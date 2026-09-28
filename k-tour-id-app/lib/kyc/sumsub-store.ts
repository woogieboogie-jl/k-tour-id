// Expiring Sandbox state. No images, SDK tokens or raw webhook data are stored.
// Every write (including revocation) compares the COMPLETE previous JSON value.
import { createHmac } from "node:crypto"
import { storeRedisCommand, type RedisConnection } from "@/lib/hackathon/redis-config"
import { SandboxError, type SandboxStatus } from "./sumsub-sandbox"
export type SumsubRecord = {
  version: 1; revision: number; externalUserId: string; applicantId?: string
  levelName: string; status: SandboxStatus; expiresAt: number
  activeSessionId: string | null; activeExpiresAt: number; updatedAt: number
  lastEventAt: number; lastEventId?: string; needsRefresh?: boolean
}
const local = new Map<string, string>()
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const unavailable = () => new SandboxError("store_unavailable", 503)
export function sumsubStoreConfiguration(env: Record<string, string | undefined> = process.env) {
  const up = [env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN]
  const kv = [env.KV_REST_API_URL, env.KV_REST_API_TOKEN]
  const anyUp = up.some(Boolean), anyKv = kv.some(Boolean)
  if (!anyUp && !anyKv && env.SUMSUB_LOCAL_MEMORY === "1" && !env.VERCEL && !env.VERCEL_ENV && env.NODE_ENV !== "production")
    return { connection: null, prefix: "ktour:sumsub:sandbox:local" }
  if (anyUp === anyKv || (anyUp && !up.every(Boolean)) || (anyKv && !kv.every(Boolean))) throw unavailable()
  const [url, token] = (anyUp ? up : kv) as [string, string]
  const prefix = env.SUMSUB_STORE_NAMESPACE ?? ""
  try {
    const u = new URL(url)
    if (url !== url.trim() || u.protocol !== "https:" || !u.hostname.endsWith(".upstash.io")
      || u.username || u.password || u.search || u.hash || u.pathname !== "/" || (u.port && u.port !== "443")) throw unavailable()
  } catch { throw unavailable() }
  if (!token || token !== token.trim() || /[\x00-\x1f\x7f]/.test(token)
    || !/^ktour:sumsub:sandbox:[A-Za-z0-9_-]{1,80}$/.test(prefix)) throw unavailable()
  return { connection: { url: url.replace(/\/+$/, ""), token }, prefix }
}
function recordKey(id: string, secret: string, prefix: string) {
  if (!id.startsWith("ktour-sbx-") || !UUID.test(id.slice(10)) || secret.length < 32) throw unavailable()
  return prefix + ":" + createHmac("sha256", secret).update(id).digest("hex")
}
function parseRecord(raw: string, id: string): SumsubRecord {
  try {
    if (raw.length > 4096) throw unavailable()
    const r = JSON.parse(raw) as SumsubRecord
    const statuses = ["access_required", "not_started", "in_progress", "pending", "retry", "approved", "rejected", "expired", "unavailable"]
    const keys = ["version","revision","externalUserId","applicantId","levelName","status","expiresAt","activeSessionId","activeExpiresAt","updatedAt","lastEventAt","lastEventId","needsRefresh"]
    if (r.version !== 1 || r.externalUserId !== id || !Number.isSafeInteger(r.revision) || r.revision < 0
      || !statuses.includes(r.status) || typeof r.levelName !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(r.levelName)
      || !Number.isSafeInteger(r.expiresAt) || !Number.isSafeInteger(r.activeExpiresAt)
      || r.activeExpiresAt > r.expiresAt || r.activeExpiresAt < 0
      || !(r.activeSessionId === null || UUID.test(r.activeSessionId))
      || !Number.isSafeInteger(r.updatedAt) || !Number.isSafeInteger(r.lastEventAt) || r.lastEventAt < 0
      || (r.applicantId !== undefined && !/^[A-Za-z0-9_-]{1,100}$/.test(r.applicantId))
      || (r.lastEventId !== undefined && !/^[A-Za-z0-9:_-]{1,160}$/.test(r.lastEventId))
      || (r.needsRefresh !== undefined && typeof r.needsRefresh !== "boolean")
      || Object.keys(r).some(k => !keys.includes(k))) throw unavailable()
    return r
  } catch { throw unavailable() }
}
async function command<T>(connection: RedisConnection, args: (string | number)[], deadline: number) {
  if (Date.now() >= deadline) throw unavailable()
  try { return await storeRedisCommand<T>(connection, args, { timeoutMs: Math.min(1200, deadline - Date.now()) }) }
  catch { throw unavailable() }
}
async function readRaw(key: string, connection: RedisConnection | null, deadline: number) {
  const raw = connection ? await command<unknown>(connection, ["GET", key], deadline) : local.get(key) ?? null
  if (raw !== null && typeof raw !== "string") throw unavailable()
  return raw
}
export async function readSumsubRecord(id: string, secret: string): Promise<SumsubRecord | null> {
  const { connection, prefix } = sumsubStoreConfiguration()
  const raw = await readRaw(recordKey(id, secret, prefix), connection, Date.now() + 4500)
  if (raw === null) return null
  const row = parseRecord(raw, id)
  return row.expiresAt > Date.now() ? row : null
}
export async function createSumsubRecord(record: Omit<SumsubRecord, "revision" | "updatedAt">, secret: string): Promise<boolean> {
  const { connection, prefix } = sumsubStoreConfiguration()
  const key = recordKey(record.externalUserId, secret, prefix), now = Date.now(), ttl = record.expiresAt - now
  if (ttl <= 0 || ttl > 7 * 24 * 60 * 60 * 1000) throw unavailable()
  const raw = JSON.stringify({ ...record, revision: 0, updatedAt: now })
  parseRecord(raw, record.externalUserId)
  if (connection) return await command(connection, ["SET", key, raw, "NX", "PX", ttl], now + 4500) === "OK"
  for (const [k, v] of local) if ((JSON.parse(v) as SumsubRecord).expiresAt <= now) local.delete(k)
  if (local.has(key)) return false
  if (local.size >= 256) throw unavailable()
  local.set(key, raw)
  return true
}
// updater is synchronous and may be replayed on contention. It MUST recheck
// scope/session IDs; returned data never silently overwrites a different writer.
export async function mutateSumsubRecord(id: string, secret: string, updater: (current: SumsubRecord) => SumsubRecord | null): Promise<SumsubRecord | null> {
  const { connection, prefix } = sumsubStoreConfiguration()
  const key = recordKey(id, secret, prefix), deadline = Date.now() + 4500
  for (let attempt = 0; attempt < 4; attempt++) {
    const raw = await readRaw(key, connection, deadline)
    if (raw === null) return null
    const before = parseRecord(raw, id)
    if (before.expiresAt <= Date.now()) return null
    const candidate = updater(structuredClone(before))
    if (!candidate) return null
    if (candidate.externalUserId !== before.externalUserId || candidate.levelName !== before.levelName
      || candidate.expiresAt !== before.expiresAt || candidate.revision !== before.revision) throw unavailable()
    const next = { ...candidate, revision: before.revision + 1, updatedAt: Date.now() }
    const encoded = JSON.stringify(next)
    parseRecord(encoded, id)
    if (!connection) {
      if (local.get(key) !== raw) continue
      local.set(key, encoded)
      return next
    }
    const changed = await command<number>(connection, [
      "EVAL", "-- ktour-sumsub-cas\nif redis.call('GET',KEYS[1]) == ARGV[1] then redis.call('SET',KEYS[1],ARGV[2],'KEEPTTL'); return 1 end return 0",
      1, key, raw, encoded,
    ], deadline)
    if (changed === 1) return next
  }
  throw new SandboxError("store_conflict", 503)
}
