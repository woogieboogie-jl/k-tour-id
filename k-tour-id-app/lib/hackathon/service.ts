// Journey state machine for one demo entitlement operation.
// Order: consent → identity(CX) → issuance(OpenDID) → presentation(VP) → proposal(AI)
//        → delegation(user PTB) → agent(consume PTB) → fulfillment(server redeem)
//        → chain(OmniOne outbox) → done. Every step re-validates server state; a
//        client can never advance a phase by asserting success.
import { verifyPersonalMessageSignature } from "@mysten/sui/verify"
import { toBase64 } from "@mysten/sui/utils"
import { hkConfig, HK_CONSENT_VERSION, HK_SCHEMA_VERSION, HK_SERVICE_ACCESS, HK_TTL } from "./config"
import { withStore, readStore, redemptionKey, type OperationRecord, type OutboxRecord } from "./store"
import { canonicalJson, digestOf, isPast, nowIso, plusMs, randomHex32, randomId, sha256Hex, HkError, assert } from "./util"
import type { AllowedAction, NextAction, OperationResult, ProposalOutput } from "./types"
import { cxComplete, cxStart } from "./adapters/cx"
import { issueCredential, presentationPayload, verifyHolderSignature, verifyIssuerSignature, type KPassVc } from "./adapters/opendid"
import { proposePerk } from "./adapters/ai"
import { agentConsume, buildDelegationPtb, executeDelegation, issueEntitlement, readGrant, readTransaction, suiClient, suiKeys, suiTargets, explorerTx, explorerObject } from "./adapters/sui"
import { getRedemption, omnioneConfigured, receiptStatus, submitRedemption } from "./adapters/omnione"

/** Sui GraphQL endpoint for the configured network (used only as a zkLogin verification cross-check). */
function zkLoginGraphqlUrl(): string | null {
  const explicit = process.env.HK_SUI_GRAPHQL_URL
  if (explicit) return explicit
  const n = hkConfig().sui.network
  return n === "testnet" || n === "mainnet" || n === "devnet" ? `https://graphql.${n}.sui.io/graphql` : null
}

// ── result projection ─────────────────────────────────────────────────
export function toResult(op: OperationRecord): OperationResult {
  const { secrets: _s, audit: _a, sessionId: _id, ...rest } = op
  const { allowedActions, safeNextAction } = allowed(op)
  return { ...rest, allowedActions, safeNextAction }
}

function allowed(op: OperationRecord): { allowedActions: AllowedAction[]; safeNextAction: NextAction } {
  if (op.status === "cancelled" || op.status === "expired" || op.status === "failed" || op.phase === "done") return { allowedActions: ["return"], safeNextAction: "return" }
  switch (op.phase) {
    case "identity": return op.identity?.handoff ? { allowedActions: ["complete_handoff", "cancel", "check_status"], safeNextAction: "check_status" } : { allowedActions: ["open_handoff", "cancel"], safeNextAction: "wait" }
    case "issuance": return op.credential ? { allowedActions: ["ack_holder", "cancel"], safeNextAction: "wait" } : { allowedActions: ["issue", "cancel"], safeNextAction: "wait" }
    case "presentation": return { allowedActions: ["present", "cancel", "check_status"], safeNextAction: "wait" }
    case "proposal": return { allowedActions: ["propose", "cancel"], safeNextAction: "wait" }
    case "delegation": return op.delegation?.status === "awaiting_signature" ? { allowedActions: ["sign_delegation", "cancel", "check_status"], safeNextAction: "wait" } : { allowedActions: ["approve", "cancel"], safeNextAction: "wait" }
    case "agent": return { allowedActions: ["run_agent", "check_status", "reconcile"], safeNextAction: "check_status" }
    case "fulfillment": return op.fulfillment?.status === "blocked" ? { allowedActions: ["check_status", "return"], safeNextAction: "return" } : { allowedActions: ["redeem", "check_status", "reconcile"], safeNextAction: "check_status" }
    default: return { allowedActions: ["check_status"], safeNextAction: "check_status" }
  }
}

function touch(op: OperationRecord, event: string, detail?: Record<string, unknown>) {
  op.revision += 1
  op.updatedAt = nowIso()
  op.audit.push({ at: op.updatedAt, event, detail })
}
function fail(op: OperationRecord, code: string, message: string, retryable = false) {
  op.error = { code, message, retryable }
  if (!retryable) { op.status = "failed"; op.phase = "failed" }
  touch(op, "error", { code, message })
}

export async function loadOperation(sessionId: string, operationId: string): Promise<OperationRecord> {
  const op = await readStore((db) => db.operations[operationId])
  if (!op || op.sessionId !== sessionId) throw new HkError("not_found", "operation not found", 404)
  return op
}

async function mutate<T>(sessionId: string, operationId: string, fn: (op: OperationRecord, db: Parameters<Parameters<typeof withStore>[0]>[0]) => Promise<T> | T): Promise<T> {
  return withStore(async (db) => {
    const op = db.operations[operationId]
    if (!op || op.sessionId !== sessionId) throw new HkError("not_found", "operation not found", 404)
    expireIfNeeded(op)
    return fn(op, db)
  })
}

function expireIfNeeded(op: OperationRecord) {
  if (op.status === "pending" && isPast(op.expiresAt) && op.phase !== "fulfillment" && op.phase !== "done") {
    op.status = "expired"; op.phase = "expired"; touch(op, "expired")
  }
}

