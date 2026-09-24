import { expect, test, type Locator, type Page } from "@playwright/test"
import { seedFreshOnboarding } from "../helpers/ondo-b-qa"

// Local UI coverage, not provider authentication, payment or chain execution.
// Run with --reporter=line --output=/tmp/... so a dev server never watches artifacts.
test.describe.configure({ timeout: 60_000 })
test.use({ serviceWorkers: "block", viewport: { width: 390, height: 844 } })

const forbiddenRequests = new WeakMap<Page, string[]>()
const passiveAssetHosts = new Set(["tiles.openfreemap.org", "fonts.googleapis.com", "fonts.gstatic.com"])

test.beforeEach(async ({ page, context, baseURL, request }) => {
  expect(baseURL, "Use an explicitly managed local server").toBeTruthy()
  const origin = new URL(baseURL!).origin
  expect(["127.0.0.1", "localhost", "[::1]"]).toContain(new URL(origin).hostname)
  const config = await request.get(`${origin}/api/hackathon/v1/config`)
  expect(config.ok(), "Read-only isolation check must succeed").toBe(true)
  expect(await config.json()).toMatchObject({ isolatedMock: true })

  const forbidden: string[] = []
  forbiddenRequests.set(page, forbidden)
  await context.route("**/*", async route => {
    const incoming = route.request()
    const url = new URL(incoming.url())
    const readOnly = incoming.method() === "GET" || incoming.method() === "HEAD"
    const local = url.origin === origin
    const knownApi = /^\/api\/hackathon\/v1\/config$/.test(url.pathname)
      || /^\/api\/ondo\/venues(?:\/|$)/.test(url.pathname)
    const allowed = readOnly && (local
      ? !url.pathname.startsWith("/api/") || knownApi
      : passiveAssetHosts.has(url.hostname) && !incoming.isNavigationRequest())
    if (!allowed) {
      // Never put OAuth fragments, query strings or request bodies in evidence.
      forbidden.push(`${incoming.method()} ${url.origin}${url.pathname}`)
      await route.abort("blockedbyclient")
      return
    }
    await route.continue()
  })
})

test.afterEach(async ({ page }) => {
  expect(forbiddenRequests.get(page) ?? [], "No service/provider request is part of story discovery").toEqual([])
})

async function openCity(page: Page, city: "seoul" | "jeju", locale: "en" | "ko" | "ja" = "en", dark = false) {
  await seedFreshOnboarding(page, locale)
  if (dark) await page.addInitScript(nextLocale => {
    const stored = JSON.parse(localStorage.getItem("ondo-b.device.v1") ?? "{}")
    localStorage.setItem("ondo-b.device.v1", JSON.stringify({ ...stored, locale: nextLocale, appearancePreference: "dark" }))
  }, locale)
  await page.goto("/", { waitUntil: "domcontentloaded" })
  await page.getByTestId("ondo-b-nation").locator(`[data-city='${city}']`).click()
  const map = page.getByTestId("ondo-b-map-entry")
  await expect(map).toHaveAttribute("data-effective-view", "map")
  await expect(map).toHaveAttribute("data-map-state", "ready", { timeout: 30_000 })
  await expect(page.getByTestId("map-discovery-dock")).toBeVisible()
  return map
}

async function expectFullyPaintedText(locator: Locator) {
  const geometry = await locator.evaluate(node => {
    const element = node as HTMLElement
    const range = document.createRange()
    range.selectNodeContents(element)
    const text = range.getBoundingClientRect()
    const box = element.getBoundingClientRect()
    return {
      width: element.clientWidth, scrollWidth: element.scrollWidth,
      height: element.clientHeight, scrollHeight: element.scrollHeight,
      textRight: text.right, boxRight: box.right, textBottom: text.bottom, boxBottom: box.bottom,
    }
  })
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width + 1)
  expect(geometry.scrollHeight).toBeLessThanOrEqual(geometry.height + 1)
  expect(geometry.textRight).toBeLessThanOrEqual(geometry.boxRight + 1)
  expect(geometry.textBottom).toBeLessThanOrEqual(geometry.boxBottom + 1)
}

async function expectReadingRestored(page: Page, collection: "sesame" | "screen", top: number) {
  const panel = page.getByTestId("map-discovery-results")
  await expect(panel).toHaveAttribute("data-collection", collection)
  await expect(panel).toHaveAttribute("data-reading", "true")
  await expect(page.getByTestId("map-discovery-read-toggle")).toHaveAttribute("aria-expanded", "true")
  await expect.poll(async () => Math.abs(await panel.evaluate(node => node.scrollTop) - top)).toBeLessThan(3)
}

