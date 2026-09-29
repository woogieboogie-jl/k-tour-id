/** Actual route -> session -> service -> atomic store -> collection regression.
 * Only network transports, proposed V2 provider projection and cryptography are
 * synthetic. Real dedicated access/profile/body/ownership/cutover guards run.
 * This is not native/provider/zkLogin/chain E2E or a production activation.
 */
import assert from "node:assert/strict"
import { beforeEach, mock, test } from "node:test"
import { AsyncLocalStorage } from "node:async_hooks"
import { createRequire } from "node:module"
import { createHash } from "node:crypto"
import { GUIDE_SAVE_V2 as GUIDE } from "../../../lib/hackathon/guide-contract"
import { GUIDE_PRODUCTION as PROFILE } from "../../../lib/hackathon/guide-production-profile"
import { CUTOVER_SCOPE, cutoverDigest, type IntegrationCutoverMarker } from "../../../lib/hackathon/integration-cutover"
import { initialSharedBudgetState, SHARED_BUDGET_SCOPE } from "../../../lib/hackathon/integration-shared-budget"
import { INTEGRATION_SUI_LIMITS as LIMITS, integrationSuiBudgetTemplate } from "../../../lib/hackathon/integration-sui-limits"
import { INTEGRATION_SUI_TARGETS } from "../../../lib/hackathon/integration-sui-targets"
import { sha256Hex } from "../../../lib/hackathon/util"
import type { Db } from "../../../lib/hackathon/store"
import { originalProvider, originalPolicy, readStore, owned, hasCode, reset, OWNER, counters, control, extraTransport } from "./guide-main-harness.fixture"

const require = createRequire(import.meta.url), target = INTEGRATION_SUI_TARGETS["selfhosted-testnet"]
const origin = PROFILE.origin, redisUrl = "https://route-synthetic-only.upstash.io"
const shared = process.env.KTOUR_FIXTURE_ALLOCATION === "shared-v2"
const environment = { ...process.env,
  NEXT_PUBLIC_HK_GUIDE_PRODUCTION: "1", HK_GUIDE_PRODUCTION_ENABLED: "1", HK_API_ENABLED: "1", NEXT_PUBLIC_HK_ENABLED: "1",
  NEXT_PUBLIC_HK_HOSTED_SUI: "0", NEXT_PUBLIC_HK_INTEGRATION_PREVIEW: "0", NEXT_PUBLIC_HK_CX_PREVIEW: "0", NEXT_PUBLIC_HK_PREVIEW_READ_ONLY: "0",
  HK_ISOLATED_MOCK: "0", HK_MODE_CX: "cx", HK_MODE_OPENDID: "opendid", HK_AI_MODE: "gemini",
  HK_CX_BASE_URL: "https://cx.raonsecure.co.kr:18543", HK_CX_PROVIDER: "comdl", HK_CX_ZKP_TYPE: "AdultVerify",
  HK_GUIDE_EXPIRES_AT: LIMITS.maxExpiresAt, HK_GUIDE_ACCESS_SECRET: "a".repeat(64), HK_GUIDE_ACCESS_CODE: "fixture_access_" + "b".repeat(32), HK_ISSUER_SIGNING_SEED: "fixture_" + "c".repeat(64),
  HK_STORE_KEY: CUTOVER_SCOPE.targetKey, KV_REST_API_URL: redisUrl, KV_REST_API_TOKEN: "fixture-not-a-secret",
  HK_INTEGRATION_SUI_TARGET: target.id, HK_SUI_NETWORK: target.network, HK_SUI_GRPC_URL: target.rpcUrls[0], HK_SUI_PACKAGE_ID: target.packageId,
  HK_SUI_CAMPAIGN_ID: target.campaignId, HK_SUI_CAMPAIGN_INITIAL_VERSION: target.campaignInitialVersion, HK_SUI_CHAIN_IDENTIFIER: target.chainIdentifier,
  HK_SUI_ISSUER_SECRET_KEY: "fixture_not_a_key_" + "d".repeat(64), HK_SUI_AGENT_SECRET_KEY: "fixture_not_a_key_" + "e".repeat(64),
  VERCEL: "1", VERCEL_ENV: "production", VERCEL_REGION: PROFILE.region, VERCEL_URL: "route-synthetic-only.vercel.app",
  VERCEL_PROJECT_ID: PROFILE.projectId, VERCEL_ORG_ID: PROFILE.orgId, VERCEL_GIT_PROVIDER: "github", VERCEL_GIT_COMMIT_REF: PROFILE.branch,
  VERCEL_GIT_COMMIT_SHA: "f".repeat(40), VERCEL_GIT_REPO_OWNER: PROFILE.repoOwner, VERCEL_GIT_REPO_SLUG: PROFILE.repoName,
}
Object.assign(process.env, environment)
const priorIds = Array.from({ length: 5 }, (_, i) => `op_priorfailed00${i + 1}`)
function priorRow(id: string) { return { operationId: id, kind: "demo", status: "failed", phase: "identity", createdAt: SHARED_BUDGET_SCOPE.firstBoundAt, updatedAt: SHARED_BUDGET_SCOPE.firstBoundAt, expiresAt: LIMITS.maxExpiresAt } }
const source = shared ? JSON.stringify({ version: 1, sessions: {}, operations: Object.fromEntries(priorIds.map(id => [id, priorRow(id)])), redemptions: {}, outbox: {}, idempotency: {}, nonces: {} }) : '{"fixture":"retained-prior-history"}'
const marker: IntegrationCutoverMarker = { version: 1, migrationId: "cutover_" + "a".repeat(64), evidenceDigest: "0x" + "b".repeat(64),
  sourceLedgerSha256: "0x" + createHash("sha256").update(source).digest("hex"), priorHostedOperationIds: ["op_priorfailed001"],
  hostedWritesDisabledAt: "2026-09-28T00:00:00Z", expiresAt: LIMITS.maxExpiresAt }
