/** Server-only bridge-v1 client. Never import from a browser entrypoint.
 * No provider URL, owner binding, credential correlator or token is browser supplied.
 * Provider mode never falls back to the sample issuer.
 */
import { createHmac } from "node:crypto"
import { HkError } from "../util"

export type OpenDidBinding = { sessionId: string; operationId: string }
export type OpenDidCxSubject = { kind: "cx_evidence_ref"; evidenceRef: string; personVerified: true; adultVerified: boolean | null; kycRef: string }
export type OpenDidCredential = { vcId: string; issuerDid: string; schemaId: string; validFrom: string; validUntil: string; holderBinding: string }
export type OpenDidOffer = { qrPayload: string }
export type OpenDidIssuance = {
  issuanceId: string; operationId: string; state: "claimed" | "offered" | "issued" | "failed" | "cancelled" | "expired"; revision: number
  offer: OpenDidOffer | null; credential: OpenDidCredential | null; error: string | null; expiresAt: string
}
export type OpenDidPresentation = {
  presentationId: string; operationId: string; state: "claimed" | "offered" | "allowed" | "denied" | "cancelled" | "expired"; revision: number
  offer: OpenDidOffer | null; decision: { decisionRef: string; decisionExpiresAt: string } | null; denyReason: string | null; expiresAt: string
}
export type OpenDidStatus = { issuanceId: string; active: boolean; reason: string | null; checkedAt: string }
export type OpenDidBridgeClient = {
  ownerBinding(binding: OpenDidBinding): string
  issuanceStart(binding: OpenDidBinding, input: { idempotencyKey: string; subject: OpenDidCxSubject }): Promise<OpenDidIssuance>
  issuanceRefresh(binding: OpenDidBinding, issuanceId: string): Promise<OpenDidIssuance>
  issuanceCancel(binding: OpenDidBinding, issuanceId: string): Promise<OpenDidIssuance>
  credentialStatus(binding: OpenDidBinding, issuanceId: string): Promise<OpenDidStatus>
  presentationStart(binding: OpenDidBinding, issuanceId: string): Promise<OpenDidPresentation>
  presentationRefresh(binding: OpenDidBinding, presentationId: string): Promise<OpenDidPresentation>
  presentationDeny(binding: OpenDidBinding, presentationId: string): Promise<OpenDidPresentation>
}
export type OpenDidBridgeConfig = {
  baseUrl: string; trustedOrigin: string; serviceToken: string; ownerBindingSecret: string
  issuerDid: string; schemaId: string; allowLoopback?: boolean; timeoutMs?: number; maxResponseBytes?: number
}

const ID = /^[A-Za-z0-9_-]{8,64}$/
const CODE = /^[a-z][a-z0-9_]{0,79}$/
const bad = () => new HkError("opendid_provider_response", "OpenDID returned an invalid or mismatched response", 502)
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw bad()
  const o = value as Record<string, unknown>
  if (Object.keys(o).length !== keys.length || keys.some(k => !Object.hasOwn(o, k))) throw bad()
  return o
}
function text(value: unknown, max = 2048): string {
  if (typeof value !== "string" || !value.length || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw bad()
  return value
}
function id(value: unknown): string { const s = text(value, 64); if (!ID.test(s)) throw bad(); return s }
function code(value: unknown): string | null { if (value === null) return null; const s = text(value, 80); if (!CODE.test(s)) throw bad(); return s }
export function openDidUtcTime(value: unknown): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) throw bad()
  const t = Date.parse(value)
  if (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 19) !== value.slice(0, 19)) throw bad()
  return t
}
function date(value: unknown): string { openDidUtcTime(value); return value as string }
function revision(value: unknown): number { if (!Number.isSafeInteger(value) || (value as number) < 0) throw bad(); return value as number }
function offer(value: unknown): OpenDidOffer | null {
  if (value === null) return null
  const o = record(value, ["qrPayload"])
  return { qrPayload: text(o.qrPayload, 8192) }
}
function parseIssuance(value: unknown, binding: OpenDidBinding, expectedId: string | undefined, cfg: OpenDidBridgeConfig): OpenDidIssuance {
  const o = record(value, ["issuanceId", "operationId", "state", "revision", "offer", "credential", "error", "expiresAt"])
  const issuanceId = id(o.issuanceId), operationId = id(o.operationId)
  if (operationId !== binding.operationId || (expectedId && issuanceId !== expectedId)) throw bad()
  if (!["claimed", "offered", "issued", "failed", "cancelled", "expired"].includes(o.state as string)) throw bad()
  let credential: OpenDidCredential | null = null
  if (o.credential !== null) {
    const c = record(o.credential, ["vcId", "issuerDid", "schemaId", "validFrom", "validUntil", "holderBinding"])
    if (c.issuerDid !== cfg.issuerDid || c.schemaId !== cfg.schemaId || typeof c.holderBinding !== "string" || !/^0x[0-9a-f]{64}$/.test(c.holderBinding)) throw bad()
    credential = { vcId: text(c.vcId, 256), issuerDid: text(c.issuerDid), schemaId: text(c.schemaId), validFrom: date(c.validFrom), validUntil: date(c.validUntil), holderBinding: c.holderBinding }
    if (openDidUtcTime(credential.validUntil) <= openDidUtcTime(credential.validFrom)) throw bad()
  }
  const qr = offer(o.offer), error = code(o.error)
  if ((o.state === "issued") !== !!credential || (qr && o.state !== "offered") || (o.state === "issued" && error)) throw bad()
  return { issuanceId, operationId, state: o.state as OpenDidIssuance["state"], revision: revision(o.revision), offer: qr, credential, error, expiresAt: date(o.expiresAt) }
}
function parsePresentation(value: unknown, binding: OpenDidBinding, expectedId?: string): OpenDidPresentation {
  const o = record(value, ["presentationId", "operationId", "state", "revision", "offer", "decision", "denyReason", "expiresAt"])
  const presentationId = id(o.presentationId), operationId = id(o.operationId)
  if (operationId !== binding.operationId || (expectedId && presentationId !== expectedId)) throw bad()
  if (!["claimed", "offered", "allowed", "denied", "cancelled", "expired"].includes(o.state as string)) throw bad()
  let decision: OpenDidPresentation["decision"] = null
  if (o.decision !== null) { const d = record(o.decision, ["decisionRef", "decisionExpiresAt"]); decision = { decisionRef: id(d.decisionRef), decisionExpiresAt: date(d.decisionExpiresAt) } }
  const qr = offer(o.offer), denyReason = code(o.denyReason), expiresAt = date(o.expiresAt)
  if ((o.state === "allowed") !== !!decision || (qr && o.state !== "offered") || (decision && (denyReason || openDidUtcTime(decision.decisionExpiresAt) > openDidUtcTime(expiresAt)))) throw bad()
  return { presentationId, operationId, state: o.state as OpenDidPresentation["state"], revision: revision(o.revision), offer: qr, decision, denyReason, expiresAt }
}
function parseStatus(value: unknown, issuanceId: string): OpenDidStatus {
  const o = record(value, ["issuanceId", "active", "reason", "checkedAt"])
  if (id(o.issuanceId) !== issuanceId || typeof o.active !== "boolean") throw bad()
  const reason = code(o.reason)
  if (o.active && reason !== null) throw bad()
  return { issuanceId, active: o.active, reason, checkedAt: date(o.checkedAt) }
}

