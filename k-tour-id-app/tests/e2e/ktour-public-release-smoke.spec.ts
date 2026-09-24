import { expect, test, type Page, type TestInfo } from "@playwright/test"

test.describe.configure({ timeout: 180_000 })
// CSS-pixel layout/flow smoke, not a high-DPI or physical-device performance test.
// Avoid continuous video and 3x rasterization of WebGL on a shared QA machine.
test.use({ serviceWorkers: "block", video: "off", deviceScaleFactor: 1 })

type Locale = "ko" | "en" | "ja"

const DEVICE_KEY = "ondo-b.device.v1"
const DEVICE_STATE = {
  onboarding: "ONB-COMPLETE",
  persona: "short_term",
  discoveryPreferences: [],
  savedVenueIds: [],
  savedEditorialPlaceIds: [],
  privateNotesByVenue: {},
  recentVenueIds: [],
  recentEditorialPlaceIds: [],
  plannedTableRefs: [],
  localSignalPostedVenueIds: [],
  localPulseEvidenceByVenue: {},
  localInteractionBoundarySeen: false,
  commerceReceipts: [],
}

const LOCALE_LABEL: Record<Locale, string> = { ko: "한국어", en: "English", ja: "日本語" }

async function installPublicGuards(page: Page, baseURL: string) {
  const origin = new URL(baseURL).origin
  const config = await page.request.get(`${origin}/api/hackathon/v1/config`)
  expect(config.status()).toBe(404)

  const forbidden: string[] = []
  await page.route("**/*", async route => {
    const request = route.request()
    const url = new URL(request.url())
    const local = url.origin === origin
    const venueRead = /^\/api\/ondo\/venues(?:\/|$)/.test(url.pathname)
    const passive = ["tiles.openfreemap.org", "fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname)
    const allowed = ["GET", "HEAD"].includes(request.method()) && (local ? !url.pathname.startsWith("/api/") || venueRead : passive)
    if (!allowed) {
      forbidden.push(`${request.method()} ${url.origin}${url.pathname}`)
      await route.abort("blockedbyclient")
      return
    }
    await route.continue()
  })
  return { forbidden }
}

async function openPublic(page: Page, baseURL: string, locale: Locale, localeFromSettings = true) {
  const pageErrors: string[] = []
  page.on("pageerror", error => pageErrors.push(error.message))
  await page.addInitScript(({ key, state, nextLocale }) => {
    localStorage.setItem(key, JSON.stringify({ ...state, locale: nextLocale }))
    sessionStorage.clear()
  }, { key: DEVICE_KEY, state: DEVICE_STATE, nextLocale: localeFromSettings ? "ko" : locale })
  const guard = await installPublicGuards(page, baseURL)
  await page.goto(`${baseURL}/?city=seoul`, { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("ondo-b-root")).toBeVisible()
  // Wait for the URL-backed city to hydrate before leaving the map for Settings.
  await expect(page.getByTestId("ondo-b-map-entry")).toHaveAttribute("data-city", "seoul")
  await expect(page.getByTestId("maplibre-map")).toHaveAttribute("data-map-state", "ready", { timeout: 30_000 })

  if (locale !== "ko" && localeFromSettings) {
    await page.getByTestId("nav-settings").click()
    await page.getByTestId("settings-language-row").click()
    await page.getByRole("radio", { name: LOCALE_LABEL[locale], exact: true }).click()
    await expect(page.getByTestId("ondo-b-root")).toHaveAttribute("data-locale", locale)
    await page.keyboard.press("Escape")
    await expect(page.locator('[role="dialog"]')).toHaveCount(0)
    await page.getByTestId("nav-ondo").click()
  }
  await expect(page.getByTestId("ondo-b-map-entry")).toHaveAttribute("data-map-state", "ready", { timeout: 30_000 })
  await expect(page.getByTestId("ondo-b-root")).toHaveAttribute("data-locale", locale)
  return { ...guard, pageErrors }
}

async function checkRootTitle(page: Page, testInfo: TestInfo, tab: string) {
  await page.getByTestId(`nav-${tab}`).click()
  const root = page.locator('[data-page-typography="root"][data-testid]').filter({ visible: true }).first()
  const title = root.locator("[data-page-title]")
  const frame = root.locator("[data-page-title-frame]")
  await expect(title).toBeVisible()
  await expect(frame).toBeVisible()
  const metrics = await title.evaluate(element => {
    const style = getComputedStyle(element)
    const frameBox = element.parentElement?.getBoundingClientRect()
    const box = element.getBoundingClientRect()
    return {
      fontSize: Number.parseFloat(style.fontSize),
      lineHeight: Number.parseFloat(style.lineHeight),
      frameHeight: frameBox?.height ?? 0,
      frameX: frameBox?.x ?? 0,
      frameY: frameBox?.y ?? 0,
      frameRight: frameBox ? frameBox.x + frameBox.width : 0,
      viewportWidth: window.innerWidth,
      x: box.x,
    }
  })
  expect(metrics.fontSize).toBeGreaterThanOrEqual(30)
  expect(metrics.fontSize).toBeLessThanOrEqual(32.1)
  expect(metrics.lineHeight).toBeGreaterThan(0)
  expect(metrics.frameHeight).toBeGreaterThanOrEqual(48)
  expect(metrics.frameY).toBeGreaterThanOrEqual(27.5)
  expect(metrics.frameX).toBeGreaterThanOrEqual((metrics.viewportWidth <= 360 ? 16 : 20) - .5)
  expect(metrics.frameRight).toBeLessThanOrEqual(metrics.viewportWidth + .5)
  await testInfo.attach(`${tab}-title-${metrics.fontSize}px`, { body: JSON.stringify(metrics), contentType: "application/json" })
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(name)
  await page.screenshot({ fullPage: false, path })
  await testInfo.attach(name, { path, contentType: "image/png" })
}

for (const locale of ["ko", "en", "ja"] as const) {
  for (const width of [320, 390] as const) {
    test(`${locale.toUpperCase()} ${width}px public roots and map header`, async ({ page, baseURL }, testInfo) => {
      await page.setViewportSize({ width, height: 844 })
      const guard = await openPublic(page, baseURL!, locale)
      for (const tab of ["my", "tables", "id", "settings"]) await checkRootTitle(page, testInfo, tab)
      await page.getByTestId("nav-ondo").click()
      await expect(page.getByTestId("map-temperature-spectrum")).toBeVisible()
      await expect(page.getByTestId("map-discovery-story-carousel")).toBeVisible()
      await capture(page, testInfo, `${locale}-${width}-map.png`)
      expect(guard.forbidden).toEqual([])
      expect(guard.pageErrors).toEqual([])
    })
  }
}

test("JA 390px dark public map keeps header and story usable", async ({ page, baseURL }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const guard = await openPublic(page, baseURL!, "ja")
  await page.getByTestId("nav-settings").click()
  await page.getByTestId("settings-appearance-row").click()
  await page.getByRole("radio", { name: "ダーク", exact: true }).click()
  await page.keyboard.press("Escape")
  await expect(page.locator('[role="dialog"]')).toHaveCount(0)
  await page.getByTestId("nav-ondo").click()
  await expect(page.getByTestId("map-temperature-spectrum")).toBeVisible()
  await expect(page.getByTestId("map-discovery-story-carousel")).toBeVisible()
  await expect(page.getByTestId("ondo-b-root")).toHaveAttribute("data-appearance", "dark")
  await capture(page, testInfo, "ja-390-dark.png")
  expect(guard.forbidden).toEqual([])
  expect(guard.pageErrors).toEqual([])
})

test("JA 390px mood, list, search, and wallet return remain public-only", async ({ page, baseURL }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  // Settings locale changes are covered by the matrix above; this scenario starts
  // as a returning Japanese-language user to isolate the discovery interaction.
  const guard = await openPublic(page, baseURL!, "ja", false)
  const map = page.getByTestId("ondo-b-map-entry")
  await page.getByTestId("map-temperature-hot").click()
  await expect(map).toHaveAttribute("data-discovery-collection", "hot")
  await expect(page.getByTestId("map-discovery-results")).toHaveAttribute("data-result-count", "3")
  await page.getByTestId("map-discovery-show-list").click()
  await expect(map).toHaveAttribute("data-effective-view", "list")
  await page.getByTestId("ondo-b-map-search-toggle").click()
  const search = page.getByTestId("ondo-b-search")
  await expect(search).toBeVisible()
  await search.fill("시장")
  await search.press("Enter")
  // Submitting intentionally collapses the search panel; reopening must retain it.
  await expect(search).toHaveCount(0)
  await expect(page.getByTestId("ondo-b-map-search-toggle")).toHaveAttribute("aria-label", /시장/)
  await page.getByTestId("ondo-b-map-search-toggle").click()
  await expect(search).toHaveValue("시장")
  await search.press("Escape")
  await page.getByTestId("map-wallet-balance").click()
  await expect(page.getByTestId("wallet-link-open")).toBeVisible()
  await page.getByTestId("nav-ondo").click()
  await expect(map).toBeVisible()
  await capture(page, testInfo, "ja-390-interactions.png")
  expect(guard.forbidden).toEqual([])
  expect(guard.pageErrors).toEqual([])
})
