import { expect, test, type Page } from "@playwright/test"
import { CX_AGE19_POLICY, JIT_IDENTITY_CONSENT, JIT_IDENTITY_VERSION, type JitIdentityContext } from "../../lib/hackathon/jit-identity-contract"
import { HarveyFixture } from "./helpers/harvey-fixture"
import type { OperationResult } from "../../lib/hackathon/types"

// Synthetic same-origin API fixtures only. This is NOT evidence of a live CX run.
const VENUE = "mois-0021cd596bc5b2a922ad"
const REQUEST = "idn_abcdefghijklmnop", AUTH = "ida_abcdefghijklmnop"
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
type Mode = "normal" | "fresh" | "age19" | "denied" | "expired" | "wrong-context" | "access" | "lost-consume" | "late-complete"
async function fixture(page: Page, mode: Mode = "normal", fallThroughFixture = false) {
  await page.addInitScript(() => {
    localStorage.setItem("ondo-b.device.v1", JSON.stringify({ locale: "ja", onboarding: "ONB-COMPLETE", persona: null, discoveryPreferences: [], savedVenueIds: [], privateNotesByVenue: {}, recentVenueIds: [], plannedTableRefs: [], localSignalPostedVenueIds: [], localPulseEvidenceByVenue: {}, localInteractionBoundarySeen: true, commerceLocalBoundarySeen: true, commerceReceipts: [] }))
  })
  const writes: { path: string; body: Record<string, unknown> }[] = []
  let context: JitIdentityContext | null = null, status = "awaiting_identity", access = mode !== "access", consumed = false, completed = false
  const future = () => new Date(Date.now() + 120_000).toISOString()
  function result() { return { version: JIT_IDENTITY_VERSION, requestId: REQUEST, status, context: mode === "wrong-context" ? { ...context, contextDigest: `0x${"b".repeat(64)}` } : context, expiresAt: status === "expired" ? "2020-01-01T00:00:00.000Z" : future(), handoff: status === "handoff" ? { kind: "qr", qrBase64: PNG, cxId: "cx_fixture", expiresAt: future() } : null, authorizationRef: status === "authorized" ? AUTH : null, authorizationExpiresAt: status === "authorized" ? future() : null, reason: status === "denied" ? "identity_denied" : null } }
  function receipt() { return { version: JIT_IDENTITY_VERSION, receiptId: "idr_abcdefghijklmnop", context, authorizedAt: new Date().toISOString(), expiresAt: future(), evidenceExpiresAt: future(), provider: "omnione_cx", personVerified: true, adultVerified: false, ...(mode === "age19" ? { age19Verified: true, age19Policy: CX_AGE19_POLICY } : {}), paymentKycVerified: false } }
  await page.route("**/api/hackathon/v1/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname.split("/v1/")[1]
    const body = request.method() === "POST" ? request.postDataJSON() as Record<string, unknown> : {}
    if (request.method() === "POST") writes.push({ path, body })
    const json = (value: unknown, code = 200) => route.fulfill({ status: code, contentType: "application/json", body: JSON.stringify(value) })
    if (path === "hosted/access") { access = body.accessCode === "fixture-access-only"; return json({ ok: access }, access ? 200 : 401) }
    if (path.startsWith("identity/") && !access) return json({ error: { code: "hosted_sui_access_denied" } }, 401)
    if (path === "identity/eligibility") return json({ version: JIT_IDENTITY_VERSION, provider: "omnione_cx", execution: "provider", person: { state: mode === "fresh" || completed ? "verified" : "proof_required", expiresAt: mode === "fresh" || completed ? future() : null }, adult: { state: "proof_required", expiresAt: null }, age19: { state: "unsupported" }, paymentKyc: { state: "unsupported" }, canStart: true, consentVersion: JIT_IDENTITY_CONSENT })
    if (path === "identity/requests") { const { consentVersion: _consent, ...ctx } = body; context = ctx as JitIdentityContext; status = mode === "fresh" ? "authorized" : "awaiting_identity"; return json(result()) }
    if (path === `identity/requests/${REQUEST}/start`) { status = "handoff"; return json(result()) }
    if (path === `identity/requests/${REQUEST}/complete`) { if (mode === "late-complete") await new Promise(resolve => setTimeout(resolve, 800)); status = mode === "expired" ? "expired" : mode === "denied" ? "denied" : "authorized"; completed = status === "authorized"; return json(result()) }
    if (path === `identity/requests/${REQUEST}/cancel`) { status = "cancelled"; return json(result()) }
    if (path === `identity/requests/${REQUEST}`) return json(result())
    if (path === `identity/authorizations/${AUTH}/consume`) { consumed = true; if (mode === "lost-consume") return route.abort("connectionreset"); return json(receipt()) }
    if (path === `identity/requests/${REQUEST}/receipt`) return consumed ? json(receipt()) : json({ error: { code: "identity_receipt_missing" } }, 404)
    return fallThroughFixture ? route.fallback() : json({ error: { code: "fixture_route_not_enabled" } }, 503)
  })
  await page.route("https://tiles.openfreemap.org/**", route => route.abort("blockedbyclient"))
  return { writes, getContext: () => context }
}
async function openPass(page: Page, query = "") {
  await page.goto(`/${query}`, { waitUntil: "domcontentloaded" })
  await page.getByTestId("nav-id").click()
  await page.getByTestId("kpass-start-setup").click()
  await expect(page.getByTestId("jit-identity-check")).toBeVisible()
}
async function create(page: Page) { await page.getByTestId("jit-identity-consent").check(); await page.getByTestId("jit-identity-create").click() }
async function authorize(page: Page) { await create(page); await page.getByTestId("jit-identity-qr").click(); await expect(page.getByAltText("モバイル身分証の確認QR")).toBeVisible(); await page.getByTestId("jit-identity-refresh").click(); await expect(page.getByTestId("jit-identity-return")).toBeVisible() }
async function noAuthorityStorage(page: Page) {
  const value = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))
  expect(value).not.toContain(AUTH); expect(value).not.toContain(REQUEST); expect(value).not.toContain("idr_abcdefghijklmnop")
}
function reusedOperation(consentVersion: string, sourceCurrent = true): OperationResult {
  const now = new Date().toISOString(), expiresAt = new Date(Date.now() + 120_000).toISOString()
  return {
    operationId: "browser-fixture-reused-identity", kind: "demo_entitlement", venueId: VENUE,
    campaignId: "browser-fixture-perk", policyVersion: 1, status: "pending", phase: "issuance",
    revision: 1, createdAt: now, updatedAt: now, expiresAt, execution: "provider",
    safeNextAction: "wait", allowedActions: ["issue", "cancel", "reconcile"],
    returnContext: { venueId: VENUE, focus: "offer" },
    consent: { version: consentVersion, digest: `0x${"a".repeat(64)}`, acceptedAt: now },
    identity: { evidenceId: "synthetic-ui-proof-only", subjectRef: "synthetic-person", source: "cx_mobile_id",
      mode: "cx", provider: "BROWSER FIXTURE ONLY", personVerified: true, adultVerified: false,
      verifiedAt: now, expiresAt, providerTransactionRef: "SYNTHETIC", handoff: null, sourceCurrent },
    credential: null, presentation: null, proposal: null, delegation: null, agent: null,
    fulfillment: null, chain: null, error: null,
  }
}
test.describe.configure({ mode: "serial", timeout: 75_000 })

