// Shared synthetic harness; never live provider or cryptographic success.
import assert from "node:assert/strict"
import { test } from "node:test"
import { sha256Hex } from "../../../lib/hackathon/util"
import { originalProvider, originalPolicy, withStore, service, resolveOpenDidCxSubject, create, identity, provider, proposed, prepare, delegated, executed, redeem, owned, hasCode, reset, id, iso, OWNER, counters, control, network, transactions, omni, refresh, pause } from "./guide-main-harness.fixture"

test("production V2 remains unavailable: no invented CX mapping or policy flag", async () => {
  assert.equal(originalProvider.providerIntegrationAvailable(), false)
  await assert.rejects(Promise.resolve().then(() => originalPolicy.assertGuideReady()), hasCode("guide_setup_required"))
  const f = await create(); await identity(f); const op = await owned(f.sessionId, f.operationId)
  assert.equal(originalProvider.providerCredentialReason(op), "opendid_policy_unsupported")
  assert.equal(op.identity!.mode, "cx")
  await assert.rejects(resolveOpenDidCxSubject({ ...op.identity!, source: "cx_mobile_id", mode: "cx", evidenceRef: op.identity!.evidenceId }), hasCode("opendid_cx_mapping_unavailable"))
  await service.cancel(f.sessionId, f.operationId)
})

test("synthetic full flow binds actual CX, proposed V2 VP, user approval, Sui evidence, collection and Omni receipt", async () => {
  reset(); const before = { ...counters }, f = await executed(), result = await redeem(f)
  assert.equal(result.status, "succeeded"); assert.equal(result.phase, "done"); assert.equal(result.chain?.status, "confirmed")
  assert.equal(result.chain?.blockNumber, 123); assert.equal(result.agent?.verified?.grantUses, 1)
  assert.equal(counters.issue - before.issue, 1); assert.equal(counters.delegate - before.delegate, 1); assert.equal(counters.agent - before.agent, 1); assert.equal(counters.omni - before.omni, 1)
  assert.ok(counters.status - before.status >= 5); assert.ok(counters.executionRead - before.executionRead >= 2)
  const collection = await service.guideCollection(f.sessionId)
  assert.equal(collection.items.length, 1); assert.equal(collection.items[0].chain.status, "confirmed")
  assert.equal(collection.pendingOperation, null)
  const publicResult = JSON.stringify(result)
  for (const secret of ["synthetic-ci-", "request-token-", "urn:fixture:", "fixture-issuance:", "kycRef", "ownerBinding", "openDidProvider"]) assert.ok(!publicResult.includes(secret), `${secret} leaked`)
  const finalCounts = { ...counters }; control.revoked = true
  assert.equal((await redeem(f)).fulfillment?.redemptionRef, result.fulfillment?.redemptionRef)
  assert.deepEqual(counters, finalCounts, "committed retry must not contact any provider")
  await assert.rejects(service.redeem(f.sessionId, f.operationId, { idempotencyKey: "fixture-redemption", bodyDigest: id("different") }), hasCode("idempotency_conflict"))
  reset()
})

test("same-session create is reused; another session's operation is inaccessible", async () => {
  reset(); const f = await create(); assert.equal((await create(f.sessionId)).operationId, f.operationId)
  await assert.rejects(service.loadOperation("session_other_fixture", f.operationId), hasCode("not_found"))
})

test("CX duplicate-subject lock prevents a second guide before any chain spend", async () => {
  reset(); control.ci = "synthetic-same-person"; const first = await create(); await identity(first)
  const second = await create(), before = counters.issue
  const blocked = await identity(second)
  assert.equal(blocked.status, "failed"); assert.equal(blocked.error?.code, "guide_save_in_progress")
  assert.equal(counters.issue, before); reset()
})

test("provider guide cannot enter the legacy sample credential path", async () => {
  reset(); const f = await create(); await identity(f)
  await assert.rejects(service.credentialIssue(f.sessionId, f.operationId, { publicKeyPem: "not-a-key", alg: "Ed25519" }), hasCode("opendid_provider_required"))
})

test("unapproved AI action never enables delegation or chain issuance", async () => {
  reset(); const f = await create(); await identity(f); await provider(f); control.badAi = true
  const before = counters.issue
  await assert.rejects(service.proposalCreate(f.sessionId, f.operationId, { locale: "ja", venueName: "ロバ", category: "食堂", district: "ソウル" }), hasCode("guide_ai_unavailable"))
  assert.equal((await owned(f.sessionId, f.operationId)).phase, "proposal"); assert.equal(counters.issue, before); reset()
})

test("revoked credential is refreshed and blocks chain issue, not cached allow", async () => {
  reset(); const f = await proposed(), before = counters.issue; control.revoked = true
  await assert.rejects(prepare(f), hasCode("opendid_status_required")); assert.equal(counters.issue, before); reset()
})

