import assert from "node:assert/strict"
import { test } from "node:test"
import { runStoreCanary } from "../../scripts/hackathon-store-canary"

const env = { HK_STORE_CANARY_ALLOW_WRITE: "1", KV_REST_API_URL: "https://fixture-redis.invalid", KV_REST_API_TOKEN: "fixture-token",
  HK_STORE_KEY: "ondo:hackathon:journey:v1", HK_CX_API_KEY: "must-not-reach-child" }

function fixtureRedis() {
  const values = new Map<string, string>()
  const expiry = new Map<string, number>()
  const commands: Array<Array<string | number>> = []
  const writes: Array<{ key: string; ttl: number }> = []
  const get = (key: string) => {
    if ((expiry.get(key) ?? Infinity) <= Date.now()) { values.delete(key); expiry.delete(key) }
    return values.get(key) ?? null
  }
  const set = (key: string, value: string, ttl: number) => { values.set(key, value); expiry.set(key, Date.now() + ttl); writes.push({ key, ttl }) }
  const del = (key: string) => { expiry.delete(key); return Number(values.delete(key)) }
  const fetchImpl: typeof fetch = async (input, init) => {
    assert.equal(String(input), env.KV_REST_API_URL)
    const cmd = JSON.parse(String(init?.body)) as Array<string | number>
    commands.push(cmd)
    let result: unknown
    if (cmd[0] === "EXISTS") result = cmd.slice(1).filter(key => get(String(key)) !== null).length
    else {
      assert.equal(cmd[0], "EVAL")
      const script = String(cmd[1]); const count = Number(cmd[2])
      const keys = cmd.slice(3, 3 + count).map(String); const args = cmd.slice(3 + count).map(String)
      assert.ok(keys.every(key => /^ktour:cx-preview:canary:[a-f0-9-]{36}:journey(?::owner|:lock)?$/.test(key)))
      if (script.includes("ktour-canary-claim")) {
        result = keys.some(key => get(key) !== null) ? 0 : 1
        if (result === 1) { set(keys[0], args[0], Number(args[2])); set(keys[1], args[1], Number(args[2])) }
      } else if (script.includes("ktour-canary-load")) result = get(keys[0]) === args[0] ? get(keys[1]) : null
      else if (script.includes("ktour-canary-lock")) {
        result = get(keys[0]) !== args[0] ? -1 : get(keys[1]) === null ? "OK" : null
        if (result === "OK") set(keys[1], args[1], 5000)
      } else if (script.includes("ktour-canary-commit")) {
        result = get(keys[0]) === args[0] && get(keys[2]) === args[2] ? 1 : 0
        if (result === 1) set(keys[1], args[1], Number(args[3]))
      } else if (script.includes("ktour-canary-cleanup")) {
        result = get(keys[0]) === args[0] ? 1 : 0
        if (result === 1) keys.forEach(del)
      } else {
        assert.equal(count, 1)
        assert.match(script, /GET.*KEYS\[1\].*ARGV\[1\].*DEL/)
        result = get(keys[0]) === args[0] ? del(keys[0]) : 0
      }
    }
    return Response.json({ result })
  }
  return { values, expiry, commands, writes, fetchImpl }
}

test("actual concurrent store workers and a fresh reader use only own TTL keys, then owner-checked cleanup", async () => {
  const fixture = fixtureRedis()
  fixture.values.set("ondo:hackathon:journey:v1", "untouched-existing-ledger")
  const result = await runStoreCanary({ env, fetchImpl: fixture.fetchImpl, fixtureWorkers: true })
  assert.deepEqual(result, { ok: true, checks: 6, cleanup: true, failures: 0 })
  assert.deepEqual([...fixture.values.entries()], [["ondo:hackathon:journey:v1", "untouched-existing-ledger"]])
  assert.equal(fixture.commands.filter(cmd => String(cmd[1]).includes("ktour-canary-commit")).length, 2)
  assert.equal(fixture.commands.filter(cmd => String(cmd[1]).includes("ktour-canary-load")).length, 3)
  assert.ok(fixture.writes.filter(write => !write.key.endsWith(":lock")).every(write => write.ttl === 120000))
  assert.equal(JSON.stringify(result).includes(env.KV_REST_API_TOKEN), false)
})

