import assert from "node:assert/strict"
import { test } from "node:test"
import { spawnSync } from "node:child_process"
import { allowlistedEnv, runIntegrationReadiness, type ExplicitEnv } from "../../lib/hackathon/integration-readiness"

const PRIVATE = "fixture-only-secret-never-in-output"
const base: ExplicitEnv = {
  HK_API_ENABLED: "1", NEXT_PUBLIC_HK_ENABLED: "1", HK_MODE_CX: "cx",
  HK_CX_API_KEY: PRIVATE, HK_ISSUER_SIGNING_SEED: PRIVATE.repeat(2),
  HK_STORE_KEY: "ktour:integration-preview:fixture", KV_REST_API_URL: "https://fixture.upstash.io/", KV_REST_API_TOKEN: PRIVATE,
  HK_SUI_ISSUER_SECRET_KEY: PRIVATE, HK_SUI_AGENT_SECRET_KEY: PRIVATE, HK_OMNIONE_PRIVATE_KEY: PRIVATE,
  HK_SUI_PACKAGE_ID: "0xc5d26326ffd5267bb5b54625c1e2b9c03f7cca4753232d0b042c62ee74fd975d",
  HK_SUI_CAMPAIGN_ID: "0xe3fce96c9c9e1086ff20dd7453e16ff2c52d3d3324e6e4e34446c7d0dc2ecf16",
  HK_SUI_CAMPAIGN_INITIAL_VERSION: "349181955",
  HK_OMNIONE_REGISTRY_ADDRESS: "0x696bc4e29c8f8079b6d3cd49d310a09577550e4c",
  HK_OMNIONE_RPC_URL: "https://stage-chainapi.omnione.net/?token=" + PRIVATE,
  NEXT_PUBLIC_GOOGLE_CLIENT_ID: "fixture-client", HK_ZKLOGIN_SALT_SEED: PRIVATE,
  ENOKI_API_KEY: PRIVATE, GEMINI_API_KEY: PRIVATE,
}
const report = (env: ExplicitEnv = base, zkLoginRequested = false) => runIntegrationReadiness({ env, zkLoginRequested })
const codes = (r: ReturnType<typeof report>) => Object.values(r.issues).flat().map(x => x.code)

test("complete offline config still cannot claim provider, OpenDID or transaction verification", () => {
  const r = report()
  assert.equal(r.ok, true)
  assert.equal(r.providerVerified, false)
  assert.equal(r.liveExecutionReady, false)
  assert.equal(r.opendidProviderReady, false)
  assert.equal(JSON.stringify(r).includes(PRIVATE), false)
  assert.ok(codes(r).includes("opendid_provider_workflow_separate"))
  assert.equal(r.safety.networkCalls, 0)
  assert.equal(r.safety.signatures, 0)
})

test("existing CX service does not require an API key the adapter treats as optional", () => {
  const r = report({ ...base, HK_CX_API_KEY: "" })
  assert.equal(r.ok, true)
  assert.equal(r.issues.ownerInputs.some(x => x.name === "HK_CX_API_KEY"), false)
  assert.equal(runIntegrationReadiness().issues.ownerInputs.some(x => x.name === "HK_CX_API_KEY"), false)
})

test("empty input inventories missing settings without network or ambient env reads", () => {
  const before = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => { calls++; throw new Error(PRIVATE) }
  try {
    const r = runIntegrationReadiness()
    assert.equal(r.ok, false)
    assert.equal(r.mode.cx, "mock")
    assert.equal(r.mode.ai, "rule")
    assert.equal(r.purpose, "prepare_full_provider_integration")
    assert.equal(r.requestedCapabilities.cx, true)
    assert.equal(r.requestedCapabilities.ai, true)
    assert.ok(codes(r).includes("provided_rpc_not_configured"))
    assert.ok(r.issues.ownerInputs.some(x => x.name === "HK_OMNIONE_PRIVATE_KEY"))
    assert.equal(r.issues.ownerInputs.some(x => x.name === "HK_OMNIONE_RPC_URL"), false)
    assert.equal(calls, 0)
  } finally { globalThis.fetch = before }
})

test("previously supplied credentials require our config work, not duplicate owner requests", () => {
  const r = runIntegrationReadiness({ availableInputs: { HK_CX_API_KEY: true, HK_ISSUER_SIGNING_SEED: true, NEXT_PUBLIC_GOOGLE_CLIENT_ID: true } })
  for (const name of ["HK_CX_API_KEY", "HK_ISSUER_SIGNING_SEED", "NEXT_PUBLIC_GOOGLE_CLIENT_ID"]) {
    assert.equal(r.issues.ownerInputs.some(x => x.name === name), false)
    assert.ok(r.issues.internalConfigWork.some(x => x.name === name && x.code === "available_input_not_configured"))
  }
  assert.equal(r.issues.ownerInputs.some(x => x.name === "HK_STORE_KEY"), false)
})

