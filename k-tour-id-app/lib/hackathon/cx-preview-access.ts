import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { isCxPreview, isReadinessPreview } from "./preview-readiness"
import { HkError } from "./util"
import { previewRedisConfig } from "./redis-config"

export const CX_PREVIEW_BRANCH = "feat/hackathon-readiness-preview-20260925"
export const CX_PREVIEW_MAX_END = Date.parse("2026-09-30T14:59:59Z")
export const CX_PREVIEW_COOKIE = "__Host-ktour_cx_preview"
const ACCESS_MS = 2 * 60 * 60 * 1000
type Env = Record<string, string | undefined>
const hash = (s: string) => createHash("sha256").update(s).digest()
const equal = (a: string, b: string) => timingSafeEqual(hash(a), hash(b))
const unavailable = () => new HkError("cx_preview_unavailable", "Identity preview is unavailable.", 503)

/** No network or storage: called before every protected route. */
export function assertCxPreviewTarget(request: Request, env: Env = process.env, now = Date.now()) {
  if (!isCxPreview() || isReadinessPreview() || env.HK_CX_PREVIEW_ENABLED !== "1") throw unavailable()
  const url = new URL(request.url)
  const expiry = Date.parse(env.HK_CX_PREVIEW_EXPIRES_AT ?? "")
  if (!Number.isFinite(expiry) || expiry <= now || expiry > CX_PREVIEW_MAX_END) throw unavailable()
  const remote = Object.keys(env).some(key => key === "VERCEL" || key.startsWith("VERCEL_"))
  if (remote) {
    if (env.VERCEL !== "1" || env.VERCEL_ENV !== "preview" || env.VERCEL_REGION !== "icn1" ||
      env.VERCEL_GIT_PROVIDER !== "github" || env.VERCEL_GIT_COMMIT_REF !== CX_PREVIEW_BRANCH ||
      env.VERCEL_GIT_REPO_OWNER !== "woogieboogie-jl" || env.VERCEL_GIT_REPO_SLUG !== "k-tour-id" ||
      !/^[a-f0-9]{40}$/.test(env.VERCEL_GIT_COMMIT_SHA ?? "") || url.protocol !== "https:") throw unavailable()
  } else if (env.HK_CX_PREVIEW_LOCAL_TEST !== "1" || !["localhost", "127.0.0.1"].includes(url.hostname)) throw unavailable()
  if (env.HK_MODE_CX !== "cx" || env.HK_ISOLATED_MOCK !== "0" || env.HK_API_ENABLED !== "1" ||
    env.HK_CX_BASE_URL !== "https://cx.raonsecure.co.kr:18543" || env.HK_CX_PROVIDER !== "comdl" || env.HK_CX_ZKP_TYPE !== "AdultVerify" ||
    !/^[a-f0-9]{64}$/.test(env.HK_CX_PREVIEW_ACCESS_SECRET ?? "") ||
    !/^[A-Za-z0-9_-]{32,128}$/.test(env.HK_CX_PREVIEW_ACCESS_CODE ?? "")) throw unavailable()
  try { previewRedisConfig(env) } catch { throw unavailable() }
  return { expiry, secret: env.HK_CX_PREVIEW_ACCESS_SECRET!, code: env.HK_CX_PREVIEW_ACCESS_CODE!, origin: url.origin }
}

export function assertCxPreviewOrigin(request: Request) {
  const url = new URL(request.url)
  const site = request.headers.get("sec-fetch-site")
  if (request.headers.get("origin") !== url.origin || (site && !["same-origin", "none"].includes(site))) {
    throw new HkError("csrf", "Use this preview directly to continue.", 403)
  }
}

