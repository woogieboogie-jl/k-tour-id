import assert from "node:assert/strict"
import { test } from "node:test"
import { runRedisProbe, validateRedisProbeEnv } from "../../scripts/hackathon-redis-probe.mjs"

const env = (extra: Record<string, string> = {}) => ({
  UPSTASH_REDIS_REST_URL: "https://redis.example.test",
  UPSTASH_REDIS_REST_TOKEN: "token-sentinel",
  HK_REDIS_PROBE_ALLOW_WRITE: "1",
  VERCEL_ENV: "preview",
  ...extra,
})

function fixtureFetch({ failCommand }: { failCommand?: string } = {}) {
  const values = new Map<string, string>()
  const requests: Array<{ url: string; init: RequestInit; command: unknown[] }> = []
  const observations: Array<{ op: string; value: unknown }> = []
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const command = JSON.parse(String(init?.body)) as unknown[]
    requests.push({ url: String(input), init: init!, command })
    const name = String(command[0])
    if (name === failCommand) throw new Error("upstream body and secret must not escape")
    if (name === "PING") return new Response(JSON.stringify({ result: "PONG" }))
    if (name === "GET") {
      const result = values.get(String(command[1])) ?? null
      observations.push({ op: "GET", value: result })
      return new Response(JSON.stringify({ result }))
    }
    if (name === "SET") {
      const key = String(command[1])
      if (command.includes("NX") && values.has(key)) return new Response(JSON.stringify({ result: null }))
      values.set(key, String(command[2]))
      observations.push({ op: "SET", value: "OK" })
      return new Response(JSON.stringify({ result: "OK" }))
    }
    if (name === "EVAL") {
      const keyCount = Number(command[2])
      const keys = command.slice(3, 3 + keyCount).map(String)
      const args = command.slice(3 + keyCount).map(String)
      if (keyCount === 1) {
        if (values.get(keys[0]) === args[0]) { values.delete(keys[0]); observations.push({ op: "DEL", value: 1 }); return new Response(JSON.stringify({ result: 1 })) }
        observations.push({ op: "DEL", value: 0 })
        return new Response(JSON.stringify({ result: 0 }))
      }
      if (values.get(keys[0]) === args[0]) { values.set(keys[1], args[1]); observations.push({ op: "EVAL", value: 1 }); return new Response(JSON.stringify({ result: 1 })) }
      observations.push({ op: "EVAL", value: 0 })
      return new Response(JSON.stringify({ result: 0 }))
    }
    return new Response(JSON.stringify({ result: null }))
  }
  return { fetchImpl, requests, values, observations }
}

test("configuration requires an exact URL/token pair, safe HTTPS URL, preview, and explicit write gate", () => {
  assert.equal(validateRedisProbeEnv({}).ok, false)
  assert.equal(validateRedisProbeEnv({ UPSTASH_REDIS_REST_URL: "https://redis.example.test" }).ok, false)
  assert.equal(validateRedisProbeEnv({ UPSTASH_REDIS_REST_TOKEN: "secret" }).ok, false)
  assert.equal(validateRedisProbeEnv(env({ UPSTASH_REDIS_REST_URL: "http://redis.example.test" })).ok, false)
  assert.equal(validateRedisProbeEnv(env({ UPSTASH_REDIS_REST_URL: "https://user:pass@redis.example.test" })).ok, false)
  assert.equal(validateRedisProbeEnv(env({ UPSTASH_REDIS_REST_URL: "https://redis.example.test/?x=1" })).ok, false)
  assert.equal(validateRedisProbeEnv(env({ HK_REDIS_PROBE_ALLOW_WRITE: "0" })).ok, false)
  assert.equal(validateRedisProbeEnv(env({ VERCEL_ENV: "production" })).ok, false)
  assert.equal(validateRedisProbeEnv({ KV_REST_API_URL: "https://redis.example.test", KV_REST_API_TOKEN: "token-sentinel", HK_REDIS_PROBE_ALLOW_WRITE: "1", VERCEL_ENV: "preview" }).ok, true)
  assert.equal(validateRedisProbeEnv({ ...env(), KV_REST_API_URL: "https://other.example.test", KV_REST_API_TOKEN: "other" }).ok, false)
  assert.equal(validateRedisProbeEnv(env(), ["--token=secret"]).ok, false)
})

