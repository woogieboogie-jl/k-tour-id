import { chromium, expect } from "@playwright/test"

const VENUE_ID = "mois-0021cd596bc5b2a922ad"
const PASSIVE_HOSTS = new Set(["tiles.openfreemap.org", "fonts.googleapis.com", "fonts.gstatic.com"])
const HACKATHON_GET = /^\/api\/hackathon\/v1\/(config|places\/[^/]+\/demo-entitlements|operations\/[^/]+)$/
const HACKATHON_POST = /^\/api\/hackathon\/v1\/(preview\/access|sessions|operations|operations\/[^/]+\/(identity\/start|identity\/complete|cancel))$/

function safeFailure(step) { throw new Error(`cx browser smoke failed at ${step}`) }
const REJECTED_CODES = new Set(["identity_failed", "identity_cancelled", "identity_expired"])

export function classifyIdentityResult(body, operationId) {
  if (!body || typeof body !== "object" || body.operationId !== operationId) throw new Error("cx browser result invalid")
  if (body.phase === "identity" && body.status === "pending" && body.identity?.mode === "cx" && body.identity?.personVerified === false && body.identity?.handoff?.kind === "qr" && body.error == null) return "pending"
  if (body.phase === "identity" && body.status === "pending" && body.identity === null && body.error?.retryable === true && REJECTED_CODES.has(body.error.code)) return "rejected"
  throw new Error("cx browser result invalid")
}

/**
 * Real CX preview smoke. The caller supplies the access code in memory; this
 * helper never reads env files, prints credentials, saves browser artifacts, or
 * follows provider/native handoff links.
 */
