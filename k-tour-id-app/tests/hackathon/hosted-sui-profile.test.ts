import assert from "node:assert/strict"
import { before, after, test } from "node:test"
import { HkError } from "../../lib/hackathon/util"
import type { HostedSuiEnv } from "../../lib/hackathon/hosted-sui-profile"

let subject: typeof import("../../lib/hackathon/hosted-sui-profile")
const savedFetch = globalThis.fetch
before(async () => { globalThis.fetch = async () => { throw new Error("unexpected_network") }; subject = await import("../../lib/hackathon/hosted-sui-profile") })
after(() => { globalThis.fetch = savedFetch })
const NOW = Date.parse("2026-09-28T14:00:00Z")
const op = "op_abcdefgh12345678", path = (action: string) => `/operations/${op}/${action}`
const signature = (flag = 0) => Buffer.concat([Buffer.from([flag]), Buffer.alloc(96, 7)]).toString("base64")
const hash = "0x" + "1".repeat(64)
const mismatch = (e: unknown) => e instanceof HkError && e.code === "hosted_sui_scope" && e.status === 403 && !e.message.includes("fixture-secret")

function fixture(mode: "mock" | "cx" = "mock"): HostedSuiEnv {
  const p = subject.PIN
  return {
    NODE_ENV: "production", NEXT_PUBLIC_HK_HOSTED_SUI: "1", HK_HOSTED_SUI_ENABLED: "1", NEXT_PUBLIC_HK_ENABLED: "1", HK_API_ENABLED: "1",
    NEXT_PUBLIC_HK_CX_PREVIEW: "0", NEXT_PUBLIC_HK_PREVIEW_READ_ONLY: "0", NEXT_PUBLIC_HK_INTEGRATION_PREVIEW: "0", HK_ISOLATED_MOCK: "0",
    HK_MODE_CX: mode, HK_MODE_OPENDID: "mock", HK_AI_MODE: "rule", HK_HOSTED_SUI_EXPIRES_AT: p.maxExpiresAt,
    HK_HOSTED_SUI_ACCESS_SECRET: "a".repeat(64), HK_HOSTED_SUI_ACCESS_CODE: "b".repeat(48), HK_ISSUER_SIGNING_SEED: "c".repeat(64),
    HK_SUI_NETWORK: p.network, HK_SUI_GRPC_URL: p.rpc, HK_SUI_PACKAGE_ID: p.packageId, HK_SUI_CAMPAIGN_ID: p.campaignId, HK_SUI_CAMPAIGN_INITIAL_VERSION: p.campaignInitialVersion,
    HK_SUI_ISSUER_SECRET_KEY: "suiprivkey1" + "q".repeat(59), HK_SUI_AGENT_SECRET_KEY: "suiprivkey1" + "p".repeat(59),
    HK_STORE_KEY: p.storeKey, UPSTASH_REDIS_REST_URL: "https://hosted-fixture.upstash.io", UPSTASH_REDIS_REST_TOKEN: "d".repeat(64),
    VERCEL: "1", VERCEL_ENV: "production", VERCEL_TARGET_ENV: "production", VERCEL_URL: "ktour-id-deployment-fixture.vercel.app", VERCEL_REGION: p.region,
    VERCEL_PROJECT_ID: p.projectId, VERCEL_ORG_ID: p.orgId, VERCEL_GIT_PROVIDER: "github", VERCEL_GIT_COMMIT_REF: p.branch,
    VERCEL_GIT_REPO_OWNER: p.repoOwner, VERCEL_GIT_REPO_SLUG: p.repoName, VERCEL_GIT_COMMIT_SHA: "e".repeat(40),
    ...(mode === "cx" ? { HK_CX_BASE_URL: "https://cx.raonsecure.co.kr:18543", HK_CX_PROVIDER: "comdl", HK_CX_ZKP_TYPE: "AdultVerify" } : {}),
  }
}

function connected() {
  return { ...fixture("cx"), NEXT_PUBLIC_HK_HOSTED_PROVIDERS: subject.CONNECTED_PIN.marker, HK_HOSTED_PROVIDERS: subject.CONNECTED_PIN.marker }
}
function google() {
  return { ...connected(), HK_HOSTED_ZKLOGIN_ENABLED: "1", NEXT_PUBLIC_GOOGLE_CLIENT_ID: subject.CONNECTED_PIN.googleClientId,
    HK_ZKLOGIN_SALT_SEED: "7".repeat(64), HK_ZKLOGIN_PROVER_URL: subject.CONNECTED_PIN.prover }
}
function omni() {
  const p = subject.CONNECTED_PIN
  return { ...connected(), HK_HOSTED_OMNIONE_ENABLED: "1", HK_OMNIONE_TARGET_ID: p.targetId, HK_OMNIONE_CHAIN_ID: p.chainId,
    HK_OMNIONE_REGISTRY_ADDRESS: p.registry, HK_OMNIONE_RECORDER_ADDRESS: p.recorder, HK_OMNIONE_GAS_LIMIT: p.gasLimit,
    HK_OMNIONE_PRIVATE_KEY: "8".repeat(64), HK_OMNIONE_RPC_URL: "https://stage-chainapi.omnione.net/?token=fixture-token" }
}

