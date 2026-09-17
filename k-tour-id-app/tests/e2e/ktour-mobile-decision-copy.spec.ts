import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test"

const failures = new WeakMap<Page, string[]>()
test.describe.configure({ timeout: 90_000 })
test.beforeEach(async ({ page }) => {
  failures.set(page, [])
  page.on("pageerror", error => failures.get(page)!.push(error.stack ?? error.message))
  await page.route("**/*", async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method()) || /sumsub|onfido|omni.?one|opendid|fullnode|sui\.io|walletconnect|stripe/i.test(url.hostname)) {
      failures.get(page)!.push(`${request.method()} ${url.origin}`)
      await route.abort("blockedbyclient")
      return
    }
    await route.continue()
  })
})
test.afterEach(({ page }) => expect(failures.get(page) ?? []).toEqual([]))

async function boot(page: Page, baseURL: string | undefined, options: { width?: number; height?: number; locale?: "en" | "ko" | "ja"; dark?: boolean } = {}) {
  await page.setViewportSize({ width: options.width ?? 390, height: options.height ?? 844 })
  await page.emulateMedia({ reducedMotion: "reduce" })
  // No identity, financial balance, proof, consent, or operation is injected.
  await page.addInitScript(({ origin, locale, appearance }) => {
    if (location.origin !== origin) return
    localStorage.setItem("ondo-b.device.v1", JSON.stringify({ locale, appearancePreference: appearance, onboarding: "ONB-COMPLETE" }))
  }, { origin: new URL(baseURL ?? "http://127.0.0.1:3112").origin, locale: options.locale ?? "en", appearance: options.dark ? "dark" : "light" })
  await page.goto("/?review=1", { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("ondo-b-root")).toHaveAttribute("data-hydrated", "true")
  await page.getByTestId("nav-id").click()
}

async function expand(node: Locator) {
  const details = node.locator("xpath=ancestor-or-self::details[1]")
  if (await details.getAttribute("open") === null) await details.locator(":scope > summary").click()
}

// Deliberately measures selected decision prose, not compact ledger labels,
// timestamps, sample tags, numeric amounts, or every 12–14px metadata value.
async function decisionCopy(page: Page, locator: Locator, info: TestInfo, label: string) {
  await expect(locator).toHaveCount(1)
  await locator.scrollIntoViewIfNeeded()
  const metrics = await locator.evaluate(element => {
    type Color = [number, number, number, number]
    const rgba = (value: string): Color => {
      const values = value.match(/[\d.]+/g)?.map(Number) ?? []
      return [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0, values[3] ?? 1]
    }
    const composite = (front: Color, back: Color): Color => [
      front[0] * front[3] + back[0] * (1 - front[3]),
      front[1] * front[3] + back[1] * (1 - front[3]),
      front[2] * front[3] + back[2] * (1 - front[3]), 1,
    ]
    const ancestors: Element[] = []
    for (let node: Element | null = element; node; node = node.parentElement) ancestors.push(node)
    let background: Color = [255, 255, 255, 1]
    for (const node of [...ancestors].reverse()) background = composite(rgba(getComputedStyle(node).backgroundColor), background)
    const style = getComputedStyle(element)
    const foreground = composite(rgba(style.color), background)
    const luminance = (color: Color) => color.slice(0, 3).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0)
    const a = luminance(foreground), b = luminance(background)
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    const textRects: DOMRect[] = []
    while (walker.nextNode()) {
      if (!walker.currentNode.textContent?.trim()) continue
      const range = document.createRange()
      range.selectNodeContents(walker.currentNode)
      textRects.push(...Array.from(range.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0))
    }
    const clippedBy = ancestors.flatMap(node => {
      const computed = getComputedStyle(node)
      const bounds = node.getBoundingClientRect()
      const clipX = /hidden|clip|auto|scroll/.test(computed.overflowX)
      const clipY = /hidden|clip|auto|scroll/.test(computed.overflowY)
      return textRects.some(rect => (clipX && (rect.left < bounds.left - 1 || rect.right > bounds.right + 1)) || (clipY && (rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1)))
        ? [{ tag: node.tagName, testId: node.getAttribute("data-testid"), height: bounds.height, overflowX: computed.overflowX, overflowY: computed.overflowY }]
        : []
    })
    const rect = element.getBoundingClientRect()
    return { text: element.textContent?.trim(), fontSize: parseFloat(style.fontSize), lineHeight: parseFloat(style.lineHeight), contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), width: rect.width, height: rect.height, textRects: textRects.length, clippedBy, viewportOverflow: document.documentElement.scrollWidth > innerWidth + 1 }
  })
  await info.attach(`${label}-metrics`, { body: JSON.stringify(metrics, null, 2), contentType: "application/json" })
  await page.screenshot({ path: info.outputPath(`${label}.png`), scale: "css" })
  expect.soft(metrics.fontSize, `${label}: decision prose`).toBeGreaterThanOrEqual(15)
  expect.soft(metrics.lineHeight / metrics.fontSize, `${label}: line spacing`).toBeGreaterThanOrEqual(1.44)
  expect.soft(metrics.contrast, `${label}: text contrast`).toBeGreaterThanOrEqual(4.5)
  expect.soft(metrics.textRects, `${label}: rendered text`).toBeGreaterThan(0)
  expect.soft(metrics.clippedBy, `${label}: text must not collapse or be clipped`).toEqual([])
  expect.soft(metrics.viewportOverflow, `${label}: horizontal overflow`).toBe(false)
}