async function clickReadingStop(page: Page, stop: Locator) {
  await stop.scrollIntoViewIfNeeded()
  // Clicking may make a final accessibility scroll after scrollIntoView. Observe
  // the actual activation point, before React opens the place, rather than
  // treating that normal pre-click movement as a failed return restoration.
  await stop.evaluate(node => node.addEventListener("click", () => {
    const observedWindow = window as typeof window & { __ktourReadingClickTop?: number }
    observedWindow.__ktourReadingClickTop = node.closest<HTMLElement>("[data-testid='map-discovery-results']")?.scrollTop
  }, { once: true, capture: true }))
  await stop.click()
  const top = await page.evaluate(() => (window as typeof window & { __ktourReadingClickTop?: number }).__ktourReadingClickTop)
  expect(typeof top, "Observe a real reading-link activation").toBe("number")
  expect(top, "The test must actually leave the start of the reading panel").toBeGreaterThan(0)
  return top!
}

async function selectTemperature(page: Page, band: "hot" | "warm" | "cool") {
  const root = page.getByTestId("map-temperature-spectrum")
  await page.getByTestId(`map-temperature-${band}`).click()
  await expect(root).toHaveAttribute("data-selected", band)
}

async function openSearch(page: Page) {
  const search = page.getByTestId("ondo-b-search")
  if (!(await search.isVisible())) await page.getByTestId("ondo-b-map-search-toggle").click()
  await expect(search).toBeVisible()
  return search
}

test("READ-01 fresh city discovery exposes stories and temperature without entering search", async ({ page }, info) => {
  const map = await openCity(page, "seoul")
  const dock = page.getByTestId("map-discovery-dock")
  await expect(dock.getByTestId("map-discovery-story").first()).toBeVisible()
  await expect(page.getByTestId("map-temperature-spectrum")).toBeVisible()
  await expect(page.getByTestId("ondo-b-search")).toHaveCount(0)
  await expect(page.getByTestId("ondo-b-view-toggle")).toHaveCount(1)
  await page.screenshot({ path: info.outputPath("fresh-discovery-dock.png"), scale: "css" })
  await selectTemperature(page, "hot")
  await expect(map).toHaveAttribute("data-discovery-collection", "hot")
  await expect(page.getByTestId("map-discovery-results")).toHaveAttribute("data-result-count", "3")
  const search = await openSearch(page)
  await search.fill("Hotdog")
  await search.press("Enter")
  await expect(map).toHaveAttribute("data-discovery-collection", "hot")
  await expect(page.getByTestId("map-discovery-results")).toHaveAttribute("data-result-count", "0")
  await expect(page.getByTestId("map-temperature-spectrum")).toHaveAttribute("data-selected", "hot")
  await expect(await openSearch(page)).toHaveValue("Hotdog")
})

test("READ-09 small Hot first view shows the whole selected card without scrolling behind its footer", async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await openCity(page, "seoul")
  await selectTemperature(page, "hot")
  const panel = page.getByTestId("map-discovery-results")
  await expect(panel).toHaveAttribute("data-collection", "hot")
  await expect(page.locator("[data-discovery-pin]")).toHaveCount(3)
  await page.evaluate(async () => { await document.fonts.ready })
  const card = panel.locator("[data-discovery-card][data-selected='true'] [data-discovery-place-opener]")
  await expect(card).toHaveCount(1)

  // Do not click/scroll the card: Playwright's auto-scroll can hide a first-view
  // clipping regression. Test visible pixels, not merely its bounding box.
  const measure = () => card.evaluate(node => {
    const box = node.getBoundingClientRect()
    const ancestor = node.closest<HTMLElement>("[data-testid='map-discovery-results']")!
    const footer = ancestor.querySelector("footer")!.getBoundingClientRect()
    return {
      panelTop: ancestor.scrollTop,
      card: { top: box.top, bottom: box.bottom, height: box.height },
      footer: { top: footer.top, bottom: footer.bottom },
      hits: [box.top + 2, box.top + box.height / 2, box.bottom - 2].map(y => {
        const x = box.left + box.width / 2
        return y >= 0 && y < innerHeight && node.contains(document.elementFromPoint(x, y))
      }),
    }
  })
  await page.screenshot({ path: info.outputPath("en320-hot-first-view.png"), scale: "css" })
  await info.attach("first-view-card-geometry", { body: JSON.stringify(await measure(), null, 2), contentType: "application/json" })
  await expect.poll(async () => (await measure()).hits).toEqual([true, true, true])
  const geometry = await measure()
  expect(geometry.panelTop, "No scrolling should be needed to see the first recommendation").toBe(0)
  expect(geometry.card.bottom).toBeLessThanOrEqual(geometry.footer.top + 1)
})

