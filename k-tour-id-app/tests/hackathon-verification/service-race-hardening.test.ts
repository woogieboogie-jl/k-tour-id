// Local-only orchestration regression. Run with --experimental-test-module-mocks.
// Real credential/VP gates, synthetic AI/chain adapters, and a disposable file ledger.
import assert from "node:assert/strict"
import { after, before, beforeEach, mock, test } from "node:test"
import { generateKeyPairSync, sign } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import http from "node:http"
import https from "node:https"
import { hkConfig, HK_CONSENT_VERSION, HK_SERVICE_ACCESS } from "../../lib/hackathon/config"
import { canonicalJson, digestOf, HkError, isPast, nowIso, plusMs, randomId } from "../../lib/hackathon/util"
import { readStore, withStore, type OutboxRecord } from "../../lib/hackathon/store"
import { presentationPayload, type KPassVc } from "../../lib/hackathon/adapters/opendid"
import type { ProposalInput } from "../../lib/hackathon/adapters/ai"
import type { GrantEvidence } from "../../lib/hackathon/sui-evidence"
import { credentialEligibility } from "../../lib/hackathon/operation-evidence"

const dataDir = mkdtempSync(join(tmpdir(), "ktour-service-races-"))
const fixtureEnv = {
  HK_ISOLATED_MOCK: "0", NEXT_PUBLIC_HK_PREVIEW_READ_ONLY: "0", NEXT_PUBLIC_HK_CX_PREVIEW: "0",
  HK_MODE_CX: "mock", HK_CX_PROVIDER: "comdl", HK_MODE_OPENDID: "mock", HK_AI_MODE: "rule", HK_DATA_DIR: dataDir,
  HK_ISSUER_SIGNING_SEED: "service-race-fixture-only-seed", HK_CAMPAIGN_ENDS_AT: "2099-01-01T00:00:00.000Z",
  HK_SUI_NETWORK: "testnet", HK_SUI_GRAPHQL_URL: "https://graphql.invalid",
  UPSTASH_REDIS_REST_URL: "", UPSTASH_REDIS_REST_TOKEN: "", KV_REST_API_URL: "", KV_REST_API_TOKEN: "",
  HK_STORE_CANARY_UUID: "", HK_STORE_CANARY_OWNER: "",
}
const oldEnv = Object.fromEntries(Object.keys(fixtureEnv).map(key => [key, process.env[key]]))
const oldFetch = globalThis.fetch
const sensitive = "https://rpc.invalid/?token=FIXTURE_PRIVATE_SENTINEL signed=FIXTURE_SIGNED_BYTES"
const address = "0x" + "1".repeat(64), agent = "0x" + "2".repeat(64), campaign = "0x" + "3".repeat(64)
const grantId = "0x" + "4".repeat(64), txHash = "0x" + "5".repeat(64)
const grantType = "fixture::entitlement::Grant"
let networkAttempts = 0, proposalCalls = 0, verifyCalls = 0, crossCheckCalls = 0
let proposePause: (() => Promise<void>) | undefined
let executionError: unknown = new Error(sensitive)
let grant: (GrantEvidence & { uses: number; revoked: boolean; expiresAtMs: number }) | undefined
let signatureScheme = "ED25519"
let outboxFailure = false
let delegationBroadcastProbe: ((callback: (digest: string) => Promise<void>) => Promise<void>) | undefined