// ── create ────────────────────────────────────────────────────────────
export async function createOperation(input: { sessionId: string; venueId: string; consentVersion: string; locale: "ko" | "en" | "ja"; venueName: string }) {
  const c = hkConfig().campaign
  assert(input.venueId === c.venueId, "venue_unsupported", "this place has no demo entitlement", 404)
  assert(input.consentVersion === HK_CONSENT_VERSION, "consent_version", "consent version mismatch")
  assert(!isPast(c.endsAt), "campaign_closed", "campaign ended", 409)
  return withStore((db) => {
    // one live operation per session+campaign; reuse instead of duplicating
    const live = Object.values(db.operations).find((o) => o.sessionId === input.sessionId && o.campaignId === c.campaignId && o.status === "pending")
    if (live) { expireIfNeeded(live); if (live.status === "pending") return toResult(live) }
    const now = nowIso()
    const consentDigest = digestOf({ version: input.consentVersion, campaignId: c.campaignId, venueId: input.venueId, purpose: c.purpose, policyVersion: c.policyVersion })
    const op: OperationRecord = {
      operationId: randomId("op"), kind: "demo_entitlement", venueId: input.venueId, campaignId: c.campaignId, policyVersion: c.policyVersion,
      status: "pending", phase: "identity", revision: 1, createdAt: now, updatedAt: now, expiresAt: plusMs(HK_TTL.operationMs),
      execution: hkConfig().cx.mode === "cx" && hkConfig().opendid.mode === "opendid" ? "provider" : "sample",
      safeNextAction: "wait", allowedActions: [], returnContext: { venueId: input.venueId, focus: "offer" },
      consent: { version: input.consentVersion, digest: consentDigest, acceptedAt: now },
      identity: null, credential: null, presentation: null, proposal: null, delegation: null, agent: null, fulfillment: null, chain: null, error: null,
      sessionId: input.sessionId, secrets: { proposalPromptDigest: undefined }, audit: [{ at: now, event: "created", detail: { locale: input.locale, venueName: input.venueName } }],
    }
    db.operations[op.operationId] = op
    return toResult(op)
  })
}

// ── identity (CX) ─────────────────────────────────────────────────────
export async function identityStart(sessionId: string, operationId: string, mobile: boolean) {
  const op = await loadOperation(sessionId, operationId)
  assert(op.status === "pending" && op.phase === "identity", "phase", "identity not in progress", 409)
  const started = await cxStart({ operationId, mobile })
  return mutate(sessionId, operationId, (o) => {
    o.identity = { evidenceId: "", subjectRef: "", source: "cx_mobile_id", mode: hkConfig().cx.mode, provider: hkConfig().cx.provider, personVerified: false, adultVerified: null, verifiedAt: "", expiresAt: started.handoff.expiresAt, providerTransactionRef: started.txId ?? "", handoff: started.handoff }
    o.secrets.cxToken = started.token; o.secrets.cxTxId = started.txId; o.secrets.cxCxId = started.cxId
    touch(o, "identity.handoff", { kind: started.handoff.kind })
    return toResult(o)
  })
}

export async function identityComplete(sessionId: string, operationId: string, sample?: { outcome: "verified" | "cancelled" | "failed" | "expired"; subjectSeed: string }) {
  const op = await loadOperation(sessionId, operationId)
  assert(op.status === "pending" && op.phase === "identity" && op.identity?.handoff, "phase", "no identity handoff", 409)
  if (isPast(op.identity.handoff.expiresAt)) return mutate(sessionId, operationId, (o) => { o.identity = null; touch(o, "identity.expired"); return toResult(o) })
  const result = await cxComplete({ operationId, token: op.secrets.cxToken, txId: op.secrets.cxTxId, cxId: op.secrets.cxCxId, mobile: op.identity.handoff.kind === "app", sample })
  return mutate(sessionId, operationId, (o, db) => {
    if ("pending" in result) { touch(o, "identity.pending"); return toResult(o) }
    if ("failed" in result) {
      o.identity = null
      touch(o, "identity.failed", { reason: result.failed })
      if (result.failed === "cancelled") { o.error = { code: "identity_cancelled", message: "user cancelled mobile id check", retryable: true } }
      else o.error = { code: `identity_${result.failed}`, message: `mobile id check ${result.failed}`, retryable: true }
      return toResult(o)
    }
    // uniqueness pre-check: one redemption per subject+campaign
    const already = db.redemptions[redemptionKey(result.evidence.subjectRef, o.campaignId)]
    o.identity = { ...result.evidence, handoff: null }
    o.secrets.cxToken = undefined; o.secrets.cxTxId = undefined; o.secrets.cxCxId = undefined
    db.sessions[sessionId].subjectRef = result.evidence.subjectRef
    if (already) {
      o.fulfillment = { status: "blocked", reason: "already_redeemed", redemptionRef: already.redemptionRef, redeemedAt: already.redeemedAt, recheck: null }
      o.phase = "fulfillment"; o.status = "succeeded"
      touch(o, "identity.verified.already_redeemed", { redemptionRef: already.redemptionRef })
      return toResult(o)
    }
    o.phase = "issuance"; o.error = null
    touch(o, "identity.verified", { mode: result.evidence.mode })
    return toResult(o)
  })
}

