import { expect, test, type Locator, type Page } from "@playwright/test"

const PLACE = "mois-0021cd596bc5b2a922ad"
const SAVE_KEY = "local-demo-traveler:ktour-neighborhood-guide-save-v2"
const errors = new WeakMap<Page, string[]>()

test.describe.configure({ timeout: 150_000 })
test.use({ viewport: { width: 320, height: 480 }, locale: "ja-JP", colorScheme: "dark" })

test.beforeEach(async ({ page, context }) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
  const seen: string[] = []
  errors.set(page, seen)
  page.on("pageerror", error => seen.push(error.message))
  // Preferences only: no account, credential, approval, balance or saved record.
  await context.addInitScript(() => {
    if (!["127.0.0.1", "localhost", "[::1]"].includes(location.hostname)) return
    localStorage.setItem("ondo-b.device.v1", JSON.stringify({ locale: "ja", appearancePreference: "dark", onboarding: "ONB-COMPLETE" }))
  })
  await context.route("**/*", async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method())
      || /sumsub|onfido|omni.?one|opendid|fullnode|sui\.io|walletconnect|stripe/i.test(url.hostname)) {
      seen.push(`Forbidden request: ${request.method()} ${url.origin}`)
      await route.abort("blockedbyclient")
      return
    }
    await route.continue()
  })
})

test.afterEach(({ page }) => { expect(errors.get(page) ?? []).toEqual([]) })

async function openGuide(page: Page) {
  // The ordinary public place deep link, followed by visible detail controls.
  await page.goto(`/?venueId=${PLACE}&review=1`, { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("ondo-b-root")).toHaveAttribute("data-hydrated", "true")
  expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true)
  await page.getByTestId("canonical-place-details").click()
  await expect(page.getByTestId("canonical-place-overlay")).toHaveAttribute("data-venue-id", PLACE)
  await page.getByTestId("experience-open").click()
  await expect(page.getByTestId("experience-public-guide")).toBeVisible()
  await expect(page.getByTestId("experience-public-heading")).toBeFocused()
  await expect(page.getByTestId("experience-guide-content").getByRole("heading", { level: 3 })).toHaveCount(3)
  await expect(page.getByTestId("experience-flow")).toHaveCount(0)
  await expect(page.getByTestId("ondo-b-action-gate")).toHaveCount(0)
}

async function readableDecision(locator: Locator) {
  const metrics = await locator.evaluateAll(nodes => nodes.map(node => {
    const style = getComputedStyle(node)
    return { font: parseFloat(style.fontSize), line: parseFloat(style.lineHeight), width: node.clientWidth, content: node.scrollWidth }
  }))
  expect(metrics.length).toBeGreaterThan(0)
  for (const metric of metrics) {
    expect(metric.font).toBeGreaterThanOrEqual(15)
    expect(metric.line / metric.font).toBeGreaterThanOrEqual(1.45)
    expect(metric.content).toBeLessThanOrEqual(metric.width + 1)
  }
}

async function tabTo(page: Page, control: Locator, maximum = 12) {
  for (let step = 0; step <= maximum; step += 1) {
    if (await control.evaluate(node => node === document.activeElement)) return
    if (step === maximum) break
    await page.keyboard.press("Tab")
  }
  await expect(control).toBeFocused()
}

async function usableFooter(page: Page, action: Locator) {
  await expect(action).toBeVisible()
  const geometry = await action.evaluate(node => {
    const rect = node.getBoundingClientRect()
    return { height: rect.height, top: rect.top, bottom: rect.bottom,
      hit: node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)) }
  })
  expect(geometry.height).toBeGreaterThanOrEqual(52)
  expect(geometry.top).toBeGreaterThanOrEqual(0)
  expect(geometry.bottom).toBeLessThanOrEqual(480)
  expect(geometry.hit).toBe(true)
  const widths = await page.evaluate(() => [document.documentElement.scrollWidth, document.body.scrollWidth])
  expect(widths).toEqual([320, 320])
}

async function reachSavingConsent(page: Page) {
  await tabTo(page, page.getByTestId("experience-add-to-pass"))
  await page.keyboard.press("Enter")
  const flow = page.getByTestId("experience-flow")
  await expect(flow).toBeAttached()
  for (let step = 0; step < 18; step += 1) {
    let action = ""
    await expect.poll(async () => {
      if (await flow.getAttribute("data-stage") === "proposal") return "proposal"
      for (const id of ["experience-pass-approve", "k-tour-id-continue", "person-route-choice-mobile_id_cx",
        "local-check-boundary-continue", "action-gate-confirm"]) {
        const control = page.getByTestId(id).filter({ visible: true }).first()
        if (!(await control.isVisible()) || !(await control.isEnabled())) continue
        if (await control.evaluate(node => Boolean(node.closest('[inert], [aria-hidden="true"]')))) continue
        if (id === "person-route-choice-mobile_id_cx" && await control.getAttribute("aria-pressed") === "true") continue
        action = id
        return id
      }
      return "waiting"
    }, { timeout: 15_000 }).not.toBe("waiting")
    if (await flow.getAttribute("data-stage") === "proposal") break
    await page.getByTestId(action).filter({ visible: true }).first().click()
  }
  await expect(flow).toHaveAttribute("data-stage", "proposal")
  await expect(page.getByTestId("experience-heading")).toBeFocused()
  await expect(page.getByTestId("experience-scope")).toContainText("支払い・送金なし")
  await expect(page.getByTestId("experience-approve")).toBeDisabled()
}

