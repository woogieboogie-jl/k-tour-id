import { createHash, timingSafeEqual } from "node:crypto"
import { redisProbeCredentials, runRedisProbeCore } from "../../scripts/hackathon-redis-probe.mjs"
import { isReadinessPreview } from "./preview-readiness"

// Retired after the successful 09:25:49Z smoke; no API route imports this module.
// Kept for regression fixtures only. This never enables app APIs.
export const REDIS_READINESS_END = Date.parse("2026-09-25T09:26:00Z")
const BRANCH = "feat/hackathon-readiness-preview-20260925"
const PATH = "/api/hackathon/v1/readiness/redis"
const CACHE_MS = 30_000
type Env = Record<string, string | undefined>
type Summary = { ok: boolean; checks: number; cleanup: boolean; failures: number }
type Result = Summary & { region: string; revision: string; observedAt: string }
type Dependencies = {
  env?: () => Env
  readOnly?: () => boolean
  now?: () => number
  fetchImpl?: typeof fetch
}

const failed = (): Summary => ({ ok: false, checks: 0, cleanup: false, failures: 1 })
const respond = (body: Summary | Result, status: number) => Response.json(body, {
  status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
})
const hash = (value: string) => createHash("sha256").update(value).digest()

async function hasEmptyBody(request: Request): Promise<boolean> {
  if (request.body === null) return true
  // Next can expose an empty POST as a stream. Only EOF is acceptable, and a
  // declared Content-Length: 0 never substitutes for examining the stream.
  const reader = request.body.getReader()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await new Promise<boolean>(resolve => {
      timer = setTimeout(() => resolve(false), 1_000)
      reader.read().then(({ done }) => resolve(done), () => resolve(false))
    })
  } finally {
    clearTimeout(timer)
    void reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

function targetAllowed(env: Env, now: number, readOnly: boolean) {
  return readOnly && now < REDIS_READINESS_END &&
    env.VERCEL === "1" && env.VERCEL_ENV === "preview" && env.VERCEL_REGION === "icn1" &&
    env.VERCEL_GIT_PROVIDER === "github" && env.VERCEL_GIT_COMMIT_REF === BRANCH &&
    env.VERCEL_GIT_REPO_OWNER === "woogieboogie-jl" && env.VERCEL_GIT_REPO_SLUG === "k-tour-id" &&
    /^[a-f0-9]{40}$/.test(env.VERCEL_GIT_COMMIT_SHA ?? "")
}

// Injectable dependencies keep all unit checks in-memory, without reading real
// credentials or weakening the default handler's statically compiled flag.
export function createRedisReadinessHandler(dependencies: Dependencies = {}) {
  const getEnv = dependencies.env ?? (() => process.env)
  const readOnly = dependencies.readOnly ?? isReadinessPreview
  const now = dependencies.now ?? Date.now
  let cached: { fingerprint: string; until: number; result: Result } | undefined
  let running: { fingerprint: string; promise: Promise<Result> } | undefined

  return async function handle(request: Request): Promise<Response> {
    const env = getEnv()
    if (!targetAllowed(env, now(), readOnly())) return respond(failed(), 404)
    const url = new URL(request.url)
    const length = request.headers.get("content-length")
    if (request.method !== "POST" || url.pathname !== PATH || url.search || url.hash ||
      request.headers.has("cookie") || request.headers.has("transfer-encoding") ||
      (length !== null && length !== "0")) return respond(failed(), 400)

    const expected = env.HK_REDIS_READINESS_TOKEN ?? ""
    const authorization = request.headers.get("authorization") ?? ""
    const supplied = /^Bearer ([A-Za-z0-9_-]{32,128})$/.exec(authorization)?.[1] ?? ""
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(expected) || !supplied ||
      !timingSafeEqual(hash(supplied), hash(expected))) return respond(failed(), 401)
    if (!await hasEmptyBody(request)) return respond(failed(), 400)
    if (!targetAllowed(getEnv(), now(), readOnly())) return respond(failed(), 404)

    const credentials = redisProbeCredentials(env)
    if (!credentials.ok || !credentials.url || !credentials.token || credentials.token === expected) {
      return respond(failed(), 503)
    }
    // Never reuse a cached success after a credential or deployment change.
    const fingerprint = hash(JSON.stringify([
      credentials.url, credentials.token, expected, env.VERCEL_GIT_COMMIT_SHA,
    ])).toString("hex")
    let result: Result
    if (cached?.fingerprint === fingerprint && cached.until > now()) result = cached.result
    else {
      if (running && running.fingerprint !== fingerprint) return respond(failed(), 503)
      if (!running) {
        const observedAt = new Date(now()).toISOString()
        const metadata = { region: "icn1", revision: env.VERCEL_GIT_COMMIT_SHA!, observedAt }
        const promise = runRedisProbeCore({
          url: credentials.url, token: credentials.token,
          fetchImpl: dependencies.fetchImpl ?? globalThis.fetch,
          // Work stops at expiry; only best-effort own-key cleanup may follow.
          workTimeoutMs: Math.min(25_000, REDIS_READINESS_END - now()), cleanupTimeoutMs: 8_000,
        }).then(summary => ({
          ok: summary.ok, checks: summary.checks, cleanup: summary.cleanup, failures: summary.failures,
          ...metadata,
        })).catch(() => ({ ...failed(), ...metadata }))
        running = { fingerprint, promise }
      }
      const flight = running
      result = await flight.promise
      if (running === flight) {
        running = undefined
        if (result.ok && now() < REDIS_READINESS_END) cached = { fingerprint, until: now() + CACHE_MS, result }
      }
    }
    // Auth is checked before every cache hit/coalesced request. Expired results
    // are discarded, even when an already-running probe completed successfully.
    if (!targetAllowed(getEnv(), now(), readOnly())) return respond(failed(), 404)
    return respond(result, result.ok ? 200 : 502)
  }
}

export const redisReadinessResponse = createRedisReadinessHandler()
