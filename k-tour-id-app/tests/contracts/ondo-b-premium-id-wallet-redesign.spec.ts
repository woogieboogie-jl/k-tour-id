import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { expect, test } from "@playwright/test"

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8")

test("B-PREMIUM-ID-001 Travel Pass exposes four independent readiness states", () => {
  const identity = source("features/ondo/identity-b/traveler-id-entry-b.tsx")

  for (const testId of [
    "traveler-id-account",
    "traveler-id-person",
    "traveler-id-age",
    "traveler-id-payment",
  ]) {
    expect(identity).toContain(`data-testid=\"${testId}\"`)
  }
  expect(identity).toContain("Travel Pass")
  expect(identity).toContain("Person")
  expect(identity).toContain("19+")
  expect(identity).toContain("Payment")
  expect(identity).toContain("Person does not prove 19+")
  expect(identity).toContain("19+ does not prove identity")
})

test("B-PREMIUM-ID-002 eligibility has a consumer flow and DOM-free QA injection", () => {
  const check = source("features/ondo/identity-b/local-check-walkthrough-b.tsx")

  expect(check).toContain('type Phase = "account" | "route" | "consent" | "processing" | "result"')
  expect(check).toContain('data-testid="direct-person-account"')
  expect(check).toContain('data-testid="direct-person-route"')
  expect(check).toContain("Verify and continue")
  expect(check).toContain("readQaRuntime<{ eligibility?: LocalCheckOutcome }>()")
  expect(check).not.toContain('data-testid="local-check-outcome-success"')
  expect(check).not.toContain('data-testid="local-check-outcome-failure"')
  expect(check).not.toContain('data-testid="local-check-outcome-unavailable"')
  expect(check).not.toContain('data-testid="local-check-outcome-expired"')
})

test("B-PREMIUM-WALLET-001 wallet is a consumer dashboard, not a merchant scenario runner", () => {
  const commerce = source("features/ondo/commerce-b/id-wallet-commerce-b.tsx")

  for (const testId of [
    "wallet-balance",
    "wallet-benefit",
    "wallet-activity",
    "wallet-privacy",
  ]) {
    expect(commerce).toContain(`data-testid=\"${testId}\"`)
  }
  expect(commerce).toContain("OOKRW")
  expect(commerce).toContain('benefits: "Place benefit"')
  expect(commerce).toContain("Purchases & refunds")
  expect(commerce).toContain('<details className={styles.truth}><summary>{copy.technical}</summary><p>{copy.technicalBody}</p></details>')
  expect(commerce).toContain("readQaRuntime<QaRuntime>()")
  expect(commerce).not.toContain('data-testid="wallet-link-ready"')
  expect(commerce).not.toContain('data-testid="wallet-link-failed"')
  expect(commerce).not.toContain('data-testid="payment-outcomes"')
  expect(commerce).not.toContain('data-testid="payment-ledgers"')
  expect(commerce).not.toContain('data-testid="commerce-outcomes"')
  expect(commerce).not.toContain('data-testid="commerce-ledgers"')
  expect(commerce).not.toContain('data-testid="commerce-reconciliation"')
  for (const retiredEvidence of [
    "wallet-link-ready",
    "wallet-link-failure",
    "payment-outcome-failure",
    "payment-outcome-insufficient",
    "holder-settlement-mirror",
    "merchant-settlement-mirror",
  ]) expect(commerce).not.toContain(`\"${retiredEvidence}\"`)
})

test("B-PREMIUM-PAY-001 contextual payment keeps model outcomes but hides them from normal UI", () => {
  const commerce = source("features/ondo/commerce-b/id-wallet-commerce-b.tsx")
  const model = source("features/ondo/commerce-b/stable-commerce-model-b.ts")

  expect(commerce).toContain("readQaRuntime<QaRuntime>()")
  expect(commerce).toContain("Use ${amount} travel balance")
  expect(commerce).toContain('refund: "Restore balance"')
  expect(commerce).toContain("data-return-to")
  expect(model).toContain('type StableCommerceBOutcome = "success" | "failure" | "insufficient"')
  expect(model).toContain('case "CONFIRM"')
  expect(model).toContain('case "PAYMENT_RETURN"')
  expect(model).toContain('case "REFUND"')
})

