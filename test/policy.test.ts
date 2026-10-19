import { describe, expect, it } from "vitest"
import { DEFAULT_PATTERN, compilePattern } from "../src/guard/pattern.js"
import { type Args, envOf, evaluate } from "../src/guard/policy.js"

type Expected = "allow" | "deny" | "ask" | "pass"

const options = (pattern = DEFAULT_PATTERN) => ({ pattern, mcpServers: ["massdriver"] })

function decide(tool: string, args: Args, pattern = DEFAULT_PATTERN): Expected {
  return evaluate(tool, args, options(pattern))?.action ?? "pass"
}

const mcp = (name: string, args: Args) => ["massdriver_" + name, args] as const
const bash = (command: string) => ["bash", { command, description: "test" }] as const

type Case = [string, Expected, readonly [string, Args]]

const cases: Case[] = [
  ["get_instance on prod is read-only", "allow", mcp("get_instance", { id: "ecomm-prod-db" })],
  ["list_projects", "allow", mcp("list_projects", {})],
  ["compare_environments vs prod", "allow", mcp("compare_environments", { source_id: "ecomm-prod", target_id: "ecomm-testa" })],
  ["get_deployment_logs follow", "allow", mcp("get_deployment_logs", { id: "x", follow: true })],
  ["evaluate_policy", "allow", mcp("evaluate_policy", { action: "project:view", entity_id: "p" })],
  ["export_resource needs the prompt", "pass", mcp("export_resource", { id: "abc" })],

  ["delete_environment prod", "deny", mcp("delete_environment", { id: "mcptest-prod" })],
  ["deploy_environment prod", "deny", mcp("deploy_environment", { id: "mcptest-prod" })],
  ["decommission_environment prod", "deny", mcp("decommission_environment", { id: "mcptest-prod" })],
  ["create_deployment PROVISION prod", "deny", mcp("create_deployment", { instance_id: "mcptest-prod-demo", action: "PROVISION" })],
  ["orphan_instance prod", "deny", mcp("orphan_instance", { instance_id: "mcptest-prod-demo" })],
  ["delete_project prod-matching id", "deny", mcp("delete_project", { id: "prodsvc" })],
  ["remove_environment_default prod", "ask", mcp("remove_environment_default", { environment_id: "mcptest-prod", resource_type: "x" })],
  ["update_instance non-prod", "pass", mcp("update_instance", { id: "mcptest-testa-demo", version: "1.2.3" })],
  ["deny beats prod-config ask", "deny", bash("mass env update ecomm-prod -d x && mass bundle publish")],
  ["delete_resource on prod instance", "deny", mcp("delete_resource", { id: "mcptest-prod-demo.bucket" })],
  ["approve_deployment always", "deny", mcp("approve_deployment", { id: "7f3e0000-0000-0000-0000-000000000000" })],

  ["update_environment prod (config)", "ask", mcp("update_environment", { id: "mcptest-prod", description: "x" })],
  ["propose_deployment prod (needs approval)", "ask", mcp("propose_deployment", { instance_id: "mcptest-prod-demo", action: "PROVISION" })],
  ["set_instance_secret prod (config)", "ask", mcp("set_instance_secret", { instance_id: "mcptest-prod-demo", name: "k", value: "v" })],
  ["update_instance prod (config)", "ask", mcp("update_instance", { id: "mcptest-prod-demo", version: "1.2.3" })],
  ["copy_instance prod destination (config)", "ask", mcp("copy_instance", { source_id: "mcptest-testa-demo", destination_id: "mcptest-prod-demo" })],
  ["set_environment_default prod (config)", "ask", mcp("set_environment_default", { environment_id: "mcptest-prod", resource_id: "u" })],
  ["create_environment named prod", "deny", mcp("create_environment", { project_id: "mcptest", id: "prod", name: "Production" })],
  ["update_resource on prod instance (config)", "ask", mcp("update_resource", { id: "mcptest-prod-demo.bucket", name: "x" })],
  ["create_resource_grant prod (config)", "ask", mcp("create_resource_grant", { resource_id: "mcptest-prod-demo.bucket", action: "resource:export" })],
  ["create_deployment PLAN on prod", "pass", mcp("create_deployment", { instance_id: "mcptest-prod-demo", action: "PLAN" })],
  ["copy_instance FROM prod source", "pass", mcp("copy_instance", { source_id: "mcptest-prod-demo", destination_id: "mcptest-testa-demo" })],
  ["fork_environment from prod parent", "pass", mcp("fork_environment", { parent_id: "mcptest-prod", id: "agentx7", name: "Fork" })],
  ["plan_deployment (uuid)", "pass", mcp("plan_deployment", { id: "u" })],
  ["rollback_deployment (uuid)", "pass", mcp("rollback_deployment", { id: "u" })],
  ["reject_deployment (uuid)", "pass", mcp("reject_deployment", { id: "u" })],
  ["abort_deployment (uuid)", "pass", mcp("abort_deployment", { id: "u" })],
  ["update_environment non-prod", "pass", mcp("update_environment", { id: "mcptest-testa", description: "prep for prod rollout" })],
  ["create_deployment PROVISION non-prod", "pass", mcp("create_deployment", { instance_id: "mcptest-testa-demo", action: "PROVISION" })],
  ["delete_project non-prod", "pass", mcp("delete_project", { id: "mcptest" })],
  ["create_project (design op)", "pass", mcp("create_project", { id: "myproj", name: "My Project" })],
  ["update_resource by uuid", "pass", mcp("update_resource", { id: "9f75ac92-fd92-4152-ae5b-9e30400e8830", name: "x" })],
  ["create_group (out of scope)", "pass", mcp("create_group", { name: "g" })],

  ["component named prodcache, env testa", "pass", mcp("set_instance_secret", { instance_id: "mcptest-testa-prodcache", name: "k", value: "v" })],
  ["env preprod blocked (substring)", "deny", mcp("delete_environment", { id: "mcptest-preprod" })],
  ["project named prodsvc, env testa", "pass", mcp("update_environment", { id: "prodsvc-testa", description: "x" })],

  ["stable publish blocked", "deny", bash("cd bundles/b && mass bundle publish")],
  ["dev publish allowed", "pass", bash("mass bundle publish --development")],
  ["dev publish -d allowed", "pass", bash("mass bundle publish -d")],
  ["publish w/ other flags still blocked", "deny", bash("mass bundle publish --skip-lint")],
  ["instance deploy prod", "deny", bash("mass instance deploy ecomm-prod-db -m msg")],
  ["instance deploy prod --plan", "pass", bash("mass instance deploy ecomm-prod-db --plan -m msg")],
  ["instance destroy prod (alias pkg)", "deny", bash("mass pkg destroy ecomm-prod-db --force")],
  ["instance deploy test env", "pass", bash("mass instance deploy ecomm-agentx7k2-db -m msg")],
  ["env delete prod (alias env)", "deny", bash("mass env delete ecomm-prod")],
  ["env update prod (config)", "ask", bash("mass env update ecomm-prod -d desc")],
  ["environment default prod (config)", "ask", bash("mass environment default ecomm-prod res-id")],
  ["instance version pin prod (config)", "ask", bash("mass instance version ecomm-prod-db@1.2.3")],
  ["project delete prod-matching", "deny", bash("mass project delete prodsvc")],
  ["read-only mass commands", "pass", bash("mass instance get ecomm-prod-db")],
  ["non-mass command untouched", "pass", bash("tofu plan -out tf.plan")],
  ["compound cmd hides publish", "deny", bash("echo hi && mass bundle publish")],
  ["env-var prefixed mass cmd", "deny", bash("MASSDRIVER_PROFILE=x mass bundle publish")],
  ["publish on a later line", "deny", bash("cd bundles/b\nmass bundle publish")],

  ["global --profile before publish", "deny", bash("mass --profile staging bundle publish")],
  ["global --profile=v before publish", "deny", bash("mass --profile=staging bundle publish")],
  ["global --profile before prod deploy", "deny", bash("mass --profile staging instance deploy ecomm-prod-db -m msg")],
  ["global --profile before prod env delete", "deny", bash("mass --profile staging env delete ecomm-prod")],
  ["global --profile before prod proj delete", "deny", bash("mass --profile staging project delete prodsvc")],
  ["profile named like a subcommand", "deny", bash("mass --profile bundle instance deploy ecomm-prod-db -m msg")],
  ["global --profile + --development ok", "pass", bash("mass --profile staging bundle publish --development")],
  ["global --profile + test env deploy ok", "pass", bash("mass --profile staging instance deploy ecomm-agentx7k2-db -m msg")],
  ["global --profile + --plan on prod ok", "pass", bash("mass --profile staging instance deploy ecomm-prod-db --plan -m msg")],
  ["massive not mass", "pass", bash("massive-tool run mass-transit")],
  ["publish --help is read-only", "pass", bash("mass bundle publish --help")],
  ["publish -h in compound cmd", "pass", bash("grep -rl x . 2>/dev/null; echo ---; mass bundle publish -h 2>&1 | head -60")],

  ["show-secrets piped into a var", "ask", bash('TF_HTTP_PASSWORD="$(mass config get -o json --show-secrets | jq -r .api_key)" tofu import a b')],
  ["show-secrets with global --profile", "ask", bash("X=$(mass --profile self-hosted config get -o json --show-secrets | jq -r .api_key)")],
  ["show-secrets standalone", "ask", bash("mass config get --show-secrets")],
  ["config get without secrets", "pass", bash('X="$(mass config get -o json | jq -r .organization_id)"')],
  ["show-secrets on another command", "pass", bash("mass config get -o json; other --show-secrets")],
  ["deny beats ask", "deny", bash("K=$(mass config get --show-secrets) && mass bundle publish")],

  ["other MCP servers are untouched", "pass", ["github_delete_environment", { id: "mcptest-prod" }]],
  ["the approval tool is not an MCP call", "pass", ["massdriver_production_approval", { tool: "bash", subject: "x" }]],
]

