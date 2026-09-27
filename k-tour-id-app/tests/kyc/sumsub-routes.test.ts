import assert from "node:assert/strict"
import test from "node:test"
import { NextRequest } from "next/server"
import { POST as start, DELETE as close } from "../../app/api/kyc/sumsub/session/route"
import { GET as status } from "../../app/api/kyc/sumsub/status/route"

process.env.SUMSUB_LOCAL_MEMORY = "1"
for (const key of ["VERCEL", "VERCEL_ENV", "VERCEL_URL", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_URL", "KV_REST_API_TOKEN", "SUMSUB_STORE_NAMESPACE"]) delete process.env[key]
Object.assign(process.env, {
  SUMSUB_MODE: "sandbox", NEXT_PUBLIC_ONDO_SUMSUB_SANDBOX: "1", VERCEL_ENV: "",
  SUMSUB_APP_TOKEN: "sbx:fixture", SUMSUB_SECRET_KEY: "provider-secret-fixture",
  SUMSUB_WEBHOOK_SECRET: "webhook-secret-fixture", SUMSUB_SESSION_SECRET: "session-secret-fixture-012345678901234567890123",
  SUMSUB_PREVIEW_ACCESS_CODE: "access-code-fixture-1234", SUMSUB_LEVEL_NAME: "id-and-liveness", SUMSUB_ALLOWED_ORIGINS: "http://localhost:3000",
})

const base = "http://localhost:3000"
function req(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set("x-ktour-kyc", "1"); headers.set("origin", base)
  return new NextRequest(`${base}${path}`, { method: init.method, headers, body: init.body, signal: init.signal ?? undefined })
}
function cookie(response: Response, name: string) { return response.headers.get("set-cookie")?.match(new RegExp(`${name}=([^;]*)`))?.[1] ?? "" }

test("session gate, status recovery, and DELETE recovery cookie preserve one applicant", async () => {
  const oldFetch = globalThis.fetch
  const users: string[] = []
  try {
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { userId?: string }
      if (body.userId) users.push(body.userId)
      return Response.json({ token: "sdk-token-fixture", userId: body.userId })
    }
    const denied = await start(req("/api/kyc/sumsub/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ consent: true }) }))
    assert.equal(denied.status, 401)
    const first = await start(req("/api/kyc/sumsub/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ consent: true, accessCode: "access-code-fixture-1234" }) }))
    assert.equal(first.status, 200)
    const active = cookie(first, "ktour_sumsub_sandbox")
    assert.ok(active)
    globalThis.fetch = async (url) => String(url).includes("/one")
      ? Response.json({ id: "app_fixture", externalUserId: users[0], sandboxMode: true })
      : Response.json({ levelName: "id-and-liveness", reviewStatus: "pending" })
    const current = await status(req("/api/kyc/sumsub/status", { headers: { cookie: `ktour_sumsub_sandbox=${active}` } }))
    assert.equal((await current.json()).status, "pending")
    const closed = await close(req("/api/kyc/sumsub/session", { method: "DELETE", headers: { cookie: `ktour_sumsub_sandbox=${active}` } }))
    assert.equal(closed.status, 204)
    const recovery = cookie(closed, "ktour_sumsub_sandbox_recovery")
    assert.ok(recovery)
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { userId?: string }
      users.push(body.userId ?? "")
      return Response.json({ token: "sdk-token-fixture-2", userId: body.userId })
    }
    const resumed = await start(req("/api/kyc/sumsub/session", { method: "POST", headers: { cookie: `ktour_sumsub_sandbox_recovery=${recovery}`, "content-type": "application/json" }, body: JSON.stringify({ consent: true, accessCode: "access-code-fixture-1234" }) }))
    assert.equal(resumed.status, 200)
    assert.equal(users.length, 2)
    assert.equal(users[0], users[1])
  } finally { globalThis.fetch = oldFetch }
})

test("cross-origin status is rejected before provider access", async () => {
  const oldFetch = globalThis.fetch
  let calls = 0
  try {
    globalThis.fetch = async () => { calls++; return Response.json({}) }
    const response = await status(new NextRequest(`${base}/api/kyc/sumsub/status`, { headers: { "x-ktour-kyc": "1", origin: "https://evil.invalid" } }))
    assert.equal(response.status, 403)
    assert.equal(calls, 0)
  } finally { globalThis.fetch = oldFetch }
})
