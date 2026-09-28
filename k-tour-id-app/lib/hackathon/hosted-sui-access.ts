import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { hostedSuiPreflightIssues } from "./hosted-sui-profile"
import { hostedIntegrationRedisConfig } from "./hosted-store-config"
import { HkError } from "./util"

type Env = Record<string, string | undefined>
export const HOSTED_SUI_COOKIE = "__Host-ktour_sui_access"
const ACCESS_MS = 2 * 60 * 60_000
const unavailable = () => new HkError("hosted_sui_unavailable", "The journey is unavailable. Please try again later.", 503)
const denied = () => new HkError("hosted_sui_access_denied", "Enter the journey access code.", 401)
const hash = (v: string) => createHash("sha256").update(v).digest()
const same = (a: string, b: string) => timingSafeEqual(hash(a), hash(b))

/** A production alias and its immutable deployment each get host-bound cookies.
 * Next's internal request URL is not the public authority behind Vercel's proxy. */
export function hostedSuiOrigin(request: Request, env: Env = process.env) {
  const url = new URL(request.url)
  if (url.username || url.password || !["http:", "https:"].includes(url.protocol)) throw unavailable()
  if (env.HK_HOSTED_SUI_LOCAL_TEST === "1" && !Object.keys(env).some(k => k === "VERCEL" || k.startsWith("VERCEL_")) && env.NODE_ENV !== "production") {
    if (!["localhost", "127.0.0.1"].includes(url.hostname)) throw unavailable()
    return url.origin
  }
  const host = request.headers.get("host") ?? ""
  const immutable = env.VERCEL_URL ?? ""
  if (!/^[a-z0-9][a-z0-9-]*\.vercel\.app$/.test(immutable) ||
    (host !== immutable && !(env.VERCEL_ENV === "production" && host === "ktour-id.vercel.app")) ||
    request.headers.get("x-forwarded-host") !== host || request.headers.get("x-forwarded-proto") !== "https") throw unavailable()
  return `https://${host}`
}

export function assertHostedSuiTarget(request: Request, env: Env = process.env, now = Date.now()) {
  const issues = hostedSuiPreflightIssues(env, now)
  try { hostedIntegrationRedisConfig(env) } catch { issues.push("storage") }
  if (issues.length) throw unavailable()
  return { origin: hostedSuiOrigin(request, env), expiry: Date.parse(env.HK_HOSTED_SUI_EXPIRES_AT!),
    secret: env.HK_HOSTED_SUI_ACCESS_SECRET!, code: env.HK_HOSTED_SUI_ACCESS_CODE! }
}

export function assertHostedSuiOrigin(request: Request, env: Env = process.env) {
  const site = request.headers.get("sec-fetch-site")
  if (request.headers.get("origin") !== hostedSuiOrigin(request, env) || (site && !["same-origin", "none"].includes(site))) {
    throw new HkError("csrf", "Open this journey directly to continue.", 403)
  }
}

const signature = (secret: string, origin: string, payload: string) => createHmac("sha256", secret)
  .update(`ktour-hosted-sui/v1:${origin}:${payload}`).digest("base64url")

export function requireHostedSuiAccess(request: Request, env: Env = process.env, now = Date.now()) {
  const config = assertHostedSuiTarget(request, env, now)
  const cookies = (request.headers.get("cookie") ?? "").split(";").map(v => v.trim()).filter(v => v.startsWith(HOSTED_SUI_COOKIE + "="))
  if (cookies.length !== 1) throw denied()
  const match = /^(\d{13})\.([a-f0-9]{32})\.([A-Za-z0-9_-]{43})$/.exec(cookies[0].slice(HOSTED_SUI_COOKIE.length + 1))
  if (!match || Number(match[1]) <= now || Number(match[1]) > Math.min(config.expiry, now + ACCESS_MS) ||
    !same(match[3], signature(config.secret, config.origin, `${match[1]}.${match[2]}`))) throw denied()
}

export function grantHostedSuiAccess(request: Request, code: unknown, env: Env = process.env, now = Date.now()) {
  const config = assertHostedSuiTarget(request, env, now)
  assertHostedSuiOrigin(request, env)
  if (typeof code !== "string" || code.length > 128 || !same(code, config.code)) throw denied()
  const expiry = Math.min(now + ACCESS_MS, config.expiry), payload = `${expiry}.${randomBytes(16).toString("hex")}`
  return Response.json({ ok: true, expiresAt: new Date(expiry).toISOString() }, { headers: {
    "cache-control": "no-store",
    "set-cookie": `${HOSTED_SUI_COOKIE}=${payload}.${signature(config.secret, config.origin, payload)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor((expiry - now) / 1000)}`,
  } })
}
