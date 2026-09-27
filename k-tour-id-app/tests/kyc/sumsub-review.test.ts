import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import test from "node:test"
import { NextRequest } from "next/server"
import { POST as startSession, DELETE as cancelSession } from "../../app/api/kyc/sumsub/session/route"
import { GET as sessionStatus } from "../../app/api/kyc/sumsub/status/route"
import { POST as receiveWebhook } from "../../app/api/kyc/sumsub/webhook/route"
import { assertSandboxRequest, createSession, readSandboxConfig, readSessionBody, readVerifiedSandboxStatus, SandboxError, sealSession, unsealRecoverySession, unsealSession, verifyWebhookSignature, webhookCreatedAt, RECOVERY_TTL_MS, SESSION_TTL_MS, type SandboxConfig } from "../../lib/kyc/sumsub-sandbox"
import { createSumsubRecord, mutateSumsubRecord, readSumsubRecord } from "../../lib/kyc/sumsub-store"

const origin = "http://localhost:3173"
const API_SECRET = "fixture-api-private-key-never-publish"
const WEBHOOK_SECRET = "fixture-webhook-private-key-never-publish"
const SESSION_SECRET = "fixture-session-private-key-never-publish"
const PROVIDER_PII = "fixture-person-name-passport-number-PII"
const config: SandboxConfig = {
  appToken: "sbx:fixture-app-token", secretKey: API_SECRET, webhookSecret: WEBHOOK_SECRET, sessionSecret: SESSION_SECRET,
  accessCode: "fixture-private-preview-code", levelName: "fixture-passport", origins: [origin],
}
const fixtureEnv = {
  NODE_ENV: "test", SUMSUB_MODE: "sandbox", NEXT_PUBLIC_ONDO_SUMSUB_SANDBOX: "1",
  SUMSUB_APP_TOKEN: config.appToken, SUMSUB_SECRET_KEY: API_SECRET, SUMSUB_SESSION_SECRET: SESSION_SECRET,
  SUMSUB_PREVIEW_ACCESS_CODE: config.accessCode, SUMSUB_LEVEL_NAME: config.levelName,
  SUMSUB_ALLOWED_ORIGINS: origin, SUMSUB_WEBHOOK_SECRET: WEBHOOK_SECRET,
} as const
function setup(extra: Record<string, string | undefined> = {}) {
  const originalEnv = process.env, originalFetch = globalThis.fetch
  process.env = { ...fixtureEnv, ...extra }
  globalThis.fetch = async () => { assert.fail("unexpected network: fixture not installed") }
  return () => { process.env = originalEnv; globalThis.fetch = originalFetch }
}
function request(path: "session" | "status" | "webhook", init: RequestInit = {}) {
  return new NextRequest(`${origin}/api/kyc/sumsub/${path}`, { ...init, signal: init.signal ?? undefined })
}
function browserHeaders(extra: Record<string, string> = {}) {
  return { origin, "x-ktour-kyc": "1", "content-type": "application/json", ...extra }
}
function assertRedacted(value: unknown) {
  const printed = JSON.stringify(value)
  for (const privateValue of [API_SECRET, WEBHOOK_SECRET, SESSION_SECRET, config.appToken, config.accessCode, PROVIDER_PII]) {
    assert.equal(printed.includes(privateValue), false)
  }
}

test("disabled and Production routes cannot create provider calls or cookies", async () => {
  for (const override of [{ SUMSUB_MODE: undefined }, { NEXT_PUBLIC_ONDO_SUMSUB_SANDBOX: "0" }, { VERCEL_ENV: "production" }]) {
    const restore = setup(override)
    try {
      const responses = [
        await startSession(request("session", { method: "POST", headers: browserHeaders(), body: JSON.stringify({ consent: true, accessCode: config.accessCode }) })),
        await sessionStatus(request("status", { headers: browserHeaders() })),
        await cancelSession(request("session", { method: "DELETE", headers: browserHeaders() })),
        await receiveWebhook(request("webhook", { method: "POST", body: "{}" })),
      ]
      for (const response of responses) {
        assert.equal(response.status, 503)
        assert.equal(response.headers.get("set-cookie"), null)
        assertRedacted(await response.json())
      }
    } finally { restore() }
  }
})

