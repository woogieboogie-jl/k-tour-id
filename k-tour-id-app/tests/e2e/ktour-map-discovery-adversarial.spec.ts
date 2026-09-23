import { expect, test, type Page } from "@playwright/test"
import { seedFreshOnboarding } from "../helpers/ondo-b-qa"

async function openScope(page: Page, city = "seoul", collection = "hot") {
  await seedFreshOnboarding(page)
  await page.goto(`/?city=${city}&collection=${collection}`, { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("map-discovery-results")).toBeVisible()
  await expect(page.getByTestId("ondo-b-map-entry")).toHaveAttribute("data-map-state", "ready", { timeout: 30_000 })
}

test("keyboard Tab reaches the mood suggestions without dismissing them", async ({ page }) => {
  await seedFreshOnboarding(page)
  await page.goto("/?city=seoul", { waitUntil: "domcontentloaded" })
  await page.getByTestId("ondo-b-search").focus()
  const hot = page.getByTestId("map-discovery-mood-hot")
  await expect(hot).toBeVisible()
  for (let step = 0; step < 5 && !await hot.evaluate(node => node === document.activeElement); step++) await page.keyboard.press("Tab")
  await expect(hot).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(page.getByTestId("map-discovery-results")).toHaveAttribute("data-result-count", "3")
})

test("existing City guides lead to the same story collection on the same map", async ({ page }) => {
  await seedFreshOnboarding(page)
  await page.goto("/?city=seoul", { waitUntil: "domcontentloaded" })
  await page.getByTestId("ondo-b-map-options-open").click()
  await page.getByTestId("ondo-b-map-options").getByRole("button", { name: "City guides" }).click()
  await page.getByTestId("ondo-b-story-collection-C01").click()
  await expect(page.getByTestId("map-discovery-results")).toHaveAttribute("data-collection", "sesame")
  await expect(page.getByTestId("map-discovery-results")).toHaveAttribute("data-result-count", "1")
  expect(new URL(page.url()).pathname).toBe("/")
})

test("Jeju scene uses the existing editorial peek/detail and returns to the same collection", async ({ page }) => {
  await openScope(page, "jeju", "screen")
  await expect(page.getByTestId("map-discovery-results")).toHaveAttribute("data-result-count", "2")
  await page.locator("[data-discovery-place-opener='jeju-seongsan-ilchulbong']").click()
  await expect(page.getByTestId("ondo-b-editorial-place-peek")).toBeVisible()
  await page.getByTestId("ondo-b-editorial-place-details").click()
  await expect(page.getByTestId("ondo-b-editorial-place-overlay")).toBeVisible()
  await page.goBack()
  await expect(page.getByTestId("ondo-b-editorial-place-peek")).toBeVisible()
  await page.goBack()
  await expect(page.getByTestId("map-discovery-results")).toBeVisible()
  await expect(page.getByTestId("ondo-b-map-entry")).toHaveAttribute("data-discovery-collection", "screen")
  await expect(page.locator("[data-discovery-place-opener='jeju-seongsan-ilchulbong']")).toBeFocused()
})

test("native traversal restores a panned collection camera without opening search suggestions", async ({ page }) => {
  await openScope(page)
  const pin = page.locator("[data-discovery-pin='research-seoul-onion-anguk']")
  await expect(pin).toBeVisible()
  await page.mouse.move(200, 300)
  await page.mouse.down()
  await page.mouse.move(235, 340, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(600)
  const before = await pin.boundingBox()
  await page.locator("[data-discovery-place-opener='research-seoul-onion-anguk']").click()
  await expect(page.getByTestId("researched-food-detail")).toBeVisible()
  await page.goBack()
  await expect(page.getByTestId("map-discovery-results")).toBeVisible()
  await expect(page.getByTestId("map-discovery-mood-hot")).toHaveCount(0)
  await expect.poll(async () => {
    const after = await pin.boundingBox()
    return before && after ? Math.hypot(before.x - after.x, before.y - after.y) : 999
  }).toBeLessThan(2)
})

for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }]) {
  test(`all three recommendation pins and a card are operable at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await openScope(page)
    await expect(page.locator("[data-discovery-pin]")).toHaveCount(3)
    await expect.poll(() => page.locator("[data-discovery-pin]").evaluateAll(nodes => nodes.every(node => {
      const rect = node.getBoundingClientRect()
      const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2
      return x > 0 && x < innerWidth && y > 0 && y < innerHeight && node.contains(document.elementFromPoint(x, y))
    }))).toBe(true)
    await page.locator("[data-discovery-place-opener]").first().click({ timeout: 10_000 })
    await expect(page.getByTestId("researched-food-detail")).toBeVisible()
  })
}
