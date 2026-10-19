import { parse } from "yaml"

export const AGENT_PREFIX = "massdriver-"
export const COMMAND_PREFIX = "massdriver:"

const AGENT_NAMES = ["architect", "bundle-dev", "upgrade-tester", "resource-import"]

// Each rule must match somewhere in the source, so an upstream rewording fails
// the build instead of silently shipping Claude-only instructions.
export const REWRITES = [
  {
    name: "agent references",
    from: new RegExp(`\`?\\b(${AGENT_NAMES.join("|")})\`? agent\\b`, "g"),
    to: `\`${AGENT_PREFIX}$1\` agent`,
  },
  { name: "Task tool", from: /\bthe Task tool to spawn\b/g, to: "the task tool to start" },
  { name: "AskUserQuestion", from: /`AskUserQuestion`/g, to: "the `question` tool" },
  { name: "WebFetch", from: /\bwith WebFetch\b/g, to: "with the webfetch tool" },
  { name: "Bash tool", from: /\bBash\b/g, to: "bash" },
  { name: "Claude Code", from: /\bClaude Code\b/g, to: "opencode" },
  { name: "install Claude", from: /\binstall Claude →/g, to: "install opencode →" },
  { name: "only Claude", from: /\bwith only Claude\b/g, to: "with only opencode" },
  { name: "settings file", from: /\.claude\/massdriver\.local\.md/g, to: ".opencode/massdriver.local.md" },
]

export function splitFrontmatter(markdown) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(markdown)
  if (!match) return { data: {}, body: markdown }
  return { data: parse(match[1]) ?? {}, body: match[2] }
}

export function rewrite(text, hits) {
  let out = text
  for (const rule of REWRITES) {
    out = out.replace(rule.from, (...groups) => {
      hits.add(rule.name)
      return rule.to.replace(/\$(\d)/g, (_, i) => groups[Number(i)])
    })
  }
  return out
}

export function assertAllRulesUsed(hits) {
  const unused = REWRITES.filter((rule) => !hits.has(rule.name)).map((rule) => rule.name)
  if (unused.length > 0) {
    throw new Error(
      `Rewrite rules matched nothing in the Claude plugin source: ${unused.join(", ")}. Review the upstream change and update scripts/translate.mjs.`,
    )
  }
}

function skillPreamble(skills) {
  if (!Array.isArray(skills) || skills.length === 0) return ""
  const names = skills.map((skill) => `\`${skill}\``).join(", ")
  return `Before anything else, load the ${names} skill${skills.length > 1 ? "s" : ""} with the skill tool.\n\n`
}

export function translateAgent(fileName, markdown, hits) {
  const { data, body } = splitFrontmatter(markdown)
  const name = AGENT_PREFIX + (data.name ?? fileName.replace(/\.md$/, ""))
  if (typeof data.description !== "string" || data.description.trim() === "") {
    throw new Error(`Agent ${fileName} has no description`)
  }
  return [
    name,
    {
      description: rewrite(data.description.trim(), hits),
      mode: "subagent",
      prompt: skillPreamble(data.skills) + rewrite(body.trim(), hits) + "\n",
    },
  ]
}

export function translateCommand(fileName, markdown, hits) {
  const { data, body } = splitFrontmatter(markdown)
  const name = COMMAND_PREFIX + (data.name ?? fileName.replace(/\.md$/, ""))
  if (typeof data.description !== "string" || data.description.trim() === "") {
    throw new Error(`Command ${fileName} has no description`)
  }
  return [
    name,
    {
      description: data.description.trim(),
      template: rewrite(body.trim(), hits) + "\n\nARGUMENTS: $ARGUMENTS\n",
    },
  ]
}