test("forged browser origin, omitted gate header and cross-site metadata fail before provider access", async () => {
  for (const headers of [
    browserHeaders({ origin: "https://foreign.invalid" }),
    { origin, "content-type": "application/json" },
    browserHeaders({ "sec-fetch-site": "cross-site" }),
  ]) {
    const restore = setup()
    try {
      const response = await startSession(request("session", { method: "POST", headers, body: JSON.stringify({ consent: true, accessCode: config.accessCode }) }))
      assert.equal(response.status, 403)
      assert.equal(response.headers.get("set-cookie"), null)
      assertRedacted(await response.json())
    } finally { restore() }
  }
})

test("provider lookup binds external user, sandbox and level before accepting any approval", async () => {
  const session = createSession(config, origin)
  for (const patch of [
    { applicant: { externalUserId: "foreign-user" } },
    { applicant: { sandboxMode: false } },
    { applicant: { sandboxMode: null } },
    { applicant: { sandboxMode: "true" } },
    { applicant: { id: "../../foreign?token=secret" } },
    { review: { levelName: "foreign-level" } },
  ]) {
    let calls = 0
    const fetcher: typeof fetch = async () => ++calls === 1
      ? Response.json({ id: "fixture_applicant", externalUserId: session.externalUserId, sandboxMode: true, ...patch.applicant, rawApplicant: PROVIDER_PII })
      : Response.json({ levelName: config.levelName, reviewStatus: "completed", reviewResult: { reviewAnswer: "GREEN" }, ...patch.review, rawReview: PROVIDER_PII })
    await assert.rejects(readVerifiedSandboxStatus(config, session, fetcher), error => {
      assert.ok(error instanceof SandboxError)
      assert.notEqual(error.code, "approved")
      assertRedacted({ message: error.message, stack: error.stack })
      return true
    })
  }
})

test("real applicant GET shape omits the webhook-only sandbox marker without weakening environment or identity binding", async () => {
  const session = createSession(config, origin)
  for (const status of ["init", "completed"]) {
    let calls = 0
    const fetcher: typeof fetch = async () => ++calls === 1
      ? Response.json({ id: "fixture_applicant", externalUserId: session.externalUserId })
      : Response.json({ levelName: config.levelName, reviewStatus: status, reviewResult: { reviewAnswer: "GREEN" } })
    assert.equal(await readVerifiedSandboxStatus(config, session, fetcher, "fixture_applicant"), status === "init" ? "in_progress" : "approved")
    assert.equal(calls, 2)
  }
  let calls = 0
  const fetcher: typeof fetch = async () => { calls++; throw new Error("must not call production") }
  await assert.rejects(readVerifiedSandboxStatus({ ...config, appToken: "prd:fixture" }, session, fetcher), error => error instanceof SandboxError && error.code === "provider_binding_mismatch")
  assert.equal(calls, 0)
})

test("provider status returns only a bounded status, never full applicant or review payloads", async () => {
  const session = createSession(config, origin)
  let calls = 0
  const fetcher: typeof fetch = async () => ++calls === 1
    ? Response.json({ id: "fixture_applicant", externalUserId: session.externalUserId, sandboxMode: true, info: { name: PROVIDER_PII }, key: API_SECRET })
    : Response.json({ levelName: config.levelName, reviewStatus: "completed", reviewResult: { reviewAnswer: "GREEN", comment: PROVIDER_PII }, accessToken: API_SECRET })
  assert.equal(await readVerifiedSandboxStatus(config, session, fetcher), "approved")
})

test("provider lookup cannot switch a previously bound applicant even for the same external user", async () => {
  const session = createSession(config, origin)
  let calls = 0
  const fetcher: typeof fetch = async () => { calls++; return Response.json({ id: "replacement_applicant", externalUserId: session.externalUserId, sandboxMode: true }) }
  await assert.rejects(readVerifiedSandboxStatus(config, session, fetcher, "original_applicant"), error => error instanceof SandboxError && error.code === "provider_binding_mismatch")
  assert.equal(calls, 1)
})

