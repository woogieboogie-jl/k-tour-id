import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { expect, test } from "@playwright/test"
import {
  createStableCommerceBState,
  createStableCommerceBLockedQuote,
  stableCommerceBReducer,
  stableCommerceBalanceB,
  STABLE_B_OPENING_BALANCE,
} from "../../features/ondo/commerce-b/stable-commerce-model-b"
import {
  createLabsBridgeQuote,
  isLabsBridgeQuote,
  readLabsBadgeReview,
  readLabsBridgeReview,
  readLabsWalletReview,
} from "../../features/ondo/labs/labs-review-truth-b"

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8")

const COMMERCE = "features/ondo/commerce-b/id-wallet-commerce-b.tsx"
const VISIT = "features/ondo/commerce-b/visit-stamp-receipt-b.tsx"
const LABS = "features/ondo/labs/labs-entry.tsx"
const LABS_REVIEW = "features/ondo/labs/labs-review-truth-b.ts"
const COMMERCE_CSS = "features/ondo/commerce-b/id-wallet-commerce-b.module.css"
const VISIT_CSS = "features/ondo/commerce-b/visit-stamp-receipt-b.module.css"
const LABS_CSS = "features/ondo/labs/labs.module.css"
const PROVIDER = "features/ondo/shared/state/ondo-b-provider.tsx"
const ACTION_GATE = "features/ondo/identity-b/action-gate-coordinator-b.tsx"

test("Wave 1 commerce keeps money unchanged before an explicit successful return", () => {
  const initial = createStableCommerceBState()
  const accepted = stableCommerceBReducer(initial, { type: "ACCEPT_BENEFIT" })
  const quote = createStableCommerceBLockedQuote(accepted, new Date("2026-08-28T03:15:00.000Z"))
  const confirmed = stableCommerceBReducer(accepted, { type: "CONFIRM", quote })

  expect(stableCommerceBalanceB(initial)).toBe(STABLE_B_OPENING_BALANCE)
  expect(stableCommerceBalanceB(accepted)).toBe(STABLE_B_OPENING_BALANCE)
  expect(stableCommerceBalanceB(confirmed)).toBe(STABLE_B_OPENING_BALANCE)
  expect(confirmed.ledger).toEqual([])

  const failed = stableCommerceBReducer(confirmed, { type: "PAYMENT_RETURN", outcome: "failure" })
  expect(stableCommerceBalanceB(failed)).toBe(STABLE_B_OPENING_BALANCE)
  expect(failed.ledger).toEqual([])
  expect(failed.lockedQuote).toEqual(quote)

  const reconfirmed = stableCommerceBReducer(failed, { type: "CONFIRM", quote })
  const paid = stableCommerceBReducer(reconfirmed, { type: "PAYMENT_RETURN", outcome: "success" })
  expect(stableCommerceBalanceB(paid)).toBeLessThan(STABLE_B_OPENING_BALANCE)
  expect(paid.receiptCount).toBe(1)
})

