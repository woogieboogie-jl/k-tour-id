import { expect, test, type Page } from "@playwright/test"
import { CANONICAL_VENUE_ID, gotoB, prepareBPage, seedB } from "../helpers/ondo-b-qa"

test.describe.configure({ timeout: 90_000 })
// Screenshots and retained failure traces are sufficient for this geometry
// suite; continuous video encoding competes with MapLibre on a busy QA host.
test.use({ video: "off" })
const browserErrors = new WeakMap<Page, string[]>()
test.beforeEach(async ({ page, request, baseURL }) => {
  browserErrors.set(page, [])
  page.on("pageerror", error => browserErrors.get(page)!.push(error.message))
  // UI-only regression: do not authenticate a person or send provider writes.
  const target = new URL(baseURL!)
  expect(target.hostname).toBe("127.0.0.1")
  expect(target.port).toBe("3166")
  const config = await request.get("/api/hackathon/v1/config")
  // The credential-free local runner selects the isolated mock profile.
  // Never allow these UI seeds against a real-provider deployment.
  expect(config.status()).toBe(200)
  expect(await config.json()).toMatchObject({ isolatedMock: true })
  await page.route("**/*", async route => {
    if (!["GET", "HEAD", "OPTIONS"].includes(route.request().method())) {
      await route.abort("blockedbyclient")
      throw new Error(`UI regression attempted ${route.request().method()} ${new URL(route.request().url()).pathname}`)
    }
    await route.continue()
  })
  await prepareBPage(page)
})
test.afterEach(async ({ page }) => { expect(browserErrors.get(page)).toEqual([]) })

async function openCity(page: Page) {
  await gotoB(page, "?city=seoul")
  await expect(page.getByTestId("ondo-b-map-entry")).toHaveAttribute("data-map-state", "ready", { timeout: 40_000 })
}

for (const scenario of [
  { width: 320, height: 700, locale: "ko", theme: "dark" },
  { width: 390, height: 844, locale: "ja", theme: "light" },
  { width: 1440, height: 1000, locale: "en", theme: "dark" },
  { width: 1920, height: 1080, locale: "ja", theme: "light" },
] as const) {
  test(`After19 keeps a contained badge and working search at ${scenario.width}/${scenario.locale}/${scenario.theme}`, async ({ page }, info) => {
    await page.setViewportSize({ width: scenario.width, height: scenario.height })
    await seedB(page, { locale: scenario.locale, session: { after19: "A19-OFF" } })
    await page.addInitScript(theme => {
      const state = JSON.parse(localStorage.getItem("ondo-b.device.v1") ?? "{}")
      localStorage.setItem("ondo-b.device.v1", JSON.stringify({ ...state, appearancePreference: theme }))
    }, scenario.theme)
    await openCity(page)
    const searchToggle = page.getByTestId("ondo-b-map-search-toggle")
    const options = page.getByTestId("ondo-b-map-options-open")
    await searchToggle.click()
    await expect(page.getByTestId("ondo-b-search")).toBeFocused()
    await page.getByTestId("ondo-b-map-search-close").click()
    await options.click()
    await page.getByTestId("ondo-b-map-options-after19-open").click()
    await page.getByTestId("global-after19-confirm").click()
    await expect(page.getByTestId("global-after19-prompt-layer")).toHaveCount(0)
    await expect(page.getByTestId("ondo-b-map-entry")).toHaveAttribute("data-after19-active", "true")
    await expect(options).toHaveAttribute("data-after19-active", "true")
    const badge = options.locator("span")
    const [optionBox, badgeBox] = await Promise.all([options.boundingBox(), badge.boundingBox()])
    expect(badgeBox!.x).toBeGreaterThanOrEqual(optionBox!.x)
    expect(badgeBox!.y).toBeGreaterThanOrEqual(optionBox!.y)
    expect(badgeBox!.x + badgeBox!.width).toBeLessThanOrEqual(optionBox!.x + optionBox!.width)
    expect(badgeBox!.y + badgeBox!.height).toBeLessThanOrEqual(optionBox!.y + optionBox!.height)
    for (const target of [searchToggle, options, page.getByTestId("ondo-b-city-picker")]) {
      expect(await target.evaluate(element => {
        const r = element.getBoundingClientRect()
        return r.width >= 44 && r.height >= 44 && element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
      })).toBe(true)
    }
    await searchToggle.click()
    const search = page.getByTestId("ondo-b-search")
    await expect(search).toBeFocused()
    await search.fill("Roba")
    await expect(search).toHaveValue("Roba")
    await page.screenshot({ path: info.outputPath(`after19-search-${scenario.width}-${scenario.locale}-${scenario.theme}.png`) })
    await page.getByTestId("ondo-b-map-search-clear").click()
    await page.getByTestId("ondo-b-map-search-close").click()
    await options.click()
    await page.getByTestId("ondo-b-map-options-after19-open").click()
    await expect(page.getByTestId("ondo-b-map-entry")).toHaveAttribute("data-after19-active", "false")
    await searchToggle.click()
    await expect(search).toBeFocused()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}

for (const width of [1440, 1920]) test(`desktop ${width} header and responsive story dock share the map center`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 1080 })
  await seedB(page, { locale: "ja" })
  await openCity(page)
  const root = await page.getByTestId("ondo-b-map-entry").boundingBox()
  const header = await page.getByTestId("ondo-b-city-header").boundingBox()
  const dock = await page.getByTestId("map-discovery-dock").boundingBox()
  for (const box of [header!, dock!]) expect(Math.abs(box.x + box.width / 2 - (root!.x + root!.width / 2))).toBeLessThan(2)
  expect(header!.width).toBe(600)
  expect(dock!.width).toBe(720)
  const next = page.getByTestId("map-story-next")
  const card = page.getByTestId("map-discovery-story").first()
  const [nextBox, cardBox] = await Promise.all([next.boundingBox(), card.boundingBox()])
  expect(nextBox!.y).toBeLessThan(cardBox!.y + cardBox!.height)
  expect(nextBox!.x).toBeGreaterThan(cardBox!.x + cardBox!.width)
  await next.click()
  await expect(page.getByTestId("map-discovery-story-carousel").locator('[aria-live="polite"]')).toHaveText("2 / 3")
  await page.screenshot({ path: info.outputPath(`centered-story-${width}.png`) })
})