test("provider rejection and transport errors are sanitized and rejected bodies are discarded", async () => {
  const session = createSession(config, origin)
  let cancelled = false
  for (const fetcher of [
    (async () => new Response(new ReadableStream({ cancel() { cancelled = true; return new Promise<void>(() => undefined) } }), { status: 401 })) as typeof fetch,
    (async () => { throw new Error(`${API_SECRET} ${PROVIDER_PII}`) }) as typeof fetch,
    (async () => new Response(`not-json ${API_SECRET} ${PROVIDER_PII}`)) as typeof fetch,
    (async () => new Response("x".repeat(256 * 1024 + 1))) as typeof fetch,
  ]) {
    await assert.rejects(readVerifiedSandboxStatus(config, session, fetcher), error => {
      assert.ok(error instanceof SandboxError)
      assertRedacted({ message: error.message, stack: error.stack })
      return true
    })
  }
  assert.equal(cancelled, true)
})

test("session body rejects oversized, missing-consent and client-supplied result fields", async () => {
  for (const value of [{ consent: false }, { consent: true, status: "approved" }, { consent: true, externalUserId: "forged" }, { consent: true, locale: "other" }, { consent: true, accessCode: "x".repeat(1025) }]) {
    await assert.rejects(readSessionBody(request("session", { method: "POST", headers: browserHeaders(), body: JSON.stringify(value) })), error => {
      assert.ok(error instanceof SandboxError)
      assert.equal(error.status >= 400 && error.status < 500, true)
      return true
    })
  }
})

test("sealed sessions are origin/level/secret/expiry bound and never contain plaintext provider fields", () => {
  const now = 1_800_000_000_000
  const session = createSession(config, origin, now)
  const cookie = sealSession(session, config.sessionSecret)
  assert.deepEqual(unsealSession(cookie, config, origin, now + 1), session)
  assert.equal(unsealSession(cookie, config, "https://foreign.invalid", now + 1), null)
  assert.equal(unsealSession(cookie, { ...config, levelName: "foreign-level" }, origin, now + 1), null)
  assert.equal(unsealSession(cookie, { ...config, sessionSecret: "foreign-secret" }, origin, now + 1), null)
  assert.equal(unsealSession(cookie, config, origin, now - 1), null)
  assert.equal(unsealSession(cookie, config, origin, now + SESSION_TTL_MS), null)
  const tampered = cookie.slice(0, 15) + (cookie[15] === "A" ? "B" : "A") + cookie.slice(16)
  assert.equal(unsealSession(tampered, config, origin, now + 1), null)
  assert.notEqual(cookie, sealSession(session, config.sessionSecret))
  assert.equal(cookie.includes(session.externalUserId), false)
  assertRedacted(cookie)
})

test("API request-signing secret cannot authorize a webhook: use the separate webhook secret", async () => {
  const restore = setup()
  try {
    const body = JSON.stringify({ type: "applicantReviewed", applicantId: "fixture_applicant", externalUserId: createSession(config, origin).externalUserId,
      levelName: config.levelName, testMode: true, createdAtMs: String(Date.now()), reviewStatus: "completed", reviewResult: { reviewAnswer: "GREEN" } })
    const response = await receiveWebhook(request("webhook", { method: "POST", headers: {
      "content-type": "application/json", "x-payload-digest-alg": "HMAC_SHA256_HEX",
      "x-payload-digest": createHmac("sha256", API_SECRET).update(body).digest("hex"),
    }, body }))
    assert.equal(response.status, 401)
    assertRedacted(await response.json())
  } finally { restore() }
})

