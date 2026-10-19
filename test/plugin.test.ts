import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Config, Hooks, PluginInput } from "@opencode-ai/plugin"

vi.mock("../src/content.js", () => ({
  SKILLS_DIR: "/plugin/skills",
  MCP_SCRIPT: "/plugin/bin/run-mcp-server.sh",
  loadContent: () => ({
    source: { repository: "r", ref: "x" },
    agents: { "massdriver-bundle-dev": { description: "d", mode: "subagent", prompt: "p" } },
    commands: { "massdriver:develop": { description: "d", template: "t $ARGUMENTS" } },
  }),
}))

const { MassdriverPlugin } = await import("../src/index.js")

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "massdriver-plugin-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

async function load(options?: Record<string, unknown>): Promise<Hooks> {
  return MassdriverPlugin({ directory: dir, worktree: dir } as PluginInput, options)
}

async function run(hooks: Hooks, tool: string, args: Record<string, unknown>, sessionID = "s1") {
  await hooks["tool.execute.before"]!({ tool, sessionID, callID: "c1" }, { args })
}

const approvalContext = (ask = vi.fn(async () => {})) =>
  ({ sessionID: "s1", messageID: "m", agent: "build", directory: dir, worktree: dir, abort: new AbortController().signal, metadata() {}, ask }) as never

describe("tool.execute.before", () => {
  it("blocks a stable bundle publish", async () => {
    const hooks = await load()
    await expect(run(hooks, "bash", { command: "mass bundle publish" })).rejects.toThrow(/--development/)
  })

  it("lets a development publish through", async () => {
    const hooks = await load()
    await expect(run(hooks, "bash", { command: "mass bundle publish --development" })).resolves.toBeUndefined()
  })

  it("blocks approve_deployment on the MCP server", async () => {
    const hooks = await load()
    await expect(run(hooks, "massdriver_approve_deployment", { id: "u" })).rejects.toThrow(/human authorization/)
  })

  it("follows a renamed MCP server", async () => {
    const hooks = await load({ mcpServerName: "md" })
    await expect(run(hooks, "md_delete_environment", { id: "shop-prod" })).rejects.toThrow(/production/)
    await expect(run(hooks, "massdriver_delete_environment", { id: "shop-prod" })).resolves.toBeUndefined()
  })

  it("holds a production config change until the user approves it once", async () => {
    const hooks = await load()
    const call = () => run(hooks, "massdriver_update_instance", { id: "ecomm-prod-db", version: "1.2.3" })

    await expect(call()).rejects.toThrow(/massdriver_production_approval/)

    const ask = vi.fn(async () => {})
    const approval = hooks.tool!.massdriver_production_approval
    await approval.execute(
      { tool: "massdriver_update_instance", subject: "ecomm-prod-db", summary: "pin version" },
      approvalContext(ask),
    )
    expect(ask).toHaveBeenCalledWith(
      expect.objectContaining({ permission: "massdriver_production_approval", patterns: ["massdriver_update_instance ecomm-prod-db"] }),
    )

    await expect(call()).resolves.toBeUndefined()
    await expect(call()).rejects.toThrow(/Held/)
  })

  it("grants nothing when the user rejects", async () => {
    const hooks = await load()
    const approval = hooks.tool!.massdriver_production_approval
    const ask = vi.fn(async () => {
      throw new Error("rejected")
    })
    await expect(
      approval.execute({ tool: "bash", subject: "ecomm-prod", summary: "x" }, approvalContext(ask)),
    ).rejects.toThrow("rejected")
    await expect(run(hooks, "bash", { command: "mass env update ecomm-prod -d x" })).rejects.toThrow(/Held/)
  })
})

describe("config", () => {
  it("registers skills, agents, commands, MCP and permissions", async () => {
    const hooks = await load()
    const config = { permission: { "*": "ask" } } as Config
    await hooks.config!(config)
    const c = config as Record<string, any>

    expect(c.skills.paths).toEqual(["/plugin/skills"])
    expect(c.agent["massdriver-bundle-dev"]).toMatchObject({ mode: "subagent" })
    expect(c.command["massdriver:develop"].template).toContain("$ARGUMENTS")
    expect(c.mcp.massdriver).toEqual({
      type: "local",
      command: ["bash", "/plugin/bin/run-mcp-server.sh"],
      timeout: 60_000,
    })
    expect(c.permission).toMatchObject({
      "*": "ask",
      "massdriver_get_*": "allow",
      "massdriver_list_*": "allow",
      massdriver_approve_deployment: "deny",
      massdriver_production_approval: "ask",
    })
    expect(Object.keys(c.permission)[0]).toBe("*")
  })

  it("keeps the user's own definitions", async () => {
    const hooks = await load({ mcpImageTag: "1.4.0" })
    const config = {
      skills: ["./mine"],
      mcp: { massdriver: { type: "remote", url: "https://example.test" } },
      agent: { "massdriver-bundle-dev": { model: "anthropic/claude-sonnet-4-5" } },
      permission: { "massdriver_get_*": "ask" },
    } as unknown as Config
    await hooks.config!(config)
    const c = config as Record<string, any>

    expect(c.skills.paths).toEqual(["./mine", "/plugin/skills"])
    expect(c.mcp.massdriver).toEqual({ type: "remote", url: "https://example.test" })
    expect(c.agent["massdriver-bundle-dev"]).toMatchObject({ model: "anthropic/claude-sonnet-4-5", prompt: "p" })
    expect(c.permission["massdriver_get_*"]).toBe("ask")
  })

  it("pins the image tag", async () => {
    const hooks = await load({ mcpImageTag: "1.4.0" })
    const config = {} as Config
    await hooks.config!(config)
    expect((config as Record<string, any>).mcp.massdriver.environment).toEqual({ MASSDRIVER_MCP_SERVER_TAG: "1.4.0" })
  })

  it("can leave MCP to the user", async () => {
    const hooks = await load({ mcp: false })
    const config = {} as Config
    await hooks.config!(config)
    expect((config as Record<string, any>).mcp).toBeUndefined()
  })
})