test("JIT-01 ordinary main Pass uses real-provider UI, explicit consent and scoped receipt", async ({ page }, info) => {
  const api = await fixture(page)
  await openPass(page)
  expect(api.writes).toHaveLength(0)
  await expect(page.getByTestId("jit-identity-create")).toBeDisabled()
  await expect(page.getByText("日本を含む海外パスポートの確認は別サービスです。", { exact: false })).toBeVisible()
  await expect.poll(() => page.getByTestId("jit-identity-check").evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
  await page.screenshot({ path: info.outputPath("pass-provider-consent.png") })
  await authorize(page)
  expect(api.writes.some(write => write.path.includes("consume"))).toBe(false)
  await page.getByTestId("jit-identity-return").click()
  await expect(page.getByTestId("jit-identity-check")).toBeHidden()
  await expect(page.getByTestId("kpass-actual-person-status")).toContainText("本人確認済み")
  expect(api.writes.filter(write => write.path.includes("consume"))).toHaveLength(1)
  expect(api.getContext()?.action).toBe("pass_setup")
  await noAuthorityStorage(page)
  await page.screenshot({ path: info.outputPath("pass-provider-result.png") })
})
test("JIT-02 current CX proof still requires action consent but no second handoff", async ({ page }) => {
  const api = await fixture(page, "fresh"); await openPass(page, "?review=0"); await create(page)
  await expect(page.getByTestId("jit-identity-return")).toBeVisible()
  expect(api.writes.some(write => write.path.endsWith("/start"))).toBe(false)
  await page.getByTestId("jit-identity-cancel").click()
  await expect(page.getByTestId("jit-identity-check")).toBeHidden()
  expect(api.writes.some(write => write.path.includes("consume"))).toBe(false)
})
test("JIT-03 access recovery follows returned profile only and preserves same action", async ({ page }) => {
  const api = await fixture(page, "access"); await openPass(page, "?review=0")
  await page.getByLabel("アクセスコード", { exact: true }).fill("fixture-access-only")
  await page.getByRole("button", { name: "アクセスを確認", exact: true }).click()
  await create(page); expect(api.getContext()?.action).toBe("pass_setup")
  expect(api.writes.filter(write => write.path.endsWith("/access")).map(write => write.path)).toEqual(["hosted/access"])
  await noAuthorityStorage(page)
})
for (const mode of ["denied", "expired", "wrong-context"] as const) test(`JIT-04 ${mode} cannot authorize or consume`, async ({ page }) => {
  const api = await fixture(page, mode); await openPass(page, "?review=0"); await create(page)
  if (mode !== "wrong-context") { await page.getByTestId("jit-identity-qr").click(); await page.getByTestId("jit-identity-refresh").click() }
  await expect(page.getByTestId("jit-identity-return")).toHaveCount(0)
  expect(api.writes.some(write => write.path.includes("consume"))).toBe(false)
  await noAuthorityStorage(page)
})
test("JIT-05 lost consume response is reconciled without repeating the write", async ({ page }) => {
  const api = await fixture(page, "lost-consume"); await openPass(page, "?review=0"); await authorize(page); await page.getByTestId("jit-identity-return").click()
  await expect(page.getByTestId("jit-identity-check")).toBeHidden()
  expect(api.writes.filter(write => write.path.includes("consume"))).toHaveLength(1)
})
test("JIT-06 close during provider result prevents late completion and cancels known request", async ({ page }) => {
  const api = await fixture(page, "late-complete"); await openPass(page, "?review=0"); await create(page); await page.getByTestId("jit-identity-qr").click()
  await page.getByTestId("jit-identity-refresh").click(); await page.getByTestId("jit-identity-cancel").click()
  await page.waitForTimeout(1100)
  await expect(page.getByTestId("jit-identity-check")).toBeHidden()
  expect(api.writes.some(write => write.path.endsWith("/cancel"))).toBe(true)
  expect(api.writes.some(write => write.path.includes("consume"))).toBe(false)
})
test("JIT-07 Local moment returns exact private draft, consumes only on Save and never sends the note", async ({ page }, info) => {
  const api = await fixture(page, "fresh")
  await page.goto(`/?review=0&city=seoul&venueId=${VENUE}`, { waitUntil: "domcontentloaded" })
  await page.getByTestId("canonical-place-details").click()
  await page.getByTestId("canonical-local-signal-open").click()
  await page.getByTestId("local-signal-tag-calm_now").click()
  await page.getByTestId("local-signal-note").fill("Private note: keep exactly this draft")
  await page.getByTestId("local-signal-person-check").click()
  const account = page.getByTestId("action-gate-confirm")
  if (await account.isVisible().catch(() => false)) await account.click()
  await expect(page.getByTestId("jit-identity-check")).toBeVisible()
  await create(page); await page.getByTestId("jit-identity-return").click()
  await expect(page.getByTestId("jit-identity-check")).toBeHidden()
  expect(api.writes.some(write => write.path.includes("consume"))).toBe(false)
  await expect(page.getByTestId("local-signal-note")).toHaveValue("Private note: keep exactly this draft")
  await page.getByTestId("local-signal-post").click()
  await expect.poll(() => api.writes.filter(write => write.path.includes("consume")).length).toBe(1)
  await expect.poll(() => page.evaluate(id => JSON.parse(localStorage.getItem("ondo-b.device.v1") ?? "{}").localSignalPostedVenueIds?.includes(id), VENUE)).toBe(true)
  expect(api.getContext()?.action).toBe("local_moment")
  expect(JSON.stringify(api.writes)).not.toContain("Private note")
  await noAuthorityStorage(page)
  await page.screenshot({ path: info.outputPath("local-moment-confirmed.png") })
})

test("JIT-08 19+ Table requests exact age purpose and missing age result stays closed", async ({ page }) => {
  const api = await fixture(page, "denied")
  await page.goto("/?review=0", { waitUntil: "domcontentloaded" })
  await page.getByTestId("nav-tables").click()
  await page.getByTestId("table-open-table-seoul-night-bites").click()
  await page.getByTestId("table-join").click()
  const account = page.getByTestId("action-gate-confirm")
  if (await account.isVisible().catch(() => false)) await account.click()
  await expect(page.getByTestId("jit-identity-check")).toBeVisible()
  expect(api.writes.filter(write => write.path.startsWith("identity/"))).toHaveLength(0)
  await create(page); await page.getByTestId("jit-identity-qr").click(); await page.getByTestId("jit-identity-refresh").click()
  expect(api.getContext()).toMatchObject({ action: "table_request", purpose: "age19", tableId: "table-seoul-night-bites" })
  await expect(page.getByTestId("jit-identity-return")).toHaveCount(0)
  expect(api.writes.some(write => write.path.includes("consume"))).toBe(false)
})
test("JIT-12 19+ Table uses exact age receipt at final local request boundary", async ({ page }) => {
  const api = await fixture(page, "age19")
  await page.goto("/?review=0", { waitUntil: "domcontentloaded" })
  await page.getByTestId("nav-tables").click(); await page.getByTestId("table-open-table-seoul-night-bites").click(); await page.getByTestId("table-join").click()
  const account = page.getByTestId("action-gate-confirm")
  if (await account.isVisible().catch(() => false)) await account.click()
  await authorize(page); await page.getByTestId("jit-identity-return").click()
  await expect(page.getByTestId("jit-identity-check")).toBeHidden()
  expect(api.writes.some(write => write.path.includes("consume"))).toBe(false)
  await page.getByTestId("table-join-confirm").click()
  await expect.poll(() => api.writes.filter(write => write.path.includes("consume")).length).toBe(1)
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("ondo-b.device.v1") ?? "{}").plannedTableRefs?.some((entry: { tableId: string }) => entry.tableId === "table-seoul-night-bites"))).toBe(true)
  await noAuthorityStorage(page)
})

