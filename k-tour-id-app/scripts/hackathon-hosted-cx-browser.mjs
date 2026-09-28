// Operator-only, ONE real CX request; not a verified-identity or Sui E2E test.
// Call run({ origin, accessCode, expectedRevision, deploymentId, mobile }) with
// the access code in memory. No CLI, env loading, saved QR, traces or screenshots.
import { constants, openSync, fstatSync, readSync, closeSync } from "node:fs"
import { chromium, expect } from "@playwright/test"
import { PIN, originOf, validateCode, verifyDeployment, metadataApi } from "./hackathon-hosted-sui-browser.mjs"

export const LIMITS = Object.freeze({ deadlineMs: 180000, requestMs: 20000, bodyBytes: 524288, requestBytes: 1024, reads: 200, apiReads: 16 })
const API = "/api/hackathon/v1", OP = /^op_[A-Za-z0-9_-]{8,64}$/
const AUTH = "/Users/woogieboogie/.config/vercel-accounts/jaewook/auth.json"
const CONSENT = "hk-consent-2026-09-14"
const REJECTED = new Set(["identity_failed", "identity_cancelled", "identity_expired"])
const safeErrors = new WeakSet()
function fail(code) { const error = new Error(code); safeErrors.add(error); throw error }
function exact(value, keys) { return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join(",") === keys.slice().sort().join(",") }
function authToken() {
  let fd
  try {
    fd = openSync(AUTH, constants.O_RDONLY | constants.O_NOFOLLOW)
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o077) || stat.size > 16384) fail("authentication_unavailable")
    const bytes = Buffer.alloc(16385); let size = 0
    while (size < bytes.length) { const count = readSync(fd, bytes, size, bytes.length - size, null); if (!count) break; size += count }
    if (size > 16384) fail("authentication_unavailable")
    const token = JSON.parse(bytes.subarray(0, size).toString("utf8")).token
    if (typeof token !== "string" || !/^[A-Za-z0-9_.-]{16,512}$/.test(token)) fail("authentication_unavailable")
    return token
  } catch { fail("authentication_unavailable") } finally { if (fd !== undefined) closeSync(fd) }
}

export function validateCxConfig(c) {
  const modes = { cx: "cx", opendid: "mock", ai: "rule", sui: "testnet", omnione: "unconfigured", zklogin: "demo-signer" }
  if (c?.hostedSui !== true || c.isolatedMock !== false || c.cxPreview !== false || c.previewReadOnly !== false || !exact(c.modes, Object.keys(modes)) || Object.entries(modes).some(([key, value]) => c.modes[key] !== value) ||
    c.campaign?.venueId !== PIN.venueId || c.sui?.network !== "testnet" || c.sui.packageId !== PIN.packageId || c.sui.campaignId !== PIN.campaignId || c.sui.googleClientId !== "" || c.consentVersion !== CONSENT ||
    c.capabilities?.chainExecutionEnabled !== true || c.capabilities.redemptionEnabled !== false || c.capabilities.opendidProviderReady !== false) fail("configuration_mismatch")
  return true
}

function noDownstream(body, id) {
  if (!OP.test(id ?? "") || body?.operationId !== id || body.venueId !== PIN.venueId || ["credential", "presentation", "proposal", "delegation", "agent", "fulfillment", "chain"].some(key => body[key] !== null)) fail("operation_contract")
}

/** Deliberately returns no evidence, CI, QR, provider transaction or error text. */
export function classifyIdentityResult(body, operationId, kind = "qr") {
  noDownstream(body, operationId)
  if (!["qr", "app"].includes(kind) || body.phase !== "identity" || body.status !== "pending") fail("identity_result_contract")
  if (body.identity?.mode === "cx" && body.identity.personVerified === false && body.identity.handoff?.kind === kind && body.error === null) return "pending"
  if (body.identity === null && body.error?.retryable === true && REJECTED.has(body.error.code)) return "rejected"
  fail("identity_result_contract")
}

