// Durable JSON store for the hackathon journey.
//
// Two backends, chosen at runtime:
//   • redis — Upstash Redis over REST (Vercel Marketplace "Upstash for Redis" or any
//             Upstash DB). Enabled when UPSTASH_REDIS_REST_URL/TOKEN (or the Vercel KV
//             aliases KV_REST_API_URL/TOKEN) are present. Multi-instance safe: every
//             read-modify-write holds a short NX lock and always re-reads the blob.
//   • file  — atomic JSON file (tmp + rename) for single-process local demos. On Vercel
//             without Redis the file falls back to /tmp (per-instance, non-durable).
// Unique constraints: one redemption per subjectRef+campaignId, one intent per
// operation, idempotency keys per (operation, action). The service layer only depends
// on this module's API (withStore / readStore), so swapping to PostgreSQL stays local.
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import { hkConfig } from "./config"
import type { OperationResult } from "./types"

export type OperationRecord = OperationResult & {
  sessionId: string
  secrets: {
    vcDocument?: unknown            // mock/opendid issued VC (issuer-signed); never returned to evidence
    holderPublicKeyPem?: string     // holder binding (mock holder)
    holderKeyAlg?: "Ed25519" | "ECDSA-P256"
    presentationChallenge?: string
    lastTxBytesB64?: string         // sponsored user PTB bytes awaiting user signature
    cxToken?: string
    cxTxId?: string
    cxCxId?: string                 // CX-issued correlation id; required by the result call
    proposalPromptDigest?: string
  }
  audit: Array<{ at: string; event: string; detail?: Record<string, unknown> }>
}

export type SessionRecord = { sessionId: string; createdAt: string; lastSeenAt: string; subjectRef: string | null }
export type RedemptionRecord = { redemptionRef: string; subjectRef: string; campaignId: string; operationId: string; redeemedAt: string }
export type OutboxRecord = {
  outboxId: string; operationId: string; eventKey: string; payloadCommitment: string; payload: Record<string, unknown>
  status: "pending" | "submitted" | "confirmed" | "failed" | "unknown"; txHash: string | null; blockNumber: number | null
  attempts: number; lastError: string | null; createdAt: string; updatedAt: string; confirmedAt: string | null
}
export type IdempotencyRecord = { key: string; bodyDigest: string; responseDigest: string; createdAt: string }

export type Db = {
  version: 1
  sessions: Record<string, SessionRecord>
  operations: Record<string, OperationRecord>
  redemptions: Record<string, RedemptionRecord>   // key = `${subjectRef}::${campaignId}`
  outbox: Record<string, OutboxRecord>
  idempotency: Record<string, IdempotencyRecord>
  nonces: Record<string, { operationId: string; consumedAt: string | null; createdAt: string }>
}

const EMPTY: Db = { version: 1, sessions: {}, operations: {}, redemptions: {}, outbox: {}, idempotency: {}, nonces: {} }

// ── backend selection ─────────────────────────────────────────────────
type RedisBackend = { kind: "redis"; url: string; token: string; key: string }
type Backend = RedisBackend | { kind: "file"; path: string }

let backendSingleton: Backend | null = null
function backend(): Backend {
  if (backendSingleton) return backendSingleton
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || ""
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || ""
  if (url && token) {
    backendSingleton = { kind: "redis", url: url.replace(/\/+$/, ""), token, key: process.env.HK_STORE_KEY || "ondo:hackathon:journey:v1" }
    return backendSingleton
  }
  const configured = hkConfig().dataDir
  // Vercel/Lambda: the project dir is read-only; only /tmp is writable (per instance, not durable).
  const dir = process.env.VERCEL && !configured.startsWith("/tmp") ? "/tmp/ondo-hackathon" : resolve(process.cwd(), configured)
  mkdirSync(dir, { recursive: true })
  backendSingleton = { kind: "file", path: resolve(dir, "journey.json") }
  return backendSingleton
}

export function storeBackendKind(): "redis" | "file" { return backend().kind }

