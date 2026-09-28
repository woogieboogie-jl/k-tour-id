import { expect, test, type Page } from "@playwright/test"

test.setTimeout(90_000)

async function openMap(page: Page, baseURL: string, collection = "") {
  const origin = new URL(baseURL).origin
  const forbidden: string[] = []
  const errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url())
    const localRead = url.origin === origin && (!url.pathname.startsWith("/api/") || url.pathname.startsWith("/api/ondo/venues"))
    const passive = ["tiles.openfreemap.org", "fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname)
    if (!["GET", "HEAD"].includes(request.method()) || (!localRead && !passive)) {
      forbidden.push(`${request.method()} ${url.pathname}`)
      return route.abort("blockedbyclient")
    }
    return route.continue()
  })
  await page.addInitScript(() => {
    localStorage.setItem("ondo-b.device.v1", JSON.stringify({ locale: "en", onboarding: "ONB-COMPLETE", appearancePreference: "light" }))
  })
  await page.goto(`/?review=0&city=seoul${collection ? `&collection=${collection}` : ""}`, { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("ondo-b-root")).toHaveAttribute("data-hydrated", "true")
  await expect(page.getByTestId("maplibre-map")).toHaveAttribute("data-map-state", "ready", { timeout: 30_000 })
  return { forbidden, errors }
}

async function withinViewport(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
}

test("search survives a shortened viewport and refocus without overflow", async ({ page, baseURL }) => {
  const guard = await openMap(page, baseURL!)
  await page.getByTestId("ondo-b-map-search-toggle").click()
  const search = page.getByTestId("ondo-b-search")
  await search.fill("서울 カフェ")
  // Geometry simulation only. This does not claim to open an iOS software keyboard.
  await page.setViewportSize({ width: 390, height: 490 })
  await expect(search).toHaveValue("서울 カフェ")
  await expect(search).toBeVisible()
  await withinViewport(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await search.focus()
  await expect(search).toBeFocused()
  await search.fill("")
  await withinViewport(page)
  expect(guard).toEqual({ forbidden: [], errors: [] })
})

test("denied geolocation does not block discovery or invent a position", async ({ page, baseURL }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.geolocation, "getCurrentPosition", { configurable: true, value: (_ok: unknown, reject: PositionErrorCallback) => reject({ code: 1, message: "Permission denied", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }) })
  })
  const guard = await openMap(page, baseURL!)
  await page.getByTestId("ondo-b-map-options-open").click()
  await page.getByTestId("ondo-b-map-options-locate").click()
  const map = page.getByTestId("ondo-b-map-entry")
  await expect(map).toHaveAttribute("data-location-state", "denied")
  await expect(map).toHaveAttribute("data-user-location", "absent")
  await expect(page.getByTestId("ondo-b-location-announcement")).toBeAttached()
  await page.getByTestId("ondo-b-map-search-toggle").click()
  await page.getByTestId("ondo-b-search").fill("cafe")
  await expect(page.getByTestId("ondo-b-search")).toHaveValue("cafe")
  await withinViewport(page)
  expect(guard).toEqual({ forbidden: [], errors: [] })
})

test("offline story reading and original collection survive reconnect", async ({ page, context, baseURL }, testInfo) => {
  const guard = await openMap(page, baseURL!, "sesame")
  await page.getByTestId("map-discovery-read-toggle").click()
  const panel = page.getByTestId("map-discovery-results")
  await expect(panel).toHaveAttribute("data-reading", "true")
  await context.setOffline(true)
  await expect(page.getByTestId("ondo-b-map-entry")).toHaveAttribute("data-connectivity", "offline")
  await expect(page.getByTestId("map-discovery-story-body")).toBeVisible()
  await withinViewport(page)
  await page.screenshot({ path: testInfo.outputPath("offline-story.png") })
  await context.setOffline(false)
  await expect(page.getByTestId("ondo-b-map-entry")).toHaveAttribute("data-connectivity", "online")
  await expect(panel).toHaveAttribute("data-collection", "sesame")
  await expect(panel).toHaveAttribute("data-reading", "true")
  expect(guard).toEqual({ forbidden: [], errors: [] })
})
