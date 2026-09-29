import type { Db, OperationRecord, OutboxRecord } from "./store"
import { GUIDE_SAVE_V2, isGuideJourney, type GuideCollectionEntry } from "./guide-contract"
import { digestOf, HkError } from "./util"
import { storedOmnioneTarget, sameOmnioneTarget } from "./omnione-targets"

export type GuideCollectionRecord = GuideCollectionEntry & { subjectRef: string; redemptionRef: string; outboxId: string }
export const guideCollectionKey = (subject: string) => digestOf({ subject, campaign: GUIDE_SAVE_V2.campaignId })
const invalid = () => new HkError("guide_collection_invalid", "The saved guide could not be verified.", 503)

/** Run in the same mutation as create/CX completion, before issuance or gas use. */
export function guideSaveConflict(db: Db, subject: string | null | undefined, exceptOperationId?: string): "guide_already_saved" | "guide_save_in_progress" | null {
  if (!subject) return null
  if (db.guideCollection?.[guideCollectionKey(subject)] || db.redemptions[`${subject}::${GUIDE_SAVE_V2.campaignId}`]) return "guide_already_saved"
  const busy = Object.values(db.operations).some(op => op.operationId !== exceptOperationId && isGuideJourney(op) && op.identity?.subjectRef === subject &&
    (op.status === "pending" && Date.parse(op.expiresAt) > Date.now() || !!op.delegation?.userTxDigest && op.delegation.status !== "failed" || !!op.agent?.txDigest))
  return busy ? "guide_save_in_progress" : null
}

/** Called ONLY inside the already independently verified redemption transaction. */
export function commitGuideCollection(db: Db, op: OperationRecord, outbox: OutboxRecord) {
  if (!isGuideJourney(op)) throw invalid()
  const subject = op.identity?.subjectRef, f = op.fulfillment, p = op.presentation
  const redemption = subject && db.redemptions[`${subject}::${op.campaignId}`]
  if (!subject || db.sessions[op.sessionId]?.subjectRef !== subject || op.identity?.mode !== "cx" || op.identity.personVerified !== true ||
    op.credential?.mode !== "opendid" || !op.credential.holderAckAt || p?.decision !== "allow" || !p.decisionConsumedAt ||
    !op.agent?.txDigest || op.agent.status !== "executed" || !op.agent.verified?.effectsOk || !op.agent.verified.eventOk || op.agent.verified.grantUses !== 1 ||
    f?.status !== "redeemed" || !f.redemptionRef || !f.redeemedAt || !redemption || redemption.operationId !== op.operationId ||
    redemption.redemptionRef !== f.redemptionRef || outbox.operationId !== op.operationId || db.outbox[outbox.outboxId] !== outbox) throw invalid()
  const key = guideCollectionKey(subject)
  db.guideCollection ??= {}
  const existing = db.guideCollection[key]
  if (existing) {
    if (existing.operationId !== op.operationId || existing.redemptionRef !== f.redemptionRef || existing.outboxId !== outbox.outboxId) throw invalid()
    return existing
  }
  return db.guideCollection[key] = { guideId: GUIDE_SAVE_V2.guideId, venueId: op.venueId, campaignId: op.campaignId, operationId: op.operationId,
    savedAt: f.redeemedAt, subjectRef: subject, redemptionRef: f.redemptionRef, outboxId: outbox.outboxId,
    chain: { target: storedOmnioneTarget(outbox.target), status: outbox.status, txHash: outbox.txHash, confirmedAt: outbox.confirmedAt } }
}

export function guideCollectionForSession(db: Db, sessionId: string): GuideCollectionEntry[] {
  const subject = db.sessions[sessionId]?.subjectRef
  if (!subject) return []
  const row = db.guideCollection?.[guideCollectionKey(subject)]
  if (!row) return []
  if (row.subjectRef !== subject) throw invalid()
  return [{ guideId: row.guideId, venueId: row.venueId, campaignId: row.campaignId, operationId: row.operationId,
    savedAt: row.savedAt, chain: { target: storedOmnioneTarget(row.chain.target), status: row.chain.status, txHash: row.chain.txHash, confirmedAt: row.chain.confirmedAt } }]
}

/** Chain delay never removes a saved guide, and confirmation requires receipt evidence. */
export function mirrorGuideCollection(db: Db, outbox: OutboxRecord) {
  for (const row of Object.values(db.guideCollection ?? {})) {
    if (row.outboxId !== outbox.outboxId || row.operationId !== outbox.operationId) continue
    if (!sameOmnioneTarget(row.chain.target, outbox.target)) throw invalid()
    const confirmed = outbox.status === "confirmed" && outbox.receiptEvidenceVersion === 1 && !!outbox.txHash && !!outbox.confirmedAt
    row.chain = { target: storedOmnioneTarget(outbox.target), status: outbox.status === "confirmed" && !confirmed ? "unknown" : outbox.status, txHash: outbox.txHash, confirmedAt: confirmed ? outbox.confirmedAt : null }
  }
}

export function assertGuideCollectionStore(value: unknown): asserts value is Record<string, GuideCollectionRecord> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid()
  for (const [key, raw] of Object.entries(value)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw invalid()
    const r = raw as GuideCollectionRecord
    if (Object.keys(raw).some(k => !["guideId", "venueId", "campaignId", "operationId", "savedAt", "chain", "subjectRef", "redemptionRef", "outboxId"].includes(k)) ||
      typeof r.subjectRef !== "string" || !r.subjectRef || r.subjectRef.length > 256 || key !== guideCollectionKey(r.subjectRef) || r.guideId !== GUIDE_SAVE_V2.guideId || r.venueId !== GUIDE_SAVE_V2.venueId || r.campaignId !== GUIDE_SAVE_V2.campaignId ||
      !/^op_[A-Za-z0-9_-]+$/.test(r.operationId) || !/^rdm_[A-Za-z0-9_-]+$/.test(r.redemptionRef) || !/^obx_[A-Za-z0-9_-]+$/.test(r.outboxId) || !Number.isFinite(Date.parse(r.savedAt)) ||
      !r.chain || Object.keys(r.chain).some(k => !["status", "txHash", "confirmedAt", "target"].includes(k)) || !["pending", "submitted", "confirmed", "failed", "unknown"].includes(r.chain.status) ||
      (r.chain.txHash !== null && !/^0x[0-9a-fA-F]{64}$/.test(r.chain.txHash)) ||
      (r.chain.confirmedAt !== null && (typeof r.chain.confirmedAt !== "string" || !Number.isFinite(Date.parse(r.chain.confirmedAt)))) ||
      (r.chain.status !== "confirmed" && r.chain.confirmedAt !== null) ||
      (r.chain.status === "confirmed" && (!r.chain.txHash || !r.chain.confirmedAt))) throw invalid()
    try { storedOmnioneTarget(r.chain.target) } catch { throw invalid() }
  }
}

/** Ordinary writes cannot delete or reassign a completed service result. */
export function assertGuideCollectionMonotonic(previous: Record<string, GuideCollectionRecord> | undefined, db: Db) {
  assertGuideCollectionStore(db.guideCollection ?? {})
  for (const [key, row] of Object.entries(previous ?? {})) {
    const next = db.guideCollection?.[key]
    if (!next || ["guideId", "venueId", "campaignId", "operationId", "savedAt", "subjectRef", "redemptionRef", "outboxId"].some(k =>
      next[k as keyof GuideCollectionRecord] !== row[k as keyof GuideCollectionRecord])) throw invalid()
    if (!sameOmnioneTarget(next.chain.target, row.chain.target)) throw invalid()
  }
}