async function acceleratedDeadlines<T>(work: () => Promise<T>): Promise<T | "fixture-deadline-exceeded"> {
  const originalTimeout = globalThis.setTimeout, originalSignalTimeout = AbortSignal.timeout
  let watchdog: ReturnType<typeof setTimeout> | undefined
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => originalTimeout(callback, Math.max(1, Math.min((ms ?? 0) / 1000, 20)), ...args)) as typeof setTimeout
  AbortSignal.timeout = () => originalSignalTimeout(20)
  try {
    return await Promise.race([work(), new Promise<"fixture-deadline-exceeded">(resolve => { watchdog = originalTimeout(() => resolve("fixture-deadline-exceeded"), 500) })])
  } finally { clearTimeout(watchdog); globalThis.setTimeout = originalTimeout; AbortSignal.timeout = originalSignalTimeout }
}

test("provider fetch and response-body deadlines settle even if a transport ignores abort", async () => {
  const session = createSession(config, origin)
  for (const fetcher of [
    (() => new Promise<Response>(() => undefined)) as typeof fetch,
    (async () => new Response(new ReadableStream({ start() { /* malicious stalled body */ } }))) as typeof fetch,
  ]) {
    const outcome = await acceleratedDeadlines(() => readVerifiedSandboxStatus(config, session, fetcher).then(() => "unexpected-success", error => error))
    assert.notEqual(outcome, "fixture-deadline-exceeded", "Abort alone is not a returned deadline")
    assert.ok(outcome instanceof SandboxError)
    assertRedacted({ message: outcome.message })
  }
})

test("session JSON read has a returned deadline for a never-ending small request body", async () => {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined
  const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value; value.enqueue(Buffer.from("{")) } })
  const pendingRequest = request("session", { method: "POST", headers: browserHeaders(), body: stream, duplex: "half" } as RequestInit)
  try {
    const outcome = await acceleratedDeadlines(() => readSessionBody(pendingRequest).then(() => "unexpected-success", error => error))
    assert.notEqual(outcome, "fixture-deadline-exceeded", "Request size limit must also bound waiting for bytes")
    assert.ok(outcome instanceof SandboxError)
  } finally { try { controller?.error(new Error("fixture cleanup")) } catch { /* already canceled */ } }
})

test("webhook signatures follow documented hex-only headers and compare the original bytes", () => {
  const raw = Buffer.from([0x7b, 0xff, 0x7d])
  for (const [algorithm, hash] of [["HMAC_SHA256_HEX", "sha256"], ["HMAC_SHA512_HEX", "sha512"]] as const) {
    const digest = createHmac(hash, WEBHOOK_SECRET).update(raw).digest("hex")
    assert.equal(verifyWebhookSignature(WEBHOOK_SECRET, raw, digest, algorithm), true)
    assert.equal(verifyWebhookSignature(WEBHOOK_SECRET, raw.toString("utf8"), digest, algorithm), false)
    assert.equal(verifyWebhookSignature(API_SECRET, raw, digest, algorithm), false)
    assert.equal(verifyWebhookSignature(WEBHOOK_SECRET, raw, digest.slice(1), algorithm), false)
  }
  for (const algorithm of [null, "HMAC_SHA512", "HMAC_SHA1_HEX", "sha256", "HMAC_SHA256_HEX,HMAC_SHA512_HEX"]) {
    assert.equal(verifyWebhookSignature(WEBHOOK_SECRET, raw, createHmac("sha512", WEBHOOK_SECRET).update(raw).digest("base64"), algorithm), false)
  }
})

test("provider event timestamps are parsed as UTC, reject normalized invalid dates and future payloads", () => {
  const now = Date.parse("2026-09-27T01:02:03.456Z")
  assert.equal(webhookCreatedAt("2026-09-27 01:02:03.456", now), now)
  for (const value of [String(now), now, "2026-09-27T01:02:03.456Z", "2026-02-30 01:02:03.456", "2026-09-27 01:08:03.456", "2026-09-27 01:02:03"])
    assert.equal(webhookCreatedAt(value, now), null)
})

