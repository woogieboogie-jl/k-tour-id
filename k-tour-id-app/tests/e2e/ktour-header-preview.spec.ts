import { expect, test, type Locator, type Page } from "@playwright/test"

test.describe.configure({ timeout: 60_000 })
test.use({ serviceWorkers: "block" })

const variants = ["a", "b", "c"] as const
const passiveAssetHosts = new Set(["fonts.googleapis.com", "fonts.gstatic.com"])

test.beforeEach(async ({ page, baseURL }) => {
  expect(baseURL).toBeTruthy()
  const origin = new URL(baseURL!).origin
  expect(new URL(origin).hostname).toMatch(/^(127\.0\.0\.1|localhost|\[::1\])$/)
  const unexpected: string[] = []
  await page.route("**/*", async route => {
    const request = route.request()
    const url = new URL(request.url())
    const passiveAsset = passiveAssetHosts.has(url.hostname) && request.method() === "GET" && !request.isNavigationRequest()
    if ((url.origin !== origin && !passiveAsset) || url.pathname.startsWith("/api/")) {
      unexpected.push(`${request.method()} ${url.origin}${url.pathname}`)
      await route.abort("blockedbyclient")
      return
    }
    await route.continue()
  })
  ;(page as Page & { __headerUnexpected?: string[] }).__headerUnexpected = unexpected
})

test.afterEach(async ({ page }) => {
  const unexpected = (page as Page & { __headerUnexpected?: string[] }).__headerUnexpected ?? []
  expect(unexpected, "Header preview must stay local and read-only").toEqual([])
  expect(await page.evaluate(() => (window as typeof window & { __headerStorageWrites?: string[] }).__headerStorageWrites ?? []), "Header preview must not write browser storage").toEqual([])
  expect((page as Page & { __headerPageErrors?: string[] }).__headerPageErrors ?? [], "Header preview must not throw browser errors").toEqual([])
})

async function openLab(page: Page) {
  const errors: string[] = []
  await page.addInitScript(() => {
    const writes: string[] = []
    const storage = Storage.prototype
    const originalSetItem = storage.setItem
    const originalRemoveItem = storage.removeItem
    const originalClear = storage.clear
    Object.defineProperty(storage, "setItem", { value: function (this: Storage, key: string, value: string) {
      writes.push(`setItem:${key}`)
      return originalSetItem.call(this, key, value)
    } satisfies Storage["setItem"] })
    Object.defineProperty(storage, "removeItem", { value: function (this: Storage, key: string) {
      writes.push(`removeItem:${key}`)
      return originalRemoveItem.call(this, key)
    } satisfies Storage["removeItem"] })
    Object.defineProperty(storage, "clear", { value: function (this: Storage) {
      writes.push("clear:")
      return originalClear.call(this)
    } satisfies Storage["clear"] })
    ;(window as typeof window & { __headerStorageWrites?: string[] }).__headerStorageWrites = writes
  })
  page.on("pageerror", error => errors.push(error.message))
  await page.goto("/labs/header-preview", { waitUntil: "domcontentloaded" })
  await expect(page.getByRole("heading", { name: /지도는 넓게/ })).toBeVisible()
  ;(page as Page & { __headerPageErrors?: string[] }).__headerPageErrors = errors
}

function frame(page: Page, variant: typeof variants[number]) {
  return page.getByTestId(`header-design-${variant}`)
}

function design(page: Page, variant: typeof variants[number]) {
  return frame(page, variant).locator("xpath=..")
}

async function selectAHot(page: Page, root: ReturnType<typeof frame>) {
  const spectrum = root.getByTestId("header-spectrum")
  const hot = root.getByTestId("header-spectrum-hot")
  await expect(hot).toHaveAttribute("aria-checked", "false")
  await hot.click()
  await expect(spectrum).toHaveAttribute("data-selected", "hot")
  await expect(hot).toHaveAttribute("aria-checked", "true")
  await expect(root.getByTestId("header-spectrum-selected-marker")).toHaveAttribute("data-band", "hot")
}

async function expectNoOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => innerWidth) + 1)
}

