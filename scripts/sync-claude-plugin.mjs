import { execFileSync } from "node:child_process"
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { assertAllRulesUsed, translateAgent, translateCommand } from "./translate.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
const { repository, ref, path: pluginPath } = pkg.claudePlugin
const dist = join(root, "dist")

function git(cwd, ...args) {
  execFileSync("git", args, { cwd, stdio: ["ignore", "ignore", "inherit"] })
}

function checkout() {
  const local = process.env.CLAUDE_PLUGINS_DIR
  if (local) {
    console.warn(`sync: using local checkout ${local} instead of ${ref}`)
    return { dir: resolve(local), ref: "local" }
  }
  const dir = join(root, ".cache", "claude-plugins", ref)
  if (!existsSync(join(dir, ".git", "HEAD")) || !existsSync(join(dir, pluginPath))) {
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    git(dir, "init", "--quiet")
    git(dir, "remote", "add", "origin", repository)
    git(dir, "fetch", "--quiet", "--depth", "1", "origin", ref)
    git(dir, "checkout", "--quiet", "--detach", "FETCH_HEAD")
  }
  return { dir, ref }
}

const source = checkout()
const plugin = join(source.dir, pluginPath)
const hits = new Set()

const markdownFiles = (dir) =>
  readdirSync(join(plugin, dir))
    .filter((file) => file.endsWith(".md"))
    .sort()

const agents = Object.fromEntries(
  markdownFiles("agents").map((file) => translateAgent(file, readFileSync(join(plugin, "agents", file), "utf8"), hits)),
)
const commands = Object.fromEntries(
  markdownFiles("commands").map((file) =>
    translateCommand(file, readFileSync(join(plugin, "commands", file), "utf8"), hits),
  ),
)
assertAllRulesUsed(hits)

mkdirSync(dist, { recursive: true })
rmSync(join(dist, "skills"), { recursive: true, force: true })
cpSync(join(plugin, "skills"), join(dist, "skills"), { recursive: true })

mkdirSync(join(dist, "bin"), { recursive: true })
cpSync(join(plugin, "scripts", "run-mcp-server.sh"), join(dist, "bin", "run-mcp-server.sh"))
chmodSync(join(dist, "bin", "run-mcp-server.sh"), 0o755)

writeFileSync(
  join(dist, "content.json"),
  JSON.stringify({ source: { repository, ref: source.ref }, agents, commands }, null, 2) + "\n",
)

console.log(
  `sync: ${Object.keys(agents).length} agents, ${Object.keys(commands).length} commands, skills from ${repository}@${source.ref}`,
)
