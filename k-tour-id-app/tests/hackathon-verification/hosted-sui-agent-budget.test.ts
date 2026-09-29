// Offline orchestration: actual service + disposable durable file store; only
// chain/evidence/provider configuration is injected. No remote signing or I/O.
// Run with --experimental-test-module-mocks (test:harvey:verification).
import assert from "node:assert/strict"
import { after, before, beforeEach, mock, test } from "node:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import http from "node:http"
import https from "node:https"
import { HkError, nowIso, randomId } from "../../lib/hackathon/util"
import type { OperationRecord } from "../../lib/hackathon/store"

const dataDir = mkdtempSync(join(tmpdir(), "ktour-hosted-agent-budget-"))
const originalEnv = { ...process.env }, originalFetch = globalThis.fetch
const realConfig = await import("../../lib/hackathon/config")
const env = {
  HK_ISOLATED_MOCK: "1", NEXT_PUBLIC_HK_HOSTED_SUI: "1", NEXT_PUBLIC_HK_CX_PREVIEW: "0", NEXT_PUBLIC_HK_PREVIEW_READ_ONLY: "0",
  NEXT_PUBLIC_HK_INTEGRATION_PREVIEW: "0", HK_MODE_CX: "mock", HK_MODE_OPENDID: "mock", HK_AI_MODE: "rule", HK_DATA_DIR: dataDir,
  HK_CAMPAIGN_ENDS_AT: "2099-01-01T00:00:00Z", HK_STORE_CANARY_UUID: "", HK_STORE_CANARY_OWNER: "",
  UPSTASH_REDIS_REST_URL: "", UPSTASH_REDIS_REST_TOKEN: "", KV_REST_API_URL: "", KV_REST_API_TOKEN: "",
}
let consumeCalls = 0, reads = 0, networkAttempts = 0
let failBeforeDigest = false, pause: (() => Promise<void>) | undefined
const forbidden = () => { networkAttempts++; throw new Error("unexpected_external_io") }
const address = "0x" + "1".repeat(64), grantId = "0x" + "2".repeat(64)
const digest = "fixture-paid-failed-transaction"
mock.module(new URL("../../lib/hackathon/config.ts", import.meta.url).href, { namedExports: {
  ...realConfig,
  // The service performs the read-only Sui preflight before claiming an attempt.
  // Real signing stays inside authorizedSui; the actual adapter's suiKeys and
  // executeSigned both enforce "Sui signing". This suite replaces that adapter
  // and tests durable budget/claim semantics, not its credential capability.
  assertExternalServicesEnabled: (name: string) => assert.equal(name, "Sui"),
} })
mock.module(new URL("../../lib/hackathon/adapters/sui.ts", import.meta.url).href, { namedExports: {
  agentConsume: async ({ beforeBroadcast }: { beforeBroadcast: (digest: string) => Promise<void> }) => {
    consumeCalls++
    await pause?.()
    if (!failBeforeDigest) await beforeBroadcast(digest)
    throw new HkError("sui_execute_failed", "Synthetic chain rejection", 502)
  },
  readGrant: async () => { reads++; return { uses: 0, revoked: false, expiresAtMs: Date.now() + 60_000 } },
  suiKeys: () => ({ agentAddress: address }),
  suiTargets: () => ({ campaign: { objectId: address }, types: { grant: "fixture::Grant" }, events: {} }),
  verifyReadExecution: forbidden, verifyReadDelegation: forbidden, issueEntitlement: forbidden, buildDelegationPtb: forbidden,
  executeDelegation: forbidden, transactionDigest: forbidden, suiClient: forbidden,
  explorerTx: () => "fixture", explorerObject: () => "fixture",
} })
mock.module(new URL("../../lib/hackathon/operation-evidence.ts", import.meta.url).href, { namedExports: {
  credentialEligibility: () => null, presentationEligibility: () => null, redemptionEligibility: forbidden,
  delegationExpectation: () => ({ campaignId: address }), executionExpectation: forbidden,
  executionManifest: () => ({ schema: "fixture", decidedAt: nowIso() }),
} })
mock.module(new URL("../../lib/hackathon/sui-evidence.ts", import.meta.url).href, { namedExports: { verifyGrantEvidence: () => undefined } })
const { withStore, readStore } = await import("../../lib/hackathon/store")
const service = await import("../../lib/hackathon/service")

before(() => {
  for (const key of Object.keys(process.env)) if (key === "VERCEL" || key.startsWith("VERCEL_")) delete process.env[key]
  Object.assign(process.env, env)
  globalThis.fetch = async () => forbidden()
  mock.method(http, "request", forbidden); mock.method(https, "request", forbidden)
})
beforeEach(() => { consumeCalls = 0; reads = 0; failBeforeDigest = false; pause = undefined; process.env.NEXT_PUBLIC_HK_HOSTED_SUI = "1" })
after(() => {
  assert.equal(networkAttempts, 0)
  globalThis.fetch = originalFetch
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key]
  Object.assign(process.env, originalEnv); mock.restoreAll()
  rmSync(dataDir, { recursive: true, force: true })
})

