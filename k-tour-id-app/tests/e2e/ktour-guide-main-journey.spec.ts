import { expect, test, type Page } from "@playwright/test"
import { GUIDE_SAVE_V2, guideJourney, type GuideCollection, type GuideReadiness } from "../../lib/hackathon/guide-contract"
import type { OperationResult } from "../../lib/hackathon/types"

// Browser fixtures only: no CX/OpenDID provider, Google signer or chain is called.
// These assertions prove routing and UI authority boundaries, not real execution.
const V = GUIDE_SAVE_V2
const OP = "op_browser_guide_fixture_20260929"
const now = new Date().toISOString()
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
  op: OperationResult | null = null
  collection: GuideCollection = { items: [], pendingOperation: null }
  constructor(readonly page: Page, readonly origin: string) {}
  async install() {
    this.page.on("pageerror", error => this.errors.push(error.message))
    await this.page.addInitScript(() => {
      localStorage.setItem("ondo-b.device.v1", JSON.stringify({ locale: "ja", appearancePreference: "dark", onboarding: "ONB-COMPLETE" }))
      sessionStorage.setItem("ondo.review.flow.v1", "0")
    })
    await this.page.context().route("**/*", async route => {
      const req = route.request(), url = new URL(req.url())
      if (url.origin !== this.origin) { await route.abort("blockedbyclient"); return }
      if (!url.pathname.startsWith("/api/hackathon/v1/")) { if (req.method() === "GET") await route.continue(); else { this.unexpected.push(url.pathname); await route.abort() }; return }
      const path = url.pathname.slice("/api/hackathon/v1".length)
      const body = req.postData() ? req.postDataJSON() : {}
      this.calls.push({ path, method: req.method(), body })
      const send = (data: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data), headers: { "cache-control": "no-store", "x-fixture-only": "no-provider-evidence" } })
      if (path === "/guide/readiness") {
        const checks: GuideReadiness["checks"] = (["identity", "credential", "execution", "audit", "login", "ai", "campaign"] as const).map(id => ({ id, status: this.ready ? "configured" : "setup_required" }))
        await send({ ...V, supported: true, ready: this.ready, verification: "configuration_only", checks, blockers: this.ready ? [] : checks.map(check => check.id), identityCheckAvailable: false }); return
      }
      if (path === "/guide/collection") { await send(this.collection); return }
      if (path === "/config") {
        await send({ isolatedMock: false, campaign: { ...V, title: { ko: "가이드 담기", en: "Save guide", ja: "ガイドを保存" }, description: { ko: "", en: "", ja: "" } }, consentVersion: V.consentVersion,
          modes: { cx: "cx", opendid: "opendid", ai: "gemini", sui: "testnet", omnione: "stage", zklogin: "google" }, sui: { network: "testnet", packageId: "", campaignId: "", explorer: "", googleClientId: "fixture-client" }, omnione: { chainId: 0, registryAddress: "" } }); return
      }
      if (path === "/sessions") { await send({ ok: true, sessionId: "fixture-only" }); return }
      if (path === "/guide/operations" && req.method() === "POST") { this.op = operation(); await send(this.op); return }
      if (path === `/operations/${OP}`) { await send(this.missingResume ? { error: { code: "not_found" } } : this.op, this.missingResume ? 404 : 200); return }
      if (path === `/operations/${OP}/reconcile`) { await send(this.op); return }
      if (path === `/operations/${OP}/redeem`) {
        this.op = operation({ phase: "done", status: "succeeded", allowedActions: ["return", "reconcile"], fulfillment: { status: "redeemed", redemptionRef: "fixture-guide-save", redeemedAt: now, reason: null, recheck: null }, chain: { outboxId: "fixture-outbox", eventKey: "fixture-event", payloadCommitment: "fixture", status: "pending", txHash: null, blockNumber: null, attempts: 0, lastError: null, confirmedAt: null } })
        this.collection = { pendingOperation: null, items: [{ guideId: V.guideId, venueId: V.venueId, campaignId: V.campaignId, operationId: OP, savedAt: now, chain: { status: "pending", txHash: null, confirmedAt: null } }] }
        await send(this.op); return
      }
      if (path.includes(`/operations/${OP}/provider/`)) {
        if (this.providerFailure) { await send({ error: { code: "provider_timeout" } }, 503); return }
        if (path.endsWith("/cancel")) { this.op = operation({ phase: "cancelled", status: "cancelled", allowedActions: ["return"] }); await send({ operation: this.op, provider: { phase: "cancelled", offer: null } }); return }
        if (path.endsWith("issuance/refresh")) { this.op = operation({ phase: "presentation", allowedActions: ["present", "cancel"] }); await send({ operation: this.op, provider: { phase: "presentation", offer: null } }); return }
        if (path.endsWith("presentation/refresh") && this.denial) { this.op = operation({ phase: "failed", status: "failed", allowedActions: ["return"] }); await send({ operation: this.op, provider: { phase: "denied", offer: null } }); return }
        await send({ operation: this.wrongProviderMode ? { ...this.op, execution: "sample" } : this.op, provider: { phase: this.op?.phase, offer: { qrPayload: this.qrPayload } } }); return
      }
      this.unexpected.push(path); await send({ error: { code: "unexpected_fixture_call" } }, 409)
    })
  }
  async place() {
    await this.page.goto(`/?venueId=${V.venueId}&review=0`, { waitUntil: "domcontentloaded" })
    await expect(this.page.getByTestId("ondo-b-root")).toHaveAttribute("data-hydrated", "true")
    await this.page.addStyleTag({ content: "nextjs-portal { display: none !important; }" })
    if (!await this.page.getByTestId("canonical-place-overlay").isVisible()) await this.page.getByTestId("canonical-place-details").click()
    await this.page.getByTestId("experience-open").click()
    await expect(this.page.getByTestId("experience-public-guide")).toBeVisible()
  }
  async save() { await this.page.getByTestId("experience-add-to-pass").click() }
  async pending(phase: OperationResult["phase"], extra: Partial<OperationResult> = {}) {
    this.ready = true; this.op = operation({ phase, ...extra }); this.collection.pendingOperation = this.op
    await this.place(); await this.save(); await expect(this.page.getByTestId("hackathon-layer")).toHaveAttribute("data-phase", phase)
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
  await expect(page.getByTestId("hackathon-layer").getByRole("alert")).toContainText("guide_operation_mismatch")
  await expect(page.getByTestId("hackathon-start")).toBeDisabled()
  f.assertSafe()
})
