import { expect, test, type Page } from "@playwright/test"
import { createHash } from "node:crypto"
import { expectBRoot, seedFreshOnboarding } from "../helpers/ondo-b-qa"

test.describe.configure({ timeout: 90_000 })

const networkViolations = new WeakMap<Page, string[]>()
const pageErrors = new WeakMap<Page, string[]>()
test.beforeEach(async ({ page }) => {
  const violations: string[] = []
  const errors: string[] = []
  networkViolations.set(page, violations)
  pageErrors.set(page, errors)
  page.on("pageerror", error => errors.push(error.message))
  const baseOrigin = new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3112").origin
  await page.route("**/*", async route => {
    const request = route.request()
    const url = new URL(request.url())
    const passive = url.hostname === "tiles.openfreemap.org" || url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com"
    const sameOriginApi = url.origin === baseOrigin && url.pathname.startsWith("/api/")
    const allowedApi = url.pathname === "/api/ondo/venues" || url.pathname === "/api/hackathon/v1/config"
    if (!(["GET", "HEAD"].includes(request.method())) || (!passive && url.origin !== baseOrigin) || (sameOriginApi && !allowedApi)) {
      violations.push(`${request.method()} ${url.origin}${url.pathname}`)
      await route.abort("blockedbyclient")
      return
    }
    await route.continue()
  })
})
test.afterEach(({ page }) => {
  expect(networkViolations.get(page) ?? []).toEqual([])
  expect(pageErrors.get(page) ?? []).toEqual([])
})

const stories = {
  seoul: ["sesame"],
  busan: ["busan-market", "busan-coffee", "busan-table"],
  jeju: ["jeju-table"],
} as const

async function openNation(page: Page, locale: "en" | "ko" | "ja", reducedMotion: boolean) {
  await seedFreshOnboarding(page, locale)
  await page.emulateMedia({ reducedMotion: reducedMotion ? "reduce" : "no-preference" })
  await page.goto("/", { waitUntil: "domcontentloaded" })
  await expectBRoot(page, locale)
  await expect(page.getByTestId("ondo-b-nation")).toBeVisible()
  await expect(page.getByTestId("maplibre-map")).toHaveAttribute("data-map-state", "ready", { timeout: 35_000 })
}

async function enterCity(page: Page, city: keyof typeof stories) {
  await page.getByTestId("ondo-b-korea-atlas").locator(`[data-city="${city}"]`).click()
  await expect(page.getByTestId("ondo-b-map-entry")).toHaveAttribute("data-city", city)
  await expect(page.getByTestId("maplibre-map")).toHaveAttribute("data-map-state", "ready", { timeout: 35_000 })
  await expect(page.getByTestId("maplibre-map")).toHaveAttribute("data-city-focus-phase", "settled", { timeout: 8_000 })
  await expect(page.getByTestId("map-discovery-story-carousel")).toBeVisible()
}

async function mapFrameHash(page: Page) {
  const image = await page.getByTestId("maplibre-map").locator("canvas.maplibregl-canvas").screenshot()
  return createHash("sha256").update(image).digest("hex")
}

async function historyCamera(page: Page) {
  return page.evaluate(() => {
    const state = history.state as { __ondoBDiscovery?: { camera?: { latitude: number; longitude: number; zoom: number } } } | null
    const camera = state?.__ondoBDiscovery?.camera
    return camera ? [camera.latitude, camera.longitude, camera.zoom] : null
  })
}

async function openStoryAndReturn(page: Page, id: string) {
  const carousel = page.getByTestId("map-discovery-story-carousel")
  const card = carousel.locator(`[data-testid="map-discovery-story"][data-collection="${id}"]`)
  const first = carousel.locator("[data-testid='map-discovery-story']").first()
  await first.focus()
  const actualIndex = await carousel.locator("[data-testid='map-discovery-story']").evaluateAll((nodes, target) => {
    return nodes.findIndex(node => node.getAttribute("data-collection") === target)
  }, id)
  expect(actualIndex, `carousel index for ${id}`).toBeGreaterThanOrEqual(0)
  for (let step = 0; step < actualIndex; step += 1) {
    await page.keyboard.press("ArrowRight")
  }
  await card.scrollIntoViewIfNeeded()
  await expect(card.locator("xpath=ancestor::article[1]")).toHaveAttribute("data-selected", "true")
  await card.click()

  const results = page.getByTestId("map-discovery-results")
  await expect(results).toBeVisible()
  await expect(results).toHaveAttribute("data-collection", id)
  await expect(results).toHaveAttribute("data-result-count", /[1-9]/)
  await page.getByTestId("map-discovery-read-toggle").click()
  await expect(page.getByTestId("map-discovery-story-body")).toBeVisible()
  const place = results.locator("[data-discovery-place-opener]").first()
  await expect(place).toBeVisible()
  await place.click()
  const detail = page.locator("[data-testid='map-discovery-market-detail']:visible, [data-testid='canonical-place-overlay']:visible, [data-testid='researched-food-detail']:visible")
  await expect(detail).toBeVisible()
  const onMap = page.locator("[data-testid='map-discovery-market-on-map']:visible")
  if (await onMap.count()) {
    await onMap.click()
  } else {
    await page.keyboard.press("Escape")
  }
  await expect(results).toBeVisible()
  await page.getByTestId("map-discovery-close").click()
  await expect(page.getByTestId("map-discovery-dock")).toBeVisible()
}