// ── issuance (OpenDID) ────────────────────────────────────────────────
export async function credentialIssue(sessionId: string, operationId: string, holder: { publicKeyPem: string; alg: "Ed25519" | "ECDSA-P256" }) {
  const op = await loadOperation(sessionId, operationId)
  assert(op.status === "pending" && op.phase === "issuance" && op.identity?.personVerified, "phase", "identity required", 409)
  assert(!isPast(op.identity.expiresAt), "evidence_expired", "identity evidence expired", 409)
  assert(/BEGIN PUBLIC KEY/.test(holder.publicKeyPem) && holder.publicKeyPem.length < 1200, "holder_key", "holder public key must be SPKI PEM")
  if (op.credential) return toResult(op)
  const issued = await issueCredential({ operationId, subjectRef: op.identity.subjectRef, holderPublicKeyPem: holder.publicKeyPem, holderKeyAlg: holder.alg, evidenceId: op.identity.evidenceId })
  return mutate(sessionId, operationId, (o) => {
    o.credential = issued.summary
    o.secrets.vcDocument = issued.document; o.secrets.holderPublicKeyPem = holder.publicKeyPem; o.secrets.holderKeyAlg = holder.alg
    touch(o, "credential.issued", { mode: issued.summary.mode, vcId: issued.summary.vcId })
    return { result: toResult(o), vc: issued.document, offer: issued.offer ?? null }
  })
}

export async function credentialHolderAck(sessionId: string, operationId: string, ack: { signatureB64: string }) {
  const op = await loadOperation(sessionId, operationId)
  assert(op.status === "pending" && op.phase === "issuance" && op.credential && op.secrets.holderPublicKeyPem && op.secrets.holderKeyAlg, "phase", "credential not issued", 409)
  const payload = canonicalJson({ typ: "ondo-kpass-holder-ack/v1", credentialRef: op.credential.credentialRef, vcId: op.credential.vcId, holderBinding: op.credential.holderBinding })
  const ok = verifyHolderSignature({ alg: op.secrets.holderKeyAlg, publicKeyPem: op.secrets.holderPublicKeyPem, payload, signatureB64: ack.signatureB64 })
  assert(ok, "holder_ack_invalid", "holder acknowledgement signature invalid", 400)
  return mutate(sessionId, operationId, (o) => {
    o.credential!.holderAckAt = nowIso()
    o.phase = "presentation"
    touch(o, "credential.holder_ack")
    return toResult(o)
  })
}

// ── presentation (VP) ─────────────────────────────────────────────────
export async function presentationRequest(sessionId: string, operationId: string) {
  return mutate(sessionId, operationId, (o, db) => {
    assert(o.status === "pending" && o.phase === "presentation" && o.credential?.holderAckAt, "phase", "holder ack required", 409)
    if (o.presentation && !o.presentation.submittedAt && !isPast(o.presentation.expiresAt)) return { result: toResult(o), challenge: o.secrets.presentationChallenge }
    const nonce = randomHex32()
    const presentationId = randomId("pres")
    const requestedClaims = ["schemaVersion", "personVerified", "serviceAccess", "validUntil", "policyVersion", "statusRef"]
    const request = { presentationId, nonce, audience: "ondo-hackathon-verifier", purpose: HK_SERVICE_ACCESS, venueId: o.venueId, campaignId: o.campaignId, requestedClaims, expiresAt: plusMs(HK_TTL.presentationRequestMs) }
    o.presentation = { presentationId, nonce, requestDigest: digestOf(request), requestedClaims, expiresAt: request.expiresAt, submittedAt: null, verifiedAt: null, decision: null, decisionRef: null, decisionExpiresAt: null, decisionConsumedAt: null, denyReason: null }
    o.secrets.presentationChallenge = canonicalJson(request)
    db.nonces[nonce] = { operationId, consumedAt: null, createdAt: nowIso() }
    touch(o, "presentation.requested", { presentationId })
    return { result: toResult(o), challenge: o.secrets.presentationChallenge }
  })
}

export async function presentationSubmit(sessionId: string, operationId: string, submission: { presentationId: string; disclosed: Record<string, unknown>; signatureB64: string }) {
  return mutate(sessionId, operationId, (o, db) => {
    assert(o.status === "pending" && o.phase === "presentation" && o.presentation && o.credential, "phase", "presentation not requested", 409)
    const p = o.presentation
    if (p.submittedAt && p.decision) return toResult(o) // idempotent re-submit → same decision
    assert(p.presentationId === submission.presentationId, "presentation_mismatch", "presentation id mismatch", 409)
    const nonceRow = db.nonces[p.nonce]
    assert(nonceRow && nonceRow.operationId === operationId && !nonceRow.consumedAt, "nonce", "nonce unknown or consumed", 409)
    const deny = (reason: string) => { p.submittedAt = nowIso(); p.decision = "deny"; p.denyReason = reason; nonceRow.consumedAt = nowIso(); touch(o, "presentation.denied", { reason }); return toResult(o) }
    if (isPast(p.expiresAt)) { p.decision = "expired"; p.submittedAt = nowIso(); nonceRow.consumedAt = nowIso(); touch(o, "presentation.expired"); return toResult(o) }
    const vc = o.secrets.vcDocument as KPassVc | null
    if (o.credential.mode === "mock") {
      if (!vc || !verifyIssuerSignature(vc)) return deny("issuer_signature")
      if (isPast(vc.expirationDate)) return deny("credential_expired")
      if (o.credential.status !== "active") return deny("credential_status")
      if (vc.credentialSubject.holderBinding !== o.credential.holderBinding) return deny("holder_binding")
      if (!vc.credentialSubject.serviceAccess.includes(HK_SERVICE_ACCESS)) return deny("service_access")
      // disclosed claims must be a subset copied from the VC (no forged values)
      for (const key of Object.keys(submission.disclosed)) {
        if (!p.requestedClaims.includes(key)) return deny("claim_not_requested")
        if (canonicalJson(submission.disclosed[key]) !== canonicalJson((vc.credentialSubject as Record<string, unknown>)[key])) return deny("claim_mismatch")
      }
      const vcDigest = digestOf(vc)
      const payload = presentationPayload({ presentationId: p.presentationId, nonce: p.nonce, audience: "ondo-hackathon-verifier", purpose: HK_SERVICE_ACCESS, venueId: o.venueId, campaignId: o.campaignId, vcDigest, disclosed: submission.disclosed })
      const ok = verifyHolderSignature({ alg: o.secrets.holderKeyAlg!, publicKeyPem: o.secrets.holderPublicKeyPem!, payload, signatureB64: submission.signatureB64 })
      if (!ok) return deny("holder_signature")
    } else {
      // opendid mode: decision comes from the verifier poll (verifierConfirm) — the
      // presentation endpoint accepts a submission marker only after that poll succeeded.
      if (!submission.disclosed.__verifierConfirmed) return deny("verifier_pending")
    }
    p.submittedAt = nowIso(); p.verifiedAt = p.submittedAt; nonceRow.consumedAt = p.submittedAt
    p.decision = "allow"; p.decisionRef = randomId("dec"); p.decisionExpiresAt = plusMs(HK_TTL.decisionMs)
    o.phase = "proposal"
    touch(o, "presentation.verified", { decisionRef: p.decisionRef })
    return toResult(o)
  })
}