async function chooseFunding(page: Page, rail: "krw_bank" | "card_wallet" | "digital_dollar", card?: "card" | "apple_pay") {
  await page.getByTestId("wallet-funding-change").click()
  await page.locator(`input[name="funding-source"][value="${rail}"]`).check()
  await page.getByTestId("funding-method-save").click()
  if (card) await page.getByTestId(`funding-card-${card}`).click()
  await expect(page.getByTestId("funding-rail-journey")).toHaveAttribute("data-phase", "quoted")
}

async function fundForCheckout(page: Page) {
  await chooseFunding(page, "krw_bank")
  await page.getByTestId("funding-quote-continue").click()
  await page.getByTestId("funding-consent").check()
  await page.getByTestId("funding-authorize").click()
  await expect(page.getByTestId("funding-rail-journey")).toHaveAttribute("data-phase", "settled")
  await page.getByTestId("funding-sample-use").click()
}

async function openCheckout(page: Page) {
  await page.getByTestId("kpass-sample-picker").click()
  await page.getByTestId("kpass-scenario-adult_visitor").click()
  await expand(page.getByTestId("kpass-service-disclosure"))
  await page.getByTestId("kpass-service-visitor_benefit").click()
  await page.getByTestId("benefit-accept").click()
  await expect(page.getByTestId("payment-minimum-consent").getByRole("checkbox")).not.toBeChecked()
}

async function completeCheckout(page: Page) {
  await page.getByTestId("payment-minimum-consent").getByRole("checkbox").check()
  await page.getByTestId("payment-confirm").click()
  // The public adult-visitor sample already supplies a credential. This is the
  // one-use presentation gate, not action-origin credential issuance (which
  // atomically returns from holder acknowledgment to its remaining gate).
  for (const axis of ["account", "payment_kyc", "credential"] as const) {
    await expect(page.getByTestId("ondo-b-action-gate")).toHaveAttribute("data-active-gate", axis)
    await page.getByTestId("action-gate-confirm").click()
  }
  await expect(page.getByTestId("payment-receipt")).toBeVisible()
}

test("M06 method-specific ID approval meaning remains readable", async ({ page, baseURL }, info) => {
  await boot(page, baseURL)
  for (const method of ["mobile-id", "residence-card", "passport"] as const) {
    await page.getByTestId("kpass-start-setup").click()
    await page.getByTestId(`ktour-id-route-${method}`).click()
    await expect(page.getByTestId("k-tour-id-consent")).toBeVisible()
    for (const meaning of ["purpose", "evidence"] as const) await decisionCopy(page, page.getByTestId(`identity-consent-${meaning}`).locator("dd"), info, `id-${method}-${meaning}`)
    await expand(page.getByTestId("identity-consent-retention"))
    await decisionCopy(page, page.getByTestId("identity-consent-retention").locator("dd"), info, `id-${method}-retention`)
    await expect(page.getByTestId("identity-consent-requester")).toContainText("K-Tour ID")
    await page.keyboard.press("Escape")
    await expect(page.getByTestId("k-tour-id-setup")).toHaveCount(0)
  }
})