/** Exact routes, before sessions/body parsing; unknown paths cannot touch Redis. */
export function cxPreviewRouteAllowed(method: string, path: string[]) {
  const operation = /^op_[A-Za-z0-9_-]{8,64}$/
  if (method === "GET" || method === "HEAD") return (
    (path.length === 1 && ["config", "me"].includes(path[0])) ||
    (path.length === 3 && path[0] === "places" && /^[A-Za-z0-9_-]{1,120}$/.test(path[1]) && path[2] === "demo-entitlements") ||
    (path.length === 2 && path[0] === "operations" && operation.test(path[1]))
  )
  if (method !== "POST") return false
  return (path.length === 2 && path[0] === "preview" && path[1] === "access") ||
    (path.length === 1 && ["sessions", "operations"].includes(path[0])) ||
    (path.length === 3 && path[0] === "operations" && operation.test(path[1]) && path[2] === "cancel") ||
    (path.length === 4 && path[0] === "operations" && operation.test(path[1]) && path[2] === "identity" && ["start", "complete"].includes(path[3]))
}

function signature(secret: string, origin: string, payload: string) {
  return createHmac("sha256", secret).update(`cx-preview/v1:${CX_PREVIEW_BRANCH}:${origin}:${payload}`).digest("base64url")
}

export function requireCxPreviewAccess(request: Request, env: Env = process.env, now = Date.now()) {
  const config = assertCxPreviewTarget(request, env, now)
  const raw = (request.headers.get("cookie") ?? "").split(";").map(s => s.trim()).filter(s => s.startsWith(CX_PREVIEW_COOKIE + "="))
  if (raw.length !== 1) throw new HkError("cx_preview_access_denied", "Enter the private preview code.", 401)
  const token = raw[0].slice(CX_PREVIEW_COOKIE.length + 1)
  const match = /^(\d{13})\.([a-f0-9]{32})\.([A-Za-z0-9_-]{43})$/.exec(token)
  if (!match || Number(match[1]) <= now || Number(match[1]) > Math.min(now + ACCESS_MS, config.expiry) ||
    !equal(match[3], signature(config.secret, config.origin, `${match[1]}.${match[2]}`))) {
    throw new HkError("cx_preview_access_denied", "Enter the private preview code.", 401)
  }
}

export function grantCxPreviewAccess(request: Request, code: unknown, env: Env = process.env, now = Date.now()) {
  const config = assertCxPreviewTarget(request, env, now)
  assertCxPreviewOrigin(request)
  if (typeof code !== "string" || code.length > 128 || !equal(code, config.code)) {
    throw new HkError("cx_preview_access_denied", "The private preview code was not accepted.", 401)
  }
  const expires = Math.min(now + ACCESS_MS, config.expiry)
  const payload = `${expires}.${randomBytes(16).toString("hex")}`
  const token = `${payload}.${signature(config.secret, config.origin, payload)}`
  return Response.json({ ok: true, expiresAt: new Date(expires).toISOString() }, {
    headers: { "cache-control": "no-store", "set-cookie": `${CX_PREVIEW_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor((expires - now) / 1000)}` },
  })
}

export async function cxPreviewBody(request: Request): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("content-type") ?? "")) throw new HkError("bad_request", "JSON is required.", 400)
  const size = request.headers.get("content-length")
  if (size && (!/^\d+$/.test(size) || Number(size) > 4096)) throw new HkError("bad_request", "Request is too large.", 400)
  const reader = request.body?.getReader()
  if (!reader) throw new HkError("bad_request", "JSON is required.", 400)
  const chunks: Uint8Array[] = []
  let total = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const read = async () => {
      for (;;) {
        const item = await reader.read()
        if (item.done) break
        total += item.value.byteLength
        if (total > 4096) throw new Error("size")
        chunks.push(item.value)
      }
      const result: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"))
      if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("shape")
      return result as Record<string, unknown>
    }
    return await Promise.race([read(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), 2000) })])
  } catch { throw new HkError("bad_request", "Invalid JSON request.", 400) }
  finally { clearTimeout(timer); void reader.cancel().catch(() => undefined); reader.releaseLock() }
}
