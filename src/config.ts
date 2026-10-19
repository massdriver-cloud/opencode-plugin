import type { Config } from "@opencode-ai/plugin"
import type { Content } from "./content.js"
import { READ_ONLY_TOOL_GLOBS, mcpToolName } from "./guard/policy.js"

export const APPROVAL_TOOL = "massdriver_production_approval"

export type MassdriverOptions = {
  mcp?: boolean
  mcpServerName?: string
  mcpImage?: string
  mcpImageTag?: string
  mcpTimeout?: number
}

export function resolveOptions(raw: Record<string, unknown> | undefined): Required<Pick<MassdriverOptions, "mcp" | "mcpServerName" | "mcpTimeout">> & MassdriverOptions {
  const options = (raw ?? {}) as MassdriverOptions
  return {
    ...options,
    mcp: options.mcp ?? true,
    mcpServerName: options.mcpServerName ?? "massdriver",
    // The launcher pulls the image on every start; the default 5s tool-listing
    // timeout is shorter than a cold pull.
    mcpTimeout: options.mcpTimeout ?? 60_000,
  }
}

type PermissionAction = "allow" | "ask" | "deny"
type PermissionMap = Record<string, unknown>

type Paths = { skillsDir: string; mcpScript: string }

function addSkillsPath(config: Config, dir: string): void {
  const current = (config as { skills?: unknown }).skills
  let skills: { paths?: string[]; urls?: string[] }
  if (Array.isArray(current)) skills = { paths: [...current] }
  else if (current && typeof current === "object") skills = { ...(current as object) }
  else skills = {}
  const paths = skills.paths ?? []
  if (!paths.includes(dir)) skills.paths = [...paths, dir]
  ;(config as { skills?: unknown }).skills = skills
}

function mcpEnvironment(options: MassdriverOptions): Record<string, string> | undefined {
  const environment: Record<string, string> = {}
  if (options.mcpImageTag) environment.MASSDRIVER_MCP_SERVER_TAG = options.mcpImageTag
  if (options.mcpImage) environment.MASSDRIVER_MCP_IMAGE = options.mcpImage
  return Object.keys(environment).length > 0 ? environment : undefined
}

function permissionMap(config: Config): PermissionMap {
  const current = (config as { permission?: unknown }).permission
  if (typeof current === "string") return { "*": current }
  if (current && typeof current === "object") return { ...(current as PermissionMap) }
  return {}
}

export function applyConfig(
  config: Config,
  content: Content,
  options: ReturnType<typeof resolveOptions>,
  paths: Paths,
): void {
  addSkillsPath(config, paths.skillsDir)

  const agents = ((config as { agent?: Record<string, unknown> }).agent ??= {})
  for (const [name, agent] of Object.entries(content.agents)) {
    agents[name] = { ...agent, ...((agents[name] as object | undefined) ?? {}) }
  }

  const commands = ((config as { command?: Record<string, unknown> }).command ??= {})
  for (const [name, command] of Object.entries(content.commands)) {
    commands[name] = { ...command, ...((commands[name] as object | undefined) ?? {}) }
  }

  if (options.mcp) {
    const mcp = ((config as { mcp?: Record<string, unknown> }).mcp ??= {})
    if (!(options.mcpServerName in mcp)) {
      const environment = mcpEnvironment(options)
      mcp[options.mcpServerName] = {
        type: "local",
        command: ["bash", paths.mcpScript],
        ...(environment ? { environment } : {}),
        timeout: options.mcpTimeout,
      }
    }
  }

  const permission = permissionMap(config)
  const server = options.mcpServerName
  for (const glob of READ_ONLY_TOOL_GLOBS) {
    const key = mcpToolName(server, glob.slice(0, -1)) + "*"
    if (!(key in permission)) permission[key] = "allow" satisfies PermissionAction
  }
  permission[mcpToolName(server, "approve_deployment")] = "deny" satisfies PermissionAction
  permission[APPROVAL_TOOL] = "ask" satisfies PermissionAction
  ;(config as { permission?: unknown }).permission = permission
}