export function createOpenDidBridgeClient(config: OpenDidBridgeConfig, fetcher: typeof fetch = fetch): OpenDidBridgeClient {
  if (typeof window !== "undefined") throw new Error("OpenDID bridge client is server-only")
  const cfg = { ...config }
  let base: URL, trusted: URL
  try { base = new URL(cfg.baseUrl); trusted = new URL(cfg.trustedOrigin) } catch { throw new HkError("opendid_provider_configuration", "OpenDID bridge configuration is invalid", 503) }
  const loopback = ["127.0.0.1", "[::1]", "localhost"].includes(base.hostname)
  if (base.origin !== trusted.origin || trusted.href !== `${trusted.origin}/` || base.pathname !== "/" || base.search || base.hash || base.username || base.password || (base.protocol !== "https:" && !(cfg.allowLoopback && loopback && base.protocol === "http:"))) throw new HkError("opendid_provider_configuration", "OpenDID bridge origin is not trusted", 503)
  if (!/^[\x21-\x7e]{32,4096}$/.test(cfg.serviceToken) || typeof cfg.ownerBindingSecret !== "string" || cfg.ownerBindingSecret.length < 32 || !cfg.issuerDid || !cfg.schemaId) throw new HkError("opendid_provider_configuration", "OpenDID bridge trust configuration is incomplete", 503)
  const timeoutMs = cfg.timeoutMs ?? 5000, maxBytes = cfg.maxResponseBytes ?? 32768
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 10000 || !Number.isSafeInteger(maxBytes) || maxBytes < 256 || maxBytes > 131072) throw new HkError("opendid_provider_configuration", "OpenDID transport limits are invalid", 503)
  const ownerBinding = (b: OpenDidBinding) => {
    if (!ID.test(b.operationId) || typeof b.sessionId !== "string" || b.sessionId.length < 8 || b.sessionId.length > 512) throw new HkError("opendid_binding", "OpenDID operation binding is invalid", 400)
    return createHmac("sha256", cfg.ownerBindingSecret).update(JSON.stringify(["ktour-opendid-owner/v1", b.sessionId, b.operationId])).digest("hex")
  }
  async function request(binding: OpenDidBinding, method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
    const owner = ownerBinding(binding), controller = new AbortController()
    let timedOut = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { timedOut = true; controller.abort(); reject(new HkError("opendid_provider_timeout", "OpenDID service timed out; check the same request again", 504, true)) }, timeoutMs) })
    const work = async () => {
      const res = await fetcher(new URL(path, base), { method, redirect: "error", cache: "no-store", signal: controller.signal,
        headers: { authorization: `Bearer ${cfg.serviceToken}`, "x-ktour-owner": owner, accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
      if (res.redirected || (res.url && new URL(res.url).origin !== base.origin)) throw bad()
      if (!/^application\/json(?:\s*;|$)/i.test(res.headers.get("content-type") ?? "")) throw bad()
      const length = res.headers.get("content-length")
      if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) { await res.body?.cancel(); throw bad() }
      const reader = res.body?.getReader()
      if (!reader) throw bad()
      const chunks: Uint8Array[] = []; let size = 0
      try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > maxBytes) { await reader.cancel(); throw bad() }; chunks.push(value) } } finally { reader.releaseLock() }
      let parsed: unknown
      try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) } catch { throw bad() }
      if (!res.ok) {
        // Validate the envelope, but do not propagate provider strings, correlators or URLs.
        const e = record(record(parsed, ["error"]).error, ["code", "message"]); code(e.code); text(e.message, 1024)
        throw new HkError("opendid_provider_rejected", "OpenDID could not complete this request", res.status === 404 ? 404 : res.status === 409 ? 409 : 502, res.status >= 500 || res.status === 429)
      }
      return parsed
    }
    try { return await Promise.race([work(), deadline]) } catch (e) {
      if (e instanceof HkError) throw e
      throw new HkError(timedOut ? "opendid_provider_timeout" : "opendid_provider_unavailable", "OpenDID service is unavailable; check the same request again", timedOut ? 504 : 503, true)
    } finally { if (timer) clearTimeout(timer); controller.abort() }
  }
  const issuance = async (b: OpenDidBinding, method: "GET" | "POST", path: string, expected?: string, body?: unknown) => parseIssuance(await request(b, method, path, body), b, expected, cfg)
  const presentation = async (b: OpenDidBinding, method: "GET" | "POST", path: string, expected?: string, body?: unknown) => parsePresentation(await request(b, method, path, body), b, expected)
  return {
    ownerBinding,
    issuanceStart: (b, input) => {
      id(input.idempotencyKey)
      const s = record(input.subject, ["kind", "evidenceRef", "personVerified", "adultVerified", "kycRef"])
      if (s.kind !== "cx_evidence_ref" || s.personVerified !== true || !(s.adultVerified === null || typeof s.adultVerified === "boolean") || typeof s.kycRef !== "string" || !/^[0-9a-f]{64}$/.test(s.kycRef)) throw new HkError("opendid_cx_mapping_unavailable", "Verified CX-to-OpenDID identity mapping is required", 503)
      id(s.evidenceRef)
      return issuance(b, "POST", "/bridge/v1/issuances", undefined, { operationId: b.operationId, idempotencyKey: input.idempotencyKey, subject: s })
    },
    issuanceRefresh: (b, i) => issuance(b, "GET", `/bridge/v1/issuances/${id(i)}`, i),
    issuanceCancel: (b, i) => issuance(b, "POST", `/bridge/v1/issuances/${id(i)}/cancel`, i),
    credentialStatus: async (b, i) => parseStatus(await request(b, "GET", `/bridge/v1/issuances/${id(i)}/status`), i),
    presentationStart: (b, i) => presentation(b, "POST", "/bridge/v1/presentations", undefined, { issuanceId: id(i), kind: "vp" }),
    presentationRefresh: (b, i) => presentation(b, "GET", `/bridge/v1/presentations/${id(i)}`, i),
    presentationDeny: (b, i) => presentation(b, "POST", `/bridge/v1/presentations/${id(i)}/deny`, i),
  }
}