export function validateHandoff(body, operationId, kind, now = Date.now()) {
  if (classifyIdentityResult(body, operationId, kind) !== "pending") fail("handoff_contract")
  const h = body.identity.handoff, expiry = Date.parse(h.expiresAt)
  if (!Number.isFinite(expiry) || expiry <= now || expiry > now + 20 * 60 * 1000) fail("handoff_expiry")
  if (kind === "qr") {
    if (typeof h.qrBase64 !== "string" || h.qrBase64.length > LIMITS.bodyBytes || !/^[A-Za-z0-9+/]+={0,2}$/.test(h.qrBase64)) fail("handoff_contract")
  } else {
    const links = [h.androidLink, h.iosLink, h.ssPayLink].filter(value => value !== undefined)
    if (!links.length || links.some(value => {
      if (typeof value !== "string" || value.length > 16384 || /[\u0000-\u0020\u007f<>]/.test(value)) return true
      let decoded = value
      for (let i = 0; i < 3; i++) {
        if (/(?:^|[=;])(?:javascript|vbscript|data|file|filesystem|blob|about|chrome|chrome-extension|moz-extension)\s*:/i.test(decoded)) return true
        try { const next = decodeURIComponent(decoded); if (next === decoded) break; decoded = next } catch { return true }
      }
      try { const u = new URL(value); return !/^[a-z][a-z0-9+.-]*:$/.test(u.protocol) || u.protocol === "http:" || Boolean(u.username || u.password) } catch { return true }
    })) fail("handoff_contract")
  }
  return kind
}

/** Every POST is claimed BEFORE forwarding. A lost response is not retried.
 * Cancellation remains possible after an unexpected request, but at most once. */
export function createCxRequestGuard(origin, mobile = false) {
  const base = originOf(origin), counts = Object.create(null)
  let operation = null, stage = 0, permit = null, blocked = false, reads = 0, apiReads = 0, blockedExternalAssets = 0
  const stop = () => { blocked = true; return false }
  return {
    bindOperation(id) { if (stage < 3 || !OP.test(id ?? "") || (operation && operation !== id)) fail("operation_mismatch"); operation = id },
    permit(action) { if (!["operations", "identity/start", "identity/complete", "cancel"].includes(action) || (permit !== null && action !== "cancel")) fail("request_permit"); permit = action },
    canCancel() { return operation !== null && !counts.cancel },
    /** @param {string} method @param {string} target @param {string | undefined} [rawBody] */
    check(method, target, rawBody = undefined) {
      let u; try { u = new URL(target, base) } catch { return stop() }
      if (u.origin !== base || u.username || u.password || u.hash) { if (["GET", "HEAD"].includes(method)) { blockedExternalAssets++; return false } return stop() }
      if (["GET", "HEAD"].includes(method)) {
        if (++reads > LIMITS.reads) return stop()
        if (!u.pathname.startsWith("/api/")) return true
        if (++apiReads > LIMITS.apiReads) return stop()
        if (method === "GET" && !u.search && ([`${API}/config`, `${API}/places/${PIN.venueId}/demo-entitlements`, ...(operation ? [`${API}/operations/${operation}`] : [])].includes(u.pathname))) return true
        if (method === "GET" && /^\/api\/ondo\/venues(?:\/|$)/.test(u.pathname)) return true
        return stop()
      }
      if (method !== "POST" || u.search || !u.pathname.startsWith(API + "/")) return stop()
      const action = u.pathname.startsWith(`${API}/operations/`) ? u.pathname.slice(`${API}/operations/${operation}/`.length) : u.pathname.slice(API.length + 1)
      const expected = ["hosted/access", "sessions", "operations", "identity/start", "identity/complete"][stage]
      const cancel = action === "cancel" && operation !== null && u.pathname === `${API}/operations/${operation}/cancel`
      if (counts[action] || (!cancel && (blocked || action !== expected)) || (stage < 3 && u.pathname !== `${API}/${action}`) || (stage >= 3 && !cancel && u.pathname !== `${API}/operations/${operation}/${action}`) || (stage >= 2 && permit !== action)) return stop()
      let body
      try { if (typeof rawBody !== "string" || Buffer.byteLength(rawBody) > LIMITS.requestBytes) return stop(); body = JSON.parse(rawBody) } catch { return stop() }
      const valid = action === "hosted/access" ? exact(body, ["accessCode"]) && typeof body.accessCode === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(body.accessCode)
        : action === "operations" ? exact(body, ["venueId", "consentVersion", "locale"]) && body.venueId === PIN.venueId && body.consentVersion === CONSENT && body.locale === "en"
        : action === "identity/start" ? exact(body, ["mobile"]) && body.mobile === mobile : exact(body, [])
      if (!valid) return stop()
      counts[action] = 1; permit = null; stage = cancel ? 6 : stage + 1; return true
    },
    summary() { return { blocked, reads, apiReads, blockedExternalAssets, mutations: { ...counts }, cancelled: counts.cancel === 1 } },
  }
}

