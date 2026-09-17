// zkLogin server helpers (HK-07). Google OAuth id_token → salt → address → ZK proof.
// Two proving paths:
// - Enoki (ENOKI_API_KEY set): Mysten's managed salt + prover. Required on Testnet/Mainnet:
//   prover-dev.mystenlabs.com proves against the Devnet verifying key (Testnet validators
//   reject it with "Groth16 proof verify failed") and prover.mystenlabs.com only accepts
//   allowlisted client IDs. The Google client ID must be registered in the Enoki portal.
// - Self-managed (fallback, Devnet only): HKDF-style salt from a server master seed over
//   (iss, aud, sub) and the public dev prover (no registration).
// The browser keeps the ephemeral private key; the server never sees it. The JWT
// is used once here and not stored.
// Note: address derivation differs between the two paths (Enoki salt vs local salt), so
// switching paths changes users' zkLogin addresses. Fine for the demo perk (no assets).
import { createHmac } from "node:crypto"
import { decodeJwt, genAddressSeed, jwtToAddress } from "@mysten/sui/zklogin"
import { hkConfig } from "../config"
import { HkError } from "../util"

export function zkLoginConfigured() {
  const c = hkConfig().sui
  return Boolean(c.googleClientId && c.zkSaltSeed)
}

export function deriveSalt(jwt: string): bigint {
  const c = hkConfig().sui
  if (!c.zkSaltSeed) throw new HkError("zklogin_unconfigured", "HK_ZKLOGIN_SALT_SEED missing", 503)
  const d = decodeJwt(jwt)
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

const ENOKI_API = process.env.ENOKI_API_URL || "https://api.enoki.mystenlabs.com/v1"
export function enokiConfigured() { return Boolean(process.env.ENOKI_API_KEY) }
export function zkLoginProverLabel() { return enokiConfigured() ? "enoki" : "dev-prover" }

async function enoki<T>(path: string, init: { method?: string; jwt: string; body?: unknown }): Promise<T> {
  const res = await fetch(`${ENOKI_API}${path}`, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${process.env.ENOKI_API_KEY}`, "zklogin-jwt": init.jwt, ...(init.body ? { "content-type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(60_000),
  })
  const text = await res.text()
  if (!res.ok) throw new HkError("zklogin_enoki", `enoki ${path} ${res.status}: ${text.slice(0, 200)}`, 502, res.status >= 500)
  try { return (JSON.parse(text) as { data: T }).data } catch { throw new HkError("zklogin_enoki", `enoki ${path}: bad json`, 502, true) }
}

export async function proveZkLogin(opts: { jwt: string; extendedEphemeralPublicKey: string; maxEpoch: number; jwtRandomness: string }): Promise<{ address: string; salt: string; inputs: ZkProofInputs; sub: string; aud: string }> {
  const c = hkConfig().sui
  const decoded = decodeJwt(opts.jwt)
  if (!decoded.sub || !decoded.aud || !decoded.iss) throw new HkError("zklogin_jwt", "jwt missing claims", 400)
  const aud = Array.isArray(decoded.aud) ? decoded.aud[0] : decoded.aud
  if (c.googleClientId && aud !== c.googleClientId) throw new HkError("zklogin_aud", "jwt audience mismatch", 400)
  if (decoded.iss !== "https://accounts.google.com" && decoded.iss !== "accounts.google.com") throw new HkError("zklogin_iss", "unsupported issuer", 400)
  if (typeof decoded.exp === "number" && decoded.exp * 1000 < Date.now()) throw new HkError("zklogin_exp", "jwt expired", 400)
  if (enokiConfigured()) {
    const network = (c.network === "mainnet" || c.network === "devnet" ? c.network : "testnet") as "testnet" | "devnet" | "mainnet"
    const who = await enoki<{ salt: string; address: string; publicKey: string }>("/zklogin", { jwt: opts.jwt })
    const proof = await enoki<ZkProofInputs>("/zklogin/zkp", { method: "POST", jwt: opts.jwt, body: { network, ephemeralPublicKey: opts.extendedEphemeralPublicKey, maxEpoch: opts.maxEpoch, randomness: opts.jwtRandomness } })
    return { address: who.address, salt: who.salt, inputs: proof, sub: decoded.sub, aud }
  }
  const salt = deriveSalt(opts.jwt)
  const address = jwtToAddress(opts.jwt, salt, false)
  const res = await fetch(c.zkProverUrl, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jwt: opts.jwt, extendedEphemeralPublicKey: opts.extendedEphemeralPublicKey, maxEpoch: opts.maxEpoch, jwtRandomness: opts.jwtRandomness, salt: salt.toString(), keyClaimName: "sub" }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new HkError("zklogin_prover", `prover ${res.status}: ${(await res.text()).slice(0, 200)}`, 502, true)
  const proof = (await res.json()) as Omit<ZkProofInputs, "addressSeed">
  const addressSeed = genAddressSeed(salt, "sub", decoded.sub, aud).toString()
  return { address, salt: salt.toString(), inputs: { ...proof, addressSeed }, sub: decoded.sub, aud }
}
