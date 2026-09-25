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
import { HkError } from "./util"
import { parseStoredJourney } from "./store-integrity"
import { previewRedisConfig, storeRedisCommand, type StoreCanaryOwnership } from "./redis-config"

export type OperationRecord = OperationResult & {
  sessionId: string
  secrets: {
    vcDocument?: unknown            // mock/opendid issued VC (issuer-signed); never returned to evidence
    holderPublicKeyPem?: string     // holder binding (mock holder)
    holderKeyAlg?: "Ed25519" | "ECDSA-P256"
    presentationChallenge?: string
    presentationBinding?: { operationId: string; presentationId: string; nonce: string; credentialRef: string; vcDigest: string; holderBinding: string; requestDigest: string; decisionRef: string; subjectRef: string }
    delegationPreparation?: { claimId: string; stage: "issuing" | "building" | "ready" | "unknown"; issueTxDigest: string | null }
    lastTxBytesB64?: string         // sponsored user PTB bytes awaiting user signature
    cxToken?: string
    cxTxId?: string
    cxCxId?: string                 // CX-issued correlation id; required by the result call
    cxStartClaim?: { id: string; expiresAt: string }
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
  // Durable worker ownership; never exposed in the public chain summary.
  processingClaim?: { id: string; expiresAt: string }
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
type RedisBackend = { kind: "redis"; url: string; token: string; key: string; canary?: StoreCanaryOwnership }
type Backend = RedisBackend | { kind: "file"; path: string }

let backendSingleton: Backend | null = null
function backend(): Backend {
  if (process.env.NEXT_PUBLIC_HK_CX_PREVIEW === "1" || process.env.HK_STORE_CANARY_UUID || process.env.HK_STORE_CANARY_OWNER) {
    const config = previewRedisConfig(process.env)
    if (hkConfig().isolatedMock) throw new HkError("store_configuration", "CX Preview requires isolated Redis storage, not file fallback.", 503)
    if (backendSingleton && (backendSingleton.kind !== "redis" || backendSingleton.url !== config.url ||
      backendSingleton.token !== config.token || backendSingleton.key !== config.key ||
      backendSingleton.canary?.ownerToken !== config.canary?.ownerToken)) {
      throw new HkError("store_configuration", "Journey storage configuration changed; restart the instance.", 503)
    }
    backendSingleton ??= { kind: "redis", ...config }
    return backendSingleton
  }
  if (backendSingleton) return backendSingleton
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || ""
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || ""
  if (!hkConfig().isolatedMock && url && token) {
    backendSingleton = { kind: "redis", url: url.replace(/\/+$/, ""), token, key: process.env.HK_STORE_KEY || "ondo:hackathon:journey:v1" }
    return backendSingleton
  }
  const configured = hkConfig().dataDir
  // Vercel/Lambda: the project dir is read-only; only /tmp is writable (per instance, not durable).
  const dir = !hkConfig().isolatedMock && process.env.VERCEL && !configured.startsWith("/tmp") ? "/tmp/ondo-hackathon" : resolve(process.cwd(), configured)
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
  // An unreadable ledger must never silently become a fresh, redeemable account.
  fileCache = parseStoredJourney(readFileSync(path, "utf8"))
  return fileCache
}
function filePersist(path: string, db: Db) {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmp, JSON.stringify(db), "utf8")
  renameSync(tmp, path)
}

// ── redis backend (Upstash REST) ──────────────────────────────────────
async function redisCmd<T = unknown>(b: RedisBackend, cmd: (string | number)[]): Promise<T> {
  return storeRedisCommand<T>(b, cmd, { timeoutMs: b.canary ? 3000 : 8000 })
}
async function redisLoad(b: RedisBackend): Promise<Db> {
  if (b.canary) {
    const raw = await redisCmd<string | null>(b, ["EVAL", "-- ktour-canary-load\nif redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('GET', KEYS[2]) end return false", 2, b.canary.ownerKey, b.key, b.canary.ownerToken])
    if (raw === null) throw new HkError("store_canary_ownership", "Canary ownership is unavailable.", 503)
    return parseStoredJourney(raw)
  }
  const raw = await redisCmd<string | null>(b, ["GET", b.key])
  if (raw === null) return structuredClone(EMPTY)
  return parseStoredJourney(raw)
}
async function redisPersist(b: RedisBackend, db: Db, token: string) {
  // Atomic compare-and-write: an expired lease cannot overwrite a newer owner.
  const committed = b.canary
    ? await redisCmd<number>(b, ["EVAL", "-- ktour-canary-commit\nif redis.call('GET', KEYS[1]) == ARGV[1] and redis.call('GET', KEYS[3]) == ARGV[3] then redis.call('SET', KEYS[2], ARGV[2], 'PX', ARGV[4]); return 1 end return 0", 3, `${b.key}:lock`, b.key, b.canary.ownerKey, token, JSON.stringify(db), b.canary.ownerToken, b.canary.ttlMs])
    : await redisCmd<number>(b, ["EVAL", "if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('SET', KEYS[2], ARGV[2]); return 1 end return 0", 2, `${b.key}:lock`, b.key, token, JSON.stringify(db)])
  if (committed !== 1) throw new HkError("store_lease_lost", "Journey changed while saving. Check the current result before retrying.", 503)
}
async function redisLock(b: RedisBackend): Promise<string> {
  const lockKey = `${b.key}:lock`
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    const ok = b.canary
      ? await redisCmd<string | null | number>(b, ["EVAL", "-- ktour-canary-lock\nif redis.call('GET', KEYS[1]) ~= ARGV[1] then return -1 end return redis.call('SET', KEYS[2], ARGV[2], 'NX', 'PX', 5000)", 2, b.canary.ownerKey, lockKey, b.canary.ownerToken, token])
      : await redisCmd<string | null>(b, ["SET", lockKey, token, "NX", "PX", 5000])
    if (ok === -1 && b.canary) throw new HkError("store_canary_ownership", "Canary ownership is unavailable.", 503)
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
  const expired = (iso: string | undefined) => Boolean(iso) && (!Number.isFinite(Date.parse(iso!)) || Date.parse(iso!) <= Date.now())
  for (const [id, op] of Object.entries(db.operations)) {
    const terminal = ["failed", "cancelled", "expired"].includes(op.status) || expired(op.expiresAt)
    const expiredHandoff = expired(op.identity?.handoff?.expiresAt)
    const secrets = op.secrets
    if (secrets && (op.identity?.mode === "cx" || secrets.cxToken || secrets.cxTxId || secrets.cxCxId || secrets.cxStartClaim) &&
      (terminal || expiredHandoff || expired(secrets.cxStartClaim?.expiresAt))) {
      delete secrets.cxToken; delete secrets.cxTxId; delete secrets.cxCxId; delete secrets.cxStartClaim
      if (op.identity && (terminal || expiredHandoff)) {
        if (op.identity.personVerified) op.identity.handoff = null
        else op.identity = null
      }
    }
    if (stale(op.updatedAt)) delete db.operations[id]
  }
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
      // Failed mutations must not leak through the in-memory cache or a later write.
      const db = structuredClone(fileLoad(b.path))
      const result = await fn(db)
      prune(db)
      filePersist(b.path, db)
      fileCache = db
      return structuredClone(result)
    }
    const token = await redisLock(b)
    try {
      const db = await redisLoad(b)
      const result = await fn(db)
      prune(db)
      await redisPersist(b, db, token)
      return structuredClone(result)
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
  if (b.kind === "file") return fn(structuredClone(fileLoad(b.path)))
  return fn(await redisLoad(b))
}

export function redemptionKey(subjectRef: string, campaignId: string) { return `${subjectRef}::${campaignId}` }