// Playwright buffers bodies: declared sizes are rejected before body(), and
// actual sizes immediately afterwards. This is not a streaming memory bound.
async function json(response) {
  const declared = response.headers()["content-length"]
  if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > LIMITS.bodyBytes)) fail("application_response_size")
  const bytes = await response.body()
  if (bytes.length > LIMITS.bodyBytes) fail("application_response_size")
  try { return JSON.parse(bytes.toString("utf8")) } catch { fail("application_json") }
}
function cancelled(body, id) { noDownstream(body, id); if (body.phase !== "cancelled" || body.status !== "cancelled" || body.identity !== null) fail("cancel_contract") }

/** @param {{ origin?: string, accessCode?: string, expectedRevision?: string, deploymentId?: string, mobile?: boolean }} [options] */
export async function run({ origin, accessCode, expectedRevision, deploymentId, mobile = false } = {}) {
  const report = { ok: false, status: "running", checkpoint: "input", identityVerificationClaimed: false, approvalClaimed: false, credentialIssued: false, chainMutationRequests: 0, handoffObserved: false, resultOutcome: null, cancelled: false, returnedToPlace: false, pageErrors: 0, requestFailures: 0, httpFailures: 0, requests: null }
  let browser, context, guard, operationId, base
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort(); if (browser) void browser.close().catch(() => {}) }, LIMITS.deadlineMs)
  try {
    base = originOf(origin); validateCode(accessCode)
    if (!/^[a-f0-9]{40}$/.test(expectedRevision ?? "") || typeof mobile !== "boolean") fail("invalid_input")
    report.checkpoint = "deployment_metadata"
    report.deployment = await verifyDeployment({ origin: base, expectedRevision, deploymentId }, metadataApi(authToken(), controller.signal))
    if (controller.signal.aborted) fail("deadline")
    guard = createCxRequestGuard(base, mobile)
    browser = await chromium.launch({ headless: true, timeout: LIMITS.requestMs })
    context = await browser.newContext({ baseURL: base, viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, isMobile: mobile, hasTouch: mobile, ...(mobile ? { userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36" } : {}), locale: "en-US", colorScheme: "light", serviceWorkers: "block" })
    context.setDefaultTimeout(LIMITS.requestMs)
    // Native app links and external browser requests are never followed.
    await context.route("**/*", async route => {
      const req = route.request(), u = new URL(req.url())
      if (req.isNavigationRequest() && u.origin !== base) report.requestFailures++
      if (!guard.check(req.method(), req.url(), req.postData() ?? undefined) || (req.method() === "POST" && !(req.headers()["content-type"] ?? "").startsWith("application/json"))) { await route.abort("blockedbyclient"); return }
      if (req.isNavigationRequest() && (u.origin !== base || u.pathname !== "/")) { report.requestFailures++; await route.abort("blockedbyclient"); return }
      // BFF redirects are never followed, and responses are size-checked before
      // delivery to the app. Public same-origin map assets use the read cap.
      if (u.pathname.startsWith(API + "/")) {
        try {
          const response = await route.fetch({ timeout: LIMITS.requestMs, maxRedirects: 0, maxRetries: 0 })
          await json(response)
          await route.fulfill({ response })
        } catch { report.requestFailures++; await route.abort("failed").catch(() => {}) }
      } else await route.continue()
    })
    const read = async path => { if (controller.signal.aborted || !guard.check("GET", base + API + path)) fail("request_scope"); const response = await context.request.get(base + API + path, { timeout: LIMITS.requestMs, maxRedirects: 0 }); if (response.status() !== 200) fail("application_response"); return json(response) }
    const post = async (path, body) => { if (controller.signal.aborted || !guard.check("POST", base + API + path, JSON.stringify(body))) fail("request_scope"); const response = await context.request.post(base + API + path, { data: body, headers: { origin: base }, timeout: LIMITS.requestMs, maxRedirects: 0 }); if (response.status() !== 200) fail("application_response"); return json(response) }
    report.checkpoint = "access"
    const access = await post("/hosted/access", { accessCode }); accessCode = undefined
    if (access.ok !== true) fail("access_contract")
    report.checkpoint = "configuration"; validateCxConfig(await read("/config"))
    const before = await read(`/places/${PIN.venueId}/demo-entitlements`)
    if (before.operation !== null || before.redeemed !== null || before.supported !== true) fail("operation_already_exists")
    const page = await context.newPage()
    page.on("pageerror", () => { report.pageErrors++ })
    page.on("requestfailed", req => { if (new URL(req.url()).origin === base) report.requestFailures++ })
    page.on("response", response => { if (new URL(response.url()).origin === base && response.status() >= 400) report.httpFailures++ })
    await page.addInitScript(() => localStorage.setItem("ondo-b.device.v1", JSON.stringify({ locale: "en", appearancePreference: "light", onboarding: "ONB-COMPLETE" })))
    report.checkpoint = "page_bootstrap"
    await page.goto(`/?venueId=${PIN.venueId}&review=0`, { waitUntil: "domcontentloaded", timeout: 45000 })
    await expect(page.getByTestId("ondo-b-root")).toHaveAttribute("data-hydrated", "true", { timeout: 45000 })
    await page.getByTestId("canonical-place-details").click(); await page.getByTestId("hackathon-entitlement-open").click()
    const layer = page.getByTestId("hackathon-layer")
    const action = async (key, click) => {
      if (controller.signal.aborted) fail("deadline")
      guard.permit(key)
      const path = key === "operations" ? `${API}/operations` : `${API}/operations/${operationId}/${key}`
      const [response] = await Promise.all([page.waitForResponse(r => r.url() === base + path && r.request().method() === "POST"), click()])
      report.lastActionStatus = response.status()
      const body = await json(response)
      if (response.status() !== 200) fail("application_response")
      return body
    }
    await expect(layer).toHaveAttribute("data-phase", "consent")
    report.checkpoint = "consent"; await layer.locator("#hk-consent").check()
    const created = await action("operations", () => layer.getByTestId("hackathon-start").click())
    operationId = created.operationId; guard.bindOperation(operationId); noDownstream(created, operationId)
    if (created.phase !== "identity" || created.status !== "pending" || created.identity !== null || created.consent?.version !== CONSENT) fail("operation_contract")
    report.operationId = operationId
    report.checkpoint = "identity_start"
    const kind = mobile ? "app" : "qr"
    const started = await action("identity/start", () => layer.getByTestId("hackathon-identity-start").click())
    validateHandoff(started, operationId, kind); report.handoffObserved = true; report.handoffKind = kind
    if (mobile) {
      await expect(layer.locator("a[href]").filter({ hasText: /Mobile ID|Samsung Wallet/ }).first()).toBeVisible()
    } else {
      const qr = layer.getByRole("img", { name: "Mobile ID QR", exact: true })
      await expect(qr).toBeVisible()
      await expect.poll(() => qr.evaluate(node => node instanceof HTMLImageElement && node.complete && node.naturalWidth > 0), { timeout: 5000 }).toBe(true)
    }
    report.checkpoint = "identity_result"
    const result = await action("identity/complete", () => layer.getByRole("button", { name: "Fetch result", exact: true }).click())
    report.resultOutcome = classifyIdentityResult(result, operationId, kind)
    report.checkpoint = "cancel"
    const stopped = await action("cancel", () => layer.getByTestId("hackathon-cancel").click())
    cancelled(stopped, operationId); report.cancelled = true
    const final = await read(`/operations/${operationId}`); cancelled(final, operationId)
    report.checkpoint = "return_to_place"
    await layer.getByTestId("hackathon-return").click(); await expect(layer).toHaveCount(0)
    await expect(page.getByTestId("canonical-place-overlay")).toHaveAttribute("data-venue-id", PIN.venueId)
    await expect(page.getByTestId("hackathon-entitlement-open")).toBeFocused()
    report.returnedToPlace = true
    if (guard.summary().blocked || report.pageErrors || report.requestFailures || report.httpFailures) fail("browser_errors")
    report.ok = true; report.status = "smoke_completed_identity_unverified"; report.checkpoint = "complete"
  } catch (error) { report.status = "failed"; report.errorCode = safeErrors.has(error) ? error.message : "verification_failed" }
  finally {
    accessCode = undefined
    // Only clean up the one bound operation. Never retry an attempted cancel.
    if (context && guard?.canCancel() && !controller.signal.aborted) {
      try {
        guard.permit("cancel")
        const path = `${API}/operations/${operationId}/cancel`
        if (!guard.check("POST", base + path, "{}")) fail("request_scope")
        const response = await context.request.post(base + path, { data: {}, headers: { origin: base }, timeout: 5000, maxRedirects: 0 })
        if (response.status() !== 200) fail("cancel_contract")
        cancelled(await json(response), operationId); report.cancelled = true
      } catch { report.cleanupUnconfirmed = true }
    }
    if (operationId && !report.cancelled) report.cleanupUnconfirmed = true
    report.requests = guard?.summary() ?? null
    controller.abort(); clearTimeout(timer)
    if (browser) await browser.close().catch(() => {})
  }
  return report
}
