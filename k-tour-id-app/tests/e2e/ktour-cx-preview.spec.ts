import { expect, test, type Page } from "@playwright/test"

test.describe.configure({ timeout: 90_000 })
test.use({ serviceWorkers: "block", video: "off", deviceScaleFactor: 1, viewport: { width: 375, height: 812 } })

const VENUE_ID = "mois-0021cd596bc5b2a922ad"
type HandoffMode = "qr" | "app"
type Scenario = "normal" | "access" | "pending" | "expired" | "cancel-fails" | "verified-replay"

const config = {
  cxPreview: true,
  isolatedMock: false,
  campaign: { venueId: VENUE_ID, campaignId: "cx-preview", title: { ko: "CX", en: "CX", ja: "CX" }, description: { ko: "CX", en: "CX", ja: "CX" }, endsAt: "2099-01-01T00:00:00.000Z" },
  modes: { cx: "cx", opendid: "disabled-cx-preview", ai: "disabled-cx-preview", sui: "disabled-cx-preview", omnione: "disabled-cx-preview", zklogin: "disabled-cx-preview" },
  sui: { network: "", packageId: "", campaignId: "", explorer: "", googleClientId: "" },
  omnione: { chainId: 0, registryAddress: "" }, consentVersion: "cx-preview-v1",
}

const OPERATION_ID = "op_fixture12345"
const QR_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

function operation(phase: "identity" | "issuance", handoff?: Record<string, unknown>, verified = false) {
  return { operationId: OPERATION_ID, venueId: VENUE_ID, phase, status: "pending", identity: { mode: "cx", provider: "fixture", personVerified: verified, handoff: handoff ?? null }, error: null }
}

async function installMock(page: Page, baseURL: string, scenario: Scenario = "normal") {
  const origin = new URL(baseURL).origin
  let authorized = scenario !== "access"
  let current: Record<string, unknown> = scenario === "pending"
    ? operation("identity", { kind: "qr", qrBase64: QR_PNG, expiresAt: "2099-01-01T00:00:00.000Z" })
    : operation("identity")
  let nextHandoff: HandoffMode = "qr"
  const calls: string[] = []
  const forbidden: string[] = []
  page.on("request", request => {
    const url = new URL(request.url())
    if (request.method() === "POST" && /credential|delegation|agent|redeem|presentation|issue/.test(url.pathname)) forbidden.push(url.pathname)
    if (url.pathname.startsWith("/api/hackathon/v1/")) calls.push(`${request.method()} ${url.pathname}`)
  })
  await page.route("**/*", async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin !== origin && !["fonts.googleapis.com", "fonts.gstatic.com", "tiles.openfreemap.org"].includes(url.hostname)) {
      await route.abort("blockedbyclient")
      return
    }
    if (url.origin !== origin || !url.pathname.startsWith("/api/hackathon/v1/")) {
      await route.continue()
      return
    }
    const path = url.pathname.replace("/api/hackathon/v1/", "")
    if (path === "config" && request.method() === "GET") {
      if (!authorized) return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: { code: "cx_preview_access_denied" } }) })
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(config) })
    }
    if (path === "sessions" && request.method() === "POST") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, sessionId: "fixture-session" }) })
    if (path === `places/${VENUE_ID}/demo-entitlements` && request.method() === "GET") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ supported: true, operation: scenario === "pending" ? current : null, redeemed: null }) })
    if (path === "preview/access" && request.method() === "POST") { authorized = true; return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, expiresAt: "2099-01-01T00:00:00.000Z" }) }) }
    if (path === "operations" && request.method() === "POST") { current = scenario === "verified-replay" ? operation("issuance", undefined, true) : operation("identity"); return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(current) }) }
    if (path === `operations/${OPERATION_ID}` && request.method() === "GET") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(current) })
    if (path === `operations/${OPERATION_ID}/identity/start` && request.method() === "POST") {
      const body = JSON.parse(request.postData() ?? "{}") as { mobile?: boolean }
      nextHandoff = body.mobile ? "app" : "qr"
      const expiresAt = scenario === "expired" ? "2000-01-01T00:00:00.000Z" : "2099-01-01T00:00:00.000Z"
      const handoff = nextHandoff === "qr"
        ? { kind: "qr", qrBase64: QR_PNG, expiresAt }
        : { kind: "app", androidLink: "cx-native://android/sentinel", iosLink: "cx-native://ios/sentinel", expiresAt }
      current = operation("identity", handoff); return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(current) })
    }
    if (path === `operations/${OPERATION_ID}/identity/complete` && request.method() === "POST") {
      if (scenario === "pending") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...current, status: "pending", error: null }) })
      if (scenario === "expired") return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: { code: "identity_expired", message: "expired" } }) })
      current = { ...current, identity: { ...(current.identity as Record<string, unknown>), mode: "cx", personVerified: true, handoff: null }, phase: "issuance", status: "pending" }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(current) })
    }
    if (path === `operations/${OPERATION_ID}/cancel` && request.method() === "POST") {
      if (scenario === "cancel-fails") return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "cancel_failed", message: "retry" } }) })
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...current, status: "cancelled" }) })
    }
    return route.continue()
  })
  page.on("pageerror", error => { throw error })
  return { calls, forbidden }
}

