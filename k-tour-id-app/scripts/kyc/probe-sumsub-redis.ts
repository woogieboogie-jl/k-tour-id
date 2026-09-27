// Operator-only, random-namespace Redis probe. No dotenv, Sumsub SDK/provider,
// app session secrets, chain code, default app namespace or filesystem writes.
import { createHmac, randomBytes, randomUUID } from "node:crypto"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { storeRedisCommand, type RedisConnection } from "../../lib/hackathon/redis-config"
import { createSumsubRecord, mutateSumsubRecord, readSumsubRecord, sumsubStoreConfiguration, type SumsubRecord } from "../../lib/kyc/sumsub-store"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const HEX64 = /^[0-9a-f]{64}$/
const TTL_MS = 120000, RUN_MS = 30000, WORKER_MS = 8000, CLOSE_MS = 2000
const workerPath = fileURLToPath(import.meta.url)
const workerCwd = fileURLToPath(new URL("../../", import.meta.url))
const loader = import.meta.resolve("tsx")
type Command = (string | number)[]
type Mode = "dry" | "fixture" | "live"
type Action = "create" | "revoke" | "event" | "verify" | "expiry"
type Scope = { uuid: string; namespace: string; owner: string; ownerKey: string; secret: string; id: string; expiryId: string; sessionId: string; expiresAt: number; keys: string[] }
type Payload = { mode: "fixture" | "live"; action: Action; connection: RedisConnection; approvedOrigin: string; scope: Scope }
type WorkerResult = { ok: boolean; closed: boolean; pid: number | null; backend: "redis" | null; cases: string[]; requests: number; casAttempts: number }
type Options = { mode?: Mode; connection?: RedisConnection; approvedOrigin?: string; fixtureCommand?: (command: Command) => Promise<unknown> }
const error = () => new Error("sumsub_redis_probe_invalid")

export const SUMSUB_PROBE_CLAIM = "-- ktour-sumsub-probe-claim\nif redis.call('EXISTS',KEYS[1],KEYS[2],KEYS[3]) ~= 0 then return 0 end; redis.call('SET',KEYS[1],ARGV[1],'NX','PX',ARGV[2]); return 1"
export const SUMSUB_PROBE_SET = "-- ktour-sumsub-probe-set\nif redis.call('GET',KEYS[2]) ~= ARGV[1] then return false end; local ttl=redis.call('PTTL',KEYS[2]); if ttl<=0 then return false end; return redis.call('SET',KEYS[1],ARGV[2],'NX','PX',math.min(ttl,tonumber(ARGV[3])))"
export const SUMSUB_PROBE_CAS = "-- ktour-sumsub-probe-cas\nif redis.call('GET',KEYS[2]) ~= ARGV[3] or redis.call('PTTL',KEYS[2])<=0 or redis.call('PTTL',KEYS[1])<=0 then return -1 end; if redis.call('GET',KEYS[1]) == ARGV[1] then redis.call('SET',KEYS[1],ARGV[2],'KEEPTTL'); return 1 end return 0"
export const SUMSUB_PROBE_CLEANUP = "-- ktour-sumsub-probe-cleanup\nif redis.call('GET',KEYS[1]) ~= ARGV[1] then return 0 end; redis.call('DEL',KEYS[2],KEYS[3],KEYS[1]); return 1"
const STORE_CAS = "-- ktour-sumsub-cas\nif redis.call('GET',KEYS[1]) == ARGV[1] then redis.call('SET',KEYS[1],ARGV[2],'KEEPTTL'); return 1 end return 0"