export async function presentationDeny(sessionId: string, operationId: string) {
  return mutate(sessionId, operationId, (o, db) => {
    assert(o.status === "pending" && o.phase === "presentation" && o.presentation, "phase", "presentation not requested", 409)
    const p = o.presentation
    if (db.nonces[p.nonce]) db.nonces[p.nonce].consumedAt = nowIso()
    p.submittedAt = nowIso(); p.decision = "deny"; p.denyReason = "holder_declined"
    o.status = "cancelled"; o.phase = "cancelled"
    touch(o, "presentation.holder_declined")
    return toResult(o)
  })
}

// ── proposal (AI) ─────────────────────────────────────────────────────
export async function proposalCreate(sessionId: string, operationId: string, ctx: { locale: "ko" | "en" | "ja"; venueName: string; category: string; district: string }) {
  const op = await loadOperation(sessionId, operationId)
  assert(op.status === "pending" && op.phase === "proposal" && op.presentation?.decision === "allow", "phase", "allow decision required", 409)
  assert(!isPast(op.presentation.decisionExpiresAt), "decision_expired", "decision expired; present again", 409)
  if (op.proposal) return toResult(op)
  const hour = new Date().getUTCHours() + 9
  const timeOfDay = hour % 24 < 11 ? "morning" : hour % 24 < 17 ? "afternoon" : "evening"
  const proposal = await proposePerk({ venueId: op.venueId, campaignId: op.campaignId, venueName: ctx.venueName, category: ctx.category, district: ctx.district, language: ctx.locale, timeOfDay, policyVersion: op.policyVersion })
  return mutate(sessionId, operationId, (o) => {
    o.proposal = proposal
    o.phase = "delegation"
    touch(o, "proposal.created", { mode: proposal.mode, model: proposal.model, guard: proposal.guard })
    return toResult(o)
  })
}