// ── file backend ──────────────────────────────────────────────────────
let fileCache: Db | null = null
function fileLoad(path: string): Db {
  if (fileCache) return fileCache
  if (!existsSync(path)) { fileCache = structuredClone(EMPTY); return fileCache }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Db
    fileCache = { ...structuredClone(EMPTY), ...parsed }
  } catch {
    fileCache = structuredClone(EMPTY)
  }
  return fileCache
}
function filePersist(path: string, db: Db) {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmp, JSON.stringify(db), "utf8")
  renameSync(tmp, path)
}

// ── redis backend (Upstash REST) ──────────────────────────────────────
async function redisCmd<T = unknown>(b: RedisBackend, cmd: (string | number)[]): Promise<T> {
  const res = await fetch(b.url, { method: "POST", headers: { authorization: `Bearer ${b.token}`, "content-type": "application/json" }, body: JSON.stringify(cmd), cache: "no-store" })
  const data = (await res.json().catch(() => ({}))) as { result?: T; error?: string }
  if (!res.ok || data.error) throw new Error(`redis ${cmd[0]}: ${data.error ?? res.statusText}`)
  return data.result as T
}
async function redisLoad(b: RedisBackend): Promise<Db> {
  const raw = await redisCmd<string | null>(b, ["GET", b.key])
  if (!raw) return structuredClone(EMPTY)
  try { return { ...structuredClone(EMPTY), ...(JSON.parse(raw) as Db) } } catch { return structuredClone(EMPTY) }
}
async function redisPersist(b: RedisBackend, db: Db) {
  await redisCmd(b, ["SET", b.key, JSON.stringify(db)])
}
async function redisLock(b: RedisBackend): Promise<string> {
  const lockKey = `${b.key}:lock`
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    const ok = await redisCmd<string | null>(b, ["SET", lockKey, token, "NX", "PX", 5000])
    if (ok === "OK") return token
    await new Promise((r) => setTimeout(r, 60 + Math.random() * 90))
  }
  throw new Error("redis lock timeout")
}
async function redisUnlock(b: RedisBackend, token: string) {
  const lockKey = `${b.key}:lock`
  // compare-and-delete so a slow holder never deletes a newer lock
  await redisCmd(b, ["EVAL", "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0", 1, lockKey, token]).catch(() => undefined)
}

// ── housekeeping (keeps the single blob small on a long-running demo) ─
const RETAIN_MS = 3 * 24 * 60 * 60 * 1000
function prune(db: Db) {
  const cutoff = Date.now() - RETAIN_MS
  const stale = (iso: string) => { const t = Date.parse(iso); return Number.isFinite(t) && t < cutoff }
  for (const [id, op] of Object.entries(db.operations)) if (stale(op.updatedAt)) delete db.operations[id]
  for (const [id, s] of Object.entries(db.sessions)) if (stale(s.lastSeenAt) && !s.subjectRef) delete db.sessions[id]
  for (const [id, n] of Object.entries(db.nonces)) if (stale(n.createdAt)) delete db.nonces[id]
  for (const [id, i] of Object.entries(db.idempotency)) if (stale(i.createdAt)) delete db.idempotency[id]
  for (const [id, o] of Object.entries(db.outbox)) if ((o.status === "confirmed" || o.status === "failed") && stale(o.updatedAt)) delete db.outbox[id]
}

// ── public API ────────────────────────────────────────────────────────
let queue: Promise<unknown> = Promise.resolve()

/** Run a read-modify-write transaction; serialized in-process and (redis) across instances. */
export function withStore<T>(fn: (db: Db) => T | Promise<T>): Promise<T> {
  const run = async () => {
    const b = backend()
    if (b.kind === "file") {
      const db = fileLoad(b.path)
      const result = await fn(db)
      prune(db)
      filePersist(b.path, db)
      return result
    }
    const token = await redisLock(b)
    try {
      const db = await redisLoad(b)
      const result = await fn(db)
      prune(db)
      await redisPersist(b, db)
      return result
    } finally {
      await redisUnlock(b, token)
    }
  }
  const next = queue.then(run, run)
  queue = next.catch(() => undefined)
  return next
}

/** Read-only view (fresh from the backend; never mutate the result). */
export async function readStore<T>(fn: (db: Db) => T): Promise<T> {
  const b = backend()
  if (b.kind === "file") return fn(fileLoad(b.path))
  return fn(await redisLoad(b))
}

export function redemptionKey(subjectRef: string, campaignId: string) { return `${subjectRef}::${campaignId}` }