export function approvedSumsubProbeConnection(connection: unknown, approvedOrigin: unknown): RedisConnection {
  const c = connection as RedisConnection | undefined
  if (!c || typeof c.url !== "string" || typeof c.token !== "string" || typeof approvedOrigin !== "string" || c.token.length > 8192) throw error()
  let parsed: URL
  try { parsed = new URL(c.url) } catch { throw error() }
  if (!/^https:\/\/[a-z0-9][a-z0-9-]*\.upstash\.io$/.test(approvedOrigin) || parsed.origin !== approvedOrigin ||
    ![approvedOrigin, approvedOrigin + "/"].includes(c.url)) throw error()
  const config = sumsubStoreConfiguration({ UPSTASH_REDIS_REST_URL: c.url, UPSTASH_REDIS_REST_TOKEN: c.token, SUMSUB_STORE_NAMESPACE: "ktour:sumsub:sandbox:qa-validation" })
  if (!config.connection) throw error()
  return config.connection
}
function makeScope(): Scope {
  const uuid = randomUUID(), namespace = `ktour:sumsub:sandbox:qa-${uuid}`, secret = randomBytes(32).toString("hex")
  const id = `ktour-sbx-${randomUUID()}`, expiryId = `ktour-sbx-${randomUUID()}`, ownerKey = `${namespace}:owner`
  const key = (value: string) => `${namespace}:${createHmac("sha256", secret).update(value).digest("hex")}`
  return { uuid, namespace, secret, id, expiryId, owner: randomBytes(32).toString("hex"), ownerKey, sessionId: randomUUID(), expiresAt: Date.now() + TTL_MS,
    keys: [ownerKey, key(id), key(expiryId)] }
}
function validateScope(s: Scope) {
  if (!s || !UUID.test(s.uuid) || s.namespace !== `ktour:sumsub:sandbox:qa-${s.uuid}` || s.ownerKey !== `${s.namespace}:owner` ||
    !HEX64.test(s.owner) || !HEX64.test(s.secret) || !UUID.test(s.sessionId) ||
    !s.id.startsWith("ktour-sbx-") || !UUID.test(s.id.slice(10)) || !s.expiryId.startsWith("ktour-sbx-") || !UUID.test(s.expiryId.slice(10)) || s.id === s.expiryId ||
    !Number.isSafeInteger(s.expiresAt) || s.expiresAt <= Date.now() || s.expiresAt > Date.now() + TTL_MS || !Array.isArray(s.keys) || s.keys.length !== 3) throw error()
  const expected = [s.ownerKey, ...[s.id, s.expiryId].map(id => `${s.namespace}:${createHmac("sha256", s.secret).update(id).digest("hex")}`)]
  if (!expected.every((key, i) => key === s.keys[i])) throw error()
}
function bounded<T>(pending: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(error()), Math.max(1, ms))
    pending.then(resolve, () => reject(error())).finally(() => clearTimeout(timer))
  })
}
function syntheticRecord(raw: string, key: string | number, scope: Scope) {
  let r: Record<string, unknown>
  try { r = JSON.parse(raw) as Record<string, unknown> } catch { throw error() }
  const expectedId = key === scope.keys[1] ? scope.id : scope.expiryId
  if (!r || Array.isArray(r) || r.version !== 1 || r.externalUserId !== expectedId || r.applicantId !== "qa_synthetic_applicant" || r.levelName !== "qa_synthetic_level" || r.status !== "pending" ||
    r.activeSessionId !== null && r.activeSessionId !== scope.sessionId || !Number.isSafeInteger(r.expiresAt) || Number(r.expiresAt) > scope.expiresAt ||
    key === scope.keys[1] && r.expiresAt !== scope.expiresAt || key === scope.keys[2] && Number(r.expiresAt) > Date.now() + 2000 ||
    Object.keys(r).some(name => !["version", "revision", "externalUserId", "applicantId", "levelName", "status", "expiresAt", "activeSessionId", "activeExpiresAt", "updatedAt", "lastEventAt", "lastEventId", "needsRefresh"].includes(name))) throw error()
}

/** Preserve the real store's SET NX and full-value CAS, adding only a parent
 * owner lease. A delayed request cannot resurrect a key after cleanup/expiry.
 * No other store command, namespace, key, TTL or Lua script is forwarded. */
