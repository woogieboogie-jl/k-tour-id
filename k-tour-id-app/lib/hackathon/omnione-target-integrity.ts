import type { Db } from "./store"
import { sameOmnioneTarget, storedOmnioneTarget } from "./omnione-targets"
import { HkError } from "./util"

const invalid = () => new HkError("store_corrupt", "Chain target history could not be verified. No changes were saved.", 503)
/** Also run on reads: a damaged target must not become a current-config fallback. */
export function assertOmnioneTargetStore(db: Db) {
  try {
    for (const op of Object.values(db.operations)) {
      storedOmnioneTarget(op.omnioneTarget)
      if (op.chain && !sameOmnioneTarget(op.omnioneTarget, op.chain.target)) throw invalid()
    }
    for (const row of Object.values(db.outbox)) {
      storedOmnioneTarget(row.target)
      const op = db.operations[row.operationId]
      if (op && !sameOmnioneTarget(op.omnioneTarget, row.target)) throw invalid()
    }
  } catch { throw invalid() }
}
export function omnioneTargetBindings(db: Db) {
  assertOmnioneTargetStore(db)
  return {
    operations: Object.fromEntries(Object.entries(db.operations).map(([id, op]) => [id, storedOmnioneTarget(op.omnioneTarget).targetId])),
    outbox: Object.fromEntries(Object.entries(db.outbox).map(([id, row]) => [id, storedOmnioneTarget(row.target).targetId])),
  }
}
/** Retained rows cannot be rebound, including before their outbox exists. Normal TTL pruning is unchanged. */
export function assertOmnioneTargetMonotonic(before: ReturnType<typeof omnioneTargetBindings>, db: Db) {
  const after = omnioneTargetBindings(db)
  for (const kind of ["operations", "outbox"] as const) for (const [id, target] of Object.entries(before[kind])) {
    if (after[kind][id] !== undefined && after[kind][id] !== target) throw invalid()
  }
}
