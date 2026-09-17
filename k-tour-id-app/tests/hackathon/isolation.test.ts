import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { hkConfig, hkPublicConfig, HK_CONSENT_VERSION, HK_SERVICE_ACCESS } from "../../lib/hackathon/config"
import { canonicalJson, digestOf, HkError, nowIso, randomId } from "../../lib/hackathon/util"
import { readStore, redemptionKey, storeBackendKind, withStore } from "../../lib/hackathon/store"
import { issueCredential, presentationPayload, verifierConfirm, verifierRequestOffer, type KPassVc } from "../../lib/hackathon/adapters/opendid"
import * as sui from "../../lib/hackathon/adapters/sui"
import * as omnione from "../../lib/hackathon/adapters/omnione"
import { enokiConfigured, proveZkLogin, zkLoginConfigured } from "../../lib/hackathon/adapters/zklogin"
import * as service from "../../lib/hackathon/service"

// Sentinel credentials intentionally exercise inherited-environment isolation.
// No test may contact a provider, chain, Redis instance or model endpoint.
const temporaryDataDir = mkdtempSync(join(tmpdir(), "harvey-hackathon-isolation-"))
const testEnv = {
  HK_ISOLATED_MOCK: "1", HK_DATA_DIR: temporaryDataDir,
  HK_MODE_CX: "cx", HK_MODE_OPENDID: "opendid", HK_AI_MODE: "gemini", GEMINI_API_KEY: "test-sentinel",
  HK_CAMPAIGN_ENDS_AT: "2099-01-01T00:00:00.000Z",
  HK_ISSUER_SIGNING_SEED: "isolated-test-issuer-seed",
  HK_SUI_PACKAGE_ID: "test-package", HK_SUI_CAMPAIGN_ID: "test-campaign",
  HK_SUI_ISSUER_SECRET_KEY: "test-sentinel", HK_SUI_AGENT_SECRET_KEY: "test-sentinel",
  HK_SUI_SPONSOR_SECRET_KEY: "test-sentinel", HK_ZKLOGIN_SALT_SEED: "test-sentinel",
  NEXT_PUBLIC_GOOGLE_CLIENT_ID: "test-client", ENOKI_API_KEY: "test-sentinel",
  HK_OMNIONE_RPC_URL: "https://chain.invalid", HK_OMNIONE_PRIVATE_KEY: "test-sentinel",
  HK_OMNIONE_REGISTRY_ADDRESS: "test-registry", UPSTASH_REDIS_REST_URL: "https://redis.invalid",
  UPSTASH_REDIS_REST_TOKEN: "test-sentinel", KV_REST_API_URL: "https://kv.invalid", KV_REST_API_TOKEN: "test-sentinel",
}
const originalEnv = Object.fromEntries(Object.keys(testEnv).map((key) => [key, process.env[key]]))
const originalFetch = globalThis.fetch
const attemptedNetwork: string[] = []

before(() => {
  Object.assign(process.env, testEnv)
  globalThis.fetch = async (input) => {
    attemptedNetwork.push(String(input))
    throw new Error("Network is forbidden in isolated hackathon tests")
  }
})
after(() => {
  globalThis.fetch = originalFetch
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  rmSync(temporaryDataDir, { recursive: true, force: true })
  assert.deepEqual(attemptedNetwork, [], "isolated tests attempted an external request")
})

const errorCode = (code: string) => (error: unknown) => error instanceof HkError && error.code === code
const signPayload = (key: KeyObject, payload: string) => sign(null, Buffer.from(payload), key).toString("base64url")

async function newOperation() {
  const sessionId = randomId("ses", 18)
  await withStore((db) => { db.sessions[sessionId] = { sessionId, createdAt: nowIso(), lastSeenAt: nowIso(), subjectRef: null } })
  const operation = await service.createOperation({ sessionId, venueId: hkConfig().campaign.venueId, consentVersion: HK_CONSENT_VERSION, locale: "en", venueName: "Test venue" })
  return { sessionId, operationId: operation.operationId }
}

