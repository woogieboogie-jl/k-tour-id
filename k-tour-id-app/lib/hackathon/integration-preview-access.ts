import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { hostedIntegrationRedisConfig } from "./hosted-store-config"
import { HkError } from "./util"

export const INTEGRATION_PREVIEW_BRANCH = "integration/autonomous-finish-20260927"
export const INTEGRATION_PREVIEW_MAX_END = Date.parse("2026-09-30T14:59:59Z")
export const INTEGRATION_PREVIEW_COOKIE = "__Host-ktour_integration_preview"
const ACCESS_MS = 2 * 60 * 60 * 1000
const MAX_BODY_BYTES = 32 * 1024
type Env = Record<string, string | undefined>
const hash = (value: string) => createHash("sha256").update(value).digest()
const equal = (a: string, b: string) => timingSafeEqual(hash(a), hash(b))
const unavailable = () => new HkError("integration_preview_unavailable", "Integration preview is unavailable.", 503)
const denied = () => new HkError("integration_preview_access_denied", "Enter the private integration preview code.", 401)
const badBody = () => new HkError("bad_request", "Invalid JSON request.", 400)
const isRemote = (env: Env) => Object.keys(env).some(key => key === "VERCEL" || key.startsWith("VERCEL_"))

/** The branch pin also protects a mistakenly built/deployed non-integration
 * artifact. Removing a runtime flag must never expose the generic API. */
export function requiresIntegrationPreviewAccess(env: Env = process.env) {
  return (env === process.env && process.env.NEXT_PUBLIC_HK_INTEGRATION_PREVIEW === "1") || env.NEXT_PUBLIC_HK_INTEGRATION_PREVIEW === "1" ||
    env.VERCEL_GIT_COMMIT_REF === INTEGRATION_PREVIEW_BRANCH
}

/** Next can present an internal URL. The immutable deployment origin is
 * accepted only with both exact host headers and HTTPS forwarding. */
export function integrationPreviewRequestOrigin(request: Request, env: Env = process.env) {
  const url = new URL(request.url)
  if (url.username || url.password || !["http:", "https:"].includes(url.protocol)) throw unavailable()
  if (!isRemote(env)) {
    if (env.HK_INTEGRATION_PREVIEW_LOCAL_TEST !== "1" || env.NODE_ENV === "production" ||
      !["localhost", "127.0.0.1"].includes(url.hostname)) throw unavailable()
    return url.origin
  }
  const host = env.VERCEL_URL ?? ""
  if (env.VERCEL !== "1" || env.VERCEL_ENV !== "preview" ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.vercel\.app$/.test(host) ||
    request.headers.get("host") !== host || request.headers.get("x-forwarded-host") !== host ||
    request.headers.get("x-forwarded-proto") !== "https") throw unavailable()
  return `https://${host}`
}

/** Offline fail-closed checks, returning fixed names only, never credentials.
 * Access preparation is not a claim that the OpenDID provider is implemented. */