test("B-PREMIUM-PAY-002 wallet readiness, balance, receipts, and refunds share one session state", () => {
  const provider = source("features/ondo/shared/state/ondo-b-provider.tsx")
  const commerce = source("features/ondo/commerce-b/id-wallet-commerce-b.tsx")
  const myKorea = source("features/ondo/my/saved-entry-b.tsx")

  for (const stateField of ["commerceWalletStatus", "commerceSession", "commerceReceipts"]) {
    expect(provider, `missing shared session field ${stateField}`).toContain(stateField)
  }
  for (const action of ["setCommerceWalletStatus", "dispatchCommerce", "recordCommerceReceipt"]) {
    expect(provider, `missing shared session action ${action}`).toContain(action)
  }
  expect(commerce).not.toContain("useReducer")
  expect(commerce).toContain("Set up travel wallet to continue")
  expect(commerce).toContain("Travel balance")
  expect(commerce).toContain('data-testid="wallet-activity-receipt"')
  expect(commerce).toContain('<CommerceRefundsB key={order.orderId} locale={locale} scope="wallet" reviewMode={reviewMode} />')
  const refunds = source("features/ondo/commerce-b/commerce-refunds-b.tsx")
  expect(refunds).toContain('data-testid={`${scope}-refund-submit`}')
  expect(refunds).toContain('data-testid={`${scope}-refund-all`}')
  expect(refunds).toContain('type: "REFUND_REQUEST"')
  expect(commerce).not.toContain('data-testid="wallet-activity-refund"')
  expect(myKorea).toContain('data-testid="my-korea-receipts"')
  expect(provider).toContain("sanitizeCommerceReceipts")
})

test("B-PREMIUM-POLISH-001 first-frame consumer copy stays product-shaped while details retain truth", () => {
  const commerce = source("features/ondo/commerce-b/id-wallet-commerce-b.tsx")
  const tables = source("features/ondo/connect/tables-entry-b.tsx")
  const place = source("features/ondo/place/canonical-place-overlay.tsx")
  const myKorea = source("features/ondo/my/saved-entry-b.tsx")
  const timeline = source("features/ondo/shared/time/product-timeline-b.ts")

  expect(commerce).toContain('voucherBody: (minimum: string, expiry: string) => `${minimum} minimum met · valid through ${expiry}`')
  expect(commerce).toContain('voucherBody: (minimum: string, expiry: string) => `${minimum} 최소 금액 충족 · ${expiry}까지`')
  expect(commerce).toContain("copy.voucherBody(formatKrw(order.grossKrw, locale), productTimeline.benefitExpiry[locale])")
  expect(commerce).toContain("Your place purchases and their refunds appear here. Top-ups are separate.")
  expect(commerce).toContain("장소별 구매와 해당 환불을 확인하세요. 충전 내역은 별도예요.")
  expect(commerce).toContain('balanceEquivalent: "Estimated in USD"')
  expect(commerce).toContain('technical: "Balance details"')
  expect(commerce).toContain('digital: "Stablecoins"')
  expect(commerce).toContain("USDC · USDT → travel balance")
  expect(commerce).toContain("Travel balance is displayed in KRW. Stablecoin funding has its own asset, network and transfer steps.")
  expect(commerce).toContain("OOKRW is a separate settlement test-token concept, not redeemable won.")
  expect(commerce).not.toContain('data-testid="commerce-device-balance-boundary"')
  expect(commerce).toContain('data-testid="commerce-payment-details"')
  expect(commerce).toContain('data-testid="commerce-settlement-details"')
  expect(commerce).toContain('connect: "Set up travel wallet"')
  expect(commerce).not.toContain('data-testid="wallet-non-live-boundary"')
  expect(commerce).toContain('originalPayment: "Original balance record"')
  expect(commerce).toContain('refundReference: "Restore reference"')
  expect(commerce).not.toContain("Eligible today")
  expect(commerce).not.toContain("이 세션의 결제와 환불")

  expect(timeline).toContain("function tableScheduleLabels(tableStartsAtMs: number): TimelineLabels")
  expect(timeline).toContain("stale build never opens on a past Table")
  expect(tables).toContain("tableClockNow < tableStartsAtMs")
  expect(tables).toContain("const activeTableTimeline = ondoBTableTimeline(activeTable, productTimeline, locale)")
  expect(tables).toContain("schedule={activeTableTimeline.schedule}")
  expect(tables).toContain("const pending = returnTo")
  expect(tables).toContain("expireJoinAtMutation(pending)")
  expect(tables).toContain('data-table-state={cardUpcoming ? "TABLE-OPEN" : "TABLE-CLOSED"}')
  expect(tables).toContain("This meal plan has ended")
  expect(tables).not.toContain('eyebrow: "Tonight in Seoul"')
  expect(place).toContain("ondoBTableTimeline(placeTable, productTimeline, locale).schedule")
  expect(myKorea).toContain("const sourceTable = ondoBTableById(reference.tableId)")
  expect(myKorea).toContain("schedule: ondoBTableTimeline(sourceTable, productTimeline, locale).schedule")
  expect(myKorea).not.toContain("schedule: productTimeline.tableSchedule[locale]")
  expect(place).toContain("LOCALDATA place information")
  expect(place).not.toContain('active: "Official LOCALDATA record"')
})
