// Two-phase operator protocol. No default network, credential, store or signing
// access. The runtime must not manufacture this protocol from request JSON/env.
import { createHash } from "node:crypto"
import { HkError } from "./util"
import { assertIntegrationSuiBudget, integrationSuiBudgetTemplate, INTEGRATION_SUI_LIMITS, type IntegrationSuiBudget } from "./integration-sui-limits"

export const CUTOVER_SCOPE = Object.freeze({
  project: "prj_w5rckTz9B1DO55fvVRXjQRy9L5RM", team: "team_6kJAloQ9WlswvMtbbCmGI7Er", account: "jaewook-9643",
  sourceKey: "ktour:sui-hosted:20260928:v1", targetKey: "ktour:integration-preview:autonomous-20260928:v1",
  controlKey: "ktour:integration-cutover:hosted-20260928:v1", maxPages: 8, maxDeployments: 64,
  maxReads: 96, deadlineMs: 30_000, sourceMaxBytes: 2 * 1024 * 1024, observationGapMs: 5_000,
  claimDrainMs: 90_000, maxInvocationMs: 900_000, proofTtlMs: 30_000,
})
const blocked = (code = "integration_cutover_unverified"): never => { throw new HkError(code, "Shared-budget cutover is not verified. No execution is authorized.", 503) }
const HEX = /^0x[0-9a-f]{64}$/, OP = /^op_[A-Za-z0-9_-]{8,64}$/, DEPLOY = /^dpl_[A-Za-z0-9]{8,80}$/
function plain(x: unknown): Record<string, unknown> {
  if (!x || typeof x !== "object" || Array.isArray(x) || ![Object.prototype, null].includes(Object.getPrototypeOf(x))) return blocked()
  const descriptors = Object.getOwnPropertyDescriptors(x)
  if (Reflect.ownKeys(x).some(k => typeof k !== "string" || !("value" in descriptors[k]) || !descriptors[k].enumerable)) return blocked()
  return x as Record<string, unknown>
}
function exact(x: unknown, keys: readonly string[]) {
  const r = plain(x)
  if (Object.keys(r).sort().join(",") !== [...keys].sort().join(",")) return blocked()
  return r
}
function iso(x: unknown): number {
  if (typeof x !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(x) || !Number.isFinite(Date.parse(x))) return blocked()
  return Date.parse(x)
}
function ids(x: unknown, pattern = OP, max = 10): string[] {
  if (!Array.isArray(x) || !x.length || x.length > max || x.some(v => typeof v !== "string" || !pattern.test(v)) || new Set(x).size !== x.length) return blocked()
  return [...x] as string[]
}
function canonical(x: unknown, depth = 0): string {
  if (depth > 30) return blocked()
  if (x === null || typeof x === "string" || typeof x === "boolean") return JSON.stringify(x)
  if (typeof x === "number" && Number.isFinite(x)) return JSON.stringify(x)
  if (Array.isArray(x)) return `[${x.map(v => canonical(v, depth + 1)).join(",")}]`
  const r = plain(x)
  // Match persisted JSON: optional undefined object fields do not survive JSON.
  return `{${Object.keys(r).filter(k => r[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical(r[k], depth + 1)}`).join(",")}}`
}
export const cutoverDigest = (x: unknown) => "0x" + createHash("sha256").update(canonical(x)).digest("hex")
const rawDigest = (raw: string) => "0x" + createHash("sha256").update(raw).digest("hex")
export function assertCutoverSourceUnchanged(raw: unknown, marker: IntegrationCutoverMarker) {
  if (typeof raw !== "string" || Buffer.byteLength(raw) > CUTOVER_SCOPE.sourceMaxBytes || rawDigest(raw) !== parseIntegrationCutoverMarker(marker).sourceLedgerSha256) {
    return blocked("integration_cutover_source_changed")
  }
}
async function boundedPortRead<T>(fn: (signal: AbortSignal) => Promise<T>, timeout = 5000): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try { return await Promise.race([fn(controller.signal), new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("bounded")) }, timeout) })]) }
  finally { if (timer) clearTimeout(timer) }
}

export type IntegrationCutoverMarker = {
  version: 1; migrationId: string; evidenceDigest: string; sourceLedgerSha256: string;
  priorHostedOperationIds: string[]; hostedWritesDisabledAt: string; expiresAt: string;
}
export type IntegrationCutoverControl = {
  version: 1; phase: "prepared" | "committed"; marker: IntegrationCutoverMarker;
  targetDigest: string | null; operationIds: string[]; sequence: number;
}
export type CutoverDb = { integrationCutover?: IntegrationCutoverMarker; integrationSuiBudget?: IntegrationSuiBudget; operations: Record<string, unknown> }
export function parseIntegrationCutoverMarker(value: unknown): IntegrationCutoverMarker {
  const m = exact(value, ["version", "migrationId", "evidenceDigest", "sourceLedgerSha256", "priorHostedOperationIds", "hostedWritesDisabledAt", "expiresAt"])
  if (m.version !== 1 || typeof m.migrationId !== "string" || !/^cutover_[a-f0-9]{64}$/.test(m.migrationId) ||
    typeof m.evidenceDigest !== "string" || !HEX.test(m.evidenceDigest) || typeof m.sourceLedgerSha256 !== "string" || !HEX.test(m.sourceLedgerSha256) ||
    m.expiresAt !== INTEGRATION_SUI_LIMITS.maxExpiresAt || iso(m.hostedWritesDisabledAt) >= INTEGRATION_SUI_LIMITS.maxEnd) return blocked()
  const prior = ids(m.priorHostedOperationIds)
  if (JSON.stringify(prior) !== JSON.stringify([...prior].sort())) return blocked()
  return structuredClone(m) as IntegrationCutoverMarker
}
export function parseIntegrationCutoverControl(value: unknown): IntegrationCutoverControl {
  const c = exact(value, ["version", "phase", "marker", "targetDigest", "operationIds", "sequence"])
  parseIntegrationCutoverMarker(c.marker)
  if (c.version !== 1 || !["prepared", "committed"].includes(String(c.phase)) || !Number.isSafeInteger(c.sequence) || Number(c.sequence) < 0 ||
    !Array.isArray(c.operationIds) || c.operationIds.length > 10 || c.operationIds.some(id => typeof id !== "string" || !OP.test(id)) || new Set(c.operationIds).size !== c.operationIds.length) return blocked()
  if (c.phase === "prepared" ? c.targetDigest !== null || c.sequence !== 0 || c.operationIds.length !== 0 : typeof c.targetDigest !== "string" || !HEX.test(c.targetDigest)) return blocked()
  return structuredClone(c) as IntegrationCutoverControl
}
/** Called on every ordinary store write; no normal callback may add/remove a marker. */
export function assertIntegrationCutoverMonotonic(previous: IntegrationCutoverMarker | undefined, db: CutoverDb) {
  if (previous === undefined) { if (db.integrationCutover !== undefined) return blocked(); return }
  const next = parseIntegrationCutoverMarker(db.integrationCutover)
  if (canonical(parseIntegrationCutoverMarker(previous)) !== canonical(next)) return blocked()
  const b = assertIntegrationSuiBudget(db)
  if (b.hostedLedgerSha256 !== next.sourceLedgerSha256 || b.hostedWritesDisabledAt !== next.hostedWritesDisabledAt ||
    canonical(b.priorHostedOperationIds) !== canonical(next.priorHostedOperationIds)) return blocked()
}
/** A budget/marker alone is NOT activation. Read the separate control atomically
 * with the ledger. It is an append-only high-watermark, not a cached env flag. */
export function assertCommittedCutover(db: CutoverDb, control: unknown, now = Date.now()): IntegrationCutoverControl {
  const c = parseIntegrationCutoverControl(control), marker = parseIntegrationCutoverMarker(db.integrationCutover)
  if (c.phase !== "committed" || !Number.isFinite(now) || now < iso(marker.hostedWritesDisabledAt) || now >= iso(marker.expiresAt) ||
    canonical(marker) !== canonical(c.marker) || c.targetDigest !== cutoverDigest(db)) return blocked()
  assertIntegrationCutoverMonotonic(marker, db)
  if (canonical(c.operationIds) !== canonical(assertIntegrationSuiBudget(db).operationIds)) return blocked()
  return c
}
/** Root store must atomically CAS old ledger+control to new ledger+this control.
 * This cannot initialize a control, decrease IDs or alter the source baseline. */
export function nextCutoverControl(previousDb: CutoverDb, previousControl: unknown, nextDb: CutoverDb, now = Date.now()) {
  const prior = assertCommittedCutover(previousDb, previousControl, now)
  assertIntegrationCutoverMonotonic(previousDb.integrationCutover, nextDb)
  const before = assertIntegrationSuiBudget(previousDb), after = assertIntegrationSuiBudget(nextDb)
  if (before.operationIds.some((id, index) => after.operationIds[index] !== id) || before.operationIds.length > after.operationIds.length || prior.sequence >= Number.MAX_SAFE_INTEGER) return blocked()
  return { ...prior, sequence: prior.sequence + 1, targetDigest: cutoverDigest(nextDb), operationIds: [...after.operationIds] } satisfies IntegrationCutoverControl
}

// AUTHORITY PORT, NOT AN HTTP/request-body DTO. An approved server-side adapter
// must authenticate every read to the pinned platform account and policy store.
// No adapter is installed by this patch: ordinary Vercel metadata/alias/config
// GETs do not prove invocation disablement or future-writer exclusion.
export type DeploymentInventoryPage = { project: string; team: string; snapshotId: string; total: number; ids: string[]; next: string | null }
export type WriterDisableReceipt = { deploymentId: string; project: string; team: string; disabledAt: string;
  invocationBoundMs: number; mechanism: "immutable-execution-revoked"; controlReceiptDigest: string }
export type FutureWriterFence = { project: string; team: string; mechanism: "legacy-writer-creation-denied";
  policyEpoch: string; enforcedAt: string; controlReceiptDigest: string }
export interface AuthenticatedCutoverReadPort {
  principal(signal: AbortSignal): Promise<{ account: string; project: string; team: string }>
  /** Exhaustive inventory of ALL deployments in the project, not branch-filtered
   * or just aliases. Adapter must include immutable and unaliased deployments. */
  deployments(cursor: string | null, signal: AbortSignal): Promise<DeploymentInventoryPage>
  /** Must establish actual immutable invocation revocation, NOT 401, pause UI,
   * an env update, build status, alias removal or unavailable endpoint alone. */
  disabled(deploymentId: string, signal: AbortSignal): Promise<WriterDisableReceipt>
  /** Enforced policy must also stop a newly created old-code deployment from
   * reacquiring the legacy signing/store capability. A metadata flag is not it. */
  futureWriters(signal: AbortSignal): Promise<FutureWriterFence>
}
type Fence = Readonly<{ evidenceDigest: string; disabledAt: string; quiescentAfterMs: number; verifiedAtMs: number; deploymentIds: readonly string[] }>
const trustedFences = new WeakSet<object>(), trustedSnapshots = new WeakSet<object>(), plans = new WeakMap<object, { sourceRaw: string; fence: Fence; markerDigest: string }>()
export type VerifiedWriterFence = Fence & { readonly __opaqueWriterFence?: never }
/** Missing real platform attestor remains a hard error. Never substitute user
 * JSON bearing authenticated:true or a local success fixture. */
export function unavailableCutoverAuthority(): never { return blocked("integration_cutover_authority_unavailable") }
export async function verifyWriterFence(port: AuthenticatedCutoverReadPort, clock: () => number = Date.now): Promise<VerifiedWriterFence> {
  const started = clock(), deadline = started + CUTOVER_SCOPE.deadlineMs
  let calls = 0
  const call = async <T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    if (++calls > CUTOVER_SCOPE.maxReads || clock() >= deadline) return blocked()
    const controller = new AbortController(), timeout = Math.max(1, Math.min(deadline - clock(), 5000))
    let timer: ReturnType<typeof setTimeout> | undefined
    try { return await Promise.race([fn(controller.signal), new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("bounded")) }, timeout) })]) }
    catch { return blocked() } finally { if (timer) clearTimeout(timer) }
  }
  const pin = (r: { project: string; team: string }) => { if (r.project !== CUTOVER_SCOPE.project || r.team !== CUTOVER_SCOPE.team) blocked() }
  const principal = await call(s => port.principal(s)); pin(principal)
  if (principal.account !== CUTOVER_SCOPE.account) return blocked()
  const policy = (r: FutureWriterFence) => {
    exact(r, ["project", "team", "mechanism", "policyEpoch", "enforcedAt", "controlReceiptDigest"]); pin(r)
    if (r.mechanism !== "legacy-writer-creation-denied" || !/^[A-Za-z0-9_-]{8,100}$/.test(r.policyEpoch) || !HEX.test(r.controlReceiptDigest) || iso(r.enforcedAt) > clock()) blocked()
    return r
  }
  const firstPolicy = policy(await call(s => port.futureWriters(s)))
  const inventory = async () => {
    let cursor: string | null = null, snapshot: string | undefined, total: number | undefined
    const found: string[] = [], seenCursors = new Set<string>()
    for (let page = 0; page < CUTOVER_SCOPE.maxPages; page++) {
      const r = await call(s => port.deployments(cursor, s)); exact(r, ["project", "team", "snapshotId", "total", "ids", "next"]); pin(r)
      if (!/^[A-Za-z0-9_-]{8,100}$/.test(r.snapshotId) || !Number.isSafeInteger(r.total) || r.total < 1 || r.total > CUTOVER_SCOPE.maxDeployments ||
        (snapshot !== undefined && (snapshot !== r.snapshotId || total !== r.total))) return blocked()
      snapshot = r.snapshotId; total = r.total
      found.push(...ids(r.ids, DEPLOY, CUTOVER_SCOPE.maxDeployments))
      if (new Set(found).size !== found.length || found.length > r.total) return blocked()
      if (r.next === null) { if (found.length !== total) return blocked(); return found.sort() }
      if (typeof r.next !== "string" || !/^[A-Za-z0-9_-]{1,120}$/.test(r.next) || seenCursors.has(r.next)) return blocked()
      seenCursors.add(r.next); cursor = r.next
    }
    return blocked()
  }
  const deploymentIds = await inventory(), receipts: WriterDisableReceipt[] = []
  let disabledAt = iso(firstPolicy.enforcedAt), quiescentAfterMs = disabledAt
  for (const id of deploymentIds) {
    const r = await call(s => port.disabled(id, s))
    exact(r, ["deploymentId", "project", "team", "disabledAt", "invocationBoundMs", "mechanism", "controlReceiptDigest"]); pin(r)
    if (r.deploymentId !== id || r.mechanism !== "immutable-execution-revoked" || !HEX.test(r.controlReceiptDigest) ||
      !Number.isSafeInteger(r.invocationBoundMs) || r.invocationBoundMs < 1 || r.invocationBoundMs > CUTOVER_SCOPE.maxInvocationMs || iso(r.disabledAt) > clock()) return blocked()
    disabledAt = Math.max(disabledAt, iso(r.disabledAt)); quiescentAfterMs = Math.max(quiescentAfterMs, iso(r.disabledAt) + r.invocationBoundMs + CUTOVER_SCOPE.claimDrainMs)
    receipts.push(r)
  }
  if (canonical(await inventory()) !== canonical(deploymentIds) || canonical(policy(await call(s => port.futureWriters(s)))) !== canonical(firstPolicy) || clock() < quiescentAfterMs || clock() >= INTEGRATION_SUI_LIMITS.maxEnd) return blocked()
  const result = Object.freeze({ evidenceDigest: cutoverDigest({ principal, policy: firstPolicy, receipts }), disabledAt: new Date(disabledAt).toISOString(), quiescentAfterMs, verifiedAtMs: clock(), deploymentIds: Object.freeze(deploymentIds) })
  trustedFences.add(result); return result
}

export interface HostedLedgerReadPort {
  readSource(signal: AbortSignal): Promise<{ key: string; raw: string; locked: boolean }>
  /** Authenticated lifetime allocation audit, including expired/pruned failures.
   * A bare current Object.keys(operations) cannot claim historical completeness.
   * Missing journal/provenance is a blocker, never a zero-slot assumption. */
  readLifetimeAllocation(signal: AbortSignal): Promise<{ key: string; operationIds: string[]; auditDigest: string }>
}
export type HostedLedgerSnapshot = Readonly<{ raw: string; digest: string; operationIds: readonly string[]; allocationAuditDigest: string; readAtMs: number }>
/** Never returns/logs identity data except the in-memory sourceRaw needed for CAS.
 * Caller must not persist snapshots or include them in errors/CLI output. */
export async function observeHostedLedger(port: HostedLedgerReadPort, fence: VerifiedWriterFence, clock: () => number = Date.now): Promise<HostedLedgerSnapshot> {
  if (!trustedFences.has(fence) || clock() < fence.quiescentAfterMs || clock() >= INTEGRATION_SUI_LIMITS.maxEnd) return blocked()
  let r: Awaited<ReturnType<HostedLedgerReadPort["readSource"]>>, allocation: Awaited<ReturnType<HostedLedgerReadPort["readLifetimeAllocation"]>>
  try { r = await boundedPortRead(s => port.readSource(s)); allocation = await boundedPortRead(s => port.readLifetimeAllocation(s)) } catch { return blocked() }
  if (r.key !== CUTOVER_SCOPE.sourceKey || r.locked || typeof r.raw !== "string" || Buffer.byteLength(r.raw) > CUTOVER_SCOPE.sourceMaxBytes) return blocked()
  let db: Record<string, unknown>
  try { db = plain(JSON.parse(r.raw)) } catch { return blocked() }
  if (db.version !== 1 || db.integrationSuiBudget !== undefined || db.integrationCutover !== undefined) return blocked()
  for (const name of ["sessions", "operations", "redemptions", "outbox", "idempotency", "nonces"]) plain(db[name])
  exact(allocation, ["key", "operationIds", "auditDigest"])
  if (allocation.key !== CUTOVER_SCOPE.sourceKey || !HEX.test(allocation.auditDigest)) return blocked()
  const operations = plain(db.operations), currentIds = Object.keys(operations), operationIds = ids(allocation.operationIds).sort()
  if (currentIds.some(id => !OP.test(id) || !operationIds.includes(id))) return blocked()
  for (const [id, raw] of Object.entries(operations)) {
    const op = plain(raw), secrets = plain(op.secrets ?? {})
    if (op.operationId !== id || !["pending", "succeeded", "failed", "cancelled", "expired"].includes(String(op.status))) return blocked()
    for (const field of ["cxStartClaim", "delegationPreparation"]) {
      const v = secrets[field]
      if (v !== undefined && (field === "cxStartClaim" || ["issuing", "building", "unknown"].includes(String(plain(v).stage)))) return blocked()
    }
    if (op.agent && ["queued", "unknown"].includes(String(plain(op.agent).status))) return blocked()
    if (op.delegation && ["prepared", "unknown"].includes(String(plain(op.delegation).status))) return blocked()
  }
  for (const row of Object.values(plain(db.outbox))) {
    const o = plain(row)
    if (o.processingClaim !== undefined || ["pending", "submitted", "unknown"].includes(String(o.status))) return blocked()
  }
  const result = Object.freeze({ raw: r.raw, digest: rawDigest(r.raw), operationIds: Object.freeze(operationIds), allocationAuditDigest: allocation.auditDigest, readAtMs: clock() })
  trustedSnapshots.add(result); return result
}
export type CutoverPlan = Readonly<{ marker: IntegrationCutoverMarker }>
/** Phase 1 plan from two stable, authenticated source observations, after actual
 * old-writer revocation/drain. All failed/cancelled/pending operation IDs count. */
export function prepareCutover(fence: VerifiedWriterFence, first: HostedLedgerSnapshot, second: HostedLedgerSnapshot, now = Date.now()): CutoverPlan {
  if (!trustedFences.has(fence) || !trustedSnapshots.has(first) || !trustedSnapshots.has(second) ||
    now < second.readAtMs || now - fence.verifiedAtMs > CUTOVER_SCOPE.proofTtlMs || now >= INTEGRATION_SUI_LIMITS.maxEnd ||
    first.readAtMs < fence.quiescentAfterMs || second.readAtMs - first.readAtMs < CUTOVER_SCOPE.observationGapMs || first.raw !== second.raw ||
    first.allocationAuditDigest !== second.allocationAuditDigest || canonical(first.operationIds) !== canonical(second.operationIds)) return blocked()
  const evidenceDigest = cutoverDigest({ writerFence: fence.evidenceDigest, sourceLedgerSha256: second.digest, operationIds: second.operationIds, allocationAuditDigest: second.allocationAuditDigest })
  const marker: IntegrationCutoverMarker = { version: 1, migrationId: "cutover_" + evidenceDigest.slice(2), evidenceDigest,
    sourceLedgerSha256: second.digest, priorHostedOperationIds: [...second.operationIds], hostedWritesDisabledAt: fence.disabledAt, expiresAt: INTEGRATION_SUI_LIMITS.maxExpiresAt }
  const plan = Object.freeze({ marker: Object.freeze(marker) })
  plans.set(plan, { sourceRaw: second.raw, fence, markerDigest: cutoverDigest(marker) }); return plan
}

// One Redis command per phase; source history is NEVER overwritten or deleted.
// Root/operator port must use the exact approved Redis backend for all five keys.
export const CUTOVER_PREPARE_LUA = `-- ktour-cutover-prepare-v1
if redis.call('GET',KEYS[1])~=ARGV[1] or redis.call('EXISTS',KEYS[2])==1 or redis.call('EXISTS',KEYS[4])==1 then return 'source_changed' end
local c=redis.call('GET',KEYS[5]); if c then if c==ARGV[2] then return 'already_prepared' end return 'control_exists' end
if redis.call('EXISTS',KEYS[3])==1 then return 'target_exists' end
redis.call('SET',KEYS[5],ARGV[2]); return 'prepared'`
export const CUTOVER_COMMIT_LUA = `-- ktour-cutover-commit-v1
if redis.call('GET',KEYS[1])~=ARGV[1] or redis.call('EXISTS',KEYS[2])==1 or redis.call('EXISTS',KEYS[4])==1 then return 'source_changed' end
local c=redis.call('GET',KEYS[5]); local t=redis.call('GET',KEYS[3]);
if c==ARGV[4] and t==ARGV[3] then return 'already_committed' end
if c~=ARGV[2] then return 'control_changed' end
if t then return 'target_exists' end
redis.call('SET',KEYS[3],ARGV[3]); redis.call('SET',KEYS[5],ARGV[4]); return 'committed'`
export interface CutoverAtomicPort {
  /** Privileged operator-only approved Redis EVAL. Never exposed on a route,
   * normal request callback, CLI stdin command, or generic Redis command API. */
  eval(script: typeof CUTOVER_PREPARE_LUA | typeof CUTOVER_COMMIT_LUA, keys: readonly string[], args: readonly string[], signal: AbortSignal): Promise<unknown>
}
const keys = () => [CUTOVER_SCOPE.sourceKey, `${CUTOVER_SCOPE.sourceKey}:lock`, CUTOVER_SCOPE.targetKey, `${CUTOVER_SCOPE.targetKey}:lock`, CUTOVER_SCOPE.controlKey] as const
function material(plan: CutoverPlan, now: number) {
  const privatePlan = plans.get(plan)
  if (!privatePlan || !trustedFences.has(privatePlan.fence) || !Number.isFinite(now) || now < privatePlan.fence.verifiedAtMs || now - privatePlan.fence.verifiedAtMs > CUTOVER_SCOPE.proofTtlMs || now >= INTEGRATION_SUI_LIMITS.maxEnd) return blocked()
  const marker = parseIntegrationCutoverMarker(plan.marker)
  if (cutoverDigest(marker) !== privatePlan.markerDigest) return blocked()
  const budget = integrationSuiBudgetTemplate({ priorHostedOperationIds: marker.priorHostedOperationIds, hostedLedgerSha256: marker.sourceLedgerSha256, hostedWritesDisabledAt: marker.hostedWritesDisabledAt })
  const db = { version: 1, sessions: {}, operations: {}, redemptions: {}, outbox: {}, idempotency: {}, nonces: {}, integrationSuiBudget: budget, integrationCutover: marker }
  const prepared: IntegrationCutoverControl = { version: 1, phase: "prepared", marker, targetDigest: null, operationIds: [], sequence: 0 }
  const committed: IntegrationCutoverControl = { ...prepared, phase: "committed", targetDigest: cutoverDigest(db) }
  return { sourceRaw: privatePlan.sourceRaw, db, prepared, committed }
}
/** A lost response is UNKNOWN; callers must reread, not clear locks/control.
 * Re-deriving the same plan with fresh evidence permits only exact idempotence. */
export async function provisionCutover(plan: CutoverPlan, phase: "prepare" | "commit", port: CutoverAtomicPort, now = Date.now()) {
  const m = material(plan, now)
  if (phase !== "prepare" && phase !== "commit") return blocked()
  let result: unknown
  try { result = await boundedPortRead(s => port.eval(phase === "prepare" ? CUTOVER_PREPARE_LUA : CUTOVER_COMMIT_LUA, keys(), phase === "prepare"
    ? [m.sourceRaw, canonical(m.prepared)] : [m.sourceRaw, canonical(m.prepared), canonical(m.db), canonical(m.committed)], s)) }
  catch { return blocked("integration_cutover_outcome_unknown") }
  if (!(phase === "prepare" ? ["prepared", "already_prepared"] : ["committed", "already_committed"]).includes(String(result))) return blocked("integration_cutover_conflict")
  return { phase, status: result as string, migrationId: m.prepared.marker.migrationId }
}
