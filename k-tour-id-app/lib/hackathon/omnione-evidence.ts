// Pure receipt/registry binding shared by the app and read-only diagnostics.
import { Interface } from "ethers"

export const OMNIONE_STAGE = Object.freeze({
  chainId: 201210, rpcOrigin: "https://stage-chainapi.omnione.net",
  registry: "0x696bc4e29c8f8079b6d3cd49d310a09577550e4c",
  recorder: "0x003403cb95c2ffd66bc5748738d96c4a5b48b4ba",
  deployTx: "0x1a82867d7608d3f473d2c2c5b4ef2995021a616de7b8d647f22544ea29e333db", deployBlock: "0x1828553",
})
export const OMNIONE_READ_ABI = [
  "function recorders(address) view returns (bool)",
  "function getRedemption(bytes32 eventKey) view returns (bool exists, bytes32 payloadCommitment, uint64 recordedAt, address recorder)",
  "event DemoEntitlementRedeemed(bytes32 indexed eventKey, bytes32 payloadCommitment, uint64 recordedAt, address recorder)",
] as const
export const omnioneReadAbi = new Interface(OMNIONE_READ_ABI)
export type OmnioneExpectation = { txHash: string; registry: string; recorder: string; eventKey: string; payloadCommitment: string; chainId: number }
export type OmnioneRegistryEntry = { exists: boolean; payloadCommitment: string; recordedAt: bigint; recorder: string }
export class OmnioneEvidenceError extends Error { constructor(readonly code: string) { super(code) } }
export const evidenceFail = (code: string): never => { throw new OmnioneEvidenceError(code) }
export const sameHex = (a: unknown, b: string) => typeof a === "string" && a.toLowerCase() === b.toLowerCase()
export const nonzeroHex32 = (value: unknown): value is string => typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value) && !/^0x0+$/i.test(value)
const address = (value: unknown): value is string => typeof value === "string" && /^0x[0-9a-f]{40}$/i.test(value) && !/^0x0+$/i.test(value)
export const rpcQuantity = (value: unknown) => typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i.test(value) ? BigInt(value) : null
export function evidenceObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return evidenceFail("rpc_response_invalid")
  return value as Record<string, unknown>
}
export function validateOmnioneExpectation(e: OmnioneExpectation) {
  if (![e.txHash, e.eventKey, e.payloadCommitment].every(nonzeroHex32) || !address(e.registry) || !address(e.recorder) || !Number.isSafeInteger(e.chainId) || e.chainId <= 0) evidenceFail("evidence_configuration_invalid")
}
/** Even a failed receipt must belong to the expected transaction and target. */
export function checkedOmnioneReceipt(raw: unknown, e: OmnioneExpectation) {
  validateOmnioneExpectation(e)
  if (raw === null) return evidenceFail("evidence_receipt_pending")
  const rc = evidenceObject(raw)
  const block = rpcQuantity(rc.blockNumber)
  if (!sameHex(rc.transactionHash, e.txHash) || !sameHex(rc.to, e.registry) || !sameHex(rc.from, e.recorder) ||
    !nonzeroHex32(rc.blockHash) || block === null || block <= 0n || block > BigInt(Number.MAX_SAFE_INTEGER) ||
    (rc.status !== "0x0" && rc.status !== "0x1")) evidenceFail("evidence_receipt_mismatch")
  return { receipt: rc, blockNumber: Number(block), blockHash: rc.blockHash as string, failed: rc.status === "0x0" }
}
export function decodeOmnioneResult(name: "recorders" | "getRedemption", raw: unknown) {
  try {
    if (typeof raw !== "string") return evidenceFail("registry_response_invalid")
    const result = omnioneReadAbi.decodeFunctionResult(name, raw)
    if (omnioneReadAbi.encodeFunctionResult(name, result).toLowerCase() !== raw.toLowerCase()) return evidenceFail("registry_response_invalid")
    return result
  } catch { return evidenceFail("registry_response_invalid") }
}
export function verifyOmnioneReceiptEvidence(raw: unknown, entry: OmnioneRegistryEntry, authorizedRecorder: boolean, e: OmnioneExpectation) {
  const checked = checkedOmnioneReceipt(raw, e)
  if (checked.failed) return evidenceFail("evidence_receipt_failed")
  if (authorizedRecorder !== true) return evidenceFail("recorder_not_allowed")
  if (entry.exists !== true || !sameHex(entry.payloadCommitment, e.payloadCommitment) ||
    typeof entry.recordedAt !== "bigint" || entry.recordedAt <= 0n || entry.recordedAt >= 2n ** 64n || !sameHex(entry.recorder, e.recorder)) evidenceFail("redemption_mismatch")
  const expected = omnioneReadAbi.encodeEventLog(omnioneReadAbi.getEvent("DemoEntitlementRedeemed")!, [e.eventKey, e.payloadCommitment, entry.recordedAt, e.recorder])
  if (!Array.isArray(checked.receipt.logs)) return evidenceFail("evidence_event_mismatch")
  const matches = checked.receipt.logs.filter(value => {
    const log = value && typeof value === "object" ? value as Record<string, unknown> : {}
    return sameHex(log.address, e.registry) && log.removed !== true && sameHex(log.data, expected.data) &&
      Array.isArray(log.topics) && log.topics.length === expected.topics.length && log.topics.every((topic, i) => sameHex(topic, expected.topics[i])) &&
      // Receipt membership is mandatory; any explicit per-log location must agree too.
      (log.transactionHash === undefined || sameHex(log.transactionHash, e.txHash)) &&
      (log.blockHash === undefined || sameHex(log.blockHash, checked.blockHash)) &&
      (log.blockNumber === undefined || rpcQuantity(log.blockNumber) === BigInt(checked.blockNumber))
  })
  if (matches.length !== 1) return evidenceFail("evidence_event_mismatch")
  return { blockNumber: checked.blockNumber, blockHash: checked.blockHash }
}
