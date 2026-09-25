import { randomBytes, randomUUID } from "node:crypto"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { previewRedisConfig, storeRedisCommand } from "../lib/hackathon/redis-config"

const workerFile = fileURLToPath(new URL("./hackathon-store-canary-worker.ts", import.meta.url))
const workerCwd = fileURLToPath(new URL("../", import.meta.url))
const loader = import.meta.resolve("tsx")
const TTL = 120000
const EMPTY = JSON.stringify({ version: 1, sessions: {}, operations: {}, redemptions: {}, outbox: {}, idempotency: {}, nonces: {} })
export const CANARY_CLAIM = "-- ktour-canary-claim\nif redis.call('EXISTS', KEYS[1], KEYS[2], KEYS[3]) ~= 0 then return 0 end redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[3]); redis.call('SET', KEYS[2], ARGV[2], 'PX', ARGV[3]); return 1"
export const CANARY_CLEANUP = "-- ktour-canary-cleanup\nif redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('DEL', KEYS[2], KEYS[3], KEYS[1]); return 1 end return 0"
type Env = Record<string, string | undefined>
type WorkerResult = { ok: boolean; closed: boolean; pid?: number; backend?: string }
type WorkerRunner = (operation: "write" | "read", id: string, env: Env, timeoutMs: number) => Promise<WorkerResult>
type Options = { env?: Env; fetchImpl?: typeof fetch; fixtureWorkers?: boolean; runWorker?: WorkerRunner; workerTimeoutMs?: number }

function startWorker(operation: "write" | "read", id: string, env: Env, timeoutMs: number, fixtureFetch?: typeof fetch): Promise<WorkerResult> {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ["--import", loader, workerFile, operation, id], {
      cwd: workerCwd, env: { ...env, NODE_ENV: "test", ...(fixtureFetch ? { HK_STORE_CANARY_FIXTURE: "1" } : {}) },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    })
    let output = ""
    let stopped = false
    let settled = false
    let closeWatchdog: ReturnType<typeof setTimeout> | undefined
    const finish = (result: WorkerResult) => {
      if (settled) return
      settled = true; clearTimeout(timer); clearTimeout(closeWatchdog); resolve(result)
    }
    const kill = () => {
      if (stopped) return
      stopped = true; child.kill("SIGKILL")
      // Never pretend kill() itself proves the worker has exited.
      closeWatchdog = setTimeout(() => finish({ ok: false, closed: false }), 2000)
    }
    const timer = setTimeout(kill, Math.max(1, Math.min(timeoutMs, 12000)))
    child.stdout?.on("data", chunk => { output += String(chunk); if (output.length > 4096) kill() })
    child.stderr?.resume() // Drain without exposing worker exception text or secrets.
    child.on("error", () => finish({ ok: false, closed: !child.pid }))
    child.on("close", code => {
      try {
        const result = JSON.parse(output.trim()) as WorkerResult
        finish({ ok: !stopped && code === 0 && result.ok === true && result.backend === "redis" && result.pid === child.pid,
          closed: true, pid: child.pid, backend: result.backend })
      } catch { finish({ ok: false, closed: true, pid: child.pid }) }
    })
    if (fixtureFetch) child.on("message", async (message: { id?: number; command?: (string | number)[] }) => {
      if (!Number.isInteger(message.id) || !Array.isArray(message.command)) return
      try {
        const config = previewRedisConfig(env)
        const result = await storeRedisCommand(config, message.command, { fetchImpl: fixtureFetch, timeoutMs: 3000 })
        if (child.connected) child.send({ id: message.id, result }, () => undefined)
      } catch { if (child.connected) child.send({ id: message.id, failed: true }, () => undefined) }
    })
  })
}

