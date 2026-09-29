import { expect, test, type Page } from "@playwright/test"
import { CANONICAL_VENUE_ID, gotoB, prepareBPage, seedB } from "../helpers/ondo-b-qa"
import { RESEARCHED_FOOD_B } from "../../features/ondo/map/researched-food-b"

test.describe.configure({ timeout: 120_000 })
const ID = "research-seoul-onion-anguk"
const MEMORY = "ondo-b.place-memories.v1"
const runtime = new WeakMap<Page, string[]>()
const writes = new WeakMap<Page, string[]>()
test.beforeEach(async ({ page }) => {
  runtime.set(page, []); writes.set(page, [])
  page.on("pageerror", error => runtime.get(page)!.push(error.message))
  await page.route("**/*", async route => {
    if (!["GET", "HEAD", "OPTIONS"].includes(route.request().method())) { writes.get(page)!.push(new URL(route.request().url()).pathname); await route.abort(); return }
    await route.continue()
  })
  await prepareBPage(page)
  page.setDefaultTimeout(15_000)
  await page.emulateMedia({ reducedMotion: "reduce" })
  await seedB(page, { locale: "ja" })
})
test.afterEach(async ({ page }) => { expect(runtime.get(page)).toEqual([]); expect(writes.get(page)).toEqual([]) })
async function research(page: Page) {
  await gotoB(page, "?city=seoul&collection=seoul-cafes&review=0")
  await page.locator(`[data-discovery-place-opener='${ID}']`).click()
  return page.locator(`[data-common-place-root='${ID}']`)
}
async function my(page: Page) { await page.getByTestId("nav-my").click(); return page.getByTestId("ondo-b-my-korea-entry") }

for (const scheme of ["light", "dark"] as const) {
  test(`JA ${scheme}: story place saves native ID, reloads, opens same detail and returns to exact My Korea item`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: scheme })
    const detail = await research(page)
    await expect(detail.getByTestId("place-personal-journal")).toHaveAttribute("data-place-id", ID)
    await detail.getByTestId("place-save").click()
    await expect(detail.getByTestId("place-save")).toHaveAttribute("aria-pressed", "true")
    await detail.getByTestId("place-personal-visit").click()
    await expect(detail.getByTestId("place-personal-visit")).toHaveAttribute("aria-pressed", "true")
    const note = detail.getByTestId(`private-note-${ID}`)
    await note.getByRole("button").first().click()
    await note.locator("textarea").fill("窓側の席でコーヒー")
    await note.getByRole("button", { name: "プライベートメモを保存", exact: true }).click()
    await expect(note.getByRole("status")).toBeVisible()
    await detail.getByTestId("place-personal-journal").screenshot({ path: info.outputPath(`journal-${scheme}.png`) })
    await page.keyboard.press("Escape")
    await expect(detail).toHaveCount(0)
    await my(page)
    const saved = page.getByTestId(`saved-discovery-${ID}`)
    await expect(saved).toBeVisible()
    await page.reload({ waitUntil: "domcontentloaded" })
    await my(page)
    await saved.click()
    await expect(detail).toBeVisible()
    await expect(detail.getByTestId("place-save")).toHaveAttribute("aria-pressed", "true")
    await expect(detail.getByTestId("place-personal-visit")).toHaveAttribute("aria-pressed", "true")
    await expect(detail.getByTestId("hackathon-entitlement-open")).toHaveCount(0)
    await expect(detail.getByTestId("place-offer-open")).toHaveCount(0)
    await page.screenshot({ path: info.outputPath(`saved-place-${scheme}.png`) })
    await page.getByTestId("research-on-map").click()
    await expect(page.locator(`[data-personal-place-pin='${ID}']`)).toBeInViewport({ timeout: 30_000 })
    await expect(page.getByTestId("content-place-peek")).toHaveAttribute("data-place-id", ID)
    await page.screenshot({ path: info.outputPath(`saved-place-on-map-${scheme}.png`) })
    await page.getByTestId("content-place-details").click()
    await expect(detail).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page.getByTestId("ondo-b-my-korea-entry")).toBeVisible()
    await expect(saved).toBeFocused()
    const memory = await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? "{}"), MEMORY)
    expect(memory[ID]).toMatchObject({ saved: true, note: "窓側の席でコーヒー" })
    expect(memory[ID]).not.toHaveProperty("verified")
  })
}

