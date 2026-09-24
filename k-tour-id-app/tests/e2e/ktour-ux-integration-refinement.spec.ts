import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test"

// Local presentation regression only. No provider, chain, payment or BFF
// mutation is needed to inspect a picker, decline consent, or read a guide.
const faults = new WeakMap<Page, string[]>()
type Profile = { width: number; height: number; locale: "en" | "ko" | "ja"; theme: "light" | "dark" }
const profiles: Profile[] = [
  { width: 390, height: 844, locale: "en", theme: "dark" },
  { width: 320, height: 568, locale: "ja", theme: "light" },
  { width: 844, height: 390, locale: "ko", theme: "dark" },
]
test.describe.configure({ timeout: 90_000 })
test.beforeEach(async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL ?? "http://127.0.0.1:3112")
  if (origin.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)) throw new Error("Use an explicitly managed loopback server")
  const errors: string[] = []
  faults.set(page, errors)
  page.on("pageerror", error => errors.push(error.message))
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin !== origin.origin) {
      // Map/image assets may be unavailable; an external document or provider
      // attempt is a test failure even when it is only a GET.
      if (request.isNavigationRequest() || !["GET", "HEAD", "OPTIONS"].includes(request.method()) || /accounts\.google|enoki|sumsub|onfido|omni.?one|opendid|fullnode|sui\.io|walletconnect|stripe/i.test(url.hostname)) errors.push(`External request: ${request.method()} ${url.origin}`)
      return route.abort("blockedbyclient")
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
      errors.push(`Unexpected mutation: ${request.method()} ${url.pathname}`)
      return route.abort("blockedbyclient")
    }
    return route.continue()
  })
})
test.afterEach(({ page }) => expect(faults.get(page) ?? []).toEqual([]))

