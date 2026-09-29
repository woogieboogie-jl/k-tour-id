/** Server-only durable bridge orchestration. The caller supplies an atomic store in
 * the SAME operation authority boundary as cancel/expiry and later Sui decisions.
 * Never persist offers or expose this server state as a browser OperationResult.
 */
import { digestOf, HkError, randomId } from "./util"
import { openDidUtcTime, type OpenDidBinding, type OpenDidBridgeClient, type OpenDidCxSubject, type OpenDidIssuance, type OpenDidOffer, type OpenDidPresentation, type OpenDidStatus } from "./adapters/opendid-provider"

export type OpenDidProviderContext = OpenDidBinding & { expiresAt: string; operationBinding?: string }
export type OpenDidProviderPhase = "issuance" | "presentation" | "allowed" | "denied" | "failed" | "cancelled" | "expired"
type Action = "issue-start" | "issue-refresh" | "present-start" | "present-refresh" | "status"
export type OpenDidProviderState = {
  version: "bridge-v1"; operationId: string; ownerBinding: string; operationBinding: string; revision: number; phase: OpenDidProviderPhase
  expiresAt: string; idempotencyKey: string; subject: OpenDidCxSubject; subjectDigest: string
  issuance: Omit<OpenDidIssuance, "offer"> | null; presentation: Omit<OpenDidPresentation, "offer"> | null
  pending: { action: Action; claimId: string; leaseUntil: string } | null
  lastStatus: OpenDidStatus | null; cleanupPending: boolean
}
export type OpenDidProviderStore = {
  read(operationId: string): Promise<OpenDidProviderState | null>
  /** Atomic create-if-absent when expectedRevision=null; otherwise atomic exact revision CAS.
   * Must also reject a now-cancelled/expired enclosing operation. Never hold a lock during I/O. */
  compareAndSet(operationId: string, expectedRevision: number | null, next: OpenDidProviderState): Promise<boolean>
}
export type OpenDidProviderResult = { state: OpenDidProviderState; offer: OpenDidOffer | null }
export type OpenDidProviderLifecycle = {
  startIssuance(context: OpenDidProviderContext, subject: OpenDidCxSubject): Promise<OpenDidProviderResult>
  refreshIssuance(context: OpenDidProviderContext): Promise<OpenDidProviderResult>
  startPresentation(context: OpenDidProviderContext): Promise<OpenDidProviderResult>
  refreshPresentation(context: OpenDidProviderContext): Promise<OpenDidProviderResult>
  cancel(context: OpenDidProviderContext): Promise<OpenDidProviderResult>
  assertFreshPermission(context: OpenDidProviderContext): Promise<OpenDidProviderResult>
  read(context: OpenDidProviderContext): Promise<OpenDidProviderResult | null>
}
const terminal = (phase: OpenDidProviderPhase) => ["cancelled", "expired", "failed", "denied"].includes(phase)
const result = (state: OpenDidProviderState, offer: OpenDidOffer | null = null): OpenDidProviderResult => ({ state, offer })
const fault = (code: string, message: string, status = 409, retryable = false) => new HkError(code, message, status, retryable)
const mismatch = () => fault("opendid_provider_binding", "OpenDID result does not match this operation", 502)
function stripOffer<T extends { offer: OpenDidOffer | null }>(value: T): Omit<T, "offer"> { const { offer: _offer, ...rest } = value; return rest }

/** Fresh permission requires a new status request at EACH consequential action.
 * Caller must bind the returned revision/decision to its subsequent atomic phase claim;
 * this is not a forever-valid permission token or a substitute for user Sui approval. */
export function assertOpenDidPermissionSnapshot(state: OpenDidProviderState, now = Date.now(), maxStatusAgeMs = 60_000): void {
  if (state.version !== "bridge-v1" || state.phase !== "allowed" || state.pending || !state.issuance?.credential || !state.presentation?.decision) throw fault("opendid_permission_required", "A verified OpenDID presentation is required")
  const c = state.issuance.credential, d = state.presentation.decision, st = state.lastStatus
  if (openDidUtcTime(state.expiresAt) <= now || openDidUtcTime(c.validUntil) <= now || openDidUtcTime(c.validFrom) > now || openDidUtcTime(d.decisionExpiresAt) <= now) throw fault("opendid_permission_expired", "OpenDID permission has expired")
  if (!st || st.issuanceId !== state.issuance.issuanceId || !st.active || st.reason !== null || openDidUtcTime(st.checkedAt) > now + 1000 || openDidUtcTime(st.checkedAt) < now - maxStatusAgeMs) throw fault("opendid_status_required", "A fresh active credential status is required")
}

