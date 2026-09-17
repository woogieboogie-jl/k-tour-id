import { expect, test, type Browser, type Locator, type Page, type TestInfo } from "@playwright/test"

// Run only while the coordinator has activated R7 or its regression check.
// Normal public entry, real local files, no seeded identity/proof/visit authority.
// R7-PHOTO-* are QA-independent acceptance cases. R7-AUTHORING-RETRY is a
// separate negative-only fixture regression, not a QA0 acceptance pass.
const PLACE = "mois-0021cd596bc5b2a922ad"
const PHOTO = "public/seoul-after-rain-hero.jpg"
const variants = [
  { locale: "ja", width: 320, height: 740, theme: "light" },
  { locale: "en", width: 390, height: 844, theme: "dark" },
  { locale: "ko", width: 430, height: 932, theme: "light" },
] as const
type Variant = (typeof variants)[number]

test.describe.configure({ timeout: 90_000 })
test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "mobile-chromium", "One mobile browser profile; variants are sequential")
})

async function publicSignal(browser: Browser, baseURL: string | undefined, variant: Variant, retryFixture: boolean, task: (page: Page, signal: Locator) => Promise<void>) {
  const origin = baseURL ?? "http://127.0.0.1:3114"
  expect(["localhost", "127.0.0.1", "[::1]"]).toContain(new URL(origin).hostname)
  const context = await browser.newContext({
    baseURL: origin, viewport: { width: variant.width, height: variant.height },
    isMobile: true, hasTouch: true, colorScheme: variant.theme,
    locale: variant.locale === "ja" ? "ja-JP" : variant.locale === "ko" ? "ko-KR" : "en-US",
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
  await context.addInitScript(({ locale, theme, retryFixture }) => {
    if (!["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)) return
    localStorage.setItem("ondo-b.device.v1", JSON.stringify({ locale, appearancePreference: theme, onboarding: "ONB-COMPLETE" }))
    sessionStorage.setItem("ondo.review.flow.v1", "0")
    // Deliberately deny one preparation. Never supplies positive authority.
    if (retryFixture) window.__ONDO_B_QA__ = { localSignalPhoto: "failure" }
  }, { ...variant, retryFixture })
  const page = await context.newPage()
  page.on("pageerror", error => failures.push(error.message))
  try {
    await page.goto(`/?review=0${retryFixture ? "&qa=1" : ""}&venueId=${PLACE}`, { waitUntil: "domcontentloaded" })
    await expect(page.getByTestId("ondo-b-root")).toHaveAttribute("data-hydrated", "true")
    await page.getByTestId("canonical-place-details").click()
    await page.getByTestId("canonical-local-signal-open").click()
    const signal = page.getByTestId("ondo-b-local-signal")
    await expect(signal).toHaveAttribute("data-venue-id", PLACE)
    await expect(signal).toHaveAttribute("data-photo-stage", "empty")
    await task(page, signal)
    await expect(page.getByTestId("ondo-b-action-gate")).toHaveCount(0)
    await expect(signal.getByTestId("local-signal-post")).toHaveCount(0)
  } finally {
    await context.close()
    expect(failures, "No runtime errors, provider requests or mutations").toEqual([])
  }
}

async function capture(page: Page, info: TestInfo, name: string, variant: Variant) {
  await page.screenshot({ path: info.outputPath(`${name}-${variant.locale}-${variant.width}-${variant.theme}.png`), scale: "css" })
  const metrics = await page.getByTestId("local-signal-photo-slot").evaluate(node => {
    const style = getComputedStyle(node), preview = node.querySelector<HTMLImageElement>("img")
    return { stage: node.getAttribute("data-photo-stage"), hasPreview: node.getAttribute("data-has-preview"),
      rect: node.getBoundingClientRect().toJSON(), aspectRatio: style.aspectRatio,
      scrollWidth: node.scrollWidth, clientWidth: node.clientWidth,
      preview: preview ? { rect: preview.getBoundingClientRect().toJSON(), decoded: preview.naturalWidth > 0 } : null,
      controls: [...node.querySelectorAll("button")].filter(button => getComputedStyle(button).display !== "none").map(button => ({
        text: button.textContent, rect: button.getBoundingClientRect().toJSON(), fontSize: getComputedStyle(button).fontSize,
      })),
    }
  })
  await info.attach(`${name}-${variant.locale}-${variant.width}-metrics`, { contentType: "application/json", body: JSON.stringify(metrics) })
}

async function compactSlot(slot: Locator) {
  await expect(slot).toHaveAttribute("data-photo-stage", "empty")
  await expect(slot).toHaveAttribute("data-has-preview", "false")
  const rect = await slot.boundingBox()
  expect(rect).not.toBeNull()
  expect(rect!.height).toBeGreaterThanOrEqual(64)
  expect(rect!.height).toBeLessThanOrEqual(80)
  expect(await slot.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
  const add = slot.locator(":scope > button")
  await expect(add).toHaveCount(1)
  expect((await add.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  expect(await add.evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(15)
  return rect!
}

test("R7-PHOTO-GEOMETRY empty and removed stay compact; a real preview expands without losing the draft", async ({ browser, baseURL }, info) => {
  for (const variant of variants) await publicSignal(browser, baseURL, variant, false, async (page, signal) => {
    const slot = signal.getByTestId("local-signal-photo-slot")
    const note = signal.getByTestId("local-signal-note")
    const tag = signal.getByTestId("local-signal-tag-calm_now")
    await tag.click()
    await note.fill("Keep this exact local photo draft.")
    await slot.scrollIntoViewIfNeeded()
    const empty = await compactSlot(slot)
    await capture(page, info, "R7-empty", variant)

    await signal.getByTestId("local-signal-photo-input").setInputFiles(PHOTO)
    await expect(signal).toHaveAttribute("data-photo-stage", "ready")
    await expect(slot).toHaveAttribute("data-has-preview", "true")
    await expect(slot.getByTestId("local-signal-photo-preview")).toBeVisible()
    const expanded = (await slot.boundingBox())!
    expect(expanded.height).toBeGreaterThan(empty.height * 2)
    expect(Math.abs(expanded.width / expanded.height - 4 / 3)).toBeLessThan(0.03)
    for (const id of ["local-signal-photo-replace", "local-signal-photo-remove"]) {
      expect((await slot.getByTestId(id).boundingBox())!.height).toBeGreaterThanOrEqual(44)
    }
    await capture(page, info, "R7-preview", variant)

    await slot.getByTestId("local-signal-photo-remove").click()
    await compactSlot(slot)
    await expect(slot.locator(":scope > button")).toBeFocused()
    await expect(note).toHaveValue("Keep this exact local photo draft.")
    await expect(tag).toHaveAttribute("aria-pressed", "true")
    await expect(signal.getByTestId("local-signal-anchor-photo")).toHaveCount(0)
    await capture(page, info, "R7-removed", variant)
    await signal.getByTestId("local-signal-close").click()
    await expect(signal.getByTestId("local-signal-discard")).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(note).toHaveValue("Keep this exact local photo draft.")
    await expect(tag).toHaveAttribute("aria-pressed", "true")
    await compactSlot(slot)
    expect(await signal.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
  })
})

test("R7-PHOTO-ERRORS real MIME size and decode errors preserve recovery and the last good draft", async ({ browser, baseURL }, info) => {
  const variant = variants[1]
  await publicSignal(browser, baseURL, variant, false, async (page, signal) => {
    const input = signal.getByTestId("local-signal-photo-input")
    const slot = signal.getByTestId("local-signal-photo-slot")
    const note = signal.getByTestId("local-signal-note")
    const tag = signal.getByTestId("local-signal-tag-calm_now")
    await tag.click()
    await note.fill("Keep this draft through media errors.")
    await input.setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not an image") })
    await expect(signal).toHaveAttribute("data-photo-stage", "photoTypeError")
    await expect(slot.getByTestId("local-signal-photo-choose-another")).toBeVisible()
    await input.setInputFiles({ name: "oversize.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(10 * 1024 * 1024 + 1) })
    await expect(signal).toHaveAttribute("data-photo-stage", "photoSizeError")
    await expect(slot.getByTestId("local-signal-photo-choose-another")).toBeVisible()
    await input.setInputFiles({ name: "corrupt.png", mimeType: "image/png", buffer: Buffer.from([137, 80, 78, 71]) })
    await expect(signal).toHaveAttribute("data-photo-stage", "photoPrepareError")
    await expect(slot).toHaveAttribute("data-has-preview", "false")
    const recovery = slot.getByTestId("local-signal-photo-choose-another")
    await expect(recovery).toBeVisible()
    await expect(slot.getByTestId("local-signal-photo-retry")).toHaveCount(0)
    expect((await slot.boundingBox())!.height).toBeGreaterThan(80)
    expect((await recovery.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await expect(note).toHaveValue("Keep this draft through media errors.")
    await expect(tag).toHaveAttribute("aria-pressed", "true")
    await capture(page, info, "R7-real-decode-recovery", variant)
    await input.setInputFiles(PHOTO)
    await expect(signal).toHaveAttribute("data-photo-stage", "ready")
    const preview = slot.getByTestId("local-signal-photo-preview")
    await expect(preview).toBeVisible()
    const original = await preview.getAttribute("src")

    await input.setInputFiles({ name: "replacement.txt", mimeType: "text/plain", buffer: Buffer.from("not an image") })
    await expect(signal).toHaveAttribute("data-photo-stage", "photoTypeError")
    await expect(preview).toHaveAttribute("src", original!)
    await expect(slot.getByTestId("local-signal-photo-choose-another")).toBeVisible()
    await input.setInputFiles({ name: "replacement-oversize.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(10 * 1024 * 1024 + 1) })
    await expect(signal).toHaveAttribute("data-photo-stage", "photoSizeError")
    await expect(preview).toHaveAttribute("src", original!)
    await expect(slot.getByTestId("local-signal-photo-choose-another")).toBeVisible()
    await input.setInputFiles({ name: "corrupt.png", mimeType: "image/png", buffer: Buffer.from([137, 80, 78, 71]) })
    await expect(signal).toHaveAttribute("data-photo-stage", "photoPrepareError")
    await expect(preview).toHaveAttribute("src", original!)
    await expect(slot).toHaveAttribute("data-has-preview", "true")
    await expect(slot.getByTestId("local-signal-photo-retry")).toHaveCount(0)
    await expect(slot.getByTestId("local-signal-photo-choose-another")).toBeVisible()
    await expect(note).toHaveValue("Keep this draft through media errors.")
    await capture(page, info, "R7-corrupt-replacement-preserved", variant)
    await input.setInputFiles(PHOTO)
    await expect(signal).toHaveAttribute("data-photo-stage", "ready")
    await expect(preview).not.toHaveAttribute("src", original!)
    await slot.getByTestId("local-signal-photo-remove").click()
    await compactSlot(slot)
    await expect(note).toHaveValue("Keep this draft through media errors.")
    await expect(tag).toHaveAttribute("aria-pressed", "true")
  })
})

test("R7-AUTHORING-RETRY QA-only negative preparation fixture retains the existing retry control", async ({ browser, baseURL }, info) => {
  test.skip(process.env.KTOUR_R7_AUTHORING_RETRY !== "1", "Authoring-only coverage: requires explicit KTOUR_R7_AUTHORING_RETRY=1 and a QA-enabled local build; never a QA0 acceptance pass")
  const variant = variants[1]
  await publicSignal(browser, baseURL, variant, true, async (page, signal) => {
    const slot = signal.getByTestId("local-signal-photo-slot")
    const note = signal.getByTestId("local-signal-note")
    const tag = signal.getByTestId("local-signal-tag-calm_now")
    await tag.click()
    await note.fill("Keep this draft through authoring-only retry.")
    await signal.getByTestId("local-signal-photo-input").setInputFiles(PHOTO)
    await expect(signal).toHaveAttribute("data-photo-stage", "photoPrepareError")
    const retry = slot.getByTestId("local-signal-photo-retry")
    await expect(retry).toBeVisible()
    expect((await slot.boundingBox())!.height).toBeGreaterThan(80)
    expect((await retry.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await capture(page, info, "R7-authoring-only-negative-retry", variant)
    await retry.click()
    await expect(signal).toHaveAttribute("data-photo-stage", "ready")
    await expect(slot.getByTestId("local-signal-photo-preview")).toBeVisible()
    await expect(note).toHaveValue("Keep this draft through authoring-only retry.")
    await expect(tag).toHaveAttribute("aria-pressed", "true")
    await slot.getByTestId("local-signal-photo-remove").click()
    await compactSlot(slot)
  })
})