test("connected capabilities require the exact dual marker and explicit independent flags", () => {
  assert.deepEqual(subject.hostedSuiPreflightIssues(connected(), NOW), [])
  for (const flags of [{ NEXT_PUBLIC_HK_HOSTED_PROVIDERS: undefined }, { HK_HOSTED_PROVIDERS: "other" }, { HK_HOSTED_AI_ENABLED: "true" }, { HK_HOSTED_ZKLOGIN_ENABLED: "unknown" }]) {
    assert.ok(subject.hostedSuiPreflightIssues({ ...connected(), ...flags }, NOW).some(x => x === "connected_profile" || x === "connected_flags"))
  }
  for (const flag of ["HK_HOSTED_AI_ENABLED", "HK_HOSTED_ZKLOGIN_ENABLED", "HK_HOSTED_OMNIONE_ENABLED"]) {
    assert.ok(subject.hostedSuiPreflightIssues({ ...fixture(), [flag]: "1" }, NOW).includes("connected_flags"))
  }
  assert.equal(subject.hostedAiEnabled(connected()), false)
  assert.equal(subject.hostedZkLoginEnabled(connected()), false)
  assert.equal(subject.hostedOmnioneEnabled(connected()), false)
})

test("connected AI permits only the fixed model/key and preserves every original lifetime/store budget", () => {
  const env = { ...connected(), HK_HOSTED_AI_ENABLED: "1", HK_AI_MODE: "gemini", GEMINI_MODEL: subject.CONNECTED_PIN.model, GEMINI_API_KEY: "a".repeat(40) }
  assert.deepEqual(subject.hostedSuiPreflightIssues(env, NOW), [])
  for (const patch of [{ GEMINI_MODEL: "gemini-2.5-pro" }, { GEMINI_API_KEY: "short" }, { GEMINI_BASE_URL: "https://foreign.invalid" }, { GOOGLE_GENERATIVE_AI_API_KEY: "another-key" }, { HK_HOSTED_AI_ENABLED: "0" }]) {
    assert.ok(subject.hostedSuiPreflightIssues({ ...env, ...patch }, NOW).includes("no_gemini"))
  }
  for (const patch of [{ HK_STORE_KEY: "fresh-ledger" }, { HK_HOSTED_SUI_MAX_OPERATIONS: "11" }, { HK_HOSTED_SUI_GAS_BUDGET_MIST: "10000001" }, { HK_HOSTED_SUI_EXPIRES_AT: "2026-10-01T00:00:00Z" }]) {
    assert.ok(subject.hostedSuiPreflightIssues({ ...env, ...patch }, NOW).length > 0)
  }
  assert.ok(subject.hostedSuiPreflightIssues(env, subject.PIN.maxEnd).includes("expiry"))
})

test("connected Google pins the supplied public client, dedicated salt shape and fixed Testnet prover", () => {
  assert.deepEqual(subject.hostedSuiPreflightIssues(google(), NOW), [])
  for (const patch of [{ NEXT_PUBLIC_GOOGLE_CLIENT_ID: "other.apps.googleusercontent.com" }, { HK_ZKLOGIN_SALT_SEED: "short" }, { HK_ZKLOGIN_PROVER_URL: "https://prover-dev.mystenlabs.com/v1" }, { GOOGLE_CLIENT_SECRET: "forbidden" }, { ENOKI_API_KEY: "forbidden" }, { HK_ZKLOGIN_ANY: "forbidden" }, { HK_HOSTED_ZKLOGIN_ENABLED: "0" }]) {
    assert.ok(subject.hostedSuiPreflightIssues({ ...google(), ...patch }, NOW).includes("no_google"))
  }
})

