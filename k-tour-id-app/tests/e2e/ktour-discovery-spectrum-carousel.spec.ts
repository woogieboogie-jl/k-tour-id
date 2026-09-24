import { expect, test, type Locator, type Page } from "@playwright/test"
import { seedFreshOnboarding } from "../helpers/ondo-b-qa"

// Adversarial acceptance coverage for the manual story carousel and the
// Hot/Warm/Cool editorial spectrum. This spec deliberately uses only the
// local, isolated map surface; it never exercises provider or write APIs.
test.describe.configure({ timeout: 60_000 })
test.use({ serviceWorkers: "block" })

const forbiddenRequests = new WeakMap<Page, string[]>()
const runtimeDiagnostics = new WeakMap<Page, { pageErrors: string[]; failedRequests: string[] }>()
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
  const diagnostics = { pageErrors: [] as string[], failedRequests: [] as string[] }
  runtimeDiagnostics.set(page, diagnostics)
  page.on("pageerror", error => diagnostics.pageErrors.push(error.message))
  page.on("requestfailed", request => diagnostics.failedRequests.push(`${request.method()} ${new URL(request.url()).pathname}: ${request.failure()?.errorText ?? "unknown"}`))
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
      forbidden.push(`${incoming.method()} ${url.origin}${url.pathname}`)
      await route.abort("blockedbyclient")
      return
    }
    await route.continue()
  })
})

test.afterEach(async ({ page }) => {
  const diagnostics = runtimeDiagnostics.get(page)
  if (diagnostics && (diagnostics.pageErrors.length || diagnostics.failedRequests.length)) {
    await test.info().attach("runtime-diagnostics", { body: JSON.stringify(diagnostics, null, 2), contentType: "application/json" })
  }
  expect(diagnostics?.pageErrors ?? [], "No uncaught runtime exceptions").toEqual([])
  expect(forbiddenRequests.get(page) ?? [], "Discovery must not contact providers or write APIs").toEqual([])
})

async function openCity(page: Page, city: "seoul" | "jeju", locale: "en" | "ko" | "ja" = "en", appearance: "light" | "dark" = "light") {
  await seedFreshOnboarding(page, locale)
  if (appearance === "dark") {
    await page.addInitScript(nextLocale => {
      const stored = JSON.parse(localStorage.getItem("ondo-b.device.v1") ?? "{}")
      localStorage.setItem("ondo-b.device.v1", JSON.stringify({ ...stored, locale: nextLocale, appearancePreference: "dark" }))
    }, locale)
  }
  await page.goto("/", { waitUntil: "domcontentloaded" })
  await page.getByTestId("ondo-b-nation").locator(`[data-city='${city}']`).click()
  const map = page.getByTestId("ondo-b-map-entry")
  await expect(map).toHaveAttribute("data-effective-view", "map")
  await expect(map).toHaveAttribute("data-map-state", "ready", { timeout: 30_000 })
  return map
}

function spectrum(page: Page): Locator {
  return page.getByTestId("map-temperature-spectrum")
}

function level(page: Page, name: "hot" | "warm" | "cool"): Locator {
  return page.getByTestId(`map-temperature-${name}`)
}

async function selectLevel(page: Page, name: "hot" | "warm" | "cool") {
  const root = spectrum(page)
  await level(page, name).click()
  await expect(root).toHaveAttribute("data-selected", name)
}

async function openSpectrum(page: Page, city: "seoul" | "jeju" = "seoul") {
  const map = await openCity(page, city)
  await expect(spectrum(page)).toBeVisible()
  return map
}