export function fenceSumsubProbeCommand(command: Command, scope: Scope): Command {
  validateScope(scope)
  const allowedKey = (key: unknown) => key === scope.keys[1] || key === scope.keys[2]
  if (command.length === 2 && (command[0] === "GET" || command[0] === "PTTL") && allowedKey(command[1])) return command
  if (command.length === 6 && command[0] === "SET" && allowedKey(command[1]) && typeof command[2] === "string" && command[2].length <= 4096 &&
    command[3] === "NX" && command[4] === "PX" && Number.isSafeInteger(command[5]) && Number(command[5]) > 0 && Number(command[5]) <= TTL_MS) {
    syntheticRecord(command[2], command[1], scope)
    return ["EVAL", SUMSUB_PROBE_SET, 2, command[1], scope.ownerKey, scope.owner, command[2], command[5]]
  }
  if (command.length === 6 && command[0] === "EVAL" && command[1] === STORE_CAS && command[2] === 1 && allowedKey(command[3]) &&
    typeof command[4] === "string" && command[4].length <= 4096 && typeof command[5] === "string" && command[5].length <= 4096) {
    syntheticRecord(command[4], command[3], scope); syntheticRecord(command[5], command[3], scope)
    return ["EVAL", SUMSUB_PROBE_CAS, 2, command[3], scope.ownerKey, command[4], command[5], scope.owner]
  }
  throw error()
}
const failedWorker = (pid: number | null = null, closed = true): WorkerResult => ({ ok: false, closed, pid, backend: null, cases: [], requests: 0, casAttempts: 0 })

function startWorker(payload: Payload, timeoutMs: number, control: { barrierReady?: (release: () => void) => void; fixtureCommand?: Options["fixtureCommand"] }): Promise<WorkerResult> {
  return new Promise(resolve => {
    // Do not inherit NODE_OPTIONS, provider keys, auth profiles, HOME or app
    // namespace variables. Credentials cross only a private stdin pipe.
    const child = spawn(process.execPath, ["--import", loader, workerPath, "--worker"], { cwd: workerCwd, env: { NODE_ENV: "test" }, stdio: ["pipe", "pipe", "pipe", "ipc"] })
    let output = "", stopped = false, settled = false, watchdog: ReturnType<typeof setTimeout> | undefined
    const finish = (result: WorkerResult) => { if (!settled) { settled = true; clearTimeout(timer); clearTimeout(watchdog); resolve(result) } }
    const kill = () => { if (!stopped) { stopped = true; child.kill("SIGKILL"); watchdog = setTimeout(() => finish(failedWorker(child.pid ?? null, false)), CLOSE_MS) } }
    const timer = setTimeout(kill, Math.max(1, Math.min(timeoutMs, WORKER_MS)))
    child.stdin?.on("error", kill)
    child.stdout?.on("data", chunk => { output += String(chunk); if (output.length > 2048) kill() })
    child.stderr?.resume() // Never forward an SDK/transport exception to output.
    child.on("error", () => finish(failedWorker(child.pid ?? null, !child.pid)))
    child.on("message", async (raw: unknown) => {
      if (settled || stopped || !raw || typeof raw !== "object") return
      const message = raw as { type?: string; id?: number; command?: Command }
      if (message.type === "barrier" && (payload.action === "revoke" || payload.action === "event")) {
        control.barrierReady?.(() => { if (child.connected) child.send({ type: "release" }, () => undefined) })
      } else if (payload.mode === "fixture" && message.type === "fixture-command" && Number.isSafeInteger(message.id) && Array.isArray(message.command) && control.fixtureCommand) {
        try {
          const result = await control.fixtureCommand(message.command)
          if (child.connected) child.send({ type: "fixture-result", id: message.id, result }, () => undefined)
        } catch { if (child.connected) child.send({ type: "fixture-result", id: message.id, failed: true }, () => undefined) }
      }
    })
    child.on("close", code => {
      try {
        const r = JSON.parse(output.trim()) as WorkerResult
        const valid = !stopped && code === 0 && r.ok === true && r.backend === "redis" && r.pid === child.pid &&
          Array.isArray(r.cases) && r.cases.length <= 5 && r.cases.every(name => /^[a-z_]{1,60}$/.test(name)) &&
          Number.isSafeInteger(r.requests) && r.requests >= 0 && r.requests <= 32 && Number.isSafeInteger(r.casAttempts) && r.casAttempts >= 0 && r.casAttempts <= 4
        finish(valid ? { ...r, closed: true } : failedWorker(child.pid ?? null))
      } catch { finish(failedWorker(child.pid ?? null)) }
    })
    child.stdin?.end(JSON.stringify(payload))
  })
}

