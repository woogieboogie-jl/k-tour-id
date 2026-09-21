import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test"

// Tests only: activate one approved item at a time with --grep "R1 optional"
// or --grep "R2 place". Never infer fixture authority from seeded preferences.
const PLACE = "mois-0021cd596bc5b2a922ad"
const DEVICE = "ondo-b.device.v1"
const faults = new WeakMap<Page, string[]>()
const layouts = [
  { locale: "ja", appearance: "light", width: 320, height: 568 },
  { locale: "en", appearance: "light", width: 390, height: 844 },
  { locale: "ko", appearance: "dark", width: 430, height: 932 },
] as const

test.describe.configure({ timeout: 90_000 })
test.beforeEach(async ({ page, context }, info) => {
  test.skip(info.project.name !== "mobile-chromium", "Mobile-owned visual and return-path regression")
  const errors: string[] = []
  faults.set(page, errors)
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

async function start(page: Page, layout: typeof layouts[number], url = "/?review=0") {
  await page.setViewportSize(layout)
  await page.addInitScript(({ locale, appearance, key }) => {
    if (!/^https?:$/.test(location.protocol) || !["127.0.0.1", "localhost"].includes(location.hostname)) return
    // Deliberately omit onboarding. A fresh NEW device must open the map.
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ locale, appearancePreference: appearance }))
  }, { ...layout, key: DEVICE })
  await page.goto(url, { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("ondo-b-root")).toHaveAttribute("data-hydrated", "true")
  await page.evaluate(() => document.fonts.ready)
}

async function capture(page: Page, info: TestInfo, label: string, metrics?: unknown) {
  await page.screenshot({ path: info.outputPath(`${label}.png`), scale: "css" })
  await info.attach(`${label}-metrics`, { contentType: "application/json", body: JSON.stringify({
    metrics,
    artifact: await page.evaluate(() => ({ url: location.href, width: innerWidth, height: innerHeight,
      resources: performance.getEntriesByType("resource").map(entry => entry.name).filter(name => /\/_next\/static\/.*\.(css|js)(\?|$)/.test(name)),
    })),
  }, null, 2) })
}

async function target(control: Locator, page: Page) {
  const box = await control.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.width).toBeGreaterThanOrEqual(44)
  expect(box!.height).toBeGreaterThanOrEqual(44)
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1)
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1)
  expect(await control.evaluate(node => { const box = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)) })).toBe(true)
  return box!
}

async function setup(page: Page) {
  await page.getByTestId("nav-settings").click()
  await page.getByTestId("ondo-b-discovery-settings").click()
  await page.getByTestId("ondo-b-onboarding-reset").click()
  const wizard = page.getByTestId("ondo-onboarding-backdrop")
  await expect(wizard).toHaveAttribute("data-onboarding-step", "intent")
  return wizard
}

async function stepMetrics(page: Page, wizard: Locator, step: string, info: TestInfo) {
  const heading = wizard.locator(`[data-onboarding-heading="${step}"]`)
  await expect(heading).toBeFocused()
  const action = wizard.getByTestId(step === "preferences" ? "onboarding-finish" : "onboarding-continue")
  const primary = await target(action, page)
  const secondary = await target(wizard.getByTestId("onboarding-guest-skip"), page)
  expect(secondary.y).toBeGreaterThanOrEqual(primary.y + primary.height)
  const header = await wizard.locator('[data-sheet-header="true"]').boundingBox()
  expect(header).not.toBeNull()
  for (const choice of await wizard.locator('[role="radio"], [data-testid^="onboarding-preference-"]:visible').all()) {
    expect((await choice.boundingBox())!.height).toBeGreaterThanOrEqual(52)
  }
  const metrics = await wizard.getByTestId("ondo-onboarding").evaluate((node, step) => {
    const heading = node.querySelector(`[data-onboarding-heading="${step}"]`)!
    return { titleSize: parseFloat(getComputedStyle(heading).fontSize), lineHeight: parseFloat(getComputedStyle(heading).lineHeight), inset: parseFloat(getComputedStyle(node).paddingLeft),
      overflow: node.scrollWidth > node.clientWidth + 1, heading: heading.getBoundingClientRect().toJSON() }
  }, step)
  expect(metrics.titleSize).toBeGreaterThanOrEqual(28)
  expect(metrics.titleSize).toBeLessThanOrEqual(32)
  expect(metrics.lineHeight / metrics.titleSize).toBeCloseTo(1.08, 2)
  expect(metrics.inset).toBe(page.viewportSize()!.width <= 360 ? 16 : 20)
  expect(primary.height).toBeGreaterThanOrEqual(52)
  expect(metrics.overflow).toBe(false)
  expect(metrics.heading.y).toBeGreaterThanOrEqual(0)
  expect(metrics.heading.bottom).toBeLessThanOrEqual(primary.y)
  await capture(page, info, `onboarding-${step}`, { ...metrics, primary, secondary, header })
  return { ...metrics, primaryHeight: primary.height, headerHeight: header!.height }
}