for (const [name, value, expected] of [
  ["NEXT_PUBLIC_HK_CX_PREVIEW", "1", "existing_cx_profile_cannot_execute_chains"],
  ["NEXT_PUBLIC_HK_PREVIEW_READ_ONLY", "1", "isolated_profile_cannot_execute_chains"],
  ["HK_ISOLATED_MOCK", "1", "isolated_profile_cannot_execute_chains"],
  ["VERCEL_ENV", "production", "production_not_approved"],
  ["HK_MODE_CX", "mock", "cx_mock_not_provider_verification"],
  ["HK_API_ENABLED", "0", "api_not_enabled"],
] as const) test("runtime profile gate: " + name, () => {
  const r = report({ ...base, [name]: value })
  assert.equal(r.ok, false)
  assert.ok(codes(r).includes(expected))
  if (["NEXT_PUBLIC_HK_PREVIEW_READ_ONLY", "HK_ISOLATED_MOCK"].includes(name)) assert.equal(r.mode.cx, "mock")
})

test("configured keys do not override an explicit AI rule mode or isolated mode", () => {
  for (const env of [{ ...base, HK_AI_MODE: "rule" }, { ...base, HK_ISOLATED_MOCK: "1" }]) {
    const r = report(env)
    assert.equal(r.mode.ai, "rule")
    assert.ok(codes(r).includes("ai_rule_fallback_not_provider_verified"))
  }
  const r = report({ ...base, GEMINI_API_KEY: "", HK_AI_MODE: "gemini" })
  assert.equal(r.mode.ai, "rule")
  assert.ok(r.issues.ownerInputs.some(x => x.name === "GEMINI_API_KEY"))
})

test("Sui sponsor falls back to issuer; deployed objects and network must match", () => {
  assert.equal(report().issues.ownerInputs.some(x => x.name === "HK_SUI_SPONSOR_SECRET_KEY"), false)
  for (const [name, value] of [["HK_SUI_PACKAGE_ID", "0x" + "1".repeat(64)], ["HK_SUI_CAMPAIGN_ID", "0x" + "2".repeat(64)], ["HK_SUI_CAMPAIGN_INITIAL_VERSION", "1"]] as const) {
    assert.ok(codes(report({ ...base, [name]: value })).includes("deployed_target_mismatch"))
  }
  assert.ok(codes(report({ ...base, HK_SUI_NETWORK: "mainnet" })).includes("sui_target_requires_review"))
  assert.ok(codes(report({ ...base, HK_SUI_GRPC_URL: "https://evil.invalid" })).includes("sui_target_requires_review"))
})

test("OmniOne needs the exact registry/chain and canonical authenticated RPC", () => {
  for (const url of ["https://test.stage-chainapi.omnione.net/?token=" + PRIVATE, "https://stage-chainapi.omnione.net/?token=API_KEY", "https://stage-chainapi.omnione.net/?token=x&token=y", "https://stage-chainapi.omnione.net/?token=x#secret", "http://stage-chainapi.omnione.net/?token=x"]) {
    const r = report({ ...base, HK_OMNIONE_RPC_URL: url })
    assert.ok(codes(r).includes("omnione_rpc_configuration_invalid"))
    assert.equal(JSON.stringify(r).includes(url), false)
  }
  assert.ok(codes(report({ ...base, HK_OMNIONE_CHAIN_ID: "1" })).includes("omnione_chain_configuration_invalid"))
  assert.ok(codes(report({ ...base, HK_OMNIONE_REGISTRY_ADDRESS: "0x" + "1".repeat(40) })).includes("deployed_target_mismatch"))
  assert.ok(codes(report({ ...base, HK_OMNIONE_RPC_URL: "" })).includes("provided_rpc_not_configured"))
})

test("Redis must use one complete alias pair and a dedicated integration namespace", () => {
  for (const env of [
    { ...base, KV_REST_API_TOKEN: "" },
    { ...base, UPSTASH_REDIS_REST_TOKEN: PRIVATE },
    { ...base, KV_REST_API_URL: "https://evil.invalid/" },
    { ...base, KV_REST_API_URL: "https://fixture.upstash.io/path" },
    { ...base, HK_STORE_KEY: "ktour:cx-preview:existing" },
  ]) assert.equal(report(env).ok, false)
  assert.equal(report({ ...base, KV_REST_API_URL: "", KV_REST_API_TOKEN: "", UPSTASH_REDIS_REST_URL: "https://fixture.upstash.io", UPSTASH_REDIS_REST_TOKEN: PRIVATE }).ok, true)
})

