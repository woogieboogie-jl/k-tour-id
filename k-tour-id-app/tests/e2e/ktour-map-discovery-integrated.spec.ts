import { expect, test, type Page } from "@playwright/test"
import { seedFreshOnboarding } from "../helpers/ondo-b-qa"

async function seed(page: Page, locale: "en" | "ko" = "en") {
  await seedFreshOnboarding(page, locale)
}

function observeForbiddenApi(page: Page) {
  const forbidden: string[] = []
  let armed = false
  page.on("request", request => {
    const url = new URL(request.url())
    if (!url.pathname.startsWith("/api/")) return
    // Initial app config reads are permitted; arm only after the hydrated map is open.
    if (!armed) return
    if (request.method() === "GET" && (/^\/api\/hackathon\/v1\/config$/i.test(url.pathname) || /^\/api\/ondo\/venues\//i.test(url.pathname))) return
    if (/^\/api\/(hackathon|kyc)(\/|$)/i.test(url.pathname)
      || /identity|payment|checkout|wallet|sign|chain|sui|omnione/i.test(url.pathname)) {
      forbidden.push(`${request.method()} ${url.pathname}`)
    }
  })
  return { forbidden, arm: () => { armed = true } }
}

async function openMap(page: Page) {
  await seed(page)
  const observed = observeForbiddenApi(page)
  await page.goto("/", { waitUntil: "domcontentloaded" })
  const nation = page.getByTestId("ondo-b-nation")
  await expect(nation).toBeVisible()
  await nation.locator("[data-city='seoul']").click()
  const map = page.getByTestId("ondo-b-map-entry")
  await expect(map).toHaveAttribute("data-effective-view", "map")
  await expect(map).toHaveAttribute("data-map-state", "ready", { timeout: 30_000 })
  observed.arm()
  return { map, forbidden: observed.forbidden }
}

async function selectTemperature(page: Page, band: "hot" | "warm" | "cool") {
  const spectrum = page.getByTestId("map-temperature-spectrum")
  await page.getByTestId(`map-temperature-${band}`).click()
  await expect(spectrum).toHaveAttribute("data-selected", band)
}

async function openSearch(page: Page) {
  const search = page.getByTestId("ondo-b-search")
  if (!(await search.isVisible())) await page.getByTestId("ondo-b-map-search-toggle").click()
  await expect(search).toBeVisible()
  return search
}

test.describe("production map discovery integration", () => {
  test.describe.configure({ timeout: 60_000 })

  test("nation → Seoul → story map → native back returns to the city map", async ({ page }) => {
    const { map, forbidden } = await openMap(page)
    await expect(map).toHaveAttribute("data-discovery-collection", "none")
    await page.getByTestId("map-discovery-story").first().click()
    await expect(map).toHaveAttribute("data-discovery-collection", "sesame")
    await expect(page.getByTestId("map-discovery-results")).toHaveAttribute("data-collection", "sesame")
    await page.goBack()
    await expect(map).toHaveAttribute("data-discovery-collection", "none")
    expect(forbidden).toEqual([])
  })

  test("native forward restores the story collection after returning to Seoul", async ({ page }) => {
    const { map, forbidden } = await openMap(page)
    await page.getByTestId("map-discovery-story").first().click()
    await expect(map).toHaveAttribute("data-discovery-collection", "sesame")
    await page.goBack()
    await expect(map).toHaveAttribute("data-discovery-collection", "none")
    await page.goForward()
    await expect(map).toHaveAttribute("data-discovery-collection", "sesame")
    await expect(page.getByTestId("map-discovery-results")).toBeVisible()
    expect(forbidden).toEqual([])
  })

  test("Hot and Cool are city-scoped collections and search Enter reaches the same modes", async ({ page }) => {
    const { map, forbidden } = await openMap(page)
    await selectTemperature(page, "hot")
    await expect(map).toHaveAttribute("data-discovery-collection", "hot")
    await expect(page.getByTestId("map-discovery-results")).toHaveAttribute("data-collection", "hot")
    const search = await openSearch(page)
    await search.fill("cool")
    await search.press("Enter")
    await expect(map).toHaveAttribute("data-discovery-collection", "cool")
    const nextSearch = await openSearch(page)
    await nextSearch.fill("hot")
    await nextSearch.press("Enter")
    await expect(map).toHaveAttribute("data-discovery-collection", "hot")
    expect(forbidden).toEqual([])
  })

  test("literal Hotdog query remains search and does not become the Hot mood", async ({ page }) => {
    const { map, forbidden } = await openMap(page)
    const search = await openSearch(page)
    await search.fill("Hotdog")
    await search.press("Enter")
    await expect(map).toHaveAttribute("data-discovery-collection", "none")
    await expect(await openSearch(page)).toHaveValue("Hotdog")
    expect(forbidden).toEqual([])
  })

  test("category filters preserve collection and expose result counts", async ({ page }) => {
    const { map, forbidden } = await openMap(page)
    await selectTemperature(page, "hot")
    const results = page.getByTestId("map-discovery-results")
    await expect(results).toHaveAttribute("data-collection", "hot")
    await page.getByTestId("ondo-b-map-options-open").click()
    const options = page.getByTestId("ondo-b-map-options")
    const categories = options.getByTestId("ondo-b-map-options-categories")
    for (const [category, count] of [["all", "3"], ["korean", "1"], ["night", "2"]] as const) {
      await categories.locator(`[data-category='${category}']`).click()
      await page.getByTestId("ondo-b-map-options-done").click()
      await expect(results).toHaveAttribute("data-result-count", count)
      await expect(map).toHaveAttribute("data-discovery-collection", "hot")
      if (category !== "night") await page.getByTestId("ondo-b-map-options-open").click()
    }
    expect(forbidden).toEqual([])
  })

  test("story market detail opens from card and closes back to the result tray", async ({ page }) => {
    const { map, forbidden } = await openMap(page)
    await page.getByTestId("map-discovery-story").first().click()
    const card = page.locator("[data-discovery-place-opener]").first()
    await expect(card).toBeVisible()
    await card.click()
    const detail = page.getByTestId("map-discovery-market-detail")
    await expect(detail).toBeVisible()
    const marketSource = detail.locator("details").first()
    await marketSource.click()
    await expect(marketSource.locator("a").first()).toHaveAttribute("href", /^https?:\/\//)
    await expect(detail.getByRole("button", { name: /저장|Save/ })).toHaveCount(0)
    await page.getByTestId("ondo-sheet").filter({ has: detail }).locator(":scope > header button").click()
    await expect(page.getByTestId("map-discovery-results")).toBeVisible()
    await expect(map).toHaveAttribute("data-discovery-collection", "sesame")
    expect(forbidden).toEqual([])
  })

  test("research detail keeps source and pin/card selection synchronized", async ({ page }) => {
    const { map, forbidden } = await openMap(page)
    await selectTemperature(page, "hot")
    const opener = page.locator("[data-discovery-place-opener]").first()
    const id = await opener.getAttribute("data-discovery-place-opener")
    expect(id).toBeTruthy()
    await opener.click()
    const detail = page.getByTestId("researched-food-detail")
    await expect(detail).toBeVisible()
    const source = detail.getByTestId("research-place-source")
    await source.locator(":scope > summary").click()
    await expect(source.locator("a").first()).toHaveAttribute("href", /^https?:\/\//)
    const pin = page.locator(`button[data-discovery-pin='${id}']`)
    await expect(pin).toHaveAttribute("aria-pressed", "true")
    await page.getByTestId("ondo-sheet").filter({ has: detail }).locator(":scope > header button").click()
    await expect(pin).toHaveAttribute("aria-pressed", "true")
    await expect(map).toHaveAttribute("data-discovery-collection", "hot")
    expect(forbidden).toEqual([])
  })

  test("unavailable map assets fall back to a list without losing the story or keyboard access", async ({ page }) => {
    await page.route("https://tiles.openfreemap.org/**", route => route.abort("failed"))
    await seed(page)
    const observed = observeForbiddenApi(page)
    await page.goto("/?city=seoul&collection=sesame", { waitUntil: "domcontentloaded" })
    const map = page.getByTestId("ondo-b-map-entry")
    await expect(map).toHaveAttribute("data-effective-view", "list", { timeout: 30_000 })
    await expect(map).toHaveAttribute("data-discovery-collection", "sesame")
    observed.arm()
    const card = page.locator("[data-discovery-place-opener]").first()
    await expect(card).toBeVisible()
    await card.focus()
    await expect(card).toBeFocused()
    await page.keyboard.press("Enter")
    await expect(page.getByTestId("map-discovery-market-detail")).toBeVisible()
    expect(observed.forbidden).toEqual([])
  })

  test("small viewport keeps discovery tray and keyboard actions inside the map shell", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 })
    const { map, forbidden } = await openMap(page)
    await selectTemperature(page, "cool")
    await expect(page.getByTestId("map-discovery-results")).toBeVisible()
    const geometry = await map.evaluate(node => ({
      right: node.getBoundingClientRect().right,
      viewport: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }))
    expect(geometry.right).toBeLessThanOrEqual(geometry.viewport + 1)
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.viewport + 1)
    expect(forbidden).toEqual([])
  })

  test("reload preserves the active city and discovery collection without a service call", async ({ page }) => {
    const { map, forbidden } = await openMap(page)
    await selectTemperature(page, "cool")
    await expect(map).toHaveAttribute("data-discovery-collection", "cool")
    await page.reload({ waitUntil: "domcontentloaded" })
    await expect(page.getByTestId("ondo-b-map-entry")).toHaveAttribute("data-discovery-collection", "cool")
    expect(forbidden).toEqual([])
  })
})
