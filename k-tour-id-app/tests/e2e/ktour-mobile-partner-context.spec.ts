import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test"

// Prepared independently; do not run until M11 is active. No private engine
// access, credential seeding, injected outcomes, real camera, or provider calls.
const TTL = 2 * 60 * 1000
const layouts = [
  { locale: "ja", appearance: "light", width: 320, height: 568, purpose: "age" },
  { locale: "en", appearance: "light", width: 390, height: 844, purpose: "person" },
  { locale: "ko", appearance: "dark", width: 430, height: 932, purpose: "visitor_benefit" },
] as const
type Layout = typeof layouts[number]
type Locale = Layout["locale"]
const wording = {
  en: { partner: "K-Tour ID sample café", person: "Identity", age: "19+", visitor_benefit: "Visitor benefit", denied: "Not shared",
    minimal: /yes\s*(?:\/|or|·|–|-)\s*no|eligible\s*(?:\/|or)\s*not eligible/i,
    session: /(?:this|current) page|page session/i, noSend: /no external|nothing.*(?:sent|send)|not.*sent.*external/i,
    reload: /reload|refresh/i, reset: /sample.{0,30}reset|reset.{0,30}sample/i,
    originalNotShared: "Your original ID or document is not shared.", closeRetains: "Closing this panel does not clear it." },
  ko: { partner: "K-Tour ID 샘플 카페", person: "신원", age: "19+", visitor_benefit: "방문자 혜택", denied: "공유하지 않았어요",
    minimal: /예\s*[\/·-]\s*아니요|충족\s*여부|참\s*[\/·-]\s*거짓/,
    session: /현재 페이지|이 페이지|페이지 세션/, noSend: /외부.{0,30}(?:전송|공유).{0,15}(?:없|않)|외부 전송 없음/,
    reload: /새로고침/, reset: /샘플.{0,20}초기화|초기화.{0,20}샘플/,
    originalNotShared: "원본 신분증이나 문서는 공유하지 않아요.", closeRetains: "창을 닫아도 기록은 남아요." },
  ja: { partner: "K-Tour ID サンプルカフェ", person: "本人", age: "19+", visitor_benefit: "旅行者特典", denied: "共有していません",
    minimal: /はい\s*[\/／・]\s*いいえ|該当.{0,8}非該当|適格.{0,8}不適格/,
    session: /このページ|現在のページ|ページセッション/, noSend: /外部.{0,20}送信.{0,15}(?:しません|されません|なし)/,
    reload: /再読み込み|リロード/, reset: /サンプル.{0,20}(?:リセット|初期化)/,
    originalNotShared: "元の身分証や書類は共有しません。", closeRetains: "画面を閉じても記録は残ります。" },
} as const
const faults = new WeakMap<Page, string[]>()