test("connected Google exposes only the owned-attempt endpoints and rejects old unbound proof bodies", () => {
  const env = google(), attemptId = "zkl_" + "a".repeat(24)
  for (const [method, value] of [["GET", "/zklogin/params"], ["GET", `/zklogin/status/${op}/${attemptId}`], ["POST", "/zklogin/start"], ["POST", "/zklogin/prove"], ["POST", "/zklogin/cancel"]]) {
    assert.equal(subject.hostedSuiRouteAllowed(method, value, env), true)
    assert.equal(subject.hostedSuiRouteAllowed(method, value, connected()), false)
  }
  subject.assertHostedSuiBody("/zklogin/start", { operationId: op, attemptId, extendedEphemeralPublicKey: "fixture-key", maxEpoch: 10, jwtRandomness: "123" }, env)
  subject.assertHostedSuiBody("/zklogin/prove", { operationId: op, attemptId, jwt: "a.b.c" }, env)
  subject.assertHostedSuiBody("/zklogin/cancel", { operationId: op, attemptId }, env)
  for (const body of [{ jwt: "a.b.c", extendedEphemeralPublicKey: "key", maxEpoch: 1, jwtRandomness: "123" }, { operationId: op, attemptId, jwt: "a.b.c", proof: {} }, { operationId: "other", attemptId, jwt: "a.b.c" }, { operationId: op, attemptId, jwt: "a.b.c\n" }]) {
    assert.throws(() => subject.assertHostedSuiBody("/zklogin/prove", body, env), mismatch)
  }
  assert.throws(() => subject.assertHostedSuiBody(path("delegation/submit"), { txBytesDigest: hash, userSignature: signature(5) }, env), mismatch)
  assert.equal(subject.hostedSuiRouteAllowed("POST", "/outbox/flush", env), false)
  assert.equal(subject.hostedSuiRouteAllowed("POST", path("provider/issuance/start"), env), false)
})

test("connected wallet boundary accepts canonical zkLogin serialization but never a mislabeled demo signature", async () => {
  const { getZkLoginSignature } = await import("@mysten/sui/zklogin")
  const userSignature = getZkLoginSignature({ maxEpoch: 10, userSignature: signature(), inputs: {
    proofPoints: { a: ["1", "2", "3"], b: [["1", "2"], ["3", "4"], ["5", "6"]], c: ["1", "2", "3"] },
    issBase64Details: { value: Buffer.from('"iss":"https://accounts.google.com",').toString("base64url"), indexMod4: 0 }, headerBase64: "fixture", addressSeed: "123",
  } })
  // Serialization only: service must independently verify this synthetic proof.
  const prepare = { userAddress: hash, signer: "zklogin", walletProof: { message: `ondo-hk-wallet-proof:${op}:decision_fixture`, signature: userSignature }, approvedProposalDigest: hash }
  subject.assertHostedSuiBody(path("delegation/prepare"), prepare, google())
  subject.assertHostedSuiBody(path("delegation/submit"), { txBytesDigest: hash, userSignature }, google())
  assert.throws(() => subject.assertHostedSuiBody(path("delegation/prepare"), prepare, fixture()), mismatch)
  assert.throws(() => subject.assertHostedSuiBody(path("delegation/prepare"), { ...prepare, signer: "demo" }, google()), mismatch)
  assert.throws(() => subject.assertHostedSuiBody(path("delegation/prepare"), { ...prepare, walletProof: { ...prepare.walletProof, signature: signature() } }, google()), mismatch)
})

test("connected OmniOne exact new Stage tuple never broadens native or old registry access", () => {
  const env = omni()
  assert.deepEqual(subject.hostedSuiPreflightIssues(env, NOW), [])
  assert.equal(subject.hostedOmnioneEnabled(env), true)
  subject.assertHostedSuiBody(path("redeem"), { idempotencyKey: "idem_abcd1234" }, env)
  for (const patch of [{ HK_OMNIONE_TARGET_ID: "stage-legacy-20260914" }, { HK_OMNIONE_RECORDER_ADDRESS: hash }, { HK_OMNIONE_RPC_URL: "https://foreign.invalid/?token=x" }, { HK_OMNIONE_PRIVATE_KEY: "bad" }, { HK_MODE_CX: "mock" }, { HK_OMNIONE_GAS_LIMIT: "300001" }, { HK_OMNIONE_UNKNOWN: "x" }]) {
    assert.ok(subject.hostedSuiPreflightIssues({ ...env, ...patch }, NOW).some(i => i === "no_omnione" || i === "connected_omnione"))
  }
  for (const body of [{}, { idempotencyKey: "x", targetId: "other" }, { idempotencyKey: "x".repeat(81) }]) assert.throws(() => subject.assertHostedSuiBody(path("redeem"), body, env), mismatch)
  assert.ok(subject.hostedSuiPreflightIssues({ ...env, HK_OPENDID_BRIDGE_URL: "https://bridge.invalid" }, NOW).includes("no_opendid_provider"))
})

