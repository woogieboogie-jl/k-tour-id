import { expect, test, type Page } from "@playwright/test"
import { GUIDE_SAVE_V2, guideJourney, type GuideCollection, type GuideReadiness } from "../../lib/hackathon/guide-contract"
import type { OperationResult } from "../../lib/hackathon/types"

// Browser fixtures only: no CX/OpenDID provider, Google signer or chain is called.
// These assertions prove routing and UI authority boundaries, not real execution.
const V = GUIDE_SAVE_V2
const OP = "op_browser_guide_fixture_20260929"
const now = new Date().toISOString()
// Close while our deny-by-default routes still own the context; pending local
// GET proxy work must not become an unhandled teardown error or escape routing.
test.afterEach(async ({ context }) => { await context.close() })
function operation(patch: Partial<OperationResult> = {}): OperationResult {
  return { journey: guideJourney(), operationId: OP, kind: "demo_entitlement", venueId: V.venueId, campaignId: V.campaignId, policyVersion: 1,
    status: "pending", phase: "identity", revision: 1, createdAt: now, updatedAt: now, expiresAt: "2026-09-30T14:59:59.000Z", execution: "provider", safeNextAction: "wait", allowedActions: ["open_handoff", "cancel"], returnContext: { venueId: V.venueId, focus: "offer" },
    consent: { version: V.consentVersion, digest: "fixture-consent", acceptedAt: now }, identity: null, credential: null, presentation: null, proposal: null, delegation: null, agent: null, fulfillment: null, chain: null, error: null, ...patch }
}