const forbidden = () => { networkAttempts++; throw new Error("External network forbidden in service hardening fixtures") }
mock.module(new URL("../../lib/hackathon/adapters/ai.ts", import.meta.url).href, { namedExports: {
  proposePerk: async (input: ProposalInput) => {
    proposalCalls++
    await proposePause?.()
    const output = { action: HK_SERVICE_ACCESS, target: { venueId: input.venueId, campaignId: input.campaignId }, title: "Fixture perk", summary: "Synthetic non-financial perk", rationale: "Fixture", language: input.language }
    const basis = { proposalId: randomId("prop"), inputDigest: digestOf(input), outputDigest: digestOf(output), promptVersion: "fixture-v1", policyVersion: input.policyVersion, model: "rule-v1" }
    return { ...basis, mode: "rule", output, proposalDigest: digestOf(basis), createdAt: nowIso(), guard: { injectionSuspected: false, schemaValid: true } }
  },
} })
mock.module("@mysten/sui/verify", { namedExports: {
  verifyPersonalMessageSignature: async () => { verifyCalls++; throw new Error(sensitive) },
} })
mock.module("@mysten/sui/cryptography", { namedExports: {
  parseSerializedSignature: () => ({ signatureScheme }),
} })
mock.module(new URL("../../lib/hackathon/adapters/sui.ts", import.meta.url).href, { namedExports: {
  agentConsume: async () => { throw executionError },
  executeDelegation: async ({ beforeBroadcast }: { beforeBroadcast: (digest: string) => Promise<void> }) => { await delegationBroadcastProbe?.(beforeBroadcast); throw executionError },
  readGrant: async () => { assert.ok(grant); return grant },
  transactionDigest: () => "fixture-sui-digest",
  suiClient: () => ({ core: { verifyZkLoginSignature: async () => { crossCheckCalls++; return { success: false, errors: [sensitive] } } } }),
  suiKeys: () => ({ agentAddress: agent }),
  suiTargets: () => ({ campaign: { objectId: campaign }, types: { grant: grantType }, events: { granted: "fixture::Granted", consent: "fixture::Consent", consumed: "fixture::Consumed", attested: "fixture::Attested" } }),
  buildDelegationPtb: forbidden, issueEntitlement: forbidden, verifyReadExecution: forbidden, verifyReadDelegation: forbidden,
  explorerTx: () => "fixture", explorerObject: () => "fixture",
} })
mock.module(new URL("../../lib/hackathon/adapters/omnione.ts", import.meta.url).href, { namedExports: {
  omnioneConfigured: () => outboxFailure,
  getRedemption: async () => { throw new HkError("omnione_evidence_unavailable", sensitive, 503, true) },
  receiptStatus: forbidden, submitRedemption: forbidden,
} })
const service = await import("../../lib/hackathon/service")

before(() => {
  Object.assign(process.env, fixtureEnv)
  globalThis.fetch = async () => forbidden()
  mock.method(http, "request", forbidden); mock.method(https, "request", forbidden)
})
beforeEach(() => {
  proposePause = undefined; proposalCalls = 0; verifyCalls = 0; crossCheckCalls = 0
  executionError = new Error(sensitive); signatureScheme = "ED25519"; grant = undefined; outboxFailure = false
  delegationBroadcastProbe = undefined
  globalThis.fetch = async () => forbidden()
})
after(() => {
  assert.equal(networkAttempts, 0)
  assert.doesNotMatch(readFileSync(join(dataDir, "journey.json"), "utf8"), /FIXTURE_PRIVATE_SENTINEL|FIXTURE_SIGNED_BYTES|rpc\.invalid/)
  globalThis.fetch = oldFetch
  for (const [key, value] of Object.entries(oldEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
  mock.restoreAll()
  rmSync(dataDir, { recursive: true, force: true })
})
const code = (...expected: string[]) => (error: unknown) => error instanceof HkError && expected.includes(error.code)
function gate() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve }); return { promise, release } }
const stored = (id: string) => readStore(db => db.operations[id])
const context = { locale: "en" as const, venueName: "Fixture venue", category: "cafe", district: "fixture" }

