import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import { Interface } from "ethers"
import { OMNIONE_STAGE, READINESS_ABI, runOmnioneReadiness } from "../../scripts/hackathon-omnione-readiness"
import { omnioneTarget } from "../../lib/hackathon/omnione-targets"

const abi = new Interface(READINESS_ABI)
const token = "query-token-sentinel-do-not-print"
const env = {
  HK_OMNIONE_RPC_URL: `${OMNIONE_STAGE.rpcOrigin}/?token=${token}`,
  HK_OMNIONE_REGISTRY_ADDRESS: OMNIONE_STAGE.registry,
}
const evidence = {
  HK_OMNIONE_READINESS_TX_HASH: "0x" + "a".repeat(64),
  HK_OMNIONE_READINESS_EVENT_KEY: "0x" + "b".repeat(64),
  HK_OMNIONE_READINESS_PAYLOAD_COMMITMENT: "0x" + "c".repeat(64),
}
const baseReceipt = { status: "0x1", from: OMNIONE_STAGE.recorder, blockHash: "0x" + "d".repeat(64), blockNumber: OMNIONE_STAGE.deployBlock }
const deployment = { ...baseReceipt, to: null, contractAddress: OMNIONE_STAGE.registry, transactionHash: OMNIONE_STAGE.deployTx }
const encodedEvent = abi.encodeEventLog(abi.getEvent("DemoEntitlementRedeemed")!, [evidence.HK_OMNIONE_READINESS_EVENT_KEY, evidence.HK_OMNIONE_READINESS_PAYLOAD_COMMITMENT, 1n, OMNIONE_STAGE.recorder])
const redemptionReceipt = { ...baseReceipt, to: OMNIONE_STAGE.registry, transactionHash: evidence.HK_OMNIONE_READINESS_TX_HASH, logs: [{ address: OMNIONE_STAGE.registry, ...encodedEvent }] }
type RpcBody = { id: number; method: string; params: unknown[] }
function fixture(override?: (body: RpcBody) => unknown) {
  const calls: RpcBody[] = []
  const fetchImpl: typeof fetch = async (url, init) => {
    assert.equal(String(url), env.HK_OMNIONE_RPC_URL)
    assert.equal(init?.redirect, "error")
    assert.equal(init?.method, "POST")
    assert.equal(init?.credentials, "omit")
    assert.deepEqual(init?.headers, { "content-type": "application/json" })
    const body = JSON.parse(String(init?.body)) as RpcBody
    calls.push(body)
    let result = override?.(body)
    if (result === undefined) {
      if (body.method === "eth_chainId") result = `0x${OMNIONE_STAGE.chainId.toString(16)}`
      else if (body.method === "eth_getCode") result = "0x60806040"
      else if (body.method === "eth_getTransactionReceipt") result = body.params[0] === OMNIONE_STAGE.deployTx ? deployment : redemptionReceipt
      else if (body.method === "eth_call") {
        const data = (body.params[0] as { data: string }).data
        result = data.startsWith(abi.getFunction("recorders")!.selector)
          ? abi.encodeFunctionResult("recorders", [true])
          : abi.encodeFunctionResult("getRedemption", [true, evidence.HK_OMNIONE_READINESS_PAYLOAD_COMMITMENT, 1n, OMNIONE_STAGE.recorder])
      } else assert.fail("Non-read-only RPC method")
    }
    return Response.json({ jsonrpc: "2.0", id: body.id, result })
  }
  return { fetchImpl, calls }
}

test("approved public constants match deployment metadata", async () => {
  const meta = JSON.parse(await readFile(new URL("../../../chain/omnione/deploy-info.stage.json", import.meta.url), "utf8"))
  assert.equal(OMNIONE_STAGE.chainId, meta.chainId)
  assert.equal(OMNIONE_STAGE.registry, meta.DemoEntitlementRegistry.address)
  assert.equal(OMNIONE_STAGE.deployTx, meta.DemoEntitlementRegistry.deployTx)
  assert.equal(OMNIONE_STAGE.deployBlock, meta.DemoEntitlementRegistry.block)
  assert.equal(OMNIONE_STAGE.recorder, meta.recorder.toLowerCase())
  assert.equal(OMNIONE_STAGE.rpcOrigin, new URL(meta.rpc).origin)
})