async function boot(page: Page, baseURL: string | undefined, profile: Profile, path = "/?review=1") {
  await page.setViewportSize(profile)
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.addInitScript(({ origin, locale, theme }) => {
    if (location.origin !== origin) return
    localStorage.setItem("ondo-b.device.v1", JSON.stringify({ locale, appearancePreference: theme, onboarding: "ONB-COMPLETE" }))
  }, { origin: new URL(baseURL ?? "http://127.0.0.1:3112").origin, locale: profile.locale, theme: profile.theme })
  await page.goto(path, { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("ondo-b-root")).toHaveAttribute("data-hydrated", "true", { timeout: 40_000 })
  await page.evaluate(() => document.fonts.ready)
}

for (const profile of profiles.slice(0, 2)) {
  test(`empty Pass stays compact and explicit review clicks still collect and reset stamps ${profile.locale} ${profile.width}`, async ({ page, baseURL }, info) => {
    await boot(page, baseURL, profile)
    await page.getByTestId("nav-id").click()
    const card = page.getByTestId("ondo-b-stamp-milestone")
    await expect(card).toHaveAttribute("data-stamps", "0")
    await expect(card).toContainText("0/10")
    await expect(card.getByTestId("journey-stamps-lifetime")).toBeVisible()
    await expect(card.getByRole("img")).toHaveCount(0)
    expect((await card.boundingBox())!.height).toBeLessThanOrEqual(150)
    await evidence(page, info, "compact-empty-pass")
    await card.getByTestId("journey-stamps-explore").click()
    await expect(page.getByTestId("ondo-b-action-gate")).toHaveCount(0)
    await expect(page.getByTestId("ondo-b-traveler-id")).toHaveCount(0)

    const place = "mois-0021cd596bc5b2a922ad"
    await page.goto(`/?review=1&city=seoul&view=list&venueId=${place}&detail=1`, { waitUntil: "domcontentloaded" })
    await page.getByTestId("canonical-journey-open").click()
    const visit = page.getByTestId("journey-visit-sheet")
    await expect(visit).toHaveAttribute("data-recorded", "false")
    // This explicit review-only button creates a local sample visit, never a
    // real proof, payment, provider request or chain record.
    await visit.getByTestId("visit-proof-check").click()
    await expect(visit).toHaveAttribute("data-recorded", "true")
    await page.getByTestId("journey-visit-return").click()
    await expect(visit).toHaveCount(0)
    await page.getByTestId("canonical-place-overlay").locator("[data-place-return-focus='detail_close']").click()
    await page.getByTestId("nav-id").click()
    await expect(card).toHaveAttribute("data-stamps", "1")
    await expect(card.getByRole("img")).toHaveCount(1)
    await expect(card.locator("[data-filled='true']")).toHaveCount(1)
    await card.getByTestId("journey-stamps-open").click()
    const collection = page.getByTestId("journey-stamps-collection")
    await expect(collection).toHaveAttribute("data-stamps", "1")
    await expect(collection.getByTestId("journey-stamp-row")).toHaveAttribute("data-venue-id", place)
    await page.keyboard.press("Escape")
    await expect(collection).toHaveCount(0)
    await expect(card.getByTestId("journey-stamps-open")).toBeFocused()

    await page.goto("/?review=1", { waitUntil: "domcontentloaded" })
    await page.getByTestId("nav-id").click()
    await expect(card).toHaveAttribute("data-stamps", "0")
    await expect(card.getByRole("img")).toHaveCount(0)
    await expect(card.getByTestId("journey-stamps-lifetime")).toBeVisible()
    await page.goto("/?review=0", { waitUntil: "domcontentloaded" })
    await page.getByTestId("nav-id").click()
    await expect(card).toHaveAttribute("data-mode", "unavailable")
    await expect(card).not.toContainText("0/10")
    await expect(card).toContainText(profile.locale === "en" ? "isn’t connected" : "まだ接続されていません")
    await expect(card.getByRole("img")).toHaveCount(0)
    await evidence(page, info, "normal-pass-unavailable-preserved")
  })
}

test("wallet has one places entry and preserves sample balance and top-up purpose", async ({ page, baseURL }, info) => {
  await boot(page, baseURL, profiles[0], "/?review=1&city=seoul")
  await page.getByTestId("nav-id").click()
  const wallet = page.getByTestId("ondo-b-id-wallet-commerce")
  const benefit = page.getByTestId("wallet-benefit")
  await expect(wallet.getByTestId("wallet-balance-places")).toHaveCount(1)
  await expect(benefit.getByTestId("wallet-balance-places")).toHaveCount(1)
  await expect(benefit.getByRole("button")).toHaveCount(1)
  await expect(benefit).toContainText("3,000")
  await page.getByTestId("wallet-link-open").click()
  const setup = page.getByTestId("wallet-connect-sheet")
  await expect(setup).toContainText("No real funds are added")
  await setup.getByRole("button", { name: "Set up travel wallet", exact: true }).click()
  await expect(setup).toHaveCount(0)
  await expect(page.getByTestId("wallet-display-equivalent")).toContainText("60,000")
  await expect(page.getByTestId("wallet-review-provenance")).toBeVisible()
  await page.getByTestId("wallet-add-funds").click()
  const funding = page.getByTestId("funding-source-sheet")
  await expect(funding).toHaveAttribute("data-funding-purpose", "topup")
  await expect(funding.getByRole("radio", { name: /Travel balance/ })).toHaveCount(0)
  await page.keyboard.press("Escape")
  await expect(funding).toHaveCount(0)
  await expect(page.getByTestId("wallet-display-equivalent")).toContainText("60,000")
  await wheelTo(page, benefit.getByTestId("wallet-balance-places"))
  await evidence(page, info, "wallet-single-places-entry")
  await coordinateClick(page, benefit.getByTestId("wallet-balance-places"))
  await expect(page.getByTestId("ondo-b-map-entry")).toHaveAttribute("data-balance-places-filter", "on")
  await expect(page.getByTestId("ondo-b-action-gate")).toHaveCount(0)
  await expect(page.getByTestId("payment-receipt")).toHaveCount(0)
  await page.getByTestId("nav-id").click()
  await expect(page.getByTestId("wallet-display-equivalent")).toContainText("60,000")
  await expect(page.getByTestId("ondo-b-stamp-milestone")).toHaveAttribute("data-stamps", "0")
})

// Verify the entire target against every overflow-clipping ancestor, before
// any locator click can auto-scroll and hide the original defect.
async function unclipped(target: Locator, hitTest = false) {
  const result = await target.evaluate(node => {
    const rect = node.getBoundingClientRect()
    let left = 0, top = 0, right = innerWidth, bottom = innerHeight
    for (let ancestor = node.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor), box = ancestor.getBoundingClientRect()
      if (/auto|scroll|hidden|clip/.test(style.overflowX)) { left = Math.max(left, box.left); right = Math.min(right, box.right) }
      if (/auto|scroll|hidden|clip/.test(style.overflowY)) { top = Math.max(top, box.top); bottom = Math.min(bottom, box.bottom) }
    }
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
    return { rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }, clip: { left, top, right, bottom }, hit: Boolean(hit && node.contains(hit)) }
  })
  expect(result.rect.left, JSON.stringify(result)).toBeGreaterThanOrEqual(result.clip.left - 1)
  expect(result.rect.top, JSON.stringify(result)).toBeGreaterThanOrEqual(result.clip.top - 1)
  expect(result.rect.right, JSON.stringify(result)).toBeLessThanOrEqual(result.clip.right + 1)
  expect(result.rect.bottom, JSON.stringify(result)).toBeLessThanOrEqual(result.clip.bottom + 1)
  if (hitTest) {
    expect(result.rect.width).toBeGreaterThanOrEqual(44)
    expect(result.rect.height).toBeGreaterThanOrEqual(44)
    expect(result.hit).toBe(true)
  }
  return result.rect
}

