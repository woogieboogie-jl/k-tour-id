/** Server-only main-operation boundary for the native OpenDID bridge.
 * Provider transport is real; production CX→CAS mapping is deliberately unavailable.
 * No native VC, QR payload, KYC/holder correlator or owner key enters public summaries.
 */
import { createHmac } from "node:crypto"
import { assertExternalServicesEnabled, hkConfig, HK_SERVICE_ACCESS } from "./config"
import { identityPolicyChanged } from "./identity-policy"
import { withStore, type Db, type OperationRecord } from "./store"
import type { CredentialSummary, PresentationSummary } from "./types"
import { digestOf, HkError } from "./util"
import { createOpenDidBridgeClient, openDidUtcTime, resolveOpenDidCxSubject, type OpenDidBridgeClient, type OpenDidCxEvidence, type OpenDidOffer, type VerifiedCxKycBinding } from "./adapters/opendid-provider"
import { assertOpenDidPermissionSnapshot, createOpenDidProviderLifecycle, type OpenDidProviderContext, type OpenDidProviderPhase, type OpenDidProviderState, type OpenDidProviderStore } from "./opendid-provider-lifecycle"

export type ProviderOperationAction = "issuance/start" | "issuance/refresh" | "presentation/start" | "presentation/refresh" | "cancel"
export type ProviderOperationResponse = { record: OperationRecord; provider: { phase: OpenDidProviderPhase; offer: OpenDidOffer | null } }
export type ProviderPermission = { revision: number; binding: string }
type AtomicStore = <T>(fn: (db: Db) => T | Promise<T>) => Promise<T>
type MappingResolver = (evidence: OpenDidCxEvidence) => Promise<VerifiedCxKycBinding | null>
const fail = (code: string, message: string, status = 409) => new HkError(code, message, status)
const terminal = (s: OpenDidProviderPhase) => ["failed", "denied", "cancelled", "expired"].includes(s)
const time = (value: string | null | undefined) => value ? Date.parse(value) : NaN
const future = (value: string | null | undefined, now: number) => Number.isFinite(time(value)) && time(value) > now

/** An environment flag cannot create the missing authenticated holder/CAS mapping,
 * or expand bridge-v1's hardcoded redeem_demo_entitlement policy to guide-save. */
export function providerIntegrationAvailable(_env: NodeJS.ProcessEnv = process.env): boolean { return false }