async function openPreview(page: Page, baseURL: string, scenario: Scenario = "normal") {
  const mock = await installMock(page, baseURL, scenario)
  await page.addInitScript(() => localStorage.setItem("ondo-b.device.v1", JSON.stringify({ locale: "en", appearancePreference: "light", onboarding: "ONB-COMPLETE" })))
  await page.goto(`${baseURL}/?venueId=${VENUE_ID}&review=0`, { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("ondo-b-root")).toBeVisible()
  await page.getByTestId("canonical-place-details").click()
  await page.getByTestId("hackathon-entitlement-open").click()
  const preview = page.getByTestId("hackathon-cx-preview")
  await expect(preview).toBeVisible()
  return { preview, ...mock }
}

async function acceptConsent(preview: ReturnType<Page["getByTestId"]>) {
  await preview.getByRole("checkbox").check()
  await preview.getByRole("button", { name: /확인 단계로|Continue to check|確認へ進む/ }).click()
  await expect(preview).toHaveAttribute("data-status", "identity")
}

test("access input is a real password field, grants access, and does not start identity on load", async ({ page, baseURL }, info) => {
  const mock = await installMock(page, baseURL!, "access")
  await page.addInitScript(() => localStorage.setItem("ondo-b.device.v1", JSON.stringify({ locale: "en", appearancePreference: "light", onboarding: "ONB-COMPLETE" })))
  await page.goto(`${baseURL}/?venueId=${VENUE_ID}&review=0`, { waitUntil: "domcontentloaded" })
  await page.getByTestId("canonical-place-details").click(); await page.getByTestId("hackathon-entitlement-open").click()
  const preview = page.getByTestId("hackathon-cx-preview")
  const input = preview.locator("input[type='password']")
  await expect(input).toBeVisible(); expect((await input.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(200)
  await page.screenshot({ path: info.outputPath("cx-access.png"), scale: "css" })
  await input.fill("fixture-access"); await preview.getByRole("button", { name: /Continue|확인|確認/ }).click()
  await expect(preview).toHaveAttribute("data-status", "consent")
  await page.screenshot({ path: info.outputPath("cx-consent.png"), scale: "css" })
  expect(mock.calls.some(path => path.includes("identity/start"))).toBe(false)
})

test("401 access can be retried, then consent explicitly selects QR or app before identity start", async ({ page, baseURL }, info) => {
  const mock = await installMock(page, baseURL!); let granted = false
  await page.route("**/api/hackathon/v1/config", async route => { if (!granted) return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: { code: "cx_preview_access_denied" } }) }); await route.fallback() })
  await page.addInitScript(() => localStorage.setItem("ondo-b.device.v1", JSON.stringify({ locale: "en", appearancePreference: "light", onboarding: "ONB-COMPLETE" })))
  await page.goto(`${baseURL}/?venueId=${VENUE_ID}&review=0`, { waitUntil: "domcontentloaded" }); await page.getByTestId("canonical-place-details").click(); await page.getByTestId("hackathon-entitlement-open").click()
  const preview = page.getByTestId("hackathon-cx-preview"); await expect(preview.locator("input[type='password']")).toBeVisible()
  granted = true; await preview.locator("input[type='password']").fill("fixture-access"); await preview.getByRole("button", { name: /Continue|확인|確認/ }).click(); await expect(preview).toHaveAttribute("data-status", "consent")
  await acceptConsent(preview); await expect(preview.getByRole("button", { name: /Start Mobile ID|모바일 신분증 확인 시작|Mobile ID確認を開始/ })).toBeDisabled()
  await preview.getByRole("button", { name: /Use QR|QR로 확인|QRで確認/ }).click(); await preview.getByRole("button", { name: /Start Mobile ID|모바일 신분증 확인 시작|Mobile ID確認を開始/ }).click()
  await expect(preview.getByAltText(/QR|Mobile ID/)).toBeVisible(); await page.screenshot({ path: info.outputPath("cx-qr.png"), scale: "css" }); expect(mock.forbidden).toEqual([])
})

