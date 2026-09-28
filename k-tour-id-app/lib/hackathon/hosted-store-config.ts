import { HkError } from "./util"
import type { RedisConnection } from "./redis-config"
import { isHostedSuiProfile } from "./hosted-sui-profile"

type Env = Record<string, string | undefined>
export type HostedIntegrationRedisConfig = RedisConnection & { key: string }
const invalid = () => new HkError("store_configuration", "Hosted integration requires safely configured, dedicated Redis storage.", 503)

/** Only the full hosted lane uses this guard; CX/canary and isolated profiles
 * keep their existing backend rules. Runtime/API flags cannot waive durability. */
export function requiresHostedIntegrationRedis(env: Env, isolatedMock: boolean): boolean {
  return !isolatedMock && (env.VERCEL === "1" || env.VERCEL_ENV === "preview" || env.VERCEL_ENV === "production")
}

/** Offline validation only: never reads ambient environment, creates a file,
 * contacts Redis, or returns a partially combined pair of credential aliases. */
export function hostedIntegrationRedisConfig(env: Env): HostedIntegrationRedisConfig {
  const upUrl = env.UPSTASH_REDIS_REST_URL ?? "", upToken = env.UPSTASH_REDIS_REST_TOKEN ?? ""
  const kvUrl = env.KV_REST_API_URL ?? "", kvToken = env.KV_REST_API_TOKEN ?? ""
  const up = Boolean(upUrl || upToken), kv = Boolean(kvUrl || kvToken)
  if (up === kv || (up && (!upUrl || !upToken)) || (kv && (!kvUrl || !kvToken))) throw invalid()
  const url = up ? upUrl : kvUrl, token = up ? upToken : kvToken
  try {
    const parsed = new URL(url)
    if (url !== url.trim() || /[\x00-\x1f\x7f]/.test(url) || parsed.protocol !== "https:" ||
      !parsed.hostname.endsWith(".upstash.io") || parsed.username || parsed.password ||
      parsed.search || parsed.hash || parsed.pathname !== "/" || (parsed.port && parsed.port !== "443")) throw invalid()
  } catch { throw invalid() }
  if (!token || token !== token.trim() || /[\x00-\x20\x7f]/.test(token)) throw invalid()
  const key = env.HK_STORE_KEY ?? ""
  // Never fall back to the public/CX/Sumsub ledger or silently invent a namespace.
  if (isHostedSuiProfile(env) ? key !== "ktour:sui-hosted:20260928:v1" : !/^ktour:integration-preview:[A-Za-z0-9:_-]{1,120}$/.test(key)) throw invalid()
  return { url: url.replace(/\/+$/, ""), token, key }
}