export async function runSumsubRedisLiveProbe(options: Options = {}) {
  const mode = options.mode ?? "dry"
  if (mode === "dry") return { ok: true, mode, executed: false, liveRedisVerified: false, providerIntegrationVerified: false, cases: [], checks: 0, cleanup: true, failures: 0, fixture: false }
  const failure = () => ({ ok: false, mode: mode === "fixture" ? "fixture" : "live", executed: false, liveRedisVerified: false, providerIntegrationVerified: false, cases: [], checks: 0, cleanup: false, failures: 1, fixture: mode === "fixture" })
  if (!["live", "fixture"].includes(mode) || mode === "live" && options.fixtureCommand || mode === "fixture" && !options.fixtureCommand ||
    process.env.VERCEL || process.env.VERCEL_ENV || process.env.NODE_ENV === "production") return failure()
  let connection: RedisConnection
  try { connection = approvedSumsubProbeConnection(options.connection, options.approvedOrigin) } catch { return failure() }
  const scope = makeScope(), cases: string[] = [], results: WorkerResult[] = []
  const deadline = Date.now() + RUN_MS
  let claimAttempted = false, claimUncertain = false, cleanup = false, completed = false, requests = 0
  const command = async (args: Command, cleaning = false) => {
    const remaining = (cleaning ? deadline + 6000 : deadline) - Date.now()
    if (remaining <= 0 || ++requests > 8) throw error()
    return mode === "fixture" ? bounded(options.fixtureCommand!(args), Math.min(1500, remaining)) : storeRedisCommand(connection, args, { timeoutMs: Math.min(1500, remaining) })
  }
  const worker = async (action: Action, barrierReady?: (release: () => void) => void) => {
    if (Date.now() >= deadline) throw error()
    const result = await startWorker({ mode, action, connection, approvedOrigin: options.approvedOrigin!, scope }, deadline - Date.now(), { barrierReady, fixtureCommand: options.fixtureCommand })
    results.push(result)
    if (!result.ok || !result.closed) throw error()
    cases.push(...result.cases)
    return result
  }
  try {
    claimAttempted = true
    let claim: unknown
    try { claim = await command(["EVAL", SUMSUB_PROBE_CLAIM, 3, ...scope.keys, scope.owner, TTL_MS]) }
    catch { claimUncertain = true; throw error() }
    if (claim !== 1) { claimUncertain = claim !== 0; throw error() }
    cases.push("random_namespace_claim")
    await worker("create")
    const releases: Array<() => void> = []
    const ready = (release: () => void) => { releases.push(release); if (releases.length === 2) releases.forEach(go => go()) }
    const writers = await Promise.allSettled([worker("revoke", ready), worker("event", ready)])
    if (writers.some(result => result.status !== "fulfilled")) throw error()
    const writerResults = writers.map(result => (result as PromiseFulfilledResult<WorkerResult>).value)
    if (releases.length !== 2 || writerResults.reduce((n, result) => n + result.casAttempts, 0) < 3) throw error()
    cases.push("forced_full_value_cas_retry")
    await worker("verify")
    await worker("expiry")
    if (new Set(results.map(result => result.pid)).size !== 5) throw error()
    cases.push("separate_process_persistence")
    completed = true
  } catch { /* A fixed result only; no credentials, raw errors or row values. */ }
  finally {
    if (claimAttempted && results.every(result => result.closed)) {
      try {
        const removed = await command(["EVAL", SUMSUB_PROBE_CLEANUP, 3, ...scope.keys, scope.owner], true)
        const remaining = await command(["EXISTS", ...scope.keys], true)
        cleanup = removed === 1 && remaining === 0 && !claimUncertain
        if (cleanup) cases.push("owned_keys_removed")
      } catch { cleanup = false }
    }
  }
  const ok = completed && cleanup
  return { ok, mode, executed: claimAttempted, liveRedisVerified: ok && mode === "live", providerIntegrationVerified: false,
    fixture: mode === "fixture", namespace: scope.namespace, cases, checks: cases.length, cleanup, failures: ok ? 0 : 1,
    workersClosed: results.every(result => result.closed), processes: new Set(results.map(result => result.pid).filter(Boolean)).size,
    commandsReported: requests + results.reduce((n, result) => n + result.requests, 0), ttlFallbackSeconds: TTL_MS / 1000 }
}