test("pending identity resumes after reload and never exposes issuance or chain actions", async ({ page, baseURL }) => {
  const { preview, forbidden } = await openPreview(page, baseURL!, "pending")
  await expect(preview).toHaveAttribute("data-status", "identity"); await expect(preview).toContainText(/Scan|스캔|読み取/); await expect(preview.getByRole("button", { name: /Start Mobile ID|모바일 신분증 확인 시작|Mobile ID確認を開始/ })).toHaveCount(0)
  await page.reload(); await expect(page.getByTestId("hackathon-cx-preview")).toHaveCount(0); await page.goto(`${baseURL}/?venueId=${VENUE_ID}&review=0`, { waitUntil: "domcontentloaded" }); await expect(page.getByTestId("ondo-b-root")).toBeVisible(); await expect(page.getByTestId("canonical-place-details")).toBeVisible(); await page.getByTestId("canonical-place-details").click(); await page.getByTestId("hackathon-entitlement-open").click(); await expect(page.getByTestId("hackathon-cx-preview")).toHaveAttribute("data-status", "identity"); await expect(page.getByTestId("hackathon-cx-preview")).toContainText(/Scan|스캔|読み取/); expect(forbidden).toEqual([])
})

test("failed cancel preserves the pending identity operation", async ({ page, baseURL }) => {
  const { preview } = await openPreview(page, baseURL!, "cancel-fails")
  await acceptConsent(preview); await preview.getByRole("button", { name: /Use app|앱으로 확인|アプリで確認/ }).click(); await preview.getByRole("button", { name: /Start Mobile ID|모바일 신분증 확인 시작|Mobile ID確認を開始/ }).click(); await expect(preview).toContainText(/Finish|앱에서|アプリ/)
  await preview.getByRole("button", { name: /Cancel|취소|キャンセル/ }).last().click(); await expect(preview).toContainText(/could not|실패|できません/); await expect(preview).toContainText(/Finish|앱에서|アプリ/)
})

test("expired handoff offers a safe restart", async ({ page, baseURL }) => {
  const { preview } = await openPreview(page, baseURL!, "expired")
  await acceptConsent(preview); await preview.getByRole("button", { name: /Use QR|QR로 확인|QRで確認/ }).click(); await preview.getByRole("button", { name: /Start Mobile ID|모바일 신분증 확인 시작|Mobile ID確認を開始/ }).click(); await expect(preview).toContainText(/expired|만료|切れ/); await expect(preview.getByRole("button", { name: /Check result|결과 확인|結果を確認/ })).toBeDisabled()
})

test("verified identity stops at identity-only success and returns focus to the same place", async ({ page, baseURL }) => {
  const { preview, forbidden } = await openPreview(page, baseURL!)
  await acceptConsent(preview); await preview.getByRole("button", { name: /Use app|앱으로 확인|アプリで確認/ }).click(); await preview.getByRole("button", { name: /Start Mobile ID|모바일 신분증 확인 시작|Mobile ID確認を開始/ }).click(); await preview.getByRole("button", { name: /Check result|결과 확인|結果を確認/ }).click(); await expect(preview).toHaveAttribute("data-status", "success"); await expect(preview).toContainText(/Identity check complete|신원 확인이 완료|本人確認が完了/)
  await preview.getByRole("button", { name: /Return to this place|같은 장소로 돌아가기|同じ場所に戻る/ }).click(); await expect(page.getByTestId("canonical-place-overlay")).toBeVisible(); await expect(page.getByTestId("hackathon-entitlement-open")).toBeFocused(); expect(forbidden).toEqual([])
})

test("a server replay that is already verified and in issuance stops at identity-only success", async ({ page, baseURL }) => {
  const { preview, forbidden } = await openPreview(page, baseURL!, "verified-replay")
  await preview.getByRole("checkbox").check(); await preview.getByRole("button", { name: /확인 단계로|Continue to check|確認へ進む/ }).click()
  await expect(preview).toHaveAttribute("data-status", "success")
  await expect(preview).toContainText(/Identity check complete|신원 확인이 완료|本人確認が完了/)
  expect(forbidden).toEqual([])
})
