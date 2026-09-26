import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { readFile } from "node:fs/promises"
import { Transaction } from "@mysten/sui/transactions"

const originalFetch = globalThis.fetch
let networkAttempts = 0
let subject: typeof import("../../scripts/hackathon-sui-readiness")
let manifest: unknown
before(async () => {
  globalThis.fetch = async () => { networkAttempts += 1; throw new Error("fixture_network_forbidden") }
  subject = await import("../../scripts/hackathon-sui-readiness")
  manifest = JSON.parse(await readFile(new URL("../../../move/ondo_entitlement/deploy-info.testnet.json", import.meta.url), "utf8"))
})
after(() => { globalThis.fetch = originalFetch; assert.equal(networkAttempts, 0) })

test("offline readiness reuses actual evidence guards but never declares live readiness", async () => {
  const before = structuredClone(manifest)
  const result = await subject.runOfflineReadiness(manifest)
  assert.equal(result.ok, true)
  assert.equal(result.mode, "offline-synthetic-rehearsal")
  assert.equal(result.liveExecutionReady, false)
  assert.equal(result.walletProofVerified, false)
  assert.equal(result.signerPlan, "demo")
  assert.equal(result.evidence.acceptedFixtures, 2)
  assert.equal(result.evidence.rejectedCases.length, 6)
  assert.equal(result.evidence.actualChainEvidence, false)
  assert.deepEqual(result.safety, { rpcCalls: 0, secretReads: 0, generatedKeys: 0, signatures: 0, broadcasts: 0, faucetCalls: 0, ledgerWrites: 0, syntheticGas: true, expirationEpoch: 0 })
  assert.deepEqual(manifest, before)
})

test("all three unsigned command sequences serialize with explicit synthetic gas and expired epoch", async () => {
  const metadata = subject.publicMetadata(manifest)
  const rows = await subject.unsignedRehearsal(manifest)
  const argumentCounts = { issue: [5], delegation: [6, 3], execution: [4, 3] }
  assert.deepEqual(rows.map(row => row.commands), [["issue"], ["delegate", "attest_consent"], ["consume", "attest_execution"]])
  for (const row of rows) {
    const tx = Transaction.from(row.bytes)
    assert.equal(tx.isFullyResolved(), true)
    const data = tx.getData()
    assert.equal(String(data.expiration?.Epoch), "0")
    assert.equal(data.gasData.owner, metadata.issuer)
    assert.equal(data.gasData.payment?.[0].objectId, "0x" + "55".repeat(32))
    assert.equal(data.commands.length, row.commands.length)
    assert.deepEqual(data.commands.map(command => command.MoveCall?.function), row.commands)
    assert.deepEqual(data.commands.map(command => command.MoveCall?.arguments.length), argumentCounts[row.step])
    assert.ok(data.commands.every(command => command.MoveCall?.package === metadata.packageId && command.MoveCall.module === "entitlement"))
    const shared = data.inputs.flatMap(input => input.Object?.SharedObject ? [input.Object.SharedObject] : [])
    assert.deepEqual(shared.map(input => ({ objectId: input.objectId, initialSharedVersion: input.initialSharedVersion, mutable: input.mutable })), [
      { objectId: metadata.campaign.objectId, initialSharedVersion: String(metadata.campaign.initialSharedVersion), mutable: true },
      ...(row.step === "execution" ? [{ objectId: "0x" + "33".repeat(32), initialSharedVersion: "1", mutable: true }] : []),
      { objectId: "0x" + "0".repeat(63) + "6", initialSharedVersion: "1", mutable: false },
    ])
    assert.deepEqual(data.commands[0].MoveCall?.arguments[0], { Input: 0, $kind: "Input" })
    if (row.step !== "issue") {
      assert.deepEqual(data.commands[1].MoveCall?.arguments.slice(0, 2), [{ Input: 0, $kind: "Input" }, { Result: 0, $kind: "Result" }], "attestation must bind the first command's returned object")
    }
    if (row.step === "delegation") {
      assert.equal(data.inputs[1].Object?.ImmOrOwnedObject?.objectId, "0x" + "22".repeat(32))
    }
  }
})

test("rehearsal is deterministic and zkLogin remains an unverified separate plan", async () => {
  const first = await subject.runOfflineReadiness(manifest, "demo")
  assert.deepEqual(await subject.runOfflineReadiness(manifest, "demo"), first)
  const zk = await subject.runOfflineReadiness(manifest, "zklogin")
  assert.equal(zk.liveExecutionReady, false)
  assert.equal(zk.walletProofVerified, false)
  assert.ok(zk.unverifiedGates.includes("authorized-Google-login"))
  assert.ok(zk.requiredEnvironmentNames.zkLogin.includes("NEXT_PUBLIC_GOOGLE_CLIENT_ID"))
  assert.deepEqual(zk.steps, first.steps, "the plan does not pretend to create a zkLogin signature")
})

test("public manifest projection never emits unknown fields or environment-like secrets", async () => {
  const input = { ...subject.publicMetadata(manifest), HK_SUI_ISSUER_SECRET_KEY: "fixture-secret-do-not-copy", unrelated: { token: "fixture-secret-do-not-copy" } }
  const output = JSON.stringify(await subject.runOfflineReadiness(input))
  assert.equal(output.includes("fixture-secret-do-not-copy"), false)
  assert.equal(output.includes("unrelated"), false)
})

test("malformed/non-testnet metadata fails closed without echoing supplied values", async () => {
  const valid = subject.publicMetadata(manifest)
  const cases = [null, [], {}, { ...valid, network: "mainnet" }, { ...valid, packageId: "fixture-secret-invalid" },
    { ...valid, agent: "0x0" }, { ...valid, issuer: "0x" + "0".repeat(64) },
    { ...valid, campaign: { ...valid.campaign, initialSharedVersion: 0 } },
    { ...valid, campaign: { ...valid.campaign, initialSharedVersion: Number.MAX_SAFE_INTEGER + 1 } },
    { ...valid, campaign: { ...valid.campaign, policyVersion: -1 } },
    { ...valid, campaign: { ...valid.campaign, campaignRef: "https://fixture-secret.invalid" } }]
  for (const value of cases) await assert.rejects(subject.runOfflineReadiness(value), { message: "sui_readiness_invalid_input" })
})

test("CLI only accepts explicit offline modes; paths, URLs, write flags and duplicates are rejected", () => {
  assert.equal(subject.parseReadinessArgs(["--offline"]), "demo")
  assert.equal(subject.parseReadinessArgs(["--offline", "--signer=demo"]), "demo")
  assert.equal(subject.parseReadinessArgs(["--offline", "--signer=zklogin"]), "zklogin")
  for (const args of [[], ["--execute"], ["--offline", "--broadcast"], ["--offline", "--offline"], ["--offline", "--signer=other"], ["--offline", "https://example.invalid"], ["--offline", ".env"]]) {
    assert.throws(() => subject.parseReadinessArgs(args), { message: "sui_readiness_invalid_input" })
  }
})