// ── delegation (Sui, user PTB) ────────────────────────────────────────
export async function delegationPrepare(sessionId: string, operationId: string, input: { userAddress: string; signer: "zklogin" | "demo"; walletProof: { message: string; signature: string }; approvedProposalDigest: string }) {
  const op = await loadOperation(sessionId, operationId)
  assert(op.status === "pending" && op.phase === "delegation" && op.proposal && op.presentation?.decision === "allow", "phase", "proposal approval required", 409)
  assert(op.proposal.proposalDigest === input.approvedProposalDigest, "proposal_digest", "approved proposal does not match", 409)
  assert(/^0x[0-9a-f]{64}$/i.test(input.userAddress), "address", "bad sui address")
  // wallet ownership proof: personal message bound to this operation
  const expectedMsg = `ondo-hk-wallet-proof:${operationId}:${op.presentation.decisionRef}`
  assert(input.walletProof.message === expectedMsg, "wallet_proof", "wallet proof message mismatch")
  try {
    await verifyPersonalMessageSignature(new TextEncoder().encode(expectedMsg), input.walletProof.signature, { address: input.userAddress, client: suiClient() })
  } catch (e) {
    let detail = e instanceof Error ? e.message : "unknown"
    let accepted = false
    if (input.signer === "zklogin") {
      // The fullnode gRPC SignatureVerificationService has been observed to pick the wrong
      // zkLogin verifying key on Testnet (MystenLabs/sui gRPC vs JSON-RPC/GraphQL mismatch).
      // Re-verify through GraphQL, which validators' path agrees with, before rejecting.
      const gqlUrl = zkLoginGraphqlUrl()
      if (gqlUrl) {
        try {
          const res = await fetch(gqlUrl, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(15_000), body: JSON.stringify({
            // GraphQL RPC 2.x schema: verifySignature(message, signature, intentScope, author) { success }
            query: "query($b:Base64!,$s:Base64!,$a:SuiAddress!){ verifySignature(message:$b, signature:$s, intentScope:PERSONAL_MESSAGE, author:$a){ success } }",
            variables: { b: toBase64(new TextEncoder().encode(expectedMsg)), s: input.walletProof.signature, a: input.userAddress },
          }) })
          const j = (await res.json()) as { data?: { verifySignature?: { success: boolean } }; errors?: Array<{ message: string }> }
          const v = j.data?.verifySignature
          if (v?.success === true) accepted = true
          else detail += ` · graphql: ${v ? `success=${String(v.success)}` : (j.errors ?? []).map((x) => x.message).join("; ")}`.slice(0, 400)
        } catch (e2) { detail += ` · graphql: ${e2 instanceof Error ? e2.message.slice(0, 200) : "?"}` }
      }
      if (!accepted) {
        try {
          const r = await suiClient().core.verifyZkLoginSignature({ bytes: toBase64(new TextEncoder().encode(expectedMsg)), signature: input.walletProof.signature, intentScope: "PersonalMessage", address: input.userAddress })
          detail += ` · grpc: success=${String(r.success)}${r.errors.length ? " " + r.errors.join("; ").slice(0, 300) : ""}`
        } catch (e2) { detail += ` · grpc: ${e2 instanceof Error ? e2.message.slice(0, 300) : "?"}` }
      }
    }
    if (!accepted) throw new HkError("wallet_proof", `wallet proof invalid: ${detail}`, 400)
  }
  if (op.delegation?.status === "awaiting_signature" && op.secrets.lastTxBytesB64 && op.delegation.userAddress === input.userAddress) {
    return { result: toResult(op), txBytesB64: op.secrets.lastTxBytesB64 }
  }
  const intentRef = randomHex32()
  const expiresAtMs = Date.now() + HK_TTL.grantExecutionMs
  const actionCommitment = digestOf({ action: op.proposal.output.action, target: op.proposal.output.target, proposalDigest: op.proposal.proposalDigest, decisionRef: op.presentation.decisionRef, policyVersion: op.policyVersion })
  const consentCommitment = digestOf({ consentDigest: op.consent!.digest, proposalDigest: op.proposal.proposalDigest, userAddress: input.userAddress, recipient: input.userAddress, expiresAtMs, maxUses: 1 })
  const issued = await issueEntitlement({ intentRefHex: intentRef, holder: input.userAddress, expiresAtMs: expiresAtMs + 60_000 })
  const ptb = await buildDelegationPtb({ userAddress: input.userAddress, entitlement: issued.entitlement, recipient: input.userAddress, actionCommitmentHex: actionCommitment, consentCommitmentHex: consentCommitment, expiresAtMs })
  return mutate(sessionId, operationId, (o) => {
    o.delegation = { delegationId: randomId("dlg"), status: "awaiting_signature", intentRef, actionCommitment, consentCommitment, userAddress: input.userAddress, signer: input.signer, recipient: input.userAddress, expiresAtMs, entitlement: { ...issued.entitlement, txDigest: issued.txDigest }, grant: null, txBytesDigest: ptb.txBytesDigest, userTxDigest: null, error: null }
    o.secrets.lastTxBytesB64 = ptb.txBytesB64
    ;(o.secrets as Record<string, unknown>).sponsorSignature = ptb.sponsorSignature
    touch(o, "delegation.prepared", { intentRef, entitlement: issued.entitlement.objectId, issueTx: issued.txDigest })
    return { result: toResult(o), txBytesB64: ptb.txBytesB64 }
  })
}

export async function delegationSubmit(sessionId: string, operationId: string, input: { txBytesDigest: string; userSignature: string }) {
  const op = await loadOperation(sessionId, operationId)
  assert(op.status === "pending" && op.phase === "delegation" && op.delegation?.status === "awaiting_signature" && op.secrets.lastTxBytesB64, "phase", "no delegation awaiting signature", 409)
  assert(op.delegation.txBytesDigest === input.txBytesDigest, "tx_mismatch", "transaction bytes changed", 409)
  assert(op.delegation.expiresAtMs > Date.now(), "grant_window_expired", "delegation window expired", 409)
  const sponsorSignature = String((op.secrets as Record<string, unknown>).sponsorSignature ?? "")
  let executed: Awaited<ReturnType<typeof executeDelegation>> | null = null
  let error: HkError | null = null
  try {
    executed = await executeDelegation({ txBytesB64: op.secrets.lastTxBytesB64, userSignature: input.userSignature, sponsorSignature, expectedGrantOwner: op.delegation.userAddress })
  } catch (e) { error = e instanceof HkError ? e : new HkError("sui_delegate", e instanceof Error ? e.message : "unknown", 502, true) }
  return mutate(sessionId, operationId, (o) => {
    if (!executed) {
      o.delegation!.status = error?.retryable ? "unknown" : "failed"; o.delegation!.error = error?.message ?? "unknown"
      o.error = { code: error?.code ?? "sui_delegate", message: error?.message ?? "unknown", retryable: Boolean(error?.retryable) }
      touch(o, "delegation.failed", { code: error?.code })
      return toResult(o)
    }
    o.delegation!.status = "delegated"; o.delegation!.grant = { ...executed.grant, txDigest: executed.txDigest }; o.delegation!.userTxDigest = executed.txDigest
    o.secrets.lastTxBytesB64 = undefined; delete (o.secrets as Record<string, unknown>).sponsorSignature
    o.phase = "agent"; o.error = null
    touch(o, "delegation.executed", { grant: executed.grant.objectId, tx: executed.txDigest })
    return toResult(o)
  })
}

