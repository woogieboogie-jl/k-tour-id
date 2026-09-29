// Independent outbox review: real service AND OmniOne adapter, inert ethers I/O.
// No authentication, real keys, signing, RPC or transaction submission occurs.
import assert from "node:assert/strict"
import { after, before, beforeEach, mock, test } from "node:test"
import { mkdtempSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import http from "node:http"
import https from "node:https"
import { Interface, Transaction, getBytes, hexlify, keccak256, zeroPadValue } from "ethers"
import { HkError } from "../../lib/hackathon/util"
import { omnioneReadAbi, OMNIONE_STAGE } from "../../lib/hackathon/omnione-evidence"
import { omnioneTargetSnapshot, type OmnioneTargetSnapshot } from "../../lib/hackathon/omnione-targets"

const directory = mkdtempSync(join(tmpdir(), "omnione-preflight-review-"))
const commitment = "0x" + "2".repeat(64), eventKey = "0x" + "4".repeat(64)
const registryAddress = OMNIONE_STAGE.registry
const recorderAddress = OMNIONE_STAGE.recorder
const newTarget = omnioneTargetSnapshot("stage-20260930")
const newRuntime = JSON.parse(readFileSync(new URL("../../../chain/omnione/runtime.stage-20260930.json", import.meta.url), "utf8")).runtime as string
const rpcUrl = `${OMNIONE_STAGE.rpcOrigin}/?token=offline-fixture-not-a-real-token`
const abi = new Interface(["function recordRedemption(bytes32 eventKey, bytes32 payloadCommitment)"])
const env = {
  HK_ISOLATED_MOCK: "0", HK_DATA_DIR: directory,
  HK_OMNIONE_RPC_URL: rpcUrl, HK_OMNIONE_PRIVATE_KEY: "fixture-never-used",
  HK_OMNIONE_REGISTRY_ADDRESS: registryAddress, HK_OMNIONE_CHAIN_ID: "201210", HK_OMNIONE_GAS_LIMIT: "300000",
  HK_OMNIONE_RECORDER_ADDRESS: recorderAddress,
  HK_OMNIONE_TARGET_ID: "stage-legacy-20260914",
  UPSTASH_REDIS_REST_URL: "", UPSTASH_REDIS_REST_TOKEN: "", KV_REST_API_URL: "", KV_REST_API_TOKEN: "",
}
const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]))
const originalFetch = globalThis.fetch
let registryReads = 0, signerConstructions = 0, broadcasts = 0, networkAttempts = 0, sequence = 0
let failedRegistryRead = 0, populateFailure = false, signFailure = false, broadcastFailure = false, wrongBroadcastHash = false
let registryExists = false, receipt: { status: number; blockNumber: number } | null = null
let populated: Record<string, unknown> | null = null, signedFixture = ""
let afterSign: (() => Promise<void>) | null = null
let onBroadcast: (() => Promise<void>) | null = null
let signerAddress: string = recorderAddress, chainId: number = OMNIONE_STAGE.chainId, recorderAllowed = true, registryCode = "0x6000"
let authorityReads = 0, signingAttempts = 0
let receiptTarget = omnioneTargetSnapshot()

mock.module("ethers", { namedExports: {
  getBytes, hexlify, keccak256, zeroPadValue, Interface,
  JsonRpcProvider: class {
    async getTransactionReceipt() { return receipt }
    async broadcastTransaction(serialized: string) {
      broadcasts++
      assert.equal(serialized, signedFixture)
      await onBroadcast?.()
      if (broadcastFailure) throw new Error("fixture timeout after broadcast entry")
      return { hash: wrongBroadcastHash ? "0x" + "f".repeat(64) : keccak256(serialized) }
    }
  },
  Wallet: class {
    constructor() { signerConstructions++ }
    get address() { return signerAddress }
    async populateTransaction(request: Record<string, unknown>) {
      if (populateFailure) throw new Error("fixture populate failure")
      populated = { ...request, nonce: 7, chainId: 201210 }
      return populated
    }
    async signTransaction(request: Record<string, unknown>) {
      signingAttempts++
      if (signFailure) throw new Error("fixture signing failure")
      // Assemble fixed RLP with an intentionally synthetic signature; no key
      // or cryptographic signer is used. Real ethers serialization/hash only.
      signedFixture = Transaction.from({ ...request, signature: { r: "0x" + "1".repeat(64), s: "0x" + "2".repeat(64), v: 27 } }).serialized
      await afterSign?.()
      return signedFixture
    }
  },
  Contract: class {
    constructor(readonly address: string) {}
    async getRedemption() {
      registryReads++
      if (registryReads === failedRegistryRead) throw new Error("fixture: registry read failed before signing")
      return [registryExists, commitment, 0, "fixture-recorder"]
    }
    recordRedemption = { populateTransaction: async (key: string, payload: string, overrides: Record<string, unknown>) => {
      assert.equal(key, eventKey); assert.equal(payload, commitment)
      return { to: this.address, data: abi.encodeFunctionData("recordRedemption", [key, payload]), ...overrides }
    } }
  },
} })

