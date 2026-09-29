// Real service/prepare CAS + disposable ledger. The narrow signing policy and
// provider transports are deterministic fixtures; no JWT, provider, or chain I/O.
import assert from "node:assert/strict"
import { after, before, beforeEach, mock, test } from "node:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fixture, now } from "../hackathon/fixtures/hosted-omnione.fixture"
import { HkError } from "../../lib/hackathon/util"
const dir = mkdtempSync(join(tmpdir(), "ktour-zk-boundary-")), saved = { ...process.env }, oldFetch = globalThis.fetch
const address = "0x" + "1".repeat(64), bytes = Buffer.from("fixture-transaction").toString("base64")
let stopped = false, checks = 0, proofs = 0, broadcasts = 0, issueCalls = 0, submitCalls = 0
let scheme = "ZkLogin", stopAt: "none" | "proof" | "issue" | "build" | "submit" = "none"
mock.module(new URL("../../lib/hackathon/zklogin-signing-policy.ts", import.meta.url).href, { namedExports: {
  assertZkLoginSigningAttempt: () => { checks++; if (stopped) throw new HkError("zklogin_attempt_inactive", "Sign-in stopped", 409) },
} })
mock.module("@mysten/sui/verify", { namedExports: { verifyPersonalMessageSignature: async () => { proofs++; if (stopAt === "proof") stopped = true } } })
mock.module("@mysten/sui/cryptography", { namedExports: { parseSerializedSignature: () => ({ signatureScheme: scheme }) } })
mock.module(new URL("../../lib/hackathon/operation-evidence.ts", import.meta.url).href, { namedExports: {
  credentialEligibility: () => null, presentationEligibility: () => null, redemptionEligibility: () => null,
  executionExpectation: () => ({}), delegationExpectation: () => ({}), executionManifest: () => ({}),
} })
mock.module(new URL("../../lib/hackathon/adapters/sui.ts", import.meta.url).href, { namedExports: {
  suiKeys: () => ({ agentAddress: address }), suiTargets: () => ({ campaign: { objectId: "fixture" }, types: { grant: "fixture" }, events: {} }),
  issueEntitlement: async ({ beforeBroadcast }: { beforeBroadcast: (digest: string) => Promise<void> }) => {
    issueCalls++; if (stopAt === "issue") stopped = true
    await beforeBroadcast("issued-fixture"); broadcasts++
    return { txDigest: "issued-fixture", entitlement: { objectId: "fixture", version: "1", digest: "fixture" } }
  },
  buildDelegationPtb: async () => { if (stopAt === "build") stopped = true; return { txBytesB64: bytes, txBytesDigest: "fixture-bytes", sponsorSignature: "fixture" } },
  executeDelegation: async ({ beforeBroadcast }: { beforeBroadcast: (digest: string) => Promise<void> }) => {
    submitCalls++; if (stopAt === "submit") stopped = true
    await beforeBroadcast("delegate-fixture"); broadcasts++
    return { txDigest: "delegate-fixture", grant: { objectId: "fixture", version: "1", digest: "fixture" } }
  },
  transactionDigest: () => "delegate-fixture", suiClient: () => ({}), explorerTx: () => "fixture", explorerObject: () => "fixture",
  agentConsume: () => assert.fail("no agent"), readGrant: () => assert.fail("no grant"), verifyReadDelegation: () => assert.fail("no delegation read"), verifyReadExecution: () => assert.fail("no execution read"),
} })
const { withStore, readStore } = await import("../../lib/hackathon/store")
const service = await import("../../lib/hackathon/service")
before(() => {
  for (const key of Object.keys(process.env)) if (key === "VERCEL" || /^(VERCEL_|HK_|NEXT_PUBLIC_HK_|KV_|UPSTASH_)/.test(key)) delete process.env[key]
  Object.assign(process.env, { HK_DATA_DIR: dir, HK_ISOLATED_MOCK: "0", HK_MODE_CX: "cx", HK_CX_PROVIDER: "comdl", HK_MODE_OPENDID: "mock", HK_AI_MODE: "rule" })
  globalThis.fetch = async () => assert.fail("external network forbidden")
  mock.timers.enable({ apis: ["Date"], now })
})
beforeEach(async () => {
  stopped = false; checks = proofs = broadcasts = issueCalls = submitCalls = 0; scheme = "ZkLogin"; stopAt = "none"
  await withStore(db => { db.operations = {}; db.sessions = {}; db.redemptions = {}; db.outbox = {}; db.idempotency = {} })
})
after(() => { mock.timers.reset(); mock.restoreAll(); globalThis.fetch = oldFetch; for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); rmSync(dir, { recursive: true, force: true }) })
async function seed() {
  const { op } = fixture()
  op.status = "pending"; op.phase = "delegation"; op.chain = null; op.fulfillment = null; op.agent = null; op.presentation!.decisionConsumedAt = null
  op.consent = { version: "fixture", digest: "fixture", acceptedAt: op.createdAt }
  op.proposal = { proposalId: "fixture", inputDigest: "fixture", outputDigest: "fixture", promptVersion: "fixture", policyVersion: 1, mode: "rule", model: "rule-v1", createdAt: op.createdAt, proposalDigest: "fixture-proposal", guard: { injectionSuspected: false, schemaValid: true },
    output: { action: "redeem_demo_entitlement", target: { venueId: op.venueId, campaignId: op.campaignId }, title: "Fixture", summary: "Fixture", rationale: "Fixture", language: "ko" } }
  await withStore(db => { db.operations[op.operationId] = op; db.sessions[op.sessionId] = { sessionId: op.sessionId, subjectRef: op.identity!.subjectRef, createdAt: op.createdAt, lastSeenAt: op.createdAt } })
  return op
}
const code = (e: unknown) => e instanceof HkError && e.code === "zklogin_attempt_inactive"
async function prepare(op: Awaited<ReturnType<typeof seed>>, signer: "zklogin" | "demo" = "zklogin") {
  return service.delegationPrepare(op.sessionId, op.operationId, { signer, userAddress: address, approvedProposalDigest: "fixture-proposal", walletProof: { message: `ondo-hk-wallet-proof:${op.operationId}:${op.presentation!.decisionRef}`, signature: "fixture-signature" } })
}
test("cancelled cached proof rejects before signature verification or issuer admission", async () => {
  const op = await seed(); stopped = true
  await assert.rejects(prepare(op), code)
  assert.equal(proofs, 0); assert.equal(issueCalls, 0); assert.equal(broadcasts, 0)
})
test("cancellation during signature verification wins before durable issuer claim", async () => {
  const op = await seed(); stopAt = "proof"
  await assert.rejects(prepare(op), code)
  assert.equal(issueCalls, 0); assert.equal(await readStore(db => db.operations[op.operationId].delegation), null)
})
test("cancellation before issuer broadcast keeps spent preparation and sends nothing", async () => {
  const op = await seed(); stopAt = "issue"
  await assert.rejects(prepare(op), code)
  assert.equal(broadcasts, 0)
  assert.equal(await readStore(db => db.operations[op.operationId].secrets.delegationPreparation?.stage), "unknown")
})
test("cancellation while building keeps minted evidence but does not return signing bytes", async () => {
  const op = await seed(); stopAt = "build"
  await assert.rejects(prepare(op), code)
  const current = await readStore(db => db.operations[op.operationId])
  assert.equal(broadcasts, 1); assert.equal(current.delegation?.entitlement?.txDigest, "issued-fixture")
  assert.equal(current.secrets.lastTxBytesB64, undefined); assert.equal(current.delegation?.status, "unknown")
})
test("cancelled proof blocks submit before dispatch; late stop blocks before broadcast", async () => {
  const op = await seed(); await prepare(op); const sent = broadcasts
  stopped = true
  await assert.rejects(service.delegationSubmit(op.sessionId, op.operationId, { txBytesDigest: "fixture-bytes", userSignature: "fixture" }), code)
  assert.equal(submitCalls, 0)
  stopped = false; stopAt = "submit"
  const result = await service.delegationSubmit(op.sessionId, op.operationId, { txBytesDigest: "fixture-bytes", userSignature: "fixture" })
  assert.equal(broadcasts, sent); assert.equal(result.delegation?.status, "unknown")
  assert.equal(result.delegation?.userTxDigest, "delegate-fixture")
})
test("demo signing remains on its existing cryptographic path", async () => {
  const op = await seed(); scheme = "ED25519"; stopped = true
  const prepared = await prepare(op, "demo")
  assert.equal(checks, 0); assert.equal(prepared.result.delegation?.status, "awaiting_signature")
})
