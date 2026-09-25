import assert from "node:assert/strict"
import { after, before, beforeEach, test } from "node:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { hkConfig, HK_CONSENT_VERSION } from "../../lib/hackathon/config"
import { HkError, nowIso, randomId } from "../../lib/hackathon/util"
import { readStore, withStore } from "../../lib/hackathon/store"
import * as service from "../../lib/hackathon/service"
import { cxStart, cxComplete } from "../../lib/hackathon/adapters/cx"

// Synthetic transport + temporary file ledger only. No real credentials, Redis,
// provider requests, Mobile ID, issuance, AI or chain actions are used here.
const dataDir = mkdtempSync(join(tmpdir(), "ktour-identity-concurrency-"))
const fixtureEnv = {
  HK_ISOLATED_MOCK: "0", NEXT_PUBLIC_HK_PREVIEW_READ_ONLY: "0", HK_CX_PREVIEW_ENABLED: "0",
  HK_MODE_CX: "cx", HK_CX_PROVIDER: "comdl", HK_CX_BASE_URL: "https://cx.invalid", HK_DATA_DIR: dataDir,
  HK_ISSUER_SIGNING_SEED: "identity-fixture-only-seed", HK_CAMPAIGN_ENDS_AT: "2099-01-01T00:00:00Z",
  UPSTASH_REDIS_REST_URL: "", UPSTASH_REDIS_REST_TOKEN: "", KV_REST_API_URL: "", KV_REST_API_TOKEN: "",
}
const oldEnv = Object.fromEntries(Object.keys(fixtureEnv).map(key => [key, process.env[key]]))
const oldFetch = globalThis.fetch
const PNG = Buffer.from("89504e470d0a1a0a00000000", "hex").toString("base64")
const calls: Array<{ path: string; body: Record<string, any>; init?: RequestInit }> = []
let sequence = 0
let resultCode = 200
let pause: ((path: string, body: Record<string, any>) => Promise<void>) | undefined
let transform: ((path: string, body: Record<string, any>, result: Record<string, any>) => Record<string, any>) | undefined

before(() => { Object.assign(process.env, fixtureEnv) })
beforeEach(() => {
  pause = undefined; transform = undefined; resultCode = 200; calls.length = 0
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input))
    assert.equal(url.origin, "https://cx.invalid", "fixture must never send a request to another host")
    const path = url.pathname, body = JSON.parse(String(init?.body))
    calls.push({ path, body, init })
    let result: Record<string, any>
    if (path.endsWith("/trans")) { sequence += 1; result = { code: 200, token: `fixture-token-${sequence}`, txId: `tx-${sequence}` } }
    else if (path.endsWith("/qr/request")) result = { code: 200, token: `qr-token-${body.txId}`, txId: body.txId, cxId: `cx-${body.txId}`, data: { qrBase64: PNG } }
    else if (path.endsWith("/app/request")) result = { code: 200, token: `app-token-${body.txId}`, txId: body.txId, cxId: `cx-${body.txId}`, data: { iosLink: "fixture-mobile-id://verify?payload=fixture", androidLink: "intent://verify#Intent;scheme=fixture-mobile-id;package=example.fixture;end" } }
    else if (path.endsWith("/result")) result = { code: resultCode, token: `result-token-${body.txId}`, txId: body.txId, cxId: body.cxId, oacxStatus: "AFTER_RESULT", data: { verified: true } }
    else if (path.endsWith("/trans/token")) {
      const txId = String(body.token).replace("result-token-", "")
      result = { code: 200, data: { txId, cxId: `cx-${txId}`, ci: "RAW-CI-NEVER-PERSIST", name: "RAW-NAME-NEVER-PERSIST", address: "RAW-ADDRESS-NEVER-PERSIST", adult: "Y" } }
    } else throw new Error("Unexpected fixture endpoint")
    if (transform) result = transform(path, body, result)
    if (pause) await pause(path, body)
    return Response.json(result)
  }
})
after(() => {
  globalThis.fetch = oldFetch
  for (const [key, value] of Object.entries(oldEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
  rmSync(dataDir, { recursive: true, force: true })
})
const code = (...expected: string[]) => (error: unknown) => error instanceof HkError && expected.includes(error.code)
function gate() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve }); return { promise, release } }
async function seed() {
  const sessionId = randomId("ses")
  await withStore(db => { db.sessions[sessionId] = { sessionId, createdAt: nowIso(), lastSeenAt: nowIso(), subjectRef: null } })
  const op = await service.createOperation({ sessionId, venueId: hkConfig().campaign.venueId, consentVersion: HK_CONSENT_VERSION, locale: "en", venueName: "Fixture venue" })
  return { sessionId, operationId: op.operationId }
}
const stored = (id: string) => readStore(db => db.operations[id])
function noBearer(op: Awaited<ReturnType<typeof stored>>) {
  for (const field of ["cxToken", "cxTxId", "cxCxId", "cxStartClaim"]) assert.equal(op.secrets[field as keyof typeof op.secrets], undefined, field)
}