test("M06 short-landscape minimum answer and retention cannot flex-collapse", async ({ page, baseURL }, info) => {
  await boot(page, baseURL, { width: 820, height: 390 })
  await page.getByTestId("travel-pass-readiness-toggle").click()
  await page.getByTestId("traveler-id-age-check").click()
  const dialog = page.getByTestId("ondo-b-local-check-walkthrough")
  await expect(dialog).toHaveAttribute("data-check-kind", "age")
  const truth = dialog.locator("#local-check-consent-minimum")
  // Check the actual container before any scroll-to-text helper can mask it.
  const truthGeometry = await truth.evaluate(node => ({ height: node.getBoundingClientRect().height, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight }))
  await info.attach("landscape-decision-truth-container", { body: JSON.stringify(truthGeometry), contentType: "application/json" })
  expect.soft(truthGeometry.height).toBeGreaterThan(70)
  await decisionCopy(page, dialog.locator('p[class*="lead"]'), info, "landscape-age-purpose")
  for (const meaning of ["minimum", "retention"] as const) await decisionCopy(page, dialog.getByTestId(`consent-${meaning}`).locator("strong"), info, `landscape-age-${meaning}`)
  await expand(page.getByTestId("local-check-boundary"))
  await decisionCopy(page, page.getByTestId("local-check-boundary").locator(":scope > p"), info, "landscape-check-boundary")
  await decisionCopy(page, page.getByTestId("consent-purpose").locator("dd"), info, "landscape-check-purpose-detail")
  await expect(page.getByTestId("local-check-boundary-continue")).toBeEnabled()
  await page.keyboard.press("Escape")
  await expect(dialog).toHaveCount(0)
  await expect(page.getByTestId("traveler-id-age")).toHaveAttribute("data-status", "none")
})

test("M06 contextual Payment and one-use credential approval stay readable at KO320", async ({ page, baseURL }, info) => {
  await boot(page, baseURL, { width: 320, height: 800, locale: "ko", dark: true })
  await fundForCheckout(page)
  await openCheckout(page)
  await page.getByTestId("payment-minimum-consent").getByRole("checkbox").check()
  await page.getByTestId("payment-confirm").click()
  const gate = page.getByTestId("ondo-b-action-gate")
  for (const axis of ["account", "payment_kyc", "credential"] as const) {
    await expect(gate).toHaveAttribute("data-active-gate", axis)
    await decisionCopy(page, gate.locator('p[class*="lead"]'), info, `context-${axis}-meaning`)
    if (axis === "credential") {
      for (const meaning of ["predicate", "retention"] as const) await decisionCopy(page, gate.getByTestId(`credential-visible-${meaning}`).locator("strong"), info, `credential-${meaning}`)
      await page.getByTestId("action-gate-cancel").click()
    } else await page.getByTestId("action-gate-confirm").click()
  }
  await expect(gate).toHaveCount(0)
  await expect(page.getByTestId("payment-receipt")).toHaveCount(0)
  await expect(page.getByTestId("payment-minimum-consent")).toBeVisible()
})