async function issued() {
  const sessionId = randomId("ses")
  await withStore(db => { db.sessions[sessionId] = { sessionId, createdAt: nowIso(), lastSeenAt: nowIso(), subjectRef: null } })
  const op = await service.createOperation({ sessionId, venueId: hkConfig().campaign.venueId, consentVersion: HK_CONSENT_VERSION, ...context })
  const operationId = op.operationId
  await service.identityStart(sessionId, operationId, false)
  await service.identityComplete(sessionId, operationId, { outcome: "verified", subjectSeed: operationId })
  const holder = generateKeyPairSync("ed25519")
  const result = await service.credentialIssue(sessionId, operationId, { publicKeyPem: holder.publicKey.export({ format: "pem", type: "spki" }).toString(), alg: "Ed25519" })
  const credential = result.result.credential!
  const signatureB64 = sign(null, Buffer.from(canonicalJson({ typ: "ondo-kpass-holder-ack/v1", credentialRef: credential.credentialRef, vcId: credential.vcId, holderBinding: credential.holderBinding })), holder.privateKey).toString("base64url")
  return { sessionId, operationId, holder, vc: result.vc as KPassVc, signatureB64 }
}
async function proposalReady() {
  const f = await issued()
  await service.credentialHolderAck(f.sessionId, f.operationId, { signatureB64: f.signatureB64 })
  const requested = await service.presentationRequest(f.sessionId, f.operationId), p = requested.result.presentation!
  const disclosed = Object.fromEntries(p.requestedClaims.map(key => [key, (f.vc.credentialSubject as Record<string, unknown>)[key]]))
  const payload = presentationPayload({ presentationId: p.presentationId, nonce: p.nonce, audience: "ondo-hackathon-verifier", purpose: HK_SERVICE_ACCESS, venueId: requested.result.venueId, campaignId: requested.result.campaignId, vcDigest: digestOf(f.vc), disclosed })
  await service.presentationSubmit(f.sessionId, f.operationId, { presentationId: p.presentationId, disclosed, signatureB64: sign(null, Buffer.from(payload), f.holder.privateKey).toString("base64url") })
  return f
}
async function delegationReady(executing = false) {
  const f = await proposalReady()
  await service.proposalCreate(f.sessionId, f.operationId, context)
  await withStore(db => {
    const o = db.operations[f.operationId], p = o.proposal!, expiresAtMs = Date.now() + 60_000
    o.delegation = {
      delegationId: randomId("dlg"), status: executing ? "delegated" : "awaiting_signature", intentRef: digestOf({ operation: f.operationId }),
      actionCommitment: digestOf({ action: p.output.action, target: p.output.target, proposalDigest: p.proposalDigest, decisionRef: o.presentation!.decisionRef, policyVersion: o.policyVersion }),
      consentCommitment: digestOf({ consentDigest: o.consent!.digest, proposalDigest: p.proposalDigest, userAddress: address, recipient: address, expiresAtMs, maxUses: 1 }),
      userAddress: address, signer: "demo", recipient: address, expiresAtMs, entitlement: null,
      grant: executing ? { objectId: grantId, initialSharedVersion: "1", txDigest: "fixture-grant" } : null,
      txBytesDigest: "fixture-bytes-digest", userTxDigest: executing ? "fixture-grant" : null, error: null,
    }
    o.secrets.lastTxBytesB64 = Buffer.from("fixture-transaction-bytes").toString("base64")
    if (executing) o.phase = "agent"
    const d = o.delegation
    grant = { objectId: grantId, type: grantType, initialSharedVersion: "1", uses: 0, revoked: false, expiresAtMs,
      json: { campaign, owner: address, agent, recipient: address, intent_ref: d.intentRef, action_commitment: d.actionCommitment, expires_at_ms: expiresAtMs, policy_version: o.policyVersion, max_uses: 1, uses: 0, revoked: false } }
  })
  return f
}

test("invalid or missing deadlines and invalid clock fail closed; boundary is expired", () => {
  const now = Date.parse("2026-09-28T00:00:00.000Z")
  for (const value of [undefined, null, "", "not-a-date", "2026-99-99", "2026-09-27T23:59:59.999Z", "2026-09-28T00:00:00.000Z"]) assert.equal(isPast(value, now), true)
  assert.equal(isPast("2026-09-28T00:00:00.001Z", now), false)
  assert.equal(isPast("2099-01-01T00:00:00.000Z", NaN), true)
  assert.equal(isPast("2099-01-01T00:00:00.000Z", Infinity), true)
})

