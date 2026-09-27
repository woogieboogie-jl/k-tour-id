import { test } from "node:test"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { createSumsubRecord, readSumsubRecord, mutateSumsubRecord, sumsubStoreConfiguration } from "../../lib/kyc/sumsub-store"

test("Sumsub Redis cannot mix pairs, fall back on partial credentials, or share the CX namespace", () => {
  for (const env of [
    {}, { SUMSUB_LOCAL_MEMORY: "1", VERCEL_ENV: "preview" },
    { SUMSUB_LOCAL_MEMORY: "1", UPSTASH_REDIS_REST_URL: "https://fixture.upstash.io" },
    { UPSTASH_REDIS_REST_URL: "https://fixture.upstash.io", KV_REST_API_TOKEN: "fake" },
    { UPSTASH_REDIS_REST_URL: "https://fixture.upstash.io", UPSTASH_REDIS_REST_TOKEN: "fake", SUMSUB_STORE_NAMESPACE: "ktour:cx-preview:any" },
  ]) assert.throws(() => sumsubStoreConfiguration(env))
  assert.equal(sumsubStoreConfiguration({ SUMSUB_LOCAL_MEMORY: "1", NODE_ENV: "test" }).connection, null)
})

test("Redis wire CAS retries against complete prior value, preserves both writers and revoked sessions", async () => {
  const previousEnv = process.env, previousFetch = globalThis.fetch
  process.env = { NODE_ENV: "test", UPSTASH_REDIS_REST_URL: "https://fixture.upstash.io", UPSTASH_REDIS_REST_TOKEN: "fixture-only", SUMSUB_STORE_NAMESPACE: "ktour:sumsub:sandbox:cas-fixture" }
  const database = new Map<string, string>(), commands: unknown[][] = []
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://fixture.upstash.io")
    const c = JSON.parse(String(init?.body)) as (string | number)[]
    commands.push(c)
    let result: unknown = null
    if (c[0] === "GET") result = database.get(String(c[1])) ?? null
    else if (c[0] === "SET") {
      assert.equal(c[3], "NX"); assert.equal(c[4], "PX"); assert.ok(Number(c[5]) > 0)
      if (!database.has(String(c[1]))) { database.set(String(c[1]), String(c[2])); result = "OK" }
    } else if (c[0] === "EVAL") {
      assert.match(String(c[1]), /GET.*ARGV\[1\]/)
      assert.match(String(c[1]), /KEEPTTL/)
      assert.equal(c[2], 1)
      result = database.get(String(c[3])) === c[4] ? 1 : 0
      if (result === 1) database.set(String(c[3]), String(c[5]))
    } else assert.fail("Unexpected Redis operation")
    return Response.json({ result })
  }
  try {
    const id = "ktour-sbx-" + randomUUID(), secret = "local-fixture-secret-never-provider-" + "x".repeat(32), sessionId = randomUUID()
    const record = { version: 1 as const, externalUserId: id, levelName: "id-and-liveness", status: "pending" as const, expiresAt: Date.now() + 60_000, activeSessionId: sessionId, activeExpiresAt: Date.now() + 30_000, lastEventAt: 0 }
    assert.equal(await createSumsubRecord(record, secret), true)
    assert.equal(await createSumsubRecord(record, secret), false)
    const before = await readSumsubRecord(id, secret)
    await Promise.all([
      mutateSumsubRecord(id, secret, row => ({ ...row, activeSessionId: null, activeExpiresAt: 0 })),
      mutateSumsubRecord(id, secret, row => ({ ...row, lastEventAt: 123, lastEventId: "event-new", needsRefresh: true })),
    ])
    const final = await readSumsubRecord(id, secret)
    assert.equal(final?.revision, 2)
    assert.equal(final?.activeSessionId, null)
    assert.equal(final?.lastEventId, "event-new")
    assert.equal(final?.status, "pending")
    assert.equal(final?.expiresAt, before?.expiresAt)
    assert.equal(await mutateSumsubRecord(id, secret, row => row.revision === before?.revision ? { ...row, status: "approved" } : null), null)
    assert.equal((await readSumsubRecord(id, secret))?.status, "pending")
    assert.ok(commands.filter(c => c[0] === "EVAL").length >= 3, "Contention was exercised, not serialized away")
    assert.ok([...database.keys()].every(key => !key.includes(id)))
    assert.equal(await mutateSumsubRecord("ktour-sbx-" + randomUUID(), secret, row => row), null)
  } finally { process.env = previousEnv; globalThis.fetch = previousFetch }
})
