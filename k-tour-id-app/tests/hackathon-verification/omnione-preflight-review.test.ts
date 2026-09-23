// Independent outbox review: real service AND OmniOne adapter, inert ethers I/O.
// No authentication, real keys, signing, RPC or transaction submission occurs.
import assert from "node:assert/strict"
import { after, before, beforeEach, mock, test } from "node:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import http from "node:http"
import https from "node:https"
import { Interface, Transaction, getBytes, hexlify, keccak256, zeroPadValue } from "ethers"
import { HkError } from "../../lib/hackathon/util"

const directory = mkdtempSync(join(tmpdir(), "omnione-preflight-review-"))
const commitment = "0x" + "2".repeat(64), eventKey = "0x" + "4".repeat(64)
const registryAddress = "0x" + "3".repeat(40)
const abi = new Interface(["function recordRedemption(bytes32 eventKey, bytes32 payloadCommitment)"])
const env = {
  HK_ISOLATED_MOCK: "0", HK_DATA_DIR: directory,
  HK_OMNIONE_RPC_URL: "https://chain.invalid", HK_OMNIONE_PRIVATE_KEY: "fixture-never-used",
  HK_OMNIONE_REGISTRY_ADDRESS: registryAddress, HK_OMNIONE_CHAIN_ID: "201210", HK_OMNIONE_GAS_LIMIT: "300000",
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

mock.module("ethers", { namedExports: {
  getBytes, hexlify, keccak256, zeroPadValue,
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
    async populateTransaction(request: Record<string, unknown>) {
      if (populateFailure) throw new Error("fixture populate failure")
      populated = { ...request, nonce: 7, chainId: 201210 }
      return populated
    }
    async signTransaction(request: Record<string, unknown>) {
      if (signFailure) throw new Error("fixture signing failure")
      // Assemble fixed RLP with an intentionally synthetic signature; no key
      // or cryptographic signer is used. Real ethers serialization/hash only.
      signedFixture = Transaction.from({ ...request, signature: { r: "0x" + "1".repeat(64), s: "0x" + "2".repeat(64), v: 27 } }).serialized
      await afterSign?.()
      return signedFixture
    }
  },
  Contract: class {
    async getRedemption() {
      registryReads++
      if (registryReads === failedRegistryRead) throw new Error("fixture: registry read failed before signing")
      return [registryExists, commitment, 0, "fixture-recorder"]
    }
    recordRedemption = { populateTransaction: async (key: string, payload: string, overrides: Record<string, unknown>) => {
      assert.equal(key, eventKey); assert.equal(payload, commitment)
      return { to: registryAddress, data: abi.encodeFunctionData("recordRedemption", [key, payload]), ...overrides }
    } }
  },
} })

before(() => {
  Object.assign(process.env, env)
  const forbidden = () => { networkAttempts++; throw new Error("network forbidden in preflight review") }
  globalThis.fetch = async () => forbidden()
  mock.method(http, "request", forbidden); mock.method(https, "request", forbidden)
})
beforeEach(() => {
  registryReads = 0; signerConstructions = 0; broadcasts = 0; failedRegistryRead = 0
  populateFailure = false; signFailure = false; broadcastFailure = false; wrongBroadcastHash = false
  registryExists = false; receipt = null; populated = null; signedFixture = ""; afterSign = null; onBroadcast = null
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

async function seed() {
  const { withStore } = await import("../../lib/hackathon/store")
  const id = `fixture-outbox-${++sequence}`
  const now = new Date().toISOString()
  await withStore(db => {
    db.outbox[id] = {
      outboxId: id, operationId: "fixture-operation", eventKey,
      payloadCommitment: commitment, payload: {}, status: "pending", txHash: null, blockNumber: null,
      attempts: 0, lastError: null, createdAt: now, updatedAt: now, confirmedAt: null,
    }
  })
  return id
}

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