async function presentationReady() {
  const ids = await newOperation()
  await service.identityStart(ids.sessionId, ids.operationId, false)
  await service.identityComplete(ids.sessionId, ids.operationId, { outcome: "verified", subjectSeed: ids.operationId })
  const holder = generateKeyPairSync("ed25519")
  const issued = await service.credentialIssue(ids.sessionId, ids.operationId, { publicKeyPem: holder.publicKey.export({ format: "pem", type: "spki" }).toString(), alg: "Ed25519" })
  assert.ok("result" in issued)
  const credential = issued.result.credential!
  await service.credentialHolderAck(ids.sessionId, ids.operationId, { signatureB64: signPayload(holder.privateKey, canonicalJson({ typ: "ondo-kpass-holder-ack/v1", credentialRef: credential.credentialRef, vcId: credential.vcId, holderBinding: credential.holderBinding })) })
  const request = await service.presentationRequest(ids.sessionId, ids.operationId)
  const vc = issued.vc as KPassVc
  const disclosed = Object.fromEntries(request.result.presentation!.requestedClaims.map((key) => [key, (vc.credentialSubject as Record<string, unknown>)[key]]))
  const submit = (claims: Record<string, unknown> = disclosed, privateKey = holder.privateKey) => {
    const p = request.result.presentation!
    const payload = presentationPayload({ presentationId: p.presentationId, nonce: p.nonce, audience: "ondo-hackathon-verifier", purpose: HK_SERVICE_ACCESS, venueId: request.result.venueId, campaignId: request.result.campaignId, vcDigest: digestOf(vc), disclosed: claims })
    return service.presentationSubmit(ids.sessionId, ids.operationId, { presentationId: p.presentationId, disclosed: claims, signatureB64: signPayload(privateKey, payload) })
  }
  return { ...ids, holder, vc, request, disclosed, submit }
}

test("isolated mode overrides inherited live settings and selects local file storage", () => {
  const c = hkConfig(), publicConfig = hkPublicConfig()
  assert.equal(c.isolatedMock, true)
  assert.equal(c.cx.mode, "mock")
  assert.equal(c.opendid.mode, "mock")
  assert.equal(c.ai.mode, "rule")
  assert.equal(storeBackendKind(), "file")
  assert.equal(publicConfig.modes.sui, "disabled-isolated")
  assert.equal(publicConfig.modes.omnione, "disabled-isolated")
  assert.equal(publicConfig.modes.zklogin, "disabled-isolated")
  assert.equal(publicConfig.sui.googleClientId, "")
  assert.equal(publicConfig.sui.packageId, "")
  assert.equal(publicConfig.omnione.registryAddress, "")
  assert.equal(publicConfig.capabilities.opendidProviderReady, false)
  assert.equal(zkLoginConfigured(), false)
  assert.equal(enokiConfigured(), false)
  assert.equal(omnione.omnioneConfigured(), false)
})

test("real local cryptographic mock flow reaches proposal and stops at the live Sui boundary", async () => {
  const flow = await presentationReady()
  const allowed = await flow.submit()
  assert.equal(allowed.execution, "sample")
  assert.equal(allowed.presentation?.decision, "allow")
  assert.equal(allowed.phase, "proposal")
  const proposal = await service.proposalCreate(flow.sessionId, flow.operationId, { locale: "en", venueName: "Test venue", category: "cafe", district: "test" })
  assert.equal(proposal.proposal?.mode, "rule")
  assert.equal(proposal.phase, "delegation")
  await assert.rejects(service.delegationPrepare(flow.sessionId, flow.operationId, { userAddress: "0x" + "1".repeat(64), signer: "zklogin", walletProof: { message: "client-marker", signature: "client-marker" }, approvedProposalDigest: proposal.proposal!.proposalDigest }), errorCode("isolated_mock_external_disabled"))
  const pending = await service.loadOperation(flow.sessionId, flow.operationId)
  assert.equal(pending.status, "pending")
  assert.equal(pending.phase, "delegation")
  for (const field of [pending.delegation, pending.agent, pending.fulfillment, pending.chain]) assert.equal(field, null)
  const evidence = service.evidence(pending)
  assert.equal(evidence.sui, null)
  assert.equal(evidence.omnione, null)
  await assert.rejects(service.loadOperation("other-session", flow.operationId), errorCode("not_found"))
})