async function readPrivateStdin(): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let length = 0, done = false
    const finish = (value?: unknown, failed = false) => { if (done) return; done = true; clearTimeout(timer); process.stdin.removeListener("data", data); process.stdin.removeListener("end", end); process.stdin.pause(); failed ? reject(error()) : resolve(value) }
    const data = (chunk: Buffer) => { length += chunk.length; if (length > 16384) finish(undefined, true); else chunks.push(chunk) }
    const end = () => { try { finish(JSON.parse(Buffer.concat(chunks).toString("utf8"))) } catch { finish(undefined, true) } }
    const timer = setTimeout(() => finish(undefined, true), 2500)
    process.stdin.on("data", data); process.stdin.once("end", end); process.stdin.once("error", () => finish(undefined, true))
  })
}

async function workerMain(payload: Payload) {
  if (!process.send || !["live", "fixture"].includes(payload.mode) || !["create", "revoke", "event", "verify", "expiry"].includes(payload.action)) throw error()
  validateScope(payload.scope)
  const connection = approvedSumsubProbeConnection(payload.connection, payload.approvedOrigin), s = payload.scope
  process.env = { NODE_ENV: "test", UPSTASH_REDIS_REST_URL: connection.url, UPSTASH_REDIS_REST_TOKEN: connection.token, SUMSUB_STORE_NAMESPACE: s.namespace }
  const config = sumsubStoreConfiguration()
  if (!config.connection || config.prefix !== s.namespace) throw error()
  const nativeFetch = globalThis.fetch, pending = new Map<number, { resolve: (value: unknown) => void; reject: () => void }>()
  let requestId = 0, requests = 0, casAttempts = 0, firstRead = true, barrierRelease: (() => void) | undefined
  process.on("message", (raw: unknown) => {
    const message = raw as { type?: string; id?: number; failed?: boolean; result?: unknown }
    if (message?.type === "release") { barrierRelease?.(); barrierRelease = undefined }
    if (message?.type === "fixture-result" && Number.isSafeInteger(message.id)) {
      const p = pending.get(message.id!)
      if (p) { pending.delete(message.id!); message.failed ? p.reject() : p.resolve(message.result) }
    }
  })
  const transport = async (command: Command) => {
    if (++requests > 32) throw error()
    if (payload.mode === "fixture") return new Promise<unknown>((resolve, reject) => {
      const id = ++requestId
      pending.set(id, { resolve, reject: () => reject(error()) })
      process.send!({ type: "fixture-command", id, command })
    })
    return storeRedisCommand(connection, command, { fetchImpl: nativeFetch, timeoutMs: 1200 })
  }
  if (await transport(["GET", s.ownerKey]) !== s.owner) throw error()
  globalThis.fetch = async (url, init) => {
    if (String(url) !== connection.url || init?.method !== "POST" || new Headers(init.headers).get("authorization") !== `Bearer ${connection.token}`) throw error()
    const original = JSON.parse(String(init.body)) as Command
    const command = fenceSumsubProbeCommand(original, s)
    if (original[0] === "EVAL") casAttempts++
    const result = await transport(command)
    if ((payload.action === "revoke" || payload.action === "event") && original[0] === "GET" && firstRead) {
      firstRead = false
      await new Promise<void>(resolve => { barrierRelease = resolve; process.send!({ type: "barrier" }) })
    }
    return Response.json({ result })
  }
  const cases: string[] = [], ensure = (ok: unknown, name: string) => { if (!ok) throw error(); cases.push(name) }
  const record = (id: string, expiresAt: number): Omit<SumsubRecord, "revision" | "updatedAt"> => ({ version: 1, externalUserId: id, applicantId: "qa_synthetic_applicant",
    levelName: "qa_synthetic_level", status: "pending", expiresAt, activeSessionId: s.sessionId, activeExpiresAt: expiresAt, lastEventAt: 0, needsRefresh: false })
  try {
    if (payload.action === "create") {
      ensure(await createSumsubRecord(record(s.id, s.expiresAt), s.secret) === true, "real_store_set_nx")
      ensure(await createSumsubRecord(record(s.id, s.expiresAt), s.secret) === false, "duplicate_create_rejected")
      const current = await readSumsubRecord(s.id, s.secret)
      ensure(current?.revision === 0 && current.activeSessionId === s.sessionId && current.expiresAt === s.expiresAt, "initial_store_read")
    } else if (payload.action === "revoke") {
      const changed = await mutateSumsubRecord(s.id, s.secret, current => ({ ...current, activeSessionId: null, activeExpiresAt: 0 }))
      ensure(changed?.activeSessionId === null && changed.activeExpiresAt === 0, "session_revocation_written")
    } else if (payload.action === "event") {
      const changed = await mutateSumsubRecord(s.id, s.secret, current => ({ ...current, lastEventAt: 200, lastEventId: "qa_synthetic_event", needsRefresh: true }))
      ensure(changed?.lastEventAt === 200 && changed.needsRefresh === true, "event_metadata_written")
    } else if (payload.action === "verify") {
      const current = await readSumsubRecord(s.id, s.secret)
      ensure(current?.revision === 2 && current.activeSessionId === null && current.activeExpiresAt === 0 && current.lastEventAt === 200 && current.lastEventId === "qa_synthetic_event" && current.needsRefresh === true && current.status === "pending" && current.expiresAt === s.expiresAt, "parallel_updates_preserved")
      ensure(await mutateSumsubRecord(s.id, s.secret, value => value.activeSessionId === s.sessionId ? { ...value, status: "approved" } : null) === null, "stale_session_update_rejected")
      ensure(await mutateSumsubRecord(s.id, s.secret, value => value.lastEventAt >= 100 ? null : { ...value, lastEventAt: 100 }) === null, "stale_event_update_rejected")
      const after = await readSumsubRecord(s.id, s.secret)
      ensure(after?.revision === 2 && after.status === "pending" && after.activeSessionId === null, "revocation_not_resurrected")
      const ttl = await transport(["PTTL", s.keys[1]])
      ensure(typeof ttl === "number" && ttl > 0 && ttl <= TTL_MS, "cas_retains_short_ttl")
    } else {
      const expiresAt = Date.now() + 2000
      ensure(await createSumsubRecord(record(s.expiryId, expiresAt), s.secret), "expiring_record_created")
      const ttl = await transport(["PTTL", s.keys[2]])
      if (typeof ttl !== "number" || ttl <= 0 || ttl > 2000) throw error()
      await new Promise(resolve => setTimeout(resolve, ttl + 75))
      ensure(await readSumsubRecord(s.expiryId, s.secret) === null && await transport(["GET", s.keys[2]]) === null && await transport(["PTTL", s.keys[2]]) === -2, "native_redis_ttl_expired")
      ensure(await mutateSumsubRecord(s.expiryId, s.secret, current => ({ ...current, needsRefresh: true })) === null, "expired_record_not_resurrected")
    }
    return { ok: true, pid: process.pid, backend: "redis", cases, requests, casAttempts }
  } finally { globalThis.fetch = nativeFetch }
}

