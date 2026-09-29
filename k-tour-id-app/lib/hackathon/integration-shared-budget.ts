// Compatible shared allocation: legacy writers keep their existing ledger/lock.
// A guide operation lives elsewhere; legacy sees only an unowned counted slot.
// No I/O, provider authority, automatic provisioning or credential revocation.
import { createHash } from "node:crypto"
import { HkError } from "./util"

export const SHARED_BUDGET_SCOPE = Object.freeze({
  sourceKey: "ktour:sui-hosted:20260928:v1", targetKey: "ktour:integration-preview:autonomous-20260928:v1",
  controlKey: "ktour:integration-cutover:hosted-20260928:v1", scopeId: "shared_reservation_20260928_v1",
  // Authenticated Vercel metadata: first hosted Preview source-key binding. All
  // observed immutable writer revisions have the same 3-day retention and cap.
  firstBoundAt: "2026-09-28T14:46:41.384Z", expiresAt: "2026-09-30T14:59:59Z",
  maxOperations: 10, retentionMs: 3 * 24 * 60 * 60 * 1000, gasBudgetMIST: 10_000_000,
})
const S = SHARED_BUDGET_SCOPE, END = Date.parse(S.expiresAt), START = Date.parse(S.firstBoundAt)
const OP = /^op_[A-Za-z0-9_-]{8,64}$/
const blocked = (): never => { throw new HkError("integration_shared_budget", "The shared execution allocation is unavailable.", 503) }
const limit = (): never => { throw new HkError("integration_sui_limit", "This integration journey has reached its execution limit.", 429) }
const plain = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v))
function exact(v: unknown, keys: string[]): Record<string, unknown> {
  if (!plain(v) || Object.keys(v).sort().join(",") !== keys.sort().join(",")) return blocked()
  return v
}
function canonical(v: unknown, depth = 0): string {
  if (depth > 30) return blocked()
  if (v === null || typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v))) return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map(x => canonical(x, depth + 1)).join(",")}]`
  if (!plain(v)) return blocked()
  return `{${Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k], depth + 1)}`).join(",")}}`
}
const digest = (v: unknown) => "0x" + createHash("sha256").update(canonical(v)).digest("hex")
function alive(now: number) { if (!Number.isFinite(now) || now < START || now >= END || START + S.retentionMs <= END) blocked() }
function date(value: unknown): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) return blocked()
  return Date.parse(value)
}
function ids(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > S.maxOperations || value.some(id => typeof id !== "string" || !OP.test(id)) || new Set(value).size !== value.length) return blocked()
  return value as string[]
}
export type IntegrationSharedBudget = {
  version: 1; mode: "shared-reservation"; sourceKey: string; targetKey: string;
  firstBoundAt: string; expiresAt: string; operationIds: string[];
}
export type SharedBudgetDb = { version: 1; operations: Record<string, unknown>; integrationSharedBudget?: IntegrationSharedBudget; integrationSuiBudget?: unknown; integrationCutover?: unknown }
export type SharedBudgetControl = {
  version: 2; mode: "shared-reservation"; phase: "committed"; scopeId: string;
  expiresAt: string; sourceOperationIds: string[]; operationIds: string[];
  sequence: number; targetDigest: string;
}
export function assertSharedBudget(db: SharedBudgetDb): IntegrationSharedBudget {
  if (db.integrationSuiBudget !== undefined || db.integrationCutover !== undefined || !plain(db.operations)) return blocked()
  const b = exact(db.integrationSharedBudget, ["version", "mode", "sourceKey", "targetKey", "firstBoundAt", "expiresAt", "operationIds"])
  if (b.version !== 1 || b.mode !== "shared-reservation" || b.sourceKey !== S.sourceKey || b.targetKey !== S.targetKey || b.firstBoundAt !== S.firstBoundAt || b.expiresAt !== S.expiresAt) return blocked()
  const allocated = ids(b.operationIds)
  if (Object.keys(db.operations).some(id => !allocated.includes(id))) return blocked()
  return b as IntegrationSharedBudget
}
export function assertSharedBudgetMonotonic(previous: IntegrationSharedBudget | undefined, db: SharedBudgetDb) {
  if (!previous) { if (db.integrationSharedBudget !== undefined) blocked(); return }
  const next = assertSharedBudget(db)
  if (canonical({ ...previous, operationIds: [] }) !== canonical({ ...next, operationIds: [] }) || previous.operationIds.length > next.operationIds.length || previous.operationIds.some((id, i) => next.operationIds[i] !== id)) blocked()
}
export function claimSharedOperation(db: SharedBudgetDb, operationId: string) {
  const b = assertSharedBudget(db)
  if (!OP.test(operationId) || b.operationIds.includes(operationId)) blocked()
  if (b.operationIds.length >= S.maxOperations) limit()
  // The authoritative combined count is checked against source under its lock
  // in nextSharedBudgetState, before source/target/control are atomically saved.
  b.operationIds.push(operationId)
}
type Source = { operations: Record<string, Record<string, unknown>>; [key: string]: unknown }
function reservation(operationId: string, now: number) {
  return { operationId, kind: "integration_budget_reservation", status: "reserved", phase: "reserved",
    createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), expiresAt: S.expiresAt,
    reservation: { version: 1, targetKey: S.targetKey } }
}
function isReservation(row: Record<string, unknown>): boolean { return row.kind === "integration_budget_reservation" }
function assertReservation(row: Record<string, unknown>, id: string, now: number) {
  exact(row, ["operationId", "kind", "status", "phase", "createdAt", "updatedAt", "expiresAt", "reservation"])
  const created = date(row.createdAt)
  if (row.operationId !== id || row.status !== "reserved" || row.phase !== "reserved" || row.updatedAt !== row.createdAt || row.expiresAt !== S.expiresAt ||
    created < START || created > now || canonical(row.reservation) !== canonical({ version: 1, targetKey: S.targetKey })) blocked()
}
export function parseSharedBudgetSource(raw: unknown, now = Date.now()): Source {
  alive(now)
  if (typeof raw !== "string" || Buffer.byteLength(raw) > 2 * 1024 * 1024) return blocked()
  let db: unknown
  try { db = JSON.parse(raw) } catch { return blocked() }
  if (!plain(db) || db.version !== 1 || db.integrationCutover !== undefined || db.integrationSuiBudget !== undefined || db.integrationSharedBudget !== undefined ||
    ["sessions", "operations", "redemptions", "outbox", "idempotency", "nonces"].some(k => !plain(db[k]))) return blocked()
  const source = db as Source, rows = Object.entries(source.operations)
  if (!rows.length || rows.length > S.maxOperations) return blocked()
  for (const [id, row] of rows) {
    if (!OP.test(id) || !plain(row) || row.operationId !== id) return blocked()
    if (isReservation(row)) assertReservation(row, id, now)
    else {
      const created = date(row.createdAt), updated = date(row.updatedAt)
      if (created < START || created > now || updated < created || updated > now || updated + S.retentionMs <= END ||
        !["pending", "succeeded", "failed", "cancelled", "expired"].includes(String(row.status)) || row.journey !== undefined) return blocked()
    }
  }
  return source
}
export function parseSharedBudgetControl(value: unknown): SharedBudgetControl {
  const c = exact(value, ["version", "mode", "phase", "scopeId", "expiresAt", "sourceOperationIds", "operationIds", "sequence", "targetDigest"])
  if (c.version !== 2 || c.mode !== "shared-reservation" || c.phase !== "committed" || c.scopeId !== S.scopeId || c.expiresAt !== S.expiresAt || !Number.isSafeInteger(c.sequence) || Number(c.sequence) < 0 ||
    typeof c.targetDigest !== "string" || !/^0x[0-9a-f]{64}$/.test(c.targetDigest)) return blocked()
  ids(c.sourceOperationIds); ids(c.operationIds)
  if (!(c.sourceOperationIds as string[]).length) return blocked()
  return c as SharedBudgetControl
}
export function assertSharedBudgetState(db: SharedBudgetDb, rawControl: unknown, rawSource: unknown, now = Date.now()) {
  const source = parseSharedBudgetSource(rawSource, now), control = parseSharedBudgetControl(rawControl), b = assertSharedBudget(db)
  const sourceIds = Object.keys(source.operations), reserved = sourceIds.filter(id => isReservation(source.operations[id]))
  if (control.targetDigest !== digest(db) || canonical(control.operationIds) !== canonical(b.operationIds) ||
    control.sourceOperationIds.some(id => !sourceIds.includes(id)) || b.operationIds.some(id => !reserved.includes(id)) || reserved.some(id => !b.operationIds.includes(id))) blocked()
  return { source, control, budget: b }
}
/** Explicit operator initialization only. Source remains byte-for-byte intact.
 * This does NOT claim old writers are stopped; they share the same slot pool. */