for (const mode of ["fresh", "normal"] as const) test(`JIT-09 Roba ${mode} identity preserves perk consent and never auto-executes`, async ({ page, baseURL }) => {
  const harvey = new HarveyFixture(page, new URL(baseURL!).origin)
  harvey.config.isolatedMock = false; harvey.config.modes.cx = "cx"
  await harvey.install()
  const api = await fixture(page, mode, true)
  const operationBodies: Record<string, unknown>[] = []
  if (mode === "fresh") await page.route("**/api/hackathon/v1/operations", async route => {
    const body = route.request().postDataJSON() as Record<string, unknown>; operationBodies.push(body)
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(reusedOperation(harvey.config.consentVersion)) })
  })
  await harvey.open()
  await expect(page.getByTestId("hackathon-start")).toBeDisabled()
  await page.locator("#hk-consent").check(); await page.getByTestId("hackathon-start").click()
  if (mode === "fresh") {
    await expect(page.getByTestId("jit-identity-check")).toBeVisible()
    expect(operationBodies).toHaveLength(0)
    await create(page)
    expect(api.writes.some(write => write.path.endsWith("/start"))).toBe(false)
    await page.getByTestId("jit-identity-return").click()
    await expect(page.getByTestId("hackathon-layer")).toHaveAttribute("data-phase", "issuance")
    expect(operationBodies).toHaveLength(1)
    expect(operationBodies[0]).toMatchObject({ identityAuthorizationRef: AUTH, identityContextDigest: api.getContext()?.contextDigest })
    expect(api.getContext()?.action).toBe("designated_perk")
    expect(api.writes.filter(write => write.path.includes("consume"))).toHaveLength(1)
  } else {
    await expect(page.getByTestId("hackathon-layer")).toHaveAttribute("data-phase", "identity")
    expect(harvey.count("/operations")).toBe(1)
    expect(api.writes.some(write => write.path === "identity/requests")).toBe(false)
    expect(harvey.actionCount("identity/start")).toBe(0)
  }
  expect(api.writes.some(write => /delegation|agent\/run|redeem/.test(write.path))).toBe(false)
  expect(harvey.forbiddenRequests).toHaveLength(0)
})