for (const locale of ["en", "ja"] as const) {
  for (const city of ["seoul", "busan", "jeju"] as const) {
    test(`${locale} ${city} regional stories remain reachable through list and back`, async ({ page }) => {
      await openNation(page, locale, true)
      await enterCity(page, city)
      const carousel = page.getByTestId("map-discovery-story-carousel")
      for (const id of stories[city]) {
        await expect(carousel.locator(`[data-testid="map-discovery-story"][data-collection="${id}"]`), `${city} story ${id}`).toBeVisible()
      }

      const first = carousel.locator("[data-testid='map-discovery-story']").first()
      await first.click()
      const results = page.getByTestId("map-discovery-results")
      await expect(results).toBeVisible()
      await expect(results).toHaveAttribute("data-result-count", /[1-9]/)
      // Story map→list remains the shared B view toggle. The mood-specific
      // `map-discovery-show-list` control is intentionally not expected here.
      await page.getByTestId("ondo-b-view-toggle").click()
      await expect(page.getByTestId("ondo-b-map-entry")).toHaveAttribute("data-effective-view", "list")
      await expect(page.getByTestId("ondo-b-list-panel")).toBeVisible()

      await page.getByTestId("ondo-b-view-toggle").click()
      await expect(page.getByTestId("ondo-b-map-entry")).toHaveAttribute("data-effective-view", "map")
      await page.getByTestId("map-discovery-close").click()
      await expect(page.getByTestId("map-discovery-dock")).toBeVisible()
      await page.getByTestId("ondo-b-city-back").click()
      await expect(page.getByTestId("ondo-b-nation")).toBeVisible()
      await expect(page).toHaveURL(/(?:\?|&)view=map|\/$/)
    })
  }
}

test("city entry motion is present only with normal motion preference", async ({ page }) => {
  await openNation(page, "en", false)
  const before = await mapFrameHash(page)
  const city = page.getByTestId("ondo-b-korea-atlas").locator("[data-city='busan']")
  await city.click()
  const map = page.getByTestId("maplibre-map")
  await expect(map).toHaveAttribute("data-city-focus-duration", /^(?!0$)\d+(?:\.\d+)?$/)
  await expect(map).toHaveAttribute("data-city-focus-phase", "settled", { timeout: 8_000 })
  await expect(page.getByTestId("ondo-b-map-entry")).toHaveAttribute("data-entry-transition", "settled")
  await expect.poll(() => mapFrameHash(page)).not.toBe(before)
})

test("reduced motion settles city entry without a camera animation", async ({ page }) => {
  await openNation(page, "en", true)
  const before = await mapFrameHash(page)
  await page.getByTestId("ondo-b-korea-atlas").locator("[data-city='busan']").click()
  const map = page.getByTestId("maplibre-map")
  await expect(map).toHaveAttribute("data-city-focus-duration", "0")
  await expect(map).toHaveAttribute("data-city-focus-phase", "settled", { timeout: 8_000 })
  await expect(page.getByTestId("ondo-b-map-entry")).toHaveAttribute("data-entry-transition", "settled")
  await expect.poll(() => mapFrameHash(page)).not.toBe(before)
})

test("all regional story cards open, read, detail, and return", async ({ page }) => {
  await openNation(page, "en", true)
  for (const city of ["busan", "jeju"] as const) {
    await enterCity(page, city)

    for (const [index, id] of stories[city].entries()) {
      const beforeStory = await historyCamera(page)
      await openStoryAndReturn(page, id)
      if (index === 0) {
        const afterStory = await historyCamera(page)
        expect(afterStory, `${city} camera history snapshot`).not.toEqual(beforeStory)
      }
      if (index < stories[city].length - 1) {
        await page.getByTestId("ondo-b-city-back").click()
        await expect(page.getByTestId("ondo-b-nation")).toBeVisible()
        await enterCity(page, city)
      }
    }
    await page.getByTestId("ondo-b-city-back").click()
    await expect(page.getByTestId("ondo-b-nation")).toBeVisible()
  }
})