function supportedPolicy(op: OperationRecord): boolean {
  // Reject every V2/unknown journey, not just a matching known guide discriminator.
  return !op.journey && op.kind === "demo_entitlement" && op.policyVersion === 1
}
function operationBinding(op: OperationRecord): string {
  const i = op.identity
  return digestOf({ version: "opendid-main-binding/v1", operationId: op.operationId, sessionId: op.sessionId,
    kind: op.kind, journey: op.journey ?? null, venueId: op.venueId, campaignId: op.campaignId,
    policyVersion: op.policyVersion, consent: op.consent, expiresAt: op.expiresAt, execution: op.execution,
    identity: i ? { evidenceId: i.evidenceId, subjectRef: i.subjectRef, source: i.source, mode: i.mode, provider: i.provider,
      personVerified: i.personVerified, adultVerified: i.adultVerified, verifiedAt: i.verifiedAt, expiresAt: i.expiresAt,
      providerTransactionRef: i.providerTransactionRef } : null })
}
function alias(state: OpenDidProviderState, kind: string, value: string): string {
  return "0x" + createHmac("sha256", state.ownerBinding).update(JSON.stringify(["opendid-public-alias/v1", state.operationId, kind, value])).digest("hex")
}
function stateReason(op: OperationRecord, now: number): string | null {
  const s = op.secrets.openDidProvider, i = op.identity
  if (!supportedPolicy(op)) return "opendid_policy_unsupported"
  if (op.execution !== "provider" || !op.consent || !i || i.mode !== "cx" || i.source !== "cx_mobile_id" || i.personVerified !== true || !i.subjectRef || !future(i.expiresAt, now)) return "opendid_identity_required"
  if (!s || s.version !== "bridge-v1" || s.operationId !== op.operationId || s.operationBinding !== operationBinding(op)
    || s.subjectDigest !== digestOf(s.subject) || s.subject.kind !== "cx_evidence_ref" || s.subject.personVerified !== true
    || s.subject.evidenceRef !== i.evidenceId || s.subject.adultVerified !== i.adultVerified) return "opendid_operation_binding"
  if (terminal(s.phase) || ["cancelled", "expired", "failed", "unknown"].includes(op.status)) return "opendid_permission_required"
  if (!future(s.expiresAt, now) || !future(op.expiresAt, now)) return "opendid_permission_expired"
  return null
}
function credentialProjection(s: OpenDidProviderState, previous: CredentialSummary | null, now: number): CredentialSummary | null {
  const c = s.issuance?.credential
  if (!c || s.issuance?.state !== "issued") return null
  const credentialRef = alias(s, "credential", s.issuance.issuanceId)
  let status: CredentialSummary["status"] = "active"
  if (!future(c.validUntil, now)) status = "expired"
  else if (terminal(s.phase)) status = "unknown"
  else if (s.lastStatus && !s.lastStatus.active) status = s.lastStatus.reason === "status_revoked" ? "revoked" : s.lastStatus.reason === "status_suspended" ? "suspended" : "unknown"
  return { credentialRef, vcId: alias(s, "vc", c.vcId), schema: c.schemaId, mode: "opendid", issuerDid: c.issuerDid,
    holderBinding: alias(s, "holder", c.holderBinding), serviceAccess: [HK_SERVICE_ACCESS], validFrom: c.validFrom, validUntil: c.validUntil,
    statusRef: alias(s, "status", s.issuance.issuanceId), status,
    // Native FINISH, not a fabricated browser acknowledgement. Preserve the first receipt time.
    holderAckAt: previous?.credentialRef === credentialRef && previous.holderAckAt ? previous.holderAckAt : new Date(now).toISOString() }
}
function presentationProjection(s: OpenDidProviderState, previous: PresentationSummary | null, now: number): PresentationSummary | null {
  const p = s.presentation
  if (!p) return null
  const presentationId = alias(s, "presentation", p.presentationId), same = previous?.presentationId === presentationId
  const allowed = s.phase === "allowed" && p.state === "allowed" && !!p.decision
  return { presentationId,
    // Local receipt/correlation commitments, NOT a claim that bridge-v1 exposes native proof nonce/digest.
    nonce: alias(s, "receipt-correlation", p.presentationId), requestDigest: digestOf({ protocol: "bridge-v1/vp", operationBinding: s.operationBinding, presentationId }),
    requestedClaims: ["org.ktour.pass.personVerified", "org.ktour.pass.serviceAccess", "org.ktour.pass.policyVersion"],
    expiresAt: p.expiresAt, submittedAt: allowed ? (same && previous?.submittedAt || new Date(now).toISOString()) : null,
    verifiedAt: allowed ? (same && previous?.verifiedAt || new Date(now).toISOString()) : null,
    decision: allowed ? "allow" : s.phase === "expired" ? "expired" : terminal(s.phase) ? "deny" : null,
    decisionRef: allowed ? alias(s, "decision", p.decision!.decisionRef) : null,
    decisionExpiresAt: allowed ? p.decision!.decisionExpiresAt : null,
    decisionConsumedAt: same ? previous!.decisionConsumedAt : null,
    denyReason: terminal(s.phase) ? "opendid_permission_required" : null }
}

/** Pure durable binding check; issuance may be valid before any presentation exists.
 * This is NOT fresh permission to send a transaction. */
