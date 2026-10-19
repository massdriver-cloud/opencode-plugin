import { readFileSync } from "node:fs"
import { join } from "node:path"

export const DEFAULT_PATTERN_SOURCE = "(prod|production)"

export const SETTINGS_FILES = [
  join(".opencode", "massdriver.local.md"),
  join(".claude", "massdriver.local.md"),
]

// The pattern is written for bash's ERE matcher in the Claude plugin, so
// POSIX bracket classes have to keep working after the move to JS RegExp.
const POSIX_CLASSES: Record<string, string> = {
  "[:alnum:]": "a-zA-Z0-9",
  "[:alpha:]": "a-zA-Z",
  "[:digit:]": "0-9",
  "[:lower:]": "a-z",
  "[:upper:]": "A-Z",
  "[:space:]": "\\s",
  "[:blank:]": " \\t",
  "[:punct:]": "!-\\/:-@\\[-`{-~",
  "[:xdigit:]": "0-9A-Fa-f",
}

export function compilePattern(source: string): RegExp | undefined {
  let translated = source
  for (const [posix, js] of Object.entries(POSIX_CLASSES)) {
    translated = translated.split(posix).join(js)
  }
  try {
    return new RegExp(translated)
  } catch {
    return undefined
  }
}

export const DEFAULT_PATTERN = compilePattern(DEFAULT_PATTERN_SOURCE) as RegExp

export function parsePatternSetting(contents: string): string | undefined {
  for (const line of contents.split(/\r?\n/)) {
    const match = /^\s*production_pattern:\s*(.*)$/.exec(line)
    if (!match) continue
    const value = match[1].replace(/^["']/, "").replace(/["']$/, "")
    return value === "" ? undefined : value
  }
  return undefined
}

export function loadProductionPattern(directory: string): RegExp {
  for (const relative of SETTINGS_FILES) {
    let contents: string
    try {
      contents = readFileSync(join(directory, relative), "utf8")
    } catch {
      continue
    }
    const source = parsePatternSetting(contents)
    if (source === undefined) return DEFAULT_PATTERN
    return compilePattern(source) ?? DEFAULT_PATTERN
  }
  return DEFAULT_PATTERN
}
