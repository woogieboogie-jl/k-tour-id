import assert from "node:assert/strict"
import test, { type TestContext } from "node:test"
import { setImmediate } from "node:timers/promises"
import { geminiGenerate, GEMINI_MAX_RESPONSE_BYTES, GEMINI_TIMEOUT_MS } from "../../lib/gemini"

const KEY = "synthetic-provider-key-no-real-network"
const LEAK = "private-provider-diagnostic-must-not-escape"
const opts = { key: KEY, model: "fixture-bounded-model", system: "fixture", message: "fixture" }
const ok = (text = "safe reply") => Response.json({ candidates: [{ content: { parts: [{ text }] } }] })
function setup(t: TestContext) {
  const oldFetch = globalThis.fetch
  const oldEnv = process.env
  process.env = { NODE_ENV: "test" }
  t.after(() => { globalThis.fetch = oldFetch; process.env = oldEnv })
}
function safe(result: unknown) {
  assert.doesNotMatch(JSON.stringify(result), new RegExp(`${KEY}|${LEAK}`))
}

test("Gemini uses one fixed HTTPS target, key header, no redirects/cache/cookies", async t => {
  setup(t)
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://generativelanguage.googleapis.com/v1beta/models/fixture-bounded-model:generateContent")
    assert.equal(new Headers(init?.headers).get("x-goog-api-key"), KEY)
    assert.equal(init?.redirect, "error")
    assert.equal(init?.cache, "no-store")
    assert.equal(init?.credentials, "omit")
    assert.ok(init?.signal instanceof AbortSignal)
    return ok()
  }
  assert.deepEqual(await geminiGenerate(opts), { reply: "safe reply", model: opts.model })
})

test("structured output excludes thought parts and requires a completed candidate", async t => {
  setup(t)
  globalThis.fetch = async () => Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [
    { thought: true, text: LEAK }, { text: '{"answer":"safe"}' },
  ] } }] })
  const result = await geminiGenerate({ ...opts, responseJsonSchema: { type: "object" } })
  assert.deepEqual(result, { reply: '{"answer":"safe"}', model: opts.model })
  safe(result)
})

test("fetch deadline returns even when transport ignores abort; late reply cannot populate cache", async t => {
  setup(t)
  t.mock.timers.enable({ apis: ["setTimeout"] })
  let resolveFetch!: (res: Response) => void
  let signal: AbortSignal | null | undefined
  let calls = 0
  globalThis.fetch = (_url, init) => {
    calls++; signal = init?.signal
    return new Promise(resolve => { resolveFetch = resolve })
  }
  const pending = geminiGenerate({ ...opts, model: "late-must-not-cache" })
  t.mock.timers.tick(GEMINI_TIMEOUT_MS)
  const result = await pending
  assert.deepEqual(result, { error: "gemini_provider_timeout" })
  assert.equal(signal?.aborted, true)
  assert.equal(calls, 1)
  let cancelled = false
  resolveFetch(new Response(new ReadableStream({ cancel() { cancelled = true } })))
  await setImmediate()
  assert.equal(cancelled, true)
  globalThis.fetch = async url => {
    assert.equal(String(url).includes("late-must-not-cache"), false)
    return ok()
  }
  assert.equal((await geminiGenerate({ key: KEY, system: "fixture", message: "fixture" })).reply, "safe reply")
  safe(result)
})

test("body deadline cancels a stalled stream without awaiting a stuck cancellation", async t => {
  setup(t)
  t.mock.timers.enable({ apis: ["setTimeout"] })
  let cancelled = false
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('{"candidates":')) },
    cancel() { cancelled = true; return new Promise<void>(() => {}) },
  }))
  const pending = geminiGenerate(opts)
  await setImmediate()
  t.mock.timers.tick(GEMINI_TIMEOUT_MS)
  assert.deepEqual(await pending, { error: "gemini_provider_timeout" })
  assert.equal(cancelled, true)
})