export function providerCredentialReason(op: OperationRecord, now = Date.now()): string | null {
  const reason = stateReason(op, now)
  if (reason) return reason
  const s = op.secrets.openDidProvider!, c = op.credential, expected = credentialProjection(s, c, now)
  if (!expected || !c || c.mode !== "opendid") return "opendid_credential_required"
  if (c.status !== "active" || expected.status !== "active") return "opendid_credential_inactive"
  if (!future(c.validUntil, now) || !Number.isFinite(time(c.validFrom)) || time(c.validFrom) > now) return "opendid_credential_expired"
  for (const field of ["credentialRef", "vcId", "schema", "issuerDid", "holderBinding", "validFrom", "validUntil", "statusRef"] as const) if (c[field] !== expected[field]) return "opendid_credential_binding"
  if (!c.holderAckAt || c.serviceAccess.length !== 1 || c.serviceAccess[0] !== HK_SERVICE_ACCESS) return "opendid_credential_binding"
  return null
}
export function providerPresentationReason(op: OperationRecord, now = Date.now()): string | null {
  const reason = providerCredentialReason(op, now)
  if (reason) return reason
  const s = op.secrets.openDidProvider!, p = op.presentation, expected = presentationProjection(s, p, now)
  if (s.phase !== "allowed" || !expected || !p || expected.decision !== "allow" || p.decision !== "allow" || !p.verifiedAt) return "opendid_permission_required"
  if (p.decisionConsumedAt) return "decision_consumed"
  if (!future(p.decisionExpiresAt, now)) return "opendid_permission_expired"
  for (const field of ["presentationId", "nonce", "requestDigest", "expiresAt", "decisionRef", "decisionExpiresAt"] as const) if (p[field] !== expected[field]) return "opendid_presentation_binding"
  if (digestOf(p.requestedClaims) !== digestOf(expected.requestedClaims)) return "opendid_presentation_binding"
  return null
}
export function assertProviderPermissionForOperation(op: OperationRecord, expectedRevision?: number, now = Date.now()): void {
  if (expectedRevision !== undefined && op.revision !== expectedRevision) throw fail("operation_changed", "Operation changed after credential status was checked")
  const reason = providerPresentationReason(op, now)
  if (reason) throw fail(reason, "Current OpenDID permission is required")
  assertOpenDidPermissionSnapshot(op.secrets.openDidProvider!, now)
}

function owned(db: Db, sessionId: string, operationId: string): OperationRecord {
  const op = db.operations[operationId]
  if (!op || op.sessionId !== sessionId) throw fail("not_found", "Operation not found", 404)
  return op
}
function touch(op: OperationRecord, s: OpenDidProviderState, now: number): void {
  op.revision++; op.updatedAt = new Date(now).toISOString()
  op.audit.push({ at: op.updatedAt, event: "opendid_provider_phase", detail: { phase: s.phase, revision: s.revision, pending: !!s.pending } })
}
function project(op: OperationRecord, s: OpenDidProviderState, now: number): void {
  op.secrets.openDidProvider = s
  op.credential = credentialProjection(s, op.credential, now)
  op.presentation = presentationProjection(s, op.presentation, now)
  if (op.status === "pending") {
    if (s.phase === "cancelled" || s.phase === "expired") { op.status = s.phase; op.phase = s.phase }
    else if (s.phase === "failed" || s.phase === "denied") { op.status = "failed"; op.phase = "failed" }
    else if (s.phase === "presentation" && op.phase === "issuance") op.phase = "presentation"
    else if (s.phase === "allowed" && ["issuance", "presentation"].includes(op.phase)) op.phase = "proposal"
  }
  touch(op, s, now)
}

/** Injectable only on the server for deterministic, zero-provider-write tests.
 * The production factory below intentionally supplies no CX→CAS resolver. */
