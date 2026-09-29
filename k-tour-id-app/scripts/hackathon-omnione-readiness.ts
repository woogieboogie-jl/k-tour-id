// Standalone, read-only readiness. Never imports app configuration or a signer.
import { Interface, keccak256 } from "ethers"
import { fileURLToPath } from "node:url"
import { OMNIONE_STAGE, OMNIONE_READ_ABI, OmnioneEvidenceError, verifyOmnioneReceiptEvidence } from "../lib/hackathon/omnione-evidence"
export { OMNIONE_STAGE }
import { omnioneTarget, type OmnioneTarget } from "../lib/hackathon/omnione-targets"

// Public deployment metadata: chain/omnione/deploy-info.stage.json.
export const READINESS_ABI = OMNIONE_READ_ABI
const abi = new Interface(READINESS_ABI)
const hex32 = (value: unknown): value is string => typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value) && !/^0x0+$/i.test(value)
const same = (a: unknown, b: string) => typeof a === "string" && a.toLowerCase() === b.toLowerCase()
const quantity = (value: unknown) => typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i.test(value) ? BigInt(value) : null
type Env = Record<string, string | undefined>
type Evidence = { txHash: string; eventKey: string; payloadCommitment: string }
type Options = { mode?: "offline" | "read-only"; env?: Env; fetchImpl?: typeof fetch; timeoutMs?: number }
type EvidenceState = "not_requested" | "unverified" | "pending" | "failed" | "confirmed"
class ProbeError extends Error {
  constructor(readonly code: string) { super(code) }
}
const fail = (code: string): never => { throw new ProbeError(code) }

function approvedRpc(raw: string) {
  try {
    const url = new URL(raw)
    const token = url.searchParams.get("token") ?? ""
    return raw.length <= 8192 && url.origin === OMNIONE_STAGE.rpcOrigin && url.pathname === "/" &&
      !url.username && !url.password && !url.hash && [...url.searchParams.keys()].join(",") === "token" &&
      token.length > 0 && token.length <= 4096 && !/[<>\s\x00-\x1f\x7f]/.test(token) && token !== "API_KEY"
  } catch { return false }
}

/** Only these explicit keys are read. In particular, no private-key value or presence is inspected. */
function configuration(env: Env) {
  let target: OmnioneTarget | null = null
  try { target = omnioneTarget(env.HK_OMNIONE_TARGET_ID) } catch { /* Public invalid selection, not an arbitrary RPC target. */ }
  const rpc = env.HK_OMNIONE_RPC_URL ?? ""
  const chainId = env.HK_OMNIONE_CHAIN_ID || String(OMNIONE_STAGE.chainId)
  const registry = env.HK_OMNIONE_REGISTRY_ADDRESS ?? ""
  const recorder = env.HK_OMNIONE_RECORDER_ADDRESS
  const parts = [env.HK_OMNIONE_READINESS_TX_HASH, env.HK_OMNIONE_READINESS_EVENT_KEY, env.HK_OMNIONE_READINESS_PAYLOAD_COMMITMENT]
  const evidenceRequested = parts.some(value => value !== undefined)
  const evidenceValid = !evidenceRequested || parts.every(hex32)
  const evidence = evidenceRequested && evidenceValid ? { txHash: parts[0]!, eventKey: parts[1]!, payloadCommitment: parts[2]! } : undefined
  return { rpc, evidence, target, metadata: {
    targetApproved: !!target,
    rpcConfigured: Boolean(rpc), rpcApproved: approvedRpc(rpc),
    chainIdApproved: !!target && chainId === String(target.chainId), registryApproved: !!target && same(registry, target.registry),
    recorderApproved: !!target && (!recorder || same(recorder, target.recorder)),
    evidenceRequested, evidenceValid,
  } }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("rpc_response_invalid")
  return value as Record<string, unknown>
}

