import { describe, expect, it } from "vitest"
// @ts-expect-error plain JS build script
import { assertAllRulesUsed, rewrite, translateAgent, translateCommand } from "../scripts/translate.mjs"

describe("translateAgent", () => {
  it("maps Claude agent frontmatter to an opencode subagent", () => {
    const hits = new Set<string>()
    const [name, agent] = translateAgent(
      "bundle-dev.md",
      "---\nname: bundle-dev\ndescription: >-\n  Builds bundles.\nwhenToUse: |\n  examples\nskills:\n  - massdriver\n---\n\nRun `openssl` (Bash). Exit Claude Code to re-point.\n",
      hits,
    )
    expect(name).toBe("massdriver-bundle-dev")
    expect(agent).toEqual({
      description: "Builds bundles.",
      mode: "subagent",
      prompt:
        "Before anything else, load the `massdriver` skill with the skill tool.\n\nRun `openssl` (bash). Exit opencode to re-point.\n",
    })
  })
})

describe("translateCommand", () => {
  it("namespaces the command and passes arguments through", () => {
    const [name, command] = translateCommand(
      "develop.md",
      "---\nname: develop\ndescription: Develop a bundle\nallowed-tools:\n  - Task\n---\n\nUse the Task tool to spawn the `bundle-dev` agent.\n",
      new Set(),
    )
    expect(name).toBe("massdriver:develop")
    expect(command).toEqual({
      description: "Develop a bundle",
      template: "Use the task tool to start the `massdriver-bundle-dev` agent.\n\nARGUMENTS: $ARGUMENTS\n",
    })
  })
})

describe("rewrite", () => {
  it("maps Claude-only tool names", () => {
    const out = rewrite("Use `AskUserQuestion`. Fetch with WebFetch. See .claude/massdriver.local.md.", new Set())
    expect(out).toBe("Use the `question` tool. Fetch with the webfetch tool. See .opencode/massdriver.local.md.")
  })

  it("fails the build when a rule stops matching upstream", () => {
    expect(() => assertAllRulesUsed(new Set(["Bash tool"]))).toThrow(/matched nothing/)
  })
})
