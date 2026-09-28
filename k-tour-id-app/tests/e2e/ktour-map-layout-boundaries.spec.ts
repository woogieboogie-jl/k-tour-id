import { expect, test, type Locator, type Page } from "@playwright/test"
import { seedFreshOnboarding, type BLocale } from "../helpers/ondo-b-qa"

test.describe.configure({ timeout: 120_000 })
const failures = new WeakMap<Page, string[]>()

test.beforeEach(async ({ page }) => {
  const errors: string[] = []
  failures.set(page, errors)
  page.on("pageerror", error => errors.push(error.message))
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" })
  // Browser permission denial only; no location, identity or age authority is seeded.
  await page.addInitScript(() => Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: { getCurrentPosition(_success: PositionCallback, failure: PositionErrorCallback) {
      failure({ code: 1, message: "denied", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError)
    } },
  }))
  await page.route("**/*", async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method())
      || /sumsub|onfido|omni.?one|opendid|fullnode|sui\.io|walletconnect|stripe/i.test(url.hostname)) {
      errors.push(`Forbidden request: ${request.method()} ${url.origin}`)
      await route.abort("blockedbyclient")
    } else await route.continue()
  })
})

test.afterEach(({ page }) => { expect(failures.get(page) ?? []).toEqual([]) })