test("desktop presents all three header directions without horizontal overflow", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await openLab(page)
  for (const variant of variants) await expect(frame(page, variant)).toBeVisible()
  await expectNoOverflow(page)
  await page.screenshot({ path: info.outputPath("header-preview-desktop-full.png"), fullPage: true, scale: "css" })
  await page.setViewportSize({ width: 1024, height: 900 })
  await expectNoOverflow(page)
})

test("tablet presents one readable frame with A/B/C tabs instead of tiny columns", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 })
  await openLab(page)
  const tabs = page.locator("[aria-label='디자인 선택'] > button")
  await expect(tabs).toHaveCount(3)
  await expect(tabs.first()).toBeVisible()
  const active = page.locator("[data-active='true']")
  await expect(active).toBeVisible()
  const width = await active.getByTestId(/header-design-/).evaluate(node => node.getBoundingClientRect().width)
  expect(width).toBeGreaterThanOrEqual(350)
  await expectNoOverflow(page)
})

test("mobile tabs swap the active A/B/C frame and preserve a bounded layout", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openLab(page)
  const tabs = page.locator("[aria-label='디자인 선택'] > button")
  for (const variant of variants) {
    await page.getByRole("button", { name: new RegExp(`^${variant.toUpperCase()} `) }).click()
    await expect(design(page, variant)).toHaveAttribute("data-active", "true")
    await expect(frame(page, variant)).toBeVisible()
    await expectNoOverflow(page)
    await page.screenshot({ path: info.outputPath(`header-preview-mobile-${variant}.png`), fullPage: true, scale: "css" })
  }
  await expect(tabs).toHaveCount(3)
})

test("each mobile direction supports city, search, mood and 19+ filtering locally", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 })
  await openLab(page)
  for (const variant of variants) {
    const root = frame(page, variant)
    await page.getByRole("button", { name: new RegExp(`^${variant.toUpperCase()} `) }).click()
    const city = root.getByRole("button", { name: /도시 변경/ })
    await city.click()
    await expect(page.getByRole("dialog", { name: "어느 도시로 갈까요?" })).toBeVisible()
    await page.getByRole("dialog").getByRole("button", { name: /^제주/ }).click()
    await expect(city).toContainText("제주")
    const search = root.getByRole("textbox", { name: "장소 또는 동네 검색" })
    if (variant === "a") {
      await root.getByRole("button", { name: "장소 검색 열기" }).click()
    }
    await search.fill("시장")
    await search.press("Enter")
    await expect(root.getByRole("status")).toContainText("시장")
    if (variant === "a") {
      await selectAHot(page, root)
      await root.getByRole("button", { name: "지도 옵션" }).click()
      await page.getByRole("dialog", { name: "지도 옵션" }).getByRole("button", { name: "19+ 설정" }).click()
    } else {
      const hot = root.getByRole("button", { name: "Hot", exact: true })
      await hot.click()
      await expect(hot).toHaveAttribute("aria-pressed", "true")
      await root.getByRole("button", { name: "분위기 및 19+ 필터" }).first().click()
    }
    const filters = page.getByRole("dialog", { name: variant === "a" ? "19+ 장소" : "분위기로 찾아보기" })
    await expect(filters).toBeVisible()
    const checkbox = filters.getByRole("checkbox")
    await checkbox.check()
    await filters.getByRole("button", { name: variant === "a" ? "지도 보기" : /곳 보기/ }).click()
    await expect(root.getByText("19+ 포함")).toBeVisible()
    await expectNoOverflow(page)
  }
})

test("refined A search opens, preserves query and mood, and Escape closes it", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openLab(page)
  const root = frame(page, "a")
  await selectAHot(page, root)
  await root.getByRole("button", { name: "장소 검색 열기" }).click()
  const search = root.getByRole("textbox", { name: "장소 또는 동네 검색" })
  await expect(search).toBeVisible()
  await search.fill("시장")
  await root.getByRole("button", { name: "검색 닫기" }).click()
  await expect(search).not.toBeVisible()
  await expect(root.getByTestId("header-spectrum")).toHaveAttribute("data-selected", "hot")
  await root.getByRole("button", { name: "장소 검색 열기" }).click()
  await expect(search).toHaveValue("시장")
  await root.getByTestId("header-spectrum-warm").click()
  await expect(search).not.toBeVisible()
  await root.getByRole("button", { name: "장소 검색 열기" }).click()
  await expect(search).toHaveValue("시장")
  await expect(root.getByTestId("header-spectrum")).toHaveAttribute("data-selected", "warm")
  await search.press("Escape")
  await expect(search).not.toBeVisible()
  await expect(root.getByRole("button", { name: "장소 검색 열기" })).toBeFocused()
})

