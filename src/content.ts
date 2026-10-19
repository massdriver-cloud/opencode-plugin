import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

export type AgentDefinition = {
  description: string
  mode: "subagent" | "primary" | "all"
  prompt: string
}

export type CommandDefinition = {
  description: string
  template: string
}

export type Content = {
  source: { repository: string; ref: string }
  agents: Record<string, AgentDefinition>
  commands: Record<string, CommandDefinition>
}

export const SKILLS_DIR = fileURLToPath(new URL("./skills", import.meta.url))
export const MCP_SCRIPT = fileURLToPath(new URL("./bin/run-mcp-server.sh", import.meta.url))

export function loadContent(): Content {
  return JSON.parse(readFileSync(new URL("./content.json", import.meta.url), "utf8")) as Content
}