for (const story of [
  { city: "seoul", locale: "ko", collection: "sesame", height: 568 },
  { city: "jeju", locale: "ja", collection: "screen", height: 800 },
] as const) test(`READ-10 ${story.locale} 320×${story.height}: collapsed story exposes its complete card and reading control without covering its pins`, async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: story.height })
  await openCity(page, story.city, story.locale)
  await page.getByTestId("map-discovery-story").first().click()
  const panel = page.getByTestId("map-discovery-results")
  const read = page.getByTestId("map-discovery-read-toggle")
  const heading = panel.getByRole("heading", { level: 2 })
  const card = panel.locator("[data-discovery-card][data-selected='true'] [data-discovery-place-opener]")
  await expect(panel).toHaveAttribute("data-collection", story.collection)
  await expect(panel).toHaveAttribute("data-reading", "false")
  await expect(read).toHaveAttribute("aria-expanded", "false")
  await expect(page.getByTestId("map-discovery-story-body")).toBeHidden()
  await expect(page.locator("[data-discovery-pin]")).toHaveCount(story.collection === "sesame" ? 1 : 2)
  await page.evaluate(async () => { await document.fonts.ready })
  // This is intentionally before any click/scroll on a result or reading control.
  await page.screenshot({ path: info.outputPath(`${story.locale}320-collapsed-story-first-view.png`), scale: "css" })
  await expectFullyPaintedText(heading)
  await expectFullyPaintedText(read)
  for (const target of [heading, read, card]) {
    await expect.poll(() => target.evaluate(node => {
      const r = node.getBoundingClientRect()
      return [r.top + 2, r.top + r.height / 2, r.bottom - 2].map(y => y >= 0 && y < innerHeight && node.contains(document.elementFromPoint(r.left + r.width / 2, y)))
    })).toEqual([true, true, true])
  }
  const geometry = await panel.evaluate(node => {
    const card = node.querySelector("[data-discovery-card][data-selected='true'] [data-discovery-place-opener]")!.getBoundingClientRect()
    const footer = node.querySelector("footer")!.getBoundingClientRect()
    return { top: node.scrollTop, cardBottom: card.bottom, footerTop: footer.top }
  })
  expect(geometry.top, "Collapsed story must not require scrolling to discover the complete selected place").toBe(0)
  expect(geometry.cardBottom).toBeLessThanOrEqual(geometry.footerTop + 1)
  expect((await read.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  // Increasing the tray must not merely move the occlusion onto a map pin.
  await expect.poll(() => page.locator("[data-discovery-pin]").evaluateAll(nodes => nodes.every(node => {
    const box = node.getBoundingClientRect()
    return node.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2))
  }))).toBe(true)
  await read.click()
  await expect(read).toHaveAttribute("aria-expanded", "true")
  await expectFullyPaintedText(page.getByTestId("map-discovery-story-intro"))
  await expect(page.getByTestId("map-discovery-story-body").locator(":scope > p")).toHaveCount(2)
})

test("READ-02 Japanese story title is complete at 320px and prose is readable before place selection", async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 800 })
  await openCity(page, "jeju", "ja", true)
  await page.getByTestId("map-discovery-story").first().click()
  const panel = page.getByTestId("map-discovery-results")
  const heading = panel.getByRole("heading", { level: 2, name: "ドラマの済州へ", exact: true })
  await expect(heading).toBeVisible()
  await expectFullyPaintedText(heading)
  await expect(page.getByTestId("map-discovery-story-intro")).toContainText("異なる二つの作品")
  await expect(page.getByTestId("map-discovery-story-body")).toBeHidden()
  await page.screenshot({ path: info.outputPath("ja320-story-preview.png"), scale: "css" })
  await page.getByTestId("map-discovery-read-toggle").click()
  const body = page.getByTestId("map-discovery-story-body")
  await expect(body).toBeVisible()
  await expect(body.locator(":scope > p")).toHaveCount(2)
  await expect(body.locator(":scope > p").nth(0)).toContainText("『おつかれさま』")
  await expect(body.locator(":scope > p").nth(1)).toContainText("『サムダルリへようこそ』")
  const textGeometry = await body.locator(":scope > p").evaluateAll(nodes => nodes.map(node => ({
    font: Number.parseFloat(getComputedStyle(node).fontSize), width: node.clientWidth, scrollWidth: node.scrollWidth,
  })))
  for (const measured of textGeometry) {
    expect(measured.font).toBeGreaterThanOrEqual(15)
    expect(measured.scrollWidth).toBeLessThanOrEqual(measured.width + 1)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
  await page.screenshot({ path: info.outputPath("ja320-story-reading.png"), scale: "css" })
})