class GuideFixture {
  calls: Array<{ path: string; method: string; body: Record<string, unknown> }> = []
  unexpected: string[] = []
  errors: string[] = []
  ready = false
  missingResume = false
  providerFailure = false
  denial = false
  qrPayload = "fixture://not-a-provider/no-identity-data"
  wrongProviderMode = false
  nativeV1 = false
  nativeMock = false
  hostedSui = false
  nativeBindingConfigured = false
  nativeBound = false
  localFresh = false
  bindingVerified = false
  bindingId = "nhb_" + "a".repeat(24)
  accessProfile: "guide-production" | "integration-preview" | "unavailable" | undefined = "guide-production"
  configProfile: string | undefined = "guide-production"
  configGuide = true
  codeRequired = false
  authorized = false
  denyCode = false
  dropAccessCookie = false
  expireProviderAccess = false
  expiredCampaign = false
  accessResponseDelay = 0
  operationResponseDelay = 0
  op: OperationResult | null = null
  collection: GuideCollection = { items: [], pendingOperation: null }
  constructor(readonly page: Page, readonly origin: string, readonly assetOrigin = origin) {}
  async install() {
    this.page.on("pageerror", error => this.errors.push(error.message))
    await this.page.addInitScript(() => {
      localStorage.setItem("ondo-b.device.v1", JSON.stringify({ locale: "ja", appearancePreference: "dark", onboarding: "ONB-COMPLETE" }))
      sessionStorage.setItem("ondo.review.flow.v1", "0")
    })
    await this.page.context().route("**/*", async route => {
      const req = route.request(), url = new URL(req.url())
      if (url.origin !== this.origin) { await route.abort("blockedbyclient"); return }
      if (!url.pathname.startsWith("/api/hackathon/v1/")) {
        if (req.method() === "GET") {
          if (this.assetOrigin !== this.origin) {
            try { await route.fulfill({ response: await route.fetch({ url: this.assetOrigin + url.pathname + url.search, maxRedirects: 0 }) }) }
            catch (error) { if (!this.page.isClosed()) throw error }
          }
          else await route.continue()
        } else { this.unexpected.push(url.pathname); await route.abort() }
        return
      }
      const path = url.pathname.slice("/api/hackathon/v1".length)
      const body = req.postData() ? req.postDataJSON() : {}
      this.calls.push({ path, method: req.method(), body })
      const send = (data: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data), headers: { "cache-control": "no-store", "x-fixture-only": "no-provider-evidence" } })
      if (path === "/guide/readiness") {
        const checks: GuideReadiness["checks"] = (["identity", "credential", "execution", "audit", "login", "ai", "campaign"] as const).map(id => ({ id, status: id === "campaign" && this.expiredCampaign ? "expired" : this.ready ? "configured" : "setup_required" }))
        const ready = this.ready && !this.expiredCampaign
        await send({ ...V, supported: true, ready, verification: "configuration_only", accessProfile: ready ? this.accessProfile : "unavailable", checks, blockers: checks.filter(check => check.status !== "configured").map(check => check.id), identityCheckAvailable: false }); return
      }
      if (path === "/guide/collection") { await send(this.collection); return }
      if (path === "/config") {
        if (this.codeRequired && !this.authorized) { await send({ error: { code: "guide_production_access_denied" } }, 401); return }
        await send({ isolatedMock: false, ...(this.hostedSui ? { hostedSui: true, capabilities: { nativeBindingConfigured: this.nativeBindingConfigured, opendidProviderReady: false } } : {}), guideProfile: this.configProfile, ...(this.configGuide ? { guide: { ...V } } : {}), campaign: { ...V, purpose: V.action, ...(this.configProfile === "integration-preview" ? { campaignId: "legacy-v1-preview-campaign" } : {}), title: { ko: "가이드 담기", en: "Save guide", ja: "ガイドを保存" }, description: { ko: "", en: "", ja: "" } }, consentVersion: V.consentVersion,
          modes: { cx: "cx", opendid: this.nativeMock ? "mock" : "opendid", ai: "gemini", sui: "testnet", omnione: "stage", zklogin: "google" }, sui: { network: "testnet", packageId: "", campaignId: "", explorer: "", googleClientId: "fixture-client" }, omnione: { chainId: 0, registryAddress: "" } }); return
      }
      if (path === "/guide/access" || path === "/integration/access") {
        if (this.accessResponseDelay) await new Promise(resolve => setTimeout(resolve, this.accessResponseDelay))
        if (this.denyCode) { await send({ error: { code: "guide_production_access_denied" } }, 401); return }
        if (!this.dropAccessCookie) this.authorized = true
        await send({ ok: true }); return
      }
      if (path === "/sessions") { await send({ ok: true, sessionId: "fixture-only" }); return }
      if (path === `/places/${V.venueId}/demo-entitlements`) { await send({ supported: true, campaign: { ...V, title: { ko: "체험", en: "Perk", ja: "特典" } }, operation: this.nativeV1 ? this.op : null, redeemed: null }); return }
      if (path === "/identity/eligibility") { await send({ error: { code: "fixture_unavailable" } }, 503); return }
      if (path === "/guide/operations" && req.method() === "POST") { this.op = operation(); await send(this.op); return }
      if (path === "/operations" && req.method() === "POST" && this.localFresh) { this.op = operation({ journey: undefined, campaignId: "ktour-local-native-3183-v1", phase: "identity", identity: null }); await send(this.op); return }
      if (path === `/operations/${OP}/identity/start` && this.localFresh) {
        const expiresAt = new Date(Date.now() + 300_000).toISOString()
        this.op = { ...this.op!, revision: this.op!.revision + 1, identity: { evidenceId: "", subjectRef: "", source: "cx_mobile_id", mode: "cx", provider: "BROWSER FIXTURE ONLY", personVerified: false, adultVerified: null, verifiedAt: "", expiresAt, providerTransactionRef: "SYNTHETIC", handoff: { kind: "qr", qrBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=", cxId: "fixture-only", expiresAt } } }
        await send(this.op); return
      }
      if (path === `/operations/${OP}/identity/complete` && this.localFresh) {
        this.op = { ...this.op!, revision: this.op!.revision + 1, phase: "issuance", identity: { ...this.op!.identity!, evidenceId: "fixture-not-real-evidence", subjectRef: "fixture-not-real-person", personVerified: true, verifiedAt: now, handoff: null } }
        await send(this.op); return
      }
      if (path === `/operations/${OP}`) { if (this.operationResponseDelay) await new Promise(resolve => setTimeout(resolve, this.operationResponseDelay)); await send(this.missingResume ? { error: { code: "not_found" } } : this.op, this.missingResume ? 404 : 200); return }
      if (path === `/operations/${OP}/reconcile`) { await send(this.op); return }
      if (path.includes(`/operations/${OP}/native-binding/`)) {
        const base = { version: "cx-holder-v1", bindingId: this.bindingId, status: this.bindingVerified ? "verified" : "challenge", expiresAt: new Date(Date.now() + 300000).toISOString() }
        if (path.endsWith("/start")) await send({ ...base, operationId: OP, token: "b".repeat(43), authNonce: "c".repeat(64) })
        else if (path.endsWith("/cancel")) await send({ ...base, status: "cancelled" })
        else await send(base)
        return
      }
      if (path === `/operations/${OP}/redeem`) {
        this.op = operation({ phase: "done", status: "succeeded", allowedActions: ["return", "reconcile"], fulfillment: { status: "redeemed", redemptionRef: "fixture-guide-save", redeemedAt: now, reason: null, recheck: null }, chain: { outboxId: "fixture-outbox", eventKey: "fixture-event", payloadCommitment: "fixture", status: "pending", txHash: null, blockNumber: null, attempts: 0, lastError: null, confirmedAt: null } })
        this.collection = { pendingOperation: null, items: [{ guideId: V.guideId, venueId: V.venueId, campaignId: V.campaignId, operationId: OP, savedAt: now, chain: { status: "pending", txHash: null, confirmedAt: null } }] }
        await send(this.op); return
      }
      if (path.includes(`/operations/${OP}/provider/`)) {
        if (this.expireProviderAccess) { this.expireProviderAccess = false; this.codeRequired = true; this.authorized = false; await send({ error: { code: "guide_production_access_denied" } }, 401); return }
        if (this.providerFailure) { await send({ error: { code: "provider_timeout" } }, 503); return }
        if (path.endsWith("/cancel")) { this.op = { ...this.op!, phase: "cancelled", status: "cancelled", allowedActions: ["return"] }; await send({ operation: this.op, provider: { phase: "cancelled", offer: null } }); return }
        if (path.endsWith("issuance/refresh")) { this.op = { ...this.op!, phase: "presentation", allowedActions: ["present", "cancel"] }; await send({ operation: this.op, provider: { phase: "presentation", offer: null } }); return }
        if (path.endsWith("presentation/refresh") && this.denial) { this.op = operation({ phase: "failed", status: "failed", allowedActions: ["return"] }); await send({ operation: this.op, provider: { phase: "denied", offer: null } }); return }
        await send({ operation: this.wrongProviderMode ? { ...this.op, execution: "sample" } : this.op, provider: { phase: this.op?.phase, offer: { qrPayload: this.qrPayload }, ...(this.nativeBound && this.bindingVerified ? { nativeBindingId: this.bindingId } : {}) } }); return
      }
      this.unexpected.push(path); await send({ error: { code: "unexpected_fixture_call" } }, 409)
    })
  }
  async place() {
    await this.page.goto(`${this.origin}/?venueId=${V.venueId}&review=0`, { waitUntil: "domcontentloaded" })
    await expect(this.page.getByTestId("ondo-b-root")).toHaveAttribute("data-hydrated", "true")
    await this.page.addStyleTag({ content: "nextjs-portal { display: none !important; }" })
    if (!await this.page.getByTestId("canonical-place-overlay").isVisible()) await this.page.getByTestId("canonical-place-details").click()
    if (this.nativeV1) { await this.page.getByTestId("hackathon-entitlement-open").click(); return }
    await this.page.getByTestId("experience-open").click()
    await expect(this.page.getByTestId("experience-public-guide")).toBeVisible()
  }
  async save() { await this.page.getByTestId("experience-add-to-pass").click() }
  async pending(phase: OperationResult["phase"], extra: Partial<OperationResult> = {}) {
    this.ready = true; this.op = operation({ phase, ...extra }); this.collection.pendingOperation = this.op
    if (this.nativeV1) this.op = { ...this.op, journey: undefined, identity: { evidenceId: "native-ui-fixture", subjectRef: "synthetic-person", source: "cx_mobile_id", mode: "cx", provider: "BROWSER FIXTURE ONLY", personVerified: true, adultVerified: false, verifiedAt: now, expiresAt: this.op.expiresAt, providerTransactionRef: "SYNTHETIC", handoff: null } }
    await this.place(); if (!this.nativeV1) await this.save(); await expect(this.page.getByTestId("hackathon-layer")).toHaveAttribute("data-phase", phase)
  }
  assertSafe() { expect(this.unexpected).toEqual([]); expect(this.errors).toEqual([]); expect(this.calls.some(call => /credential\/issue|holder-ack|presentation\/submit|^\/operations$/.test(call.path))).toBe(false) }
}

test("GUIDE-01 free read and unavailable save never create a sample or legacy operation", async ({ page, baseURL }, info) => {
  const f = new GuideFixture(page, baseURL!); await f.install(); await f.place()
  expect(f.calls.filter(call => call.method === "POST")).toEqual([])
  await expect(page.getByTestId("experience-guide-content").getByRole("heading", { level: 3 })).toHaveCount(3)
  await f.save(); await expect(page.getByTestId("guide-save-readiness")).toContainText("現在、パスには保存できません")
  await expect(page.getByTestId("experience-flow")).toHaveCount(0)
  expect(f.calls.filter(call => call.method === "POST")).toEqual([])
  await page.screenshot({ path: info.outputPath("guide-unavailable-ja.png") })
  await page.getByTestId("guide-keep-reading").click(); await expect(page.getByTestId("experience-public-guide")).toBeVisible()
  f.assertSafe()
})

test("GUIDE-02 consent creates exact v2 only; no mock approval or sample signer", async ({ page, baseURL }, info) => {
  const f = new GuideFixture(page, baseURL!); f.ready = true; await f.install(); await f.place(); await f.save()
  await expect(page.getByTestId("hackathon-start")).toBeDisabled()
  await expect(page.getByTestId("hackathon-layer")).toContainText("読むだけなら確認は不要")
  await page.locator("#hk-consent").check(); await page.getByTestId("hackathon-start").click()
  await expect(page.getByTestId("hackathon-layer")).toHaveAttribute("data-phase", "identity")
  expect(f.calls.filter(call => call.path === "/guide/operations")).toEqual([{ method: "POST", path: "/guide/operations", body: { venueId: V.venueId, consentVersion: V.consentVersion, locale: "ja" } }])
  await expect(page.getByTestId("hackathon-isolated-notice")).toHaveCount(0)
  await expect(page.getByTestId("hackathon-signer-demo")).toHaveCount(0)
  await page.screenshot({ path: info.outputPath("guide-identity-ja.png") })
  await page.getByTestId("hackathon-close").click()
  await expect(page.getByTestId("canonical-place-overlay")).toHaveAttribute("data-venue-id", V.venueId)
  f.assertSafe()
})

test("GUIDE-03 QR stays ephemeral; issuance and presentation use real-provider contracts and denial saves nothing", async ({ page, baseURL }) => {
  const f = new GuideFixture(page, baseURL!); f.denial = true; await f.install(); await f.pending("issuance")
  await page.getByTestId("guide-provider-start").click(); await expect(page.getByTestId("guide-provider-step").locator("img")).toBeVisible()
  const stored = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))
  expect(stored).not.toContain("fixture://")
  await page.getByTestId("guide-provider-refresh").click(); await expect(page.getByTestId("hackathon-layer")).toHaveAttribute("data-phase", "presentation")
  await page.getByTestId("guide-provider-start").click(); await page.getByTestId("guide-provider-refresh").click()
  await expect(page.getByTestId("hackathon-layer")).toHaveAttribute("data-status", "failed")
  expect(f.collection.items).toEqual([]); expect(f.calls.some(call => call.path.endsWith("/redeem"))).toBe(false)
  f.assertSafe()
})