for (const change of ["cancel", "operation-expiry", "identity-expiry", "credential-expiry", "credential-revoked"] as const) {
  test(`holder acknowledgement cannot commit after queued ${change}`, async () => {
    const f = await issued(), entered = gate(), release = gate()
    const blocker = withStore(async () => { entered.release(); await release.promise })
    await entered.promise
    const earlier = change === "cancel" ? service.cancel(f.sessionId, f.operationId) : withStore(db => {
      const o = db.operations[f.operationId]
      if (change === "operation-expiry") o.expiresAt = "invalid-expiry"
      if (change === "identity-expiry") o.identity!.expiresAt = "invalid-expiry"
      if (change === "credential-expiry") o.credential!.validUntil = "invalid-expiry"
      if (change === "credential-revoked") o.credential!.status = "revoked"
    })
    const ack = service.credentialHolderAck(f.sessionId, f.operationId, { signatureB64: f.signatureB64 })
    const rejection = assert.rejects(ack, code("operation_changed", "phase", "evidence_expired", "credential_expired"))
    await new Promise<void>(resolve => setImmediate(resolve))
    release.release()
    await Promise.all([blocker, earlier, rejection])
    const o = await stored(f.operationId)
    assert.equal(o.credential!.holderAckAt, null)
    assert.equal(o.audit.filter(row => row.event === "credential.holder_ack").length, 0)
    assert.notEqual(o.phase, "presentation")
    if (change === "cancel") assert.equal(o.status, "cancelled")
  })
}

test("concurrent holder acknowledgements advance only once", async () => {
  const f = await issued()
  const results = await Promise.allSettled([service.credentialHolderAck(f.sessionId, f.operationId, f), service.credentialHolderAck(f.sessionId, f.operationId, f)])
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1)
  assert.equal((await stored(f.operationId)).audit.filter(row => row.event === "credential.holder_ack").length, 1)
})

for (const change of ["cancel", "operation-expiry", "decision-expiry", "identity-expiry", "credential-revoked", "new-revision"] as const) {
  test(`AI proposal cannot replace current state after ${change}`, async () => {
    const f = await proposalReady(), entered = gate(), release = gate()
    proposePause = async () => { entered.release(); await release.promise }
    const pending = service.proposalCreate(f.sessionId, f.operationId, context)
    const rejection = assert.rejects(pending, code("operation_changed", "phase", "decision_expired", "eligibility"))
    await entered.promise
    if (change === "cancel") await service.cancel(f.sessionId, f.operationId)
    else await withStore(db => {
      const o = db.operations[f.operationId]
      if (change === "operation-expiry") o.expiresAt = "invalid-expiry"
      if (change === "decision-expiry") o.presentation!.decisionExpiresAt = "invalid-expiry"
      if (change === "identity-expiry") o.identity!.expiresAt = "invalid-expiry"
      if (change === "credential-revoked") o.credential!.status = "revoked"
      if (change === "new-revision") o.revision++
    })
    release.release()
    await rejection
    const o = await stored(f.operationId)
    assert.equal(o.proposal, null); assert.notEqual(o.phase, "delegation")
    assert.equal(o.audit.filter(row => row.event === "proposal.created").length, 0)
    if (change === "cancel") assert.equal(o.status, "cancelled")
  })
}

test("concurrent AI responses cannot overwrite the first committed proposal", async () => {
  const f = await proposalReady(), entered = gate(), release = gate()
  let call = 0
  proposePause = async () => { if (++call === 1) { entered.release(); await release.promise } }
  const first = service.proposalCreate(f.sessionId, f.operationId, context)
  const rejection = assert.rejects(first, code("operation_changed", "phase"))
  await entered.promise
  const winner = await service.proposalCreate(f.sessionId, f.operationId, context)
  release.release(); await rejection
  const o = await stored(f.operationId)
  assert.deepEqual(o.proposal, winner.proposal)
  assert.equal(o.audit.filter(row => row.event === "proposal.created").length, 1)
  assert.equal(proposalCalls, 2)
})

test("paid AI admission persists before dispatch, allows one concurrent request, and replays saved output without another request", async () => {
  const previousMode = process.env.HK_AI_MODE, previousKey = process.env.GEMINI_API_KEY
  try {
    process.env.HK_AI_MODE = "gemini"; process.env.GEMINI_API_KEY = "offline-fixture-only"
    const f = await proposalReady(), entered = gate(), release = gate()
    proposePause = async () => { entered.release(); await release.promise }
    const first = service.proposalCreate(f.sessionId, f.operationId, context)
    await entered.promise
    const claimed = await stored(f.operationId)
    assert.equal(claimed.secrets.aiGeneration?.stage, "claimed")
    assert.ok(!service.toResult(claimed).allowedActions.includes("propose"))
    assert.equal(JSON.stringify(service.toResult(claimed)).includes("aiGeneration"), false)
    await assert.rejects(service.proposalCreate(f.sessionId, f.operationId, context), code("ai_generation_already_requested"))
    assert.equal(proposalCalls, 1)
    release.release()
    const result = await first
    assert.equal((await stored(f.operationId)).secrets.aiGeneration?.stage, "completed")
    assert.deepEqual((await service.proposalCreate(f.sessionId, f.operationId, context)).proposal, result.proposal)
    assert.equal(proposalCalls, 1)
  } finally {
    if (previousMode === undefined) delete process.env.HK_AI_MODE; else process.env.HK_AI_MODE = previousMode
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previousKey
  }
})