export function integrationPreviewPreflightIssues(request: Request, env: Env = process.env, now = Date.now()) {
  const expiry = Date.parse(env.HK_INTEGRATION_PREVIEW_EXPIRES_AT ?? "")
  const seed = env.HK_ISSUER_SIGNING_SEED ?? ""
  const checks: Record<string, boolean> = {
    integration_build: env.NEXT_PUBLIC_HK_INTEGRATION_PREVIEW === "1" && (env !== process.env || process.env.NEXT_PUBLIC_HK_INTEGRATION_PREVIEW === "1"),
    no_cx_build: env.NEXT_PUBLIC_HK_CX_PREVIEW === "0" && (env !== process.env || process.env.NEXT_PUBLIC_HK_CX_PREVIEW === "0"),
    no_readonly_build: env.NEXT_PUBLIC_HK_PREVIEW_READ_ONLY === "0" && (env !== process.env || process.env.NEXT_PUBLIC_HK_PREVIEW_READ_ONLY === "0"),
    runtime_enabled: env.HK_INTEGRATION_PREVIEW_ENABLED === "1",
    expiry: Number.isFinite(now) && Number.isFinite(expiry) && expiry > now && expiry <= INTEGRATION_PREVIEW_MAX_END,
    api_enabled: env.HK_API_ENABLED === "1" && env.NEXT_PUBLIC_HK_ENABLED === "1",
    non_mock: env.HK_ISOLATED_MOCK === "0",
    cx_mode: env.HK_MODE_CX === "cx",
    opendid_mode: env.HK_MODE_OPENDID === "opendid",
    cx_origin: env.HK_CX_BASE_URL === "https://cx.raonsecure.co.kr:18543",
    cx_provider: env.HK_CX_PROVIDER === "comdl",
    cx_zkp: env.HK_CX_ZKP_TYPE === "AdultVerify",
    issuer_seed: seed.length >= 32 && seed.length <= 1024 && seed === seed.trim() && !/[\x00-\x1f\x7f]/.test(seed) && !/sample|change[\s_-]*me|placeholder|sentinel/i.test(seed),
    access_secret: /^[a-f0-9]{64}$/.test(env.HK_INTEGRATION_PREVIEW_ACCESS_SECRET ?? ""),
    access_code: /^[A-Za-z0-9_-]{32,128}$/.test(env.HK_INTEGRATION_PREVIEW_ACCESS_CODE ?? ""),
  }
  if (isRemote(env)) Object.assign(checks, {
    seoul: env.VERCEL_REGION === "icn1",
    git_provider: env.VERCEL_GIT_PROVIDER === "github",
    git_branch: env.VERCEL_GIT_COMMIT_REF === INTEGRATION_PREVIEW_BRANCH,
    git_owner: env.VERCEL_GIT_REPO_OWNER === "woogieboogie-jl",
    git_repo: env.VERCEL_GIT_REPO_SLUG === "k-tour-id",
    git_revision: /^[a-f0-9]{40}$/.test(env.VERCEL_GIT_COMMIT_SHA ?? ""),
    project: env.VERCEL_PROJECT_ID === "prj_w5rckTz9B1DO55fvVRXjQRy9L5RM",
    team: env.VERCEL_ORG_ID === "team_6kJAloQ9WlswvMtbbCmGI7Er",
  })
  try { integrationPreviewRequestOrigin(request, env); checks.request_origin = true } catch { checks.request_origin = false }
  try { hostedIntegrationRedisConfig(env); checks.redis_configuration = true } catch { checks.redis_configuration = false }
  return Object.keys(checks).filter(key => !checks[key])
}

export function assertIntegrationPreviewTarget(request: Request, env: Env = process.env, now = Date.now()) {
  if (integrationPreviewPreflightIssues(request, env, now).length) throw unavailable()
  return { expiry: Date.parse(env.HK_INTEGRATION_PREVIEW_EXPIRES_AT!), secret: env.HK_INTEGRATION_PREVIEW_ACCESS_SECRET!,
    code: env.HK_INTEGRATION_PREVIEW_ACCESS_CODE!, origin: integrationPreviewRequestOrigin(request, env) }
}

export function assertIntegrationPreviewOrigin(request: Request, env: Env = process.env) {
  const site = request.headers.get("sec-fetch-site")
  if (request.headers.get("origin") !== integrationPreviewRequestOrigin(request, env) ||
    (site && site !== "same-origin" && site !== "none")) throw new HkError("csrf", "Use this preview directly to continue.", 403)
}

const operationId = /^op_[A-Za-z0-9_-]{8,64}$/
const actions: Record<string, readonly string[]> = {
  "identity/start": ["mobile"], "identity/complete": [],
  "credential/issue": ["publicKeyPem", "alg"], "credential/holder-ack": ["signatureB64"],
  "presentation/request": [], "presentation/submit": ["presentationId", "disclosed", "signatureB64"], "presentation/deny": [],
  proposal: ["locale"], "delegation/prepare": ["userAddress", "signer", "walletProof", "approvedProposalDigest"],
  "delegation/submit": ["txBytesDigest", "userSignature"], "agent/run": [], redeem: ["idempotencyKey"], cancel: [], reconcile: [], "sui/agent-address": [],
}

/** Exact path lengths and verbs; HEAD and all unknown/query routes stay shut. */
export function integrationPreviewRouteAllowed(method: string, path: string[]) {
  if (method === "GET") return (path.length === 1 && ["config", "me"].includes(path[0])) ||
    (path.length === 3 && path[0] === "places" && /^[A-Za-z0-9_-]{1,120}$/.test(path[1]) && path[2] === "demo-entitlements") ||
    ((path.length === 2 || (path.length === 3 && path[2] === "evidence")) && path[0] === "operations" && operationId.test(path[1])) ||
    (path.length === 2 && path[0] === "zklogin" && path[1] === "params")
  if (method !== "POST") return false
  return (path.length === 1 && ["sessions", "operations"].includes(path[0])) ||
    (path.length === 2 && ((path[0] === "integration" && path[1] === "access") || (path[0] === "zklogin" && path[1] === "prove"))) ||
    ((path.length === 3 || path.length === 4) && path[0] === "operations" && operationId.test(path[1]) && Object.hasOwn(actions, path.slice(2).join("/")))
}