test("recovery lasts beyond the active session but remains bound to its absolute expiry and audience", () => {
  const now = 1_800_000_000_000, session = createSession(config, origin, now), cookie = sealSession(session, config.sessionSecret)
  assert.equal(unsealSession(cookie, config, origin, now + SESSION_TTL_MS + 1), null)
  assert.deepEqual(unsealRecoverySession(cookie, config, origin, now + SESSION_TTL_MS + 1), session)
  assert.equal(unsealRecoverySession(cookie, config, origin, now + RECOVERY_TTL_MS), null)
  assert.equal(unsealRecoverySession(cookie, config, "https://foreign.invalid", now + 1), null)
  for (const patch of [{ sessionId: "forged" }, { recoveryExpiresAt: now + RECOVERY_TTL_MS + 1 }, { expiresAt: now + SESSION_TTL_MS + 1 }]) {
    assert.equal(unsealRecoverySession(sealSession({ ...session, ...patch }, config.sessionSecret), config, origin, now + 1), null)
  }
})

test("Vercel browser origin is pinned to deployment metadata and exact proxy headers, not internal request authority", () => {
  const host = "sumsub-fixture.vercel.app", canonical = `https://${host}`
  const restore = setup({ VERCEL: "1", VERCEL_ENV: "preview", VERCEL_URL: host })
  const remoteConfig = { ...config, origins: [canonical] }
  const headers = { ...browserHeaders({ origin: canonical }), host, "x-forwarded-host": host, "x-forwarded-proto": "https" }
  try {
    const call = (patch: Record<string, string> = {}) => assertSandboxRequest(new Request("http://n/api/kyc/sumsub/session", { method: "POST", headers: { ...headers, ...patch } }), remoteConfig, true)
    assert.equal(call(), canonical)
    const rejected: Record<string, string>[] = [{ host: "foreign.vercel.app" }, { "x-forwarded-host": "foreign.vercel.app" }, { "x-forwarded-host": "" }, { "x-forwarded-proto": "http" }, { "x-forwarded-proto": "https,http" }, { origin: "https://foreign.vercel.app" }]
    for (const patch of rejected) assert.throws(() => call(patch), SandboxError)
    process.env.VERCEL_ENV = "production"
    assert.throws(() => call(), SandboxError)
  } finally { restore() }
})

test("missing webhook credentials disables only webhooks, while CX and read-only profiles disable all routes", async () => {
  const restore = setup({ SUMSUB_WEBHOOK_SECRET: undefined })
  try {
    assert.ok(readSandboxConfig())
    const response = await receiveWebhook(request("webhook", { method: "POST", body: "{}" }))
    assert.equal(response.status, 503)
    for (const flag of ["NEXT_PUBLIC_HK_CX_PREVIEW", "NEXT_PUBLIC_HK_PREVIEW_READ_ONLY"]) {
      process.env[flag] = "1"
      assert.equal(readSandboxConfig(), null)
      delete process.env[flag]
    }
  } finally { restore() }
})

async function seedRecord(status: "pending" | "approved" = "pending") {
  const session = createSession(config, origin)
  assert.equal(await createSumsubRecord({ version: 1, externalUserId: session.externalUserId, applicantId: "fixture_applicant", levelName: config.levelName,
    status, lastEventAt: 0, expiresAt: session.recoveryExpiresAt, activeSessionId: session.sessionId, activeExpiresAt: session.expiresAt }, config.sessionSecret), true)
  return session
}
function eventFor(externalUserId: string, patch: Record<string, unknown> = {}) {
  return { applicantId: "fixture_applicant", externalUserId, levelName: config.levelName, sandboxMode: true, type: "applicantReviewed",
    createdAtMs: new Date(Date.now() - 1_000).toISOString().replace("T", " ").replace("Z", ""), eventId: "event-fixture-1",
    reviewStatus: "completed", reviewResult: { reviewAnswer: "GREEN", clientComment: PROVIDER_PII }, ...patch }
}
async function webhook(value: Record<string, unknown>, options: { algorithm?: string; aliasHeader?: boolean; bytes?: Buffer } = {}) {
  const raw = options.bytes ?? Buffer.from(JSON.stringify(value)), algorithm = options.algorithm ?? "HMAC_SHA256_HEX"
  const digest = createHmac(algorithm === "HMAC_SHA512_HEX" ? "sha512" : "sha256", WEBHOOK_SECRET).update(raw).digest("hex")
  return receiveWebhook(request("webhook", { method: "POST", headers: { "content-type": "application/json", "x-payload-digest-alg": algorithm,
    [options.aliasHeader ? "x-signature" : "x-payload-digest"]: digest }, body: new Uint8Array(raw) }))
}

