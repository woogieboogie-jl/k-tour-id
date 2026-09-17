// Browser-side helpers for the hackathon journey: API client, holder key
// (WebCrypto), and the Sui signer (zkLogin via Google, or a labelled demo signer).
// Secrets live in sessionStorage only for the life of one journey and are
// removed when it ends. Nothing is placed in URLs.
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519"
import { fromBase64, toBase64 } from "@mysten/sui/utils"
import { generateNonce, generateRandomness, getExtendedEphemeralPublicKey, getZkLoginSignature } from "@mysten/sui/zklogin"
import type { OperationResult } from "@/lib/hackathon/types"

const API = "/api/hackathon/v1"

export class ApiError extends Error { constructor(public code: string, message: string, public status: number, public retryable: boolean) { super(message) } }

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) }, credentials: "same-origin", cache: "no-store" })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) { const e = data?.error ?? {}; throw new ApiError(String(e.code ?? "http_" + res.status), String(e.message ?? res.statusText), res.status, Boolean(e.retryable)) }
  return data as T
}
const post = <T,>(path: string, body?: unknown) => call<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) })

// ── OmniOne CX, fetched by the browser ────────────────────────────────
// The CX verifier answers unauthenticated and sends `Access-Control-Allow-Origin: *`,
// but it refuses connections from cloud networks, so a deployed server cannot reach it.
// The visitor's own network can, so the QR handoff is requested here. This proves the
// CX integration end to end up to the handoff; the result still cannot be verified by
// this server, so the journey continues on the clearly labelled sample path.
export const CX_BROWSER_QR = process.env.NEXT_PUBLIC_HK_CX_BROWSER_QR === "1"
const CX_BASE = process.env.NEXT_PUBLIC_HK_CX_BASE_URL || "https://cx.raonsecure.co.kr:18543"
const CX_PROVIDER = process.env.NEXT_PUBLIC_HK_CX_PROVIDER || "comdl"
const CX_ZKP = process.env.NEXT_PUBLIC_HK_CX_ZKP_TYPE || "AdultVerify"

export type CxBrowserQr = { qrBase64: string; cxId: string; txId: string; provider: string }

