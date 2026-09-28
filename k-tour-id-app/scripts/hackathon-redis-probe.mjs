import { randomUUID } from "node:crypto"
import { pathToFileURL } from "node:url"

const TTL = 120_000
const TIMEOUT = 10_000
const URL_ENV = "UPSTASH_REDIS_REST_URL"
const TOKEN_ENV = "UPSTASH_REDIS_REST_TOKEN"

/** Credentials only; callers must apply their own execution gate first. @param {Record<string, string | undefined>} env */
export function redisProbeCredentials(env) {
  const upstashUrl = env[URL_ENV] ?? ""
  const upstashToken = env[TOKEN_ENV] ?? ""
  const kvUrl = env.KV_REST_API_URL ?? ""
  const kvToken = env.KV_REST_API_TOKEN ?? ""
  const upstashAny = Boolean(upstashUrl || upstashToken)
  const kvAny = Boolean(kvUrl || kvToken)
  if ((upstashAny && Boolean(upstashUrl) !== Boolean(upstashToken)) || (kvAny && Boolean(kvUrl) !== Boolean(kvToken)) || (upstashAny && kvAny)) return { ok: false, reason: "configuration" }
  const url = upstashUrl || kvUrl
  const token = upstashToken || kvToken
  if (!url) return { ok: false, reason: "configuration" }
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) return { ok: false, reason: "configuration" }
  } catch { return { ok: false, reason: "configuration" } }
  return { ok: true, url, token }
}

/** @param {Record<string, string | undefined>} [env] @param {string[]} [args] */
export function validateRedisProbeEnv(env = process.env, args = []) {
  if (args.length) return { ok: false, reason: "configuration" }
  const config = redisProbeCredentials(env)
  if (!config.ok) return config
  if (env.HK_REDIS_PROBE_ALLOW_WRITE !== "1" || env.VERCEL_ENV === "production" || env.NODE_ENV === "production") return { ok: false, reason: "execution_gate" }
  return config
}

function summary(ok, checks, cleanup, failures = 0) { return { ok, checks, cleanup, failures } }

/** @param {{ env?: Record<string, string | undefined>, fetchImpl?: typeof fetch, uuid?: string, args?: string[] }} [options] */
export async function runRedisProbe({ env = process.env, fetchImpl = globalThis.fetch, uuid = randomUUID(), args = [] } = {}) {
  const config = validateRedisProbeEnv(env, args)
  if (!config.ok) return summary(false, 0, false, 1)
  return runRedisProbeCore({ url: config.url, token: config.token, fetchImpl, uuid })
}

/**
 * Own-key primitives only: no app store, session, provider, or file fallback.
 * The CLI and temporary Preview handler retain separate execution gates.
 * @param {{ url: string, token: string, fetchImpl?: typeof fetch, uuid?: string, workTimeoutMs?: number, cleanupTimeoutMs?: number }} options
 */
export async function runRedisProbeCore({ url, token, fetchImpl = globalThis.fetch, uuid = randomUUID(), workTimeoutMs = 25_000, cleanupTimeoutMs = 8_000 }) {
  const base = `ktour:probe:${uuid}`
  const lock = `${base}:lock`
  const value = `${base}:value`
  const owner = randomUUID()
  const keys = [lock, value]
  let checks = 0
  let failures = 0
  let acquired = false
  let cleanupOk = true
  let knownValue
  let phaseSignal = AbortSignal.timeout(Math.max(1, Math.min(25_000, workTimeoutMs)))
  const command = async (name, args = []) => {
    const signal = AbortSignal.any([phaseSignal, AbortSignal.timeout(TIMEOUT)])
    signal.throwIfAborted()
    // Race the entire fetch AND body read. A lost response remains an uncertain
    // write even if a transport ignores cancellation; never claim it was undone.
    const pending = (async () => {
      const response = await fetchImpl(url, {
        method: "POST", redirect: "error", cache: "no-store",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify([name, ...args]), signal,
      })
      if (!response.ok) { await response.body?.cancel(); throw new Error("redis_probe_upstream") }
      const reader = response.body?.getReader()
      if (!reader) throw new Error("redis_probe_response")
      const chunks = []
      let size = 0
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > 16_384) { await reader.cancel(); throw new Error("redis_probe_response") }
          chunks.push(value)
        }
      } finally { reader.releaseLock() }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"))
      if (!body || Object.prototype.hasOwnProperty.call(body, "error") || !Object.prototype.hasOwnProperty.call(body, "result")) throw new Error("redis_probe_response")
      if ((name === "SET" && body.result !== "OK" && body.result !== null) ||
        (name === "EVAL" && body.result !== 0 && body.result !== 1)) throw new Error("redis_probe_response")
      return body.result
    })()
    return await new Promise((resolve, reject) => {
      const abort = () => reject(new Error("redis_probe_timeout"))
      signal.addEventListener("abort", abort, { once: true })
      pending.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort))
      if (signal.aborted) abort()
    })
  }
  const check = async (work, mayWrite = false) => {
    try { const result = await work(); checks += 1; return result }
    catch {
      failures += 1
      // A lost response cannot prove that Redis did not perform the write.
      // TTL is the fallback; do not report cleanup as confirmed in this case.
      if (mayWrite) cleanupOk = false
      return undefined
    }
  }
  try {
    const ping = await check(() => command("PING"))
    if (ping !== "PONG") failures += 1
    else {
      const first = await check(() => command("SET", [lock, owner, "NX", "PX", String(TTL)]), true)
      acquired = first === "OK"
      if (!acquired) failures += 1
    }
    if (acquired) {
      const second = await check(() => command("SET", [lock, randomUUID(), "NX", "PX", String(TTL)]), true)
      if (second !== null) failures += 1
      const created = await check(() => command("SET", [value, "initial", "NX", "PX", String(TTL)]), true)
      if (created === "OK") knownValue = "initial"
      else failures += 1
      if (knownValue) {
        const initial = await check(() => command("GET", [value]))
        if (initial !== "initial") failures += 1
        const stale = await check(() => command("EVAL", [
          "if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('SET', KEYS[2], ARGV[2], 'PX', ARGV[3]); return 1 else return 0 end",
          "2", lock, value, "stale-owner", "stale", String(TTL),
        ]), true)
        if (stale !== 0) failures += 1
        const afterStale = await check(() => command("GET", [value]))
        if (afterStale !== "initial") failures += 1
        const current = await check(() => command("EVAL", [
          "if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('SET', KEYS[2], ARGV[2], 'PX', ARGV[3]); return 1 else return 0 end",
          "2", lock, value, owner, "current", String(TTL),
        ]), true)
        if (current !== 1) failures += 1
        else knownValue = "current"
        const afterCurrent = await check(() => command("GET", [value]))
        if (afterCurrent !== "current") failures += 1
      }
    }
  } finally {
    phaseSignal = AbortSignal.timeout(Math.max(1, Math.min(8_000, cleanupTimeoutMs)))
    if (acquired) {
      for (const key of keys) {
        const expected = key === lock ? owner : knownValue
        if (!expected) continue
        const deleted = await check(() => command("EVAL", [
          "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end",
          "1", key, expected,
        ]))
        if (deleted !== 1) { cleanupOk = false; failures += 1 }
      }
    }
  }
  return summary(failures === 0 && acquired && cleanupOk, checks, cleanupOk, failures)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const result = await runRedisProbe({ env: process.env, args: process.argv.slice(2) })
  process.stdout.write(`${JSON.stringify(result)}\n`)
  process.exitCode = result.ok ? 0 : 1
}
