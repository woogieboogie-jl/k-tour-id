import type { Db } from "./store"
import { HkError } from "./util"

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
  return parsed as Db
}