for (const method of ["bank", "card", "apple_pay"] as const) {
  test(`M07 ${method} approval and balance-consequence prose remain readable`, async ({ page, baseURL }, info) => {
    await boot(page, baseURL)
    await chooseFunding(page, method === "bank" ? "krw_bank" : "card_wallet", method === "bank" ? undefined : method)
    const flow = page.getByTestId("funding-rail-journey")
    if (method === "bank") {
      for (const width of [360, 430, 390]) {
        await page.setViewportSize({ width, height: 844 })
        const insets = await page.getByTestId("funding-source-sheet").locator("[data-sample-step]").evaluate(node => {
          const style = getComputedStyle(node)
          return { left: parseFloat(style.paddingLeft), right: parseFloat(style.paddingRight), overflowY: style.overflowY, horizontalOverflow: node.scrollWidth > node.clientWidth + 1 }
        })
        await info.attach(`funding-insets-${width}`, { body: JSON.stringify(insets), contentType: "application/json" })
        expect(insets.left).toBe(width <= 360 ? 16 : 20)
        expect(insets.right).toBe(width <= 360 ? 16 : 20)
        expect(insets.overflowY).toBe("auto")
        expect(insets.horizontalOverflow).toBe(false)
        await page.screenshot({ path: info.outputPath(`bank-quote-${width}.png`), scale: "css" })
      }
    }
    await decisionCopy(page, flow.locator(':scope > p[class*="note"]'), info, `${method}-quote-boundary`)
    await page.getByTestId("funding-quote-continue").click()
    await expect(page.getByTestId("funding-consent")).not.toBeChecked()
    await expect(page.getByTestId("funding-authorize")).toBeDisabled()
    await decisionCopy(page, flow.locator(':scope > p[class*="note"]'), info, `${method}-approval-boundary`)
    await decisionCopy(page, page.getByTestId("funding-consent").locator("xpath=following-sibling::span"), info, `${method}-consent`)
    const outcome = method === "bank" ? "unknown" : method === "card" ? "failed" : "settled"
    await expand(page.getByTestId(`funding-outcome-${outcome}`))
    await page.getByTestId(`funding-outcome-${outcome}`).click()
    await page.getByTestId("funding-consent").check()
    await page.getByTestId("funding-authorize").click()
    await expect(flow).toHaveAttribute("data-phase", outcome)
    await decisionCopy(page, flow.locator('p[class*="note"]'), info, `${method}-${outcome}-consequence`)
    if (outcome === "unknown") {
      await expect(flow).not.toHaveAttribute("data-credit-committed", "true")
      await page.getByTestId("funding-check-status").click()
      await expect(flow).toHaveAttribute("data-phase", "settled")
      await decisionCopy(page, flow.locator('p[class*="note"]'), info, `${method}-settled-consequence`)
    }
  })
}

test("M07 JA320 stablecoin consent distinguishes source confirmation from credited arrival", async ({ page, baseURL }, info) => {
  await boot(page, baseURL, { width: 320, height: 800, locale: "ja", dark: true })
  await chooseFunding(page, "digital_dollar")
  const stable = page.getByTestId("stablecoin-funding")
  await decisionCopy(page, stable.locator(':scope > p[class*="truth"]'), info, "stablecoin-sample-truth")
  await page.getByTestId("stablecoin-asset-USDT").click()
  await page.getByTestId("stablecoin-signer-existing_wallet").click()
  await decisionCopy(page, stable.locator('[class*="signer"] > p'), info, "stablecoin-connection-scope")
  await page.getByTestId("stablecoin-connect").click()
  await page.getByTestId("stablecoin-connection-approve").click()
  await page.getByTestId("funding-quote-continue").click()
  await decisionCopy(page, stable.locator(':scope > p[class*="notice"]'), info, "stablecoin-single-transfer")
  await decisionCopy(page, page.getByTestId("funding-consent").locator("xpath=following-sibling::span"), info, "stablecoin-consent")
  await expect(page.getByTestId("funding-consent")).not.toBeChecked()
  await page.getByTestId("funding-consent").check()
  await page.getByTestId("funding-authorize").click()
  await expand(page.getByTestId("stablecoin-status-unknown"))
  await page.getByTestId("stablecoin-status-unknown").click()
  await page.getByTestId("stablecoin-check-source").click()
  await decisionCopy(page, stable.locator('p[role="status"]'), info, "stablecoin-unknown-no-resend")
  await expect(page.getByTestId("funding-rail-journey")).not.toHaveAttribute("data-credit-committed", "true")
  await page.getByTestId("stablecoin-check-source").click()
  await expect(stable).toHaveAttribute("data-source-status", "confirmed")
  await expect(stable).not.toHaveAttribute("data-destination-status", "confirmed")
  await decisionCopy(page, stable.locator('[class*="resultHero"] > p'), info, "stablecoin-source-not-arrival")
  for (let index = 0; index < 3; index++) await decisionCopy(page, stable.locator('[class*="journey"] small').nth(index), info, `stablecoin-progress-${index}`)
  await expect(page.getByTestId("funding-rail-journey")).not.toHaveAttribute("data-credit-committed", "true")
  await page.getByTestId("stablecoin-check-destination").click()
  await expect(page.getByTestId("funding-rail-journey")).toHaveAttribute("data-credit-committed", "true")
  await decisionCopy(page, stable.locator(':scope > p[class*="notice"]'), info, "stablecoin-credited-consequence")
})