export type OpenDidCxEvidence = { source: "cx_mobile_id"; mode: "cx"; evidenceRef: string; personVerified: boolean; adultVerified: boolean | null; expiresAt: string }
export type VerifiedCxKycBinding = { evidenceRef: string; kycRef: string; mappingVersion: "cx-cas-v1" }
/** The resolver must independently verify a real holder/CAS binding. Hashing an arbitrary
 * evidence ID is NOT a mapping. No resolver is provided until the native/CAS contract exists. */
export async function resolveOpenDidCxSubject(evidence: OpenDidCxEvidence, resolver?: (e: OpenDidCxEvidence) => Promise<VerifiedCxKycBinding | null>, now = Date.now()): Promise<OpenDidCxSubject> {
  if (evidence.source !== "cx_mobile_id" || evidence.mode !== "cx" || evidence.personVerified !== true || openDidUtcTime(evidence.expiresAt) <= now) throw new HkError("opendid_identity_required", "Current verified CX identity is required", 409)
  id(evidence.evidenceRef)
  if (!resolver) throw new HkError("opendid_cx_mapping_unavailable", "CX-to-OpenDID holder mapping is not connected", 503)
  const mapped = await resolver({ ...evidence })
  if (!mapped || mapped.mappingVersion !== "cx-cas-v1" || mapped.evidenceRef !== evidence.evidenceRef || !/^[0-9a-f]{64}$/.test(mapped.kycRef)) throw new HkError("opendid_cx_mapping_unavailable", "CX-to-OpenDID holder mapping could not be verified", 503)
  return { kind: "cx_evidence_ref", evidenceRef: evidence.evidenceRef, personVerified: true, adultVerified: evidence.adultVerified, kycRef: mapped.kycRef }
}
