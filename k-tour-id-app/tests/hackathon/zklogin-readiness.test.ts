import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { assessZkLoginReadiness } from "../../lib/hackathon/zklogin-readiness"
import { runIntegrationReadiness } from "../../lib/hackathon/integration-readiness"

const secret = "private-fixture-not-a-real-key"
const base = { HK_SUI_NETWORK: "testnet", NEXT_PUBLIC_GOOGLE_CLIENT_ID: "fixture.apps.googleusercontent.com", HK_ZKLOGIN_SALT_SEED: secret }
const codes = (env = {}) => assessZkLoginReadiness({ ...base, ...env }).issues.map(item => item.code)
const previousFetch = globalThis.fetch
let requests = 0
before(() => { globalThis.fetch = async () => { requests++; throw new Error("unexpected_network") } })
after(() => { globalThis.fetch = previousFetch; assert.equal(requests, 0) })

test("client and seed alone cannot make the inherited prover Testnet-ready", () => {
  const report = assessZkLoginReadiness(base)
  assert.equal(report.configuredInputsPresent, true)
  assert.equal(report.provider, "implicit-prover")
  assert.equal(report.liveExecutionReady, false)
  assert.ok(codes().includes("zklogin_default_prover_network_unverified"))
  assert.equal(report.providerVerified, false)
  assert.deepEqual(report.safety, { networkCalls: 0, signatures: 0, broadcasts: 0, secretValuesOutput: false })
})

test("both dev and production-looking explicit endpoints require actual network-key and access verification", () => {
  for (const url of ["https://prover-dev.mystenlabs.com/v1", "https://prover.mystenlabs.com/v1", "https://reviewed-prover.invalid/v1"]) {
    const report = assessZkLoginReadiness({ ...base, HK_ZKLOGIN_PROVER_URL: url })
    assert.equal(report.provider, "explicit-prover")
    assert.ok(report.issues.some(item => item.code === "zklogin_prover_network_unverified"))
    assert.ok(report.issues.some(item => item.code === "zklogin_prover_access_unverified"))
    assert.equal(report.liveExecutionReady, false)
  }
})

test("Enoki precedence is preserved but key presence is not app/client registration proof", () => {
  const report = assessZkLoginReadiness({ ...base, ENOKI_API_KEY: secret, HK_ZKLOGIN_PROVER_URL: "http://unused.invalid" })
  assert.equal(report.provider, "enoki")
  assert.ok(report.issues.some(item => item.code === "zklogin_enoki_app_configuration_unverified"))
  assert.equal(report.issues.some(item => item.code === "zklogin_prover_url_invalid"), false)
  assert.equal(report.liveExecutionReady, false)
  assert.equal(JSON.stringify(report).includes(secret), false)
})

test("unsafe URLs and unreviewed Enoki overrides expose fixed codes, never input values", () => {
  for (const url of ["http://provider.invalid/v1", "https://user:private@provider.invalid/v1", "https://provider.invalid/v1?key=" + secret, "https://provider.invalid/v1#" + secret, "https://provider.invalid:123/v1"]) {
    for (const managed of [true, false]) {
      const report = assessZkLoginReadiness({ ...base, ...(managed ? { ENOKI_API_KEY: secret, ENOKI_API_URL: url } : { HK_ZKLOGIN_PROVER_URL: url }) })
      assert.ok(report.issues.some(item => item.code === (managed ? "zklogin_enoki_url_invalid" : "zklogin_prover_url_invalid")))
      assert.equal(JSON.stringify(report).includes(url), false)
      assert.equal(JSON.stringify(report).includes(secret), false)
    }
  }
  assert.ok(codes({ ENOKI_API_KEY: secret, ENOKI_API_URL: "https://custom.invalid/v1" }).includes("zklogin_custom_enoki_requires_review"))
})

test("every hosted profile selector refuses zkLogin readiness even with complete inputs", () => {
  for (const flag of [{ NEXT_PUBLIC_HK_HOSTED_SUI: "1" }, { HK_HOSTED_SUI_ENABLED: "1" }, { VERCEL_GIT_COMMIT_REF: "deploy/sui-main-20260928" }]) {
    assert.ok(codes({ ...flag, ENOKI_API_KEY: secret }).includes("hosted_sui_profile_forbids_zklogin"))
  }
  assert.ok(codes({ HK_SUI_NETWORK: "mainnet" }).includes("zklogin_network_requires_review"))
})

test("empty input ignores ambient provider credentials and keeps human approval separate", () => {
  const report = assessZkLoginReadiness()
  assert.equal(report.configuredInputsPresent, false)
  assert.deepEqual(report.issues.filter(item => item.code === "zklogin_input_missing").map(item => item.name), ["NEXT_PUBLIC_GOOGLE_CLIENT_ID", "HK_ZKLOGIN_SALT_SEED"])
  assert.equal(report.humanApproval, "google_login_and_wallet_approval_required")
  assert.ok(report.issues.some(item => item.code === "oauth_callback_registration_unverified"))
})

test("hostile input and getters cannot execute or escape through diagnostics", () => {
  let touched = 0
  for (const input of [null, [], { SECRET: secret }, { get ENOKI_API_KEY() { touched++; throw new Error(secret) } }, { ENOKI_API_KEY: 7 }, { ENOKI_API_KEY: secret + "\n" }, { ENOKI_API_KEY: "x".repeat(8193) }]) {
    assert.throws(() => assessZkLoginReadiness(input as never), /^Error: zklogin_readiness_input_invalid$/)
  }
  assert.equal(touched, 0)
})

test("integration preflight cannot silently accept a prover URL or demand Enoki exclusively", () => {
  for (const env of [base, { ...base, HK_ZKLOGIN_PROVER_URL: "https://prover-dev.mystenlabs.com/v1" }]) {
    const report = runIntegrationReadiness({ env, zkLoginRequested: true, aiRequested: false })
    assert.equal(report.ok, false)
    assert.ok(report.issues.internalConfigWork.some(item => /zklogin_(default_)?prover_network_unverified/.test(item.code)))
    assert.equal(report.issues.ownerInputs.some(item => item.name === "ENOKI_API_KEY"), false)
    assert.equal(JSON.stringify(report).includes(secret), false)
  }
})
