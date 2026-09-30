import { createHmac } from "node:crypto"
import { hostedIntegrationRedisConfig } from "./hosted-store-config"
import { hostedSuiOrigin, assertHostedSuiOrigin } from "./hosted-sui-access"
import { jitIdentityRouteAllowed } from "./jit-identity-routes"
import { storeRedisCommand } from "./redis-config"
import { HkError } from "./util"
import { hostedSuiRouteAllowed } from "./hosted-sui-profile"

type Env = Record<string, string | undefined>
export const PUBLIC_CX_MARKER = "public-identity-20260930-v1"
export function publicCxEnabled(env: Env = process.env) {
  return env.NEXT_PUBLIC_HK_PUBLIC_CX === PUBLIC_CX_MARKER && env.HK_PUBLIC_CX === PUBLIC_CX_MARKER &&
    env.HK_MODE_CX === "cx" && env.HK_ISOLATED_MOCK === "0" && env.HK_API_ENABLED === "1" &&
    env.NEXT_PUBLIC_HK_ENABLED === "1" && env.NEXT_PUBLIC_HK_CX_PREVIEW === "0" &&
    env.NEXT_PUBLIC_HK_INTEGRATION_PREVIEW === "0" && env.NEXT_PUBLIC_HK_PREVIEW_READ_ONLY === "0" &&
    env.HK_CX_BASE_URL === "https://cx.raonsecure.co.kr:18543" && env.HK_CX_PROVIDER === "comdl" &&
    env.HK_CX_ZKP_TYPE === "AdultVerify" && (env.HK_ISSUER_SIGNING_SEED?.length ?? 0) >= 32
}

/** Only the purpose-bound identity API is public. This never grants the hosted
 * access cookie or opens operation, credential, Sui, Gemini or admin endpoints. */
export function publicCxRouteAllowed(method: string, path: readonly string[], env: Env = process.env) {
  return publicCxEnabled(env) && jitIdentityRouteAllowed(method, path)
}

/** Public product entry, still behind the FULL hosted lifetime/role/budget
 * preflight and exact body rules. Operations must import a purpose-approved CX
 * grant; no anonymous operation slot or old direct identity start is exposed. */
export function publicJourneyRouteAllowed(method: string, path: readonly string[], env: Env = process.env) {
  if (!publicCxEnabled(env) || !hostedSuiRouteAllowed(method, path, env)) return false
  if (path[0] === "hosted" || path[0] === "identity") return false
  if (path[0] === "operations" && path[2] === "identity") return false
  return ["config", "me", "places", "sessions", "operations", "zklogin", "guide"].includes(path[0])
}
export function assertPublicCxTarget(req: Request, env: Env = process.env) {
  if (!publicCxEnabled(env) || new URL(req.url).search || new URL(req.url).hash) throw new HkError("jit_identity_unavailable", "Identity unavailable", 503)
  hostedIntegrationRedisConfig(env)
  const local = env.HK_HOSTED_SUI_LOCAL_TEST === "1" && env.NODE_ENV !== "production" && !Object.keys(env).some(k => k === "VERCEL" || k.startsWith("VERCEL_"))
  if (!local && (env.VERCEL !== "1" || env.VERCEL_PROJECT_ID !== "prj_w5rckTz9B1DO55fvVRXjQRy9L5RM" ||
    !["production", "preview"].includes(env.VERCEL_ENV ?? "") || env.VERCEL_GIT_REPO_OWNER !== "woogieboogie-jl" ||
    env.VERCEL_GIT_REPO_SLUG !== "k-tour-id" || !/^[a-f0-9]{40}$/.test(env.VERCEL_GIT_COMMIT_SHA ?? ""))) throw new HkError("jit_identity_unavailable", "Identity unavailable", 503)
  hostedSuiOrigin(req, env)
  if (req.method !== "GET") assertHostedSuiOrigin(req, env)
}

// Atomic fixed-window abuse limits, separate from the finite chain gas ledger.
// Only a daily-keyed pseudonym is stored, not the IP or raw forwarded header.
export const PUBLIC_CX_RATE_LUA = `
local a = tonumber(redis.call('GET', KEYS[1]) or '0')
local b = tonumber(redis.call('GET', KEYS[2]) or '0')
if a >= tonumber(ARGV[1]) or b >= tonumber(ARGV[2]) then return 0 end
redis.call('INCR', KEYS[1]); redis.call('EXPIRE', KEYS[1], ARGV[3])
redis.call('INCR', KEYS[2]); redis.call('EXPIRE', KEYS[2], ARGV[3])
return 1`
export function publicCxRateKeys(req: Request, action: "create" | "start", env: Env, now: number) {
  const ip = env.VERCEL === "1" ? req.headers.get("x-vercel-forwarded-for") : "local"
  if (!ip || ip.length > 256 || /[\x00-\x1f\x7f]/.test(ip)) throw new HkError("jit_identity_unavailable", "Client boundary unavailable", 503)
  const day = Math.floor(now / 86_400_000), hour = Math.floor(now / 3_600_000)
  const subject = createHmac("sha256", env.HK_ISSUER_SIGNING_SEED!).update(`public-cx-rate:${day}:${ip}`).digest("hex")
  return [`ktour:public-cx:${action}:${hour}:${subject}`, `ktour:public-cx:${action}:${hour}:global`]
}
export async function reservePublicCxRate(req: Request, path: readonly string[], env: Env = process.env) {
  const action = path.length === 1 && path[0] === "sessions" || path.length === 2 && path[1] === "requests" ? "create" : path[3] === "start" ? "start" : null
  if (!action) return
  const connection = hostedIntegrationRedisConfig(env), keys = publicCxRateKeys(req, action, env, Date.now())
  const result = await storeRedisCommand<number>(connection, ["EVAL", PUBLIC_CX_RATE_LUA, 2, ...keys,
    action === "start" ? 5 : 20, action === "start" ? 100 : 300, 7200])
  if (result !== 1) throw new HkError("jit_identity_limit", "Please wait before starting another identity check", 429)
}