test.describe("manual story carousel and editorial spectrum", () => {
  test("same-city story previews are manual: tap opens the story and does not auto-advance", async ({ page }) => {
    const map = await openCity(page, "jeju", "en", "dark")
    const previews = page.getByTestId("map-discovery-story-carousel")
    await expect(previews).toBeVisible()
    const cards = previews.locator("[data-story-id]")
    await expect(cards).toHaveCount(2)
    expect(await cards.evaluateAll(nodes => nodes.every(node => node.querySelector("[data-testid='map-discovery-story']")?.getAttribute("aria-label")?.includes("Jeju")))).toBe(true)

    const first = cards.first().getByTestId("map-discovery-story")
    await first.click()
    await expect(page.getByTestId("map-discovery-results")).toHaveAttribute("data-collection", "screen")
    await expect(map).toHaveAttribute("data-discovery-collection", "screen")
    await expect(page.getByTestId("map-discovery-story-body")).toBeHidden()
    await expect(page.getByTestId("map-discovery-read-toggle")).toBeVisible()

    // A manual carousel must stay on the chosen preview until the traveller
    // explicitly navigates; no timer may replace its selected story.
    await page.waitForTimeout(900)
    await expect(page.getByTestId("map-discovery-results")).toHaveAttribute("data-collection", "screen")
    await expect(page.getByTestId("map-discovery-story-carousel")).toHaveCount(0)
  })

  test("story next/previous and keyboard activation keep map pins, selected card and list results in agreement", async ({ page }) => {
    const map = await openCity(page, "jeju", "ko")
    const carousel = page.getByTestId("map-discovery-story-carousel")
    const cards = carousel.locator("[data-story-id]")
    await cards.first().getByTestId("map-discovery-story").focus()
    await page.keyboard.press("Enter")
    const panel = page.getByTestId("map-discovery-results")
    await expect(panel).toHaveAttribute("data-result-count", "2")
    const next = panel.getByRole("button", { name: /다음|Next|次/ })
    await expect(next).toBeVisible()
    await next.click()
    const selected = panel.locator("[data-discovery-card][data-selected='true']")
    const selectedId = await selected.getAttribute("data-discovery-card")
    expect(selectedId).toBeTruthy()
    await expect(page.locator(`button[data-discovery-pin='${selectedId}']`)).toHaveAttribute("aria-pressed", "true")

    await page.getByTestId("ondo-b-view-toggle").click()
    await expect(map).toHaveAttribute("data-effective-view", "list")
    await expect(page.getByTestId("map-discovery-results")).toHaveAttribute("data-layout", "list")
    await expect(page.locator("[data-discovery-card]")).toHaveCount(2)
    await expect(page.locator(`[data-discovery-card='${selectedId}'][data-selected='true']`)).toHaveCount(1)
  })

  test("Hot, Warm and Cool are vertical, city-scoped editorial sets with exactly three demos", async ({ page }) => {
    const map = await openSpectrum(page)
    await expect(spectrum(page)).toHaveAttribute("data-selected", "all")
    await page.setViewportSize({ width: 320, height: 720 })
    await page.screenshot({ path: test.info().outputPath("spectrum-320-light.png"), scale: "css" })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: test.info().outputPath("spectrum-390-light.png"), scale: "css" })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.screenshot({ path: test.info().outputPath("spectrum-1440-light.png"), scale: "css" })
    for (const name of ["hot", "warm", "cool"] as const) {
      await selectLevel(page, name)
      await expect(map).toHaveAttribute("data-discovery-collection", name)
      const panel = page.getByTestId("map-discovery-results")
      await expect(panel).toHaveAttribute("data-result-count", "3")
      await expect(panel.locator("[data-discovery-card]")).toHaveCount(3)
      expect(await panel.locator("[data-discovery-card]").evaluateAll(nodes => nodes.every(node => node.getAttribute("data-city") === "seoul"))).toBe(true)
      await page.getByTestId("map-discovery-close").click()
      if (name !== "cool") {
        await page.getByTestId("map-temperature-reset").click()
      }
    }
  })

  test("horizontal touch-style carousel movement changes the active preview without opening a story", async ({ page }) => {
    await openCity(page, "jeju")
    const carousel = page.getByTestId("map-discovery-story-carousel")
    const active = () => carousel.locator("[data-story-id][data-selected='true']").first()
    const before = await active().getAttribute("data-story-id")
    expect(before).toBeTruthy()
    if (test.info().project.name.includes("desktop")) {
      await active().getByTestId("map-discovery-story").focus()
      await page.keyboard.press("ArrowRight")
    } else {
      const rail = carousel.locator("[data-story-id]").first()
      const box = await rail.boundingBox()
      expect(box).toBeTruthy()
      const cdp = await page.context().newCDPSession(page)
      const x = box!.x + box!.width * .75
      const y = box!.y + box!.height / 2
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1 }] })
      for (const nextX of [x - 80, x - 180, x - 280]) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: nextX, y, id: 1 }] })
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
    }
    await expect.poll(async () => active().getAttribute("data-story-id")).not.toBe(before)
    await expect(page.getByTestId("map-discovery-results")).toHaveCount(0)
    await active().getByTestId("map-discovery-story").focus()
    await page.keyboard.press("Space")
    await expect(page.getByTestId("map-discovery-results")).toBeVisible()
  })

  test("real map pan moves populated camera telemetry; reading then preserves that camera", async ({ page }) => {
    const map = await openCity(page, "seoul")
    const canvas = page.getByTestId("maplibre-map")
    const readCamera = async () => canvas.evaluate(node => ({
      center: node.getAttribute("data-map-center"), zoom: node.getAttribute("data-map-zoom"),
    }))
    const initialCamera = await readCamera()
    expect(initialCamera.center).toMatch(/^-?\d+\.\d{5},-?\d+\.\d{5}$/)
    expect(Number(initialCamera.zoom)).not.toBeNaN()
    const box = await canvas.boundingBox()
    expect(box).toBeTruthy()
    const cdp = await page.context().newCDPSession(page)
    const x = box!.x + box!.width * .55
    const y = box!.y + box!.height * .45
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 2 }] })
    for (const nextX of [x + 45, x + 100, x + 160]) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: nextX, y, id: 2 }] })
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
    await expect.poll(() => readCamera()).not.toEqual(initialCamera)

    await page.locator("[data-testid='map-discovery-story'][data-collection='sesame']").click()
    // Story open may deliberately fly to its same-city stops. Establish the
    // post-flight camera before asserting that reading itself is camera-neutral.
    await page.waitForTimeout(800)
    const cameraBeforeReading = await readCamera()
    await page.getByTestId("map-discovery-read-toggle").click()
    const body = page.getByTestId("map-discovery-story-body")
    await body.evaluate(node => { node.scrollTop = node.scrollHeight })
    await expect.poll(() => readCamera()).toEqual(cameraBeforeReading)
    await page.getByTestId("map-discovery-read-toggle").click()
    await expect(map).toHaveAttribute("data-discovery-collection", "sesame")
  })

  test("reset clears only discovery selection and preserves city/filter state", async ({ page }) => {
    const map = await openCity(page, "seoul")
    if (await page.getByTestId("ondo-b-map-options-open").count()) {
      await page.getByTestId("ondo-b-map-options-open").click()
      const options = page.getByTestId("ondo-b-map-options")
      await options.getByTestId("ondo-b-map-options-categories").locator("[data-category='korean']").click()
      await page.getByTestId("ondo-b-map-options-done").click()
    } else {
      await page.getByTestId("ondo-b-category-rail").locator("[data-category='korean']").click()
    }
    await selectLevel(page, "warm")
    await expect(map).toHaveAttribute("data-discovery-collection", "warm")
    await page.getByTestId("map-temperature-reset").click()
    await expect(map).toHaveAttribute("data-discovery-collection", "none")
    await expect(map).toHaveAttribute("data-city", "seoul")
    if (await page.getByTestId("ondo-b-map-options-open").count()) {
      await page.getByTestId("ondo-b-map-options-open").click()
      await expect(page.getByTestId("ondo-b-map-options-categories").locator("[data-category='korean']")).toHaveAttribute("aria-pressed", "true")
    } else {
      await expect(page.getByTestId("ondo-b-category-rail").locator("[data-category='korean']")).toHaveAttribute("aria-pressed", "true")
    }
  })

  test("unsupported city and reduced motion remain honest and operable", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" })
    const map = await openSpectrum(page, "jeju")
    await selectLevel(page, "hot")
    const empty = page.getByTestId("map-discovery-empty")
    await expect(empty).toHaveAttribute("data-reason", "city")
    await expect(empty).toContainText(/준비|come|ありません/)
    await expect(page.locator("[data-discovery-pin]")).toHaveCount(0)
    await expect(spectrum(page).locator("*").first()).toHaveCSS("transition-duration", /0s|0\.01s/)
    await expect(map).toHaveAttribute("data-map-appearance", "light")
  })
})
