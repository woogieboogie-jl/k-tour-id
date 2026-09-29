// Actual service + durable disposable file ledger; only admission/environment
// and chain/credential transports are synthetic. No real identity or chain call.
import assert from "node:assert/strict"
import { after, before, beforeEach, mock, test } from "node:test"
import { mkdtempSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { env, fixture, now } from "../hackathon/fixtures/hosted-omnione.fixture"
import { omnioneTargetSnapshot } from "../../lib/hackathon/omnione-targets"
import { HkError } from "../../lib/hackathon/util"
const realProfile = await import("../../lib/hackathon/hosted-sui-profile")
const dir = mkdtempSync(join(tmpdir(), "ktour-hosted-omnione-")), savedEnv = { ...process.env }, savedFetch = globalThis.fetch
let enabled = true, admission = true, calls = 0, reads = 0, failSubmit = false, holdRead: (() => Promise<void>) | undefined
let receipt: "pending" | "confirmed" = "pending", proofInvalid = false
const hash = "0x" + "4".repeat(64)
mock.module(new URL("../../lib/hackathon/hosted-sui-profile.ts", import.meta.url).href, { namedExports: {
  ...realProfile, hostedOmnioneEnabled: () => enabled, hostedSuiPreflightIssues: () => admission ? [] : ["expiry"],
} })
mock.module(new URL("../../lib/hackathon/adapters/sui.ts", import.meta.url).href, { namedExports: {
  suiKeys: () => ({ agentAddress: "fixture-agent" }), suiTargets: () => ({ campaign: { objectId: "fixture" }, types: { grant: "fixture" }, events: {} }),
  verifyReadExecution: async () => { reads++; await holdRead?.(); return { executedAtMs: now } },
  agentConsume: () => assert.fail("no new Sui execution"), buildDelegationPtb: () => assert.fail("no new Sui preparation"),
  executeDelegation: () => assert.fail("no new delegation"), issueEntitlement: () => assert.fail("no new issuance"),
  readGrant: () => assert.fail("no grant query"), verifyReadDelegation: () => assert.fail("no delegation query"),
  transactionDigest: () => "fixture", suiClient: () => assert.fail("no chain client"), explorerTx: () => "fixture", explorerObject: () => "fixture",
} })
mock.module(new URL("../../lib/hackathon/operation-evidence.ts", import.meta.url).href, { namedExports: {
  credentialEligibility: () => proofInvalid ? "identity_invalid" : null, presentationEligibility: () => null,
  redemptionEligibility: (op: { identity: { subjectRef: string }; campaignId: string }, db: { redemptions: Record<string, unknown> }) => proofInvalid ? "identity_invalid" : db.redemptions[`${op.identity.subjectRef}::${op.campaignId}`] ? "already_redeemed" : null,
  executionExpectation: () => ({}), delegationExpectation: () => ({}), executionManifest: () => ({}),
} })
mock.module(new URL("../../lib/hackathon/adapters/omnione.ts", import.meta.url).href, { namedExports: {
  omnioneConfigured: () => true, getRedemption: async () => ({ exists: false }),
  submitRedemption: async (opts: { onPrepared?: (hash: string) => Promise<void> }) => { calls++; await opts.onPrepared?.(hash); if (failSubmit) throw new Error("fixture-lost-response"); return { txHash: hash, alreadyRecorded: false, matches: true } },
  receiptStatus: async () => ({ status: receipt, blockNumber: receipt === "confirmed" ? 456 : null }),
} })
const { withStore, readStore } = await import("../../lib/hackathon/store")
const service = await import("../../lib/hackathon/service")
before(() => {
  for (const key of Object.keys(process.env)) if (key === "VERCEL" || key.startsWith("VERCEL_") || key.startsWith("HK_") || key.startsWith("NEXT_PUBLIC_HK_") || key.startsWith("KV_") || key.startsWith("UPSTASH_")) delete process.env[key]
  Object.assign(process.env, env(), { HK_ISOLATED_MOCK: "1", HK_DATA_DIR: dir, KV_REST_API_URL: "", KV_REST_API_TOKEN: "" })
  globalThis.fetch = async () => assert.fail("no external request")
  mock.timers.enable({ apis: ["Date"], now })
})
beforeEach(async () => {
  enabled = admission = true; calls = reads = 0; failSubmit = proofInvalid = false; holdRead = undefined; receipt = "pending"
  await withStore(db => { db.operations = {}; db.redemptions = {}; db.outbox = {}; db.sessions = {}; db.idempotency = {} })
})
after(() => { mock.timers.reset(); mock.restoreAll(); globalThis.fetch = savedFetch; for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key]; Object.assign(process.env, savedEnv); rmSync(dir, { recursive: true, force: true }) })
async function seed(legacy = false) {
  const f = fixture(); f.op.status = "pending"; f.op.phase = "fulfillment"; f.op.presentation!.decisionConsumedAt = null
  f.op.fulfillment = { status: "pending", reason: "authorization_consumed", redemptionRef: null, redeemedAt: null, recheck: null }; f.op.chain = null
  if (legacy) f.op.omnioneTarget = omnioneTargetSnapshot()
  await withStore(db => { db.operations[f.op.operationId] = f.op; db.sessions[f.op.sessionId] = { sessionId: f.op.sessionId, subjectRef: f.op.identity!.subjectRef, createdAt: f.op.createdAt, lastSeenAt: f.op.createdAt } })
  return f.op
}
const input = { idempotencyKey: "fixture-confirm", bodyDigest: "fixture-body" }
const rejected = (e: unknown) => e instanceof HkError && e.code === "hosted_sui_scope"
test("explicit confirmation atomically commits one test use+outbox and same-key retry never resends", async () => {
  const op = await seed(); receipt = "confirmed"
  const result = await service.redeem(op.sessionId, op.operationId, input)
  assert.equal(result.fulfillment?.status, "redeemed"); assert.equal(result.chain?.status, "confirmed"); assert.equal(calls, 1)
  const disk = JSON.parse(readFileSync(join(dir, "journey.json"), "utf8"))
  assert.equal(Object.keys(disk.redemptions).length, 1); assert.equal(Object.keys(disk.outbox).length, 1)
  const again = await service.redeem(op.sessionId, op.operationId, input)
  assert.equal(again.fulfillment?.redemptionRef, result.fulfillment?.redemptionRef); assert.equal(calls, 1); assert.equal(reads, 1)
})
test("concurrent confirmations produce only one durable redemption and dispatch", async () => {
  const op = await seed()
  await Promise.allSettled([service.redeem(op.sessionId, op.operationId, input), service.redeem(op.sessionId, op.operationId, input)])
  assert.equal(calls, 1)
  assert.equal(await readStore(db => Object.keys(db.redemptions).length), 1)
  assert.equal(await readStore(db => Object.keys(db.outbox).length), 1)
})
test("legacy operation has no new confirmation CTA and cannot be auto-audited", async () => {
  const op = await seed(true)
  assert.equal(service.toResult(op).hostedTestRedemption, false)
  assert.equal(service.toResult(op).allowedActions.includes("redeem"), false)
  await assert.rejects(service.redeem(op.sessionId, op.operationId, input), rejected)
  assert.equal(reads, 0); assert.equal(calls, 0)
})
test("exact-target recovery marker persists when activation disappears but never authorizes a CTA", async () => {
  const op = await seed()
  assert.equal(service.toResult(op).hostedTestRedemption, true)
  enabled = false
  const view = service.toResult(op)
  assert.equal(view.hostedTestRedemption, true)
  assert.equal(view.allowedActions.includes("redeem"), false)
  await assert.rejects(service.redeem(op.sessionId, op.operationId, input), rejected)
  assert.equal(reads, 0); assert.equal(calls, 0)
})
test("disabled activation or expiry while Sui verification waits fails final CAS without business commit", async () => {
  for (const change of [() => { enabled = false }, () => { admission = false }]) {
    enabled = admission = true
    const op = await seed(); holdRead = async () => { change() }
    await assert.rejects(service.redeem(op.sessionId, op.operationId, input), rejected)
    assert.equal(await readStore(db => Object.keys(db.redemptions).length), 0)
    assert.equal(await readStore(db => Object.keys(db.outbox).length), 0); assert.equal(calls, 0)
  }
})
test("revoked proof during Sui recheck blocks business state and creates no audit", async () => {
  const op = await seed(); holdRead = async () => { proofInvalid = true }
  const result = await service.redeem(op.sessionId, op.operationId, input)
  assert.equal(result.fulfillment?.status, "blocked"); assert.equal(calls, 0)
  assert.equal(await readStore(db => Object.keys(db.outbox).length), 0)
})
test("lost OmniOne response keeps committed use and prepared hash; reconcile only reads", async () => {
  const op = await seed(); failSubmit = true
  const result = await service.redeem(op.sessionId, op.operationId, input)
  assert.equal(result.fulfillment?.status, "redeemed"); assert.equal(result.chain?.status, "submitted"); assert.equal(result.chain?.txHash, hash)
  failSubmit = false; receipt = "confirmed"
  await service.processOutbox(result.chain!.outboxId)
  assert.equal(calls, 1); assert.equal(await readStore(db => db.operations[op.operationId].chain?.status), "confirmed")
})
