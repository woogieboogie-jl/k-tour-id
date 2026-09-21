import { hkConfig, HK_SERVICE_ACCESS, HK_TTL } from "./config"
import { digestOf, sha256Hex, assert } from "./util"
import { redemptionKey, type Db, type OperationRecord } from "./store"
import type { GrantExpectation, ExecutionExpectation } from "./sui-evidence"
import { verifyIssuerSignature, sampleSubjectCommitment, type KPassVc } from "./adapters/opendid"

const time = (v: string | null | undefined) => v ? Date.parse(v) : NaN
const fresh = (v: string | null | undefined, now: number) => Number.isFinite(time(v)) && time(v) > now

/** Provider status is deliberately NOT inferred from a cached summary. */
export function credentialEligibility(op: OperationRecord, now = Date.now()): string | null {
  const i = op.identity, c = op.credential, vc = op.secrets.vcDocument as KPassVc | undefined
  if (i?.personVerified !== true || !i.subjectRef || !fresh(i.expiresAt, now)) return "identity_invalid"
  if (!c) return "credential_missing"
  if (c.mode !== "mock") return "opendid_provider_unimplemented"
  if (c.status !== "active") return `credential_${c.status}`
  if (!fresh(c.validUntil, now) || !Number.isFinite(time(c.validFrom)) || time(c.validFrom) > now) return "credential_expired"
  if (!vc || !verifyIssuerSignature(vc)) return "credential_signature"
  const s = vc.credentialSubject
  if (!s || vc.id !== c.vcId || vc.issuer !== c.issuerDid || vc.expirationDate !== c.validUntil || vc.issuanceDate !== c.validFrom
    || s.holderBinding !== c.holderBinding || s.statusRef !== c.statusRef || s.schemaVersion !== c.schema || s.policyVersion !== op.policyVersion
    || s.validUntil !== c.validUntil || s.validFrom !== c.validFrom || s.personVerified !== true
    || s.subjectCommitment !== sampleSubjectCommitment(i.subjectRef)
    || s.holderBinding !== digestOf({ spki: op.secrets.holderPublicKeyPem, alg: op.secrets.holderKeyAlg })
    || !Array.isArray(s.serviceAccess) || !s.serviceAccess.includes(HK_SERVICE_ACCESS) || !c.serviceAccess.includes(HK_SERVICE_ACCESS)) return "credential_binding"
  if (!c.holderAckAt) return "holder_ack_missing"
  return null
}

export function presentationEligibility(op: OperationRecord): string | null {
  const p = op.presentation, b = op.secrets.presentationBinding
  if (!p || p.decision !== "allow" || !p.decisionRef || !Number.isFinite(time(p.verifiedAt))) return "presentation_missing"
  if (p.decisionConsumedAt) return "decision_consumed"
  if (!b || b.operationId !== op.operationId || b.presentationId !== p.presentationId || b.nonce !== p.nonce || b.credentialRef !== op.credential?.credentialRef || b.holderBinding !== op.credential?.holderBinding
    || b.subjectRef !== op.identity?.subjectRef || b.vcDigest !== digestOf(op.secrets.vcDocument)
    || b.requestDigest !== p.requestDigest || b.decisionRef !== p.decisionRef) return "presentation_binding"
  return null
}

export function fulfillmentEligibility(op: OperationRecord, executedAtMs: number, now = Date.now()): string | null {
  const c = hkConfig().campaign
  if (op.campaignId !== c.campaignId || op.venueId !== c.venueId || op.policyVersion !== c.policyVersion || !fresh(c.endsAt, now)) return "campaign_closed"
  const eligibility = credentialEligibility(op, now) ?? presentationEligibility(op)
  if (eligibility) return eligibility
  if (!Number.isSafeInteger(executedAtMs) || executedAtMs > now || executedAtMs < time(op.presentation!.verifiedAt)
    || executedAtMs >= time(op.presentation!.decisionExpiresAt) || !Number.isFinite(time(op.presentation!.decisionExpiresAt))) return "decision_expired"
  if (now >= executedAtMs + HK_TTL.fulfillmentMs) return "fulfillment_expired"
  return null
}

