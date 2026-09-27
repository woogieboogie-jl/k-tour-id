import { NextRequest, NextResponse } from "next/server"
import { assertSandboxRequest, NO_STORE_HEADERS, readSandboxConfig, readVerifiedSandboxStatus, SandboxError, SESSION_COOKIE, unsealSession } from "@/lib/kyc/sumsub-sandbox"
import { readSumsubRecord, mutateSumsubRecord } from "@/lib/kyc/sumsub-store"
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export async function GET(request: NextRequest) {
  const config = readSandboxConfig()
  const output = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE_HEADERS })
  if (!config) return output(503, { status: "unavailable", configured: false, environment: "sandbox" })
  try {
    const audience = assertSandboxRequest(request, config, false)
    const session = unsealSession(request.cookies.get(SESSION_COOKIE)?.value, config, audience)
    if (!session) return output(200, { status: request.cookies.has(SESSION_COOKIE) ? "expired" : "access_required", configured: true, environment: "sandbox" })
    const saved = await readSumsubRecord(session.externalUserId, config.sessionSecret)
    if (!saved || saved.activeSessionId !== session.sessionId || saved.activeExpiresAt <= Date.now() || saved.levelName !== session.levelName)
      throw new SandboxError("session_expired", 401)
    // Always re-query the exact provider applicant. A signed webhook or an
    // old stored approval is never sufficient to manufacture a current result.
    const status = await readVerifiedSandboxStatus(config, session, undefined, saved.applicantId)
    const committed = await mutateSumsubRecord(session.externalUserId, config.sessionSecret, row => {
      if (row.revision !== saved.revision || row.activeSessionId !== session.sessionId || row.activeExpiresAt <= Date.now()) return null
      return { ...row, status, needsRefresh: false }
    })
    if (!committed) throw new SandboxError("status_changed_retry", 503)
    return output(200, { status, configured: true, environment: "sandbox", checkedAt: committed.updatedAt, expiresAt: session.expiresAt, retryAfterSeconds: 10 })
  } catch (error) {
    const known = error instanceof SandboxError ? error : new SandboxError("provider_unavailable")
    return output(known.status, { status: known.code === "session_expired" ? "expired" : "unavailable", configured: true, environment: "sandbox", error: known.code })
  }
}
