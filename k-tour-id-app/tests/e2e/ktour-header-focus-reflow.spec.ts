import { expect, test, type Page } from "@playwright/test"
import { seedFreshOnboarding } from "../helpers/ondo-b-qa"

test.use({ serviceWorkers: "block" })
test.describe.configure({ timeout: 60_000 })
test.beforeEach(async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin
  const config = await page.request.get(`${origin}/api/hackathon/v1/config`)
  expect(await config.json()).toMatchObject({ isolatedMock: true })
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url())
    const passive = ["tiles.openfreemap.org", "fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname)
    const localRead = url.origin === origin && (!url.pathname.startsWith("/api/") || url.pathname === "/api/hackathon/v1/config" || url.pathname.startsWith("/api/ondo/venues/"))
    if (!["GET", "HEAD"].includes(request.method()) || !(passive || localRead)) {
      await route.abort("blockedbyclient")
      throw new Error(`Unexpected request: ${request.method()} ${url.pathname}`)
    }
    await route.continue()
  })
})

async function openCity(page: Page, locale: "ko" | "en" | "ja" = "ko") {
  await seedFreshOnboarding(page, locale)
  await page.goto("/?city=seoul")
  await expect(page.getByTestId("ondo-b-map-entry")).toHaveAttribute("data-map-state", "ready", { timeout: 30_000 })
  await expect(page.getByTestId("map-temperature-hot")).toBeVisible()
}

test("search clear, mood command and short-screen remount keep keyboard ownership", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openCity(page)
  await page.getByTestId("ondo-b-map-search-toggle").click()
  const input = page.getByTestId("ondo-b-search")
  await input.fill("tea")
  await page.getByTestId("ondo-b-map-search-clear").click()
  await expect(input).toBeFocused()
  await input.fill("hot")
  await input.press("Enter")
  const hot = page.getByTestId("map-temperature-hot")
  await expect(hot).toBeFocused()
  await hot.press("Home")
  await expect(page.getByTestId("map-temperature-cool")).toHaveAttribute("aria-checked", "true")
  await page.getByTestId("map-temperature-cool").press("End")
  await expect(hot).toHaveAttribute("aria-checked", "true")
  await page.getByTestId("ondo-b-map-search-toggle").click()
  await input.fill("tea")
  for (const height of [300, 844]) {
    await page.setViewportSize({ width: 390, height })
    await expect(page.getByTestId("ondo-b-map-entry")).toHaveAttribute("data-layout-mode", height === 300 ? "ultra-short" : "compact-map")
    await expect(input).toHaveValue("tea")
    await expect(input).toBeFocused()
  }
  const header = await page.getByTestId("ondo-b-city-header").boundingBox()
  const field = await page.getByTestId("ondo-b-search-shell").boundingBox()
  expect(header!.y + header!.height).toBeGreaterThanOrEqual(field!.y + field!.height - 1)
  await input.press("Escape")
  await expect(page.getByTestId("ondo-b-map-search-toggle")).toBeFocused()
})

test("city picker uses canonical city state and never fills unsupported moods from Seoul", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openCity(page)
  await page.getByTestId("ondo-b-city-picker").click()
  await page.locator('[data-city-choice="jeju"]').click()
  await expect(page.getByTestId("ondo-b-map-entry")).toHaveAttribute("data-city", "jeju")
  await page.getByTestId("map-temperature-hot").click()
  await expect(page.getByTestId("map-discovery-empty")).toHaveAttribute("data-reason", "city")
  await expect(page.getByTestId("map-discovery-results")).toHaveAttribute("data-result-count", "0")
  await page.getByTestId("map-temperature-reset").click()
  await expect(page.getByTestId("ondo-b-map-entry")).toHaveAttribute("data-city", "jeju")
})

for (const locale of ["ko", "en", "ja"] as const) test(`${locale} dark small-screen header retains 44px targets and measured search bounds`, async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await seedFreshOnboarding(page, locale)
  await page.addInitScript(() => {
    const stored = JSON.parse(localStorage.getItem("ondo-b.device.v1") ?? "{}")
    localStorage.setItem("ondo-b.device.v1", JSON.stringify({ ...stored, appearancePreference: "dark" }))
  })
  await page.goto("/?city=seoul")
  await expect(page.getByTestId("map-temperature-hot")).toBeVisible()
  await expect(page.locator("html")).toHaveAttribute("data-ondo-theme", "dark")
  for (const id of ["ondo-b-city-back", "ondo-b-map-options-open", "ondo-b-map-search-toggle", "map-temperature-cool", "map-temperature-warm", "map-temperature-hot"]) {
    const target = page.getByTestId(id)
    const box = await target.boundingBox()
    expect(box!.width).toBeGreaterThanOrEqual(44)
    expect(box!.height).toBeGreaterThanOrEqual(44)
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(320)
    expect(await target.evaluate(element => {
      const rect = element.getBoundingClientRect()
      return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
    })).toBe(true)
  }
  await page.getByTestId("ondo-b-map-search-toggle").click()
  await expect(page.getByTestId("ondo-b-search")).toBeFocused()
  expect(await page.getByTestId("ondo-b-search").evaluate(element => getComputedStyle(element).outlineStyle)).toBe("none")
  await page.screenshot({ path: info.outputPath(`header-${locale}-320-dark-search.png`) })
})
