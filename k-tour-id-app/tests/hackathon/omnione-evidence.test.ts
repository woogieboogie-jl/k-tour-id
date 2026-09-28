import assert from "node:assert/strict"
import { test } from "node:test"
import { OMNIONE_STAGE, omnioneReadAbi as abi, verifyOmnioneReceiptEvidence, type OmnioneExpectation } from "../../lib/hackathon/omnione-evidence"
import { omnioneRpcReader, readOmnioneReceiptEvidence } from "../../lib/hackathon/omnione-readonly"

export const expected: OmnioneExpectation = { ...OMNIONE_STAGE, txHash: "0x" + "a".repeat(64), eventKey: "0x" + "b".repeat(64), payloadCommitment: "0x" + "c".repeat(64) }
const blockHash = "0x" + "d".repeat(64)
export const entry = { exists: true, payloadCommitment: expected.payloadCommitment, recordedAt: 10n, recorder: expected.recorder }
export function receiptFixture() {
  return { status: "0x1", transactionHash: expected.txHash, blockNumber: "0x7b", blockHash, to: expected.registry, from: expected.recorder,
    logs: [{ address: expected.registry, transactionHash: expected.txHash, blockHash, blockNumber: "0x7b", removed: false,
      ...abi.encodeEventLog(abi.getEvent("DemoEntitlementRedeemed")!, [expected.eventKey, expected.payloadCommitment, entry.recordedAt, expected.recorder]) }],
  }
}
function rpcFixture(patch?: (method: string, params: unknown[]) => unknown) {
  const calls: string[] = []
  return { calls, async call(method: Parameters<ReturnType<typeof omnioneRpcReader>["call"]>[0], params: unknown[]): Promise<unknown> {
    calls.push(method)
    const override = patch?.(method, params)
    if (override !== undefined) return override
    if (method === "eth_chainId") return "0x" + expected.chainId.toString(16)
    if (method === "eth_getTransactionReceipt") return receiptFixture()
    assert.equal(method, "eth_call")
    const call = params[0] as { to: string; data: string }
    assert.equal(call.to, expected.registry)
    if (call.data.startsWith(abi.getFunction("recorders")!.selector)) return abi.encodeFunctionResult("recorders", [true])
    assert.equal(call.data, abi.encodeFunctionData("getRedemption", [expected.eventKey]))
    return abi.encodeFunctionResult("getRedemption", [entry.exists, entry.payloadCommitment, entry.recordedAt, entry.recorder])
  } }
}

test("receipt, authorized recorder, registry entry and exact same-transaction event bind together", async () => {
  assert.deepEqual(verifyOmnioneReceiptEvidence(receiptFixture(), entry, true, expected), { blockNumber: 123, blockHash })
  const rpc = rpcFixture()
  assert.deepEqual(await readOmnioneReceiptEvidence(rpc, expected), { status: "confirmed", blockNumber: 123 })
  assert.deepEqual(rpc.calls, ["eth_chainId", "eth_getTransactionReceipt", "eth_call", "eth_call"])
})

test("foreign tx, target, sender, status or block cannot confirm even with matching registry data", () => {
  const base = receiptFixture()
  for (const patch of [
    { transactionHash: "0x" + "1".repeat(64) }, { to: "0x" + "1".repeat(40) }, { from: "0x" + "1".repeat(40) },
    { status: "0x0" }, { status: "0x2" }, { blockHash: "0x" + "0".repeat(64) }, { blockNumber: "0x0" },
    { blockNumber: "0x20000000000000" }, { blockNumber: null },
  ]) assert.throws(() => verifyOmnioneReceiptEvidence({ ...base, ...patch }, entry, true, expected))
})

