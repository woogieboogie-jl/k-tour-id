import { NextRequest, NextResponse } from "next/server"
import { mutateSumsubRecord, readSumsubRecord } from "@/lib/kyc/sumsub-store"
import { NO_STORE_HEADERS, readBoundedRequestBody, readSandboxConfig, SandboxError, sumsubRequest, verifyWebhookSignature, webhookCreatedAt, webhookEventId } from "@/lib/kyc/sumsub-sandbox"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
const EVENT_TYPES = new Set(["applicantCreated", "applicantPending", "applicantReviewed", "applicantOnHold", "applicantReset", "applicantDeleted"])
function output(status: number, body: Record<string, unknown>) { return NextResponse.json(body, { status, headers: NO_STORE_HEADERS }) }
export async function POST(request: NextRequest) {
  const config = readSandboxConfig()
  if (!config?.webhookSecret) return output(503, { error: "unavailable" })
  const webhookSecret = config.webhookSecret
  const deadline = Date.now() + 8_000, controller = new AbortController()
  let expired = false, timer: ReturnType<typeof setTimeout> | undefined
  const assertLive = () => { if (expired || Date.now() >= deadline) throw new SandboxError("unavailable") }
  const work = async () => {
   try {
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new SandboxError("invalid_payload", 415)
    const raw = await readBoundedRequestBody(request, 256 * 1024, 1_000)
    assertLive()
    if (!verifyWebhookSignature(webhookSecret, raw, request.headers.get("x-payload-digest"), request.headers.get("x-payload-digest-alg"))) return output(401, { error: "invalid_signature" })
    let value: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw))
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error()
      value = parsed as Record<string, unknown>
    } catch { throw new SandboxError("invalid_payload", 400) }
    const applicantId = value.applicantId, externalUserId = value.externalUserId
    if (typeof applicantId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(applicantId) || typeof externalUserId !== "string" || !/^ktour-sbx-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(externalUserId)
      || value.sandboxMode !== true || value.levelName !== config.levelName || typeof value.type !== "string" || !EVENT_TYPES.has(value.type)) throw new SandboxError("invalid_payload", 400)
    // testMode is a manual dashboard send, NOT the Sandbox environment marker.
    // A signed manual fixture acknowledges delivery but must never affect a user.
    if (value.testMode === true) return output(200, { ok: true, applied: false })
    if (value.testMode !== undefined && value.testMode !== false) throw new SandboxError("invalid_payload", 400)
    const createdAt = webhookCreatedAt(value.createdAtMs)
    if (createdAt === null) throw new SandboxError("invalid_payload", 400)
    const eventId = webhookEventId(value, raw)
    const saved = await readSumsubRecord(externalUserId, config.sessionSecret)
    assertLive()
    if (!saved || (saved.applicantId && saved.applicantId !== applicantId) || saved.levelName !== config.levelName) throw new SandboxError("invalid_payload", 400)
    if (saved.lastEventId === eventId || createdAt <= (saved.lastEventAt ?? 0)) return output(200, { ok: true, applied: false })
    const applicant = await sumsubRequest(config, `/resources/applicants/-;externalUserId=${encodeURIComponent(externalUserId)}/one`, "GET", undefined,
      (url, init) => fetch(url, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal }))
    assertLive()
    if (applicant.id !== applicantId || applicant.externalUserId !== externalUserId || applicant.sandboxMode !== true) throw new SandboxError("invalid_payload", 400)
    const changed = await mutateSumsubRecord(externalUserId, config.sessionSecret, current => {
      assertLive()
      if (current.levelName !== config.levelName || (current.applicantId && current.applicantId !== applicantId)
        || current.lastEventId === eventId || createdAt <= (current.lastEventAt ?? 0)) return null
      // Preserve status and every session/revocation field. Only an authenticated
      // subsequent GET of provider status can supply a newly checked outcome.
      return { ...current, applicantId, lastEventId: eventId, lastEventAt: createdAt, needsRefresh: true }
    })
    return output(200, { ok: true, applied: changed !== null })
   } catch (error) {
    if (error instanceof SandboxError && error.status >= 400 && error.status < 500 && error.code !== "applicant_not_found") return output(error.status, { error: "invalid_payload" })
    // Provider and durable-store faults must be retryable; never expose payloads,
    // applicant identifiers, provider responses, credentials or Redis details.
    return output(503, { error: "unavailable" })
   }
  }
  try {
    const timeout = new Promise<NextResponse>(resolve => { timer = setTimeout(() => {
      expired = true; controller.abort(); resolve(output(503, { error: "unavailable" }))
    }, 8_000) })
    return await Promise.race([work(), timeout])
  } finally {
    expired = true; if (timer) clearTimeout(timer); controller.abort()
  }
}