test("GUIDE-04 provider timeout offers check same request, not another start; cancellation is explicit", async ({ page, baseURL }) => {
  const f = new GuideFixture(page, baseURL!); await f.install(); await f.pending("issuance")
  f.providerFailure = true; await page.getByTestId("guide-provider-start").click()
  await expect(page.getByTestId("guide-provider-step").getByRole("alert")).toBeVisible()
  await expect(page.getByTestId("guide-provider-start")).toHaveCount(0)
  f.providerFailure = false; await page.getByTestId("guide-provider-cancel").click()
  await expect(page.getByTestId("hackathon-layer")).toHaveAttribute("data-status", "cancelled")
  expect(f.calls.filter(call => call.path.endsWith("issuance/start"))).toHaveLength(1)
  f.assertSafe()
})

test("GUIDE-05 final save reaches server-backed Pass collection and survives reload with pending audit distinct", async ({ page, baseURL }, info) => {
  const f = new GuideFixture(page, baseURL!); await f.install(); await f.pending("fulfillment", { allowedActions: ["redeem", "reconcile"], fulfillment: { status: "pending", reason: null, redemptionRef: null, redeemedAt: null, recheck: null } })
  await page.getByTestId("hackathon-redeem").click(); await expect(page.getByTestId("hackathon-layer")).toHaveAttribute("data-phase", "done")
  await expect(page.getByTestId("hackathon-layer")).toContainText("パスに保存しました")
  await expect(page.getByTestId("hackathon-layer")).toHaveAttribute("data-chain-status", "pending")
  await page.getByTestId("hackathon-return").click()
  await page.goto("/?review=0&tab=id", { waitUntil: "domcontentloaded" }); await page.getByTestId("nav-id").click()
  await expect(page.getByTestId("server-guide-collection")).toContainText("保存済み・記録を確認中")
  await expect(page.getByTestId("experience-saved-guides")).toHaveCount(0)
  await page.getByTestId("server-guide-collection").scrollIntoViewIfNeeded()
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" })
  await page.screenshot({ path: info.outputPath("guide-pass-ja.png") })
  await page.reload({ waitUntil: "domcontentloaded" }); await page.getByTestId("nav-id").click()
  await expect(page.getByTestId("server-guide-collection")).toContainText("保存済み・記録を確認中")
  await page.getByTestId("server-guide-open").click(); await expect(page.getByTestId("experience-public-guide")).toBeVisible()
  expect(f.calls.filter(call => call.path.endsWith("/redeem"))).toHaveLength(1)
  f.assertSafe()
})

test("GUIDE-07 uncertain execution checks same operation without execute or save", async ({ page, baseURL }) => {
  const f = new GuideFixture(page, baseURL!); await f.install(); await f.pending("agent", { safeNextAction: "check_status", allowedActions: ["reconcile"], agent: { dispatchId: "fixture-dispatch", status: "unknown", decisionCommitment: "fixture", manifestCommitment: "fixture", manifest: null, txDigest: null, recordId: null, verified: null, error: null } })
  await expect(page.getByTestId("hackathon-agent-run")).toHaveCount(0)
  await expect(page.getByTestId("hackathon-redeem")).toHaveCount(0)
  await page.getByTestId("hackathon-reconcile").click()
  expect(f.calls.filter(call => call.path.endsWith("/reconcile"))).toHaveLength(1)
  expect(f.calls.some(call => /agent\/run|\/redeem$|\/guide\/operations$/.test(call.path))).toBe(false)
  f.assertSafe()
})

test("GUIDE-08 old demo signer cannot satisfy guide approval after resume", async ({ page, baseURL }) => {
  const f = new GuideFixture(page, baseURL!); await f.install()
  await page.addInitScript(id => sessionStorage.setItem(`ondo-b.hackathon.signer.v1:${id}`, JSON.stringify({ kind: "demo", address: "0xfixture", secretKey: "never-used-fixture" })), OP)
  const proposal = { proposalId: "fixture-proposal", mode: "gemini", model: "fixture", promptVersion: "v2", policyVersion: 1, inputDigest: "fixture", output: { action: V.action, target: { venueId: V.venueId, campaignId: V.campaignId }, title: "ガイドを保存", summary: "このガイドだけを保存", rationale: "選択したガイドを読み返せます。", language: "ja" }, outputDigest: "fixture", proposalDigest: "fixture", createdAt: now, guard: { injectionSuspected: false, schemaValid: true } } as NonNullable<OperationResult["proposal"]>
  await f.pending("delegation", { allowedActions: ["approve"], proposal })
  await expect(page.getByTestId("hackathon-layer")).toContainText("このガイドをパスに1回保存する範囲だけを承認します")
  await expect(page.getByTestId("hackathon-signer-google")).toBeVisible()
  await expect(page.getByTestId("hackathon-signer-demo")).toHaveCount(0)
  await expect(page.getByTestId("hackathon-delegate")).toHaveCount(0)
  expect(f.calls.some(call => call.path.includes("delegation/"))).toBe(false)
  f.assertSafe()
})