/** Six calls at most; each fetch AND response body are bounded. No retries or polling. */
function rpcReader(url: string, fetchImpl: typeof fetch, timeoutMs: number) {
  let requests = 0
  const deadline = Date.now() + 25000
  return {
    count: () => requests,
    async call(method: "eth_chainId" | "eth_getCode" | "eth_call" | "eth_getTransactionReceipt", params: unknown[]) {
      const remaining = deadline - Date.now()
      if (remaining <= 0 || requests >= 6) return fail("rpc_deadline")
      const id = ++requests
      const controller = new AbortController()
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
      let timer: ReturnType<typeof setTimeout> | undefined
      const work = async () => {
        const response = await fetchImpl(url, {
          method: "POST", redirect: "error", cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer",
          signal: controller.signal, headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        })
        if (controller.signal.aborted) { void response.body?.cancel().catch(() => undefined); return fail("rpc_timeout") }
        reader = response.body?.getReader()
        if (response.status === 401 || response.status === 403) return fail("rpc_auth_rejected")
        if (response.status >= 300 && response.status < 400) return fail("rpc_redirect_rejected")
        if (!response.ok) return fail("rpc_http_error")
        const length = response.headers.get("content-length")
        if (length && (!/^\d+$/.test(length) || Number(length) > 262144)) return fail("rpc_response_too_large")
        if (!reader) return fail("rpc_response_invalid")
        const chunks: Uint8Array[] = []
        let size = 0
        for (;;) {
          const chunk = await reader.read()
          if (chunk.done) break
          size += chunk.value.byteLength
          if (size > 262144) return fail("rpc_response_too_large")
          chunks.push(chunk.value)
        }
        let parsed: Record<string, unknown>
        try { parsed = object(JSON.parse(Buffer.concat(chunks).toString("utf8"))) }
        catch { return fail("rpc_response_invalid") }
        if (parsed.jsonrpc !== "2.0" || parsed.id !== id || !("result" in parsed) || "error" in parsed) return fail("rpc_response_invalid")
        return parsed.result
      }
      try {
        return await Promise.race([work(), new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new ProbeError("rpc_timeout")), Math.min(timeoutMs, remaining))
        })])
      } catch (error) {
        if (error instanceof ProbeError) throw error
        return fail("rpc_transport_failed") // Never surface fetch/RPC errors containing query tokens.
      } finally {
        clearTimeout(timer)
        controller.abort()
        if (reader) { void reader.cancel().catch(() => undefined); try { reader.releaseLock() } catch { /* pending read */ } }
      }
    },
  }
}

function receipt(value: unknown, expectedTx: string, deployment: boolean, target: OmnioneTarget) {
  const prefix = deployment ? "deployment_receipt" : "evidence_receipt"
  if (value === null) return fail(`${prefix}_pending`)
  const result = object(value)
  if (result.status === "0x0") return fail(`${prefix}_failed`)
  if (result.status !== "0x1" || !same(result.transactionHash, expectedTx) || !hex32(result.blockHash) ||
    (quantity(result.blockNumber) ?? 0n) <= 0n) return fail(`${prefix}_mismatch`)
  if (deployment) {
    if (result.to !== null || !same(result.contractAddress, target.registry) || !same(result.from, target.recorder) ||
      quantity(result.blockNumber) !== BigInt(target.deployBlock)) return fail(`${prefix}_mismatch`)
  } else if (!same(result.to, target.registry) || !same(result.from, target.recorder)) return fail(`${prefix}_mismatch`)
  return result
}

function decode(name: "recorders" | "getRedemption", raw: unknown) {
  try {
    if (typeof raw !== "string") return fail("registry_response_invalid")
    const result = abi.decodeFunctionResult(name, raw)
    if (abi.encodeFunctionResult(name, result).toLowerCase() !== raw.toLowerCase()) return fail("registry_response_invalid")
    return result
  } catch { return fail("registry_response_invalid") }
}

