import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { GUIDE_PRODUCTION, guideProductionPreflightIssues, type GuideProductionEnv } from "./guide-production-profile"
import { hostedIntegrationRedisConfig } from "./hosted-store-config"
import { assertIntegrationPreviewBody } from "./integration-preview-access"
import { GUIDE_SAVE_V2 } from "./guide-contract"
import { HkError } from "./util"

export const GUIDE_PRODUCTION_COOKIE = "__Host-ktour_guide_access"
const ACCESS_MS = 2 * 60 * 60_000
const unavailable = () => new HkError("guide_production_unavailable", "Guide saving is not available yet.", 503)
const denied = () => new HkError("guide_access_denied", "Enter the journey access code.", 401)
const scope = () => new HkError("guide_production_scope", "This action is not available in the guide journey.", 403)
const bad = () => new HkError("bad_request", "Invalid guide request.", 400)
const hash = (s: string) => createHash("sha256").update(s).digest()
const same = (a: string, b: string) => timingSafeEqual(hash(a), hash(b))

export function guideProductionOrigin(request: Request, env: GuideProductionEnv = process.env): string {
  const url = new URL(request.url)
  if (url.username || url.password || !["http:", "https:"].includes(url.protocol)) throw unavailable()
  const remote = Object.keys(env).some(k => k === "VERCEL" || k.startsWith("VERCEL_"))
  if (!remote && env.HK_GUIDE_LOCAL_TEST === "1" && env.NODE_ENV !== "production") {
    if (!["localhost", "127.0.0.1"].includes(url.hostname)) throw unavailable()
    return url.origin
  }
  const host = request.headers.get("host") ?? "", immutable = env.VERCEL_URL ?? ""
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.vercel\.app$/.test(immutable) ||
    (host !== immutable && !(env.VERCEL_ENV === "production" && `https://${host}` === GUIDE_PRODUCTION.origin)) ||
    request.headers.get("x-forwarded-host") !== host || request.headers.get("x-forwarded-proto") !== "https") throw unavailable()
  return `https://${host}`
}
export function assertGuideProductionTarget(request: Request, env: GuideProductionEnv = process.env, now = Date.now()) {
  const issues = guideProductionPreflightIssues(env, now)
  try { hostedIntegrationRedisConfig(env) } catch { issues.push("storage") }
  if (issues.length) throw unavailable()
  return { origin: guideProductionOrigin(request, env), expiry: Date.parse(env.HK_GUIDE_EXPIRES_AT!), secret: env.HK_GUIDE_ACCESS_SECRET!, code: env.HK_GUIDE_ACCESS_CODE! }
}
export function assertGuideProductionOrigin(request: Request, env: GuideProductionEnv = process.env) {
  const site = request.headers.get("sec-fetch-site")
  if (request.headers.get("origin") !== guideProductionOrigin(request, env) || (site && !["same-origin", "none"].includes(site))) throw new HkError("csrf", "Open this journey directly.", 403)
}
const signature = (secret: string, origin: string, payload: string) => createHmac("sha256", secret).update(`ktour-guide-access/v2:${origin}:${payload}`).digest("base64url")
export function requireGuideProductionAccess(request: Request, env: GuideProductionEnv = process.env, now = Date.now()) {
  const c = assertGuideProductionTarget(request, env, now)
  const cookies = (request.headers.get("cookie") ?? "").split(";").map(s => s.trim()).filter(s => s.startsWith(GUIDE_PRODUCTION_COOKIE + "="))
  if (cookies.length !== 1) throw denied()
  const m = /^(\d{13})\.([a-f0-9]{32})\.([A-Za-z0-9_-]{43})$/.exec(cookies[0].slice(GUIDE_PRODUCTION_COOKIE.length + 1))
  if (!m || Number(m[1]) <= now || Number(m[1]) > Math.min(c.expiry, now + ACCESS_MS) || !same(m[3], signature(c.secret, c.origin, `${m[1]}.${m[2]}`))) throw denied()
}
export function grantGuideProductionAccess(request: Request, code: unknown, env: GuideProductionEnv = process.env, now = Date.now()) {
  const c = assertGuideProductionTarget(request, env, now)
  assertGuideProductionOrigin(request, env)
  if (typeof code !== "string" || !/^[A-Za-z0-9_-]{32,128}$/.test(code) || !same(code, c.code)) throw denied()
  const expiry = Math.min(now + ACCESS_MS, c.expiry), payload = `${expiry}.${randomBytes(16).toString("hex")}`
  return Response.json({ ok: true, expiresAt: new Date(expiry).toISOString() }, { headers: {
    "cache-control": "no-store", "set-cookie": `${GUIDE_PRODUCTION_COOKIE}=${payload}.${signature(c.secret, c.origin, payload)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor((expiry - now) / 1000)}`,
  } })
}
const operation = /^op_[A-Za-z0-9_-]{8,64}$/
const actions = new Set(["identity/start", "identity/complete", "provider/issuance/start", "provider/issuance/refresh", "provider/presentation/start", "provider/presentation/refresh", "provider/cancel", "proposal", "delegation/prepare", "delegation/submit", "agent/run", "redeem", "cancel", "reconcile", "sui/agent-address"])
export function guideProductionRouteAllowed(method: string, path: string[]): boolean {
  if (!Array.isArray(path) || path.some(p => typeof p !== "string" || !p || p.includes("/"))) return false
  if (method === "GET") return (path.length === 1 && ["config", "me"].includes(path[0])) ||
    (path.length === 2 && ((path[0] === "guide" && path[1] === "collection") || (path[0] === "zklogin" && path[1] === "params"))) ||
    (path[0] === "operations" && operation.test(path[1] ?? "") && (path.length === 2 || (path.length === 3 && path[2] === "evidence")))
  if (method !== "POST") return false
  return (path.length === 1 && path[0] === "sessions") ||
    (path.length === 2 && ((path[0] === "guide" && ["access", "operations"].includes(path[1])) || (path[0] === "zklogin" && path[1] === "prove"))) ||
    (path[0] === "operations" && operation.test(path[1] ?? "") && path.length >= 3 && path.length <= 5 && actions.has(path.slice(2).join("/")))
}
export function assertGuideProductionBody(path: string[], body: Record<string, unknown>) {
  if (!guideProductionRouteAllowed("POST", path)) throw scope()
  if (!body || typeof body !== "object" || Array.isArray(body)) throw bad()
  if (path[0] === "guide" && path[1] === "access") {
    if (Object.keys(body).length !== 1 || typeof body.accessCode !== "string" || !/^[A-Za-z0-9_-]{32,128}$/.test(body.accessCode)) throw bad()
    return
  }
  assertIntegrationPreviewBody(path, body)
  if (path[0] === "guide" && (body.venueId !== GUIDE_SAVE_V2.venueId || body.consentVersion !== GUIDE_SAVE_V2.consentVersion || !["ko", "en", "ja"].includes(String(body.locale)))) throw bad()
  const action = path.slice(2).join("/")
  if (action === "delegation/prepare" && body.signer !== "zklogin") throw bad()
}
