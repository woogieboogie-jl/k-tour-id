import assert from "node:assert/strict"
import { test } from "node:test"
import { createRedisReadinessHandler, REDIS_READINESS_END } from "../../lib/hackathon/redis-readiness"
import { runRedisProbeCore, validateRedisProbeEnv } from "../../scripts/hackathon-redis-probe.mjs"

const DIAGNOSTIC_TOKEN = "independent-readiness-fixture-token-0123456789"
const REDIS_TOKEN = "redis-token-sentinel"
const URL = "https://redis.example.test"
const PATH = "https://preview.example.test/api/hackathon/v1/readiness/redis"
const request = (init: RequestInit = {}, url = PATH) => new Request(url, {
  method: "POST", ...init,
  headers: init.headers ?? { authorization: `Bearer ${DIAGNOSTIC_TOKEN}` },
})

function fixtureRedis() {
  const values = new Map<string, string>()
  const commands: unknown[][] = []
  const requests: Array<{ input: string; init?: RequestInit }> = []
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push({ input: String(input), init })
    const command = JSON.parse(String(init?.body)) as unknown[]
    commands.push(command)
    const op = String(command[0])
    let result: unknown
    if (op === "PING") result = "PONG"
    else if (op === "GET") result = values.get(String(command[1])) ?? null
    else if (op === "SET") {
      const key = String(command[1])
      result = values.has(key) ? null : "OK"
      if (result === "OK") values.set(key, String(command[2]))
    } else if (op === "EVAL") {
      const count = Number(command[2])
      const keys = command.slice(3, 3 + count).map(String)
      const args = command.slice(3 + count).map(String)
      result = 0
      if (values.get(keys[0]) === args[0]) {
        result = 1
        if (count === 1) values.delete(keys[0])
        else values.set(keys[1], args[1])
      }
    } else throw new Error("unexpected fixture command")
    return Response.json({ result })
  }
  return { values, commands, requests, fetchImpl }
}

function harness(fetchImpl?: typeof fetch) {
  const fixture = fixtureRedis()
  const env: Record<string, string | undefined> = {
    NODE_ENV: "production", VERCEL: "1", VERCEL_ENV: "preview", VERCEL_REGION: "icn1",
    VERCEL_GIT_PROVIDER: "github", VERCEL_GIT_COMMIT_REF: "feat/hackathon-readiness-preview-20260925",
    VERCEL_GIT_REPO_OWNER: "woogieboogie-jl", VERCEL_GIT_REPO_SLUG: "k-tour-id",
    VERCEL_GIT_COMMIT_SHA: "a".repeat(40), HK_REDIS_READINESS_TOKEN: DIAGNOSTIC_TOKEN,
    KV_REST_API_URL: URL, KV_REST_API_TOKEN: REDIS_TOKEN,
  }
  const state = { now: REDIS_READINESS_END - 120_000, readOnly: true }
  const handle = createRedisReadinessHandler({
    env: () => env, now: () => state.now, readOnly: () => state.readOnly,
    fetchImpl: fetchImpl ?? fixture.fetchImpl,
  })
  return { ...fixture, env, state, handle }
}

test("authenticated approved Preview checks only TTL-protected UUID keys and leaks no credentials", async () => {
  const h = harness()
  const response = await h.handle(request())
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("cache-control"), "no-store")
  const result = await response.json()
  assert.deepEqual(result, { ok: true, checks: 11, cleanup: true, failures: 0,
    region: "icn1", revision: "a".repeat(40), observedAt: new Date(h.state.now).toISOString() })
  assert.equal(h.values.size, 0)
  assert.equal(h.requests.length, 11)
  for (const { input, init } of h.requests) {
    assert.equal(input, URL)
    assert.equal(init?.method, "POST")
    assert.equal(init?.redirect, "error")
    assert.equal(init?.cache, "no-store")
    assert.ok(init?.signal instanceof AbortSignal)
  }
  for (const command of h.commands) {
    const keys = command[0] === "EVAL" ? command.slice(3, 3 + Number(command[2])) : command[0] === "PING" ? [] : [command[1]]
    assert.ok(keys.every(key => /^ktour:probe:[0-9a-f-]{36}:(lock|value)$/.test(String(key))))
    if (command[0] === "SET") assert.ok(command.includes("PX") && command.includes("120000"))
    if (command[0] === "EVAL" && String(command[1]).includes("redis.call('SET'")) assert.ok(command.includes("120000"))
  }
  const output = JSON.stringify(result)
  for (const forbidden of [DIAGNOSTIC_TOKEN, REDIS_TOKEN, URL, "ktour:probe:"]) assert.equal(output.includes(forbidden), false)
})

