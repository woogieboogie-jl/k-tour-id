// Operator-only live Sandbox smoke. No document, camera, approval, trace or screenshots.
import { chromium, expect, type Route } from "@playwright/test"
import { SESSION_COOKIE, unsealSession, sumsubRequest, type SandboxConfig } from "../../lib/kyc/sumsub-sandbox"

export function approvedPreviewOrigin(value: string) {
  return /^https:\/\/ondo-[a-z0-9]+-jaewook-9643s-projects\.vercel\.app$/.test(value)
}

// Observed WebSDK initialization/diagnostics only. This never permits document
// uploads, applicant mutation, review submission or simulated approval APIs.
export function allowedSdkBootstrapRequest(raw: string, method: string, body: Buffer | null, contentType: string) {
  try {
    const url = new URL(raw)
    return url.origin === "https://api.sumsub.com" && !url.username && !url.password && method === "POST"
      && new Set(["/resources/sdkIntegrations/websdkInit", "/resources/tracking/trackEvents", "/resources/tracking/trackTimings", "/resources/serviceLogger/jsError", "/websdk/trackClose"]).has(url.pathname)
      // A missing body buffer is not evidence that an unobserved body is small.
      && body !== null && body.byteLength <= 65536 && !/multipart|octet-stream|image\//i.test(contentType)
      && (url.pathname !== "/resources/sdkIntegrations/websdkInit" || contentType.split(";")[0].trim().toLowerCase() === "application/json")
  } catch { return false }
}

export function optionalSdkTelemetryRequest(raw: string, method: string) {
  try {
    const url = new URL(raw)
    return url.origin === "https://api.sumsub.com" && !url.username && !url.password && method === "POST" && url.pathname === "/stry"
  } catch { return false }
}

export function allowedPreviewBrowserRequest(raw: string, method: string, body: Buffer | null, contentType: string, origin: string) {
  try {
    const url = new URL(raw), reading = method === "GET" || method === "HEAD"
    if (url.username || url.password) return false
    if (url.origin === origin) return url.pathname === "/api/kyc/sumsub/status" && method === "GET"
      || url.pathname === "/api/kyc/sumsub/session" && ["POST", "DELETE"].includes(method)
      || !url.pathname.startsWith("/api/") && reading
      || url.pathname.startsWith("/api/ondo/venues/") && reading
    return url.protocol === "https:" && !url.port
      && ["api.sumsub.com", "static.sumsub.com", "tiles.openfreemap.org", "fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname)
      && reading || allowedSdkBootstrapRequest(raw, method, body, contentType)
  } catch { return false }
}

// Playwright's route.continue() does not re-run routing for redirects. Fetch
// exactly one response, never fulfill a 3xx, and preserve successful response
// headers/body (including SDK scripts, CSS and the app's session cookie).
export async function forwardPreviewRouteWithoutRedirects(
  route: Pick<Route, "fetch" | "fulfill" | "abort">,
  blocked: (reason: "redirect_blocked" | "request_transport_failed") => void,
) {
  let response: Awaited<ReturnType<Route["fetch"]>> | undefined
  let blockedAlready = false
  try {
    response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 30_000 })
    if (response.status() >= 300 && response.status() < 400) {
      blockedAlready = true
      blocked("redirect_blocked")
      await route.abort("blockedbyclient")
      return
    }
    await route.fulfill({ response })
  } catch {
    if (!blockedAlready) blocked("request_transport_failed")
    await route.abort("blockedbyclient").catch(() => undefined)
  } finally {
    await response?.dispose().catch(() => undefined)
  }
}

export function finalPreviewProbeFailure(failure: string | null, revoked: boolean, pageErrors: number, unexpectedRequests: number) {
  return failure ?? (pageErrors ? "no_app_page_errors" : unexpectedRequests ? "no_unexpected_remote_requests" : !revoked ? "session_revocation_failed" : null)
}

