import { expect, test, type Locator, type Page } from "@playwright/test"
import { seedFreshOnboarding, type BLocale } from "../helpers/ondo-b-qa"

test.describe.configure({ timeout: 90_000 })

const errors = new WeakMap<Page, string[]>()
test.beforeEach(({ page }) => {
  const seen: string[] = []
  errors.set(page, seen)
  page.on("pageerror", error => seen.push(error.message))
})
test.afterEach(({ page }) => { expect(errors.get(page) ?? []).toEqual([]) })

async function start(page: Page, locale: BLocale, appearance: "light" | "dark") {
  // Device presentation preferences only: no identity, payment or map state
  // is injected. Every case enters the public root as a fresh guest.
  await seedFreshOnboarding(page, locale)
  await page.addInitScript(appearance => {
    const device = JSON.parse(localStorage.getItem("ondo-b.device.v1") ?? "{}")
    localStorage.setItem("ondo-b.device.v1", JSON.stringify({ ...device, appearancePreference: appearance }))
  }, appearance)
  await page.emulateMedia({ colorScheme: appearance, reducedMotion: "reduce" })
  await page.goto("/", { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("ondo-b-root")).toHaveAttribute("data-hydrated", "true")
  await expect(page.locator("html")).toHaveAttribute("lang", locale)
  await expect(page.locator("html")).toHaveAttribute("data-ondo-theme", appearance)
  await expect(page.getByTestId("ondo-b-nation")).toBeVisible()
  await expect(page.getByTestId("ondo-onboarding-backdrop")).toHaveCount(0)
  await expect(page.getByTestId("maplibre-map")).toHaveAttribute("data-map-state", "ready", { timeout: 35_000 })
}

async function box(node: Locator) {
  const bounds = await node.boundingBox()
  expect(bounds).not.toBeNull()
  return bounds!
}

async function hit(node: Locator) {
  await expect(node).toBeVisible()
  await expect.poll(() => node.evaluate(element => {
    const rect = element.getBoundingClientRect()
    return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
  }), { message: "The visible control must own its center hit target" }).toBe(true)
}

async function fullBleedMap(page: Page) {
  const viewport = page.viewportSize()!
  const canvas = page.getByTestId("maplibre-map").locator("canvas.maplibregl-canvas")
  await expect(canvas).toBeVisible()
  const shell = await box(page.getByTestId("ondo-canvas"))
  await expect.poll(async () => {
    const current = await box(canvas)
    return current.y + current.height
  }, { message: "The actual map canvas must reach the viewport bottom" }).toBeCloseTo(viewport.height, 0)
  const bounds = await box(canvas)
  expect(shell.y + shell.height).toBeCloseTo(viewport.height, 0)
  expect(bounds.width).toBeGreaterThanOrEqual(shell.width - 2)
  const clippedBottom = await canvas.evaluate(element => {
    let bottom = element.getBoundingClientRect().bottom
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      if (/^(hidden|clip|auto|scroll)$/.test(getComputedStyle(parent).overflowY)) {
        bottom = Math.min(bottom, parent.getBoundingClientRect().bottom)
      }
    }
    return Math.min(bottom, window.innerHeight)
  })
  expect(clippedBottom, "A full-height canvas must not be clipped above the dock by an ancestor").toBeCloseTo(viewport.height, 0)
  const nav = page.getByTestId("ondo-main-nav")
  const navBox = await box(nav)
  expect(navBox.y + navBox.height).toBeLessThanOrEqual(viewport.height)
  expect(navBox.y).toBeLessThan(bounds.y + bounds.height)
  const interaction = await box(page.getByTestId("ondo-b-map-entry"))
  expect(interaction.y + interaction.height, "Map controls reserve dock space even though the backdrop does not").toBeLessThanOrEqual(navBox.y + 1)
  for (const action of await nav.locator("button").all()) await hit(action)
  expect(await page.locator("html").evaluate(node => node.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1)
}

async function nationGeometry(page: Page) {
  const atlas = page.getByTestId("ondo-b-korea-atlas")
  await expect(atlas).toHaveAttribute("data-map-presentation", "ready")
  await expect(page.getByTestId("ondo-b-nation").getByRole("heading", { level: 1 })).toBeVisible()
  const lockup = page.locator('[data-ondo-brand-lockup="compact"]')
  await expect(lockup).toHaveAccessibleName("K-Tour ID")
  await expect(lockup.locator("b")).toHaveText("K-Tour ID")
  const subtitle = lockup.locator("..").locator(":scope > small")
  await expect(subtitle).toBeVisible()
  const markBox = await box(lockup.locator('[data-ktour-mark="monochrome"]'))
  const wordBox = await box(lockup.locator("b"))
  const lockupBox = await box(lockup)
  const subtitleBox = await box(subtitle)
  const atlasBox = await box(atlas)
  expect(wordBox.x - markBox.x - markBox.width, "Logo and product name need a deliberate gap").toBeGreaterThanOrEqual(7.5)
  expect(subtitleBox.y - lockupBox.y - lockupBox.height, "The subtitle must not crowd the product lockup").toBeGreaterThanOrEqual(7.5)
  expect(atlasBox.y - subtitleBox.y - subtitleBox.height, "The atlas border must clear the entire translated subtitle").toBeGreaterThanOrEqual(11.5)
  expect(await subtitle.evaluate(node => node.scrollWidth <= node.clientWidth + 1), "Do not truncate the translated subtitle").toBe(true)
  const header = lockup.locator("xpath=ancestor::header[1]")
  const brandBox = await box(lockup.locator(".."))
  for (const action of await header.locator("button:visible").all()) {
    const actionBox = await box(action)
    const overlapX = Math.min(brandBox.x + brandBox.width, actionBox.x + actionBox.width) - Math.max(brandBox.x, actionBox.x)
    const overlapY = Math.min(brandBox.y + brandBox.height, actionBox.y + actionBox.height) - Math.max(brandBox.y, actionBox.y)
    expect(overlapX > 1 && overlapY > 1, "Translated masthead must not collide with language/sample controls").toBe(false)
    await hit(action)
  }
  const navBox = await box(page.getByTestId("ondo-main-nav"))
  for (const city of ["seoul", "busan", "jeju"]) {
    const action = atlas.locator(`button[data-city="${city}"]`)
    await hit(action)
    const actionBox = await box(action)
    expect(actionBox.y + actionBox.height).toBeLessThanOrEqual(navBox.y - 7)
  }
  const preferences = page.getByTestId("ondo-b-personalization-edit")
  await hit(preferences)
  const preferenceBox = await box(preferences)
  expect(preferenceBox.y + preferenceBox.height).toBeLessThanOrEqual(navBox.y - 7)
  await fullBleedMap(page)
}

for (const locale of ["en", "ko", "ja"] as const) {
  for (const appearance of ["light", "dark"] as const) {
    test(`MAP-MASTHEAD ${locale} ${appearance} keeps the brand clear and the backdrop beneath the dock`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 320, height: 568 })
      await start(page, locale, appearance)
      for (const size of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(size)
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
        await nationGeometry(page)
        await page.screenshot({ path: testInfo.outputPath(`nation-${locale}-${appearance}-${size.width}.png`), scale: "css" })
      }
      if (locale === "en" && appearance === "light") {
        await page.emulateMedia({ reducedMotion: "no-preference" })
        const ambience = page.getByTestId("ondo-b-atlas-motion")
        await hit(ambience)
        const nav = await box(page.getByTestId("ondo-main-nav"))
        const control = await box(ambience)
        expect(control.y + control.height).toBeLessThanOrEqual(nav.y - 7)
      }
    })
  }
}