test("durable reservation prevents parallel provider transactions and valid handoff retries replay", async () => {
  const ids = await seed(), entered = gate(), release = gate()
  pause = async path => { if (path.endsWith("/trans")) { entered.release(); await release.promise } }
  const first = service.identityStart(ids.sessionId, ids.operationId, false)
  await entered.promise
  assert.ok((await stored(ids.operationId)).secrets.cxStartClaim)
  await assert.rejects(service.identityStart(ids.sessionId, ids.operationId, true), code("identity_start_pending"))
  release.release()
  const handoff = await first
  assert.equal(calls.filter(call => call.path.endsWith("/trans")).length, 1)
  const repeated = await service.identityStart(ids.sessionId, ids.operationId, true)
  assert.deepEqual(repeated, handoff)
  assert.equal(calls.length, 2)
  assert.equal((await stored(ids.operationId)).secrets.cxStartClaim, undefined)
})

test("cancel during start discards late handoff and clears the durable claim", async () => {
  const ids = await seed(), entered = gate(), release = gate()
  pause = async path => { if (path.endsWith("/qr/request")) { entered.release(); await release.promise } }
  const start = service.identityStart(ids.sessionId, ids.operationId, false)
  await entered.promise
  await service.cancel(ids.sessionId, ids.operationId)
  release.release()
  await assert.rejects(start, code("phase", "operation_changed"))
  const op = await stored(ids.operationId)
  assert.equal(op.status, "cancelled"); assert.equal(op.identity, null); noBearer(op)
})

test("late completion after cancellation cannot authenticate the session", async () => {
  const ids = await seed(); await service.identityStart(ids.sessionId, ids.operationId, false)
  const entered = gate(), release = gate()
  pause = async path => { if (path.endsWith("/result")) { entered.release(); await release.promise } }
  const complete = service.identityComplete(ids.sessionId, ids.operationId)
  await entered.promise
  await service.cancel(ids.sessionId, ids.operationId)
  release.release()
  await assert.rejects(complete, code("phase", "operation_changed"))
  const op = await stored(ids.operationId)
  assert.equal(op.status, "cancelled"); noBearer(op)
  assert.equal(await readStore(db => db.sessions[ids.sessionId].subjectRef), null)
})

test("verified completion replays without provider I/O and never persists raw identity claims", async () => {
  const ids = await seed(); await service.identityStart(ids.sessionId, ids.operationId, false)
  const verified = await service.identityComplete(ids.sessionId, ids.operationId)
  assert.equal(verified.phase, "issuance"); assert.equal(verified.identity?.personVerified, true)
  assert.equal(verified.identity?.adultVerified, true)
  const count = calls.length
  assert.deepEqual(await service.identityComplete(ids.sessionId, ids.operationId), verified)
  assert.equal(calls.length, count)
  noBearer(await stored(ids.operationId))
  const disk = readFileSync(join(dataDir, "journey.json"), "utf8")
  for (const raw of ["RAW-CI-NEVER-PERSIST", "RAW-NAME-NEVER-PERSIST", "RAW-ADDRESS-NEVER-PERSIST"]) assert.equal(disk.includes(raw), false)
  await assert.rejects(service.identityComplete(ids.sessionId, ids.operationId, { outcome: "verified", subjectSeed: "attacker" }), code("cx_sample_not_allowed"))
  assert.equal(calls.length, count)
})

