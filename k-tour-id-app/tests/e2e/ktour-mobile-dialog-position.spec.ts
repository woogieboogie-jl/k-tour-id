import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test"

type Check = "person" | "age"
type Origin = { check: Check; scrollTop: number }
const failures = new WeakMap<Page, string[]>()
const modal = (page: Page) => page.getByTestId("ondo-b-local-check-walkthrough")

test.describe.configure({ timeout: 60_000 })
test.beforeEach(async ({ page }) => {
  failures.set(page, [])
  page.on("pageerror", error => failures.get(page)!.push(error.stack ?? error.message))
  await page.route("**/*", async route => {
    const request = route.request()
    const url = new URL(request.url())
    // This local UI regression must never exercise a real provider or mutation.
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method()) || /sumsub|onfido|omni.?one|opendid|fullnode|sui\.io|walletconnect|stripe/i.test(url.hostname)) {
      failures.get(page)!.push(`${request.method()} ${url.origin}`)
      await route.abort("blockedbyclient")
      return
    }
    await route.continue()
  })
})
test.afterEach(({ page }) => expect(failures.get(page) ?? []).toEqual([]))

async function boot(page: Page, baseURL: string | undefined, options: { review?: boolean; width?: number; height?: number; locale?: "en" | "ko"; dark?: boolean; motion?: boolean } = {}) {
  await page.setViewportSize({ width: options.width ?? 390, height: options.height ?? 844 })
  await page.emulateMedia({ reducedMotion: options.motion ? "no-preference" : "reduce" })
  // Display/onboarding preferences only, restricted to this exact app origin.
  // Account, proofs, consent, and results are reached through visible controls.
  await page.addInitScript(({ origin, locale, appearance }) => {
    if (window.location.origin !== origin) return
    localStorage.setItem("ondo-b.device.v1", JSON.stringify({ locale, appearancePreference: appearance, onboarding: "ONB-COMPLETE" }))
  }, { origin: new URL(baseURL ?? "http://127.0.0.1:3112").origin, locale: options.locale ?? "en", appearance: options.dark ? "dark" : "light" })
  await page.goto(`/?review=${options.review === false ? "0" : "1"}`, { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("ondo-b-root")).toHaveAttribute("data-hydrated", "true")
  await page.getByTestId("nav-id").click()
  const readiness = page.getByTestId("travel-pass-readiness-toggle")
  if (!await readiness.evaluate(node => node.closest("details")?.open)) await readiness.click()
}

async function hitTarget(locator: Locator) {
  const geometry = await locator.evaluate(node => {
    const rect = node.getBoundingClientRect()
    const x = rect.x + rect.width / 2
    const y = rect.y + rect.height / 2
    const hit = document.elementFromPoint(x, y)
    return { x, y, width: rect.width, height: rect.height, insideViewport: x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight, hit: Boolean(hit && (node === hit || node.contains(hit))) }
  })
  expect(geometry.width).toBeGreaterThan(0)
  expect(geometry.height).toBeGreaterThan(0)
  expect(geometry.insideViewport, `Offscreen target: ${JSON.stringify(geometry)}`).toBe(true)
  expect(geometry.hit, `Obscured target: ${JSON.stringify(geometry)}`).toBe(true)
  return geometry
}

async function coordinateClick(page: Page, locator: Locator) {
  const point = await hitTarget(locator)
  await page.mouse.click(point.x, point.y)
}

async function openFromScrolledPass(page: Page, check: Check): Promise<Origin> {
  const opener = page.getByTestId(`traveler-id-${check}-check`)
  // Intentionally scroll the real Pass before opening. No dialog locator action
  // is allowed to auto-scroll the page and conceal the original M01 defect.
  await opener.evaluate(node => node.scrollIntoView({ block: "center", behavior: "instant" }))
  const scrollTop = await page.getByTestId("ondo-scroll-region").evaluate(node => node.scrollTop)
  expect(scrollTop).toBeGreaterThan(100)
  await coordinateClick(page, opener)
  await expect(modal(page)).toHaveAttribute("data-check-kind", check)
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  return { check, scrollTop }
}

async function assertPosition(page: Page, info: TestInfo, label: string) {
  // These are read-only geometry assertions BEFORE any dialog locator click.
  const geometry = await modal(page).evaluate(node => {
    const rect = node.getBoundingClientRect()
    const canvas = document.querySelector('[data-testid="ondo-canvas"]')!.getBoundingClientRect()
    const active = document.activeElement
    const focused = active?.getBoundingClientRect()
    return {
      dialog: { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
      canvas: { x: canvas.x, y: canvas.y, right: canvas.right, bottom: canvas.bottom },
      viewport: { width: innerWidth, height: innerHeight },
      activeInside: Boolean(active && node.contains(active)),
      focusVisible: Boolean(focused && focused.top >= 0 && focused.bottom <= innerHeight),
      parentIsCanvas: node.parentElement?.parentElement?.getAttribute("data-testid") === "ondo-canvas",
    }
  })
  await info.attach(`${label}-geometry`, { body: JSON.stringify(geometry, null, 2), contentType: "application/json" })
  await page.screenshot({ path: info.outputPath(`${label}.png`), scale: "css" })
  expect(geometry.dialog.y, "Dialog must not inherit the Pass scroll offset").toBeGreaterThanOrEqual(geometry.canvas.y - 1)
  expect(geometry.dialog.bottom).toBeLessThanOrEqual(Math.min(geometry.canvas.bottom, geometry.viewport.height) + 1)
  expect(geometry.dialog.x).toBeGreaterThanOrEqual(geometry.canvas.x - 1)
  expect(geometry.dialog.right).toBeLessThanOrEqual(geometry.canvas.right + 1)
  expect(geometry.activeInside).toBe(true)
  expect(geometry.focusVisible).toBe(true)
  await hitTarget(modal(page).locator("header button"))
  await expect(page.getByTestId("ondo-canvas")).toHaveAttribute("data-ondo-modal-open", "true")
  expect(await page.getByTestId("ondo-b-traveler-id").evaluate(node => Boolean(node.closest('[inert], [aria-hidden="true"]')))).toBe(true)
  await expect(page.getByTestId("nav-id")).not.toBeVisible()
  await expect(page.locator('[role="dialog"][aria-modal="true"]')).toHaveCount(1)
}

async function assertReturned(page: Page, origin: Origin) {
  await expect(modal(page)).toHaveCount(0)
  await expect(page.getByTestId("ondo-canvas")).not.toHaveAttribute("data-ondo-modal-open", "true")
  await expect.poll(async () => Math.abs(await page.getByTestId("ondo-scroll-region").evaluate(node => node.scrollTop) - origin.scrollTop)).toBeLessThanOrEqual(1)
  const opener = page.getByTestId(`traveler-id-${origin.check}-check`)
  await expect(opener).toBeFocused()
  await hitTarget(opener)
  await expect(page.getByTestId("nav-id")).toBeVisible()
  expect(await page.getByTestId("ondo-b-traveler-id").evaluate(node => Boolean(node.closest('[inert], [aria-hidden="true"]')))).toBe(false)
}

async function personConsent(page: Page) {
  if (await page.getByTestId("direct-person-account-continue").count()) await page.getByTestId("direct-person-account-continue").click()
  await expect(modal(page)).toHaveAttribute("data-check-phase", "route")
  await page.getByTestId("direct-person-route-mobile-id").click()
  await expect(modal(page)).toHaveAttribute("data-check-phase", "consent")
}

test("M01 coordinate Person opener remains viewport-owned and restores exact origin", async ({ page, baseURL }, info) => {
  await boot(page, baseURL)
  for (const method of ["escape", "header"] as const) {
    const origin = await openFromScrolledPass(page, "person")
    await page.waitForTimeout(400)
    await assertPosition(page, info, `person-${method}`)
    await hitTarget(page.getByTestId("direct-person-account-continue"))
    if (method === "escape") await page.keyboard.press("Escape")
    else await coordinateClick(page, modal(page).locator("header button"))
    await assertReturned(page, origin)
  }
  await expect(page.getByTestId("traveler-id-person")).toHaveAttribute("data-status", "none")
})

test("M01 Age consent is reachable and declining restores the scrolled Pass", async ({ page, baseURL }, info) => {
  await boot(page, baseURL)
  const origin = await openFromScrolledPass(page, "age")
  await assertPosition(page, info, "age-consent")
  await hitTarget(page.getByTestId("local-check-boundary-continue"))
  await modal(page).locator('[data-testid="local-check-consent"] button').last().click()
  await assertReturned(page, origin)
  await expect(page.getByTestId("traveler-id-age")).toHaveAttribute("data-status", "none")
})

test("M01 normal Person and Age remain unavailable without promoting proof", async ({ page, baseURL }, info) => {
  await boot(page, baseURL, { review: false })
  for (const check of ["person", "age"] as const) {
    const origin = await openFromScrolledPass(page, check)
    await assertPosition(page, info, `normal-${check}`)
    await expect(modal(page)).toHaveAttribute("data-execution-mode", "normal")
    if (check === "person") {
      await page.getByTestId("direct-person-account-continue").click()
      await page.getByTestId("direct-person-route-mobile-id").click()
    } else await page.getByTestId("local-check-boundary-continue").click()
    await expect(page.getByTestId("local-check-result")).toHaveAttribute("data-result", "unavailable")
    await page.getByTestId("direct-person-return").click()
    await assertReturned(page, origin)
    await expect(page.getByTestId(`traveler-id-${check}`)).not.toHaveAttribute("data-status", "success")
  }
  await expect(page.getByTestId("traveler-id-payment")).toHaveAttribute("data-status", "none")
})

test("M01 public review completion preserves independent Person and Age axes", async ({ page, baseURL }, info) => {
  await boot(page, baseURL)
  const personOrigin = await openFromScrolledPass(page, "person")
  await assertPosition(page, info, "review-person")
  await personConsent(page)
  await page.getByTestId("local-check-boundary-continue").click()
  await assertReturned(page, personOrigin)
  await expect(page.getByTestId("traveler-id-person")).toHaveAttribute("data-status", "success")
  await expect(page.getByTestId("traveler-id-person")).not.toHaveAttribute("data-review-result", "none")
  await expect(page.getByTestId("traveler-id-age")).toHaveAttribute("data-status", "none")
  const ageOrigin = await openFromScrolledPass(page, "age")
  await assertPosition(page, info, "review-age")
  await page.getByTestId("local-check-boundary-continue").click()
  await assertReturned(page, ageOrigin)
  await expect(page.getByTestId("traveler-id-age")).toHaveAttribute("data-status", "success")
  await expect(page.getByTestId("traveler-id-age")).toHaveAttribute("data-review-result", "true")
  await expect(page.getByTestId("traveler-id-payment")).toHaveAttribute("data-status", "none")
  await expect(page.getByTestId("traveler-id-credential")).not.toHaveAttribute("data-status", "review-draft")
})

test("M01 cancel during animated processing cannot promote Person later", async ({ page, baseURL }, info) => {
  await boot(page, baseURL, { motion: true })
  const origin = await openFromScrolledPass(page, "person")
  await page.waitForTimeout(300)
  await assertPosition(page, info, "processing-origin")
  await personConsent(page)
  await page.getByTestId("local-check-boundary-continue").click()
  await expect(modal(page)).toHaveAttribute("data-check-phase", "processing")
  await page.keyboard.press("Escape")
  await expect(modal(page)).toHaveAttribute("aria-busy", "true")
  await expect(page.getByTestId("ondo-canvas")).toHaveAttribute("data-ondo-modal-open", "true")
  await assertReturned(page, origin)
  await page.waitForTimeout(800)
  await expect(page.getByTestId("traveler-id-person")).toHaveAttribute("data-status", "none")
  await expect(page.getByTestId("traveler-id-age")).toHaveAttribute("data-status", "none")
})

test("M01 Korean dark 320px preserves viewport, inner scroll, and exact return", async ({ page, baseURL }, info) => {
  await boot(page, baseURL, { width: 320, height: 568, locale: "ko", dark: true })
  const origin = await openFromScrolledPass(page, "person")
  await assertPosition(page, info, "ko-dark-320")
  await personConsent(page)
  await page.getByTestId("local-check-boundary").locator("summary").click()
  const body = modal(page).locator("[data-local-check-body]")
  expect(await body.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true)
  await body.hover()
  await page.mouse.wheel(0, 700)
  await expect.poll(() => body.evaluate(node => node.scrollTop)).toBeGreaterThan(0)
  expect(await page.getByTestId("ondo-scroll-region").evaluate(node => node.scrollTop)).toBe(origin.scrollTop)
  await page.getByTestId("local-check-boundary-continue").scrollIntoViewIfNeeded()
  await hitTarget(page.getByTestId("local-check-boundary-continue"))
  await coordinateClick(page, modal(page).locator("header button"))
  await assertReturned(page, origin)
})

test("M01 820px canvas and short landscape keep checks inside their viewport", async ({ page, baseURL }, info) => {
  await boot(page, baseURL, { width: 820, height: 1000 })
  let origin = await openFromScrolledPass(page, "person")
  await assertPosition(page, info, "desktop-canvas-820")
  await page.keyboard.press("Escape")
  await assertReturned(page, origin)
  await page.setViewportSize({ width: 820, height: 390 })
  origin = await openFromScrolledPass(page, "age")
  await assertPosition(page, info, "short-landscape-820")
  await page.getByTestId("local-check-boundary-continue").scrollIntoViewIfNeeded()
  await hitTarget(page.getByTestId("local-check-boundary-continue"))
  expect(await page.getByTestId("ondo-scroll-region").evaluate(node => node.scrollTop)).toBe(origin.scrollTop)
  await coordinateClick(page, modal(page).locator("header button"))
  await assertReturned(page, origin)
})