let rawTarget: string | null, rawControl: string | null, rawSource = source, writes = 0, sessionReads = 0
const locks = new Map<string, string>()
function seed() {
  const db: Db = { version: 1, sessions: {}, operations: {}, redemptions: {}, outbox: {}, idempotency: {}, nonces: {}, integrationCutover: structuredClone(marker),
    integrationSuiBudget: integrationSuiBudgetTemplate({ priorHostedOperationIds: marker.priorHostedOperationIds, hostedLedgerSha256: marker.sourceLedgerSha256, hostedWritesDisabledAt: marker.hostedWritesDisabledAt }) }
  if (shared) {
    const initial = initialSharedBudgetState(source)
    rawTarget = JSON.stringify(initial.db); rawControl = JSON.stringify(initial.control)
  } else {
    rawTarget = JSON.stringify(db)
    rawControl = JSON.stringify({ version: 1, phase: "committed", marker: db.integrationCutover, operationIds: [], targetDigest: cutoverDigest(db), sequence: 0 })
  }
  rawSource = source; locks.clear(); writes = 0; sessionReads = 0
}
extraTransport.run = async (url, init) => {
  if (url.origin !== redisUrl) return null
  const cmd = JSON.parse(String(init?.body)) as Array<string | number>
  let result: unknown
  if (cmd[0] === "SET" && cmd[3] === "NX") {
    const key = String(cmd[1]); assert.ok([`${CUTOVER_SCOPE.targetKey}:lock`, `${CUTOVER_SCOPE.sourceKey}:lock`].includes(key))
    assert.equal(locks.has(key), false); locks.set(key, String(cmd[2])); result = "OK"
  }
  else if (cmd[0] === "MGET") { assert.deepEqual(cmd.slice(1), [CUTOVER_SCOPE.targetKey, CUTOVER_SCOPE.controlKey, CUTOVER_SCOPE.sourceKey]); result = [rawTarget, rawControl, rawSource] }
  else if (cmd[0] === "EVAL" && cmd[2] === 4 && String(cmd[1]).includes("ktour-cutover-runtime-commit-v1")) {
    assert.deepEqual(cmd.slice(3, 7), [`${CUTOVER_SCOPE.targetKey}:lock`, CUTOVER_SCOPE.targetKey, CUTOVER_SCOPE.controlKey, CUTOVER_SCOPE.sourceKey])
    result = locks.get(String(cmd[3])) === cmd[7] && rawTarget === cmd[8] && rawControl === cmd[9] && rawSource === cmd[12] ? 1 : 0
    if (result === 1) { rawTarget = String(cmd[10]); rawControl = String(cmd[11]); writes++ }
  } else if (cmd[0] === "EVAL" && cmd[2] === 5 && String(cmd[1]).includes("ktour-shared-reservation-commit-v1")) {
    assert.deepEqual(cmd.slice(3, 8), [`${CUTOVER_SCOPE.targetKey}:lock`, CUTOVER_SCOPE.targetKey, CUTOVER_SCOPE.controlKey, `${CUTOVER_SCOPE.sourceKey}:lock`, CUTOVER_SCOPE.sourceKey])
    result = locks.get(String(cmd[3])) === cmd[8] && locks.get(String(cmd[6])) === cmd[9] && rawTarget === cmd[10] && rawControl === cmd[11] && rawSource === cmd[12] ? 1 : 0
    if (result === 1) { rawTarget = String(cmd[13]); rawControl = String(cmd[14]); rawSource = String(cmd[15]); writes++ }
  } else if (cmd[0] === "EVAL" && cmd[2] === 1) { const key = String(cmd[3]); result = locks.get(key) === cmd[4] ? 1 : 0; if (result === 1) locks.delete(key) }
  else throw new Error("unexpected_fixture_redis_command")
  return Response.json({ result })
}

