import assert from "node:assert/strict"
import test from "node:test"
import { geminiGenerate } from "../../lib/gemini"
import { POST as chatPost } from "../../app/api/chat/route"

const SECRET = "gemini-key-sentinel"
const BODY = "https://provider.invalid/?token=body-secret"

function env(overrides: Record<string, string | undefined>) {
  const previous = new Map<string, string | undefined>()
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key])
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

test("Gemini HTTP and transport failures never echo provider body, URL, or key", async () => {
  const oldFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => new Response(BODY, { status: 403 })
    const result = await geminiGenerate({ key: SECRET, system: "system", message: "hello" })
    assert.equal(result.error, "gemini_provider_http_403")
    assert.equal(JSON.stringify(result).includes(BODY), false)
    assert.equal(JSON.stringify(result).includes(SECRET), false)

    globalThis.fetch = async () => { throw new Error(`socket ${BODY} key=${SECRET}`) }
    const transport = await geminiGenerate({ key: SECRET, system: "system", message: "hello" })
    assert.equal(transport.error, "gemini_provider_unavailable")
    assert.equal(JSON.stringify(transport).includes(BODY), false)
    assert.equal(JSON.stringify(transport).includes(SECRET), false)
  } finally {
    globalThis.fetch = oldFetch
  }
})

test("chat route exposes a fixed provider error while preserving success contract", async () => {
  const restore = env({ GEMINI_API_KEY: SECRET, HK_ISOLATED_MOCK: "0", HK_MODE_CX: "off", NEXT_PUBLIC_HK_PREVIEW_READ_ONLY: "0" })
  const oldFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => new Response(BODY, { status: 500 })
    const response = await chatPost(new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "hello" }),
    }))
    assert.equal(response.status, 502)
    const payload = await response.json() as { error?: string }
    assert.deepEqual(payload, { error: "AI provider unavailable" })
    assert.equal(JSON.stringify(payload).includes(BODY), false)
    assert.equal(JSON.stringify(payload).includes(SECRET), false)
  } finally {
    globalThis.fetch = oldFetch
    restore()
  }
})

test("successful Gemini replies retain the existing response contract", async () => {
  const oldFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "safe reply" }] } }] }), { status: 200 })
    const result = await geminiGenerate({ key: SECRET, system: "system", message: "hello" })
    assert.deepEqual(result, { reply: "safe reply" })
  } finally {
    globalThis.fetch = oldFetch
  }
})

test("a 404 model falls back to the next candidate without exposing its body", async () => {
  const restore = env({ GEMINI_MODEL: "fixture-first-model" })
  const oldFetch = globalThis.fetch
  let calls = 0
  try {
    globalThis.fetch = async () => {
      calls += 1
      if (calls === 1) return new Response("missing model provider secret", { status: 404 })
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "fallback reply" }] } }] }), { status: 200 })
    }
    const result = await geminiGenerate({ key: SECRET, system: "system", message: "hello" })
    assert.deepEqual(result, { reply: "fallback reply" })
    assert.equal(calls, 2)
  } finally {
    globalThis.fetch = oldFetch
    restore()
  }
})

test("a provider stream whose cancellation never settles cannot block failure or 404 fallback", async () => {
  const restore = env({ GEMINI_MODEL: "fixture-first-model" })
  const oldFetch = globalThis.fetch
  let calls = 0
  try {
    globalThis.fetch = async () => {
      calls += 1
      if (calls === 1) {
        return new Response(new ReadableStream({ cancel: () => new Promise<void>(() => {}) }), { status: 404 })
      }
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "fallback after hanging cancel" }] } }] }), { status: 200 })
    }
    const result = await geminiGenerate({ key: SECRET, system: "system", message: "hello" })
    assert.deepEqual(result, { reply: "fallback after hanging cancel" })
    assert.equal(calls, 2)
  } finally {
    globalThis.fetch = oldFetch
    restore()
  }
})

test("empty and malformed provider responses fail closed without leaking diagnostics", async () => {
  const oldFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ candidates: [] }), { status: 200 })
    const empty = await geminiGenerate({ key: SECRET, system: "system", message: "hello" })
    assert.equal(empty.error, "gemini_provider_empty_response")

    globalThis.fetch = async () => new Response(`malformed ${BODY} ${SECRET}`, { status: 200 })
    const malformed = await geminiGenerate({ key: SECRET, system: "system", message: "hello" })
    assert.equal(malformed.error, "gemini_provider_unavailable")
    assert.equal(JSON.stringify(malformed).includes(BODY), false)
    assert.equal(JSON.stringify(malformed).includes(SECRET), false)
  } finally {
    globalThis.fetch = oldFetch
  }
})