before(() => {
  Object.assign(process.env, env)
  const forbidden = () => { networkAttempts++; throw new Error("network forbidden in preflight review") }
  globalThis.fetch = async (url, init) => {
    if (String(url) !== rpcUrl || init?.method !== "POST") return forbidden()
    const body = JSON.parse(String(init.body)) as { id: number; method: string; params: unknown[] }
    let result: unknown
    if (body.method === "eth_chainId") result = "0x" + chainId.toString(16)
    else if (body.method === "eth_getCode") { authorityReads++; result = registryCode }
    else if (body.method === "eth_getTransactionReceipt") {
      assert.equal(body.params[0], keccak256(signedFixture))
      result = receipt ? {
        status: "0x" + receipt.status.toString(16), blockNumber: "0x" + receipt.blockNumber.toString(16), blockHash: "0x" + "6".repeat(64),
        transactionHash: keccak256(signedFixture), to: receiptTarget.registry, from: receiptTarget.recorder,
        logs: [{ address: receiptTarget.registry, ...omnioneReadAbi.encodeEventLog(omnioneReadAbi.getEvent("DemoEntitlementRedeemed")!, [eventKey, commitment, 1n, receiptTarget.recorder]) }],
      } : null
    } else if (body.method === "eth_call") {
      const data = (body.params[0] as { data: string }).data
      if (data.startsWith(omnioneReadAbi.getFunction("recorders")!.selector)) result = omnioneReadAbi.encodeFunctionResult("recorders", [recorderAllowed])
      else if (data.startsWith(omnioneReadAbi.getFunction("getRedemption")!.selector)) {
        assert.equal((body.params[0] as { to: string }).to, receiptTarget.registry)
        result = omnioneReadAbi.encodeFunctionResult("getRedemption", [registryExists, commitment, 1n, receiptTarget.recorder])
      }
      else return forbidden()
    } else return forbidden()
    return Response.json({ jsonrpc: "2.0", id: body.id, result })
  }
  mock.method(http, "request", forbidden); mock.method(https, "request", forbidden)
})
beforeEach(() => {
  Object.assign(process.env, env); receiptTarget = omnioneTargetSnapshot()
  registryReads = 0; signerConstructions = 0; broadcasts = 0; failedRegistryRead = 0
  populateFailure = false; signFailure = false; broadcastFailure = false; wrongBroadcastHash = false
  registryExists = false; receipt = null; populated = null; signedFixture = ""; afterSign = null; onBroadcast = null
  signerAddress = recorderAddress; chainId = OMNIONE_STAGE.chainId; recorderAllowed = true; registryCode = "0x6000"
  authorityReads = 0; signingAttempts = 0
})
after(() => {
  globalThis.fetch = originalFetch
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  mock.restoreAll()
  rmSync(directory, { recursive: true, force: true })
  assert.equal(networkAttempts, 0)
})

async function seed(target?: OmnioneTargetSnapshot) {
  const { withStore } = await import("../../lib/hackathon/store")
  const id = `fixture-outbox-${++sequence}`
  const now = new Date().toISOString()
  await withStore(db => {
    db.outbox[id] = {
      ...(target ? { target } : {}),
      outboxId: id, operationId: "fixture-operation", eventKey,
      payloadCommitment: commitment, payload: {}, status: "pending", txHash: null, blockNumber: null,
      attempts: 0, lastError: null, createdAt: now, updatedAt: now, confirmedAt: null,
    }
  })
  return id
}