type Browser = Map<string, string>
const requestContext = new AsyncLocalStorage<{ request: Request; browser: Browser }>()
mock.module(require.resolve("next/headers"), { namedExports: {
  headers: async () => requestContext.getStore()!.request.headers,
  cookies: async () => {
    sessionReads++
    const { request, browser } = requestContext.getStore()!
    const presented = new Map((request.headers.get("cookie") ?? "").split(";").filter(Boolean).map(v => { const p = v.trim().indexOf("="); return [v.trim().slice(0, p), v.trim().slice(p + 1)] }))
    return { get: (name: string) => presented.has(name) ? { name, value: presented.get(name)! } : undefined,
      set: (name: string, value: string, options: { httpOnly: boolean; path: string; sameSite: string }) => {
        assert.equal(options.httpOnly, true); assert.equal(options.path, "/"); assert.equal(options.sameSite, "lax"); browser.set(name, value)
      } }
  },
} })
const route = await import("../../../app/api/hackathon/v1/[...path]/route")
beforeEach(() => { reset(); for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, environment); seed() })

async function call(browser: Browser, path: string[], { method = "GET", body = {}, headers = {} }: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const request = new Request(`${origin}/api/hackathon/v1/${path.join("/")}`, { method, headers: {
    host: "ktour-id.vercel.app", "x-forwarded-host": "ktour-id.vercel.app", "x-forwarded-proto": "https", origin, "sec-fetch-site": "same-origin", "content-type": "application/json",
    cookie: [...browser].map(([name, value]) => `${name}=${value}`).join("; "), ...headers,
  }, ...(method === "POST" ? { body: JSON.stringify(body) } : {}) })
  const response = await requestContext.run({ request, browser }, () => (method === "POST" ? route.POST : route.GET)(request, { params: Promise.resolve({ path }) }))
  const cookie = response.headers.get("set-cookie")?.split(";")[0]
  if (cookie) browser.set(cookie.slice(0, cookie.indexOf("=")), cookie.slice(cookie.indexOf("=") + 1))
  const value = await response.json()
  assert.equal(response.headers.get("cache-control"), "no-store")
  return { status: response.status, value }
}
async function post(browser: Browser, path: string[], body: unknown = {}) {
  const result = await call(browser, path, { method: "POST", body })
  assert.equal(result.status, 200, JSON.stringify(result.value))
  return result.value
}
async function browser() {
  const b: Browser = new Map()
  await post(b, ["guide", "access"], { accessCode: environment.HK_GUIDE_ACCESS_CODE })
  await post(b, ["sessions"])
  return b
}
async function create(b: Browser) {
  const op = await post(b, ["guide", "operations"], { venueId: GUIDE.venueId, consentVersion: GUIDE.consentVersion, locale: "ja" })
  return { operationId: op.operationId as string, sessionId: b.get("ondo_hk_session")! }
}
async function proposal(b: Browser) {
  const f = await create(b), path = ["operations", f.operationId]
  await post(b, [...path, "identity", "start"], { mobile: false })
  const identity = await post(b, [...path, "identity", "complete"])
  assert.equal(identity.identity.mode, "cx"); assert.equal(identity.identity.personVerified, true)
  const issuance = await post(b, [...path, "provider", "issuance", "start"])
  assert.equal(issuance.provider.phase, "issuance"); assert.ok(issuance.provider.offer.qrPayload)
  await post(b, [...path, "provider", "issuance", "refresh"])
  await post(b, [...path, "provider", "presentation", "start"])
  const vp = await post(b, [...path, "provider", "presentation", "refresh"])
  assert.equal(vp.provider.phase, "allowed"); assert.equal(vp.provider.offer, null)
  await post(b, [...path, "proposal"], { locale: "ja" })
  return f
}
async function executed(b: Browser) {
  const f = await proposal(b), op = await owned(f.sessionId, f.operationId), path = ["operations", f.operationId]
  const message = `ondo-hk-wallet-proof:${f.operationId}:${op.presentation!.decisionRef}`
  const prepared = await post(b, [...path, "delegation", "prepare"], { signer: "zklogin", userAddress: OWNER, approvedProposalDigest: op.proposal!.proposalDigest,
    walletProof: { message, signature: `fixture-zk:${sha256Hex(new TextEncoder().encode(message))}` } })
  await post(b, [...path, "delegation", "submit"], { txBytesDigest: prepared.result.delegation.txBytesDigest, userSignature: "fixture-user-approved" })
  await post(b, [...path, "agent", "run"])
  return f
}

