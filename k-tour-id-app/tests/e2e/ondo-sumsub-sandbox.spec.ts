import { expect, test, type Page, type Route } from "@playwright/test"

// UI regression only: every KYC response is intercepted before the real server.
// These cases neither possess credentials nor launch a real provider SDK.
const DEVICE_KEY = "ondo-b.device.v1"
const FAKE_ACCESS_CODE = "ui-fixture-not-a-real-access-code"
type Status = "access_required" | "pending" | "approved" | "retry" | "rejected" | "expired" | "unavailable"
type Reply = { status: number; body?: Record<string, unknown> }
type ApiPlan = { status(): Reply; session?(): Reply; close?(): Reply }
type ApiCalls = { status: number; sessions: Record<string, unknown>[]; closes: number }
const guards = new WeakMap<Page, { errors: string[]; providerRequests: string[] }>()

test.use({ viewport: { width: 390, height: 844 } })
test.setTimeout(90_000)

function snapshot(status: Status, httpStatus = 200): Reply {
  return { status: httpStatus, body: { status, configured: true, environment: "sandbox", checkedAt: Date.now(), expiresAt: Date.now() + 60_000, retryAfterSeconds: 10 } }
}

test.beforeEach(async ({ page }) => {
  const guard = { errors: [] as string[], providerRequests: [] as string[] }
  guards.set(page, guard)
  page.on("pageerror", error => guard.errors.push(error.stack ?? error.message))
  await page.route(url => /(^|\.)sumsub\.(com|net)$/.test(url.hostname), async route => {
    guard.providerRequests.push(new URL(route.request().url()).hostname)
    await route.abort("blockedbyclient")
  })
  // Basemap transport is outside this identity UI regression's scope.
  await page.route("https://tiles.openfreemap.org/**", route => route.abort("blockedbyclient"))
})

test.afterEach(async ({ page }) => {
  expect(guards.get(page)?.providerRequests, "No real Sumsub SDK/API request is permitted in this mocked suite").toEqual([])
  expect(guards.get(page)?.errors, "No application JavaScript errors").toEqual([])
})

async function mockApi(page: Page, plan: ApiPlan): Promise<ApiCalls> {
  const calls: ApiCalls = { status: 0, sessions: [], closes: 0 }
  async function fulfill(route: Route, reply: Reply) {
    await route.fulfill({ status: reply.status, headers: { "Cache-Control": "no-store" }, ...(reply.body ? { contentType: "application/json", body: JSON.stringify(reply.body) } : {}) })
  }
  await page.route("**/api/kyc/**", async route => {
    const request = route.request()
    const url = new URL(request.url())
    expect(url.origin).toBe(new URL(page.url()).origin)
    expect(request.headers()["x-ktour-kyc"]).toBe("1")
    if (url.pathname === "/api/kyc/sumsub/status" && request.method() === "GET") {
      calls.status += 1
      return fulfill(route, plan.status())
    }
    if (url.pathname === "/api/kyc/sumsub/session" && request.method() === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>
      calls.sessions.push(body)
      expect(Object.keys(body).sort()).toEqual(body.accessCode === undefined ? ["consent", "locale"] : ["accessCode", "consent", "locale"])
      expect(body).toMatchObject({ consent: true, locale: "en" })
      return fulfill(route, plan.session?.() ?? snapshot("access_required", 401))
    }
    if (url.pathname === "/api/kyc/sumsub/session" && request.method() === "DELETE") {
      calls.closes += 1
      return fulfill(route, plan.close?.() ?? { status: 204 })
    }
    await route.abort("blockedbyclient")
    throw new Error("Unexpected KYC request in mocked Sandbox regression")
  })
  return calls
}

async function authoritySnapshot(page: Page) {
  return page.evaluate(key => {
    const device = JSON.parse(localStorage.getItem(key) ?? "{}")
    const axes = JSON.parse(sessionStorage.getItem("ondo-b.action-gates.v1") ?? "{}")
    return {
      credential: device.identityCredential ?? null,
      person: axes.person ?? null,
      payment: axes.payment ?? null,
      age: sessionStorage.getItem("ondo-b.after19.session.v1"),
      receipts: device.commerceReceipts ?? [],
      onboarding: device.onboarding ?? "ONB-NEW",
      persona: device.persona ?? null,
      preferences: device.discoveryPreferences ?? [],
    }
  }, DEVICE_KEY)
}

