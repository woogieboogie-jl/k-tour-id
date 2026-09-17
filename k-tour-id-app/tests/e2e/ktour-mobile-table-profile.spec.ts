import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test"

// Run only the active item: --grep "R5 Table" or --grep "R6 profile".
// Local preferences are the only seed. Account and membership come from UI.
const TABLE = "table-busan-gijang-dinner"
const VENUE = "mois-03041681b54ea5399763"
const ROBA = "mois-0021cd596bc5b2a922ad"
const layouts = [
  { locale: "ja", appearance: "light", width: 320, height: 568 },
  { locale: "en", appearance: "light", width: 390, height: 844 },
  { locale: "ko", appearance: "dark", width: 430, height: 932 },
] as const
type Layout = { locale: "ja" | "en" | "ko"; appearance: "light" | "dark"; width: number; height: number }
const copy = {
  en: { from: "From", lives: "Lives in", languages: "Languages", save: "Save changes", done: "Done", cancel: "Cancel", close: "Close profile", booking: "Local meal plan only · no seat or venue booking is sent." },
  ko: { from: "출신 지역", lives: "현재 생활권", languages: "사용 언어", save: "변경사항 저장", done: "완료", cancel: "취소", close: "프로필 닫기", booking: "로컬 식사 계획 · 좌석이나 장소 예약은 전송되지 않아요." },
  ja: { from: "出身", lives: "居住地", languages: "使用言語", save: "変更を保存", done: "完了", cancel: "キャンセル", close: "プロフィールを閉じる", booking: "端末内の食事プランです。席や店舗の予約は送信されません。" },
} as const
const faults = new WeakMap<Page, string[]>()