test("actual production policy still blocks provider V2 despite the child fixture projection", async () => {
  assert.equal(originalProvider.providerIntegrationAvailable(), false)
  await assert.rejects(originalPolicy.assertGuideReady(), hasCode("guide_setup_required"))
  const b = await browser(), config = await call(b, ["config"])
  assert.equal(config.status, 200); assert.equal(config.value.capabilities.chainExecutionEnabled, false)
  assert.equal(config.value.guide.campaignId, GUIDE.campaignId)
})

test("authenticated actual routes complete synthetic V2 through collection with same operation and budget", async () => {
  const b = await browser(), before = { ...counters }, f = await executed(b)
  const result = await post(b, ["operations", f.operationId, "redeem"], { idempotencyKey: "route-save-1" })
  assert.equal(result.status, "succeeded"); assert.equal(result.chain.status, "confirmed")
  const list = await call(b, ["guide", "collection"])
  assert.equal(list.status, 200); assert.equal(list.value.items.length, 1); assert.equal(list.value.items[0].operationId, f.operationId)
  assert.equal(list.value.items[0].chain.status, "confirmed"); assert.equal(list.value.pendingOperation, null)
  const db = await readStore(db => db)
  if (shared) {
    assert.deepEqual(db.integrationSharedBudget!.operationIds, [f.operationId]); assert.equal(db.integrationSuiBudget, undefined)
    const allocation = JSON.parse(rawSource).operations
    assert.equal(Object.keys(allocation).length, 6)
    for (const id of priorIds) assert.deepEqual(allocation[id], priorRow(id))
    assert.equal(allocation[f.operationId].kind, "integration_budget_reservation")
    assert.equal(allocation[f.operationId].sessionId, undefined); assert.equal(allocation[f.operationId].secrets, undefined)
  } else {
    assert.deepEqual(db.integrationSuiBudget!.operationIds, [f.operationId]); assert.deepEqual(db.integrationSuiBudget!.priorHostedOperationIds, marker.priorHostedOperationIds)
  }
  assert.equal(counters.issue - before.issue, 1); assert.equal(counters.delegate - before.delegate, 1); assert.equal(counters.agent - before.agent, 1); assert.equal(counters.omni - before.omni, 1)
  const evidence = await call(b, ["operations", f.operationId, "evidence"])
  assert.equal(evidence.status, 200)
  for (const privateMarker of ["synthetic-ci-", "request-token-", "urn:fixture:", "kycRef", "ownerBinding", "openDidProvider", "fixture_not_a_key_"]) {
    assert.equal(JSON.stringify([result, list.value, evidence.value]).includes(privateMarker), false, privateMarker)
  }
  const final = { ...counters }; control.revoked = true
  const retry = await post(b, ["operations", f.operationId, "redeem"], { idempotencyKey: "route-save-1" })
  assert.equal(retry.fulfillment.redemptionRef, result.fulfillment.redemptionRef); assert.deepEqual(counters, final)
})