test("READ-03 market text opens the place and native traversal plus reload preserve reading position", async ({ page }) => {
  await openCity(page, "seoul", "ko")
  await page.getByTestId("map-discovery-story").first().click()
  await page.getByTestId("map-discovery-read-toggle").click()
  const body = page.getByTestId("map-discovery-story-body")
  await expect(body.locator(":scope > p")).toHaveCount(2)
  await expect(body).toContainText("들기름은 메밀국수")
  const stop = body.getByRole("button", { name: /중부시장/ })
  const top = await clickReadingStop(page, stop)
  const detail = page.getByTestId("map-discovery-market-detail")
  await expect(detail).toHaveAttribute("data-place-id", "lab-seoul-jungbu-market")
  await expect(detail).toContainText("개별 점포")
  await page.goBack()
  await expect(detail).toHaveCount(0)
  await expectReadingRestored(page, "sesame", top)
  await page.goForward()
  await expect(detail).toBeVisible()
  await page.goBack()
  await expectReadingRestored(page, "sesame", top)
  await page.reload({ waitUntil: "domcontentloaded" })
  await expectReadingRestored(page, "sesame", top)
})

test("READ-04 Jeju reading links use the existing peek/detail and return to the same story stop", async ({ page }) => {
  await openCity(page, "jeju")
  await page.getByTestId("map-discovery-story").first().click()
  await page.getByTestId("map-discovery-read-toggle").click()
  const stop = page.getByTestId("map-discovery-story-body").getByRole("button", { name: /Gwangchigi Beach/ })
  const top = await clickReadingStop(page, stop)
  await expect(page.getByTestId("ondo-b-editorial-place-peek")).toHaveAttribute("data-editorial-place-id", "jeju-gwangchigi-beach")
  await page.getByTestId("ondo-b-editorial-place-details").click()
  await expect(page.getByTestId("ondo-b-editorial-place-overlay")).toBeVisible()
  await page.goBack()
  await expect(page.getByTestId("ondo-b-editorial-place-peek")).toBeVisible()
  await page.goBack()
  await expectReadingRestored(page, "screen", top)
  await expect(page.locator("[data-discovery-pin='jeju-gwangchigi-beach']")).toHaveAttribute("aria-pressed", "true")
})

test("READ-05 collection footer owns one map/list toggle and keeps the selected place through reload", async ({ page }) => {
  const map = await openCity(page, "seoul")
  await selectTemperature(page, "hot")
  const panel = page.getByTestId("map-discovery-results")
  const pin = page.locator("[data-discovery-pin='research-seoul-london-bagel-dosan']")
  await pin.click()
  await expect(pin).toHaveAttribute("aria-pressed", "true")
  await panel.getByTestId("map-discovery-show-list").click()
  await expect(map).toHaveAttribute("data-effective-view", "list")
  await expect(panel).toHaveAttribute("data-collection", "hot")
  await expect(panel).toHaveAttribute("data-result-count", "3")
  await expect(panel.locator("[data-discovery-card='research-seoul-london-bagel-dosan']")).toHaveAttribute("data-selected", "true")
  await page.reload({ waitUntil: "domcontentloaded" })
  await expect(map).toHaveAttribute("data-effective-view", "list")
  await expect(panel).toHaveAttribute("data-collection", "hot")
  await expect(page.getByTestId("ondo-b-view-toggle")).toHaveCount(1)
  await page.getByTestId("ondo-b-view-toggle").click()
  await expect(map).toHaveAttribute("data-effective-view", "map")
  await expect(pin).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByTestId("ondo-b-search")).toHaveCount(0)
})