export async function runSumsubPreviewProbe(options: {
  mode?: "dry" | "live"; origin?: string; config?: SandboxConfig
  inspectOwnRecord?: (id: string) => Promise<{ active: boolean; lastEventAt: number; needsRefresh: boolean }>
}) {
  if (options.mode !== "live") return { ok: true, executed: false, checks: [], humanIdentityVerified: false }
  const { origin, config } = options
  if (!origin || !approvedPreviewOrigin(origin) || !config?.appToken.startsWith("sbx:") || !config.origins.includes(origin) || !options.inspectOwnRecord)
    return { ok: false, executed: false, checks: [], humanIdentityVerified: false }
  const checks: string[] = [], ensure = (ok: unknown, name: string) => { if (!ok) throw new Error(name); checks.push(name) }
  const browserEnv = Object.fromEntries(Object.entries(process.env).filter(([key, value]) =>
    ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "DISPLAY"].includes(key) && typeof value === "string")) as Record<string, string>
  const browser = await chromium.launch({ headless: true, env: browserEnv })
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "en-US", reducedMotion: "no-preference", serviceWorkers: "block" })
  const page = await context.newPage()
  page.setDefaultTimeout(30_000)
  const headers = { "x-ktour-kyc": "1", origin, "content-type": "application/json" }
  let pageErrors = 0, unexpectedRequests = 0, expectedTelemetryBlocked = 0, sessionAttempted = false, revoked = false, phase = "preflight", failure: string | null = null
  const blockedRequestKinds: string[] = []
  const blockedProviderShapes = new Set<string>()
  let firstId: string | undefined
  let cookiePresent = false, providerClockDeltaMs: number | null = null
  let observedStatus: { code: number; status: string; error: string | null } | null = null
  let sdkErrorScreen = false
  let providerBinding: Record<string, boolean | string> | null = null
  // Operator-side inspection only: the authenticated server enforces its own
  // clock. A local laptop a few seconds behind must not misclassify its cookie.
  const inspectionNow = () => Date.now() + Math.max(0, providerClockDeltaMs ?? 0) + 1000
  const inFlightRoutes = new Set<Promise<void>>()
  page.on("pageerror", () => { pageErrors++ })
  const handleBrowserRoute = async (route: Route) => {
    const url = new URL(route.request().url())
    const method = route.request().method()
    // Optional binary telemetry is deliberately blocked, not silently allowed
    // or counted as proof that SDK bootstrap itself failed.
    if (optionalSdkTelemetryRequest(url.href, method)) {
      expectedTelemetryBlocked++
      return route.abort("blockedbyclient")
    }
    if (allowedPreviewBrowserRequest(url.href, method, route.request().postDataBuffer(), route.request().headers()["content-type"] ?? "", origin))
      return forwardPreviewRouteWithoutRedirects(route, reason => {
        unexpectedRequests++
        blockedRequestKinds.push(reason)
      })
    unexpectedRequests++
    blockedRequestKinds.push(url.hostname === "api.sumsub.com" ? "provider_mutation_blocked" : "unexpected_request_blocked")
    if (url.hostname === "api.sumsub.com") {
      const shape = url.pathname.split("/").map(segment => segment === "-" || /^[A-Za-z][A-Za-z-]{0,14}$/.test(segment) ? segment : segment ? ":redacted" : "").join("/")
      blockedProviderShapes.add(method + " " + shape)
    }
    return route.abort("blockedbyclient")
  }
  await context.route("**/*", route => {
    const pending = handleBrowserRoute(route)
    inFlightRoutes.add(pending)
    void pending.finally(() => inFlightRoutes.delete(pending)).catch(() => undefined)
    return pending
  })
  const status = async () => {
    const response = await context.request.get(origin + "/api/kyc/sumsub/status", { headers, maxRedirects: 0 })
    const data = await response.json()
    observedStatus = { code: response.status(), status: ["access_required", "expired", "unavailable", "in_progress", "pending", "approved", "rejected", "retry"].includes(data.status) ? data.status : "unknown", error: typeof data.error === "string" && /^[a-z_]{1,50}$/.test(data.error) ? data.error : null }
    return { code: response.status(), status: data.status, configured: data.configured, environment: data.environment }
  }
  const open = async () => {
    await page.getByTestId("kpass-start-setup").click()
    await page.getByTestId("ktour-id-route-passport").click()
    await page.getByTestId("k-tour-id-consent-approve").click()
    await page.waitForFunction(() => document.querySelector('[data-testid="sumsub-passport-step"]')?.getAttribute("data-status") === "access_required")
  }
  const launchSdk = async () => {
    await page.getByTestId("sumsub-access-code").fill(config.accessCode)
    const response = page.waitForResponse(r => r.url() === origin + "/api/kyc/sumsub/session" && r.request().method() === "POST")
    sessionAttempted = true
    await page.getByTestId("sumsub-start").click()
    const issued = await response
    await issued.finished()
    ensure(issued.status() === 200, "actual_session_token_issued")
    const cookie = (await context.cookies(origin)).find(c => c.name === SESSION_COOKIE)
    cookiePresent = Boolean(cookie)
    const serverDate = Date.parse(issued.headers().date ?? "")
    providerClockDeltaMs = Number.isFinite(serverDate) ? serverDate - Date.now() : null
    ensure(providerClockDeltaMs !== null && Math.abs(providerClockDeltaMs) < 60_000, "bounded_server_clock")
    const session = unsealSession(cookie?.value, config, origin, inspectionNow())
    ensure(Boolean(session), "encrypted_session_bound")
    if (firstId) ensure(session!.externalUserId === firstId, "resume_preserves_applicant")
    else firstId = session!.externalUserId
    await page.getByTestId("sumsub-sdk-container").locator("iframe").waitFor({ state: "visible" })
    await expect.poll(() => page.frames().some(f => { try { return new URL(f.url()).hostname === "api.sumsub.com" } catch { return false } }), { timeout: 20_000 }).toBe(true)
    const frame = page.frames().find(f => { try { return new URL(f.url()).hostname === "api.sumsub.com" } catch { return false } })
    ensure(Boolean(frame), "provider_iframe_opened")
    await frame!.locator("body").waitFor({ state: "visible" })
    await frame!.waitForFunction(() => (document.body?.innerText.trim().length ?? 0) > 30)
    sdkErrorScreen = /something went wrong|unable to|an error|invalid token|expired|try again/i.test(await frame!.locator("body").innerText())
    ensure(!sdkErrorScreen, "provider_screen_not_error")
    ensure(await frame!.locator("button, input, select, a").count() > 0, "provider_interactive_screen_loaded")
  }
  try {
    const before = await status()
    ensure(before.code === 200 && before.status === "access_required" && before.configured === true && before.environment === "sandbox", "unauthenticated_gate")
    const forged = await context.request.get(origin + "/api/kyc/sumsub/status", { headers: { ...headers, origin: "https://foreign.invalid" }, maxRedirects: 0 })
    ensure(forged.status() === 403, "foreign_origin_rejected")
    await page.addInitScript(() => localStorage.setItem("ondo-b.device.v1", JSON.stringify({ locale: "en", appearancePreference: "light" })))
    await page.goto(origin + "/?review=0", { waitUntil: "domcontentloaded" })
    await page.waitForFunction(() => document.querySelector('[data-testid="ondo-b-root"]')?.getAttribute("data-hydrated") === "true")
    await page.getByTestId("nav-id").click()
    phase = "sdk_start"
    await open()
    await launchSdk()
    const current = await status()
    if (current.status !== "in_progress" && firstId) {
      const applicant = await sumsubRequest(config, `/resources/applicants/-;externalUserId=${encodeURIComponent(firstId)}/one`)
      providerBinding = { externalMatches: applicant.externalUserId === firstId, sandboxModePresent: "sandboxMode" in applicant,
        sandboxModeTrue: applicant.sandboxMode === true, sandboxPresent: "sandbox" in applicant, sandboxTrue: applicant.sandbox === true,
        idValid: typeof applicant.id === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(applicant.id) }
      if (providerBinding.idValid) {
        const review = await sumsubRequest(config, `/resources/applicants/${applicant.id}/status`)
        providerBinding.levelMatches = review.levelName === config.levelName
        providerBinding.levelPresent = "levelName" in review
        providerBinding.reviewInit = review.reviewStatus === "init"
      }
    }
    ensure(current.code === 200 && current.status === "in_progress", "real_provider_unsubmitted_status")
    ensure(await page.getByTestId("sumsub-passport-step").getAttribute("data-pass-issued") === "false", "no_unearned_pass")
    phase = "close_resume"
    await page.getByTestId("k-tour-id-cancel").click()
    await page.getByTestId("k-tour-id-setup").waitFor({ state: "detached" })
    revoked = true
    ensure((await status()).status === "access_required", "close_revokes_active_session")
    await open()
    await launchSdk()
    if (options.inspectOwnRecord && firstId) {
      const row = await options.inspectOwnRecord(firstId)
      ensure(row.active, "durable_preview_session")
      if (row.lastEventAt > 0) checks.push("provider_webhook_metadata_received")
    }
    ensure(pageErrors === 0, "no_app_page_errors")
    ensure(unexpectedRequests === 0, "no_unexpected_remote_requests")
  } catch (error) {
    const allowed = new Set(["actual_session_token_issued", "bounded_server_clock", "encrypted_session_bound", "resume_preserves_applicant", "provider_iframe_opened", "provider_screen_not_error", "provider_interactive_screen_loaded", "unauthenticated_gate", "foreign_origin_rejected", "real_provider_unsubmitted_status", "no_unearned_pass", "close_revokes_active_session", "durable_preview_session", "no_app_page_errors", "no_unexpected_remote_requests"])
    failure = error instanceof Error && allowed.has(error.message) ? error.message : "browser_step_failed"
  } finally {
    if (sessionAttempted) {
      try {
        const cookie = (await context.cookies(origin)).find(c => c.name === SESSION_COOKIE)
        const session = unsealSession(cookie?.value, config, origin, inspectionNow())
        const ownId = session?.externalUserId ?? firstId
        const response = await context.request.delete(origin + "/api/kyc/sumsub/session", { headers, maxRedirects: 0 })
        revoked = response.status() === 204 && Boolean(ownId) && !(await options.inspectOwnRecord!(ownId!)).active
      }
      catch { revoked = false }
    }
    await browser.close()
    // Keep routing installed until the browser is closed, then drain existing
    // handlers. Removing routes earlier would create an unguarded egress gap.
    await Promise.allSettled([...inFlightRoutes])
  }
  // Cleanup is asynchronous: late iframe errors/requests must still make the
  // final result fail, even if the earlier assertions had already passed.
  failure = finalPreviewProbeFailure(failure, revoked, pageErrors, unexpectedRequests)
  return { ok: failure === null, executed: true, phase, failure, checks, revoked, pageErrors, unexpectedRequests, expectedTelemetryBlocked, blockedRequestKinds,
    cookiePresent, providerClockDeltaMs, observedStatus, sdkErrorScreen, providerBinding, blockedProviderShapes: [...blockedProviderShapes],
    sdkProviderConnected: checks.includes("provider_interactive_screen_loaded"), humanIdentityVerified: false, documentsUploaded: 0, screenshots: 0 }
}