test("actual connected config authorizes exact provider adapter strings, not native or arbitrary services", async () => {
  const oldEnv = process.env, oldNow = Date.now
  try {
    process.env = { ...omni(), ...google(), NODE_ENV: "test", HK_HOSTED_AI_ENABLED: "1", HK_AI_MODE: "gemini", GEMINI_MODEL: subject.CONNECTED_PIN.model, GEMINI_API_KEY: "a".repeat(40) }
    Date.now = () => NOW
    const { assertExternalServicesEnabled, hkPublicConfig } = await import("../../lib/hackathon/config")
    for (const name of ["Sui", "Sui signing", "Sui delegation", "Sui agent execution", "Sui grant lookup", "Gemini proposal", "zkLogin provider authentication", "OmniOne Chain", "OmniOne Chain signing", "OmniOne Chain submission", "OmniOne Chain evidence"]) assert.doesNotThrow(() => assertExternalServicesEnabled(name), name)
    for (const name of ["OpenDID", "OmniOne signing", "Gemini chat", "other"]) assert.throws(() => assertExternalServicesEnabled(name), (e: unknown) => e instanceof HkError && e.code === "hosted_sui_scope")
    assert.equal(hkPublicConfig().modes.zklogin, "google")
    assert.equal(hkPublicConfig().capabilities.hostedTestRedemptionEnabled, true)
    assert.equal(hkPublicConfig().capabilities.opendidProviderReady, false)
    assert.equal(hkPublicConfig().modes.opendid, "mock")
    process.env.HK_HOSTED_PROVIDERS = "wrong"
    for (const name of ["Gemini proposal", "zkLogin provider authentication", "OmniOne Chain submission"]) assert.throws(() => assertExternalServicesEnabled(name))
  } finally { process.env = oldEnv; Date.now = oldNow }
})

test("policy import performs no network; constants cap lifetime operations and gas", () => {
  assert.equal(subject.PIN.branch, "deploy/sui-main-20260928")
  assert.equal(subject.PIN.publicOrigin, "https://ktour-id.vercel.app")
  assert.equal(subject.PIN.maxOperations, 10); assert.equal(subject.PIN.gasBudgetMIST, 10_000_000)
  assert.equal(subject.PIN.maxTransactions, subject.PIN.maxOperations * 3)
  assert.equal(subject.PIN.maxTotalGasMIST, subject.PIN.maxTransactions * subject.PIN.gasBudgetMIST)
  assert.equal(subject.PIN.maxEnd, Date.parse("2026-09-30T14:59:59Z"))
  assert.ok(Object.isFrozen(subject.PIN))
})

test("either flag or exact branch requires protection; disabling flags cannot expose the branch", () => {
  assert.equal(subject.isHostedSuiProfile({}), false)
  for (const env of [{ NEXT_PUBLIC_HK_HOSTED_SUI: "1" }, { HK_HOSTED_SUI_ENABLED: "1" }, { VERCEL_GIT_COMMIT_REF: subject.PIN.branch, NEXT_PUBLIC_HK_HOSTED_SUI: "0", HK_HOSTED_SUI_ENABLED: "0" }]) assert.equal(subject.isHostedSuiProfile(env), true)
  for (const env of [{ NEXT_PUBLIC_HK_HOSTED_SUI: "true" }, { VERCEL_GIT_COMMIT_REF: "integration/autonomous-finish-20260927" }, { VERCEL_GIT_COMMIT_REF: subject.PIN.branch + "-other" }]) assert.equal(subject.isHostedSuiProfile(env), false)
})

test("explicit mock and provider deployments both validate without changing their chosen mode", () => {
  for (const mode of ["mock", "cx"] as const) for (const target of ["preview", "production"]) {
    const env = { ...fixture(mode), VERCEL_ENV: target, VERCEL_TARGET_ENV: target }, before = structuredClone(env)
    assert.deepEqual(subject.hostedSuiPreflightIssues(env, NOW), [])
    assert.deepEqual(env, before)
  }
  const env = fixture("cx"); env.HK_CX_BASE_URL = "https://fixture-secret.invalid"
  assert.ok(subject.hostedSuiPreflightIssues(env, NOW).includes("cx_origin")); assert.equal(env.HK_MODE_CX, "cx")
})

test("runtime uses documented project metadata without requiring the CLI org variable", () => {
  const env = fixture()
  delete env.VERCEL_ORG_ID
  assert.deepEqual(subject.hostedSuiPreflightIssues(env, NOW), [])
  assert.ok(subject.hostedSuiPreflightIssues({ ...env, VERCEL_PROJECT_ID: undefined }, NOW).includes("project"))
  for (const value of ["", "foreign-team"]) assert.ok(subject.hostedSuiPreflightIssues({ ...env, VERCEL_ORG_ID: value }, NOW).includes("team"))
})

