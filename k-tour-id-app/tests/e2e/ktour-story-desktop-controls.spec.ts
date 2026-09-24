import { expect, test, type Page } from "@playwright/test"
import { seedFreshOnboarding } from "../helpers/ondo-b-qa"

test.describe.configure({ timeout: 60_000 })
test.use({ serviceWorkers: "block" })

const forbiddenRequests = new WeakMap<Page, string[]>()
const diagnostics = new WeakMap<Page, string[]>()
const passiveAssetHosts = new Set(["tiles.openfreemap.org", "fonts.googleapis.com", "fonts.gstatic.com"])

test.beforeEach(async ({ page, context, baseURL, request }) => {
  expect(baseURL, "Use an explicitly managed local server").toBeTruthy()
  const origin = new URL(baseURL!).origin
  const config = await request.get(`${origin}/api/hackathon/v1/config`)
  expect(config.ok()).toBe(true)
  expect(await config.json()).toMatchObject({ isolatedMock: true })
  forbiddenRequests.set(page, [])
  diagnostics.set(page, [])
  page.on("pageerror", error => diagnostics.get(page)?.push(error.message))
  await context.route("**/*", async route => {
    const request = route.request()
    const url = new URL(request.url())
    const local = url.origin === origin
    const readOnly = request.method() === "GET" || request.method() === "HEAD"
    const knownApi = /^\/api\/hackathon\/v1\/config$/.test(url.pathname) || /^\/api\/ondo\/venues(?:\/|$)/.test(url.pathname)
    const allowed = readOnly && (local
      ? !url.pathname.startsWith("/api/") || knownApi
      : passiveAssetHosts.has(url.hostname) && !request.isNavigationRequest())
    if (!allowed) {
      forbiddenRequests.get(page)?.push(`${request.method()} ${url.origin}${url.pathname}`)
      await route.abort("blockedbyclient")
      return
    }
    await route.continue()
  })
})

test.afterEach(async ({ page }) => {
  expect(diagnostics.get(page) ?? [], "No uncaught runtime exceptions").toEqual([])
  expect(forbiddenRequests.get(page) ?? [], "Desktop story discovery stays local/read-only").toEqual([])
})

async function openSeoul(page: Page, locale: "en" | "ko" | "ja" = "en") {
  await seedFreshOnboarding(page, locale)
  await page.goto("/", { waitUntil: "domcontentloaded" })
  const nation = page.getByTestId("ondo-b-nation")
  await expect(nation).toBeVisible()
  await nation.locator("[data-city='seoul']").click()
  const map = page.getByTestId("ondo-b-map-entry")
  await expect(map).toHaveAttribute("data-map-state", "ready", { timeout: 30_000 })
  await expect(page.getByTestId("map-discovery-story-carousel")).toBeVisible()
  return map
}

function selectedStory(page: Page) {
  return page.getByTestId("map-discovery-story-carousel").locator("[data-story-id][data-selected='true']")
}

test("desktop 1440: previous/next progress 1→2→3, settle preview without opening results, and disable at boundaries", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const map = await openSeoul(page)
  const previous = page.getByTestId("map-story-previous")
  const next = page.getByTestId("map-story-next")
  await expect(previous).toBeDisabled()
  await expect(next).toBeEnabled()
  await expect(page.getByTestId("map-discovery-story-carousel")).toContainText("1 / 3")
  await page.screenshot({ path: test.info().outputPath("story-controls-1440-initial.png"), scale: "css" })
  const before = await page.getByTestId("maplibre-map").getAttribute("data-map-center")
  await next.click()
  await expect(page.getByTestId("map-discovery-story-carousel")).toContainText("2 / 3")
  await expect(selectedStory(page)).toHaveAttribute("data-story-id", /.+/)
  await expect.poll(() => page.getByTestId("maplibre-map").getAttribute("data-map-center")).not.toBe(before)
  await expect(page.getByTestId("map-discovery-results")).toHaveCount(0)
  await next.click()
  await expect(page.getByTestId("map-discovery-story-carousel")).toContainText("3 / 3")
  await expect(next).toBeDisabled()
  await expect(previous).toBeEnabled()
  await previous.click()
  await expect(page.getByTestId("map-discovery-story-carousel")).toContainText("2 / 3")
  await expect(previous).toBeEnabled()
})

test("desktop 1280: clicking the selected full-card story opens exactly that collection", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  const map = await openSeoul(page)
  const next = page.getByTestId("map-story-next")
  await next.click()
  await expect(selectedStory(page)).toHaveAttribute("data-story-id", "seoul-cafes")
  const id = await selectedStory(page).getAttribute("data-story-id")
  expect(id).toBeTruthy()
  await selectedStory(page).getByTestId("map-discovery-story").click()
  await expect(map).toHaveAttribute("data-discovery-collection", id!)
  await expect(page.getByTestId("map-discovery-results")).toHaveAttribute("data-kind", "story")
})

test("desktop rapid Next→Previous before the settle window returns to story 1 without opening results", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await openSeoul(page)
  const next = page.getByTestId("map-story-next")
  const previous = page.getByTestId("map-story-previous")
  await next.click()
  await previous.click()
  await page.waitForTimeout(260)
  await expect(page.getByTestId("map-discovery-story-carousel")).toContainText("1 / 3")
  await expect(page.getByTestId("map-discovery-results")).toHaveCount(0)
})

test("desktop Next then focus/search before settle cancels the pending camera preview", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await openSeoul(page)
  const mapCanvas = page.getByTestId("maplibre-map")
  const before = await mapCanvas.getAttribute("data-map-center")
  // Issue both actions in one browser task so the focus cancellation is
  // unambiguously before the 180ms preview settle window; Locator.click can
  // otherwise yield through smooth-scroll/actionability work first.
  await page.evaluate(() => {
    const next = document.querySelector<HTMLButtonElement>("[data-testid='map-story-next']")
    const search = document.querySelector<HTMLInputElement>("[data-testid='ondo-b-search']")
    next?.click()
    search?.focus()
  })
  await expect(page.getByTestId("ondo-b-search")).toBeFocused()
  await page.waitForTimeout(260)
  await expect(mapCanvas).toHaveAttribute("data-map-center", before!)
  await expect(page.getByTestId("map-discovery-results")).toHaveCount(0)
})

test("390 mobile keeps desktop prev/next controls hidden and leaves native carousel ownership intact", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openSeoul(page)
  await expect(page.getByTestId("map-story-previous")).toBeHidden()
  await expect(page.getByTestId("map-story-next")).toBeHidden()
  await expect(page.getByTestId("map-discovery-story-carousel")).toBeVisible()
  await expect(page.getByTestId("map-discovery-story-carousel").locator("[data-story-id]")).toHaveCount(3)
})

test("JA narrow desktop keeps controls localized, hit targets operable, and text within the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 760 })
  await openSeoul(page, "ja")
  await page.screenshot({ path: test.info().outputPath("story-controls-1280-ja.png"), scale: "css" })
  const carousel = page.getByTestId("map-discovery-story-carousel")
  for (const control of [page.getByTestId("map-story-previous"), page.getByTestId("map-story-next")]) {
    await expect(control).toBeVisible()
    await expect(control).toHaveAttribute("aria-label", /前|次|Previous|Next/)
    await expect.poll(async () => (await control.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)
  }
  await expect(carousel).toContainText("ソウル")
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280)
})
