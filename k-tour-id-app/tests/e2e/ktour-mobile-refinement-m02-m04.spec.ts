import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test"
import venues from "../../data/ondo-venues/canonical-venues-map.json" with { type: "json" }

// Run one approved item at a time, e.g. --grep "M02 quiet" --workers=1.
// A bare M02/M03/M04 would also match this filename and select every item.
// Only preferences are seeded. Account/Age/Table results use public review UI.
const PLACE = "mois-0021cd596bc5b2a922ad"
const DIRECTIONS = { en: "Directions", ko: "길찾기", ja: "経路を見る" } as const
type Locale = keyof typeof DIRECTIONS
type Appearance = "light" | "dark"
const faults = new WeakMap<Page, string[]>()

test.describe.configure({ timeout: 120_000 })
test.beforeEach(async ({ page, context }) => {
  const errors: string[] = []
  faults.set(page, errors)
  context.on("page", opened => opened.on("pageerror", error => errors.push(error.message)))
  page.on("pageerror", error => errors.push(error.message))
  await page.emulateMedia({ reducedMotion: "reduce" })
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url())
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method())
      || /sumsub|onfido|omni.?one|opendid|fullnode|sui\.io|walletconnect|stripe/i.test(url.hostname)) {
      errors.push(`Forbidden request: ${request.method()} ${url.origin}`)
      return route.abort("blockedbyclient")
    }
    return route.continue()
  })
})
test.afterEach(({ page }) => { expect(faults.get(page) ?? []).toEqual([]) })

async function preferences(page: Page, locale: Locale, appearance: Appearance) {
  await page.addInitScript(({ locale, appearance }) => {
    // Never touch storage in popup/about:blank/third-party documents.
    if (!/^https?:$/.test(location.protocol) || !["127.0.0.1", "localhost"].includes(location.hostname)) return
    localStorage.setItem("ondo-b.device.v1", JSON.stringify({ locale, appearancePreference: appearance, onboarding: "ONB-COMPLETE" }))
  }, { locale, appearance })
}

async function ready(page: Page, url: string) {
  await page.goto(url, { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("ondo-b-root")).toHaveAttribute("data-hydrated", "true", { timeout: 45_000 })
  await page.evaluate(() => document.fonts.ready)
}

async function evidence(page: Page, info: TestInfo, label: string) {
  await page.screenshot({ path: info.outputPath(`${label}.png`), scale: "css" })
  await info.attach(`${label}-artifact`, {
    body: JSON.stringify(await page.evaluate(() => ({
      url: location.href,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      resources: performance.getEntriesByType("resource").map(entry => entry.name).filter(name => /\/_next\/static\/.*\.(css|js)(\?|$)/.test(name)),
    })), null, 2),
    contentType: "application/json",
  })
}

async function hitTarget(control: Locator, page: Page) {
  const box = await control.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.width).toBeGreaterThanOrEqual(44)
  expect(box!.height).toBeGreaterThanOrEqual(44)
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1)
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1)
  expect(await control.evaluate(node => {
    const rect = node.getBoundingClientRect()
    return node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
  })).toBe(true)
  return box!
}

// Resolve transparent ancestor layers instead of treating transparent text
// elements as if they had a white background. These panels have flat surfaces;
// screenshots remain a separate paint oracle, not a substitute for this check.
async function textContrast(target: Locator) {
  return target.evaluate(node => {
    type RGBA = [number, number, number, number]
    function color(value: string): RGBA {
      const values = value.match(/[\d.]+/g)?.map(Number) ?? []
      if (value.startsWith("color(srgb")) return [values[0], values[1], values[2], values[3] ?? 1]
      if (/^rgba?\(/.test(value)) return [values[0] / 255, values[1] / 255, values[2] / 255, values[3] ?? 1]
      throw new Error(`Unsupported computed color: ${value}`)
    }
    function over(front: RGBA, back: RGBA): RGBA {
      const alpha = front[3] + back[3] * (1 - front[3])
      if (!alpha) return [0, 0, 0, 0]
      return [0, 1, 2].map(index => (front[index] * front[3] + back[index] * back[3] * (1 - front[3])) / alpha).concat(alpha) as RGBA
    }
    function luminance(value: RGBA) {
      const linear = value.slice(0, 3).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
      return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722
    }
    let background: RGBA = [0, 0, 0, 0]
    for (let element: Element | null = node; element && background[3] < .999; element = element.parentElement) {
      background = over(background, color(getComputedStyle(element).backgroundColor))
    }
    if (background[3] < .999) throw new Error("Contrast target has no opaque ancestor surface")
    const foreground = over(color(getComputedStyle(node).color), background)
    const a = luminance(foreground), b = luminance(background)
    return { text: node.textContent, foreground, background, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) }
  })
}