test("GUIDE-09 narrow Japanese reader and readiness keep actions reachable", async ({ page, baseURL }, info) => {
  await page.setViewportSize({ width: 320, height: 740 })
  const f = new GuideFixture(page, baseURL!); await f.install(); await f.place(); await f.save()
  await expect(page.getByTestId("guide-save-readiness")).toContainText("現在、パスには保存できません")
  const dialog = page.getByRole("dialog").filter({ has: page.getByTestId("guide-save-readiness") })
  expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
  expect(await page.locator("html").evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
  await expect(page.getByTestId("guide-keep-reading")).toBeInViewport()
  await page.screenshot({ path: info.outputPath("guide-readiness-ja-320.png") })
  await page.getByTestId("guide-keep-reading").click(); await expect(page.getByTestId("experience-public-guide")).toBeVisible()
  f.assertSafe()
})

test("GUIDE-10 unrenderable provider QR is explicit and never claims app handoff", async ({ page, baseURL }) => {
  const f = new GuideFixture(page, baseURL!); f.qrPayload = "x".repeat(6000); await f.install(); await f.pending("issuance")
  await page.getByTestId("guide-provider-start").click()
  await expect(page.getByTestId("guide-provider-step").getByRole("alert")).toContainText("QRを表示できませんでした")
  await expect(page.getByTestId("guide-provider-step").locator("img")).toHaveCount(0)
  await expect(page.getByTestId("guide-provider-refresh")).toBeVisible()
  expect(f.collection.items).toEqual([]); f.assertSafe()
})

test("GUIDE-11 mixed sample provider response never exposes its QR or advances", async ({ page, baseURL }) => {
  const f = new GuideFixture(page, baseURL!); f.wrongProviderMode = true; await f.install(); await f.pending("issuance")
  await page.getByTestId("guide-provider-start").click()
  await expect(page.getByTestId("guide-provider-step").getByRole("alert")).toBeVisible()
  await expect(page.getByTestId("guide-provider-step").locator("img")).toHaveCount(0)
  await expect(page.getByTestId("hackathon-layer")).toHaveAttribute("data-phase", "issuance")
  f.assertSafe()
})

test("GUIDE-06 missing resume and v1 DTO never become a new v2 operation", async ({ page, baseURL }) => {
  const f = new GuideFixture(page, baseURL!); f.ready = true; f.op = operation(); f.collection.pendingOperation = f.op; f.missingResume = true
  await f.install(); await f.place(); await f.save()
  await expect(page.getByTestId("hackathon-layer").getByRole("alert")).toBeVisible(); await expect(page.getByTestId("hackathon-start")).toBeDisabled()
  expect(f.calls.some(call => call.path === "/guide/operations")).toBe(false)
  await page.getByTestId("hackathon-close").click()
  f.missingResume = false; f.op = operation({ journey: undefined, campaignId: "hk-identity-perk-v1", execution: "sample" }); f.collection.pendingOperation = f.op
  await page.getByTestId("experience-open").click(); await f.save()
  await expect(page.getByTestId("guide-error-code")).toContainText("guide_operation_mismatch")
  await expect(page.getByTestId("hackathon-start")).toBeDisabled()
  f.assertSafe()
})

const ACCESS_CODE = "fixture_only_access_not_a_real_secret_20260929"

test("GUIDE-12 production access is private, transient and separate from identity consent", async ({ page, baseURL }, info) => {
  await page.setViewportSize({ width: 320, height: 740 })
  const f = new GuideFixture(page, baseURL!); f.ready = true; f.codeRequired = true; await f.install(); await f.place(); await f.save()
  await expect(page.getByTestId("guide-access")).toHaveAttribute("data-profile", "guide-production")
  await expect(page.getByTestId("guide-access-submit")).toBeDisabled()
  expect(f.calls.filter(call => call.method === "POST")).toEqual([])
  const input = page.getByTestId("guide-access-code")
  await input.fill("too-short"); await expect(page.getByTestId("guide-access-submit")).toBeDisabled()
  f.denyCode = true; await input.fill(ACCESS_CODE); await page.getByTestId("guide-access-submit").click()
  await expect(page.getByTestId("guide-access").getByRole("alert")).toBeVisible(); await expect(input).toHaveValue("")
  expect(f.calls.some(call => call.path === "/sessions")).toBe(false)
  const dialog = page.getByRole("dialog").filter({ has: page.getByTestId("guide-access") })
  expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
  await page.screenshot({ path: info.outputPath("guide-access-ja-320.png") })
  f.denyCode = false; await input.fill(ACCESS_CODE); await page.getByTestId("guide-access-submit").click()
  await expect(page.getByTestId("hackathon-start")).toBeDisabled(); await expect(page.locator("#hk-consent")).not.toBeChecked()
  expect(f.calls.filter(call => call.path.endsWith("/access"))).toEqual([
    { method: "POST", path: "/guide/access", body: { accessCode: ACCESS_CODE } },
    { method: "POST", path: "/guide/access", body: { accessCode: ACCESS_CODE } },
  ])
  expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))).not.toContain(ACCESS_CODE)
  expect(f.calls.some(call => call.path === "/guide/operations")).toBe(false); f.assertSafe()
})

test("GUIDE-13 explicit integration profile alone selects the integration access endpoint", async ({ page, baseURL }) => {
  const f = new GuideFixture(page, baseURL!); f.ready = true; f.codeRequired = true; f.accessProfile = "integration-preview"; f.configProfile = "integration-preview"
  await f.install(); await f.place(); await f.save()
  await page.getByTestId("guide-access-code").fill(ACCESS_CODE); await page.getByTestId("guide-access-submit").click()
  await expect(page.locator("#hk-consent")).toBeVisible()
  expect(f.calls.filter(call => call.path.endsWith("/access"))).toEqual([{ method: "POST", path: "/integration/access", body: { accessCode: ACCESS_CODE } }])
  expect(f.calls.some(call => call.path === "/guide/operations")).toBe(false); f.assertSafe()
})

test("GUIDE-14 missing readiness profile or mismatched protected config never falls back to preview", async ({ page, baseURL }) => {
  const f = new GuideFixture(page, baseURL!); f.ready = true; f.accessProfile = undefined; await f.install(); await f.place(); await f.save()
  await expect(page.getByTestId("guide-save-readiness")).toContainText("現在、パスには保存できません")
  expect(f.calls.some(call => call.path === "/config")).toBe(false)
  await page.getByTestId("guide-keep-reading").click(); f.accessProfile = "guide-production"; f.configProfile = "integration-preview"; await f.save()
  await expect(page.getByTestId("guide-access")).toHaveAttribute("data-state", "unavailable")
  f.configProfile = "guide-production"; f.configGuide = false; await page.getByTestId("guide-access-retry").click()
  await expect(page.getByTestId("guide-access")).toHaveAttribute("data-state", "unavailable")
  expect(f.calls.filter(call => call.method === "POST")).toEqual([])
  await page.getByTestId("guide-access-keep-reading").click(); await expect(page.getByTestId("experience-public-guide")).toBeVisible(); f.assertSafe()
})

