import { expect, test, type Locator, type Page } from "@playwright/test"
import { gotoB, prepareBPage, seedB } from "../helpers/ondo-b-qa"

// Real canonical Hongchao from the reported screenshot; no auth, identity,
// operation, or review-service state is seeded by this geometry regression.
const HONGCHAO = "mois-003cb1bed588108df9a5"
const errors = new WeakMap<Page, string[]>()
const writes = new WeakMap<Page, string[]>()
test.describe.configure({ timeout: 90_000 })
test.use({ video: "off" })

test.beforeEach(async ({ page, request, baseURL }) => {
  expect(new URL(baseURL!).hostname).toBe("127.0.0.1")
  const config = await request.get("/api/hackathon/v1/config")
  expect(config.status()).toBe(200)
  expect(await config.json()).toMatchObject({ isolatedMock: true })
  errors.set(page, [])
  writes.set(page, [])
  page.on("pageerror", error => errors.get(page)!.push(error.message))
  await page.route("**/*", async route => {
    if (!["GET", "HEAD", "OPTIONS"].includes(route.request().method())) {
      writes.get(page)!.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`)
      await route.abort("blockedbyclient")
      return
    }
    await route.continue()
  })
  await prepareBPage(page)
})

test.afterEach(async ({ page }) => {
  expect(errors.get(page)).toEqual([])
  expect(writes.get(page)).toEqual([])
})

async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all(document.getAnimations().filter(animation => {
      const duration = animation.effect?.getComputedTiming().endTime
      return typeof duration === "number" && Number.isFinite(duration)
    }).map(animation => animation.finished.catch(() => undefined)))
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  })
}

async function expectHitTarget(target: Locator) {
  await expect(target).toBeVisible()
  expect(await target.evaluate(element => {
    const box = element.getBoundingClientRect()
    return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))
  })).toBe(true)
}

const scenarios = [
  { width: 1024, height: 768, mobile: false, centered: true },
  { width: 1440, height: 1000, mobile: false, centered: true },
  { width: 1920, height: 1080, mobile: false, centered: true },
  { width: 1440, height: 520, mobile: false, centered: true },
  { width: 1024, height: 501, mobile: false, centered: true },
  { width: 1440, height: 480, mobile: false, centered: false },
  { width: 390, height: 844, mobile: true, centered: true },
  { width: 320, height: 700, mobile: true, centered: true },
]

for (const scenario of scenarios) for (const theme of ["light", "dark"] as const) {
  test(`canonical peek ${scenario.width}x${scenario.height} ${theme} keeps its map-aligned layout and search`, async ({ page, isMobile }, info) => {
    test.skip(isMobile !== scenario.mobile, "Use actual mobile context only for mobile cases")
    await page.setViewportSize({ width: scenario.width, height: scenario.height })
    await seedB(page, { locale: "ja", local: { appearancePreference: theme } })
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "no-preference" })
    await gotoB(page, `?venueId=${HONGCHAO}&review=0`)
    const peek = page.getByTestId("canonical-place-peek")
    const map = page.getByTestId("ondo-b-map-entry")
    const header = page.getByTestId("ondo-b-city-header")
    await expect(peek).toHaveAttribute("data-venue-id", HONGCHAO)
    await expect(map).toHaveAttribute("data-map-state", "ready", { timeout: 40_000 })
    await settle(page)
    const [peekBox, mapBox, headerBox] = await Promise.all([peek.boundingBox(), map.boundingBox(), header.boundingBox()])
    expect(peekBox).not.toBeNull()
    expect(mapBox).not.toBeNull()
    expect(headerBox).not.toBeNull()
    if (scenario.centered) {
      // Compare to the map, not the browser/canvas (which includes a PC rail).
      expect(Math.abs(peekBox!.x + peekBox!.width / 2 - (mapBox!.x + mapBox!.width / 2))).toBeLessThan(2)
      expect(peekBox!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height)
      if (!scenario.mobile) expect(peekBox!.width).toBe(460)
      if (mapBox!.width >= 900 && mapBox!.height >= 501) expect(Math.abs(peekBox!.x + peekBox!.width / 2 - (headerBox!.x + headerBox!.width / 2))).toBeLessThan(2)
    } else {
      // Low landscape: the right lane deliberately leaves search on the left.
      expect(peekBox!.x).toBeGreaterThan(headerBox!.x + headerBox!.width)
      expect(peekBox!.width).toBeLessThanOrEqual(408)
    }
    expect(peekBox!.x).toBeGreaterThanOrEqual(mapBox!.x)
    expect(peekBox!.x + peekBox!.width).toBeLessThanOrEqual(mapBox!.x + mapBox!.width)
    expect(peekBox!.y).toBeGreaterThanOrEqual(0)
    expect(peekBox!.y + peekBox!.height).toBeLessThanOrEqual(scenario.height)
    await expectHitTarget(page.getByTestId("canonical-place-details"))
    await expectHitTarget(page.getByTestId("canonical-venue-directions"))
    await expectHitTarget(page.getByTestId("ondo-b-map-search-toggle"))
    if (!scenario.mobile && scenario.centered) {
      const visiblePin = () => page.getByTestId("maplibre-map").evaluate(element => {
        const x = Number((element as HTMLElement).dataset.peekSelectedPinX)
        const y = Number((element as HTMLElement).dataset.peekSelectedPinY)
        const peek = document.querySelector('[data-testid="canonical-place-peek"]')!.getBoundingClientRect()
        const map = element.getBoundingClientRect()
        return Number.isFinite(x) && Number.isFinite(y) && x >= map.left + 64 && x <= map.right - 64 && y >= map.top + 40 && y <= map.bottom - 64
          && (y + 64 <= peek.top || x + 64 <= peek.left || x - 64 >= peek.right)
      })
      await expect.poll(visiblePin).toBe(true)
    }
    await info.attach("geometry", { body: JSON.stringify({ scenario, theme, peek: peekBox, map: mapBox, header: headerBox }, null, 2), contentType: "application/json" })
    await page.screenshot({ path: info.outputPath(`peek-${scenario.width}x${scenario.height}-${theme}.png`) })

    if (scenario.width === 1440 && scenario.height === 1000 && theme === "light") {
      const camera = page.getByTestId("maplibre-map")
      const readCamera = () => camera.evaluate(element => ({
        x: Number((element as HTMLElement).dataset.peekSelectedPinX),
        y: Number((element as HTMLElement).dataset.peekSelectedPinY),
        zoom: (element as HTMLElement).dataset.mapZoom,
        pitch: (element as HTMLElement).dataset.mapPitch,
      }))
      const before = await readCamera()
      await page.mouse.move(mapBox!.x + 80, mapBox!.y + 220)
      await page.mouse.down()
      await page.mouse.move(mapBox!.x + 120, mapBox!.y + 270, { steps: 12 })
      await page.mouse.up()
      await expect.poll(async () => Math.hypot((await readCamera()).x - before.x, (await readCamera()).y - before.y)).toBeGreaterThan(10)
      const panned = await readCamera()
      expect(panned.zoom).toBe(before.zoom)
      expect(panned.pitch).toBe(before.pitch)
      await page.getByTestId("ondo-b-map-search-toggle").click()
      await expect(page.getByTestId("ondo-b-search")).toBeFocused()
      await page.getByTestId("ondo-b-map-search-close").click()
      await settle(page)
      const restored = await readCamera()
      expect(Math.hypot(restored.x - panned.x, restored.y - panned.y)).toBeLessThan(2)
      expect(restored.zoom).toBe(panned.zoom)
      expect(restored.pitch).toBe(panned.pitch)
    }

    await page.getByTestId("ondo-b-map-search-toggle").click()
    const search = page.getByTestId("ondo-b-search")
    await expect(search).toBeFocused()
    await search.fill("홍차오")
    await expect(search).toHaveValue("홍차오")
    await expectHitTarget(search)
    await expect(peek).toHaveAttribute("data-venue-id", HONGCHAO)
    await page.getByTestId("ondo-b-map-search-close").click()
    await page.getByTestId("canonical-place-details").click()
    await expect(page.getByTestId("canonical-place-overlay")).toHaveAttribute("data-venue-id", HONGCHAO)
    await page.keyboard.press("Escape")
    await expect(peek).toHaveAttribute("data-venue-id", HONGCHAO)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}
