// OmniOne Chain adapter — DemoEntitlementRegistry (선택과제 2, +5%).
// One event kind: DemoEntitlementRedeemed(eventKey, payloadCommitment).
// eventKey is a random per-operation 32-byte key; payloadCommitment is a
// sha256 over a de-identified manifest. Nothing personal reaches the chain.
// Confirmation = receipt status 1 AND getRedemption(eventKey) returns the same
// commitment. A tx hash alone is never "confirmed".
import { Contract, JsonRpcProvider, Wallet, getBytes, hexlify, keccak256, zeroPadValue } from "ethers"
import { assertExternalServicesEnabled, hkConfig } from "../config"
import { HkError } from "../util"

const ABI = [
  "function recordRedemption(bytes32 eventKey, bytes32 payloadCommitment)",
  "function getRedemption(bytes32 eventKey) view returns (bool exists, bytes32 payloadCommitment, uint64 recordedAt, address recorder)",
  "function total() view returns (uint256)",
  "function recorders(address) view returns (bool)",
  "event DemoEntitlementRedeemed(bytes32 indexed eventKey, bytes32 payloadCommitment, uint64 recordedAt, address recorder)",
]

let providerSingleton: JsonRpcProvider | null = null
function provider() {
  assertExternalServicesEnabled("OmniOne Chain")
  const c = hkConfig().omnione
  if (!c.rpcUrl) throw new HkError("omnione_unconfigured", "HK_OMNIONE_RPC_URL missing", 503)
  if (!providerSingleton) providerSingleton = new JsonRpcProvider(c.rpcUrl, { chainId: c.chainId, name: "omnione-stage" }, { staticNetwork: true })
  return providerSingleton
}
function signer() {
  assertExternalServicesEnabled("OmniOne Chain signing")
  const c = hkConfig().omnione
  if (!c.privateKey) throw new HkError("omnione_unconfigured", "HK_OMNIONE_PRIVATE_KEY missing", 503)
  return new Wallet(c.privateKey, provider())
}
function registry(withSigner: boolean) {
  assertExternalServicesEnabled("OmniOne Chain")
  const c = hkConfig().omnione
  if (!c.registryAddress) throw new HkError("omnione_unconfigured", "HK_OMNIONE_REGISTRY_ADDRESS missing", 503)
  return new Contract(c.registryAddress, ABI, withSigner ? signer() : provider())
}
const b32 = (hex: string) => zeroPadValue(getBytes(hex), 32)

export function omnioneConfigured() {
  if (hkConfig().isolatedMock) return false
  const c = hkConfig().omnione
  return Boolean(c.rpcUrl && c.privateKey && c.registryAddress)
}

/** Persist the signed transaction's identity BEFORE broadcasting. No raw signature is exposed. */
export async function submitRedemption(opts: { eventKeyHex: string; payloadCommitmentHex: string; onPrepared?: (txHash: string) => Promise<void> }) {
  // Preserve the isolation contract; a disabled lane is not a retryable RPC failure.
  assertExternalServicesEnabled("OmniOne Chain submission")
  let broadcastStarted = false
  try {
    const c = hkConfig().omnione
    const existing = await getRedemption(opts.eventKeyHex)
    if (existing.exists) return { txHash: null as string | null, alreadyRecorded: true, matches: existing.payloadCommitment.toLowerCase() === opts.payloadCommitmentHex.toLowerCase() }
    const wallet = signer()
    const request = await registry(false).recordRedemption.populateTransaction(b32(opts.eventKeyHex), b32(opts.payloadCommitmentHex), { type: 0, gasPrice: 0n, gasLimit: c.gasLimit })
    const signed = await wallet.signTransaction(await wallet.populateTransaction(request))
    const txHash = keccak256(signed)
    await opts.onPrepared?.(txHash)
    broadcastStarted = true
    const tx = await provider().broadcastTransaction(signed)
    if (tx.hash.toLowerCase() !== txHash.toLowerCase()) throw new HkError("omnione_transaction_mismatch", "Broadcast result does not match the prepared transaction", 502)
    return { txHash, alreadyRecorded: false, matches: true }
  } catch (error) {
    // A failed read/sign/persistence step is known not to have broadcast. A
    // transport error after broadcast starts is ambiguous and must be queried.
    if (!broadcastStarted) throw new HkError("omnione_submission_not_started", "OmniOne preparation failed before broadcast; safe to retry preparation", 503)
    throw error
  }
}

export async function getRedemption(eventKeyHex: string) {
  const r = await registry(false).getRedemption(b32(eventKeyHex))
  return { exists: Boolean(r[0]), payloadCommitment: hexlify(r[1]) as string, recordedAt: Number(r[2]), recorder: String(r[3]) }
}

export async function receiptStatus(txHash: string): Promise<{ status: "pending" | "confirmed" | "failed"; blockNumber: number | null }> {
  const rc = await provider().getTransactionReceipt(txHash)
  if (!rc) return { status: "pending", blockNumber: null }
  return { status: rc.status === 1 ? "confirmed" : "failed", blockNumber: rc.blockNumber }
}

export function explorerHint(txHash: string) {
  return `OmniOne Chain(stage) chainId ${hkConfig().omnione.chainId} · tx ${txHash}`
}