async function noIssuedPass(page: Page) {
  await expect(page.getByTestId("traveler-id-credential")).toHaveAttribute("data-status", "none")
  for (const axis of ["person", "age", "payment"]) await expect(page.getByTestId(`traveler-id-${axis}`)).toHaveAttribute("data-status", "none")
  await expect(page.getByTestId("k-tour-id-credential")).toHaveCount(0)
  expect(await page.evaluate(code => [...Object.values(localStorage), ...Object.values(sessionStorage)].some(value => String(value).includes(code)), FAKE_ACCESS_CODE)).toBe(false)
}

async function noHorizontalOverflow(page: Page) {
  const widths = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }))
  expect(widths.document).toBeLessThanOrEqual(widths.viewport + 1)
  for (const selector of ["k-tour-id-setup", "sumsub-passport-step"]) {
    const box = await page.getByTestId(selector).boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(-1)
    expect(box!.x + box!.width).toBeLessThanOrEqual(widths.viewport + 1)
  }
}

async function openPassport(page: Page, calls: ApiCalls, appearance: "light" | "dark" = "light", locale: "en" | "ko" | "ja" = "en") {
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: appearance })
  // Only display preferences are seeded: onboarding, identity and account stay new.
  await page.addInitScript(({ key, appearance, locale }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ locale, appearancePreference: appearance }))
  }, { key: DEVICE_KEY, appearance, locale })
  await page.goto("/?review=0", { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("ondo-b-root")).toHaveAttribute("data-hydrated", "true", { timeout: 45_000 })
  await expect(page.locator("html")).toHaveAttribute("data-ondo-theme", appearance)
  await expect(page.getByTestId("ondo-b-nation")).toBeVisible()
  await expect(page.getByTestId("ondo-onboarding-backdrop")).toHaveCount(0)
  await expect(page.getByTestId("researched-food-detail")).toHaveCount(0)
  await page.getByTestId("nav-id").click()
  await noIssuedPass(page)
  const before = await authoritySnapshot(page)
  await page.getByTestId("kpass-start-setup").click()
  const setup = page.getByTestId("k-tour-id-setup")
  await expect(setup.getByTestId("ktour-id-route-passport")).toHaveAttribute("data-availability", "sandbox")
  await setup.getByTestId("ktour-id-route-passport").click()
  await expect(setup).toHaveAttribute("data-phase", "consent")
  await expect(setup).toHaveAttribute("data-environment", "sandbox")
  await expect(setup.getByTestId("k-tour-id-consent")).toContainText("Sumsub")
  await expect(setup.getByTestId("k-tour-id-technical-truth")).toContainText(locale === "ko" ? "권한으로 연결되지" : locale === "ja" ? "権限には反映されません" : "benefit permissions")
  expect(await setup.innerText()).not.toMatch(/\btest\b|sandbox|테스트|テスト/i)
  await expect(setup.getByTestId("identity-sample-controls")).toHaveCount(0)
  expect(calls).toEqual({ status: 0, sessions: [], closes: 0 })
  await setup.getByTestId("k-tour-id-consent-approve").click()
  const step = page.getByTestId("sumsub-passport-step")
  await expect(step).not.toHaveAttribute("data-status", "loading")
  await expect(step).toHaveAttribute("data-environment", "sandbox")
  await expect(step).toHaveAttribute("data-pass-issued", "false")
  await expect(setup.getByRole("button", { name: "Previous step", exact: true })).toHaveCount(0)
  await expect(setup.getByTestId("k-tour-id-cancel")).toBeVisible()
  await expect(page.getByTestId("sumsub-sdk-container")).toBeHidden()
  expect(await setup.innerText()).not.toMatch(/\btest\b|sandbox|테스트|テスト/i)
  await expect(page.locator("#ktour-local-fixture-panel, #ktour-review-controller")).toHaveCount(0)
  return { setup, step, before }
}

async function expectReturnedWithoutAuthority(page: Page, before: Awaited<ReturnType<typeof authoritySnapshot>>) {
  await expect(page.getByTestId("k-tour-id-setup")).toHaveCount(0)
  await expect(page.getByTestId("kpass-start-setup")).toBeFocused()
  await noIssuedPass(page)
  expect(await authoritySnapshot(page)).toEqual(before)
}