export async function runBrowserSmoke({ origin, accessCode, expectedRevision } = {}) {
  let inputOrigin
  try { inputOrigin = new URL(origin) } catch { safeFailure("input") }
  if (typeof origin !== "string" || inputOrigin.username || inputOrigin.password || !/^https:\/\//.test(origin) || !inputOrigin.hostname.endsWith(".vercel.app") || !["", "/"].includes(inputOrigin.pathname) || inputOrigin.search || inputOrigin.hash || (expectedRevision && !/^[a-f0-9]{40}$/i.test(expectedRevision))) safeFailure("input")
  if (typeof accessCode !== "string" || accessCode.length === 0 || accessCode.length > 128) safeFailure("input")
  const base = new URL(origin); base.pathname = "/"; base.search = ""; base.hash = ""
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: "en-US", colorScheme: "light", serviceWorkers: "block" })
  const page = await context.newPage()
  const counts = { access: 0, consent: 0, qr: 0, app: 0, checkResult: 0, pendingResult: 0, rejectedResult: 0, cancel: 0, returnedFocus: 0, forbiddenRequests: 0, identityBeforeConsent: 0, pageErrors: 0 }
  const forbidden = []
  let consentCommitted = false
  let startPermit = false
  let checkPermit = false
  let identityStarts = 0
  let operationId = null
  let canceled = false
  let revisionMismatch = false
  let configObserved = false
  let observedResultOutcome = null
  let checkpoint = "page"
  const recordResponse = async response => {
    const url = new URL(response.url())
    if (url.origin !== base.origin) return
    if (url.pathname.endsWith("/config") && response.request().method() === "GET" && response.status() === 200) {
      try { const body = await response.json(); configObserved = true; if (body?.cxPreview !== true || body?.isolatedMock !== false || body?.modes?.cx !== "cx" || body?.deployment?.region !== "icn1" || (expectedRevision && body?.deployment?.revision !== expectedRevision)) revisionMismatch = true } catch { revisionMismatch = true }
    }
    if (response.request().method() !== "POST") return
    if (url.pathname.endsWith("/operations") && !url.pathname.includes("/identity/")) {
      try { const body = await response.json(); if (typeof body?.operationId === "string") operationId = body.operationId } catch { /* no body disclosure */ }
    }
  }
  page.on("response", response => { void recordResponse(response) })
  page.on("pageerror", () => { counts.pageErrors += 1 })
  await context.route("**/*", async route => {
    const request = route.request(); const url = new URL(request.url()); const method = request.method()
    if (url.origin !== base.origin) {
      if (method === "GET" && PASSIVE_HOSTS.has(url.hostname) && !request.isNavigationRequest()) return route.continue()
      counts.forbiddenRequests += 1; forbidden.push("external"); return route.abort("blockedbyclient")
    }
    if (!url.pathname.startsWith("/api/")) {
      if (["GET", "HEAD", "OPTIONS"].includes(method)) return route.continue()
      counts.forbiddenRequests += 1; forbidden.push("local-mutation"); return route.abort("blockedbyclient")
    }
    const allowedGet = method === "GET" && (HACKATHON_GET.test(url.pathname) || /^\/api\/ondo\/venues(?:\/|$)/.test(url.pathname))
    const allowedPost = method === "POST" && HACKATHON_POST.test(url.pathname)
    if (allowedPost && url.pathname.endsWith("/identity/start")) {
      if (!consentCommitted || !startPermit || !operationId || url.pathname !== `/api/hackathon/v1/operations/${operationId}/identity/start` || identityStarts >= 2) { counts.identityBeforeConsent += 1; counts.forbiddenRequests += 1; forbidden.push("identity-start"); return route.abort("blockedbyclient") }
      startPermit = false; identityStarts += 1
    }
    if (allowedPost && url.pathname.endsWith("/identity/complete")) {
      if (!consentCommitted || !checkPermit || !operationId || url.pathname !== `/api/hackathon/v1/operations/${operationId}/identity/complete` || counts.checkResult >= 1) { counts.forbiddenRequests += 1; forbidden.push("identity-complete"); return route.abort("blockedbyclient") }
      checkPermit = false
    }
    if (allowedGet || allowedPost) return route.continue()
    counts.forbiddenRequests += 1; forbidden.push("api"); return route.abort("blockedbyclient")
  })
  const preview = () => page.getByTestId("hackathon-cx-preview")
  const clickPlaceCta = async () => {
    await page.getByTestId("canonical-place-details").click()
    await page.getByTestId("hackathon-entitlement-open").click()
    await preview().waitFor({ state: "visible" })
  }
  const beginConsent = async () => {
    checkpoint = "consent"
    const surface = preview(); await surface.getByRole("checkbox").check()
    const response = page.waitForResponse(item => item.url() === `${base.origin}/api/hackathon/v1/operations` && item.request().method() === "POST")
    consentCommitted = true; counts.consent += 1
    await surface.getByRole("button", { name: /Continue to check|확인 단계로|確認へ進む/ }).click(); const operationResponse = await response
    if (!operationResponse.ok()) safeFailure("operation-create")
    try { const body = await operationResponse.json(); if (typeof body?.operationId !== "string" || !/^op_[A-Za-z0-9_-]{8,160}$/.test(body.operationId)) safeFailure("operation-create"); operationId = body.operationId } catch { safeFailure("operation-create") }
    canceled = false
  }
  const assertStart = async (response, kind) => {
    if (!response.ok()) safeFailure(`${kind}-start`)
    try {
      const body = await response.json(); const handoff = body?.identity?.handoff
      if (body?.operationId !== operationId || body?.identity?.mode !== "cx" || handoff?.kind !== kind || typeof handoff?.expiresAt !== "string" || !Number.isFinite(Date.parse(handoff.expiresAt)) || Date.parse(handoff.expiresAt) <= Date.now()) safeFailure(`${kind}-handoff`)
    } catch { safeFailure(`${kind}-handoff`) }
  }
  const cancelCurrent = async () => {
    checkpoint = "cancel"
    const response = page.waitForResponse(item => item.url().endsWith(`/operations/${operationId}/cancel`) && item.request().method() === "POST")
    await preview().getByRole("button", { name: /^Cancel$|^취소$|^キャンセル$/ }).click(); const result = await response
    if (!result.ok()) safeFailure("cancel")
    try { const body = await result.json(); if (body?.operationId !== operationId || body?.status !== "cancelled" || body?.phase !== "cancelled" || body?.identity !== null) safeFailure("cancel-contract") } catch { safeFailure("cancel-contract") }
    counts.cancel += 1; canceled = true; consentCommitted = false; startPermit = false; checkPermit = false
    await preview().getByRole("checkbox").waitFor({ state: "visible" })
  }
  try {
    checkpoint = "page"
    await page.addInitScript(() => localStorage.setItem("ondo-b.device.v1", JSON.stringify({ locale: "en", appearancePreference: "light", onboarding: "ONB-COMPLETE" })))
    await page.goto(`${base.origin}/?venueId=${VENUE_ID}&review=0`, { waitUntil: "domcontentloaded" })
    checkpoint = "place"; await page.getByTestId("ondo-b-root").waitFor({ state: "visible" }); await clickPlaceCta()
    checkpoint = "access"; const surface = preview(); await surface.locator("input[type=password]").waitFor({ state: "visible" })
    await surface.locator("input[type=password]").fill(accessCode); counts.access += 1
    const accessResponse = page.waitForResponse(item => item.url() === `${base.origin}/api/hackathon/v1/preview/access` && item.request().method() === "POST")
    await surface.getByRole("button", { name: /Continue|확인|確認/ }).click(); if (!(await accessResponse).ok()) safeFailure("access")
    checkpoint = "config"; await surface.getByRole("checkbox").waitFor({ state: "visible" })
    if (!configObserved || revisionMismatch) safeFailure("config")
    await beginConsent()
    checkpoint = "qr-start"; await surface.getByRole("button", { name: /Use QR|QR로 확인|QRで確認/ }).click()
    startPermit = true
    const qrStartResponse = page.waitForResponse(item => item.url().endsWith(`/operations/${operationId}/identity/start`) && item.request().method() === "POST")
    await surface.getByRole("button", { name: /Start Mobile ID check|모바일 신분증 확인 시작|Mobile ID確認を開始/ }).click(); await assertStart(await qrStartResponse, "qr")
    checkpoint = "qr-render"; const qrImage = surface.locator("img[alt*='QR'], img[alt*='Mobile ID']"); await qrImage.waitFor({ state: "visible" }); await expect.poll(() => qrImage.evaluate(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0), { timeout: 5_000 }).toBe(true); counts.qr += 1
    checkpoint = "reload-resume"; await page.reload(); await preview().waitFor({ state: "detached" })
    await page.goto(`${base.origin}/?venueId=${VENUE_ID}&review=0`, { waitUntil: "domcontentloaded" }); await clickPlaceCta()
    checkpoint = "pending"; checkPermit = true; const checkResponse = page.waitForResponse(item => item.url().endsWith(`/operations/${operationId}/identity/complete`) && item.request().method() === "POST")
    await preview().getByRole("button", { name: /Check result|결과 확인|結果を確認/ }).click(); const checked = await checkResponse; counts.checkResult += 1
    if (!checked.ok()) safeFailure("check-result")
    let resultOutcome
    try { const body = await checked.json(); resultOutcome = classifyIdentityResult(body, operationId); observedResultOutcome = resultOutcome === "pending" ? "pending" : body.error.code } catch { safeFailure("check-result") }
    await expect(preview()).toHaveAttribute("data-status", "identity")
    if (resultOutcome === "pending") { counts.pendingResult += 1; await expect(preview()).toContainText("The check is not complete yet.") }
    else { counts.rejectedResult += 1; await expect(preview().locator("img[alt*='QR'], img[alt*='Mobile ID']")).toHaveCount(0); await expect(preview().getByRole("button", { name: /Start Mobile ID check|모바일 신분증 확인 시작|Mobile ID確認を開始/ })).toBeVisible(); await expect(preview().locator("[data-tone='error']")).toBeVisible() }
    await cancelCurrent()
    await beginConsent(); checkpoint = "app-start"; await preview().getByRole("button", { name: /Use app|앱으로 확인|アプリで確認/ }).click(); startPermit = true; const appStartResponse = page.waitForResponse(item => item.url().endsWith(`/operations/${operationId}/identity/start`) && item.request().method() === "POST"); await preview().getByRole("button", { name: /Start Mobile ID check|모바일 신분증 확인 시작|Mobile ID確認を開始/ }).click(); if (!(await appStartResponse).ok()) safeFailure("app-start")
    await assertStart(await appStartResponse, "app")
    checkpoint = "app-links"; const links = preview().locator("a[href]"); await links.first().waitFor({ state: "visible" })
    const unsafeLinks = await links.evaluateAll(nodes => nodes.filter(node => { try { return ["javascript:", "data:", "file:", "vbscript:"].includes(new URL(node.getAttribute("href") ?? "").protocol) } catch { return true } }).length)
    if (unsafeLinks) safeFailure("app-link-safety"); counts.app += await links.count()
    await cancelCurrent()
    checkpoint = "focus"; await preview().getByRole("button", { name: /^(Close|닫기|閉じる)$/ }).click(); await expect(page.getByTestId("hackathon-entitlement-open")).toBeFocused(); counts.returnedFocus += 1
    checkpoint = "network-guards"; if (counts.identityBeforeConsent || counts.forbiddenRequests || counts.pageErrors || forbidden.length) safeFailure("network-guards")
    return { ...counts, observedResultOutcome, operationObserved: Boolean(operationId), revisionChecked: Boolean(expectedRevision), canceled: true }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("cx browser smoke failed at ")) throw error
    safeFailure(checkpoint)
  } finally {
    let cleanupUnconfirmed = false
    if (operationId && /^op_[A-Za-z0-9_-]{8,160}$/.test(operationId) && !canceled) {
      try {
        const cleanup = await context.request.post(`${base.origin}/api/hackathon/v1/operations/${encodeURIComponent(operationId)}/cancel`, { headers: { origin: base.origin, "content-type": "application/json" }, data: {}, maxRedirects: 0, timeout: 5_000 })
        const body = await cleanup.json().catch(() => null)
        if (!cleanup.ok() || body?.operationId !== operationId || body?.status !== "cancelled" || body?.phase !== "cancelled" || body?.identity !== null) cleanupUnconfirmed = true
      } catch { cleanupUnconfirmed = true }
    }
    await context.close().catch(() => {})
    await browser.close().catch(() => {})
    if (cleanupUnconfirmed) throw new Error("cx browser smoke failed at cleanup-unconfirmed")
  }
}