test("On map retains exact story place and exposes its same detail instead of returning to the story", async ({ page }, info) => {
  const detail = await research(page)
  await page.getByTestId("research-on-map").click()
  const peek = page.getByTestId("content-place-peek")
  await expect(peek).toHaveAttribute("data-place-id", ID)
  await expect(detail).toHaveCount(0)
  await expect(page.getByTestId("map-discovery-results")).toBeHidden()
  await expect(page.getByTestId("map-discovery-results")).toHaveCSS("visibility", "hidden")
  await expect(peek).toBeFocused()
  await expect(page).toHaveURL(new RegExp(`discoveryPlaceId=${ID}`))
  const pin = page.locator(`[data-discovery-pin='${ID}']`)
  await expect(pin).toBeInViewport({ timeout: 30_000 })
  const clearance = await peek.evaluate(node => {
    const dock = document.getElementById("ondo-main-nav")!
    const a = node.getBoundingClientRect(), b = dock.getBoundingClientRect()
    return a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom
  })
  expect(clearance).toBe(true)
  await page.screenshot({ path: info.outputPath("on-map-native-place.png") })
  await peek.getByTestId("content-place-details").click()
  await expect(detail).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByTestId("map-discovery-results")).toHaveAttribute("data-collection", "seoul-cafes")
  await expect(page.locator(`[data-discovery-place-opener='${ID}']`)).toBeFocused()
})

test("Leaving Explore cancels an On map focus waiting for basemap readiness", async ({ page }) => {
  let release!: () => void
  const waiting = new Promise<void>(resolve => { release = resolve })
  await page.route("https://tiles.openfreemap.org/**", async route => { await waiting; await route.continue() })
  try {
    await gotoB(page, `?city=seoul&discoveryPlaceId=${ID}&review=0`)
    await expect(page.locator(`[data-common-place-root='${ID}']`)).toBeVisible()
    const map = page.getByTestId("ondo-b-map-entry")
    await expect(map).not.toHaveAttribute("data-map-state", "ready")
    await page.getByTestId("research-on-map").click()
    await expect(page.getByTestId("content-place-peek")).toBeVisible()
    await my(page)
    await expect(page.getByTestId("ondo-b-my-korea-entry")).toBeVisible()
    release()
    await expect(map).toHaveAttribute("data-map-state", "ready", { timeout: 30_000 })
    // The preserved hidden map must not execute the abandoned 14.5 focus later.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    const canvas = page.locator("[data-map-zoom]").first()
    const zoom = Number(await canvas.getAttribute("data-map-zoom"))
    expect(Number.isFinite(zoom)).toBe(true)
    expect(Math.abs(zoom - 14.5)).toBeGreaterThan(0.1)
    await page.getByTestId("nav-ondo").click()
    await expect(map).toBeVisible()
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    await expect(canvas).toHaveAttribute("data-map-zoom", zoom.toFixed(3))
  } finally { release() }
})

test("directory and story use same complete place experience and persisted personal record", async ({ page }) => {
  const detail = await research(page)
  await detail.getByTestId("place-save").click()
  await page.keyboard.press("Escape")
  await gotoB(page, "?city=seoul&view=list&review=0")
  await page.locator(`button[data-research-id='${ID}']`).click()
  await expect(detail.getByTestId("place-save")).toHaveAttribute("aria-pressed", "true")
  await expect(detail.locator("[data-common-place-section='memories']")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.locator(`button[data-research-id='${ID}']`)).toBeFocused()
})

test("canonical and editorial places expose identical personal journal without fake stamps", async ({ page }, info) => {
  for (const [id, query, opener] of [
    [CANONICAL_VENUE_ID, `?venueId=${CANONICAL_VENUE_ID}&review=0`, "canonical-place-details"],
    ["jeju-seongsan-ilchulbong", "?city=jeju&editorialPlaceId=jeju-seongsan-ilchulbong&review=0", "ondo-b-editorial-place-details"],
  ]) {
    await gotoB(page, query)
    await page.getByTestId(opener).click()
    const detail = page.locator(`[data-common-place-root='${id}']`)
    const journal = detail.getByTestId("place-personal-journal")
    await expect(journal).toHaveAttribute("data-provenance", "self-reported-local")
    await journal.getByTestId("place-personal-visit").click()
    await expect(journal.getByTestId("place-personal-visit")).toHaveAttribute("aria-pressed", "true")
    await expect(detail.getByTestId("canonical-journey-open")).toHaveCount(0)
    await journal.screenshot({ path: info.outputPath(`${id}-journal.png`) })
  }
})