test("refined A spectrum commits a pointer choice and cancels an abandoned draft", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openLab(page)
  const root = frame(page, "a")
  await root.evaluate(node => node.scrollIntoView({ block: "start", inline: "nearest" }))
  const bands = root.getByTestId("header-spectrum-bands")
  const bandsBox = await bands.boundingBox()
  expect(bandsBox).toBeTruthy()
  const warm = root.getByTestId("header-spectrum-warm")
  const cool = root.getByTestId("header-spectrum-cool")
  const hot = root.getByTestId("header-spectrum-hot")
  await expect(bands.locator("[data-band]").first()).toHaveAttribute("data-band", "cool")
  await expect(bands.locator("[data-band]").nth(1)).toHaveAttribute("data-band", "warm")
  await expect(bands.locator("[data-band]").nth(2)).toHaveAttribute("data-band", "hot")
  for (const label of ["Hot", "Warm", "Cool"]) await expect(bands.getByText(label, { exact: true }).first()).not.toBeVisible()
  for (const radio of [cool, warm, hot]) expect((await radio.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  const coolBox = await cool.boundingBox()
  const warmBox = await warm.boundingBox()
  const hotBox = await hot.boundingBox()
  expect(coolBox && warmBox && hotBox).toBeTruthy()
  const map = root.getByTestId("header-a-map")
  const cameraBeforeDraft = await map.getAttribute("data-camera")
  const resultCountBeforeDraft = await root.getByTestId("header-a-recommendations").getAttribute("data-count")
  expect(cameraBeforeDraft).toBeTruthy()
  expect(resultCountBeforeDraft).toBeTruthy()
  await page.mouse.move(coolBox!.x + coolBox!.width / 2, coolBox!.y + coolBox!.height / 2)
  await page.mouse.down()
  await page.mouse.move(hotBox!.x + hotBox!.width / 2, hotBox!.y + hotBox!.height / 2)
  await expect(bands).toHaveAttribute("data-draft", "hot")
  await expect(map).toHaveAttribute("data-camera", cameraBeforeDraft as string)
  await expect(root.getByTestId("header-a-recommendations")).toHaveAttribute("data-count", resultCountBeforeDraft as string)
  await page.mouse.up()
  await expect(root.getByTestId("header-spectrum")).toHaveAttribute("data-selected", "hot")
  await expect(root.getByTestId("header-a-recommendations")).toHaveAttribute("data-count", "3")
  await expect(map).not.toHaveAttribute("data-camera", cameraBeforeDraft!)
  await page.mouse.move(warmBox!.x + warmBox!.width / 2, warmBox!.y + warmBox!.height / 2)
  await page.mouse.down()
  await page.mouse.move(coolBox!.x + coolBox!.width / 2, coolBox!.y + coolBox!.height / 2)
  await expect(bands).toHaveAttribute("data-draft", "cool")
  await page.mouse.move(2, 2)
  await page.mouse.up()
  await expect(root.getByTestId("header-spectrum")).toHaveAttribute("data-selected", "hot")
})

test("inline A spectrum supports keyboard movement, reset, and query preservation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openLab(page)
  const root = frame(page, "a")
  const spectrum = root.getByTestId("header-spectrum")
  const cool = root.getByTestId("header-spectrum-cool")
  await cool.focus()
  await page.keyboard.press("ArrowRight")
  await expect(spectrum).toHaveAttribute("data-selected", "warm")
  await page.keyboard.press("ArrowRight")
  await expect(spectrum).toHaveAttribute("data-selected", "hot")
  await root.getByTestId("header-spectrum-reset").click()
  await expect(spectrum).toHaveAttribute("data-selected", "all")
  await expect(root.getByTestId("header-spectrum-reset")).toHaveAttribute("aria-pressed", "true")
  await root.getByRole("button", { name: "장소 검색 열기" }).click()
  const search = root.getByRole("textbox", { name: "장소 또는 동네 검색" })
  await search.fill("시장")
  await root.getByTestId("header-spectrum-reset").click()
  await expect(search).not.toBeVisible()
  await root.getByRole("button", { name: "장소 검색 열기" }).click()
  await expect(search).toHaveValue("시장")
  await root.getByRole("button", { name: "검색 닫기" }).click()
})