test("GUIDE-15 successful access response without a usable cookie cannot authorize the journey", async ({ page, baseURL }) => {
  const f = new GuideFixture(page, baseURL!); f.ready = true; f.codeRequired = true; f.dropAccessCookie = true; await f.install(); await f.place(); await f.save()
  await page.getByTestId("guide-access-code").fill(ACCESS_CODE); await page.getByTestId("guide-access-submit").click()
  await expect(page.getByTestId("guide-access")).toHaveAttribute("data-state", "code")
  await expect(page.getByTestId("guide-access-code")).toHaveValue(""); await expect(page.getByTestId("hackathon-layer")).toHaveCount(0)
  expect(f.calls.filter(call => call.method === "POST").map(call => call.path)).toEqual(["/guide/access"]); f.assertSafe()
})

test("GUIDE-16 expired access clears QR and resumes only the same operation after explicit recheck", async ({ page, baseURL }) => {
  const f = new GuideFixture(page, baseURL!); await f.install(); await f.pending("issuance")
  await page.getByTestId("guide-provider-start").click(); await expect(page.getByTestId("guide-provider-step").locator("img")).toBeVisible()
  f.expireProviderAccess = true; await page.getByTestId("guide-provider-refresh").click()
  await expect(page.getByTestId("guide-access")).toHaveAttribute("data-state", "recheck")
  await expect(page.getByTestId("guide-provider-step")).toHaveCount(0)
  const countBeforeRecheck = f.calls.length
  await page.waitForTimeout(150); expect(f.calls.length).toBe(countBeforeRecheck)
  await page.getByTestId("guide-access-retry").click(); await page.getByTestId("guide-access-code").fill(ACCESS_CODE); await page.getByTestId("guide-access-submit").click()
  await expect(page.getByTestId("hackathon-layer")).toHaveAttribute("data-phase", "issuance")
  await expect(page.getByTestId("guide-provider-step").locator("img")).toHaveCount(0)
  expect(f.calls.filter(call => call.path === `/operations/${OP}`)).toHaveLength(2)
  expect(f.calls.filter(call => call.path.endsWith("issuance/start"))).toHaveLength(1)
  expect(f.calls.filter(call => call.path.endsWith("issuance/refresh"))).toHaveLength(1)
  expect(f.calls.some(call => call.path === "/guide/operations")).toBe(false); f.assertSafe()
})

test("GUIDE-17 campaign expiry keeps free reading open without creating access or operation", async ({ page, baseURL }) => {
  const f = new GuideFixture(page, baseURL!); f.ready = true; f.expiredCampaign = true; await f.install(); await f.place(); await f.save()
  await expect(page.getByTestId("guide-save-readiness")).toContainText("保存の受付は終了しました")
  expect(f.calls.filter(call => call.method === "POST")).toEqual([])
  await page.getByTestId("guide-keep-reading").click(); await expect(page.getByTestId("experience-public-guide")).toBeVisible(); f.assertSafe()
})

test("GUIDE-18 missing-operation retry never replaces the known operation with a new save", async ({ page, baseURL }) => {
  const f = new GuideFixture(page, baseURL!); f.ready = true; f.op = operation(); f.collection.pendingOperation = f.op; f.missingResume = true
  await f.install(); await f.place(); await f.save(); await expect(page.getByTestId("guide-bootstrap-retry")).toBeVisible()
  f.collection.pendingOperation = null; await page.getByTestId("guide-bootstrap-retry").click()
  await expect.poll(() => f.calls.filter(call => call.path === `/operations/${OP}`).length).toBe(2)
  await expect(page.getByTestId("hackathon-start")).toBeDisabled()
  expect(f.calls.some(call => call.path === "/guide/operations")).toBe(false); f.assertSafe()
})

test("GUIDE-19 leaving while access is pending cannot mount a late journey or start a session", async ({ page, baseURL }) => {
  const f = new GuideFixture(page, baseURL!); f.ready = true; f.codeRequired = true; f.accessResponseDelay = 600; await f.install(); await f.place(); await f.save()
  await page.getByTestId("guide-access-code").fill(ACCESS_CODE); await page.getByTestId("guide-access-submit").click()
  await page.getByTestId("guide-access-keep-reading").click(); await expect(page.getByTestId("experience-public-guide")).toBeVisible()
  await page.waitForTimeout(650); await expect(page.getByTestId("hackathon-layer")).toHaveCount(0)
  expect(f.calls.some(call => call.path === "/sessions")).toBe(false); f.assertSafe()
})

test("GUIDE-20 a closed journey's late terminal GET cannot erase a newer pending pointer", async ({ page, baseURL }) => {
  const f = new GuideFixture(page, baseURL!); f.ready = true; f.op = operation({ phase: "done", status: "succeeded" }); f.collection.pendingOperation = operation(); f.operationResponseDelay = 700
  await f.install(); await f.place(); await f.save()
  await expect.poll(() => f.calls.some(call => call.path === `/operations/${OP}`)).toBe(true)
  await page.getByTestId("hackathon-close").click()
  const newer = JSON.stringify({ venueId: V.venueId, locale: "ja", source: "guide", resumeOperationId: "op_newer_fixture_only", savedAt: Date.now() })
  await page.evaluate(value => sessionStorage.setItem("ondo-b.hackathon.pending.v1", value), newer)
  await page.waitForTimeout(750)
  expect(await page.evaluate(() => sessionStorage.getItem("ondo-b.hackathon.pending.v1"))).toBe(newer)
  await expect(page.getByTestId("hackathon-layer")).toHaveCount(0); f.assertSafe()
})

test("GUIDE-21 a provider body arriving after timeout cannot restore QR or advance", async ({ page, baseURL }) => {
  const f = new GuideFixture(page, baseURL!); await f.install(); await f.pending("issuance")
  // Deliberately emulate a transport that cannot abort an already received body.
  // Only this fixture's 15s provider deadline is shortened; no product motion changes.
  await page.evaluate(() => {
    const originalFetch = window.fetch.bind(window), originalTimeout = window.setTimeout.bind(window)
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => originalTimeout(handler, timeout === 15000 ? 80 : timeout, ...args)) as typeof window.setTimeout
    window.fetch = async (...args) => {
      const response = await originalFetch(...args)
      if (String(args[0]).includes("/provider/issuance/start")) {
        const json = response.json.bind(response)
        response.json = async () => { const value = await json(); await new Promise(resolve => originalTimeout(resolve, 200)); return value }
      }
      return response
    }
  })
  await page.getByTestId("guide-provider-start").click()
  await expect(page.getByTestId("guide-provider-step").getByRole("alert")).toBeVisible()
  await expect(page.getByTestId("guide-provider-step").locator("img")).toHaveCount(0)
  await expect(page.getByTestId("hackathon-layer")).toHaveAttribute("data-phase", "issuance")
  expect(f.collection.items).toEqual([]); f.assertSafe()
})

