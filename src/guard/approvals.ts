export const APPROVAL_TTL_MS = 10 * 60 * 1000

export type ApprovalKey = {
  sessionID: string
  tool: string
  subject: string
}

const keyOf = ({ sessionID, tool, subject }: ApprovalKey) => JSON.stringify([sessionID, tool, subject])

// One approval covers exactly one retried call. Anything broader would turn a
// single human "yes" into standing permission against production.
export class Approvals {
  private readonly grants = new Map<string, number>()

  constructor(private readonly now: () => number = Date.now) {}

  grant(key: ApprovalKey): void {
    this.grants.set(keyOf(key), this.now() + APPROVAL_TTL_MS)
  }

  consume(key: ApprovalKey): boolean {
    const id = keyOf(key)
    const expires = this.grants.get(id)
    if (expires === undefined) return false
    this.grants.delete(id)
    return expires >= this.now()
  }
}
