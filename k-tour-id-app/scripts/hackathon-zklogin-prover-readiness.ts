// Standalone health probe, not a proof-generation or activation command.
// No app config, JWT, salt, signer, API key, account, or provider mutation is read.
import { fileURLToPath } from "node:url"

type Env = { HK_SUI_NETWORK?: string; HK_ZKLOGIN_PROVER_URL?: string }
type Options = { mode?: "offline" | "read-only"; env?: Env; fetchImpl?: typeof fetch; timeoutMs?: number }
const TARGETS = {
  testnet: { proofUrl: "https://prover.mystenlabs.com/v1", healthUrl: "https://prover.mystenlabs.com/ping", label: "mysten-public" },
  devnet: { proofUrl: "https://prover-dev.mystenlabs.com/v1", healthUrl: "https://prover-dev.mystenlabs.com/ping", label: "mysten-devnet" },
} as const
class ProbeError extends Error { constructor(readonly code: string) { super(code) } }
const fail = (code: string): never => { throw new ProbeError(code) }

function readConfiguration(input: Env) {
  try {
    if (!input || typeof input !== "object" || Array.isArray(input)) return fail("configuration_invalid")
    const values: Env = {}
    for (const name of ["HK_SUI_NETWORK", "HK_ZKLOGIN_PROVER_URL"] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(input, name)
      if (!descriptor) continue
      if (!("value" in descriptor) || (descriptor.value !== undefined &&
        (typeof descriptor.value !== "string" || descriptor.value.length > 2048))) return fail("configuration_invalid")
      values[name] = descriptor.value
    }
    const network = values.HK_SUI_NETWORK === undefined ? "testnet" : values.HK_SUI_NETWORK
    const target = network === "testnet" || network === "devnet" ? TARGETS[network] : null
    const configured = Boolean(values.HK_ZKLOGIN_PROVER_URL)
    return { network: target ? network as "testnet" | "devnet" : null, configured,
      target: target && values.HK_ZKLOGIN_PROVER_URL === target.proofUrl ? target : null }
  } catch { return fail("configuration_invalid") }
}

/** Exactly one allowlisted GET; no redirects, retries, credentials, or proof POST.
 * /ping only proves reachability. It cannot attest a proving key, OAuth audience
 * acceptance, callback registration, salt continuity, or a valid Sui signature.
 * Custom/self-hosted providers require their own reviewed health contract.
 */
export async function runZkLoginProverReadiness(options: Options = {}) {
  const mode = options.mode ?? "offline"
  const issues: string[] = []
  let network: "testnet" | "devnet" | null = null
  let explicitProverConfigured = false
  let target: (typeof TARGETS)[keyof typeof TARGETS] | null = null
  let health: "not_requested" | "reachable" | "failed" = "not_requested"
  let networkCalls = 0
  try {
    const config = readConfiguration(options.env ?? {})
    network = config.network
    explicitProverConfigured = config.configured
    target = config.target
    if (!network) issues.push("network_not_supported_by_probe")
    if (!explicitProverConfigured) issues.push("explicit_prover_missing")
    else if (!target) issues.push("prover_health_contract_unreviewed")
  } catch { issues.push("configuration_invalid") }
  if (mode !== "offline" && mode !== "read-only") issues.push("mode_invalid")

  if (!issues.length && mode === "read-only" && target) {
    const url = target.healthUrl
    const controller = new AbortController()
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(1, Math.min(5000, options.timeoutMs!)) : 5000
    const work = async () => {
      networkCalls++
      const response = await (options.fetchImpl ?? fetch)(url, {
        method: "GET", redirect: "error", cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", signal: controller.signal,
        headers: { accept: "text/plain" },
      })
      if (controller.signal.aborted) { void response.body?.cancel().catch(() => undefined); return fail("prover_health_timeout") }
      reader = response.body?.getReader()
      if (response.status >= 300 && response.status < 400) return fail("prover_health_redirect_rejected")
      if (response.url && response.url !== url) return fail("prover_health_redirect_rejected")
      if (response.status === 401 || response.status === 403) return fail("prover_health_auth_rejected")
      if (!response.ok) return fail("prover_health_http_error")
      const length = response.headers.get("content-length")
      if (length && (!/^\d+$/.test(length) || Number(length) > 64)) return fail("prover_health_response_too_large")
      if (!reader) return fail("prover_health_response_invalid")
      const chunks: Uint8Array[] = []
      let size = 0
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) break
        size += chunk.value.byteLength
        if (size > 64) return fail("prover_health_response_too_large")
        chunks.push(chunk.value)
      }
      let body: string
      try { body = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)).trim() }
      catch { return fail("prover_health_response_invalid") }
      if (body !== "pong") return fail("prover_health_response_invalid")
    }
    try {
      await Promise.race([work(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ProbeError("prover_health_timeout")), timeoutMs)
      })])
      health = "reachable"
    } catch (error) {
      health = "failed"
      issues.push(error instanceof ProbeError ? error.code : "prover_health_transport_failed")
    } finally {
      clearTimeout(timer)
      controller.abort()
      if (reader) { void reader.cancel().catch(() => undefined); try { reader.releaseLock() } catch { /* pending read */ } }
    }
  }
  return {
    ok: issues.length === 0, mode, network, provider: target?.label ?? null,
    configuration: { explicitProverConfigured, reviewedHealthContract: Boolean(target) }, health, issues,
    liveExecutionReady: false as const, providerVerified: false as const,
    remaining: ["oauth_callback_registration", "approved_user_jwt", "original_salt_continuity", "proving_key_and_audience_acceptance", "valid_sui_zklogin_signature"],
    safety: { networkCalls, proofRequests: 0, jwtSent: false, signatures: 0, broadcasts: 0, secretValuesOutput: false },
    limitation: "Health is not zkLogin verification. No proof generation, OAuth consent, key compatibility, or end-to-end Sui execution was verified.",
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.length > 1 || (args.length === 1 && args[0] !== "--read-only")) {
    process.stdout.write(`${JSON.stringify({ ok: false, issues: ["arguments_invalid"], proofRequests: 0, broadcasts: 0 })}\n`)
    process.exitCode = 1
  } else {
    // Only public configuration names are read; no dotenv or ambient secrets.
    const result = await runZkLoginProverReadiness({ mode: args.length ? "read-only" : "offline", env: {
      HK_SUI_NETWORK: process.env.HK_SUI_NETWORK, HK_ZKLOGIN_PROVER_URL: process.env.HK_ZKLOGIN_PROVER_URL,
    } })
    process.stdout.write(`${JSON.stringify(result)}\n`)
    process.exitCode = result.ok ? 0 : 1
  }
}
