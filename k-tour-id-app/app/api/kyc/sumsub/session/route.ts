import { randomUUID } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { assertSandboxRequest, createSession, matchesAccessCode, NO_STORE_HEADERS, readSandboxConfig, readSessionBody, RECOVERY_COOKIE, SandboxError, sealSession, SESSION_COOKIE, SESSION_TTL_MS, sumsubRequest, unsealSession, unsealRecoverySession, type SandboxSession } from "@/lib/kyc/sumsub-sandbox"
import { createSumsubRecord, mutateSumsubRecord, readSumsubRecord } from "@/lib/kyc/sumsub-store"
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
function output(status: number, body: Record<string, unknown>) { return NextResponse.json(body, { status, headers: NO_STORE_HEADERS }) }
function cookies(response: NextResponse, session: SandboxSession, secret: string, secure: boolean) {
  const sealed = sealSession(session, secret)
  response.cookies.set(SESSION_COOKIE, sealed, { httpOnly: true, secure, sameSite: "lax", path: "/", expires: new Date(session.expiresAt) })
  // Opaque, same-browser recovery. It is NOT an active authentication cookie.
  response.cookies.set(RECOVERY_COOKIE, sealed, { httpOnly: true, secure, sameSite: "lax", path: "/", expires: new Date(session.recoveryExpiresAt) })
}
export async function POST(request: NextRequest) {
  const config = readSandboxConfig()
  if (!config) return output(503, { status: "unavailable", configured: false, environment: "sandbox" })
  let session: SandboxSession | null = null
  let issuedSession = false
  let secure = true
  try {
    const audience = assertSandboxRequest(request, config, true)
    secure = audience.startsWith("https:")
    const body = await readSessionBody(request)
    const active = unsealSession(request.cookies.get(SESSION_COOKIE)?.value, config, audience)
    const recovery = unsealRecoverySession(request.cookies.get(RECOVERY_COOKIE)?.value, config, audience)
    if (active) {
      const record = await readSumsubRecord(active.externalUserId, config.sessionSecret)
      if (record?.activeSessionId === active.sessionId && record.activeExpiresAt > Date.now() && record.levelName === active.levelName) session = active
    }
    if (!session) {
      if (!matchesAccessCode(body.accessCode, config.accessCode)) throw new SandboxError("access_required", 401)
      if (recovery) {
        const now = Date.now()
        const resumed = { ...recovery, sessionId: randomUUID(), issuedAt: now, expiresAt: Math.min(now + SESSION_TTL_MS, recovery.recoveryExpiresAt) }
        // Two simultaneous recovery attempts cannot invalidate each other's
        // freshly issued session. A stale active cookie can never reopen it.
        const before = await readSumsubRecord(recovery.externalUserId, config.sessionSecret)
        if (!before || before.levelName !== recovery.levelName) throw new SandboxError("session_expired", 401)
        if (before.activeSessionId && before.activeExpiresAt > now) throw new SandboxError("session_conflict", 409)
        const updated = await mutateSumsubRecord(recovery.externalUserId, config.sessionSecret, row => {
          if (row.revision !== before.revision || row.levelName !== recovery.levelName) return null
          return { ...row, activeSessionId: resumed.sessionId, activeExpiresAt: resumed.expiresAt }
        })
        if (!updated) throw new SandboxError("session_conflict", 409)
        session = resumed
        issuedSession = true
      } else {
        // A presented but invalid cookie must not silently create another applicant.
        if (request.cookies.has(SESSION_COOKIE) || request.cookies.has(RECOVERY_COOKIE)) throw new SandboxError("session_expired", 401)
        const fresh = createSession(config, audience)
        const created = await createSumsubRecord({
          version: 1, externalUserId: fresh.externalUserId, levelName: fresh.levelName,
          status: "in_progress", expiresAt: fresh.recoveryExpiresAt, activeSessionId: fresh.sessionId,
          activeExpiresAt: fresh.expiresAt, lastEventAt: 0, needsRefresh: true,
        }, config.sessionSecret)
        if (!created) throw new SandboxError("session_conflict", 409)
        session = fresh
        issuedSession = true
      }
    }
    const ttlInSecs = Math.min(600, Math.floor((session.expiresAt - Date.now()) / 1000))
    if (ttlInSecs < 10) throw new SandboxError("session_expired", 401)
    const result = await sumsubRequest(config, "/resources/accessTokens/sdk", "POST", { userId: session.externalUserId, levelName: session.levelName, ttlInSecs })
    if (typeof result.token !== "string" || result.token.length === 0 || result.token.length > 1024 || result.userId !== session.externalUserId) throw new SandboxError("invalid_provider_response")
    const current = await readSumsubRecord(session.externalUserId, config.sessionSecret)
    if (current?.activeSessionId !== session.sessionId || current.activeExpiresAt <= Date.now()) throw new SandboxError("session_expired", 401)
    const response = output(200, { accessToken: result.token, environment: "sandbox", expiresAt: session.expiresAt })
    if (issuedSession) cookies(response, session, config.sessionSecret, secure)
    return response
  } catch (error) {
    const known = error instanceof SandboxError ? error : new SandboxError("provider_unavailable")
    const response = output(known.status, {
      status: known.code === "access_required" ? "access_required" : known.code === "session_expired" ? "expired" : "unavailable",
      error: known.code, configured: true, environment: "sandbox",
    })
    // Preserve a newly created applicant on provider failure, but never let a
    // late response restore cookies from a revoked/replaced generation.
    if (session && issuedSession && known.code !== "session_expired") {
      try {
        const current = await readSumsubRecord(session.externalUserId, config.sessionSecret)
        if (current?.activeSessionId === session.sessionId && current.activeExpiresAt > Date.now()) cookies(response, session, config.sessionSecret, secure)
      } catch { /* An uncertain store cannot authorize issuing session cookies. */ }
    }
    return response
  }
}
export async function DELETE(request: NextRequest) {
  const config = readSandboxConfig()
  if (!config) return output(503, { status: "unavailable", configured: false, environment: "sandbox" })
  try {
    const audience = assertSandboxRequest(request, config, true)
    const session = unsealRecoverySession(request.cookies.get(SESSION_COOKIE)?.value, config, audience)
    if (session) {
      const revoked = await mutateSumsubRecord(session.externalUserId, config.sessionSecret, row => {
        if (row.activeSessionId !== session.sessionId) return null
        return { ...row, activeSessionId: null, activeExpiresAt: 0 }
      })
      // An old tab's delayed DELETE must not clear a newer browser session.
      if (!revoked) return new NextResponse(null, { status: 204, headers: NO_STORE_HEADERS })
    }
    const response = new NextResponse(null, { status: 204, headers: NO_STORE_HEADERS })
    response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, secure: audience.startsWith("https:"), sameSite: "lax", path: "/", maxAge: 0 })
    if (session) response.cookies.set(RECOVERY_COOKIE, sealSession(session, config.sessionSecret), {
      httpOnly: true, secure: audience.startsWith("https:"), sameSite: "lax", path: "/", expires: new Date(session.recoveryExpiresAt),
    })
    else if (!unsealRecoverySession(request.cookies.get(RECOVERY_COOKIE)?.value, config, audience))
      response.cookies.set(RECOVERY_COOKIE, "", { httpOnly: true, secure: audience.startsWith("https:"), sameSite: "lax", path: "/", maxAge: 0 })
    return response
  } catch (error) {
    const known = error instanceof SandboxError ? error : new SandboxError("store_unavailable")
    return output(known.status, { error: known.code })
  }
}
