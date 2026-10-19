import { describe, expect, it } from "vitest"
import { APPROVAL_TTL_MS, Approvals } from "../src/guard/approvals.js"

const key = { sessionID: "s1", tool: "massdriver_update_instance", subject: "ecomm-prod-db" }

describe("Approvals", () => {
  it("covers exactly one call", () => {
    const approvals = new Approvals()
    approvals.grant(key)
    expect(approvals.consume(key)).toBe(true)
    expect(approvals.consume(key)).toBe(false)
  })

  it("is scoped to session, tool and subject", () => {
    const approvals = new Approvals()
    approvals.grant(key)
    expect(approvals.consume({ ...key, sessionID: "s2" })).toBe(false)
    expect(approvals.consume({ ...key, tool: "bash" })).toBe(false)
    expect(approvals.consume({ ...key, subject: "ecomm-prod-api" })).toBe(false)
    expect(approvals.consume(key)).toBe(true)
  })

  it("expires", () => {
    let now = 0
    const approvals = new Approvals(() => now)
    approvals.grant(key)
    now = APPROVAL_TTL_MS + 1
    expect(approvals.consume(key)).toBe(false)
  })
})