test("two concurrent completions only record one verified identity", async () => {
  const ids = await seed(); await service.identityStart(ids.sessionId, ids.operationId, false)
  const entered = gate(), release = gate(); let resultCalls = 0
  pause = async path => { if (path.endsWith("/result") && ++resultCalls === 1) { entered.release(); await release.promise } }
  const first = service.identityComplete(ids.sessionId, ids.operationId)
  await entered.promise
  const second = await service.identityComplete(ids.sessionId, ids.operationId)
  release.release()
  assert.deepEqual(await first, second)
  assert.equal((await stored(ids.operationId)).audit.filter(row => row.event === "identity.verified").length, 1)
})

test("pending replies retain a rotated provider token only in server state", async () => {
  const ids = await seed(); await service.identityStart(ids.sessionId, ids.operationId, false)
  resultCode = 402
  const pending = await service.identityComplete(ids.sessionId, ids.operationId)
  assert.equal(pending.phase, "identity")
  const token = (await stored(ids.operationId)).secrets.cxToken
  assert.ok(token?.startsWith("result-token-"))
  assert.equal(JSON.stringify(pending).includes(token!), false)
  resultCode = 200
  const verified = await service.identityComplete(ids.sessionId, ids.operationId)
  assert.equal(verified.identity?.personVerified, true)
  assert.equal(calls.filter(call => call.path.endsWith("/result")).at(-1)?.body.token, token)
})

test("a late failed result cannot erase a newer handoff after an explicit retry", async () => {
  const ids = await seed(); await service.identityStart(ids.sessionId, ids.operationId, false)
  const entered = gate(), release = gate(); let resultCalls = 0
  resultCode = 406
  pause = async path => { if (path.endsWith("/result") && ++resultCalls === 1) { entered.release(); await release.promise } }
  const first = service.identityComplete(ids.sessionId, ids.operationId)
  await entered.promise
  await service.identityComplete(ids.sessionId, ids.operationId)
  noBearer(await stored(ids.operationId))
  const retried = await service.identityStart(ids.sessionId, ids.operationId, false)
  release.release()
  await assert.rejects(first, code("operation_changed"))
  assert.deepEqual((await stored(ids.operationId)).identity, retried.identity)
})

test("operation and handoff expiry reject completion and scrub bearer state", async () => {
  for (const kind of ["operation", "handoff"] as const) {
    const ids = await seed(); await service.identityStart(ids.sessionId, ids.operationId, false)
    await withStore(db => { const op = db.operations[ids.operationId]; if (kind === "operation") op.expiresAt = "2000-01-01T00:00:00Z"; else op.identity!.handoff!.expiresAt = "2000-01-01T00:00:00Z" })
    const count = calls.length
    await assert.rejects(service.identityComplete(ids.sessionId, ids.operationId), code("phase"))
    assert.equal(calls.length, count); noBearer(await stored(ids.operationId))
  }
})

test("expiry during provider I/O cannot store a verified result", async () => {
  const ids = await seed(); await service.identityStart(ids.sessionId, ids.operationId, false)
  const entered = gate(), release = gate()
  pause = async path => { if (path.endsWith("/result")) { entered.release(); await release.promise } }
  const checking = service.identityComplete(ids.sessionId, ids.operationId)
  await entered.promise
  await withStore(db => { db.operations[ids.operationId].expiresAt = "2000-01-01T00:00:00Z" })
  release.release()
  await assert.rejects(checking, code("phase", "operation_changed"))
  noBearer(await stored(ids.operationId))
  assert.equal(await readStore(db => db.sessions[ids.sessionId].subjectRef), null)
})

test("session ownership, expired operations and provider-mode changes fail before provider calls", async () => {
  const ids = await seed()
  await assert.rejects(service.identityStart("other-session", ids.operationId, false), code("not_found"))
  assert.equal(calls.length, 0)
  await service.identityStart(ids.sessionId, ids.operationId, false)
  const count = calls.length
  process.env.HK_MODE_CX = "mock"
  try { await assert.rejects(service.identityComplete(ids.sessionId, ids.operationId, { outcome: "verified", subjectSeed: "attacker" }), code("cx_mode_changed")) }
  finally { process.env.HK_MODE_CX = "cx" }
  assert.equal(calls.length, count)
  await withStore(db => { db.operations[ids.operationId].expiresAt = "2000-01-01T00:00:00Z" })
  await assert.rejects(service.identityStart(ids.sessionId, ids.operationId, false), code("phase"))
  assert.equal(calls.length, count)
  noBearer(await stored(ids.operationId))
})