test("JIT-13 Roba identity consent cancel retains Escape ownership and returns to usable map search", async ({ page, baseURL }, info) => {
  test.setTimeout(120_000)
  const harvey = new HarveyFixture(page, new URL(baseURL!).origin)
  harvey.config.isolatedMock = false; harvey.config.modes.cx = "cx"
  await harvey.install()
  // A synthetic current result selects this same nested consent surface even
  // in legacy builds. No provider request, consent grant or operation is made.
  const api = await fixture(page, "fresh", true)
  await page.goto(`/?venueId=${VENUE}&review=0`, { waitUntil: "domcontentloaded" })
  // Bound cold development hydration separately; the behavior assertions below
  // retain the normal short timeout and never force focus or pointer events.
  await expect(page.getByTestId("ondo-b-root")).toHaveAttribute("data-hydrated", "true", { timeout: 45_000 })
  if (!await page.getByTestId("canonical-place-overlay").isVisible()) await page.getByTestId("canonical-place-details").click()
  await page.getByTestId("hackathon-entitlement-open").click()
  await expect(page.getByTestId("hackathon-layer")).toBeVisible()
  await page.locator("#hk-consent").check()
  await page.getByTestId("hackathon-start").click()
  await expect(page.getByTestId("jit-identity-check")).toBeVisible()
  await expect(page.getByTestId("jit-identity-consent")).not.toBeChecked()
  await expect(page.getByTestId("jit-identity-create")).toBeDisabled()
  await page.getByTestId("jit-identity-cancel").click()
  await expect(page.getByTestId("jit-identity-check")).toBeHidden()
  await expect(page.getByTestId("hackathon-close")).toBeFocused()
  await expect(page.locator("#hk-consent")).not.toBeChecked()
  await expect(page.getByTestId("hackathon-start")).toBeDisabled()
  await page.screenshot({ path: info.outputPath("roba-cancel-focused-close.png") })
  // Do not click another control or force focus: Escape must work immediately
  // after the real nested Cancel, with exactly the same place restored.
  await page.keyboard.press("Escape")
  await expect(page.getByTestId("hackathon-layer")).toBeHidden()
  const place = page.getByTestId("canonical-place-overlay")
  await expect(place).toHaveAttribute("data-venue-id", VENUE)
  await expect(page.getByTestId("hackathon-entitlement-open")).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(place).toBeHidden()
  await expect(page.getByTestId("nav-ondo")).toHaveAttribute("aria-current", "page")
  await page.getByTestId("ondo-b-map-search-toggle").click()
  const search = page.getByTestId("ondo-b-search")
  await search.fill("Roba")
  await expect(search).toBeFocused()
  await expect(search).toHaveValue("Roba")
  expect(api.writes.filter(write => write.path.startsWith("identity/") || write.path.startsWith("operations"))).toHaveLength(0)
  expect(harvey.count("/operations")).toBe(0)
  expect(harvey.forbiddenRequests).toHaveLength(0)
  expect(harvey.pageErrors).toHaveLength(0)
  await noAuthorityStorage(page)
  await page.screenshot({ path: info.outputPath("roba-cancel-search.png") })
})

