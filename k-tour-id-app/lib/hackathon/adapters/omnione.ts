// OmniOne Chain adapter — DemoEntitlementRegistry (선택과제 2, +5%).
// One event kind: DemoEntitlementRedeemed(eventKey, payloadCommitment).
// eventKey is a random per-operation 32-byte key; payloadCommitment is a
// sha256 over a de-identified manifest. Nothing personal reaches the chain.
// Confirmation = receipt status 1 AND getRedemption(eventKey) returns the same
// commitment. A tx hash alone is never "confirmed".
import { Contract, JsonRpcProvider, Wallet, getBytes, hexlify, keccak256, zeroPadValue } from "ethers"
import { assertExternalServicesEnabled, hkConfig } from "../config"
import { HkError } from "../util"
import { evidenceFail, nonzeroHex32, validateOmnioneExpectation } from "../omnione-evidence"
import { configuredOmnioneTarget, storedOmnioneTarget, sameOmnioneTarget, type OmnioneTargetSnapshot } from "../omnione-targets"
import { approvedOmnioneRpc, omnioneRpcReader, readOmnioneReceiptEvidence, type OmnioneReceiptResult } from "../omnione-readonly"
import { checkedOmnioneSigningTarget, verifyOmnioneSigningAuthority } from "../omnione-signing-preflight"

const ABI = [
  "function recordRedemption(bytes32 eventKey, bytes32 payloadCommitment)",
  "function getRedemption(bytes32 eventKey) view returns (bool exists, bytes32 payloadCommitment, uint64 recordedAt, address recorder)",
  "function total() view returns (uint256)",
  "function recorders(address) view returns (bool)",
  "event DemoEntitlementRedeemed(bytes32 indexed eventKey, bytes32 payloadCommitment, uint64 recordedAt, address recorder)",
]

let providerSingleton: JsonRpcProvider | null = null
let providerConfig: { rpcUrl: string; chainId: number } | null = null
function provider(target?: OmnioneTargetSnapshot) {
  assertExternalServicesEnabled("OmniOne Chain")
  const c = hkConfig().omnione
  if (!c.rpcUrl) throw new HkError("omnione_unconfigured", "HK_OMNIONE_RPC_URL missing", 503)
  if (!approvedOmnioneRpc(c.rpcUrl)) evidenceFail("rpc_configuration_invalid")
  const chainId = storedOmnioneTarget(target).chainId
  if (providerConfig && (providerConfig.rpcUrl !== c.rpcUrl || providerConfig.chainId !== chainId)) evidenceFail("rpc_configuration_changed")
  if (!providerSingleton) {
    providerSingleton = new JsonRpcProvider(c.rpcUrl, { chainId, name: "omnione-stage" }, { staticNetwork: true })
    providerConfig = { rpcUrl: c.rpcUrl, chainId }
  }
  return providerSingleton
}
function signer(target?: OmnioneTargetSnapshot) {
  assertExternalServicesEnabled("OmniOne Chain signing")
  const c = hkConfig().omnione
  if (!c.privateKey) throw new HkError("omnione_unconfigured", "HK_OMNIONE_PRIVATE_KEY missing", 503)
  if (!sameOmnioneTarget(target, configuredOmnioneTarget(c))) evidenceFail("target_configuration_changed")
  return new Wallet(c.privateKey, provider(target))
}
function registry(withSigner: boolean, target?: OmnioneTargetSnapshot) {
  assertExternalServicesEnabled("OmniOne Chain")
  const t = storedOmnioneTarget(target)
  return new Contract(t.registry, ABI, withSigner ? signer(t) : provider(t))
}
const b32 = (hex: string) => zeroPadValue(getBytes(hex), 32)

export function omnioneConfigured(target?: OmnioneTargetSnapshot, readOnly = false) {
  if (hkConfig().isolatedMock) return false
  const c = hkConfig().omnione
  try {
    storedOmnioneTarget(target)
    if (!c.rpcUrl || !approvedOmnioneRpc(c.rpcUrl)) return false
    if (readOnly) return true // Historical receipts never depend on the current signing key/target.
    const configured = configuredOmnioneTarget(c)
    return Boolean(c.privateKey && (target === undefined || sameOmnioneTarget(target, configured)))
  } catch { return false }
}

