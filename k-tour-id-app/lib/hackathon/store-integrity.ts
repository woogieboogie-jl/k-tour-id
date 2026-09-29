import type { Db } from "./store"
import { HkError } from "./util"
import { assertIntegrationSuiBudget } from "./integration-sui-limits"
import { assertGuideCollectionStore } from "./guide-collection"
import { isGuideJourney } from "./guide-contract"
import type { OperationRecord } from "./store"
import { parseIntegrationCutoverMarker, assertIntegrationCutoverMonotonic } from "./integration-cutover"
import { assertSharedBudget } from "./integration-shared-budget"
import { assertJitIdentityLedger } from "./jit-identity-integrity"
import { assertOmnioneTargetStore } from "./omnione-target-integrity"

/** Reject corrupt/incompatible storage instead of clearing redemption history. */
export function parseStoredJourney(raw: unknown): Db {
  const invalid = () => new HkError("store_corrupt", "Journey storage is unavailable. No changes were saved.", 503)
  if (typeof raw !== "string") throw invalid()
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { throw invalid() }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw invalid()
  const db = parsed as Record<string, unknown>
  if (db.version !== 1) throw invalid()
  for (const name of ["sessions", "operations", "redemptions", "outbox", "idempotency", "nonces"]) {
    const rows = db[name]
    if (!rows || typeof rows !== "object" || Array.isArray(rows)) throw invalid()
    if (Object.values(rows).some((row) => !row || typeof row !== "object" || Array.isArray(row))) throw invalid()
  }
  if (db.integrationSuiBudget !== undefined) {
    try { assertIntegrationSuiBudget(parsed as Db) } catch { throw invalid() }
  }
  if (db.integrationCutover !== undefined) {
    try { const marker = parseIntegrationCutoverMarker(db.integrationCutover); assertIntegrationCutoverMonotonic(marker, parsed as Db) }
    catch { throw invalid() }
  }
  if (db.integrationSharedBudget !== undefined) {
    try { assertSharedBudget(parsed as Db) } catch { throw invalid() }
  }
  if (db.guideCollection !== undefined) {
    try { assertGuideCollectionStore(db.guideCollection) } catch { throw invalid() }
  }
  if (db.jitIdentity !== undefined) {
    try { assertJitIdentityLedger(db.jitIdentity) } catch { throw invalid() }
  }
  for (const op of Object.values(db.operations as Record<string, OperationRecord>)) {
    if (op.journey !== undefined && !isGuideJourney(op)) throw invalid()
  }
  assertOmnioneTargetStore(parsed as Db)
  return parsed as Db
}