for (const layout of layouts) {
  test(`R1 optional setup keeps one type and inset scale ${layout.locale} ${layout.width}`, async ({ page }, info) => {
    await start(page, layout)
    await expect(page.getByTestId("ondo-onboarding-backdrop")).toHaveCount(0)
    await expect(page.getByTestId("ondo-b-map-entry")).toBeVisible()
    const wizard = await setup(page)
    const metrics = [await stepMetrics(page, wizard, "intent", info)]
    await expect(wizard.getByTestId("onboarding-continue")).toBeDisabled()
    await wizard.getByTestId("persona-short_trip").click()
    await wizard.getByTestId("onboarding-continue").click()
    metrics.push(await stepMetrics(page, wizard, "area", info))
    // A short trip can continue without choosing an area; no new requirement.
    await expect(wizard.locator('[role="radio"][aria-checked="true"]')).toHaveCount(0)
    await expect(wizard.getByTestId("onboarding-continue")).toBeEnabled()
    await wizard.getByTestId("onboarding-continue").click()
    await expect(wizard).toHaveAttribute("data-onboarding-step", "preferences")
    await wizard.locator("button[data-sheet-navigation='back']").click()
    await expect(wizard).toHaveAttribute("data-onboarding-step", "area")
    await expect(wizard.locator('[role="radio"][aria-checked="true"]')).toHaveCount(0)
    await wizard.getByTestId("onboarding-area-busan").click()
    await wizard.getByTestId("onboarding-continue").click()
    metrics.push(await stepMetrics(page, wizard, "preferences", info))
    for (const [key, tolerance] of [["titleSize", 2], ["inset", 2], ["primaryHeight", 4], ["headerHeight", 1]] as const) {
      const values = metrics.map(value => value[key])
      expect(Math.max(...values) - Math.min(...values), key).toBeLessThanOrEqual(tolerance)
    }
    await wizard.getByTestId("onboarding-preference-classic").click()
    const dietary = wizard.getByTestId("onboarding-dietary-disclosure")
    await dietary.locator("summary").click()
    await expect(dietary.locator(":scope > small")).toBeVisible()
    await dietary.getByTestId("onboarding-preference-vegan").click()
    await wizard.locator("button[data-sheet-navigation='back']").click()
    await expect(wizard).toHaveAttribute("data-onboarding-step", "area")
    await expect(wizard.getByTestId("onboarding-area-busan")).toHaveAttribute("aria-checked", "true")
    await wizard.getByTestId("onboarding-continue").click()
    await expect(wizard.getByTestId("onboarding-preference-classic")).toHaveAttribute("aria-pressed", "true")
    await wizard.getByTestId("onboarding-finish").click()
    await expect(wizard).toHaveCount(0)
    const committed = await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? "{}"), DEVICE)
    expect(committed).toMatchObject({ onboarding: "ONB-COMPLETE", persona: "short_trip", discoveryArea: "busan" })
    expect(committed.discoveryPreferences).toEqual(expect.arrayContaining(["classic", "vegan"]))
    await expect(page.getByTestId("ondo-b-action-gate")).toHaveCount(0)
    await setup(page)
    await wizard.getByTestId("persona-living").click()
    await wizard.getByTestId("onboarding-guest-skip").click()
    await expect(wizard).toHaveCount(0)
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? "{}").persona, DEVICE)).toBe("short_trip")
    await setup(page)
    await page.keyboard.press("Escape")
    await expect(wizard).toHaveCount(0)
    await expect(page.getByTestId("ondo-b-map-entry")).toBeVisible()
  })
}

// Compare actual paint, including transparent ancestor surfaces. Flat controls
// only; saved screenshots are a separate visual oracle for hierarchy/spacing.
async function paint(locator: Locator) {
  return locator.evaluate(node => {
    type Color = [number, number, number, number]
    const parse = (value: string): Color => {
      if (value.startsWith("#")) { const v = value.slice(1); const full = v.length === 3 ? v.split("").map(n => n + n).join("") : v; return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16) / 255).concat(1) as Color }
      const n = value.match(/[\d.]+/g)!.map(Number)
      return value.startsWith("color(srgb") ? [n[0], n[1], n[2], n[3] ?? 1] : [n[0] / 255, n[1] / 255, n[2] / 255, n[3] ?? 1]
    }
    const over = (a: Color, b: Color): Color => { const alpha = a[3] + b[3] * (1 - a[3]); return alpha ? [0, 1, 2].map(i => (a[i] * a[3] + b[i] * b[3] * (1 - a[3])) / alpha).concat(alpha) as Color : [0, 0, 0, 0] }
    let background: Color = [0, 0, 0, 0]
    for (let el: Element | null = node; el && background[3] < .999; el = el.parentElement) background = over(background, parse(getComputedStyle(el).backgroundColor))
    if (background[3] < .999) throw new Error("No opaque surface for contrast")
    const style = getComputedStyle(node), foreground = over(parse(style.color), background)
    const lum = (v: Color) => v.slice(0, 3).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4).reduce((n, x, i) => n + x * [.2126, .7152, .0722][i], 0)
    const a = lum(foreground), b = lum(background)
    return { text: node.textContent, background, control: parse(style.getPropertyValue("--ondo-control").trim()), ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) }
  })
}