/** Read-only diagnostics after a real visible save; never seeds authority. */
async function readSavedRecord(page: Page) {
  return page.evaluate(key => new Promise<unknown>((resolve, reject) => {
    const request = indexedDB.open("ktour-experience-mock-v1", 1)
    request.onupgradeneeded = () => { request.transaction?.abort(); reject(new Error("Expected an existing save")) }
    request.onerror = () => reject(new Error("Cannot read saved history"))
    request.onsuccess = () => {
      const db = request.result
      const transaction = db.transaction("experiences", "readonly")
      const read = transaction.objectStore("experiences").get(key)
      transaction.oncomplete = () => { db.close(); resolve(read.result) }
      transaction.onerror = transaction.onabort = () => { db.close(); reject(new Error("Cannot read saved history")) }
    }
  }), SAVE_KEY)
}

test("GUIDE-VIS01 JA320 public reading keeps its footer usable and keyboard cancellation returns to the guide", async ({ page }, testInfo) => {
  await openGuide(page)
  await readableDecision(page.getByTestId("experience-guide-content").locator("article p"))
  const titleSize = await page.getByTestId("experience-public-heading").evaluate(node => parseFloat(getComputedStyle(node).fontSize))
  expect(titleSize).toBeGreaterThanOrEqual(28)
  expect(titleSize).toBeLessThanOrEqual(32)
  const add = page.getByTestId("experience-add-to-pass")
  await expect(add).toHaveText("マイパスに保存")
  await usableFooter(page, add)
  await page.screenshot({ path: testInfo.outputPath("01-ja320-public-guide.png"), scale: "css" })
  await page.getByTestId("experience-guide-content").getByRole("heading", { level: 3 }).last().scrollIntoViewIfNeeded()
  await usableFooter(page, add)
  await tabTo(page, add)
  await page.keyboard.press("Enter")
  await expect(page.getByTestId("ondo-b-action-gate")).toHaveAttribute("data-active-gate", "account")
  await tabTo(page, page.getByTestId("action-gate-cancel"))
  await page.keyboard.press("Enter")
  await expect(page.getByTestId("experience-public-guide")).toBeVisible()
  await expect(page.getByTestId("experience-public-heading")).toBeFocused()
  await expect(page.getByTestId("experience-flow")).toHaveCount(0)
  await usableFooter(page, add)
  await page.keyboard.press("Escape")
  await expect(page.getByTestId("experience-open")).toBeFocused()
})

test("GUIDE-VIS02 JA320 keyboard save consent and pass → reader → saved status → close preserve focus and history", async ({ page }, testInfo) => {
  await openGuide(page)
  await reachSavingConsent(page)
  const checkbox = page.getByTestId("experience-consent")
  await readableDecision(checkbox.locator(".."))
  await tabTo(page, checkbox)
  await page.keyboard.press("Space")
  await expect(checkbox).toBeChecked()
  await expect(checkbox).toBeInViewport()
  await page.screenshot({ path: testInfo.outputPath("02-ja320-keyboard-save-consent.png"), scale: "css" })
  const approve = page.getByTestId("experience-approve")
  await tabTo(page, approve)
  await usableFooter(page, approve)
  await page.keyboard.press("Enter")
  const flow = page.getByTestId("experience-flow")
  await expect(flow).toHaveAttribute("data-stage", "complete")
  await expect(flow).toHaveAttribute("data-audit", "confirmed")
  await expect(flow).toHaveAttribute("data-execution-count", "1")
  await expect(flow).toHaveAttribute("data-used-count", "1")
  const before = await readSavedRecord(page)
  await tabTo(page, page.getByTestId("experience-return"))
  await page.keyboard.press("Enter")
  await expect(page.getByTestId("canonical-place-overlay")).toHaveAttribute("data-venue-id", PLACE)
  await page.getByTestId("canonical-place-overlay").locator('[data-place-return-focus="detail_close"]').click()
  await page.getByTestId("nav-id").click()
  const saved = page.getByTestId("experience-saved-guide")
  await expect(saved).toBeVisible()
  await saved.scrollIntoViewIfNeeded()
  await saved.focus()
  await page.keyboard.press("Enter")
  await expect(page.getByTestId("experience-public-guide")).toBeVisible()
  await expect(page.getByTestId("experience-public-heading")).toBeFocused()
  await expect(page.getByTestId("experience-add-to-pass")).toHaveText("保存状況を見る")
  await expect(page.getByTestId("ondo-b-action-gate")).toHaveCount(0)
  expect(await readSavedRecord(page)).toEqual(before)
  await tabTo(page, page.getByTestId("experience-add-to-pass"))
  await page.keyboard.press("Enter")
  await expect(flow).toHaveAttribute("data-stage", "complete")
  await expect(page.getByTestId("experience-heading")).toBeFocused()
  await expect(page.getByTestId("ondo-b-action-gate")).toHaveCount(0)
  await expect(page.getByTestId("experience-return")).toHaveText("保存したガイド")
  await page.keyboard.press("Escape")
  await expect(page.getByTestId("nav-id")).toHaveAttribute("aria-current", "page")
  await expect(saved).toBeFocused()
  await expect(saved).toBeInViewport()
  expect(await readSavedRecord(page)).toEqual(before)
  await page.screenshot({ path: testInfo.outputPath("03-ja320-saved-guide-return-focus.png"), scale: "css" })
})
