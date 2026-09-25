import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { cxReadinessResponse, CX_PREFLIGHT_END } from "../../lib/hackathon/cx-readiness"
import { GET } from "../../app/api/hackathon/v1/[...path]/route"

const envKeys = ["NEXT_PUBLIC_HK_PREVIEW_READ_ONLY", "VERCEL_ENV", "VERCEL_REGION", "VERCEL_GIT_COMMIT_SHA"] as const
const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]))
const originalFetch = globalThis.fetch
const originalNow = Date.now
let now = Date.parse("2026-09-25T05:00:00Z")
let fetchCalls: Array<{ input: string; init?: RequestInit }> = []
let fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

process.env.NEXT_PUBLIC_HK_PREVIEW_READ_ONLY = "1"
process.env.VERCEL_ENV = "preview"
process.env.VERCEL_REGION = "qa-region"
process.env.VERCEL_GIT_COMMIT_SHA = "qa-revision"
Date.now = () => now

before(() => {
  fetchCalls = []
  fetchImpl = async (input, init) => {
    fetchCalls.push({ input: String(input), init })
    return new Response(JSON.stringify([
      { provider_id: "comdl", status_code: "y", oper_sort: "prod", version: "v1.5", name: "PII must be removed", phone: "secret" },
      { provider_id: "coidentitydocument", status_code: "n", oper_sort: "dev", version: "v1.5", address: "secret" },
      { provider_id: "unknown", status_code: "y", oper_sort: "prod", version: "v1.5" },
      { provider_id: "comrc", status_code: "y", oper_sort: "prod", version: "v1.4" },
    ]))
  }
  globalThis.fetch = (input, init) => fetchImpl(input, init)
})

