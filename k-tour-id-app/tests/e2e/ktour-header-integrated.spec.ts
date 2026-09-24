import { expect, test, type Page } from "@playwright/test"
import { seedFreshOnboarding } from "../helpers/ondo-b-qa"

test.describe.configure({ timeout: 60_000 })
test.use({ serviceWorkers: "block" })

async function openSeoul(page: Page, baseURL: string) {
  const origin = new URL(baseURL).origin
  const config = await page.request.get(`${origin}/api/hackathon/v1/config`)
  expect(config.ok()).toBe(true)
  expect(await config.json()).toMatchObject({ isolatedMock: true })
  const forbidden: string[] = []
  await page.route("**/*", async route => {
    const request = route.request()
    const url = new URL(request.url())
    const local = url.origin === origin
    const config = url.pathname === "/api/hackathon/v1/config"
    const venueRead = /^\/api\/ondo\/venues(?:\/|$)/.test(url.pathname)
    const passive = ["tiles.openfreemap.org", "fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname)
    const allowed = ["GET", "HEAD"].includes(request.method()) && (local ? !url.pathname.startsWith("/api/") || config || venueRead : passive)
    if (!allowed) {
      forbidden.push(`${request.method()} ${url.origin}${url.pathname}`)
      await route.abort("blockedbyclient")
      return
    }
    await route.continue()
  })
  await seedFreshOnboarding(page)
  await page.goto("/?city=seoul", { waitUntil: "domcontentloaded" })
  const map = page.getByTestId("ondo-b-map-entry")
  await expect(map).toHaveAttribute("data-map-state", "ready", { timeout: 30_000 })
  await expect(page.getByTestId("map-temperature-spectrum")).toBeVisible()
  return { map, forbidden }
}

async function openSearch(page: Page) {
  const input = page.getByTestId("ondo-b-search")
  if (!(await input.isVisible())) await page.getByTestId("ondo-b-map-search-toggle").click()
  await expect(input).toBeVisible()
  return input
}

test("production header preserves query and mood in both selection orders", async ({ page, baseURL }) => {
  const { map, forbidden } = await openSeoul(page, baseURL!)
  const input = await openSearch(page)
  await input.fill("onion")
  await input.press("Enter")
  await page.getByTestId("map-temperature-hot").click()
  await expect(map).toHaveAttribute("data-discovery-collection", "hot")
  await expect(await openSearch(page)).toHaveValue("onion")

  await page.getByTestId("map-temperature-reset").click()
  await expect(await openSearch(page)).toHaveValue("onion")
  await page.getByTestId("ondo-b-map-search-toggle").click()
  await page.getByTestId("map-temperature-cool").click()
  const moodFirst = await openSearch(page)
  await moodFirst.fill("onion")
  await moodFirst.press("Enter")
  await expect(map).toHaveAttribute("data-discovery-collection", "cool")
  await expect(await openSearch(page)).toHaveValue("onion")
  expect(forbidden).toEqual([])
})

test("production header remains operable inside short and wide map shells", async ({ page, baseURL }) => {
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 600, height: 800 }, { width: 900, height: 390 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport)
    const { forbidden } = await openSeoul(page, baseURL!)
    const spectrum = page.getByTestId("map-temperature-spectrum")
    const spectrumBox = await spectrum.boundingBox()
    expect(spectrumBox).toBeTruthy()
    expect(spectrumBox!.x).toBeGreaterThanOrEqual(0)
    expect(spectrumBox!.x + spectrumBox!.width).toBeLessThanOrEqual(viewport.width + 1)
    for (const band of ["cool", "warm", "hot"]) {
      const control = page.getByTestId(`map-temperature-${band}`)
      await expect(control).toBeVisible()
      const box = await control.boundingBox()
      expect(box).toBeTruthy()
      expect(box!.width).toBeGreaterThanOrEqual(44)
      expect(box!.height).toBeGreaterThanOrEqual(44)
    }
    await expect(page.getByTestId("map-temperature-reset")).toBeVisible()
    await expect(page.getByTestId("ondo-b-map-search-toggle")).toBeVisible()
    expect(forbidden).toEqual([])
  }
})

test("map header wallet opens the shared balance surface and returns to the map", async ({ page, baseURL }) => {
  const { map, forbidden } = await openSeoul(page, baseURL!)
  const wallet = page.getByTestId("map-wallet-balance")
  await expect(wallet).toBeVisible()
  const beforeCity = await map.getAttribute("data-city")
  await wallet.click()
  await expect(page.getByTestId("wallet-link-open")).toBeVisible()
  await page.getByTestId("nav-ondo").click()
  await expect(map).toBeVisible()
  await expect(map).toHaveAttribute("data-city", beforeCity ?? "seoul")
  expect(forbidden).toEqual([])
})
