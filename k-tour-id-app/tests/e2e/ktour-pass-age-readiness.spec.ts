import { expect, test } from "@playwright/test"
import { JIT_IDENTITY_CONSENT, JIT_IDENTITY_VERSION } from "../../lib/hackathon/jit-identity-contract"

// Synthetic GET status fixtures only, not live authentication or an action grant.
for (const locale of ["ko", "en", "ja"] as const) test(`PASS-AGE ${locale}: server-only display, local expiry and no writes`, async ({ page }, info) => {
  if (locale === "ko" && info.project.name === "mobile-chromium") await page.setViewportSize({ width: 320, height: 700 })
  const writes: string[] = []
  const pageErrors: string[] = []
  page.on("pageerror", error => pageErrors.push(error.message))
  let mode: "loading" | "proof_required" | "unsupported" | "not_verified" | "verified" | "invalid" | "unavailable" = "loading"
  let expiresAt: string | null = null
  let releaseLoading!: () => void
  const loading = new Promise<void>(resolve => { releaseLoading = resolve })
  await page.addInitScript(locale => {
    localStorage.setItem("ondo-b.device.v1", JSON.stringify({ locale, onboarding: "ONB-COMPLETE", persona: null, discoveryPreferences: [], savedVenueIds: [], privateNotesByVenue: {}, recentVenueIds: [], plannedTableRefs: [], localSignalPostedVenueIds: [], localPulseEvidenceByVenue: {}, localInteractionBoundarySeen: true, commerceLocalBoundarySeen: true, commerceReceipts: [] }))
  }, locale)
  await page.route("**/api/**", async route => {
    const req = route.request()
    if (!["GET", "HEAD"].includes(req.method())) { writes.push(new URL(req.url()).pathname); return route.fulfill({ status: 503, json: { error: { code: "fixture_write_denied" } } }) }
    const path = new URL(req.url()).pathname
    if (!path.startsWith("/api/hackathon/")) return route.continue()
    if (!path.endsWith("/identity/eligibility")) return route.fulfill({ status: 503, json: { error: { code: "fixture_not_enabled" } } })
    if (mode === "loading") await loading
    if (mode === "unavailable") return route.fulfill({ status: 503, json: { error: { code: "identity_unavailable" } } })
    return route.fulfill({ json: {
      version: JIT_IDENTITY_VERSION, provider: "omnione_cx", execution: "provider", canStart: true, consentVersion: JIT_IDENTITY_CONSENT,
      person: { state: "verified", expiresAt: new Date(Date.now() + 120_000).toISOString() },
      adult: { state: "verified", expiresAt: new Date(Date.now() + 120_000).toISOString() },
      age19: mode === "unsupported" ? { state: "unsupported" } : { state: mode === "invalid" ? "verified" : mode, expiresAt: mode === "invalid" ? null : expiresAt },
      paymentKyc: { state: "unsupported" },
    } })
  })
  await page.route("https://tiles.openfreemap.org/**", route => route.abort("blockedbyclient"))
  await page.goto("/?review=0", { waitUntil: "domcontentloaded" })
  await page.getByTestId("nav-id").click()
  await page.getByTestId("travel-pass-readiness-toggle").click()
  const age = page.getByTestId("traveler-id-age")
  await expect(age).toHaveAttribute("data-status", "loading")
  mode = "proof_required"; releaseLoading()
  await expect(age).toHaveAttribute("data-status", "proof_required")
  await expect(age).toContainText("After19")
  await expect(age.locator("button,a")).toHaveCount(0)
  await expect(age).not.toContainText(/아직 연결되지|未接続|not connected/)
  await age.scrollIntoViewIfNeeded()
  await page.evaluate(() => document.fonts.ready)
  await expect.poll(() => age.evaluate(node => {
    const title = node.querySelector("h3")!.getBoundingClientRect(), status = node.querySelector("div")!.getBoundingClientRect(), guidance = node.querySelector("p")!.getBoundingClientRect()
    return { readable: status.width > 120, noOverlap: guidance.top >= Math.max(title.bottom, status.bottom) + 3, contained: node.scrollWidth <= node.clientWidth + 1 }
  })).toEqual({ readable: true, noOverlap: true, contained: true })
  await page.screenshot({ path: info.outputPath(`pass-age-${locale}-required.png`) })
  for (const state of ["unsupported", "not_verified", "verified"] as const) {
    mode = state; expiresAt = state === "verified" ? new Date(Date.now() + 2500).toISOString() : null
    await page.evaluate(() => window.dispatchEvent(new Event("focus")))
    await expect(age).toHaveAttribute("data-status", state === "unsupported" ? "unavailable" : state)
  }
  await expect(age).toContainText("OmniOne CX")
  await expect(age).toHaveAttribute("data-status", "expired", { timeout: 6000 })
  await age.scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath(`pass-age-${locale}-expired.png`) })
  for (const state of ["invalid", "unavailable"] as const) {
    mode = state
    await page.evaluate(() => window.dispatchEvent(new Event("focus")))
    await expect(age).toHaveAttribute("data-status", "unavailable")
  }
  await expect(page.getByTestId("jit-identity-check")).toHaveCount(0)
  expect(writes).toEqual([])
  expect(pageErrors).toEqual([])
})

test("PASS-AGE explicit review keeps the existing separate review-only age control", async ({ page }) => {
  const writes: string[] = []
  await page.addInitScript(() => localStorage.setItem("ondo-b.device.v1", JSON.stringify({ locale: "en", onboarding: "ONB-COMPLETE", persona: null, discoveryPreferences: [], savedVenueIds: [], privateNotesByVenue: {}, recentVenueIds: [], plannedTableRefs: [], localSignalPostedVenueIds: [], localPulseEvidenceByVenue: {}, localInteractionBoundarySeen: true, commerceLocalBoundarySeen: true, commerceReceipts: [] })))
  await page.route("**/api/hackathon/**", route => { if (route.request().method() !== "GET") writes.push(route.request().method()); return route.fulfill({ status: 503, json: { error: { code: "fixture_not_enabled" } } }) })
  await page.route("https://tiles.openfreemap.org/**", route => route.abort("blockedbyclient"))
  await page.goto("/?review=1", { waitUntil: "domcontentloaded" })
  await page.getByTestId("nav-id").click()
  await page.getByTestId("travel-pass-readiness-toggle").click()
  const age = page.getByTestId("traveler-id-age")
  await expect(age).toHaveAttribute("data-status", "none")
  await expect(age).not.toHaveAttribute("data-display-only-age", "true")
  await age.getByTestId("traveler-id-age-check").click()
  await expect(page.getByTestId("ondo-b-local-check-walkthrough")).toBeVisible()
  await expect(page.getByTestId("jit-identity-check")).toHaveCount(0)
  expect(writes).toEqual([])
})