test("Wave 1 consumer payment uses KRW/USD and explicit stablecoin samples remain separate from provider-backed funding", () => {
  const commerce = source(COMMERCE)

  expect(commerce).toContain('balance: "Travel balance"')
  expect(commerce).toContain('bank: "Bank account"')
  expect(commerce).toContain('card: "Card · Apple Pay"')
  expect(commerce).toContain('digital: "Stablecoins"')
  expect(commerce).toContain("USDC · USDT → travel balance")
  expect(commerce).toContain('asset: "KRW"')
  expect(commerce).toContain('testQuote: "Price in USD"')
  expect(commerce).toContain('const [draftSource, setDraftSource]')
  expect(commerce).toContain('onChange={() => { if (!closing) { setDraftSource(id); setSaveError(false) } }}')
  expect(commerce).not.toContain('onChange={() => onSelect(id)}')
  expect(commerce).toContain('onSelect(draftSource)')
  expect(commerce).toContain('data-testid="funding-provider-required"')
  expect(commerce).toContain('localActual("travel_wallet_shell"')
  expect(commerce).toContain('const fundingAvailable = reviewMode && fundingSource === "travel_balance" && walletStatus === "ready"')
  expect(commerce).toContain('if (!reviewMode) return')
  expect(commerce).toContain('data-testid="wallet-funding-primary"')
  expect(commerce).toContain('aria-label={fundingCopy.chooseFunding}')
  expect(commerce).not.toContain("Travel Wallet isn’t connected yet")
  expect(commerce).not.toContain("여행 지갑은 아직 연결 전이에요")
  expect(commerce).not.toContain("旅のウォレットはまだ接続されていません")
  expect(commerce).toContain('<details className={styles.truth}><summary>{copy.technical}</summary><p>{copy.technicalBody}</p></details>')
  expect(commerce).toContain("Travel balance is displayed in KRW. Stablecoin funding has its own asset, network and transfer steps.")
  expect(commerce).toContain("OOKRW is a separate settlement test-token concept, not redeemable won.")
  expect(commerce).toContain('estimateBasis: "Estimate · ₩1,350 = US$1 · Aug 19, 2026"')
  expect(commerce).toContain('estimateBasis: "예상값 · ₩1,350 = US$1 · 2026. 8. 19."')
  expect(commerce).toContain('estimateBasis: "概算・₩1,350 = US$1・2026/8/19"')
  expect(commerce).toContain('<div className={styles.quoteTotal}><span>{copy.total}</span><strong>{formatKrwFromSettlementUnits(debit, locale)}</strong></div>')
  expect(commerce).not.toContain('<small>{copy.asset}</small>')
})

test("Wave 1 result separates receipt, visit and stamp while showing the balance consequence", () => {
  const commerce = source(COMMERCE)
  const visit = source(VISIT)
  const journey = source("features/ondo/commerce-b/journey-visit-b.tsx")

  expect(commerce).toContain('receipt: "Balance-use record"')
  expect(commerce).toContain("receiptBalanceDelta")
  expect(commerce).toContain("balanceAfterUse")
  expect(commerce).toContain('data-testid="payment-receipt"')
  expect(commerce).toContain('<JourneyVisitEntryB key={`journey-${venueId}`} locale={locale} venueId={venueId} context="receipt" />')
  expect(journey).toContain('<VisitStampReceiptB locale={locale} venueId={venueId} active={open && presence.phase === "open"} />')
  expect(commerce).not.toContain("recordUniqueVisit")
  expect(journey).not.toContain("recordUniqueVisit")
  expect(visit).toContain("if (!reviewMode) return")
  expect(visit).toContain("if (!reviewMode || !activeRef.current || checking) return")
  expect(visit).toContain("if (!activeRef.current) return")
  expect(visit).toContain("window.cancelAnimationFrame(proofFrameRef.current)")
  expect(visit).toContain('data-testid="visit-proof-check"')
  expect(visit).toContain("recordUniqueVisit")
  expect(visit).toContain("reviewMode || recorded")
  expect(visit).toContain('data-testid="visit-review-provenance"')
  expect(visit).toContain("recorded ? (")
})

test("Wave 1 Labs keeps providerless truth, separate typed assets and one-shot gated badge mutation", () => {
  const labs = source(LABS)

  expect(labs).toContain("Sui Testnet → OmniOne")
  expect(labs).toContain('"No real assets move"')
  expect(labs).toContain("BRIDGE_PHASE_ORDER.map")
  expect(labs).toContain('data-testid="labs-target-truth"')
  expect(labs).toContain('text("자산", "Assets", "資産")')
  expect(labs).toContain('"Each asset stays separate"')
  expect(labs).not.toContain("stored.bridge === \"BRG-PENDING\" ? \"BRG-FAILED\"")
  expect(labs).toContain('text("경로 계속", "Continue route", "経路を続ける")')
  expect(labs).toContain('type LabsAssetVisualState = "available" | "reserved" | "pending" | "stale" | "error"')
  expect(labs).toContain("data-asset-state={assetState}")
  expect(labs).toContain('if (provider === "b" && !reviewEnabled)')
  expect(labs).toContain('providerUnavailable("funding")')
  expect(labs).toContain("createBBadgeActionReturn")
  expect(labs).toContain("consumePendingBActionAtMutation")
  expect(labs).toContain("finalizeConsumedBAction")
  expect(labs).toContain('consumed.cta !== "MINT_BADGE"')
  expect(labs).not.toContain("data-testid=\"labs-explorer-link\"")
})