test("market keeps native place save/journal but gains no merchant actions", async ({ page }) => {
  await gotoB(page, "?city=seoul&collection=sesame&discoveryPlaceId=lab-seoul-jungbu-market&review=0")
  const detail = page.locator("[data-common-place-root='lab-seoul-jungbu-market']")
  await expect(detail).toBeVisible()
  await detail.getByTestId("place-save").click()
  await expect(detail.getByTestId("place-save")).toHaveAttribute("aria-pressed", "true")
  await expect(detail.getByTestId("place-offer-open")).toHaveCount(0)
  await expect(detail.getByTestId("hackathon-entitlement-open")).toHaveCount(0)
  await page.getByTestId("map-discovery-market-on-map").click()
  await expect(page.getByTestId("content-place-peek")).toHaveAttribute("data-place-id", "lab-seoul-jungbu-market")
})

test("storage denial keeps bookmark/visit false and preserves note draft for retry", async ({ page }) => {
  const detail = await research(page)
  await page.evaluate(key => {
    const original = Storage.prototype.setItem
    Object.defineProperty(window.localStorage, "setItem", { configurable: true, value(name: string, value: string) { if (name === key) throw new DOMException("Denied", "QuotaExceededError"); return original.call(this, name, value) } })
  }, MEMORY)
  await detail.getByTestId("place-save").click()
  await expect(detail.getByTestId("place-save")).toHaveAttribute("aria-pressed", "false")
  await expect(detail.getByRole("alert")).toBeVisible()
  const note = detail.getByTestId(`private-note-${ID}`)
  await note.getByRole("button").first().click()
  await note.locator("textarea").fill("preserve me")
  await note.getByRole("button", { name: "プライベートメモを保存", exact: true }).click()
  await expect(note.locator("textarea")).toHaveValue("preserve me")
  await page.evaluate(() => { delete (window.localStorage as unknown as { setItem?: unknown }).setItem })
  await note.getByRole("button", { name: "メモの保存を再試行", exact: true }).click()
  await expect(note.getByRole("status")).toBeVisible()
})

test("removing a bookmark preserves the journal and exact personal-record return", async ({ page }) => {
  const detail = await research(page)
  await detail.getByTestId("place-save").click()
  await detail.getByTestId("place-personal-visit").click()
  await detail.getByTestId("place-save").click()
  await expect(detail.getByTestId("place-save")).toHaveAttribute("aria-pressed", "false")
  await page.keyboard.press("Escape")
  await my(page)
  await expect(page.getByTestId(`saved-discovery-${ID}`)).toHaveCount(0)
  const visit = page.locator(`[data-personal-visit-place='${ID}']`)
  await visit.click()
  await expect(detail.getByTestId("place-personal-visit")).toHaveAttribute("aria-pressed", "true")
  await page.keyboard.press("Escape")
  await expect(visit).toBeFocused()
})

