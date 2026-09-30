import type { Db } from "./store"
import { assert } from "./util"

export function publicIdentityAllocations(db: Db) {
  return Object.fromEntries(Object.values(db.operations).map(op => [op.operationId, op.secrets?.publicIdentity === true]))
}
export function assertPublicIdentityStore(db: Db) {
  for (const op of Object.values(db.operations)) {
    if (op.secrets?.publicIdentity === undefined) continue
    assert(op.secrets.publicIdentity === true && op.kind === "identity_check" && op.campaignId === "ktour-purpose-identity-v1" &&
      !op.credential && !op.presentation && !op.proposal && !op.delegation && !op.agent && !op.fulfillment && !op.chain && !op.omnioneTarget,
      "store_corrupt", "Identity-only allocation changed", 503)
  }
}
export function assertPublicIdentityMonotonic(before: Record<string, boolean>, db: Db) {
  assertPublicIdentityStore(db)
  for (const [id, previous] of Object.entries(before)) {
    const row = db.operations[id]
    // Housekeeping runs after this check. Neither a legacy gas allocation nor a
    // public-only row can be relabelled by any application mutation.
    if (row) assert((row.secrets?.publicIdentity === true) === previous, "store_corrupt", "Allocation provenance changed", 503)
  }
}