test.describe.configure({ timeout: 90_000 })
test.beforeEach(async ({ page, context }, info) => {
  test.skip(info.project.name !== "mobile-chromium", "Mobile-owned task hierarchy and profile consent checks")
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

async function start(page: Page, layout: Layout, url = "/?review=1") {
  await page.setViewportSize(layout)
  await page.addInitScript(({ locale, appearance }) => {
    if (!/^https?:$/.test(location.protocol) || !["127.0.0.1", "localhost"].includes(location.hostname)) return
    if (!localStorage.getItem("ondo-b.device.v1")) localStorage.setItem("ondo-b.device.v1", JSON.stringify({ locale, appearancePreference: appearance }))
  }, layout)
  await page.goto(url, { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("ondo-b-root")).toHaveAttribute("data-hydrated", "true")
  await page.evaluate(() => document.fonts.ready)
}

async function capture(page: Page, info: TestInfo, label: string, metrics?: unknown) {
  await page.screenshot({ path: info.outputPath(`${label}.png`), scale: "css" })
  await info.attach(`${label}-metrics`, { contentType: "application/json", body: JSON.stringify({ metrics,
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
  expect(await control.evaluate(node => { const b = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)) })).toBe(true)
}

async function before(first: Locator, second: Locator) {
  const other = await second.elementHandle()
  expect(other).not.toBeNull()
  expect(await first.evaluate((node, other) => Boolean(node.compareDocumentPosition(other!) & Node.DOCUMENT_POSITION_FOLLOWING), other)).toBe(true)
  const a = await first.boundingBox(), b = await second.boundingBox()
  expect(a).not.toBeNull(); expect(b).not.toBeNull()
  // Common scroll-space geometry also catches CSS order overriding DOM order.
  expect(a!.y + a!.height).toBeLessThanOrEqual(b!.y + 1)
}

async function readable(node: Locator, minSize: number) {
  const metrics = await node.evaluate(element => {
    const bounds = element.getBoundingClientRect(), style = getComputedStyle(element)
    const range = document.createRange(); range.selectNodeContents(element)
    const lines = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0).map(r => r.toJSON())
    return { text: element.textContent, fontSize: parseFloat(style.fontSize), bounds: bounds.toJSON(), lines,
      scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, overflowY: style.overflowY }
  })
  expect(metrics.fontSize).toBeGreaterThanOrEqual(minSize)
  expect(metrics.lines.length).toBeGreaterThan(0)
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1)
  for (const line of metrics.lines) {
    expect(line.left).toBeGreaterThanOrEqual(metrics.bounds.left - 1)
    expect(line.right).toBeLessThanOrEqual(metrics.bounds.right + 1)
    expect(line.top).toBeGreaterThanOrEqual(metrics.bounds.top - 1)
    expect(line.bottom).toBeLessThanOrEqual(metrics.bounds.bottom + 1)
  }
  return metrics
}

async function openBusan(page: Page) {
  await page.getByTestId("nav-tables").click()
  await page.getByTestId(`table-open-${TABLE}`).click()
  const detail = page.getByTestId("table-detail")
  await expect(detail).toHaveAttribute("data-table-id", TABLE)
  await expect(detail).toHaveAttribute("data-venue-id", VENUE)
  return detail
}

async function publicJoin(page: Page, detail: Locator) {
  await detail.getByTestId("table-join").click()
  const gate = page.getByTestId("ondo-b-action-gate")
  await expect(gate).toHaveAttribute("data-active-gate", "account")
  await gate.getByTestId("action-gate-confirm").click()
  await expect(gate).toHaveCount(0)
  const confirmation = detail.getByTestId("table-join-confirmation")
  await expect(confirmation).toHaveAttribute("data-return-table", TABLE)
  await expect(confirmation).toHaveAttribute("data-return-venue", VENUE)
  return confirmation
}

for (const layout of layouts) {
  test(`R5 Table facts lead the task without losing drafts ${layout.locale} ${layout.width}`, async ({ page }, info) => {
    await start(page, layout)
    const detail = await openBusan(page)
    const facts = detail.locator("[data-plan-context='detail'] [data-fact-kind]")
    await expect(facts).toHaveCount(6)
    expect(await facts.evaluateAll(nodes => nodes.map(node => node.getAttribute("data-fact-kind")))).toEqual(["time", "seats", "format", "menu", "language", "cost"])
    const join = detail.getByTestId("table-join"), profile = detail.getByTestId("table-host-profile-open")
    const measured = []
    for (const fact of await facts.all()) {
      await before(fact, join)
      const value = fact.locator("dd")
      await value.scrollIntoViewIfNeeded()
      measured.push(await readable(value, 14))
      const box = await value.boundingBox()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(layout.width + 1)
    }
    await before(join, profile)
    const truth = detail.getByText(copy[layout.locale].booking, { exact: true })
    await truth.scrollIntoViewIfNeeded()
    const truthMetrics = await readable(truth, 15)
    await before(truth, join)
    await capture(page, info, "facts-and-join", { facts: measured, truth: truthMetrics })
    await expect(detail.getByTestId("table-return-place")).toBeAttached()
    await expect(detail.getByTestId("table-reservation-open")).toBeAttached()
    const note = `Dietary note retained: ${layout.locale}`
    await detail.getByTestId("table-join-draft").fill(note)
    await profile.click()
    await detail.getByTestId("ondo-profile-panel").getByRole("button", { name: copy[layout.locale].close, exact: true }).click()
    await expect(profile).toBeFocused()
    await expect(detail.getByTestId("table-join-draft")).toHaveValue(note)
    await expect(detail).toHaveAttribute("data-table-membership", "TMB-NONE")
    await join.click()
    const cancelGate = page.getByTestId("ondo-b-action-gate")
    await expect(cancelGate).toHaveAttribute("data-active-gate", "account")
    await cancelGate.getByTestId("action-gate-cancel").click()
    await expect(cancelGate).toHaveCount(0)
    await expect(detail.getByTestId("table-join-draft")).toHaveValue(note)
    const confirmation = await publicJoin(page, detail)
    await expect(confirmation.getByTestId("after19-return")).toHaveText(note)
    const confirm = detail.getByTestId("table-join-confirm")
    for (const fact of await facts.all()) await before(fact, confirm)
    await before(confirm, profile)
    await confirm.scrollIntoViewIfNeeded(); await target(confirm, page)
    await capture(page, info, "confirm-same-table")
    await confirm.click()
    await expect(detail).toHaveAttribute("data-table-membership", "TMB-CONFIRMED")
    await before(detail.getByTestId("table-open-chat"), profile)
    await detail.getByTestId("table-open-chat").click()
    const compose = detail.getByTestId("table-chat-compose")
    await compose.fill(`Unsent note ${layout.locale}`)
    await profile.click()
    await detail.getByTestId("ondo-profile-panel").getByRole("button", { name: copy[layout.locale].close, exact: true }).click()
    await expect(profile).toBeFocused()
    await expect(compose).toHaveValue(`Unsent note ${layout.locale}`)
    await expect(detail.getByTestId("table-message")).toHaveCount(0)
    await detail.locator("header").first().getByRole("button").click()
    await expect(detail).toHaveCount(0)
    await expect(page.getByTestId(`table-open-${TABLE}`)).toBeFocused()
    await page.getByTestId(`table-open-${TABLE}`).click()
    await expect(detail).toHaveAttribute("data-table-id", TABLE)
    await expect(detail).toHaveAttribute("data-venue-id", VENUE)
    await expect(detail).toHaveAttribute("data-table-membership", "TMB-CONFIRMED")
    await expect(detail.getByTestId("table-open-chat")).toBeVisible()
    // Existing Table close intentionally resets unsent local messages. Draft
    // preservation above applies to optional profile/gate returns, not a new
    // persistence promise after leaving and reopening the Table.
  })
}

async function accountThroughBookmark(page: Page, layout: Layout) {
  await start(page, layout, `/?review=1&city=seoul&view=list&venueId=${ROBA}&detail=1`)
  const place = page.getByTestId("canonical-place-overlay")
  await place.getByTestId("canonical-venue-save").click()
  const gate = page.getByTestId("account-save-gate")
  await expect(gate).toBeVisible()
  await gate.getByTestId("account-start").click()
  await expect(gate).toHaveCount(0)
  await expect(place.getByTestId("canonical-venue-save")).toHaveAttribute("aria-pressed", "true")
  await place.locator("[data-place-return-focus='detail_close']").click()
  await expect(place).toHaveCount(0)
  await page.getByTestId("nav-my").click()
  await page.getByTestId("my-korea-profile-open").click()
  const profile = page.getByTestId("ondo-profile-panel")
  await expect(profile).toHaveAttribute("data-editor-state", "editing")
  await expect(page.getByTestId("k-tour-id-setup")).toHaveCount(0)
  return profile
}

async function fieldSemantics(profile: Locator, page: Page, id: string, label: string, value: string) {
  const input = profile.locator(`#${id}`)
  await expect(input).toHaveAccessibleName(label)
  const descriptions = await input.evaluate(node => (node.getAttribute("aria-describedby") ?? "").trim().split(/\s+/).filter(Boolean).map(id => ({ id, text: document.getElementById(id)?.textContent?.trim() ?? "" })))
  expect(descriptions.length).toBeGreaterThan(0)
  for (const description of descriptions) expect(description.text).not.toBe("")
  await input.fill(value)
  const toggle = profile.getByRole("button", { name: new RegExp(`^${label}:`) })
  await expect(toggle).toHaveCount(1)
  await expect(toggle).toHaveAttribute("aria-pressed", "false")
  await toggle.scrollIntoViewIfNeeded(); await target(toggle, page)
  // Inputs may be raised. The containing field row must not become another
  // elevated card; inspect the semantic input parent, not a CSS class.
  const row = await input.evaluate(node => {
    type Color = [number, number, number, number]
    const parse = (value: string): Color => { const n = value.match(/[\d.]+/g)!.map(Number); return value.startsWith("color(srgb") ? [n[0], n[1], n[2], n[3] ?? 1] : [n[0] / 255, n[1] / 255, n[2] / 255, n[3] ?? 1] }
    const over = (a: Color, b: Color): Color => { const alpha = a[3] + b[3] * (1 - a[3]); return alpha ? [0, 1, 2].map(i => (a[i] * a[3] + b[i] * b[3] * (1 - a[3])) / alpha).concat(alpha) as Color : [0, 0, 0, 0] }
    const background = (start: Element) => {
      let result: Color = [0, 0, 0, 0]
      for (let element: Element | null = start; element && result[3] < .999; element = element.parentElement) result = over(result, parse(getComputedStyle(element).backgroundColor))
      if (result[3] < .999) throw new Error("No opaque profile surface")
      return result
    }
    return { shadow: getComputedStyle(node.parentElement!).boxShadow,
      background: background(node.parentElement!), parentBackground: background(node.parentElement!.parentElement!) }
  })
  expect(row.shadow).toBe("none")
  for (let channel = 0; channel < 3; channel++) expect(Math.abs(row.background[channel] - row.parentBackground[channel])).toBeLessThanOrEqual(1 / 255)
  return { input, toggle, descriptions, row }
}

async function onePaintedSelfDisclosure(profile: Locator) {
  const disclosures = await profile.evaluate(node => {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT), matches: string[] = []
    while (walker.nextNode()) {
      const text = walker.currentNode.textContent?.trim() ?? "", parent = walker.currentNode.parentElement
      if (!parent || !/you (?:add|added|enter)|self.entered|직접 입력|내가 입력|自分で入力|直接入力/i.test(text)) continue
      const style = getComputedStyle(parent), box = parent.getBoundingClientRect()
      if (box.width <= 2 || box.height <= 2 || style.visibility !== "visible" || style.display === "none" || style.clipPath === "inset(50%)") continue
      if (parent.closest("[hidden],[aria-hidden='true']")) continue
      const details = parent.closest("details")
      if (details && !details.open && !parent.closest("summary")) continue
      matches.push(text)
    }
    return matches
  })
  expect(disclosures, "One visible self-entered explanation; per-field describedby help may remain visually hidden").toHaveLength(1)
  return disclosures
}

async function profileTextContrast(node: Locator) {
  const result = await node.evaluate(element => {
    type Color = [number, number, number, number]
    const parse = (value: string): Color => { const n = value.match(/[\d.]+/g)!.map(Number); return value.startsWith("color(srgb") ? [n[0], n[1], n[2], n[3] ?? 1] : [n[0] / 255, n[1] / 255, n[2] / 255, n[3] ?? 1] }
    const over = (a: Color, b: Color): Color => { const alpha = a[3] + b[3] * (1 - a[3]); return alpha ? [0, 1, 2].map(i => (a[i] * a[3] + b[i] * b[3] * (1 - a[3])) / alpha).concat(alpha) as Color : [0, 0, 0, 0] }
    let background: Color = [0, 0, 0, 0]
    for (let parent: Element | null = element; parent && background[3] < .999; parent = parent.parentElement) background = over(background, parse(getComputedStyle(parent).backgroundColor))
    if (background[3] < .999) throw new Error("No opaque profile contrast surface")
    const foreground = over(parse(getComputedStyle(element).color), background)
    const luminance = (color: Color) => color.slice(0, 3).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0)
    const a = luminance(foreground), b = luminance(background)
    return { text: element.textContent, foreground, background, contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) }
  })
  expect(result.contrast, `Profile text contrast: ${result.text}`).toBeGreaterThanOrEqual(4.5)
  return result
}

