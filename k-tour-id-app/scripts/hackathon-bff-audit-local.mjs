// No application-source changes; creates disposable local sample records.
// Local sample operations only, no provider calls.
// A nonzero exit means the required recovery/decline behavior failed; these are
// not expected-failure tests and must not be counted as green UI fixtures.
import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { chromium, expect } from "@playwright/test"

const baseURL = "http://127.0.0.1:3137"
const venue = "mois-0021cd596bc5b2a922ad"
const output = resolve("artifacts/qa/hackathon-flow-audit-20260917")
const config = await fetch(`${baseURL}/api/hackathon/v1/config`).then(response => response.json())
assert.equal(config.isolatedMock, true)
assert.equal(config.capabilities.chainExecutionEnabled, false)
assert.equal(config.modes.cx, "mock")
assert.equal(config.modes.opendid, "mock")
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
const cases = []
const forbidden = []

async function openFlow() {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" })
  const page = await context.newPage()
  page.setDefaultTimeout(15000)
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin !== baseURL) {
      if (request.isNavigationRequest() || !["GET", "HEAD", "OPTIONS"].includes(request.method())) forbidden.push(`${request.method()} ${url.origin}${url.pathname}`)
      return route.abort("blockedbyclient")
    }
    if (request.method() === "POST" && (!url.pathname.startsWith("/api/hackathon/v1/") || /delegation\/|agent\/run|\/redeem$|zklogin\/prove/.test(url.pathname))) {
      forbidden.push(`${request.method()} ${url.pathname}`)
      return route.abort("blockedbyclient")
    }
    await route.continue()
  })
  await page.addInitScript(() => localStorage.setItem("ondo-b.device.v1", JSON.stringify({ locale: "en", appearancePreference: "light", onboarding: "ONB-COMPLETE" })))
  await page.goto(`/?venueId=${venue}&review=0`, { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("ondo-b-root")).toHaveAttribute("data-hydrated", "true")
  await page.getByTestId("canonical-place-details").click()
  await page.getByTestId("hackathon-entitlement-open").click()
  await page.locator("#hk-consent").check()
  await page.getByTestId("hackathon-start").click()
  await page.getByTestId("hackathon-identity-start").click()
  await page.getByTestId("hackathon-identity-approve").click()
  await expect(page.getByTestId("hackathon-layer")).toHaveAttribute("data-phase", "issuance")
  return { context, page, layer: page.getByTestId("hackathon-layer") }
}

try {
  // Real browser -> real local API. No synthetic presentation request is added.
  const decline = await openFlow()
  try {
    await decline.page.getByTestId("hackathon-issue").click()
    await expect(decline.layer).toHaveAttribute("data-phase", "presentation")
    const responsePromise = decline.page.waitForResponse(response => response.url().endsWith("/presentation/deny"))
    await decline.page.getByTestId("hackathon-presentation-deny").click()
    const response = await responsePromise, body = await response.json()
    await decline.page.screenshot({ path: resolve(output, "bff-presentation-decline.png"), scale: "css" })
    const safelyDeclined = response.ok() && body.presentation?.decision === "deny" && body.status === "cancelled" && body.phase === "cancelled" && !body.proposal && !body.delegation && !body.agent && !body.fulfillment
    cases.push({ id: "BFF-DECLINE", requirement: "Declining before any presentation request records refusal and cancellation without downstream advancement or an API error", passed: safelyDeclined, httpStatus: response.status(), errorCode: body.error?.code ?? null, errorMessage: body.error?.message ?? null, actualPhase: await decline.layer.getAttribute("data-phase") })
    // Presentation offers a decline action, not a separate cancel button.
    // Closing this disposable browser context must not fake a successful decline.
  } finally { await decline.context.close() }

  // Drop one holder acknowledgement only; issuance and retry reach the real BFF.
  const retry = await openFlow()
  try {
    let dropped = 0
    await retry.page.route("**/credential/holder-ack", async route => {
      dropped += 1
      if (dropped === 1) return route.abort("failed")
      await route.fallback()
    })
    const firstPromise = retry.page.waitForResponse(response => response.url().endsWith("/credential/issue"))
    await retry.page.getByTestId("hackathon-issue").click()
    const first = await firstPromise, firstBody = await first.json()
    await expect(retry.layer).toContainText(/fetch|network|load/i)
    const secondPromise = retry.page.waitForResponse(response => response.url().endsWith("/credential/issue"))
    await retry.page.getByTestId("hackathon-issue").click()
    const second = await secondPromise, secondBody = await second.json()
    let recovered = true
    try { await expect(retry.layer).toHaveAttribute("data-phase", "presentation", { timeout: 4000 }) } catch { recovered = false }
    await retry.page.screenshot({ path: resolve(output, "bff-issuance-retry.png"), scale: "css" })
    const sameCredential = Boolean(firstBody.vc?.id && firstBody.vc.id === secondBody.vc?.id && firstBody.result?.credential?.credentialRef === secondBody.result?.credential?.credentialRef)
    cases.push({ id: "BFF-ISSUE-RETRY", requirement: "Retry after an interrupted holder acknowledgement returns the same VC envelope and progresses to presentation", passed: recovered && sameCredential && Boolean(secondBody.result && secondBody.vc), firstHttpStatus: first.status(), retryHttpStatus: second.status(), firstEnvelope: Boolean(firstBody.result && firstBody.vc), retryEnvelope: Boolean(secondBody.result && secondBody.vc), sameCredential, holderAckAttempts: dropped, actualPhase: await retry.layer.getAttribute("data-phase") })
    await retry.page.getByTestId("hackathon-cancel").click()
    await expect(retry.layer).toHaveAttribute("data-status", "cancelled")
  } finally { await retry.context.close() }
} finally {
  await browser.close()
  const report = { generatedAt: new Date().toISOString(), baseURL, isolatedMock: true, externalExecutionBoundary: "Disabled by isolated server configuration plus browser request guards; not a measured provider transaction counter", cases, forbidden }
  await writeFile(resolve(output, "bff-audit.json"), JSON.stringify(report, null, 2) + "\n")
  console.log(JSON.stringify(report, null, 2))
  if (cases.length !== 2 || cases.some(row => !row.passed) || forbidden.length) process.exitCode = 1
}