test("existing Enoki wins, but explicit prover paths still require network/access verification", () => {
  const both = report({ ...base, HK_ZKLOGIN_PROVER_URL: "https://prover.invalid/v1" }, true)
  assert.equal(both.issues.ownerInputs.some(x => x.code === "zklogin_provider_path_missing"), false)
  const prover = report({ ...base, ENOKI_API_KEY: "", HK_ZKLOGIN_PROVER_URL: "https://prover.invalid/v1" }, true)
  assert.equal(codes(prover).includes("zklogin_prover_url_invalid"), false)
  assert.ok(codes(prover).includes("zklogin_prover_network_unverified"))
  assert.ok(codes(prover).includes("zklogin_prover_access_unverified"))
  assert.equal(prover.ok, false)
  assert.ok(codes(both).includes("zklogin_enoki_app_configuration_unverified"))
  assert.ok(codes(report({ ...base, ENOKI_API_KEY: "", HK_ZKLOGIN_PROVER_URL: "http://prover.invalid/v1" }, true)).includes("zklogin_prover_url_invalid"))
  assert.ok(codes(prover).includes("oauth_callback_registration_unverified"))
  assert.ok(codes(prover).includes("google_login_and_wallet_approval_required"))
})

test("sample or missing CX subject seeds are not accepted for real identity", () => {
  for (const seed of ["", "change-me", "ondo-hackathon-sample-issuer-seed-change-me"]) {
    const r = report({ ...base, HK_ISSUER_SIGNING_SEED: seed })
    assert.equal(r.ok, false)
    assert.ok(r.issues.ownerInputs.some(x => x.code === "issuer_seed_missing_or_placeholder"))
  }
})

test("malicious getters, extra names, nonstrings, and hostile objects fail with fixed codes", () => {
  let reads = 0
  const getter = { get HK_STORE_KEY() { reads++; throw new Error(PRIVATE) } }
  for (const input of [getter, null, [], { SECRET: PRIVATE }, { HK_STORE_KEY: null }, { HK_STORE_KEY: 1 }, { HK_STORE_KEY: PRIVATE + "\n" }]) {
    assert.throws(() => allowlistedEnv(input as ExplicitEnv), /^Error: readiness_input_invalid$/)
  }
  assert.equal(reads, 0)
  for (const input of [{ get env() { reads++; throw new Error(PRIVATE) } }, { availableInputs: { get HK_STORE_KEY() { reads++; return true } } }, { aiRequested: PRIVATE }, { extra: PRIVATE }]) {
    assert.throws(() => runIntegrationReadiness(input as never), /^Error: readiness_input_invalid$/)
  }
  assert.equal(reads, 0)
})

const cli = (args: string[], input = "") => spawnSync("node", ["--import", "tsx", "scripts/hackathon-integration-readiness.ts", ...args], {
  input, encoding: "utf8", maxBuffer: 128 * 1024, timeout: 15_000, env: { ...process.env, GEMINI_API_KEY: PRIVATE },
})
test("CLI empty inventory ignores ambient credentials and exits nonzero for missing config", () => {
  const r = cli(["--offline"])
  assert.equal(r.status, 1)
  const body = JSON.parse(r.stdout)
  assert.ok(body.issues.ownerInputs.some((x: { name: string }) => x.name === "GEMINI_API_KEY"))
  assert.equal((r.stdout + r.stderr).includes(PRIVATE), false)
})

test("CLI consumes bounded stdin envelope without secret values in stdout/stderr", () => {
  const r = cli(["--offline", "--stdin"], JSON.stringify({ env: base, zkLoginRequested: false }))
  assert.equal(r.status, 0)
  assert.equal(JSON.parse(r.stdout).providerVerified, false)
  assert.equal((r.stdout + r.stderr).includes(PRIVATE), false)
  assert.equal(r.stderr, "")
})

test("CLI rejects unsafe argv, duplicate switches, unknown input fields and oversized input", () => {
  for (const args of [[], ["--set", "SECRET=" + PRIVATE], ["--offline", "--offline"], ["--stdin", "--offline"]]) {
    const r = cli(args)
    assert.equal(r.status, 1)
    assert.equal((r.stdout + r.stderr).includes(PRIVATE), false)
  }
  for (const input of ["null", "[]", JSON.stringify({ env: { SECRET: PRIVATE } }), JSON.stringify({ aiRequested: PRIVATE }), "x".repeat(33000)]) {
    const r = cli(["--offline", "--stdin"], input)
    assert.equal(r.status, 1)
    assert.equal((r.stdout + r.stderr).includes(PRIVATE), false)
    assert.equal(JSON.parse(r.stdout).error, "stdin_input_invalid")
  }
})