test("MAP-CANVAS city/list controls retain dock clearance and saved/pass retain their content padding", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await start(page, "en", "light")
  await page.getByTestId("ondo-b-korea-atlas").locator('button[data-city="seoul"]').click()
  await expect(page.getByTestId("ondo-b-city-header")).toBeVisible()
  await expect(page.getByTestId("maplibre-map")).toHaveAttribute("data-map-mode", "city")
  await expect(page.getByTestId("ondo-b-map-entry")).toHaveAttribute("data-entry-transition", "settled")
  await expect(page.getByTestId("ondo-b-map-entry")).toHaveAttribute("data-effective-view", "map")
  await fullBleedMap(page)
  const nav = await box(page.getByTestId("ondo-main-nav"))
  for (const action of [page.getByTestId("ondo-b-view-toggle"), page.getByTestId("ondo-b-map-key-details").locator(":scope > summary"), page.getByTestId("ondo-b-attribution").getByRole("link").first()]) {
    await hit(action)
    const bounds = await box(action)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(nav.y - 7)
  }
  await page.screenshot({ path: testInfo.outputPath("city-map-fullbleed.png"), scale: "css" })
  await page.getByTestId("ondo-b-view-toggle").click()
  await expect(page.getByTestId("ondo-b-result-bar")).toHaveAttribute("data-effective-view", "list")
  const list = page.getByTestId("ondo-b-list-panel")
  await expect(list).toBeVisible()
  const listBox = await box(list)
  const toggleBox = await box(page.getByTestId("ondo-b-view-toggle"))
  expect(listBox.y + listBox.height).toBeLessThanOrEqual(toggleBox.y + 1)
  expect(toggleBox.y + toggleBox.height).toBeLessThanOrEqual(nav.y - 7)
  expect(await list.evaluate(node => getComputedStyle(node).overflowY)).toBe("auto")
  await hit(page.getByTestId("ondo-b-view-toggle"))
  await fullBleedMap(page)
  await page.screenshot({ path: testInfo.outputPath("city-list-reserved-dock.png"), scale: "css" })
  for (const [tab, content] of [["my", "ondo-b-my-korea-entry"], ["id", "ondo-b-traveler-id"]] as const) {
    await page.getByTestId(`nav-${tab}`).click()
    await expect(page.getByTestId(content)).toBeVisible()
    const region = page.getByTestId("ondo-scroll-region")
    await expect(region).toHaveAttribute("data-active-tab", tab)
    const regionBox = await box(region)
    const dock = await box(page.getByTestId("ondo-main-nav"))
    expect(regionBox.y + regionBox.height).toBeLessThanOrEqual(dock.y + 1)
    expect(dock.y - regionBox.y - regionBox.height).toBeLessThanOrEqual(20)
    expect(await region.evaluate(node => getComputedStyle(node).paddingBottom)).toBe("0px")
    await expect(page.getByTestId("ondo-tab-panel-ondo")).toHaveAttribute("aria-hidden", "true")
    await hit(page.getByTestId(`nav-${tab}`))
    await page.screenshot({ path: testInfo.outputPath(`${tab}-unchanged-content-dock.png`), scale: "css" })
  }
  await page.getByTestId("nav-ondo").click()
  await expect(page.getByTestId("ondo-b-list-panel")).toBeVisible()
  await page.getByTestId("ondo-b-view-toggle").click()
  await expect(page.getByTestId("ondo-b-map-entry")).toHaveAttribute("data-effective-view", "map")
  await fullBleedMap(page)
})