test("wrong or missing deployment metadata, readonly flag, and expiry deny before any fetch", async () => {
  const invalid: Record<string, string> = {
    VERCEL: "0", VERCEL_ENV: "production", VERCEL_REGION: "iad1", VERCEL_GIT_PROVIDER: "gitlab",
    VERCEL_GIT_COMMIT_REF: "main", VERCEL_GIT_REPO_OWNER: "someone", VERCEL_GIT_REPO_SLUG: "other",
    VERCEL_GIT_COMMIT_SHA: "not-a-revision",
  }
  for (const [key, value] of Object.entries(invalid)) {
    for (const replacement of [value, undefined]) {
      const h = harness(); h.env[key] = replacement
      assert.equal((await h.handle(request())).status, 404, key)
      assert.equal(h.requests.length, 0)
    }
  }
  for (const variant of ["flag", "expiry"] as const) {
    const h = harness()
    if (variant === "flag") h.state.readOnly = false
    else h.state.now = REDIS_READINESS_END
    assert.equal((await h.handle(request())).status, 404)
    assert.equal(h.requests.length, 0)
  }
})

test("only an exact bodyless cookieless POST with valid independent bearer authentication is accepted", async () => {
  const malformed = [
    request({ method: "GET" }), request({ method: "HEAD" }), request({}, PATH + "/extra"),
    request({}, PATH + "?url=https://evil.invalid"), request({ body: "{}" }),
    request({ headers: { authorization: `Bearer ${DIAGNOSTIC_TOKEN}`, cookie: "session=sentinel" } }),
    request({ headers: { authorization: `Bearer ${DIAGNOSTIC_TOKEN}`, "transfer-encoding": "chunked" } }),
    request({ headers: { authorization: `Bearer ${DIAGNOSTIC_TOKEN}`, "content-length": "1" } }),
  ]
  for (const req of malformed) {
    const h = harness()
    assert.equal((await h.handle(req)).status, 400)
    assert.equal(h.requests.length, 0)
  }
  for (const authorization of ["", "Bearer short", `Bearer ${"x".repeat(44)}`, `Bearer ${REDIS_TOKEN}`, `Bearer ${"x".repeat(129)}`]) {
    const h = harness()
    assert.equal((await h.handle(request({ headers: { authorization } }))).status, 401)
    assert.equal(h.requests.length, 0)
  }
  for (const expected of [undefined, "short"]) {
    const h = harness(); h.env.HK_REDIS_READINESS_TOKEN = expected
    assert.equal((await h.handle(request())).status, 401)
    assert.equal(h.requests.length, 0)
  }
  const reused = harness(); reused.env.KV_REST_API_TOKEN = DIAGNOSTIC_TOKEN
  assert.equal((await reused.handle(request())).status, 503)
  assert.equal(reused.requests.length, 0)
})

test("missing, partial, mixed-alias and unsafe Redis configuration never fetch or fall back to the app store", async () => {
  const changes = [
    { KV_REST_API_TOKEN: undefined }, { KV_REST_API_URL: undefined },
    { UPSTASH_REDIS_REST_URL: URL }, { UPSTASH_REDIS_REST_URL: URL, UPSTASH_REDIS_REST_TOKEN: REDIS_TOKEN },
    { KV_REST_API_URL: "http://redis.example.test" }, { KV_REST_API_URL: "https://user:password@redis.example.test" },
    { KV_REST_API_URL: URL + "?key=secret" }, { KV_REST_API_URL: URL + "#secret" },
  ]
  for (const change of changes) {
    const h = harness(); Object.assign(h.env, change)
    assert.equal((await h.handle(request())).status, 503)
    assert.equal(h.requests.length, 0)
  }
  assert.equal(validateRedisProbeEnv({ KV_REST_API_URL: URL, KV_REST_API_TOKEN: REDIS_TOKEN,
    HK_REDIS_PROBE_ALLOW_WRITE: "1", VERCEL_ENV: "preview", NODE_ENV: "production" }).ok, false,
  "runtime diagnostic must not weaken the CLI production refusal")
})

test("Next-style empty POST streams are accepted only after auth; bytes, false zero length, and stalled streams are denied", async () => {
  const streamed = (body: ReadableStream, authorization = `Bearer ${DIAGNOSTIC_TOKEN}`) => ({
    method: "POST", url: PATH, headers: new Headers({ authorization, "content-length": "0" }), body,
  } as Request)
  const empty = harness()
  assert.equal((await empty.handle(streamed(new ReadableStream({ start(controller) { controller.close() } })))).status, 200)

  const nonempty = harness()
  assert.equal((await nonempty.handle(streamed(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode("x")); controller.close()
  } })))).status, 400)
  assert.equal(nonempty.requests.length, 0)

  const unauthenticated = harness()
  const inaccessibleBody = { getReader() { throw new Error("body read before auth") } } as unknown as ReadableStream
  assert.equal((await unauthenticated.handle(streamed(inaccessibleBody, "Bearer wrong"))).status, 401)
  assert.equal(unauthenticated.requests.length, 0)

  const stalled = harness()
  assert.equal((await stalled.handle(streamed(new ReadableStream()))).status, 400)
  assert.equal(stalled.requests.length, 0)
})