// ── agent (Sui, consume PTB) ──────────────────────────────────────────
export async function agentRun(sessionId: string, operationId: string) {
  const op = await loadOperation(sessionId, operationId)
  assert(op.status === "pending" && op.phase === "agent" && op.delegation?.grant && op.proposal, "phase", "delegation required", 409)
  if (op.agent?.status === "executed") return toResult(op)
  const grantState = await readGrant(op.delegation.grant.objectId)
  if (grantState.uses > 0) {
    // consumed earlier (retry after unknown): find our record via the tx history is not possible without indexer; mark unknown→reconcile
    return mutate(sessionId, operationId, (o) => { o.agent = o.agent ?? { dispatchId: randomId("agt"), status: "unknown", decisionCommitment: "", manifestCommitment: "", manifest: null, txDigest: null, recordId: null, verified: null, error: "grant already consumed; reconcile" }; touch(o, "agent.grant_already_consumed"); return toResult(o) })
  }
  assert(!grantState.revoked, "grant_revoked", "grant revoked", 409)
  assert(grantState.expiresAtMs > Date.now(), "grant_expired", "grant expired", 409)
  const k = suiKeys()
  assert(grantState.agent.toLowerCase() === k.agentAddress.toLowerCase(), "agent_mismatch", "grant names a different agent", 409)
  // de-identified execution manifest (provenance): links inputs → proposal → consent → grant → decision
  const manifest = {
    schema: "ondo-agent-manifest/v1", operationRef: sha256Hex(operationId), campaignId: op.campaignId, venueId: op.venueId, policyVersion: op.policyVersion,
    proposal: { proposalId: op.proposal.proposalId, model: op.proposal.model, promptVersion: op.proposal.promptVersion, inputDigest: op.proposal.inputDigest, outputDigest: op.proposal.outputDigest, proposalDigest: op.proposal.proposalDigest },
    consentCommitment: op.delegation.consentCommitment, actionCommitment: op.delegation.actionCommitment, intentRef: op.delegation.intentRef,
    grant: op.delegation.grant.objectId, agent: k.agentAddress, tool: "redeem_demo_entitlement", decidedAt: nowIso(),
  }
  const decisionCommitment = digestOf({ action: op.proposal.output.action, target: op.proposal.output.target, grant: op.delegation.grant.objectId, actionCommitment: op.delegation.actionCommitment })
  const manifestCommitment = digestOf(manifest)
  let executed: Awaited<ReturnType<typeof agentConsume>> | null = null
  let error: HkError | null = null
  try {
    executed = await agentConsume({ grant: op.delegation.grant, decisionCommitmentHex: decisionCommitment, manifestCommitmentHex: manifestCommitment, expectedRecipient: op.delegation.recipient, expectedIntentRefHex: op.delegation.intentRef })
  } catch (e) { error = e instanceof HkError ? e : new HkError("sui_consume", e instanceof Error ? e.message : "unknown", 502, true) }
  const after = executed ? await readGrant(op.delegation.grant.objectId) : null
  return mutate(sessionId, operationId, (o) => {
    const dispatchId = o.agent?.dispatchId ?? randomId("agt")
    if (!executed) {
      o.agent = { dispatchId, status: error?.retryable ? "unknown" : "failed", decisionCommitment, manifestCommitment, manifest, txDigest: null, recordId: null, verified: null, error: error?.message ?? "unknown" }
      o.error = { code: error?.code ?? "sui_consume", message: error?.message ?? "unknown", retryable: Boolean(error?.retryable) }
      touch(o, "agent.failed", { code: error?.code })
      return toResult(o)
    }
    o.agent = { dispatchId, status: "executed", decisionCommitment, manifestCommitment, manifest, txDigest: executed.txDigest, recordId: executed.recordId, verified: { effectsOk: true, eventOk: true, grantUses: after?.uses ?? null, checkedAt: nowIso() }, error: null }
    o.phase = "fulfillment"; o.error = null
    o.fulfillment = { status: "pending", reason: "authorization_consumed", redemptionRef: null, redeemedAt: null, recheck: null }
    touch(o, "agent.executed", { tx: executed.txDigest, record: executed.recordId })
    return toResult(o)
  })
}

// ── fulfillment (server redeem) + OmniOne outbox ──────────────────────
export async function redeem(sessionId: string, operationId: string, input: { idempotencyKey: string; bodyDigest: string }) {
  const op = await loadOperation(sessionId, operationId)
  assert(op.status === "pending" && op.phase === "fulfillment" && op.agent?.status === "executed" && op.agent.txDigest, "phase", "verified Sui execution required", 409)
  // independent re-verification of the Sui execution before committing service state
  const suiTx = await readTransaction(op.agent.txDigest)
  const grant = op.delegation?.grant ? await readGrant(op.delegation.grant.objectId) : null
  const t = suiTargets()
  const suiOk = Boolean(suiTx?.success && suiTx.events.some((e) => e.type === t.events.consumed) && grant && grant.uses === 1)
  const outboxRecord = await mutate(sessionId, operationId, (o, db) => {
    const idem = db.idempotency[`${operationId}:redeem:${input.idempotencyKey}`]
    if (idem) { assert(idem.bodyDigest === input.bodyDigest, "idempotency_conflict", "same key, different body", 409); return null }
    const f = o.fulfillment!
    const recheck = {
      credential: !o.credential || isPast(o.credential.validUntil) ? "expired" : o.credential.status,
      presentation: !o.presentation?.decisionRef ? "missing" : o.presentation.decisionConsumedAt ? "consumed" : isPast(o.presentation.decisionExpiresAt) ? "expired_decision_ok_after_sui" : "allow",
      sui: suiOk ? "verified" : "unverified",
      campaign: isPast(hkConfig().campaign.endsAt) ? "closed" : "open",
    }
    f.recheck = recheck
    const subject = o.identity?.subjectRef ?? ""
    const key = redemptionKey(subject, o.campaignId)
    const block = (reason: string) => { f.status = "blocked"; f.reason = reason; o.status = "succeeded"; touch(o, "fulfillment.blocked", { reason, recheck }); return null }
    if (!suiOk) return block("sui_unverified")
    if (recheck.credential !== "active") return block("credential_" + recheck.credential)
    if (recheck.presentation === "consumed") return block("decision_consumed")
    if (recheck.campaign !== "open") return block("campaign_closed")
    if (db.redemptions[key]) return block("already_redeemed")
    // commit: decisionRef consumed + redemption + outbox in one store transaction
    o.presentation!.decisionConsumedAt = nowIso()
    const redemptionRef = randomId("rdm")
    db.redemptions[key] = { redemptionRef, subjectRef: subject, campaignId: o.campaignId, operationId, redeemedAt: nowIso() }
    f.status = "redeemed"; f.reason = null; f.redemptionRef = redemptionRef; f.redeemedAt = db.redemptions[key].redeemedAt
    const eventKey = randomHex32()
    const payload = { kind: "DemoEntitlementRedeemed", schemaVersion: HK_SCHEMA_VERSION, campaignRef: o.campaignId, policyVersion: o.policyVersion, salt: randomHex32(), suiDigestCommitment: sha256Hex(o.agent!.txDigest!), manifestCommitment: o.agent!.manifestCommitment }
    const outbox: OutboxRecord = { outboxId: randomId("obx"), operationId, eventKey, payloadCommitment: digestOf(payload), payload, status: "pending", txHash: null, blockNumber: null, attempts: 0, lastError: null, createdAt: nowIso(), updatedAt: nowIso(), confirmedAt: null }
    db.outbox[outbox.outboxId] = outbox
    o.chain = { outboxId: outbox.outboxId, eventKey, payloadCommitment: outbox.payloadCommitment, status: "pending", txHash: null, blockNumber: null, attempts: 0, lastError: null, confirmedAt: null }
    o.status = "succeeded"; o.phase = "done"
    db.idempotency[`${operationId}:redeem:${input.idempotencyKey}`] = { key: input.idempotencyKey, bodyDigest: input.bodyDigest, responseDigest: digestOf({ redemptionRef }), createdAt: nowIso() }
    touch(o, "fulfillment.redeemed", { redemptionRef, outboxId: outbox.outboxId })
    return outbox
  })
  if (outboxRecord) await processOutbox(outboxRecord.outboxId).catch(() => undefined)
  return toResult(await loadOperation(sessionId, operationId))
}