test("Wave 1 Labs freezes the reviewed route and cannot settle a mismatch or an untyped result", () => {
  const labs = source(LABS)
  const labsReview = source(LABS_REVIEW)

  expect(labsReview).toContain("type LabsBridgeQuote = Readonly")
  expect(labsReview).toContain("return Object.freeze")
  expect(labs).toContain("const bridgeQuoteRef = useRef<LabsBridgeQuote | null>(null)")
  expect(labs).toContain("const bridgeExecutionRef = useRef<ReviewFixtureExecution<LabsBridgeReviewValue> | null>(null)")
  expect(labs).toContain('if (mismatch || !isCurrentLabsBridgeQuote(quote))')
  expect(labs).toContain('if (mismatch || (provider === "b" && !bridgeExecutionRef.current))')
  expect(labs).toContain('bridgeExecutionRef.current?.result !== "FIXTURE_SUCCESS"')
  expect(labs).toContain('disabled={mismatch} data-testid="labs-bridge-confirm"')
  expect(labs).toContain('disabled={mismatch} data-testid="labs-bridge-submit"')
  expect(labs).toContain('disabled={mismatch} data-testid="labs-bridge-advance"')
  expect(labs).toContain('data-review-provenance="simulated"')
  for (const truth of [
    "Target network: Sui Testnet · Simulated",
    "대상 네트워크: Sui Testnet · 시뮬레이션",
    "対象ネットワーク：Sui Testnet · シミュレーション",
  ]) expect(labs.match(new RegExp(truth.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))).toHaveLength(1)
  expect(labs).toContain("Review fixture · Simulated · balances and transactions unchanged")
})

test("Wave 1 Labs restores review outcomes only with typed success provenance", () => {
  const labs = source(LABS)
  const labsReview = source(LABS_REVIEW)

  for (const receipt of ["walletReview", "bridgeReview", "badgeReview"]) {
    expect(labs).toContain(`${receipt}:`)
  }
  for (const truth of [
    'record.mode !== "review"',
    'record.executionTruth !== "FIXTURE_REVIEW"',
    'record.provenanceTruth !== "SIMULATED"',
    'record.result !== "FIXTURE_SUCCESS"',
    'record.externalProviderConnected !== false',
    'record.externalEffect !== "none"',
  ]) expect(labsReview).toContain(truth)
  expect(labs).toContain('const bWalletReady = provider === "b" && qaControls && stored.wallet === "WAL-READY" && stored.walletReview != null')
  expect(labs).toContain('const bridgeNeedsReview = stored.bridge === "BRG-PENDING" || stored.bridge === "BRG-SIMULATED-SUCCESS"')
  expect(labs).toContain('const bBridgeReady = bWalletReady && (!bridgeNeedsReview || stored.bridgeReview != null)')
  expect(labs).toContain('provider !== "b" || stored.mint !== "NFT-MINTED" || stored.badgeReview')
  expect(labs).toContain('setWalletReview(execution.result === "FIXTURE_SUCCESS" ? execution : null)')
  expect(labs).toContain('setBridgeReview(execution.result === "FIXTURE_SUCCESS" ? execution : null)')
  expect(labs).toContain("setBadgeReview(execution)")
  expect(labs).toContain('data-testid="labs-wallet-review-provenance" data-review-provenance="simulated"')
  expect(labs).toContain('data-review-provenance={provider === "b" && bridgeReview ? "simulated" : undefined}')
  expect(labs).toContain('data-review-provenance={provider === "b" && badgeReview ? "simulated" : undefined}')
  expect(labs).toContain("function disconnectWallet()")
})

