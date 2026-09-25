import assert from "node:assert/strict"
import { after, before, test } from "node:test"

// This suite exercises the preview boundary without starting Next or touching a
// provider. Keep deliberately live-looking inherited values in the environment:
// the guard must run before config, cookies, request bodies, or fetch are read.
const envKeys = [
  "NEXT_PUBLIC_HK_PREVIEW_READ_ONLY", "HK_API_ENABLED", "NEXT_PUBLIC_HK_ENABLED",
  "HK_ISOLATED_MOCK", "GEMINI_API_KEY", "HK_MODE_CX", "HK_MODE_OPENDID", "HK_AI_MODE",
  "HK_SUI_PACKAGE_ID", "HK_SUI_CAMPAIGN_ID", "HK_SUI_ISSUER_SECRET_KEY", "HK_OMNIONE_RPC_URL",
] as const
const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]))
const originalFetch = globalThis.fetch
let attemptedNetwork: string[] = []

process.env.NEXT_PUBLIC_HK_PREVIEW_READ_ONLY = "1"
delete process.env.HK_API_ENABLED
delete process.env.NEXT_PUBLIC_HK_ENABLED
Object.assign(process.env, {
  HK_ISOLATED_MOCK: "0",
  GEMINI_API_KEY: "inherited-live-sentinel",
  HK_MODE_CX: "cx",
  HK_MODE_OPENDID: "opendid",
  HK_AI_MODE: "gemini",
  HK_SUI_PACKAGE_ID: "inherited-live-sentinel",
  HK_SUI_CAMPAIGN_ID: "inherited-live-sentinel",
  HK_SUI_ISSUER_SECRET_KEY: "inherited-live-sentinel",
  HK_OMNIONE_RPC_URL: "https://provider.invalid",
})

const route = await import("../../app/api/hackathon/v1/[...path]/route")
const ask = await import("../../app/api/ask/route")
const chat = await import("../../app/api/chat/route")
const readiness = await import("../../lib/hackathon/preview-readiness")

before(() => {
  attemptedNetwork = []
  globalThis.fetch = async input => {
    attemptedNetwork.push(String(input))
    throw new Error("preview readiness test forbids network")
  }
})

after(() => {
  globalThis.fetch = originalFetch
  for (const key of envKeys) {
    const value = originalEnv[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  assert.deepEqual(attemptedNetwork, [], "preview-read-only guard allowed an external request")
})

const ctx = (path: string[]) => ({ params: Promise.resolve({ path }) })
const json = async (response: Response) => await response.json() as Record<string, any>

test("preview readiness is an exact opt-in and publishes a non-cacheable isolated config", async () => {
  assert.equal(readiness.isReadinessPreview(), true)
  const response = await route.GET(new Request("http://localhost/api/hackathon/v1/config"), ctx(["config"]))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("cache-control"), "no-store")
  const body = await json(response)
  assert.equal(body.previewReadOnly, true)
  assert.equal(body.isolatedMock, true)
  assert.equal(body.capabilities?.chainExecutionEnabled, false)
})

test("read-only hackathon GET rejects session reads and malformed config paths", async () => {
  const blocked = await route.GET(new Request("http://localhost/api/hackathon/v1/me", { headers: { cookie: "session=sentinel" } }), ctx(["me"]))
  assert.equal(blocked.status, 503)
  assert.equal((await json(blocked)).error?.code, "preview_read_only")

  const nested = await route.GET(new Request("http://localhost/api/hackathon/v1/config/extra"), ctx(["config", "extra"]))
  assert.equal(nested.status, 503)
  assert.equal((await json(nested)).error?.code, "preview_read_only")

  const extra = await route.GET(new Request("http://localhost/api/hackathon/v1/readiness/cx/extra"), ctx(["readiness", "cx", "extra"]))
  assert.equal(extra.status, 503)
  assert.equal((await json(extra)).error?.code, "preview_read_only")
})

test("read-only hackathon POST rejects before same-origin, cookies, body parsing, or provider code", async () => {
  const request = new Request("http://evil.invalid/api/hackathon/v1/sessions", {
    method: "POST",
    headers: { cookie: "session=sentinel", origin: "https://evil.invalid", "content-type": "application/json" },
    body: "{ this body must not be parsed",
  })
  const response = await route.POST(request, ctx(["sessions"]))
  assert.equal(response.status, 503)
  assert.equal((await json(response)).error?.code, "preview_read_only")

  const diagnosticPost = await route.POST(new Request("http://localhost/api/hackathon/v1/readiness/cx", { method: "POST" }), ctx(["readiness", "cx"]))
  assert.equal(diagnosticPost.status, 503)
  assert.equal((await json(diagnosticPost)).error?.code, "preview_read_only")

  const redis = await route.POST(new Request("http://localhost/api/hackathon/v1/readiness/redis", { method: "POST" }), ctx(["readiness", "redis"]))
  assert.equal(redis.status, 404, "operator diagnostic must be disabled outside its exact remote profile")
  for (const path of [["readiness", "redis", "extra"], ["operations", "sentinel", "reconcile"], ["operations", "sentinel", "credential", "issue"]]) {
    const denied = await route.POST(new Request("http://localhost/api/hackathon/v1/" + path.join("/"), { method: "POST" }), ctx(path))
    assert.equal(denied.status, 503)
  }
})

test("ask and chat reject preview POSTs before reading a live-looking body", async () => {
  const request = () => new Request("http://localhost/api", { method: "POST", body: "{ malformed" })
  const askResponse = await ask.POST(request())
  const chatResponse = await chat.POST(request())
  assert.equal(askResponse.status, 503)
  assert.equal(chatResponse.status, 503)
  assert.equal((await json(askResponse)).error?.code, "preview_read_only")
  assert.equal((await json(chatResponse)).error?.code, "preview_read_only")
})

test("disabling the exact preview flag preserves the existing hackathon feature gate", async () => {
  process.env.NEXT_PUBLIC_HK_PREVIEW_READ_ONLY = "true"
  assert.equal(readiness.isReadinessPreview(), false)
  const response = await route.GET(new Request("http://localhost/api/hackathon/v1/config"), ctx(["config"]))
  assert.equal(response.status, 404)
  assert.equal((await json(response)).error?.code, "not_found")

  delete process.env.NEXT_PUBLIC_HK_PREVIEW_READ_ONLY
  const post = await route.POST(new Request("http://localhost/api/hackathon/v1/sessions", { method: "POST" }), ctx(["sessions"]))
  assert.equal(post.status, 404)
  assert.equal((await json(post)).error?.code, "not_found")
  process.env.NEXT_PUBLIC_HK_PREVIEW_READ_ONLY = "1"
})