/** OmniOne outbox worker step: submit if pending, confirm if submitted. Safe to re-run. */
export async function processOutbox(outboxId: string) {
  const row = await readStore((db) => db.outbox[outboxId])
  if (!row || row.status === "confirmed" || row.status === "failed") return row
  if (!omnioneConfigured()) { await withStore((db) => { const r = db.outbox[outboxId]; r.lastError = "omnione_unconfigured"; r.updatedAt = nowIso(); mirror(db, r) }); return row }
  try {
    if (row.status === "pending" || row.status === "unknown") {
      // recover by eventKey first (never resend blindly)
      const existing = await getRedemption(row.eventKey)
      if (existing.exists) {
        const matches = existing.payloadCommitment.toLowerCase() === row.payloadCommitment.toLowerCase()
        await withStore((db) => { const r = db.outbox[outboxId]; r.status = matches ? "confirmed" : "failed"; r.lastError = matches ? null : "duplicate_eventKey_payload_mismatch"; r.confirmedAt = matches ? nowIso() : null; r.updatedAt = nowIso(); mirror(db, r) })
        return await readStore((db) => db.outbox[outboxId])
      }
      const submitted = await submitRedemption({ eventKeyHex: row.eventKey, payloadCommitmentHex: row.payloadCommitment })
      await withStore((db) => { const r = db.outbox[outboxId]; r.attempts += 1; r.txHash = submitted.txHash; r.status = submitted.txHash ? "submitted" : "unknown"; r.updatedAt = nowIso(); mirror(db, r) })
    }
    const after = await readStore((db) => db.outbox[outboxId])
    if (after.status === "submitted" && after.txHash) {
      const rc = await receiptStatus(after.txHash)
      if (rc.status === "confirmed") {
        const onchain = await getRedemption(after.eventKey)
        const matches = onchain.exists && onchain.payloadCommitment.toLowerCase() === after.payloadCommitment.toLowerCase()
        await withStore((db) => { const r = db.outbox[outboxId]; r.status = matches ? "confirmed" : "failed"; r.blockNumber = rc.blockNumber; r.confirmedAt = matches ? nowIso() : null; r.lastError = matches ? null : "receipt_ok_but_registry_mismatch"; r.updatedAt = nowIso(); mirror(db, r) })
      } else if (rc.status === "failed") {
        await withStore((db) => { const r = db.outbox[outboxId]; r.status = "failed"; r.blockNumber = rc.blockNumber; r.lastError = "receipt_status_0"; r.updatedAt = nowIso(); mirror(db, r) })
      }
    }
  } catch (e) {
    await withStore((db) => { const r = db.outbox[outboxId]; r.attempts += 1; r.status = r.txHash ? "submitted" : "unknown"; r.lastError = e instanceof Error ? e.message.slice(0, 200) : "unknown"; r.updatedAt = nowIso(); mirror(db, r) })
  }
  return await readStore((db) => db.outbox[outboxId])
}
function mirror(db: Parameters<Parameters<typeof withStore>[0]>[0], r: OutboxRecord) {
  const o = db.operations[r.operationId]
  if (!o?.chain) return
  o.chain = { outboxId: r.outboxId, eventKey: r.eventKey, payloadCommitment: r.payloadCommitment, status: r.status, txHash: r.txHash, blockNumber: r.blockNumber, attempts: r.attempts, lastError: r.lastError, confirmedAt: r.confirmedAt }
  touch(o, "chain." + r.status)
}

