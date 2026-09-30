/** Durable CX -> fresh native holder binding. No browser acknowledgement is proof.
 * CAS allocation is claimed once before I/O; uncertain results only reconcile.
 * The final state requires a real DIDAuth signature AND trusted TA/DID readback.
 */
import { createHmac, randomBytes } from "node:crypto"
import type { Db, OperationRecord } from "./store"
import { digestOf, HkError, safeEqual } from "./util"
import { identityPolicyChanged } from "./identity-policy"
import { refreshJitImportedIdentity } from "./jit-identity-import"
import { verifyNativeDidAuth, type NativeHolderKey } from "./native-binding-did"
import type { NativeBindingProvider } from "./native-binding-provider"

export const NATIVE_BINDING_VERSION = "cx-holder-v1" as const
export const NATIVE_BINDING_ID = /^nhb_[A-Za-z0-9_-]{24}$/
export const NATIVE_BINDING_TOKEN = /^[A-Za-z0-9_-]{43}$/
export type NativeHolderBindingState = {
  version: typeof NATIVE_BINDING_VERSION; bindingId: string; operationId: string; sessionId: string
  operationBinding: string; subjectCommitment: string; configBinding: string; revision: number
  status: "challenge" | "allocating" | "allocated" | "proved" | "confirming" | "verified" | "unknown" | "cancelled" | "expired"
  createdAt: string; expiresAt: string; authNonce: string; casUserId: string; kycRef: string
  holder: NativeHolderKey | null; proofDigest: string | null; verifiedAt: string | null
  claimAt: string | null
}
export type NativeBindingPublic = { version: typeof NATIVE_BINDING_VERSION; bindingId: string; status: NativeHolderBindingState["status"]; expiresAt: string }
export type NativeBindingLaunch = NativeBindingPublic & { operationId: string; token: string; authNonce: string }
export type NativeBindingBegin = NativeBindingPublic & { casUserId: string; token: string; authNonce: string }
type Atomic = <T>(fn: (db: Db) => T | Promise<T>) => Promise<T>
const fail = (code = "native_binding_inactive", status = 409) => new HkError(code, code === "native_binding_unavailable" ? "The native holder connection is not available" : "The native holder request is no longer valid", status)
const alive = (s: NativeHolderBindingState) => !["cancelled", "expired"].includes(s.status)
const future = (value: string, now: number) => Number.isFinite(Date.parse(value)) && Date.parse(value) > now
const publicState = (s: NativeHolderBindingState): NativeBindingPublic => ({ version: s.version, bindingId: s.bindingId, status: s.status, expiresAt: s.expiresAt })
export function nativeBindingOperationDigest(op: OperationRecord): string {
  return digestOf({ version: NATIVE_BINDING_VERSION, operationId: op.operationId, sessionId: op.sessionId, venueId: op.venueId, campaignId: op.campaignId, policyVersion: op.policyVersion,
    consent: op.consent, identity: op.identity ? { evidenceId: op.identity.evidenceId, subjectRef: op.identity.subjectRef, source: op.identity.source, mode: op.identity.mode, provider: op.identity.provider,
      personVerified: op.identity.personVerified, adultVerified: op.identity.adultVerified, expiresAt: op.identity.expiresAt } : null, expiresAt: op.expiresAt })
}
export function assertNativeHolderBinding(op: OperationRecord, configBinding?: string, now = Date.now()): NativeHolderBindingState {
  const s = op.secrets.nativeHolderBinding
  if (!s || s.version !== NATIVE_BINDING_VERSION || s.status !== "verified" || !s.holder || !s.verifiedAt || s.operationId !== op.operationId || s.sessionId !== op.sessionId || s.operationBinding !== nativeBindingOperationDigest(op) || (configBinding && s.configBinding !== configBinding) || !future(s.expiresAt, now) || !future(op.expiresAt, now) || !op.identity || !future(op.identity.expiresAt, now) || op.identity.mode !== "cx" || op.identity.source !== "cx_mobile_id" || !op.identity.personVerified || op.identity.sourceCurrent === false || op.secrets.identityImportInvalid || op.execution !== "provider" || op.status !== "pending") throw fail()
  return s
}
export function createNativeBindingService(deps: { atomic: Atomic; provider: NativeBindingProvider; secret: string; configBinding: string; now?: () => number; identityChanged?: (op: OperationRecord) => boolean }) {
  const now = deps.now ?? Date.now, changed = deps.identityChanged ?? (op => identityPolicyChanged(op.identity))
  if (typeof deps.secret !== "string" || deps.secret.length < 32 || !/^0x[0-9a-f]{64}$/.test(deps.configBinding)) throw fail("native_binding_unavailable", 503)
  const hmac = (domain: string, value: unknown, encoding: "hex" | "base64url" = "hex") => createHmac("sha256", deps.secret).update(JSON.stringify([domain, value])).digest(encoding)
  const token = (s: NativeHolderBindingState, stage: "launch" | "native") => hmac("ktour-native-binding-token/v1", [stage, s.bindingId, s.operationBinding, s.authNonce], "base64url")
  const touch = (op: OperationRecord, s: NativeHolderBindingState) => { s.revision++; op.revision++; op.updatedAt = new Date(now()).toISOString() }
  function owned(db: Db, id: string, sessionId?: string): OperationRecord {
    const op = db.operations[id]
    if (!op || !db.sessions[op.sessionId] || (sessionId !== undefined && op.sessionId !== sessionId)) throw fail("not_found", 404)
    refreshJitImportedIdentity(db, op)
    return op
  }
  function active(op: OperationRecord): void {
    if (op.journey || op.kind !== "demo_entitlement" || op.policyVersion !== 1 || op.secrets.publicIdentity || op.execution !== "provider" || op.status !== "pending" || !["issuance", "presentation", "proposal", "approval", "prepare", "delegation"].includes(op.phase) || !op.consent || !op.identity || op.identity.source !== "cx_mobile_id" || op.identity.mode !== "cx" || !op.identity.personVerified || !op.identity.subjectRef || op.identity.handoff || op.identity.sourceCurrent === false || changed(op) || !future(op.identity.expiresAt, now()) || !future(op.expiresAt, now())) throw fail()
  }
  function state(op: OperationRecord, bindingId?: string): NativeHolderBindingState {
    const s = op.secrets.nativeHolderBinding
    if (!s || s.version !== NATIVE_BINDING_VERSION || (bindingId !== undefined && s.bindingId !== bindingId) || s.operationId !== op.operationId || s.sessionId !== op.sessionId || s.configBinding !== deps.configBinding) throw fail("not_found", 404)
    active(op)
    if (s.operationBinding !== nativeBindingOperationDigest(op) || !alive(s) || !future(s.expiresAt, now())) throw fail()
    return s
  }
  function nativeAuth(op: OperationRecord, bindingId: string, bearer: string, stage: "launch" | "native") {
    const s = state(op, bindingId)
    if (!NATIVE_BINDING_TOKEN.test(bearer) || !safeEqual(token(s, stage), bearer)) throw fail("native_binding_access_denied", 401)
    return s
  }
  const beginReply = (s: NativeHolderBindingState): NativeBindingBegin => ({ ...publicState(s), casUserId: s.casUserId, token: token(s, "native"), authNonce: s.authNonce })
  return {
    async start(sessionId: string, operationId: string): Promise<NativeBindingLaunch> {
      return deps.atomic(db => {
        const op = owned(db, operationId, sessionId); active(op)
        const existing = op.secrets.nativeHolderBinding
        if (existing) { const s = state(op); return { ...publicState(s), operationId, token: token(s, "launch"), authNonce: s.authNonce } }
        if (op.phase !== "issuance") throw fail()
        const createdAt = new Date(now()).toISOString(), expiresAt = new Date(Math.min(now() + 600_000, Date.parse(op.expiresAt), Date.parse(op.identity!.expiresAt))).toISOString()
        const operationBinding = nativeBindingOperationDigest(op), bindingId = `nhb_${randomBytes(18).toString("base64url")}`
        const subjectCommitment = hmac("ktour-native-cx-subject/v1", op.identity!.subjectRef)
        // A fresh-wallet enrolment cannot silently replace another pending/bound
        // wallet for this person. Reuse needs the separately verified holder flow.
        for (const other of Object.values(db.operations)) {
          const b = other.secrets.nativeHolderBinding
          if (b && b.subjectCommitment === subjectCommitment && b.bindingId !== bindingId && b.status !== "cancelled" && b.status !== "expired") throw fail("native_binding_existing_holder", 409)
        }
        const s: NativeHolderBindingState = { version: NATIVE_BINDING_VERSION, bindingId, operationId, sessionId, operationBinding, subjectCommitment, configBinding: deps.configBinding,
          revision: 0, status: "challenge", createdAt, expiresAt, authNonce: hmac("ktour-native-auth-nonce/v1", [bindingId, operationBinding, expiresAt, randomBytes(32).toString("hex")]),
          casUserId: randomBytes(32).toString("base64url"), kycRef: hmac("ktour-native-cas-person/v1", op.identity!.subjectRef), holder: null, proofDigest: null, verifiedAt: null, claimAt: null }
        op.secrets.nativeHolderBinding = s; touch(op, s)
        return { ...publicState(s), operationId, token: token(s, "launch"), authNonce: s.authNonce }
      })
    },
    async status(sessionId: string, operationId: string): Promise<NativeBindingPublic | null> {
      return deps.atomic(db => {
        const op = owned(db, operationId, sessionId), s = op.secrets.nativeHolderBinding
        if (!s) return null
        if (!future(s.expiresAt, now()) && alive(s)) { s.status = "expired"; touch(op, s) }
        if (alive(s)) { try { state(op) } catch { s.status = "cancelled"; touch(op, s) } }
        return publicState(s)
      })
    },
    async cancel(sessionId: string, operationId: string): Promise<NativeBindingPublic> {
      return deps.atomic(db => {
        const op = owned(db, operationId, sessionId), s = op.secrets.nativeHolderBinding
        if (!s) throw fail("not_found", 404)
        if (op.delegation?.userTxDigest || op.agent?.txDigest || ["agent", "fulfillment", "done"].includes(op.phase)) throw fail()
        if (s.status !== "cancelled") { s.status = "cancelled"; touch(op, s) }
        return publicState(s)
      })
    },
    async begin(operationId: string, bindingId: string, bearer: string): Promise<NativeBindingBegin> {
      const claim = await deps.atomic(db => {
        const op = owned(db, operationId), s = nativeAuth(op, bindingId, bearer, "launch")
        if (s.status === "allocated") return { state: structuredClone(s), allocate: false, complete: true }
        if (s.status === "allocating" && s.claimAt && now() - Date.parse(s.claimAt) >= 30_000) { s.status = "unknown"; touch(op, s) }
        if (s.status === "allocating" || s.status === "confirming") throw fail("native_binding_pending", 409)
        const allocate = s.status === "challenge"
        if (!allocate && s.status !== "unknown") throw fail()
        s.status = "allocating"; s.claimAt = new Date(now()).toISOString(); touch(op, s)
        return { state: structuredClone(s), allocate, complete: false }
      })
      if (claim.complete) return beginReply(claim.state)
      try {
        if (claim.allocate) await deps.provider.allocateCas(claim.state.casUserId, claim.state.kycRef)
        else await deps.provider.confirmCas(claim.state.casUserId, claim.state.kycRef) // Lost response: read only, never another allocation.
        return await deps.atomic(db => {
          const op = owned(db, operationId), s = nativeAuth(op, bindingId, bearer, "launch")
          if (s.revision !== claim.state.revision || s.status !== "allocating") throw fail()
          s.status = "allocated"; s.claimAt = null; touch(op, s); return beginReply(s)
        })
      } catch (error) {
        await deps.atomic(db => { const op = owned(db, operationId), s = op.secrets.nativeHolderBinding; if (s?.bindingId === bindingId && s.revision === claim.state.revision && s.status === "allocating") { s.status = "unknown"; touch(op, s) } })
        if (error instanceof HkError && error.code === "native_binding_inactive") throw error
        throw fail("native_binding_unknown", 503)
      }
    },
    async prove(operationId: string, bindingId: string, bearer: string, didDocument: unknown, didAuth: unknown): Promise<NativeBindingPublic> {
      const claim = await deps.atomic(db => structuredClone(nativeAuth(owned(db, operationId), bindingId, bearer, "native")))
      const key = verifyNativeDidAuth(didDocument, didAuth, { authNonce: claim.authNonce, createdAt: claim.createdAt, expiresAt: claim.expiresAt, now: now() })
      const proofDigest = digestOf({ didDocument, didAuth })
      return deps.atomic(db => {
        const op = owned(db, operationId), s = nativeAuth(op, bindingId, bearer, "native")
        if (s.status === "proved" && s.proofDigest === proofDigest && s.holder?.keyCommitment === key.keyCommitment) return publicState(s)
        if (s.revision !== claim.revision || s.status !== "allocated") throw fail()
        for (const other of Object.values(db.operations)) {
          const b = other.secrets.nativeHolderBinding
          if (b?.holder?.did === key.did && b.subjectCommitment !== s.subjectCommitment && alive(b)) throw fail()
        }
        s.holder = key; s.proofDigest = proofDigest; s.status = "proved"; touch(op, s); return publicState(s)
      })
    },
    async confirm(operationId: string, bindingId: string, bearer: string): Promise<NativeBindingPublic> {
      const claim = await deps.atomic(db => {
        const op = owned(db, operationId), s = nativeAuth(op, bindingId, bearer, "native")
        if (s.status === "verified") return structuredClone(s)
        if (s.status === "confirming" && s.claimAt && now() - Date.parse(s.claimAt) >= 30_000) { s.status = "proved"; touch(op, s) }
        if (!s.holder || s.status !== "proved") throw fail()
        s.status = "confirming"; s.claimAt = new Date(now()).toISOString(); touch(op, s); return structuredClone(s)
      })
      if (claim.status === "verified") return publicState(claim)
      try {
        await deps.provider.confirmCas(claim.casUserId, claim.kycRef)
        await deps.provider.confirmHolder(claim.holder!, claim.kycRef)
        return await deps.atomic(db => {
          const op = owned(db, operationId), s = nativeAuth(op, bindingId, bearer, "native")
          if (s.revision !== claim.revision || s.status !== "confirming") throw fail()
          s.status = "verified"; s.verifiedAt = new Date(now()).toISOString(); touch(op, s); return publicState(s)
        })
      } catch (error) {
        await deps.atomic(db => { const op = owned(db, operationId), s = op.secrets.nativeHolderBinding; if (s?.bindingId === bindingId && s.revision === claim.revision && s.status === "confirming") { s.status = "proved"; touch(op, s) } })
        if (error instanceof HkError && error.code === "native_binding_inactive") throw error
        throw fail("native_binding_provider_unavailable", 503)
      }
    },
  }
}