async function coordinateClick(page: Page, control: Locator) {
  const rect = await unclipped(control, true)
  await page.mouse.click((rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2)
}

async function wheelTo(page: Page, control: Locator) {
  const viewport = page.viewportSize()!
  await page.mouse.move(viewport.width / 2, viewport.height / 2)
  for (let attempt = 0; attempt < 18; attempt++) {
    const target = await control.evaluate(node => {
      const rect = node.getBoundingClientRect()
      let top = 0, bottom = innerHeight
      for (let ancestor = node.parentElement; ancestor; ancestor = ancestor.parentElement) {
        if (!/auto|scroll|hidden|clip/.test(getComputedStyle(ancestor).overflowY)) continue
        const clip = ancestor.getBoundingClientRect()
        top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom)
      }
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
      return { visible: rect.top >= top && rect.bottom <= bottom && Boolean(hit && node.contains(hit)), above: rect.top < top }
    })
    if (target.visible) return
    await page.mouse.wheel(0, target.above ? -160 : 160)
    await page.waitForTimeout(90)
  }
  throw new Error("Could not reach the control with natural wheel scrolling")
}

async function evidence(page: Page, info: TestInfo, name: string) {
  await page.screenshot({ path: info.outputPath(`${name}.png`), scale: "css" })
}