// The real main-origin URL below is intercepted completely: assets come ONLY
// from the credential-free local server and ALL APIs are synthetic fixtures.
// No production request, native SDK, identity, model or chain call occurs.
async function nativeFixture(page: Page, localOrigin: string, options: { mainOrigin?: boolean; platform?: string; frozen?: boolean; guide?: boolean; mock?: boolean; throwOnOpen?: boolean; boundApp?: boolean } = {}) {
  // Next dev waits for its HMR connection before hydrating. Proxy that one
  // development channel to localhost too; never connect to Production's socket.
  await page.context().routeWebSocket("**", socket => {
    const incoming = new URL(socket.url())
    if (!incoming.pathname.startsWith("/_next/webpack-hmr")) { socket.close(); return }
    const local = new URL(incoming.pathname + incoming.search, localOrigin)
    local.protocol = "ws:"
    const upstream = new WebSocket(local)
    upstream.binaryType = "arraybuffer"
    const queued: Array<string | Buffer> = []
    let closed = false
    socket.onMessage(message => upstream.readyState === WebSocket.OPEN ? upstream.send(message) : queued.push(message))
    socket.onClose(() => { closed = true; if (upstream.readyState === WebSocket.OPEN) upstream.close() })
    upstream.addEventListener("open", () => {
      if (closed) { upstream.close(); return }
      for (const message of queued) upstream.send(message)
      queued.length = 0
    })
    upstream.addEventListener("message", event => {
      if (closed) return
      if (typeof event.data === "string") socket.send(event.data)
      else if (event.data instanceof ArrayBuffer) socket.send(Buffer.from(event.data))
    })
    upstream.addEventListener("close", () => { if (!closed) socket.close() })
    upstream.addEventListener("error", () => { if (!closed) socket.close() })
  })
  await page.addInitScript(({ platform, frozen, throwOnOpen, boundApp }) => {
    const state = window as unknown as Record<string, unknown>
    state.__nativeFixtureCalls = 0
    const bridge = { available: true, platform, openOffer() {
      state.__nativeFixtureCalls = Number(state.__nativeFixtureCalls) + 1
      if (throwOnOpen) throw new Error("fixture unknown handoff outcome")
      return { authorized: true } // Deliberately untrusted; the product must ignore it.
    }, showWallet() { throw new Error("not part of the handoff contract") } }
    const app = { available: true, version: 1, platform: "ios", bindingVersion: "cx-holder-v1", wallet: async () => ({ v: 1, holder: "synthetic", state: "needs_setup", biometric: "none" }), setup: async () => ({}), unlock: async () => ({}), cancel: async () => ({ v: 1, cancelled: false, reason: "in_flight" }),
      bind: async (a: { requestId: string }) => { state.__nativeBindCalls = Number(state.__nativeBindCalls ?? 0) + 1; return { v: 1, requestId: a.requestId, outcome: "submitted", retryable: false } },
      issue: async (a: { requestId: string; bindingId: string }) => { state.__nativeFixtureCalls = Number(state.__nativeFixtureCalls) + 1; state.__nativeBoundId = a.bindingId; return { v: 1, requestId: a.requestId, outcome: "submitted", retryable: false } }, present: async () => ({}) }
    state.ktourNative = frozen ? Object.freeze(boundApp ? app : bridge) : boundApp ? app : bridge
  }, { platform: options.platform ?? "ios", frozen: options.frozen ?? true, throwOnOpen: options.throwOnOpen ?? false, boundApp: options.boundApp ?? false })
  const origin = options.mainOrigin === false ? localOrigin : "https://ktour-id.vercel.app"
  const f = new GuideFixture(page, origin, localOrigin)
  f.nativeV1 = !options.guide
  f.nativeMock = options.mock ?? false
  f.hostedSui = !options.guide
  f.nativeBindingConfigured = !options.mock
  f.nativeBound = options.boundApp ?? false
  await f.install()
  await f.pending("issuance", { expiresAt: new Date(Date.now() + 300_000).toISOString() })
  return f
}
const nativeCalls = (page: Page) => page.evaluate(() => Number((window as unknown as Record<string, unknown>).__nativeFixtureCalls))