test("Wave 1 Labs rejects extra fields at every review and bridge quote boundary", () => {
  const recordedAt = new Date().toISOString()
  const common = {
    mode: "review",
    executionTruth: "FIXTURE_REVIEW",
    provenanceTruth: "SIMULATED",
    result: "FIXTURE_SUCCESS",
    externalProviderConnected: false,
    externalEffect: "none",
    recordedAt,
  } as const
  const wallet = { ...common, fixtureId: "FX-LABS-WALLET-SUCCESS", value: { address: "0x8a71…4d2c" } }
  expect(readLabsWalletReview(wallet)).not.toBeNull()
  expect(readLabsWalletReview({ ...wallet, hiddenProviderResult: "accepted" })).toBeNull()
  expect(readLabsWalletReview({ ...wallet, value: { ...wallet.value, holder: "private" } })).toBeNull()

  const quote = createLabsBridgeQuote(Date.now() + 60_000)
  expect(isLabsBridgeQuote(quote)).toBe(true)
  expect(isLabsBridgeQuote({ ...quote, hiddenRouteId: "private" })).toBe(false)
  const bridge = {
    ...common,
    fixtureId: "FX-LABS-BRIDGE-SUCCESS",
    value: { route: "sui-testnet-to-omnione", quote },
  }
  expect(readLabsBridgeReview(bridge)).not.toBeNull()
  expect(readLabsBridgeReview({ ...bridge, value: { ...bridge.value, providerPayload: {} } })).toBeNull()
  expect(readLabsBridgeReview({ ...bridge, value: { ...bridge.value, quote: { ...quote, privateMemo: "x" } } })).toBeNull()

  const badge = { ...common, fixtureId: "FX-BADGE-SUCCESS", value: { badge: "travel-keepsake" } }
  expect(readLabsBadgeReview(badge)).not.toBeNull()
  expect(readLabsBadgeReview({ ...badge, value: { ...badge.value, owner: "private" } })).toBeNull()
})