export function initialSharedBudgetState(rawSource: string, now = Date.now()) {
  const source = parseSharedBudgetSource(rawSource, now)
  if (Object.values(source.operations).some(isReservation)) blocked()
  const db = { version: 1 as const, sessions: {}, operations: {}, redemptions: {}, outbox: {}, idempotency: {}, nonces: {},
    integrationSharedBudget: { version: 1 as const, mode: "shared-reservation" as const, sourceKey: S.sourceKey, targetKey: S.targetKey, firstBoundAt: S.firstBoundAt, expiresAt: S.expiresAt, operationIds: [] as string[] } }
  const control: SharedBudgetControl = { version: 2, mode: "shared-reservation", phase: "committed", scopeId: S.scopeId, expiresAt: S.expiresAt,
    sourceOperationIds: Object.keys(source.operations).sort(), operationIds: [], sequence: 0, targetDigest: digest(db) }
  assertSharedBudgetState(db, control, rawSource, now)
  return { db, control }
}
export function nextSharedBudgetState(previous: SharedBudgetDb, rawControl: unknown, rawSource: string, next: SharedBudgetDb, now = Date.now()) {
  const { source, control, budget } = assertSharedBudgetState(previous, rawControl, rawSource, now)
  assertSharedBudgetMonotonic(budget, next)
  const after = assertSharedBudget(next), fresh = after.operationIds.filter(id => !budget.operationIds.includes(id))
  if (fresh.length > 1 || control.sequence >= Number.MAX_SAFE_INTEGER) blocked()
  if (Object.keys(source.operations).length + fresh.length > S.maxOperations) limit()
  for (const id of fresh) {
    if (source.operations[id] || !plain(next.operations[id]) || next.operations[id].operationId !== id) blocked()
    source.operations[id] = reservation(id, now)
  }
  const sourceRaw = fresh.length ? JSON.stringify(source) : rawSource
  const nextControl: SharedBudgetControl = { ...control, sourceOperationIds: Object.keys(source.operations).sort(), operationIds: [...after.operationIds], sequence: control.sequence + 1, targetDigest: digest(next) }
  assertSharedBudgetState(next, nextControl, sourceRaw, now)
  return { control: nextControl, sourceRaw }
}