/** Persist the signed transaction's identity BEFORE broadcasting. No raw signature is exposed. */
export async function submitRedemption(opts: { eventKeyHex: string; payloadCommitmentHex: string; target?: OmnioneTargetSnapshot; onPrepared?: (txHash: string) => Promise<void> }) {
  // Preserve the isolation contract; a disabled lane is not a retryable RPC failure.
  assertExternalServicesEnabled("OmniOne Chain submission")
  let broadcastStarted = false
  try {
    const c = hkConfig().omnione
    const target = checkedOmnioneSigningTarget(c)
    const snapshot = storedOmnioneTarget(opts.target)
    if (!sameOmnioneTarget(snapshot, configuredOmnioneTarget(c))) evidenceFail("target_configuration_changed")
    if (!nonzeroHex32(opts.eventKeyHex) || !nonzeroHex32(opts.payloadCommitmentHex)) evidenceFail("evidence_configuration_invalid")
    const existing = await getRedemption(opts.eventKeyHex, snapshot)
    if (existing.exists) return { txHash: null as string | null, alreadyRecorded: true, matches: existing.payloadCommitment.toLowerCase() === opts.payloadCommitmentHex.toLowerCase() }
    const wallet = signer(snapshot)
    await verifyOmnioneSigningAuthority(target, wallet.address, omnioneRpcReader(c.rpcUrl, { maxCalls: 3, deadline: Date.now() + 15000 }))
    const request = await registry(false, snapshot).recordRedemption.populateTransaction(b32(opts.eventKeyHex), b32(opts.payloadCommitmentHex), { type: 0, gasPrice: 0n, gasLimit: c.gasLimit })
    const signed = await wallet.signTransaction(await wallet.populateTransaction(request))
    const txHash = keccak256(signed)
    await opts.onPrepared?.(txHash)
    broadcastStarted = true
    const tx = await provider(snapshot).broadcastTransaction(signed)
    if (tx.hash.toLowerCase() !== txHash.toLowerCase()) throw new HkError("omnione_transaction_mismatch", "Broadcast result does not match the prepared transaction", 502)
    return { txHash, alreadyRecorded: false, matches: true }
  } catch (error) {
    // A failed read/sign/persistence step is known not to have broadcast. A
    // transport error after broadcast starts is ambiguous and must be queried.
    if (!broadcastStarted) throw new HkError("omnione_submission_not_started", "OmniOne preparation failed before broadcast; safe to retry preparation", 503)
    throw error
  }
}

export async function getRedemption(eventKeyHex: string, target?: OmnioneTargetSnapshot) {
  const r = await registry(false, target).getRedemption(b32(eventKeyHex))
  return { exists: Boolean(r[0]), payloadCommitment: hexlify(r[1]) as string, recordedAt: Number(r[2]), recorder: String(r[3]) }
}

export async function receiptStatus(txHash: string, binding: { eventKey: string; payloadCommitment: string; target?: OmnioneTargetSnapshot }): Promise<OmnioneReceiptResult> {
  assertExternalServicesEnabled("OmniOne Chain evidence")
  const c = hkConfig().omnione
  try {
    const target = storedOmnioneTarget(binding.target)
    const expected = { ...binding, txHash, registry: target.registry, recorder: target.recorder, chainId: target.chainId }
    validateOmnioneExpectation(expected)
    if (!c.rpcUrl) throw new Error("configuration")
    const url = new URL(c.rpcUrl)
    if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error("configuration")
    return await readOmnioneReceiptEvidence(omnioneRpcReader(c.rpcUrl, { maxCalls: 4, deadline: Date.now() + 20000 }), expected)
  } catch {
    // No SDK/RPC URL, credential or response body reaches the outbox/API.
    throw new HkError("omnione_evidence_unavailable", "OmniOne receipt evidence is unavailable; check again without resubmitting.", 503, true)
  }
}

export function explorerHint(txHash: string) {
  return `OmniOne Chain(stage) chainId ${hkConfig().omnione.chainId} · tx ${txHash}`
}
