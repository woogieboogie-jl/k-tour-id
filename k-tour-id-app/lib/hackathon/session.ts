// Cookie session for the hackathon journey. HttpOnly + SameSite=Lax; same-origin
// enforced on mutating requests (Origin/Sec-Fetch-Site) as a CSRF guard.
import { cookies, headers } from "next/headers"
import { nowIso, randomId, HkError } from "./util"
import { withStore, readStore, type SessionRecord } from "./store"

export const HK_SESSION_COOKIE = "ondo_hk_session"

export async function assertSameOrigin() {
  const h = await headers()
  const site = h.get("sec-fetch-site")
  if (site && site !== "same-origin" && site !== "none") throw new HkError("csrf", "cross-site request rejected", 403)
  const origin = h.get("origin")
  const host = h.get("x-forwarded-host") ?? h.get("host")
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) throw new HkError("csrf", "origin mismatch", 403)
    } catch (e) {
      if (e instanceof HkError) throw e
      throw new HkError("csrf", "bad origin", 403)
    }
  }
}

export async function getSession(): Promise<SessionRecord | null> {
  const jar = await cookies()
  const id = jar.get(HK_SESSION_COOKIE)?.value
  if (!id) return null
  return readStore((db) => db.sessions[id] ?? null)
}

const SESSION_ID_SHAPE = /^ses_[A-Za-z0-9_-]{16,40}$/

export async function ensureSession(): Promise<SessionRecord> {
  const existing = await getSession()
  if (existing) {
    await withStore((db) => { const s = db.sessions[existing.sessionId]; if (s) s.lastSeenAt = nowIso() })
    return existing
  }
  const jar = await cookies()
  const presented = jar.get(HK_SESSION_COOKIE)?.value
  // A well-formed cookie whose record is missing (store swapped, pruned, or two parallel
  // first requests racing to mint a cookie) is adopted instead of replaced: concurrent
  // requests then converge on one id and the browser never sees competing Set-Cookies.
  const sessionId = presented && SESSION_ID_SHAPE.test(presented) ? presented : randomId("ses", 18)
  const session = await withStore((db) => {
    const s = db.sessions[sessionId] ?? { sessionId, createdAt: nowIso(), lastSeenAt: nowIso(), subjectRef: null }
    s.lastSeenAt = nowIso()
    db.sessions[sessionId] = s
    return s
  })
  if (sessionId !== presented) jar.set(HK_SESSION_COOKIE, sessionId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 })
  return session
}

export async function requireSession(): Promise<SessionRecord> {
  const s = await getSession()
  if (!s) throw new HkError("no_session", "session required", 401)
  return s
}
