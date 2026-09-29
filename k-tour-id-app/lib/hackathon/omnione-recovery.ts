// Chain-read-only recovery. No service/config/Wallet import or submission capability.
import { randomUUID } from "node:crypto"
import type { Db, OutboxRecord } from "./store"
import { nonzeroHex32 } from "./omnione-evidence"
import { sameOmnioneTarget, storedOmnioneTarget } from "./omnione-targets"
import { mirrorGuideCollection } from "./guide-collection"
import { readOmnioneReceiptEvidence, type OmnioneReceiptResult, type OmnioneRpcReader } from "./omnione-readonly"

export type RecoveryRepository = { read: () => Promise<Db>; mutate: <T>(work: (db: Db) => T, cleanup?: boolean) => Promise<T> }
const eligible = (row: OutboxRecord) => row && (row.status === "submitted" || row.status === "unknown") && nonzeroHex32(row.txHash) && nonzeroHex32(row.eventKey) && nonzeroHex32(row.payloadCommitment)
const unchanged = (row: OutboxRecord, before: OutboxRecord) => row.operationId === before.operationId && row.txHash === before.txHash && row.eventKey === before.eventKey && row.payloadCommitment === before.payloadCommitment && sameOmnioneTarget(row.target, before.target)
function mirror(db: Db, row: OutboxRecord, at: string) {
  mirrorGuideCollection(db, row)
  const op = db.operations[row.operationId]
  if (!op?.chain || op.chain.outboxId !== row.outboxId || op.chain.eventKey !== row.eventKey || op.chain.payloadCommitment !== row.payloadCommitment) return
  if (!sameOmnioneTarget(op.omnioneTarget, row.target) || !sameOmnioneTarget(op.chain.target, row.target)) return
  op.chain = { target: storedOmnioneTarget(row.target), outboxId: row.outboxId, eventKey: row.eventKey, payloadCommitment: row.payloadCommitment, status: row.status, txHash: row.txHash, blockNumber: row.blockNumber, attempts: row.attempts, lastError: row.lastError, confirmedAt: row.confirmedAt }
  op.revision += 1; op.updatedAt = at
  op.audit.push({ at, event: `chain.${row.status}` })
}
function applyResult(db: Db, row: OutboxRecord, result: OmnioneReceiptResult) {
  const at = new Date().toISOString()
  if (result.status === "confirmed" && result.blockNumber !== null) {
    row.status = "confirmed"; row.blockNumber = result.blockNumber; row.confirmedAt = at; row.lastError = null
    row.receiptEvidenceVersion = 1
  } else if (result.status === "failed" || result.status === "mismatch") {
    row.status = "failed"; row.blockNumber = result.blockNumber; row.confirmedAt = null
    row.lastError = result.status === "failed" ? "receipt_status_0" : "omnione_evidence_mismatch"
    delete row.receiptEvidenceVersion
  } else { row.status = "submitted"; row.confirmedAt = null; row.lastError = null }
  row.updatedAt = at; mirror(db, row, at)
}

/** May update the dedicated ledger; NEVER signs or writes to the chain.
 * All claims/commits must be run by a repository with atomic compare-and-write. */
export async function recoverOmnioneOutbox(options: { repository: RecoveryRepository; rpc: OmnioneRpcReader; limit?: number; deadline?: number }) {
  const limit = options.limit ?? 1
  if (!Number.isInteger(limit) || limit < 1 || limit > 3) throw new Error("recovery_limit_invalid")
  const deadline = Math.min(options.deadline ?? Infinity, Date.now() + 25000)
  if (!Number.isFinite(deadline) || deadline <= Date.now()) throw new Error("recovery_deadline")
  const summary = { ok: false, mode: "chain-read-only-recovery", selected: 0, checked: 0, confirmed: 0, pending: 0, failed: 0, skipped: 0, unresolvedWithoutHash: 0, legacyUnverified: 0, deferred: 0, cleanupComplete: true, issues: [] as string[], signatures: 0, broadcasts: 0 }
  const db = await options.repository.read()
  const rows = Object.entries(db.outbox)
  // Work and output are bounded even if the dedicated ledger is unexpectedly large.
  if (rows.length > 1000) throw new Error("recovery_ledger_too_large")
  const candidates = rows.filter(([id, row]) => id === row.outboxId && eligible(row))
  if (rows.some(([id, row]) => (row.status === "submitted" || row.status === "unknown") &&
    (id !== row.outboxId || nonzeroHex32(row.txHash) && !eligible(row)))) summary.issues.push("recovery_row_invalid")
  summary.unresolvedWithoutHash = rows.filter(([, row]) => (row.status === "submitted" || row.status === "unknown") && !nonzeroHex32(row.txHash)).length
  summary.legacyUnverified = rows.filter(([, row]) => row.status === "confirmed" && row.receiptEvidenceVersion !== 1).length
  summary.deferred = Math.max(0, candidates.length - limit)
  for (const [id, snapshot] of candidates.slice(0, limit)) {
    if (Date.now() >= deadline) { summary.issues.push("recovery_deadline"); break }
    summary.selected++
    const claimId = `obx_recover_${randomUUID()}`
    let claimed = false
    try {
      const target = storedOmnioneTarget(snapshot.target)
      claimed = await options.repository.mutate(current => {
        const row = current.outbox[id]
        if (!eligible(row) || !unchanged(row, snapshot) || Date.now() >= deadline ||
          (row.processingClaim && !(Date.parse(row.processingClaim.expiresAt) <= Date.now()))) return false
        row.processingClaim = { id: claimId, expiresAt: new Date(deadline).toISOString() }
        return true
      })
      if (!claimed) { summary.skipped++; continue }
      const result = await readOmnioneReceiptEvidence(options.rpc, { txHash: snapshot.txHash!, eventKey: snapshot.eventKey, payloadCommitment: snapshot.payloadCommitment, registry: target.registry, recorder: target.recorder, chainId: target.chainId })
      summary.checked++
      const saved = await options.repository.mutate(current => {
        const row = current.outbox[id]
        if (!eligible(row) || !unchanged(row, snapshot) || row.processingClaim?.id !== claimId ||
          !(Date.parse(row.processingClaim.expiresAt) > Date.now()) || Date.now() >= deadline) return false
        applyResult(current, row, result)
        return true
      })
      if (!saved) { summary.skipped++; continue }
      if (result.status === "confirmed") summary.confirmed++
      else if (result.status === "pending") summary.pending++
      else summary.failed++
    } catch { summary.issues.push("recovery_check_unavailable") }
    finally {
      // Also attempt release after an uncertain claim response. Never delete a
      // replacement owner's claim or infer that a timed-out write did not land.
      try {
        await options.repository.mutate(current => {
          const row = current.outbox[id]
          if (row?.processingClaim?.id === claimId) delete row.processingClaim
        }, true)
      } catch { summary.cleanupComplete = false; summary.issues.push("recovery_claim_cleanup_unconfirmed") }
    }
  }
  summary.ok = summary.issues.length === 0 && summary.cleanupComplete && summary.unresolvedWithoutHash === 0 && summary.legacyUnverified === 0 && summary.deferred === 0 && summary.skipped === 0 && summary.pending === 0 && summary.failed === 0 && summary.checked === summary.confirmed
  return summary
}
