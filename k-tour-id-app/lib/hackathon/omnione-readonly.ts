// Read RPC only: never imports configuration, Wallet, app service, or signing keys.
import { checkedOmnioneReceipt, decodeOmnioneResult, evidenceFail, evidenceObject, OmnioneEvidenceError, omnioneReadAbi, OMNIONE_STAGE, rpcQuantity, validateOmnioneExpectation, verifyOmnioneReceiptEvidence, type OmnioneExpectation } from "./omnione-evidence"

export function approvedOmnioneRpc(raw: string) {
  try {
    const url = new URL(raw), token = url.searchParams.get("token") ?? ""
    return raw.length <= 8192 && url.origin === OMNIONE_STAGE.rpcOrigin && url.pathname === "/" &&
      !url.username && !url.password && !url.hash && [...url.searchParams.keys()].join(",") === "token" &&
      token.length > 0 && token.length <= 4096 && !/[<>\s\x00-\x1f\x7f]/.test(token) && token !== "API_KEY"
  } catch { return false }
}
type Method = "eth_chainId" | "eth_getCode" | "eth_call" | "eth_getTransactionReceipt"
export function omnioneRpcReader(url: string, options: { fetchImpl?: typeof fetch; timeoutMs?: number; deadline?: number; maxCalls?: number } = {}) {
  let requests = 0
  const deadline = Math.min(options.deadline ?? Infinity, Date.now() + 25000)
  const maxCalls = Math.max(1, Math.min(16, options.maxCalls ?? 6))
  return {
    count: () => requests,
    async call(method: Method, params: unknown[]): Promise<unknown> {
      if (!["eth_chainId", "eth_getCode", "eth_call", "eth_getTransactionReceipt"].includes(method)) return evidenceFail("rpc_method_forbidden")
      const remaining = deadline - Date.now()
      if (remaining <= 0 || requests >= maxCalls) return evidenceFail("rpc_deadline")
      const id = ++requests, controller = new AbortController()
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, timer: ReturnType<typeof setTimeout> | undefined
      const work = async () => {
        const response = await (options.fetchImpl ?? fetch)(url, {
          method: "POST", redirect: "error", cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer",
          signal: controller.signal, headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        })
        if (controller.signal.aborted) { void response.body?.cancel().catch(() => undefined); return evidenceFail("rpc_timeout") }
        reader = response.body?.getReader()
        if (response.status === 401 || response.status === 403) return evidenceFail("rpc_auth_rejected")
        if (response.status >= 300 && response.status < 400) return evidenceFail("rpc_redirect_rejected")
        if (!response.ok) return evidenceFail("rpc_http_error")
        const length = response.headers.get("content-length")
        if (length && (!/^\d+$/.test(length) || Number(length) > 262144)) return evidenceFail("rpc_response_too_large")
        if (!reader) return evidenceFail("rpc_response_invalid")
        const chunks: Uint8Array[] = []; let size = 0
        for (;;) {
          const chunk = await reader.read()
          if (chunk.done) break
          size += chunk.value.byteLength
          if (size > 262144) return evidenceFail("rpc_response_too_large")
          chunks.push(chunk.value)
        }
        let parsed: Record<string, unknown>
        try { parsed = evidenceObject(JSON.parse(Buffer.concat(chunks).toString("utf8"))) } catch { return evidenceFail("rpc_response_invalid") }
        if (parsed.jsonrpc !== "2.0" || parsed.id !== id || !Object.hasOwn(parsed, "result") || Object.hasOwn(parsed, "error")) return evidenceFail("rpc_response_invalid")
        return parsed.result
      }
      try {
        return await Promise.race([work(), new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new OmnioneEvidenceError("rpc_timeout")), Math.max(1, Math.min(5000, options.timeoutMs ?? 5000, remaining)))
        })])
      } catch (error) {
        if (error instanceof OmnioneEvidenceError) throw error
        return evidenceFail("rpc_transport_failed")
      } finally {
        clearTimeout(timer); controller.abort()
        if (reader) { void reader.cancel().catch(() => undefined); try { reader.releaseLock() } catch { /* pending read */ } }
      }
    },
  }
}
export type OmnioneRpcReader = Pick<ReturnType<typeof omnioneRpcReader>, "call">
export type OmnioneReceiptResult = { status: "pending" | "confirmed" | "failed" | "mismatch"; blockNumber: number | null; code?: string }
/** Check-only: successful confirmation requires all four reads and the shared verifier. */
export async function readOmnioneReceiptEvidence(rpc: OmnioneRpcReader, expected: OmnioneExpectation): Promise<OmnioneReceiptResult> {
  try {
    validateOmnioneExpectation(expected)
    if (rpcQuantity(await rpc.call("eth_chainId", [])) !== BigInt(expected.chainId)) evidenceFail("chain_id_mismatch")
    const raw = await rpc.call("eth_getTransactionReceipt", [expected.txHash])
    const rc = checkedOmnioneReceipt(raw, expected)
    if (rc.failed) return { status: "failed", blockNumber: rc.blockNumber, code: "receipt_status_0" }
    const allowed = decodeOmnioneResult("recorders", await rpc.call("eth_call", [{ to: expected.registry, data: omnioneReadAbi.encodeFunctionData("recorders", [expected.recorder]) }, "latest"]))
    if (allowed[0] !== true) evidenceFail("recorder_not_allowed")
    const entry = decodeOmnioneResult("getRedemption", await rpc.call("eth_call", [{ to: expected.registry, data: omnioneReadAbi.encodeFunctionData("getRedemption", [expected.eventKey]) }, "latest"]))
    const verified = verifyOmnioneReceiptEvidence(raw, { exists: entry[0], payloadCommitment: entry[1], recordedAt: entry[2], recorder: entry[3] }, true, expected)
    return { status: "confirmed", blockNumber: verified.blockNumber }
  } catch (error) {
    if (error instanceof OmnioneEvidenceError && error.code === "evidence_receipt_pending") return { status: "pending", blockNumber: null }
    if (error instanceof OmnioneEvidenceError && ["chain_id_mismatch", "recorder_not_allowed", "redemption_mismatch", "evidence_receipt_mismatch", "evidence_event_mismatch"].includes(error.code)) return { status: "mismatch", blockNumber: null, code: error.code }
    throw error
  }
}