for (const locale of ["en", "ko", "ja"] as const) {
  for (const layout of [
    { width: 320, height: 568, appearance: "light" },
    { width: 390, height: 844, appearance: "dark" },
    { width: 430, height: 932, appearance: "light" },
    { width: 1440, height: 1000, appearance: "dark" },
  ] as const) {
    test(`M02 quiet Directions ${locale} ${layout.width} ${layout.appearance}`, async ({ page, context }, info) => {
      test.skip((layout.width < 1000) !== (info.project.name === "mobile-chromium"), "Match the real browser profile to the viewport")
      await page.setViewportSize(layout)
      await preferences(page, locale, layout.appearance)
      await ready(page, `/?review=0&city=seoul&view=list&venueId=${PLACE}&detail=1`)
      const detail = page.getByTestId("canonical-place-overlay")
      await expect(detail).toHaveAttribute("data-venue-id", PLACE)
      const group = detail.getByTestId("canonical-place-decisions")
      await group.scrollIntoViewIfNeeded()
      const action = group.getByTestId("canonical-venue-primary-directions")
      const save = group.getByTestId("canonical-venue-save")
      await expect(action).toHaveAccessibleName(DIRECTIONS[locale])
      await expect(action).toHaveAttribute("title", DIRECTIONS[locale])
      await expect(action).toHaveAttribute("target", "_blank")
      await expect(action).toHaveAttribute("rel", /noreferrer/)
      await expect(action).toHaveAttribute("data-place-return-focus", "directions")
      await expect(action.locator("svg")).toHaveAttribute("aria-hidden", "true")
      // Icon-only is intentional; no localized text may still overflow the box.
      expect(await action.innerText()).toBe("")
      const box = await hitTarget(action, page)
      expect(box.width).toBeLessThanOrEqual(56)
      const icon = await action.locator("svg").boundingBox()
      expect(icon!.width).toBeGreaterThanOrEqual(18)
      expect(icon!.x).toBeGreaterThanOrEqual(box.x)
      expect(icon!.x + icon!.width).toBeLessThanOrEqual(box.x + box.width)
      const saveBox = await hitTarget(save, page)
      if (layout.width <= 430) {
        expect(saveBox.width).toBeLessThanOrEqual(56)
        expect(box.x - (saveBox.x + saveBox.width)).toBeGreaterThanOrEqual(8)
        expect(box.x - (saveBox.x + saveBox.width)).toBeLessThanOrEqual(16)
      }
      const feature = venues.features.find(feature => feature.id === PLACE)!
      const [longitude, latitude] = feature.geometry.coordinates
      const href = await action.getAttribute("href")
      const destination = new URL(href!)
      expect(destination.origin).toBe("https://www.google.com")
      expect(destination.pathname).toBe("/maps/dir/")
      expect(destination.searchParams.get("destination")).toBe(`${latitude},${longitude}`)
      await expect(save).toHaveAttribute("aria-pressed", "false")
      await action.focus()
      await expect(action).toBeFocused()
      await evidence(page, info, "directions-icon-group")
      // Exercise the external action without contacting the map provider.
      await context.route("https://www.google.com/maps/dir/**", route => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Directions intercepted locally</title>" }))
      const popupPending = page.waitForEvent("popup")
      await action.click()
      const popup = await popupPending
      await popup.waitForLoadState("domcontentloaded")
      expect(popup.url()).toBe(href)
      await popup.close()
      await expect(detail).toHaveAttribute("data-venue-id", PLACE)
      await expect(save).toHaveAttribute("aria-pressed", "false")
      expect(await group.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
    })
  }
}

for (const appearance of ["light", "dark"] as const) {
  for (const city of ["seoul", "jeju"] as const) {
    test(`M03 map legend ${appearance} ${city} standard and After19`, async ({ page }, info) => {
      test.skip(info.project.name !== "mobile-chromium", "Mobile-owned appearance regression")
      await page.setViewportSize(city === "jeju" ? { width: 320, height: 568 } : { width: 390, height: 844 })
      await preferences(page, "ja", appearance)
      await ready(page, `/?review=0&city=${city}`)
      const map = page.getByTestId("ondo-b-map-entry")
      await expect(map).toHaveAttribute("data-map-state", "ready", { timeout: 30_000 })
      for (const after19 of city === "seoul" ? [false, true] : [false]) {
        if (after19) {
          await page.getByTestId("global-after19-toggle").click()
          await page.getByTestId("global-after19-confirm").click()
          await expect(page.getByTestId("global-after19-prompt-layer")).toHaveCount(0)
        }
        await expect(map).toHaveAttribute("data-after19-active", String(after19))
        await expect(page.locator("html")).toHaveAttribute("data-ondo-theme", appearance)
        const disclosure = page.getByTestId("ondo-b-map-key-details")
        await disclosure.locator(":scope > summary").click()
        const panel = disclosure.locator(":scope > div")
        await expect(panel).toBeVisible()
        const labels = [panel.locator(":scope > small"), panel.getByTestId("ondo-b-pulse-legend").locator("span")]
        for (const locator of labels) for (const target of await locator.all()) {
          await target.scrollIntoViewIfNeeded()
          const contrast = await textContrast(target)
          expect(contrast.ratio, JSON.stringify(contrast)).toBeGreaterThanOrEqual(4.5)
        }
        if (city === "seoul") {
          const method = page.getByTestId("ondo-b-pulse-methodology")
          const summary = method.locator(":scope > summary")
          await summary.scrollIntoViewIfNeeded()
          const contrast = await textContrast(summary)
          expect(contrast.ratio, JSON.stringify(contrast)).toBeGreaterThanOrEqual(4.5)
          await hitTarget(summary, page)
          await evidence(page, info, `legend-summary-${after19 ? "after19" : "standard"}`)
          if (await method.getAttribute("open") == null) await summary.click()
          await expect(method).toHaveAttribute("open", "")
          const drivers = method.getByTestId("ondo-b-pulse-production-drivers")
          await expect(drivers).toBeVisible()
          expect(await drivers.locator("dt").count()).toBeGreaterThan(0)
          for (const target of await drivers.locator("dt, dd, strong").all()) {
            await target.scrollIntoViewIfNeeded()
            const result = await textContrast(target)
            expect(result.ratio, JSON.stringify(result)).toBeGreaterThanOrEqual(4.5)
          }
          await evidence(page, info, `legend-method-${after19 ? "after19" : "standard"}`)
          for (const target of await method.getByTestId("ondo-b-map-pulse-places").locator("button, button b").all()) {
            await target.scrollIntoViewIfNeeded()
            const result = await textContrast(target)
            expect(result.ratio, JSON.stringify(result)).toBeGreaterThanOrEqual(4.5)
          }
        }
        expect(await panel.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
        await evidence(page, info, `legend-${after19 ? "after19" : "standard"}`)
        await disclosure.locator(":scope > summary").click()
        await expect(disclosure).not.toHaveAttribute("open", "")
        const creditPanel = page.getByTestId("ondo-b-attribution")
        await expect(creditPanel).toBeVisible()
        for (const link of await creditPanel.getByRole("link").all()) {
          const result = await textContrast(link)
          expect(result.ratio, JSON.stringify(result)).toBeGreaterThanOrEqual(4.5)
          await hitTarget(link, page)
        }
        expect(await creditPanel.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
        await evidence(page, info, `credits-${after19 ? "after19" : "standard"}`)
      }
    })
  }

  test(`M03 map failure ${appearance} remains readable and retries same query`, async ({ page }, info) => {
    test.skip(info.project.name !== "mobile-chromium", "Mobile-owned recovery regression")
    await page.setViewportSize({ width: 390, height: 844 })
    await preferences(page, "ja", appearance)
    await page.route("https://tiles.openfreemap.org/**", route => route.abort("blockedbyclient"))
    await ready(page, "/?review=0&city=seoul&q=Roba")
    const status = page.getByTestId("ondo-b-map-fallback-status")
    await expect(status).toBeVisible({ timeout: 30_000 })
    for (const target of [status.locator(":scope > span"), status.getByRole("button")]) {
      const contrast = await textContrast(target)
      expect(contrast.ratio, JSON.stringify(contrast)).toBeGreaterThanOrEqual(4.5)
    }
    await expect(page.getByTestId("ondo-b-search")).toHaveValue("Roba")
    const result = page.locator(`[data-venue-opener="${PLACE}"]`).first()
    await expect(result).toBeVisible()
    await hitTarget(status.getByRole("button"), page)
    await evidence(page, info, "map-failure")
    await page.unroute("https://tiles.openfreemap.org/**")
    await status.getByRole("button").click()
    await expect(page.getByTestId("ondo-b-map-entry")).toHaveAttribute("data-map-state", "ready", { timeout: 30_000 })
    await expect(status).toHaveCount(0)
    await expect(page.getByTestId("ondo-b-search")).toHaveValue("Roba")
    expect(new URL(page.url()).searchParams.get("q")).toBe("Roba")
    await evidence(page, info, "map-recovered")
  })
}

for (const locale of ["en", "ko", "ja"] as const) {
  test(`M04 saved plans use the same selected Table schedule ${locale}`, async ({ page }, info) => {
    test.skip(info.project.name !== "mobile-chromium", "One public-state schedule run per locale")
    await page.setViewportSize({ width: 390, height: 844 })
    await preferences(page, locale, "light")
    await ready(page, "/?review=1")
    await page.getByTestId("nav-tables").click()
    for (const [id, venue, time] of [
      ["table-busan-gijang-dinner", "mois-03041681b54ea5399763", "18:30"],
      ["table-jeju-haenyeo-supper", "jeju-haenyeo-kitchen-bukchon", "18:30"],
      ["table-seoul-night-bites", PLACE, "20:30"],
    ]) {
      const card = page.getByTestId(`table-card-${id}`)
      const schedule = await card.getByTestId("table-sample-time").locator("dd").innerText()
      expect(schedule).toContain(`${time} KST`)
      await card.getByTestId(`table-open-${id}`).click()
      const detail = page.getByTestId("table-detail")
      await expect(detail).toHaveAttribute("data-table-id", id)
      await expect(detail).toHaveAttribute("data-venue-id", venue)
      await expect(detail.getByTestId("table-sample-time").locator("dd")).toHaveText(schedule)
      await detail.getByTestId("table-join").click()
      const gate = page.getByTestId("ondo-b-action-gate")
      if (id === "table-busan-gijang-dinner") {
        await expect(gate).toHaveAttribute("data-active-gate", "account")
        await gate.getByTestId("action-gate-confirm").click()
      }
      if (id === "table-seoul-night-bites") {
        await expect(gate).toHaveAttribute("data-active-gate", "age")
        await gate.getByTestId("after19-start").click()
        // Seoul is age-gated. Complete the actual review setup; never inject
        // a credential, age result, or QA authority just to save a plan.
        const identity = page.getByTestId("k-tour-id-setup")
        await expect(identity).toHaveAttribute("data-execution-mode", "review")
        await identity.getByTestId("k-tour-id-method-mobile-id").click()
        await identity.getByTestId("k-tour-id-consent-approve").click()
        const handoff = identity.getByTestId("k-tour-id-route-step")
        await expect(handoff).toHaveAttribute("data-handoff-state", "ready")
        await handoff.getByTestId("k-tour-id-continue").click()
        await identity.getByTestId("identity-handoff-approve").click()
        await expect(handoff).toHaveAttribute("data-handoff-state", "approved")
        await handoff.getByTestId("k-tour-id-continue").click()
        const holder = identity.getByTestId("k-tour-id-holder-delivery")
        await expect(holder).toHaveAttribute("data-holder-state", "ready")
        await holder.getByTestId("k-tour-id-continue").click()
        await expect(holder).toHaveAttribute("data-holder-state", "receipt")
        await holder.getByTestId("k-tour-id-continue").click()
        // Action-gate setup returns atomically to its exact pending action.
        await expect(identity).toHaveCount(0)
        await expect(gate).toHaveAttribute("data-active-gate", "age")
        await gate.getByTestId("after19-start").click()
      }
      await expect(gate).toHaveCount(0)
      await detail.getByTestId("table-join-confirm").click()
      await expect(detail.getByTestId("table-open-chat")).toBeVisible()
      await detail.locator("header").first().getByRole("button").click()
      await expect(detail).toHaveCount(0)
      await page.getByTestId("nav-my").click()
      const planned = page.getByTestId(`planned-table-${id}`)
      await expect(planned).toBeVisible()
      await expect(planned.locator(":scope > p")).toContainText(schedule)
      await evidence(page, info, `saved-${id}`)
      await planned.getByRole("button").click()
      await expect(detail).toHaveAttribute("data-table-id", id)
      await expect(detail).toHaveAttribute("data-venue-id", venue)
      await expect(detail.getByTestId("table-sample-time").locator("dd")).toHaveText(schedule)
      await expect(detail.getByTestId("table-open-chat")).toBeVisible()
      await detail.locator("header").first().getByRole("button").click()
      await expect(detail).toHaveCount(0)
    }
  })
}
