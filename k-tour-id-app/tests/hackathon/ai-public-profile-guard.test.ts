import assert from "node:assert/strict"
import test from "node:test"
import { POST as chatPost } from "../../app/api/chat/route"
import { POST as askPost } from "../../app/api/ask/route"
import { GUIDE_PRODUCTION } from "../../lib/hackathon/guide-production-profile"

const KEY = "synthetic-fixture-key-no-real-provider"
const guideSignals = [
  { NEXT_PUBLIC_HK_GUIDE_PRODUCTION: "1" },
  { HK_GUIDE_PRODUCTION_ENABLED: "1" },
  { VERCEL_GIT_COMMIT_REF: GUIDE_PRODUCTION.branch },
  { NEXT_PUBLIC_HK_HOSTED_SUI: "1", NEXT_PUBLIC_HK_HOSTED_PROVIDERS: "connected-20260930-v1", HK_HOSTED_PROVIDERS: "connected-20260930-v1", HK_HOSTED_AI_ENABLED: "1" },
  { HK_HOSTED_SUI_ENABLED: "1" },
  { VERCEL_GIT_COMMIT_REF: "deploy/sui-main-20260928" },
]

for (const [name, post] of [["chat", chatPost], ["ask", askPost]] as const) {
  test(`${name} denies every guide/hosted/connected profile signal before body parsing or provider access`, async () => {
    const oldEnv = process.env, oldFetch = globalThis.fetch
    try {
      let calls = 0
      globalThis.fetch = async () => { calls++; throw new Error("must not call provider") }
      for (const signal of guideSignals) {
        process.env = { NODE_ENV: "test", GEMINI_API_KEY: KEY, ...signal }
        const request = new Request(`https://example.invalid/api/${name}`, { method: "POST", body: "not-json" })
        const response = await post(request)
        assert.equal(response.status, 403)
        assert.equal(response.headers.get("cache-control"), "no-store")
        assert.equal(request.bodyUsed, false)
        const result = await response.json()
        assert.equal(result.error.code, "integration_preview_scope")
        assert.equal(result.error.retryable, false)
        assert.equal(JSON.stringify(result).includes(KEY), false)
      }
      assert.equal(calls, 0)
    } finally { process.env = oldEnv; globalThis.fetch = oldFetch }
  })

  test(`${name} preserves non-guide success and no-key contracts`, async () => {
    const oldEnv = process.env, oldFetch = globalThis.fetch
    try {
      process.env = { NODE_ENV: "test", GEMINI_API_KEY: KEY, NEXT_PUBLIC_HK_GUIDE_PRODUCTION: "0", HK_GUIDE_PRODUCTION_ENABLED: "0", VERCEL_GIT_COMMIT_REF: "fixture-normal" }
      let calls = 0
      globalThis.fetch = async () => {
        calls++
        return Response.json({ candidates: [{ content: { parts: [{ text: "safe fixture reply" }] } }] })
      }
      const response = await post(new Request(`https://example.invalid/api/${name}`, { method: "POST", body: JSON.stringify({ message: "Hello" }) }))
      assert.equal(response.status, 200)
      assert.deepEqual(await response.json(), { reply: "safe fixture reply" })
      assert.equal(calls, 1)
      delete process.env.GEMINI_API_KEY
      const unavailable = await post(new Request(`https://example.invalid/api/${name}`, { method: "POST", body: "not-json" }))
      assert.equal(unavailable.status, 503)
      assert.equal(calls, 1)
    } finally { process.env = oldEnv; globalThis.fetch = oldFetch }
  })
}
