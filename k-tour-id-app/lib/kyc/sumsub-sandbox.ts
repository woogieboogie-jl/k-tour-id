// Server-only Sumsub Sandbox adapter. It never issues credentials or grants
// eligibility; the provider review is reduced to a bounded status enum.
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto"

export type SandboxConfig = { appToken: string; secretKey: string; webhookSecret?: string; sessionSecret: string; accessCode: string; levelName: string; origins: string[] }
export type SandboxSession = { version: 1; environment: "sandbox"; externalUserId: string; sessionId: string; levelName: string; audience: string; issuedAt: number; expiresAt: number; recoveryExpiresAt: number }
export type SandboxStatus = "access_required" | "not_started" | "in_progress" | "pending" | "approved" | "retry" | "rejected" | "expired" | "unavailable"
export const SESSION_TTL_MS = 30 * 60 * 1000
export const RECOVERY_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const SESSION_COOKIE = "ktour_sumsub_sandbox"
export const RECOVERY_COOKIE = "ktour_sumsub_sandbox_recovery"
export const SUMSUB_PREVIEW_EXPIRY_CUTOFF = Date.parse("2026-09-30T14:59:59.000Z")
export class SandboxError extends Error { constructor(public code: string, public status = 503) { super(code) } }

export function isPreviewExpiryValid(value: string | undefined, now = Date.now()): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false
  const expiry = Date.parse(value)
  if (!Number.isFinite(expiry) || expiry <= now) return false
  return expiry <= Math.min(now + 30 * 24 * 60 * 60 * 1000, SUMSUB_PREVIEW_EXPIRY_CUTOFF)
}

export function readSandboxConfig(env: Record<string, string | undefined> = process.env, now = Date.now()): SandboxConfig | null {
  if (env.SUMSUB_MODE !== "sandbox" || env.NEXT_PUBLIC_ONDO_SUMSUB_SANDBOX !== "1" || env.NEXT_PUBLIC_HK_PREVIEW_READ_ONLY === "1" || env.NEXT_PUBLIC_HK_CX_PREVIEW === "1" || env.VERCEL_ENV === "production") return null
  if (env.VERCEL_ENV === "preview" && !isPreviewExpiryValid(env.SUMSUB_PREVIEW_EXPIRES_AT, now)) return null
  const appToken = env.SUMSUB_APP_TOKEN, secretKey = env.SUMSUB_SECRET_KEY, webhookSecret = env.SUMSUB_WEBHOOK_SECRET, sessionSecret = env.SUMSUB_SESSION_SECRET, accessCode = env.SUMSUB_PREVIEW_ACCESS_CODE, levelName = env.SUMSUB_LEVEL_NAME
  if (!appToken?.startsWith("sbx:") || !secretKey || !sessionSecret || sessionSecret.length < 32 || !accessCode || accessCode.length < 16 || accessCode.length > 256 || !levelName || !/^[A-Za-z0-9_-]{1,100}$/.test(levelName)) return null
  const origins = (env.SUMSUB_ALLOWED_ORIGINS ?? "").split(",").filter(Boolean).flatMap(value => {
    try { const u = new URL(value.trim()); return u.origin === value.trim() && !u.hostname.includes("*") && (u.protocol === "https:" || (env.NODE_ENV !== "production" && u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname))) ? [u.origin] : [] } catch { return [] }
  })
  if (env.VERCEL_ENV === "preview" && env.VERCEL_URL && /^[A-Za-z0-9.-]+\.vercel\.app$/.test(env.VERCEL_URL)) origins.push(`https://${env.VERCEL_URL}`)
  return origins.length ? { appToken, secretKey, webhookSecret, sessionSecret, accessCode, levelName, origins } : null
}

