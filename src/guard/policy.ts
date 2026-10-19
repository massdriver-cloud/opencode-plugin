export type Verdict =
  | { action: "allow"; reason: string }
  | { action: "deny"; reason: string }
  | { action: "ask"; reason: string; subject: string }

export type Args = Record<string, unknown>

export const PROD_CONFIG_REASON =
  "Production target. Agents may configure production only for an instance that is not deployed yet (an import). Approve only if that is what this is."

export const SHOW_SECRETS_REASON =
  "Reads the Massdriver API key from your active mass CLI profile so OpenTofu can authenticate to the Massdriver state backend. Approve only if the key is piped into a variable, not printed."

export const SHOW_SECRETS_SUBJECT = "mass config get --show-secrets"

const SHOW_SECRETS_RE =
  /(^|[\s("`=])mass\s([^;&|]*\s)?config\s+get\s([^;&|]*\s)?--show-secrets([\s=)"`]|$)/

function str(args: Args, key: string): string {
  const value = args[key]
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return ""
}

function matches(pattern: RegExp, value: string): boolean {
  return value !== "" && pattern.test(value)
}

// Slugs are lowercase alphanumeric ids joined by '-', so the env is always the
// second segment. An unexpected shape falls back to the whole slug, which can
// only make the guard stricter.
export function envOf(slug: string, expectedSegments: number): string {
  const parts = slug.split("-")
  if (parts.length > 1 && parts[parts.length - 1] === "") parts.pop()
  return parts.length === expectedSegments ? parts[1] : slug
}

function slugIsProd(pattern: RegExp, slug: string, expectedSegments: number): boolean {
  if (slug === "") return false
  return matches(pattern, envOf(slug, expectedSegments))
}

const deny = (reason: string): Verdict => ({ action: "deny", reason })
const allow = (reason: string): Verdict => ({ action: "allow", reason })
const ask = (subject: string, reason = PROD_CONFIG_REASON): Verdict => ({ action: "ask", reason, subject })

const READ_ONLY_PREFIXES = ["get_", "list_", "compare_", "evaluate_", "explain_"]

export const READ_ONLY_TOOL_GLOBS = READ_ONLY_PREFIXES.map((prefix) => `${prefix}*`)

export function checkMcp(tool: string, args: Args, pattern: RegExp): Verdict | undefined {
  const p = pattern.source

  if (tool === "approve_deployment") {
    return deny(
      "Approving deployments is a human authorization step. Approve in the Massdriver UI, or reject with reject_deployment.",
    )
  }
  if (READ_ONLY_PREFIXES.some((prefix) => tool.startsWith(prefix))) {
    return allow("Read-only Massdriver tool; safe on any environment.")
  }

  switch (tool) {
    case "propose_deployment":
    case "set_instance_secret":
    case "remove_instance_secret":
    case "set_remote_reference":
    case "remove_remote_reference": {
      const slug = str(args, "instance_id")
      return slugIsProd(pattern, slug, 3) ? ask(slug) : undefined
    }
    case "update_instance": {
      const slug = str(args, "id")
      return slugIsProd(pattern, slug, 3) ? ask(slug) : undefined
    }
    case "copy_instance": {
      const slug = str(args, "destination_id")
      return slugIsProd(pattern, slug, 3) ? ask(slug) : undefined
    }
    case "update_environment": {
      const slug = str(args, "id")
      return slugIsProd(pattern, slug, 2) ? ask(slug) : undefined
    }
    case "set_environment_default":
    case "remove_environment_default": {
      const slug = str(args, "environment_id")
      return slugIsProd(pattern, slug, 2) ? ask(slug) : undefined
    }
    case "update_resource":
    case "create_resource_grant": {
      const slug = str(args, "id") || str(args, "resource_id")
      if (!slug.includes(".")) return undefined
      return matches(pattern, envOf(slug.slice(0, slug.indexOf(".")), 3)) ? ask(slug) : undefined
    }
    case "create_deployment": {
      if (str(args, "action") === "PLAN") return undefined
      const slug = str(args, "instance_id")
      if (!slugIsProd(pattern, slug, 3)) return undefined
      return deny(
        `${slug} targets a production environment (pattern: ${p}). Plan with action: PLAN, or hand off with propose_deployment for a human to approve.`,
      )
    }
    case "orphan_instance": {
      const slug = str(args, "instance_id")
      if (!slugIsProd(pattern, slug, 3)) return undefined
      return deny(`${slug} targets a production environment (pattern: ${p}); refusing to orphan a production instance.`)
    }
    case "delete_environment":
    case "deploy_environment":
    case "decommission_environment": {
      const slug = str(args, "id")
      if (!slugIsProd(pattern, slug, 2)) return undefined
      return deny(
        `${slug} matches the production pattern (${p}); refusing to deploy, decommission or delete a production environment.`,
      )
    }
    case "create_environment": {
      const slug = str(args, "id")
      if (!matches(pattern, slug)) return undefined
      return deny(
        `Environment id '${slug}' matches the production pattern (${p}). Agents may not create production-named environments; create it in the Massdriver UI if intended.`,
      )
    }
    case "delete_project": {
      const slug = str(args, "id")
      if (!matches(pattern, slug)) return undefined
      return deny(`Project id '${slug}' matches the production pattern (${p}); refusing to delete a production project.`)
    }
    case "delete_resource": {
      const slug = str(args, "id")
      if (!slug.includes(".")) return undefined
      const env = envOf(slug.slice(0, slug.indexOf(".")), 3)
      if (!matches(pattern, env)) return undefined
      return deny(`Resource belongs to a production instance (env '${env}' matches ${p}); refusing to delete it.`)
    }
  }
  return undefined
}

const SUBCOMMANDS = new Set(["bundle", "instance", "inst", "package", "pkg", "environment", "env", "project"])

function firstPositional(tokens: string[]): string {
  return tokens.find((token) => !token.startsWith("-")) ?? ""
}

type Mode = "deny" | "ask"

function scanSegment(segment: string, mode: Mode, pattern: RegExp): Verdict | undefined {
  const p = pattern.source
  let tokens = segment.split(/\s+/).filter((token) => token !== "")

  while (tokens.length > 0 && !tokens[0].startsWith("-") && tokens[0].includes("=")) {
    tokens = tokens.slice(1)
  }
  if (tokens.length < 2 || tokens[0] !== "mass") return undefined

  // Global flags must not push the subcommand out of position, or
  // `mass --profile x bundle publish` would walk past every check below.
  tokens = tokens.slice(1)
  while (tokens.length > 0) {
    const token = tokens[0]
    if (token.startsWith("--profile=") || token === "--help" || token === "-h") {
      tokens = tokens.slice(1)
    } else if (token === "--profile") {
      tokens = tokens.slice(2)
    } else if (SUBCOMMANDS.has(token)) {
      break
    } else {
      tokens = tokens.slice(1)
    }
  }
  if (tokens.length === 0) return undefined

  const [command, action = "", ...rest] = tokens

  switch (command) {
    case "bundle": {
      if (mode !== "deny" || action !== "publish") return undefined
      const development = rest.some((token) => ["--development", "-d", "--help", "-h"].includes(token))
      if (development) return undefined
      return deny(
        "Missing --development flag. Stable releases need human authorization. Use: mass bundle publish --development",
      )
    }
    case "instance":
    case "inst":
    case "package":
    case "pkg": {
      if (action === "deploy" || action === "destroy") {
        if (mode !== "deny") return undefined
        if (action === "deploy" && ` ${segment} `.includes(" --plan ")) return undefined
        const slug = firstPositional(rest)
        if (!slugIsProd(pattern, slug, 3)) return undefined
        return deny(`${slug} targets a production environment (pattern: ${p}). Use a non-production environment.`)
      }
      if (action === "version") {
        if (mode !== "ask") return undefined
        const slug = firstPositional(rest).split("@")[0]
        return slugIsProd(pattern, slug, 3) ? ask(slug) : undefined
      }
      return undefined
    }
    case "environment":
    case "env": {
      if (action !== "delete" && action !== "update" && action !== "default") return undefined
      const slug = firstPositional(rest)
      if (!slugIsProd(pattern, slug, 2)) return undefined
      if (action === "delete" && mode === "deny") {
        return deny(`${slug} matches the production pattern (${p}); refusing to delete a production environment.`)
      }
      if (action !== "delete" && mode === "ask") return ask(slug)
      return undefined
    }
    case "project": {
      if (mode !== "deny" || action !== "delete") return undefined
      const slug = firstPositional(rest)
      if (!matches(pattern, slug)) return undefined
      return deny(`Project '${slug}' matches the production pattern (${p}); refusing to delete a production project.`)
    }
  }
  return undefined
}

function scan(command: string, mode: Mode, pattern: RegExp): Verdict | undefined {
  for (const segment of command.split(/&&|\|\||;|\||\n/)) {
    const verdict = scanSegment(segment, mode, pattern)
    if (verdict) return verdict
  }
  return undefined
}

export function checkBash(command: string, pattern: RegExp): Verdict | undefined {
  if (!/[\s;&|(]mass\s/.test(` ${command}`)) return undefined

  const verdict = scan(command, "deny", pattern) ?? scan(command, "ask", pattern)
  if (verdict) return verdict

  // Profile auth has no other way to hand the API key to the state backend.
  if (SHOW_SECRETS_RE.test(command)) return ask(SHOW_SECRETS_SUBJECT, SHOW_SECRETS_REASON)
  return undefined
}

export type GuardOptions = {
  pattern: RegExp
  mcpServers: string[]
}

export function mcpToolName(server: string, tool: string): string {
  const sanitize = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "_")
  return `${sanitize(server)}_${sanitize(tool)}`
}

export function evaluate(tool: string, args: Args, options: GuardOptions): Verdict | undefined {
  if (tool === "bash") return checkBash(str(args, "command"), options.pattern)
  for (const server of options.mcpServers) {
    const prefix = mcpToolName(server, "")
    if (tool.startsWith(prefix)) return checkMcp(tool.slice(prefix.length), args, options.pattern)
  }
  return undefined
}