test("access revocation and extra provider fields cannot touch sessions, provider transport or ledger", async () => {
  const b = await browser(), f = await create(b), baseline = { writes, sessionReads, counters: { ...counters } }
  for (const body of [{ approved: true }, { mode: "mock" }, { subject: { kind: "synthetic" } }]) {
    const r = await call(b, ["operations", f.operationId, "provider", "issuance", "start"], { method: "POST", body })
    assert.equal(r.status, 400)
  }
  b.delete("__Host-ktour_guide_access")
  const denied = await call(b, ["operations", f.operationId, "identity", "start"], { method: "POST", body: { mobile: false } })
  assert.equal(denied.status, 401); assert.equal(denied.value.error.code, "guide_access_denied")
  assert.equal(writes, baseline.writes); assert.equal(sessionReads, baseline.sessionReads); assert.deepEqual(counters, baseline.counters)
})

test("another authenticated browser cannot view or mutate an owned operation or saved guide", async () => {
  const b = await browser(), f = await executed(b)
  await post(b, ["operations", f.operationId, "redeem"], { idempotencyKey: "owner-save" })
  const stranger = await browser(), baseline = { ...counters }
  for (const path of [["operations", f.operationId], ["operations", f.operationId, "evidence"]]) assert.equal((await call(stranger, path)).status, 404)
  assert.equal((await call(stranger, ["operations", f.operationId, "reconcile"], { method: "POST" })).status, 404)
  assert.deepEqual((await call(stranger, ["guide", "collection"])).value.items, [])
  assert.deepEqual(counters, baseline)
})

test("unknown Omni response stays saved and route reconciliation is read-only recovery", async () => {
  const b = await browser(), f = await executed(b); control.omniPending = true
  const first = await post(b, ["operations", f.operationId, "redeem"], { idempotencyKey: "pending-omni" }), sends = counters.omni
  assert.equal(first.chain.status, "submitted"); assert.equal((await call(b, ["guide", "collection"])).value.items[0].chain.status, "submitted")
  control.omniPending = false
  const recovered = await post(b, ["operations", f.operationId, "reconcile"])
  assert.equal(recovered.chain.status, "confirmed"); assert.equal(counters.omni, sends)
  assert.equal((await call(b, ["guide", "collection"])).value.items[0].chain.status, "confirmed")
})