async function fixture() {
  const sessionId = randomId("ses")
  await withStore(db => { db.sessions[sessionId] = { sessionId, createdAt: nowIso(), lastSeenAt: nowIso(), subjectRef: null } })
  const made = await service.createOperation({ sessionId, venueId: realConfig.hkConfig().campaign.venueId, consentVersion: realConfig.HK_CONSENT_VERSION, locale: "en", venueName: "Fixture" })
  await withStore(db => {
    const o = db.operations[made.operationId]
    o.phase = "agent"
    o.proposal = { output: { action: "redeem_demo_entitlement", target: { venueId: o.venueId, campaignId: o.campaignId } } } as OperationRecord["proposal"]
    o.delegation = { grant: { objectId: grantId, initialSharedVersion: "1", txDigest: "fixture-grant" }, expiresAtMs: Date.now() + 60_000 } as OperationRecord["delegation"]
  })
  return { sessionId, operationId: made.operationId }
}
function disk(id: string): OperationRecord {
  return JSON.parse(readFileSync(join(dataDir, "journey.json"), "utf8")).operations[id]
}

test("hosted chain-rejected paid attempt is durable and never re-signed or re-broadcast", async () => {
  const f = await fixture()
  const first = await service.agentRun(f.sessionId, f.operationId)
  assert.equal(first.agent?.status, "failed"); assert.equal(first.agent?.txDigest, digest)
  assert.equal(disk(f.operationId).agent?.txDigest, digest)
  const calls = consumeCalls, before = JSON.stringify(disk(f.operationId))
  const results = await Promise.all([service.agentRun(f.sessionId, f.operationId), service.agentRun(f.sessionId, f.operationId)])
  assert.equal(consumeCalls, calls); assert.equal(reads, 1)
  assert.equal(JSON.stringify(disk(f.operationId)), before)
  for (const result of results) {
    assert.equal(result.agent?.txDigest, digest); assert.equal(result.allowedActions.includes("run_agent"), false)
    assert.equal(result.allowedActions.includes("return"), true); assert.equal(result.safeNextAction, "return")
  }
})

test("failure before digest remains a consumed hosted attempt, not permission to retry", async () => {
  const f = await fixture(); failBeforeDigest = true
  await service.agentRun(f.sessionId, f.operationId)
  assert.equal(disk(f.operationId).agent?.status, "failed"); assert.equal(disk(f.operationId).agent?.txDigest, null)
  await service.agentRun(f.sessionId, f.operationId)
  assert.equal(consumeCalls, 1); assert.equal(reads, 1)
})

test("durable queued/unknown intent without digest cannot dispatch after an interrupted request", async () => {
  const f = await fixture()
  for (const status of ["queued", "unknown"] as const) {
    await withStore(db => { db.operations[f.operationId].agent = { dispatchId: "fixture-intent", status, txDigest: null } as OperationRecord["agent"] })
    assert.equal(disk(f.operationId).agent?.status, status)
    const result = await service.agentRun(f.sessionId, f.operationId)
    assert.equal(result.agent?.status, status); assert.equal(result.allowedActions.includes("run_agent"), false)
  }
  assert.equal(consumeCalls, 0); assert.equal(reads, 0)
})

test("concurrent hosted calls persist one claim before the injected signer can run", async () => {
  const f = await fixture()
  let release!: () => void, entered!: () => void
  const wait = new Promise<void>(resolve => { release = resolve }), start = new Promise<void>(resolve => { entered = resolve })
  pause = async () => { entered(); await wait }
  const first = service.agentRun(f.sessionId, f.operationId)
  await start
  assert.equal(disk(f.operationId).agent?.status, "queued")
  const second = await service.agentRun(f.sessionId, f.operationId)
  assert.equal(second.agent?.status, "queued"); assert.equal(consumeCalls, 1)
  release(); await first
  assert.equal(consumeCalls, 1)
})

test("nonhosted failed-attempt retry remains unchanged", async () => {
  process.env.NEXT_PUBLIC_HK_HOSTED_SUI = "0"
  const f = await fixture()
  await service.agentRun(f.sessionId, f.operationId)
  await service.agentRun(f.sessionId, f.operationId)
  assert.equal(consumeCalls, 2); assert.equal(reads, 2)
})

test("ten lifetime operations include cancelled/failed records and survive fresh durable reads", async () => {
  await withStore(db => {
    // Separate test ledger state, not production cleanup.
    for (const op of Object.values(db.operations)) { op.status = "cancelled"; op.updatedAt = nowIso() }
  })
  while (await readStore(db => Object.keys(db.operations).length) < 10) await fixture()
  const before = readFileSync(join(dataDir, "journey.json"), "utf8")
  await assert.rejects(fixture(), (e: unknown) => e instanceof HkError && e.code === "hosted_sui_limit")
  assert.equal(Object.keys(JSON.parse(before).operations).length, 10)
  assert.equal(await readStore(db => Object.keys(db.operations).length), 10)
  assert.equal(consumeCalls, 0)
})
