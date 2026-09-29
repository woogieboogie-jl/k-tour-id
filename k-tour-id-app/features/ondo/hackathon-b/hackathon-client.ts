// Browser-side helpers for the hackathon journey: API client, holder key
// (WebCrypto), and the Sui signer (zkLogin via Google, or a labelled demo signer).
// Secrets live in sessionStorage only for the life of one journey and are
// removed when it ends. Nothing is placed in URLs.
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519"
import { fromBase64, toBase64 } from "@mysten/sui/utils"
import { generateNonce, generateRandomness, getExtendedEphemeralPublicKey, getZkLoginSignature } from "@mysten/sui/zklogin"
import type { OperationResult } from "@/lib/hackathon/types"
import { ZKLOGIN_CALLBACK, ZKLOGIN_ATTEMPT_ID, validZkLoginAttemptView, type ZkLoginStart, type ZkLoginStarted, type ZkLoginAttemptView } from "@/lib/hackathon/zklogin-attempt-contract"

const API = "/api/hackathon/v1"

export class ApiError extends Error { constructor(public code: string, message: string, public status: number, public retryable: boolean) { super(message) } }

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) }, credentials: "same-origin", cache: "no-store" })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) { const e = data?.error ?? {}; throw new ApiError(String(e.code ?? "http_" + res.status), String(e.message ?? res.statusText), res.status, Boolean(e.retryable)) }
  return data as T
}
const post = <T,>(path: string, body?: unknown) => call<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) })
async function zkCall<T>(path: string, body?: unknown): Promise<T> {
  const signal = AbortSignal.timeout(60_000)
  const pending = (async () => {
    const response = await fetch(`${API}/zklogin/${path}`, { method: body === undefined ? "GET" : "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }), headers: { "content-type": "application/json" }, credentials: "same-origin", cache: "no-store", redirect: "error", signal })
    const reader = response.body?.getReader()
    if (!reader || response.redirected) throw new Error("Check the sign-in result")
    let size = 0, text = ""; const decoder = new TextDecoder("utf-8", { fatal: true })
    try { for (;;) { const part = await reader.read(); if (signal.aborted) throw Error(); if (part.done) break; size += part.value.byteLength; if (size > 32768) { void reader.cancel(); throw Error() }; text += decoder.decode(part.value, { stream: true }) } text += decoder.decode() } finally { reader.releaseLock() }
    const data = JSON.parse(text)
    if (!response.ok) throw new ApiError(String(data?.error?.code ?? "zklogin_attempt_unknown"), "Check the sign-in result before continuing.", response.status, false)
    return data as T
  })()
  try { return await new Promise<T>((resolve, reject) => { const stop = () => reject(new Error("Sign-in result is uncertain. Check the existing attempt; it will not be sent again.")); signal.addEventListener("abort", stop, { once: true }); pending.then(resolve, reject).finally(() => signal.removeEventListener("abort", stop)); if (signal.aborted) stop() }) }
  catch (error) { if (error instanceof ApiError) throw error; throw new Error("Sign-in result is uncertain. Check the existing attempt; it will not be sent again.") }
}

// ── OmniOne CX, fetched by the browser ────────────────────────────────
// A QR handoff is not a verified identity result. Availability depends on the
// configured service and network; isolated runs must never call this external URL.
export const CX_BROWSER_QR = process.env.NEXT_PUBLIC_HK_CX_BROWSER_QR === "1"
const CX_BASE = process.env.NEXT_PUBLIC_HK_CX_BASE_URL || "https://cx.raonsecure.co.kr:18543"
const CX_PROVIDER = process.env.NEXT_PUBLIC_HK_CX_PROVIDER || "comdl"
const CX_ZKP = process.env.NEXT_PUBLIC_HK_CX_ZKP_TYPE || "AdultVerify"

export type CxBrowserQr = { qrBase64: string; cxId: string; txId: string; provider: string }

export async function fetchCxBrowserQr(): Promise<CxBrowserQr> {
  if (!CX_BROWSER_QR || (await api.config()).isolatedMock !== false) throw new Error("External identity requests are disabled")
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
  create: (venueId: string, consentVersion: string, locale: string, identity?: { identityAuthorizationRef: string; identityContextDigest: string }) => post<OperationResult>("/operations", { venueId, consentVersion, locale, ...identity }),
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
  zkParams: () => call<{ configured: boolean; googleClientId: string; redirectUri: string; maxEpoch: number; epoch: number }>("/zklogin/params"),
  zkStart: (b: ZkLoginStart) => zkCall<ZkLoginStarted>("start", b),
  zkProve: (b: { operationId: string; attemptId: string; jwt: string }) => zkCall<ZkLoginAttemptView>("prove", b),
  zkStatus: (operationId: string, attemptId: string) => zkCall<ZkLoginAttemptView>(`status/${encodeURIComponent(operationId)}/${encodeURIComponent(attemptId)}`),
  zkCancel: (operationId: string, attemptId: string) => zkCall<ZkLoginAttemptView>("cancel", { operationId, attemptId }),
}

export type PublicConfig = { isolatedMock?: boolean; capabilities?: { hostedTestRedemptionEnabled?: boolean; [key: string]: boolean | undefined }; campaign: { venueId: string; campaignId: string; title: Record<string, string>; description: Record<string, string>; endsAt: string }; modes: Record<string, string>; sui: { network: string; packageId: string; campaignId: string; explorer: string; googleClientId: string }; omnione: { chainId: number; registryAddress: string }; consentVersion: string }
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
  // Do not issue/ack a pass to a holder key that cannot survive a page return.
  sessionStorage.setItem(key, JSON.stringify(stored))
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
  try { sessionStorage.removeItem(`${HOLDER_KEY}:${operationId}`); sessionStorage.removeItem(`${SIGNER_KEY}:${operationId}`); sessionStorage.removeItem(`ondo-b.hackathon.jwt:${operationId}`) } catch { /* ignore */ }
}

// ── Sui signer: zkLogin (Google) or demo signer ───────────────────────
const SIGNER_KEY = "ondo-b.hackathon.signer.v1"
export type StoredSigner =
  | { kind: "demo"; address: string; secretKey: string }
  | { kind: "zklogin"; address: string; ephemeralSecretKey: string; maxEpoch: number; randomness: string; inputs: ZkInputs | null; nonce: string; jwtPending: boolean; oauthState?: string; attemptId?: string; attemptExpiresAt?: string; proofRequestSent?: boolean; proofState?: ZkLoginAttemptView["status"] }

export function readSigner(operationId: string): StoredSigner | null {
  try {
    const raw = sessionStorage.getItem(`${SIGNER_KEY}:${operationId}`), s = raw ? JSON.parse(raw) as StoredSigner : null
    if (s?.kind === "zklogin" && s.attemptId && (!s.attemptExpiresAt || Date.parse(s.attemptExpiresAt) <= Date.now())) return { ...s, jwtPending: true, inputs: null, address: "", proofState: s.attemptExpiresAt ? "expired" : s.proofState }
    return s
  } catch { return null }
}
export function writeSigner(operationId: string, s: StoredSigner | null) {
  if (!s) sessionStorage.removeItem(`${SIGNER_KEY}:${operationId}`)
  else sessionStorage.setItem(`${SIGNER_KEY}:${operationId}`, JSON.stringify(s))
}
/** End one OAuth attempt without discarding the ephemeral key needed for a retry.
 * A provider cancellation or malformed callback must not leave an old state
 * value looking usable on the next return. No token or proof is created here. */
export function clearZkLoginOAuthAttempt(operationId: string) {
  try {
    const signer = readSigner(operationId)
    if (signer?.kind === "zklogin" && signer.jwtPending && signer.oauthState) {
      writeSigner(operationId, { ...signer, oauthState: undefined })
    }
  } catch { /* Storage can be unavailable in a private or blocked context. */ }
}
const TERMINAL_ZKLOGIN_CODES = new Set(["zklogin_jwt", "zklogin_aud", "zklogin_iss", "zklogin_exp"])
export function isTerminalZkLoginError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 400 && TERMINAL_ZKLOGIN_CODES.has(error.code)
}
/** Remove a rejected callback token and its one-time correlation state. The
 * operation itself and its place-return marker remain resumable. */