test("unknown paid AI result is spent even after reload and never resends", async () => {
  const previousMode = process.env.HK_AI_MODE, previousKey = process.env.GEMINI_API_KEY
  try {
    process.env.HK_AI_MODE = "gemini"; process.env.GEMINI_API_KEY = "offline-fixture-only"
    const f = await proposalReady()
    proposePause = async () => { throw new Error("fixture response lost") }
    await assert.rejects(service.proposalCreate(f.sessionId, f.operationId, context), /fixture response lost/)
    assert.equal((await stored(f.operationId)).secrets.aiGeneration?.stage, "unknown")
    assert.deepEqual(service.toResult(await service.loadOperation(f.sessionId, f.operationId)).allowedActions, ["check_status", "cancel", "return"])
    proposePause = undefined
    await assert.rejects(service.proposalCreate(f.sessionId, f.operationId, context), code("ai_generation_already_requested"))
    assert.equal(proposalCalls, 1)
    assert.equal((await stored(f.operationId)).proposal, null)
    // A worker crash before dispatch leaves the same spent claimed boundary.
    const second = await proposalReady()
    await withStore(db => { db.operations[second.operationId].secrets.aiGeneration = { claimId: "aigen_crashed", requestDigest: digestOf(context), stage: "claimed", createdAt: nowIso() } })
    await assert.rejects(service.proposalCreate(second.sessionId, second.operationId, context), code("ai_generation_already_requested"))
    assert.equal(proposalCalls, 1)
  } finally {
    if (previousMode === undefined) delete process.env.HK_AI_MODE; else process.env.HK_AI_MODE = previousMode
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previousKey
  }
})

test("late paid AI result after cancel cannot create a proposal or reopen the one-shot reservation", async () => {
  const previousMode = process.env.HK_AI_MODE, previousKey = process.env.GEMINI_API_KEY
  try {
    process.env.HK_AI_MODE = "gemini"; process.env.GEMINI_API_KEY = "offline-fixture-only"
    const f = await proposalReady(), entered = gate(), release = gate()
    proposePause = async () => { entered.release(); await release.promise }
    const first = service.proposalCreate(f.sessionId, f.operationId, context)
    const rejected = assert.rejects(first, code("operation_changed", "phase"))
    await entered.promise; await service.cancel(f.sessionId, f.operationId); release.release(); await rejected
    const op = await stored(f.operationId)
    assert.equal(op.status, "cancelled"); assert.equal(op.proposal, null)
    assert.equal(op.secrets.aiGeneration?.stage, "unknown"); assert.equal(proposalCalls, 1)
  } finally {
    if (previousMode === undefined) delete process.env.HK_AI_MODE; else process.env.HK_AI_MODE = previousMode
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previousKey
  }
})

test("invalid current credential or decision rejects before requesting an AI proposal", async () => {
  for (const kind of ["credential", "decision"] as const) {
    const f = await proposalReady()
    await withStore(db => {
      const op = db.operations[f.operationId]
      if (kind === "credential") op.credential!.status = "revoked"
      else op.presentation!.decisionExpiresAt = "invalid-expiry"
    })
    await assert.rejects(service.proposalCreate(f.sessionId, f.operationId, context), code("eligibility", "decision_expired"))
  }
  assert.equal(proposalCalls, 0)
})