export function createOpenDidProviderLifecycle(deps: { store: OpenDidProviderStore; bridge: OpenDidBridgeClient; now?: () => number; leaseMs?: number }): OpenDidProviderLifecycle {
  const { store, bridge } = deps, now = deps.now ?? Date.now, leaseMs = deps.leaseMs ?? 15_000
  const bindingOf = (ctx: OpenDidProviderContext) => ctx.operationBinding ?? digestOf({ operationId: ctx.operationId, ownerBinding: bridge.ownerBinding(ctx) })
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 11_000 || leaseMs > 60_000) throw fault("opendid_configuration", "OpenDID claim lease is invalid", 503)
  async function owned(ctx: OpenDidProviderContext): Promise<OpenDidProviderState | null> {
    const row = await store.read(ctx.operationId)
    if (row && (row.version !== "bridge-v1" || row.operationId !== ctx.operationId || row.ownerBinding !== bridge.ownerBinding(ctx))) throw fault("not_found", "Operation not found", 404)
    if (row && row.operationBinding !== bindingOf(ctx)) throw fault("opendid_operation_binding", "OpenDID request no longer matches this operation")
    return row
  }
  async function readActive(ctx: OpenDidProviderContext): Promise<OpenDidProviderState | null> {
    for (let n = 0; n < 8; n++) {
      const row = await owned(ctx)
      if (!row || terminal(row.phase)) return row
      if (Math.min(openDidUtcTime(row.expiresAt), openDidUtcTime(ctx.expiresAt)) > now()) return row
      const expired = { ...row, revision: row.revision + 1, phase: "expired" as const, pending: null, lastStatus: null, cleanupPending: true }
      if (await store.compareAndSet(ctx.operationId, row.revision, expired)) return expired
    }
    throw fault("opendid_busy", "OpenDID state changed; check again", 409, true)
  }
  async function latest(ctx: OpenDidProviderContext): Promise<OpenDidProviderState> {
    const row = await readActive(ctx)
    if (!row) throw fault("opendid_request_required", "Start the OpenDID request first")
    return row
  }
  const stillClaimed = (row: OpenDidProviderState, claim: OpenDidProviderState) => row.revision === claim.revision && row.pending?.claimId === claim.pending?.claimId && !terminal(row.phase)
  async function claim(ctx: OpenDidProviderContext, action: Action, phases: OpenDidProviderPhase[]): Promise<{ row: OpenDidProviderState; acquired: boolean }> {
    for (let n = 0; n < 8; n++) {
      const row = await latest(ctx)
      if (terminal(row.phase)) return { row, acquired: false }
      if (!phases.includes(row.phase)) throw fault("opendid_phase", "OpenDID request is not in this phase")
      if (row.pending && openDidUtcTime(row.pending.leaseUntil) > now()) return { row, acquired: false }
      const next = { ...row, revision: row.revision + 1, pending: { action, claimId: randomId("claim"), leaseUntil: new Date(now() + leaseMs).toISOString() } }
      if (await store.compareAndSet(ctx.operationId, row.revision, next)) return { row: next, acquired: true }
    }
    throw fault("opendid_busy", "OpenDID state changed; check again", 409, true)
  }
  async function discardOffer(ctx: OpenDidProviderContext, response: OpenDidIssuance | OpenDidPresentation): Promise<void> {
    // A result after cancellation cannot restore local authority. Best-effort terminate
    // a newly discovered provider handle; failure leaves cleanupPending on the row.
    try {
      if ("issuanceId" in response) await bridge.issuanceCancel(ctx, response.issuanceId)
      else await bridge.presentationDeny(ctx, response.presentationId)
    } catch { /* authority already revoked locally; no success claim for provider cleanup */ }
  }
  async function run<T>(ctx: OpenDidProviderContext, action: Action, phases: OpenDidProviderPhase[], call: (row: OpenDidProviderState) => Promise<T>, apply: (row: OpenDidProviderState, response: T) => { next: OpenDidProviderState; offer?: OpenDidOffer | null }, discard?: (response: T) => Promise<void>): Promise<OpenDidProviderResult> {
    const lease = await claim(ctx, action, phases)
    if (!lease.acquired) return result(lease.row)
    const snapshot = lease.row
    let response: T
    try { response = await call(snapshot) } catch (e) {
      const current = await latest(ctx)
      if (!stillClaimed(current, snapshot)) return result(current)
      await store.compareAndSet(ctx.operationId, current.revision, { ...current, revision: current.revision + 1, pending: null })
      throw e
    }
    const current = await latest(ctx)
    if (!stillClaimed(current, snapshot)) {
      if (terminal(current.phase) && discard) await discard(response)
      return result(current)
    }
    let applied: { next: OpenDidProviderState; offer?: OpenDidOffer | null }
    try { applied = apply(current, response) } catch (e) {
      await store.compareAndSet(ctx.operationId, current.revision, { ...current, revision: current.revision + 1, pending: null })
      throw e
    }
    const next = { ...applied.next, revision: current.revision + 1, pending: null }
    if (!await store.compareAndSet(ctx.operationId, current.revision, next)) {
      const newest = await latest(ctx)
      if (terminal(newest.phase) && discard) await discard(response)
      return result(newest)
    }
    return result(next, applied.offer ?? null)
  }
  function acceptIssuance(row: OpenDidProviderState, response: OpenDidIssuance) {
    if (response.operationId !== row.operationId || (row.issuance && (response.issuanceId !== row.issuance.issuanceId || response.revision < row.issuance.revision))) throw mismatch()
    const c = response.credential
    if (response.state === "issued" && (!c || openDidUtcTime(c.validFrom) > now() || openDidUtcTime(c.validUntil) <= now())) throw fault("opendid_credential_expired", "OpenDID credential is not currently valid")
    const expiredPending = ["claimed", "offered"].includes(response.state) && openDidUtcTime(response.expiresAt) <= now()
    const phase: OpenDidProviderPhase = expiredPending ? "expired" : response.state === "issued" ? "presentation" : ["failed", "cancelled", "expired"].includes(response.state) ? response.state as OpenDidProviderPhase : "issuance"
    return { next: { ...row, phase, issuance: stripOffer(response), lastStatus: null }, offer: phase === "issuance" ? response.offer : null }
  }
  function acceptPresentation(row: OpenDidProviderState, response: OpenDidPresentation) {
    if (response.operationId !== row.operationId || (row.presentation && (response.presentationId !== row.presentation.presentationId || response.revision < row.presentation.revision))) throw mismatch()
    const c = row.issuance?.credential
    if (!c || openDidUtcTime(c.validFrom) > now() || openDidUtcTime(c.validUntil) <= now()) throw fault("opendid_credential_expired", "OpenDID credential is not currently valid")
    if (response.state === "allowed" && (!response.decision || openDidUtcTime(response.decision.decisionExpiresAt) <= now() || openDidUtcTime(response.decision.decisionExpiresAt) > openDidUtcTime(c.validUntil))) throw fault("opendid_permission_expired", "OpenDID decision is not currently valid")
    const expiredPending = ["claimed", "offered"].includes(response.state) && openDidUtcTime(response.expiresAt) <= now()
    const phase: OpenDidProviderPhase = expiredPending ? "expired" : ["allowed", "denied", "cancelled", "expired"].includes(response.state) ? response.state as OpenDidProviderPhase : "presentation"
    return { next: { ...row, phase, presentation: stripOffer(response), lastStatus: null }, offer: phase === "presentation" ? response.offer : null }
  }
  const api: OpenDidProviderLifecycle = {
    async startIssuance(ctx, subject) {
      if (subject.kind !== "cx_evidence_ref" || subject.personVerified !== true) throw fault("opendid_cx_mapping_unavailable", "Verified CX-to-OpenDID mapping is required", 503)
      if (openDidUtcTime(ctx.expiresAt) <= now()) throw fault("opendid_expired", "Operation has expired")
      const subjectDigest = digestOf(subject)
      let row = await readActive(ctx)
      if (!row) {
        const initial: OpenDidProviderState = { version: "bridge-v1", operationId: ctx.operationId, ownerBinding: bridge.ownerBinding(ctx), operationBinding: bindingOf(ctx), revision: 0, phase: "issuance", expiresAt: ctx.expiresAt,
          idempotencyKey: randomId("odissue"), subject: { ...subject }, subjectDigest, issuance: null, presentation: null, pending: null, lastStatus: null, cleanupPending: false }
        await store.compareAndSet(ctx.operationId, null, initial)
        row = await latest(ctx)
      }
      if (row.subjectDigest !== subjectDigest) throw fault("opendid_subject_mismatch", "OpenDID request is bound to different identity evidence")
      if (terminal(row.phase) || row.phase !== "issuance") return result(row)
      if (row.issuance) return api.refreshIssuance(ctx)
      return run(ctx, "issue-start", ["issuance"], r => bridge.issuanceStart(ctx, { idempotencyKey: r.idempotencyKey, subject: r.subject }), acceptIssuance, r => discardOffer(ctx, r))
    },
    async refreshIssuance(ctx) {
      const row = await latest(ctx)
      if (terminal(row.phase) || row.phase !== "issuance") return result(row)
      if (!row.issuance) return api.startIssuance(ctx, row.subject)
      return run(ctx, "issue-refresh", ["issuance"], r => bridge.issuanceRefresh(ctx, r.issuance!.issuanceId), acceptIssuance, r => discardOffer(ctx, r))
    },
    async startPresentation(ctx) {
      const row = await latest(ctx)
      if (terminal(row.phase) || row.phase === "allowed") return result(row)
      if (row.phase !== "presentation" || !row.issuance?.credential) throw fault("opendid_credential_required", "A provider-issued credential is required")
      if (openDidUtcTime(row.issuance.credential.validFrom) > now() || openDidUtcTime(row.issuance.credential.validUntil) <= now()) throw fault("opendid_credential_expired", "OpenDID credential is not currently valid")
      if (row.presentation) return api.refreshPresentation(ctx)
      return run(ctx, "present-start", ["presentation"], r => bridge.presentationStart(ctx, r.issuance!.issuanceId), acceptPresentation, r => discardOffer(ctx, r))
    },
    async refreshPresentation(ctx) {
      const row = await latest(ctx)
      if (terminal(row.phase) || row.phase === "allowed") return result(row)
      if (!row.presentation) return api.startPresentation(ctx)
      return run(ctx, "present-refresh", ["presentation"], r => bridge.presentationRefresh(ctx, r.presentation!.presentationId), acceptPresentation, r => discardOffer(ctx, r))
    },
    async cancel(ctx) {
      let stopped: OpenDidProviderState | undefined
      for (let n = 0; n < 8; n++) {
        const row = await latest(ctx)
        if (terminal(row.phase)) { stopped = row; break }
        const next = { ...row, revision: row.revision + 1, phase: "cancelled" as const, pending: null, lastStatus: null, cleanupPending: true }
        if (await store.compareAndSet(ctx.operationId, row.revision, next)) { stopped = next; break }
      }
      if (!stopped) throw fault("opendid_busy", "OpenDID state changed; check again", 409, true)
      // Local revocation is durable BEFORE provider I/O. A disconnected provider cannot
      // authorize later phases or undo cancellation. This does not revoke an already issued VC.
      let cleaned = true
      if (stopped.presentation) try { await bridge.presentationDeny(ctx, stopped.presentation.presentationId) } catch { cleaned = false }
      if (stopped.issuance) try { await bridge.issuanceCancel(ctx, stopped.issuance.issuanceId) } catch { cleaned = false }
      if (!stopped.issuance) cleaned = false // a lost/in-flight issuance may still need operator/provider cleanup
      const current = await latest(ctx)
      if (cleaned && current.cleanupPending) await store.compareAndSet(ctx.operationId, current.revision, { ...current, revision: current.revision + 1, cleanupPending: false })
      return result(await latest(ctx))
    },
    async assertFreshPermission(ctx) {
      const row = await latest(ctx)
      if (row.phase !== "allowed" || !row.issuance?.credential || !row.presentation?.decision) throw fault("opendid_permission_required", "A verified OpenDID presentation is required")
      const requestAt = now()
      const response = await run(ctx, "status", ["allowed"], r => bridge.credentialStatus(ctx, r.issuance!.issuanceId), (r, status) => {
        const checkedAt = openDidUtcTime(status.checkedAt)
        if (status.issuanceId !== r.issuance!.issuanceId || checkedAt < requestAt - 1000 || checkedAt > now() + 1000) throw fault("opendid_status_required", "A fresh credential status could not be established")
        return { next: { ...r, lastStatus: status } }
      })
      // A busy lease returns a pending row, which this assertion rejects rather than
      // silently reusing another step's earlier positive status.
      assertOpenDidPermissionSnapshot(response.state, now())
      return response
    },
    async read(ctx) { const row = await readActive(ctx); return row ? result(row) : null },
  }
  return api
}
