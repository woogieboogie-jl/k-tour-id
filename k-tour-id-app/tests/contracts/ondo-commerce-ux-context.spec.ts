import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { expect, test } from "@playwright/test"
import { createFundingRailB, fundingRailTransitionB, readFundingRailB } from "../../features/ondo/commerce-b/funding-rail-model-b"
import { createStableCommerceBState, stableCommerceBalanceB } from "../../features/ondo/commerce-b/stable-commerce-model-b"

const source = (name: string) => readFileSync(resolve(process.cwd(), "features/ondo/commerce-b", name), "utf8")
const commerce = source("id-wallet-commerce-b.tsx")
const funding = commerce.slice(commerce.indexOf("function FundingSourceSheet"), commerce.indexOf("function CanonicalCommerceOfferB"))
const refunds = source("commerce-refunds-b.tsx")

test("UX01 funding purpose separates adding funds from choosing a payment method", () => {
  expect(commerce).toContain('purpose: "topup" | "payment"')
  expect(funding).toContain('.filter(method => purpose !== "topup" || method.id !== "travel_balance")')
  expect(funding).toContain('purpose === "topup" ? copy.topupTitle : copy.title')
  expect(funding).toContain('data-funding-purpose={purpose}')
  for (const id of ["wallet-funding-primary", "wallet-add-funds"]) {
    expect(commerce.split("\n").find(line => line.includes(`data-testid="${id}"`))).toContain('purpose: "topup"')
  }
  expect(commerce.split("\n").find(line => line.includes('data-testid="wallet-funding-change"'))).toContain('purpose: "payment"')
  const paymentConfirmOffset = commerce.indexOf('data-testid="payment-confirm"')
  const paymentConfirm = commerce.slice(commerce.lastIndexOf("<button", paymentConfirmOffset), commerce.indexOf("</button>", paymentConfirmOffset) + "</button>".length)
  expect(paymentConfirm).toContain('shortageKrw > 0 ? (event) => openFundingForQuote(event.currentTarget, "topup")')
  const pay = commerce.slice(commerce.indexOf("function pay("), commerce.indexOf("function retry("))
  expect(pay).toContain('if (shortageKrw > 0 && event)')
  expect(pay).toContain('openFundingForQuote(event.currentTarget, "topup")')
})

test("UX01 already-credited terminal presentation resets without recrediting or erasing the ledger", () => {
  const restore = funding.slice(funding.indexOf("useLayoutEffect(() =>"), funding.indexOf("useLayoutEffect(() =>", funding.indexOf("useLayoutEffect(() =>") + 1))
  expect(restore).toContain('if (restored?.phase === "settled")')
  expect(restore).toContain('state.commerceSession.fundingCredits.some')
  expect(restore).toMatch(/if \(!credited\) \{[\s\S]*removeItem\(FUNDING_RAIL_SESSION_KEY_B\)[\s\S]*\} else \{[\s\S]*restored = null[\s\S]*credited = false/)
  expect(restore).not.toContain("creditSampleFunding(")
  expect(restore).not.toContain("dispatchCommerce(")
  expect(funding).toContain('operationRef.current?.phase !== "settled" || !creditComplete')
})

test("UX01 unresolved submitted top-up survives close and restore as the same operation", () => {
  const now = Date.parse("2026-09-15T04:00:00Z")
  let operation = createFundingRailB({ operationId: "demo-fund:ux-context", rail: "krw_bank", creditKrw: 30_000, now })
  operation = fundingRailTransitionB(operation, { type: "REVIEW", now })
  operation = fundingRailTransitionB(operation, { type: "AUTHORIZE", quoteId: operation.quote.quoteId, consent: true, outcome: "unknown", now })
  operation = fundingRailTransitionB(operation, { type: "CANCEL", now: now + 1 })
  expect(operation.phase).toBe("unknown")
  expect(operation.receipt).toBeNull()
  expect(readFundingRailB(JSON.stringify(operation), now + 2)).toEqual(operation)
  expect(funding).toContain('["pending", "unknown"].includes(operationRef.current.phase)')
})

test("UX01 fiat and stablecoin return to the retained venue without authorizing its purchase", () => {
  expect(commerce).toContain('returnVenueName: presented.transactionVenueName')
  expect(funding).toContain('data-testid="funding-return-context"')
  expect(funding).toContain('Adding funds is separate from paying the place.')
  expect(funding).not.toContain('Payment is confirmed separately.')
  expect(funding).toContain('returnLabel={fundingReturnLabel}')
  expect(funding).toContain('creditComplete ? fundingReturnLabel')
  expect(source("stablecoin-funding-b.tsx")).toContain('creditComplete ? returnLabel')
  const handoff = commerce.slice(commerce.indexOf("function openFundingForQuote"), commerce.indexOf("function pay("))
  expect(handoff).toContain('type: "PREPARE_QUOTE", quote')
  expect(handoff).toContain("setConsent(false)")
  expect(handoff).not.toContain('type: "CONFIRM"')
})

test("UX02 both receipt owners use one amount-aware refund panel, including full remaining amount", () => {
  expect(commerce.match(/<CommerceRefundsB\b/g)).toHaveLength(2)
  expect(commerce).toContain('scope="checkout"')
  expect(commerce).toContain('scope="wallet"')
  expect(commerce).not.toContain('data-testid="payment-refund"')
  expect(commerce).not.toContain('data-testid="wallet-activity-refund"')
  expect(commerce).not.toContain('dispatchCommerce({ type: "REFUND" })')
  expect(refunds).toContain('data-testid={`${scope}-refund-amount`}')
  expect(refunds).toContain('setAmount(String(remaining))')
  expect(refunds).toContain('type: "REFUND_REQUEST"')
  expect(refunds).toContain('type: "REFUND_RETRY"')
  expect(refunds).toContain('operation.phase === "unknown"')
  expect(refunds).toContain('operation.amountKrw <= remaining')
})

test("UX09 seed stays 60000 KRW while sample setup and purchase-only history name their scope", () => {
  expect(stableCommerceBalanceB(createStableCommerceBState()) * 1_000).toBe(60_000)
  expect(commerce).toContain('reviewMode ? copy.sampleLinkTitle : copy.linkTitle')
  expect(commerce).toContain('reviewMode ? copy.sampleLinkBody : copy.linkBody')
  expect(commerce).toContain('Start with a sample travel balance. No real funds are added.')
  for (const label of ['addFunds: "Add funds"', 'addFunds: "충전하기"', 'addFunds: "チャージする"', 'activity: "Purchases & refunds"', 'activity: "구매·환불 내역"', 'activity: "購入・返金履歴"']) expect(commerce).toContain(label)
  expect(commerce).not.toContain('addFunds: "Add funds first"')
  expect(commerce).not.toContain('noActivity: "No balance records yet"')
})

test("UX05 review copy is venue-neutral while stablecoin transfer details remain explicit", () => {
  expect(commerce).toContain('title: "Review payment"')
  expect(commerce).toContain('<Store size={30} aria-hidden="true" />')
  expect(commerce).not.toContain('K-Tour ID MEAL BENEFIT')
  expect(commerce).not.toContain('Your visit, ready')
  expect(commerce).toContain('Travel balance is displayed in KRW. Stablecoin funding has its own asset, network and transfer steps.')
  const stablecoin = source("stablecoin-funding-b.tsx")
  for (const boundary of ["SOURCE_STATUS", "DESTINATION_STATUS", "stablecoinCanAuthorizeB", "onCreditRetry"]) expect(stablecoin).toContain(boundary)
})
