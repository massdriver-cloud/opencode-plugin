import { type Plugin, tool } from "@opencode-ai/plugin"
import { APPROVAL_TOOL, applyConfig, resolveOptions } from "./config.js"
import { MCP_SCRIPT, SKILLS_DIR, loadContent } from "./content.js"
import { Approvals } from "./guard/approvals.js"
import { loadProductionPattern } from "./guard/pattern.js"
import { evaluate } from "./guard/policy.js"

export const MassdriverPlugin: Plugin = async ({ directory }, rawOptions) => {
  const options = resolveOptions(rawOptions)
  const content = loadContent()
  const approvals = new Approvals()

  return {
    config: async (config) => {
      applyConfig(config, content, options, { skillsDir: SKILLS_DIR, mcpScript: MCP_SCRIPT })
    },

    "tool.execute.before": async (input, output) => {
      const verdict = evaluate(input.tool, output.args ?? {}, {
        pattern: loadProductionPattern(directory),
        mcpServers: [options.mcpServerName],
      })
      if (!verdict || verdict.action === "allow") return
      if (verdict.action === "deny") throw new Error(`Blocked by the Massdriver safety guard: ${verdict.reason}`)

      const key = { sessionID: input.sessionID, tool: input.tool, subject: verdict.subject }
      if (approvals.consume(key)) return
      throw new Error(
        [
          `Held by the Massdriver safety guard: ${verdict.reason}`,
          `To proceed, call the ${APPROVAL_TOOL} tool with tool="${input.tool}" and subject="${verdict.subject}" so the user is asked to approve, then retry this exact call once.`,
          "Tell the user what the approval is for before requesting it.",
        ].join(" "),
      )
    },

    tool: {
      [APPROVAL_TOOL]: tool({
        description:
          "Ask the user to approve one production-affecting Massdriver call that the safety guard held. Use only when the guard tells you to, with the tool and subject it named. Approval covers a single retry of that call.",
        args: {
          tool: tool.schema.string().describe("The tool id the guard held, e.g. bash or massdriver_update_instance"),
          subject: tool.schema.string().describe("The subject the guard named, usually a production slug"),
          summary: tool.schema.string().describe("One sentence telling the user what the call will change and why"),
        },
        async execute(args, context) {
          await context.ask({
            permission: APPROVAL_TOOL,
            patterns: [`${args.tool} ${args.subject}`],
            always: [],
            metadata: { tool: args.tool, subject: args.subject, summary: args.summary },
          })
          approvals.grant({ sessionID: context.sessionID, tool: args.tool, subject: args.subject })
          return `Approved. Retry the ${args.tool} call for ${args.subject} now; the approval covers one call.`
        },
      }),
    },
  }
}
