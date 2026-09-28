import assert from "node:assert/strict"
import { test } from "node:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, existsSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import { previewRedisConfig, storeRedisCommand } from "../../lib/hackathon/redis-config"

const valid = () => ({
  KV_REST_API_URL: "https://fixture-redis.invalid", KV_REST_API_TOKEN: "fixture-redis-token",
  HK_STORE_KEY: "ktour:cx-preview:fixture:journey",
  HK_ISSUER_SIGNING_SEED: "b829083aae579eddcc554433221109875566778899aabbccddeeff0011223344",
})

test("CX Preview requires one complete alias pair, safe REST origin, dedicated key and non-sample seed", () => {
  assert.equal(previewRedisConfig(valid()).key, "ktour:cx-preview:fixture:journey")
  assert.equal(previewRedisConfig({ ...valid(), KV_REST_API_URL: undefined, KV_REST_API_TOKEN: undefined,
    UPSTASH_REDIS_REST_URL: "https://fixture-redis.invalid", UPSTASH_REDIS_REST_TOKEN: "fixture-token" }).token, "fixture-token")
  const invalid = [
    { KV_REST_API_URL: undefined }, { KV_REST_API_TOKEN: undefined },
    { UPSTASH_REDIS_REST_URL: "https://other.invalid" }, { UPSTASH_REDIS_REST_TOKEN: "other-token" },
    { UPSTASH_REDIS_REST_URL: "https://other.invalid", UPSTASH_REDIS_REST_TOKEN: "other-token" },
    { KV_REST_API_URL: "http://fixture-redis.invalid" }, { KV_REST_API_URL: "https://user:password@fixture-redis.invalid" },
    { KV_REST_API_URL: "https://fixture-redis.invalid:444" }, { KV_REST_API_URL: "https://fixture-redis.invalid/path" },
    { KV_REST_API_URL: "https://fixture-redis.invalid?secret=x" }, { KV_REST_API_URL: "https://fixture-redis.invalid#x" },
    { HK_STORE_KEY: undefined }, { HK_STORE_KEY: "ondo:hackathon:journey:v1" }, { HK_STORE_KEY: "ktour:cx-preview:" },
    { HK_ISSUER_SIGNING_SEED: undefined }, { HK_ISSUER_SIGNING_SEED: "short" },
    { HK_ISSUER_SIGNING_SEED: "ondo-hackathon-sample-issuer-seed-change-me" },
  ]
  for (const change of invalid) assert.throws(() => previewRedisConfig({ ...valid(), ...change }), { code: "store_configuration" })
})

test("canary ownership cannot be enabled for an inherited real ledger or altered namespace", () => {
  const uuid = randomUUID()
  const env = { ...valid(), HK_STORE_KEY: `ktour:cx-preview:canary:${uuid}:journey`,
    HK_STORE_CANARY_UUID: uuid, HK_STORE_CANARY_OWNER: "ab".repeat(32), HK_STORE_CANARY_ALLOW_WRITE: "1" }
  assert.deepEqual(previewRedisConfig(env).canary, { ownerKey: `${env.HK_STORE_KEY}:owner`, ownerToken: env.HK_STORE_CANARY_OWNER, ttlMs: 120000 })
  for (const change of [
    { HK_STORE_KEY: valid().HK_STORE_KEY }, { HK_STORE_KEY: env.HK_STORE_KEY + ":other" },
    { HK_STORE_CANARY_OWNER: undefined }, { HK_STORE_CANARY_UUID: "bad" },
    { HK_STORE_CANARY_ALLOW_WRITE: "0" }, { VERCEL_ENV: "production" },
  ]) assert.throws(() => previewRedisConfig({ ...env, ...change }), { code: "store_configuration" })
})

test("the real backend selector fails before file creation, and preserves isolated mock behavior", () => {
  const directory = mkdtempSync(join(tmpdir(), "ktour-store-selector-"))
  const storeUrl = new URL("../../lib/hackathon/store.ts", import.meta.url).href
  const childPath = join(directory, "must-not-exist")
  const run = (environment: Record<string, string>, code: string) => spawnSync(process.execPath,
    ["--import", import.meta.resolve("tsx"), "--input-type=module", "-e", code],
    { env: { ...environment, NODE_ENV: "test" }, encoding: "utf8", timeout: 10000 })
  try {
    const base = { NEXT_PUBLIC_HK_PREVIEW_READ_ONLY: "0", NEXT_PUBLIC_HK_CX_PREVIEW: "1", HK_ISOLATED_MOCK: "0", HK_DATA_DIR: childPath }
    const rejected = run(base, `const {storeBackendKind}=await import(${JSON.stringify(storeUrl)}); try { storeBackendKind(); process.exitCode=1 } catch(e) { if(e.code!=='store_configuration') process.exitCode=2 }`)
    assert.equal(rejected.status, 0, "misconfigured real selector must fail closed")
    assert.equal(existsSync(childPath), false)
    const configured = run({ ...base, ...valid() }, `const {storeBackendKind}=await import(${JSON.stringify(storeUrl)}); if(storeBackendKind()!=='redis') process.exitCode=1`)
    assert.equal(configured.status, 0, "correct CX Preview selector must use Redis")
    assert.equal(existsSync(childPath), false)
    const mock = run({ ...base, NEXT_PUBLIC_HK_CX_PREVIEW: "0", HK_ISOLATED_MOCK: "1", KV_REST_API_URL: "https://ignored.invalid" },
      `const {storeBackendKind,withStore,readStore}=await import(${JSON.stringify(storeUrl)}); if(storeBackendKind()!=='file') process.exitCode=1; await withStore(db=>{}); if(!await readStore(db=>db.version===1)) process.exitCode=2`)
    assert.equal(mock.status, 0, "existing isolated mock must retain the file backend")
    assert.equal(existsSync(join(childPath, "journey.json")), true)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test("Redis transport bounds time, disables redirects and sanitizes malformed/upstream errors", async () => {
  const connection = { url: "https://fixture-redis.invalid", token: "sensitive-fixture-token" }
  const good = await storeRedisCommand(connection, ["PING"], { fetchImpl: async (input, init) => {
    assert.equal(String(input), connection.url); assert.equal(init?.redirect, "error"); assert.ok(init?.signal instanceof AbortSignal)
    return Response.json({ result: "PONG" })
  } })
  assert.equal(good, "PONG")
  for (const response of [Response.json({ result: "PONG", error: "sensitive-fixture-token" }), Response.json({}), new Response("bad-json"), new Response("secret", { status: 500 })]) {
    await assert.rejects(storeRedisCommand(connection, ["PING"], { fetchImpl: async () => response }), error => {
      assert.equal((error as { code: string }).code, "store_unavailable")
      assert.equal(String(error).includes("sensitive-fixture-token"), false)
      return true
    })
  }
  const keepAlive = setTimeout(() => undefined, 1000)
  try {
    await assert.rejects(storeRedisCommand(connection, ["PING"], { timeoutMs: 10, fetchImpl: async () => await new Promise<Response>(() => undefined) }), { code: "store_unavailable" })
  } finally { clearTimeout(keepAlive) }
})
