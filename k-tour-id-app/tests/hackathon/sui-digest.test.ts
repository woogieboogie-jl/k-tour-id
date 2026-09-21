import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { Transaction } from "@mysten/sui/transactions"
import { fromBase64, toBase64 } from "@mysten/sui/utils"
import { sha256Hex } from "../../lib/hackathon/util"

// These object references are synthetic. No client, keys, signing or broadcast
// is used: every input needed for BCS serialization is supplied explicitly.
function preparedTransaction(sender = "0x1") {
  const tx = new Transaction()
  tx.setSender(sender)
  tx.setGasOwner("0x2")
  tx.setGasBudget(1_000_000)
  tx.setGasPrice(1_000)
  tx.setGasPayment([{ objectId: "0x3", version: "1", digest: "11111111111111111111111111111111" }])
  return tx
}

const originalFetch = globalThis.fetch
const attemptedNetwork: string[] = []
let transactionDigest: typeof import("../../lib/hackathon/adapters/sui").transactionDigest

before(async () => {
  globalThis.fetch = async (input) => {
    attemptedNetwork.push(String(input))
    throw new Error("Network is forbidden in pure transaction digest tests")
  }
  // Import the adapter only after the guard is installed.
  ;({ transactionDigest } = await import("../../lib/hackathon/adapters/sui"))
})

after(() => {
  globalThis.fetch = originalFetch
  assert.deepEqual(attemptedNetwork, [], "digest computation attempted an external request")
})

test("full built bytes yield the Sui digest synchronously before any broadcast", async () => {
  const tx = preparedTransaction()
  assert.equal(tx.isFullyResolved(), true)
  const bytes = await tx.build()
  const digest = transactionDigest(bytes)
  assert.equal(typeof digest, "string")
  assert.equal(digest, "5pYLfna4i5b6sWToNsR7SjrQHpXhZM6Q2XyreUWJ6jfM")
  assert.equal(digest, await Transaction.from(bytes).getDigest())
  assert.match(digest, /^[1-9A-HJ-NP-Za-km-z]+$/)
})

test("digest is stable across repeated calls, copied bytes and persisted base64", async () => {
  const bytes = await preparedTransaction().build()
  const original = Uint8Array.from(bytes)
  const digest = transactionDigest(bytes)
  assert.equal(transactionDigest(bytes), digest)
  assert.equal(transactionDigest(Uint8Array.from(bytes)), digest)
  assert.equal(transactionDigest(fromBase64(toBase64(bytes))), digest)
  assert.deepEqual(bytes, original, "digest calculation must not mutate signed transaction bytes")
})

test("on-chain digest is distinct from the application's SHA-256 byte fingerprint", async () => {
  const bytes = await preparedTransaction().build()
  assert.notEqual(transactionDigest(bytes), sha256Hex(bytes))
  assert.match(sha256Hex(bytes), /^0x[0-9a-f]{64}$/)
  assert.equal(transactionDigest(bytes), await Transaction.from(bytes).getDigest())
})

test("user and agent prepared transaction bytes use the same local digest algorithm", async () => {
  const userBytes = await preparedTransaction("0x1").build()
  const agentBytes = await preparedTransaction("0x4").build()
  for (const bytes of [userBytes, agentBytes]) {
    assert.equal(transactionDigest(bytes), await Transaction.from(bytes).getDigest())
  }
  assert.notEqual(transactionDigest(userBytes), transactionDigest(agentBytes), "sender is part of the signed transaction data")
})

test("changes to gas budget, gas owner or object version change the prepared digest", async () => {
  const bytes = await preparedTransaction().build()
  const originalDigest = transactionDigest(bytes)
  for (const mutate of [
    (tx: Transaction) => tx.setGasBudget(1_000_001),
    (tx: Transaction) => tx.setGasOwner("0x5"),
    (tx: Transaction) => tx.setGasPayment([{ objectId: "0x3", version: "2", digest: "11111111111111111111111111111111" }]),
  ]) {
    const changed = Transaction.from(bytes)
    mutate(changed)
    const changedBytes = await changed.build()
    assert.notEqual(transactionDigest(changedBytes), originalDigest)
    assert.equal(transactionDigest(changedBytes), await Transaction.from(changedBytes).getDigest())
  }
})
