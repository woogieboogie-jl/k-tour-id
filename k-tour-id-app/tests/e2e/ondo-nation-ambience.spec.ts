import { expect, test } from "@playwright/test"
import { expectBRuntimeClean, installBRuntimeGuard } from "../helpers/ondo-b-qa"

test.beforeEach(({ page }) => installBRuntimeGuard(page))
test.afterEach(async ({ page }, testInfo) => { await expectBRuntimeClean(page, testInfo) })

test("nation welcome settles without shifting city controls and honors reduced motion", async ({ page }) => {
  test.setTimeout(45_000)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: "no-preference", colorScheme: "light" })
  await page.addInitScript(() => localStorage.setItem("ondo-b.device.v1", JSON.stringify({ locale: "en", onboarding: "ONB-COMPLETE" })))
  await page.goto("/", { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("maplibre-map")).toHaveAttribute("data-map-projection-settled", "true", { timeout: 20_000 })
  const atlas = page.getByTestId("ondo-b-korea-atlas")
  const motion = page.getByTestId("ondo-b-atlas-motion")
  const city = atlas.locator("button[data-city='seoul']")
  await expect(atlas).toHaveAttribute("data-atlas-motion", "playing")
  await expect(motion).toHaveCount(0)
  const anchorBefore = await city.boundingBox()
  const halo = city.locator("i")
  expect(await halo.evaluate(node => getComputedStyle(node, "::before").animationIterationCount)).toBe("1")
  expect(await halo.evaluate(node => getComputedStyle(node, "::before").animationPlayState)).toBe("running")

  await expect(atlas).toHaveAttribute("data-atlas-motion", "settled", { timeout: 5500 })
  expect(await halo.evaluate(node => getComputedStyle(node, "::before").animationName)).toBe("none")
  expect(await city.boundingBox()).toEqual(anchorBefore)

  await page.getByTestId("nav-settings").click()
  await expect(atlas).toHaveAttribute("data-atlas-motion", "settled")
  await page.getByTestId("nav-ondo").click()
  await expect(atlas).toHaveAttribute("data-atlas-motion", "settled")

  await page.emulateMedia({ reducedMotion: "reduce" })
  await expect(atlas).toHaveAttribute("data-atlas-reduced-motion", "true")
  await expect(atlas).toHaveAttribute("data-atlas-motion", "settled")
  await expect(motion).toHaveCount(0)
  expect(await halo.evaluate(node => getComputedStyle(node, "::before").animationName)).toBe("none")
  await city.focus()
  await expect(city).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(page.getByTestId("ondo-b-city-back")).toBeVisible()
})
