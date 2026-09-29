import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import { runIntegrationReadiness, type ExplicitEnv } from "../../lib/hackathon/integration-readiness"
import { resolveIntegrationSuiTarget, type IntegrationSuiTargetId } from "../../lib/hackathon/integration-sui-targets"

const PRIVATE = "test-secret-only-not-a-real-key-never-echo"
const targetEnv = (id: IntegrationSuiTargetId): ExplicitEnv => {
  const target = resolveIntegrationSuiTarget(id)
  return {
    HK_API_ENABLED: "1", NEXT_PUBLIC_HK_ENABLED: "1", HK_MODE_CX: "cx",
    HK_ISSUER_SIGNING_SEED: PRIVATE, HK_STORE_KEY: "ktour:integration-preview:fixture",
    KV_REST_API_URL: "https://fixture.upstash.io", KV_REST_API_TOKEN: PRIVATE,
    HK_INTEGRATION_SUI_TARGET: id, HK_SUI_NETWORK: target.network,
    HK_SUI_CHAIN_IDENTIFIER: target.chainIdentifier, HK_SUI_GRPC_URL: target.rpcUrls[0],
    HK_SUI_PACKAGE_ID: target.packageId, HK_SUI_CAMPAIGN_ID: target.campaignId,
    HK_SUI_CAMPAIGN_INITIAL_VERSION: target.campaignInitialVersion,
    HK_SUI_ISSUER_SECRET_KEY: PRIVATE, HK_SUI_AGENT_SECRET_KEY: PRIVATE,
    HK_OMNIONE_REGISTRY_ADDRESS: "0x696bc4e29c8f8079b6d3cd49d310a09577550e4c",
    HK_OMNIONE_PRIVATE_KEY: PRIVATE, HK_OMNIONE_RPC_URL: "https://stage-chainapi.omnione.net/?token=" + PRIVATE,
  }
}
const publicRoles = (id: IntegrationSuiTargetId): { issuer: string; agent: string; sponsor: string } => {
  const target = resolveIntegrationSuiTarget(id)
  return { issuer: target.issuerAddress, agent: target.agentAddress, sponsor: target.sponsorAddress }
}
const report = (env = targetEnv("selfhosted-testnet"), suiRoles = publicRoles("selfhosted-testnet")) =>
  runIntegrationReadiness({ env, suiRoles, aiRequested: false, zkLoginRequested: false })
const codes = (r: ReturnType<typeof report>) => r.issues.internalConfigWork.map(issue => issue.code)

test("each explicitly selected approved tuple is inspectable, never a signer or execution authorization", () => {
  for (const id of ["selfhosted-testnet", "harvey-original"] as const) {
    const r = report(targetEnv(id), publicRoles(id))
    assert.equal(r.ok, true)
    assert.equal(r.suiTarget?.id, id)
    assert.equal(r.suiRolesCompared, true)
    assert.equal(r.suiSignerOwnershipVerified, false)
    assert.equal(r.providerVerified, false)
    assert.equal(r.liveExecutionReady, false)
    assert.equal(r.opendidProviderReady, false)
    assert.equal(JSON.stringify(r).includes(PRIVATE), false)
    assert.deepEqual(r.safety, { networkCalls: 0, signatures: 0, broadcasts: 0, envMutations: 0, secretValuesOutput: false })
  }
})

test("complete known tuples do not infer a missing or unknown selector", () => {
  for (const selector of [undefined, "", "selfhosted-testnet ", "arbitrary-target-" + PRIVATE]) {
    const r = report({ ...targetEnv("selfhosted-testnet"), HK_INTEGRATION_SUI_TARGET: selector })
    assert.equal(r.ok, false)
    assert.equal(r.suiTarget, null)
    assert.equal(r.suiRolesCompared, false)
    assert.ok(codes(r).includes(selector ? "sui_target_selection_invalid" : "sui_target_selection_required"))
    assert.equal(JSON.stringify(r).includes(PRIVATE), false)
  }
})

test("cross-target and partly mixed package/campaign/version tuples fail closed", () => {
  for (const id of ["selfhosted-testnet", "harvey-original"] as const) {
    const other = targetEnv(id === "selfhosted-testnet" ? "harvey-original" : "selfhosted-testnet")
    for (const name of ["HK_SUI_PACKAGE_ID", "HK_SUI_CAMPAIGN_ID", "HK_SUI_CAMPAIGN_INITIAL_VERSION"] as const) {
      const r = report({ ...targetEnv(id), [name]: other[name] }, publicRoles(id))
      assert.equal(r.ok, false)
      assert.ok(r.issues.internalConfigWork.some(issue => issue.code === "deployed_target_mismatch" && issue.name === name))
    }
    assert.equal(report({ ...other, HK_INTEGRATION_SUI_TARGET: id }, publicRoles(id)).ok, false)
  }
})