for (const layout of layouts) {
  test(`R6 profile is quiet but keeps separate field consent ${layout.locale} ${layout.width}`, async ({ page }, info) => {
    const profile = await accountThroughBookmark(page, layout), t = copy[layout.locale]
    const name = profile.locator("#profile-display-name")
    await name.fill("Mina")
    const from = await fieldSemantics(profile, page, "profile-from-b", t.from, "Canada")
    const lives = await fieldSemantics(profile, page, "profile-lives-in-b", t.lives, "Seoul")
    const languages = await fieldSemantics(profile, page, "profile-languages-b", t.languages, "English, 日本語")
    const describedIds = [from, lives, languages].flatMap(field => field.descriptions.map(description => description.id))
    expect(new Set(describedIds).size).toBe(describedIds.length)
    const disclosure = await onePaintedSelfDisclosure(profile)
    const intro = profile.locator("p").filter({ hasText: /You add these|직접 입력|自分で入力/ })
    const introMetrics = await readable(intro, 15)
    expect(await intro.evaluate(node => parseFloat(getComputedStyle(node).lineHeight) / parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(1.5)
    const contrast = await Promise.all([
      intro,
      profile.locator('label[for="profile-display-name"] > span'),
      ...["profile-from-b", "profile-lives-in-b", "profile-languages-b"].map(id => profile.locator(`label[for="${id}"]`)),
    ].map(profileTextContrast))
    await from.toggle.click(); await languages.toggle.click()
    await expect(from.toggle).toHaveAttribute("aria-pressed", "true")
    await expect(languages.toggle).toHaveAttribute("aria-pressed", "true")
    await expect(lives.toggle).toHaveAttribute("aria-pressed", "false")
    const publicView = profile.getByTestId("public-profile-view")
    await expect(publicView.locator("[data-public-field='from']")).toContainText("Canada")
    await expect(publicView.locator("[data-public-field='languages']")).toContainText("English")
    await expect(publicView.locator("[data-public-field='lives-in']")).toHaveCount(0)
    await name.scrollIntoViewIfNeeded()
    await capture(page, info, "profile-editor", { disclosure, introMetrics, contrast, rows: [from.row, lives.row, languages.row], descriptions: describedIds })
    await profile.getByRole("button", { name: t.cancel, exact: true }).click()
    const prompt = profile.getByTestId("profile-discard-prompt")
    await expect(prompt).toHaveAttribute("role", "alertdialog")
    await expect(prompt.getByTestId("profile-discard-keep")).toBeFocused()
    await prompt.getByTestId("profile-discard-keep").click()
    await expect(name).toHaveValue("Mina")
    await expect(from.input).toHaveValue("Canada")
    await profile.getByRole("button", { name: t.save, exact: true }).click()
    await expect(profile).toHaveAttribute("data-editor-state", "saved")
    await expect(profile.getByTestId("profile-save-result")).toBeVisible()
    await profile.getByRole("button", { name: t.done, exact: true }).click()
    await expect(page.getByTestId("profile-entry-panel-my_korea")).toHaveCount(0)
    const opener = page.getByTestId("my-korea-profile-open")
    await expect(opener).toBeFocused()
    await opener.click()
    await expect(from.input).toHaveValue("Canada")
    await expect(from.toggle).toHaveAttribute("aria-pressed", "true")
    await expect(lives.toggle).toHaveAttribute("aria-pressed", "false")
    await from.input.fill("Discard this draft")
    await profile.getByRole("button", { name: t.close, exact: true }).click()
    await expect(prompt).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(prompt).toHaveCount(0)
    await expect(from.input).toHaveValue("Discard this draft")
    await profile.getByRole("button", { name: t.cancel, exact: true }).click()
    await prompt.getByTestId("profile-discard-confirm").click()
    await expect(page.getByTestId("profile-entry-panel-my_korea")).toHaveCount(0)
    await expect(opener).toBeFocused()
    await opener.click()
    await expect(from.input).toHaveValue("Canada")
    await expect(name).toHaveValue("Mina")
    await profile.getByRole("button", { name: t.cancel, exact: true }).click()
    await expect(profile).toHaveAttribute("data-editor-state", "published")
    await expect(prompt).toHaveCount(0)
    await profile.getByRole("button", { name: t.close, exact: true }).click()
    await expect(opener).toBeFocused()
  })
}

for (const layout of [layouts[0], layouts[1], { ...layouts[1], width: 820, height: 390 }]) {
test(`R6 profile dirty Table-host exit still guards the exact Table ${layout.width}`, async ({ page }, info) => {
  await start(page, layout)
  const detail = await openBusan(page)
  await publicJoin(page, detail)
  await detail.getByTestId("table-join-confirm").click()
  await expect(detail).toHaveAttribute("data-table-membership", "TMB-CONFIRMED")
  await detail.getByTestId("table-host-profile-open").click()
  const profile = detail.getByTestId("ondo-profile-panel")
  const name = profile.locator("#profile-display-name")
  await name.fill("Unsaved hosted draft")
  await detail.locator("header").first().getByRole("button").click()
  const prompt = profile.getByTestId("profile-discard-prompt")
  await expect(prompt).toBeVisible()
  await expect(detail).toHaveAttribute("data-table-presence", "open")
  await expect(detail).toHaveAttribute("data-table-id", TABLE)
  await expect(prompt.getByTestId("profile-discard-keep")).toBeInViewport({ ratio: 1 })
  await expect(prompt.getByTestId("profile-discard-confirm")).toBeInViewport({ ratio: 1 })
  await target(prompt.getByTestId("profile-discard-keep"), page)
  await target(prompt.getByTestId("profile-discard-confirm"), page)
  await capture(page, info, "dirty-table-host-exit")
  await prompt.getByTestId("profile-discard-keep").click()
  await expect(name).toHaveValue("Unsaved hosted draft")
  await expect(name).toBeFocused()
  await expect(name).toBeInViewport({ ratio: 1 })
  await target(name, page)
  await detail.locator("header").first().getByRole("button").click()
  await prompt.getByTestId("profile-discard-confirm").click()
  await expect(detail).toHaveCount(0)
  await expect(page.getByTestId(`table-open-${TABLE}`)).toBeFocused()
  await page.getByTestId(`table-open-${TABLE}`).click()
  await expect(detail).toHaveAttribute("data-table-membership", "TMB-CONFIRMED")
  await detail.getByTestId("table-host-profile-open").click()
  await expect(name).not.toHaveValue("Unsaved hosted draft")
})
}