test("canary invalid configuration and production gate perform zero calls", async () => {
  let calls = 0
  const fetchImpl: typeof fetch = async () => { calls += 1; throw new Error("network forbidden") }
  for (const change of [{ HK_STORE_CANARY_ALLOW_WRITE: "0" }, { VERCEL_ENV: "production" },
    { KV_REST_API_TOKEN: undefined }, { UPSTASH_REDIS_REST_TOKEN: "mixed" }, { KV_REST_API_URL: "http://unsafe.invalid" }]) {
    assert.equal((await runStoreCanary({ env: { ...env, ...change }, fetchImpl, fixtureWorkers: true })).ok, false)
  }
  assert.equal((await runStoreCanary({ env, fixtureWorkers: true })).ok, false)
  assert.equal(calls, 0)
})

test("a failed closed worker is cleaned in finally and receives no provider or inherited ledger settings", async () => {
  const fixture = fixtureRedis()
  const result = await runStoreCanary({ env, fetchImpl: fixture.fetchImpl, runWorker: async (_op, _id, childEnv) => {
    assert.equal(childEnv.HK_CX_API_KEY, undefined)
    assert.notEqual(childEnv.HK_STORE_KEY, env.HK_STORE_KEY)
    assert.equal(childEnv.HK_MODE_CX, "mock")
    return { ok: false, closed: true }
  } })
  assert.equal(result.ok, false)
  assert.equal(result.cleanup, true)
  assert.equal(fixture.values.size, 0)
})

test("unconfirmed worker termination and a lost claim response never claim cleanup success", async () => {
  const fixture = fixtureRedis()
  const unsettled = await runStoreCanary({ env, fetchImpl: fixture.fetchImpl, runWorker: async () => ({ ok: false, closed: false }) })
  assert.equal(unsettled.cleanup, false)
  assert.equal(unsettled.ok, false)
  const lostClaim = await runStoreCanary({ env, fetchImpl: async (input, init) => {
    const response = await fixture.fetchImpl(input, init)
    if (String(JSON.parse(String(init?.body))[1]).includes("ktour-canary-claim")) throw new Error("lost response")
    return response
  }, runWorker: async () => { assert.fail("uncertain claim must not launch a worker") } })
  assert.equal(lostClaim.ok, false)
  assert.equal(lostClaim.cleanup, false)
})

test("cleanup ownership mismatch preserves someone else's keys and is reported as failure", async () => {
  const fixture = fixtureRedis()
  const result = await runStoreCanary({ env, fetchImpl: fixture.fetchImpl, runWorker: async (_op, _id, childEnv) => {
    fixture.values.set(`${childEnv.HK_STORE_KEY}:owner`, "different-owner")
    return { ok: false, closed: true }
  } })
  assert.equal(result.cleanup, false)
  assert.ok([...fixture.values.values()].includes("different-owner"))
})

test("owner revocation fences a delayed actual store commit and prevents ledger resurrection", async () => {
  const fixture = fixtureRedis()
  let revoked = false
  const result = await runStoreCanary({ env, fixtureWorkers: true, fetchImpl: async (input, init) => {
    const cmd = JSON.parse(String(init?.body))
    if (!revoked && String(cmd[1]).includes("ktour-canary-commit")) {
      revoked = true
      const ledger = String(cmd[4]); const owner = String(cmd[5])
      fixture.values.delete(ledger); fixture.values.delete(owner)
    }
    return fixture.fetchImpl(input, init)
  } })
  assert.equal(result.ok, false)
  assert.equal(result.cleanup, false)
  assert.equal([...fixture.values.keys()].some(key => key.endsWith(":journey")), false)
})

test("timed-out real child processes are killed and confirmed closed before owned cleanup succeeds", async () => {
  const fixture = fixtureRedis()
  const started = performance.now()
  const result = await runStoreCanary({ env, fixtureWorkers: true, workerTimeoutMs: 500,
    fetchImpl: async (input, init) => {
      const cmd = JSON.parse(String(init?.body))
      if (String(cmd[1]).includes("ktour-canary-load")) return await new Promise<Response>(() => undefined)
      return fixture.fetchImpl(input, init)
    } })
  assert.equal(result.ok, false)
  assert.equal(result.cleanup, true)
  assert.equal(fixture.values.size, 0)
  assert.ok(performance.now() - started < 5000)
})
