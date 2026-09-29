import { z } from "zod"
import { JIT_IDENTITY_CONSENT, JIT_IDENTITY_VERSION, type JitIdentityContext, type JitIdentityEligibility, type JitIdentityReceipt, type JitIdentityRequest } from "@/lib/hackathon/jit-identity-contract"

const date = z.string().datetime({ offset: true })
const bounded = z.string().min(1).max(256)
const contextSchema = z.object({ action: z.enum(["pass_setup", "local_moment", "table_request", "designated_perk"]), purpose: z.enum(["person", "adult", "age19"]), venueId: bounded.nullable(), tableId: bounded.nullable(), contextDigest: z.string().regex(/^0x[a-f0-9]{64}$/) }).strict()
const axis = z.object({ state: z.enum(["verified", "proof_required", "unavailable"]), expiresAt: date.nullable() }).strict()
const eligibilitySchema = z.object({ version: z.literal(JIT_IDENTITY_VERSION), provider: z.literal("omnione_cx"), execution: z.enum(["provider", "unavailable"]), person: axis, adult: z.object({ state: z.enum(["verified", "proof_required", "not_verified", "unavailable"]), expiresAt: date.nullable() }).strict(), age19: z.object({ state: z.literal("unsupported") }).strict(), paymentKyc: z.object({ state: z.literal("unsupported") }).strict(), canStart: z.boolean(), consentVersion: z.literal(JIT_IDENTITY_CONSENT) }).strict()
const requestId = z.string().regex(/^idn_[A-Za-z0-9_-]{16,32}$/)
const authorizationId = z.string().regex(/^ida_[A-Za-z0-9_-]{16,32}$/)
const handoff = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("qr"), qrBase64: z.string().min(1).max(300_000), cxId: bounded, expiresAt: date }).strict(),
  z.object({ kind: z.literal("app"), androidLink: z.string().max(8192).optional(), iosLink: z.string().max(8192).optional(), ssPayLink: z.string().max(8192).optional(), cxId: bounded, expiresAt: date }).strict(),
])
const requestSchema = z.object({ version: z.literal(JIT_IDENTITY_VERSION), requestId, status: z.enum(["awaiting_identity", "preparing", "handoff", "checking", "authorized", "completed", "denied", "cancelled", "expired", "unknown"]), context: contextSchema, expiresAt: date, handoff: handoff.nullable(), authorizationRef: authorizationId.nullable(), authorizationExpiresAt: date.nullable(), reason: z.string().max(128).nullable() }).strict()
const receiptSchema = z.object({ version: z.literal(JIT_IDENTITY_VERSION), receiptId: bounded, context: contextSchema, authorizedAt: date, expiresAt: date, evidenceExpiresAt: date, provider: z.literal("omnione_cx"), personVerified: z.literal(true), adultVerified: z.boolean(), paymentKycVerified: z.literal(false) }).strict()

export function sameJitContext(a: JitIdentityContext, b: JitIdentityContext) { return a.action === b.action && a.purpose === b.purpose && a.venueId === b.venueId && a.tableId === b.tableId && a.contextDigest === b.contextDigest }
function parseDto<T>(schema: z.ZodType<T>, value: unknown): T { const result = schema.safeParse(value); if (!result.success) throw new JitIdentityError("identity_response_invalid"); return result.data }
export function parseJitEligibility(value: unknown): JitIdentityEligibility {
  const parsed = parseDto(eligibilitySchema, value)
  if (parsed.execution !== "provider" && (parsed.canStart || parsed.person.state === "verified" || parsed.adult.state === "verified")) throw new Error("identity_response_mismatch")
  if (parsed.person.state === "verified" && (!parsed.person.expiresAt || Date.parse(parsed.person.expiresAt) <= Date.now())) throw new Error("identity_expired")
  return parsed
}
export function parseJitRequest(value: unknown, expected: JitIdentityContext, expectedId?: string): JitIdentityRequest {
  const parsed = parseDto(requestSchema, value)
  if (!sameJitContext(parsed.context, expected) || expectedId && parsed.requestId !== expectedId) throw new Error("identity_response_mismatch")
  if (parsed.status === "authorized" && (!parsed.authorizationRef || !parsed.authorizationExpiresAt || Date.parse(parsed.authorizationExpiresAt) <= Date.now() || Date.parse(parsed.expiresAt) <= Date.now())) throw new Error("identity_expired")
  if (parsed.status !== "handoff" && parsed.status !== "checking" && parsed.handoff) throw new Error("identity_handoff_mismatch")
  return parsed
}
export function parseJitReceipt(value: unknown, expected: JitIdentityContext): JitIdentityReceipt {
  const parsed = parseDto(receiptSchema, value)
  if (!sameJitContext(parsed.context, expected) || parsed.context.purpose === "age19" || parsed.context.purpose === "adult" && !parsed.adultVerified || Date.parse(parsed.expiresAt) <= Date.now() || Date.parse(parsed.evidenceExpiresAt) <= Date.now() || Date.parse(parsed.authorizedAt) > Date.now() + 5000) throw new Error("identity_receipt_mismatch")
  return parsed
}
export class JitIdentityError extends Error { constructor(public code: string, public status = 0) { super(code) } }
export const JIT_ACCESS_PATHS: Readonly<Record<string, string>> = Object.freeze({ hosted_sui_access_denied: "hosted/access", guide_access_denied: "guide/access", integration_preview_access_denied: "integration/access", cx_preview_access_denied: "preview/access" })

