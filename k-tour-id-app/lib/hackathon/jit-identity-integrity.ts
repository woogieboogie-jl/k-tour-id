import type { Db } from "./store"
import type { JitIdentityLedger } from "./jit-identity-records"
import { JIT_AUTHORIZATION_ID, JIT_REQUEST_ID, JIT_IDENTITY_CONSENT, JIT_IDENTITY_VERSION } from "./jit-identity-contract"
import { assert, digestOf } from "./util"
import { CX_AGE19_POLICY } from "./cx-age-policy"

const same = (a: unknown, b: unknown) => digestOf(a) === digestOf(b)
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x)
const date = (x: unknown) => typeof x === "string" && Number.isFinite(Date.parse(x))
const check = (ok: unknown) => assert(ok, "store_corrupt", "Identity authorization storage is unavailable", 503)
const hash = (x: unknown) => typeof x === "string" && /^0x[0-9a-f]{64}$/.test(x)

/** Structural and cross-row integrity only. Current provider/expiry/action policy
 * is separately rechecked before every authorization and downstream execution. */
export function assertJitIdentityLedger(value: unknown): asserts value is JitIdentityLedger {
  check(object(value) && value.version === 1 && object(value.requests) && object(value.authorizations))
  const s = value as JitIdentityLedger
  check(Object.keys(s.requests).length <= 512 && Object.keys(s.authorizations).length <= 512)
  for (const [id, r] of Object.entries(s.requests)) {
    check(object(r) && JIT_REQUEST_ID.test(id) && r.requestId === id && typeof r.sessionId === "string" && r.sessionId.length > 0)
    check(object(r.context) && hash(r.context.contextDigest) && hash(r.policyDigest) && date(r.createdAt) && date(r.expiresAt) && Date.parse(r.expiresAt) > Date.parse(r.createdAt))
    check(r.consentDigest === digestOf({ version: JIT_IDENTITY_CONSENT, sessionId: r.sessionId, requestId: id, context: r.context }))
    check(["awaiting_identity", "preparing", "handoff", "checking", "authorized", "completed", "denied", "cancelled", "expired", "unknown"].includes(r.status))
    check(typeof r.started === "boolean" && Number.isSafeInteger(r.polls) && r.polls >= 0 && r.polls <= 120 && Number.isFinite(r.lastPollAt) && r.lastPollAt >= 0)
    check(r.started === (typeof r.operationId === "string") && (r.started || r.operationId === null))
    check(r.handoff === null || (object(r.handoff) && ["qr", "app"].includes(r.handoff.kind) && date(r.handoff.expiresAt)))
    if (r.claim) check(typeof r.claim.id === "string" && date(r.claim.expiresAt))
    if (r.authorizationRef !== null) check(JIT_AUTHORIZATION_ID.test(r.authorizationRef) && s.authorizations[r.authorizationRef]?.requestId === id)
    if (["authorized", "completed"].includes(r.status)) check(r.authorizationRef !== null && typeof r.evidenceOperationId === "string")
  }
  for (const [id, a] of Object.entries(s.authorizations)) {
    check(object(a) && JIT_AUTHORIZATION_ID.test(id) && id === a.authorizationRef)
    const r = s.requests[a.requestId]
    check(r && r.authorizationRef === id && r.sessionId === a.sessionId && r.policyDigest === a.policyDigest && r.consentDigest === a.consentDigest &&
      r.evidenceOperationId === a.evidenceOperationId && same(r.context, a.context))
    check(typeof a.evidenceId === "string" && /^subj_[A-Za-z0-9_-]+$/.test(a.subjectRef) && date(a.createdAt) && date(a.expiresAt) &&
      Date.parse(a.expiresAt) > Date.parse(a.createdAt) && Date.parse(a.expiresAt) <= Date.parse(r.expiresAt))
    if (a.operationId !== undefined) check(typeof a.operationId === "string" && a.context.action === "designated_perk" && a.receipt)
    if (a.receipt) check(a.receipt.version === JIT_IDENTITY_VERSION && /^idr_[A-Za-z0-9_-]{16,32}$/.test(a.receipt.receiptId) &&
      same(a.receipt.context, a.context) &&
      (a.context.action === "after19_access" && a.context.purpose === "age19"
        ? date(a.receipt.expiresAt) && Date.parse(a.receipt.expiresAt) <= Date.parse(a.receipt.evidenceExpiresAt) && Date.parse(a.receipt.expiresAt) > Date.parse(a.receipt.authorizedAt)
        : a.receipt.expiresAt === a.expiresAt) && date(a.receipt.authorizedAt) &&
      Date.parse(a.receipt.authorizedAt) >= Date.parse(a.createdAt) && Date.parse(a.receipt.authorizedAt) < Date.parse(a.expiresAt) &&
      date(a.receipt.evidenceExpiresAt) && a.receipt.provider === "omnione_cx" && a.receipt.personVerified === true &&
      typeof a.receipt.adultVerified === "boolean" && a.receipt.paymentKycVerified === false && r.status === "completed" &&
      (a.receipt.age19Verified === undefined || typeof a.receipt.age19Verified === "boolean") &&
      (a.context.purpose !== "age19" || (a.receipt.age19Verified === true && a.receipt.age19Policy === CX_AGE19_POLICY)))
  }
}

