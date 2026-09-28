import assert from "node:assert/strict"
import test from "node:test"
import { NextRequest } from "next/server"
import { POST as start, DELETE as close } from "../../app/api/kyc/sumsub/session/route"
import { GET as status } from "../../app/api/kyc/sumsub/status/route"
import { SESSION_COOKIE, RECOVERY_COOKIE } from "../../lib/kyc/sumsub-sandbox"

const origin = "http://localhost:3000"
const accessCode = "access-code-fixture-race-1234"
const fixture = {
  NODE_ENV: "test", SUMSUB_LOCAL_MEMORY: "1", SUMSUB_MODE: "sandbox",
  NEXT_PUBLIC_ONDO_SUMSUB_SANDBOX: "1", SUMSUB_APP_TOKEN: "sbx:fixture-race",
  SUMSUB_SECRET_KEY: "provider-secret-fixture", SUMSUB_WEBHOOK_SECRET: "webhook-secret-fixture",
  SUMSUB_SESSION_SECRET: "session-secret-fixture-races-012345678901234567890123",
  SUMSUB_PREVIEW_ACCESS_CODE: accessCode, SUMSUB_LEVEL_NAME: "id-and-liveness",
  SUMSUB_ALLOWED_ORIGINS: origin,
} as const
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
function request(path: "session" | "status", method = "GET", cookies = "", access = false) {
  return new NextRequest(`${origin}/api/kyc/sumsub/${path}`, {
    method, headers: {
      origin, "x-ktour-kyc": "1", ...(cookies ? { cookie: cookies } : {}),
      ...(method === "POST" ? { "content-type": "application/json" } : {}),
    },
    ...(method === "POST" ? { body: JSON.stringify({ consent: true, ...(access ? { accessCode } : {}) }) } : {}),
  })
}
function cookie(response: Response, name: string) {
  const value = response.headers.get("set-cookie")?.match(new RegExp(`(?:^|, )${name}=([^;]*)`))?.[1]
  assert.ok(value, `Expected ${name} cookie`)
  return `${name}=${value}`
}
async function withinFixture(work: () => Promise<void>) {
  const oldEnv = process.env, oldFetch = globalThis.fetch, oldNow = Date.now
  process.env = { ...fixture, NODE_ENV: "test" as const }
  globalThis.fetch = async () => { throw new Error("Unexpected fixture request") }
  try { await work() } finally { process.env = oldEnv; globalThis.fetch = oldFetch; Date.now = oldNow }
}
function sdkReply(init?: RequestInit) {
  const body = JSON.parse(String(init?.body)) as { userId: string }
  assert.match(body.userId, /^ktour-sbx-/)
  return { user: body.userId, response: Response.json({ token: "fake-sdk-token", userId: body.userId }) }
}
async function fresh() {
  let user = ""
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://api.sumsub.com/resources/accessTokens/sdk")
    const reply = sdkReply(init); user = reply.user; return reply.response
  }
  const response = await start(request("session", "POST", "", true))
  assert.equal(response.status, 200)
  return { user, active: cookie(response, SESSION_COOKIE), recovery: cookie(response, RECOVERY_COOKIE) }
}

test("a late approved provider reply cannot replace cancellation and a fresh session", () => withinFixture(async () => {
  const first = await fresh()
  const entered = deferred<void>(), delayed = deferred<Response>()
  globalThis.fetch = async url => {
    if (String(url).endsWith("/one")) { entered.resolve(); return delayed.promise }
    assert.equal(String(url), "https://api.sumsub.com/resources/applicants/app_fixture/status")
    return Response.json({ levelName: "id-and-liveness", reviewStatus: "completed", reviewResult: { reviewAnswer: "GREEN" } })
  }
  const staleStatus = status(request("status", "GET", first.active))
  await entered.promise
  assert.equal((await close(request("session", "DELETE", first.active))).status, 204)
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith("/sdk")) return sdkReply(init).response
    assert.equal(String(url), "https://api.sumsub.com/resources/applicants/app_fixture/status")
    return Response.json({ levelName: "id-and-liveness", reviewStatus: "completed", reviewResult: { reviewAnswer: "GREEN" } })
  }
  const replacement = await start(request("session", "POST", first.recovery, true))
  assert.equal(replacement.status, 200)
  delayed.resolve(Response.json({ id: "app_fixture", externalUserId: first.user, sandboxMode: true }))
  const stale = await staleStatus
  assert.equal(stale.status, 503)
  assert.deepEqual(await stale.json(), { status: "unavailable", configured: true, environment: "sandbox", error: "status_changed_retry" })
  globalThis.fetch = async url => String(url).endsWith("/one")
    ? Response.json({ id: "app_fixture", externalUserId: first.user, sandboxMode: true })
    : Response.json({ levelName: "id-and-liveness", reviewStatus: "pending" })
  const current = await status(request("status", "GET", cookie(replacement, SESSION_COOKIE)))
  assert.equal(current.status, 200)
  assert.equal((await current.json()).status, "pending")
}))