test("concurrent authenticated requests coalesce; successful cache lasts thirty seconds and never skips auth", async () => {
  const fixture = fixtureRedis()
  let release!: () => void
  const pause = new Promise<void>(resolve => { release = resolve })
  let calls = 0
  const h = harness(async (input, init) => {
    calls += 1
    if (calls === 1) await pause
    return fixture.fetchImpl(input, init)
  })
  const first = h.handle(request()); const second = h.handle(request())
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(calls, 1)
  release()
  assert.deepEqual((await Promise.all([first, second])).map(response => response.status), [200, 200])
  assert.equal(calls, 11)
  assert.equal((await h.handle(request())).status, 200)
  assert.equal((await h.handle(request({ headers: {} }))).status, 401)
  assert.equal(calls, 11)
  h.state.now += 30_000
  assert.equal((await h.handle(request())).status, 200)
  assert.equal(calls, 22)
  h.state.readOnly = false
  assert.equal((await h.handle(request())).status, 404)
  assert.equal(calls, 22)
})

test("failed probes are not cached; malformed and oversized provider bodies never leak", async () => {
  for (const fetchImpl of [
    async () => Response.json({ result: "PONG", error: REDIS_TOKEN }),
    async () => new Response(REDIS_TOKEN.repeat(2000)),
    async () => { throw new Error(REDIS_TOKEN) },
  ]) {
    let calls = 0
    const h = harness(async () => { calls += 1; return fetchImpl() })
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await h.handle(request())
      assert.equal(response.status, 502)
      const output = await response.text()
      assert.equal(output.includes(REDIS_TOKEN), false)
      assert.equal(JSON.parse(output).ok, false)
    }
    assert.equal(calls, 2)
  }
})

test("lost write response is uncertain cleanup, never a successful runtime smoke", async () => {
  const fixture = fixtureRedis()
  const h = harness(async (input, init) => {
    const response = await fixture.fetchImpl(input, init)
    if (JSON.parse(String(init?.body))[0] === "SET") throw new Error(REDIS_TOKEN)
    return response
  })
  const response = await h.handle(request())
  assert.equal(response.status, 502)
  const result = await response.json()
  assert.equal(result.ok, false)
  assert.equal(result.cleanup, false)
  assert.equal(fixture.values.size, 1, "unknown write relies on TTL, not claimed deletion")
})

test("an unexpected mutation result cannot claim a known write outcome or confirmed cleanup", async () => {
  const fixture = fixtureRedis()
  const h = harness(async (input, init) => {
    const response = await fixture.fetchImpl(input, init)
    if (JSON.parse(String(init?.body))[0] === "SET") return Response.json({ result: "unexpected" })
    return response
  })
  const response = await h.handle(request())
  const result = await response.json()
  assert.equal(response.status, 502)
  assert.equal(result.ok, false)
  assert.equal(result.cleanup, false)
  assert.equal(fixture.values.size, 1)
})

test("a result completing beyond the hard deadline is discarded, including later cache reads", async () => {
  const fixture = fixtureRedis()
  const h = harness(async (input, init) => {
    const response = await fixture.fetchImpl(input, init)
    h.state.now = REDIS_READINESS_END
    return response
  })
  assert.equal((await h.handle(request())).status, 404)
  const count = fixture.commands.length
  assert.equal((await h.handle(request())).status, 404)
  assert.equal(fixture.commands.length, count)
})

test("core work deadline bounds a transport that ignores abort without claiming cleanup", async () => {
  const fixture = fixtureRedis()
  const keepAlive = setTimeout(() => undefined, 2_000)
  try {
    const started = performance.now()
    const result = await runRedisProbeCore({ url: URL, token: REDIS_TOKEN, workTimeoutMs: 10, cleanupTimeoutMs: 10,
      fetchImpl: async (input, init) => {
        const response = await fixture.fetchImpl(input, init)
        if (JSON.parse(String(init?.body))[0] === "SET") return await new Promise<Response>(() => undefined)
        return response
      } })
    assert.equal(result.ok, false)
    assert.equal(result.cleanup, false)
    assert.ok(performance.now() - started < 1_000)
    assert.equal(fixture.values.size, 1)
  } finally { clearTimeout(keepAlive) }
})