test("wide short window keeps the header and story in separate usable lanes", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 480 })
  await seedB(page, { locale: "en" })
  await openCity(page)
  const header = await page.getByTestId("ondo-b-city-header").boundingBox()
  const dock = await page.getByTestId("map-discovery-dock").boundingBox()
  expect(header!.x + header!.width).toBeLessThan(dock!.x)
  for (const box of [header!, dock!]) {
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height).toBeLessThanOrEqual(480)
  }
  await page.getByTestId("map-story-next").click()
  await page.getByTestId("ondo-b-map-search-toggle").click()
  await expect(page.getByTestId("ondo-b-search")).toBeFocused()
  await page.screenshot({ path: info.outputPath("wide-short-search.png") })
})

test("After19 handoff with a selected mobile place leaves search interactive", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await seedB(page, { locale: "ja" })
  await gotoB(page, `?venueId=${CANONICAL_VENUE_ID}&review=0`)
  await expect(page.getByTestId("canonical-place-peek")).toBeVisible()
  await page.getByTestId("ondo-b-map-options-open").click()
  await page.getByTestId("ondo-b-map-options-after19-open").click()
  await page.getByTestId("global-after19-confirm").click()
  await expect(page.getByTestId("global-after19-prompt-layer")).toHaveCount(0)
  await expect(page.getByTestId("ondo-b-map-entry")).toHaveAttribute("data-after19-active", "true")
  await page.getByTestId("ondo-b-map-search-toggle").click()
  await page.getByTestId("ondo-b-search").fill("로바")
  await expect(page.getByTestId("ondo-b-search")).toBeFocused()
  await expect(page.getByTestId("ondo-b-search")).toHaveValue("로바")
  await page.screenshot({ path: info.outputPath("after19-selected-place-search.png") })
})

test("nation welcome has no ambience control, is finite and reduced-motion safe", async ({ page }) => {
  await seedB(page, { locale: "ja" })
  await page.emulateMedia({ reducedMotion: "no-preference" })
  await gotoB(page, "?review=0")
  const atlas = page.getByTestId("ondo-b-korea-atlas")
  await expect(atlas).toHaveAttribute("data-atlas-motion", "playing", { timeout: 40_000 })
  await expect(page.getByTestId("ondo-b-atlas-motion")).toHaveCount(0)
  const ripple = atlas.locator('[data-city="seoul"] i > b')
  expect(await ripple.evaluate(element => getComputedStyle(element).animationIterationCount)).toBe("1")
  await expect(atlas).toHaveAttribute("data-atlas-motion", "settled", { timeout: 5500 })
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.reload()
  await expect(atlas).toHaveAttribute("data-atlas-reduced-motion", "true")
  await expect(atlas).toHaveAttribute("data-atlas-motion", "paused")
  expect(await ripple.evaluate(element => getComputedStyle(element).animationName)).toBe("none")
})

test("dark After19 search settles on loaded street-level geometry", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await seedB(page, { locale: "ja" })
  await page.addInitScript(() => {
    const state = JSON.parse(localStorage.getItem("ondo-b.device.v1") ?? "{}")
    localStorage.setItem("ondo-b.device.v1", JSON.stringify({ ...state, appearancePreference: "dark" }))
  })
  await openCity(page)
  await page.getByTestId("ondo-b-map-options-open").click()
  await page.getByTestId("ondo-b-map-options-after19-open").click()
  await page.getByTestId("global-after19-confirm").click()
  await expect(page.getByTestId("global-after19-prompt-layer")).toHaveCount(0)
  await page.getByTestId("ondo-b-map-search-toggle").click()
  await page.getByTestId("ondo-b-search").fill("Roba")
  const map = page.getByTestId("maplibre-map")
  await expect.poll(async () => Number(await map.getAttribute("data-map-zoom")), { timeout: 15_000 }).toBeGreaterThanOrEqual(14)
  await expect.poll(async () => Number(await map.getAttribute("data-visible-building-relief-count")), { timeout: 15_000 }).toBeGreaterThan(0)
  await page.screenshot({ path: info.outputPath("dark-after19-search-settled.png") })
})
