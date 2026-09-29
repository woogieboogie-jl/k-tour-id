// Operator-only diagnostic: dedicated Preview ledger, chain reads, fenced ledger
// status updates. No dotenv, app config/service, private-key reads, or signing.
import { randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"
import { configuredOmnioneTarget } from "../lib/hackathon/omnione-targets"
import { omnioneTargetBindings, assertOmnioneTargetMonotonic } from "../lib/hackathon/omnione-target-integrity"
import { approvedOmnioneRpc, omnioneRpcReader } from "../lib/hackathon/omnione-readonly"
import { recoverOmnioneOutbox, type RecoveryRepository } from "../lib/hackathon/omnione-recovery"
import { parseStoredJourney } from "../lib/hackathon/store-integrity"
import { storeRedisCommand, type RedisConnection } from "../lib/hackathon/redis-config"

type Env = Record<string, string | undefined>
const STORE_KEY = /^ktour:integration-preview:[A-Za-z0-9:_-]{1,120}$/
const invalid = () => new Error("recovery_configuration_invalid")
export function recoveryArguments(args: string[]) {
  if (args.length !== 4 || args[0] !== "--read-only" || args[1] !== "--store-key" || !STORE_KEY.test(args[2]) || !/^--limit=[1-3]$/.test(args[3])) throw invalid()
  return { key: args[2], limit: Number(args[3].slice(-1)) }
}
/** Only explicitly named read credentials are accessed, never the signer or seed. */
export function recoveryConfiguration(env: Env, key: string) {
  if (!STORE_KEY.test(key) || env.HK_STORE_KEY !== key || env.HK_OMNIONE_RECOVERY_ENABLED !== "1" || env.NODE_ENV === "production" || env.VERCEL || env.VERCEL_ENV === "production") throw invalid()
  const until = Date.parse(env.HK_OMNIONE_RECOVERY_UNTIL ?? "")
  if (!Number.isFinite(until) || until <= Date.now() || until > Date.now() + 30 * 60_000) throw invalid()
  const upUrl = env.UPSTASH_REDIS_REST_URL ?? "", upToken = env.UPSTASH_REDIS_REST_TOKEN ?? ""
  const kvUrl = env.KV_REST_API_URL ?? "", kvToken = env.KV_REST_API_TOKEN ?? ""
  if (Boolean(upUrl || upToken) === Boolean(kvUrl || kvToken) || (upUrl || upToken) && (!upUrl || !upToken) || (kvUrl || kvToken) && (!kvUrl || !kvToken)) throw invalid()
  const url = upUrl || kvUrl, token = upToken || kvToken
  try {
    const u = new URL(url)
    if (url !== url.trim() || u.protocol !== "https:" || !u.hostname.endsWith(".upstash.io") || u.username || u.password || u.search || u.hash || u.pathname !== "/" || u.port && u.port !== "443") throw invalid()
  } catch { throw invalid() }
  if (!token || token !== token.trim() || /[\x00-\x1f\x7f]/.test(token)) throw invalid()
  const rpc = env.HK_OMNIONE_RPC_URL ?? ""
  if (!approvedOmnioneRpc(rpc)) throw invalid()
  try { configuredOmnioneTarget({ targetId: env.HK_OMNIONE_TARGET_ID, chainId: Number(env.HK_OMNIONE_CHAIN_ID || "201210"),
    registryAddress: env.HK_OMNIONE_REGISTRY_ADDRESS || "", recorderAddress: env.HK_OMNIONE_RECORDER_ADDRESS }) } catch { throw invalid() }
  return { redis: { url: url.replace(/\/+$/, ""), token }, key, rpc, until }
}

/** Same journey lock protocol as app withStore; extra raw-value CAS prevents an
 * unexpected writer from being overwritten. Missing ledgers are never created. */
export function redisRecoveryRepository(connection: RedisConnection, key: string, options: { fetchImpl?: typeof fetch; deadline: number }) {
  if (!STORE_KEY.test(key)) throw invalid()
  let requests = 0
  async function command<T>(args: (string | number)[], cleanup = false): Promise<T> {
    const remaining = options.deadline + (cleanup ? 5000 : 0) - Date.now()
    if (remaining <= 0 || requests >= 48) throw new Error("recovery_store_deadline")
    requests++
    return storeRedisCommand<T>(connection, args, { fetchImpl: options.fetchImpl, timeoutMs: Math.max(1, Math.min(2000, remaining)) })
  }
  const repository: RecoveryRepository = {
    async read() { return parseStoredJourney(await command<string | null>(["GET", key])) },
    async mutate(work, cleanup = false) {
      const token = `recover:${randomUUID()}`, lock = `${key}:lock`
      let locked = false
      try {
        const result = await command<string | null>(["SET", lock, token, "NX", "PX", 5000], cleanup)
        if (result !== "OK") throw new Error("recovery_store_busy")
        locked = true
        const raw = await command<string | null>(["GET", key], cleanup)
        const db = parseStoredJourney(raw), targets = omnioneTargetBindings(db), resultValue = work(db)
        assertOmnioneTargetMonotonic(targets, db)
        const next = JSON.stringify(db)
        if (next !== raw) {
          const saved = await command<number>(["EVAL", "-- ktour-omnione-recovery-cas\nlocal t=redis.call('TIME'); local ms=t[1]*1000+math.floor(t[2]/1000); if ms >= tonumber(ARGV[4]) then return 0 end; if redis.call('GET',KEYS[1]) == ARGV[1] and redis.call('GET',KEYS[2]) == ARGV[2] then redis.call('SET',KEYS[2],ARGV[3],'KEEPTTL'); return 1 end return 0", 2, lock, key, token, raw!, next, options.deadline + (cleanup ? 5000 : 0)], cleanup)
          if (saved !== 1) throw new Error("recovery_store_lease_lost")
        }
        return resultValue
      } finally {
        // Includes uncertain SET replies: release only this invocation's token.
        const released = await command<number>(["EVAL", "-- ktour-omnione-recovery-unlock\nif redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0", 1, lock, token], true)
        if (locked && released !== 1) throw new Error("recovery_store_cleanup_unconfirmed")
      }
    },
  }
  return { repository, count: () => requests }
}
export async function runOmnioneRecovery(args: string[], options: { env?: Env; fetchImpl?: typeof fetch } = {}) {
  try {
    const parsed = recoveryArguments(args), config = recoveryConfiguration(options.env ?? process.env, parsed.key)
    const deadline = Math.min(Date.now() + 25000, config.until)
    const rpc = omnioneRpcReader(config.rpc, { fetchImpl: options.fetchImpl, deadline, maxCalls: parsed.limit * 4, timeoutMs: 3000 })
    const redis = redisRecoveryRepository(config.redis, parsed.key, { fetchImpl: options.fetchImpl, deadline })
    const result = await recoverOmnioneOutbox({ repository: redis.repository, rpc, limit: parsed.limit, deadline })
    return { ...result, rpcRequests: rpc.count(), storeRequests: redis.count(), ledgerMayBeUpdated: true }
  } catch {
    return { ok: false, mode: "chain-read-only-recovery", issues: ["recovery_unavailable_or_unapproved"], signatures: 0, broadcasts: 0 }
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runOmnioneRecovery(process.argv.slice(2))
  process.stdout.write(`${JSON.stringify(result)}\n`)
  process.exitCode = result.ok ? 0 : 1
}
