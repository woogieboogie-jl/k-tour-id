import { expect, test, type Page } from "@playwright/test"
import { GUIDE_SAVE_V2 as GUIDE } from "../../lib/hackathon/guide-contract"

// Run only on the actual `hackathon-guide-build.mjs` artifact with runtime OFF.
// No intercepted readiness/config fixtures and no provider credentials. Browser
// mutation blocking is defense in depth; any attempted API mutation fails QA.
test.skip(process.env.GUIDE_BUILT_PROFILE_QA !== "1", "Requires an explicitly prepared guide production artifact")
const pendingKey = "ondo-b.hackathon.pending.v1"

async function installReadOnlyBoundary(page: Page, baseURL: string) {
  const target = new URL(baseURL), origin = target.origin
  const local = ["http://127.0.0.1:3172", "http://localhost:3172"].includes(origin)
  const approvedInactivePreview = process.env.GUIDE_REMOTE_READ_ONLY === "1" && process.env.PLAYWRIGHT_BASE_URL === baseURL &&
    target.protocol === "https:" && /^ondo-[a-z0-9]+-jaewook-9643s-projects\.vercel\.app$/.test(target.hostname) && !target.port
  expect(!target.username && !target.password && target.pathname === "/" && !target.search && !target.hash).toBe(true)
  expect(local || approvedInactivePreview, "Only local3172 or an explicitly approved immutable guide Preview; never the main alias").toBe(true)
  const mutations: string[] = [], reads: string[] = [], errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  await page.addInitScript(() => {
    localStorage.setItem("ondo-b.device.v1", JSON.stringify({ locale: "ja", appearancePreference: "dark", onboarding: "ONB-COMPLETE" }))
    sessionStorage.setItem("ondo.review.flow.v1", "0")
  })
  await page.context().route("**/*", async route => {
    const request = route.request(), url = new URL(request.url())
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
      if (url.origin === origin && url.pathname.startsWith("/api/")) mutations.push(`${request.method()} ${url.pathname}`)
      await route.abort("blockedbyclient"); return
    }
    if (url.origin !== origin) {
      const passive = ["fonts.googleapis.com", "fonts.gstatic.com", "tiles.openfreemap.org", "demotiles.maplibre.org"].includes(url.hostname)
      if (!passive || request.resourceType() === "document") { await route.abort("blockedbyclient"); return }
    }
    if (url.origin === origin && url.pathname.startsWith("/api/hackathon/")) reads.push(url.pathname)
    await route.continue()
  })
  return { mutations, reads, errors }
}

async function hydrated(page: Page) {
  await expect(page.getByTestId("ondo-b-root")).toHaveAttribute("data-hydrated", "true")
  await page.evaluate(async () => {
    await document.fonts.ready
    // Map ambience includes paused timelines: awaiting every animation in the
    // document can never settle. Only await the current modal's bounded entry.
    const dialog = document.querySelector("[role='dialog']")
    const finiteEntry = dialog?.getAnimations({ subtree: true }).filter(a => a.playState === "running" && Number(a.effect?.getComputedTiming().endTime) <= 1500) ?? []
    await Promise.race([Promise.all(finiteEntry.map(a => a.finished.catch(() => {}))), new Promise(resolve => window.setTimeout(resolve, 1600))])
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  })
}

async function noLegacyJourney(page: Page) {
  for (const id of ["hackathon-entitlement-open", "hackathon-demo-entry", "hackathon-layer", "hackathon-integration-access", "hackathon-cx-preview"]) {
    await expect(page.getByTestId(id)).toHaveCount(0)
  }
}