test("M08 checkout consent and partial or unknown refund consequences remain readable", async ({ page, baseURL }, info) => {
  await boot(page, baseURL)
  await fundForCheckout(page)
  await openCheckout(page)
  const consent = page.getByTestId("payment-minimum-consent")
  await decisionCopy(page, consent.locator("label > span"), info, "checkout-balance-approval")
  await decisionCopy(page, consent.locator("p"), info, "checkout-approval-scope")
  await completeCheckout(page)
  const receipt = page.getByTestId("payment-receipt")
  const venueId = await receipt.getByTestId("receipt-place-context").getAttribute("data-venue-id")
  expect(venueId).toBeTruthy()
  await decisionCopy(page, receipt.locator(':scope > p[class*="receiptLead"]'), info, "receipt-benefit-consequence")
  await decisionCopy(page, receipt.getByTestId("payment-receipt-consequence"), info, "receipt-no-external-payment")
  const refunds = page.getByTestId("checkout-refund-panel")
  await expand(refunds)
  await decisionCopy(page, refunds.locator(':scope > div > p[class*="note"]').first(), info, "refund-amount-benefit-consequence")
  await page.getByTestId("checkout-refund-amount").fill("5000")
  await page.getByTestId("checkout-refund-submit").click()
  await expect(page.getByTestId("checkout-refund-operation")).toHaveAttribute("data-phase", "settled")
  await decisionCopy(page, refunds.locator(':scope > div > p[class*="note"]').first(), info, "partial-refund-benefit-consequence")
  await expand(page.getByTestId("checkout-refund-case"))
  await page.getByTestId("checkout-refund-case").selectOption("unknown")
  await page.getByTestId("checkout-refund-all").click()
  await page.getByTestId("checkout-refund-submit").click()
  await expect(page.getByTestId("checkout-refund-operation").last()).toHaveAttribute("data-phase", "unknown")
  const unresolvedOperation = await page.getByTestId("checkout-refund-operation").last().getAttribute("data-operation-id")
  await decisionCopy(page, page.getByTestId("checkout-refund-operation").last().locator("small"), info, "unknown-refund-status")
  await decisionCopy(page, refunds.locator('p[role="status"]'), info, "unknown-refund-unchanged-balance")
  await expect(page.getByTestId("checkout-refund-total")).toContainText("5,000")
  await page.getByTestId("checkout-refund-check").click()
  await expect(page.getByTestId("checkout-refund-operation").last()).toHaveAttribute("data-phase", "settled")
  await expect(page.getByTestId("checkout-refund-operation").last()).toHaveAttribute("data-operation-id", unresolvedOperation!)
  await expect(page.getByTestId("checkout-refund-operation")).toHaveCount(2)
  await expect(page.getByTestId("checkout-refund-remaining")).toHaveText("₩0")
  await decisionCopy(page, receipt.locator(':scope > p[class*="receiptLead"]'), info, "full-refund-benefit-restored")
  await page.getByTestId("payment-receipt-return").click()
  await expect(page.getByTestId("payment-receipt")).toHaveCount(0)
  await expect(page.getByTestId("canonical-place-peek")).toHaveAttribute("data-venue-id", venueId!)
  await page.screenshot({ path: info.outputPath("full-refund-exact-place-return.png"), scale: "css" })
})