test("Wave 1 payment review is visible, exact-return checked twice, and providerless use requires explicit sample opt-in", () => {
  const coordinator = source(ACTION_GATE)

  expect(coordinator).toContain('data-testid={gate === "person" ? "ondo-b-local-check-walkthrough" : gate === "age" ? "after19-walkthrough" : gate === "payment_kyc" ? "payment-check-walkthrough" : undefined}')
  expect(coordinator).toContain('paymentProcessingTitle: "Checking payment readiness…"')
  expect(coordinator).toContain('paymentSuccessTitle: "Payment review result ready"')
  expect(coordinator).toContain('data-testid="payment-review-scope"')
  expect(coordinator.match(/hashBActionReturnTo\(latest\.pending\) === hashBActionReturnTo\(pending\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
  expect(coordinator.match(/activeGate !== "payment_kyc" \|\| view !== "(processing|success)"/g)).toHaveLength(2)
  expect(coordinator).toMatch(/activeGate !== "payment_kyc" \|\| view !== "success"[\s\S]*createBActionReviewAxis\("payment_kyc", staged\.execution, now\)[\s\S]*!payment \|\| !commit\(\{ \.\.\.latest, payment, outcome: null \}\)/)
  expect(coordinator).toContain('const sampleProviderUnavailable = (gate === "person" || gate === "age" || gate === "payment_kyc") && resolvedView === "unavailable" && !reviewMode')
  expect(coordinator).toContain('data-testid="action-gate-sample-continue"')
  expect(coordinator).toContain('if (!enterReviewSample()) return')
})

test("Wave 1 checkout revalidates the complete live plan and keeps private quote fields out of the DOM", () => {
  const commerce = source(COMMERCE)

  expect(commerce).toContain('const returnTo = JSON.stringify({ cta: "START_CHECKOUT", venueId: originVenueId })')
  expect(commerce).not.toMatch(/data-return-to=\{[^}]*offerId/)
  expect(commerce).toContain("const terminalPolicyRef = useRef")
  for (const guard of [
    'live.walletStatus !== "ready"',
    'live.fundingSource !== "travel_balance"',
    "!live.consent",
    'live.account !== "ACC-ACTIVE"',
    "currentCommerce.confirmationPending !== true",
    "!isStableCommerceBLockedQuote(quoteContext.quote, now)",
    'quoteContext.quote.fundingSource !== "travel_balance"',
    "currentBenefitMode !== quoteContext.quote.benefitMode",
    'quoteContext.quote.benefitMode === "ktour" && liveBenefitPolicy.status !== "recommended"',
    "stableCommerceBalanceB(currentCommerce) < quoteContext.quote.finalDebit",
    "!sameStableCommerceBLockedQuote(currentQuote, quoteContext.quote)",
  ]) expect(commerce).toContain(guard)
  expect(commerce).toContain("finalizeConsumedBActionWithMutation(")
  const atomicBoundary = commerce.indexOf("const finalized = finalizeConsumedBActionWithMutation(")
  const productCommit = commerce.indexOf('() => actions.dispatchCommerce({ type: "PAYMENT_RETURN", outcome })', atomicBoundary)
  const completionEvent = commerce.indexOf("window.dispatchEvent(new CustomEvent(B_ACTION_GATE_COMPLETE_EVENT", atomicBoundary)
  const successView = commerce.indexOf('setView("receipt")', atomicBoundary)
  expect(atomicBoundary).toBeGreaterThan(-1)
  expect(productCommit).toBeGreaterThan(atomicBoundary)
  expect(completionEvent).toBeGreaterThan(productCommit)
  expect(successView).toBeGreaterThan(completionEvent)
  expect(commerce.slice(atomicBoundary, completionEvent)).toContain('if (!finalized)')
})

test("Wave 1 review payment provenance is session-only and cannot hydrate a production-looking paid wallet", () => {
  const provider = source(PROVIDER)
  const commerce = source(COMMERCE)

  expect(provider).toContain('executionTruth: "FIXTURE_REVIEW"')
  expect(provider).toContain("provenanceTruth: REVIEW_PROVENANCE_TRUTH")
  expect(provider).toContain('receipt.executionTruth !== "FIXTURE_REVIEW" || receipt.provenanceTruth !== REVIEW_PROVENANCE_TRUTH')
  expect(provider).toMatch(/function deviceState[\s\S]*commerceReceipts:\s*\[\]/)
  expect(provider).toMatch(/const next: OndoBState = \{[\s\S]*commerceReceipts:\s*\[\],[\s\S]*commerceWalletStatus:\s*"disconnected",[\s\S]*commerceSession:\s*createStableCommerceBState\(\)/)
  expect(commerce).toContain('data-testid="payment-review-provenance"')
  expect(commerce).toContain('data-review-provenance="review"')
  expect(commerce).toContain('data-testid="wallet-review-provenance"')
  expect(commerce).toContain('const walletStatus: OndoBCommerceWalletStatus = state.commerceWalletStatus')
  // KRW is now the primary amount. Keep sample provenance visible; USD/OOKRW
  // explanation is a tap/keyboard-accessible detail, not a live-balance claim.
  expect(commerce).toContain('walletStatus === "ready" && reviewMode ? <small className={styles.balanceReview}')
  expect(commerce).toContain('<details className={styles.privacy} data-testid="wallet-balance-info">')
  expect(commerce).toContain('{FUNDING_COPY[locale].technicalBody}</p></details>')
  expect(commerce).toContain('const visibleBalance = reviewMode ? balance : 0')
})

test("Wave 1 merchant traits remain per-condition facts with explicit states", () => {
  const labs = source(LABS)
  const labsCss = source(LABS_CSS)

  for (const state of ["eligible", "ineligible", "unknown", "loading", "stale", "error"]) {
    expect(labs).toContain(`\"${state}\"`)
  }
  expect(labs).toContain('const positive = statusKey === "eligible"')
  expect(labs).toContain('statusKey === "ineligible"')
  expect(labs).toContain("? CircleMinus")
  expect(labs).toContain("? Clock3")
  expect(labs).toContain("? LoaderCircle")
  expect(labs).toContain("? AlertTriangle")
  expect(labs).not.toContain('trait.result === "eligible" || trait.result === "ineligible"')
  expect(labsCss).toContain('.traitHeading em[data-status="eligible"]')
  expect(labsCss).toContain('.traitHeading em[data-status="ineligible"]')
  expect(labsCss).not.toContain('.traitHeading em[data-status="confirmed"]')
  expect(labs).toContain("data-trait-status={statusKey}")
  expect(labs).toContain("traitDetails")
  expect(labs).toContain("never combined into a score")
  expect(labs).toContain('providerUnavailable("credential")')
  expect(labs).not.toContain('text("계약 명세만 제공", "CONTRACT ONLY", "契約仕様のみ")}</p></div></div>\n          {TRAIT_FIXTURES')
})

test("Wave 1 mobile decision zones reserve space and keep accessibility fallbacks", () => {
  const commerce = source(COMMERCE)
  const commerceCss = source(COMMERCE_CSS)
  const visitCss = source(VISIT_CSS)
  const labsCss = source(LABS_CSS)

  expect(commerceCss).toMatch(/@media \(max-width: 699px\)[\s\S]*?\.offerBody\s*\{[\s\S]*?padding:\s*10px 11px calc\(138px \+ env\(safe-area-inset-bottom\)\)/)
  expect(commerceCss).toContain(".offerDecision .paymentConsequence { grid-column: 1 / -1; }")
  expect(commerceCss).toContain(".offerDecision .payButton { grid-column: 1; }")
  expect(commerce).toContain("<Store size={30} aria-hidden=\"true\" />")
  expect(commerceCss).toMatch(/\.offerMark\s*\{[^}]*width:\s*60px;[^}]*height:\s*60px/)
  expect(commerceCss).toMatch(/\.fundingSummary strong\s*\{[^}]*overflow-wrap:\s*anywhere/)
  expect(commerceCss).toMatch(/\.offerBenefit p\s*\{[^}]*display:\s*block;[^}]*overflow:\s*visible/)
  expect(commerceCss).toMatch(/\.fundingOptions small\s*\{[^}]*display:\s*block;[^}]*overflow:\s*visible/)
  expect(commerceCss).not.toMatch(/\.offerHeader span\s*\{[^}]*text-overflow:\s*ellipsis/)
  expect(commerceCss).toContain("bottom: calc(10px + env(safe-area-inset-bottom))")
  expect(commerceCss).toContain("@media (orientation: landscape) and (max-height: 500px)")
  expect(commerceCss).toContain("@media (prefers-reduced-motion: reduce)")
  expect(visitCss).toContain("@media (forced-colors: active)")
  expect(visitCss).toContain("@media (prefers-reduced-motion: reduce)")
  expect(labsCss).toContain("@media (max-width: 360px)")
  expect(labsCss).toMatch(/@media \(max-width: 360px\)[^{]*\{[\s\S]*?\.assetRow\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/)
  expect(labsCss).toMatch(/\.assetRow span\s*\{[^}]*font-size:\s*12px/)
  expect(labsCss).not.toMatch(/\.assetRow[^}]*text-overflow:\s*ellipsis/)
  expect(labsCss).toContain("@media (orientation: landscape) and (max-height: 500px)")
  expect(labsCss).toContain("@media (forced-colors: active)")
  expect(labsCss).toContain("@media (prefers-reduced-motion: reduce)")
  expect(labsCss).toContain(".bridgeTimeline:focus-visible")
})