after(() => {
  globalThis.fetch = originalFetch
  Date.now = originalNow
  for (const key of envKeys) {
    const value = originalEnv[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

const advance = (ms = 60_001) => { now += ms }
const body = async (response: Response) => await response.json() as Record<string, unknown>
const routeCtx = (path: string[]) => ({ params: Promise.resolve({ path }) })

test("exact preview GET reaches only the fixed CX provider catalogue and returns allowlisted fields", { concurrency: false }, async () => {
  const response = await GET(new Request("http://localhost/api/hackathon/v1/readiness/cx"), routeCtx(["readiness", "cx"]))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("cache-control"), "no-store")
  assert.equal(fetchCalls.length, 1)
  assert.equal(fetchCalls[0]?.input, "https://cx.raonsecure.co.kr:18543/oacx/api/v1.0/provider/list")
  const init = fetchCalls[0]?.init
  assert.equal(init?.method, "GET")
  assert.equal(init?.redirect, "error")
  assert.equal(init?.cache, "no-store")
  assert.deepEqual(init?.headers, { accept: "application/json" })
  assert.equal("authorization" in (init?.headers ?? {}), false)
  assert.ok(init?.signal instanceof AbortSignal)
  const result = await body(response)
  assert.equal(result.authenticated, false)
  assert.equal(result.identityVerified, false)
  assert.deepEqual(result.providers, [
    { provider: "comdl", environment: "prod", available: true, version: "v1.5" },
    { provider: "coidentitydocument", environment: "dev", available: false, version: "v1.5" },
  ])
  assert.equal(JSON.stringify(result).includes("secret"), false)
})

test("HEAD and query-string requests are rejected before fetch", { concurrency: false }, async () => {
  advance()
  const before = fetchCalls.length
  const head = await cxReadinessResponse(new Request("http://localhost/api/hackathon/v1/readiness/cx", { method: "HEAD" }))
  const query = await cxReadinessResponse(new Request("http://localhost/api/hackathon/v1/readiness/cx?probe=1"))
  assert.equal(head.status, 400)
  assert.equal(query.status, 400)
  assert.equal(fetchCalls.length, before)
})

test("GET body, transfer-encoding, and nonzero content-length are rejected before fetch", { concurrency: false }, async () => {
  advance()
  const before = fetchCalls.length
  const request = (headers: Headers, body: BodyInit | null): Request => ({
    method: "GET", url: "http://localhost/api/hackathon/v1/readiness/cx", headers, body,
  } as Request)
  const withBody = await cxReadinessResponse(request(new Headers(), new ReadableStream()))
  const transfer = await cxReadinessResponse(request(new Headers([["transfer-encoding", "chunked"]]), null))
  const length = await cxReadinessResponse(request(new Headers([["content-length", "1"]]), null))
  for (const response of [withBody, transfer, length]) {
    assert.equal(response.status, 400)
    const result = await body(response)
    assert.equal((result.error as Record<string, unknown>).code, "cx_preflight_request")
  }
  assert.equal(fetchCalls.length, before)
})

test("parallel calls share one sixty-second probe, then expire into one new call", { concurrency: false }, async () => {
  advance()
  let probeCalls = 0
  let release!: (response: Response) => void
  fetchImpl = async () => { probeCalls += 1; return await new Promise<Response>(resolve => { release = resolve }) }
  const first = cxReadinessResponse(new Request("http://localhost/api/hackathon/v1/readiness/cx"))
  const second = cxReadinessResponse(new Request("http://localhost/api/hackathon/v1/readiness/cx"))
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(probeCalls, 1)
  release(new Response(JSON.stringify([{ provider_id: "comdl", status_code: "y", oper_sort: "prod", version: "v1.5" }])))
  await Promise.all([first, second])

  fetchImpl = async (input, init) => {
    probeCalls += 1
    fetchCalls.push({ input: String(input), init })
    return new Response(JSON.stringify([{ provider_id: "comdl", status_code: "y", oper_sort: "prod", version: "v1.5" }]))
  }
  advance()
  await cxReadinessResponse(new Request("http://localhost/api/hackathon/v1/readiness/cx"))
  assert.equal(probeCalls, 2)
})

test("preview flag, deployment, or expiry disables without a network call", { concurrency: false }, async () => {
  advance()
  const before = fetchCalls.length
  process.env.NEXT_PUBLIC_HK_PREVIEW_READ_ONLY = "0"
  assert.equal((await cxReadinessResponse(new Request("http://localhost/api/api/readiness/cx"))).status, 404)
  process.env.NEXT_PUBLIC_HK_PREVIEW_READ_ONLY = "1"
  process.env.VERCEL_ENV = "production"
  assert.equal((await cxReadinessResponse(new Request("http://localhost/api/readiness/cx"))).status, 404)
  process.env.VERCEL_ENV = "preview"
  now = CX_PREFLIGHT_END
  assert.equal((await cxReadinessResponse(new Request("http://localhost/api/readiness/cx"))).status, 404)
  assert.equal(fetchCalls.length, before)
  now = Date.parse("2026-09-25T05:00:00Z")
})

test("invalid, non-array, oversized, and thrown responses use bounded generic errors", { concurrency: false }, async () => {
  process.env.NEXT_PUBLIC_HK_PREVIEW_READ_ONLY = "1"
  process.env.VERCEL_ENV = "preview"
  // The previous test deliberately rewinds the fake clock after checking the
  // expiry gate; move beyond the retained probe before exercising new bodies.
  now = Date.parse("2026-09-25T05:05:00Z")
  const cases: Array<{ response?: Response; error?: Error; code: string }> = [
    { response: new Response("not-json"), code: "cx_catalog_network_or_response" },
    { response: new Response(JSON.stringify({ provider_id: "comdl" })), code: "cx_catalog_shape" },
    { response: new Response("x".repeat(256 * 1024 + 1)), code: "cx_catalog_size" },
    { error: new Error("secret provider credentials"), code: "cx_catalog_network_or_response" },
  ]
  for (const item of cases) {
    advance()
    fetchImpl = async (input, init) => {
      fetchCalls.push({ input: String(input), init })
      if (item.error) throw item.error
      return item.response!
    }
    const response = await cxReadinessResponse(new Request("http://localhost/api/hackathon/v1/readiness/cx"))
    assert.equal(response.status, 502)
    const result = await body(response)
    assert.equal(result.error, item.code)
    assert.equal(JSON.stringify(result).includes("secret provider credentials"), false)
  }
})

test("a probe that completes after the fixed preflight deadline is discarded", { concurrency: false }, async () => {
  now = CX_PREFLIGHT_END - 1_000
  let release!: (response: Response) => void
  fetchImpl = async () => await new Promise<Response>(resolve => { release = resolve })
  const pending = cxReadinessResponse(new Request("http://localhost/api/hackathon/v1/readiness/cx"))
  await new Promise<void>(resolve => setImmediate(resolve))
  now = CX_PREFLIGHT_END
  release(new Response(JSON.stringify([{ provider_id: "comdl", status_code: "y", oper_sort: "prod", version: "v1.5" }])))
  const response = await pending
  assert.equal(response.status, 404)
  assert.equal(((await body(response)).error as Record<string, unknown>).code, "cx_preflight_disabled")
  now = Date.parse("2026-09-25T05:00:00Z")
})