test("fixture probe performs bounded own-key lifecycle and lock/evidence checks", async () => {
  const fixture = fixtureFetch()
  const result = await runRedisProbe({ env: env(), fetchImpl: fixture.fetchImpl, uuid: "unit-uuid" })
  assert.deepEqual(result, { ok: true, checks: 11, cleanup: true, failures: 0 })
  assert.ok(fixture.requests.length >= 10)
  assert.ok(fixture.requests.every(request => request.url === "https://redis.example.test"))
  assert.equal(JSON.stringify(result).includes("token-sentinel"), false)
  const commands = fixture.requests.map(request => request.command)
  assert.equal(commands[0]?.[0], "PING")
  assert.equal(commands[1]?.[0], "SET")
  assert.equal(commands.filter(command => command[0] === "SET").every(command => command.includes("PX") && command.includes("120000")), true)
  assert.equal(commands.filter(command => command[0] === "EVAL").filter(command => String(command[1]).includes("redis.call('SET'")).every(command => command.includes("120000")), true)
  const reads = commands.filter(command => command[0] === "GET")
  assert.equal(reads.length, 3)
  assert.deepEqual(fixture.observations.filter(item => item.op === "GET").map(item => item.value), ["initial", "initial", "current"])
  assert.deepEqual(fixture.observations.filter(item => item.op === "EVAL").map(item => item.value), [0, 1])
  assert.equal(commands.filter(command => command[0] === "EVAL").some(command => String(command[1]).includes("redis.call('DEL'")), true)
  assert.equal(fixture.values.size, 0)
})

test("a failed upstream command still cleans only the owned keys and returns a generic summary", async () => {
  const fixture = fixtureFetch({ failCommand: "GET" })
  const result = await runRedisProbe({ env: env(), fetchImpl: fixture.fetchImpl, uuid: "failure-uuid" })
  assert.equal(result.ok, false)
  assert.equal(result.cleanup, true)
  assert.ok(result.failures > 0)
  assert.equal([...fixture.values.keys()].length, 0)
  assert.equal(fixture.requests.some(request => request.command[0] === "FLUSHDB" || request.command[0] === "SCAN"), false)
})

test("a pre-existing value key blocks further writes and preserves the non-owned key", async () => {
  const fixture = fixtureFetch()
  fixture.values.set("ktour:probe:collision:value", "other-owner")
  const result = await runRedisProbe({ env: env(), fetchImpl: fixture.fetchImpl, uuid: "collision" })
  assert.equal(result.ok, false)
  assert.equal(result.cleanup, true)
  assert.equal(fixture.values.get("ktour:probe:collision:value"), "other-owner")
  assert.equal(fixture.requests.some(request => request.command[0] === "EVAL" && String(request.command[1]).includes("redis.call('SET'")), false)
})

test("missing credentials and disabled execution perform no fetch", async () => {
  let calls = 0
  const fetchImpl = async () => { calls += 1; throw new Error("network forbidden") }
  assert.deepEqual(await runRedisProbe({ env: {}, fetchImpl }), { ok: false, checks: 0, cleanup: false, failures: 1 })
  assert.deepEqual(await runRedisProbe({ env: env({ HK_REDIS_PROBE_ALLOW_WRITE: "0" }), fetchImpl }), { ok: false, checks: 0, cleanup: false, failures: 1 })
  assert.equal(calls, 0)
})

test("an error envelope cannot become success even with a result field", async () => {
  let calls = 0
  const result = await runRedisProbe({ env: env(), fetchImpl: async () => {
    calls += 1
    return Response.json({ result: "PONG", error: "secret-sentinel" })
  } })
  assert.equal(result.ok, false)
  assert.equal(calls, 1, "invalid PING must not lead to writes")
  assert.equal(JSON.stringify(result).includes("secret-sentinel"), false)
})

test("a lost write response cannot claim confirmed cleanup", async () => {
  const fixture = fixtureFetch()
  const result = await runRedisProbe({ env: env(), uuid: "lost-write", fetchImpl: async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await fixture.fetchImpl(input, init)
    if (JSON.parse(String(init?.body))[0] === "SET") throw new Error("lost response")
    return response
  } })
  assert.equal(result.ok, false)
  assert.equal(result.cleanup, false)
  assert.ok(fixture.values.has("ktour:probe:lost-write:lock"), "TTL, not claimed cleanup, must recover the unknown write")
})
