import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { INTEGRATION_SUI_TARGETS, integrationSuiRolesMatch, resolveIntegrationSuiTarget } from "../../lib/hackathon/integration-sui-targets"
import { PIN } from "../../lib/hackathon/hosted-sui-profile"

const original = JSON.parse(readFileSync(new URL("../../../move/ondo_entitlement/deploy-info.testnet.json", import.meta.url), "utf8"))
const roles = (id: "harvey-original" | "selfhosted-testnet") => {
  const p = resolveIntegrationSuiTarget(id)
  return { issuer: p.issuerAddress, agent: p.agentAddress, sponsor: p.sponsorAddress }
}

test("only the two explicit reviewed selections resolve; env-like data never chooses a target", () => {
  assert.deepEqual(Object.keys(INTEGRATION_SUI_TARGETS), ["harvey-original", "selfhosted-testnet"])
  for (const input of [undefined, null, "", "testnet", "mainnet", "selfhosted-testnet ", "SELFHOSTED-TESTNET", "__proto__", {}, { id: "selfhosted-testnet" }]) {
    assert.throws(() => resolveIntegrationSuiTarget(input), /^Error: integration_sui_target_invalid$/)
  }
})

test("Harvey pins match the preserved deployment metadata, including issuer-as-sponsor", () => {
  const p = resolveIntegrationSuiTarget("harvey-original")
  assert.equal(p.network, original.network); assert.equal(p.chainIdentifier, original.chainIdentifier)
  assert.equal(p.packageId, original.packageId); assert.equal(p.campaignId, original.campaign.objectId)
  assert.equal(p.campaignInitialVersion, String(original.campaign.initialSharedVersion))
  assert.equal(p.issuerAddress, original.issuer); assert.equal(p.agentAddress, original.agent)
  assert.equal(p.sponsorAddress, original.issuer)
})

test("owned pins match the live-tested hosted-Sui lane without changing either environment", () => {
  const p = resolveIntegrationSuiTarget("selfhosted-testnet")
  assert.equal(p.network, PIN.network); assert.equal(p.chainIdentifier, PIN.chainIdentifier)
  assert.equal(p.packageId, PIN.packageId); assert.equal(p.campaignId, PIN.campaignId)
  assert.equal(p.campaignInitialVersion, PIN.campaignInitialVersion)
  assert.equal(p.issuerAddress, PIN.issuer); assert.equal(p.agentAddress, PIN.agent); assert.equal(p.sponsorAddress, PIN.sponsor)
  assert.deepEqual(p.rpcUrls, ["https://fullnode.testnet.sui.io", "https://fullnode.testnet.sui.io:443"])
  assert.ok(Object.isFrozen(INTEGRATION_SUI_TARGETS) && Object.isFrozen(p) && Object.isFrozen(p.rpcUrls))
})

test("roles are exact full-length public addresses, never arbitrary sponsors or cross-target mixtures", () => {
  for (const id of ["harvey-original", "selfhosted-testnet"] as const) {
    const target = resolveIntegrationSuiTarget(id), correct = roles(id)
    assert.equal(integrationSuiRolesMatch(target, correct), true)
    assert.equal(integrationSuiRolesMatch(target, { ...correct, issuer: correct.issuer.toUpperCase() }), true)
    assert.equal(integrationSuiRolesMatch(target, roles(id === "harvey-original" ? "selfhosted-testnet" : "harvey-original")), false)
    for (const role of ["issuer", "agent", "sponsor"] as const) {
      for (const bad of ["0x1", "0x" + "0".repeat(64), correct[role] + " ", "SECRET_SENTINEL"]) {
        assert.equal(integrationSuiRolesMatch(target, { ...correct, [role]: bad }), false)
      }
    }
    assert.equal(integrationSuiRolesMatch({ ...target, issuerAddress: "0x" + "1".repeat(64) } as never, correct), false)
  }
})

test("unknown keys and accessor-bearing public role objects are rejected without executing getters", () => {
  const target = resolveIntegrationSuiTarget("selfhosted-testnet"), correct = roles("selfhosted-testnet")
  let reads = 0
  const getter = { ...correct, get issuer() { reads++; throw new Error("private-error") } }
  for (const input of [getter, null, [], { ...correct, extra: "secret" }, { issuer: correct.issuer, agent: correct.agent }]) {
    assert.equal(integrationSuiRolesMatch(target, input as never), false)
  }
  assert.equal(reads, 0)
})