test("event emitter, scope, data, recorder, location, removed and duplicate mismatches are rejected", () => {
  const base = receiptFixture(), log = base.logs[0]
  const foreignEvent = abi.encodeEventLog(abi.getEvent("DemoEntitlementRedeemed")!, ["0x" + "1".repeat(64), expected.payloadCommitment, entry.recordedAt, expected.recorder])
  const otherRecorder = abi.encodeEventLog(abi.getEvent("DemoEntitlementRedeemed")!, [expected.eventKey, expected.payloadCommitment, entry.recordedAt, "0x" + "1".repeat(40)])
  const logs = [[], [log, log], [{ ...log, address: "0x" + "1".repeat(40) }], [{ ...log, ...foreignEvent }], [{ ...log, ...otherRecorder }],
    [{ ...log, data: "0x" }], [{ ...log, topics: [] }], [{ ...log, removed: true }],
    [{ ...log, transactionHash: "0x" + "1".repeat(64) }], [{ ...log, blockHash: "0x" + "1".repeat(64) }], [{ ...log, blockNumber: "0x7c" }]]
  for (const value of logs) assert.throws(() => verifyOmnioneReceiptEvidence({ ...base, logs: value }, entry, true, expected), { message: "evidence_event_mismatch" })
})

test("unauthorized recorder and missing/different registry record are not receipt confirmation", () => {
  assert.throws(() => verifyOmnioneReceiptEvidence(receiptFixture(), entry, false, expected), { message: "recorder_not_allowed" })
  for (const patch of [{ exists: false }, { payloadCommitment: "0x" + "1".repeat(64) }, { recorder: "0x" + "1".repeat(40) }, { recordedAt: 0n }, { recordedAt: 11n }]) {
    assert.throws(() => verifyOmnioneReceiptEvidence(receiptFixture(), { ...entry, ...patch }, true, expected))
  }
})

test("read pipeline requires actual chain and recorder authorization; pending/failed remain distinct", async () => {
  assert.equal((await readOmnioneReceiptEvidence(rpcFixture(method => method === "eth_chainId" ? "0x1" : undefined), expected)).status, "mismatch")
  const unauthorized = rpcFixture((method, params) => method === "eth_call" && (params[0] as { data: string }).data.startsWith(abi.getFunction("recorders")!.selector) ? abi.encodeFunctionResult("recorders", [false]) : undefined)
  assert.equal((await readOmnioneReceiptEvidence(unauthorized, expected)).status, "mismatch")
  assert.equal(unauthorized.calls.length, 3)
  assert.deepEqual(await readOmnioneReceiptEvidence(rpcFixture(method => method === "eth_getTransactionReceipt" ? null : undefined), expected), { status: "pending", blockNumber: null })
  assert.deepEqual(await readOmnioneReceiptEvidence(rpcFixture(method => method === "eth_getTransactionReceipt" ? { ...receiptFixture(), status: "0x0" } : undefined), expected), { status: "failed", blockNumber: 123, code: "receipt_status_0" })
})

test("malformed expectations perform no read; RPC responses and errors are bounded and sanitized", async () => {
  const rpc = rpcFixture()
  await assert.rejects(readOmnioneReceiptEvidence(rpc, { ...expected, txHash: "fixture-secret" }))
  assert.equal(rpc.calls.length, 0)
  const secret = "fixture-secret-not-for-output"
  for (const fake of [async () => { throw new Error(secret) }, async () => Response.json({ jsonrpc: "2.0", id: 1, result: null, error: { message: secret } })]) {
    const reader = omnioneRpcReader("https://fixture.invalid", { fetchImpl: fake })
    await assert.rejects(reader.call("eth_chainId", []), error => error instanceof Error && !error.message.includes(secret))
  }
  const never = omnioneRpcReader("https://fixture.invalid", { fetchImpl: () => new Promise(() => undefined), timeoutMs: 10 })
  await assert.rejects(never.call("eth_chainId", []), { message: "rpc_timeout" })
  const capped = omnioneRpcReader("https://fixture.invalid", { maxCalls: 1, fetchImpl: async () => Response.json({ jsonrpc: "2.0", id: 1, result: "0x1" }) })
  await capped.call("eth_chainId", [])
  await assert.rejects(capped.call("eth_chainId", []), { message: "rpc_deadline" })
})