async function enterNation(page: Page, locale: BLocale = "ja") {
  await seedFreshOnboarding(page, locale)
  await page.addInitScript(() => {
    const device = JSON.parse(localStorage.getItem("ondo-b.device.v1") ?? "{}")
    localStorage.setItem("ondo-b.device.v1", JSON.stringify({ ...device, appearancePreference: "dark" }))
  })
  await page.goto("/", { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("ondo-b-root")).toHaveAttribute("data-hydrated", "true")
  await expect(page.locator("html")).toHaveAttribute("lang", locale)
  await expect(page.locator("html")).toHaveAttribute("data-ondo-theme", "dark")
  await expect(page.getByTestId("ondo-onboarding-backdrop")).toHaveCount(0)
  await expect(page.getByTestId("maplibre-map")).toHaveAttribute("data-map-state", "ready", { timeout: 35_000 })
}

async function tabTo(page: Page, target: Locator, maximum = 40) {
  for (let step = 0; step < maximum; step += 1) {
    if (await target.evaluate(node => node === document.activeElement)) return
    await page.keyboard.press("Tab")
  }
  await expect(target).toBeFocused()
}

async function hit(target: Locator) {
  await expect(target).toBeVisible()
  await expect.poll(() => target.evaluate(node => {
    const rect = node.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
      && node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
  }), { message: "The control must own its visible center, not sit under another layer" }).toBe(true)
}

async function dockGeometry(page: Page, mobile: boolean) {
  await expect.poll(() => page.getByTestId("ondo-canvas").evaluate((node, isMobile) => {
    const dock = node.querySelector<HTMLElement>("#ondo-main-nav")!
    const style = getComputedStyle(dock)
    const reserved = parseFloat(getComputedStyle(node).getPropertyValue("--ondo-map-dock-space"))
    const expected = isMobile ? dock.offsetHeight + parseFloat(style.marginTop) + parseFloat(style.marginBottom) : 0
    return Number.isFinite(reserved) && Math.abs(reserved - expected) < 1
  }, mobile)).toBe(true)
  await expect.poll(() => page.evaluate(isMobile => {
    const rect = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!.getBoundingClientRect()
    const map = rect("maplibre-map")
    const interaction = rect("ondo-b-map-entry")
    const nav = rect("ondo-main-nav")
    const content = rect("ondo-scroll-region")
    const reserved = parseFloat(getComputedStyle(document.querySelector('[data-testid="ondo-canvas"]')!).getPropertyValue("--ondo-map-dock-space")) || 0
    return interaction.bottom <= nav.top + 1
      && Math.abs(interaction.height - (map.height - reserved)) < 1.5
      && (isMobile ? Math.abs(map.bottom - innerHeight) < 1.5 : content.bottom <= nav.top + 1)
  }, mobile), { message: "The map backdrop and the reserved interaction lane must settle together" }).toBe(true)
  for (const button of await page.getByTestId("ondo-main-nav").locator("button").all()) await hit(button)
  const viewport = page.viewportSize()!
  expect(await page.locator("html").evaluate(node => node.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1)
}

async function nationTargets(page: Page) {
  await expect(page.getByTestId("maplibre-map")).toHaveAttribute("data-map-projection-settled", "true")
  const atlas = page.getByTestId("ondo-b-korea-atlas")
  await expect(atlas).toHaveAttribute("data-map-presentation", "ready")
  const brand = page.locator('[data-ondo-brand-lockup="compact"]')
  await expect(brand).toHaveAccessibleName("K-Tour ID")
  const header = brand.locator("xpath=ancestor::header[1]")
  const brandBox = await brand.boundingBox()
  expect(brandBox).not.toBeNull()
  for (const action of await header.locator("button:visible").all()) {
    await hit(action)
    const bounds = (await action.boundingBox())!
    expect(Math.min(bounds.x + bounds.width, brandBox!.x + brandBox!.width)
      - Math.max(bounds.x, brandBox!.x), "Brand and header actions must not overlap horizontally").toBeLessThanOrEqual(1)
  }
  for (const city of ["seoul", "busan", "jeju"]) await hit(atlas.locator(`button[data-city="${city}"]`))
  await hit(page.getByTestId("ondo-b-personalization-edit"))
}

async function reachableFeedbackAction(page: Page, target: Locator) {
  await tabTo(page, target)
  await expect(target).toBeFocused()
  await hit(target)
  const geometry = await target.evaluate(node => {
    const rect = node.getBoundingClientRect()
    let top = 0
    let bottom = innerHeight
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      if (/^(auto|scroll|hidden|clip)$/.test(getComputedStyle(parent).overflowY)) {
        const bounds = parent.getBoundingClientRect()
        top = Math.max(top, bounds.top)
        bottom = Math.min(bottom, bounds.bottom)
      }
    }
    return { height: rect.height, visibleHeight: Math.min(rect.bottom, bottom) - Math.max(rect.top, top) }
  })
  expect(geometry.height).toBeGreaterThanOrEqual(44)
  expect(geometry.visibleHeight, "Keyboard focus must expose the whole 44px action inside the scrollport").toBeGreaterThanOrEqual(43)
}

test("LAYOUT-BOUNDARY01 JA nation demo modal restores dock reserve, targets and opener focus", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await enterNation(page)
  await nationTargets(page)
  await dockGeometry(page, true)
  const demo = page.getByTestId("review-sample-indicator")
  for (let pass = 0; pass < 2; pass += 1) {
    await demo.click()
    const modal = page.getByRole("dialog").filter({ has: page.getByTestId("product-guide") })
    await expect(modal).toBeVisible()
    await expect(page.getByTestId("ondo-main-nav")).toBeHidden()
    await tabTo(page, modal.getByRole("button", { name: "閉じる", exact: true }))
    await page.keyboard.press(pass === 0 ? "Escape" : "Enter")
    await expect(modal).toHaveCount(0)
    await expect(demo).toBeFocused()
    await nationTargets(page)
    await dockGeometry(page, true)
  }
  await page.screenshot({ path: testInfo.outputPath("ja-nation-after-modal.png"), scale: "css" })
})

test("LAYOUT-BOUNDARY02 repeated 800/801 breakpoint changes preserve nation and city controls", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 800, height: 900 })
  await enterNation(page, "en")
  for (const width of [800, 801, 800, 801]) {
    await page.setViewportSize({ width, height: 900 })
    await nationTargets(page)
    await dockGeometry(page, width <= 800)
  }
  await page.getByTestId("ondo-b-korea-atlas").locator('button[data-city="seoul"]').click()
  await expect(page.getByTestId("maplibre-map")).toHaveAttribute("data-map-mode", "city")
  for (const width of [800, 801, 800]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(page.getByTestId("ondo-b-map-entry")).toHaveAttribute("data-city", "seoul")
    await dockGeometry(page, width <= 800)
    await hit(page.getByTestId("ondo-b-view-toggle"))
  }
  await page.screenshot({ path: testInfo.outputPath("city-after-800-801-resize.png"), scale: "css" })
})