function selectNewTarget() {
  Object.assign(process.env, { HK_OMNIONE_TARGET_ID: newTarget.targetId, HK_OMNIONE_REGISTRY_ADDRESS: newTarget.registry, HK_OMNIONE_RECORDER_ADDRESS: newTarget.recorder })
  signerAddress = newTarget.recorder; registryCode = newRuntime
}
test("new snapshotted outbox signs only the new target and passes bytecode attestation", async () => {
  selectNewTarget(); receiptTarget = newTarget
  const { processOutbox } = await import("../../lib/hackathon/service")
  const id = await seed(newTarget)
  const result = await processOutbox(id)
  assert.equal(result?.status, "submitted"); assert.equal(broadcasts, 1)
  assert.equal(populated!.to, newTarget.registry)
  assert.deepEqual(result?.target, newTarget)
})
test("legacy pending outbox cannot be automatically moved to the new signer/registry", async () => {
  selectNewTarget()
  const { processOutbox } = await import("../../lib/hackathon/service")
  const id = await seed()
  const result = await processOutbox(id)
  assert.equal(result?.status, "pending"); assert.equal(result?.attempts, 0)
  assert.equal(registryReads, 0); assert.equal(signingAttempts, 0); assert.equal(broadcasts, 0)
})
test("saved legacy receipt recovers after target switch and removal of signer without rebroadcast", async () => {
  const { processOutbox } = await import("../../lib/hackathon/service")
  const id = await seed()
  const first = await processOutbox(id)
  assert.equal(first?.status, "submitted")
  selectNewTarget(); process.env.HK_OMNIONE_PRIVATE_KEY = ""
  receipt = { status: 1, blockNumber: 10 }; registryExists = true
  const recovered = await processOutbox(id)
  assert.equal(recovered?.status, "confirmed"); assert.equal(broadcasts, 1)
  assert.equal(recovered?.attempts, 1); assert.equal(signingAttempts, 1)
})
test("new receipt remains readable on its own target after current configuration rolls back", async () => {
  selectNewTarget(); receiptTarget = newTarget
  const { processOutbox } = await import("../../lib/hackathon/service")
  const id = await seed(newTarget)
  await processOutbox(id)
  Object.assign(process.env, env); process.env.HK_OMNIONE_PRIVATE_KEY = ""
  receipt = { status: 1, blockNumber: 11 }; registryExists = true
  const recovered = await processOutbox(id)
  assert.equal(recovered?.status, "confirmed"); assert.deepEqual(recovered?.target, newTarget)
  assert.equal(broadcasts, 1); assert.equal(signingAttempts, 1)
})

test("failure in the adapter's read-only preflight does not strand a never-broadcast audit", async () => {
  const { processOutbox } = await import("../../lib/hackathon/service")
  const id = await seed(); failedRegistryRead = 2
  const first = await processOutbox(id)
  assert.equal(registryReads, 2, "exercise both the worker and adapter preflight reads")
  assert.equal(signerConstructions, 0, "the adapter has not even constructed its signer")
  assert.equal(broadcasts, 0, "nothing could have reached broadcast")
  assert.equal(first?.status, "pending", "a known read-only failure should remain retryable")
  assert.equal(first?.attempts, 0)
  const recovered = await processOutbox(id)
  assert.equal(recovered?.status, "submitted")
  assert.equal(broadcasts, 1)
})

for (const stage of ["populate", "sign"] as const) test(`${stage} failure before broadcast remains safely retryable`, async () => {
  const { processOutbox } = await import("../../lib/hackathon/service")
  const id = await seed()
  populateFailure = stage === "populate"; signFailure = stage === "sign"
  const first = await processOutbox(id)
  assert.equal(first?.status, "pending"); assert.equal(first?.attempts, 0); assert.equal(first?.txHash, null)
  assert.equal(broadcasts, 0)
  populateFailure = false; signFailure = false
  assert.equal((await processOutbox(id))?.status, "submitted"); assert.equal(broadcasts, 1)
})

test("persistence callback rejection forbids broadcast and does not poison a new attempt", async () => {
  const { submitRedemption } = await import("../../lib/hackathon/adapters/omnione")
  await assert.rejects(submitRedemption({ eventKeyHex: eventKey, payloadCommitmentHex: commitment, onPrepared: async hash => {
    assert.equal(hash, keccak256(signedFixture)); throw new Error("fixture persistence rejected")
  } }), (error: unknown) => error instanceof HkError && error.code === "omnione_submission_not_started")
  assert.equal(broadcasts, 0)
  const next = await submitRedemption({ eventKeyHex: eventKey, payloadCommitmentHex: commitment, onPrepared: async () => undefined })
  assert.equal(next.txHash, keccak256(signedFixture)); assert.equal(broadcasts, 1)
})

