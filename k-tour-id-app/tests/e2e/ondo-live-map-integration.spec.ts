import { expect, test } from "@playwright/test"
import {
  CANONICAL_VENUE_ID,
  expectBRuntimeClean,
  gotoB,
  installBRuntimeGuard,
  prepareBPage,
  seedB,
} from "../helpers/ondo-b-qa"

test.describe.configure({ mode: "serial", timeout: 90_000 })

test.beforeEach(async ({ page }) => {
  installBRuntimeGuard(page)
  await page.route("**/*", async route => {
    if (!["GET", "HEAD", "OPTIONS"].includes(route.request().method())) {
      await route.abort("blockedbyclient")
      return
    }
    await route.continue()
  })
  await prepareBPage(page)
  await seedB(page)
})

test.afterEach(async ({ page }, info) => {
  await expectBRuntimeClean(page, info)
})

async function openCity(page: Parameters<typeof gotoB>[0], reducedMotion: "reduce" | "no-preference" = "no-preference") {
  await page.emulateMedia({ reducedMotion })
  await gotoB(page, "?city=seoul&review=0")
  await expect(page.getByTestId("maplibre-map")).toHaveAttribute("data-map-state", "ready", { timeout: 35_000 })
  await expect(page.getByTestId("ondo-b-map-entry")).toHaveAttribute("data-city", "seoul")
}

test("desktop place peek preserves navigation and details remains modal", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await gotoB(page, `?venueId=${CANONICAL_VENUE_ID}&review=0`)
  const peek = page.getByTestId("canonical-place-peek")
  await expect(peek).toBeVisible()
  await expect(peek).not.toHaveAttribute("aria-modal", "true")
  await expect(page.getByTestId("nav-settings")).toBeVisible()
  await page.getByTestId("nav-settings").click()
  await expect(page.getByTestId("nav-settings")).toHaveAttribute("aria-current", "page")
  await expect(page.getByTestId("ondo-b-settings-entry").getByRole("heading", { name: "Settings", exact: true })).toBeVisible()
  await page.getByTestId("nav-ondo").click()
  await expect(page.getByTestId("nav-ondo")).toHaveAttribute("aria-current", "page")
  await gotoB(page, `?venueId=${CANONICAL_VENUE_ID}&review=0`)
  await expect(page.getByTestId("canonical-place-peek")).toBeVisible()
  await peek.getByTestId("canonical-place-details").click()
  const detail = page.getByTestId("canonical-place-overlay")
  await expect(detail).toBeVisible()
  await expect(detail).toHaveAttribute("aria-modal", "true")
})

test("place peek stays nonmodal across desktop and mobile resize", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await gotoB(page, `?venueId=${CANONICAL_VENUE_ID}&review=0`)
  const peek = page.getByTestId("canonical-place-peek")
  await expect(peek).not.toHaveAttribute("aria-modal", "true")
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(peek).not.toHaveAttribute("aria-modal", "true")
  await page.setViewportSize({ width: 1440, height: 1000 })
  await expect(peek).not.toHaveAttribute("aria-modal", "true")
})

test("resizing a peek preserves focused map search without trapping it", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await gotoB(page, `?venueId=${CANONICAL_VENUE_ID}&review=0`)
  const peek = page.getByTestId("canonical-place-peek")
  const search = page.getByTestId("ondo-b-map-search-toggle")
  await search.focus()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(peek).not.toHaveAttribute("aria-modal", "true")
  await expect(search).toBeFocused()
  await search.press("Enter")
  await expect(page.getByTestId("ondo-b-search")).toBeFocused()
  await peek.focus()
  await page.keyboard.press("Escape")
  await expect(peek).toHaveCount(0)
})

test("review-zero map controls move the live map without sample authority", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await openCity(page)
  const map = page.getByTestId("maplibre-map")
  const entry = page.getByTestId("ondo-b-map-entry")
  await expect(entry).toHaveAttribute("data-review-session", "false")
  await expect(entry).toHaveAttribute("data-sample-temperature", "true")
  await expect(page.getByTestId("map-wallet-balance")).toHaveCount(0)
  const before = await map.getAttribute("data-map-zoom")
  await page.getByRole("button", { name: "Zoom in" }).click()
  await expect.poll(() => map.getAttribute("data-map-zoom")).not.toBe(before)
})

test("review-zero temperature timeline runs independently of sample authority", async ({ page }) => {
  await openCity(page, "no-preference")
  const timeline = page.getByTestId("ondo-temperature-timeline")
  await expect(timeline).toHaveAttribute("data-running", "true")
  await expect(timeline).toHaveAttribute("data-reduced-motion", "false")
  const before = await timeline.getAttribute("data-minute")
  await page.waitForTimeout(1_500)
  await expect.poll(() => timeline.getAttribute("data-minute")).not.toBe(before)
})

test("city entry camera animation remains live in review zero", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" })
  await gotoB(page, "?review=0")
  await expect(page.getByTestId("ondo-b-korea-atlas")).toBeVisible()
  await page.getByTestId("ondo-b-korea-atlas").locator("[data-city='busan']").click()
  const map = page.getByTestId("maplibre-map")
  await expect(map).toHaveAttribute("data-city-focus-target", "busan")
  await expect(map).toHaveAttribute("data-city-focus-duration", /^(?!0$)\d+(?:\.\d+)?$/)
  await expect(map).toHaveAttribute("data-city-focus-phase", "settled", { timeout: 10_000 })
  await expect(page.getByTestId("ondo-b-map-entry")).toHaveAttribute("data-entry-transition", "settled")
})

test("reduced motion keeps the review-zero timeline static", async ({ page }) => {
  await openCity(page, "reduce")
  const timeline = page.getByTestId("ondo-temperature-timeline")
  await expect(timeline).toHaveAttribute("data-reduced-motion", "true")
  await expect(timeline).toHaveAttribute("data-running", "false")
})