test("signed GREEN webhook is only a refresh hint and preserves revocation, status and absolute expiry", async () => {
  const restore = setup({ SUMSUB_LOCAL_MEMORY: "1" })
  try {
    const session = await seedRecord("approved")
    await mutateSumsubRecord(session.externalUserId, config.sessionSecret, current => ({ ...current, activeSessionId: null, activeExpiresAt: 0 }))
    const before = await readSumsubRecord(session.externalUserId, config.sessionSecret)
    globalThis.fetch = async (_url, init) => {
      assert.equal(init?.redirect, "error"); assert.equal(init?.method, "GET")
      return Response.json({ id: "fixture_applicant", externalUserId: session.externalUserId, sandboxMode: true, info: PROVIDER_PII })
    }
    const response = await webhook(eventFor(session.externalUserId), { algorithm: "HMAC_SHA512_HEX" })
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true, applied: true })
    const after = await readSumsubRecord(session.externalUserId, config.sessionSecret)
    assert.equal(after?.status, before?.status)
    assert.equal(after?.activeSessionId, null); assert.equal(after?.activeExpiresAt, 0)
    assert.equal(after?.expiresAt, before?.expiresAt); assert.equal(after?.needsRefresh, true)
    assert.equal(after?.revision, (before?.revision ?? 0) + 1)
    assertRedacted(after)
  } finally { restore() }
})

test("webhooks cannot seed an unknown user, use production/manual samples, wrong applicant or forged headers", async () => {
  const restore = setup({ SUMSUB_LOCAL_MEMORY: "1" })
  try {
    const session = await seedRecord()
    for (const patch of [{ sandboxMode: false }, { sandboxMode: undefined }, { applicantId: "foreign_applicant" }, { levelName: "foreign" }, { type: "applicantActionReviewed" }, { createdAtMs: "not-date" }, { externalUserId: createSession(config, origin).externalUserId }]) {
      const response = await webhook(eventFor(session.externalUserId, patch))
      assert.equal(response.status, 400); assertRedacted(await response.json())
    }
    const manual = await webhook(eventFor(session.externalUserId, { testMode: true }))
    assert.deepEqual(await manual.json(), { ok: true, applied: false })
    const alias = await webhook(eventFor(session.externalUserId), { aliasHeader: true })
    assert.equal(alias.status, 401)
    assert.equal((await readSumsubRecord(session.externalUserId, config.sessionSecret))?.needsRefresh, undefined)
  } finally { restore() }
})

test("webhook re-query accepts the actual marker-free GET shape but not contradictory environment data", async () => {
  const restore = setup({ SUMSUB_LOCAL_MEMORY: "1" })
  try {
    for (const marker of [false, null, "true", "omitted"] as const) {
      const session = await seedRecord()
      globalThis.fetch = async () => Response.json({ id: "fixture_applicant", externalUserId: session.externalUserId,
        ...(marker === "omitted" ? {} : { sandboxMode: marker }) })
      const response = await webhook(eventFor(session.externalUserId))
      assert.equal(response.status, marker === "omitted" ? 200 : 400)
      const saved = await readSumsubRecord(session.externalUserId, config.sessionSecret)
      assert.equal(saved?.needsRefresh === true, marker === "omitted")
      assert.equal(saved?.status, "pending")
    }
  } finally { restore() }
})

