import assert from "node:assert/strict"
import { test } from "node:test"
import { OMNIONE_STAGE, OmnioneEvidenceError, omnioneReadAbi } from "../../lib/hackathon/omnione-evidence"
import { checkedOmnioneSigningTarget, verifyOmnioneSigningAuthority, type OmnioneSigningTarget } from "../../lib/hackathon/omnione-signing-preflight"
import { omnioneRpcReader, type OmnioneRpcReader } from "../../lib/hackathon/omnione-readonly"

const target: OmnioneSigningTarget = { rpcUrl: `${OMNIONE_STAGE.rpcOrigin}/?token=fixture-only`, chainId: OMNIONE_STAGE.chainId, registryAddress: OMNIONE_STAGE.registry }
const denied = (code: string) => (error: unknown) => error instanceof OmnioneEvidenceError && error.code === code
function fixture(overrides: { chain?: unknown; code?: unknown; permission?: unknown } = {}) {
  const calls: { method: string; params: unknown[] }[] = []
  const rpc: OmnioneRpcReader = { async call(method, params) {
    calls.push({ method, params })
    if (method === "eth_chainId") return Object.hasOwn(overrides, "chain") ? overrides.chain : "0x311fa"
    if (method === "eth_getCode") return Object.hasOwn(overrides, "code") ? overrides.code : "0x6000"
    if (method === "eth_call") return Object.hasOwn(overrides, "permission") ? overrides.permission : omnioneReadAbi.encodeFunctionResult("recorders", [true])
    assert.fail("Only three read-only methods are allowed")
  } }
  return { calls, rpc }
}

test("approved signer verifies live chain, code and exact registry permission without signing", async () => {
  const f = fixture()
  assert.equal(checkedOmnioneSigningTarget(target).recorderAddress, OMNIONE_STAGE.recorder)
  await verifyOmnioneSigningAuthority(target, OMNIONE_STAGE.recorder.toUpperCase().replace("0X", "0x"), f.rpc)
  assert.deepEqual(f.calls, [
    { method: "eth_chainId", params: [] },
    { method: "eth_getCode", params: [OMNIONE_STAGE.registry, "latest"] },
    { method: "eth_call", params: [{ to: OMNIONE_STAGE.registry, data: omnioneReadAbi.encodeFunctionData("recorders", [OMNIONE_STAGE.recorder]) }, "latest"] },
  ])
})

test("wrong origin, token, chain, Anchor address or explicit recorder fail before any I/O", async () => {
  const cases: Array<[Partial<OmnioneSigningTarget>, string]> = [
    [{ rpcUrl: "https://example.invalid/?token=fixture-only" }, "rpc_configuration_invalid"],
    [{ rpcUrl: `${OMNIONE_STAGE.rpcOrigin}/?token=API_KEY` }, "rpc_configuration_invalid"],
    [{ rpcUrl: `${target.rpcUrl}&token=duplicate` }, "rpc_configuration_invalid"],
    [{ rpcUrl: `${target.rpcUrl}\n` }, "rpc_configuration_invalid"],
    [{ rpcUrl: `${OMNIONE_STAGE.rpcOrigin}/?token=has%0Acontrol` }, "rpc_configuration_invalid"],
    [{ chainId: 1 }, "chain_configuration_mismatch"],
    [{ registryAddress: "0x9112d8a1a251c6a07eb7bde307fef3b3b4aa5a97" }, "registry_configuration_mismatch"],
    [{ recorderAddress: "0x" + "f".repeat(40) }, "recorder_configuration_mismatch"],
  ]
  for (const [change, code] of cases) {
    const f = fixture()
    await assert.rejects(verifyOmnioneSigningAuthority({ ...target, ...change }, OMNIONE_STAGE.recorder, f.rpc), denied(code))
    assert.equal(f.calls.length, 0)
  }
})

test("a valid but different private key's address cannot reach RPC", async () => {
  const f = fixture()
  await assert.rejects(verifyOmnioneSigningAuthority(target, "0x" + "f".repeat(40), f.rpc), denied("signer_address_mismatch"))
  assert.equal(f.calls.length, 0)
})

test("static SDK network metadata cannot hide a wrong live chain", async () => {
  const f = fixture({ chain: "0x1" })
  await assert.rejects(verifyOmnioneSigningAuthority(target, OMNIONE_STAGE.recorder, f.rpc), denied("chain_id_mismatch"))
  assert.equal(f.calls.length, 1)
})

test("missing, zero or malformed bytecode denies before checking recorder", async () => {
  for (const code of [null, "0x", "0x00", "0x0", "0xzz", "0x123"]) {
    const f = fixture({ code })
    await assert.rejects(verifyOmnioneSigningAuthority(target, OMNIONE_STAGE.recorder, f.rpc), denied("registry_code_empty_or_invalid"))
    assert.equal(f.calls.length, 2)
  }
})

test("revoked permission is re-read for every attempted write", async () => {
  await verifyOmnioneSigningAuthority(target, OMNIONE_STAGE.recorder, fixture().rpc)
  const f = fixture({ permission: omnioneReadAbi.encodeFunctionResult("recorders", [false]) })
  await assert.rejects(verifyOmnioneSigningAuthority(target, OMNIONE_STAGE.recorder, f.rpc), denied("recorder_not_allowed"))
  assert.equal(f.calls.length, 3)
})

test("malformed permission is not treated as truthy", async () => {
  const f = fixture({ permission: "0x02" })
  await assert.rejects(verifyOmnioneSigningAuthority(target, OMNIONE_STAGE.recorder, f.rpc), denied("registry_response_invalid"))
})

test("bounded production reader never exposes a failing provider URL or token", async () => {
  let calls = 0
  const rpc = omnioneRpcReader(target.rpcUrl, { maxCalls: 3, fetchImpl: async () => {
    calls++; throw new Error(`provider leaked ${target.rpcUrl}`)
  } })
  await assert.rejects(verifyOmnioneSigningAuthority(target, OMNIONE_STAGE.recorder, rpc), denied("rpc_transport_failed"))
  assert.equal(calls, 1)
})