test("hosted wallet verification permits only the default or exact Testnet GraphQL endpoint", () => {
  for (const base of [fixture(), google()]) {
    for (const value of [undefined, "", "https://graphql.testnet.sui.io/graphql"]) {
      assert.deepEqual(subject.hostedSuiPreflightIssues({ ...base, HK_SUI_GRAPHQL_URL: value }, NOW), [])
    }
    for (const value of ["https://foreign.invalid/graphql", "http://graphql.testnet.sui.io/graphql", "https://graphql.testnet.sui.io/graphql?x=1", "https://graphql.testnet.sui.io/graphql#x", "https://graphql.mainnet.sui.io/graphql"]) {
      assert.deepEqual(subject.hostedSuiPreflightIssues({ ...base, HK_SUI_GRAPHQL_URL: value }, NOW), ["sui_graphql"])
    }
  }
})

test("missing or crossed build/runtime/mode/metadata/chain pins fail closed with fixed names", () => {
  const mutations: Array<[string, string | undefined, string]> = [
    ["NEXT_PUBLIC_HK_HOSTED_SUI", "0", "hosted_build"], ["HK_HOSTED_SUI_ENABLED", "0", "runtime_enabled"],
    ["NEXT_PUBLIC_HK_CX_PREVIEW", "1", "no_cx_build"], ["NEXT_PUBLIC_HK_PREVIEW_READ_ONLY", "1", "no_readonly_build"], ["NEXT_PUBLIC_HK_INTEGRATION_PREVIEW", "1", "no_integration_build"],
    ["HK_API_ENABLED", "0", "api_enabled"], ["HK_ISOLATED_MOCK", "1", "non_isolated"], ["HK_MODE_CX", undefined, "cx_mode"], ["HK_MODE_CX", "fallback", "cx_mode"],
    ["HK_MODE_OPENDID", "opendid", "sample_credential"], ["HK_AI_MODE", "gemini", "rule_ai"], ["HK_CX_SAMPLE_FALLBACK", "1", "no_cx_fallback"],
    ["HK_SUI_NETWORK", "mainnet", "sui_network"], ["HK_SUI_GRPC_URL", "https://fixture-secret.invalid", "sui_rpc"], ["HK_SUI_PACKAGE_ID", hash, "sui_package"],
    ["HK_SUI_CAMPAIGN_ID", hash, "sui_campaign"], ["HK_SUI_CAMPAIGN_INITIAL_VERSION", "349181955", "sui_shared_version"], ["HK_SUI_CHAIN_IDENTIFIER", "wrong", "sui_chain"],
    ["HK_SUI_ISSUER_SECRET_KEY", undefined, "issuer_key"], ["HK_SUI_AGENT_SECRET_KEY", undefined, "agent_key"], ["HK_SUI_SPONSOR_SECRET_KEY", "bad", "sponsor_key"],
    ["HK_ISSUER_SIGNING_SEED", "sample-seed-change-me", "credential_seed"], ["HK_HOSTED_SUI_ACCESS_SECRET", "short", "access_secret"], ["HK_HOSTED_SUI_ACCESS_CODE", "short", "access_code"],
    ["VERCEL", undefined, "hosted_platform"], ["VERCEL_ENV", "development", "deployment_target"], ["VERCEL_TARGET_ENV", "preview", "deployment_target"],
    ["VERCEL_PROJECT_ID", "foreign-project", "project"], ["VERCEL_ORG_ID", "foreign-team", "team"], ["VERCEL_REGION", "iad1", "seoul"],
    ["VERCEL_GIT_COMMIT_REF", "main", "git_branch"], ["VERCEL_GIT_REPO_OWNER", "other", "git_owner"], ["VERCEL_GIT_REPO_SLUG", "other", "git_repo"],
    ["VERCEL_GIT_COMMIT_SHA", "short", "git_revision"], ["VERCEL_GIT_PROVIDER", "gitlab", "git_provider"], ["VERCEL_URL", "https://fixture-secret.invalid", "immutable_host"],
    ["HK_HOSTED_SUI_MAX_OPERATIONS", "11", "operation_budget"], ["HK_HOSTED_SUI_GAS_BUDGET_MIST", "10000001", "gas_budget"],
    ["HK_CAMPAIGN_VENUE_ID", "another-place", "campaign_scope"], ["HK_CAMPAIGN_ENDS_AT", "2027-01-01T00:00:00Z", "campaign_expiry"],
  ]
  for (const [key, value, issue] of mutations) {
    const env = { ...fixture(), [key]: value }, issues = subject.hostedSuiPreflightIssues(env, NOW)
    assert.ok(issues.includes(issue), `${key} must report ${issue}`)
    assert.ok(issues.every(i => /^[a-z_]+$/.test(i))); assert.equal(JSON.stringify(issues).includes("fixture-secret"), false)
  }
})