test("A shared header keeps rows and touch targets stable across viewport sizes", async ({ page }) => {
  for (const viewport of [{ width: 320, height: 720 }, { width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
    await page.setViewportSize(viewport)
    await openLab(page)
    const root = frame(page, "a")
    await page.evaluate(() => document.fonts.ready)
    await root.evaluate(node => node.scrollIntoView({ block: "start", inline: "nearest" }))
    const shell = root.getByTestId("header-a-shell")
    const utilities = root.getByTestId("header-a-utilities")
    const curation = root.getByTestId("header-a-curation")
    const spectrum = root.getByTestId("header-spectrum")
    const reset = root.getByTestId("header-spectrum-reset")
    const searchToggle = root.getByRole("button", { name: "장소 검색 열기" })

    const initialPhoneBox = await root.boundingBox()
    const shellBox = await shell.boundingBox()
    const utilitiesBox = await utilities.boundingBox()
    const curationBox = await curation.boundingBox()
    const spectrumBox = await spectrum.boundingBox()
    const resetBox = await reset.boundingBox()
    const searchBox = await searchToggle.boundingBox()
    expect(initialPhoneBox).toBeTruthy()
    expect(shellBox).toBeTruthy()
    expect(utilitiesBox).toBeTruthy()
    expect(curationBox).toBeTruthy()
    expect(shellBox!.height).toBeLessThanOrEqual(106)
    expect(spectrumBox).toBeTruthy()
    expect(resetBox).toBeTruthy()
    expect(searchBox).toBeTruthy()
    expect(resetBox!.width).toBeGreaterThanOrEqual(44)
    expect(resetBox!.height).toBeGreaterThanOrEqual(44)
    expect(searchBox!.width).toBeGreaterThanOrEqual(44)
    expect(searchBox!.height).toBeGreaterThanOrEqual(44)
    for (const utility of await utilities.getByRole("button").all()) {
      const utilityBox = await utility.boundingBox()
      expect(utilityBox).toBeTruthy()
      expect(utilityBox!.width).toBeGreaterThanOrEqual(44)
      expect(utilityBox!.height).toBeGreaterThanOrEqual(44)
    }
    await expect(spectrum).toHaveAttribute("data-selected", "all")
    await expect(root.getByTestId("header-spectrum-selected-marker")).toHaveCount(0)
    await expect(root.getByTestId("header-spectrum").locator("svg")).toHaveCount(0)
    const resultSummary = root.getByTestId("header-a-result-summary")
    await expect(resultSummary).toHaveAttribute("aria-live", "polite")
    const summaryStyle = await resultSummary.evaluate(node => {
      const style = getComputedStyle(node)
      const rect = node.getBoundingClientRect()
      return { clip: style.clip, width: rect.width, height: rect.height }
    })
    expect(summaryStyle.clip).toMatch(/rect\(0px, 0px, 0px, 0px\)/)
    expect(summaryStyle.width).toBeLessThanOrEqual(1)
    expect(summaryStyle.height).toBeLessThanOrEqual(1)
    await expect(root.locator('[class*="mapCaption"]')).toHaveCount(0)
    const cards = root.getByTestId("header-a-card-position")
    await expect(cards).toHaveCount(7)
    await expect(cards.first()).toContainText("1 / 7")

    for (const band of ["cool", "warm", "hot"]) {
      const bandBox = await root.getByTestId(`header-spectrum-${band}`).boundingBox()
      expect(bandBox).toBeTruthy()
      expect(bandBox!.width).toBeGreaterThanOrEqual(48)
      expect(bandBox!.height).toBeGreaterThanOrEqual(44)
    }

    await searchToggle.click()
    const searchForm = root.getByRole("search")
    const searchInput = root.getByRole("textbox", { name: "장소 또는 동네 검색" })
    await expect(searchInput).toBeVisible()
    const searchFormBox = await searchForm.boundingBox()
    const phoneBox = await root.boundingBox()
    expect(searchFormBox).toBeTruthy()
    expect(phoneBox).toBeTruthy()
    expect(searchFormBox!.x).toBeGreaterThanOrEqual(phoneBox!.x)
    expect(searchFormBox!.x + searchFormBox!.width).toBeLessThanOrEqual(phoneBox!.x + phoneBox!.width)
    const expandedUtilitiesBox = await utilities.boundingBox()
    const expandedCurationBox = await curation.boundingBox()
    const expandedShellBox = await shell.boundingBox()
    const expandedSearchBox = await searchToggle.boundingBox()
    const expandedPhoneBox = await root.boundingBox()
    expect(expandedUtilitiesBox).toBeTruthy()
    expect(expandedCurationBox).toBeTruthy()
    expect(expandedShellBox).toBeTruthy()
    expect(expandedSearchBox).toBeTruthy()
    expect(expandedPhoneBox).toBeTruthy()
    expect(searchFormBox!.y).toBeGreaterThanOrEqual(shellBox!.y + shellBox!.height)
    expect(expandedShellBox!.height).toBeLessThanOrEqual(106)
    // Compare positions inside the phone, not page viewport coordinates.
    expect(Math.abs((expandedUtilitiesBox!.x - expandedPhoneBox!.x) - (utilitiesBox!.x - initialPhoneBox!.x))).toBeLessThan(1)
    expect(Math.abs((expandedUtilitiesBox!.y - expandedPhoneBox!.y) - (utilitiesBox!.y - initialPhoneBox!.y))).toBeLessThan(1)
    expect(Math.abs((expandedCurationBox!.x - expandedPhoneBox!.x) - (curationBox!.x - initialPhoneBox!.x))).toBeLessThan(1)
    expect(Math.abs((expandedCurationBox!.y - expandedPhoneBox!.y) - (curationBox!.y - initialPhoneBox!.y))).toBeLessThan(1)
    expect(Math.abs((expandedShellBox!.x - expandedPhoneBox!.x) - (shellBox!.x - initialPhoneBox!.x))).toBeLessThan(1)
    expect(Math.abs((expandedShellBox!.y - expandedPhoneBox!.y) - (shellBox!.y - initialPhoneBox!.y))).toBeLessThan(1)
    expect(Math.abs((expandedSearchBox!.x - expandedPhoneBox!.x) - (searchBox!.x - initialPhoneBox!.x))).toBeLessThan(1)
    expect(Math.abs((expandedSearchBox!.y - expandedPhoneBox!.y) - (searchBox!.y - initialPhoneBox!.y))).toBeLessThan(1)
    expect(expandedSearchBox!.width).toBe(searchBox!.width)
    expect(expandedSearchBox!.height).toBe(searchBox!.height)
    await root.getByRole("button", { name: "검색 닫기" }).click()
  }
})

test("A committed mood updates camera and keeps three local recommendations", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openLab(page)
  const root = frame(page, "a")
  await root.evaluate(node => node.scrollIntoView({ block: "start", inline: "nearest" }))
  const map = root.getByTestId("header-a-map")
  const recommendations = root.getByTestId("header-a-recommendations")
  await expect(recommendations).toHaveAttribute("data-count", "7")
  await expect(recommendations.locator("[data-place-id]")).toHaveCount(7)
  const before = await map.getAttribute("data-camera")
  await root.getByTestId("header-spectrum-cool").click()
  await expect(root.getByTestId("header-a-recommendations")).toHaveAttribute("data-count", "3")
  await expect(map).not.toHaveAttribute("data-camera", before!)
  await expect(recommendations.locator("[data-place-id]")).toHaveCount(3)
  await root.getByRole("button", { name: /도시 변경/ }).click()
  await page.getByRole("dialog").getByRole("button", { name: /^제주/ }).click()
  await expect(recommendations).toHaveAttribute("data-count", "3")
  await expect(recommendations.locator("[data-place-id]")).toHaveCount(3)
})

test("refined A credits collapse on schedule, pause on hover/focus, and open local source info", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openLab(page)
  const root = frame(page, "a")
  await root.evaluate(node => node.scrollIntoView({ block: "start", inline: "nearest" }))
  const credits = root.getByTestId("header-credits")
  await expect(credits).toHaveAttribute("data-expanded", "true")
  await credits.hover()
  await page.waitForTimeout(5_300)
  await expect(credits).toHaveAttribute("data-expanded", "true")
  const sourceButton = credits.getByRole("button", { name: "지도 출처 보기" })
  await sourceButton.evaluate(node => (node as HTMLElement).focus({ preventScroll: true }))
  await page.waitForTimeout(5_300)
  await expect(credits).toHaveAttribute("data-expanded", "true")
  await root.getByRole("button", { name: "지도 옵션" }).evaluate(node => (node as HTMLElement).focus({ preventScroll: true }))
  await page.mouse.move(2, 2)
  await page.waitForTimeout(5_300)
  await expect(credits).toHaveAttribute("data-expanded", "false")
  await sourceButton.click()
  await expect(page.getByRole("dialog", { name: /지도 출처/ })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog", { name: /지도 출처/ })).not.toBeVisible()
})

test("wallet and options dialogs close with Escape and return focus to their triggers", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openLab(page)
  const root = frame(page, "a")
  const wallet = root.getByRole("button", { name: /여행 지갑/ })
  await wallet.click()
  await expect(page.getByRole("dialog", { name: "여행 지갑" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog", { name: "여행 지갑" })).toBeHidden()
  await expect(wallet).toBeFocused()
  const options = root.getByRole("button", { name: "지도 옵션" })
  await options.click()
  const optionsDialog = page.getByRole("dialog", { name: "지도 옵션" })
  await expect(optionsDialog).toBeVisible()
  await optionsDialog.getByRole("checkbox").uncheck()
  await page.keyboard.press("Escape")
  await expect(optionsDialog).toBeHidden()
  await expect(options).toBeFocused()
  await expectNoOverflow(page)
})

test("320px Seoul and Jeju 19+ maps keep pin targets and readable search text across all variants", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 })
  await openLab(page)
  for (const variant of variants) {
    const root = frame(page, variant)
    await page.getByRole("button", { name: new RegExp(`^${variant.toUpperCase()} `) }).click()
    for (const city of ["서울", "제주"] as const) {
      await root.getByRole("button", { name: /도시 변경/ }).click()
      await page.getByRole("dialog").getByRole("button", { name: new RegExp(`^${city}`) }).click()
      let filters: Locator
      if (variant === "a") {
        await root.getByRole("button", { name: "지도 옵션" }).click()
        await page.getByRole("dialog", { name: "지도 옵션" }).getByRole("button", { name: "19+ 설정" }).click()
        filters = page.getByRole("dialog", { name: "19+ 장소" })
      } else {
        await root.getByRole("button", { name: "분위기 및 19+ 필터" }).first().click()
        filters = page.getByRole("dialog", { name: "분위기로 찾아보기" })
      }
      const checkbox = filters.getByRole("checkbox")
      if (!(await checkbox.isChecked())) await checkbox.check()
      await filters.getByRole("button", { name: variant === "a" ? "지도 보기" : /곳 보기/ }).click()
      await expect(root.getByText("19+ 포함")).toBeVisible()
      const search = root.getByRole("textbox", { name: "장소 또는 동네 검색" })
      if (variant === "a") {
        await root.getByRole("button", { name: "장소 검색 열기" }).click()
        await expect(search).toBeVisible()
        await root.getByRole("button", { name: "검색 닫기" }).click()
        await root.getByRole("button", { name: "장소 검색 열기" }).click()
      }
      expect(await search.evaluate(node => Number.parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16)
      if (variant === "a") await root.getByRole("button", { name: "검색 닫기" }).click()
      const map = root.locator("[aria-label$='예시 지도']")
      await map.evaluate(node => node.scrollIntoView({ block: "start", inline: "nearest" }))
      const pins = map.locator("button")
      await expect(pins.first()).toBeVisible()
      const results = await pins.evaluateAll(nodes => nodes.map(node => {
        const box = node.getBoundingClientRect()
        const points = [box.top + 2, box.top + box.height / 2, box.bottom - 2]
        return { width: box.width, height: box.height, hits: points.map(y => {
          const target = document.elementFromPoint(box.left + box.width / 2, y)
          return y >= 0 && y < innerHeight && node.contains(target)
        }) }
      }))
      expect(results.length).toBeGreaterThan(0)
      expect(results.every(result => result.width > 0 && result.height > 0 && result.hits.every(Boolean))).toBe(true)
      await expectNoOverflow(page)
    }
  }
})