const key = (secret: string) => createHash("sha256").update(`ktour-sumsub-sandbox-v1:${secret}`).digest()
export function sealSession(session: SandboxSession, secret: string): string { const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key(secret), iv); cipher.setAAD(Buffer.from("ktour-sumsub-sandbox:v1")); const data = Buffer.concat([cipher.update(JSON.stringify(session), "utf8"), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url") }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
function decodeSession(value: string | undefined, config: SandboxConfig, audience: string, now: number): SandboxSession | null {
  if (!value || value.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(value)) return null
  try {
    const bytes = Buffer.from(value, "base64url")
    if (bytes.length < 29) return null
    const decipher = createDecipheriv("aes-256-gcm", key(config.sessionSecret), bytes.subarray(0, 12))
    decipher.setAAD(Buffer.from("ktour-sumsub-sandbox:v1")); decipher.setAuthTag(bytes.subarray(12, 28))
    const s = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8")) as SandboxSession
    return s.version === 1 && s.environment === "sandbox" && s.levelName === config.levelName && s.audience === audience
      && typeof s.externalUserId === "string" && s.externalUserId.startsWith("ktour-sbx-") && UUID.test(s.externalUserId.slice(10)) && UUID.test(s.sessionId)
      && Number.isSafeInteger(s.issuedAt) && Number.isSafeInteger(s.expiresAt) && Number.isSafeInteger(s.recoveryExpiresAt)
      && s.issuedAt <= now && s.expiresAt > s.issuedAt && s.expiresAt - s.issuedAt <= SESSION_TTL_MS
      && s.expiresAt <= s.recoveryExpiresAt && s.recoveryExpiresAt > now && s.recoveryExpiresAt - s.issuedAt <= RECOVERY_TTL_MS ? s : null
  } catch { return null }
}
export function unsealSession(value: string | undefined, config: SandboxConfig, audience: string, now = Date.now()): SandboxSession | null { const session = decodeSession(value, config, audience, now); return session && session.expiresAt > now ? session : null }
export function unsealRecoverySession(value: string | undefined, config: SandboxConfig, audience: string, now = Date.now()): SandboxSession | null { return decodeSession(value, config, audience, now) }
export function createSession(config: SandboxConfig, audience: string, now = Date.now()): SandboxSession { return { version: 1, environment: "sandbox", externalUserId: `ktour-sbx-${randomUUID()}`, sessionId: randomUUID(), levelName: config.levelName, audience, issuedAt: now, expiresAt: now + SESSION_TTL_MS, recoveryExpiresAt: now + RECOVERY_TTL_MS } }
export function matchesAccessCode(candidate: unknown, expected: string): boolean { if (typeof candidate !== "string" || candidate.length > 256) return false; return timingSafeEqual(createHash("sha256").update(candidate).digest(), createHash("sha256").update(expected).digest()) }
export function assertSandboxRequest(request: Request, config: SandboxConfig, mutation: boolean): string {
  const url = new URL(request.url)
  if (url.username || url.password || !["http:", "https:"].includes(url.protocol)) throw new SandboxError("request_not_allowed", 403)
  let audience = url.origin
  if (process.env.VERCEL === "1" || process.env.VERCEL_ENV) {
    const host = process.env.VERCEL_URL
    if (process.env.VERCEL !== "1" || process.env.VERCEL_ENV !== "preview" || !host || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.vercel\.app$/.test(host)
      || request.headers.get("host") !== host || request.headers.get("x-forwarded-host") !== host || request.headers.get("x-forwarded-proto") !== "https") throw new SandboxError("request_not_allowed", 403)
    audience = `https://${host}`
  }
  if (!config.origins.includes(audience) || request.headers.get("x-ktour-kyc") !== "1") throw new SandboxError("request_not_allowed", 403)
  const origin = request.headers.get("origin")
  if ((mutation && origin !== audience) || (origin !== null && origin !== audience)) throw new SandboxError("request_not_allowed", 403)
  const site = request.headers.get("sec-fetch-site")
  if (site && site !== "same-origin" && site !== "none") throw new SandboxError("request_not_allowed", 403)
  if (request.method === "POST" && request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new SandboxError("invalid_request", 415)
  return audience
}
export function signSumsubRequest(secret: string, timestamp: string, method: string, path: string, body = ""): string { return createHmac("sha256", secret).update(timestamp + method.toUpperCase() + path + body).digest("hex") }

const MAX_PROVIDER_BYTES = 256 * 1024
function discard(stream: ReadableStream<Uint8Array> | null) { try { void stream?.cancel().catch(() => undefined) } catch { /* cleanup cannot disclose transport errors */ } }
async function streamBytes(stream: ReadableStream<Uint8Array> | null, maxBytes: number, signal: AbortSignal, error: SandboxError): Promise<Buffer> {
  if (!stream || signal.aborted) { discard(stream); throw error }
  const reader = stream.getReader(), chunks: Uint8Array[] = []
  const cancel = () => { try { void reader.cancel().catch(() => undefined) } catch { /* best effort without waiting on hostile transport */ } }
  signal.addEventListener("abort", cancel, { once: true })
  let size = 0, complete = false
  try {
    for (;;) {
      const next = await reader.read()
      if (signal.aborted) throw error
      if (next.done) break
      size += next.value.byteLength
      if (size > maxBytes) throw error
      chunks.push(next.value)
    }
    complete = true
    return Buffer.concat(chunks)
  } finally {
    signal.removeEventListener("abort", cancel)
    if (!complete) cancel()
    try { reader.releaseLock() } catch { /* a stalled reader is already being cancelled */ }
  }
}
async function bounded<T>(work: (signal: AbortSignal) => Promise<T>, timeoutMs: number, error: SandboxError): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(error) }, timeoutMs) })
    return await Promise.race([work(controller.signal), deadline])
  } finally { if (timer) clearTimeout(timer); controller.abort() }
}
export async function readBoundedRequestBody(request: Request, maxBytes = 1024, timeoutMs = 5_000): Promise<Buffer> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_PROVIDER_BYTES || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15_000) throw new SandboxError("invalid_request", 400)
  try {
    return await bounded(signal => streamBytes(request.body, maxBytes, signal, new SandboxError("invalid_request", 413)), timeoutMs, new SandboxError("invalid_request", 408))
  } catch (error) { if (error instanceof SandboxError) throw error; throw new SandboxError("invalid_request", 400) }
}
async function providerJson(url: string, init: RequestInit, code: "provider_unavailable", fetcher: typeof fetch = fetch): Promise<Record<string, unknown>> {
  try {
    return await bounded(async signal => {
      const response = await fetcher(url, { ...init, redirect: "error", cache: "no-store", signal })
      if (signal.aborted) { discard(response.body); throw new SandboxError(code) }
      if (!response.ok) { discard(response.body); throw new SandboxError(response.status === 404 ? "applicant_not_found" : code, response.status === 404 ? 404 : 503) }
      const raw = await streamBytes(response.body, MAX_PROVIDER_BYTES, signal, new SandboxError("invalid_provider_response"))
      let value: unknown
      try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)) } catch { throw new SandboxError("invalid_provider_response") }
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new SandboxError("invalid_provider_response")
      return value as Record<string, unknown>
    }, 15_000, new SandboxError(code))
  } catch (error) { if (error instanceof SandboxError) throw error; throw new SandboxError(code) }
}
export async function sumsubRequest(config: SandboxConfig, path: string, method: "GET" | "POST" = "GET", body?: unknown, fetcher: typeof fetch = fetch): Promise<Record<string, unknown>> { if (!path.startsWith("/resources/") || /[\r\n#?]/.test(path)) throw new SandboxError("invalid_provider_path"); const payload = body === undefined ? "" : JSON.stringify(body); const timestamp = String(Math.floor(Date.now() / 1000)); return providerJson(`https://api.sumsub.com${path}`, { method, headers: { "X-App-Token": config.appToken, "X-App-Access-Ts": timestamp, "X-App-Access-Sig": signSumsubRequest(config.secretKey, timestamp, method, path, payload), ...(payload ? { "Content-Type": "application/json" } : {}) }, ...(payload ? { body: payload } : {}) }, "provider_unavailable", fetcher) }
export function normalizeReview(value: Record<string, unknown>): SandboxStatus { const result = value.reviewResult as Record<string, unknown> | undefined; if (value.reviewStatus === "completed") { if (result?.reviewAnswer === "GREEN") return "approved"; if (result?.reviewAnswer === "RED" && result.reviewRejectType === "RETRY") return "retry"; if (result?.reviewAnswer === "RED" && result.reviewRejectType === "FINAL") return "rejected"; return "unavailable" } if (["pending", "queued", "onHold", "awaitingService"].includes(String(value.reviewStatus))) return "pending"; if (["init", "prechecked", "awaitingUser"].includes(String(value.reviewStatus))) return "in_progress"; return "unavailable" }
export async function readVerifiedSandboxStatus(config: SandboxConfig, session: SandboxSession, fetcher: typeof fetch = fetch, expectedApplicantId?: string): Promise<SandboxStatus> { if (!config.appToken.startsWith("sbx:") || session.environment !== "sandbox") throw new SandboxError("provider_binding_mismatch"); let applicant: Record<string, unknown>; try { applicant = await sumsubRequest(config, `/resources/applicants/-;externalUserId=${encodeURIComponent(session.externalUserId)}/one`, "GET", undefined, fetcher) } catch (error) { if (error instanceof SandboxError && error.code === "applicant_not_found" && expectedApplicantId === undefined) return "in_progress"; throw error } if (applicant.externalUserId !== session.externalUserId || applicant.sandboxMode !== true || typeof applicant.id !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(applicant.id) || (expectedApplicantId !== undefined && applicant.id !== expectedApplicantId)) throw new SandboxError("provider_binding_mismatch"); const review = await sumsubRequest(config, `/resources/applicants/${encodeURIComponent(applicant.id)}/status`, "GET", undefined, fetcher); if (review.levelName !== session.levelName) throw new SandboxError("provider_binding_mismatch"); return normalizeReview(review) }
export async function readSessionBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const raw = await readBoundedRequestBody(request)
    const body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw))
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !["consent", "accessCode", "locale"].includes(key)) || body.consent !== true || (body.accessCode !== undefined && (typeof body.accessCode !== "string" || body.accessCode.length > 256)) || (body.locale !== undefined && !["en", "ko", "ja"].includes(body.locale))) throw new Error()
    return body as Record<string, unknown>
  } catch (error) { if (error instanceof SandboxError) throw error; throw new SandboxError("invalid_request", 400) }
}
export const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache", "X-Content-Type-Options": "nosniff", Vary: "Cookie, Origin" }