export function createProviderOperationService(deps: { atomic: AtomicStore; bridge: OpenDidBridgeClient; resolveCxMapping?: MappingResolver; now?: () => number; identityChanged?: (op: OperationRecord) => boolean }) {
  const now = deps.now ?? Date.now, changedIdentity = deps.identityChanged ?? (op => identityPolicyChanged(op.identity))
  async function load(sessionId: string, operationId: string) { return deps.atomic(db => structuredClone(owned(db, sessionId, operationId))) }
  function context(op: OperationRecord): OpenDidProviderContext {
    return { sessionId: op.sessionId, operationId: op.operationId, operationBinding: operationBinding(op),
      expiresAt: new Date(Math.min(openDidUtcTime(op.expiresAt), openDidUtcTime(op.identity!.expiresAt))).toISOString() }
  }
  function validate(op: OperationRecord, action: ProviderOperationAction | "permission") {
    if (!supportedPolicy(op)) throw fail("opendid_policy_unsupported", "The native provider policy does not authorize this journey", 503)
    if (!op.identity || op.identity.source !== "cx_mobile_id" || op.identity.mode !== "cx" || op.identity.personVerified !== true || !op.identity.subjectRef || !op.consent || op.execution !== "provider") throw fail("opendid_identity_required", "Verified CX identity and consent are required")
    if (action !== "cancel" && (changedIdentity(op) || !future(op.identity.expiresAt, now()))) throw fail("opendid_identity_required", "Current verified CX identity is required")
    if (action !== "cancel" && (op.status !== "pending" || !future(op.expiresAt, now()))) throw fail("opendid_operation_inactive", "This operation is no longer active")
    if (op.credential && op.credential.mode !== "opendid") throw fail("opendid_mode_changed", "Cancel and restart with the selected credential provider")
    if (action === "issuance/start" && !["issuance", "presentation", "proposal"].includes(op.phase)) throw fail("opendid_phase", "OpenDID issuance is not available in this phase")
    if (action === "cancel" && ((op.status === "pending" && !["issuance", "presentation", "proposal"].includes(op.phase)) || op.status === "succeeded" || op.delegation?.userTxDigest || op.agent?.txDigest)) throw fail("opendid_cancel_after_execution", "Provider cancellation cannot undo an approved chain action")
  }
  function lifecycle(ctx: OpenDidProviderContext) {
    const scoped: OpenDidProviderStore = {
      async read(id) {
        if (id !== ctx.operationId) throw fail("not_found", "Operation not found", 404)
        return deps.atomic(db => {
          const op = owned(db, ctx.sessionId, id), s = op.secrets.openDidProvider
          if (!s) return null
          // Outer cancellation, expiry, identity/policy drift wins over an in-flight result.
          const invalid = operationBinding(op) !== s.operationBinding || changedIdentity(op)
          const dead = ["cancelled", "expired", "failed", "unknown"].includes(op.status)
          const expired = !future(op.expiresAt, now()) || !future(op.identity?.expiresAt, now())
          if (!terminal(s.phase) && (invalid || dead || expired)) {
            const phase: OpenDidProviderPhase = expired || op.status === "expired" ? "expired" : op.status === "cancelled" ? "cancelled" : "failed"
            project(op, { ...s, phase, revision: s.revision + 1, pending: null, lastStatus: null, cleanupPending: true }, now())
          }
          return structuredClone(op.secrets.openDidProvider!)
        })
      },
      async compareAndSet(id, expectedRevision, next) {
        if (id !== ctx.operationId) return false
        return deps.atomic(db => {
          const op = owned(db, ctx.sessionId, id), current = op.secrets.openDidProvider
          if ((current?.revision ?? null) !== expectedRevision || next.operationId !== id || next.ownerBinding !== deps.bridge.ownerBinding(ctx) || next.operationBinding !== ctx.operationBinding) return false
          const terminalUpdate = terminal(next.phase)
          const active = op.status === "pending" && future(op.expiresAt, now()) && future(op.identity?.expiresAt, now()) && !changedIdentity(op)
          if (!terminalUpdate && (!active || operationBinding(op) !== ctx.operationBinding)) return false
          // Terminal updates are allowed after enclosing cancellation only to remove authority/finish cleanup.
          if (terminalUpdate && !current) return false
          project(op, structuredClone(next), now())
          return true
        })
      },
    }
    return createOpenDidProviderLifecycle({ store: scoped, bridge: deps.bridge, now })
  }
  return {
    async action(sessionId: string, operationId: string, action: ProviderOperationAction): Promise<ProviderOperationResponse> {
      if (!["issuance/start", "issuance/refresh", "presentation/start", "presentation/refresh", "cancel"].includes(action)) throw fail("opendid_action", "Unknown OpenDID action", 400)
      const op = await load(sessionId, operationId); validate(op, action)
      const ctx = context(op), flow = lifecycle(ctx)
      let result
      if (action === "issuance/start") {
        const i = op.identity!
        const subject = await resolveOpenDidCxSubject({ source: "cx_mobile_id", mode: "cx", evidenceRef: i.evidenceId, personVerified: i.personVerified, adultVerified: i.adultVerified, expiresAt: i.expiresAt }, deps.resolveCxMapping, now())
        result = await flow.startIssuance(ctx, subject)
      } else if (action === "issuance/refresh") result = await flow.refreshIssuance(ctx)
      else if (action === "presentation/start") result = await flow.startPresentation(ctx)
      else if (action === "presentation/refresh") result = await flow.refreshPresentation(ctx)
      else result = await flow.cancel(ctx)
      const record = await load(sessionId, operationId), state = record.secrets.openDidProvider!
      // Another task may cancel after the provider result but before this response is projected.
      const current = record.status === "pending" && state.revision === result.state.revision && !terminal(state.phase) && operationBinding(record) === state.operationBinding
      return { record, provider: { phase: state.phase, offer: current ? result.offer : null } }
    },
    async refreshPermission(sessionId: string, operationId: string): Promise<ProviderPermission> {
      const op = await load(sessionId, operationId); validate(op, "permission")
      const ctx = context(op), result = await lifecycle(ctx).assertFreshPermission(ctx)
      const current = await load(sessionId, operationId)
      if (current.secrets.openDidProvider?.revision !== result.state.revision) throw fail("operation_changed", "Operation changed after credential status was checked")
      assertProviderPermissionForOperation(current, undefined, now())
      return { revision: current.revision, binding: result.state.operationBinding }
    },
  }
}

