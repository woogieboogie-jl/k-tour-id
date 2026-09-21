// Storage-first orchestration. The adapter functions are supplied by the server,
// never by an HTTP client; unit tests use explicit local fixtures, not mock chains.
import { withStore, type OperationRecord } from "./store"
import { assert, HkError, nowIso, randomId } from "./util"
import type { DelegationSummary } from "./types"

type Entitlement = NonNullable<DelegationSummary["entitlement"]>
type Scope = Pick<DelegationSummary, "intentRef" | "actionCommitment" | "consentCommitment" | "userAddress" | "signer" | "recipient" | "expiresAtMs">
export type PreparationServices = {
  issue: (input: { intentRefHex: string; holder: string; expiresAtMs: number; beforeBroadcast: (digest: string) => Promise<void> }) => Promise<{ txDigest: string; entitlement: Omit<Entitlement, "txDigest"> }>
  build: (input: { userAddress: string; entitlement: Omit<Entitlement, "txDigest">; recipient: string; actionCommitmentHex: string; consentCommitmentHex: string; expiresAtMs: number }) => Promise<{ txBytesB64: string; txBytesDigest: string; sponsorSignature: string }>
}
function touch(op: OperationRecord, event: string) {
  op.revision += 1; op.updatedAt = nowIso(); op.audit.push({ at: op.updatedAt, event })
}

/** One irreversible issuer attempt per operation, claimed durably before I/O. */
export async function prepareDelegationOnce(input: { sessionId: string; operationId: string; expectedRevision: number; scope: Scope }, services: PreparationServices): Promise<OperationRecord> {
  const { sessionId, operationId, expectedRevision, scope } = input
  const claimId = randomId("prep")
  const owned = (op: OperationRecord | undefined): OperationRecord => {
    assert(op && op.sessionId === sessionId, "not_found", "operation not found", 404)
    assert(op.secrets.delegationPreparation?.claimId === claimId, "delegation_pending", "preparation belongs to another request", 409)
    return op
  }
  // Deliberately outside the catch: losing concurrent callers must not change
  // the winning claim, nor dispatch an issuer transaction.
  await withStore((db) => {
    const op = db.operations[operationId]
    assert(op && op.sessionId === sessionId, "not_found", "operation not found", 404)
    assert(op.status === "pending" && op.phase === "delegation" && Date.parse(op.expiresAt) > Date.now(), "phase", "delegation is not pending", 409)
    assert(!op.delegation && !op.secrets.delegationPreparation, "delegation_pending", "issuer attempt already claimed; reconcile or stop", 409)
    assert(op.revision === expectedRevision, "operation_changed", "approval changed while preparation was in flight", 409)
    assert(scope.expiresAtMs > Date.now(), "grant_window_expired", "delegation window expired", 409)
    op.delegation = { ...scope, delegationId: randomId("dlg"), status: "prepared", entitlement: null, grant: null, txBytesDigest: null, userTxDigest: null, error: null }
    op.secrets.delegationPreparation = { claimId, stage: "issuing", issueTxDigest: null }
    touch(op, "delegation.issue_claimed")
  })
  try {
    const issued = await services.issue({ intentRefHex: scope.intentRef, holder: scope.userAddress, expiresAtMs: scope.expiresAtMs + 60_000, beforeBroadcast: async (digest) => {
      await withStore((db) => {
        const op = owned(db.operations[operationId])
        assert(op.status === "pending" && op.phase === "delegation" && Date.parse(op.expiresAt) > Date.now() && scope.expiresAtMs > Date.now(), "phase", "issuer dispatch was stopped or approval expired", 409)
        assert(op.secrets.delegationPreparation!.stage === "issuing" && !op.secrets.delegationPreparation!.issueTxDigest, "delegation_pending", "issuer already dispatched", 409)
        op.secrets.delegationPreparation!.issueTxDigest = digest
        touch(op, "delegation.issue_dispatching")
      })
    } })
    // This checkpoint precedes PTB building. A build/RPC failure can never erase
    // an already-created entitlement and can never justify another mint.
    const proceed = await withStore((db) => {
      const op = owned(db.operations[operationId])
      assert(op.secrets.delegationPreparation!.issueTxDigest === issued.txDigest, "sui_evidence_mismatch", "issued transaction differs from the persisted intent", 502)
      op.delegation!.entitlement = { ...issued.entitlement, txDigest: issued.txDigest }
      op.delegation!.status = "entitled"
      op.secrets.delegationPreparation!.stage = "building"
      touch(op, "delegation.entitlement_persisted")
      return op.status === "pending" && op.phase === "delegation" && Date.parse(op.expiresAt) > Date.now() && scope.expiresAtMs > Date.now()
    })
    assert(proceed, "phase", "preparation was stopped; issued evidence retained", 409)
    const ptb = await services.build({ userAddress: scope.userAddress, entitlement: issued.entitlement, recipient: scope.recipient, actionCommitmentHex: scope.actionCommitment, consentCommitmentHex: scope.consentCommitment, expiresAtMs: scope.expiresAtMs })
    return await withStore((db) => {
      const op = owned(db.operations[operationId])
      assert(op.status === "pending" && op.phase === "delegation" && Date.parse(op.expiresAt) > Date.now() && scope.expiresAtMs > Date.now(), "phase", "preparation was stopped or expired", 409)
      op.delegation!.status = "awaiting_signature"; op.delegation!.txBytesDigest = ptb.txBytesDigest
      op.secrets.lastTxBytesB64 = ptb.txBytesB64
      ;(op.secrets as Record<string, unknown>).sponsorSignature = ptb.sponsorSignature
      op.secrets.delegationPreparation!.stage = "ready"
      touch(op, "delegation.prepared")
      return op
    })
  } catch (error) {
    await withStore((db) => {
      const op = owned(db.operations[operationId])
      op.secrets.delegationPreparation!.stage = "unknown"
      op.delegation!.status = "unknown"
      op.delegation!.error = "Preparation was interrupted; issuer will not be retried. Check status or stop this operation."
      op.error = { code: "delegation_preparation_unknown", message: op.delegation!.error, retryable: false }
      touch(op, "delegation.preparation_unknown")
    }).catch(() => undefined) // A persisted claim still prevents re-minting if this write fails.
    if (error instanceof HkError) throw error
    throw new HkError("delegation_preparation_unknown", "Preparation was interrupted; check status or stop. No automatic issuer retry is allowed.", 502)
  }
}
