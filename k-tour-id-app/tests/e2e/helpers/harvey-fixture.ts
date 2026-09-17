import { expect, test as base, type Page, type Route } from "@playwright/test"
import type { AllowedAction, OperationResult, Phase } from "../../../lib/hackathon/types"
import type { EntitlementInfo, PublicConfig } from "../../../features/ondo/hackathon-b/hackathon-client"

/** Browser presentation fixture only. No provider verification, BFF service,
 * transaction construction, broadcast, or chain confirmation is exercised. */
export const HARVEY_VENUE = "mois-0021cd596bc5b2a922ad"
export const HARVEY_CAMPAIGN = "browser-fixture-perk"
const API = "/api/hackathon/v1"
const OPERATION_ID = "browser-fixture-operation-1"
const fixtureDigest = `0x${"f1".repeat(32)}`
const txBytesB64 = Buffer.from("BROWSER_FIXTURE_ONLY_NOT_A_CHAIN_TRANSACTION").toString("base64")
type Locale = "en" | "ko" | "ja"
type Call = { method: string; path: string; body: Record<string, unknown> }

export class HarveyFixture {
  readonly calls: Call[] = []
  readonly forbiddenRequests: string[] = []
  readonly unexpectedRequests: string[] = []
  readonly pageErrors: string[] = []
  operation: OperationResult | null = null
  private failOnce = new Map<string, string>()
  private readonly now = new Date().toISOString()
  private readonly expiresAt = new Date(Date.now() + 60 * 60_000).toISOString()
  readonly config: PublicConfig = {
    isolatedMock: true,
    campaign: {
      venueId: HARVEY_VENUE, campaignId: HARVEY_CAMPAIGN,
      title: { en: "Browser fixture perk", ko: "브라우저 픽스처 혜택", ja: "ブラウザ・フィクスチャ特典" },
      description: {
        en: "Browser fixture only. No actual verification, payment, merchant obligation or blockchain transaction.",
        ko: "브라우저 픽스처 전용. 실제 신원 확인·결제·매장 제공 의무·블록체인 거래가 없습니다.",
        ja: "ブラウザ・フィクスチャ専用。実際の本人確認・決済・店舗の提供義務・ブロックチェーン取引はありません。",
      },
      endsAt: this.expiresAt,
    },
    modes: { cx: "mock", opendid: "mock", ai: "rule", sui: "mock", omnione: "mock", zklogin: "demo-signer" },
    sui: { network: "browser-fixture", packageId: "", campaignId: "", explorer: "", googleClientId: "" },
    omnione: { chainId: 0, registryAddress: "" }, consentVersion: "browser-fixture-consent-v1",
  }

  constructor(readonly page: Page, readonly origin: string) {}

  count(path: string) { return this.calls.filter(call => call.path === path).length }
  failNext(action: string, message = "Fixture temporary failure: retry the same step") {
    this.failOnce.set(`/operations/${OPERATION_ID}/${action}`, message)
  }
  actionCount(action: string) { return this.count(`/operations/${OPERATION_ID}/${action}`) }

