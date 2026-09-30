import { expect, test, type Page } from "@playwright/test"
import { CX_AGE19_POLICY, JIT_IDENTITY_CONSENT, JIT_IDENTITY_VERSION, type JitIdentityContext } from "../../lib/hackathon/jit-identity-contract"

// All identity responses are synthetic same-origin fixtures. No live proof.
const ID = "idn_age19fixture1234", AUTH = "ida_age19fixture1234"
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
async function fixture(page: Page, mode: "success" | "missing" | "lost" | "late" | "stale" = "success") {
  const writes: string[] = []
  let context: JitIdentityContext | null = null, status = "awaiting_identity", consumed = false, revoked = false
  const expiry = new Date(Date.now() + 120_000).toISOString()
  const result = () => ({ version: JIT_IDENTITY_VERSION, requestId: ID, status, context, expiresAt: expiry,
    handoff: status === "handoff" ? { kind: "qr", qrBase64: PNG, cxId: "fixture", expiresAt: expiry } : null,
    authorizationRef: status === "authorized" ? AUTH : null, authorizationExpiresAt: status === "authorized" ? expiry : null,
    reason: status === "denied" ? "age19_not_verified" : null })
  const receipt = () => ({ version: JIT_IDENTITY_VERSION, receiptId: "idr_age19fixture1234", context, authorizedAt: new Date().toISOString(), expiresAt: expiry, evidenceExpiresAt: expiry,
    provider: "omnione_cx", personVerified: true, adultVerified: false, age19Verified: true, age19Policy: CX_AGE19_POLICY, paymentKycVerified: false })
  await page.addInitScript(() => {
    localStorage.setItem("ondo-b.device.v1", JSON.stringify({ locale: "ja", onboarding: "ONB-COMPLETE", persona: null, discoveryPreferences: [], savedVenueIds: [], privateNotesByVenue: {}, recentVenueIds: [], plannedTableRefs: [], localSignalPostedVenueIds: [], localPulseEvidenceByVenue: {}, localInteractionBoundarySeen: true, commerceLocalBoundarySeen: true, commerceReceipts: [] }))
    const now = Date.now()
    sessionStorage.setItem("ondo-b.after19.session.v1", JSON.stringify({ version: 1, age: "eligible", ageExpiresAt: new Date(now + 86400000).toISOString(), mode: "on", activation: "manual", expiryNotice: false, eligibilityReceipt: { schema: "local-age-declaration.v1", predicate: "AGE_GTE_19", outcome: "eligible", issuerType: "LOCAL_DECLARATION", provenanceTruth: "SELF_DECLARED", issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 86400000).toISOString(), disclosure: "night_view_only" } }))
  })
  await page.route("**/*", route => {
    const req = route.request(), url = new URL(req.url())
    if (url.hostname !== "127.0.0.1" || (!url.pathname.startsWith("/api/hackathon/v1/") && req.method() !== "GET")) return route.abort()
    return route.continue()
  })
  await page.route("**/api/hackathon/v1/**", async route => {
    const req = route.request(), path = new URL(req.url()).pathname.split("/v1/")[1]
    const body = req.method() === "POST" ? req.postDataJSON() : null
    if (body) writes.push(path)
    const json = (v: unknown, code = 200) => route.fulfill({ status: code, contentType: "application/json", body: JSON.stringify(v) })
    if (path === "identity/eligibility") return json({ version: JIT_IDENTITY_VERSION, provider: "omnione_cx", execution: "provider", person: { state: "proof_required", expiresAt: null }, adult: { state: "proof_required", expiresAt: null }, age19: { state: "proof_required", expiresAt: null }, paymentKyc: { state: "unsupported" }, canStart: true, consentVersion: JIT_IDENTITY_CONSENT })
    if (path === "identity/requests") { const { consentVersion, ...ctx } = body; expect(consentVersion).toBe(JIT_IDENTITY_CONSENT); context = ctx; return json(result()) }
    if (path.endsWith("/start")) { status = "handoff"; return json(result()) }
    if (path.endsWith("/complete")) { if (mode === "late") await new Promise(r => setTimeout(r, 700)); status = mode === "missing" ? "denied" : "authorized"; return json(result()) }
    if (path.endsWith("/cancel")) { status = "cancelled"; return json(result()) }
    if (path.endsWith("/consume")) { consumed = true; if (mode === "lost") return route.abort("connectionreset"); return json(receipt()) }
    if (path.endsWith("/receipt")) return consumed && !revoked ? json(receipt()) : json({ error: { code: "jit_identity_proof" } }, 403)
    if (path === `identity/requests/${ID}`) return json(result())
    return json({ error: { code: "fixture_disabled" } }, 503)
  })
  return { writes, context: () => context, revoke: () => { revoked = true } }
}
async function open(page: Page) {
  await page.goto("/?city=seoul&review=0", { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("ondo-b-map-entry")).toHaveAttribute("data-after19-active", "false")
  await page.getByTestId("ondo-b-map-options-open").click()
  await page.getByTestId("ondo-b-map-options-after19-open").click()
  await page.getByTestId("global-after19-confirm").click()
  await expect(page.getByTestId("jit-identity-check")).toBeVisible()
}
async function start(page: Page) {
  await expect(page.getByTestId("jit-identity-create")).toBeDisabled()
  await page.getByTestId("jit-identity-consent").check()
  await page.getByTestId("jit-identity-create").click()
  await page.getByTestId("jit-identity-qr").click()
  await page.getByTestId("jit-identity-refresh").click()
}
test.describe.configure({ mode: "serial", timeout: 90_000 })
for (const mode of ["success", "lost"] as const) test(`After19 ${mode} consumes exact age19 receipt before opening; no persisted authority`, async ({ page }, info) => {
  const f = await fixture(page, mode); await open(page)
  await expect(page.getByTestId("jit-identity-check")).toContainText("生年月日の原文は保存せず")
  await page.screenshot({ path: info.outputPath("age19-consent-ja.png") })
  await start(page)
  await expect(page.getByTestId("ondo-b-map-entry")).toHaveAttribute("data-after19-active", "false")
  await page.getByTestId("jit-identity-return").click()
  await expect(page.getByTestId("global-after19-prompt-layer")).toHaveCount(0)
  await expect(page.getByTestId("ondo-b-map-entry")).toHaveAttribute("data-after19-active", "true")
  expect(f.context()).toMatchObject({ action: "after19_access", purpose: "age19", venueId: null, tableId: null })
  expect(f.writes.filter(p => p.endsWith("consume"))).toHaveLength(1)
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))
  expect(storage).not.toContain(AUTH); expect(storage).not.toContain("idr_age19")
  await page.getByTestId("ondo-b-map-search-toggle").click()
  await page.getByTestId("ondo-b-search").fill("Roba")
  await expect(page.getByTestId("ondo-b-search")).toBeFocused()
  await page.screenshot({ path: info.outputPath("age19-active-search.png") })
  f.revoke(); await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")))
  await expect(page.getByTestId("ondo-b-map-entry")).toHaveAttribute("data-after19-active", "false")
})
test("After19 missing age claim remains locked and cancellation never consumes", async ({ page }) => {
  const f = await fixture(page, "missing"); await open(page); await start(page)
  await expect(page.getByTestId("jit-identity-check")).toContainText("満19歳以上であることを確認できませんでした")
  await expect(page.getByTestId("jit-identity-return")).toHaveCount(0)
  await page.getByTestId("jit-identity-cancel").click()
  await expect(page.getByTestId("ondo-b-map-entry")).toHaveAttribute("data-after19-active", "false")
  expect(f.writes.some(p => p.endsWith("consume"))).toBe(false)
})
test("After19 cancel wins over a late provider completion", async ({ page }) => {
  const f = await fixture(page, "late"); await open(page); await start(page)
  await page.getByTestId("jit-identity-cancel").click()
  await page.waitForTimeout(900)
  await expect(page.getByTestId("ondo-b-map-entry")).toHaveAttribute("data-after19-active", "false")
  expect(f.writes.some(p => p.endsWith("consume"))).toBe(false)
})
