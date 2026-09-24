import { expect, test, type Locator, type Page } from "@playwright/test"

const DEVICE_KEY = "ondo-b.device.v1"

async function seed(page: Page, locale: "en" | "ko") {
  await page.addInitScript(({ key, nextLocale }) => {
    localStorage.setItem(key, JSON.stringify({
      locale: nextLocale,
      onboarding: "ONB-COMPLETE",
      persona: "short_term",
      discoveryPreferences: [],
      savedVenueIds: [],
      privateNotesByVenue: {},
      recentVenueIds: [],
      plannedTableRefs: [],
      localSignalPostedVenueIds: [],
      localPulseEvidenceByVenue: {},
      localInteractionBoundarySeen: false,
    }))
  }, { key: DEVICE_KEY, nextLocale: locale })
}

async function requiredBox(locator: Locator) {
  const bounds = await locator.boundingBox()
  expect(bounds).not.toBeNull()
  return bounds!
}

async function openSeoul(page: Page, locale: "en" | "ko", viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport)
  await seed(page, locale)
  await page.goto("/?city=seoul", { waitUntil: "domcontentloaded" })
  const root = page.getByTestId("ondo-b-map-entry")
  await expect(root).toHaveAttribute("data-effective-view", "map")
  await expect(root).toHaveAttribute("data-map-state", "ready", { timeout: 20_000 })
  return root
}