test("default offline reads neither secrets nor the network and prints only safe metadata", async () => {
  const readKeys: string[] = []
  const guarded = new Proxy(env, { get(target, key) {
    readKeys.push(String(key))
    assert.notEqual(key, "HK_OMNIONE_PRIVATE_KEY")
    return target[key as keyof typeof target]
  } })
  const result = await runOmnioneReadiness({ env: guarded, fetchImpl: async () => { assert.fail("offline network") } })
  assert.equal(result.ok, true)
  assert.equal(result.mode, "offline")
  assert.equal(result.rpcRequests, 0)
  assert.equal(result.newTransactions, 0)
  assert.equal(result.evidence, "not_requested")
  assert.equal(JSON.stringify(result).includes(token), false)
  assert.equal(readKeys.some(key => key.includes("PRIVATE")), false)
  assert.equal((await runOmnioneReadiness({ env: {} })).ok, false)
})

test("new registered target checks its deployment and runtime without replacing legacy pins", async () => {
  const target = omnioneTarget("stage-20260930")
  const runtime = JSON.parse(await readFile(new URL("../../../chain/omnione/runtime.stage-20260930.json", import.meta.url), "utf8")).runtime
  const selected = { ...env, HK_OMNIONE_TARGET_ID: target.targetId, HK_OMNIONE_REGISTRY_ADDRESS: target.registry, HK_OMNIONE_RECORDER_ADDRESS: target.recorder }
  const fixtureNew = fixture(body => {
    if (body.method === "eth_getCode") { assert.equal(body.params[0], target.registry); return runtime }
    if (body.method === "eth_getTransactionReceipt") { assert.equal(body.params[0], target.deployTx); return { ...deployment, from: target.recorder, contractAddress: target.registry, transactionHash: target.deployTx, blockNumber: target.deployBlock } }
    if (body.method === "eth_call") { assert.equal((body.params[0] as { to: string }).to, target.registry); return abi.encodeFunctionResult("recorders", [true]) }
  })
  const result = await runOmnioneReadiness({ mode: "read-only", env: selected, fetchImpl: fixtureNew.fetchImpl })
  assert.equal(result.ok, true); assert.equal(result.target?.targetId, target.targetId); assert.equal(result.rpcRequests, 4)
  for (const change of [{ HK_OMNIONE_TARGET_ID: "unregistered" }, { HK_OMNIONE_REGISTRY_ADDRESS: OMNIONE_STAGE.registry }, { HK_OMNIONE_RECORDER_ADDRESS: OMNIONE_STAGE.recorder }]) {
    const rejected = await runOmnioneReadiness({ mode: "read-only", env: { ...selected, ...change }, fetchImpl: async () => { assert.fail("invalid target must not contact RPC") } })
    assert.equal(rejected.ok, false); assert.equal(rejected.rpcRequests, 0)
  }
  const wrongCode = await runOmnioneReadiness({ mode: "read-only", env: selected, fetchImpl: fixture().fetchImpl })
  assert.equal(wrongCode.ok, false); assert.ok(wrongCode.issues.includes("registry_code_mismatch"))
})