export async function fetchCxBrowserQr(): Promise<CxBrowserQr> {
  const call = async (path: string, body: unknown) => {
    const res = await fetch(`${CX_BASE}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    if (!res.ok) throw new Error(`CX ${path} ${res.status}`)
    return (await res.json()) as Record<string, unknown>
  }
  const trans = await call("/oacx/api/v1.0/trans", {})
  const token = String(trans.token ?? ""), txId = String(trans.txId ?? "")
  if (!token || !txId) throw new Error("CX did not return a token")
  const qr = await call("/oacx/api/v1.0/authen/qr/request", {
    token, txId, provider: `${CX_PROVIDER}_v1.5`,
    contentInfo: { signType: "ENT_MID" }, extraParams: { zkpType: CX_ZKP },
  })
  const code = Number(qr.resultCode ?? 200)
  if (code !== 200) throw new Error(`CX qr/request ${code}: ${String(qr.oacxCode ?? "")}`)
  const data = (qr.data && typeof qr.data === "object" ? qr.data : {}) as Record<string, unknown>
  return { qrBase64: String(data.qrBase64 ?? ""), cxId: String(qr.cxId ?? ""), txId, provider: String(qr.provider ?? CX_PROVIDER) }
}

export const api = {
  /** Establish the HttpOnly session cookie before parallel calls so they cannot race to mint different ids. */
  session: () => post<{ ok: true; sessionId: string }>("/sessions"),
  config: () => call<PublicConfig>("/config"),
  entitlements: (venueId: string) => call<EntitlementInfo>(`/places/${encodeURIComponent(venueId)}/demo-entitlements`),
  create: (venueId: string, consentVersion: string, locale: string) => post<OperationResult>("/operations", { venueId, consentVersion, locale }),
  get: (id: string) => call<OperationResult>(`/operations/${id}`),
  evidence: (id: string) => call<Record<string, unknown>>(`/operations/${id}/evidence`),
  identityStart: (id: string, mobile: boolean) => post<OperationResult>(`/operations/${id}/identity/start`, { mobile }),
  identityComplete: (id: string, sample?: { outcome: string; subjectSeed: string }) => post<OperationResult>(`/operations/${id}/identity/complete`, sample ? { sample } : {}),
  issue: (id: string, publicKeyPem: string, alg: string) => post<{ result: OperationResult; vc: unknown; offer: unknown }>(`/operations/${id}/credential/issue`, { publicKeyPem, alg }),
  holderAck: (id: string, signatureB64: string) => post<OperationResult>(`/operations/${id}/credential/holder-ack`, { signatureB64 }),
  presentationRequest: (id: string) => post<{ result: OperationResult; challenge: string }>(`/operations/${id}/presentation/request`),
  presentationSubmit: (id: string, presentationId: string, disclosed: Record<string, unknown>, signatureB64: string) => post<OperationResult>(`/operations/${id}/presentation/submit`, { presentationId, disclosed, signatureB64 }),
  presentationDeny: (id: string) => post<OperationResult>(`/operations/${id}/presentation/deny`),
  proposal: (id: string, locale: string) => post<OperationResult>(`/operations/${id}/proposal`, { locale }),
  delegationPrepare: (id: string, b: { userAddress: string; signer: "zklogin" | "demo"; walletProof: { message: string; signature: string }; approvedProposalDigest: string }) => post<{ result: OperationResult; txBytesB64: string }>(`/operations/${id}/delegation/prepare`, b),
  delegationSubmit: (id: string, txBytesDigest: string, userSignature: string) => post<OperationResult>(`/operations/${id}/delegation/submit`, { txBytesDigest, userSignature }),
  agentRun: (id: string) => post<OperationResult>(`/operations/${id}/agent/run`),
  redeem: (id: string, idempotencyKey: string) => post<OperationResult>(`/operations/${id}/redeem`, { idempotencyKey }),
  cancel: (id: string) => post<OperationResult>(`/operations/${id}/cancel`),
  reconcile: (id: string) => post<OperationResult>(`/operations/${id}/reconcile`),
  zkParams: () => call<{ configured: boolean; googleClientId: string; maxEpoch: number; epoch: number }>("/zklogin/params"),
  zkProve: (b: { jwt: string; extendedEphemeralPublicKey: string; maxEpoch: number; jwtRandomness: string }) => post<{ address: string; inputs: ZkInputs; maxEpoch: number }>("/zklogin/prove", b),
}

export type PublicConfig = { campaign: { venueId: string; campaignId: string; title: Record<string, string>; description: Record<string, string>; endsAt: string }; modes: Record<string, string>; sui: { network: string; packageId: string; campaignId: string; explorer: string; googleClientId: string }; omnione: { chainId: number; registryAddress: string }; consentVersion: string }
export type EntitlementInfo = { supported: boolean; campaign: PublicConfig["campaign"] | null; modes?: Record<string, string>; consentVersion?: string; operation: OperationResult | null; redeemed: { redemptionRef: string; redeemedAt: string } | null }
export type ZkInputs = { proofPoints: { a: string[]; b: string[][]; c: string[] }; issBase64Details: { value: string; indexMod4: number }; headerBase64: string; addressSeed: string }

// ── holder key (WebCrypto) ────────────────────────────────────────────
const HOLDER_KEY = "ondo-b.hackathon.holder.v1"
type StoredHolder = { alg: "Ed25519" | "ECDSA-P256"; jwk: JsonWebKey; publicKeyPem: string }

function pemFromSpki(spki: ArrayBuffer) {
  const b64 = toBase64(new Uint8Array(spki)).replace(/(.{64})/g, "$1\n")
  return `-----BEGIN PUBLIC KEY-----\n${b64.trim()}\n-----END PUBLIC KEY-----\n`
}
export async function ensureHolderKey(operationId: string): Promise<StoredHolder> {
  const key = `${HOLDER_KEY}:${operationId}`
  try { const raw = sessionStorage.getItem(key); if (raw) return JSON.parse(raw) as StoredHolder } catch { /* ignore */ }
  let alg: StoredHolder["alg"] = "Ed25519"
  let pair: CryptoKeyPair
  try { pair = (await crypto.subtle.generateKey({ name: "Ed25519" } as AlgorithmIdentifier, true, ["sign", "verify"])) as CryptoKeyPair }
  catch { alg = "ECDSA-P256"; pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) }
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey)
  const spki = await crypto.subtle.exportKey("spki", pair.publicKey)
  const stored: StoredHolder = { alg, jwk, publicKeyPem: pemFromSpki(spki) }
  try { sessionStorage.setItem(key, JSON.stringify(stored)) } catch { /* ignore */ }
  return stored
}
export async function holderSign(holder: StoredHolder, payload: string): Promise<string> {
  const algo = holder.alg === "Ed25519" ? ({ name: "Ed25519" } as AlgorithmIdentifier) : { name: "ECDSA", namedCurve: "P-256" }
  const key = await crypto.subtle.importKey("jwk", holder.jwk, algo, false, ["sign"])
  const sig = await crypto.subtle.sign(holder.alg === "Ed25519" ? ({ name: "Ed25519" } as AlgorithmIdentifier) : { name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(payload))
  return toBase64(new Uint8Array(sig)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}
export function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown => Array.isArray(v) ? v.map(sort) : v && typeof v === "object" ? Object.keys(v as Record<string, unknown>).sort().reduce<Record<string, unknown>>((a, k) => { const x = (v as Record<string, unknown>)[k]; if (x !== undefined) a[k] = sort(x); return a }, {}) : v
  return JSON.stringify(sort(value))
}
export function clearJourneySecrets(operationId: string) {
  try { sessionStorage.removeItem(`${HOLDER_KEY}:${operationId}`); sessionStorage.removeItem(`${SIGNER_KEY}:${operationId}`) } catch { /* ignore */ }
}

// ── Sui signer: zkLogin (Google) or demo signer ───────────────────────
const SIGNER_KEY = "ondo-b.hackathon.signer.v1"
export type StoredSigner =
  | { kind: "demo"; address: string; secretKey: string }
  | { kind: "zklogin"; address: string; ephemeralSecretKey: string; maxEpoch: number; randomness: string; inputs: ZkInputs | null; nonce: string; jwtPending: boolean }

export function readSigner(operationId: string): StoredSigner | null {
  try { const raw = sessionStorage.getItem(`${SIGNER_KEY}:${operationId}`); return raw ? (JSON.parse(raw) as StoredSigner) : null } catch { return null }
}
export function writeSigner(operationId: string, s: StoredSigner | null) {
  try { if (!s) sessionStorage.removeItem(`${SIGNER_KEY}:${operationId}`); else sessionStorage.setItem(`${SIGNER_KEY}:${operationId}`, JSON.stringify(s)) } catch { /* ignore */ }
}
export function createDemoSigner(operationId: string): StoredSigner {
  const kp = Ed25519Keypair.generate()
  const s: StoredSigner = { kind: "demo", address: kp.toSuiAddress(), secretKey: kp.getSecretKey() }
  writeSigner(operationId, s)
  return s
}
/** Begin Google zkLogin: stores ephemeral key + nonce, returns the OAuth URL to navigate to. */
export async function beginZkLogin(operationId: string, googleClientId: string, maxEpoch: number): Promise<string> {
  const eph = Ed25519Keypair.generate()
  const randomness = generateRandomness()
  const nonce = generateNonce(eph.getPublicKey(), maxEpoch, randomness)
  writeSigner(operationId, { kind: "zklogin", address: "", ephemeralSecretKey: eph.getSecretKey(), maxEpoch, randomness, inputs: null, nonce, jwtPending: true })
  const redirect = `${window.location.origin}/hackathon/zklogin/callback`
  const params = new URLSearchParams({ client_id: googleClientId, redirect_uri: redirect, response_type: "id_token", scope: "openid", nonce, state: operationId, prompt: "select_account" })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}
/** Finish zkLogin after the OAuth callback stored the JWT: prove and derive the address. */
export async function finishZkLogin(operationId: string, jwt: string): Promise<StoredSigner> {
  const s = readSigner(operationId)
  if (!s || s.kind !== "zklogin") throw new Error("zklogin session missing")
  const eph = Ed25519Keypair.fromSecretKey(s.ephemeralSecretKey)
  const extended = getExtendedEphemeralPublicKey(eph.getPublicKey())
  const proved = await api.zkProve({ jwt, extendedEphemeralPublicKey: extended, maxEpoch: s.maxEpoch, jwtRandomness: s.randomness })
  const next: StoredSigner = { ...s, address: proved.address, inputs: proved.inputs, jwtPending: false }
  writeSigner(operationId, next)
  return next
}
async function rawSign(s: StoredSigner, bytes: Uint8Array, personal: boolean): Promise<string> {
  if (s.kind === "demo") {
    const kp = Ed25519Keypair.fromSecretKey(s.secretKey)
    return personal ? (await kp.signPersonalMessage(bytes)).signature : (await kp.signTransaction(bytes)).signature
  }
  if (!s.inputs) throw new Error("zklogin proof missing")
  const eph = Ed25519Keypair.fromSecretKey(s.ephemeralSecretKey)
  const userSignature = personal ? (await eph.signPersonalMessage(bytes)).signature : (await eph.signTransaction(bytes)).signature
  return getZkLoginSignature({ inputs: s.inputs, maxEpoch: s.maxEpoch, userSignature })
}
export const signPersonalMessage = (s: StoredSigner, message: string) => rawSign(s, new TextEncoder().encode(message), true)
export const signTransactionBytes = (s: StoredSigner, txBytesB64: string) => rawSign(s, fromBase64(txBytesB64), false)
export async function sha256Hex(bytes: Uint8Array) {
  const d = await crypto.subtle.digest("SHA-256", bytes as BufferSource)
  return "0x" + Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("")
}
export { fromBase64 }
