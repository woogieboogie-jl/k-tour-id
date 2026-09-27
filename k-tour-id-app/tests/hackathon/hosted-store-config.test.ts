import assert from "node:assert/strict"
import { test } from "node:test"
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { HkError } from "../../lib/hackathon/util"
import { hostedIntegrationRedisConfig, requiresHostedIntegrationRedis } from "../../lib/hackathon/hosted-store-config"

const fixture = () => ({ VERCEL: "1", VERCEL_ENV: "preview", HK_ISOLATED_MOCK: "0",
  NEXT_PUBLIC_HK_CX_PREVIEW: "0", NEXT_PUBLIC_HK_PREVIEW_READ_ONLY: "0",
  KV_REST_API_URL: "https://fixture.upstash.io/", KV_REST_API_TOKEN: "FIXTURE_ONLY_PRIVATE_TOKEN",
  HK_STORE_KEY: "ktour:integration-preview:fixture:journey" })
const invalid = (error: unknown) => {
  assert.ok(error instanceof HkError)
  assert.equal(error.code, "store_configuration"); assert.equal(error.status, 503)
  assert.doesNotMatch(error.message, /FIXTURE_ONLY|upstash\.io|token=/)
  return true
}

test("hosted integration requires durability regardless of API or provider mode flags", () => {
  for (const env of [{ VERCEL: "1" }, { VERCEL_ENV: "preview" }, { VERCEL_ENV: "production" }, { VERCEL: "1", HK_API_ENABLED: "0", HK_MODE_CX: "mock" }]) {
    assert.equal(requiresHostedIntegrationRedis(env, false), true)
    assert.equal(requiresHostedIntegrationRedis(env, true), false)
  }
  assert.equal(requiresHostedIntegrationRedis({}, false), false)
  assert.equal(requiresHostedIntegrationRedis({ NODE_ENV: "production" }, false), false, "a local production build is not automatically a hosted provider lane")
})

test("one complete alias pair and explicit integration namespace validate without I/O", () => {
  const f = fixture(), expected = { url: "https://fixture.upstash.io", token: f.KV_REST_API_TOKEN, key: f.HK_STORE_KEY }
  assert.deepEqual(hostedIntegrationRedisConfig(f), expected)
  assert.deepEqual(hostedIntegrationRedisConfig({ UPSTASH_REDIS_REST_URL: f.KV_REST_API_URL, UPSTASH_REDIS_REST_TOKEN: f.KV_REST_API_TOKEN, HK_STORE_KEY: f.HK_STORE_KEY }), expected)
  assert.deepEqual(hostedIntegrationRedisConfig({ ...f, UPSTASH_REDIS_REST_URL: "", UPSTASH_REDIS_REST_TOKEN: "" }), expected)
})

test("missing, partial, cross-paired and duplicate aliases fail closed", () => {
  const f = fixture()
  const variants = [ {}, { HK_STORE_KEY: f.HK_STORE_KEY }, { ...f, KV_REST_API_TOKEN: "" }, { ...f, KV_REST_API_URL: "" },
    { ...f, KV_REST_API_URL: "", UPSTASH_REDIS_REST_URL: f.KV_REST_API_URL },
    { ...f, KV_REST_API_TOKEN: "", UPSTASH_REDIS_REST_TOKEN: f.KV_REST_API_TOKEN },
    { ...f, UPSTASH_REDIS_REST_URL: f.KV_REST_API_URL }, { ...f, UPSTASH_REDIS_REST_TOKEN: f.KV_REST_API_TOKEN },
    { ...f, UPSTASH_REDIS_REST_URL: f.KV_REST_API_URL, UPSTASH_REDIS_REST_TOKEN: f.KV_REST_API_TOKEN } ]
  for (const env of variants) assert.throws(() => hostedIntegrationRedisConfig(env), invalid)
})

test("unsafe endpoints, tokens and shared ledger names cannot configure hosted integration", () => {
  for (const url of ["http://fixture.upstash.io", "https://fixture.invalid", "https://upstash.io.evil.invalid", "https://user:pass@fixture.upstash.io", "https://fixture.upstash.io/path", "https://fixture.upstash.io/?token=FIXTURE_ONLY_PRIVATE_TOKEN", "https://fixture.upstash.io/#fragment", "https://fixture.upstash.io:8443", " https://fixture.upstash.io", "https://fixture.upstash.io\n"]) {
    assert.throws(() => hostedIntegrationRedisConfig({ ...fixture(), KV_REST_API_URL: url }), invalid)
  }
  for (const token of ["", " ", " fixture", "fixture ", "fixture\n", "fixture\ttoken"]) assert.throws(() => hostedIntegrationRedisConfig({ ...fixture(), KV_REST_API_TOKEN: token }), invalid)
  for (const key of ["", "ondo:hackathon:journey:v1", "ktour:cx-preview:fixture", "ktour:sumsub:sandbox:fixture", "ktour:integration-preview:", "ktour:integration-preview:bad/key", "ktour:integration-preview:" + "x".repeat(121)]) {
    assert.throws(() => hostedIntegrationRedisConfig({ ...fixture(), HK_STORE_KEY: key }), invalid)
  }
})