test("404 fallback consumes the original deadline instead of receiving a fresh timeout", async t => {
  setup(t)
  t.mock.timers.enable({ apis: ["setTimeout"] })
  let resolveFirst!: (res: Response) => void
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    if (calls === 1) return new Promise<Response>(resolve => { resolveFirst = resolve })
    return new Promise<Response>(() => {})
  }
  const pending = geminiGenerate(opts)
  t.mock.timers.tick(GEMINI_TIMEOUT_MS - 1000)
  resolveFirst(new Response(LEAK, { status: 404 }))
  await setImmediate()
  assert.equal(calls, 2)
  t.mock.timers.tick(1000)
  assert.deepEqual(await pending, { error: "gemini_provider_timeout" })
  assert.equal(calls, 2)
})

test("declared oversized body is cancelled without being read", async t => {
  setup(t)
  let cancelled = false
  globalThis.fetch = async () => new Response(new ReadableStream({ cancel() { cancelled = true } }), {
    headers: { "content-length": String(GEMINI_MAX_RESPONSE_BYTES + 1) },
  })
  const result = await geminiGenerate(opts)
  assert.deepEqual(result, { error: "gemini_provider_response_too_large" })
  assert.equal(cancelled, true)
  safe(result)
})

test("actual streamed bytes are bounded even when content length lies or is absent", async t => {
  setup(t)
  for (const length of [undefined, "1"]) {
    let cancelled = false
    let calls = 0
    globalThis.fetch = async () => {
      calls++
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(GEMINI_MAX_RESPONSE_BYTES))
          controller.enqueue(new Uint8Array(1))
        },
        cancel() { cancelled = true },
      }), { headers: length ? { "content-length": length } : undefined })
    }
    assert.deepEqual(await geminiGenerate(opts), { error: "gemini_provider_response_too_large" })
    assert.equal(cancelled, true)
    assert.equal(calls, 1)
  }
})

test("exact byte bound and split UTF-8 text remain valid", async t => {
  setup(t)
  const head = '{"candidates":[{"content":{"parts":[{"text":"'
  const tail = '"}]}}]}'
  const reply = "x".repeat(GEMINI_MAX_RESPONSE_BYTES - head.length - tail.length)
  globalThis.fetch = async () => new Response(head + reply + tail)
  assert.equal((await geminiGenerate(opts)).reply?.length, reply.length)
  const bytes = new TextEncoder().encode(JSON.stringify({ candidates: [{ content: { parts: [{ text: "日本語 한국어" }] } }] }))
  globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) {
    for (const byte of bytes) controller.enqueue(new Uint8Array([byte]))
    controller.close()
  } }))
  assert.equal((await geminiGenerate(opts)).reply, "日本語 한국어")
})

test("malformed JSON, invalid UTF-8 and invalid text types fail once without diagnostics", async t => {
  setup(t)
  for (const body of [LEAK, new Uint8Array([0xff]), JSON.stringify({ candidates: [{ content: { parts: [{ text: { secret: LEAK } }] } }] }), JSON.stringify({ candidates: { secret: LEAK } })]) {
    let calls = 0
    globalThis.fetch = async () => { calls++; return new Response(body) }
    const result = await geminiGenerate(opts)
    assert.deepEqual(result, { error: "gemini_provider_unavailable" })
    assert.equal(calls, 1)
    safe(result)
  }
})

test("empty success, 429, 500 and transport uncertainty never automatically resubmit", async t => {
  setup(t)
  for (const variant of ["empty", "429", "500", "network"]) {
    let calls = 0
    globalThis.fetch = async () => {
      calls++
      if (variant === "network") throw new Error(`${LEAK} ${KEY}`)
      if (variant === "empty") return Response.json({ candidates: [] })
      return new Response(LEAK, { status: Number(variant) })
    }
    const result = await geminiGenerate(opts)
    assert.ok(result.error)
    assert.equal(calls, 1)
    safe(result)
  }
})