test("prepared hash is durable before broadcast and preserves legacy calldata/gas/type", async () => {
  const { processOutbox } = await import("../../lib/hackathon/service")
  const { readStore } = await import("../../lib/hackathon/store")
  const id = await seed()
  onBroadcast = async () => {
    const row = await readStore(db => db.outbox[id])
    assert.equal(row.txHash, keccak256(signedFixture)); assert.equal(row.status, "submitted")
  }
  const result = await processOutbox(id)
  const parsed = Transaction.from(signedFixture)
  assert.equal(result?.txHash, parsed.hash)
  assert.equal(parsed.type, 0); assert.equal(parsed.gasPrice, 0n); assert.equal(parsed.gasLimit, 300000n)
  assert.equal(parsed.chainId, 201210n); assert.equal(parsed.nonce, 7)
  assert.equal(parsed.to?.toLowerCase(), registryAddress)
  assert.equal(parsed.data, abi.encodeFunctionData("recordRedemption", [eventKey, commitment]))
  assert.ok(populated); assert.equal(broadcasts, 1)
  assert.equal(authorityReads, 1); assert.equal(signingAttempts, 1)
})

for (const failure of ["signer", "chain", "code", "permission"] as const) test(`write authorization refuses ${failure} mismatch before signing or broadcast`, async () => {
  const { submitRedemption } = await import("../../lib/hackathon/adapters/omnione")
  if (failure === "signer") signerAddress = "0x" + "f".repeat(40)
  if (failure === "chain") chainId = 1
  if (failure === "code") registryCode = "0x"
  if (failure === "permission") recorderAllowed = false
  let prepared = false
  await assert.rejects(submitRedemption({ eventKeyHex: eventKey, payloadCommitmentHex: commitment, onPrepared: async () => { prepared = true } }),
    (error: unknown) => error instanceof HkError && error.code === "omnione_submission_not_started")
  assert.equal(prepared, false); assert.equal(populated, null); assert.equal(signingAttempts, 0); assert.equal(broadcasts, 0)
})

test("broadcast timeout retains the prepared hash and recovers without rebroadcast", async () => {
  const { processOutbox } = await import("../../lib/hackathon/service")
  const id = await seed(); broadcastFailure = true
  const first = await processOutbox(id)
  assert.equal(first?.status, "submitted"); assert.equal(first?.txHash, keccak256(signedFixture))
  assert.equal(first?.attempts, 1); assert.equal(broadcasts, 1)
  broadcastFailure = false; receipt = { status: 1, blockNumber: 99 }; registryExists = true
  const recovered = await processOutbox(id)
  assert.equal(recovered?.status, "confirmed"); assert.equal(recovered?.blockNumber, 99); assert.equal(broadcasts, 1)
})

test("a mismatching broadcast response cannot replace the locally prepared hash", async () => {
  const { processOutbox } = await import("../../lib/hackathon/service")
  const id = await seed(); wrongBroadcastHash = true
  const first = await processOutbox(id)
  assert.equal(first?.status, "submitted"); assert.equal(first?.txHash, keccak256(signedFixture))
  assert.match(first?.lastError ?? "", /does not match/); assert.equal(first?.confirmedAt, null)
  await processOutbox(id); assert.equal(broadcasts, 1)
})

test("lease takeover before hash persistence prevents broadcast and stale rollback", async () => {
  const { processOutbox } = await import("../../lib/hackathon/service")
  const { withStore } = await import("../../lib/hackathon/store")
  const id = await seed()
  afterSign = async () => { await withStore(db => {
    const row = db.outbox[id]
    row.processingClaim = { id: "replacement-owner", expiresAt: new Date(Date.now() + 60_000).toISOString() }
    row.lastError = "replacement-owner-state"
  }) }
  const result = await processOutbox(id)
  assert.equal(broadcasts, 0); assert.equal(result?.txHash, null)
  assert.equal(result?.processingClaim?.id, "replacement-owner")
  assert.equal(result?.lastError, "replacement-owner-state"); assert.equal(result?.status, "unknown")
})