export async function runOmnioneReadiness(options: Options = {}) {
  const mode = options.mode ?? "offline"
  const config = configuration(options.env ?? process.env)
  const target = config.target
  const checks: string[] = []
  const issues: string[] = []
  let evidenceState: EvidenceState = config.metadata.evidenceRequested ? "unverified" : "not_requested"
  const timeout = Number.isFinite(options.timeoutMs) ? Math.max(1, Math.min(5000, options.timeoutMs!)) : 5000
  const rpc = rpcReader(config.rpc, options.fetchImpl ?? fetch, timeout)
  if (!config.metadata.rpcApproved) issues.push("rpc_configuration_invalid")
  if (!config.metadata.targetApproved) issues.push("target_not_registered")
  if (!config.metadata.chainIdApproved) issues.push("chain_configuration_mismatch")
  if (!config.metadata.registryApproved) issues.push("registry_configuration_mismatch")
  if (!config.metadata.recorderApproved) issues.push("recorder_configuration_mismatch")
  if (!config.metadata.evidenceValid) issues.push("evidence_configuration_invalid")
  if (mode !== "offline" && mode !== "read-only") issues.push("mode_invalid")
  if (!issues.length && mode === "read-only" && target) {
    try {
      if (quantity(await rpc.call("eth_chainId", [])) !== BigInt(target.chainId)) fail("chain_id_mismatch")
      checks.push("chain_id")
      const code = await rpc.call("eth_getCode", [target.registry, "latest"])
      if (typeof code !== "string" || !/^0x(?:[0-9a-f]{2})+$/i.test(code) || /^0x0+$/i.test(code)) fail("registry_code_empty_or_invalid")
      if (target.runtimeCodeHash && !same(keccak256(code as string), target.runtimeCodeHash)) fail("registry_code_mismatch")
      checks.push("registry_code_present")
      const allowed = decode("recorders", await rpc.call("eth_call", [{ to: target.registry, data: abi.encodeFunctionData("recorders", [target.recorder]) }, "latest"]))
      if (allowed[0] !== true) fail("recorder_not_allowed")
      checks.push("recorder_allowed")
      receipt(await rpc.call("eth_getTransactionReceipt", [target.deployTx]), target.deployTx, true, target)
      checks.push("deployment_receipt")
      if (config.evidence) {
        const rc = receipt(await rpc.call("eth_getTransactionReceipt", [config.evidence.txHash]), config.evidence.txHash, false, target)
        checks.push("evidence_receipt")
        const entry = decode("getRedemption", await rpc.call("eth_call", [{ to: target.registry, data: abi.encodeFunctionData("getRedemption", [config.evidence.eventKey]) }, "latest"]))
        if (entry[0] !== true || !same(entry[1], config.evidence.payloadCommitment) || entry[2] <= 0n || !same(entry[3], target.recorder)) fail("redemption_mismatch")
        checks.push("redemption_matches")
        verifyOmnioneReceiptEvidence(rc, { exists: entry[0], payloadCommitment: entry[1], recordedAt: entry[2], recorder: entry[3] }, true, { ...config.evidence, registry: target.registry, recorder: target.recorder, chainId: target.chainId })
        checks.push("evidence_event_matches")
        evidenceState = "confirmed"
      }
    } catch (error) {
      const code = error instanceof ProbeError || error instanceof OmnioneEvidenceError ? error.code : "readiness_failed"
      issues.push(code)
      if (code === "evidence_receipt_pending") evidenceState = "pending"
      if (code === "evidence_receipt_failed") evidenceState = "failed"
    }
  }
  return {
    ok: issues.length === 0, mode, target, configuration: config.metadata,
    rpcRequests: rpc.count(), checks, issues, evidence: evidenceState, newTransactions: 0,
    limitation: "Offline means configuration only. Read-only checks do not prove new signing, broadcast, finality, or a new CX/Sui/OmniOne end-to-end journey.",
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.length > 1 || (args.length === 1 && args[0] !== "--read-only")) {
    process.stdout.write(`${JSON.stringify({ ok: false, issues: ["arguments_invalid"], newTransactions: 0 })}\n`)
    process.exitCode = 1
  } else {
    // No dotenv, SDK provider, key loading, env mutation, or files containing reports.
    const result = await runOmnioneReadiness({ mode: args.length ? "read-only" : "offline" })
    process.stdout.write(`${JSON.stringify(result)}\n`)
    process.exitCode = result.ok ? 0 : 1
  }
}