export function clearZkLoginReturn(operationId: string) {
  try { sessionStorage.removeItem(`ondo-b.hackathon.jwt:${operationId}`) } catch { /* blocked storage */ }
  clearZkLoginOAuthAttempt(operationId)
}
export function createDemoSigner(operationId: string): StoredSigner {
  const kp = Ed25519Keypair.generate()
  const s: StoredSigner = { kind: "demo", address: kp.toSuiAddress(), secretKey: kp.getSecretKey() }
  writeSigner(operationId, s)
  return s
}
/** Begin Google zkLogin: stores ephemeral key + nonce, returns the OAuth URL to navigate to. */
export function canBeginGoogleHere() {
  if (typeof window === "undefined" || window.location.origin !== new URL(ZKLOGIN_CALLBACK).origin || window.top !== window.self) return false
  // Google forbids OAuth in embedded user agents. The current iOS bridge has
  // no ASWebAuthenticationSession/callback transport: do not navigate WK to
  // Google, and do not treat openOffer's return as Google authentication.
  if (Object.getOwnPropertyDescriptor(window, "ktourNative")) return false
  const ua = window.navigator.userAgent
  return !(/(?:iPhone|iPad|iPod).*AppleWebKit/i.test(ua) && !/(?:Safari|CriOS|FxiOS|EdgiOS)\//i.test(ua)) && !/; wv\)|\bwv\b/i.test(ua)
}
export async function beginZkLogin(operationId: string, googleClientId: string, maxEpoch: number, isCurrent = () => true): Promise<string> {
  if (!canBeginGoogleHere()) throw new Error("Open the main app to sign in with Google.")
  const config = await api.config()
  if (config.isolatedMock !== false || config.modes.zklogin !== "google" || config.sui.googleClientId !== googleClientId || !isCurrent()) throw new Error("External sign-in is disabled")
  if (readSigner(operationId)?.kind === "zklogin") throw new Error("Check or cancel the current sign-in before starting another.")
  const eph = Ed25519Keypair.generate()
  const randomness = generateRandomness()
  const nonce = generateNonce(eph.getPublicKey(), maxEpoch, randomness)
  const attemptId = `zkl_${toBase64(crypto.getRandomValues(new Uint8Array(18))).replaceAll("+", "-").replaceAll("/", "_")}`
  const draft: StoredSigner = { kind: "zklogin", address: "", ephemeralSecretKey: eph.getSecretKey(), maxEpoch, randomness, inputs: null, nonce, jwtPending: true, attemptId, proofRequestSent: false }
  writeSigner(operationId, draft) // Lost start response still has a known GET/cancel handle.
  const started = await api.zkStart({ operationId, attemptId, extendedEphemeralPublicKey: getExtendedEphemeralPublicKey(eph.getPublicKey()), maxEpoch, jwtRandomness: randomness })
  const { googleClientId: audience, redirectUri, nonce: returnedNonce, oauthState, ...summary } = started
  if (!validZkLoginAttemptView(summary, operationId, attemptId) || summary.status !== "pending" || summary.maxEpoch !== maxEpoch || Date.parse(summary.expiresAt) <= Date.now() || audience !== googleClientId || redirectUri !== ZKLOGIN_CALLBACK || returnedNonce !== nonce || !/^state_[A-Za-z0-9_-]{32}$/.test(oauthState)) throw new Error("Sign-in response does not match this operation")
  if (!isCurrent() || readSigner(operationId)?.kind !== "zklogin" || (readSigner(operationId) as Extract<StoredSigner, { kind: "zklogin" }>).attemptId !== attemptId) throw new Error("Sign-in was closed. Check the current attempt.")
  writeSigner(operationId, { ...draft, oauthState, attemptExpiresAt: summary.expiresAt, proofState: "pending" })
  const params = new URLSearchParams({ client_id: googleClientId, redirect_uri: ZKLOGIN_CALLBACK, response_type: "id_token", scope: "openid", nonce, state: oauthState, prompt: "select_account" })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}
/** Finish zkLogin after the OAuth callback stored the JWT: prove and derive the address. */
export async function finishZkLogin(operationId: string, jwt?: string, isCurrent = () => true): Promise<StoredSigner> {
  const s = readSigner(operationId)
  if (!canBeginGoogleHere() || !s || s.kind !== "zklogin" || !s.attemptId || !ZKLOGIN_ATTEMPT_ID.test(s.attemptId)) throw new Error("zklogin session missing")
  const eph = Ed25519Keypair.fromSecretKey(s.ephemeralSecretKey)
  if (generateNonce(eph.getPublicKey(), s.maxEpoch, s.randomness) !== s.nonce) throw new Error("Sign-in key binding changed")
  let proved: ZkLoginAttemptView
  if (!s.proofRequestSent && jwt && s.attemptExpiresAt && Date.parse(s.attemptExpiresAt) > Date.now() && isCurrent()) {
    // Mark before sending, discard token even if transport fails. Another click
    // or reload can only GET the same result, never resend the proving request.
    writeSigner(operationId, { ...s, proofRequestSent: true, proofState: "proving" })
    sessionStorage.removeItem(`ondo-b.hackathon.jwt:${operationId}`)
    proved = await api.zkProve({ operationId, attemptId: s.attemptId, jwt })
  } else proved = await api.zkStatus(operationId, s.attemptId)
  if (!validZkLoginAttemptView(proved, operationId, s.attemptId) || proved.maxEpoch !== s.maxEpoch) throw new Error("Sign-in result does not match this operation")
  const current = readSigner(operationId)
  if (!isCurrent() || current?.kind !== "zklogin" || current.attemptId !== s.attemptId) throw new Error("Sign-in was closed")
  writeSigner(operationId, { ...current, proofState: proved.status, attemptExpiresAt: proved.expiresAt })
  if (proved.status !== "proved" || !proved.address || !proved.inputs || Date.parse(proved.expiresAt) <= Date.now()) throw new Error("Sign-in is not completed. Check its status or cancel this attempt.")
  const next: StoredSigner = { ...current, address: proved.address, inputs: proved.inputs, jwtPending: false, oauthState: undefined, proofState: "proved", attemptExpiresAt: proved.expiresAt }
  writeSigner(operationId, next)
  return next
}
export async function cancelZkLogin(operationId: string): Promise<void> {
  const s = readSigner(operationId)
  if (!s || s.kind !== "zklogin") return
  if (s.attemptId) {
    try {
      const result = await api.zkCancel(operationId, s.attemptId)
      if (!validZkLoginAttemptView(result, operationId, s.attemptId) || result.status !== "cancelled") throw new Error("Check the sign-in cancellation result")
    } catch (error) {
      // A start rejected before durable creation can leave a local draft. Only
      // an authoritative absent-attempt response may discard it; timeout,
      // access loss and unknown cancellation preserve the recovery handle.
      if (!(error instanceof ApiError && error.status === 404 && error.code === "not_found" && !s.attemptExpiresAt)) throw error
    }
  }
  // Do not clear a newer attempt while an old cancellation was in flight.
  const current = readSigner(operationId)
  if (current?.kind === "zklogin" && current.attemptId === s.attemptId) { clearZkLoginReturn(operationId); writeSigner(operationId, null) }
}
async function rawSign(s: StoredSigner, bytes: Uint8Array, personal: boolean): Promise<string> {
  if (s.kind === "demo") {
    const kp = Ed25519Keypair.fromSecretKey(s.secretKey)
    return personal ? (await kp.signPersonalMessage(bytes)).signature : (await kp.signTransaction(bytes)).signature
  }
  if (!s.inputs) throw new Error("zklogin proof missing")
  if (s.attemptId && (!s.attemptExpiresAt || Date.parse(s.attemptExpiresAt) <= Date.now() || s.proofState !== "proved")) throw new Error("Check the current sign-in before approving")
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