test("tampered claims and wrong holder signatures never allow a presentation", async () => {
  const tampered = await presentationReady()
  const claimResult = await tampered.submit({ ...tampered.disclosed, personVerified: false })
  assert.equal(claimResult.presentation?.decision, "deny")
  assert.equal(claimResult.presentation?.denyReason, "claim_mismatch")
  const wrongHolder = await presentationReady()
  const signatureResult = await wrongHolder.submit(wrongHolder.disclosed, generateKeyPairSync("ed25519").privateKey)
  assert.equal(signatureResult.presentation?.decision, "deny")
  assert.equal(signatureResult.presentation?.denyReason, "holder_signature")
})

test("client verifier confirmation cannot bypass the incomplete OpenDID provider lifecycle", async () => {
  const flow = await presentationReady()
  await withStore((db) => { db.operations[flow.operationId].credential!.mode = "opendid" })
  const result = await flow.submit({ __verifierConfirmed: true })
  assert.equal(result.presentation?.decision, "deny")
  assert.equal(result.presentation?.denyReason, "opendid_provider_unimplemented")
  assert.equal(result.presentation?.verifiedAt, null)
  assert.equal(result.phase, "presentation")
  assert.equal(result.proposal, null)
})

test("OpenDID issuance and verifier entrypoints fail closed before provider contact", async () => {
  process.env.HK_ISOLATED_MOCK = "0"
  try {
    await assert.rejects(issueCredential({ operationId: "test", subjectRef: "test", holderPublicKeyPem: "test", holderKeyAlg: "Ed25519", evidenceId: "test" }), errorCode("opendid_provider_unimplemented"))
    await assert.rejects(verifierRequestOffer({ operationId: "test" }), errorCode("opendid_provider_unimplemented"))
    await assert.rejects(verifierConfirm("client-ref"), errorCode("opendid_provider_unimplemented"))
  } finally { process.env.HK_ISOLATED_MOCK = "1" }
})

test("all chain and provider authentication entrypoints reject isolated execution", async () => {
  for (const call of [sui.suiClient, sui.suiKeys, sui.suiTargets]) assert.throws(call, errorCode("isolated_mock_external_disabled"))
  const forbidden = [
    () => sui.readGrant("test"), () => sui.readTransaction("test"), () => sui.currentEpoch(),
    () => sui.issueEntitlement({ intentRefHex: "test", holder: "test", expiresAtMs: Date.now() }),
    () => sui.buildDelegationPtb({ userAddress: "test", entitlement: { objectId: "test", version: "1", digest: "test" }, recipient: "test", actionCommitmentHex: "test", consentCommitmentHex: "test", expiresAtMs: Date.now() }),
    () => sui.executeDelegation({ txBytesB64: "test", userSignature: "test", sponsorSignature: "test", expectedGrantOwner: "test" }),
    () => sui.agentConsume({ grant: { objectId: "test", initialSharedVersion: "1" }, decisionCommitmentHex: "test", manifestCommitmentHex: "test", expectedRecipient: "test", expectedIntentRefHex: "test" }),
    () => omnione.getRedemption("test"), () => omnione.receiptStatus("test"),
    () => omnione.submitRedemption({ eventKeyHex: "test", payloadCommitmentHex: "test" }),
    () => proveZkLogin({ jwt: "test", extendedEphemeralPublicKey: "test", maxEpoch: 2, jwtRandomness: "test" }),
    () => service.delegationSubmit("test", "test", { txBytesDigest: "test", userSignature: "test" }),
    () => service.agentRun("test", "test"),
  ]
  for (const call of forbidden) await assert.rejects(call, errorCode("isolated_mock_external_disabled"))
})

