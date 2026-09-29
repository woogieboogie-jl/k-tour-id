// Optional hosted audit of the app-owned test entitlement. This does not
// activate native OpenDID or create a merchant/payment obligation.
import { hostedOmnioneEnabled, hostedSuiPreflightIssues, isHostedSuiProfile, PIN, type HostedSuiEnv } from "./hosted-sui-profile"
import { omnioneTargetSnapshot, sameOmnioneTarget } from "./omnione-targets"
import type { Db, OperationRecord, OutboxRecord } from "./store"
import { digestOf, sha256Hex, HkError } from "./util"

/** A persisted lane marker, not current permission. Keep it stable across
 * provider outages/expiry so closing the UI does not erase recovery state. */
export function hostedOmnioneOperationBound(op: OperationRecord): boolean {
  return op.kind === "demo_entitlement" && !op.journey && op.venueId === PIN.venueId && op.campaignId === PIN.campaignRef && op.policyVersion === PIN.policyVersion
    && sameOmnioneTarget(op.omnioneTarget, omnioneTargetSnapshot("stage-20260930"))
    && op.identity?.mode === "cx" && op.identity.source === "cx_mobile_id" && op.identity.personVerified === true
    && op.credential?.mode === "mock"
}
export function hostedOmnioneOperationAllowed(op: OperationRecord, env: HostedSuiEnv = process.env, now = Date.now()): boolean {
  return isHostedSuiProfile(env) && hostedOmnioneEnabled(env) && hostedSuiPreflightIssues(env, now).length === 0 && hostedOmnioneOperationBound(op)
}
/** Preserve the old hosted reject-before-storage boundary unless the complete
 * optional lane is enabled. No identity/chain/API call can open this fence. */
export function assertHostedOmnioneAdmission(env: HostedSuiEnv = process.env, now = Date.now()): void {
  if (isHostedSuiProfile(env) && (!hostedOmnioneEnabled(env) || hostedSuiPreflightIssues(env, now).length)) throw new HkError("hosted_sui_scope", "Test entitlement confirmation is not enabled for this operation.", 403)
}

/** Only this explicit new-operation lane relaxes the old hosted redemption fence.
 * Fresh identity, holder/VP, Sui execution, expiry, subject and one-use checks are
 * still performed by the service before its atomic business+outbox commit. */
export function assertHostedOmnioneOperation(op: OperationRecord, env: HostedSuiEnv = process.env, now = Date.now()): void {
  if (isHostedSuiProfile(env) && !hostedOmnioneOperationAllowed(op, env, now)) throw new HkError("hosted_sui_scope", "Test entitlement confirmation is not enabled for this operation.", 403)
}

/** A fresh dispatch must have a real committed service result in the SAME
 * ledger. Historical legacy rows and standalone synthetic probes never qualify.
 * Do not re-evaluate current credential expiry here: the recorded fact is the
 * already committed result; the hosted global deadline still gates dispatch. */
export function assertHostedOmnioneOutbox(db: Db, row: OutboxRecord, env: HostedSuiEnv = process.env, now = Date.now()): void {
  if (!isHostedSuiProfile(env)) return
  const op = db.operations[row.operationId], f = op?.fulfillment
  if (!op) throw new HkError("hosted_sui_scope", "Committed test entitlement evidence is required.", 403)
  assertHostedOmnioneOperation(op, env, now)
  const record = db.redemptions[`${op.identity!.subjectRef}::${op.campaignId}`]
  if (op.status !== "succeeded" || op.phase !== "done" || f?.status !== "redeemed" || !f.redemptionRef || !f.redeemedAt
    || record?.operationId !== op.operationId || record.redemptionRef !== f.redemptionRef || record.redeemedAt !== f.redeemedAt
    || record.subjectRef !== op.identity!.subjectRef || record.campaignId !== op.campaignId
    || !op.agent?.txDigest || op.agent.status !== "executed" || !op.agent.verified?.effectsOk || !op.agent.verified.eventOk
    || !op.presentation?.decisionConsumedAt || op.chain?.outboxId !== row.outboxId || op.chain.eventKey !== row.eventKey
    || op.chain.payloadCommitment !== row.payloadCommitment || !sameOmnioneTarget(op.omnioneTarget, row.target) || !sameOmnioneTarget(op.chain.target, row.target)
    || row.payload.kind !== "DemoEntitlementRedeemed" || row.payload.campaignRef !== op.campaignId || row.payload.policyVersion !== op.policyVersion
    || row.payload.suiDigestCommitment !== sha256Hex(op.agent.txDigest) || row.payload.manifestCommitment !== op.agent.manifestCommitment
    || digestOf(row.payload) !== row.payloadCommitment) {
    throw new HkError("hosted_sui_scope", "Committed test entitlement evidence is required.", 403)
  }
}
