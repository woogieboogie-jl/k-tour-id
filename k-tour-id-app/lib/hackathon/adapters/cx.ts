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

/** Same call as {@link cxPost} but never throws on a CX result code: the result
 * endpoint reports "user has not finished" through codes, not HTTP status. */
async function cxPostRaw(path: string, body: Record<string, unknown>) {
  const c = hkConfig().cx
  const res = await fetch(`${c.baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(c.apiKey ? { "x-api-key": c.apiKey } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  const text = await res.text()
  if (!res.ok) throw new HkError("cx_http", `CX ${path} ${res.status}: ${text.slice(0, 200)}`, 502, true)
  try { return JSON.parse(text) as Record<string, unknown> } catch { return {} as Record<string, unknown> }
}

async function cxPost(path: string, body: Record<string, unknown>) {
  const c = hkConfig().cx
  const res = await fetch(`${c.baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(c.apiKey ? { "x-api-key": c.apiKey } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  const text = await res.text()
  let json: Record<string, unknown> = {}
  try { json = JSON.parse(text) } catch { /* keep raw */ }
  if (!res.ok) throw new HkError("cx_http", `CX ${path} ${res.status}: ${text.slice(0, 200)}`, 502, true)
  const code = Number(json.code ?? json.resultCode ?? 200)
  if (code && code !== 200) throw new HkError("cx_error", `CX ${path} code ${code}: ${String(json.message ?? "")}`, 502, code >= 500)
  return json
}

export async function cxStart(opts: { operationId: string; mobile: boolean }): Promise<CxStart> {
  const c = hkConfig().cx
  const expiresAt = plusMs(HK_TTL.identityHandoffMs)
  if (c.mode === "mock") {
    return { handoff: { kind: "mock", label: "Mobile ID sample", expiresAt } }
  }
  const trans = await cxPost("/oacx/api/v1.0/trans", { serviceType: "MID", provider: `${c.provider}_v1.5`, contentInfo: { signType: "ENT_MID" }, extraParams: { zkpType: c.zkpType }, compareCI: false, reference: opts.operationId })
  const token = String(trans.token ?? ""), txId = String(trans.txId ?? "")
  if (!token || !txId) throw new HkError("cx_token", "CX trans did not return token/txId", 502, true)
  if (opts.mobile) {
    const app = await cxPost("/oacx/api/v1.0/authen/app/request", { token, txId, provider: `${c.provider}_v1.5`, contentInfo: { signType: "ENT_MID" }, extraParams: { zkpType: c.zkpType }, mode: "direct" })
    const d = dataOf(app)
    const cxId = String(app.cxId ?? "")
    return { token: String(app.token ?? token), txId, cxId, handoff: { kind: "app", androidLink: d.androidLink as string | undefined, iosLink: d.iosLink as string | undefined, ssPayLink: d.ssPayLink as string | undefined, cxId, expiresAt } }
  }
  const qr = await cxPost("/oacx/api/v1.0/authen/qr/request", { token, txId, provider: `${c.provider}_v1.5`, contentInfo: { signType: "ENT_MID" }, extraParams: { zkpType: c.zkpType } })
  const qd = dataOf(qr)
  const qrCxId = String(qr.cxId ?? "")
  return { token: String(qr.token ?? token), txId, cxId: qrCxId, handoff: { kind: "qr", qrBase64: String(qd.qrBase64 ?? ""), cxId: qrCxId, expiresAt } }
}

/** Server-side result verification. `sample` is only honoured in mock mode. */
export async function cxComplete(opts: {
  operationId: string; token?: string; txId?: string; cxId?: string; mobile: boolean
  sample?: { outcome: "verified" | "cancelled" | "failed" | "expired"; subjectSeed: string }
}): Promise<CxResult | { pending: true } | { failed: "cancelled" | "failed" | "expired" }> {
  const c = hkConfig().cx
  // Sample path: always in mock mode, and in live mode only when the caller explicitly
  // asked for it (holder without this credential type). Evidence stays mode "mock".
  if (c.mode === "mock" || (c.sampleFallback && opts.sample)) {
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
  if (!opts.token || !opts.txId) throw new HkError("cx_state", "missing CX token", 409)
  // result requires provider + cxId as well (manual 2.3.3 / 2.3.4). Codes carry the
  // outcome here, so this call must not throw on a non-200 CX code.
  const result = await cxPostRaw(opts.mobile ? "/oacx/api/v1.0/authen/app/result" : "/oacx/api/v1.0/authen/qr/result", { provider: `${c.provider}_v1.5`, token: opts.token, txId: opts.txId, cxId: opts.cxId })
  const status = String(result.oacxStatus ?? result.status ?? "")
  const code = Number(result.resultCode ?? result.code ?? 200)
  // 402 OACX_NOT_SIGNED: the holder has not finished in the Mobile ID app yet.
  if (code === 402 || code === 408) return { pending: true }
  // 406 OACX_CANCLED_SIGNED: cancelled by the holder, or the request expired.
  if (code === 406) return { failed: "cancelled" }
  // 312 token expired → the handoff window is gone; treat as expired so the UI restarts it.
  if (code === 312) return { failed: "expired" }
  // 30020 OACX_VERIFIER_ERROR: no completed submission for this transaction
  // (e.g. the QR was never scanned, or the holder has no credential of this type).
  if (code === 30020) return { failed: "failed" }
  if (code !== 200) throw new HkError("cx_error", `CX result code ${code}: ${String(result.oacxCode ?? "")}`, 502, true)
  if (status && status !== "AFTER_RESULT") return { pending: true }
  const rd = dataOf(result)
  if (!rd.verified) return { failed: "failed" }
  const parsed = await cxPost("/oacx/api/v1.0/trans/token", { token: String(result.token ?? opts.token) })
  // Claims are nested under `data` and include full PII (name/birth/ihidnum/address).
  // Only the correlation handle and the adult flag are read; nothing else is returned or stored.
  const claims = dataOf(parsed)
  const ci = typeof claims.ci === "string" ? claims.ci : ""
  const txid = String(claims.txId ?? claims.txid ?? opts.txId)
  // Same-person linkage: CI when provided by the provider, else provider txid+cxid (documented D1 blocker for coresidence).
  const subjectRef = "subj_" + hmacHex(hkConfig().opendid.signingSeed, ci ? `cx-ci:${ci}` : `cx-tx:${txid}:${String(claims.cxId ?? claims.cxid ?? opts.cxId ?? "")}`).slice(2, 34)
  const adult = claims.adult ?? claims.adultYn ?? claims.isAdult ?? (rd.zkp === true ? true : undefined)
  return { evidence: {
    evidenceId: randomId("evd"), subjectRef, source: "cx_mobile_id", mode: "cx", provider: String(claims.provider ?? c.provider),
    personVerified: true, adultVerified: adult === undefined ? null : Boolean(adult === true || adult === "Y" || adult === "true"),
    verifiedAt: nowIso(), expiresAt: plusMs(HK_TTL.evidenceMs), providerTransactionRef: txid,
  }, raw: { provider: claims.provider, vcTypeCode: claims.vcTypeCode, issuanceDate: claims.issuanceDate, expirationDate: claims.expirationDate } }
}
