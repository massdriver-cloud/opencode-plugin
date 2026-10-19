import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { DEFAULT_PATTERN, compilePattern, loadProductionPattern, parsePatternSetting } from "../src/guard/pattern.js"

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "massdriver-pattern-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function settings(folder: ".opencode" | ".claude", contents: string) {
  mkdirSync(join(dir, folder), { recursive: true })
  writeFileSync(join(dir, folder, "massdriver.local.md"), contents)
}

describe("loadProductionPattern", () => {
  it("defaults without a settings file", () => {
    expect(loadProductionPattern(dir)).toBe(DEFAULT_PATTERN)
  })

  it("reads .opencode/massdriver.local.md", () => {
    settings(".opencode", "---\nproduction_pattern: (live|prd)\n---\n")
    expect(loadProductionPattern(dir).source).toBe("(live|prd)")
  })

  it("falls back to .claude/massdriver.local.md", () => {
    settings(".claude", "---\nproduction_pattern: '^prd$'\n---\n")
    expect(loadProductionPattern(dir).source).toBe("^prd$")
  })

  it("prefers .opencode over .claude", () => {
    settings(".opencode", "production_pattern: live\n")
    settings(".claude", "production_pattern: prd\n")
    expect(loadProductionPattern(dir).source).toBe("live")
  })

  it("keeps the default when the pattern is not a valid regex", () => {
    settings(".opencode", "production_pattern: (unclosed\n")
    expect(loadProductionPattern(dir)).toBe(DEFAULT_PATTERN)
  })

  it("keeps the default when the pattern is empty", () => {
    settings(".opencode", 'production_pattern: ""\n')
    expect(loadProductionPattern(dir)).toBe(DEFAULT_PATTERN)
  })
})

describe("parsePatternSetting", () => {
  it("takes the first production_pattern line", () => {
    expect(parsePatternSetting("a: 1\n  production_pattern: \"x|y\"\nproduction_pattern: z\n")).toBe("x|y")
  })
})

describe("compilePattern", () => {
  it("accepts POSIX bracket classes", () => {
    const pattern = compilePattern("^prd[[:digit:]]+$")!
    expect(pattern.test("prd2")).toBe(true)
    expect(pattern.test("prdx")).toBe(false)
  })
})