test("query token is supported, while alternate hosts, credentials, redirects and query injection fail closed", async () => {
  for (const rpc of ["", `${OMNIONE_STAGE.rpcOrigin}/?token=<API_KEY>`, `${OMNIONE_STAGE.rpcOrigin}/?token=API_KEY`,
    `http://stage-chainapi.omnione.net/?token=${token}`, `https://evil.invalid/?token=${token}`,
    `https://u:p@stage-chainapi.omnione.net/?token=${token}`, `${OMNIONE_STAGE.rpcOrigin}/other?token=${token}`,
    `${OMNIONE_STAGE.rpcOrigin}/?token=${token}&token=other`, `${OMNIONE_STAGE.rpcOrigin}/?token=${token}&other=1`,
    `${OMNIONE_STAGE.rpcOrigin}/?token=${token}#fragment`, `https://stage-chainapi.omnione.net:1234/?token=${token}`]) {
    const result = await runOmnioneReadiness({ mode: "read-only", env: { ...env, HK_OMNIONE_RPC_URL: rpc }, fetchImpl: async () => { assert.fail("invalid config network") } })
    assert.ok(result.issues.includes("rpc_configuration_invalid"))
    assert.equal(result.rpcRequests, 0)
    assert.equal(JSON.stringify(result).includes(token), false)
  }
  for (const patch of [{ HK_OMNIONE_CHAIN_ID: "1" }, { HK_OMNIONE_REGISTRY_ADDRESS: "0x" + "1".repeat(40) }, { HK_OMNIONE_READINESS_TX_HASH: evidence.HK_OMNIONE_READINESS_TX_HASH }]) {
    assert.equal((await runOmnioneReadiness({ mode: "read-only", env: { ...env, ...patch }, fetchImpl: async () => { assert.fail("invalid config network") } })).ok, false)
  }
})

test("explicit read-only checks exact chain, code, approved recorder and deployment with four RPC calls", async () => {
  const f = fixture()
  const result = await runOmnioneReadiness({ mode: "read-only", env, fetchImpl: f.fetchImpl })
  assert.equal(result.ok, true)
  assert.equal(result.rpcRequests, 4)
  assert.deepEqual(result.checks, ["chain_id", "registry_code_present", "recorder_allowed", "deployment_receipt"])
  assert.deepEqual(f.calls.map(call => call.method), ["eth_chainId", "eth_getCode", "eth_call", "eth_getTransactionReceipt"])
  assert.equal(result.evidence, "not_requested")
})

test("wrong chain, empty code, false recorder and unrelated deployment each stop immediately", async () => {
  const cases = [
    { method: "eth_chainId", value: "0x1", issue: "chain_id_mismatch", count: 1 },
    { method: "eth_getCode", value: "0x", issue: "registry_code_empty_or_invalid", count: 2 },
    { method: "eth_getCode", value: "0x00", issue: "registry_code_empty_or_invalid", count: 2 },
    { method: "eth_call", value: abi.encodeFunctionResult("recorders", [false]), issue: "recorder_not_allowed", count: 3 },
    { method: "eth_getTransactionReceipt", value: null, issue: "deployment_receipt_pending", count: 4 },
    { method: "eth_getTransactionReceipt", value: { ...deployment, status: "0x0" }, issue: "deployment_receipt_failed", count: 4 },
    { method: "eth_getTransactionReceipt", value: { ...deployment, contractAddress: "0x" + "1".repeat(40) }, issue: "deployment_receipt_mismatch", count: 4 },
  ]
  for (const item of cases) {
    const f = fixture(body => body.method === item.method ? item.value : undefined)
    const result = await runOmnioneReadiness({ mode: "read-only", env, fetchImpl: f.fetchImpl })
    assert.equal(result.ok, false)
    assert.deepEqual(result.issues, [item.issue])
    assert.equal(result.rpcRequests, item.count)
  }
})