test("late token response and old DELETE cannot reactivate or revoke a replacement session", () => withinFixture(async () => {
  const first = await fresh()
  const entered = deferred<void>(), delayed = deferred<Response>()
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://api.sumsub.com/resources/accessTokens/sdk")
    assert.equal(sdkReply(init).user, first.user)
    entered.resolve(); return delayed.promise
  }
  const renewal = start(request("session", "POST", first.active))
  await entered.promise
  assert.equal((await close(request("session", "DELETE", first.active))).status, 204)
  globalThis.fetch = async (_url, init) => sdkReply(init).response
  const replacement = await start(request("session", "POST", first.recovery, true))
  assert.equal(replacement.status, 200)
  delayed.resolve(Response.json({ token: "late-fake-token", userId: first.user }))
  const late = await renewal
  assert.equal(late.status, 401)
  assert.equal((await late.json()).error, "session_expired")
  assert.equal(late.headers.get("set-cookie"), null, "Late POST must not overwrite the replacement browser cookies")
  let calls = 0
  globalThis.fetch = async url => {
    calls++
    return String(url).endsWith("/one")
      ? Response.json({ id: "app_fixture", externalUserId: first.user, sandboxMode: true })
      : Response.json({ levelName: "id-and-liveness", reviewStatus: "pending" })
  }
  assert.equal((await status(request("status", "GET", first.active))).status, 401)
  assert.equal(calls, 0, "Revoked stale cookie must not query provider")
  const staleClose = await close(request("session", "DELETE", first.active))
  assert.equal(staleClose.status, 204)
  assert.equal(staleClose.headers.get("set-cookie"), null, "Old DELETE must not clear or replace the newer cookies")
  const current = await status(request("status", "GET", cookie(replacement, SESSION_COOKIE)))
  assert.equal(current.status, 200)
  assert.equal((await current.json()).status, "pending")
  assert.equal(calls, 2)
}))

test("parallel recovery preserves one applicant and grants only one replacement session", () => withinFixture(async () => {
  const first = await fresh()
  assert.equal((await close(request("session", "DELETE", first.active))).status, 204)
  const users: string[] = []
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://api.sumsub.com/resources/accessTokens/sdk")
    const reply = sdkReply(init); users.push(reply.user); return reply.response
  }
  const attempts = await Promise.all([
    start(request("session", "POST", first.recovery, true)),
    start(request("session", "POST", first.recovery, true)),
  ])
  assert.deepEqual(attempts.map(response => response.status).sort(), [200, 409])
  assert.deepEqual(users, [first.user])
  const denied = await start(request("session", "POST", first.recovery))
  assert.equal(denied.status, 401)
  assert.deepEqual(users, [first.user])
}))

test("a token reply arriving after active-session expiry emits no cookies", () => withinFixture(async () => {
  const now = Date.now()
  Date.now = () => now
  const first = await fresh()
  const entered = deferred<void>(), delayed = deferred<Response>()
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://api.sumsub.com/resources/accessTokens/sdk")
    assert.equal(sdkReply(init).user, first.user)
    entered.resolve(); return delayed.promise
  }
  const renewal = start(request("session", "POST", first.active))
  await entered.promise
  Date.now = () => now + 31 * 60 * 1000
  delayed.resolve(Response.json({ token: "expired-fake-token", userId: first.user }))
  const late = await renewal
  assert.equal(late.status, 401)
  assert.equal((await late.json()).error, "session_expired")
  assert.equal(late.headers.get("set-cookie"), null)
}))

test("an uncertain provider failure preserves recovery cookies only for the current session", () => withinFixture(async () => {
  const users: string[] = []
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://api.sumsub.com/resources/accessTokens/sdk")
    users.push(sdkReply(init).user)
    return Response.json({ error: "fixture-private-provider-diagnostic" }, { status: 503 })
  }
  const failure = await start(request("session", "POST", "", true))
  assert.equal(failure.status, 503)
  assert.deepEqual(await failure.json(), { status: "unavailable", error: "provider_unavailable", configured: true, environment: "sandbox" })
  const active = cookie(failure, SESSION_COOKIE)
  assert.ok(cookie(failure, RECOVERY_COOKIE))
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://api.sumsub.com/resources/accessTokens/sdk")
    const reply = sdkReply(init); users.push(reply.user); return reply.response
  }
  const retried = await start(request("session", "POST", active))
  assert.equal(retried.status, 200)
  assert.equal(users.length, 2)
  assert.equal(users[0], users[1], "Provider retry must reuse the applicant created before the uncertain response")
}))