export function redemptionEligibility(op: OperationRecord, db: Pick<Db, "sessions" | "redemptions">, executedAtMs: number, now = Date.now()): string | null {
  const reason = fulfillmentEligibility(op, executedAtMs, now)
  if (reason) return reason
  const subject = op.identity!.subjectRef
  if (db.sessions[op.sessionId]?.subjectRef !== subject) return "session_subject_mismatch"
  if (db.redemptions[redemptionKey(subject, op.campaignId)]) return "already_redeemed"
  return null
}

type BindingConfig = Pick<GrantExpectation, "campaignId" | "grantType" | "events">
export function delegationExpectation(op: OperationRecord, config: BindingConfig, agent: string): GrantExpectation {
  const d = op.delegation, p = op.proposal
  assert(d && p && op.consent && op.presentation?.decisionRef, "operation_proof", "operation approval proof missing", 409)
  assert(p.output.action === HK_SERVICE_ACCESS && p.output.target.venueId === op.venueId && p.output.target.campaignId === op.campaignId && p.policyVersion === op.policyVersion, "operation_proof", "proposal target changed", 409)
  assert(p.outputDigest === digestOf(p.output) && p.proposalDigest === digestOf({ proposalId: p.proposalId, inputDigest: p.inputDigest, outputDigest: p.outputDigest, promptVersion: p.promptVersion, policyVersion: p.policyVersion, model: p.model }), "operation_proof", "proposal digest changed", 409)
  assert(d.actionCommitment === digestOf({ action: p.output.action, target: p.output.target, proposalDigest: p.proposalDigest, decisionRef: op.presentation.decisionRef, policyVersion: op.policyVersion }), "operation_proof", "approved action changed", 409)
  assert(d.consentCommitment === digestOf({ consentDigest: op.consent.digest, proposalDigest: p.proposalDigest, userAddress: d.userAddress, recipient: d.recipient, expiresAtMs: d.expiresAtMs, maxUses: 1 }), "operation_proof", "approved consent scope changed", 409)
  return { ...config, grantId: d.grant?.objectId, owner: d.userAddress, agent, recipient: d.recipient, intentRef: d.intentRef, actionCommitment: d.actionCommitment, consentCommitment: d.consentCommitment, expiresAtMs: d.expiresAtMs, policyVersion: op.policyVersion }
}

export function executionManifest(op: OperationRecord, agent: string, decidedAt: string) {
  const d = op.delegation!, p = op.proposal!
  return {
    schema: "ondo-agent-manifest/v1", operationRef: sha256Hex(op.operationId), campaignId: op.campaignId, venueId: op.venueId, policyVersion: op.policyVersion,
    proposal: { proposalId: p.proposalId, model: p.model, promptVersion: p.promptVersion, inputDigest: p.inputDigest, outputDigest: p.outputDigest, proposalDigest: p.proposalDigest },
    consentCommitment: d.consentCommitment, actionCommitment: d.actionCommitment, intentRef: d.intentRef,
    grant: d.grant!.objectId, agent, tool: HK_SERVICE_ACCESS, decidedAt,
  }
}

export function executionExpectation(op: OperationRecord, config: BindingConfig, agent: string): ExecutionExpectation {
  const expected = delegationExpectation(op, config, agent)
  const a = op.agent, p = op.proposal!
  assert(expected.grantId && a?.manifest && typeof a.manifest.decidedAt === "string" && Number.isFinite(time(a.manifest.decidedAt)), "operation_proof", "execution proof missing", 409)
  const manifest = executionManifest(op, agent, a.manifest.decidedAt)
  const decision = digestOf({ action: p.output.action, target: p.output.target, grant: expected.grantId, actionCommitment: expected.actionCommitment })
  assert(a.manifestCommitment === digestOf(a.manifest) && a.manifestCommitment === digestOf(manifest) && a.decisionCommitment === decision, "operation_proof", "execution proof belongs to a different operation or scope", 409)
  return { ...expected, grantId: expected.grantId, decisionCommitment: decision, manifestCommitment: a.manifestCommitment, recordId: a.recordId ?? undefined }
}
