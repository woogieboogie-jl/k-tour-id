// OmniOne CX adapter — Mobile ID verification (필수과제).
//
// mode "cx"  : real OmniOne CX VC-Verifier REST flow (manual v1.0, 2024-07-09):
//              POST /oacx/api/v1.0/trans            -> { token, txId }
//              POST /oacx/api/v1.0/authen/qr/request -> { qrBase64, cxId }   (PC/QR)
//              POST /oacx/api/v1.0/authen/app/request-> { androidLink, iosLink, ssPayLink } (mobile handoff)
//              POST /oacx/api/v1.0/authen/qr|app/result -> { verified, ... }
//              POST /oacx/api/v1.0/trans/token       -> claims (with zkpType AdultVerify: adult flag only)
//              Tokens are step-bound: the server re-validates the call order, so
//              we keep token/txId server-side and never accept a client "success".
// mode "mock": deterministic sample (labelled SIMULATION in the UI). The mock
//              still produces a server-side IdentityEvidence with a stable
//              subjectRef derived from a server secret so uniqueness rules can
//              be exercised; it never claims to be a government result.
import { hkConfig, HK_TTL } from "../config"
import { hmacHex, nowIso, plusMs, randomId, HkError } from "../util"
import type { IdentityEvidence, IdentityHandoff } from "../types"

export type CxStart = { handoff: IdentityHandoff; token?: string; txId?: string; cxId?: string }

/** CX nests payloads under `data` and reports progress in `oacxStatus` (not `status`). */
const dataOf = (json: Record<string, unknown>): Record<string, unknown> =>
  json.data && typeof json.data === "object" ? (json.data as Record<string, unknown>) : {}
export type CxResult = { evidence: IdentityEvidence; raw?: Record<string, unknown> }

const MAX_RESPONSE_BYTES = 512 * 1024
const validHandle = (value: unknown, max = 8192): value is string => typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000-\u0020\u007f]/.test(value)
function handle(value: unknown, label: string, max = 8192): string {
  if (!validHandle(value, max)) throw new HkError("cx_response", `CX returned an invalid ${label}`, 502)
  return value
}
function transactionEcho(json: Record<string, unknown>, txId: string, cxId?: string) {
  const returnedTx = json.txId ?? json.txid, returnedCx = json.cxId ?? json.cxid
  if ((returnedTx !== undefined && returnedTx !== txId) || (cxId !== undefined && returnedCx !== undefined && returnedCx !== cxId)) {
    throw new HkError("cx_transaction_mismatch", "CX result does not match this identity request", 502)
  }
}
function safeAppLink(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined
  if (typeof value !== "string" || value.length > 16_384 || /[\u0000-\u0020\u007f<>]/.test(value)) throw new HkError("cx_handoff", "CX returned an invalid app handoff", 502)
  // Native schemes vary by OS/wallet; do not invent a vendor-specific scheme.
  // Reject browser-executable/local-resource schemes, including intent fallbacks.
  const forbidden = /(?:^|[=;])(?:javascript|vbscript|data|file|filesystem|blob|about|chrome|chrome-extension|moz-extension)\s*:/i
  let decoded = value
  for (let i = 0; i < 3; i += 1) {
    if (forbidden.test(decoded)) throw new HkError("cx_handoff", "CX returned an invalid app handoff", 502)
    try { const next = decodeURIComponent(decoded); if (next === decoded) break; decoded = next } catch { break }
  }
  try {
    const url = new URL(value)
    if (!/^[a-z][a-z0-9+.-]*:$/.test(url.protocol) || url.protocol === "http:" || url.username || url.password) throw new Error()
  } catch { throw new HkError("cx_handoff", "CX returned an invalid app handoff", 502) }
  return value
}
function safeQr(value: unknown): string {
  if (typeof value !== "string" || value.length > 450_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new HkError("cx_handoff", "CX returned an invalid QR handoff", 502)
  const bytes = Buffer.from(value, "base64")
  if (bytes.length < 8 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" || bytes.toString("base64") !== value) throw new HkError("cx_handoff", "CX returned an invalid QR handoff", 502)
  return value
}

/** Same call as {@link cxPost} but never throws on a CX result code: the result
 * endpoint reports "user has not finished" through codes, not HTTP status. */
async function cxPostRaw(path: string, body: Record<string, unknown>) {
  const c = hkConfig().cx
  const signal = AbortSignal.timeout(15_000)
  const pending = (async () => {
    const res = await fetch(`${c.baseUrl}${path}`, {
      method: "POST", redirect: "error", cache: "no-store",
      headers: { "content-type": "application/json", ...(c.apiKey ? { "x-api-key": c.apiKey } : {}) },
      body: JSON.stringify(body), signal,
    })
    if (!res.ok) { void res.body?.cancel().catch(() => undefined); throw new HkError("cx_http", `CX request failed (${res.status})`, 502, true) }
    const reader = res.body?.getReader()
    if (!reader) throw new HkError("cx_response", "CX returned an invalid response", 502)
    const chunks: Uint8Array[] = []
    let bytes = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        bytes += value.byteLength
        if (bytes > MAX_RESPONSE_BYTES) { void reader.cancel().catch(() => undefined); throw new HkError("cx_response", "CX returned an invalid response", 502) }
        chunks.push(value)
      }
    } finally { reader.releaseLock() }
    const json: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"))
    if (json && typeof json === "object" && !Array.isArray(json)) return json as Record<string, unknown>
    throw new HkError("cx_response", "CX returned an invalid response", 502)
  })()
  try {
    return await new Promise<Record<string, unknown>>((resolve, reject) => {
      const abort = () => reject(new HkError("cx_request", "CX request could not be completed", 502, true))
      signal.addEventListener("abort", abort, { once: true })
      pending.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort))
      if (signal.aborted) abort()
    })
  } catch (error) {
    // Never forward transport exceptions: they may contain URLs, bodies or tokens.
    if (error instanceof HkError) throw error
    throw new HkError("cx_response", "CX returned an invalid response", 502, true)
  }
}