if (process.argv[1] === workerPath) {
  const args = process.argv.slice(2)
  if (args.length === 1 && args[0] === "--worker") {
    try { const result = await workerMain(await readPrivateStdin() as Payload); process.stdout.write(JSON.stringify(result)); process.disconnect?.() }
    catch { process.stdout.write('{"ok":false}'); process.exitCode = 1; process.disconnect?.() }
  } else if (args.length === 0 || args.length === 1 && args[0] === "--dry") {
    process.stdout.write(JSON.stringify(await runSumsubRedisLiveProbe()) + "\n")
  } else if (args.length === 1 && args[0] === "--live") {
    try {
      const input = await readPrivateStdin() as { connection?: RedisConnection; approvedOrigin?: string }
      const result = await runSumsubRedisLiveProbe({ mode: "live", connection: input.connection, approvedOrigin: input.approvedOrigin })
      process.stdout.write(JSON.stringify(result) + "\n"); process.exitCode = result.ok ? 0 : 1
    } catch { process.stdout.write('{"ok":false,"executed":false,"liveRedisVerified":false,"failures":1}\n'); process.exitCode = 1 }
  } else { process.stdout.write('{"ok":false,"executed":false,"liveRedisVerified":false,"failures":1}\n'); process.exitCode = 1 }
}
