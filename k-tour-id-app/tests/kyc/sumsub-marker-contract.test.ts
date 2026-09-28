import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import test from "node:test"
import { NextRequest } from "next/server"
import { GET as status } from "../../app/api/kyc/sumsub/status/route"
import { POST as webhook } from "../../app/api/kyc/sumsub/webhook/route"
import { createSession, readVerifiedSandboxStatus, SandboxError, sealSession, SESSION_COOKIE, type SandboxConfig, type SandboxSession } from "../../lib/kyc/sumsub-sandbox"
import { createSumsubRecord, mutateSumsubRecord, readSumsubRecord } from "../../lib/kyc/sumsub-store"

const origin = "http://localhost:3197"
const config: SandboxConfig = {
  appToken: "sbx:marker-contract-fixture", secretKey: "fixture-api-secret",
  webhookSecret: "fixture-webhook-secret", sessionSecret: "fixture-session-secret-01234567890123456789",
  accessCode: "fixture-access-code-012345", levelName: "fixture-passport", origins: [origin],
}
async function isolated(work: () => Promise<void>) {
  const env = process.env, fetcher = globalThis.fetch
  process.env = {
    NODE_ENV: "test", SUMSUB_LOCAL_MEMORY: "1", SUMSUB_MODE: "sandbox", NEXT_PUBLIC_ONDO_SUMSUB_SANDBOX: "1",
    SUMSUB_APP_TOKEN: config.appToken, SUMSUB_SECRET_KEY: config.secretKey, SUMSUB_WEBHOOK_SECRET: config.webhookSecret,
    SUMSUB_SESSION_SECRET: config.sessionSecret, SUMSUB_PREVIEW_ACCESS_CODE: config.accessCode,
    SUMSUB_LEVEL_NAME: config.levelName, SUMSUB_ALLOWED_ORIGINS: origin,
  }
  globalThis.fetch = async () => { assert.fail("Unexpected request: all provider replies must be local fixtures") }
  try { await work() } finally { process.env = env; globalThis.fetch = fetcher }
}
async function seed() {
  const session = createSession(config, origin)
  assert.equal(await createSumsubRecord({
    version: 1, externalUserId: session.externalUserId, applicantId: "fixture_applicant", levelName: config.levelName,
    status: "pending", lastEventAt: 0, expiresAt: session.recoveryExpiresAt,
    activeSessionId: session.sessionId, activeExpiresAt: session.expiresAt,
  }, config.sessionSecret), true)
  return session
}
function statusRequest(session: SandboxSession) {
  return new NextRequest(`${origin}/api/kyc/sumsub/status`, {
    headers: { origin, "x-ktour-kyc": "1", cookie: `${SESSION_COOKIE}=${sealSession(session, config.sessionSecret)}` },
  })
}
function event(session: SandboxSession, patch: Record<string, unknown> = {}) {
  return {
    applicantId: "fixture_applicant", externalUserId: session.externalUserId, levelName: config.levelName,
    sandboxMode: true, type: "applicantReviewed", eventId: "marker-contract-event",
    createdAtMs: new Date(Date.now() - 1000).toISOString().replace("T", " ").replace("Z", ""),
    reviewStatus: "completed", reviewResult: { reviewAnswer: "GREEN" }, ...patch,
  }
}
function signedWebhook(value: Record<string, unknown>, secret = config.webhookSecret!) {
  const body = JSON.stringify(value)
  return new NextRequest(`${origin}/api/kyc/sumsub/webhook`, {
    method: "POST", headers: { "content-type": "application/json", "x-payload-digest-alg": "HMAC_SHA256_HEX",
      "x-payload-digest": createHmac("sha256", secret).update(body).digest("hex") }, body,
  })
}
function provider(session: SandboxSession, applicantPatch: Record<string, unknown> = {}, reviewPatch: Record<string, unknown> = {}) {
  let calls = 0
  globalThis.fetch = async (input, init) => {
    calls++
    const url = new URL(String(input)), headers = new Headers(init?.headers)
    assert.equal(url.origin, "https://api.sumsub.com")
    assert.equal(init?.method, "GET"); assert.equal(init.redirect, "error")
    assert.equal(headers.get("X-App-Token"), config.appToken)
    const timestamp = headers.get("X-App-Access-Ts")
    assert.match(timestamp ?? "", /^\d+$/)
    assert.equal(headers.get("X-App-Access-Sig"), createHmac("sha256", config.secretKey).update(`${timestamp}GET${url.pathname}`).digest("hex"))
    if (url.pathname.endsWith("/one")) {
      assert.equal(url.pathname, `/resources/applicants/-;externalUserId=${session.externalUserId}/one`)
      return Response.json({ id: "fixture_applicant", externalUserId: session.externalUserId, ...applicantPatch })
    }
    assert.equal(url.pathname, "/resources/applicants/fixture_applicant/status")
    return Response.json({ levelName: config.levelName, reviewStatus: "completed", reviewResult: { reviewAnswer: "GREEN" }, ...reviewPatch })
  }
  return () => calls
}