/** Only our same-origin BFF receives credentials. No automatic POST retry. */
export async function jitIdentityCall(path: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
  if (!/^(identity\/(eligibility|requests(?:\/idn_[A-Za-z0-9_-]{16,32}(?:\/(start|complete|cancel|receipt))?)?|authorizations\/ida_[A-Za-z0-9_-]{16,32}\/consume)|(hosted|guide|integration|preview)\/access)$/.test(path)) throw new JitIdentityError("identity_path_invalid")
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (signal?.aborted) controller.abort()
  signal?.addEventListener("abort", abort, { once: true })
  const timer = setTimeout(abort, 20_000)
  try {
    const response = await fetch(`/api/hackathon/v1/${path}`, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store", redirect: "error", headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal })
    if (controller.signal.aborted) throw new JitIdentityError("identity_request_closed")
    const reader = response.body?.getReader()
    if (!reader) throw new JitIdentityError("identity_response_invalid")
    const chunks: Uint8Array[] = []; let size = 0
    try { while (true) { const { done, value } = await reader.read(); if (controller.signal.aborted) throw new JitIdentityError("identity_request_closed"); if (done) break; size += value.byteLength; if (size > 350_000) throw new JitIdentityError("identity_response_too_large"); chunks.push(value) } } finally { void reader.cancel().catch(() => {}); reader.releaseLock() }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    const result: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (controller.signal.aborted) throw new JitIdentityError("identity_request_closed")
    if (!response.ok) { const error = result && typeof result === "object" && "error" in result ? result.error : null; const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^[a-z0-9_]{1,80}$/.test(error.code) ? error.code : "identity_unavailable"; throw new JitIdentityError(code, response.status) }
    return result
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort) }
}

export async function jitContext(input: Omit<JitIdentityContext, "contextDigest">, privateIntent: string): Promise<JitIdentityContext> {
  const bytes = new TextEncoder().encode(JSON.stringify({ ...input, privateIntent }))
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return { ...input, contextDigest: `0x${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")}` }
}

export async function consumeJitRequestReceipt(request: JitIdentityRequest, signal?: AbortSignal) {
  if (request.status !== "authorized" || !request.authorizationRef || Date.parse(request.authorizationExpiresAt ?? "") <= Date.now() || Date.parse(request.expiresAt) <= Date.now()) throw new JitIdentityError("identity_expired")
  let value: unknown
  try { value = await jitIdentityCall(`identity/authorizations/${request.authorizationRef}/consume`, request.context, signal) }
  catch (cause) { if (signal?.aborted) throw cause; value = await jitIdentityCall(`identity/requests/${request.requestId}/receipt`, undefined, signal) }
  return parseJitReceipt(value, request.context)
}

export function jitQrSource(value: string) {
  const data = value.replace(/^data:image\/png;base64,/, "")
  // PNG only: no SVG, external URL, markup, or active image format.
  return data.length <= 300_000 && /^iVBORw0KGgo[A-Za-z0-9+/=\r\n]+$/.test(data) ? `data:image/png;base64,${data}` : null
}

/** These links come only from the authenticated BFF's provider response. */
export function jitAppLink(value: string | undefined) {
  if (!value || value.length > 8192 || /[\u0000-\u0020\u007f<>]/.test(value)) return null
  let decoded = value
  for (let index = 0; index < 4; index += 1) {
    if (/(?:^|[=;])(?:javascript|vbscript|data|file|filesystem|blob|about|chrome|chrome-extension|moz-extension)\s*:/i.test(decoded) || /(?:^|;)scheme=(?:javascript|vbscript|data|file|filesystem|blob|about|chrome|chrome-extension|moz-extension)(?:;|$)/i.test(decoded)) return null
    try { const next = decodeURIComponent(decoded); if (next === decoded) break; decoded = next } catch { return null }
  }
  try { const url = new URL(value); return url.username || url.password || url.protocol === "http:" || !/^[a-z][a-z0-9+.-]*:$/.test(url.protocol) ? null : value } catch { return null }
}
