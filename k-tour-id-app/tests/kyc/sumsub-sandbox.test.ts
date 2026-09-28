import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import test from "node:test"
import { createSumsubRecord, mutateSumsubRecord, readSumsubRecord } from "../../lib/kyc/sumsub-store"
import { createSession, isPreviewExpiryValid, normalizeReview, readVerifiedSandboxStatus, verifyWebhookSignature } from "../../lib/kyc/sumsub-sandbox"

process.env.SUMSUB_LOCAL_MEMORY = "1"
const secret = "fixture-session-secret-012345678901234567890123"
const externalUserId = "ktour-sbx-11111111-1111-4111-8111-111111111111"

test("Sandbox review normalization is status-only and terminal states are explicit", () => {
  assert.equal(normalizeReview({ reviewStatus: "prechecked" }), "in_progress")
  assert.equal(normalizeReview({ reviewStatus: "pending" }), "pending")
  assert.equal(normalizeReview({ reviewStatus: "completed", reviewResult: { reviewAnswer: "GREEN" } }), "approved")
  assert.equal(normalizeReview({ reviewStatus: "completed", reviewResult: { reviewAnswer: "RED", reviewRejectType: "RETRY" } }), "retry")
  assert.equal(normalizeReview({ reviewStatus: "completed", reviewResult: { reviewAnswer: "RED", reviewRejectType: "FINAL" } }), "rejected")
})

test("signed webhook accepts supported HMAC encodings and rejects tampering/legacy algorithms", () => {
  const body = JSON.stringify({ applicantId: "app_1" })
  const hex = createHmac("sha256", secret).update(body).digest("hex")
  const sha512 = createHmac("sha512", secret).update(body).digest("hex")
  assert.equal(verifyWebhookSignature(secret, body, hex, "HMAC_SHA256_HEX"), true)
  assert.equal(verifyWebhookSignature(secret, body, sha512, "HMAC_SHA512_HEX"), true)
  assert.equal(verifyWebhookSignature(secret, body + "!", hex, "HMAC_SHA256_HEX"), false)
  assert.equal(verifyWebhookSignature(secret, body, hex, "HMAC_SHA1"), false)
})

test("durable records use revision CAS and reject stale concurrent writers", async () => {
  const expiresAt = Date.now() + 60_000
  assert.equal(await createSumsubRecord({ version: 1, externalUserId, applicantId: "app_1", levelName: "id-and-liveness", status: "in_progress", expiresAt, activeSessionId: null, activeExpiresAt: 0, lastEventAt: 50 }, secret), true)
  const before = await readSumsubRecord(externalUserId, secret)
  assert.ok(before)
  const first = await mutateSumsubRecord(externalUserId, secret, row => ({ ...row, status: "pending", lastEventAt: 100 }))
  assert.equal(first?.revision, 1)
  const second = await mutateSumsubRecord(externalUserId, secret, row => ({ ...row, status: "approved", lastEventAt: 200 }))
  assert.equal(second?.revision, 2)
  assert.equal((await readSumsubRecord(externalUserId, secret))?.status, "approved")
})

test("provider status lookup is injectable and binds applicant and level", async () => {
  const config = { appToken: "sbx:fixture", secretKey: secret, webhookSecret: secret, sessionSecret: secret, accessCode: "fixture-access-code-1234", levelName: "id-and-liveness", origins: ["http://localhost:3000"] }
  const session = createSession(config, "http://localhost:3000", 1000)
  const calls: string[] = []
  const fetcher: typeof fetch = async (url) => { calls.push(String(url)); return calls.length === 1 ? Response.json({ id: "app_1", externalUserId: session.externalUserId, sandboxMode: true }) : Response.json({ levelName: config.levelName, reviewStatus: "pending" }) }
  assert.equal(await readVerifiedSandboxStatus(config, session, fetcher), "pending")
  assert.equal(calls.length, 2)
})

test("CX/read-only preview guards exclude the Sumsub surface", async () => {
  const { readSandboxConfig } = await import("../../lib/kyc/sumsub-sandbox")
  const base = { SUMSUB_MODE: "sandbox", NEXT_PUBLIC_ONDO_SUMSUB_SANDBOX: "1", SUMSUB_APP_TOKEN: "sbx:x", SUMSUB_SECRET_KEY: "s", SUMSUB_WEBHOOK_SECRET: "w", SUMSUB_SESSION_SECRET: secret, SUMSUB_PREVIEW_ACCESS_CODE: "access-code-fixture-1234", SUMSUB_LEVEL_NAME: "id-and-liveness", SUMSUB_ALLOWED_ORIGINS: "http://localhost:3000" }
  assert.equal(readSandboxConfig({ ...base, NEXT_PUBLIC_HK_PREVIEW_READ_ONLY: "1" }), null)
  assert.equal(readSandboxConfig({ ...base, NEXT_PUBLIC_HK_CX_PREVIEW: "1" }), null)
})

test("protected Preview requires a short, future expiry while local fixtures remain unchanged", async () => {
  const { readSandboxConfig } = await import("../../lib/kyc/sumsub-sandbox")
  const now = Date.parse("2026-09-27T00:00:00.000Z")
  const expiry = "2026-09-30T14:59:59.000Z"
  const base = { SUMSUB_MODE: "sandbox", NEXT_PUBLIC_ONDO_SUMSUB_SANDBOX: "1", VERCEL_ENV: "preview", VERCEL: "1", VERCEL_URL: "preview.example.vercel.app", SUMSUB_APP_TOKEN: "sbx:x", SUMSUB_SECRET_KEY: "s", SUMSUB_WEBHOOK_SECRET: "w", SUMSUB_SESSION_SECRET: secret, SUMSUB_PREVIEW_ACCESS_CODE: "access-code-fixture-1234", SUMSUB_LEVEL_NAME: "id-and-liveness", SUMSUB_ALLOWED_ORIGINS: "https://preview.example.vercel.app" }
  assert.equal(isPreviewExpiryValid(expiry, now), true)
  assert.equal(readSandboxConfig({ ...base, SUMSUB_PREVIEW_EXPIRES_AT: expiry }, now)?.levelName, "id-and-liveness")
  for (const value of [undefined, "not-a-date", "2026-09-26T23:59:59.000Z", "2026-10-01T00:00:00.000Z", "2026-09-30T14:59:59Z"])
    assert.equal(isPreviewExpiryValid(value, now), false)
  assert.equal(readSandboxConfig({ ...base }, now), null)
  const localBase = { ...base, VERCEL_ENV: "", VERCEL: undefined, VERCEL_URL: undefined, SUMSUB_ALLOWED_ORIGINS: "http://localhost:3000" }
  assert.equal(readSandboxConfig(localBase, now)?.levelName, "id-and-liveness")
})