test("prepared delegation retry reuses exact bytes and never remints entitlement", async () => {
  reset(); const f = await proposed(), before = counters.issue, first = await prepare(f), second = await prepare(f)
  assert.equal(first.txBytesB64, second.txBytesB64); assert.equal(counters.issue - before, 1)
})

test("forged proposal, wrong signer and invalid wallet signature cannot authorize issuance", async () => {
  reset(); const f = await proposed(), op = await owned(f.sessionId, f.operationId), before = counters.issue
  const message = `ondo-hk-wallet-proof:${f.operationId}:${op.presentation!.decisionRef}`
  const valid = { userAddress: OWNER, signer: "zklogin" as const, approvedProposalDigest: op.proposal!.proposalDigest, walletProof: { message, signature: `fixture-zk:${sha256Hex(new TextEncoder().encode(message))}` } }
  await assert.rejects(service.delegationPrepare(f.sessionId, f.operationId, { ...valid, approvedProposalDigest: id("unapproved") }), hasCode("proposal_digest"))
  await assert.rejects(service.delegationPrepare(f.sessionId, f.operationId, { ...valid, signer: "demo" }), hasCode("zklogin_required"))
  await assert.rejects(service.delegationPrepare(f.sessionId, f.operationId, { ...valid, walletProof: { message, signature: "fixture-zk:forged" } }), hasCode("wallet_proof"))
  assert.equal(counters.issue, before)
})

test("changed transaction bytes cannot reach delegation broadcast", async () => {
  reset(); const f = await proposed(); await prepare(f); const before = counters.delegate
  await assert.rejects(service.delegationSubmit(f.sessionId, f.operationId, { txBytesDigest: id("replaced bytes"), userSignature: "fixture-user-approved" }), hasCode("tx_mismatch"))
  assert.equal(counters.delegate, before)
})

test("expired decision cannot issue even with a newly active status response", async () => {
  reset(); const f = await proposed(), before = counters.issue
  await withStore(db => { const op = db.operations[f.operationId]; op.secrets.openDidProvider!.presentation!.decision!.decisionExpiresAt = iso(-1); op.presentation!.decisionExpiresAt = iso(-1) })
  await assert.rejects(prepare(f), hasCode("opendid_permission_expired")); assert.equal(counters.issue, before)
})

test("concurrent preparation claims permit only one issuer attempt", async () => {
  reset(); const f = await proposed(), before = counters.issue
  const results = await Promise.allSettled([prepare(f), prepare(f)])
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1)
  assert.equal(counters.issue - before, 1)
})

test("unknown issuance is not retried or reminted", async () => {
  reset(); const f = await proposed(); control.issueFailure = true; const before = counters.issue
  await assert.rejects(prepare(f)); await assert.rejects(prepare(f)); assert.equal(counters.issue - before, 1); reset()
})

test("cancellation while issue transport is pending wins before broadcast", async () => {
  reset(); const f = await proposed(); let release!: () => void, entered!: () => void
  const started = new Promise<void>(r => { entered = r }), wait = new Promise<void>(r => { release = r })
  pause.issue = async () => { entered(); await wait }
  const pending = prepare(f); await started; await service.cancel(f.sessionId, f.operationId); release()
  await assert.rejects(pending); assert.equal((await owned(f.sessionId, f.operationId)).status, "cancelled"); reset()
})

test("provider revocation during issuer preparation prevents the pending broadcast", async () => {
  reset(); const f = await proposed(); let release!: () => void, entered!: () => void
  const started = new Promise<void>(r => { entered = r }), wait = new Promise<void>(r => { release = r })
  pause.issue = async () => { entered(); await wait }
  const pending = prepare(f); await started; control.revoked = true
  await assert.rejects(refresh(f.sessionId, f.operationId), hasCode("opendid_status_required")); release()
  await assert.rejects(pending)
  assert.equal((await owned(f.sessionId, f.operationId)).secrets.delegationPreparation?.issueTxDigest, null)
  reset()
})

test("unknown user delegation resolves from exact evidence without repeat submission", async () => {
  reset(); const f = await proposed(), p = await prepare(f); control.loseDelegateResponse = true; const before = counters.delegate
  const result = await service.delegationSubmit(f.sessionId, f.operationId, { txBytesDigest: p.result.delegation!.txBytesDigest!, userSignature: "fixture-user-approved" })
  assert.equal(result.delegation?.status, "unknown")
  await assert.rejects(service.cancel(f.sessionId, f.operationId), hasCode("cannot_cancel"))
  const recovered = await service.reconcile(f.sessionId, f.operationId); assert.equal(recovered.phase, "agent"); assert.equal(counters.delegate - before, 1); reset()
})

