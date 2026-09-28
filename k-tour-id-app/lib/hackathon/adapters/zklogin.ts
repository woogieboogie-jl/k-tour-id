// zkLogin server helpers (HK-07). Google OAuth id_token → salt → address → ZK proof.
// Two proving paths:
// - Enoki (ENOKI_API_KEY set): managed salt + prover; configure its app/client/network.
// - Explicit self-managed HTTPS prover: local salt from a server master seed over
//   (iss, aud, sub). Current Sui docs allow public Testnet proving; Enoki is optional.
// No implicit Devnet endpoint or automatic fallback. Endpoint selection does NOT
// verify the proving key or OAuth audience access; those need separate evidence.
// The browser keeps the ephemeral private key; the server never sees it. The JWT
// is used once here and not stored.
// Note: address derivation differs between the two paths (Enoki salt vs local salt), so
// switching paths changes users' zkLogin addresses. Fine for the demo perk (no assets).
import { createHmac } from "node:crypto"
import { decodeJwt, genAddressSeed, jwtToAddress } from "@mysten/sui/zklogin"
import { assertExternalServicesEnabled, hkConfig } from "../config"
import { HkError } from "../util"
import { isHostedSuiProfile } from "../hosted-sui-profile"
import { selectZkLoginProvider } from "../zklogin-provider-selection"

export function zkLoginConfigured() {
  const config = hkConfig()
  if (config.isolatedMock || config.cxPreview || isHostedSuiProfile()) return false
  const c = config.sui
  return Boolean(c.googleClientId && c.zkSaltSeed && selectZkLoginProvider(process.env))
}

export function deriveSalt(jwt: string): bigint {
  const c = hkConfig().sui
  if (!c.zkSaltSeed) throw new HkError("zklogin_unconfigured", "HK_ZKLOGIN_SALT_SEED missing", 503)
  const d = decodeClaims(jwt)
  const mac = createHmac("sha256", c.zkSaltSeed).update(`${d.iss}|${d.aud}|${d.sub}`).digest()
  // salt must be < 2^128 for zkLogin
  return BigInt("0x" + mac.subarray(0, 16).toString("hex"))
}

export type ZkProofInputs = {
  proofPoints: { a: string[]; b: string[][]; c: string[] }
  issBase64Details: { value: string; indexMod4: number }
  headerBase64: string
  addressSeed: string
}

export function enokiConfigured() { return !hkConfig().isolatedMock && !hkConfig().cxPreview && !isHostedSuiProfile() && selectZkLoginProvider(process.env)?.kind === "enoki" }
export function zkLoginProverLabel() { return zkLoginConfigured() ? selectZkLoginProvider(process.env)!.kind : "unconfigured" }

function decodeClaims(jwt: string) {
  try { return decodeJwt(jwt) }
  catch { throw new HkError("zklogin_jwt", "Invalid login token", 400) }
}

const MAX_PROVIDER_BYTES = 128 * 1024
type ProviderCode = "zklogin_enoki" | "zklogin_prover"
const providerFailure = (code: ProviderCode, retryable = true) => new HkError(code, "zkLogin provider request could not be completed", 502, retryable)

/** Do not expose provider bodies or transport exceptions (they can echo JWTs,
 * API keys and request URLs). Bound successful responses as well as failures. */
async function providerJson(url: string, init: RequestInit, code: ProviderCode): Promise<Record<string, unknown>> {
  const signal = AbortSignal.timeout(60_000)
  const pending = (async () => {
    const res = await fetch(url, { ...init, redirect: "error", cache: "no-store", signal })
    if (!res.ok) {
      void res.body?.cancel().catch(() => undefined)
      throw providerFailure(code, res.status === 429 || res.status >= 500)
    }
    const reader = res.body?.getReader()
    if (!reader) throw providerFailure(code)
    const chunks: Uint8Array[] = []
    let bytes = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        bytes += value.byteLength
        if (bytes > MAX_PROVIDER_BYTES) {
          void reader.cancel().catch(() => undefined)
          throw providerFailure(code)
        }
        chunks.push(value)
      }
    } finally { reader.releaseLock() }
    const json: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"))
    if (!json || typeof json !== "object" || Array.isArray(json)) throw providerFailure(code)
    return json as Record<string, unknown>
  })()
  try {
    return await new Promise<Record<string, unknown>>((resolve, reject) => {
      const abort = () => reject(providerFailure(code))
      signal.addEventListener("abort", abort, { once: true })
      pending.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort))
      if (signal.aborted) abort()
    })
  } catch (error) {
    // Preserve only our fixed message; never forward an upstream exception.
    throw providerFailure(code, error instanceof HkError ? error.retryable : true)
  }
}