export function assertJitIdentityMonotonic(previous: JitIdentityLedger | undefined, db: Db) {
  if (!previous && db.jitIdentity === undefined) return
  assertJitIdentityLedger(db.jitIdentity)
  const next = db.jitIdentity
  for (const [id, old] of Object.entries(previous?.requests ?? {})) {
    const row = next.requests[id]
    check(row && ["requestId", "sessionId", "context", "consentDigest", "createdAt", "expiresAt", "policyDigest"].every(k =>
      same(row[k as keyof typeof row], old[k as keyof typeof old])))
    check(!old.started || row.started)
    check(row.polls >= old.polls && row.lastPollAt >= old.lastPollAt)
    for (const key of ["operationId", "evidenceOperationId", "authorizationRef"] as const) if (old[key]) check(row[key] === old[key])
    if (["completed", "cancelled", "expired", "denied", "unknown"].includes(old.status)) check(row.status === old.status || row.status === "cancelled")
    if (old.status === "completed") check(row.status === "completed")
  }
  for (const [id, old] of Object.entries(previous?.authorizations ?? {})) {
    const row = next.authorizations[id]
    check(row && same({ ...row, receipt: null, operationId: null }, { ...old, receipt: null, operationId: null }))
    if (old.receipt) check(same(row.receipt, old.receipt))
    if (old.operationId) check(row.operationId === old.operationId)
  }
}

/** Never remove a provenance link to make an invalid copy look independent. */
export function jitImportBindings(db: Db) {
  return Object.fromEntries(Object.values(db.operations).filter(op => op.secrets?.identityImport).map(op => [op.operationId, structuredClone(op.secrets.identityImport!)]))
}
export function assertJitImportBindings(previous: ReturnType<typeof jitImportBindings>, db: Db) {
  for (const [id, binding] of Object.entries(previous)) check(db.operations[id] && same(binding, db.operations[id].secrets?.identityImport))
}

export function pruneJitIdentitySecrets(db: Db, now = Date.now()) {
  for (const r of Object.values(db.jitIdentity?.requests ?? {})) {
    if (Date.parse(r.expiresAt) <= now || (r.claim && Date.parse(r.claim.expiresAt) <= now) || ["completed", "authorized", "denied", "cancelled", "expired", "unknown"].includes(r.status)) {
      delete r.cxToken; delete r.cxTxId; delete r.cxCxId; r.handoff = null
      // Keep the expired claim as a tombstone: status projection says unknown;
      // the provider operation/slot must never be retried after a lost response.
    }
  }
}
