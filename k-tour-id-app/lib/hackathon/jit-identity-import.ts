import type { Db, OperationRecord } from "./store"
import { jitEvidence, jitRuntimePolicy, type JitRuntimePolicy } from "./jit-identity-policy"
import { assert, digestOf } from "./util"
import { JIT_IDENTITY_CONSENT } from "./jit-identity-contract"

/** Copying a proof never severs its revocation/configuration/subject binding. */
export function refreshJitImportedIdentity(db: Db, op: OperationRecord, policy: JitRuntimePolicy = jitRuntimePolicy(), now = Date.now()): boolean {
  const binding = op.secrets?.identityImport
  if (!binding) return true
  const a = db.jitIdentity?.authorizations[binding.authorizationRef]
  const request = a ? db.jitIdentity?.requests[a.requestId] : undefined
  const source = db.operations[binding.sourceOperationId]
  const e = jitEvidence(db, op.sessionId, source, policy, now)
  const valid = Boolean(a && request && a.receipt && request.status === "completed" && a.operationId === op.operationId &&
    a.sessionId === op.sessionId && request.sessionId === op.sessionId && a.policyDigest === policy.digest && request.policyDigest === policy.digest &&
    request.authorizationRef === a.authorizationRef && request.evidenceOperationId === a.evidenceOperationId && a.evidenceOperationId === binding.sourceOperationId &&
    request.consentDigest === a.consentDigest && a.consentDigest === digestOf({ version: JIT_IDENTITY_CONSENT, sessionId: a.sessionId, requestId: a.requestId, context: a.context }) &&
    digestOf(request.context) === digestOf(a.context) && digestOf(a.receipt.context) === digestOf(a.context) &&
    a.context.action === "designated_perk" && a.context.purpose === "person" && a.context.venueId === op.venueId &&
    a.context.contextDigest === binding.contextDigest && Date.parse(binding.importedAt) < Date.parse(a.expiresAt) && Date.parse(binding.importedAt) >= Date.parse(a.receipt.authorizedAt) &&
    e && e.evidenceId === binding.evidenceId && e.evidenceId === a.evidenceId && e.subjectRef === a.subjectRef &&
    op.identity?.evidenceId === e.evidenceId && op.identity?.subjectRef === e.subjectRef && op.identity.providerPolicyDigest === e.providerPolicyDigest &&
    op.identity.providerTransactionRef === e.providerTransactionRef && op.identity.expiresAt === e.expiresAt)
  op.secrets.identityImportInvalid = !valid
  if (op.identity) op.identity.sourceCurrent = valid
  return valid
}
export function refreshJitImportedIdentities(db: Db) {
  for (const op of Object.values(db.operations)) if (op.secrets?.identityImport) refreshJitImportedIdentity(db, op)
}
export function assertJitImportedIdentity(db: Db, op: OperationRecord) {
  assert(refreshJitImportedIdentity(db, op), "jit_identity_proof", "The source identity approval is no longer valid", 403)
}

/** Runs in the same CAS as operation creation. An approval cannot bind two
 * operations, change purpose, or skip the perk's separate consent/VC/VP steps. */
export function importJitIdentity(db: Db, op: OperationRecord, authorizationRef: string, contextDigest: string, now = Date.now(), policy = jitRuntimePolicy(now)) {
  const a = db.jitIdentity?.authorizations[authorizationRef]
  const request = a ? db.jitIdentity?.requests[a.requestId] : undefined
  assert(a && request && a.sessionId === op.sessionId && request.status === "completed" && a.receipt &&
    a.context.action === "designated_perk" && a.context.purpose === "person" && a.context.venueId === op.venueId &&
    a.context.tableId === null && a.context.contextDigest === contextDigest && Date.parse(a.expiresAt) > now &&
    a.policyDigest === policy.digest && (!a.operationId || a.operationId === op.operationId),
    "jit_identity_scope", "The identity approval does not match this perk operation", 403)
  const source = db.operations[a.evidenceOperationId], evidence = jitEvidence(db, op.sessionId, source, policy, now)
  assert(evidence && evidence.evidenceId === a.evidenceId && evidence.subjectRef === a.subjectRef, "jit_identity_proof", "Current provider proof required", 403)
  a.operationId = op.operationId
  op.identity = { ...evidence, handoff: null }
  op.secrets.identityImport = { sourceOperationId: a.evidenceOperationId, evidenceId: a.evidenceId, authorizationRef, contextDigest, importedAt: new Date(now).toISOString() }
  op.phase = "issuance"
  assert(refreshJitImportedIdentity(db, op, policy, now), "jit_identity_proof", "The source identity approval is no longer valid", 403)
}
