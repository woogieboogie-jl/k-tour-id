import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test"

const TABLE = "table-busan-gijang-dinner"
test.describe.configure({ timeout: 90_000 })

async function capture(page: Page, info: TestInfo, name: string) {
  await page.screenshot({ path: info.outputPath(`${name}.png`), scale: "css" })
}

async function companionsFollowTask(detail: Locator, task: Locator) {
  const panel = detail.locator(":scope > article")
  // Inspect one common scroll space, without moving focus or domain state.
  await panel.evaluate(node => { node.scrollTop = 0 })
  const facts = detail.locator('[data-plan-context="detail"]')
  const companion = detail.getByTestId("table-companion-actions")
  const profile = detail.getByTestId("profile-entry-table_host")
  const [a, b, c, d] = await Promise.all([facts.boundingBox(), task.boundingBox(), companion.boundingBox(), profile.boundingBox()])
  expect(a).not.toBeNull(); expect(b).not.toBeNull(); expect(c).not.toBeNull(); expect(d).not.toBeNull()
  expect(c!.y).toBeGreaterThanOrEqual(Math.max(a!.y + a!.height, b!.y + b!.height) - 1)
  expect(d!.y).toBeGreaterThanOrEqual(c!.y + c!.height - 1)
  expect(await panel.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
}

async function reachable(control: Locator) {
  await control.scrollIntoViewIfNeeded()
  expect(await control.evaluate(node => {
    const b = node.getBoundingClientRect()
    return b.width >= 44 && b.height >= 44 && node.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2))
  })).toBe(true)
}

for (const viewport of [{ width: 820, height: 390 }, { width: 1440, height: 1000 }]) {
  test(`R5-WIDE Table optional destinations follow the active task at ${viewport.width}`, async ({ page, context }, info) => {
    test.skip(info.project.name !== "mobile-chromium", "One worker/profile with explicit landscape and wide viewports")
    const failures: string[] = []
    page.on("pageerror", error => failures.push(error.message))
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url())
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method())
        || /sumsub|onfido|omni.?one|opendid|fullnode|sui\.io|walletconnect|stripe/i.test(url.hostname)) {
        failures.push(`${request.method()} ${url.origin}`)
        return route.abort("blockedbyclient")
      }
      return route.continue()
    })
    await page.setViewportSize(viewport)
    await page.emulateMedia({ reducedMotion: "reduce" })
    await page.addInitScript(() => {
      if (!["localhost", "127.0.0.1"].includes(location.hostname)) return
      localStorage.setItem("ondo-b.device.v1", JSON.stringify({ locale: "en", appearancePreference: "dark", onboarding: "ONB-COMPLETE" }))
    })
    await page.goto("/?review=1", { waitUntil: "domcontentloaded" })
    await expect(page.getByTestId("ondo-b-root")).toHaveAttribute("data-hydrated", "true")
    await page.getByTestId("nav-tables").click()
    await page.getByTestId(`table-open-${TABLE}`).click()
    const detail = page.getByTestId("table-detail")
    const facts = detail.locator('[data-plan-context="detail"]')
    await expect(facts.locator("dl > div")).toHaveCount(6)
    for (const value of await facts.locator("dd").all()) {
      await expect(value).toHaveCSS("font-size", "15px")
      expect(await value.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
    }
    expect(await facts.evaluate(node => getComputedStyle(node, "::before").content)).toBe("none")
    expect(await facts.locator("dl > div").first().evaluate(node => getComputedStyle(node, "::before").content)).toBe("none")
    const join = detail.getByTestId("table-join")
    await companionsFollowTask(detail, join.locator(".."))
    await capture(page, info, "wide-detail-order")
    await reachable(detail.getByTestId("table-return-place"))
    await reachable(detail.getByTestId("table-reservation-open"))
    await capture(page, info, "wide-detail-companions")
    await detail.getByTestId("table-join-draft").fill("Keep the exact wide-layout plan note.")
    await join.click()
    await page.getByTestId("action-gate-confirm").click()
    await expect(detail.getByTestId("after19-return")).toHaveText("Keep the exact wide-layout plan note.")
    await detail.getByTestId("table-join-confirm").click()
    await detail.getByTestId("table-open-chat").click()
    const chat = detail.getByTestId("table-chat")
    await expect(chat).toBeVisible()
    await companionsFollowTask(detail, chat)
    await reachable(detail.getByTestId("table-return-place"))
    await reachable(detail.getByTestId("table-reservation-open"))
    await capture(page, info, "wide-chat-companions")
    await reachable(detail.getByTestId("table-host-profile-open"))
    await detail.getByTestId("table-host-profile-open").click()
    await detail.getByTestId("ondo-profile-panel").getByRole("button", { name: "Close profile", exact: true }).click()
    await expect(detail.getByTestId("table-host-profile-open")).toBeFocused()
    await expect(detail).toHaveAttribute("data-table-membership", "TMB-CONFIRMED")
    expect(failures).toEqual([])
  })
}