test("NATIVE-LOCAL-01 purpose consent starts one local operation without JIT or automatic CX request", async ({ page, baseURL }) => {
  test.skip(baseURL !== "http://127.0.0.1:3183", "Requires the explicitly marked isolated local bundle")
  const f = new GuideFixture(page, baseURL!); f.nativeV1 = true; f.localFresh = true; await f.install(); await f.place()
  await expect(page.getByTestId("hackathon-start")).toBeDisabled()
  await page.locator("#hk-consent").check(); await page.getByTestId("hackathon-start").click()
  await expect(page.getByTestId("hackathon-layer")).toHaveAttribute("data-phase", "identity")
  await expect(page.getByTestId("hackathon-identity-start")).toBeVisible()
  expect(f.calls.filter(c => c.path === "/operations" && c.method === "POST")).toHaveLength(1)
  expect(f.calls.some(c => c.path.startsWith("/identity/") || c.path.endsWith("/identity/start") || c.path.includes("/provider/"))).toBe(false)
  await expect(page.getByTestId("native-local-phone-qr")).toBeVisible()
  await page.getByTestId("hackathon-identity-start").click()
  expect(f.calls.filter(c => c.path.endsWith("/identity/start")).map(c => c.body)).toEqual([{ mobile: false }])
  await expect(page.getByAltText("Mobile ID QR")).toBeVisible()
  await expect(page.getByTestId("hackathon-layer")).toHaveAttribute("data-phase", "identity")
  expect(f.calls.some(c => c.path.endsWith("/identity/complete"))).toBe(false)
  await page.getByTestId("hackathon-layer").getByRole("button", { name: "結果を確認", exact: true }).click()
  await expect(page.getByTestId("hackathon-layer")).toHaveAttribute("data-phase", "issuance")
  expect(f.calls.filter(c => c.path.endsWith("/identity/complete")).map(c => c.body)).toEqual([{}])
  expect(f.calls.some(c => c.path.includes("/provider/") || c.path.includes("/native-binding/"))).toBe(false)
  expect(f.unexpected).toEqual([]); expect(f.errors).toEqual([])
})
test("NATIVE-LOCAL-02 local verification stops before AI chain or merchant execution", async ({ page, baseURL }) => {
  test.skip(baseURL !== "http://127.0.0.1:3183", "Requires the explicitly marked isolated local bundle")
  const f = new GuideFixture(page, baseURL!); f.nativeV1 = true; await f.install(); await f.pending("proposal", { allowedActions: ["propose", "cancel"] })
  await expect(page.getByTestId("native-local-scope-end")).toBeVisible()
  await expect(page.getByTestId("hackathon-propose")).toHaveCount(0)
  expect(f.calls.some(c => /proposal|delegate|agent\/run|redeem/.test(c.path))).toBe(false); f.assertSafe()
})
test("NATIVE-BIND-01 explicit fresh binding never self-authorizes; server status then separate offer", async ({ page, baseURL }) => {
  const f = await nativeFixture(page, baseURL!, { boundApp: true })
  await expect(page.getByTestId("native-holder-binding")).toBeVisible()
  await expect(page.getByTestId("guide-provider-start")).toBeDisabled()
  await expect(page.getByTestId("guide-provider-refresh")).toBeDisabled()
  await page.getByTestId("native-binding-start").click()
  await expect.poll(() => page.evaluate(() => Number((window as unknown as Record<string, unknown>).__nativeBindCalls))).toBe(1)
  expect(f.calls.filter(c => c.path.includes("/provider/")).length).toBe(0)
  await expect(page.getByTestId("hackathon-layer")).toHaveAttribute("data-phase", "issuance")
  await page.getByTestId("native-binding-status").click()
  await expect(page.getByTestId("native-holder-binding")).not.toContainText("サーバーで本人確認とウォレットの接続を確認しました")
  await expect(page.getByTestId("guide-provider-start")).toBeDisabled()
  f.bindingVerified = true; await page.getByTestId("native-binding-status").click()
  await expect(page.getByTestId("native-holder-binding")).toContainText("サーバーで本人確認とウォレットの接続を確認しました")
  await expect(page.getByTestId("guide-provider-start")).toBeEnabled()
  await page.getByTestId("native-holder-binding").scrollIntoViewIfNeeded()
  await page.screenshot({ path: test.info().outputPath("native-binding-server-status.png"), fullPage: true })
  await page.getByTestId("guide-provider-start").click(); await page.getByTestId("guide-provider-native-open").click()
  expect(await nativeCalls(page)).toBe(1)
  expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__nativeBoundId)).toBe(f.bindingId)
  await expect(page.getByTestId("hackathon-layer")).toHaveAttribute("data-phase", "issuance")
  const layout = await page.getByTestId("hackathon-layer").evaluate(root => {
    const bounds = root.getBoundingClientRect(), sheet = root.firstElementChild!.getBoundingClientRect(), close = root.querySelector("[data-testid='hackathon-close']")!.getBoundingClientRect()
    return { top: bounds.top, bottom: bounds.bottom, sheetTop: sheet.top, sheetBottom: sheet.bottom, closeTop: close.top, closeBottom: close.bottom }
  })
  expect(layout.sheetTop).toBeGreaterThanOrEqual(layout.top - 1)
  expect(layout.sheetBottom).toBeLessThanOrEqual(layout.bottom + 1)
  expect(layout.closeTop).toBeGreaterThanOrEqual(layout.top)
  expect(layout.closeBottom).toBeLessThanOrEqual(layout.bottom)
  await page.screenshot({ path: test.info().outputPath("native-binding-confirmed.png"), fullPage: true }); f.assertSafe()
})
test("NATIVE-BIND-02 absent server binding cannot dispatch an offer; explicit cancel has no retry", async ({ page, baseURL }) => {
  const f = await nativeFixture(page, baseURL!, { boundApp: true })
  await expect(page.getByTestId("guide-provider-start")).toBeDisabled(); await expect(page.getByTestId("guide-provider-native-open")).toHaveCount(0)
  await page.getByTestId("native-binding-start").click(); await page.getByTestId("native-binding-cancel").click()
  await expect(page.getByTestId("native-binding-start")).toHaveCount(0)
  expect(f.calls.filter(c => c.path.endsWith("/native-binding/start")).length).toBe(1)
  expect(f.calls.filter(c => c.path.endsWith("/native-binding/cancel")).length).toBe(1)
  expect(f.calls.filter(c => c.path.includes("/provider/")).length).toBe(0)
  await expect(page.getByTestId("guide-provider-start")).toBeDisabled()
  expect(await nativeCalls(page)).toBe(0); f.assertSafe()
})

test("NATIVE-01 explicit issue/present handoff is one-shot and return never approves or advances", async ({ page, baseURL }) => {
  const f = await nativeFixture(page, baseURL!)
  await expect(page.getByTestId("guide-provider-native-open")).toHaveCount(0)
  await page.getByTestId("guide-provider-start").click()
  await expect(page.getByTestId("guide-provider-native-open")).toBeVisible()
  expect(await nativeCalls(page)).toBe(0)
  const before = f.calls.length
  await page.getByTestId("guide-provider-native-open").click()
  await expect(page.getByTestId("guide-provider-native-open")).toBeDisabled()
  await expect(page.getByTestId("guide-provider-native-pending")).toContainText("完了や承認を意味しません")
  await page.evaluate(() => { window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("pageshow")); document.dispatchEvent(new Event("visibilitychange")) })
  await expect(page.getByTestId("hackathon-layer")).toHaveAttribute("data-phase", "issuance")
  expect(await nativeCalls(page)).toBe(1)
  expect(f.calls.length).toBe(before)
  await page.getByTestId("guide-provider-refresh").click()
  await expect(page.getByTestId("hackathon-layer")).toHaveAttribute("data-phase", "presentation")
  await expect(page.getByTestId("guide-provider-native-open")).toHaveCount(0)
  await page.getByTestId("guide-provider-start").click()
  await page.getByTestId("guide-provider-native-open").click()
  expect(await nativeCalls(page)).toBe(2)
  await page.screenshot({ path: test.info().outputPath("native-presentation-pending.png"), fullPage: true })
  await page.getByTestId("guide-provider-cancel").click()
  await expect(page.getByTestId("guide-provider-native-open")).toHaveCount(0)
  expect(f.collection.items).toEqual([])
  expect(f.calls.some(call => /prepare|submit|agent|redeem|issuance\/mock/.test(call.path))).toBe(false)
  const persisted = await page.evaluate(() => JSON.stringify([Object.values(localStorage), Object.values(sessionStorage)]))
  expect(persisted).not.toContain(f.qrPayload)
  f.assertSafe()
})

for (const variant of ["origin", "platform", "mutable"] as const) {
  test(`NATIVE-02 ${variant} mismatch cannot display native action; QR and result check remain available`, async ({ page, baseURL }) => {
    const f = await nativeFixture(page, baseURL!, { mainOrigin: variant !== "origin", platform: variant === "platform" ? "android" : "ios", frozen: variant !== "mutable" })
    await page.getByTestId("guide-provider-start").click()
    await expect(page.getByTestId("guide-provider-step").locator("img")).toBeVisible()
    await expect(page.getByTestId("guide-provider-native-open")).toHaveCount(0)
    await expect(page.getByTestId("guide-provider-refresh")).toBeVisible()
    expect(await nativeCalls(page)).toBe(0)
    f.assertSafe()
  })
}

test("NATIVE-03 closed operation ignores a late native offer and does not hand off", async ({ page, baseURL }) => {
  const f = await nativeFixture(page, baseURL!)
  await page.evaluate(() => {
    const originalFetch = window.fetch.bind(window)
    window.fetch = async (...args) => {
      const response = await originalFetch(...args)
      if (String(args[0]).includes("/provider/issuance/start")) {
        const json = response.json.bind(response)
        response.json = async () => { const body = await json(); await new Promise(resolve => setTimeout(resolve, 400)); return body }
      }
      return response
    }
  })
  await page.getByTestId("guide-provider-start").click()
  await expect.poll(() => f.calls.some(call => call.path.endsWith("/provider/issuance/start"))).toBe(true)
  await page.getByTestId("hackathon-close").click()
  await page.waitForTimeout(450)
  await expect(page.getByTestId("guide-provider-native-open")).toHaveCount(0)
  await expect(page.getByTestId("hackathon-layer")).toHaveCount(0)
  expect(await nativeCalls(page)).toBe(0)
  expect(f.calls.some(call => call.path.endsWith("/presentation/start"))).toBe(false)
  f.assertSafe()
})