test("unknown agent execution is check-only; exact receipt recovers then service commits once", async () => {
  reset(); const f = await delegated(); control.loseAgentResponse = true; const before = counters.agent
  assert.equal((await service.agentRun(f.sessionId, f.operationId)).agent?.status, "unknown")
  assert.equal((await service.agentRun(f.sessionId, f.operationId)).agent?.status, "unknown")
  assert.equal((await service.reconcile(f.sessionId, f.operationId)).phase, "fulfillment")
  assert.equal((await redeem(f)).status, "succeeded"); assert.equal(counters.agent - before, 1); reset()
})

test("tampered execution event cannot commit the saved guide or Omni outbox", async () => {
  reset(); const f = await executed(), op = await owned(f.sessionId, f.operationId), tx = transactions.get(op.agent!.txDigest!)!
  ;(tx.events[0].json as Record<string, unknown>).recipient = id("foreign recipient")
  const before = counters.omni; await assert.rejects(redeem(f), hasCode("sui_evidence_mismatch"))
  assert.equal((await service.guideCollection(f.sessionId)).items.length, 0); assert.equal(counters.omni, before)
})

test("pending Omni receipt keeps guide saved; reconciliation confirms without rebroadcast", async () => {
  reset(); const f = await executed(); control.omniPending = true; const before = counters.omni
  const saved = await redeem(f); assert.equal(saved.status, "succeeded"); assert.equal(saved.chain?.status, "submitted")
  assert.equal((await service.guideCollection(f.sessionId)).items[0].chain.status, "submitted")
  control.omniPending = false; const recovered = await service.reconcile(f.sessionId, f.operationId)
  assert.equal(recovered.chain?.status, "confirmed"); assert.equal(counters.omni - before, 1)
})

test("concurrent Omni recovery workers confirm one existing submission only", async () => {
  reset(); const f = await executed(); control.omniPending = true; const before = counters.omni
  const saved = await redeem(f); control.omniPending = false
  await Promise.all([service.processOutbox(saved.chain!.outboxId), service.processOutbox(saved.chain!.outboxId)])
  const latest = await service.loadOperation(f.sessionId, f.operationId)
  assert.equal(latest.chain?.status, "confirmed"); assert.equal(counters.omni - before, 1)
})

test("unknown Omni submission without a digest remains check-only, never a retry", async () => {
  reset(); const f = await executed(); control.omniPending = true; const saved = await redeem(f)
  await withStore(db => { const row = db.outbox[saved.chain!.outboxId]; row.txHash = null; row.status = "unknown" })
  omni.delete(saved.chain!.txHash!); const before = counters.omni
  await service.processOutbox(saved.chain!.outboxId)
  assert.equal((await service.loadOperation(f.sessionId, f.operationId)).chain?.status, "unknown"); assert.equal(counters.omni, before); reset()
})

test("saved guide is visible only to the verified subject and blocks a second saved result", async () => {
  reset(); control.ci = "synthetic-already-saved-person"; const f = await executed(); await redeem(f)
  assert.equal((await service.guideCollection("unrelated_fixture_session")).items.length, 0)
  await assert.rejects(create(f.sessionId), hasCode("guide_already_saved"))
  const second = await create(); const result = await identity(second)
  assert.equal(result.error?.code, "guide_already_saved"); assert.equal((await service.guideCollection(second.sessionId)).items.length, 1); reset()
})

test("Omni response lost after persisted hash is recovered check-only", async () => {
  reset(); const f = await executed(); control.loseOmniResponse = true; const before = counters.omni
  const saved = await redeem(f); assert.equal(saved.status, "succeeded"); assert.ok(saved.chain?.txHash)
  control.loseOmniResponse = false; const recovered = await service.reconcile(f.sessionId, f.operationId)
  assert.equal(recovered.chain?.status, "confirmed"); assert.equal(counters.omni - before, 1)
})

test("mismatched Omni event never produces a confirmed collection badge", async () => {
  reset(); const f = await executed(); control.omniMismatch = true; const saved = await redeem(f)
  assert.equal(saved.status, "succeeded"); assert.equal(saved.chain?.status, "failed")
  assert.equal((await service.guideCollection(f.sessionId)).items[0].chain.status, "failed"); reset()
})

test("fixture transport allowlist saw no real provider request", () => {
  assert.ok(network.length > 0)
  for (const target of network) assert.ok(target.startsWith("https://cx.fixture.invalid/") || target.startsWith("https://bridge.fixture.invalid/") || target.startsWith("https://generativelanguage.googleapis.com/v1beta/models/") || target === "https://graphql.testnet.sui.io/graphql")
})