test("fresh provider revocation blocks route delegation before issuing any chain object", async () => {
  const b = await browser(), f = await proposal(b), op = await owned(f.sessionId, f.operationId), before = counters.issue
  control.revoked = true
  const message = `ondo-hk-wallet-proof:${f.operationId}:${op.presentation!.decisionRef}`
  const r = await call(b, ["operations", f.operationId, "delegation", "prepare"], { method: "POST", body: { signer: "zklogin", userAddress: OWNER, approvedProposalDigest: op.proposal!.proposalDigest,
    walletProof: { message, signature: `fixture-zk:${sha256Hex(new TextEncoder().encode(message))}` } } })
  assert.equal(r.status, 409); assert.equal(r.value.error.code, "opendid_status_required"); assert.equal(counters.issue, before)
})

test("cancelled operation cannot start identity again or become a collection item", async () => {
  const b = await browser(), f = await create(b)
  const cancelled = await post(b, ["operations", f.operationId, "cancel"])
  assert.equal(cancelled.status, "cancelled")
  const before = { ...counters }, r = await call(b, ["operations", f.operationId, "identity", "start"], { method: "POST", body: { mobile: false } })
  assert.ok(r.status >= 400); assert.deepEqual(counters, before)
  assert.equal((await call(b, ["guide", "collection"])).value.items.length, 0)
})

test("retained source mutation and missing control stop create before replacing the budget", async () => {
  const b = await browser(), baseline = rawTarget, priorWrites = writes
  if (shared) { const changed = JSON.parse(rawSource); delete changed.operations[priorIds[0]]; rawSource = JSON.stringify(changed) }
  else rawSource += " "
  assert.equal((await call(b, ["guide", "operations"], { method: "POST", body: { venueId: GUIDE.venueId, consentVersion: GUIDE.consentVersion, locale: "ja" } })).status, 503)
  assert.equal(rawTarget, baseline); assert.equal(writes, priorWrites)
  rawSource = source; rawControl = null
  assert.equal((await call(b, ["guide", "collection"])).status, 503)
  assert.equal(rawTarget, baseline); assert.equal(writes, priorWrites)
})

if (shared) test("shared route accepts legitimate old-writer allocation while keeping the combined cap", async () => {
  const b = await browser(), changed = JSON.parse(rawSource)
  for (let i = 6; i <= 9; i++) { const id = `op_priorfailed00${i}`; changed.operations[id] = priorRow(id) }
  rawSource = JSON.stringify(changed)
  const f = await create(b)
  assert.equal(Object.keys(JSON.parse(rawSource).operations).length, 10)
  await post(b, ["operations", f.operationId, "cancel"])
  const before = { target: JSON.parse(rawTarget!), source: rawSource }
  const denied = await call(b, ["guide", "operations"], { method: "POST", body: { venueId: GUIDE.venueId, consentVersion: GUIDE.consentVersion, locale: "ja" } })
  assert.equal(denied.status, 429); assert.equal(denied.value.error.code, "integration_sui_limit")
  // Request middleware may legitimately refresh the existing session. It must
  // not consume/release an allocation or mutate any operation on rejected create.
  const after = JSON.parse(rawTarget!)
  assert.deepEqual(after.operations, before.target.operations)
  assert.deepEqual(after.integrationSharedBudget, before.target.integrationSharedBudget)
  assert.equal(rawSource, before.source)
  assert.deepEqual((await call(b, ["guide", "collection"])).value.items, [])
})

if (shared) test("shared reservation row cannot be read or mutated as an owned main-route operation", async () => {
  const b = await browser(), f = await create(b), prior = { ...counters }
  // Existing legacy ids are counted but never copied into this profile's target.
  for (const path of [["operations", priorIds[0]], ["operations", priorIds[0], "evidence"]]) assert.equal((await call(b, path)).status, 404)
  const stranger = await browser()
  assert.equal((await call(stranger, ["operations", f.operationId, "cancel"], { method: "POST" })).status, 404)
  assert.equal(Object.keys(JSON.parse(rawSource).operations).length, 6)
  assert.deepEqual(counters, prior)
})