export async function runStoreCanary(options: Options = {}) {
  const env = options.env ?? process.env
  const failure = () => ({ ok: false, checks: 0, cleanup: false, failures: 1 })
  if (env.HK_STORE_CANARY_ALLOW_WRITE !== "1" || env.VERCEL_ENV === "production" ||
    (options.fixtureWorkers && !options.fetchImpl)) return failure()
  const uuid = randomUUID()
  const key = `ktour:cx-preview:canary:${uuid}:journey`
  const owner = randomBytes(32).toString("hex")
  // Parent-generated identifiers override and never use an inherited app ledger.
  const childEnv: Env = {
    PATH: env.PATH ?? "", NODE_ENV: "test", NEXT_PUBLIC_HK_CX_PREVIEW: "1",
    NEXT_PUBLIC_HK_PREVIEW_READ_ONLY: "0", HK_ISOLATED_MOCK: "0",
    HK_MODE_CX: "mock", HK_MODE_OPENDID: "mock", HK_AI_MODE: "rule",
    HK_STORE_CANARY_ALLOW_WRITE: "1", HK_STORE_CANARY_UUID: uuid, HK_STORE_CANARY_OWNER: owner,
    HK_STORE_KEY: key, HK_ISSUER_SIGNING_SEED: randomBytes(32).toString("hex"),
    UPSTASH_REDIS_REST_URL: env.UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN: env.UPSTASH_REDIS_REST_TOKEN,
    KV_REST_API_URL: env.KV_REST_API_URL, KV_REST_API_TOKEN: env.KV_REST_API_TOKEN,
  }
  let config: ReturnType<typeof previewRedisConfig>
  try { config = previewRedisConfig(childEnv) } catch { return failure() }
  const command = (cmd: (string | number)[]) => storeRedisCommand(config, cmd, { fetchImpl: options.fetchImpl, timeoutMs: 3000 })
  const keys = [config.canary!.ownerKey, key, `${key}:lock`]
  const runner = options.runWorker ?? ((op, id, workerEnv, timeout) => startWorker(op, id, workerEnv,
    Math.min(timeout, options.workerTimeoutMs ?? 12000), options.fixtureWorkers ? options.fetchImpl : undefined))
  let checks = 0
  let cleanup = false
  let passed = false
  let claimAttempted = false
  let claimUncertain = false
  let allWorkersClosed = true
  const deadline = Date.now() + 22000
  try {
    claimAttempted = true
    let claim: unknown
    try { claim = await command(["EVAL", CANARY_CLAIM, 3, ...keys, owner, EMPTY, TTL]) }
    catch { claimUncertain = true; throw new Error("claim_unknown") }
    if (claim !== 1) { if (claim !== 0) claimUncertain = true; throw new Error("claim_failed") }
    checks += 1
    const writes = await Promise.allSettled([runner("write", "a", childEnv, deadline - Date.now()), runner("write", "b", childEnv, deadline - Date.now())])
    const results = writes.map(item => item.status === "fulfilled" ? item.value : { ok: false, closed: false })
    allWorkersClosed = results.every(item => item.closed)
    if (results.some(item => !item.ok || item.backend !== "redis") || new Set(results.map(item => item.pid)).size !== 2) throw new Error("writes_failed")
    checks += 2
    if (Date.now() >= deadline) throw new Error("deadline")
    let read: WorkerResult
    try { read = await runner("read", "reader", childEnv, deadline - Date.now()) }
    catch { allWorkersClosed = false; throw new Error("reader_unknown") }
    allWorkersClosed &&= read.closed
    if (!read.ok || read.backend !== "redis" || results.some(item => item.pid === read.pid)) throw new Error("read_failed")
    checks += 1
    passed = true
  } catch { passed = false }
  finally {
    if (claimAttempted) {
      try {
        const deleted = await command(["EVAL", CANARY_CLEANUP, 3, ...keys, owner])
        const remaining = await command(["EXISTS", ...keys])
        cleanup = deleted === 1 && remaining === 0 && !claimUncertain && allWorkersClosed
        if (cleanup) checks += 2
      } catch { cleanup = false }
    }
  }
  const ok = passed && cleanup
  return { ok, checks, cleanup, failures: ok ? 0 : 1 }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = process.argv.length === 2 ? await runStoreCanary() : { ok: false, checks: 0, cleanup: false, failures: 1 }
  process.stdout.write(`${JSON.stringify(result)}\n`)
  process.exitCode = result.ok ? 0 : 1
}