test("webhooks replayed or reordered after a newer event do not mutate state or call the provider", async () => {
  const restore = setup({ SUMSUB_LOCAL_MEMORY: "1" })
  try {
    const session = await seedRecord(), value = eventFor(session.externalUserId)
    let calls = 0
    globalThis.fetch = async () => { calls++; return Response.json({ id: "fixture_applicant", externalUserId: session.externalUserId, sandboxMode: true }) }
    assert.deepEqual(await (await webhook(value)).json(), { ok: true, applied: true })
    const first = await readSumsubRecord(session.externalUserId, config.sessionSecret)
    for (const replay of [value, { ...value, eventId: "equal-time-different-id" }, { ...value, eventId: "older-event", createdAtMs: "2020-01-01 00:00:00.000" }]) {
      assert.deepEqual(await (await webhook(replay)).json(), { ok: true, applied: false })
    }
    assert.equal(calls, 1)
    assert.deepEqual(await readSumsubRecord(session.externalUserId, config.sessionSecret), first)
    assert.equal(first?.status, "pending")
  } finally { restore() }
})

test("webhook provider and Redis faults are redacted retryable errors, never invalid-payload success", async () => {
  const restore = setup({ SUMSUB_LOCAL_MEMORY: "1" })
  try {
    const session = await seedRecord(), value = eventFor(session.externalUserId)
    for (const fetcher of [
      (async () => new Response(PROVIDER_PII, { status: 401 })) as typeof fetch,
      (async () => { throw new Error(`${API_SECRET} ${PROVIDER_PII}`) }) as typeof fetch,
      (async () => Response.json({ id: "foreign", externalUserId: session.externalUserId, sandboxMode: true })) as typeof fetch,
    ]) {
      globalThis.fetch = fetcher
      const response = await webhook(value)
      assert.ok([400, 503].includes(response.status)); assertRedacted(await response.json())
    }
    process.env.UPSTASH_REDIS_REST_URL = "https://fixture.upstash.io"
    process.env.UPSTASH_REDIS_REST_TOKEN = "fixture-redis-secret-never-publish"
    globalThis.fetch = async () => { throw new Error("fixture-redis-secret-never-publish") }
    const response = await webhook(value)
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), { error: "unavailable" })
  } finally { restore() }
})

test("webhook raw-byte size, UTF-8 and stalled-stream limits settle and cancel the body", async () => {
  const restore = setup()
  try {
    const oversized = await webhook({}, { bytes: Buffer.alloc(256 * 1024 + 1, 0x20) })
    assert.equal(oversized.status, 413)
    const malformed = await webhook({}, { bytes: Buffer.from([0x7b, 0xff, 0x7d]) })
    assert.equal(malformed.status, 400)
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(Buffer.from("{")) }, cancel() { cancelled = true; return new Promise<void>(() => undefined) } })
    const pending = request("webhook", { method: "POST", headers: { "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit)
    const outcome = await acceleratedDeadlines(() => receiveWebhook(pending))
    assert.notEqual(outcome, "fixture-deadline-exceeded")
    assert.ok(outcome instanceof Response); assert.equal(outcome.status, 408); assert.equal(cancelled, true)
  } finally { restore() }
})

test("whole webhook response is bounded and a provider result arriving after timeout cannot mutate state", async () => {
  const restore = setup({ SUMSUB_LOCAL_MEMORY: "1" })
  try {
    const session = await seedRecord(), before = await readSumsubRecord(session.externalUserId, config.sessionSecret)
    let resolveProvider: ((response: Response) => void) | undefined, signal: AbortSignal | null | undefined
    globalThis.fetch = async (_url, init) => { signal = init?.signal; return new Promise<Response>(resolve => { resolveProvider = resolve }) }
    const outcome = await acceleratedDeadlines(() => webhook(eventFor(session.externalUserId)))
    assert.notEqual(outcome, "fixture-deadline-exceeded")
    assert.ok(outcome instanceof Response); assert.equal(outcome.status, 503)
    assert.equal(signal?.aborted, true)
    resolveProvider?.(Response.json({ id: "fixture_applicant", externalUserId: session.externalUserId, sandboxMode: true }))
    // Let the late response and its cleanup finish without using another deadline.
    await new Promise<void>(resolve => setImmediate(resolve))
    assert.deepEqual(await readSumsubRecord(session.externalUserId, config.sessionSecret), before)
  } finally { restore() }
})