test("M09 credited amount precedes the primary return and secondary discovery action", async ({ page, baseURL }, info) => {
  await boot(page, baseURL)
  await chooseFunding(page, "krw_bank")
  await page.getByTestId("funding-quote-continue").click()
  await page.getByTestId("funding-consent").check()
  await page.getByTestId("funding-authorize").click()
  const flow = page.getByTestId("funding-rail-journey")
  await expect(flow).toHaveAttribute("data-phase", "settled")
  await expect(flow).toHaveAttribute("data-credit-committed", "true")
  const sheet = page.getByTestId("funding-source-sheet")
  const back = sheet.getByTestId("funding-sample-use")
  const places = sheet.getByTestId("funding-balance-places")
  await expect(back).toHaveText("Back to balance")
  await expect(places).toBeVisible()
  const settledBalance = await page.getByTestId("funding-receipt-balance").innerText()
  const hierarchy = await sheet.evaluate(node => {
    const amount = node.querySelector('[data-testid="funding-receipt-balance"]')!
    const primary = node.querySelector('[data-testid="funding-sample-use"]')!
    const secondary = node.querySelector('[data-testid="funding-balance-places"]')!
    return {
      amountBeforeReturn: Boolean(amount.compareDocumentPosition(primary) & Node.DOCUMENT_POSITION_FOLLOWING),
      returnBeforeDiscovery: Boolean(primary.compareDocumentPosition(secondary) & Node.DOCUMENT_POSITION_FOLLOWING),
      primaryBackground: getComputedStyle(primary).backgroundColor,
      secondaryBackground: getComputedStyle(secondary).backgroundColor,
      primaryHeight: primary.getBoundingClientRect().height,
      secondaryHeight: secondary.getBoundingClientRect().height,
    }
  })
  await info.attach("funding-result-hierarchy", { body: JSON.stringify(hierarchy, null, 2), contentType: "application/json" })
  expect(hierarchy.amountBeforeReturn).toBe(true)
  expect(hierarchy.returnBeforeDiscovery).toBe(true)
  expect(hierarchy.secondaryBackground).not.toBe(hierarchy.primaryBackground)
  expect(hierarchy.primaryHeight).toBeGreaterThanOrEqual(44)
  expect(hierarchy.secondaryHeight).toBeGreaterThanOrEqual(44)
  await page.getByTestId("funding-receipt-balance").scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath("funding-result-primary-secondary.png"), scale: "css" })
  await places.scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath("funding-result-actions.png"), scale: "css" })
  await back.click()
  await expect(sheet).toHaveCount(0)
  await expect(page.getByTestId("wallet-display-equivalent")).toHaveText(settledBalance)
  await expect(page.getByTestId("traveler-id-payment")).toHaveAttribute("data-status", "none")
  await expect(page.getByTestId("payment-receipt")).toHaveCount(0)
})