test("expiry has a hard end, no invalid/infinite/expired timestamps or arbitrary dates", () => {
  for (const expiry of [undefined, "", "bad", "2026-09-28T14:00:00Z", "2026-09-30T15:00:00Z", "2026-09-30", "2026-09-30T23:59:59+09:00"]) {
    assert.ok(subject.hostedSuiPreflightIssues({ ...fixture(), HK_HOSTED_SUI_EXPIRES_AT: expiry }, NOW).includes("expiry"))
  }
  for (const now of [NaN, Infinity, subject.PIN.maxEnd]) assert.ok(subject.hostedSuiPreflightIssues(fixture(), now).includes("expiry"))
})

test("provider and Google/OmniOne/Gemini settings cannot activate this profile", () => {
  for (const [key, issue] of [["NEXT_PUBLIC_GOOGLE_CLIENT_ID", "no_google"], ["GOOGLE_CLIENT_SECRET", "no_google"], ["HK_ZKLOGIN_SALT_SEED", "no_google"], ["GEMINI_API_KEY", "no_gemini"], ["HK_OMNIONE_PRIVATE_KEY", "no_omnione"], ["HK_OMNIONE_RPC_URL", "no_omnione"], ["HK_OPENDID_TAS_URL", "no_opendid_provider"], ["HK_OPENDID_ISSUER_DID", "no_opendid_provider"]]) {
    const issues = subject.hostedSuiPreflightIssues({ ...fixture(), [key]: "fixture-secret" }, NOW)
    assert.ok(issues.includes(issue)); assert.equal(JSON.stringify(issues).includes("fixture-secret"), false)
  }
})

test("storage requires exactly one full Redis pair and the fixed non-canary namespace", () => {
  for (const patch of [
    { HK_STORE_KEY: "ondo:hackathon:journey:v1" }, { HK_STORE_KEY: "ktour:integration-preview:any" }, { HK_STORE_CANARY_UUID: "present" },
    { UPSTASH_REDIS_REST_URL: undefined }, { UPSTASH_REDIS_REST_TOKEN: undefined },
    { UPSTASH_REDIS_REST_URL: "http://hosted-fixture.upstash.io" }, { UPSTASH_REDIS_REST_URL: "https://user:fixture-secret@hosted-fixture.upstash.io" },
    { UPSTASH_REDIS_REST_URL: "https://hosted-fixture.upstash.io/?token=fixture-secret" }, { UPSTASH_REDIS_REST_URL: "https://hosted-fixture.upstash.io:8080" },
    { UPSTASH_REDIS_REST_URL: "https://hosted-fixture.upstash.io.evil.invalid" }, { UPSTASH_REDIS_REST_TOKEN: "bad token" },
    { KV_REST_API_URL: "https://second.upstash.io", KV_REST_API_TOKEN: "f".repeat(64) },
  ]) assert.ok(subject.hostedSuiPreflightIssues({ ...fixture(), ...patch }, NOW).some(i => ["redis_configuration", "store_key", "no_store_canary"].includes(i)))
  const env = fixture(); env.KV_REST_API_URL = env.UPSTASH_REDIS_REST_URL; env.KV_REST_API_TOKEN = env.UPSTASH_REDIS_REST_TOKEN
  delete env.UPSTASH_REDIS_REST_URL; delete env.UPSTASH_REDIS_REST_TOKEN
  assert.deepEqual(subject.hostedSuiPreflightIssues(env, NOW), [])
})

test("local-only test metadata cannot waive hosted production target checks", () => {
  const env = fixture()
  for (const key of Object.keys(env)) if (key === "VERCEL" || key.startsWith("VERCEL_")) delete env[key]
  env.NODE_ENV = "test"; env.HK_HOSTED_SUI_LOCAL_TEST = "1"
  assert.deepEqual(subject.hostedSuiPreflightIssues(env, NOW), [])
  assert.ok(subject.hostedSuiPreflightIssues({ ...env, NODE_ENV: "production" }, NOW).includes("hosted_platform"))
  assert.ok(subject.hostedSuiPreflightIssues({ ...fixture(), HK_HOSTED_SUI_LOCAL_TEST: "1" }, NOW).includes("no_local_override"))
})

test("derived public signer addresses must match all three exact role pins", () => {
  const p = subject.PIN, roles = { issuer: p.issuer, agent: p.agent, sponsor: p.sponsor }
  subject.assertHostedSuiRoles(roles)
  for (const key of ["issuer", "agent", "sponsor"] as const) assert.throws(() => subject.assertHostedSuiRoles({ ...roles, [key]: hash }), mismatch)
  assert.throws(() => subject.assertHostedSuiRoles({ ...roles, agent: p.issuer }), mismatch)
})