test("READ-06 unsupported Jeju Hot explains the city limit and offers the local story without switching cities", async ({ page }) => {
  const map = await openCity(page, "jeju")
  await selectTemperature(page, "hot")
  const empty = page.getByTestId("map-discovery-empty")
  await expect(empty).toHaveAttribute("data-reason", "city")
  await expect(empty).toContainText("Picks for this city are still to come")
  await expect(page.getByTestId("map-discovery-results")).toHaveAttribute("data-result-count", "0")
  await empty.getByRole("button", { name: "Explore this city’s story" }).click()
  await expect(map).toHaveAttribute("data-discovery-collection", "screen")
  await expect(page.getByTestId("map-discovery-results")).toHaveAttribute("data-result-count", "2")
  expect(new URL(page.url()).searchParams.get("city")).toBe("jeju")
  await page.goBack()
  await expect(map).toHaveAttribute("data-discovery-collection", "hot")
  await expect(empty).toHaveAttribute("data-reason", "city")
})

test("READ-07 Seoul filter-empty recovery opens existing filters and retains Cool", async ({ page }) => {
  const map = await openCity(page, "seoul")
  await selectTemperature(page, "cool")
  await page.getByTestId("ondo-b-map-options-open").click()
  const categories = page.getByTestId("ondo-b-map-options-categories")
  await categories.locator("[data-category='casual']").click()
  await page.getByTestId("ondo-b-map-options-done").click()
  const empty = page.getByTestId("map-discovery-empty")
  await expect(empty).toHaveAttribute("data-reason", "filters")
  await expect(empty).toContainText("No picks match your current filters")
  await empty.getByRole("button", { name: "Review filters" }).click()
  await expect(page.getByTestId("ondo-b-map-options")).toBeVisible()
  await categories.locator("[data-category='all']").click()
  await page.getByTestId("ondo-b-map-options-done").click()
  await expect(empty).toHaveCount(0)
  await expect(map).toHaveAttribute("data-discovery-collection", "cool")
  await expect(page.getByTestId("map-discovery-results")).toHaveAttribute("data-result-count", "3")
  await expect(page.getByTestId("ondo-b-search")).toHaveCount(0)
})

test("READ-08 story source and map credits stay available without opening an external document", async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 800 })
  await openCity(page, "seoul", "ko")
  await page.getByTestId("map-discovery-story").first().click()
  const source = page.getByTestId("map-discovery-source")
  await expect(source).toHaveAttribute("href", "https://rurubu.jp/andmore/article/25110")
  await expect(source).toHaveAttribute("target", "_blank")
  await expect(source).toHaveAttribute("rel", /noopener/)
  const attribution = page.getByTestId("ondo-b-attribution")
  await expect(attribution).toHaveAttribute("data-attribution-presentation", "visible-legal")
  await expect(attribution).toBeVisible()
  await page.getByTestId("ondo-b-map-options-open").click()
  const options = page.getByTestId("ondo-b-map-options")
  const credits = options.getByTestId("ondo-b-map-options-credits")
  await credits.locator(":scope > summary").click()
  for (const [name, href] of [
    ["OpenFreeMap", "https://openfreemap.org/"],
    ["© OpenMapTiles", "https://openmaptiles.org/"],
    ["© OpenStreetMap contributors", "https://www.openstreetmap.org/copyright"],
  ]) {
    const link = credits.getByRole("link", { name, exact: true })
    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute("href", href)
    // Map Options is a scrollable sheet on compact viewports; verify each
    // legal link after bringing its own 44px target into the visible region.
    await link.scrollIntoViewIfNeeded()
    await expect.poll(() => link.evaluate(node => {
      // A wrapped inline link's union-box centre may be empty space. Use its
      // painted line boxes and still require a real, unobscured click target.
      const hits = Array.from(node.getClientRects()).map(r => {
        const x = r.left + r.width / 2, y = r.top + r.height / 2
        const target = document.elementFromPoint(x, y)
        return { x, y, usable: r.width > 0 && r.height > 0 && x > 0 && x < innerWidth && y > 0 && y < innerHeight && node.contains(target), target: target?.tagName, testId: target?.closest("[data-testid]")?.getAttribute("data-testid") }
      })
      return { usable: hits.some(hit => hit.usable), hits }
    }), { message: `${name} must not be behind the tray or bottom navigation` }).toMatchObject({ usable: true })
  }
  await page.screenshot({ path: info.outputPath("ko320-story-visible-map-credits.png"), scale: "css" })
})