test("expired start ownership cannot overwrite a newer attempt", async () => {
  const ids = await seed(), entered = gate(), release = gate(); let starts = 0
  pause = async path => { if (path.endsWith("/qr/request") && ++starts === 1) { entered.release(); await release.promise } }
  const first = service.identityStart(ids.sessionId, ids.operationId, false)
  await entered.promise
  await withStore(db => { db.operations[ids.operationId].secrets.cxStartClaim!.expiresAt = "2000-01-01T00:00:00Z" })
  const second = await service.identityStart(ids.sessionId, ids.operationId, false)
  release.release()
  await assert.rejects(first, code("operation_changed"))
  assert.deepEqual((await stored(ids.operationId)).identity, second.identity)
})

test("start validates transaction handles and PNG payload before saving a handoff", async () => {
  for (const patch of [{ token: {} }, { txId: "" }, { cxId: "" }, { data: { qrBase64: "not-a-png" } }]) {
    transform = (path, _body, result) => path.endsWith("/qr/request") ? { ...result, ...patch } : result
    const ids = await seed()
    await assert.rejects(service.identityStart(ids.sessionId, ids.operationId, false), code("cx_response", "cx_transaction_mismatch", "cx_handoff"))
    const op = await stored(ids.operationId)
    assert.equal(op.identity, null); noBearer(op)
  }
})

test("app handoffs accept native/universal links but reject executable and encoded intent fallbacks", async () => {
  const valid = await cxStart({ operationId: "fixture", mobile: true })
  assert.equal(valid.handoff.kind, "app")
  for (const link of ["javascript:alert(1)", "data:text/html,fixture", "file:///fixture", "intent://verify#Intent;S.browser_fallback_url=javascript%3Aalert(1);end", "https://user:pass@example.test", "https://example.test/\nfixture"]) {
    transform = (path, _body, result) => path.endsWith("/app/request") ? { ...result, data: { iosLink: link } } : result
    await assert.rejects(cxStart({ operationId: "fixture", mobile: true }), code("cx_handoff"))
  }
})

test("CX uses rotated tokens, requires cxId, forbids redirects, and redacts transport/oversized response failures", async () => {
  const ids = await seed(); await service.identityStart(ids.sessionId, ids.operationId, false)
  await service.identityComplete(ids.sessionId, ids.operationId)
  assert.ok(calls.find(call => call.path.endsWith("/result"))?.body.token.startsWith("qr-token-"))
  assert.ok(calls.find(call => call.path.endsWith("/trans/token"))?.body.token.startsWith("result-token-"))
  assert.ok(calls.every(call => call.init?.redirect === "error" && call.init.cache === "no-store"))
  await assert.rejects(cxComplete({ operationId: "fixture", token: "token", txId: "tx", mobile: false }), code("cx_state"))
  for (const fixture of [async () => { throw new Error("SECRET-TRANSPORT-CONTENT") }, async () => new Response("SECRET-TRANSPORT-CONTENT".repeat(30_000))]) {
    globalThis.fetch = fixture
    await assert.rejects(cxStart({ operationId: "fixture", mobile: false }), (error: unknown) => error instanceof HkError && !error.message.includes("SECRET-TRANSPORT-CONTENT"))
  }
})

test("a provider response body that never ends is deadline-bounded and sanitized", async () => {
  const originalTimeout = AbortSignal.timeout
  const keepAlive = setTimeout(() => undefined, 1_000)
  AbortSignal.timeout = () => originalTimeout(10)
  globalThis.fetch = async () => new Response(new ReadableStream())
  const started = performance.now()
  try {
    await assert.rejects(cxStart({ operationId: "fixture", mobile: false }), code("cx_request"))
    assert.ok(performance.now() - started < 500)
  } finally { AbortSignal.timeout = originalTimeout; clearTimeout(keepAlive) }
})