test("NATIVE-04 refreshing invalidates a previously opened offer even on lost response", async ({ page, baseURL }) => {
  const f = await nativeFixture(page, baseURL!)
  await page.getByTestId("guide-provider-start").click()
  await page.getByTestId("guide-provider-native-open").click()
  f.providerFailure = true
  await page.getByTestId("guide-provider-refresh").click()
  await expect(page.getByTestId("guide-provider-step").getByRole("alert")).toBeVisible()
  await expect(page.getByTestId("guide-provider-native-open")).toHaveCount(0)
  await expect(page.getByTestId("guide-provider-start")).toHaveCount(0)
  expect(await nativeCalls(page)).toBe(1)
  await expect(page.getByTestId("guide-provider-refresh")).toBeEnabled()
  f.assertSafe()
})

test("NATIVE-05 unsupported guide V2 cannot open the native V1 transport", async ({ page, baseURL }) => {
  const f = await nativeFixture(page, baseURL!, { guide: true })
  await page.getByTestId("guide-provider-start").click()
  await expect(page.getByTestId("guide-provider-step").locator("img")).toBeVisible()
  await expect(page.getByTestId("guide-provider-native-open")).toHaveCount(0)
  await expect(page.getByTestId("guide-provider-step")).not.toContainText("このアプリで身分証の確認画面を開けます")
  expect(await nativeCalls(page)).toBe(0)
  f.assertSafe()
})

test("NATIVE-06 mock configured V1 keeps the existing sample path and never calls native", async ({ page, baseURL }) => {
  const f = await nativeFixture(page, baseURL!, { mock: true })
  await expect(page.getByTestId("hackathon-issue")).toBeVisible()
  await expect(page.getByTestId("guide-provider-step")).toHaveCount(0)
  expect(await nativeCalls(page)).toBe(0)
  expect(f.calls.some(call => call.path.includes("/provider/"))).toBe(false)
  f.assertSafe()
})

test("NATIVE-07 unknown native outcome is not announced as delivered and is not retried", async ({ page, baseURL }) => {
  const f = await nativeFixture(page, baseURL!, { throwOnOpen: true })
  await page.getByTestId("guide-provider-start").click()
  await page.getByTestId("guide-provider-native-open").click()
  await expect(page.getByTestId("guide-provider-native-open")).toBeDisabled()
  await expect(page.getByTestId("guide-provider-native-pending")).toHaveCount(0)
  await expect(page.getByTestId("guide-provider-step").getByRole("alert")).toContainText("移動を確認できませんでした")
  await expect(page.getByTestId("guide-provider-refresh")).toBeEnabled()
  expect(await nativeCalls(page)).toBe(1)
  expect(f.calls.filter(call => call.path.includes("/provider/")).length).toBe(1)
  f.assertSafe()
})

// Run with a credential-free local NEXT_PUBLIC_HK_HOSTED_SUI=1 build/server.
// The eight-step progress assertion prevents a non-hosted build from silently
// passing this regression. All BFF calls are intercepted presentation fixtures.
test("NATIVE-HOSTED-01 actual configured provider passes hosted gate and replaces mock issuance UI", async ({ page, baseURL }, info) => {
  const f = new GuideFixture(page, baseURL!)
  f.hostedSui = true; f.nativeBindingConfigured = true; f.nativeV1 = true
  f.configGuide = false; f.configProfile = undefined
  await f.install(); await f.pending("issuance", { expiresAt: new Date(Date.now() + 300_000).toISOString() })
  await expect(page.getByRole("group", { name: /3\/8$/ })).toBeVisible()
  await expect(page.getByTestId("integration-preview-access")).toHaveCount(0)
  await expect(page.getByTestId("guide-provider-step")).toBeVisible()
  await expect(page.getByTestId("hackathon-issue")).toHaveCount(0)
  expect(f.calls.some(call => call.path.includes("/provider/"))).toBe(false)
  await page.getByTestId("guide-provider-start").click()
  await expect(page.getByTestId("guide-provider-step").locator("img")).toBeVisible()
  await page.getByTestId("guide-provider-refresh").click()
  await expect(page.getByTestId("hackathon-layer")).toHaveAttribute("data-phase", "presentation")
  await expect(page.getByTestId("guide-provider-step")).toHaveAttribute("data-provider-phase", "presentation")
  await expect(page.getByTestId("hackathon-layer")).not.toContainText("OpenDIDの身分証は発行しません")
  await page.screenshot({ path: info.outputPath("hosted-native-provider-selection.png") })
  expect(f.calls.filter(call => call.path.includes("/provider/")).map(call => call.path)).toEqual([
    `/operations/${OP}/provider/issuance/start`, `/operations/${OP}/provider/issuance/refresh`,
  ])
  f.assertSafe()
})

test("NATIVE-HOSTED-02 native mode without server configuration capability cannot mount or call provider", async ({ page, baseURL }) => {
  const f = new GuideFixture(page, baseURL!)
  f.hostedSui = true; f.nativeBindingConfigured = false; f.nativeV1 = true
  f.configGuide = false; f.configProfile = undefined
  f.op = operation({ journey: undefined, phase: "issuance", expiresAt: new Date(Date.now() + 300_000).toISOString() })
  await f.install(); await f.place()
  await expect(page.getByTestId("integration-preview-access")).toContainText("現在、統合体験を開けません")
  await expect(page.getByTestId("hackathon-layer")).toHaveCount(0)
  await expect(page.getByTestId("guide-provider-step")).toHaveCount(0)
  expect(f.calls.some(call => call.path.includes("/provider/"))).toBe(false)
  f.assertSafe()
})

test("NATIVE-HOSTED-03 existing mock hosted lane keeps sample UI without native capability", async ({ page, baseURL }) => {
  const f = new GuideFixture(page, baseURL!)
  f.hostedSui = true; f.nativeBindingConfigured = false; f.nativeMock = true; f.nativeV1 = true
  f.configGuide = false; f.configProfile = undefined
  await f.install(); await f.pending("issuance", { expiresAt: new Date(Date.now() + 300_000).toISOString() })
  await expect(page.getByRole("group", { name: /3\/8$/ })).toBeVisible()
  await expect(page.getByTestId("hackathon-issue")).toBeVisible()
  await expect(page.getByTestId("hackathon-layer")).toContainText("OpenDIDの身分証は発行しません")
  await expect(page.getByTestId("guide-provider-step")).toHaveCount(0)
  expect(f.calls.some(call => call.path.includes("/provider/"))).toBe(false)
  f.assertSafe()
})