test("committed redemption retries are session-bound, idempotent and do not touch chains", async () => {
  const ids = await newOperation()
  const input = { idempotencyKey: "same-request", bodyDigest: digestOf({ request: "same" }) }
  await withStore((db) => {
    const op = db.operations[ids.operationId]
    op.status = "succeeded"; op.phase = "done"
    op.fulfillment = { status: "redeemed", reason: null, redemptionRef: "rdm-test", redeemedAt: nowIso(), recheck: null }
    db.redemptions[redemptionKey("test-subject", op.campaignId)] = { redemptionRef: "rdm-test", subjectRef: "test-subject", campaignId: op.campaignId, operationId: ids.operationId, redeemedAt: op.fulfillment.redeemedAt! }
    db.idempotency[`${ids.operationId}:redeem:${input.idempotencyKey}`] = { key: input.idempotencyKey, bodyDigest: input.bodyDigest, responseDigest: digestOf({ redemptionRef: "rdm-test" }), createdAt: nowIso() }
  })
  const before = await readStore((db) => db)
  const responses = await Promise.all([service.redeem(ids.sessionId, ids.operationId, input), service.redeem(ids.sessionId, ids.operationId, input)])
  assert.equal(responses[0].fulfillment?.redemptionRef, "rdm-test")
  assert.deepEqual(responses[0], responses[1])
  await assert.rejects(service.redeem(ids.sessionId, ids.operationId, { ...input, bodyDigest: "changed" }), errorCode("idempotency_conflict"))
  await assert.rejects(service.redeem("other-session", ids.operationId, input), errorCode("not_found"))
  await assert.rejects(service.redeem(ids.sessionId, ids.operationId, { ...input, idempotencyKey: "another-request" }), errorCode("phase"))
  assert.deepEqual(await readStore((db) => db), before)
})

test("file transactions roll back failures and returned snapshots cannot mutate the ledger", async () => {
  const sessionId = randomId("ses", 18)
  const result = await withStore((db) => {
    db.sessions[sessionId] = { sessionId, createdAt: nowIso(), lastSeenAt: nowIso(), subjectRef: null }
    return db.sessions[sessionId]
  })
  result.subjectRef = "outside-write"
  const snapshot = await readStore((db) => db.sessions[sessionId])
  assert.equal(snapshot.subjectRef, null)
  snapshot.subjectRef = "read-side-write"
  assert.equal((await readStore((db) => db.sessions[sessionId])).subjectRef, null)
  const diskBefore = readFileSync(join(temporaryDataDir, "journey.json"), "utf8")
  await assert.rejects(withStore((db) => {
    db.sessions[sessionId].subjectRef = "rolled-back"
    throw new Error("intentional transaction failure")
  }), /intentional transaction failure/)
  assert.equal(readFileSync(join(temporaryDataDir, "journey.json"), "utf8"), diskBefore)
  await withStore((db) => { db.sessions[sessionId].lastSeenAt = nowIso() })
  assert.equal((await readStore((db) => db.sessions[sessionId])).subjectRef, null)
})

test("outbox remains pending with no transaction or fake confirmation in isolated mode", async () => {
  const ids = await newOperation(), outboxId = randomId("obx")
  await withStore((db) => {
    const row = { outboxId, operationId: ids.operationId, eventKey: "test-event", payloadCommitment: "test-commitment", payload: {}, status: "pending" as const, txHash: null, blockNumber: null, attempts: 0, lastError: null, createdAt: nowIso(), updatedAt: nowIso(), confirmedAt: null }
    db.outbox[outboxId] = row
    db.operations[ids.operationId].chain = { outboxId, eventKey: row.eventKey, payloadCommitment: row.payloadCommitment, status: "pending", txHash: null, blockNumber: null, attempts: 0, lastError: null, confirmedAt: null }
  })
  const result = await service.processOutbox(outboxId)
  assert.equal(result?.status, "pending")
  assert.equal(result?.lastError, "isolated_mock_external_disabled")
  assert.equal(result?.txHash, null)
  assert.equal(result?.confirmedAt, null)
  assert.equal(result?.attempts, 0)
  const operation = await service.reconcile(ids.sessionId, ids.operationId)
  assert.equal(operation.chain?.status, "pending")
  assert.equal(operation.chain?.confirmedAt, null)
  assert.deepEqual(attemptedNetwork, [])
})