export type WebhookEvent = { eventId: string; applicantId: string; externalUserId?: string; levelName?: string; status: SandboxStatus; receivedAt: number }
export function verifyWebhookSignature(secret: string, rawBody: string | Uint8Array, digest: string | null, algorithm: string | null): boolean {
  const hash = algorithm === "HMAC_SHA256_HEX" ? "sha256" : algorithm === "HMAC_SHA512_HEX" ? "sha512" : null
  if (!secret || !hash || !digest || !/^[0-9a-f]+$/i.test(digest) || digest.length !== (hash === "sha256" ? 64 : 128)) return false
  const expected = createHmac(hash, secret).update(rawBody).digest(), actual = Buffer.from(digest, "hex")
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
export function webhookStatus(value: Record<string, unknown>): SandboxStatus { return normalizeReview(value) }
export function webhookEventId(value: Record<string, unknown>, rawBody: string | Uint8Array): string { const supplied = value.webhookId ?? value.eventId; return typeof supplied === "string" && /^[A-Za-z0-9:_-]{1,160}$/.test(supplied) ? supplied : createHash("sha256").update(rawBody).digest("hex") }
// Sumsub documents createdAtMs as a UTC date string, not an epoch or local time.
export function webhookCreatedAt(value: unknown, now = Date.now()): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/.test(value)) return null
  const iso = value.replace(" ", "T") + "Z", timestamp = Date.parse(iso)
  return Number.isFinite(timestamp) && timestamp >= 0 && timestamp <= now + 5 * 60 * 1000 && new Date(timestamp).toISOString() === iso ? timestamp : null
}