test.describe("premium Pulse map and responsive shell lane", () => {
  test.describe.configure({ timeout: 90_000 })

  for (const locale of ["en", "ko"] as const) {
    test(`${locale} mobile Pulse is non-temperature and leaves a contiguous map field`, async ({ page }) => {
      const root = await openSeoul(page, locale, { width: 390, height: 844 })

      await expect.soft(root).toHaveAttribute("data-pulse-visual-grammar", "aura-scale-selection-capsule")
      await expect.soft(root).toHaveAttribute("data-pulse-motion", "one-shot-bloom-reduced-safe")
      await expect.soft(page.getByTestId("ondo-b-pulse-marker-accessible-detail")).not.toContainText("°")
      await expect.soft(page.getByTestId("ondo-b-map-key")).not.toContainText("°")

      const [rootBox, headerBox, locationBox, locateBox, keyBox, resultBox, creditsBox] = await Promise.all([
        requiredBox(root),
        requiredBox(page.getByTestId("ondo-b-city-header")),
        requiredBox(page.getByTestId("ondo-b-location-message")),
        requiredBox(page.getByTestId("ondo-b-locate")),
        requiredBox(page.getByTestId("ondo-b-map-key")),
        requiredBox(page.getByTestId("ondo-b-result-bar")),
        requiredBox(page.getByTestId("ondo-b-attribution")),
      ])
      const readableTop = Math.max(headerBox.y + headerBox.height, locationBox.y + locationBox.height, locateBox.y + locateBox.height)
      const readableBottom = Math.min(keyBox.y, resultBox.y, creditsBox.y)
      expect.soft((readableBottom - readableTop) / rootBox.height).toBeGreaterThanOrEqual(.5)
      expect.soft(keyBox.height).toBeLessThanOrEqual(52)
      expect.soft(creditsBox.width).toBeLessThanOrEqual(48)
      expect.soft(Math.abs(resultBox.y - creditsBox.y)).toBeLessThanOrEqual(1)

      const touchTargets = [
        page.getByTestId("ondo-b-locate"),
        page.getByTestId("ondo-b-view-toggle"),
        page.getByTestId("ondo-b-map-key-details").locator(":scope > summary"),
        page.getByTestId("ondo-b-attribution").getByRole("link").first(),
      ]
      for (const target of touchTargets) {
        const bounds = await requiredBox(target)
        expect.soft(Math.min(bounds.width, bounds.height)).toBeGreaterThanOrEqual(44)
      }
    })
  }

  for (const viewport of [
    { width: 320, height: 720 },
    { width: 430, height: 932 },
  ]) {
    test(`${viewport.width}x${viewport.height} keeps at least half of the usable Explore surface as map`, async ({ page }) => {
      const root = await openSeoul(page, "en", viewport)
      const receipt = await root.evaluate((node) => {
        const rootRect = node.getBoundingClientRect()
        const box = (id: string) => node.querySelector<HTMLElement>(`[data-testid='${id}']`)?.getBoundingClientRect()
        const header = box("ondo-b-city-header")
        const location = box("ondo-b-location-message")
        const locate = box("ondo-b-locate")
        const key = box("ondo-b-map-key")
        const result = box("ondo-b-result-bar")
        const credits = box("ondo-b-attribution")
        const readableTop = Math.max(header?.bottom ?? rootRect.top, location?.bottom ?? rootRect.top, locate?.bottom ?? rootRect.top)
        const readableBottom = Math.min(key?.top ?? rootRect.bottom, result?.top ?? rootRect.bottom, credits?.top ?? rootRect.bottom)
        return {
          ratio: (readableBottom - readableTop) / rootRect.height,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        }
      })
      expect(receipt.ratio).toBeGreaterThanOrEqual(.5)
      expect(receipt.overflow).toBeLessThanOrEqual(1)
    })
  }

  test("1440 desktop uses a left navigation rail instead of a bottom phone dock", async ({ page }) => {
    const root = await openSeoul(page, "en", { width: 1440, height: 1000 })
    const canvas = page.getByTestId("ondo-canvas")
    const content = page.getByTestId("ondo-scroll-region")
    const nav = page.getByTestId("ondo-main-nav")
    await expect(canvas).toHaveAttribute("data-responsive-shell", "mobile-dock-desktop-rail")

    const [canvasBox, contentBox, navBox] = await Promise.all([
      requiredBox(canvas),
      requiredBox(content),
      requiredBox(nav),
    ])
    expect(navBox.x + navBox.width).toBeLessThanOrEqual(contentBox.x + .5)
    expect(navBox.width).toBeLessThanOrEqual(96)
    expect(navBox.height).toBeGreaterThanOrEqual(contentBox.height * .8)
    expect(navBox.y).toBeGreaterThanOrEqual(canvasBox.y)
    expect(navBox.y + navBox.height).toBeLessThanOrEqual(canvasBox.y + canvasBox.height)

    const buttonBoxes = await nav.getByRole("button").evaluateAll((buttons) => buttons.map((button) => {
      const rect = button.getBoundingClientRect()
      return { width: rect.width, height: rect.height }
    }))
    expect(buttonBoxes).toHaveLength(5)
    for (const bounds of buttonBoxes) expect(Math.min(bounds.width, bounds.height)).toBeGreaterThanOrEqual(44)

    await expect(root).toHaveAttribute("data-pulse-visual-grammar", "aura-scale-selection-capsule")
  })

  test("844x390 opens on the compact map and an explicit List remains scrollable", async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 })
    await seed(page, "ko")
    await page.goto("/?city=seoul", { waitUntil: "domcontentloaded" })
    const root = page.getByTestId("ondo-b-map-entry")
    await expect(root).toHaveAttribute("data-effective-view", "map")
    await expect(page.getByTestId("maplibre-map")).toBeVisible()
    const landscapeMapReceipt = await root.evaluate((node) => {
      const rootBox = node.getBoundingClientRect()
      const header = node.querySelector<HTMLElement>("[data-testid='ondo-b-city-header']")?.getBoundingClientRect()
      const lowerChrome = ["ondo-b-map-key", "ondo-b-result-bar", "ondo-b-attribution"]
        .map((id) => node.querySelector<HTMLElement>(`[data-testid='${id}']`)?.getBoundingClientRect())
        .filter((box): box is DOMRect => box != null)
      return {
        ratio: (Math.min(...lowerChrome.map((box) => box.top)) - (header?.bottom ?? rootBox.top)) / rootBox.height,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }
    })
    expect(landscapeMapReceipt.ratio).toBeGreaterThanOrEqual(.55)
    expect(landscapeMapReceipt.overflow).toBeLessThanOrEqual(1)
    await page.getByTestId("ondo-b-view-toggle").click()
    await expect(root).toHaveAttribute("data-requested-view", "list")
    await expect(root).toHaveAttribute("data-effective-view", "list")
    const list = page.getByTestId("ondo-b-list-panel")
    await expect(list).toBeVisible()
    await list.evaluate((node) => { node.scrollTop = 160 })
    expect(await list.evaluate((node) => node.scrollTop)).toBeGreaterThan(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  })

  test("desktop selection preserves the place flow and exposes the selected capsule grammar", async ({ page }) => {
    const root = await openSeoul(page, "en", { width: 1440, height: 1000 })
    await expect(root).toHaveAttribute("data-selected-pulse-grammar", "one-shot-halo-place-capsule")
    await page.getByTestId("ondo-b-map-key-details").locator(":scope > summary").click()
    await page.getByTestId("ondo-b-pulse-methodology").locator(":scope > summary").click()
    const hottest = page.getByTestId("ondo-b-map-pulse-places").getByRole("button").first()
    await expect(hottest).toHaveAttribute("data-temperature-score", /^\d+$/)
    await expect(hottest).not.toContainText("°")
    const hottestVenueId = await hottest.getAttribute("data-venue-id")
    expect(hottestVenueId).toBeTruthy()
    await hottest.click()
    await expect(root).toHaveAttribute("data-selected-venue-id", hottestVenueId!)
    await expect(page.getByTestId("ondo-b-selected-marker-status")).toContainText("ONDO temperature")
    await expect(page.getByTestId("ondo-b-selected-marker-status")).not.toContainText("°")
    await expect(page.getByTestId("canonical-place-peek")).toBeVisible()
  })

  test("reduced motion keeps ONDO temperature static while preserving all forty city signals", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" })
    const root = await openSeoul(page, "ko", { width: 390, height: 844 })
    await expect(root).toHaveAttribute("data-pulse-motion-applied", "static")
    await expect(root).toHaveAttribute("data-pulse-map-anchor-count", "8")
    await expect(page.getByTestId("ondo-b-pulse-marker-accessible-detail").locator("li")).toHaveCount(40)
    await page.getByTestId("ondo-b-map-key-details").locator(":scope > summary").click()
    const peakSwatch = page.getByTestId("ondo-b-pulse-legend").locator("[data-level='peak'] i")
    expect(await peakSwatch.evaluate((node) => getComputedStyle(node).animationName)).toBe("none")
  })

  test("production map has no runtime error overlay or console/page error", async ({ page }) => {
    test.skip(process.env.ONDO_PRODUCTION_ACCEPTANCE !== "1", "Run against an optimized production server")
    const errors: string[] = []
    page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`) })
    page.on("pageerror", (error) => errors.push(`page: ${error.message}`))
    await openSeoul(page, "en", { width: 390, height: 844 })
    await page.waitForTimeout(750)
    expect(errors).toEqual([])
    await expect(page.locator("nextjs-portal")).toHaveCount(0)
  })
})
