import { readStore, withStore, type Db, type OperationRecord } from "./store"
import { cxStart, cxComplete } from "./adapters/cx"
import { assert, digestOf, HkError, randomId } from "./util"
import { jitEvidence, jitRuntimePolicy, reserveJitIdentityOperation, validateJitContext, type JitRuntimePolicy } from "./jit-identity-policy"
import { JIT_IDENTITY_CONSENT, JIT_IDENTITY_VERSION, type JitIdentityContext, type JitIdentityEligibility, type JitIdentityRequest, type JitIdentityReceipt } from "./jit-identity-contract"
import type { JitIdentityRequestRecord, JitIdentityAuthorizationRecord } from "./jit-identity-records"

const REQUEST_MS = 10 * 60_000, AUTH_MS = 2 * 60_000, CLAIM_MS = 45_000, MAX_POLLS = 120
const iso = (n: number) => new Date(n).toISOString()
type Ports = {
  read: typeof readStore; mutate: typeof withStore; now: () => number; policy: (now: number) => JitRuntimePolicy
  reserve: typeof reserveJitIdentityOperation; start: typeof cxStart; complete: typeof cxComplete
}
const defaults: Ports = { read: readStore, mutate: withStore, now: Date.now, policy: jitRuntimePolicy, reserve: reserveJitIdentityOperation, start: cxStart, complete: cxComplete }
const clear = (r: JitIdentityRequestRecord) => { delete r.cxToken; delete r.cxTxId; delete r.cxCxId; delete r.claim; r.handoff = null }
const same = (a: unknown, b: unknown) => digestOf(a) === digestOf(b)
function ledger(db: Db) { return db.jitIdentity ??= { version: 1, requests: {}, authorizations: {} } }
function owned(db: Db, sessionId: string, requestId: string) {
  const r = db.jitIdentity?.requests[requestId]
  assert(db.sessions[sessionId] && r?.sessionId === sessionId, "not_found", "Identity request not found", 404)
  return r
}
function active(r: JitIdentityRequestRecord, policy: JitRuntimePolicy, now: number) {
  assert(policy.enabled && r.policyDigest === policy.digest && Date.parse(policy.expiresAt) > now, "jit_identity_unavailable", "Identity policy is unavailable", 503)
  assert(Date.parse(r.expiresAt) > now, "identity_expired", "Identity request expired", 410)
  assert(!["cancelled", "expired", "denied", "unknown", "completed"].includes(r.status), "jit_identity_inactive", "Identity request is inactive", 409)
}
function grantEvidence(db: Db, a: JitIdentityAuthorizationRecord, policy: JitRuntimePolicy, now: number) {
  validateJitContext(a.context, policy)
  const r = owned(db, a.sessionId, a.requestId)
  assert(["authorized", "completed"].includes(r.status) && a.policyDigest === policy.digest && r.policyDigest === policy.digest &&
    r.authorizationRef === a.authorizationRef && r.evidenceOperationId === a.evidenceOperationId && r.consentDigest === a.consentDigest &&
    a.consentDigest === digestOf({ version: JIT_IDENTITY_CONSENT, sessionId: a.sessionId, requestId: a.requestId, context: a.context }) && same(r.context, a.context) && Date.parse(a.expiresAt) > now,
  "jit_identity_expired", "Action authorization is unavailable", 409)
  const e = jitEvidence(db, a.sessionId, db.operations[a.evidenceOperationId], policy, now)
  assert(e && e.evidenceId === a.evidenceId && e.subjectRef === a.subjectRef &&
    (a.context.purpose !== "adult" || e.adultVerified === true) && a.context.purpose !== "age19", "jit_identity_proof", "Current identity proof required", 403)
  return e
}
function projection(db: Db, r: JitIdentityRequestRecord, policy: JitRuntimePolicy, now: number): JitIdentityRequest {
  let status = r.status, reason = r.reason
  if (Date.parse(r.expiresAt) <= now && !["cancelled", "denied"].includes(status)) { status = "expired"; reason = "identity_expired" }
  else if (!policy.enabled || r.policyDigest !== policy.digest) { status = "denied"; reason = "identity_policy_changed" }
  else if (["preparing", "checking"].includes(status) && (!r.claim || Date.parse(r.claim.expiresAt) <= now)) { status = "unknown"; reason = "identity_check_unknown" }
  let authorization: JitIdentityAuthorizationRecord | undefined
  if (["authorized", "completed"].includes(status) && r.authorizationRef) {
    try { authorization = db.jitIdentity?.authorizations[r.authorizationRef]; assert(authorization, "jit_identity_proof", "Missing grant"); grantEvidence(db, authorization, policy, now) }
    catch { authorization = undefined; status = "expired"; reason = "authorization_unavailable" }
  }
  return { version: JIT_IDENTITY_VERSION, requestId: r.requestId, status, context: { ...r.context }, expiresAt: r.expiresAt,
    handoff: status === "handoff" || status === "checking" ? r.handoff : null,
    authorizationRef: authorization?.authorizationRef ?? null, authorizationExpiresAt: authorization?.expiresAt ?? null, reason }
}
function authorize(db: Db, r: JitIdentityRequestRecord, op: OperationRecord, policy: JitRuntimePolicy, now: number) {
  const e = jitEvidence(db, r.sessionId, op, policy, now)
  assert(e, "jit_identity_proof", "Current identity proof required", 403)
  if (r.context.purpose === "age19" || (r.context.purpose === "adult" && e.adultVerified !== true)) {
    r.status = "denied"; r.reason = r.context.purpose === "age19" ? "unsupported_age_policy" : "adult_claim_missing"; return
  }
  const authorizationRef = randomId("ida"), expiresAt = iso(Math.min(now + AUTH_MS, Date.parse(r.expiresAt), Date.parse(e.expiresAt), Date.parse(policy.expiresAt)))
  ledger(db).authorizations[authorizationRef] = { authorizationRef, requestId: r.requestId, sessionId: r.sessionId,
    context: { ...r.context }, consentDigest: r.consentDigest, evidenceOperationId: op.operationId, evidenceId: e.evidenceId,
    subjectRef: e.subjectRef, policyDigest: policy.digest, createdAt: iso(now), expiresAt, receipt: null }
  r.evidenceOperationId = op.operationId; r.authorizationRef = authorizationRef; r.status = "authorized"; r.reason = null
}