for (const locale of ["ko", "ja"] as const) {
  for (const width of [320, 390]) {
    test(`SUMSUB-UI ${locale} ${width}px: pending copy fits and closing never grants authority`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 844 })
      const calls = await mockApi(page, { status: () => snapshot("pending") })
      const { before } = await openPassport(page, calls, "light", locale)
      await noHorizontalOverflow(page)
      await page.getByTestId("sumsub-return").scrollIntoViewIfNeeded()
      await expect(page.getByTestId("sumsub-return")).toBeVisible()
      await page.screenshot({ path: info.outputPath(`pending-${locale}-${width}.png`) })
      await page.getByTestId("sumsub-return").click()
      await expectReturnedWithoutAuthority(page, before)
    })
  }
}

for (const appearance of ["light", "dark"] as const) {
  test(`SUMSUB-UI ${appearance}: map-first consent precedes the protected code gate and denied retry`, async ({ page }, info) => {
    const calls = await mockApi(page, { status: () => snapshot("access_required") })
    const { step, before } = await openPassport(page, calls, appearance)
    await expect(step).toHaveAttribute("data-status", "access_required")
    await expect(page.getByTestId("sumsub-access-code")).toHaveAttribute("type", "password")
    await expect(page.getByTestId("sumsub-start")).toBeDisabled()
    await page.getByTestId("sumsub-access-code").fill(FAKE_ACCESS_CODE)
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      await page.getByTestId("sumsub-start").click()
      await expect.poll(() => calls.sessions.length).toBe(attempt)
      await expect(step.getByRole("alert")).toContainText("Check your invite code")
      await expect(page.getByTestId("sumsub-start")).toBeEnabled()
    }
    expect(calls.sessions.every(body => body.accessCode === FAKE_ACCESS_CODE)).toBe(true)
    await noIssuedPass(page)
    await noHorizontalOverflow(page)
    await page.screenshot({ path: info.outputPath(`code-gate-${appearance}.png`) })
    await page.getByTestId("sumsub-return").click()
    await expectReturnedWithoutAuthority(page, before)
    expect(calls.closes).toBe(1)
  })

  test(`SUMSUB-UI ${appearance}: server Sandbox approval displays a result but issues no local credential`, async ({ page }, info) => {
    const calls = await mockApi(page, { status: () => snapshot("approved") })
    const { step, before } = await openPassport(page, calls, appearance)
    await expect(step).toHaveAttribute("data-status", "approved")
    await expect(step.getByRole("heading")).toHaveText("Your passport check is complete")
    await expect(step).toContainText("Pass issuance and benefits are handled separately")
    await expect(page.getByTestId("sumsub-start")).toHaveCount(0)
    await expect(page.getByTestId("sumsub-check-status")).toHaveCount(0)
    await noIssuedPass(page)
    expect(await authoritySnapshot(page)).toEqual(before)
    await noHorizontalOverflow(page)
    await page.screenshot({ path: info.outputPath(`server-approved-no-pass-${appearance}.png`) })
    await page.getByTestId("sumsub-return").click()
    await expectReturnedWithoutAuthority(page, before)
    expect(calls.sessions).toEqual([])
    expect(calls.closes).toBe(0)
    await page.reload({ waitUntil: "domcontentloaded" })
    await expect(page.getByTestId("ondo-b-root")).toHaveAttribute("data-hydrated", "true")
    await page.getByTestId("nav-id").click()
    await noIssuedPass(page)
    expect(await authoritySnapshot(page)).toEqual(before)
  })
}

test("SUMSUB-UI expired: restarting requests access again without reviving identity", async ({ page }) => {
  const calls = await mockApi(page, { status: () => snapshot("expired"), session: () => snapshot("access_required", 401) })
  const { step, before } = await openPassport(page, calls)
  await expect(step.getByRole("heading")).toHaveText("Your session has expired")
  await page.getByTestId("sumsub-start").click()
  await expect(step).toHaveAttribute("data-status", "access_required")
  await expect(page.getByTestId("sumsub-access-code")).toBeVisible()
  expect(calls.sessions).toEqual([{ consent: true, locale: "en" }])
  await page.getByTestId("sumsub-return").click()
  await expectReturnedWithoutAuthority(page, before)
})