for (const signer of ["demo", "zklogin"] as const) {
  test(`${signer} wallet-proof rejection never exposes SDK or fallback errors`, async () => {
    const f = await proposalReady(), proposed = await service.proposalCreate(f.sessionId, f.operationId, context)
    signatureScheme = signer === "zklogin" ? "ZkLogin" : "ED25519"
    globalThis.fetch = async input => { assert.equal(new URL(String(input)).origin, "https://graphql.invalid"); return Response.json({ errors: [{ message: sensitive }] }) }
    await assert.rejects(service.delegationPrepare(f.sessionId, f.operationId, { userAddress: address, signer, walletProof: { message: `ondo-hk-wallet-proof:${f.operationId}:${proposed.presentation!.decisionRef}`, signature: "fixture-signature" }, approvedProposalDigest: proposed.proposal!.proposalDigest }), error => {
      assert.ok(error instanceof HkError); assert.equal(error.code, "wallet_proof")
      assert.doesNotMatch(error.message, /FIXTURE_|rpc\.invalid|graphql:|grpc:/)
      return true
    })
    assert.equal(verifyCalls, 1)
    assert.equal(crossCheckCalls, signer === "zklogin" ? 1 : 0)
    assert.equal((await stored(f.operationId)).delegation, null)
  })
}

for (const action of ["delegate", "consume"] as const) for (const kind of ["transport", "failed", "typed-unknown"] as const) {
  test(`${action}: ${kind} errors are safe in the ledger and keep transaction classification`, async () => {
    const f = await delegationReady(action === "consume")
    executionError = kind === "transport" ? new Error(sensitive) : new HkError(kind === "failed" ? "sui_execute_failed" : "sui_evidence_mismatch", sensitive, 502, true)
    const result = action === "delegate" ? await service.delegationSubmit(f.sessionId, f.operationId, { txBytesDigest: "fixture-bytes-digest", userSignature: "fixture-user-signature" }) : await service.agentRun(f.sessionId, f.operationId)
    assert.equal(action === "delegate" ? result.delegation?.status : result.agent?.status, kind === "failed" ? "failed" : "unknown")
    assert.equal(result.error?.code, kind === "transport" ? action === "delegate" ? "sui_delegate" : "sui_consume" : kind === "failed" ? "sui_execute_failed" : "sui_evidence_mismatch")
    assert.doesNotMatch(JSON.stringify(result), /FIXTURE_PRIVATE_SENTINEL|FIXTURE_SIGNED_BYTES|rpc\.invalid/)
    assert.doesNotMatch(JSON.stringify(await stored(f.operationId)), /FIXTURE_PRIVATE_SENTINEL|FIXTURE_SIGNED_BYTES|rpc\.invalid/)
  })
}

test("typed OmniOne errors cannot smuggle provider secrets into outbox state", async () => {
  const f = await proposalReady(), outboxId = randomId("obx")
  outboxFailure = true
  await withStore(db => {
    const row: OutboxRecord = { outboxId, operationId: f.operationId, eventKey: txHash, payloadCommitment: digestOf({ fixture: true }), payload: {}, status: "pending", txHash: null, blockNumber: null, attempts: 0, lastError: null, createdAt: nowIso(), updatedAt: nowIso(), confirmedAt: null }
    db.outbox[outboxId] = row
    db.operations[f.operationId].chain = { ...row }
  })
  const result = await service.processOutbox(outboxId)
  assert.equal(result?.status, "pending"); assert.equal(result?.attempts, 0)
  assert.doesNotMatch(JSON.stringify(result), /FIXTURE_PRIVATE_SENTINEL|FIXTURE_SIGNED_BYTES|rpc\.invalid/)
})