function configuredService() {
  assertExternalServicesEnabled("OpenDID")
  if (hkConfig().opendid.mode !== "opendid") throw fail("opendid_mode_required", "Provider credential mode is not enabled", 503)
  const env = process.env
  const bridge = createOpenDidBridgeClient({ baseUrl: env.HK_OPENDID_BRIDGE_URL ?? "", trustedOrigin: env.HK_OPENDID_TRUSTED_ORIGIN ?? "",
    serviceToken: env.HK_OPENDID_BRIDGE_TOKEN ?? "", ownerBindingSecret: env.HK_OPENDID_OWNER_BINDING_SECRET ?? "",
    issuerDid: env.HK_OPENDID_ISSUER_DID ?? "", schemaId: env.HK_OPENDID_SCHEMA_ID ?? "",
    allowLoopback: env.HK_OPENDID_BRIDGE_ALLOW_LOOPBACK === "1" && !env.VERCEL })
  // No resolver is wired until Claude/vendor provides the authenticated CX→holder/CAS contract.
  return createProviderOperationService({ atomic: withStore, bridge })
}
export async function providerOperationAction(sessionId: string, operationId: string, action: ProviderOperationAction): Promise<ProviderOperationResponse> {
  return configuredService().action(sessionId, operationId, action)
}
export async function refreshProviderPermission(sessionId: string, operationId: string): Promise<ProviderPermission> {
  return configuredService().refreshPermission(sessionId, operationId)
}