test("GUIDE-BUILD-01: free guide remains usable while legacy venue and menu CTAs are absent", async ({ page, baseURL }, info) => {
  const audit = await installReadOnlyBoundary(page, baseURL!)
  await page.goto(`/?venueId=${GUIDE.venueId}&review=0`, { waitUntil: "domcontentloaded" })
  await hydrated(page)
  if (!await page.getByTestId("canonical-place-overlay").isVisible()) await page.getByTestId("canonical-place-details").click()
  await expect(page.getByTestId("experience-open")).toBeVisible()
  await noLegacyJourney(page)
  await page.getByTestId("experience-open").click()
  await expect(page.getByTestId("experience-public-guide")).toBeVisible()
  await expect(page.getByTestId("experience-guide-content").getByRole("heading", { level: 3 })).toHaveCount(3)
  const responsePromise = page.waitForResponse(r => new URL(r.url()).pathname === "/api/hackathon/v1/guide/readiness")
  await page.getByTestId("experience-add-to-pass").click()
  const response = await responsePromise
  expect(response.status()).toBe(200)
  expect(await response.json()).toMatchObject({ supported: true, ready: false, verification: "configuration_only", accessProfile: "unavailable", guideId: GUIDE.guideId, campaignId: GUIDE.campaignId })
  await expect(page.getByTestId("guide-save-readiness")).toHaveAttribute("data-ready", "false")
  await expect(page.getByTestId("guide-save-readiness")).toContainText("現在、パスには保存できません")
  await hydrated(page)
  await page.screenshot({ path: info.outputPath("guide-built-runtime-off-ja.png") })
  await page.getByTestId("guide-keep-reading").click()
  await expect(page.getByTestId("experience-public-guide")).toBeVisible()
  // Explicitly entering the existing sample menu must not restore the removed
  // v1 shortcut. This changes no build/runtime policy or provider authority.
  await page.goto("/?review=1", { waitUntil: "domcontentloaded" })
  await hydrated(page)
  await page.getByTestId("review-sample-indicator").first().click()
  await expect(page.getByTestId("integration-demo-open")).toBeVisible()
  await noLegacyJourney(page)
  expect(audit.mutations).toEqual([])
  expect(audit.errors).toEqual([])
})

test("GUIDE-BUILD-02: historical stored resume and forged legacy events cannot select a legacy or sample journey", async ({ page, baseURL }) => {
  const audit = await installReadOnlyBoundary(page, baseURL!)
  const legacy = { venueId: GUIDE.venueId, locale: "ja", resumeOperationId: "historical-v1-operation", savedAt: Date.now() }
  await page.addInitScript(({ key, value }) => sessionStorage.setItem(key, JSON.stringify(value)), { key: pendingKey, value: legacy })
  await page.goto("/?review=0&hk=historical-v1-operation", { waitUntil: "domcontentloaded" })
  await hydrated(page)
  await noLegacyJourney(page)
  await expect(page.getByTestId("guide-save-readiness")).toHaveCount(0)
  expect(await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)!), pendingKey)).toEqual(legacy)
  for (const source of [undefined, "legacy", "sample", "integration-preview"]) {
    await page.evaluate(({ venueId, source }) => window.dispatchEvent(new CustomEvent("ondo:b:hackathon-open", { detail: { venueId, locale: "ja", source, resumeOperationId: "historical-v1-operation" } })), { venueId: GUIDE.venueId, source })
  }
  await hydrated(page)
  await noLegacyJourney(page)
  expect(audit.reads.some(path => /\/operations(?:\/|$)|\/config$/.test(path))).toBe(false)
  expect(audit.mutations).toEqual([])
  expect(audit.errors).toEqual([])
  // An explicit guide source remains a view-only request. It must pass the real
  // readiness gate and cannot reinterpret the historical pointer as a v2 result.
  await page.evaluate(venueId => window.dispatchEvent(new CustomEvent("ondo:b:hackathon-open", { detail: { venueId, locale: "ja", source: "guide", returnTo: "place" } })), GUIDE.venueId)
  await expect(page.getByTestId("guide-save-readiness")).toHaveAttribute("data-ready", "false")
  await noLegacyJourney(page)
  expect(audit.reads).toContain("/api/hackathon/v1/guide/readiness")
  expect(audit.mutations).toEqual([])
})

test("GUIDE-BUILD-03: old start, auto-execute, step and /hackathon shortcuts do not open the entitlement venue", async ({ page, baseURL }) => {
  const audit = await installReadOnlyBoundary(page, baseURL!)
  for (const path of ["/?hk=start", "/?hk=auto", "/?hk=auto-execute", "/?hk=step", "/hackathon"]) {
    await page.goto(path, { waitUntil: "domcontentloaded" })
    await hydrated(page)
    await expect.poll(() => new URL(page.url()).searchParams.has("hk")).toBe(false)
    // The removed shortcut used a 300 ms timer plus an expansion retry. Observe
    // beyond that window without forcing clicks or disabling product motion.
    await page.waitForTimeout(700)
    await noLegacyJourney(page)
    await expect(page.getByTestId("canonical-place-overlay")).toHaveCount(0)
    await expect(page.getByTestId("guide-save-readiness")).toHaveCount(0)
  }
  expect(audit.reads.some(path => /\/operations(?:\/|$)|\/config$/.test(path))).toBe(false)
  expect(audit.mutations).toEqual([])
  expect(audit.errors).toEqual([])
})