describe("default production pattern", () => {
  it.each(cases)("%s -> %s", (_name, expected, [tool, args]) => {
    expect(decide(tool, args)).toBe(expected)
  })
})

describe("custom production pattern", () => {
  const custom = compilePattern("(live|prd)")!

  it("blocks the custom env", () => {
    expect(decide(...mcp("delete_environment", { id: "mcptest-live" }), custom)).toBe("deny")
  })

  it("no longer treats prod as production", () => {
    expect(decide(...mcp("delete_environment", { id: "mcptest-prod" }), custom)).toBe("pass")
  })

  it("applies to the CLI", () => {
    expect(decide(...bash("mass instance deploy shop-prd-db -m msg"), custom)).toBe("deny")
  })
})

describe("ask verdicts name what needs approval", () => {
  it("uses the production slug", () => {
    expect(evaluate(...mcp("update_instance", { id: "ecomm-prod-db" }), options())).toMatchObject({
      action: "ask",
      subject: "ecomm-prod-db",
    })
  })

  it("strips the version from a CLI pin", () => {
    expect(evaluate(...bash("mass instance version ecomm-prod-db@1.2.3"), options())).toMatchObject({
      subject: "ecomm-prod-db",
    })
  })
})

describe("envOf", () => {
  it("returns the second segment for the expected shape", () => {
    expect(envOf("ecomm-prod-db", 3)).toBe("prod")
    expect(envOf("ecomm-prod", 2)).toBe("prod")
  })

  it("falls back to the whole slug for unexpected shapes", () => {
    expect(envOf("a-b-c-d", 3)).toBe("a-b-c-d")
    expect(envOf("solo", 2)).toBe("solo")
  })
})
