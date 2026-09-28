import assert from "node:assert/strict"
import { after, before, beforeEach, mock, test } from "node:test"

const BRANCH = "integration/autonomous-finish-20260927"
const PRIVATE = "fixture-only-private-value"
const KEYS = ["NEXT_PUBLIC_HK_INTEGRATION_PREVIEW", "NEXT_PUBLIC_HK_CX_PREVIEW", "NEXT_PUBLIC_HK_PREVIEW_READ_ONLY", "VERCEL_GIT_COMMIT_REF", "HK_INTEGRATION_PREVIEW_ENABLED", "HK_API_ENABLED", "NEXT_PUBLIC_HK_ENABLED", "GEMINI_API_KEY"] as const
const previous = Object.fromEntries(KEYS.map(key => [key, process.env[key]]))
const originalFetch = globalThis.fetch
let networkAttempts = 0, bodyReads = 0, headerReads = 0, logCalls = 0
let ask: typeof import("../../app/api/ask/route")
let chat: typeof import("../../app/api/chat/route")

function configure(overrides: Record<string, string | undefined> = {}) {
  const env: Record<string, string | undefined> = {
    NEXT_PUBLIC_HK_INTEGRATION_PREVIEW: "0", NEXT_PUBLIC_HK_CX_PREVIEW: "0", NEXT_PUBLIC_HK_PREVIEW_READ_ONLY: "0",
    VERCEL_GIT_COMMIT_REF: undefined, HK_INTEGRATION_PREVIEW_ENABLED: "0", HK_API_ENABLED: "1", NEXT_PUBLIC_HK_ENABLED: "1", GEMINI_API_KEY: PRIVATE,
    ...overrides,
  }
  for (const key of KEYS) {
    if (env[key] === undefined) delete process.env[key]
    else process.env[key] = env[key]
  }
}

before(async () => {
  configure()
  globalThis.fetch = async () => { networkAttempts += 1; throw new Error(PRIVATE) }
  mock.method(console, "error", () => { logCalls += 1 })
  mock.method(console, "log", () => { logCalls += 1 })
  ask = await import("../../app/api/ask/route")
  chat = await import("../../app/api/chat/route")
})
beforeEach(() => configure())
after(() => {
  globalThis.fetch = originalFetch
  mock.restoreAll()
  for (const key of KEYS) {
    if (previous[key] === undefined) delete process.env[key]
    else process.env[key] = previous[key]
  }
  assert.equal(networkAttempts, 0)
  assert.equal(bodyReads, 0)
  assert.equal(headerReads, 0)
  assert.equal(logCalls, 0)
})

function untouchedRequest(path: string) {
  const request = new Request(`https://preview.invalid${path}?token=${PRIVATE}`, {
    method: "POST", headers: { cookie: `__Host-ktour_integration_preview=${PRIVATE}`, authorization: `Bearer ${PRIVATE}`, "content-type": "application/json" },
    body: "{ malformed fixture that must never be consumed",
  })
  Object.defineProperty(request, "json", { value: async () => { bodyReads += 1; throw new Error(PRIVATE) } })
  Object.defineProperty(request, "headers", { get() { headerReads += 1; throw new Error(PRIVATE) } })
  return request
}

async function assertIntegrationDenied() {
  for (const [path, handler] of [["/api/ask", ask.POST], ["/api/chat", chat.POST]] as const) {
    const response = await handler(untouchedRequest(path))
    assert.equal(response.status, 403)
    assert.equal(response.headers.get("cache-control"), "no-store")
    assert.equal(response.headers.get("set-cookie"), null)
    const body = await response.json()
    assert.deepEqual(body, { error: { code: "integration_preview_scope", message: "This endpoint is unavailable in the private integration preview.", retryable: false } })
    assert.equal(JSON.stringify(body).includes(PRIVATE), false)
  }
}

test("actual ask/chat routes refuse an integration artifact before headers, body, logs or provider work", async () => {
  configure({ NEXT_PUBLIC_HK_INTEGRATION_PREVIEW: "1" })
  await assertIntegrationDenied()
})

test("approved integration branch remains blocked when the public integration flag is removed or disabled", async () => {
  for (const flag of [undefined, "0", "false", "true", ""]) {
    configure({ NEXT_PUBLIC_HK_INTEGRATION_PREVIEW: flag, VERCEL_GIT_COMMIT_REF: BRANCH })
    await assertIntegrationDenied()
  }
})

test("frozen integration flag remains blocked with missing or different branch metadata", async () => {
  for (const branch of [undefined, "main", "feat/hackathon-readiness-preview-20260925", "integration/sumsub-live-20260927"]) {
    configure({ NEXT_PUBLIC_HK_INTEGRATION_PREVIEW: "1", VERCEL_GIT_COMMIT_REF: branch })
    await assertIntegrationDenied()
  }
})

test("runtime enablement, feature flags or supplied access credentials cannot open ancillary AI endpoints", async () => {
  for (const enabled of ["0", "1", undefined]) {
    configure({ NEXT_PUBLIC_HK_INTEGRATION_PREVIEW: "0", VERCEL_GIT_COMMIT_REF: BRANCH, HK_INTEGRATION_PREVIEW_ENABLED: enabled, HK_API_ENABLED: "1", NEXT_PUBLIC_HK_ENABLED: "1" })
    await assertIntegrationDenied()
  }
})

test("existing CX-only and read-only responses remain unchanged and still precede request/provider work", async () => {
  for (const profile of ["NEXT_PUBLIC_HK_CX_PREVIEW", "NEXT_PUBLIC_HK_PREVIEW_READ_ONLY"]) {
    configure({ [profile]: "1" })
    for (const [path, handler] of [["/api/ask", ask.POST], ["/api/chat", chat.POST]] as const) {
      const response = await handler(untouchedRequest(path))
      assert.equal(response.status, 503)
      assert.equal(response.headers.get("cache-control"), "no-store")
      const body = await response.json()
      assert.equal(body.error.code, "preview_read_only")
      assert.equal(JSON.stringify(body).includes(PRIVATE), false)
    }
  }
})

test("ordinary public profile preserves existing no-key response contracts without body or network work", async () => {
  configure({ GEMINI_API_KEY: undefined, VERCEL_GIT_COMMIT_REF: "main" })
  const askResponse = await ask.POST(untouchedRequest("/api/ask"))
  const chatResponse = await chat.POST(untouchedRequest("/api/chat"))
  assert.equal(askResponse.status, 503)
  assert.equal(chatResponse.status, 503)
  assert.deepEqual(await askResponse.json(), { error: "no-key" })
  assert.deepEqual(await chatResponse.json(), { error: "No AI key configured (set GEMINI_API_KEY)" })
})