export function assertIntegrationPreviewBody(path: string[], body: Record<string, unknown>) {
  const fields = path.length === 1 ? (path[0] === "operations" ? ["venueId", "consentVersion", "locale"] : [])
    : path[0] === "integration" ? ["accessCode"]
      : path[0] === "zklogin" ? ["jwt", "extendedEphemeralPublicKey", "maxEpoch", "jwtRandomness"]
        : actions[path.slice(2).join("/")] ?? []
  if (Object.keys(body).some(key => !fields.includes(key))) throw badBody()
  if (path.slice(2).join("/") === "identity/start" && typeof body.mobile !== "boolean") throw badBody()
  if (Object.hasOwn(body, "alg") && !["Ed25519", "ECDSA-P256"].includes(String(body.alg))) throw badBody()
  if (Object.hasOwn(body, "signer") && !["zklogin", "demo"].includes(String(body.signer))) throw badBody()
  if (Object.hasOwn(body, "walletProof") && (!body.walletProof || typeof body.walletProof !== "object" || Array.isArray(body.walletProof) ||
    Object.keys(body.walletProof).some(key => !["message", "signature"].includes(key)))) throw badBody()
  if (Object.hasOwn(body, "disclosed") && (!body.disclosed || typeof body.disclosed !== "object" || Array.isArray(body.disclosed))) throw badBody()
}

function signature(secret: string, origin: string, payload: string) {
  return createHmac("sha256", secret).update(`integration-preview/v1:${INTEGRATION_PREVIEW_BRANCH}:${origin}:${payload}`).digest("base64url")
}

export function requireIntegrationPreviewAccess(request: Request, env: Env = process.env, now = Date.now()) {
  const config = assertIntegrationPreviewTarget(request, env, now)
  const cookies = (request.headers.get("cookie") ?? "").split(";").map(value => value.trim()).filter(value => value.startsWith(INTEGRATION_PREVIEW_COOKIE + "="))
  if (cookies.length !== 1) throw denied()
  const match = /^(\d{13})\.([a-f0-9]{32})\.([A-Za-z0-9_-]{43})$/.exec(cookies[0].slice(INTEGRATION_PREVIEW_COOKIE.length + 1))
  if (!match || Number(match[1]) <= now || Number(match[1]) > Math.min(now + ACCESS_MS, config.expiry) ||
    !equal(match[3], signature(config.secret, config.origin, `${match[1]}.${match[2]}`))) throw denied()
}

export function grantIntegrationPreviewAccess(request: Request, code: unknown, env: Env = process.env, now = Date.now()) {
  const config = assertIntegrationPreviewTarget(request, env, now)
  assertIntegrationPreviewOrigin(request, env)
  if (typeof code !== "string" || code.length > 128 || !equal(code, config.code)) throw denied()
  const expires = Math.min(now + ACCESS_MS, config.expiry)
  const payload = `${expires}.${randomBytes(16).toString("hex")}`
  const token = `${payload}.${signature(config.secret, config.origin, payload)}`
  return Response.json({ ok: true, expiresAt: new Date(expires).toISOString() }, { headers: {
    "cache-control": "no-store", "set-cookie": `${INTEGRATION_PREVIEW_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor((expires - now) / 1000)}`,
  } })
}

/** Streams are bounded even without Content-Length. Timeout/cancel cleanup
 * cannot delay the error response or invoke any storage/provider work. */
export async function integrationPreviewBody(request: Request): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("content-type") ?? "")) throw badBody()
  const size = request.headers.get("content-length")
  if (size !== null && (!/^\d+$/.test(size) || Number(size) > MAX_BODY_BYTES)) throw badBody()
  const reader = request.body?.getReader()
  if (!reader) throw badBody()
  const chunks: Uint8Array[] = []
  let total = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let finished = false
  try {
    const read = async () => {
      for (;;) {
        const item = await reader.read()
        if (finished) throw badBody()
        if (item.done) break
        total += item.value.byteLength
        if (total > MAX_BODY_BYTES) throw badBody()
        chunks.push(item.value)
      }
      const result: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)))
      if (!result || typeof result !== "object" || Array.isArray(result)) throw badBody()
      return result as Record<string, unknown>
    }
    return await Promise.race([read(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(badBody()), 2000) })])
  } catch { throw badBody() }
  finally { finished = true; clearTimeout(timer); void reader.cancel().catch(() => undefined); reader.releaseLock() }
}