// ── cancel / reconcile / evidence ─────────────────────────────────────
export async function cancel(sessionId: string, operationId: string) {
  return mutate(sessionId, operationId, (o, db) => {
    if (o.status !== "pending") return toResult(o)
    assert(o.phase !== "agent" && o.phase !== "fulfillment", "cannot_cancel", "execution already started; use reconcile", 409)
    if (o.presentation?.nonce && db.nonces[o.presentation.nonce]) db.nonces[o.presentation.nonce].consumedAt = nowIso()
    o.status = "cancelled"; o.phase = "cancelled"
    touch(o, "cancelled", { at_phase: o.phase })
    return toResult(o)
  })
}

export async function reconcile(sessionId: string, operationId: string) {
  const op = await loadOperation(sessionId, operationId)
  if (op.chain?.outboxId) await processOutbox(op.chain.outboxId)
  if (op.agent?.status === "unknown" && op.delegation?.grant) {
    const g = await readGrant(op.delegation.grant.objectId).catch(() => null)
    if (g && g.uses === 1) await mutate(sessionId, operationId, (o) => { o.agent!.status = "executed"; o.agent!.verified = { effectsOk: true, eventOk: false, grantUses: 1, checkedAt: nowIso() }; o.phase = "fulfillment"; o.fulfillment = o.fulfillment ?? { status: "pending", reason: "authorization_consumed", redemptionRef: null, redeemedAt: null, recheck: null }; touch(o, "agent.reconciled") })
  }
  if (op.delegation?.status === "unknown" && op.delegation.userTxDigest) {
    const tx = await readTransaction(op.delegation.userTxDigest).catch(() => null)
    if (tx?.success) await mutate(sessionId, operationId, (o) => { o.delegation!.status = "delegated"; o.phase = "agent"; touch(o, "delegation.reconciled") })
  }
  return toResult(await loadOperation(sessionId, operationId))
}

export function evidence(op: OperationRecord) {
  const cfg = hkConfig()
  return {
    operationId: op.operationId, status: op.status, phase: op.phase,
    identity: op.identity ? { mode: op.identity.mode, provider: op.identity.provider, evidenceId: op.identity.evidenceId, verifiedAt: op.identity.verifiedAt, providerTransactionRef: op.identity.mode === "mock" ? "SIMULATION" : "provider-held", subjectRef: "server-held (not disclosed)" } : null,
    credential: op.credential ? { mode: op.credential.mode, schema: op.credential.schema, vcId: op.credential.vcId, issuerDid: op.credential.issuerDid, holderBinding: op.credential.holderBinding, status: op.credential.status, validUntil: op.credential.validUntil, holderAckAt: op.credential.holderAckAt } : null,
    presentation: op.presentation ? { presentationId: op.presentation.presentationId, requestDigest: op.presentation.requestDigest, decision: op.presentation.decision, verifiedAt: op.presentation.verifiedAt, decisionConsumedAt: op.presentation.decisionConsumedAt } : null,
    proposal: op.proposal ? { mode: op.proposal.mode, model: op.proposal.model, promptVersion: op.proposal.promptVersion, inputDigest: op.proposal.inputDigest, outputDigest: op.proposal.outputDigest, proposalDigest: op.proposal.proposalDigest, guard: op.proposal.guard } : null,
    sui: op.delegation ? {
      network: cfg.sui.network, packageId: cfg.sui.packageId, campaignId: cfg.sui.campaignId, signer: op.delegation.signer,
      intentRef: op.delegation.intentRef, actionCommitment: op.delegation.actionCommitment, consentCommitment: op.delegation.consentCommitment,
      entitlement: op.delegation.entitlement ? { objectId: op.delegation.entitlement.objectId, issueTx: op.delegation.entitlement.txDigest, url: explorerTx(op.delegation.entitlement.txDigest) } : null,
      grant: op.delegation.grant ? { objectId: op.delegation.grant.objectId, tx: op.delegation.grant.txDigest, url: explorerObject(op.delegation.grant.objectId), txUrl: explorerTx(op.delegation.grant.txDigest) } : null,
      agent: op.agent ? { status: op.agent.status, tx: op.agent.txDigest, txUrl: op.agent.txDigest ? explorerTx(op.agent.txDigest) : null, recordId: op.agent.recordId, recordUrl: op.agent.recordId ? explorerObject(op.agent.recordId) : null, decisionCommitment: op.agent.decisionCommitment, manifestCommitment: op.agent.manifestCommitment, manifest: op.agent.manifest, verified: op.agent.verified } : null,
    } : null,
    fulfillment: op.fulfillment,
    omnione: op.chain ? { chainId: cfg.omnione.chainId, registry: cfg.omnione.registryAddress, eventKey: op.chain.eventKey, payloadCommitment: op.chain.payloadCommitment, status: op.chain.status, txHash: op.chain.txHash, blockNumber: op.chain.blockNumber, confirmedAt: op.chain.confirmedAt, lastError: op.chain.lastError } : null,
    provenanceCheck: op.agent?.manifest ? { recomputedManifestCommitment: digestOf(op.agent.manifest), storedManifestCommitment: op.agent.manifestCommitment, matches: digestOf(op.agent.manifest) === op.agent.manifestCommitment } : null,
    boundaries: {
      note: "Sui consume ≠ benefit used. DB redemption is the ledger; OmniOne is the audit anchor; neither chain carries PII.",
      mock: { cx: cfg.cx.mode === "mock", opendid: cfg.opendid.mode === "mock" },
    },
  }
}

export function validateProposalOutput(o: unknown): o is ProposalOutput { return Boolean(o && typeof o === "object" && (o as ProposalOutput).action === "redeem_demo_entitlement") }