test("401, redirects, provider and transport errors never disclose query tokens or external messages", async () => {
  const errors: [typeof fetch, string][] = [
    [async () => new Response(token, { status: 401 }), "rpc_auth_rejected"],
    [async () => new Response(token, { status: 403 }), "rpc_auth_rejected"],
    [async () => new Response(token, { status: 302, headers: { location: `https://evil.invalid/${token}` } }), "rpc_redirect_rejected"],
    [async () => { throw new Error(env.HK_OMNIONE_RPC_URL) }, "rpc_transport_failed"],
    [async () => Response.json({ jsonrpc: "2.0", id: 1, error: { message: env.HK_OMNIONE_RPC_URL } }), "rpc_response_invalid"],
    [async () => Response.json({ jsonrpc: "2.0", id: 2, result: `0x${OMNIONE_STAGE.chainId.toString(16)}` }), "rpc_response_invalid"],
  ]
  for (const [fetchImpl, issue] of errors) {
    const result = await runOmnioneReadiness({ mode: "read-only", env, fetchImpl })
    assert.deepEqual(result.issues, [issue])
    assert.equal(JSON.stringify(result).includes(token), false)
    assert.equal(JSON.stringify(result).includes("?token="), false)
  }
})

test("fetch and streaming body have bounded deadlines, even if a fixture ignores abort", async () => {
  for (const fetchImpl of [
    (() => new Promise<Response>(() => undefined)) as typeof fetch,
    (async () => new Response(new ReadableStream({ start() { /* never closes */ } }))) as typeof fetch,
  ]) {
    const started = Date.now()
    const result = await runOmnioneReadiness({ mode: "read-only", env, fetchImpl, timeoutMs: 10 })
    assert.deepEqual(result.issues, ["rpc_timeout"])
    assert.ok(Date.now() - started < 1000)
  }
  for (const response of [new Response("x", { headers: { "content-length": "262145" } }), new Response("x".repeat(262145))]) {
    const result = await runOmnioneReadiness({ mode: "read-only", env, fetchImpl: async () => response })
    assert.deepEqual(result.issues, ["rpc_response_too_large"])
  }
})

test("existing evidence requires successful receipt, matching registry and matching event in that transaction", async () => {
  const result = await runOmnioneReadiness({ mode: "read-only", env: { ...env, ...evidence }, fetchImpl: fixture().fetchImpl })
  assert.equal(result.ok, true)
  assert.equal(result.rpcRequests, 6)
  assert.equal(result.evidence, "confirmed")
  assert.equal(result.newTransactions, 0)
  for (const rc of [null, { ...redemptionReceipt, status: "0x0" }, { ...redemptionReceipt, logs: [] }, { ...redemptionReceipt, transactionHash: "0x" + "e".repeat(64) }]) {
    const result = await runOmnioneReadiness({ mode: "read-only", env: { ...env, ...evidence }, fetchImpl: fixture(body => body.method === "eth_getTransactionReceipt" && body.params[0] === evidence.HK_OMNIONE_READINESS_TX_HASH ? rc : undefined).fetchImpl })
    assert.equal(result.ok, false)
    assert.notEqual(result.evidence, "confirmed")
    if (rc === null) assert.equal(result.evidence, "pending")
    if (rc?.status === "0x0") assert.equal(result.evidence, "failed")
  }
})

test("mismatched or absent redemption never counts as confirmed, even with a successful receipt", async () => {
  for (const entry of [[true, "0x" + "e".repeat(64), 1n, OMNIONE_STAGE.recorder], [false, "0x" + "0".repeat(64), 0n, "0x" + "0".repeat(40)], [true, evidence.HK_OMNIONE_READINESS_PAYLOAD_COMMITMENT, 1n, "0x" + "e".repeat(40)]]) {
    const f = fixture(body => body.method === "eth_call" && (body.params[0] as { data: string }).data.startsWith(abi.getFunction("getRedemption")!.selector) ? abi.encodeFunctionResult("getRedemption", entry) : undefined)
    const result = await runOmnioneReadiness({ mode: "read-only", env: { ...env, ...evidence }, fetchImpl: f.fetchImpl })
    assert.deepEqual(result.issues, ["redemption_mismatch"])
    assert.equal(result.evidence, "unverified")
  }
})