/** Ports are internal test seams, never obtained from a browser or environment.
 * Provider I/O happens only after an atomic, retained original-budget claim. */
export function createJitIdentityService(ports: Ports = defaults) {
  const policy = () => { const now = ports.now(); return { now, policy: ports.policy(now) } }
  return {
    async eligibility(sessionId: string | null): Promise<JitIdentityEligibility> {
      const snapshot = policy()
      const evidence = sessionId ? await ports.read(db => Object.values(db.operations)
        .map(op => jitEvidence(db, sessionId, op, snapshot.policy, snapshot.now)).filter(e => e !== null)
        .sort((a, b) => b.verifiedAt.localeCompare(a.verifiedAt))) : []
      const current = policy(), available = current.policy.enabled && current.policy.digest === snapshot.policy.digest
      const person = available ? evidence.find(e => Date.parse(e.expiresAt) > current.now) : undefined
      const adult = available ? evidence.find(e => e.adultVerified === true && Date.parse(e.expiresAt) > current.now) : undefined
      return { version: JIT_IDENTITY_VERSION, provider: "omnione_cx", execution: available ? "provider" : "unavailable",
        person: { state: !available ? "unavailable" : person ? "verified" : "proof_required", expiresAt: person?.expiresAt ?? null },
        adult: { state: !available ? "unavailable" : adult ? "verified" : person ? "not_verified" : "proof_required", expiresAt: adult?.expiresAt ?? null },
        age19: { state: "unsupported" }, paymentKyc: { state: "unsupported" }, canStart: available, consentVersion: JIT_IDENTITY_CONSENT }
    },
    async create(sessionId: string, input: unknown): Promise<JitIdentityRequest> {
      return ports.mutate(db => {
        const p = policy(), context = validateJitContext(input, p.policy, true)
        assert(db.sessions[sessionId], "no_session", "Session required", 401)
        assert(p.policy.enabled, "jit_identity_unavailable", "Identity checking is unavailable", 503)
        const state = ledger(db), existing = Object.values(state.requests).find(r => r.sessionId === sessionId && same(r.context, context))
        if (existing) return projection(db, existing, p.policy, p.now)
        assert(Object.keys(state.requests).length < 512 && Object.values(state.requests).filter(r => r.sessionId === sessionId).length < 32,
          "jit_identity_limit", "Identity request history limit reached", 429)
        const requestId = randomId("idn"), r: JitIdentityRequestRecord = {
          requestId, sessionId, context, consentDigest: digestOf({ version: JIT_IDENTITY_CONSENT, sessionId, requestId, context }),
          status: "awaiting_identity", createdAt: iso(p.now), expiresAt: iso(Math.min(p.now + REQUEST_MS, Date.parse(p.policy.expiresAt))),
          policyDigest: p.policy.digest, operationId: null, evidenceOperationId: null, authorizationRef: null, reason: null,
          handoff: null, started: false, polls: 0, lastPollAt: 0,
        }
        state.requests[requestId] = r
        if (context.purpose === "age19") { r.status = "denied"; r.reason = "unsupported_age_policy" }
        else {
          const candidates = Object.values(db.operations).filter(op => {
            const e = jitEvidence(db, sessionId, op, p.policy, p.now)
            return e && (context.purpose !== "adult" || e.adultVerified === true)
          }).sort((a, b) => b.identity!.verifiedAt.localeCompare(a.identity!.verifiedAt))
          if (candidates[0]) authorize(db, r, candidates[0], p.policy, p.now)
        }
        return projection(db, r, p.policy, p.now)
      })
    },
    async get(sessionId: string, requestId: string) { return ports.read(db => { const p = policy(); return projection(db, owned(db, sessionId, requestId), p.policy, p.now) }) },
    async start(sessionId: string, requestId: string, mobile: boolean): Promise<JitIdentityRequest> {
      assert(typeof mobile === "boolean", "bad_request", "Invalid handoff")
      const claimId = randomId("jclaim")
      const prepared = await ports.mutate(db => {
        const p = policy(), r = owned(db, sessionId, requestId); active(r, p.policy, p.now)
        if (["authorized", "handoff", "checking"].includes(r.status)) return { result: projection(db, r, p.policy, p.now) }
        assert(!r.started, "jit_identity_start_used", "This identity attempt is already reserved; check its result", 409)
        assert(r.status === "awaiting_identity", "jit_identity_inactive", "Identity request is not ready", 409)
        const operationId = randomId("op"), now = iso(p.now)
        // Terminal-ineligible phase prevents old immutable general journey
        // routes from starting another CX request or issuing assets for this row.
        const op: OperationRecord = { operationId, kind: "identity_check", venueId: r.context.venueId ?? "identity-pass",
          campaignId: "ktour-purpose-identity-v1", policyVersion: 1, status: "pending", phase: "consent", revision: 1,
          createdAt: now, updatedAt: now, expiresAt: r.expiresAt, execution: "provider", safeNextAction: "check_status", allowedActions: [], returnContext: null,
          consent: { version: JIT_IDENTITY_CONSENT, digest: r.consentDigest, acceptedAt: r.createdAt }, identity: null, credential: null,
          presentation: null, proposal: null, delegation: null, agent: null, fulfillment: null, chain: null, error: null,
          sessionId, secrets: {}, audit: [{ at: now, event: "identity.purpose.reserved" }] }
        ports.reserve(db, op)
        r.operationId = operationId; r.started = true; r.status = "preparing"; r.claim = { id: claimId, expiresAt: iso(p.now + CLAIM_MS) }
        return { operationId, policyDigest: p.policy.digest }
      })
      if (prepared.result) return prepared.result
      let started: Awaited<ReturnType<typeof cxStart>>
      try {
        const p = policy(); assert(p.policy.enabled && p.policy.digest === prepared.policyDigest, "jit_identity_unavailable", "Identity policy changed", 503)
        started = await ports.start({ operationId: prepared.operationId!, mobile })
        assert(started.handoff.kind !== "mock", "jit_identity_proof", "A sample is not provider verification", 403)
      } catch (error) {
        await ports.mutate(db => { const r = owned(db, sessionId, requestId); if (r.claim?.id === claimId) { clear(r); r.status = "unknown"; r.reason = "identity_start_unknown" } })
        if (error instanceof HkError) throw error
        throw new HkError("cx_request", "Identity provider is unavailable", 502, true)
      }
      return ports.mutate(db => {
        const p = policy(), r = owned(db, sessionId, requestId); active(r, p.policy, p.now)
        assert(r.claim?.id === claimId && Date.parse(r.claim.expiresAt) > p.now && db.operations[r.operationId!]?.status === "pending",
          "operation_changed", "Identity request changed", 409)
        r.handoff = { ...started.handoff, expiresAt: iso(Math.min(Date.parse(started.handoff.expiresAt), Date.parse(r.expiresAt))) }
        r.cxToken = started.token; r.cxTxId = started.txId; r.cxCxId = started.cxId; delete r.claim; r.status = "handoff"
        return projection(db, r, p.policy, p.now)
      })
    },
    async complete(sessionId: string, requestId: string): Promise<JitIdentityRequest> {
      const claimId = randomId("jclaim")
      const prepared = await ports.mutate(db => {
        const p = policy(), r = owned(db, sessionId, requestId)
        if (["authorized", "completed"].includes(r.status)) return { result: projection(db, r, p.policy, p.now) }
        active(r, p.policy, p.now)
        assert(r.status === "handoff" && r.handoff && Date.parse(r.handoff.expiresAt) > p.now && r.operationId && db.operations[r.operationId]?.status === "pending",
          "jit_identity_inactive", "Identity handoff is unavailable", 409)
        assert(r.polls < MAX_POLLS && (!r.lastPollAt || p.now - r.lastPollAt >= 1500), "jit_identity_poll_limit", "Wait before checking identity again", 429)
        r.polls += 1; r.lastPollAt = p.now; r.status = "checking"; r.claim = { id: claimId, expiresAt: iso(p.now + CLAIM_MS) }
        return { snapshot: structuredClone(r), policyDigest: p.policy.digest }
      })
      if (prepared.result) return prepared.result
      const snapshot = prepared.snapshot!
      let result: Awaited<ReturnType<typeof cxComplete>>
      try { const p = policy(); assert(p.policy.enabled && p.policy.digest === prepared.policyDigest, "jit_identity_unavailable", "Identity policy changed", 503)
        result = await ports.complete({ operationId: snapshot.operationId!, token: snapshot.cxToken, txId: snapshot.cxTxId, cxId: snapshot.cxCxId, mobile: snapshot.handoff?.kind === "app" })
      } catch (error) {
        await ports.mutate(db => { const r = owned(db, sessionId, requestId); if (r.claim?.id === claimId) { delete r.claim; r.status = "handoff"; r.reason = "identity_check_unavailable" } })
        if (error instanceof HkError) throw error
        throw new HkError("cx_request", "Identity check is unavailable", 502, true)
      }
      return ports.mutate(db => {
        const p = policy(), r = owned(db, sessionId, requestId); active(r, p.policy, p.now)
        assert(r.claim?.id === claimId && Date.parse(r.claim.expiresAt) > p.now && r.operationId === snapshot.operationId &&
          r.cxToken === snapshot.cxToken && r.cxTxId === snapshot.cxTxId && r.cxCxId === snapshot.cxCxId && db.operations[r.operationId!]?.status === "pending",
        "operation_changed", "Identity request changed", 409)
        delete r.claim
        if ("pending" in result) { if (result.token) r.cxToken = result.token; r.status = "handoff" }
        else if ("failed" in result) {
          clear(r); r.status = result.failed === "cancelled" ? "cancelled" : result.failed === "expired" ? "expired" : "denied"; r.reason = `identity_${result.failed}`
          const op = db.operations[r.operationId!]; op.status = result.failed === "cancelled" ? "cancelled" : "failed"; op.phase = op.status; op.updatedAt = iso(p.now)
        } else {
          const e = result.evidence, session = db.sessions[sessionId]
          assert(e.mode === "cx" && e.personVerified === true && e.provider === p.policy.provider && e.providerPolicyDigest === p.policy.digest &&
            e.providerTransactionRef === snapshot.cxTxId && e.subjectRef && (!session.subjectRef || session.subjectRef === e.subjectRef),
            "jit_identity_proof", "Identity provider binding could not be verified", 403)
          const op = db.operations[r.operationId!]
          op.identity = { ...e, handoff: null }; op.status = "succeeded"; op.phase = "done"; op.updatedAt = iso(p.now); session.subjectRef = e.subjectRef
          clear(r); authorize(db, r, op, p.policy, p.now)
        }
        return projection(db, r, p.policy, p.now)
      })
    },
    async cancel(sessionId: string, requestId: string) {
      return ports.mutate(db => {
        const p = policy(), r = owned(db, sessionId, requestId)
        assert(r.status !== "completed", "cannot_cancel", "This action check was already used", 409)
        clear(r); r.status = "cancelled"; r.reason = "identity_cancelled"
        if (r.operationId && db.operations[r.operationId]) { const op = db.operations[r.operationId]; op.status = "cancelled"; op.phase = "cancelled"; op.updatedAt = iso(p.now) }
        return projection(db, r, p.policy, p.now)
      })
    },
    async consume(sessionId: string, authorizationRef: string, input: unknown): Promise<JitIdentityReceipt> {
      return ports.mutate(db => {
        const p = policy(), context = validateJitContext(input, p.policy), a = db.jitIdentity?.authorizations[authorizationRef]
        assert(a?.sessionId === sessionId && same(a.context, context), "jit_identity_scope", "Authorization belongs to a different action", 403)
        const e = grantEvidence(db, a, p.policy, p.now)
        if (a.receipt) return structuredClone(a.receipt)
        a.receipt = { version: JIT_IDENTITY_VERSION, receiptId: randomId("idr"), context: { ...a.context }, authorizedAt: iso(p.now), expiresAt: a.expiresAt,
          evidenceExpiresAt: e.expiresAt, provider: "omnione_cx", personVerified: true, adultVerified: e.adultVerified === true, paymentKycVerified: false }
        owned(db, sessionId, a.requestId).status = "completed"
        return structuredClone(a.receipt)
      })
    },
    async receipt(sessionId: string, requestId: string): Promise<JitIdentityReceipt> {
      return ports.read(db => {
        const p = policy(), r = owned(db, sessionId, requestId), a = r.authorizationRef ? db.jitIdentity?.authorizations[r.authorizationRef] : undefined
        assert(a?.receipt, "not_found", "No completed action authorization", 404)
        grantEvidence(db, a, p.policy, p.now)
        return structuredClone(a.receipt)
      })
    },
  }
}
export const jitIdentity = createJitIdentityService()