test("network, genesis identifier and RPC are required exact public target values", () => {
  for (const [name, bad] of [
    ["HK_SUI_NETWORK", "mainnet"], ["HK_SUI_CHAIN_IDENTIFIER", "foreign-genesis"],
    ["HK_SUI_GRPC_URL", "https://fullnode.testnet.sui.io.evil.invalid"],
    ["HK_SUI_GRPC_URL", "https://fullnode.testnet.sui.io/?token=" + PRIVATE],
  ] as const) {
    const r = report({ ...targetEnv("selfhosted-testnet"), [name]: bad })
    assert.equal(r.ok, false)
    assert.ok(codes(r).includes("sui_target_requires_review"))
    assert.equal(JSON.stringify(r).includes(PRIVATE), false)
  }
  for (const name of ["HK_SUI_NETWORK", "HK_SUI_CHAIN_IDENTIFIER", "HK_SUI_GRPC_URL"] as const) {
    const r = report({ ...targetEnv("selfhosted-testnet"), [name]: "" })
    assert.ok(r.issues.internalConfigWork.some(issue => issue.code === "known_public_value_not_configured" && issue.name === name))
    assert.equal(r.issues.ownerInputs.some(issue => issue.name === name), false)
  }
})

test("secret presence cannot substitute for checked role addresses or bless foreign roles", () => {
  const env = targetEnv("selfhosted-testnet")
  const unchecked = runIntegrationReadiness({ env, aiRequested: false, zkLoginRequested: false })
  assert.equal(unchecked.ok, false)
  assert.ok(codes(unchecked).includes("sui_public_roles_not_checked"))
  const pinned = publicRoles("selfhosted-testnet")
  for (const roles of [publicRoles("harvey-original"), { ...pinned, issuer: pinned.agent }, { ...pinned, sponsor: pinned.agent }, { ...pinned, agent: PRIVATE }]) {
    const r = report(env, roles)
    assert.equal(r.ok, false)
    assert.equal(r.suiRolesCompared, false)
    assert.ok(codes(r).includes("sui_public_roles_mismatch"))
    assert.equal(JSON.stringify(r).includes(PRIVATE), false)
  }
})

test("known available own keys remain our config work, never inferred from the target label", () => {
  const env = { ...targetEnv("selfhosted-testnet"), HK_SUI_ISSUER_SECRET_KEY: "", HK_SUI_AGENT_SECRET_KEY: "" }
  const opts = { env, suiRoles: publicRoles("selfhosted-testnet"), aiRequested: false, zkLoginRequested: false }
  const noAssertion = runIntegrationReadiness(opts)
  const available = runIntegrationReadiness({ ...opts, availableInputs: { HK_SUI_ISSUER_SECRET_KEY: true, HK_SUI_AGENT_SECRET_KEY: true } })
  for (const name of ["HK_SUI_ISSUER_SECRET_KEY", "HK_SUI_AGENT_SECRET_KEY"]) {
    assert.ok(noAssertion.issues.ownerInputs.some(issue => issue.name === name))
    assert.equal(available.issues.ownerInputs.some(issue => issue.name === name), false)
    assert.ok(available.issues.internalConfigWork.some(issue => issue.code === "available_input_not_configured" && issue.name === name))
  }
  assert.equal(available.suiSignerOwnershipVerified, false)
  assert.equal(available.ok, false)
})

test("public role input rejects accessors, hidden extras, symbols and hostile shapes without evaluating getters", () => {
  let reads = 0
  const pinned = publicRoles("selfhosted-testnet")
  const getter = { ...pinned, get issuer() { reads++; throw new Error(PRIVATE) } }
  const hidden = Object.defineProperty({ ...pinned }, "extra", { value: PRIVATE })
  for (const roles of [getter, hidden, { ...pinned, [Symbol("extra")]: PRIVATE }, { issuer: pinned.issuer },
    { ...pinned, agent: PRIVATE + "\n" }, [], null, new Map(), { ...pinned, issuer: "x".repeat(129) }]) {
    assert.throws(() => runIntegrationReadiness({ suiRoles: roles as never }), /^Error: readiness_input_invalid$/)
  }
  assert.equal(reads, 0)
})

test("role comparison uses the validated snapshot, never a second read of hostile input", () => {
  let descriptorReads = 0
  const roles = new Proxy(publicRoles("selfhosted-testnet"), {
    getOwnPropertyDescriptor(target, name) {
      if (++descriptorReads > 3) throw new Error(PRIVATE)
      return Object.getOwnPropertyDescriptor(target, name)
    },
  })
  assert.equal(report(targetEnv("selfhosted-testnet"), roles).suiRolesCompared, true)
  assert.equal(descriptorReads, 3)
})

const cli = (input: unknown) => spawnSync("node", ["--import", "tsx", "scripts/hackathon-integration-readiness.ts", "--offline", "--stdin"], {
  input: JSON.stringify(input), encoding: "utf8", maxBuffer: 128 * 1024, timeout: 15_000,
})
test("stdin CLI selects own public pins but never reflects supplied secrets or role strings", () => {
  const good = cli({ env: targetEnv("selfhosted-testnet"), suiRoles: publicRoles("selfhosted-testnet"), aiRequested: false, zkLoginRequested: false })
  assert.equal(good.status, 0)
  assert.equal(JSON.parse(good.stdout).suiTarget.id, "selfhosted-testnet")
  assert.equal((good.stdout + good.stderr).includes(PRIVATE), false)
  const bad = cli({ suiRoles: { ...publicRoles("selfhosted-testnet"), extra: PRIVATE } })
  assert.equal(bad.status, 1)
  assert.deepEqual(JSON.parse(bad.stdout), { ok: false, error: "stdin_input_invalid" })
  assert.equal((bad.stdout + bad.stderr).includes(PRIVATE), false)
})