// The caller holds target then source lock. Five comparisons happen before any
// SET; legacy lease expiry/new owners and either ledger drift cause zero writes.
export const SHARED_BUDGET_COMMIT_LUA = `-- ktour-shared-reservation-commit-v1
if redis.call('GET',KEYS[1])~=ARGV[1] or redis.call('GET',KEYS[4])~=ARGV[2] or redis.call('GET',KEYS[2])~=ARGV[3] or redis.call('GET',KEYS[3])~=ARGV[4] or redis.call('GET',KEYS[5])~=ARGV[5] then return 0 end
if ARGV[5]~=ARGV[8] then redis.call('SET',KEYS[5],ARGV[8]) end
redis.call('SET',KEYS[2],ARGV[6]); redis.call('SET',KEYS[3],ARGV[7]); return 1`
export const SHARED_BUDGET_INITIALIZE_LUA = `-- ktour-shared-reservation-initialize-v1
if redis.call('GET',KEYS[1])~=ARGV[1] or redis.call('GET',KEYS[4])~=ARGV[2] or redis.call('GET',KEYS[5])~=ARGV[3] or redis.call('EXISTS',KEYS[2])~=0 or redis.call('EXISTS',KEYS[3])~=0 then return 0 end
redis.call('SET',KEYS[2],ARGV[4]); redis.call('SET',KEYS[3],ARGV[5]); return 1`