  async install() {
    this.page.on("pageerror", error => this.pageErrors.push(error.message))
    // All local integration calls are fulfilled here, including reads. Unknown
    // API paths are failures, never fall-throughs to a credential-bearing BFF.
    await this.page.context().route("**/*", async route => {
      const request = route.request(), url = new URL(request.url())
      const mutation = !["GET", "HEAD", "OPTIONS"].includes(request.method())
      if (url.origin !== this.origin) {
        const passiveFont = ["fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname)
          && ["stylesheet", "font"].includes(request.resourceType())
        const provider = !passiveFont && /sumsub|onfido|omni.?one|opendid|fullnode|sui\.io|walletconnect|stripe|raonsecure|googleapis|accounts\.google\.com|mystenlabs\.com/i.test(url.hostname)
        if (mutation || provider || request.resourceType() === "document") {
          this.forbiddenRequests.push(`${request.method()} ${url.origin}${url.pathname}`)
        }
        // Offline assets may use the app's existing fallbacks. No external HTTP
        // request is needed to substantiate this fixture-only test result.
        await route.abort("blockedbyclient")
        return
      }
      if (url.pathname.startsWith(`${API}/`)) {
        await this.respond(route, url.pathname.slice(API.length))
        return
      }
      if (mutation) {
        this.forbiddenRequests.push(`${request.method()} ${url.pathname}`)
        await route.abort("blockedbyclient")
        return
      }
      await route.continue()
    })
  }

  async preferences(locale: Locale = "en", appearance: "light" | "dark" = "light") {
    await this.page.addInitScript(({ locale, appearance }) => {
      localStorage.setItem("ondo-b.device.v1", JSON.stringify({ locale, appearancePreference: appearance, onboarding: "ONB-COMPLETE" }))
      sessionStorage.setItem("ondo.review.flow.v1", "0")
    }, { locale, appearance })
  }

  async open(extraQuery = "") {
    await this.page.goto(`/?venueId=${HARVEY_VENUE}&review=0${extraQuery}`, { waitUntil: "domcontentloaded" })
    await expect(this.page.getByTestId("ondo-b-root")).toHaveAttribute("data-hydrated", "true")
    if (extraQuery) {
      // The old auto link is allowed to reveal the place after its two short
      // navigation timers; observe that window before taking manual actions.
      await this.page.waitForTimeout(1000)
      expect(this.count("/operations")).toBe(0)
      await expect(this.page.getByTestId("hackathon-layer")).toHaveCount(0)
    }
    if (!await this.page.getByTestId("canonical-place-overlay").isVisible()) {
      await this.page.getByTestId("canonical-place-details").click()
    }
    await expect(this.page.getByTestId("canonical-place-overlay")).toBeVisible()
    await this.page.getByTestId("hackathon-entitlement-open").click()
    await expect(this.page.getByTestId("hackathon-layer")).toBeVisible()
    await expect(this.page.locator("#hk-consent")).not.toBeChecked()
    await expect.poll(() => this.count("/config")).toBeGreaterThan(0)
  }

  private advance(phase: Phase, patch: Partial<OperationResult> = {}) {
    if (!this.operation) throw new Error("Fixture operation has not been created")
    const actions: Partial<Record<Phase, AllowedAction[]>> = {
      identity: ["complete_handoff", "cancel"], issuance: ["issue", "ack_holder", "cancel"],
      presentation: ["present", "cancel"], proposal: ["propose", "cancel"],
      delegation: ["approve", "sign_delegation", "cancel"], agent: ["run_agent", "reconcile"],
      fulfillment: ["redeem", "reconcile"], done: ["reconcile", "return"], cancelled: ["return"],
    }
    this.operation = { ...this.operation, phase, allowedActions: actions[phase] ?? [], ...patch, revision: this.operation.revision + 1, updatedAt: new Date().toISOString() }
    return this.operation
  }

  private async respond(route: Route, path: string) {
    const request = route.request()
    const body = request.postDataJSON() as Record<string, unknown> | null
    this.calls.push({ method: request.method(), path, body: body ?? {} })
    const send = (value: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) })
    const error = this.failOnce.get(path)
    if (error) {
      this.failOnce.delete(path)
      await send({ error: { code: "fixture_retry", message: error, retryable: true } }, 503)
      return
    }
    if (path === "/sessions") { await send({ ok: true, sessionId: "browser-fixture-session" }); return }
    if (path === "/config") { await send(this.config); return }
    if (path === `/places/${HARVEY_VENUE}/demo-entitlements`) {
      const info: EntitlementInfo = {
        supported: true, campaign: this.config.campaign, modes: this.config.modes,
        consentVersion: this.config.consentVersion,
        operation: this.operation?.status === "pending" ? this.operation : null,
        redeemed: this.operation?.fulfillment?.status === "redeemed"
          ? { redemptionRef: this.operation.fulfillment.redemptionRef!, redeemedAt: this.operation.fulfillment.redeemedAt! } : null,
      }
      await send(info); return
    }
    if (path === "/operations" && request.method() === "POST") {
      expect(body).toMatchObject({ venueId: HARVEY_VENUE, consentVersion: this.config.consentVersion })
      expect(this.operation).toBeNull()
      this.operation = {
        operationId: OPERATION_ID, kind: "demo_entitlement", venueId: HARVEY_VENUE,
        campaignId: HARVEY_CAMPAIGN, policyVersion: 1, status: "pending", phase: "identity", revision: 1,
        createdAt: this.now, updatedAt: this.now, expiresAt: this.expiresAt,
        execution: "sample", safeNextAction: "wait", allowedActions: ["open_handoff", "cancel"],
        returnContext: { venueId: HARVEY_VENUE, focus: "offer" },
        consent: { version: this.config.consentVersion, digest: fixtureDigest, acceptedAt: this.now },
        identity: null, credential: null, presentation: null, proposal: null, delegation: null,
        agent: null, fulfillment: null, chain: null, error: null,
      }
      await send(this.operation); return
    }
    if (path === `/operations/${OPERATION_ID}` && request.method() === "GET") { await send(this.operation); return }
    if (path === `/operations/${OPERATION_ID}/evidence`) {
      await send({ fixtureOnly: true, provenance: "BROWSER_FIXTURE_NOT_PROVIDER_EVIDENCE", actualTransactions: 0, operationId: OPERATION_ID, fulfillment: this.operation?.fulfillment, chain: this.operation?.chain }); return
    }
    const action = path.startsWith(`/operations/${OPERATION_ID}/`) ? path.slice(`/operations/${OPERATION_ID}/`.length) : ""
    const op = this.operation
    if (!op) { this.unexpectedRequests.push(path); await send({ error: { code: "fixture_missing_operation" } }, 409); return }
    const requirePhase = (phase: Phase) => expect(op.phase, `Fixture API phase for ${action}`).toBe(phase)
    switch (action) {
      case "identity/start": {
        requirePhase("identity")
        await send(this.advance("identity", { identity: {
          evidenceId: "fixture-identity", subjectRef: "fixture-person", source: "cx_mobile_id", mode: "mock", provider: "browser-fixture",
          personVerified: false, adultVerified: null, verifiedAt: this.now, expiresAt: this.expiresAt,
          providerTransactionRef: "SIMULATION", handoff: { kind: "mock", label: "BROWSER FIXTURE · SIMULATION", expiresAt: this.expiresAt },
        } })); return
      }
      case "identity/complete": {
        requirePhase("identity")
        expect(body?.sample).toMatchObject({ outcome: "verified" })
        expect(op.identity?.handoff?.kind).toBe("mock")
        await send(this.advance("issuance", { identity: { ...op.identity!, personVerified: true } })); return
      }
      case "credential/issue": {
        requirePhase("issuance")
        expect(body?.publicKeyPem).toEqual(expect.stringContaining("BEGIN PUBLIC KEY"))
        const result = this.advance("issuance", { credential: {
          credentialRef: "fixture-credential", vcId: "fixture-vc", schema: "KPassHackathonCredential/v1", mode: "mock",
          issuerDid: "did:fixture:issuer", holderBinding: fixtureDigest, serviceAccess: ["redeem_demo_entitlement"],
          validFrom: this.now, validUntil: this.expiresAt, statusRef: "fixture-status", status: "active", holderAckAt: null,
        } })
        await send({ result, vc: { fixtureOnly: true, credentialSubject: { schemaVersion: 1, personVerified: true, serviceAccess: ["redeem_demo_entitlement"], validUntil: this.expiresAt, policyVersion: 1, statusRef: "fixture-status" } }, offer: null }); return
      }
      case "credential/holder-ack": {
        requirePhase("issuance")
        expect(body?.signatureB64).toEqual(expect.any(String))
        await send(this.advance("presentation", { credential: { ...op.credential!, holderAckAt: this.now } })); return
      }
      case "presentation/request": {
        requirePhase("presentation")
        const result = this.advance("presentation", { presentation: {
          presentationId: "fixture-presentation", nonce: "fixture-nonce", requestDigest: fixtureDigest,
          requestedClaims: ["schemaVersion", "personVerified", "serviceAccess", "validUntil", "policyVersion", "statusRef"],
          expiresAt: this.expiresAt, submittedAt: null, verifiedAt: null, decision: null,
          decisionRef: null, decisionExpiresAt: null, decisionConsumedAt: null, denyReason: null,
        } })
        await send({ result, challenge: "fixture-challenge" }); return
      }
      case "presentation/submit": {
        requirePhase("presentation")
        expect(body).toMatchObject({ presentationId: "fixture-presentation", disclosed: { personVerified: true } })
        await send(this.advance("proposal", { presentation: { ...op.presentation!, submittedAt: this.now, verifiedAt: this.now, decision: "allow", decisionRef: "fixture-decision", decisionExpiresAt: this.expiresAt } })); return
      }
      case "presentation/deny": {
        requirePhase("presentation")
        await send(this.advance("cancelled", { status: "cancelled", safeNextAction: "return" })); return
      }
      case "proposal": {
        requirePhase("proposal")
        const language: Locale = body?.locale === "ja" ? "ja" : body?.locale === "ko" ? "ko" : "en"
        await send(this.advance("delegation", { proposal: {
          proposalId: "fixture-proposal", mode: "rule", model: "browser-fixture", promptVersion: "fixture-v1", policyVersion: 1,
          inputDigest: fixtureDigest, outputDigest: fixtureDigest, proposalDigest: fixtureDigest, createdAt: this.now,
          guard: { injectionSuspected: false, schemaValid: true },
          output: { action: "redeem_demo_entitlement", target: { venueId: HARVEY_VENUE, campaignId: HARVEY_CAMPAIGN },
            title: this.config.campaign.title[language], summary: this.config.campaign.description[language],
            rationale: "BROWSER FIXTURE · no provider or chain execution", language },
        } })); return
      }
      case "delegation/prepare": {
        requirePhase("delegation")
        expect(body).toMatchObject({ signer: "demo", approvedProposalDigest: fixtureDigest })
        expect(body?.walletProof).toMatchObject({ message: `ondo-hk-wallet-proof:${OPERATION_ID}:fixture-decision` })
        const userAddress = String(body?.userAddress)
        const result = this.advance("delegation", { delegation: {
          delegationId: "fixture-delegation", status: "awaiting_signature", intentRef: "fixture-intent",
          actionCommitment: fixtureDigest, consentCommitment: fixtureDigest, userAddress, signer: "demo", recipient: userAddress,
          expiresAtMs: Date.now() + 600_000,
          entitlement: { objectId: "fixture-entitlement", version: "1", digest: fixtureDigest, txDigest: "fixture-issue-not-broadcast" },
          grant: null, txBytesDigest: fixtureDigest, userTxDigest: null, error: null,
        } })
        await send({ result, txBytesB64 }); return
      }
      case "delegation/submit": {
        requirePhase("delegation")
        expect(body?.userSignature).toEqual(expect.any(String))
        await send(this.advance("agent", { delegation: { ...op.delegation!, status: "delegated", grant: { objectId: "fixture-grant", initialSharedVersion: "1", txDigest: "fixture-grant-not-broadcast" }, userTxDigest: "fixture-user-not-broadcast" } })); return
      }
      case "agent/run": {
        requirePhase("agent")
        await send(this.advance("fulfillment", { agent: {
          dispatchId: "fixture-dispatch", status: "executed", decisionCommitment: fixtureDigest, manifestCommitment: fixtureDigest,
          manifest: { fixtureOnly: true }, txDigest: "fixture-agent-not-broadcast", recordId: "fixture-record",
          verified: { effectsOk: true, eventOk: true, grantUses: 1, checkedAt: this.now }, error: null,
        }, fulfillment: { status: "pending", reason: null, redemptionRef: null, redeemedAt: null, recheck: null } })); return
      }
      case "redeem": {
        requirePhase("fulfillment")
        await send(this.advance("done", { status: "succeeded", safeNextAction: "check_status",
          fulfillment: { status: "redeemed", reason: null, redemptionRef: "fixture-use-not-real", redeemedAt: this.now, recheck: { credential: "active", presentation: "allow", sui: "fixture", campaign: "fixture" } },
          chain: { outboxId: "fixture-outbox", eventKey: "fixture-event", payloadCommitment: fixtureDigest, status: "pending", txHash: null, blockNumber: null, attempts: 0, lastError: null, confirmedAt: null },
        })); return
      }
      case "reconcile": {
        requirePhase("done")
        await send(this.advance("done", { safeNextAction: "return", chain: { ...op.chain!, status: "confirmed", txHash: "fixture-audit-not-broadcast", blockNumber: 1, attempts: 1, confirmedAt: this.now } })); return
      }
      case "cancel": {
        expect(["identity", "issuance", "presentation", "proposal", "delegation"]).toContain(op.phase)
        await send(this.advance("cancelled", { status: "cancelled", safeNextAction: "return" })); return
      }
      default: this.unexpectedRequests.push(path); await send({ error: { code: "fixture_unhandled_path", message: path } }, 404)
    }
  }
}

export const test = base.extend<{ harvey: HarveyFixture }>({
  harvey: async ({ page, baseURL }, use, testInfo) => {
    if (!baseURL) throw new Error("A dedicated local Harvey baseURL is required")
    const url = new URL(baseURL)
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("Harvey fixture tests must never target a remote deployment")
    const fixture = new HarveyFixture(page, url.origin)
    await fixture.install()
    await use(fixture)
    await testInfo.attach("fixture-provenance", { contentType: "application/json", body: JSON.stringify({
      fixtureOnly: true, actualTransactions: 0, providerVerification: false,
      requests: fixture.calls.map(({ method, path }) => ({ method, path })),
      finalPhase: fixture.operation?.phase ?? "not-started", finalChainFixtureStatus: fixture.operation?.chain?.status ?? null,
    }, null, 2) })
    expect(fixture.forbiddenRequests, "No provider requests or unmocked mutations").toEqual([])
    expect(fixture.unexpectedRequests, "Every integration API call must have an explicit fixture").toEqual([])
    expect(fixture.pageErrors, "No unhandled browser errors").toEqual([])
  },
})

export { expect }
