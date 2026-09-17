import { expect, test, type Browser, type Locator, type Page, type TestInfo } from "@playwright/test"

// Prepared for individually activated M05 / M12 / M13 changes. Run only the
// active item's title filter against the coordinator's frozen local server.
// No account, membership, proof, receipt or stamp authority is seeded.
const PLACE = "mois-0021cd596bc5b2a922ad"
const TABLE = "table-busan-gijang-dinner"
const variants = [
  { locale: "ja", width: 320, height: 740, theme: "light" },
  { locale: "en", width: 390, height: 844, theme: "dark" },
  { locale: "ko", width: 430, height: 932, theme: "light" },
] as const
type Variant = (typeof variants)[number]

test.describe.configure({ timeout: 90_000 })
test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "mobile-chromium", "This bounded suite uses the mobile browser profile")
})

async function publicPage(browser: Browser, baseURL: string | undefined, variant: Variant, review: boolean, task: (page: Page) => Promise<void>) {
  const origin = baseURL ?? "http://127.0.0.1:3112"
  expect(["localhost", "127.0.0.1", "[::1]"]).toContain(new URL(origin).hostname)
  const context = await browser.newContext({
    baseURL: origin,
    viewport: { width: variant.width, height: variant.height },
    isMobile: true, hasTouch: true, colorScheme: variant.theme,
    locale: variant.locale === "ko" ? "ko-KR" : variant.locale === "ja" ? "ja-JP" : "en-US",
    timezoneId: "Asia/Seoul", reducedMotion: "reduce",
  })
  const failures: string[] = []
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url())
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method())
      || /sumsub|onfido|omni.?one|opendid|fullnode|sui\.io|walletconnect|stripe/i.test(url.hostname)) {
      failures.push(`${request.method()} ${url.origin}`)
      await route.abort("blockedbyclient")
    } else await route.continue()
  })
  await context.addInitScript(({ locale, theme, review }) => {
    if (!["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)) return
    localStorage.setItem("ondo-b.device.v1", JSON.stringify({ locale, appearancePreference: theme, onboarding: "ONB-COMPLETE" }))
    sessionStorage.setItem("ondo.review.flow.v1", review ? "1" : "0")
  }, { ...variant, review })
  const page = await context.newPage()
  page.on("pageerror", error => failures.push(error.message))
  try {
    await page.goto(`/?review=${review ? "1" : "0"}`, { waitUntil: "domcontentloaded" })
    await expect(page.getByTestId("ondo-b-root")).toHaveAttribute("data-hydrated", "true")
    await task(page)
  } finally {
    await context.close()
    expect(failures, "No runtime errors, external provider calls or mutations").toEqual([])
  }
}

function sheetFor(content: Locator) {
  return content.locator('xpath=ancestor::*[@data-testid="ondo-sheet"][1]')
}

async function noOverflow(page: Page, surface: Locator) {
  expect(await surface.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
  expect(await page.locator("html").evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
}

async function capture(page: Page, info: TestInfo, item: string, variant: Variant) {
  await page.screenshot({ path: info.outputPath(`${item}-${variant.locale}-${variant.width}-${variant.theme}.png`), scale: "css" })
}

async function openPublicReport(page: Page) {
  await page.getByTestId("nav-tables").click()
  await page.getByTestId(`table-open-${TABLE}`).click()
  await page.getByTestId("table-join-draft").fill("Meet by the entrance.")
  await page.getByTestId("table-join").click()
  await expect(page.getByTestId("ondo-b-action-gate")).toHaveAttribute("data-active-gate", "account")
  await page.getByTestId("action-gate-confirm").click()
  await page.getByTestId("table-join-confirm").click()
  await page.getByTestId("table-open-chat").click()
  await page.getByTestId("table-report").click()
  const decision = page.getByTestId("table-safety-decision")
  await expect(decision).toBeVisible()
  return decision
}

async function openVisit(page: Page, review: boolean) {
  await page.goto(`/?review=${review ? "1" : "0"}&venueId=${PLACE}`, { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("ondo-b-root")).toHaveAttribute("data-hydrated", "true")
  await page.getByTestId("canonical-place-details").click()
  await page.getByTestId("canonical-journey-open").click()
  const visit = page.getByTestId("journey-visit-sheet")
  await expect(visit).toHaveAttribute("data-venue-id", PLACE)
  return visit
}

async function dismissPlace(page: Page) {
  for (let step = 0; step < 3 && await page.getByRole("dialog").count(); step++) {
    await page.keyboard.press("Escape")
    await page.waitForTimeout(350)
  }
  await expect(page.getByRole("dialog")).toHaveCount(0)
}

async function oneStampInPass(page: Page) {
  const visit = await openVisit(page, true)
  await visit.getByTestId("visit-proof-check").click()
  await expect(visit).toHaveAttribute("data-recorded", "true")
  await page.getByTestId("journey-visit-return").click()
  await expect(visit).toHaveCount(0)
  await dismissPlace(page)
  await page.getByTestId("nav-id").click()
  const card = page.getByTestId("ondo-b-stamp-milestone")
  await expect(card).toHaveAttribute("data-stamps", "1")
  return card
}

test("M05-REPORT-REFLOW full-width reasons remain readable in the three mobile variants", async ({ browser, baseURL }, info) => {
  for (const variant of variants) await publicPage(browser, baseURL, variant, true, async page => {
    const decision = await openPublicReport(page)
    const reasons = decision.getByTestId("table-report-reasons")
    const labels = reasons.locator("label")
    await expect(labels).toHaveCount(3)
    await expect(decision.getByTestId("table-report-confirm")).toBeDisabled()
    const boxes = await labels.evaluateAll(nodes => nodes.map(node => {
      const box = node.getBoundingClientRect()
      const style = getComputedStyle(node)
      return { x: box.x, y: box.y, width: box.width, height: box.height, fontSize: parseFloat(style.fontSize), lineHeight: parseFloat(style.lineHeight), overflow: node.scrollWidth > node.clientWidth + 1 }
    }))
    for (let index = 0; index < boxes.length; index++) {
      expect(boxes[index].height).toBeGreaterThanOrEqual(48)
      expect(boxes[index].fontSize).toBe(15)
      expect(boxes[index].lineHeight).toBeCloseTo(21.75, 1)
      expect(boxes[index].overflow).toBe(false)
      expect(Math.abs(boxes[index].x - boxes[0].x)).toBeLessThanOrEqual(1)
      if (index) expect(boxes[index].y).toBeGreaterThanOrEqual(boxes[index - 1].y + boxes[index - 1].height)
    }
    const behavior = reasons.getByTestId("table-report-reason-behavior")
    await behavior.check()
    await expect(behavior).toBeChecked()
    await expect(decision.getByTestId("table-report-confirm")).toBeEnabled()
    if (variant.locale === "en") {
      expect(await behavior.locator("..").locator("span").evaluate(node => {
        const text = node.firstChild
        if (!text || text.nodeType !== Node.TEXT_NODE) return false
        const start = (text.textContent ?? "").indexOf("Uncomfortable")
        if (start < 0) return false
        const range = document.createRange()
        range.setStart(text, start); range.setEnd(text, start + "Uncomfortable".length)
        return range.getClientRects().length === 1
      }), "The English word must not break internally").toBe(true)
    }
    await noOverflow(page, decision)
    await capture(page, info, "M05-reasons", variant)
  })
})

test("M05-REPORT-RETURN cancellation and explicit report keep the same Table and focus", async ({ browser, baseURL }) => {
  await publicPage(browser, baseURL, variants[1], true, async page => {
    let decision = await openPublicReport(page)
    const table = page.getByTestId("table-detail")
    const membership = await table.getAttribute("data-table-membership")
    await decision.getByTestId("table-report-reason-behavior").check()
    await decision.getByTestId("table-report-reason-behavior").focus()
    await page.keyboard.press("ArrowDown")
    await expect(decision.getByTestId("table-report-reason-other")).toBeChecked()
    await expect(decision.getByTestId("table-report-reason-other")).toBeFocused()
    await page.keyboard.press("Escape")
    await expect(decision).toHaveCount(0)
    await expect(page.getByTestId("table-report-receipt")).toHaveCount(0)
    await expect(page.getByTestId("table-report")).toBeFocused()
    await page.getByTestId("table-report").click()
    decision = page.getByTestId("table-safety-decision")
    await expect(decision.getByTestId("table-report-confirm")).toBeDisabled()
    await decision.getByTestId("table-report-reason-other").check()
    await decision.getByTestId("table-report-block").check()
    await decision.getByTestId("table-report-confirm").click()
    await expect(decision).toHaveCount(0)
    await expect(page.getByTestId("table-report-receipt")).toHaveAttribute("data-participant-blocked", "true")
    await expect(page.getByTestId("table-report-receipt")).toContainText("Saved only on this device")
    await expect(page.getByTestId("table-report")).toBeFocused()
    await expect(table).toHaveAttribute("data-table-id", TABLE)
    await expect(table).toHaveAttribute("data-table-membership", membership!)
  })
})

test("M12-VISIT-UNAVAILABLE normal visits have no active collection goal or recording promise", async ({ browser, baseURL }, info) => {
  const promise = { en: "No purchase needed", ko: "결제 없이도 기록할 수 있어요", ja: "支払いなしで記録できます" }
  const unavailable = { en: /not connected|aren.t connected|isn.t available|unavailable|not available/i, ko: /연결|확인할 수 없|준비 중/, ja: /接続|確認できません|準備中/ }
  for (const variant of variants) await publicPage(browser, baseURL, variant, false, async page => {
    await page.getByTestId("nav-id").click()
    const card = page.getByTestId("ondo-b-stamp-milestone")
    await expect(card).toHaveAttribute("data-mode", "unavailable")
    await expect(card).not.toContainText(/0\s*\/\s*10/)
    const visit = await openVisit(page, false)
    const receipt = visit.getByTestId("visit-stamp-receipt")
    await expect(visit).toHaveAttribute("data-recorded", "false")
    await expect(receipt).toHaveAttribute("data-mode", "unavailable")
    await expect(receipt).toHaveAttribute("data-recorded", "false")
    await expect(receipt).toHaveAttribute("data-proof-state", "unavailable")
    await expect(receipt).not.toContainText(/0\s*\/\s*10/)
    await expect(receipt).not.toContainText(promise[variant.locale])
    await expect(receipt).toContainText(unavailable[variant.locale])
    await expect(receipt.getByRole("img")).toHaveCount(0)
    await expect(receipt.getByTestId("visit-proof-check")).toHaveCount(0)
    await expect(visit.getByTestId("journey-visit-pass")).toHaveCount(0)
    await expect(receipt.getByTestId("visit-stamp-details")).toBeVisible()
    await expect(page.getByTestId("ondo-b-action-gate")).toHaveCount(0)
    await noOverflow(page, visit)
    await capture(page, info, "M12-unavailable", variant)
    await receipt.getByTestId("visit-stamp-details").locator("summary").click()
    await expect(receipt.getByTestId("visit-stamp-details")).not.toContainText(/sample visit|샘플 방문|サンプル訪問/)
    await capture(page, info, "M12-unavailable-details", variant)
    await sheetFor(visit).locator('[data-sheet-navigation="back"]').click()
    await expect(visit).toHaveCount(0)
    await expect(page.getByTestId("canonical-place-overlay")).toHaveAttribute("data-venue-id", PLACE)
    await expect(page.getByTestId("canonical-journey-open")).toBeFocused()
  })
})

test("M12-VISIT-REVIEW explicit recording stays unique and public sample exit restores unavailable truth", async ({ browser, baseURL }, info) => {
  await publicPage(browser, baseURL, variants[1], true, async page => {
    const visit = await openVisit(page, true)
    const receipt = visit.getByTestId("visit-stamp-receipt")
    await expect(receipt).toHaveAttribute("data-stamp-count", "0")
    await expect(receipt.getByRole("img")).toHaveCount(1)
    await receipt.getByTestId("visit-proof-check").click()
    await expect(visit).toHaveAttribute("data-recorded", "true")
    await expect(receipt).toHaveAttribute("data-stamp-count", "1")
    await expect(receipt.getByTestId("visit-proof-check")).toHaveCount(0)
    await page.getByTestId("journey-visit-return").click()
    await expect(visit).toHaveCount(0)
    await page.getByTestId("canonical-journey-open").click()
    await expect(visit).toHaveAttribute("data-recorded", "true")
    await expect(receipt).toHaveAttribute("data-stamp-count", "1")
    await expect(receipt.getByTestId("visit-proof-check")).toHaveCount(0)
    await expect(page.getByTestId("ondo-b-action-gate")).toHaveCount(0)
    await capture(page, info, "M12-review-recorded", variants[1])
    await page.getByTestId("journey-visit-return").click()
    await expect(visit).toHaveCount(0)
    await dismissPlace(page)
    await page.getByTestId("nav-id").click()
    await page.getByTestId("review-sample-indicator").click()
    await page.getByText("Integration status", { exact: true }).click()
    await Promise.all([
      page.waitForURL(url => url.searchParams.get("review") === "0"),
      page.getByRole("button", { name: "Exit sample and return to the regular app", exact: true }).click(),
    ])
    await expect(page.getByTestId("ondo-b-root")).toHaveAttribute("data-hydrated", "true")
    const normalVisit = await openVisit(page, false)
    await expect(normalVisit).toHaveAttribute("data-recorded", "false")
    await expect(normalVisit.getByTestId("visit-stamp-receipt")).toHaveAttribute("data-mode", "unavailable")
    await expect(normalVisit.getByTestId("visit-proof-check")).toHaveCount(0)
    await expect(normalVisit.getByTestId("journey-visit-pass")).toHaveCount(0)
    await capture(page, info, "M12-after-public-exit", variants[1])
  })
})

async function readableLifetime(surface: Locator) {
  const notice = surface.getByTestId("journey-stamps-lifetime")
  await expect(notice).toBeVisible()
  const font = await notice.evaluate(node => {
    const style = getComputedStyle(node)
    return { size: parseFloat(style.fontSize), lineHeight: parseFloat(style.lineHeight), overflow: node.scrollWidth > node.clientWidth + 1 }
  })
  expect(font.size).toBeGreaterThanOrEqual(13)
  expect(font.size).toBeLessThanOrEqual(14)
  expect(font.lineHeight).toBeGreaterThanOrEqual(font.size * 1.5)
  expect(font.overflow).toBe(false)
  return notice
}

test("M13-LIFETIME-READABLE card and collection expose an independent readable lifetime line", async ({ browser, baseURL }, info) => {
  for (const variant of variants) await publicPage(browser, baseURL, variant, true, async page => {
    await page.getByTestId("nav-id").click()
    await readableLifetime(page.getByTestId("ondo-b-stamp-milestone"))
    const card = await oneStampInPass(page)
    const notice = await readableLifetime(card)
    const noticeBox = (await notice.boundingBox())!
    const actionBox = (await card.getByTestId("journey-stamps-open").boundingBox())!
    expect(actionBox.y, "Lifecycle explanation has its own line, not a tiny action-row caption").toBeGreaterThanOrEqual(noticeBox.y + noticeBox.height - 1)
    await noOverflow(page, card)
    await capture(page, info, "M13-card", variant)
    await card.getByTestId("journey-stamps-open").click()
    const collection = page.getByTestId("journey-stamps-collection")
    await expect(collection).toHaveAttribute("data-stamps", "1")
    await readableLifetime(collection)
    await noOverflow(page, collection)
    await capture(page, info, "M13-collection", variant)
  })
})

test("M13-LIFETIME-TRUTH tab changes preserve the session but reload resets the advertised progress", async ({ browser, baseURL }) => {
  await publicPage(browser, baseURL, variants[1], true, async page => {
    const card = await oneStampInPass(page)
    await expect(card.getByTestId("journey-stamps-lifetime")).toContainText(/resets on reload/i)
    await card.getByTestId("journey-stamps-open").click()
    const collection = page.getByTestId("journey-stamps-collection")
    await expect(collection.getByTestId("journey-stamps-lifetime")).toContainText(/resets on reload/i)
    await page.keyboard.press("Escape")
    await expect(collection).toHaveCount(0)
    await expect(card.getByTestId("journey-stamps-open")).toBeFocused()
    await page.getByTestId("nav-my").click()
    await page.getByTestId("nav-id").click()
    await expect(card).toHaveAttribute("data-stamps", "1")
    await page.reload({ waitUntil: "domcontentloaded" })
    await expect(page.getByTestId("ondo-b-root")).toHaveAttribute("data-hydrated", "true")
    await dismissPlace(page)
    await page.getByTestId("nav-id").click()
    await expect(card).toHaveAttribute("data-stamps", "0")
    await expect(card.getByTestId("journey-stamps-open")).toHaveCount(0)
    await expect(card.getByTestId("journey-stamps-lifetime")).toContainText(/resets on reload/i)
  })
})