for (const view of [{ width: 390, locale: "en", dark: false }, { width: 320, locale: "ja", dark: true }] as const) {
test(`M10 ${view.locale}${view.width} receipt hierarchy condenses sample truth without losing benefit or financial details`, async ({ page, baseURL }, info) => {
  await boot(page, baseURL, view)
  await fundForCheckout(page)
  await openCheckout(page)
  await completeCheckout(page)
  const receipt = page.getByTestId("payment-receipt")
  const inspectReceipt = async (phase: "paid" | "refunded") => {
    const heading = receipt.locator(":scope > h2")
    for (const width of [320, 430, 390]) {
      await page.setViewportSize({ width, height: 844 })
      const titleStyle = await heading.evaluate(node => {
        const style = getComputedStyle(node)
        return { fontSize: parseFloat(style.fontSize), lineHeight: parseFloat(style.lineHeight), overflow: document.documentElement.scrollWidth > innerWidth + 1 }
      })
      await info.attach(`receipt-title-${phase}-${width}`, { body: JSON.stringify(titleStyle), contentType: "application/json" })
      expect(titleStyle.fontSize).toBeGreaterThanOrEqual(28)
      expect(titleStyle.fontSize).toBeLessThanOrEqual(32)
      expect(titleStyle.lineHeight / titleStyle.fontSize).toBeGreaterThanOrEqual(1.14)
      expect(titleStyle.overflow).toBe(false)
    }
    await page.setViewportSize({ width: view.width, height: 844 })
    const lead = receipt.locator(':scope > p[class*="receiptLead"]')
    await expect(lead).toContainText(/benefit|特典/i)
    const truth = receipt.getByTestId("payment-receipt-consequence")
    await expect(truth).toHaveCount(1)
    await expect(truth).toBeVisible()
    await expect(truth).toContainText(/no (external|real)|外部注文|実際のお金/i)
    const provenance = receipt.getByTestId("payment-review-provenance")
    await expect(provenance).toHaveAttribute("data-review-provenance", "review")
    // One visible truth block, with the sample provenance retained inside it.
    expect(await provenance.evaluate(node => Boolean(node.closest('[data-testid="payment-receipt-consequence"]')))).toBe(true)
    await expect(truth).toContainText(/sample|review|サンプル/i)
    await expect(receipt.getByTestId("receipt-place-context")).toBeVisible()
    const details = receipt.getByTestId("commerce-settlement-details")
    await expect(details).not.toHaveAttribute("open", "")
    await expect(details.getByTestId("commerce-receipt-reference")).not.toBeVisible()
    await heading.scrollIntoViewIfNeeded()
    await page.screenshot({ path: info.outputPath(`receipt-hierarchy-${phase}.png`), scale: "css" })
    const primary = receipt.getByTestId("payment-receipt-return")
    await primary.scrollIntoViewIfNeeded()
    const primaryPaint = await primary.evaluate(node => {
      const style = getComputedStyle(node)
      // Resolve theme colors without touching application/domain state.
      const swatch = document.createElement("span")
      swatch.style.cssText = "position:absolute;visibility:hidden;color:var(--ondo-control);background:var(--ondo-control-ink)"
      node.append(swatch)
      const tokens = getComputedStyle(swatch)
      const result = { height: node.getBoundingClientRect().height, background: style.backgroundColor, foreground: style.color, backgroundImage: style.backgroundImage, control: tokens.color, controlInk: tokens.backgroundColor }
      swatch.remove()
      return result
    })
    await info.attach(`receipt-return-${phase}`, { body: JSON.stringify(primaryPaint), contentType: "application/json" })
    expect(primaryPaint.height).toBeGreaterThanOrEqual(52)
    expect(primaryPaint.backgroundImage).toBe("none")
    expect(primaryPaint.background).toBe(primaryPaint.control)
    expect(primaryPaint.foreground).toBe(primaryPaint.controlInk)
    await page.screenshot({ path: info.outputPath(`receipt-return-${phase}.png`), scale: "css" })
    await expand(details)
    await expect(details.getByTestId("commerce-receipt-reference").locator("code")).not.toBeEmpty()
    await expect(details.getByTestId("commerce-operation-id").locator("code")).not.toBeEmpty()
    await expect(details.getByTestId("commerce-provider-status")).toHaveAttribute("data-provider-order", "NOT_CONNECTED")
    await expect(details.getByTestId("commerce-holder-delta")).toBeVisible()
    await expect(details.getByTestId("commerce-merchant-delta")).toBeVisible()
    await details.locator(":scope > summary").click()
  }
  await inspectReceipt("paid")
  await expand(page.getByTestId("checkout-refund-panel"))
  await page.getByTestId("checkout-refund-all").click()
  await page.getByTestId("checkout-refund-submit").click()
  await expect(receipt).toHaveAttribute("data-completion-kind", "refunded")
  await expect(page.getByTestId("checkout-refund-operation")).toHaveAttribute("data-phase", "settled")
  await expect(page.getByTestId("checkout-refund-remaining")).toHaveText("₩0")
  await inspectReceipt("refunded")
  await page.getByTestId("payment-receipt-return").click()
  await expect(receipt).toHaveCount(0)
})
}