test("LAYOUT-BOUNDARY03 JA320x480 denied Options and off notice survive ID return with keyboard undo/dismiss", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 480 })
  await enterNation(page)
  await page.getByTestId("ondo-b-korea-atlas").locator('button[data-city="seoul"]').click()
  const map = page.getByTestId("ondo-b-map-entry")
  await expect(map).toHaveAttribute("data-compact-chrome", "true")
  await page.getByTestId("global-after19-toggle").click()
  // Public tab-only declaration; never installs a review age receipt.
  await page.getByTestId("global-after19-confirm").click()
  await expect(page.getByTestId("global-after19-prompt-layer")).toHaveCount(0)
  await expect(page.getByTestId("global-after19-banner")).toHaveAttribute("data-review-result", "false")
  const options = page.getByTestId("ondo-b-map-options-open")
  await options.click()
  await page.getByTestId("ondo-b-map-options-locate").click()
  await expect(map).toHaveAttribute("data-location-state", "denied")
  // Locate intentionally closes Options before invoking the browser request.
  // Reopen the public panel to inspect the resulting denial explanation.
  await expect(page.getByTestId("ondo-b-map-options-done")).toHaveCount(0)
  await options.click()
  const privacy = page.getByTestId("ondo-b-map-options-location-privacy")
  await tabTo(page, privacy.locator("summary"))
  await page.keyboard.press("Enter")
  await expect(privacy.locator("p")).toBeVisible()
  await expect(privacy.locator("p")).not.toHaveText("")
  await privacy.locator("p").scrollIntoViewIfNeeded()
  await expect(privacy.locator("p")).toBeInViewport()
  await page.screenshot({ path: testInfo.outputPath("ja320-denied-options.png"), scale: "css" })
  await tabTo(page, page.getByTestId("ondo-b-map-options-done"))
  await page.keyboard.press("Enter")
  await expect(options).toBeFocused()
  await page.getByTestId("global-after19-banner").getByRole("button").click()
  const notice = page.getByTestId("global-after19-off-notice")
  await expect(notice).toBeVisible()
  await page.getByTestId("nav-id").click()
  await expect(page.getByTestId("ondo-tab-panel-ondo")).toHaveAttribute("aria-hidden", "true")
  await expect(notice).toBeHidden()
  await page.getByTestId("nav-ondo").click()
  await expect(map).toHaveAttribute("data-city", "seoul")
  await expect(map).toHaveAttribute("data-location-state", "denied")
  await expect(map).toHaveAttribute("data-compact-chrome", "true")
  await expect(map).toHaveAttribute("data-after19-active", "false")
  await dockGeometry(page, true)
  const undo = notice.getByRole("button", { name: "もう一度オンにする", exact: true })
  await reachableFeedbackAction(page, undo)
  await page.screenshot({ path: testInfo.outputPath("ja320-feedback-after-id-return.png"), scale: "css" })
  await page.keyboard.press("Space")
  await expect(map).toHaveAttribute("data-after19-active", "true")
  await expect(notice).toHaveCount(0)
  await page.getByTestId("global-after19-banner").getByRole("button").click()
  const dismiss = notice.getByRole("button", { name: "閉じる", exact: true })
  await reachableFeedbackAction(page, dismiss)
  await page.keyboard.press("Enter")
  await expect(notice).toHaveCount(0)
  await expect(page.getByTestId("global-after19-toggle")).toBeFocused()
  await expect(map).toHaveAttribute("data-after19-active", "false")
  await expect(map).toHaveAttribute("data-location-state", "denied")
})