async function cxPost(path: string, body: Record<string, unknown>) {
  const json = await cxPostRaw(path, body)
  const code = Number(json.resultCode ?? json.code)
  if (!Number.isInteger(code)) throw new HkError("cx_response", "CX returned an invalid result code", 502)
  if (code !== 200) throw new HkError("cx_error", `CX returned result code ${code}`, 502, code >= 500)
  return json
}

export async function cxStart(opts: { operationId: string; mobile: boolean }): Promise<CxStart> {
  const c = hkConfig().cx
  const expiresAt = plusMs(HK_TTL.identityHandoffMs)
  if (c.mode === "mock") {
    return { handoff: { kind: "mock", label: "Mobile ID sample", expiresAt } }
  }
  const trans = await cxPost("/oacx/api/v1.0/trans", { serviceType: "MID", provider: `${c.provider}_v1.5`, contentInfo: { signType: "ENT_MID" }, extraParams: { zkpType: c.zkpType }, compareCI: false, reference: opts.operationId })
  const token = handle(trans.token, "token"), txId = handle(trans.txId, "transaction reference", 512)
  if (opts.mobile) {
    const app = await cxPost("/oacx/api/v1.0/authen/app/request", { token, txId, provider: `${c.provider}_v1.5`, contentInfo: { signType: "ENT_MID" }, extraParams: { zkpType: c.zkpType }, mode: "direct" })
    const d = dataOf(app)
    transactionEcho(app, txId)
    const cxId = handle(app.cxId, "correlation reference", 512)
    const androidLink = safeAppLink(d.androidLink), iosLink = safeAppLink(d.iosLink), ssPayLink = safeAppLink(d.ssPayLink)
    if (!androidLink && !iosLink && !ssPayLink) throw new HkError("cx_handoff", "CX returned no app handoff", 502)
    return { token: handle(app.token ?? token, "token"), txId, cxId, handoff: { kind: "app", androidLink, iosLink, ssPayLink, cxId, expiresAt } }
  }
  const qr = await cxPost("/oacx/api/v1.0/authen/qr/request", { token, txId, provider: `${c.provider}_v1.5`, contentInfo: { signType: "ENT_MID" }, extraParams: { zkpType: c.zkpType } })
  const qd = dataOf(qr)
  transactionEcho(qr, txId)
  const qrCxId = handle(qr.cxId, "correlation reference", 512)
  return { token: handle(qr.token ?? token, "token"), txId, cxId: qrCxId, handoff: { kind: "qr", qrBase64: safeQr(qd.qrBase64), cxId: qrCxId, expiresAt } }
}