for (const profile of profiles) {
  test(`sample picker stays outside scrolled Pass and restores origin ${profile.locale} ${profile.width}`, async ({ page, baseURL }, info) => {
    await boot(page, baseURL, profile)
    await page.getByTestId("nav-id").click()
    const opener = page.getByTestId("kpass-sample-picker")
    // Start with the real 330px wheel movement used in the defect report.
    await page.mouse.move(profile.width / 2, profile.height / 2)
    await page.mouse.wheel(0, 330)
    await page.waitForTimeout(120)
    await wheelTo(page, opener)
    const scroller = page.getByTestId("ondo-scroll-region")
    const before = await scroller.evaluate(node => node.scrollTop)
    expect(before).toBeGreaterThan(0)
    await coordinateClick(page, opener)
    const sheet = page.getByTestId("ondo-sheet").filter({ has: page.getByTestId("kpass-sample-picker-body") })
    await expect(sheet).toBeVisible()
    await expect(sheet.locator("[data-sheet-navigation='close']")).toBeFocused()
    expect(await sheet.evaluate(node => node.parentElement?.parentElement?.getAttribute("data-testid"))).toBe("ondo-canvas")
    await unclipped(sheet.locator("[data-sheet-header]"))
    await unclipped(sheet.locator("[data-sheet-header] > div"))
    await unclipped(sheet.locator("[data-sheet-navigation='close']"), true)
    expect(await sheet.evaluate(node => {
      const layer = node.parentElement!.getBoundingClientRect(), canvas = node.parentElement!.parentElement!.getBoundingClientRect()
      return Math.abs(layer.top - canvas.top) < 2 && Math.abs(layer.bottom - canvas.bottom) < 2
    })).toBe(true)
    await evidence(page, info, "scrolled-picker-before-locator-click")
    await page.keyboard.press("Escape")
    await expect(sheet).toHaveCount(0)
    await expect(opener).toBeFocused()
    await expect.poll(async () => Math.abs(await scroller.evaluate(node => node.scrollTop) - before)).toBeLessThanOrEqual(1)
    await coordinateClick(page, opener)
    await expect(sheet).toBeVisible()
    await sheet.getByTestId("kpass-scenario-age_unknown").click()
    await expect(sheet).toHaveCount(0)
    await expect(opener).toBeFocused()
    await coordinateClick(page, opener)
    await expect(sheet.getByTestId("kpass-scenario-age_unknown")).toHaveAttribute("aria-pressed", "true")
    await coordinateClick(page, sheet.locator("[data-sheet-navigation='close']"))
    await expect(opener).toBeFocused()
  })

  test(`identity review boundary is readable without approving identity ${profile.locale} ${profile.width}`, async ({ page, baseURL }, info) => {
    await boot(page, baseURL, profile)
    await page.getByTestId("nav-id").click()
    await page.getByTestId("travel-pass-readiness-toggle").click()
    const opener = page.getByTestId("traveler-id-person-check")
    await opener.click()
    const modal = page.getByTestId("ondo-b-local-check-walkthrough")
    if (await page.getByTestId("direct-person-account-continue").count()) await page.getByTestId("direct-person-account-continue").click()
    await page.getByTestId("direct-person-route-mobile-id").click()
    await expect(modal).toHaveAttribute("data-check-phase", "consent")
    const truth = page.getByTestId("direct-person-review-scope")
    await unclipped(truth)
    const contrast = await truth.evaluate(node => {
      const rgb = (value: string) => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number).map(value => value / 255)
      const light = (values: number[]) => values.map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0)
      const ink = getComputedStyle(node).color
      let ancestor: Element | null = node, background = ""
      while (ancestor) { background = getComputedStyle(ancestor).backgroundColor; if (background !== "rgba(0, 0, 0, 0)" && background !== "transparent") break; ancestor = ancestor.parentElement }
      const a = light(rgb(ink)), b = light(rgb(background))
      return { ink, background, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), size: parseFloat(getComputedStyle(node).fontSize) }
    })
    await info.attach("identity-boundary-contrast", { body: JSON.stringify(contrast), contentType: "application/json" })
    expect(contrast.ratio).toBeGreaterThanOrEqual(4.5)
    expect(contrast.size).toBeGreaterThanOrEqual(15)
    await evidence(page, info, "identity-consent-no-approval")
    await coordinateClick(page, modal.locator("header button"))
    await expect(modal).toHaveCount(0)
    await expect(opener).toBeFocused()
    await expect(page.getByTestId("traveler-id-person")).toHaveAttribute("data-status", "none")
  })

  test(`place rows preserve reading, visit and reservation returns ${profile.locale} ${profile.width}`, async ({ page, baseURL }, info) => {
    const place = "mois-0021cd596bc5b2a922ad"
    await boot(page, baseURL, profile, `/?review=1&city=seoul&view=list&venueId=${place}&detail=1`)
    const detail = page.getByTestId("canonical-place-overlay")
    await expect(detail).toHaveAttribute("data-venue-id", place)
    await expect(detail.locator("[data-detail-state]").first()).not.toHaveAttribute("data-detail-state", "loading")
    const header = detail.locator(":scope > article > header")
    const assertHeader = async () => {
      await unclipped(header)
      await unclipped(header.locator(":scope > span"))
      for (const button of await header.locator("button").all()) {
        await unclipped(button, true)
        await unclipped(button.locator("svg"))
      }
    }
    await assertHeader()
    const pulse = detail.getByTestId("canonical-place-pulse").locator(":scope > summary")
    expect((await pulse.boundingBox())!.height).toBeLessThanOrEqual(72)
    const actions = detail.getByTestId("place-service-actions")
    await expect(actions).toHaveAttribute("data-service-layout", "rows")
    for (const id of ["experience-open", "canonical-meal-benefit-open", "place-reservation-open", "hackathon-entitlement-open", "canonical-journey-open", "canonical-place-table"]) await expect(detail.getByTestId(id)).toHaveCount(1)
    const placeActions = detail.getByTestId("canonical-place-actions")
    const tripActions = detail.getByTestId("canonical-trip-actions")
    await expect(placeActions).toHaveCount(1)
    await expect(tripActions).toHaveCount(1)
    expect(await placeActions.evaluate(node => Boolean(node.compareDocumentPosition(document.querySelector('[data-testid="canonical-trip-actions"]')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true)
    for (const id of ["canonical-meal-benefit-open", "place-reservation-open", "hackathon-entitlement-open"]) await expect(placeActions.getByTestId(id)).toHaveCount(1)
    for (const id of ["experience-open", "canonical-journey-open"]) await expect(tripActions.getByTestId(id)).toHaveCount(1)
    await expect(placeActions.getByTestId("canonical-place-table")).toHaveCount(0)
    await expect(tripActions.getByTestId("canonical-place-table")).toHaveCount(0)
    const widths = await actions.evaluate(node => Array.from(node.children).map(child => ({ parent: node.clientWidth, width: child.getBoundingClientRect().width, text: child.scrollWidth, inner: child.clientWidth })))
    for (const width of widths) {
      expect(Math.abs(width.parent - width.width)).toBeLessThanOrEqual(1)
      expect(width.text).toBeLessThanOrEqual(width.inner + 1)
    }
    await expect(detail.getByTestId("canonical-place-table")).toContainText({ en: "Dine with travelers", ko: "여행자와 함께 먹기", ja: "旅行者と食事" }[profile.locale])
    await expect(detail.getByTestId("place-reservation-open")).toContainText({ en: "Reserve a table", ko: "매장 예약", ja: "お店を予約" }[profile.locale])
    await evidence(page, info, "place-initial-header-and-hierarchy")
    const scroller = detail.locator("[data-place-return-scroll='detail']")
    for (const [id, surface] of [["experience-open", "experience-public-guide"], ["canonical-journey-open", "journey-visit-sheet"], ["place-reservation-open", "reservation-sample"]] as const) {
      const action = detail.getByTestId(id)
      await wheelTo(page, action)
      await assertHeader()
      const before = await scroller.evaluate(node => node.scrollTop)
      await evidence(page, info, `place-before-${id}`)
      await coordinateClick(page, action)
      const opened = page.getByTestId(surface)
      await expect(opened).toBeVisible()
      await expect(page.getByTestId("ondo-b-action-gate")).toHaveCount(0)
      if (surface === "experience-public-guide") {
        await expect(page.getByTestId("experience-flow")).toHaveCount(0)
        await expect(page.getByTestId("experience-guide-content").getByRole("heading", { level: 3 })).toHaveCount(3)
      } else await expect(opened).toHaveAttribute("data-venue-id", place)
      const sheet = page.getByTestId("ondo-sheet").filter({ has: opened })
      await unclipped(sheet.locator("[data-sheet-header]"))
      const close = sheet.locator("button[data-sheet-navigation]")
      await coordinateClick(page, close)
      await expect(opened).toHaveCount(0)
      await expect(detail).toHaveAttribute("data-venue-id", place)
      await expect(action).toBeFocused()
      await expect.poll(async () => Math.abs(await scroller.evaluate(node => node.scrollTop) - before)).toBeLessThanOrEqual(1)
      await assertHeader()
    }
    // No sample visit acceptance, reservation submission, payment approval,
    // or Harvey operation was performed by opening and returning.
    await expect(detail.getByTestId("canonical-journey-open")).toHaveAttribute("data-recorded", "false")
    await expect(page.getByTestId("hackathon-layer")).toHaveCount(0)
    await evidence(page, info, "place-after-all-returns")
  })
}
