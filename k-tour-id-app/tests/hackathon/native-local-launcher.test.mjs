import assert from "node:assert/strict"
import test from "node:test"
import { mkdtempSync, chmodSync, writeFileSync, symlinkSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { nativeLocalEnvironment, readNativeLocalConfig } from "../../scripts/hackathon-native-local.mjs"
const now = Date.parse("2026-09-30T00:00:00Z")
const config = { HK_OPENDID_BRIDGE_URL: "http://127.0.0.1:3193", HK_OPENDID_TRUSTED_ORIGIN: "http://127.0.0.1:3193", HK_OPENDID_ISSUER_DID: "did:omn:issuer", HK_OPENDID_SCHEMA_ID: "http://127.0.0.1:19401/issuer/api/v1/vc/vcschema?name=vc.schema.ktour.pass", HK_OPENDID_CAS_URL: "http://127.0.0.1:19403", HK_OPENDID_TA_URL: "http://127.0.0.1:19400", HK_OPENDID_DID_API_URL: "http://127.0.0.1:19405", HK_OPENDID_BRIDGE_TOKEN: "fixture".repeat(8), HK_OPENDID_OWNER_BINDING_SECRET: "owner".repeat(8), HK_OPENDID_ADMIN_TOKEN: "admin".repeat(8), HK_ISSUER_SIGNING_SEED: "identity".repeat(8), HK_CAMPAIGN_ENDS_AT: "2026-10-01T00:00:00Z" }
test("launcher inherits only shell essentials, pins 3183/dev and keeps old infrastructure unreachable", () => {
  const env = nativeLocalEnvironment(config, { PATH: "/bin", HOME: "/fixture", VERCEL: "1", GEMINI_API_KEY: "must-not-copy", HK_SUI_AGENT_SECRET_KEY: "must-not-copy", KV_REST_API_TOKEN: "must-not-copy" }, now)
  assert.equal(env.PATH, "/bin"); assert.equal(env.NODE_ENV, "development"); assert.equal(env.HK_DATA_DIR, ".data/native-binding-3183")
  assert.equal(env.NEXT_PUBLIC_HK_LOCAL_NATIVE, env.HK_LOCAL_NATIVE)
  for (const key of ["VERCEL", "GEMINI_API_KEY", "HK_SUI_AGENT_SECRET_KEY", "KV_REST_API_TOKEN"]) assert.equal(env[key], undefined)
  for (const patch of [{ HK_OPENDID_CAS_URL: "http://127.0.0.1:19303" }, { HK_OPENDID_BRIDGE_URL: "http://localhost:3193" }, { HK_OPENDID_DID_API_URL: "http://127.0.0.1:19406" }, { HK_OPENDID_SCHEMA_ID: "https://elsewhere.invalid/schema" }, { HK_OPENDID_BRIDGE_TOKEN: "short" }, { HK_CAMPAIGN_ENDS_AT: "2026-09-29T00:00:00Z" }, { HK_CAMPAIGN_ENDS_AT: "2099-01-01T00:00:00Z" }, { GEMINI_API_KEY: "forbidden" }]) assert.throws(() => nativeLocalEnvironment({ ...config, ...patch }, {}, now))
})
test("launcher private config rejects public permissions, symlinks and extra fields without printing values", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "ktour-native-launcher-test-"))), path = join(dir, "config.json")
  try {
    chmodSync(dir, 0o700); writeFileSync(path, JSON.stringify(config), { mode: 0o600 })
    assert.deepEqual(readNativeLocalConfig(path), config)
    chmodSync(path, 0o644); assert.throws(() => readNativeLocalConfig(path)); chmodSync(path, 0o600)
    const link = join(dir, "link.json"); symlinkSync(path, link); assert.throws(() => readNativeLocalConfig(link))
    chmodSync(dir, 0o755); assert.throws(() => readNativeLocalConfig(path))
  } finally { rmSync(dir, { recursive: true }) }
})