test("legacy stored error strings are sanitized at result/evidence projection without mutation", async () => {
  const f = await delegationReady(true)
  const op = await stored(f.operationId)
  // Deliberately do not persist hostile history: the boundary must be safe even
  // for an existing in-memory ledger snapshot containing an old SDK message.
  op.error = { code: "sui_execute_failed", message: sensitive, retryable: false }
  op.delegation!.error = sensitive
  op.agent = { dispatchId: "fixture-agent", status: "unknown", decisionCommitment: txHash, manifestCommitment: txHash, manifest: null, txDigest: "fixture-sui-digest", recordId: null, verified: null, error: sensitive }
  op.chain = { outboxId: "fixture-outbox", eventKey: txHash, payloadCommitment: txHash, status: "submitted", txHash, blockNumber: null, attempts: 1, lastError: sensitive, confirmedAt: null }
  const before = structuredClone(op)
  const result = service.toResult(op), evidence = service.evidence(op)
  assert.doesNotMatch(JSON.stringify({ result, evidence }), /FIXTURE_PRIVATE_SENTINEL|FIXTURE_SIGNED_BYTES|rpc\.invalid/)
  assert.equal(result.error?.code, "sui_execute_failed"); assert.equal(result.error?.retryable, false)
  assert.equal(result.delegation?.status, before.delegation!.status)
  assert.equal(result.agent?.status, before.agent!.status)
  assert.equal(result.chain?.txHash, txHash)
  assert.deepEqual(op, before, "projection must not rewrite legacy evidence or transaction recovery state")
})

for (const drift of ["mode", "provider"] as const) {
  test(`persisted identity ${drift} cannot cross current policy at credential/VP/AI/Sui write boundaries`, async () => {
    const issuance = await issued()
    const challenge = await issued()
    await service.credentialHolderAck(challenge.sessionId, challenge.operationId, challenge)
    const submission = await issued()
    await service.credentialHolderAck(submission.sessionId, submission.operationId, submission)
    const requested = await service.presentationRequest(submission.sessionId, submission.operationId)
    const p = requested.result.presentation!
    const disclosed = Object.fromEntries(p.requestedClaims.map(key => [key, (submission.vc.credentialSubject as Record<string, unknown>)[key]]))
    const payload = presentationPayload({ presentationId: p.presentationId, nonce: p.nonce, audience: "ondo-hackathon-verifier", purpose: HK_SERVICE_ACCESS, venueId: requested.result.venueId, campaignId: requested.result.campaignId, vcDigest: digestOf(submission.vc), disclosed })
    const submit = { presentationId: p.presentationId, disclosed, signatureB64: sign(null, Buffer.from(payload), submission.holder.privateKey).toString("base64url") }
    const proposal = await proposalReady()
    const delegation = await delegationReady()
    const execution = await delegationReady(true)
    const fixtures = [issuance, challenge, submission, proposal, delegation, execution]
    const snapshots = await Promise.all(fixtures.map(f => stored(f.operationId)))
    const prepared = snapshots[4], beforeProposalCalls = proposalCalls
    const key = drift === "mode" ? "HK_MODE_CX" : "HK_CX_PROVIDER", prior = process.env[key]
    process.env[key] = drift === "mode" ? "cx" : "different-provider"
    try {
      const holder = { publicKeyPem: issuance.holder.publicKey.export({ format: "pem", type: "spki" }).toString(), alg: "Ed25519" as const }
      const attempts = [
        () => service.credentialIssue(issuance.sessionId, issuance.operationId, holder),
        () => service.credentialHolderAck(issuance.sessionId, issuance.operationId, issuance),
        () => service.presentationRequest(challenge.sessionId, challenge.operationId),
        () => service.presentationSubmit(submission.sessionId, submission.operationId, submit),
        () => service.proposalCreate(proposal.sessionId, proposal.operationId, context),
        () => service.delegationPrepare(delegation.sessionId, delegation.operationId, { userAddress: address, signer: "demo", walletProof: { message: `ondo-hk-wallet-proof:${delegation.operationId}:${prepared.presentation!.decisionRef}`, signature: "fixture-signature" }, approvedProposalDigest: prepared.proposal!.proposalDigest }),
        () => service.delegationSubmit(delegation.sessionId, delegation.operationId, { txBytesDigest: "fixture-bytes-digest", userSignature: "fixture-user-signature" }),
        () => service.agentRun(execution.sessionId, execution.operationId),
      ]
      for (const attempt of attempts) await assert.rejects(attempt(), code("cx_mode_changed"))
      for (let i = 0; i < fixtures.length; i++) assert.deepEqual(await stored(fixtures[i].operationId), snapshots[i])
      assert.equal(credentialEligibility(prepared), "identity_policy_changed")
      assert.equal(proposalCalls, beforeProposalCalls); assert.equal(verifyCalls, 0); assert.equal(crossCheckCalls, 0)
      const result = service.toResult(prepared)
      assert.equal(result.safeNextAction, "return")
      assert.deepEqual(result.allowedActions, ["check_status", "reconcile", "cancel", "return"])
    } finally { if (prior === undefined) delete process.env[key]; else process.env[key] = prior }
  })
}