test("JIT-10 Roba lost create response restores the same campaign operation with GET only", async ({ page, baseURL }) => {
  const harvey = new HarveyFixture(page, new URL(baseURL!).origin)
  harvey.config.isolatedMock = false; harvey.config.modes.cx = "cx"
  await harvey.install()
  const api = await fixture(page, "fresh", true)
  const operationBodies: Record<string, unknown>[] = []
  let entitlementReadsBeforeCreate = 0
  await page.route("**/api/hackathon/v1/operations", async route => {
    operationBodies.push(route.request().postDataJSON() as Record<string, unknown>)
    entitlementReadsBeforeCreate = harvey.count(`/places/${VENUE}/demo-entitlements`)
    // Synthetic server commit followed by a lost response; GET reconciles this exact record.
    harvey.operation = reusedOperation(harvey.config.consentVersion)
    await route.abort("connectionreset")
  })
  await harvey.open()
  await page.locator("#hk-consent").check(); await page.getByTestId("hackathon-start").click()
  await create(page); await page.getByTestId("jit-identity-return").click()
  await expect(page.getByTestId("hackathon-layer")).toHaveAttribute("data-phase", "issuance")
  await expect(page.getByTestId("hackathon-issue")).toBeVisible()
  expect(operationBodies).toHaveLength(1)
  expect(operationBodies[0]).toMatchObject({ identityAuthorizationRef: AUTH, identityContextDigest: api.getContext()?.contextDigest })
  // Place details may load the same read model before the journey's bootstrap.
  // Exactly one further GET must recover this write, independently of those reads.
  expect(harvey.count(`/places/${VENUE}/demo-entitlements`)).toBe(entitlementReadsBeforeCreate + 1)
  expect(api.writes.filter(write => write.path.includes("consume"))).toHaveLength(1)
  expect(api.writes.some(write => /\/operations\/[^/]+\//.test(`/${write.path}`))).toBe(false)
  expect(harvey.forbiddenRequests).toHaveLength(0)
})

test("JIT-11 Roba stale source removes executable CTAs but retains check stop and return", async ({ page, baseURL }, info) => {
  const harvey = new HarveyFixture(page, new URL(baseURL!).origin)
  harvey.config.isolatedMock = false; harvey.config.modes.cx = "cx"
  await harvey.install()
  const api = await fixture(page, "fresh", true)
  let creates = 0
  await page.route("**/api/hackathon/v1/operations", async route => {
    creates++
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(reusedOperation(harvey.config.consentVersion, false)) })
  })
  await harvey.open()
  await page.locator("#hk-consent").check(); await page.getByTestId("hackathon-start").click()
  await create(page); await page.getByTestId("jit-identity-return").click()
  await expect(page.getByTestId("hackathon-identity-source-invalid")).toBeVisible()
  await expect(page.getByTestId("hackathon-identity-source-invalid")).toContainText("送信済みの実行が取り消されるわけではありません")
  for (const id of ["hackathon-issue", "hackathon-present", "hackathon-propose", "hackathon-delegate", "hackathon-agent-run", "hackathon-redeem"]) {
    await expect(page.getByTestId(id)).toHaveCount(0)
  }
  await expect(page.getByTestId("hackathon-reconcile")).toBeVisible()
  await expect(page.getByTestId("hackathon-cancel")).toBeVisible()
  await expect(page.getByTestId("hackathon-return")).toBeVisible()
  expect(creates).toBe(1)
  expect(api.writes.some(write => /\/operations\/[^/]+\//.test(`/${write.path}`))).toBe(false)
  expect(harvey.forbiddenRequests).toHaveLength(0)
  await page.screenshot({ path: info.outputPath("roba-source-invalid.png") })
  await page.getByTestId("hackathon-return").click()
  await expect(page.getByTestId("hackathon-layer")).toBeHidden()
})