const storeUrl = new URL("../../lib/hackathon/store.ts", import.meta.url).href
const prefix = `
  import assert from 'node:assert/strict';
  import http from 'node:http'; import https from 'node:https';
  const forbid=()=>{throw new Error('OFFLINE_TEST_NETWORK_FORBIDDEN')};
  globalThis.fetch=forbid; http.request=forbid; https.request=forbid;
  const {storeBackendKind,readStore,withStore}=await import(${JSON.stringify(storeUrl)});
  const invalid=e=>e?.code==='store_configuration'&&!String(e.message).includes('FIXTURE_ONLY');
`
function run(env: Record<string, string | undefined>, script: string) {
  // No ambient account/provider/Redis credentials enter this child process.
  return execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", prefix + script], {
    env: { PATH: process.env.PATH ?? "", NODE_ENV: "test", ...env }, encoding: "utf8", timeout: 15000, maxBuffer: 128 * 1024,
  })
}

test("actual hosted backend rejects unsafe config before file creation, network or mutation", () => {
  const root = mkdtempSync(join(tmpdir(), "ktour-hosted-store-reject-")), dataDir = join(root, "must-not-exist")
  try {
    for (const env of [
      { ...fixture(), KV_REST_API_URL: "", KV_REST_API_TOKEN: "" },
      { ...fixture(), KV_REST_API_URL: "", UPSTASH_REDIS_REST_URL: fixture().KV_REST_API_URL },
      { ...fixture(), HK_STORE_KEY: "ktour:cx-preview:existing" },
      { ...fixture(), UPSTASH_REDIS_REST_URL: fixture().KV_REST_API_URL, UPSTASH_REDIS_REST_TOKEN: "FIXTURE_ONLY_SECOND_TOKEN" },
    ]) run({ ...env, HK_DATA_DIR: dataDir }, `
      const fs=(await import('node:fs')).default;
      fs.mkdirSync=()=>{throw new Error('FILE_CREATION_FORBIDDEN')};
      (await import('node:module')).syncBuiltinESMExports();
      assert.throws(()=>storeBackendKind(),invalid);
      await assert.rejects(readStore(()=>{throw new Error('READ_CALLBACK_MUST_NOT_RUN')}),invalid);
      await assert.rejects(withStore(()=>{throw new Error('WRITE_CALLBACK_MUST_NOT_RUN')}),invalid);
    `)
    assert.equal(existsSync(dataDir), false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("valid hosted backend is Redis and config removal/drift cannot reuse a cached connection", () => {
  run(fixture(), `
    assert.equal(storeBackendKind(),'redis');
    const originalToken=process.env.KV_REST_API_TOKEN;
    delete process.env.KV_REST_API_TOKEN;
    assert.throws(()=>storeBackendKind(),invalid);
    process.env.KV_REST_API_TOKEN=originalToken;
    assert.equal(storeBackendKind(),'redis');
    process.env.HK_STORE_KEY+=':changed';
    assert.throws(()=>storeBackendKind(),invalid);
    process.env.HK_STORE_KEY=${JSON.stringify(fixture().HK_STORE_KEY)};
    process.env.KV_REST_API_TOKEN='FIXTURE_ONLY_CHANGED_TOKEN';
    assert.throws(()=>storeBackendKind(),invalid);
  `)
})

test("a local file backend cannot be reused after switching into hosted integration", () => {
  const root = mkdtempSync(join(tmpdir(), "ktour-hosted-store-local-"))
  try {
    run({ HK_DATA_DIR: root, HK_ISOLATED_MOCK: "0" }, `
      assert.equal(storeBackendKind(),'file');
      Object.assign(process.env,${JSON.stringify(fixture())});
      assert.throws(()=>storeBackendKind(),invalid);
    `)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("isolated hosted demos keep file storage and CX-only keeps its original Redis namespace", () => {
  const root = mkdtempSync(join(tmpdir(), "ktour-hosted-store-isolation-"))
  try {
    run({ ...fixture(), HK_ISOLATED_MOCK: "1", HK_DATA_DIR: root, HK_STORE_KEY: "invalid-for-integration", KV_REST_API_TOKEN: "" }, `
      assert.equal(storeBackendKind(),'file');
      await withStore(()=>{}); assert.equal(await readStore(db=>db.version),1);
    `)
    run({ ...fixture(), NEXT_PUBLIC_HK_CX_PREVIEW: "1", HK_STORE_KEY: "ktour:cx-preview:fixture", HK_ISSUER_SIGNING_SEED: "c".repeat(64) }, `
      assert.equal(storeBackendKind(),'redis');
    `)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