async function enoki<T>(baseUrl: string, apiKey: string, path: string, init: { method?: string; jwt: string; body?: unknown }): Promise<T> {
  const json = await providerJson(`${baseUrl}${path}`, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${apiKey}`, "zklogin-jwt": init.jwt, ...(init.body ? { "content-type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  }, "zklogin_enoki")
  if (!json.data || typeof json.data !== "object" || Array.isArray(json.data)) throw providerFailure("zklogin_enoki")
  return json.data as T
}

export async function proveZkLogin(opts: { jwt: string; extendedEphemeralPublicKey: string; maxEpoch: number; jwtRandomness: string }): Promise<{ address: string; salt: string; inputs: ZkProofInputs; sub: string; aud: string }> {
  assertExternalServicesEnabled("zkLogin provider authentication")
  const c = hkConfig().sui
  const provider = selectZkLoginProvider(process.env)
  if (!c.googleClientId || !c.zkSaltSeed || !provider) throw new HkError("zklogin_unconfigured", "zkLogin provider configuration is unavailable", 503)
  const decoded = decodeClaims(opts.jwt)
  if (!decoded.sub || !decoded.aud || !decoded.iss) throw new HkError("zklogin_jwt", "jwt missing claims", 400)
  const aud = Array.isArray(decoded.aud) ? decoded.aud[0] : decoded.aud
  if (c.googleClientId && aud !== c.googleClientId) throw new HkError("zklogin_aud", "jwt audience mismatch", 400)
  if (decoded.iss !== "https://accounts.google.com" && decoded.iss !== "accounts.google.com") throw new HkError("zklogin_iss", "unsupported issuer", 400)
  if (typeof decoded.exp === "number" && decoded.exp * 1000 < Date.now()) throw new HkError("zklogin_exp", "jwt expired", 400)
  if (provider.kind === "enoki") {
    const apiKey = process.env.ENOKI_API_KEY!
    const network = (c.network === "mainnet" || c.network === "devnet" ? c.network : "testnet") as "testnet" | "devnet" | "mainnet"
    const who = await enoki<{ salt: string; address: string; publicKey: string }>(provider.url, apiKey, "/zklogin", { jwt: opts.jwt })
    const proof = await enoki<ZkProofInputs>(provider.url, apiKey, "/zklogin/zkp", { method: "POST", jwt: opts.jwt, body: { network, ephemeralPublicKey: opts.extendedEphemeralPublicKey, maxEpoch: opts.maxEpoch, randomness: opts.jwtRandomness } })
    return { address: who.address, salt: who.salt, inputs: proof, sub: decoded.sub, aud }
  }
  const salt = deriveSalt(opts.jwt)
  let address: string
  try { address = jwtToAddress(opts.jwt, salt, false) }
  catch { throw new HkError("zklogin_jwt", "Invalid login token", 400) }
  const proof = await providerJson(provider.url, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jwt: opts.jwt, extendedEphemeralPublicKey: opts.extendedEphemeralPublicKey, maxEpoch: opts.maxEpoch, jwtRandomness: opts.jwtRandomness, salt: salt.toString(), keyClaimName: "sub" }),
  }, "zklogin_prover") as Omit<ZkProofInputs, "addressSeed">
  const addressSeed = genAddressSeed(salt, "sub", decoded.sub, aud).toString()
  return { address, salt: salt.toString(), inputs: { ...proof, addressSeed }, sub: decoded.sub, aud }
}