test.describe.configure({ timeout: 90_000 })
test.beforeEach(async ({ page, context }, info) => {
  test.skip(info.project.name !== "mobile-chromium", "Mobile holder-consent regression")
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

async function openTools(page: Page) {
  await page.locator("[data-testid='review-sample-indicator']:visible").first().click()
  await page.getByTestId("integration-demo-open").click()
  await expect(page.getByTestId("integration-demo")).toHaveAttribute("data-provenance", "SIMULATED")
}

async function enterCounter(page: Page, layout: Layout) {
  await page.setViewportSize(layout)
  await page.addInitScript(({ locale, appearance }) => {
    if (!/^https?:$/.test(location.protocol) || !["127.0.0.1", "localhost"].includes(location.hostname)) return
    if (!localStorage.getItem("ondo-b.device.v1")) localStorage.setItem("ondo-b.device.v1", JSON.stringify({ locale, appearancePreference: appearance }))
  }, layout)
  await page.goto("/?review=1", { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("ondo-b-root")).toHaveAttribute("data-hydrated", "true")
  await page.evaluate(() => document.fonts.ready)
  await expect(page.getByTestId("ondo-onboarding-backdrop")).toHaveCount(0)
  await openTools(page)
  await page.getByTestId("partner-sample-sign-in").click()
  const consent = page.getByTestId("partner-device-consent")
  await expect(consent).not.toBeChecked()
  await expect(page.getByTestId("partner-device-ready")).toBeDisabled()
  await consent.check()
  await page.getByTestId("partner-device-ready").click()
  await page.getByTestId("integration-demo").getByRole("button", { name: wording[layout.locale][layout.purpose], exact: true }).click()
}

async function createAndScan(page: Page) {
  const before = await page.evaluate(() => Date.now())
  await page.getByTestId("integration-verifier-create").click()
  const after = await page.evaluate(() => Date.now())
  const handoff = page.getByTestId("partner-request-handoff")
  await expect(handoff).toHaveAttribute("data-view", "counter")
  await expect(handoff.getByTestId("partner-sample-qr")).toBeVisible()
  await page.getByTestId("integration-holder-open").click()
  await page.getByTestId("partner-camera-allow").click()
  await expect(handoff).toHaveAttribute("data-view", "scan")
  await page.getByTestId("partner-qr-scan").click()
  await expect(page.getByTestId("integration-holder-request")).toHaveAttribute("data-phase", "consent")
  await expect(page.getByTestId("integration-holder-request").getByRole("heading")).toBeFocused()
  // The scanner is a local sample interaction, not browser camera permission.
  await expect(page.locator("input[type='file'], video")).toHaveCount(0)
  return { before, after }
}

async function persistentBusinessState(page: Page) {
  return page.evaluate(() => ({
    device: localStorage.getItem("ondo-b.device.v1"),
    sessions: Object.fromEntries(["ondo-b.account.v1", "ondo-b.action-gates.v1", "ondo-b.after19.session.v1", "ondo-b.activity-profile.v1", "ondo-b.labs.v1"].map(key => [key, sessionStorage.getItem(key)])),
  }))
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
  expect(await control.evaluate(node => { const b = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)) })).toBe(true)
}

async function capture(page: Page, info: TestInfo, label: string, metrics?: unknown) {
  await page.screenshot({ path: info.outputPath(`${label}.png`), scale: "css" })
  await info.attach(`${label}-metrics`, { contentType: "application/json", body: JSON.stringify({ metrics,
    artifact: await page.evaluate(() => ({ url: location.href, width: innerWidth, height: innerHeight,
      resources: performance.getEntriesByType("resource").map(entry => entry.name).filter(name => /\/_next\/static\/.*\.(css|js)(\?|$)/.test(name)),
    })),
  }, null, 2) })
}

async function requestContext(page: Page, locale: Locale, purpose: Layout["purpose"], issued: { before: number; after: number }, info: TestInfo) {
  const context = page.getByTestId("partner-holder-request-context"), t = wording[locale]
  await expect(context).toHaveJSProperty("tagName", "DL")
  await expect(context.locator("dt")).toHaveCount(5)
  await expect(context.locator("dd")).toHaveCount(5)
  const text = await context.innerText()
  expect(text).toContain(t.partner)
  expect(text).toContain(t[purpose])
  expect(text).toMatch(t.minimal)
  expect(text).toMatch(t.session)
  expect(text).toMatch(t.noSend)
  expect(text).toMatch(t.reload)
  expect(text).toMatch(t.reset)
  expect(text).toContain(t.originalNotShared)
  expect(text).toContain(t.closeRetains)
  expect(text).not.toMatch(/sample-request:|sample-check:|credentialId|did:|0x[\da-f]{16}/i)
  for (const disclosure of [t.originalNotShared, t.closeRetains]) {
    const value = context.locator("dd").filter({ hasText: disclosure })
    await value.scrollIntoViewIfNeeded()
    await expect(value).toBeVisible()
  }
  const values = []
  for (const value of await context.locator("dd").all()) {
    await value.scrollIntoViewIfNeeded()
    const metric = await value.evaluate(node => {
      const range = document.createRange(); range.selectNodeContents(node)
      return { text: node.textContent, fontSize: parseFloat(getComputedStyle(node).fontSize), bounds: node.getBoundingClientRect().toJSON(),
        lines: [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0).map(rect => rect.toJSON()), overflow: node.scrollWidth > node.clientWidth + 1 }
    })
    expect(metric.fontSize).toBeGreaterThanOrEqual(15)
    expect(metric.overflow).toBe(false)
    for (const line of metric.lines) {
      expect(line.left).toBeGreaterThanOrEqual(metric.bounds.left - 1)
      expect(line.right).toBeLessThanOrEqual(metric.bounds.right + 1)
      expect(line.bottom).toBeLessThanOrEqual(metric.bounds.bottom + 1)
    }
    values.push(metric)
  }
  const time = context.locator("time[datetime]")
  await expect(time).toHaveCount(1)
  const datetime = await time.getAttribute("datetime"), deadline = Date.parse(datetime!)
  expect(Number.isFinite(deadline)).toBe(true)
  expect(deadline).toBeGreaterThanOrEqual(issued.before + TTL)
  expect(deadline).toBeLessThanOrEqual(issued.after + TTL)
  const clockParts = await page.evaluate(({ locale, deadline }) => Object.fromEntries(new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).formatToParts(deadline).map(part => [part.type, part.value])), { locale, deadline })
  // Intl's Korean best-fit pattern can render 5분 even when another formatter
  // with fewer fields renders 05. Compare the numeric clock components, then
  // assert the exact full seconds/timezone string below.
  const shownClock = (await time.innerText()).match(/(\d+)\s*[:시時]\s*(\d+)/)
  expect(shownClock).not.toBeNull()
  expect(Number(shownClock![1])).toBe(Number(clockParts.hour))
  expect(Number(shownClock![2])).toBe(Number(clockParts.minute))
  const expiryText = await page.evaluate(({ locale, deadline }) => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short" }).format(deadline), { locale, deadline })
  await expect(time).toHaveText(expiryText)
  await context.locator("dd").first().scrollIntoViewIfNeeded()
  await capture(page, info, "holder-request-context", { datetime, deadline, issued, values })
  await page.getByTestId("integration-holder-deny").scrollIntoViewIfNeeded()
  await target(page.getByTestId("integration-holder-deny"), page)
  await target(page.getByTestId("integration-holder-approve"), page)
  await capture(page, info, "holder-context-and-decision", { datetime, values })
  return { datetime, deadline, text }
}

for (const layout of layouts) {
  test(`M11 holder context explains actual request and denial ${layout.locale} ${layout.width}`, async ({ page }, info) => {
    // Keep the Korean single-digit minute regression reproducible, without
    // injecting identity, permissions, outcomes, or the engine's deadline.
    if (layout.locale === "ko") await page.clock.install({ time: new Date("2026-09-16T11:03:04.000Z") })
    await enterCounter(page, layout)
    const before = await persistentBusinessState(page)
    const issued = await createAndScan(page)
    const context = await requestContext(page, layout.locale, layout.purpose, issued, info)
    // Closing the tools is not a deletion/reset operation. The same in-memory
    // request and deadline return when this still-open page reopens the tools.
    await page.keyboard.press("Escape")
    await expect(page.getByTestId("integration-demo")).toHaveCount(0)
    await openTools(page)
    await expect(page.getByTestId("integration-holder-request")).toHaveAttribute("data-phase", "consent")
    await expect(page.getByTestId("integration-holder-request").getByRole("heading")).toBeFocused()
    await expect(page.getByTestId("partner-holder-request-context").locator("time")).toHaveAttribute("datetime", context.datetime!)
    if (layout.locale === "en") {
      await page.getByRole("dialog").filter({ has: page.getByTestId("integration-demo") }).locator("[data-sheet-navigation='close']").click()
      await expect(page.getByTestId("integration-demo")).toHaveCount(0)
      await openTools(page)
      await expect(page.getByTestId("integration-holder-request").getByRole("heading")).toBeFocused()
      await expect(page.getByTestId("partner-holder-request-context").locator("time")).toHaveAttribute("datetime", context.datetime!)
    }
    await page.getByTestId("integration-holder-deny").click()
    const result = page.getByTestId("integration-verifier-result")
    await expect(result).toHaveAttribute("data-receipt-decision", "denied")
    await expect(result).toContainText(wording[layout.locale].denied)
    expect(await persistentBusinessState(page)).toEqual(before)
    await page.getByTestId("integration-tab-events").click()
    await expect(page.getByTestId("integration-event")).toHaveCount(0)
    await page.getByTestId("integration-tab-verify").click()
    await capture(page, info, "denied-no-holder-change")
    await page.reload({ waitUntil: "domcontentloaded" })
    await expect(page.getByTestId("ondo-b-root")).toHaveAttribute("data-hydrated", "true")
    await openTools(page)
    await expect(page.getByTestId("partner-sample-sign-in")).toBeVisible()
    await expect(page.getByTestId("integration-holder-request")).toHaveCount(0)
    await expect(page.getByTestId("integration-verifier-result")).toHaveCount(0)
  })
}

test("M11 holder expiry blocks approval using the actual two-minute deadline", async ({ page }, info) => {
  await page.clock.install()
  await enterCounter(page, layouts[1])
  const before = await persistentBusinessState(page)
  const issued = await createAndScan(page)
  const context = await requestContext(page, "en", "person", issued, info)
  const remaining = context.deadline - await page.evaluate(() => Date.now())
  expect(remaining).toBeGreaterThan(0)
  await page.clock.fastForward(remaining + 1)
  await expect(page.getByTestId("partner-holder-request-context").locator("time")).toHaveAttribute("datetime", context.datetime!)
  await page.getByTestId("integration-holder-approve").click()
  const result = page.getByTestId("integration-verifier-result")
  await expect(result).toHaveAttribute("data-receipt-decision", "expired")
  await expect(result).not.toHaveAttribute("data-status", "allowed")
  expect(await persistentBusinessState(page)).toEqual(before)
  await capture(page, info, "actual-request-expired")
  await page.getByTestId("integration-tab-events").click()
  await expect(page.getByTestId("integration-event")).toHaveCount(0)
})

test("M11 holder rejects replay and wrong partner through public sample cases without changing the holder", async ({ page }, info) => {
  await enterCounter(page, layouts[1])
  const before = await persistentBusinessState(page)
  // These are visible sample choices, not private engine access or injected
  // credentials. A guest must receive a binding rejection, not a proof result.
  for (const [sampleCase, note] of [
    ["replay", "Create a new request to continue."],
    ["wrong_audience", "This request cannot be used here."],
  ] as const) {
    await test.step(sampleCase, async () => {
      const selector = page.getByTestId("integration-verifier-case")
      const details = selector.locator("..")
      if (await details.getAttribute("open") === null) await details.locator("summary").click()
      await selector.selectOption(sampleCase)
      await expect(selector).toHaveValue(sampleCase)
      await createAndScan(page)
      await page.getByTestId("integration-holder-approve").click()
      const result = page.getByTestId("integration-verifier-result")
      await expect(result).toHaveAttribute("data-receipt-decision", "denied")
      await expect(result).toHaveAttribute("data-status", "denied")
      await expect(result.getByRole("heading")).toHaveText("Request not accepted")
      await expect(result).toContainText(note)
      await expect(page.getByTestId("integration-holder-approve")).toHaveCount(0)
      expect(await persistentBusinessState(page)).toEqual(before)
      await capture(page, info, `holder-${sampleCase}-rejected`)
      await page.getByTestId("integration-tab-events").click()
      await expect(page.getByTestId("integration-event")).toHaveCount(0)
      await expect(page.getByTestId("integration-voucher-issue")).toBeDisabled()
      await page.getByTestId("integration-tab-verify").click()
      await expect(result).toHaveAttribute("data-receipt-decision", "denied")
    })
  }
  // The rejection must not poison later requests or synthesize eligibility:
  // a fresh normal request still reaches the guest's genuine proof boundary.
  const selector = page.getByTestId("integration-verifier-case")
  const details = selector.locator("..")
  if (await details.getAttribute("open") === null) await details.locator("summary").click()
  await selector.selectOption("normal")
  await createAndScan(page)
  await page.getByTestId("integration-holder-approve").click()
  await expect(page.getByTestId("integration-verifier-result")).toHaveAttribute("data-receipt-decision", "needs_proof")
  expect(await persistentBusinessState(page)).toEqual(before)
  await page.getByTestId("integration-tab-events").click()
  await expect(page.getByTestId("integration-event")).toHaveCount(0)
})