test("marker-free signed Sandbox GET reaches status route as bounded init/approval only after both binding reads", () => isolated(async () => {
  for (const [reviewStatus, expected] of [["init", "in_progress"], ["completed", "approved"]]) {
    const session = await seed(), calls = provider(session, {}, { reviewStatus })
    const response = await status(statusRequest(session)), body = await response.json()
    assert.equal(response.status, 200); assert.equal(body.status, expected); assert.equal(calls(), 2)
    assert.deepEqual(Object.keys(body).sort(), ["checkedAt", "configured", "environment", "expiresAt", "retryAfterSeconds", "status"])
    assert.equal((await readSumsubRecord(session.externalUserId, config.sessionSecret))?.status, expected)
  }
}))

test("marker-free lookup never bypasses external user, previous applicant, level or explicit marker rejection", () => isolated(async () => {
  for (const patch of [
    { applicant: { externalUserId: "foreign-user" }, calls: 1 },
    { applicant: { id: "replacement_applicant" }, calls: 1 },
    { applicant: { sandboxMode: false }, calls: 1 },
    { applicant: { sandboxMode: null }, calls: 1 },
    { applicant: { sandboxMode: "true" }, calls: 1 },
    { review: { levelName: "foreign-level" }, calls: 2 },
  ]) {
    const session = await seed(), before = await readSumsubRecord(session.externalUserId, config.sessionSecret)
    const calls = provider(session, patch.applicant, patch.review)
    const response = await status(statusRequest(session))
    assert.equal(response.status, 503); assert.equal((await response.json()).error, "provider_binding_mismatch")
    assert.equal(calls(), patch.calls)
    assert.deepEqual(await readSumsubRecord(session.externalUserId, config.sessionSecret), before)
  }
}))

test("production app token and a non-Sandbox session fail before any provider call", () => isolated(async () => {
  const session = await seed()
  let calls = 0
  globalThis.fetch = async () => { calls++; assert.fail("Production must not reach provider") }
  const invalid = { ...session, environment: "production" } as unknown as SandboxSession
  await assert.rejects(readVerifiedSandboxStatus(config, invalid), error => error instanceof SandboxError && error.code === "provider_binding_mismatch")
  process.env.SUMSUB_APP_TOKEN = "prd:fixture"
  assert.equal((await status(statusRequest(session))).status, 503)
  assert.equal((await webhook(signedWebhook(event(session)))).status, 503)
  assert.equal(calls, 0)
}))

test("incoming signed webhook still requires true marker and separate HMAC key before marker-free re-query", () => isolated(async () => {
  const session = await seed(), calls = provider(session)
  for (const sandboxMode of [undefined, false, null, "true", 1]) {
    assert.equal((await webhook(signedWebhook(event(session, { sandboxMode })))).status, 400)
  }
  assert.equal((await webhook(signedWebhook(event(session), config.secretKey))).status, 401)
  assert.equal(calls(), 0)
  assert.equal((await readSumsubRecord(session.externalUserId, config.sessionSecret))?.needsRefresh, undefined)
}))

test("marker-free webhook re-query remains only a replay-safe hint and cannot undo revocation", () => isolated(async () => {
  const session = await seed()
  await mutateSumsubRecord(session.externalUserId, config.sessionSecret, row => ({ ...row, activeSessionId: null, activeExpiresAt: 0 }))
  const before = await readSumsubRecord(session.externalUserId, config.sessionSecret), calls = provider(session), value = event(session)
  const response = await webhook(signedWebhook(value))
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true, applied: true })
  const after = await readSumsubRecord(session.externalUserId, config.sessionSecret)
  assert.equal(after?.status, "pending"); assert.equal(after?.needsRefresh, true)
  assert.equal(after?.activeSessionId, null); assert.equal(after?.activeExpiresAt, 0); assert.equal(after?.expiresAt, before?.expiresAt)
  assert.deepEqual(await (await webhook(signedWebhook(value))).json(), { ok: true, applied: false })
  assert.deepEqual(await readSumsubRecord(session.externalUserId, config.sessionSecret), after)
  assert.equal((await status(statusRequest(session))).status, 401)
  assert.equal(calls(), 1)
}))