test("clear device content rolls back new records on late failure then removes them on explicit retry", async ({ page }) => {
  const detail = await research(page)
  await detail.getByTestId("place-save").click()
  await detail.getByTestId("place-personal-visit").click()
  await page.keyboard.press("Escape")
  const before = await page.evaluate(key => localStorage.getItem(key), MEMORY)
  await page.evaluate(() => {
    sessionStorage.setItem("ondo-b.labs.v1", "preserve-until-complete")
    const remove = Storage.prototype.removeItem
    Object.defineProperty(window.sessionStorage, "removeItem", { configurable: true, value(key: string) {
      if (key === "ondo-b.labs.v1") throw new DOMException("Denied", "SecurityError")
      return remove.call(this, key)
    } })
  })
  await page.getByTestId("nav-settings").click()
  await page.getByTestId("ondo-b-device-data-settings").click()
  await page.getByTestId("ondo-b-clear-device-open").click()
  const dialog = page.getByRole("dialog", { name: "保存データを削除しますか？", exact: true })
  await dialog.getByRole("button", { name: "保存データを削除", exact: true }).click()
  await expect(page.getByTestId("ondo-b-clear-device-error")).toBeVisible()
  expect(await page.evaluate(key => localStorage.getItem(key), MEMORY)).toBe(before)
  await page.evaluate(() => { delete (window.sessionStorage as unknown as { removeItem?: unknown }).removeItem })
  await dialog.getByRole("button", { name: "保存データを削除", exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect(await page.evaluate(key => localStorage.getItem(key), MEMORY)).toBeNull()
  await my(page)
  await expect(page.getByTestId(`saved-discovery-${ID}`)).toHaveCount(0)
  await expect(page.getByTestId("my-korea-personal-visits")).toHaveCount(0)
})

test("Busan and Jeju directory native places share save and exact-city reopen at narrow widths", async ({ page }, info) => {
  if (info.project.name === "mobile-chromium") await page.setViewportSize({ width: 320, height: 740 })
  for (const city of ["busan", "jeju"] as const) {
    const place = RESEARCHED_FOOD_B.find(item => item.city === city)!
    await gotoB(page, `?city=${city}&view=list&review=0`)
    await page.locator(`button[data-research-id='${place.id}']`).click()
    const detail = page.locator(`[data-common-place-root='${place.id}']`)
    await detail.getByTestId("place-save").click()
    await expect(detail.getByTestId("place-save")).toHaveAttribute("aria-pressed", "true")
    await page.keyboard.press("Escape")
    await my(page)
    await page.getByTestId(`saved-discovery-${place.id}`).click()
    await expect(detail).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`city=${city}`))
    await detail.getByTestId("place-personal-journal").scrollIntoViewIfNeeded()
    await page.screenshot({ path: info.outputPath(`${city}-common-place.png`) })
    await page.keyboard.press("Escape")
    await expect(page.getByTestId(`saved-discovery-${place.id}`)).toBeFocused()
  }
})

for (const story of [
  { city: "seoul", collection: "sesame", id: "lab-seoul-jungbu-market", name: "中部市場", editorial: false },
  { city: "jeju", collection: "screen", id: "jeju-gwangchigi-beach", name: "クァンチギ海岸", editorial: true },
] as const) test(`Expanded ${story.collection} reading preserves scroll and native history through common place detail`, async ({ page }, info) => {
  // A tall desktop can fit this short market story without any scrolling.
  // Use a normal short laptop viewport so this case exercises nonzero restoration.
  if (info.project.name === "desktop-chromium") await page.setViewportSize({ width: 1280, height: 720 })
  await gotoB(page, `?city=${story.city}&collection=${story.collection}&review=0`)
  await page.getByTestId("map-discovery-read-toggle").click()
  const panel = page.getByTestId("map-discovery-results")
  const stop = page.getByTestId("map-discovery-story-body").getByRole("button", { name: new RegExp(story.name) })
  await stop.scrollIntoViewIfNeeded()
  await stop.evaluate(node => node.addEventListener("click", () => {
    (window as typeof window & { __commonPlaceReadingTop?: number }).__commonPlaceReadingTop = node.closest<HTMLElement>("[data-testid='map-discovery-results']")?.scrollTop
  }, { once: true, capture: true }))
  await stop.click()
  const top = await page.evaluate(() => (window as typeof window & { __commonPlaceReadingTop?: number }).__commonPlaceReadingTop)
  expect(top).toBeGreaterThan(0)
  if (story.editorial) {
    await expect(page.getByTestId("ondo-b-editorial-place-peek")).toHaveAttribute("data-editorial-place-id", story.id)
    await page.getByTestId("ondo-b-editorial-place-details").click()
  }
  await expect(page.locator(`[data-common-place-root='${story.id}']`)).toBeVisible()
  await page.goBack()
  if (story.editorial) {
    await expect(page.getByTestId("ondo-b-editorial-place-peek")).toBeVisible()
    await page.goBack()
  }
  const restored = async () => {
    await expect(panel).toHaveAttribute("data-reading", "true")
    await expect(panel).toHaveAttribute("data-collection", story.collection)
    await expect.poll(async () => Math.abs(await panel.evaluate(node => node.scrollTop) - top!)).toBeLessThan(3)
  }
  await restored()
  await page.goForward()
  if (story.editorial) await expect(page.getByTestId("ondo-b-editorial-place-peek")).toHaveAttribute("data-editorial-place-id", story.id)
  else await expect(page.locator(`[data-common-place-root='${story.id}']`)).toBeVisible()
  await page.goBack()
  await restored()
  await page.reload({ waitUntil: "domcontentloaded" })
  await restored()
})