test("policy migration preserves old evidence, safe reconciliation and cancellation without relabeling mock identity", async () => {
  const f = await issued(), op = await stored(f.operationId)
  process.env.HK_MODE_CX = "cx"
  try {
    assert.deepEqual(await service.loadOperation(f.sessionId, f.operationId), op)
    const result = await service.reconcile(f.sessionId, f.operationId)
    assert.equal(result.credential?.vcId, op.credential!.vcId)
    const evidence = service.evidence(op)
    assert.equal(evidence.identity?.mode, "mock")
    assert.deepEqual(evidence.boundaries.mock, { cx: true, opendid: true })
    assert.equal(evidence.boundaries.identityPolicyChanged, true)
    assert.deepEqual(await stored(f.operationId), op)
    assert.equal((await service.cancel(f.sessionId, f.operationId)).status, "cancelled")
  } finally { process.env.HK_MODE_CX = "mock" }
})

test("matching server-persisted CX policy still permits the existing signed sample-credential flow", async () => {
  // Synthetic ledger fixture, NOT a claim of a real provider approval.
  const f = await issued()
  await withStore(db => { db.operations[f.operationId].identity!.mode = "cx" })
  process.env.HK_MODE_CX = "cx"
  try {
    const replay = await service.credentialIssue(f.sessionId, f.operationId, { publicKeyPem: f.holder.publicKey.export({ format: "pem", type: "spki" }).toString(), alg: "Ed25519" })
    assert.equal(replay.result.identity?.mode, "cx")
    assert.equal(replay.result.credential?.mode, "mock")
    await service.credentialHolderAck(f.sessionId, f.operationId, f)
    const requested = await service.presentationRequest(f.sessionId, f.operationId), p = requested.result.presentation!
    const disclosed = Object.fromEntries(p.requestedClaims.map(key => [key, (f.vc.credentialSubject as Record<string, unknown>)[key]]))
    const payload = presentationPayload({ presentationId: p.presentationId, nonce: p.nonce, audience: "ondo-hackathon-verifier", purpose: HK_SERVICE_ACCESS, venueId: requested.result.venueId, campaignId: requested.result.campaignId, vcDigest: digestOf(f.vc), disclosed })
    await service.presentationSubmit(f.sessionId, f.operationId, { presentationId: p.presentationId, disclosed, signatureB64: sign(null, Buffer.from(payload), f.holder.privateKey).toString("base64url") })
    const proposed = await service.proposalCreate(f.sessionId, f.operationId, context)
    assert.equal(proposed.phase, "delegation")
    assert.equal(credentialEligibility(await stored(f.operationId)), null)
    assert.deepEqual(service.evidence(await stored(f.operationId)).boundaries.mock, { cx: false, opendid: true })
    assert.equal(proposalCalls, 1)
  } finally { process.env.HK_MODE_CX = "mock" }
})

for (const changed of ["policy", "digest", "unchanged"] as const) {
  test(`delegation pre-broadcast callback rechecks ${changed} without discarding the durable intent`, async () => {
    const f = await delegationReady()
    let syntheticBroadcasts = 0
    delegationBroadcastProbe = async callback => {
      if (changed === "policy") process.env.HK_MODE_CX = "cx"
      await callback(changed === "digest" ? "foreign-digest" : "fixture-sui-digest")
      syntheticBroadcasts++
    }
    try {
      const result = await service.delegationSubmit(f.sessionId, f.operationId, { txBytesDigest: "fixture-bytes-digest", userSignature: "fixture-signature" })
      assert.equal(syntheticBroadcasts, changed === "unchanged" ? 1 : 0)
      assert.equal(result.delegation?.userTxDigest, "fixture-sui-digest")
      assert.equal(result.delegation?.status, "unknown")
      assert.equal(result.error?.code, changed === "policy" ? "cx_mode_changed" : changed === "digest" ? "tx_mismatch" : "sui_delegate")
    } finally { process.env.HK_MODE_CX = "mock" }
  })
}