test("canonical string and array paths accept only the scoped journey endpoints", () => {
  const gets = ["config", "me", `places/${subject.PIN.venueId}/demo-entitlements`, `operations/${op}`, `operations/${op}/evidence`]
  const posts = ["sessions", "operations", "hosted/access", ...["identity/start", "identity/complete", "credential/issue", "credential/holder-ack", "presentation/request", "presentation/submit", "presentation/deny", "proposal", "delegation/prepare", "delegation/submit", "agent/run", "cancel", "reconcile", "sui/agent-address"].map(a => `operations/${op}/${a}`)]
  for (const [method, paths] of [["GET", gets], ["POST", posts]] as const) for (const value of paths) {
    assert.equal(subject.hostedSuiRouteAllowed(method, value.split("/")), true)
    assert.equal(subject.hostedSuiRouteAllowed(method, "/" + value), true)
    assert.equal(subject.hostedSuiRouteAllowed(method, "/api/hackathon/v1/" + value), true)
  }
  for (const method of ["HEAD", "OPTIONS", "PUT", "PATCH", "DELETE", "post", "get"]) assert.equal(subject.hostedSuiRouteAllowed(method, "/config"), false)
})

test("provider/redemption/outbox routes, tails, encodings and malformed IDs never pass", () => {
  for (const value of ["/zklogin/params", "/zklogin/prove", "/readiness/cx", "/outbox/flush", "/integration/access", "/preview/access", path("redeem"), path("opendid/complete"), path("identity/callback"), path("agent/run/extra"), "/operations/op_short", "/config/extra", "/config?debug=1", "/config#x", "/config/", "//config", "/%63onfig", "/operations/../config", "/operations/op_abcdefgh%2fagent/run", "https://ktour-id.vercel.app/api/hackathon/v1/config"]) {
    assert.equal(subject.hostedSuiRouteAllowed("GET", value), false, value)
    assert.equal(subject.hostedSuiRouteAllowed("POST", value), false, value)
  }
})

test("mock identity requires explicit bounded sample, provider identity rejects every sample", () => {
  const sample = { sample: { outcome: "verified", subjectSeed: `sample-${op}` } }
  subject.assertHostedSuiBody(path("identity/complete"), sample, fixture("mock"))
  subject.assertHostedSuiBody(path("identity/complete"), {}, fixture("cx"))
  for (const value of [{}, { sample: null }, { sample: {} }, { sample: { outcome: "unknown", subjectSeed: "a" } }, { sample: { outcome: "verified", subjectSeed: "" } }, { sample: { outcome: "verified", subjectSeed: "a", claims: true } }]) assert.throws(() => subject.assertHostedSuiBody(path("identity/complete"), value, fixture("mock")), mismatch)
  for (const mode of ["cx", "fallback", undefined]) assert.throws(() => subject.assertHostedSuiBody(path("identity/complete"), sample, { ...fixture(), HK_MODE_CX: mode }), mismatch)
})

test("delegation requires demo and canonical ED25519 wallet proof plus exact operation prefix", () => {
  const body = { userAddress: hash, signer: "demo", walletProof: { message: `ondo-hk-wallet-proof:${op}:decision_abcd1234`, signature: signature() }, approvedProposalDigest: hash }
  subject.assertHostedSuiBody(path("delegation/prepare"), body, fixture())
  for (const value of [{ ...body, signer: "zklogin" }, { ...body, signer: undefined }, { ...body, userAddress: "0x1" }, { ...body, approvedProposalDigest: "wrong" }, { ...body, sponsorSignature: signature() }, { ...body, walletProof: { ...body.walletProof, message: "ondo-hk-wallet-proof:op_another:decision" } }, { ...body, walletProof: { ...body.walletProof, signature: signature(5) } }, { ...body, walletProof: { ...body.walletProof, secret: "fixture-secret" } }]) assert.throws(() => subject.assertHostedSuiBody(path("delegation/prepare"), value, fixture()), mismatch)
})

test("delegation submit rejects non-ED25519, missing, malformed or noncanonical signatures", () => {
  subject.assertHostedSuiBody(path("delegation/submit"), { txBytesDigest: hash, userSignature: signature() }, fixture())
  for (const sig of [undefined, "", signature(1), signature(2), signature(3), signature(5), signature(6), signature().replace(/=+$/, ""), signature() + "\n", Buffer.alloc(96).toString("base64")]) assert.throws(() => subject.assertHostedSuiBody(path("delegation/submit"), { txBytesDigest: hash, userSignature: sig }, fixture()), mismatch)
})