for (const layout of layouts) {
  test(`R2 place keeps companions quiet and exact returns ${layout.locale} ${layout.width}`, async ({ page }, info) => {
    await start(page, layout, `/?review=1&city=seoul&view=list&venueId=${PLACE}&detail=1`)
    const detail = page.getByTestId("canonical-place-overlay")
    await expect(detail).toHaveAttribute("data-venue-id", PLACE)
    const primary = detail.getByTestId("canonical-meal-benefit-open")
    const primaryPaint = await paint(primary)
    // 9/21: payment and reservation are quiet full-width rows, not competing
    // primary tiles. All entries remain reachable and high contrast.
    expect(primaryPaint.background).not.toEqual(primaryPaint.control)
    expect(primaryPaint.ratio).toBeGreaterThanOrEqual(4.5)
    for (const id of ["place-reservation-open", "experience-open", "canonical-journey-open", "canonical-place-table"]) {
      const action = detail.getByTestId(id)
      await action.scrollIntoViewIfNeeded()
      await target(action, page)
      const colors = await paint(action)
      expect(colors.background, id).toEqual(primaryPaint.background)
      const textPaint = []
      for (const text of await action.locator("strong, small").all()) {
        const result = await paint(text)
        expect(result.ratio, JSON.stringify(result)).toBeGreaterThanOrEqual(4.5)
        textPaint.push(result)
      }
      if (id === "experience-open" || id === "canonical-journey-open") {
        const row = await action.evaluate(node => {
          const style = getComputedStyle(node)
          return { height: node.getBoundingClientRect().height, background: style.backgroundColor,
            inlineBorders: [style.borderInlineStartWidth, style.borderInlineEndWidth], radius: style.borderRadius,
            shadow: style.boxShadow, padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft] }
        })
        expect(row.height).toBeGreaterThanOrEqual(64)
        expect(row.background).toBe("rgba(0, 0, 0, 0)")
        expect(row.inlineBorders).toEqual(["0px", "0px"])
        expect(row.radius).toBe("0px")
        expect(row.shadow).toBe("none")
        expect(row.padding).toEqual(["12px", "0px", "12px", "0px"])
      }
      await capture(page, info, `companion-${id}`, { colors, textPaint })
    }
    for (const [id, surface] of [["experience-open", "experience-public-guide"], ["canonical-journey-open", "journey-visit-sheet"], ["canonical-place-table", "table-detail"]]) {
      const action = detail.getByTestId(id)
      await action.click()
      const opened = page.getByTestId(surface)
      await expect(opened).toBeVisible()
      await expect(page.getByTestId("ondo-b-action-gate")).toHaveCount(0)
      if (surface === "experience-public-guide") {
        await expect(page.getByTestId("experience-flow")).toHaveCount(0)
        await expect(page.getByTestId("experience-guide-content").getByRole("heading", { level: 3 })).toHaveCount(3)
      } else {
        await expect(opened).toHaveAttribute("data-venue-id", PLACE)
      }
      if (surface === "table-detail") {
        await expect(opened).toHaveAttribute("data-table-id", "table-seoul-night-bites")
        // Table header Back belongs to the Tables list. Its explicit place
        // return restores the captured canonical venue and invoking action.
        await opened.getByTestId("table-return-place").click()
      } else {
        await page.getByTestId("ondo-sheet").filter({ has: opened }).locator("button[data-sheet-navigation]").click()
      }
      await expect(opened).toHaveCount(0)
      await expect(detail).toHaveAttribute("data-venue-id", PLACE)
      await expect(action).toBeFocused()
    }
    // The approved peek keeps its one commerce entry and separate Details.
    await page.goto(`/?review=1&city=seoul&view=list&venueId=${PLACE}`, { waitUntil: "domcontentloaded" })
    const peek = page.getByTestId("canonical-place-peek")
    await expect(peek).toHaveAttribute("data-venue-id", PLACE)
    await expect(peek.getByTestId("peek-place-service")).toHaveAttribute("data-visual-priority", "primary")
    await expect(peek.getByTestId("canonical-place-details")).toHaveAttribute("data-visual-priority", "secondary")
    await expect(peek.getByTestId("experience-open")).toHaveCount(0)
    await expect(peek.getByTestId("canonical-journey-open")).toHaveCount(0)
    await capture(page, info, "peek-preserved")
  })
}