for (const view of [{ width: 390, locale: "en", dark: false }, { width: 320, locale: "ja", dark: true }] as const) {
test(`R9 saved purchase keeps exact financial references and distinct place or wallet returns ${view.locale} ${view.width}`, async ({ page, baseURL }, info) => {
  await boot(page, baseURL, view)
  await fundForCheckout(page)
  await openCheckout(page)
  await completeCheckout(page)
  const receipt = page.getByTestId("payment-receipt")
  const venueId = await receipt.getByTestId("receipt-place-context").getAttribute("data-venue-id")
  expect(venueId).toBeTruthy()
  // Read the public receipt; do not seed or reinterpret stored authority.
  await expand(receipt.getByTestId("commerce-settlement-details"))
  const paymentReference = await receipt.getByTestId("commerce-receipt-reference").locator("code").innerText()
  await expand(page.getByTestId("checkout-refund-panel"))
  await page.getByTestId("checkout-refund-amount").fill("5000")
  await page.getByTestId("checkout-refund-submit").click()
  await expect(page.getByTestId("checkout-refund-operation")).toHaveAttribute("data-phase", "settled")
  const refundOperation = await page.getByTestId("checkout-refund-operation").getAttribute("data-operation-id")
  expect(refundOperation).toBeTruthy()
  await page.getByTestId("payment-receipt-return").click()
  await expect(receipt).toHaveCount(0)
  // A canonical place can remain as the legitimate checkout origin.
  for (let attempt = 0; attempt < 2; attempt++) {
    if (await page.getByTestId("canonical-place-overlay").isVisible() || await page.getByTestId("canonical-place-peek").isVisible()) await page.keyboard.press("Escape")
  }
  await page.getByTestId("nav-my").click()
  const saved = page.getByTestId("my-korea-selected-purchase")
  await expect(saved).toHaveAttribute("data-venue-id", venueId!)
  await expand(saved.getByTestId("my-korea-receipt-details"))
  await expect(saved.getByTestId("my-korea-payment-reference")).toContainText(paymentReference)
  await expect(saved.getByTestId("my-korea-refund-reference")).toHaveCount(1)
  await expect(saved.getByTestId("my-korea-refund-reference")).toContainText(`${refundOperation}:receipt`)
  const place = saved.getByTestId("my-korea-receipt-place")
  const wallet = saved.getByTestId("my-korea-receipt-wallet")
  await expect(place).toBeVisible()
  await expect(wallet).toBeVisible()
  const paint = await saved.evaluate(node => {
    const primary = node.querySelector('[data-testid="my-korea-receipt-place"]')!
    const secondary = node.querySelector('[data-testid="my-korea-receipt-wallet"]')!
    return { primaryBackground: getComputedStyle(primary).backgroundColor, secondaryBackground: getComputedStyle(secondary).backgroundColor, primaryFont: parseFloat(getComputedStyle(primary).fontSize), secondaryFont: parseFloat(getComputedStyle(secondary).fontSize), overflow: node.scrollWidth > node.clientWidth + 1, placeBeforeWallet: Boolean(primary.compareDocumentPosition(secondary) & Node.DOCUMENT_POSITION_FOLLOWING), primaryHeight: primary.getBoundingClientRect().height, secondaryHeight: secondary.getBoundingClientRect().height }
  })
  await info.attach("saved-purchase-action-hierarchy", { body: JSON.stringify(paint, null, 2), contentType: "application/json" })
  expect(paint.primaryBackground).not.toBe(paint.secondaryBackground)
  expect(paint.placeBeforeWallet).toBe(true)
  expect(paint.primaryHeight).toBeGreaterThanOrEqual(52)
  expect(paint.secondaryHeight).toBeGreaterThanOrEqual(48)
  expect(paint.primaryFont).toBeGreaterThanOrEqual(15)
  expect(paint.secondaryFont).toBeGreaterThanOrEqual(15)
  expect(paint.overflow).toBe(false)
  await saved.scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath("saved-purchase-actions.png"), scale: "css" })
  await place.click()
  await expect(page.getByTestId("canonical-place-peek")).toHaveAttribute("data-venue-id", venueId!)
  await page.keyboard.press("Escape")
  await expect(page.getByTestId("canonical-place-peek")).toHaveCount(0)
  await page.getByTestId("nav-my").click()
  await wallet.click()
  await expect(page.getByTestId("nav-id")).toHaveAttribute("aria-current", "page")
  await expect(page.getByTestId("wallet-display-equivalent")).toBeVisible()
  await expect(page.getByTestId("payment-receipt")).toHaveCount(0)
  await page.getByTestId("nav-my").click()
  await expect(saved).toHaveAttribute("data-venue-id", venueId!)
  await expand(saved.getByTestId("my-korea-receipt-details"))
  await expect(saved.getByTestId("my-korea-payment-reference")).toContainText(paymentReference)
  await expect(saved.getByTestId("my-korea-refund-reference")).toContainText(`${refundOperation}:receipt`)
})
}