/** Server-side result verification. `sample` is only honoured in mock mode. */
export async function cxComplete(opts: {
  operationId: string; token?: string; txId?: string; cxId?: string; mobile: boolean
  sample?: { outcome: "verified" | "cancelled" | "failed" | "expired"; subjectSeed: string }
}): Promise<CxResult | { pending: true; token?: string } | { failed: "cancelled" | "failed" | "expired" }> {
  const c = hkConfig().cx
  // A real-provider operation cannot be downgraded by a client-supplied sample.
  // Run a separate explicitly mock-configured journey for demonstrations.
  if (c.mode === "cx" && opts.sample) throw new HkError("cx_sample_not_allowed", "Sample identity results cannot complete a provider check", 409)
  if (c.mode === "mock") {
    const s = opts.sample ?? { outcome: "verified", subjectSeed: "sample-person-1" }
    if (s.outcome !== "verified") return { failed: s.outcome }
    // subjectRef: keyed HMAC of a sample subject seed. In cx mode this comes
    // from provider correlation (ci/txid), never from name/DOB hashing.
    const subjectRef = "subj_" + hmacHex(hkConfig().opendid.signingSeed, `mock-subject:${s.subjectSeed}`).slice(2, 34)
    return { evidence: {
      evidenceId: randomId("evd"), subjectRef, source: "cx_mobile_id", mode: "mock", provider: c.provider,
      personVerified: true, adultVerified: true, verifiedAt: nowIso(), expiresAt: plusMs(HK_TTL.evidenceMs),
      providerTransactionRef: `sample-cx-${opts.operationId.slice(-8)}`,
    } }
  }
  if (!validHandle(opts.token) || !validHandle(opts.txId, 512) || !validHandle(opts.cxId, 512)) throw new HkError("cx_state", "missing CX transaction state", 409)
  // result requires provider + cxId as well (manual 2.3.3 / 2.3.4). Codes carry the
  // outcome here, so this call must not throw on a non-200 CX code.
  const result = await cxPostRaw(opts.mobile ? "/oacx/api/v1.0/authen/app/result" : "/oacx/api/v1.0/authen/qr/result", { provider: `${c.provider}_v1.5`, token: opts.token, txId: opts.txId, cxId: opts.cxId })
  transactionEcho(result, opts.txId, opts.cxId)
  const status = String(result.oacxStatus ?? result.status ?? "")
  const code = Number(result.resultCode ?? result.code)
  if (!Number.isInteger(code)) throw new HkError("cx_response", "CX returned an invalid result code", 502)
  // 402 OACX_NOT_SIGNED: the holder has not finished in the Mobile ID app yet.
  const pending = (): { pending: true; token?: string } => result.token === undefined
    ? { pending: true } : { pending: true, token: handle(result.token, "token") }
  if (code === 402 || code === 408) return pending()
  // 406 OACX_CANCLED_SIGNED: cancelled by the holder, or the request expired.
  if (code === 406) return { failed: "cancelled" }
  // 312 token expired → the handoff window is gone; treat as expired so the UI restarts it.
  if (code === 312) return { failed: "expired" }
  // 30020 OACX_VERIFIER_ERROR: no completed submission for this transaction
  // (e.g. the QR was never scanned, or the holder has no credential of this type).
  if (code === 30020) return { failed: "failed" }
  if (code !== 200) throw new HkError("cx_error", `CX result code ${code}`, 502, true)
  if (status !== "AFTER_RESULT") return pending()
  const rd = dataOf(result)
  if (rd.verified !== true) return { failed: "failed" }
  const parsed = await cxPost("/oacx/api/v1.0/trans/token", { token: handle(result.token ?? opts.token, "token") })
  // Claims are nested under `data` and include full PII (name/birth/ihidnum/address).
  // Only the correlation handle and the adult flag are read; nothing else is returned or stored.
  const claims = dataOf(parsed)
  const ci = typeof claims.ci === "string" ? claims.ci.trim() : ""
  const txid = claims.txId ?? claims.txid
  if (typeof txid !== "string" || !txid) throw new HkError("cx_transaction_missing", "CX did not return the verified transaction reference", 502)
  const returnedCxId = claims.cxId ?? claims.cxid
  if (txid !== opts.txId || (returnedCxId !== undefined && String(returnedCxId) !== opts.cxId)) {
    throw new HkError("cx_transaction_mismatch", "CX result does not match this identity request", 502)
  }
  // A new transaction is not a new person. This campaign promises one use per
  // person: an absent stable provider handle is a configuration blocker, not
  // permission to generate a fresh subject from txId on every attempt.
  if (!ci) throw new HkError("cx_subject_unavailable", "A stable provider subject is required for this one-per-person campaign", 503)
  const subjectRef = "subj_" + hmacHex(hkConfig().opendid.signingSeed, `cx-ci:${ci}`).slice(2, 34)
  const adult = claims.adult ?? claims.adultYn ?? claims.isAdult ?? (rd.zkp === true ? true : undefined)
  return { evidence: {
    evidenceId: randomId("evd"), subjectRef, source: "cx_mobile_id", mode: "cx", provider: c.provider,
    personVerified: true, adultVerified: adult === undefined ? null : Boolean(adult === true || adult === "Y" || adult === "true"),
    verifiedAt: nowIso(), expiresAt: plusMs(HK_TTL.evidenceMs), providerTransactionRef: txid,
  } }
}
