import { expect, test, type Page } from "@playwright/test"
import { seedFreshOnboarding } from "../helpers/ondo-b-qa"

test.use({ serviceWorkers: "block" })
test.describe.configure({ timeout: 45_000 })
test.beforeEach(async ({ page, request, baseURL }) => {
  expect(new URL(baseURL!).hostname).toBe("127.0.0.1")
  expect(await (await request.get("/api/hackathon/v1/config")).json()).toMatchObject({ isolatedMock: true })
  await seedFreshOnboarding(page)
})
async function open(page: Page) {
  await page.goto("/?city=seoul", { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("ondo-b-map-entry")).toHaveAttribute("data-map-state", "ready", { timeout: 30_000 })
  await expect(page.getByTestId("map-temperature-spectrum")).toBeVisible()
}
async function hit(page: Page, id: string) {
  return page.getByTestId(id).evaluate(node => {
    const r = node.getBoundingClientRect()
    return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
  })
}
for (const size of [{ width: 320, height: 568 }, { width: 844, height: 390 }]) {
  test(`temperature remains operable with map chrome at ${size.width}×${size.height}`, async ({ page }, info) => {
    await page.setViewportSize(size)
    await open(page)
    expect(await hit(page, "map-temperature-spectrum")).toBe(true)
    if (size.width === 320) expect(await hit(page, "ondo-b-map-options-open")).toBe(true)
    for (const band of ["hot", "warm", "cool"]) expect(await hit(page, `map-temperature-${band}`)).toBe(true)
    await page.screenshot({ path: info.outputPath("temperature-open.png"), scale: "css" })
    await page.getByTestId("map-temperature-warm").click()
    await expect(page.getByTestId("map-discovery-results")).toHaveAttribute("data-result-count", "3")
    const card = page.locator('[data-discovery-card][data-selected="true"] button')
    await expect.poll(() => card.evaluate(node => {
      const r = node.getBoundingClientRect()
      return [r.top + 2, r.bottom - 2].every(y => node.contains(document.elementFromPoint(r.x + r.width / 2, y)))
    })).toBe(true)
    await page.screenshot({ path: info.outputPath("warm-first-card.png"), scale: "css" })
  })
}

test("touch thermometer commits only on release; touch cancel is inert", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await open(page)
  const hot = (await page.getByTestId("map-temperature-hot").boundingBox())!
  const cool = (await page.getByTestId("map-temperature-cool").boundingBox())!
  const cdp = await context.newCDPSession(page)
  const touch = (type: "touchStart" | "touchMove" | "touchEnd" | "touchCancel", x = hot.x + hot.width / 2) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" || type === "touchCancel" ? [] : [{ x, y: hot.y + hot.height / 2 }] })
  await touch("touchStart")
  await touch("touchMove", cool.x + cool.width / 2)
  await expect(page.getByTestId("ondo-b-map-entry")).toHaveAttribute("data-discovery-collection", "none")
  await touch("touchCancel")
  await expect(page.getByTestId("ondo-b-map-entry")).toHaveAttribute("data-discovery-collection", "none")
  await touch("touchStart")
  await touch("touchMove", cool.x + cool.width / 2)
  await touch("touchEnd")
  await expect(page.getByTestId("ondo-b-map-entry")).toHaveAttribute("data-discovery-collection", "cool")
  await expect(page.getByTestId("map-discovery-results")).toHaveAttribute("data-result-count", "3")
})

test("temperature intersects free text and reset does not erase that query", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await open(page)
  const search = page.getByTestId("ondo-b-search")
  await page.getByTestId("ondo-b-map-search-toggle").click()
  await search.fill("onion")
  await search.press("Enter")
  await page.getByTestId("map-temperature-hot").click()
  await page.getByTestId("ondo-b-map-search-toggle").click()
  await expect(search).toHaveValue("onion")
  await page.getByTestId("ondo-b-map-search-toggle").click()
  await expect(page.getByTestId("map-discovery-results")).toHaveAttribute("data-result-count", "1")
  await page.getByTestId("map-discovery-show-list").click()
  await expect(page.getByTestId("map-discovery-results")).toHaveAttribute("data-result-count", "1")
  await page.getByTestId("ondo-b-view-toggle").click()
  await page.getByTestId("map-temperature-cool").click()
  await expect(page.getByTestId("map-discovery-results")).toHaveAttribute("data-result-count", "0")
  await page.getByTestId("ondo-b-map-search-toggle").click()
  await expect(search).toHaveValue("onion")
  await page.getByTestId("map-temperature-reset").click()
  await expect(page.getByTestId("ondo-b-map-entry")).toHaveAttribute("data-discovery-collection", "none")
})

test("native touch swipe previews the next story and flies its map without opening it", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await open(page)
  const carousel = page.getByTestId("map-discovery-story-carousel")
  const rail = carousel.locator("[data-story-id]").first().locator("..")
  const box = (await rail.boundingBox())!
  const map = page.getByTestId("maplibre-map")
  const before = await map.getAttribute("data-map-center")
  expect(before).toBeTruthy()
  const cdp = await context.newCDPSession(page)
  const y = box.y + box.height / 2
  const start = box.x + box.width - 24
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: start, y }] })
  for (let i = 1; i <= 8; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: start - (box.width - 48) * i / 8, y }] })
    if (i === 3) {
      // A finger can pause longer than the snap debounce. Native pointercancel
      // on scroll-start must not be mistaken for this finger being released.
      await page.waitForTimeout(250)
      await expect(carousel.locator("[data-story-id][data-selected='true']")).toHaveAttribute("data-story-id", "sesame")
    }
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
  const selected = carousel.locator("[data-story-id][data-selected='true']")
  await expect(selected).not.toHaveAttribute("data-story-id", "sesame")
  await expect(page.getByTestId("map-discovery-results")).toHaveCount(0)
  await expect.poll(() => map.getAttribute("data-map-center")).not.toBe(before)
  const story = selected.getByTestId("map-discovery-story")
  if (test.info().project.name.includes("desktop")) await story.click()
  else await story.tap()
  await expect(page.getByTestId("map-discovery-results")).toBeVisible()
})