test("SUMSUB-UI rejected: no restart or issuance is offered and the same ID entry is restored", async ({ page }) => {
  const calls = await mockApi(page, { status: () => snapshot("rejected") })
  const { step, before } = await openPassport(page, calls, "dark")
  await expect(step.getByRole("heading")).toHaveText("We couldn’t verify your passport")
  await expect(step).toContainText("existing pass are unchanged")
  await expect(page.getByTestId("sumsub-start")).toHaveCount(0)
  await expect(page.getByTestId("sumsub-check-status")).toHaveCount(0)
  await page.getByTestId("sumsub-return").click()
  await expectReturnedWithoutAuthority(page, before)
  expect(calls.sessions).toEqual([])
  expect(calls.closes).toBe(0)
})

test("SUMSUB-UI unavailable503: explicit status retry follows only later server review responses", async ({ page }) => {
  let reply = snapshot("unavailable", 503)
  const calls = await mockApi(page, { status: () => reply })
  const { step, before } = await openPassport(page, calls)
  await expect(step).toHaveAttribute("data-status", "unavailable")
  await expect(step.getByRole("heading")).toHaveText("Passport verification is unavailable")
  await expect(page.getByTestId("sumsub-start")).toHaveCount(0)
  await noIssuedPass(page)
  reply = snapshot("retry")
  await page.getByTestId("sumsub-check-status").click()
  await expect(step).toHaveAttribute("data-status", "retry")
  await expect(step.getByRole("heading")).toHaveText("One more step is needed")
  await expect(page.getByTestId("sumsub-start")).toHaveText("Continue passport check")
  await noIssuedPass(page)
  reply = snapshot("approved")
  await page.getByTestId("sumsub-check-status").click()
  await expect(step).toHaveAttribute("data-status", "approved")
  await page.getByTestId("sumsub-return").click()
  await expectReturnedWithoutAuthority(page, before)
  expect(calls.sessions).toEqual([])
})

test("SUMSUB-UI pending: a failed close stays honest and retry ends only the browser session", async ({ page }) => {
  let closeAttempts = 0
  const calls = await mockApi(page, { status: () => snapshot("pending"), close: () => ++closeAttempts === 1 ? snapshot("unavailable", 503) : { status: 204 } })
  const { setup, step, before } = await openPassport(page, calls, "dark")
  await expect(step.getByRole("heading")).toHaveText("Your passport is being reviewed")
  await expect(step).toContainText("Closing this screen does not cancel the review")
  await expect(page.getByTestId("sumsub-start")).toHaveCount(0)
  await setup.getByTestId("k-tour-id-cancel").click()
  await expect(step.getByRole("alert")).toContainText("couldn’t confirm that this browser session ended")
  await expect(step.getByRole("alert")).toContainText("does not cancel the review or delete data")
  await expect(page.getByTestId("sumsub-sdk-container")).toBeHidden()
  await expect(page.getByTestId("sumsub-close-screen")).toBeVisible()
  await expect(page.getByTestId("sumsub-return")).toHaveText("Retry closing")
  expect(calls.closes).toBe(1)
  await noIssuedPass(page)
  await page.getByTestId("sumsub-return").click()
  await expectReturnedWithoutAuthority(page, before)
  expect(calls.closes).toBe(2)
  expect(calls.sessions).toEqual([])
})

test("SUMSUB-UI a temporary status outage preserves pending review and recovers on the next query", async ({ page }) => {
  let reply = snapshot("pending")
  const calls = await mockApi(page, { status: () => reply })
  const { step, before } = await openPassport(page, calls)
  const outages: Reply[] = [
    { status: 503, body: { status: "unavailable", error: "provider_unavailable", configured: true, environment: "sandbox" } },
    { status: 502 },
    { status: 504 },
  ]
  for (const outage of outages) {
    reply = outage
    await page.getByTestId("sumsub-check-status").click()
    await expect(step).toHaveAttribute("data-status", "pending")
    await expect(step.getByRole("heading")).toHaveText("Your passport is being reviewed")
    await expect(step.getByRole("alert")).toContainText("Check your connection")
    await noIssuedPass(page)
  }
  reply = snapshot("approved")
  await page.getByTestId("sumsub-check-status").click()
  await expect(step).toHaveAttribute("data-status", "approved")
  await expect(step.getByRole("alert")).toHaveCount(0)
  await page.getByTestId("sumsub-return").click()
  await expectReturnedWithoutAuthority(page, before)
  expect(calls.sessions).toEqual([])
})