test("sample credential, presentation, access and operation payloads preserve current BFF shapes", () => {
  subject.assertHostedSuiBody("/sessions", {}, fixture())
  subject.assertHostedSuiBody("/operations", { venueId: subject.PIN.venueId, consentVersion: subject.PIN.consentVersion, locale: "en" }, fixture())
  subject.assertHostedSuiBody("/hosted/access", { accessCode: "a".repeat(48) }, fixture())
  subject.assertHostedSuiBody(path("identity/start"), { mobile: true }, fixture())
  const pem = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\n-----END PUBLIC KEY-----\n"
  for (const alg of ["Ed25519", "ECDSA-P256"]) subject.assertHostedSuiBody(path("credential/issue"), { publicKeyPem: pem, alg }, fixture())
  const signatureB64 = Buffer.alloc(64, 7).toString("base64url")
  subject.assertHostedSuiBody(path("credential/holder-ack"), { signatureB64 }, fixture())
  subject.assertHostedSuiBody(path("presentation/submit"), { presentationId: "pres_abcdefgh12345678", signatureB64, disclosed: { schemaVersion: "KPassHackathonCredential/v1", personVerified: true, serviceAccess: ["redeem_demo_entitlement"], validUntil: "2026-09-29T00:00:00Z", policyVersion: 1, statusRef: "status_abcdefgh" } }, fixture())
  for (const action of ["presentation/request", "presentation/deny", "agent/run", "cancel", "reconcile", "sui/agent-address"]) subject.assertHostedSuiBody(path(action), {}, fixture())
})

test("unknown nested fields, array/null bodies, getters and excluded paths are fixed scope errors", () => {
  for (const value of [null, [], "fixture-secret", { admin: true }, JSON.parse('{"__proto__":{"admin":true}}'), Object.defineProperty({}, "secret", { get() { throw new Error("fixture-secret") } })]) assert.throws(() => subject.assertHostedSuiBody("/sessions", value, fixture()), mismatch)
  for (const [p, body] of [[path("redeem"), {}], [path("agent/run"), { approved: true }], [path("identity/start"), {}], ["/operations", { venueId: "other", consentVersion: subject.PIN.consentVersion }], ["/hosted/access", { accessCode: "short" }], [path("credential/issue"), { alg: "Ed25519", publicKeyPem: "-----BEGIN PRIVATE KEY-----" }], [path("presentation/submit"), { presentationId: "pres_abcdefgh12345678", signatureB64: Buffer.alloc(64).toString("base64"), disclosed: { name: "fixture-secret" } }]] as const) assert.throws(() => subject.assertHostedSuiBody(p, body, fixture()), mismatch)
})

test("actual browser holderSign WebCrypto output passes ack/presentation schemas for both holder algorithms", async () => {
  const { holderSign } = await import("../../features/ondo/hackathon-b/hackathon-client")
  for (const alg of ["Ed25519", "ECDSA-P256"] as const) {
    const keyAlgorithm: EcKeyGenParams | Algorithm = alg === "Ed25519" ? { name: "Ed25519" } : { name: "ECDSA", namedCurve: "P-256" }
    const pair = await crypto.subtle.generateKey(keyAlgorithm, true, ["sign", "verify"]) as CryptoKeyPair
    const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey)
    const signatureB64 = await holderSign({ alg, jwk, publicKeyPem: "unused-public-fixture" }, "public-fixture-payload")
    assert.equal(signatureB64.length, 86)
    subject.assertHostedSuiBody(path("credential/holder-ack"), { signatureB64 }, fixture())
    subject.assertHostedSuiBody(path("presentation/submit"), { presentationId: "pres_abcdefgh12345678", disclosed: {}, signatureB64 }, fixture())
  }
  for (const signatureB64 of [Buffer.alloc(64).toString("base64"), Buffer.alloc(63).toString("base64url"), Buffer.alloc(65).toString("base64url"), "!".repeat(86), signature()]) {
    assert.throws(() => subject.assertHostedSuiBody(path("credential/holder-ack"), { signatureB64 }, fixture()), mismatch)
  }
})

test("actual external-service boundary permits exact Sui grant reads and rejects every other provider", async () => {
  const { assertExternalServicesEnabled } = await import("../../lib/hackathon/config")
  const saved = { ...process.env }, originalNow = Date.now
  try {
    for (const key of Object.keys(process.env)) if (/^(HK_|NEXT_PUBLIC_HK_|NEXT_PUBLIC_GOOGLE_|GOOGLE_|GEMINI_|VERCEL|UPSTASH_|KV_)/.test(key)) delete process.env[key]
    Object.assign(process.env, fixture()); Date.now = () => NOW
    for (const name of ["Sui", "Sui signing", "Sui delegation", "Sui agent execution", "Sui grant lookup"]) assert.doesNotThrow(() => assertExternalServicesEnabled(name))
    for (const name of ["Sui grant lookup extra", "OmniOne", "Gemini", "Google", "OpenDID", "Sui unrestricted", "fixture-secret"]) {
      assert.throws(() => assertExternalServicesEnabled(name), (e: unknown) => e instanceof HkError && e.code === "hosted_sui_scope" && e.status === 503 && !e.message.includes("fixture-secret"))
    }
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
    Object.assign(process.env, saved); Date.now = originalNow
  }
})
