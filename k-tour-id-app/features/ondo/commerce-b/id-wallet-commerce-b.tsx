"use client"

import type { KeyboardEvent, SyntheticEvent } from "react"
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  ArrowLeft,
  BadgeCheck,
  Banknote,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Coins,
  CreditCard,
  Gift,
  Info,
  Link2,
  LoaderCircle,
  LockKeyhole,
  MapPin,
  ReceiptText,
  RefreshCcw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Store,
  TicketCheck,
  WalletCards,
  X,
} from "lucide-react"
import { canonicalMapVenueById } from "@/lib/ondo/venues/map-data"
import { venueDisplayName } from "@/lib/ondo/venues/display"
import {
  abandonPendingBAction,
  actionReturnFromBEvent,
  B_ACTION_GATE_CANCEL_EVENT,
  B_ACTION_GATE_COMPLETE_EVENT,
  B_ACTION_GATE_READY_EVENT,
  consumePendingBActionAtMutation,
  createBCheckoutActionReturn,
  finalizeConsumedBActionWithMutation,
  privateContextForBAction,
  requestBActionGate,
  restoreBActionGateSession,
  restoreConsumedBActionAfterMutationFailure,
  type BCheckoutActionReturn,
} from "../identity-b/action-gate-contract-b"
import { openSavedBDiscoveryVenue } from "../map/b-discovery-history"
import { useOndoB, type OndoBCommerceFundingSource, type OndoBCommerceWalletStatus } from "../shared/state/ondo-b-provider"
import type { OndoBLocale } from "../shared/state/ondo-b-preferences"
import { ondoBProductTimeline } from "../shared/time/product-timeline-b"
import { focusFirstAvailableDestination } from "../shared/ui/focus-destination"
import { isRenderedFocusable } from "../shared/ui/is-rendered-focusable"
import { ONDO_MODAL_PRIORITY } from "../shared/ui/modal-layer-priority"
import { useDocumentScrollLock, useModalIsolation, useModalVisualViewport } from "../shared/ui/use-modal-isolation"
import { useSheetPresence, type SheetPresencePhase } from "../shared/ui/use-sheet-presence"
import { enterReviewSample, qaReviewFixtureOptions, readQaRuntime, useQaControls } from "../shared/ui/use-qa-controls"
import { createReviewFixtureAuthority, localActual, providerUnavailable, reviewFixture } from "../contracts/execution-mode"
import {
  createStableCommerceBLockedQuote,
  isStableCommerceBLockedQuote,
  sameStableCommerceBLockedQuote,
  STABLE_B_KRW_PRICE,
  STABLE_B_OFFER_ID,
  STABLE_B_OFFER_VENUE_ID,
  STABLE_B_OOKRW_PRICE,
  STABLE_B_RECEIPT_ID,
  STABLE_B_REFUND_RECEIPT_ID,
  STABLE_B_VOUCHER_VALUE,
  stableCommerceBalanceB,
  stableCommerceOpeningBalanceB,
  stableCommerceBenefitPolicyB,
  stableCommerceBreakdownB,
  stableCommerceQuoteDebitB,
  stableCommerceRefundedKrwB,
  stableCommerceHeldKrwB,
  stableCommerceOrderB,
  stableCommerceOrdersB,
  STABLE_B_PAYMENT_OPERATION_ID,
  type StableCommerceBState,
} from "./stable-commerce-model-b"
import { JourneyVisitEntryB } from "./journey-visit-b"
import { createFundingRailB, fundingRailTransitionB, readFundingRailB, FUNDING_CREDIT_AMOUNTS_B, FUNDING_RAIL_SESSION_KEY_B, type FundingCardMethodB, type FundingRailActionB, type FundingRailOperationB, type FundingSampleOutcomeB } from "./funding-rail-model-b"
import fundingStyles from "./funding-rail-b.module.css"
import styles from "./id-wallet-commerce-b.module.css"
import operationStyles from "./commerce-operations-b.module.css"
import { CommerceRefundsB } from "./commerce-refunds-b"
import { StablecoinFundingB } from "./stablecoin-funding-b"
import { commerceSampleResponseB } from "./commerce-sample-response-b"
import { resolveCommercePlaceB, requestPlaceServiceReturnB, requestBalancePlacesB } from "./place-service-registry-b"

const actionGateSessionOptions = qaReviewFixtureOptions

type Locale = OndoBLocale
type WalletReturn = "ready" | "failed"
type PaymentView = "review" | "processing" | "operation" | "receipt" | "failure" | "insufficient" | "refunded"
type PaymentSampleCaseB = "normal" | "authorization_failure" | "authorization_unknown" | "capture_failure" | "capture_unknown"
type QaPayment = "failure" | "insufficient"
type QaBenefit = "ineligible" | "below_minimum" | "expired"
type QaRuntime = { wallet?: "failure"; payment?: QaPayment; benefit?: QaBenefit; holdProcessing?: boolean }
type FundingSheetSubject = {
  context: string
  purpose: "topup" | "payment"
  returnVenueName?: string
  returnShortageKrw?: number
  locale: Locale
  source: OndoBCommerceFundingSource
  walletReady: boolean
}
type FundingFocusReturn = {
  exact: HTMLButtonElement
  fallbackSelectors: readonly string[]
}
type WalletSheetSubject = Readonly<{
  boundarySeen: boolean
  context: string
  locale: Locale
  reviewMode: boolean
}>
type WalletFocusReturn = Readonly<{
  exact: HTMLButtonElement
  fallbackSelectors: readonly string[]
}>
type CommerceOfferSubject = Readonly<{
  commerce: StableCommerceBState
  crossVenueReceipt: boolean
  fundingSource: OndoBCommerceFundingSource
  key: string
  locale: Locale
  originVenueId: string
  originVenueName: string
  reviewMode: boolean
  transactionVenueId: string
  transactionVenueName: string
  walletStatus: OndoBCommerceWalletStatus
}>
type CommerceOfferVisualSnapshot = Readonly<{
  benefitPolicy: ReturnType<typeof stableCommerceBenefitPolicyB>
  consent: boolean
  consentPrompted: boolean
  storageError: "gate" | "payment" | "refund" | null
  view: PaymentView
}>

const FOCUSABLE = "button:not([disabled]),input:not([disabled]),[href],summary,[tabindex]:not([tabindex='-1'])"
const NUMBER_LOCALE: Record<Locale, string> = { en: "en-US", ko: "ko-KR", ja: "ja-JP" }
const TEST_DISPLAY_KRW_PER_OOKRW = 1_000
const DISPLAY_KRW_PER_USD = 1_350

const FUNDING_COPY = {
  en: {
    sheet: "Payment method",
    title: "How would you like to pay?",
    topupTitle: "How would you like to add funds?",
    selected: "Payment method",
    change: "Change",
    chooseAvailable: "Choose another method",
    chooseFunding: "Choose funding method",
    addFunds: "Add funds",
    done: "Use this method",
    ready: "Ready",
    setup: "Set up",
    provider: "Connection needed",
    balance: "Travel balance",
    balanceBody: "Prepared for this trip",
    bank: "Bank account",
    bankBody: "Add KRW",
    card: "Card · Apple Pay",
    cardBody: "Pay with a card or Apple Pay",
    digital: "Stablecoins",
    digitalBody: "USDC · USDT → travel balance",
    unavailable: "Not connected",
    sample: "See connected sample",
    sampleTitle: "Connected funding sample",
    sampleAmount: "Amount to add",
    sampleReady: "Ready to add to your travel balance",
    sampleContinue: "Add sample balance",
    sampleBoundary: "Sample only · no money moves",
    saveError: "Couldn’t save this choice. Try again.",
    technical: "Balance details",
    technicalBody: "Travel balance is displayed in KRW. Stablecoin funding has its own asset, network and transfer steps. OOKRW is a separate settlement test-token concept, not redeemable won.",
  },
  ko: {
    sheet: "결제수단",
    title: "어떻게 결제할까요?",
    topupTitle: "어떤 방법으로 충전할까요?",
    selected: "결제수단",
    change: "변경",
    chooseAvailable: "다른 수단 선택",
    chooseFunding: "충전 방식 선택",
    addFunds: "충전하기",
    done: "이 수단 사용",
    ready: "준비됨",
    setup: "설정 필요",
    provider: "연결 필요",
    balance: "여행 잔액",
    balanceBody: "이번 여행에 준비된 잔액",
    bank: "은행 계좌",
    bankBody: "KRW 충전",
    card: "카드 · Apple Pay",
    cardBody: "카드 또는 Apple Pay로 결제",
    digital: "스테이블코인",
    digitalBody: "USDC · USDT → 여행 잔액",
    unavailable: "연결되지 않음",
    sample: "연결 후 화면 보기",
    sampleTitle: "연결 후 충전 화면",
    sampleAmount: "추가할 금액",
    sampleReady: "여행 잔액에 추가할 준비가 됐어요",
    sampleContinue: "샘플 잔액 추가",
    sampleBoundary: "샘플 화면 · 실제 금액 이동 없음",
    saveError: "선택을 저장하지 못했어요. 다시 시도해 주세요.",
    technical: "잔액 상세",
    technicalBody: "여행 잔액은 KRW로 표시합니다. 스테이블코인은 별도 자산·네트워크·전송 단계를 거칩니다. OOKRW는 정산 테스트 토큰 개념이며 상환 가능한 원화가 아닙니다.",
  },
  ja: {
    sheet: "支払い方法",
    title: "どの方法で支払いますか？",
    topupTitle: "どの方法でチャージしますか？",
    selected: "支払い方法",
    change: "変更",
    chooseAvailable: "別の方法を選ぶ",
    chooseFunding: "入金方法を選ぶ",
    addFunds: "チャージする",
    done: "この方法を使う",
    ready: "利用可能",
    setup: "設定が必要",
    provider: "接続が必要",
    balance: "旅の残高",
    balanceBody: "この旅行用に準備した残高",
    bank: "銀行口座",
    bankBody: "KRWを追加",
    card: "カード・Apple Pay",
    cardBody: "カードまたはApple Payで支払う",
    digital: "ステーブルコイン",
    digitalBody: "USDC・USDT → 旅の残高",
    unavailable: "未接続",
    sample: "接続後の画面を見る",
    sampleTitle: "接続後の入金画面",
    sampleAmount: "追加する金額",
    sampleReady: "旅の残高に追加できます",
    sampleContinue: "サンプル残高を追加",
    sampleBoundary: "サンプル画面・実際の資金移動なし",
    saveError: "選択を保存できませんでした。もう一度お試しください。",
    technical: "残高の詳細",
    technicalBody: "旅の残高はKRWで表示します。ステーブルコインは資産・ネットワーク・送信を個別に確認します。OOKRWは精算テストトークンの概念で、換金可能なウォンではありません。",
  },
} as const

function formatNumber(value: number, locale: Locale) {
  return new Intl.NumberFormat(NUMBER_LOCALE[locale], { maximumFractionDigits: 0 }).format(value)
}

function formatKrw(value: number, locale: Locale) {
  return new Intl.NumberFormat(NUMBER_LOCALE[locale], {
    style: "currency",
    currency: "KRW",
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: 0,
  }).format(value)
}

function formatSignedOokrw(value: number, locale: Locale) {
  const sign = value > 0 ? "+" : value < 0 ? "−" : ""
  return `${sign}${formatNumber(Math.abs(value), locale)} OOKRW`
}

function formatKrwFromSettlementUnits(value: number, locale: Locale) {
  return formatKrw(value * TEST_DISPLAY_KRW_PER_OOKRW, locale)
}

function formatUsdFromKrw(value: number, locale: Locale) {
  return new Intl.NumberFormat(NUMBER_LOCALE[locale], {
    style: "currency",
    currency: "USD",
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / DISPLAY_KRW_PER_USD).replace(/^\$/, "US$")
}

function formatUsdFromSettlementUnits(value: number, locale: Locale) {
  return formatUsdFromKrw(value * TEST_DISPLAY_KRW_PER_OOKRW, locale)
}

const COPY = {
  en: {
    eyebrow: "TRAVEL WALLET",
    title: "Wallet",
    body: "Keep your travel balance, place benefits and receipts together.",
    balance: "Travel balance",
    balanceSource: "Prepared for this trip",
    balanceSourceEmpty: "No funds added",
    balanceReview: "Review sample · no external wallet",
    balanceEmpty: "Set up when you want to pay at a place",
    balanceEmptyReady: "Choose a funding method",
    balanceEmptyStatus: "Empty",
    testAsset: "How your wallet works",
    balanceReady: "Ready",
    balanceFailed: "Setup needs another try",
    balanceEquivalent: "Estimated in USD",
    connect: "Set up travel wallet",
    connectCompact: "Continue",
    reconnect: "Try setup again",
    reconnectCompact: "Try again",
    disconnect: "Reset travel wallet",
    disconnectCompact: "Reset",
    benefits: "Place benefit",
    benefitTitle: (amount: string) => `${amount} off`,
    benefitBody: "Use it at eligible K-Tour ID places.",
    benefitState: "Available",
    explore: "Open benefit place",
    activity: "Purchases & refunds",
    noActivity: "No purchases yet",
    noActivityBody: "Your place purchases and their refunds appear here. Top-ups are separate.",
    paidActivity: "Balance used",
    refundedActivity: "Balance restored",
    activityVenue: "Payment at",
    activityReceipt: "Balance record",
    originalPayment: "Original balance record",
    refundReference: "Restore reference",
    refundedAmount: "Balance restored",
    activityPlace: "Open exact place",
    privacy: "Payment privacy",
    privacyBody: "Only wallet readiness and your benefit choice are used for this payment. Your name, age, identity and address are not shared.",
    testTruth: "Amounts are shown to you in KRW and estimated USD. The device ledger uses OOKRW internally. USDC or USDT may appear here only when selected as a funding source. No bank, card, wallet or payment provider is connected yet, so no money or digital asset moves.",
    linkDialog: "Travel Wallet",
    linkTitle: "Start with an empty travel wallet",
    linkBody: "Choose how you’ll add KRW or USD when a provider is connected.",
    sampleLinkTitle: "Try your travel wallet",
    sampleLinkBody: "Start with a sample travel balance. No real funds are added.",
    linking: "Creating your wallet…",
    linkingBody: "No funding or payment is being made.",
    linkFailed: "Local setup didn’t complete",
    linkFailedBody: "Nothing changed. Try again without losing your place.",
    noticeError: "Nothing was sent. Please try again.",
    benefitUsed: "Used",
    cancel: "Not now",
    close: "Close",
  },
  ko: {
    eyebrow: "여행 지갑",
    title: "지갑",
    body: "여행 잔액과 장소별 혜택, 영수증을 한곳에서 확인하세요.",
    balance: "여행 잔액",
    balanceSource: "이번 여행에 준비된 잔액",
    balanceSourceEmpty: "추가된 금액 없음",
    balanceReview: "심사용 잔액 · 외부 지갑 미연결",
    balanceEmpty: "매장에서 결제할 때 설정하세요",
    balanceEmptyReady: "충전 방식을 선택하세요",
    balanceEmptyStatus: "잔액 없음",
    testAsset: "지갑 이용 안내",
    balanceReady: "준비됨",
    balanceFailed: "설정을 다시 시도해 주세요",
    balanceEquivalent: "USD 예상 금액",
    connect: "여행 지갑 설정",
    connectCompact: "계속",
    reconnect: "설정 다시 시도",
    reconnectCompact: "다시 시도",
    disconnect: "여행 지갑 초기화",
    disconnectCompact: "초기화",
    benefits: "장소별 혜택",
    benefitTitle: (amount: string) => `${amount} 할인`,
    benefitBody: "대상 K-Tour ID 장소에서 사용할 수 있어요.",
    benefitState: "사용 가능",
    explore: "혜택 장소 열기",
    activity: "구매·환불 내역",
    noActivity: "아직 구매 내역이 없어요",
    noActivityBody: "장소별 구매와 해당 환불을 확인하세요. 충전 내역은 별도예요.",
    paidActivity: "잔액 사용",
    refundedActivity: "잔액 복원",
    activityVenue: "결제 장소",
    activityReceipt: "잔액 기록",
    originalPayment: "원 잔액 기록",
    refundReference: "복원 참조",
    refundedAmount: "복원된 잔액",
    activityPlace: "이 장소 열기",
    privacy: "결제 개인정보",
    privacyBody: "이 결제에는 지갑 준비 상태와 혜택 선택만 사용합니다. 이름·나이·신원·주소는 공유하지 않아요.",
    testTruth: "금액은 KRW와 예상 USD로 표시합니다. 기기 내 원장은 OOKRW를 내부 단위로 사용하며, USDC나 USDT는 사용자가 자금 출처로 선택한 경우에만 이 상세에서 보여줍니다. 아직 은행·카드·지갑·결제 제공자가 연결되지 않아 실제 금액이나 디지털 자산은 이동하지 않습니다.",
    linkDialog: "여행 지갑",
    linkTitle: "빈 여행 지갑으로 시작",
    linkBody: "제공자 연결 후 KRW 또는 USD를 추가할 방식을 선택하세요.",
    sampleLinkTitle: "여행 지갑을 체험해 보세요",
    sampleLinkBody: "샘플 여행 잔액으로 시작해요. 실제 금액이 충전되지는 않아요.",
    linking: "지갑을 만드는 중…",
    linkingBody: "충전이나 결제는 진행되지 않아요.",
    linkFailed: "로컬 설정을 완료하지 못했어요",
    linkFailedBody: "변경된 내용이 없습니다. 현재 위치에서 다시 시도하세요.",
    noticeError: "전송된 정보는 없습니다. 다시 시도해 주세요.",
    benefitUsed: "사용됨",
    cancel: "나중에",
    close: "닫기",
  },
  ja: {
    eyebrow: "トラベルウォレット",
    title: "ウォレット",
    body: "旅の残高、お店の特典、レシートをまとめて確認できます。",
    balance: "旅の残高",
    balanceSource: "この旅行用に準備した残高",
    balanceSourceEmpty: "入金額なし",
    balanceReview: "レビュー用残高・外部ウォレット未接続",
    balanceEmpty: "お店で支払うときに設定",
    balanceEmptyReady: "入金方法を選んでください",
    balanceEmptyStatus: "残高なし",
    testAsset: "ウォレットの仕組み",
    balanceReady: "利用可能",
    balanceFailed: "設定をもう一度お試しください",
    balanceEquivalent: "USDでの概算",
    connect: "旅のウォレットを設定",
    connectCompact: "続ける",
    reconnect: "設定をもう一度試す",
    reconnectCompact: "再試行",
    disconnect: "旅のウォレットをリセット",
    disconnectCompact: "リセット",
    benefits: "お店の特典",
    benefitTitle: (amount: string) => `${amount}割引`,
    benefitBody: "対象のK-Tour IDスポットで利用できます。",
    benefitState: "利用可能",
    explore: "特典のお店を開く",
    activity: "購入・返金履歴",
    noActivity: "購入履歴はまだありません",
    noActivityBody: "お店での購入とその返金を表示します。チャージは別です。",
    paidActivity: "残高を使用",
    refundedActivity: "残高を復元",
    activityVenue: "支払先のお店",
    activityReceipt: "残高記録",
    originalPayment: "元の残高記録",
    refundReference: "復元参照",
    refundedAmount: "戻した残高",
    activityPlace: "このお店を開く",
    privacy: "決済時のプライバシー",
    privacyBody: "この支払いには、ウォレットの準備状況と特典の選択だけを使用します。名前、年齢、本人情報、住所は共有しません。",
    testTruth: "金額はKRWとUSDの概算で表示します。端末内台帳ではOOKRWを内部単位として使用し、USDCやUSDTは資金元として選択した場合にだけこの詳細に表示します。銀行、カード、ウォレット、決済事業者はまだ接続されていないため、実際のお金やデジタル資産は移動しません。",
    linkDialog: "旅のウォレット",
    linkTitle: "空の旅ウォレットから始める",
    linkBody: "事業者への接続後にKRWまたはUSDを追加する方法を選べます。",
    sampleLinkTitle: "旅のウォレットを体験",
    sampleLinkBody: "サンプルの旅の残高から始めます。実際の資金は追加されません。",
    linking: "ウォレットを作成しています…",
    linkingBody: "入金や支払いは行われません。",
    linkFailed: "ローカル設定を完了できませんでした",
    linkFailedBody: "変更はありません。今の画面からもう一度お試しください。",
    noticeError: "情報は送信されていません。もう一度お試しください。",
    benefitUsed: "使用済み",
    cancel: "今回はしない",
    close: "閉じる",
  },
} as const

const OFFER_COPY = {
  en: {
    eyebrow: "PLACE PAYMENT",
    title: "Review payment",
    from: "Payment at",
    venueBoundaryPrefix: "K-Tour ID on-device payment preview at",
    venueBoundarySuffix: "· not offered or accepted by the venue · no wallet/provider contacted · no money moves",
    price: "Payment amount",
    testQuote: "Price in USD",
    estimateBasis: "Estimate · ₩1,350 = US$1 · Aug 19, 2026",
    benefit: "K-Tour ID benefit",
    total: "You pay",
    balanceBefore: "Travel balance",
    balanceAfter: "After this use",
    balanceRestored: "Restored balance",
    asset: "KRW",
    voucher: "Your benefit",
    voucherBody: (minimum: string, expiry: string) => `${minimum} minimum met · valid through ${expiry}`,
    fixedQuote: "Display estimate · ₩1,350 = US$1 · provider rate and fees unavailable",
    recommendation: "Available for this payment",
    applied: "Applied",
    apply: "Apply benefit",
    remove: "Not now",
    available: "Available",
    policyIneligible: "Benefit unavailable for this place",
    policyBelowMinimum: "Minimum spend not met",
    policyExpired: "This benefit has expired",
    policyBody: "Nothing changed. Return to the place and choose another option.",
    consentTitle: "Pay privately",
    consentBody: "Only wallet readiness and this benefit choice are used. Your name, identity, age, address and original documents stay private.",
    consent: "I agree to use my travel balance for this payment",
    consentRequired: "Review this one choice to continue.",
    pay: (amount: string) => `Use ${amount} travel balance`,
    connectToPay: "Set up travel wallet to continue",
    back: "Back to place",
    close: "Close and return to place",
    consequence: "No external order or real money movement",
    fundingConsequence: "A provider is required before funds can be added or used",
    processing: "Recording balance use…",
    processingBody: "Your place, benefit and amount stay unchanged.",
    failed: "Payment didn’t complete",
    failedBody: "Nothing was debited and your benefit is still available.",
    insufficient: "Not enough travel balance",
    insufficientBody: "No debit was made. The temporary condition is cleared before you retry, or you can choose another way at the venue.",
    paymentStorageError: "Could not save this on-device payment record. Nothing was completed — try again.",
    gateStorageError: "Could not open the Payment check. The payment details and device balance are unchanged — try again.",
    refundStorageError: "Could not save this balance-restoration record. The original balance record is unchanged — try again.",
    retry: "Try again",
    receipt: "Balance-use record",
    receiptBody: "Your benefit was applied to this balance record.",
    receiptWithoutBenefit: "This balance-use record is saved in your activity.",
    paid: "Amount",
    remaining: "Balance left",
    receiptId: "Balance record",
    originalPayment: "Original balance record",
    paymentReceipt: "Original balance record",
    refundReference: "Restore reference",
    refundedAmount: "Balance restored",
    refund: "Restore balance",
    support: "Restore this record",
    supportBody: "Restore the travel balance and one-use benefit saved on this device.",
    refunded: "Balance restored",
    refundedBody: "Your travel balance and benefit are available again.",
    refundedWithoutBenefit: "Your travel balance is available again and the unused benefit remains available.",
    return: "Return to place",
    returnToPlace: (venue: string) => `Return to ${venue}`,
    crossVenueReceipt: (receiptVenue: string, returnVenue: string) => `This device already has a receipt for ${receiptVenue}. It is not a transaction at ${returnVenue}.`,
    testMode: "Payment details",
    demoNote: "Balance record only · no venue order",
    providerOrder: "Venue order",
    providerNotConnected: "Not placed",
    providerNotConnectedBody: "This records only the change to your travel balance.",
    testTruth: "Customer amounts use KRW and estimated USD. The device ledger uses OOKRW internally. If a visitor chooses a digital-dollar funding route, its source may be USDC or USDT. Benefit eligibility is calculated from this offer on this device; no AI or provider call is made. No wallet, merchant, stablecoin network or payment provider is currently connected.",
    settlement: "Receipt details",
    operation: "Operation",
    holderChange: "Your balance",
    merchantChange: "Merchant side",
    combinedChange: "Combined change",
    recordedOnly: "Balance record only · not sent to the venue",
    reviewProvenance: "Sample result",
  },
  ko: {
    eyebrow: "매장 결제",
    title: "결제 금액 확인",
    from: "결제 장소",
    venueBoundaryPrefix: "K-Tour ID 기기 내 결제 체험 장소",
    venueBoundarySuffix: "· 매장에서 제공하거나 접수하지 않음 · 지갑·공급자 연결 없음 · 돈 이동 없음",
    price: "이용 금액",
    testQuote: "USD 예상 금액",
    estimateBasis: "예상값 · ₩1,350 = US$1 · 2026. 8. 19.",
    benefit: "K-Tour ID 혜택",
    total: "결제 금액",
    balanceBefore: "여행 잔액",
    balanceAfter: "사용 후 잔액",
    balanceRestored: "복원된 잔액",
    asset: "KRW",
    voucher: "나의 혜택",
    voucherBody: (minimum: string, expiry: string) => `${minimum} 최소 금액 충족 · ${expiry}까지`,
    fixedQuote: "표시용 예상값 · ₩1,350 = US$1 · 실제 환율과 수수료는 제공자 연결 후 확인",
    recommendation: "이 결제에 사용할 수 있는 혜택",
    applied: "적용됨",
    apply: "혜택 적용",
    remove: "나중에",
    available: "사용 가능",
    policyIneligible: "이 장소에서는 혜택을 사용할 수 없어요",
    policyBelowMinimum: "최소 이용 금액을 충족하지 못했어요",
    policyExpired: "이 혜택은 만료됐어요",
    policyBody: "변경된 내용은 없습니다. 장소로 돌아가 다른 방법을 선택해 주세요.",
    consentTitle: "개인정보를 지키는 결제",
    consentBody: "지갑 준비 상태와 이 혜택 선택만 사용합니다. 이름·신원·나이·주소·원본 문서는 비공개로 유지돼요.",
    consent: "이 결제에 여행 잔액을 사용하는 데 동의합니다",
    consentRequired: "이 항목을 확인하면 계속할 수 있어요.",
    pay: (amount: string) => `여행 잔액 ${amount} 사용`,
    connectToPay: "여행 지갑을 설정하고 계속",
    back: "장소로 돌아가기",
    close: "닫고 장소로 돌아가기",
    consequence: "외부 주문이나 실제 돈 이동은 없어요",
    fundingConsequence: "금액을 추가하거나 사용하려면 제공자 연결이 필요해요",
    processing: "잔액 사용을 기록하는 중…",
    processingBody: "장소와 혜택, 금액은 그대로 유지돼요.",
    failed: "결제를 완료하지 못했어요",
    failedBody: "차감된 잔액은 없고 혜택도 그대로 사용할 수 있어요.",
    insufficient: "여행 잔액이 부족해요",
    insufficientBody: "차감된 잔액은 없습니다. 재시도 전에 임시 조건이 해제되며, 매장에서 다른 방법을 선택할 수도 있어요.",
    paymentStorageError: "이 기기에 결제 기록을 저장하지 못했어요. 완료된 내용은 없습니다. 다시 시도하세요.",
    gateStorageError: "결제 확인을 열지 못했어요. 결제 내용과 기기 내 잔액은 그대로입니다. 다시 시도하세요.",
    refundStorageError: "이 기기에 잔액 복원 기록을 저장하지 못했어요. 원 잔액 기록은 그대로입니다. 다시 시도하세요.",
    retry: "다시 시도",
    receipt: "잔액 사용 기록",
    receiptBody: "이 잔액 기록에 혜택이 적용됐어요.",
    receiptWithoutBenefit: "잔액 사용 기록을 활동에 저장했어요.",
    paid: "금액",
    remaining: "남은 잔액",
    receiptId: "잔액 기록",
    originalPayment: "원 잔액 기록",
    paymentReceipt: "원 잔액 기록",
    refundReference: "복원 참조",
    refundedAmount: "복원된 잔액",
    refund: "잔액 복원",
    support: "이 기록 복원",
    supportBody: "이 기기에 저장된 여행 잔액과 1회 혜택을 다시 사용할 수 있게 복원합니다.",
    refunded: "잔액 복원 완료",
    refundedBody: "여행 잔액과 혜택을 다시 사용할 수 있어요.",
    refundedWithoutBenefit: "여행 잔액을 복원했고 사용하지 않은 혜택은 그대로 남아 있어요.",
    return: "장소로 돌아가기",
    returnToPlace: (venue: string) => `장소로 돌아가기 · ${venue}`,
    crossVenueReceipt: (receiptVenue: string, returnVenue: string) => `이 로컬 동작에는 이미 ${receiptVenue} 영수증이 있어요. ${returnVenue} 거래가 아닙니다.`,
    testMode: "결제 상세",
    demoNote: "잔액 기록만 저장 · 매장 주문 없음",
    providerOrder: "매장 주문",
    providerNotConnected: "접수되지 않음",
    providerNotConnectedBody: "여행 잔액의 변화만 기록합니다.",
    testTruth: "사용자 금액은 KRW와 예상 USD로 표시하고, 기기 내 원장은 OOKRW를 내부 단위로 사용합니다. 방문자가 디지털 달러 자금 경로를 선택하는 경우 출처는 USDC 또는 USDT일 수 있습니다. 혜택 대상 여부는 이 오퍼만으로 기기에서 계산하며 AI나 제공자를 호출하지 않습니다. 현재 외부 지갑·가맹점·스테이블코인 네트워크·결제 제공자는 연결되어 있지 않습니다.",
    settlement: "영수증 상세",
    operation: "작업 번호",
    holderChange: "내 잔액",
    merchantChange: "매장 측",
    combinedChange: "합산 변화",
    recordedOnly: "잔액 기록만 저장 · 매장에 전송되지 않음",
    reviewProvenance: "샘플 결과",
  },
  ja: {
    eyebrow: "お店への支払い",
    title: "支払いを確認",
    from: "支払先のお店",
    venueBoundaryPrefix: "K-Tour ID端末内の支払い体験・対象店",
    venueBoundarySuffix: "· お店での提供・受付なし · ウォレット・事業者への接続なし · お金の移動なし",
    price: "利用金額",
    testQuote: "USDでの概算",
    estimateBasis: "概算・₩1,350 = US$1・2026/8/19",
    benefit: "K-Tour ID特典",
    total: "使用する残高",
    balanceBefore: "旅の残高",
    balanceAfter: "利用後の残高",
    balanceRestored: "復元後の残高",
    asset: "KRW",
    voucher: "あなたの特典",
    voucherBody: (minimum: string, expiry: string) => `最低金額${minimum}を達成 · ${expiry}まで有効`,
    fixedQuote: "表示用の概算・₩1,350 = US$1・実際のレートと手数料は事業者接続後に確認",
    recommendation: "この支払いで使える特典",
    applied: "適用済み",
    apply: "特典を適用",
    remove: "今回は使わない",
    available: "利用可能",
    policyIneligible: "このお店では特典を利用できません",
    policyBelowMinimum: "最低利用額に達していません",
    policyExpired: "この特典の有効期限が切れています",
    policyBody: "変更はありません。お店の画面に戻り、別の方法を選んでください。",
    consentTitle: "必要な情報だけで支払いを確認",
    consentBody: "使うのはウォレットの準備状況とこの特典の選択だけです。名前、本人情報、年齢、住所、元の書類は非公開のままです。",
    consent: "この支払いに旅の残高を使うことに同意します",
    consentRequired: "この項目を確認すると続けられます。",
    pay: (amount: string) => `旅の残高から${amount}を使う`,
    connectToPay: "旅のウォレットを設定して続ける",
    back: "お店の画面に戻る",
    close: "閉じてお店の画面に戻る",
    consequence: "外部注文や実際のお金の移動はありません",
    fundingConsequence: "入金や利用には事業者への接続が必要です",
    processing: "残高利用を記録しています…",
    processingBody: "お店、特典、金額は変わりません。",
    failed: "支払いを完了できませんでした",
    failedBody: "残高は引かれておらず、特典も引き続き利用できます。",
    insufficient: "旅の残高が不足しています",
    insufficientBody: "残高は引かれていません。再試行の前に一時条件を解除します。お店で別の方法を選ぶこともできます。",
    paymentStorageError: "この端末に支払い記録を保存できませんでした。完了した処理はありません。もう一度お試しください。",
    gateStorageError: "支払い確認を開けませんでした。支払い内容と端末内残高は変わっていません。もう一度お試しください。",
    refundStorageError: "この端末に残高復元の記録を保存できませんでした。元の残高記録は変わっていません。もう一度お試しください。",
    retry: "もう一度試す",
    receipt: "残高利用の記録",
    receiptBody: "この残高記録に特典を適用しました。",
    receiptWithoutBenefit: "残高利用の記録をアクティビティに保存しました。",
    paid: "金額",
    remaining: "残りの残高",
    receiptId: "残高記録",
    originalPayment: "元の残高記録",
    paymentReceipt: "元の残高記録",
    refundReference: "復元参照",
    refundedAmount: "戻した残高",
    refund: "残高を復元",
    support: "この記録を復元",
    supportBody: "この端末に保存した旅の残高と1回限りの特典を、もう一度使える状態に戻します。",
    refunded: "残高を復元しました",
    refundedBody: "旅の残高と特典をもう一度利用できます。",
    refundedWithoutBenefit: "旅の残高を復元し、未使用の特典はそのまま残っています。",
    return: "同じお店の画面に戻る",
    returnToPlace: (venue: string) => `${venue}に戻る`,
    crossVenueReceipt: (receiptVenue: string, returnVenue: string) => `このローカル操作には${receiptVenue}のレシートがあります。${returnVenue}の取引ではありません。`,
    testMode: "決済の詳細",
    demoNote: "残高記録のみ・店舗注文なし",
    providerOrder: "店舗への注文",
    providerNotConnected: "未送信",
    providerNotConnectedBody: "旅の残高の変化だけを記録します。",
    testTruth: "利用者向けの金額はKRWとUSDの概算で表示し、端末内台帳ではOOKRWを内部単位として使用します。旅行者がデジタルドルの資金ルートを選ぶ場合、資金元はUSDCまたはUSDTです。特典の対象判定はこのオファーだけを使って端末内で計算し、AIや外部事業者は呼び出しません。現在、外部ウォレット、加盟店、ステーブルコインネットワーク、決済事業者は接続されていません。",
    settlement: "レシート詳細",
    operation: "操作番号",
    holderChange: "自分の残高",
    merchantChange: "店舗側",
    combinedChange: "合計変化",
    recordedOnly: "残高記録のみ・店舗には未送信",
    reviewProvenance: "サンプル結果",
  },
} as const

function runAfterFrames(callback: () => void, count: number) {
  let frame = 0
  let timeout = 0
  let remaining = count
  let completed = false
  const finish = () => {
    if (completed) return
    completed = true
    window.cancelAnimationFrame(frame)
    window.clearTimeout(timeout)
    callback()
  }
  const tick = () => {
    if (remaining <= 0) { finish(); return }
    remaining -= 1
    frame = window.requestAnimationFrame(tick)
  }
  frame = window.requestAnimationFrame(tick)
  // Mobile browsers may throttle rAF while a sheet or browser chrome is
  // settling. Preserve the visible beat, but never leave setup or payment
  // frozen behind an indefinitely delayed frame callback.
  timeout = window.setTimeout(finish, Math.max(0, count * 17 + 34))
  return () => {
    completed = true
    window.cancelAnimationFrame(frame)
    window.clearTimeout(timeout)
  }
}

const COMMERCE_WALLET_OPEN_EVENT = "ondo-b-commerce-wallet-open"

function openCommerceWalletSheet(trigger: HTMLButtonElement) {
  window.dispatchEvent(new CustomEvent(COMMERCE_WALLET_OPEN_EVENT, { detail: { trigger } }))
}

function trapFocus(event: KeyboardEvent<HTMLElement>, root: HTMLElement | null, onEscape: () => void) {
  if (event.key === "Escape") { event.preventDefault(); onEscape(); return }
  if (event.key !== "Tab") return
  const focusable = Array.from(root?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(isRenderedFocusable)
  const first = focusable[0]
  const last = focusable.at(-1)
  if (!first || !last) return
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}

function WalletConnectSheet({ locale, boundarySeen, presenceState, subject, reviewMode, onAcknowledge, onClose, onReturn }: {
  locale: Locale
  boundarySeen: boolean
  presenceState: Exclude<SheetPresencePhase, "closed">
  subject: string
  reviewMode: boolean
  onAcknowledge(): boolean
  onClose(): void
  onReturn(status: WalletReturn): void
}) {
  const copy = COPY[locale]
  const closing = presenceState === "closing"
  const closingRef = useRef(closing)
  closingRef.current = closing
  const exitRequestedRef = useRef(false)
  const wasClosingRef = useRef(closing)
  if (wasClosingRef.current && !closing) exitRequestedRef.current = false
  wasClosingRef.current = closing
  const [phase, setPhase] = useState<"info" | "linking" | "failed">("info")
  const [noticeError, setNoticeError] = useState(false)
  const [hasEntered, setHasEntered] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const returnedRef = useRef(false)
  const liveVisual = { noticeError, phase }
  const visualRef = useRef(liveVisual)
  if (!closing && !exitRequestedRef.current) visualRef.current = liveVisual
  const visual = closing || exitRequestedRef.current ? visualRef.current : liveVisual
  useModalIsolation(true, rootRef)
  useDocumentScrollLock(true)

  useLayoutEffect(() => {
    if (closing) setHasEntered(true)
  }, [closing])

  useEffect(() => {
    if (closing) return
    const frame = window.requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>("[data-wallet-focus]")?.focus({ preventScroll: true }))
    return () => window.cancelAnimationFrame(frame)
  }, [closing, phase])

  useEffect(() => {
    if (phase !== "linking" || closing) return
    return runAfterFrames(() => {
      if (closingRef.current || exitRequestedRef.current) return
      if (!reviewMode) {
        const execution = localActual("travel_wallet_shell", { status: "ready" as const, balanceKRW: 0 as const })
        if (execution.result !== "LOCAL_COMMITTED" || execution.externalEffect !== "none") {
          setPhase("failed")
          return
        }
        if (returnedRef.current || closingRef.current || exitRequestedRef.current) return
        returnedRef.current = true
        exitRequestedRef.current = true
        onReturn("ready")
        onClose()
        return
      }
      const authority = createReviewFixtureAuthority({
        qaRuntimeEnabled: reviewMode,
        explicitlyRequested: reviewMode,
        fixtureId: readQaRuntime<QaRuntime>()?.wallet === "failure" ? "FX-WALLET-FAIL" : "FX-WALLET-SUCCESS",
      })
      if (!authority) { setPhase("failed"); return }
      const execution = readQaRuntime<QaRuntime>()?.wallet === "failure"
        ? reviewFixture(authority, { outcome: "failure" })
        : reviewFixture(authority, { outcome: "success", value: { status: "ready" as const } })
      const outcome: WalletReturn = execution.result === "FIXTURE_SUCCESS" ? "ready" : "failed"
      if (outcome === "failed") { setPhase("failed"); return }
      if (returnedRef.current || closingRef.current || exitRequestedRef.current) return
      returnedRef.current = true
      exitRequestedRef.current = true
      onReturn("ready")
      onClose()
    }, 22)
  }, [closing, onClose, onReturn, phase, reviewMode])

  function begin() {
    if (closingRef.current || exitRequestedRef.current) return
    if (!boundarySeen && !onAcknowledge()) { setNoticeError(true); return }
    setNoticeError(false)
    setPhase("linking")
  }

  function requestClose() {
    if (closingRef.current || exitRequestedRef.current) return
    exitRequestedRef.current = true
    onClose()
  }

  function finishFailed() {
    if (closingRef.current || exitRequestedRef.current) return
    exitRequestedRef.current = true
    onReturn("failed")
    onClose()
  }

  function consumeClosingInput(event: SyntheticEvent) {
    if (!closingRef.current && !exitRequestedRef.current) return
    event.preventDefault()
    event.stopPropagation()
    event.nativeEvent.stopImmediatePropagation()
  }

  return createPortal(
    <div
      className={`${styles.sheetBackdrop} ${styles.walletSetupBackdrop}`}
      data-wallet-presence={presenceState}
      data-wallet-entered={hasEntered ? "true" : "false"}
      onClick={(event) => { if (event.target === event.currentTarget) requestClose() }}
      onClickCapture={consumeClosingInput}
      onPointerDownCapture={consumeClosingInput}
      onKeyDownCapture={consumeClosingInput}
    >
      <div ref={rootRef} className={`${styles.sheet} ${styles.walletSetupSheet}`} role="dialog" aria-modal="true" aria-label={copy.linkDialog} aria-busy={visual.phase === "linking" || closing ? "true" : undefined} data-testid="wallet-connect-sheet" data-modal-layer-priority={ONDO_MODAL_PRIORITY.nestedCritical} data-wallet-subject={subject} data-phase={visual.phase} onAnimationEnd={(event) => { if (event.currentTarget === event.target && presenceState === "open") setHasEntered(true) }} onKeyDown={(event) => trapFocus(event, rootRef.current, requestClose)}>
        <div className={styles.grabber} aria-hidden="true" />
        <header><span>{copy.linkDialog}</span><button type="button" data-wallet-focus aria-label={copy.close} aria-disabled={closing ? "true" : undefined} onClick={requestClose}><X size={20} aria-hidden="true" /></button></header>
        {visual.phase === "info" ? (
          <div className={`${styles.sheetBody} ${styles.walletSetupBody}`} data-testid="wallet-setup-scroll">
            <div className={styles.sheetIcon}><WalletCards size={28} aria-hidden="true" /></div>
            <h2>{reviewMode ? copy.sampleLinkTitle : copy.linkTitle}</h2><p>{reviewMode ? copy.sampleLinkBody : copy.linkBody}</p>
            <div className={styles.walletSetupFlow} role="img" aria-label={copy.linkBody}>
              <span><WalletCards aria-hidden="true" /></span><ChevronRight aria-hidden="true" /><span><Gift aria-hidden="true" /></span><ChevronRight aria-hidden="true" /><span><ReceiptText aria-hidden="true" /></span>
            </div>
            <details className={styles.truth}><summary>{copy.testAsset}</summary><p>{copy.testTruth}</p></details>
            {visual.noticeError ? <p className={styles.error} role="alert">{copy.noticeError}</p> : null}
            <button type="button" className={styles.primary} onClick={begin}><Link2 size={18} aria-hidden="true" />{copy.connect}</button>
            <button type="button" className={styles.quietButton} onClick={requestClose}>{copy.cancel}</button>
          </div>
        ) : null}
        {visual.phase === "linking" ? <div className={`${styles.sheetBody} ${styles.walletSetupBody} ${styles.sheetStatus}`} data-testid="wallet-setup-scroll" role="status" aria-live="polite"><LoaderCircle className={styles.spinner} size={32} aria-hidden="true" /><h2>{copy.linking}</h2><p>{copy.linkingBody}</p></div> : null}
        {visual.phase === "failed" ? <div className={`${styles.sheetBody} ${styles.walletSetupBody} ${styles.sheetStatus}`} data-testid="wallet-setup-scroll" role="alert"><RefreshCcw size={32} aria-hidden="true" /><h2>{copy.linkFailed}</h2><p>{copy.linkFailedBody}</p><button type="button" className={styles.primary} data-wallet-focus data-testid="wallet-link-retry" onClick={() => { if (!closingRef.current && !exitRequestedRef.current) setPhase("linking") }}>{copy.reconnect}</button><button type="button" className={styles.quietButton} onClick={finishFailed}>{copy.cancel}</button></div> : null}
      </div>
    </div>,
    document.body,
  )
}

function fundingSourceLabel(locale: Locale, source: OndoBCommerceFundingSource) {
  const copy = FUNDING_COPY[locale]
  if (source === "krw_bank") return copy.bank
  if (source === "card_wallet") return copy.card
  if (source === "digital_dollar") return copy.digital
  return copy.balance
}

function FundingSourceSheet({ locale, source, subject, purpose, returnVenueName, returnShortageKrw, walletReady, presenceState, onSelect, onClose }: {
  locale: Locale
  source: OndoBCommerceFundingSource
  subject: string
  purpose: FundingSheetSubject["purpose"]
  returnVenueName?: string
  returnShortageKrw?: number
  walletReady: boolean
  presenceState: Exclude<SheetPresencePhase, "closed">
  onSelect(source: OndoBCommerceFundingSource): boolean
  onClose(): void
}) {
  const { state, actions } = useOndoB()
  const reviewMode = useQaControls()
  const copy = FUNDING_COPY[locale]
  const words = (en: string, ko: string, ja: string) => locale === "ko" ? ko : locale === "ja" ? ja : en
  const layerRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const [draftSource, setDraftSource] = useState<OndoBCommerceFundingSource>(source)
  const [operation, setOperation] = useState<FundingRailOperationB | null>(null)
  const operationRef = useRef<FundingRailOperationB | null>(null)
  const [consent, setConsent] = useState(false)
  const [sampleOutcome, setSampleOutcome] = useState<FundingSampleOutcomeB>("settled")
  const [creditComplete, setCreditComplete] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const [hasEntered, setHasEntered] = useState(false)
  const closing = presenceState === "closing"
  const closingRef = useRef(closing)
  closingRef.current = closing
  useModalIsolation(true, rootRef)
  useDocumentScrollLock(true)
  useModalVisualViewport(layerRef)
  useLayoutEffect(() => {
    setDraftSource(purpose === "topup" && source === "travel_balance" ? "krw_bank" : source)
    let restored: FundingRailOperationB | null = null
    let credited = false
    try {
      if (reviewMode) restored = readFundingRailB(window.sessionStorage.getItem(FUNDING_RAIL_SESSION_KEY_B))
      if (restored?.phase === "settled") {
        credited = state.commerceSession.fundingCredits.some(receipt => receipt.operationId === restored?.operationId && JSON.stringify(receipt) === JSON.stringify(restored.receipt))
        // Funding credits are intentionally mounted-session only. A previous
        // receipt must not imply money survived a reload or wallet reset.
        if (!credited) {
          window.sessionStorage.removeItem(FUNDING_RAIL_SESSION_KEY_B)
          restored = null
        } else {
          // A credited receipt remains in the mounted ledger, but a fresh
          // Add funds / Change request starts at methods, not that old receipt.
          restored = null
          credited = false
        }
      }
    } catch { restored = null }
    operationRef.current = restored
    setOperation(restored)
    setConsent(false)
    setCreditComplete(credited)
    setSaveError(false)
  }, [source, subject, purpose, reviewMode])
  useLayoutEffect(() => {
    // A cancelled exit keeps this component mounted. Mark it settled before
    // reopening so the base entrance animation cannot restart from frame one.
    if (closing) setHasEntered(true)
  }, [closing])
  useEffect(() => {
    if (presenceState !== "open") return
    const activeAtOpen = document.activeElement
    const focusInitial = () => {
      const root = rootRef.current
      const target = root?.querySelector<HTMLElement>("[data-funding-focus]")
      const active = document.activeElement
      if (root?.contains(active) && active !== activeAtOpen) return
      if (target && isRenderedFocusable(target)) target.focus({ preventScroll: true })
    }
    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(focusInitial)
    })
    const recoveryTimer = window.setTimeout(() => {
      if (rootRef.current && !rootRef.current.contains(document.activeElement)) focusInitial()
    }, 160)
    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(recoveryTimer)
    }
  }, [locale, presenceState, source, subject, walletReady, operation?.phase])
  function writeOperation(next: FundingRailOperationB) {
    if (closingRef.current || !qaReviewFixtureOptions().allowReviewFixture) return false
    try {
      const encoded = JSON.stringify(next)
      window.sessionStorage.setItem(FUNDING_RAIL_SESSION_KEY_B, encoded)
      if (window.sessionStorage.getItem(FUNDING_RAIL_SESSION_KEY_B) !== encoded) { setSaveError(true); return false }
      operationRef.current = next
      setOperation(next)
      setSaveError(false)
      return true
    } catch { setSaveError(true); return false }
  }
  function transition(action: FundingRailActionB) {
    const current = operationRef.current
    if (!current || closingRef.current) return false
    const next = fundingRailTransitionB(current, action)
    if (next === current || !writeOperation(next)) return false
    if (next.phase === "settled") creditSettled(next)
    return true
  }
  function creditSettled(next: FundingRailOperationB) {
    if (closingRef.current || next.phase !== "settled" || !next.receipt || !qaReviewFixtureOptions().allowReviewFixture) return false
    const authority = createReviewFixtureAuthority({ qaRuntimeEnabled: true, explicitlyRequested: true, fixtureId: "FX-FUNDING-RAIL-SETTLED" })
    if (!authority) return false
    const execution = reviewFixture(authority, { outcome: "success", value: next.receipt })
    const committed = actions.creditSampleFunding(execution)
    setCreditComplete(committed)
    setSaveError(!committed)
    return committed
  }
  function checkStatus(result: FundingSampleOutcomeB) {
    const current = operationRef.current
    if (!current || closingRef.current) return
    const next = fundingRailTransitionB(current, { type: "STATUS", operationId: current.operationId, quoteId: current.quote.quoteId, result, now: Date.now() })
    if (next === current || !writeOperation(next)) return
    if (next.phase === "settled") creditSettled(next)
  }
  useEffect(() => {
    if (closing || !reviewMode || !operation) return
    if (operation.phase === "pending" && !operation.stablecoin) {
      const timer = window.setTimeout(() => checkStatus(operation.outcome), 900)
      return () => window.clearTimeout(timer)
    }
    if (operation.phase === "quoted" || operation.phase === "authorize") {
      const timer = window.setTimeout(() => transition({ type: "REVIEW", now: Date.now() }), Math.max(0, operation.quote.expiresAt - Date.now()) + 10)
      return () => window.clearTimeout(timer)
    }
  // All timer callbacks read the current operation, never a previous quote.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing, reviewMode, operation?.phase, operation?.quote.quoteId])
  const methods = [
    { id: "travel_balance" as const, Icon: WalletCards, title: copy.balance, body: copy.balanceBody, status: walletReady ? copy.ready : copy.setup },
    { id: "krw_bank" as const, Icon: Banknote, title: copy.bank, body: copy.bankBody, status: reviewMode ? "Sample" : copy.provider },
    { id: "card_wallet" as const, Icon: CreditCard, title: copy.card, body: copy.cardBody, status: reviewMode ? "Sample" : copy.provider },
    { id: "digital_dollar" as const, Icon: Coins, title: copy.digital, body: copy.digitalBody, status: reviewMode ? "Sample" : copy.provider },
  ].filter(method => purpose !== "topup" || method.id !== "travel_balance")
  function commitFundingChoice() {
    if (closing) return
    setSaveError(false)
    if (draftSource !== "travel_balance") return
    if (onSelect(draftSource)) onClose()
    else setSaveError(true)
  }
  function openConnectedSample() {
    if (closing || draftSource === "travel_balance" || operationRef.current) return
    setSaveError(false)
    if (!reviewMode && !enterReviewSample()) {
      setSaveError(true)
      return
    }
    const next = createFundingRailB({ operationId: `demo-fund:${crypto.randomUUID()}`, rail: draftSource, creditKrw: 30_000, now: Date.now() })
    setConsent(false)
    setSampleOutcome("settled")
    setCreditComplete(false)
    writeOperation(next)
  }
  function useSampleBalance() {
    if (closing || operationRef.current?.phase !== "settled" || !creditComplete) return
    if (onSelect("travel_balance")) onClose()
    else setSaveError(true)
  }
  function useBalanceAtPlaces() {
    if (closing || operationRef.current?.phase !== "settled" || !creditComplete) return
    if (!onSelect("travel_balance")) { setSaveError(true); return }
    onClose()
    actions.setTab("ondo")
    actions.setSurface({ kind: "map" })
    window.requestAnimationFrame(() => requestBalancePlacesB())
  }
  function editQuote(creditKrw: number, cardMethod?: FundingCardMethodB) {
    const current = operationRef.current
    if (!current || current.phase !== "quoted" || current.attempt >= 100 || closingRef.current) return
    if (creditKrw === current.quote.creditKrw && (cardMethod ?? current.quote.cardMethod) === current.quote.cardMethod) return
    writeOperation(createFundingRailB({ operationId: current.operationId, rail: current.quote.rail, asset: current.stablecoin?.asset, cardMethod: cardMethod ?? current.quote.cardMethod ?? undefined, creditKrw, now: Date.now(), attempt: current.attempt + 1 }))
    setConsent(false)
  }
  function showMethods() {
    if (closing || (operationRef.current && ["pending", "unknown"].includes(operationRef.current.phase))) return
    try {
      window.sessionStorage.removeItem(FUNDING_RAIL_SESSION_KEY_B)
      if (window.sessionStorage.getItem(FUNDING_RAIL_SESSION_KEY_B) !== null) { setSaveError(true); return }
      operationRef.current = null
      setOperation(null)
      setConsent(false)
      setCreditComplete(false)
      setSaveError(false)
    } catch { setSaveError(true) }
  }
  function closeFunding() {
    if (closingRef.current) return
    if (operationRef.current && ["quoted", "authorize", "pending"].includes(operationRef.current.phase)) transition({ type: "CANCEL", now: Date.now() })
    onClose()
  }
  const quote = operation?.quote
  const SampleIcon = quote?.rail === "krw_bank" ? Banknote : quote?.rail === "card_wallet" ? CreditCard : Coins
  const railLabel = quote?.rail === "card_wallet" ? quote.cardMethod === "apple_pay" ? "Apple Pay" : words("Card", "카드", "カード") : quote ? fundingSourceLabel(locale, quote.rail) : ""
  const money = (minor: number, currency: "KRW" | "USD") => new Intl.NumberFormat(locale === "ko" ? "ko-KR" : locale === "ja" ? "ja-JP" : "en-US", { style: "currency", currency, maximumFractionDigits: currency === "KRW" ? 0 : 2 }).format(currency === "USD" ? minor / 100 : minor)
  const phase = operation?.phase
  const fundingReturnLabel = returnVenueName
    ? words(`Return to ${returnVenueName}`, `${returnVenueName} 결제로 돌아가기`, `${returnVenueName}の支払いに戻る`)
    : words("Back to balance", "잔액으로 돌아가기", "残高に戻る")
  const phaseTitle = operation?.stablecoin && phase === "quoted" ? words("Stablecoins, ready for your trip", "코인을 여행 잔액으로", "コインを旅の残高に")
    : operation?.stablecoin && phase === "authorize" ? words("Review your transfer", "전송 내용을 확인해 주세요", "送信内容を確認")
    : operation?.stablecoin && phase === "pending" ? words("Follow your transfer", "전송 과정을 확인해요", "送信の流れを確認")
    : operation?.stablecoin && phase === "settled" ? words("Sample transfer complete", "샘플 전송 완료", "サンプル送信が完了")
    : phase === "quoted" ? words("How much to add?", "얼마를 충전할까요?", "いくら追加しますか？")
    : phase === "authorize" ? words("Confirm this top-up", "충전 내용을 확인해 주세요", "チャージ内容を確認")
      : phase === "pending" ? words("Confirming your top-up", "충전을 확인하고 있어요", "チャージを確認中")
        : phase === "unknown" ? words("Still checking", "아직 확인 중이에요", "確認を続けています")
          : phase === "settled" ? creditComplete ? words("Added to balance", "충전됐어요", "残高に追加しました") : words("Top-up result ready", "충전 결과를 확인했어요", "チャージ結果を確認しました")
            : phase === "cancelled" ? words("Top-up cancelled", "충전을 취소했어요", "チャージをキャンセルしました")
              : phase === "expired" ? words("This quote expired", "견적이 만료됐어요", "見積もりの期限が切れました")
                : words("Top-up did not complete", "충전을 완료하지 못했어요", "チャージが完了しませんでした")
  return createPortal(
    <div
      ref={layerRef}
      className={`${styles.sheetBackdrop} ${styles.fundingBackdrop}`}
      data-funding-presence={presenceState}
      data-funding-entered={hasEntered ? "true" : "false"}
      onClickCapture={(event) => { if (closing) { event.preventDefault(); event.stopPropagation(); event.nativeEvent.stopImmediatePropagation() } }}
      onPointerDownCapture={(event) => { if (closing) { event.preventDefault(); event.stopPropagation(); event.nativeEvent.stopImmediatePropagation() } }}
      onKeyDownCapture={(event) => { if (closing) { event.preventDefault(); event.stopPropagation(); event.nativeEvent.stopImmediatePropagation() } }}
    >
      <div ref={rootRef} className={`${styles.sheet} ${styles.fundingSheet}`} role="dialog" aria-modal="true" aria-labelledby="funding-source-title" aria-busy={closing ? "true" : undefined} data-testid="funding-source-sheet" data-funding-subject={subject} data-funding-purpose={purpose} data-funding-source={source} data-funding-locale={locale} data-modal-layer-priority={ONDO_MODAL_PRIORITY.finalCritical} onAnimationEnd={(event) => { if (event.currentTarget === event.target && presenceState === "open") setHasEntered(true) }} onKeyDown={(event) => trapFocus(event, rootRef.current, closeFunding)}>
        <div className={styles.grabber} aria-hidden="true" />
        <header><span>{operation ? words("Add money", "충전", "チャージ") : purpose === "topup" ? copy.addFunds : copy.sheet}</span><button type="button" data-funding-focus aria-label={COPY[locale].close} aria-disabled={closing ? "true" : undefined} onClick={closeFunding}><X size={20} aria-hidden="true" /></button></header>
        <div className={styles.fundingSheetBody} data-sample-step={phase ?? "methods"}>
          <h2 id="funding-source-title">{operation ? phaseTitle : purpose === "topup" ? copy.topupTitle : copy.title}</h2>
          {returnVenueName ? <section className={styles.fundingReturnContext} data-testid="funding-return-context" data-shortage-krw={returnShortageKrw ?? 0} data-credit-committed={creditComplete}>
            <strong><MapPin size={15} aria-hidden="true" />{returnVenueName}</strong>
            {!creditComplete ? <p>{!creditComplete && returnShortageKrw !== undefined && returnShortageKrw > 0
              ? words(`Shortfall before top-up: ${formatKrw(returnShortageKrw, locale)}`, `충전 전 부족 금액 ${formatKrw(returnShortageKrw, locale)}`, `チャージ前の不足額 ${formatKrw(returnShortageKrw, locale)}`)
              : words("Return to this payment after adding funds", "충전 후 같은 결제로 돌아와요", "チャージ後は同じ支払いに戻ります")}</p> : null}
            <small>{words("Adding funds is separate from paying the place.", "충전은 매장 결제와 별개예요.", "チャージとお店への支払いは別です。")}</small>
          </section> : null}
          {operation && quote && operation.stablecoin ? <div data-testid="funding-rail-journey" data-phase={phase} data-provider-route={quote.rail} data-credit-committed={creditComplete}>
            <StablecoinFundingB key={quote.quoteId} operation={operation} locale={locale} closing={closing} creditComplete={creditComplete} balance={formatKrwFromSettlementUnits(stableCommerceBalanceB(state.commerceSession), locale)} returnLabel={fundingReturnLabel} onAction={transition} onAmount={amount => editQuote(amount)} onCreditRetry={() => creditSettled(operation)} onUseBalance={useSampleBalance} onMethods={showMethods} onClose={closeFunding} />
            {saveError ? <p className={styles.error} role="alert">{copy.saveError}</p> : null}
          </div> : operation && quote ? <div className={fundingStyles.flow} data-testid="funding-rail-journey" data-phase={phase} data-provider-route={quote.rail} data-card-method={quote.cardMethod ?? "none"} data-credit-committed={creditComplete}>
            <p className={fundingStyles.eyebrow}><SampleIcon size={17} aria-hidden="true" />{railLabel} · {words("Sample", "샘플", "サンプル")}</p>
            <ol className={fundingStyles.steps} aria-label={words("Quote, authorize, result", "견적, 승인, 결과", "見積もり・承認・結果")}><li data-active="true" /><li data-active={phase !== "quoted"} /><li data-active={phase === "settled"} /></ol>
            {phase === "quoted" || phase === "authorize" ? <>
              <strong className={fundingStyles.amount}>{money(quote.creditKrw, "KRW")}</strong>
              {phase === "quoted" ? <><div className={fundingStyles.options} aria-label={words("Amount to add", "충전 금액", "チャージ金額")}>{FUNDING_CREDIT_AMOUNTS_B.map(amount => <button key={amount} type="button" data-testid={`funding-amount-${amount}`} aria-pressed={quote.creditKrw === amount} onClick={() => editQuote(amount)}>{money(amount, "KRW")}</button>)}</div>{quote.rail === "card_wallet" ? <div className={fundingStyles.options} aria-label={copy.card}>{(["card", "apple_pay"] as const).map(method => <button key={method} type="button" data-testid={`funding-card-${method}`} aria-pressed={quote.cardMethod === method} onClick={() => editQuote(quote.creditKrw, method)}>{method === "apple_pay" ? "Apple Pay" : words("Card", "카드", "カード")}</button>)}</div> : null}</> : null}
              <dl className={fundingStyles.quote}><div><dt>{words("You pay", "출금 금액", "支払額")}</dt><dd>{money(quote.sourceAmountMinor, quote.sourceCurrency)}</dd></div><div><dt>{words("Fee included", "포함된 수수료", "含まれる手数料")}</dt><dd>{money(quote.feeMinor, quote.sourceCurrency)}</dd></div><div><dt>{words("Added to balance", "잔액에 충전", "残高への追加")}</dt><dd>{money(quote.creditKrw, "KRW")}</dd></div>{quote.rateKrwPerUsd ? <div><dt>{words("Sample rate", "샘플 환율", "サンプルレート")}</dt><dd>$1 = ₩1,500</dd></div> : null}</dl>
              {phase === "authorize" ? <><p className={fundingStyles.note}>{quote.rail === "krw_bank" ? words("Approve a sample bank transfer. No bank account is requested.", "샘플 은행 이체를 승인해요. 실제 계좌를 입력하지 않습니다.", "サンプル銀行振込を承認します。実際の口座情報は不要です。") : quote.rail === "card_wallet" ? quote.cardMethod === "apple_pay" ? words("Preview Apple Pay authorization. No system payment sheet or charge is opened.", "Apple Pay 승인을 체험해요. 실제 결제창이나 청구는 없습니다.", "Apple Pay承認の体験です。実際の決済画面や請求はありません。") : words("Preview a card authentication step. No card number is collected.", "카드 인증 단계를 체험해요. 카드번호는 수집하지 않습니다.", "カード認証を体験します。カード番号は収集しません。") : words("Approve a sample USD conversion. No token transfer or bridge is submitted.", "샘플 USD 전환을 승인해요. 토큰 전송이나 브리지는 실행하지 않습니다.", "サンプルUSD変換を承認します。トークン送信やブリッジは実行しません。")}</p><label className={fundingStyles.consent}><input type="checkbox" data-testid="funding-consent" checked={consent} onChange={event => setConsent(event.target.checked)} /><span>{words("Add this amount to my sample travel wallet. Create the sample wallet if needed. No real funds move.", "샘플 여행 지갑에 이 금액을 충전합니다. 필요하면 샘플 지갑을 만들며, 실제 돈은 이동하지 않습니다.", "この金額をサンプル旅行ウォレットに追加します。必要ならサンプルを作成します。実際の資金は動きません。")}</span></label><details className={fundingStyles.technical}><summary>{words("Sample outcome", "샘플 결과 선택", "サンプル結果")}</summary><div className={fundingStyles.options}>{(["settled", "failed", "unknown"] as const).map(outcome => <button key={outcome} type="button" data-testid={`funding-outcome-${outcome}`} aria-pressed={sampleOutcome === outcome} onClick={() => setSampleOutcome(outcome)}>{outcome === "settled" ? words("Complete", "완료", "完了") : outcome === "failed" ? words("Failure", "실패", "失敗") : words("Pending", "확인 중", "確認中")}</button>)}</div></details></> : <p className={fundingStyles.note}>{words("Illustrative fees and rates only. No real payment details are needed.", "환율과 수수료는 샘플이에요. 실제 결제 정보는 필요하지 않습니다.", "レートと手数料はサンプルです。実際の決済情報は不要です。")}</p>}
              <div className={fundingStyles.actions}><button type="button" className={fundingStyles.primary} data-testid={phase === "quoted" ? "funding-quote-continue" : "funding-authorize"} disabled={closing || (phase === "authorize" && !consent)} onClick={() => phase === "quoted" ? transition({ type: "REVIEW", now: Date.now() }) : transition({ type: "AUTHORIZE", quoteId: quote.quoteId, consent, outcome: sampleOutcome, now: Date.now() })}>{phase === "quoted" ? words("Continue", "계속", "続ける") : words("Approve sample top-up", "샘플 충전 승인", "サンプルチャージを承認")}</button><button type="button" className={fundingStyles.secondary} data-testid="funding-cancel" onClick={() => transition({ type: "CANCEL", now: Date.now() })}>{COPY[locale].cancel}</button></div>
            </> : phase === "pending" || phase === "unknown" ? <><div className={fundingStyles.status} role="status"><span className={fundingStyles.mark}>{phase === "pending" ? <LoaderCircle className={styles.spinner} size={30} aria-hidden="true" /> : <Clock3 size={30} aria-hidden="true" />}</span><strong className={fundingStyles.amount}>{money(quote.creditKrw, "KRW")}</strong><p className={fundingStyles.note}>{words("Your balance has not changed. Check this same top-up before starting another.", "아직 잔액은 그대로예요. 새 충전 전에 이 요청을 먼저 확인합니다.", "残高はまだ変わっていません。次のチャージの前にこの申請を確認します。")}</p></div>{phase === "unknown" || saveError ? <button type="button" className={fundingStyles.primary} data-testid="funding-check-status" onClick={() => checkStatus("settled")}>{words("Check status", "상태 확인", "状況を確認")}</button> : null}<button type="button" className={fundingStyles.secondary} onClick={closeFunding}>{words("Check later", "나중에 확인", "後で確認")}</button></> : phase === "settled" ? <><div className={fundingStyles.status}><span className={fundingStyles.mark}><BadgeCheck size={30} aria-hidden="true" /></span><strong className={fundingStyles.amount}>+{money(quote.creditKrw, "KRW")}</strong></div><dl className={fundingStyles.quote}><div><dt>{words("Sample top-up", "샘플 충전", "サンプルチャージ")}</dt><dd>{money(quote.creditKrw, "KRW")}</dd></div><div><dt>{words("Sample balance", "샘플 잔액", "サンプル残高")}</dt><dd data-testid="funding-receipt-balance">{formatKrwFromSettlementUnits(stableCommerceBalanceB(state.commerceSession), locale)}</dd></div></dl><p className={fundingStyles.note}>{words("No real funds moved. Your payment check and pass allowance stay separate.", "실제 돈은 이동하지 않았어요. 결제 확인과 자격 한도는 그대로 유지됩니다.", "実際の資金は動いていません。決済確認とパス上限は別のままです。")}</p><div className={fundingStyles.actions}><button type="button" className={fundingStyles.primary} data-testid={creditComplete ? "funding-sample-use" : "funding-credit-retry"} onClick={creditComplete ? useSampleBalance : () => creditSettled(operation)}>{creditComplete ? fundingReturnLabel : words("Apply sample result", "샘플 결과 반영", "サンプル結果を反映")}</button><button type="button" className={fundingStyles.secondary} data-testid="funding-add-another" onClick={showMethods}>{words("Start another top-up", "다른 충전 시작", "別のチャージを開始")}</button></div><details className={fundingStyles.technical}><summary>{words("Receipt", "영수증", "控え")}</summary><span className={fundingStyles.operation}>{operation.operationId}</span></details></> : <><div className={fundingStyles.status}><span className={fundingStyles.mark}><RotateCcw size={30} aria-hidden="true" /></span><p className={fundingStyles.note}>{words("Your balance is unchanged. Retry with a new quote.", "잔액은 그대로예요. 새 견적으로 다시 시도할 수 있습니다.", "残高は変わっていません。新しい見積もりで再試行できます。")}</p></div><div className={fundingStyles.actions}><button type="button" className={fundingStyles.primary} data-testid="funding-retry" onClick={() => { setConsent(false); setSampleOutcome("settled"); transition({ type: "RETRY", now: Date.now() }) }}>{words("Try again", "다시 시도", "もう一度試す")}</button><button type="button" className={fundingStyles.secondary} onClick={showMethods}>{words("Choose another method", "다른 방법 선택", "別の方法を選ぶ")}</button></div></>}
            {saveError ? <p className={styles.error} role="alert">{copy.saveError}</p> : null}
          </div> : <>
          <fieldset className={styles.fundingOptions}>
            <legend className={styles.srOnly}>{purpose === "topup" ? copy.addFunds : copy.sheet}</legend>
            {methods.map(({ id, Icon, title, body, status }) => (
              <label key={id} data-selected={draftSource === id} data-committed={source === id} data-connected={id === "travel_balance" && walletReady} data-requires-provider={id === "travel_balance" ? "false" : "true"}>
                <input type="radio" name="funding-source" value={id} checked={draftSource === id} aria-disabled={closing ? "true" : undefined} onChange={() => { if (!closing) { setDraftSource(id); setSaveError(false) } }} />
                <span className={styles.fundingIcon}><Icon size={20} aria-hidden="true" /></span>
                <span><strong>{title}</strong><small>{body}</small></span>
                <em data-icon-only={id === "travel_balance" ? "false" : "true"} aria-label={status}>{id === "travel_balance" ? status : <Clock3 size={15} aria-hidden="true" />}</em>
              </label>
            ))}
          </fieldset>
          {draftSource !== "travel_balance" && !reviewMode ? <p className={styles.fundingUnavailable} role="status" data-testid="funding-provider-required" data-provider-route={draftSource}><Clock3 size={16} aria-hidden="true" />{copy.unavailable}</p> : null}
          {saveError ? <p className={styles.error} role="alert">{copy.saveError}</p> : null}
          <details className={styles.truth}><summary>{copy.technical}</summary><p>{copy.technicalBody}</p></details>
          <button type="button" className={styles.primary} data-testid="funding-method-save" disabled={closing || (draftSource !== "travel_balance" && !reviewMode)} onClick={draftSource === "travel_balance" ? commitFundingChoice : openConnectedSample}>{draftSource === "travel_balance" ? copy.done : reviewMode ? words("Continue", "계속", "続ける") : copy.provider}</button>
          {draftSource !== "travel_balance" && !reviewMode ? <button type="button" className={styles.sampleButton} data-testid="funding-sample-open" onClick={openConnectedSample}>{copy.sample}<ChevronRight size={17} aria-hidden="true" /></button> : null}
          </>}
          {phase === "settled" && creditComplete && subject.startsWith("wallet:") ? <button type="button" className={fundingStyles.secondary} data-testid="funding-balance-places" onClick={useBalanceAtPlaces}><MapPin size={18} aria-hidden="true" />{words("Find places for this balance", "이 잔액으로 이용할 곳 보기", "この残高で使える場所を見る")}</button> : null}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function CanonicalCommerceOfferB({ commerce, locale, presenceState, venueId, venueName, originVenueId, originVenueName, crossVenueReceipt, walletStatus, fundingSource, reviewMode, onConnect, onOpenFunding, onClose }: {
  commerce: StableCommerceBState
  locale: Locale
  presenceState: Exclude<SheetPresencePhase, "closed">
  venueId: string
  venueName: string
  originVenueId: string
  originVenueName: string
  crossVenueReceipt: boolean
  walletStatus: OndoBCommerceWalletStatus
  fundingSource: OndoBCommerceFundingSource
  reviewMode: boolean
  onConnect(trigger: HTMLButtonElement): void
  onOpenFunding(trigger: HTMLButtonElement, purpose: FundingSheetSubject["purpose"]): void
  onClose(): boolean
}) {
  const { state, actions } = useOndoB()
  const closing = presenceState === "closing"
  const closingRef = useRef(closing)
  closingRef.current = closing
  const exitRequestedRef = useRef(false)
  const wasClosingRef = useRef(closing)
  if (wasClosingRef.current && !closing) exitRequestedRef.current = false
  wasClosingRef.current = closing
  const copy = OFFER_COPY[locale]
  const fundingCopy = FUNDING_COPY[locale]
  const rootRef = useRef<HTMLElement>(null)
  const pendingRef = useRef(false)
  const pendingCheckoutRef = useRef<BCheckoutActionReturn | null>(null)
  const preserveReturnToRef = useRef(false)
  const liveCommerce = state.commerceSession
  const order = stableCommerceOrderB(commerce)
  const commerceRef = useRef(liveCommerce)
  commerceRef.current = liveCommerce
  const [view, setView] = useState<PaymentView>(() => commerce.status === "paid" ? "receipt" : commerce.status === "refunded" ? "refunded" : commerce.confirmationPending && commerce.paymentOperation ? "operation" : "review")
  const previousViewRef = useRef<PaymentView>(view)
  const [consent, setConsent] = useState(Boolean(commerce.confirmationPending && commerce.paymentOperation))
  const [manualCapture, setManualCapture] = useState(false)
  const [paymentSampleCase, setPaymentSampleCase] = useState<PaymentSampleCaseB>("normal")
  const words = (en: string, ko: string, ja: string) => locale === "ko" ? ko : locale === "ja" ? ja : en
  const [consentPrompted, setConsentPrompted] = useState(false)
  const [benefitQa, setBenefitQa] = useState<QaBenefit | undefined>()
  const [productTimeline] = useState(() => ondoBProductTimeline())
  const [storageError, setStorageError] = useState<"gate" | "payment" | "refund" | null>(null)
  const returnTo = JSON.stringify({ cta: "START_CHECKOUT", venueId: originVenueId })
  const balance = stableCommerceBalanceB(commerce)
  const breakdown = stableCommerceBreakdownB(commerce)
  const debit = stableCommerceQuoteDebitB(commerce)
  const shortageKrw = Math.max(0, Math.round((debit - balance) * 1_000))
  const balanceAfterUse = Math.max(0, balance - debit)
  const benefitSelected = commerce.voucher === "selected" || commerce.voucher === "consumed"
  const fundingAvailable = reviewMode && fundingSource === "travel_balance" && walletStatus === "ready"
  const fundingStatus = fundingSource === "travel_balance"
    ? walletStatus === "ready"
      ? reviewMode
        ? shortageKrw > 0
          ? `${words("Available", "사용 가능", "利用可能")} ${formatKrwFromSettlementUnits(balance, locale)}`
          : `${formatKrwFromSettlementUnits(balance, locale)} → ${formatKrwFromSettlementUnits(balanceAfterUse, locale)}`
        : `${formatKrw(0, locale)} · ${fundingCopy.addFunds}`
      : fundingCopy.setup
    : fundingCopy.provider
  const benefitExpiresAtMs = productTimeline.benefitExpiresAtMs
  const benefitPolicy = stableCommerceBenefitPolicyB({
    venueEligible: order.venueId === venueId && benefitQa !== "ineligible",
    mealOOKRW: benefitQa === "below_minimum" ? order.grossKrw / 1_000 - 1 : order.grossKrw / 1_000,
    minimumOOKRW: order.grossKrw / 1_000,
    nowMs: benefitQa === "expired" ? benefitExpiresAtMs + 1 : Date.now(),
    expiresAtMs: benefitExpiresAtMs,
  })
  const liveVisualSnapshot: CommerceOfferVisualSnapshot = {
    benefitPolicy,
    consent,
    consentPrompted,
    storageError,
    view,
  }
  const visualSnapshotRef = useRef(liveVisualSnapshot)
  if (!closing && !exitRequestedRef.current) visualSnapshotRef.current = liveVisualSnapshot
  const visualSnapshot = closing || exitRequestedRef.current ? visualSnapshotRef.current : liveVisualSnapshot
  const renderedView = visualSnapshot.view
  const renderedConsent = visualSnapshot.consent
  const renderedConsentPrompted = visualSnapshot.consentPrompted
  const renderedStorageError = visualSnapshot.storageError
  const renderedBenefitPolicy = visualSnapshot.benefitPolicy
  const settlementKind = renderedView === "refunded" ? "REFUND" : "PAYMENT"
  const allSettlementEntries = commerce.ledger.filter((entry) => entry.kind === settlementKind)
  const latestRefundOperationId = renderedView === "refunded" ? allSettlementEntries.at(-1)?.operationId : null
  const settlementEntries = latestRefundOperationId ? allSettlementEntries.filter(entry => entry.operationId === latestRefundOperationId) : allSettlementEntries
  const holderEntry = settlementEntries.find((entry) => entry.side === "holder")
  const merchantEntry = settlementEntries.find((entry) => entry.side === "merchant")
  const settlementTotal = settlementEntries.reduce((total, entry) => total + entry.amount, 0)
  const terminalPolicyRef = useRef({
    credential: state.identityCredential,
    walletStatus,
    fundingSource,
    consent,
    account: state.account,
    venueId,
    benefitQa,
    benefitExpiresAtMs,
  })
  terminalPolicyRef.current = {
    credential: state.identityCredential,
    walletStatus,
    fundingSource,
    consent,
    account: state.account,
    venueId,
    benefitQa,
    benefitExpiresAtMs,
  }
  useModalIsolation(true, rootRef)
  useDocumentScrollLock(true)

  useEffect(() => {
    if (liveCommerce.status === "refunded" && view === "receipt") setView("refunded")
  }, [liveCommerce.status, view])
  useEffect(() => {
    // Returning to an unresolved sample reuses its exact private checkout. It
    // never creates another payment or reconstructs a proof from a receipt.
    if (!reviewMode || !commerce.confirmationPending || !commerce.paymentOperation || !commerce.lockedQuote) return
    const pending = restoreBActionGateSession(window.sessionStorage, new Date(), actionGateSessionOptions()).pending
    const context = pending ? privateContextForBAction(pending) : null
    if (pending?.cta === "START_CHECKOUT" && pending.venueId === venueId && context?.cta === "START_CHECKOUT" && sameStableCommerceBLockedQuote(context.quote, commerce.lockedQuote)) {
      pendingCheckoutRef.current = pending
      pendingRef.current = true
      preserveReturnToRef.current = true
    }
  }, [])

  useLayoutEffect(() => {
    if (!closing) return
    const consumeClosingKey = (event: globalThis.KeyboardEvent) => {
      if (rootRef.current?.closest("[inert],[aria-hidden='true']")) return
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    window.addEventListener("keydown", consumeClosingKey, true)
    return () => window.removeEventListener("keydown", consumeClosingKey, true)
  }, [closing])

  useEffect(() => {
    if (closing) return
    const frame = window.requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>("[data-commerce-initial-focus]")?.focus({ preventScroll: true }))
    return () => window.cancelAnimationFrame(frame)
  }, [closing])

  useEffect(() => {
    if (closing) return
    rootRef.current?.scrollTo({ top: 0, behavior: "auto" })
    if (previousViewRef.current === view) return
    previousViewRef.current = view
    const frame = window.requestAnimationFrame(() => {
      rootRef.current?.querySelector<HTMLElement>(`[data-payment-view-focus="${view}"]`)?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [closing, view])
  useEffect(() => {
    if (!consent || closing) return
    const frame = window.requestAnimationFrame(() => rootRef.current?.scrollTo({ top: 0, behavior: "auto" }))
    return () => window.cancelAnimationFrame(frame)
  }, [closing, consent])
  useEffect(() => {
    if (storageError !== "refund" || closing) return
    const frame = window.requestAnimationFrame(() => rootRef.current?.scrollTo({ top: 0, behavior: "auto" }))
    return () => window.cancelAnimationFrame(frame)
  }, [closing, storageError])
  useEffect(() => {
    setBenefitQa(readQaRuntime<QaRuntime>()?.benefit)
  }, [])

  useEffect(() => {
    function returnFromPaymentGate(event: Event, completed: boolean) {
      if (closingRef.current || exitRequestedRef.current) return
      const payload = event instanceof CustomEvent ? event.detail as BCheckoutActionReturn & { gateOutcome?: string } : null
      const detail = actionReturnFromBEvent(payload)
      if (!detail || detail.cta !== "START_CHECKOUT" || detail.venueId !== venueId) return
      const checkoutContext = privateContextForBAction(detail)
      if (!checkoutContext || checkoutContext.cta !== "START_CHECKOUT") {
        setStorageError("gate")
        return
      }
      if (!completed) {
        // Declining the optional K-Tour presentation removes only the optional
        // benefit. The same order remains available through standard checkout.
        if (payload?.gateOutcome === "denied" && checkoutContext.quote.benefitMode === "ktour" && benefitSelected) {
          actions.dispatchCommerce({ type: "CANCEL_CONFIRMATION" })
          actions.dispatchCommerce({ type: "DECLINE_BENEFIT" })
          setConsent(false)
        }
        window.requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>("[data-testid='payment-confirm']")?.focus({ preventScroll: true }))
        return
      }
      if (!consent || walletStatus !== "ready" || fundingSource !== "travel_balance" || pendingRef.current || liveCommerce.status !== "idle" || !reviewMode) return
      const latest = restoreBActionGateSession(window.sessionStorage, new Date(), actionGateSessionOptions())
      const satisfied = new Set<"account" | "payment_kyc">()
      if (state.account === "ACC-ACTIVE") satisfied.add("account")
      if (latest.payment.status === "eligible" && latest.payment.expiresAt && Date.parse(latest.payment.expiresAt) > Date.now()) satisfied.add("payment_kyc")
      if (latest.pending?.tokenId !== detail.tokenId
        || !isStableCommerceBLockedQuote(checkoutContext.quote, new Date())
        || !satisfied.has("account")
        || !satisfied.has("payment_kyc")
        || (checkoutContext.quote.benefitMode === "ktour" && benefitPolicy.status !== "recommended")) {
        setStorageError("gate")
        return
      }
      pendingCheckoutRef.current = detail
      pendingRef.current = true
      setStorageError(null)
      if (!actions.dispatchCommerce({ type: "CONFIRM", quote: checkoutContext.quote })) {
        pendingCheckoutRef.current = null
        pendingRef.current = false
        setStorageError("payment")
        return
      }
      setView("processing")
    }
    const complete = (event: Event) => returnFromPaymentGate(event, true)
    const cancel = (event: Event) => returnFromPaymentGate(event, false)
    window.addEventListener(B_ACTION_GATE_READY_EVENT, complete)
    window.addEventListener(B_ACTION_GATE_CANCEL_EVENT, cancel)
    return () => {
      window.removeEventListener(B_ACTION_GATE_READY_EVENT, complete)
      window.removeEventListener(B_ACTION_GATE_CANCEL_EVENT, cancel)
    }
  }, [actions, benefitPolicy.status, benefitSelected, closing, liveCommerce.status, consent, fundingSource, reviewMode, state.account, venueId, walletStatus])

  useEffect(() => {
    if (view !== "processing" || closing) return
    const cancelPending = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      preserveReturnToRef.current = true
      closeOffer()
    }
    window.addEventListener("keydown", cancelPending, true)
    return () => window.removeEventListener("keydown", cancelPending, true)
  }, [closing, view])

  useEffect(() => {
    if (view !== "processing" || closing) return
    const settlePayment = () => {
      if (closingRef.current || exitRequestedRef.current) return
      const expected = pendingCheckoutRef.current
      const quoteContext = expected ? privateContextForBAction(expected) : null
      const currentQuote = commerceRef.current.lockedQuote
      const currentCommerce = commerceRef.current
      const now = new Date()
      const latest = restoreBActionGateSession(window.sessionStorage, now, actionGateSessionOptions())
      const live = terminalPolicyRef.current
      const liveBenefitPolicy = stableCommerceBenefitPolicyB({
        venueEligible: live.venueId === stableCommerceOrderB(currentCommerce).venueId && live.benefitQa !== "ineligible",
        mealOOKRW: stableCommerceOrderB(currentCommerce).grossKrw / 1_000 - (live.benefitQa === "below_minimum" ? 1 : 0),
        minimumOOKRW: stableCommerceOrderB(currentCommerce).grossKrw / 1_000,
        nowMs: live.benefitQa === "expired" ? live.benefitExpiresAtMs + 1 : now.getTime(),
        expiresAtMs: live.benefitExpiresAtMs,
      })
      const satisfied = new Set<"account" | "payment_kyc">()
      if (live.account === "ACC-ACTIVE") satisfied.add("account")
      if (latest.payment.status === "eligible" && latest.payment.expiresAt && Date.parse(latest.payment.expiresAt) > now.getTime()) satisfied.add("payment_kyc")
      const currentBenefitMode = currentCommerce.voucher === "selected" || currentCommerce.voucher === "consumed" ? "ktour" : "standard"
      if (!reviewMode || !expected || quoteContext?.cta !== "START_CHECKOUT"
        || live.walletStatus !== "ready"
        || live.fundingSource !== "travel_balance"
        || !live.consent
        || live.account !== "ACC-ACTIVE"
        || live.venueId !== stableCommerceOrderB(currentCommerce).venueId
        || currentCommerce.status !== "idle"
        || currentCommerce.confirmationPending !== true
        || !isStableCommerceBLockedQuote(quoteContext.quote, now)
        || quoteContext.quote.fundingSource !== "travel_balance"
        || currentBenefitMode !== quoteContext.quote.benefitMode
        || (quoteContext.quote.benefitMode === "ktour" && liveBenefitPolicy.status !== "recommended")
        || stableCommerceBalanceB(currentCommerce) < quoteContext.quote.finalDebit
        || !sameStableCommerceBLockedQuote(currentQuote, quoteContext.quote)) {
        providerUnavailable("merchant_payment")
        pendingCheckoutRef.current = null
        pendingRef.current = false
        actions.dispatchCommerce({ type: "CANCEL_CONFIRMATION" })
        setStorageError("gate")
        setView("failure")
        return
      }
      const qa = readQaRuntime<QaRuntime>()
      const injected = qa?.payment
      if (qa && injected) delete qa.payment
      const outcome = injected === "failure" ? "failure" : injected === "insufficient" ? "insufficient" : "success"
      const authority = createReviewFixtureAuthority({
        qaRuntimeEnabled: reviewMode,
        explicitlyRequested: reviewMode,
        fixtureId: `FX-PAY-${outcome === "failure" ? "FAIL" : outcome.toUpperCase()}`,
      })
      const execution = authority
        ? outcome === "success"
          ? reviewFixture(authority, { outcome: "success", value: { receiptId: stableCommerceOrderB(currentCommerce).receiptId }, now })
          : reviewFixture(authority, { outcome: "failure", now })
        : providerUnavailable("merchant_payment")
      if (execution.result === "PROVIDER_UNAVAILABLE") {
        pendingCheckoutRef.current = null
        pendingRef.current = false
        actions.dispatchCommerce({ type: "CANCEL_CONFIRMATION" })
        setStorageError("gate")
        setView("failure")
        return
      }
      if (outcome === "success") {
        const operation = currentCommerce.paymentOperation
        if (!operation) {
          const authorizationOutcome = paymentSampleCase === "authorization_failure" ? "failure" : paymentSampleCase === "authorization_unknown" ? "unknown" : "success"
          const authorization = commerceSampleResponseB({ operationId: stableCommerceOrderB(currentCommerce).operationId, stage: "authorization", outcome: authorizationOutcome, amountKrw: currentQuote!.finalDebit * 1_000 })
          if (!authorization || !actions.dispatchCommerce({ type: "AUTHORIZE_PAYMENT", outcome: authorizationOutcome, now: Date.now(), execution: authorization })) {
            pendingRef.current = false
            setStorageError("gate")
            setView("failure")
            return
          }
          if (authorizationOutcome !== "success" || manualCapture) setView("operation")
          return
        }
        if (operation.phase === "authorized") {
          if (manualCapture) { setView("operation"); return }
          if (!actions.dispatchCommerce({ type: "CAPTURE_REQUEST" })) { setStorageError("payment"); setView("operation") }
          return
        }
        if (operation.phase !== "capture_pending") { setView("operation"); return }
        if (paymentSampleCase === "capture_failure" || paymentSampleCase === "capture_unknown") {
          const captureOutcome = paymentSampleCase === "capture_unknown" ? "unknown" : "failure"
          const response = commerceSampleResponseB({ operationId: operation.operationId, stage: "capture", outcome: captureOutcome, amountKrw: operation.amountKrw })
          if (!response || !actions.dispatchCommerce({ type: "CAPTURE_RESULT", outcome: captureOutcome, execution: response })) setStorageError("payment")
          setView("operation")
          return
        }
      }
      const consumed = consumePendingBActionAtMutation(window.sessionStorage, expected, satisfied, now, { ...actionGateSessionOptions(), credential: terminalPolicyRef.current.credential })
      if (!consumed || consumed.cta !== "START_CHECKOUT") {
        pendingCheckoutRef.current = null
        pendingRef.current = false
        actions.dispatchCommerce({ type: "CANCEL_CONFIRMATION" })
        setStorageError("gate")
        setView("failure")
        return
      }
      if (outcome === "success") {
        const finalized = finalizeConsumedBActionWithMutation(
          window.sessionStorage,
          consumed,
          () => actions.dispatchCommerce({ type: "PAYMENT_RETURN", outcome }),
          new Date(),
          actionGateSessionOptions(),
        )
        pendingRef.current = false
        pendingCheckoutRef.current = null
        if (!finalized) {
          preserveReturnToRef.current = true
          setStorageError("payment")
          setView("failure")
          return
        }
        preserveReturnToRef.current = false
        window.dispatchEvent(new CustomEvent(B_ACTION_GATE_COMPLETE_EVENT, { detail: consumed }))
        setView("receipt")
        return
      }

      const committed = actions.dispatchCommerce({ type: "PAYMENT_RETURN", outcome })
      pendingRef.current = false
      if (!committed) {
        restoreConsumedBActionAfterMutationFailure(window.sessionStorage, consumed, new Date(), actionGateSessionOptions())
        pendingCheckoutRef.current = null
        setStorageError("payment")
        setView("failure")
        return
      }
      preserveReturnToRef.current = true
      if (!restoreConsumedBActionAfterMutationFailure(window.sessionStorage, consumed, new Date(), actionGateSessionOptions())) setStorageError("payment")
      pendingCheckoutRef.current = null
      setView(outcome)
    }
    const qa = reviewMode ? readQaRuntime<QaRuntime>() : undefined
    if (qa?.holdProcessing && !liveCommerce.paymentOperation) {
      window.addEventListener("ondo-b-flow8-release-payment", settlePayment, { once: true })
      return () => window.removeEventListener("ondo-b-flow8-release-payment", settlePayment)
    }
    return runAfterFrames(settlePayment, 28)
  }, [actions, closing, reviewMode, state.account, view, liveCommerce.paymentOperation?.phase, manualCapture, paymentSampleCase])

  function resumePaymentOperation(statusOutcome: "success" | "failure" = "success") {
    if (closingRef.current || exitRequestedRef.current || !reviewMode) return
    const operation = liveCommerce.paymentOperation
    if (!operation) return
    setStorageError(null)
    if (operation.phase === "unknown") {
      const response = commerceSampleResponseB({ operationId: operation.operationId, stage: operation.unknownStage!, outcome: statusOutcome, amountKrw: operation.amountKrw })
      if (!response || !actions.dispatchCommerce({ type: "PAYMENT_STATUS", outcome: statusOutcome, now: Date.now(), execution: response })) { setStorageError("payment"); return }
      setPaymentSampleCase("normal")
      setView(statusOutcome === "success" ? "processing" : "operation")
    } else if (operation.phase === "authorized" || operation.phase === "capture_failed") {
      if (!actions.dispatchCommerce({ type: "CAPTURE_REQUEST" })) { setStorageError("payment"); return }
      if (operation.phase === "capture_failed") setPaymentSampleCase("normal")
      setView("processing")
    } else if (operation.phase === "capture_pending") {
      setPaymentSampleCase("normal")
      setView("processing")
    } else {
      actions.dispatchCommerce({ type: "CANCEL_CONFIRMATION" })
      pendingRef.current = false
      setPaymentSampleCase("normal")
      setView("review")
    }
  }

  function openFundingForQuote(trigger: HTMLButtonElement, purpose: FundingSheetSubject["purpose"] = "payment") {
    if (closingRef.current || exitRequestedRef.current) return
    if (reviewMode && liveCommerce.status === "idle" && !liveCommerce.confirmationPending) {
      const quote = liveCommerce.lockedQuote ?? createStableCommerceBLockedQuote(liveCommerce)
      actions.dispatchCommerce({ type: "PREPARE_QUOTE", quote })
      // Adding funds is separate from approving this merchant amount.
      setConsent(false)
    }
    onOpenFunding(trigger, purpose)
  }

  function pay(event?: SyntheticEvent<HTMLButtonElement>) {
    if (closingRef.current || exitRequestedRef.current) return
    if (!reviewMode) return
    if (shortageKrw > 0 && event) {
      openFundingForQuote(event.currentTarget, "topup")
      return
    }
    if (liveCommerce.lockedQuote && !isStableCommerceBLockedQuote(liveCommerce.lockedQuote, new Date())) {
      actions.dispatchCommerce({ type: "CANCEL_CONFIRMATION" })
      setConsent(false)
      setConsentPrompted(true)
      setStorageError("gate")
      return
    }
    if (!consent) {
      setConsentPrompted(true)
      window.requestAnimationFrame(() => {
        const input = rootRef.current?.querySelector<HTMLInputElement>("[data-testid='payment-minimum-consent'] input")
        input?.scrollIntoView({ block: "center", behavior: "smooth" })
        input?.focus({ preventScroll: true })
      })
      return
    }
    if (pendingRef.current || liveCommerce.status !== "idle") return
    setStorageError(null)
    const latest = restoreBActionGateSession(window.sessionStorage, new Date(), actionGateSessionOptions())
    if (latest.pending?.cta === "START_CHECKOUT" && latest.pending.venueId === venueId) {
      window.dispatchEvent(new CustomEvent(B_ACTION_GATE_READY_EVENT, { detail: latest.pending }))
      return
    }
    const now = new Date()
    const quote = liveCommerce.lockedQuote ?? createStableCommerceBLockedQuote(liveCommerce, new Date(now.getTime() + 15 * 60 * 1000))
    if (!requestBActionGate(createBCheckoutActionReturn({ venueId, quote, now }), actionGateSessionOptions())) setStorageError("gate")
  }

  function retry() {
    if (closingRef.current || exitRequestedRef.current) return
    pendingRef.current = false
    setStorageError(null)
    setView("review")
  }

  function consumeClosingInput(event: SyntheticEvent) {
    if (!closingRef.current && !exitRequestedRef.current) return
    event.preventDefault()
    event.stopPropagation()
    event.nativeEvent.stopImmediatePropagation()
  }

  function beginFinalDismiss() {
    if (closingRef.current || exitRequestedRef.current) return false
    exitRequestedRef.current = true
    return true
  }

  function closeOffer() {
    if (!beginFinalDismiss()) return
    const operation = commerceRef.current.paymentOperation
    const unresolved = operation?.phase === "unknown" || operation?.phase === "capture_pending"
    if (operation?.phase === "capture_pending") {
      const response = commerceSampleResponseB({ operationId: operation.operationId, stage: "capture", outcome: "unknown", amountKrw: operation.amountKrw })
      if (response) actions.dispatchCommerce({ type: "CAPTURE_RESULT", outcome: "unknown", execution: response })
    }
    if (unresolved) preserveReturnToRef.current = true
    const pending = restoreBActionGateSession(window.sessionStorage, new Date(), actionGateSessionOptions()).pending
    if (!preserveReturnToRef.current && pending?.cta === "START_CHECKOUT" && pending.venueId === venueId) {
      abandonPendingBAction(window.sessionStorage, pending, new Date(), actionGateSessionOptions())
    }
    pendingCheckoutRef.current = null
    pendingRef.current = false
    if (!unresolved && (liveCommerce.confirmationPending || liveCommerce.lockedQuote || view === "processing")) actions.dispatchCommerce({ type: "CANCEL_CONFIRMATION" })
    if (!onClose()) exitRequestedRef.current = false
  }

  const offerDialogLabel = renderedView === "processing"
    ? copy.processing
    : renderedView === "operation"
      ? words("Payment status", "결제 상태", "決済の状況")
    : renderedView === "failure"
      ? copy.failed
      : renderedView === "insufficient"
        ? copy.insufficient
        : renderedView === "refunded"
          ? copy.refunded
          : renderedView === "receipt"
            ? copy.receipt
            : undefined

  return (
    <section
      ref={rootRef}
      className={styles.offerOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby={renderedView === "review" ? "canonical-commerce-title" : undefined}
      aria-label={offerDialogLabel}
      aria-busy={closing ? "true" : undefined}
      data-testid="ondo-b-id-wallet-commerce"
      data-modal-layer-priority={renderedView === "receipt" ? 139 : ONDO_MODAL_PRIORITY.critical}
      style={renderedView === "receipt" ? { zIndex: 139 } : undefined}
      data-origin-venue-id={originVenueId}
      data-transaction-venue-id={venueId}
      data-order-id={order.orderId}
      data-cross-venue-receipt={crossVenueReceipt ? "true" : "false"}
      data-return-to={returnTo}
      data-payment-state={renderedView}
      data-wallet-status={walletStatus}
      data-benefit-policy={renderedBenefitPolicy.status}
      data-commerce-presence={presenceState}
      data-locale={locale}
      data-visual-direction="apple-wallet-flow8"
      data-flow8-object="offer"
      onClickCapture={consumeClosingInput}
      onPointerDownCapture={consumeClosingInput}
      onKeyDownCapture={consumeClosingInput}
      onKeyDown={(event) => trapFocus(event, rootRef.current, closeOffer)}
    >
      <header className={styles.offerHeader}>
        <button type="button" data-commerce-initial-focus data-testid="commerce-origin-return" aria-label={crossVenueReceipt ? copy.returnToPlace(originVenueName) : copy.close} onClick={closeOffer}><ArrowLeft size={20} aria-hidden="true" /></button>
        {renderedView === "review" ? <span className={styles.checkoutContext} data-testid="commerce-checkout-context" data-venue-id={venueId}><strong>{venueName}</strong><small>{formatKrwFromSettlementUnits(debit, locale)}</small></span> : <span>{copy.eyebrow}</span>}
        <i className={styles.headerSpacer} aria-hidden="true" />
      </header>

      {crossVenueReceipt ? (
        <p className={styles.offerTruth} data-testid="commerce-cross-venue-receipt-boundary">
          {copy.crossVenueReceipt(venueName, originVenueName)}
        </p>
      ) : null}

      {renderedView === "review" ? (
        <div className={styles.offerBody}>
          <section className={styles.offerHero}>
            <div className={styles.offerMark}><Store size={30} aria-hidden="true" /></div>
            <p>{copy.eyebrow}</p>
            <h2 id="canonical-commerce-title">{copy.title}</h2>
            <span data-testid="commerce-place-context" data-place-context="venue" data-venue-id={venueId}><MapPin size={15} aria-hidden="true" />{copy.from} {venueName}</span>
          </section>

          {renderedBenefitPolicy.status === "recommended" ? <>
          <section className={styles.quote} aria-label={copy.total} data-flow8-object="quote" data-locked-quote={commerce.lockedQuote ? JSON.stringify(commerce.lockedQuote) : undefined}>
            <div><span>{copy.price}</span><strong>{formatKrw(order.grossKrw, locale)}</strong></div>
            <div className={styles.discount} data-flow8-benefit-delta={benefitSelected ? "applied" : "available"}><span>{copy.benefit}</span><strong>{benefitSelected ? `−${formatKrw(order.benefitKrw, locale)}` : copy.available}</strong></div>
            <div className={styles.quoteTotal}><span>{copy.total}</span><strong>{formatKrwFromSettlementUnits(debit, locale)}</strong></div>
          </section>
          <section className={styles.fundingSummary} data-testid="commerce-funding-source" data-funding-source={fundingSource} data-provider-connected={fundingAvailable}>
            <div><WalletCards size={20} aria-hidden="true" /><span><small>{fundingCopy.selected}</small><strong>{fundingSourceLabel(locale, fundingSource)}</strong><em>{fundingStatus}</em>{reviewMode && shortageKrw > 0 ? <em className={styles.shortageAmount} data-testid="commerce-balance-shortage" role="status">{words("Short by", "부족 금액", "不足額")} {formatKrw(shortageKrw, locale)}</em> : null}</span></div>
            <button type="button" onClick={(event) => openFundingForQuote(event.currentTarget)}>{fundingCopy.change}</button>
          </section>

          {commerce.lockedQuote && !commerce.confirmationPending ? <p className={styles.quoteReturn} data-testid="commerce-held-quote">{words("This place and amount are kept while you top up. Adding funds is separate from paying the place.", "충전하는 동안 장소와 금액은 그대로예요. 충전은 매장 결제와 별개예요.", "チャージ中も場所と金額を保持します。チャージとお店への支払いは別です。")} <button type="button" onClick={() => { actions.dispatchCommerce({ type: "CANCEL_CONFIRMATION" }); setConsent(false) }}>{words("Review changes", "금액·혜택 다시 보기", "金額・特典を見直す")}</button></p> : null}

          <section className={styles.offerBenefit} data-testid="commerce-voucher" data-voucher-state={commerce.voucher} data-benefit-recommendation={commerce.benefitRecommendation}>
            <div className={styles.benefitIcon}><TicketCheck size={22} aria-hidden="true" /></div>
            <div><h3>{commerce.benefitRecommendation === "recommended" ? copy.recommendation : copy.voucher}</h3><p data-testid="commerce-benefit-eligibility">{copy.voucherBody(formatKrw(order.grossKrw, locale), productTimeline.benefitExpiry[locale])}</p></div>
            <div className={styles.benefitActions}>
              <button type="button" data-testid="benefit-accept" aria-pressed={commerce.benefitRecommendation === "accepted"} onClick={() => actions.dispatchCommerce({ type: "ACCEPT_BENEFIT" })}>
                {commerce.benefitRecommendation === "accepted" ? copy.applied : copy.apply}
              </button>
              <button type="button" data-testid="benefit-decline" aria-pressed={commerce.benefitRecommendation === "declined"} onClick={() => actions.dispatchCommerce({ type: "DECLINE_BENEFIT" })}>{copy.remove}</button>
            </div>
          </section>

          {reviewMode ? <section className={styles.consentCard} data-testid="payment-minimum-consent" data-prompted={renderedConsentPrompted ? "true" : "false"}>
            <div><LockKeyhole size={20} aria-hidden="true" /><span><h3>{copy.consentTitle}</h3><p>{copy.consentBody}</p></span></div>
            <label><input type="checkbox" checked={renderedConsent} aria-describedby={renderedConsentPrompted && !renderedConsent ? "payment-consent-hint" : undefined} onChange={(event) => { setConsent(event.target.checked); if (event.target.checked) setConsentPrompted(false) }} /><span>{copy.consent}</span></label>
            {renderedConsentPrompted && !renderedConsent ? <small id="payment-consent-hint" className={styles.consentHint} role="alert">{copy.consentRequired}</small> : null}
          </section> : null}
          {reviewMode ? <details className={operationStyles.paymentOptions} data-testid="payment-operation-options"><summary><ReceiptText size={18} aria-hidden="true" /><span>{words("Explore payment steps", "결제 단계 살펴보기", "決済ステップを見る")}</span></summary><div className={operationStyles.body}>
            <label><input type="checkbox" data-testid="payment-manual-capture" checked={manualCapture} onChange={event => setManualCapture(event.target.checked)} /><span>{words("Review approval before capture", "승인 후 매입을 직접 확인", "承認後に決済確定を確認")}</span></label>
            <label>{words("Sample response", "샘플 응답", "サンプル応答")}<select data-testid="payment-operation-case" value={paymentSampleCase} onChange={event => setPaymentSampleCase(event.target.value as PaymentSampleCaseB)}><option value="normal">{words("Normal", "정상", "通常")}</option><option value="authorization_failure">{words("Approval declined", "승인 거절", "承認拒否")}</option><option value="authorization_unknown">{words("Approval result unknown", "승인 결과 불명", "承認結果が不明")}</option><option value="capture_failure">{words("Capture failed · retry", "매입 실패 · 재시도", "決済確定失敗・再試行")}</option><option value="capture_unknown">{words("Capture result unknown", "매입 결과 불명", "決済確定の結果が不明")}</option></select></label>
            <p className={operationStyles.note}>{words("Approval holds the amount. Only a confirmed capture changes the balance. These are sample steps, not real provider requests.", "승인은 금액을 보류하고, 매입 확정 때만 잔액이 차감돼요. 실제 요청이 아닌 샘플 단계입니다.", "承認は金額の保留です。決済確定後に残高が変わります。実際のプロバイダーへの申請ではありません。")}</p>
          </div></details> : null}

          <details className={styles.testDetails} data-testid="commerce-payment-details">
            <summary>{copy.testMode}</summary>
            <p className={styles.demoNote} data-testid="commerce-local-only-status"><LockKeyhole size={15} aria-hidden="true" />{copy.demoNote}</p>
            <p data-testid="commerce-venue-test-boundary">{copy.venueBoundaryPrefix} <strong>{venueName}</strong> {copy.venueBoundarySuffix}</p>
            <p data-testid="commerce-provider-boundary"><strong>{copy.providerOrder} · {copy.providerNotConnected}</strong><br />{copy.providerNotConnectedBody}</p>
            <p data-testid="commerce-fixed-quote-boundary">{copy.fixedQuote}</p>
            <p>{copy.testTruth}</p>
          </details>
          {renderedStorageError === "gate" ? <p className={styles.storageError} data-testid="payment-gate-storage-error" role="alert">{copy.gateStorageError}</p> : null}
          <div className={styles.offerDecision} data-flow8-decision="payment">
            <p id="payment-consequence" className={styles.paymentConsequence}><ShieldCheck size={15} aria-hidden="true" />{reviewMode ? copy.consequence : copy.fundingConsequence}</p>
            <button
              type="button"
              className={styles.payButton}
              data-testid="payment-confirm"
              aria-describedby="payment-consequence"
              onClick={!reviewMode
                ? walletStatus === "ready" ? (event) => openFundingForQuote(event.currentTarget) : (event) => onConnect(event.currentTarget)
                : shortageKrw > 0 ? (event) => openFundingForQuote(event.currentTarget, "topup") : fundingSource !== "travel_balance" ? (event) => openFundingForQuote(event.currentTarget) : walletStatus === "ready" ? pay : (event) => onConnect(event.currentTarget)}
            >
              <CircleDollarSign size={19} aria-hidden="true" />
              {!reviewMode
                ? walletStatus === "ready" ? fundingCopy.chooseFunding : copy.connectToPay
                : shortageKrw > 0 ? words("Top up for this payment", "이 결제에 필요한 잔액 충전", "この支払いのためにチャージ") : fundingSource !== "travel_balance" ? fundingCopy.chooseAvailable : walletStatus === "ready" ? copy.pay(formatKrwFromSettlementUnits(debit, locale)) : copy.connectToPay}
            </button>
            <button type="button" className={styles.quietButton} data-testid="payment-cancel" onClick={closeOffer}><ArrowLeft size={17} aria-hidden="true" /><span>{copy.back}</span></button>
          </div>
          </> : (
            <section className={styles.benefitRecovery} data-testid="commerce-benefit-recovery" role="status">
              <Info size={24} aria-hidden="true" />
              <h3>{renderedBenefitPolicy.status === "ineligible" ? copy.policyIneligible : renderedBenefitPolicy.status === "below_minimum" ? copy.policyBelowMinimum : copy.policyExpired}</h3>
              <p>{copy.policyBody}</p>
              <button type="button" className={styles.primary} onClick={closeOffer}>{copy.back}</button>
            </section>
          )}
        </div>
      ) : null}

      {renderedView === "processing" ? (
        <div className={styles.paymentStatus} data-testid="payment-processing" data-payment-view-focus="processing" tabIndex={-1} aria-live="polite"><LoaderCircle className={styles.spinner} size={36} aria-hidden="true" /><h2>{copy.processing}</h2><p>{copy.processingBody}</p></div>
      ) : null}
      {renderedView === "operation" && liveCommerce.paymentOperation ? <section className={operationStyles.status} data-testid="payment-operation" data-phase={liveCommerce.paymentOperation.phase} data-payment-view-focus="operation" tabIndex={-1}>
        <Clock3 size={32} aria-hidden="true" />
        <ol className={operationStyles.steps} aria-label={words("Approval, capture, receipt", "승인, 매입, 영수증", "承認・決済確定・控え")}><li data-active={liveCommerce.paymentOperation.authorizedAt !== null}>{words("Approval", "승인", "承認")}</li><li data-active={liveCommerce.paymentOperation.phase === "settled"}>{words("Capture", "매입", "決済確定")}</li><li data-active={false}>{words("Receipt", "영수증", "控え")}</li></ol>
        <h2>{liveCommerce.paymentOperation.phase === "authorized" ? words("Approved. Not charged yet.", "승인됐어요. 아직 결제 전이에요.", "承認済み。まだ決済前です。") : liveCommerce.paymentOperation.phase === "unknown" ? words("Confirm this payment first", "이 결제부터 확인해 주세요", "まずこの決済を確認") : liveCommerce.paymentOperation.phase === "capture_failed" ? words("Capture did not complete", "매입을 완료하지 못했어요", "決済を確定できませんでした") : words("Approval did not complete", "승인을 완료하지 못했어요", "承認を完了できませんでした")}</h2>
        <strong className={operationStyles.amount}>{formatKrw(liveCommerce.paymentOperation.amountKrw, locale)}</strong>
        <p className={operationStyles.note}>{liveCommerce.paymentOperation.phase === "unknown" ? words("Do not pay again. Check the same operation; no debit or refund is assumed from an unknown result.", "다시 결제하지 마세요. 같은 요청을 조회하며, 불명 결과로 차감이나 환불을 확정하지 않습니다.", "再決済せず同じ申請を確認してください。不明な結果から引落や返金を確定しません。") : words("Your sample balance has not changed. No benefit has been used.", "샘플 잔액은 그대로이고 혜택도 아직 사용하지 않았어요.", "サンプル残高と特典はまだ変わっていません。")}</p>
        <dl className={operationStyles.amounts}><div><dt>{words("Balance", "잔액", "残高")}</dt><dd>{formatKrwFromSettlementUnits(stableCommerceBalanceB(liveCommerce), locale)}</dd></div><div><dt>{words("On hold", "승인 보류액", "保留額")}</dt><dd data-testid="payment-held-amount">{formatKrw(stableCommerceHeldKrwB(liveCommerce), locale)}</dd></div></dl>
        <button type="button" className={operationStyles.primary} data-testid="payment-operation-continue" onClick={() => resumePaymentOperation()}>{liveCommerce.paymentOperation.phase === "unknown" ? words("Check status", "상태 확인", "状況を確認") : liveCommerce.paymentOperation.phase === "authorized" ? words("Complete payment", "결제 완료하기", "決済を確定") : words("Try again", "다시 시도", "再試行")}</button>
        <button type="button" data-testid="payment-operation-back" onClick={closeOffer}>{liveCommerce.paymentOperation.phase === "unknown" ? words("Check later", "나중에 확인", "後で確認") : words("Cancel payment", "결제 취소", "決済をキャンセル")}</button>
        {liveCommerce.paymentOperation.phase === "unknown" ? <details className={operationStyles.samples}><summary>{words("Sample response", "샘플 응답", "サンプル応答")}</summary><button type="button" data-testid="payment-query-failure" onClick={() => resumePaymentOperation("failure")}>{words("Check: not completed", "조회: 미완료 응답", "照会：未完了の応答")}</button></details> : null}
        {renderedStorageError ? <p className={operationStyles.error} role="alert">{copy.paymentStorageError}</p> : null}
      </section> : null}

      {renderedView === "failure" || renderedView === "insufficient" ? (
        <div className={styles.paymentStatus} data-testid="payment-recovery" data-payment-view-focus={renderedView} data-recovery={renderedView} tabIndex={-1} aria-live="polite">
          <div className={styles.issueMark}>{renderedView === "failure" ? <RefreshCcw size={30} aria-hidden="true" /> : <WalletCards size={30} aria-hidden="true" />}</div>
          <h2>{renderedView === "failure" ? copy.failed : copy.insufficient}</h2>
          {renderedStorageError === "payment"
            ? <p className={styles.storageError} data-testid="commerce-storage-error" role="alert">{copy.paymentStorageError}</p>
            : <p>{renderedView === "failure" ? copy.failedBody : copy.insufficientBody}</p>}
          <button type="button" className={styles.primary} data-testid="payment-retry" onClick={retry}>{copy.retry}</button>
          {renderedView === "insufficient" ? <button type="button" className={styles.secondary} data-testid="payment-shortage-funding" onClick={event => { setView("review"); openFundingForQuote(event.currentTarget, "topup") }}>{words("Top up and return", "충전하고 돌아오기", "チャージして戻る")}</button> : null}
          <button type="button" className={styles.quietButton} onClick={closeOffer}>{copy.back}</button>
        </div>
      ) : null}

      {renderedView === "receipt" || renderedView === "refunded" ? (
        <div className={styles.receiptWrap} data-testid="payment-receipt" data-payment-view-focus={renderedView} data-refunded={renderedView === "refunded"} data-storage-error={renderedStorageError ?? "none"} data-completion-kind={renderedView} data-flow8-object="receipt" tabIndex={-1} aria-live="polite">
          <div className={styles.receiptMark}>{renderedView === "refunded" ? <RotateCcw size={31} aria-hidden="true" /> : <BadgeCheck size={33} aria-hidden="true" />}</div>
          <p className={styles.receiptEyebrow} data-testid="receipt-place-context" data-place-context="venue" data-venue-id={venueId}><MapPin size={15} aria-hidden="true" />{venueName}</p>
          <h2>{renderedView === "refunded" ? copy.refunded : copy.receipt}</h2>
          <p className={styles.receiptLead}>{renderedView === "refunded"
            ? commerce.voucherApplied ? copy.refundedBody : copy.refundedWithoutBenefit
            : commerce.voucherApplied ? copy.receiptBody : copy.receiptWithoutBenefit}</p>
          <section className={styles.receiptCard}>
            <div className={styles.receiptBalanceDelta}><span>{renderedView === "refunded" ? copy.balanceRestored : copy.balanceBefore}</span><strong>{formatKrwFromSettlementUnits(renderedView === "refunded" ? stableCommerceOpeningBalanceB(commerce) - commerce.chargedDebit : stableCommerceOpeningBalanceB(commerce), locale)} → {formatKrwFromSettlementUnits(balance, locale)}</strong></div>
            <div><span>{renderedView === "refunded" ? copy.originalPayment : copy.paid}</span><strong>{formatKrwFromSettlementUnits(commerce.chargedDebit, locale)}</strong></div>
            {renderedView === "refunded" ? <div><span>{copy.refundedAmount}</span><strong>{formatKrwFromSettlementUnits(commerce.chargedDebit, locale)}</strong></div> : null}
            {renderedView === "receipt" && stableCommerceRefundedKrwB(commerce) > 0 ? <div data-testid="payment-partial-refund"><span>{copy.refundedAmount}</span><strong>{formatKrw(stableCommerceRefundedKrwB(commerce), locale)}</strong></div> : null}
            <div><span>{copy.benefit}</span><strong>{formatKrwFromSettlementUnits(breakdown.benefit, locale)}</strong></div>
            <div><span>{copy.remaining}</span><strong>{formatKrwFromSettlementUnits(balance, locale)}</strong></div>
          </section>
          <p className={styles.receiptConsequence} data-testid="payment-receipt-consequence"><ShieldCheck size={15} aria-hidden="true" /><span>{reviewMode ? <><span data-testid="payment-review-provenance" data-review-provenance="review">{copy.reviewProvenance}</span>{" · "}</> : null}{copy.consequence}</span></p>
          {holderEntry && merchantEntry ? (
            <details className={styles.settlementDetails} data-testid="commerce-settlement-details">
              <summary><ReceiptText size={17} aria-hidden="true" /><span>{copy.settlement}</span><ChevronRight className={styles.disclosureChevron} size={16} aria-hidden="true" /></summary>
              <p className={styles.receiptBoundary} data-testid="commerce-local-only-status"><LockKeyhole size={15} aria-hidden="true" />{copy.demoNote}</p>
              <div data-testid="commerce-receipt-reference"><span>{renderedView === "refunded" ? copy.paymentReceipt : copy.receiptId}</span><code>{commerce.receiptId ?? order.receiptId}</code></div>
              {renderedView === "refunded" ? <div data-testid="commerce-refund-reference"><span>{copy.refundReference}</span><code>{holderEntry.receiptId ?? STABLE_B_REFUND_RECEIPT_ID}</code></div> : null}
              <div data-testid="commerce-operation-id"><span>{copy.operation}</span><code>{holderEntry.operationId}</code></div>
              <div data-testid="commerce-holder-delta"><span>{copy.holderChange}</span><strong>{formatSignedOokrw(holderEntry.amount, locale)}</strong></div>
              <div data-testid="commerce-merchant-delta"><span>{copy.merchantChange}</span><strong>{formatSignedOokrw(merchantEntry.amount, locale)}</strong></div>
              <div data-testid="commerce-settlement-total"><span>{copy.combinedChange}</span><strong>{formatSignedOokrw(settlementTotal, locale)}</strong></div>
              <div data-testid="commerce-provider-status" data-provider-order={commerce.providerOrder}><span>{copy.providerOrder}</span><strong>{copy.providerNotConnected}</strong></div>
              <p><ShieldCheck size={15} aria-hidden="true" />{copy.recordedOnly}</p>
            </details>
          ) : null}
          {renderedView === "receipt" ? <JourneyVisitEntryB key={`journey-${venueId}`} locale={locale} venueId={venueId} context="receipt" /> : null}
          <CommerceRefundsB locale={locale} scope="checkout" reviewMode={reviewMode && !closing} />
          {renderedStorageError === "refund" ? <p className={styles.storageError} data-testid="commerce-storage-error" role="alert">{copy.refundStorageError}</p> : null}
          <button type="button" className={styles.primary} data-testid="payment-receipt-return" onClick={closeOffer}>{crossVenueReceipt ? copy.returnToPlace(originVenueName) : copy.return}<ChevronRight size={18} aria-hidden="true" /></button>
          <button type="button" className={styles.quietButton} data-testid="payment-new-order" onClick={() => actions.openMealBenefitFromPlace(venueId, { newOrder: true })}>{words("Start another payment here", "이 매장에서 새 결제 시작", "このお店で新しい支払い")}</button>
        </div>
      ) : null}
    </section>
  )
}

const COMMERCE_FALLBACK_DESTINATIONS = [
  "[data-testid='canonical-meal-benefit-open']",
  "[data-testid='canonical-place-details']",
  "[data-testid='ondo-b-view-toggle']",
  "#ondo-active-panel",
] as const

/**
 * The payment surface cannot live inside the ID tab: returning to its venue
 * switches the canonical tab immediately. This stable mount keeps only the
 * last presentation alive for the exit interval; domain/history state is
 * still mutated synchronously by returnFromCommerceOrigin().
 */
export function CommerceOfferMountB() {
  const { state, actions } = useOndoB()
  const reviewMode = useQaControls()
  const liveOrigin = state.tab === "id"
    && state.commerceOrigin
    && resolveCommercePlaceB(state.commerceOrigin.venueId)?.commerce
    ? state.commerceOrigin
    : null
  const originSerialRef = useRef(0)
  const previousOriginVenueRef = useRef<string | null>(null)
  const liveOriginVenueId = liveOrigin?.venueId ?? null
  // Returning from a prerequisite gate restores the same venue context with a
  // fresh object. Keep that as the same presentation so consent and the ready
  // event cannot be lost to a remount. A real close (null) followed by reopen,
  // or a different venue, still receives a fresh serial and local state.
  if (liveOriginVenueId && previousOriginVenueRef.current !== liveOriginVenueId) originSerialRef.current += 1
  previousOriginVenueRef.current = liveOriginVenueId
  const originVenue = liveOrigin ? resolveCommercePlaceB(liveOrigin.venueId) : null
  const originVenueName = originVenue?.name[state.locale] ?? null
  const receiptVenue = state.commerceReceiptVenueId ? resolveCommercePlaceB(state.commerceReceiptVenueId) : null
  const receiptVenueName = receiptVenue?.name[state.locale] ?? null
  const hasTerminalReceipt = state.commerceSession.status === "paid" || state.commerceSession.status === "refunded"
  const crossVenueReceipt = Boolean(hasTerminalReceipt && originVenue && receiptVenue && originVenue.id !== receiptVenue.id)
  const walletStatus: OndoBCommerceWalletStatus = state.commerceWalletStatus
  const activeFundingSource: OndoBCommerceFundingSource = state.commerceFundingSource
  const offerKey = liveOrigin ? `commerce:${liveOrigin.venueId}:${stableCommerceOrderB(state.commerceSession).orderId}:${originSerialRef.current}` : null
  const desiredSubject = useMemo<CommerceOfferSubject | null>(() => {
    if (!liveOrigin || !originVenue || !originVenueName || !offerKey) return null
    const transactionVenue = crossVenueReceipt && receiptVenue && receiptVenueName
      ? { id: receiptVenue.id, name: receiptVenueName }
      : { id: liveOrigin.venueId, name: originVenueName }
    return {
      commerce: state.commerceSession,
      crossVenueReceipt,
      fundingSource: activeFundingSource,
      key: offerKey,
      locale: state.locale,
      originVenueId: liveOrigin.venueId,
      originVenueName,
      reviewMode,
      transactionVenueId: transactionVenue.id,
      transactionVenueName: transactionVenue.name,
      walletStatus,
    }
  }, [activeFundingSource, crossVenueReceipt, liveOrigin, offerKey, originVenue, originVenueName, receiptVenue, receiptVenueName, reviewMode, state.commerceSession, state.locale, walletStatus])
  const offerPresence = useSheetPresence(desiredSubject)
  const retainedSubject = offerPresence.value
  const presented = desiredSubject?.key === retainedSubject?.key && offerPresence.phase === "open"
    ? desiredSubject
    : retainedSubject
  const presentedPhase = desiredSubject?.key === retainedSubject?.key && offerPresence.phase === "open" ? "open" : "closing"

  const exactOpenerRef = useRef<HTMLElement | null>(null)
  const researchOpenerRef = useRef<{ placeId: string; action: "offer" } | null>(null)
  const restoreAfterExitRef = useRef(false)
  const desiredWasOpenRef = useRef(false)
  const desiredKeyRef = useRef<string | null>(null)
  const restorationSerialRef = useRef(0)
  const activeAtOpen = useMemo<HTMLElement | null>(() => liveOrigin
    && typeof document !== "undefined"
    && document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null, [liveOrigin])

  useLayoutEffect(() => {
    if (!desiredSubject) {
      if (desiredWasOpenRef.current) {
        restoreAfterExitRef.current = true
        restorationSerialRef.current += 1
      }
      desiredWasOpenRef.current = false
      return
    }
    const freshSubject = !desiredWasOpenRef.current || desiredKeyRef.current !== desiredSubject.key
    desiredWasOpenRef.current = true
    if (!freshSubject) return
    desiredKeyRef.current = desiredSubject.key
    restoreAfterExitRef.current = false
    restorationSerialRef.current += 1
    const opener = activeAtOpen?.closest<HTMLElement>("button") ?? null
    exactOpenerRef.current = opener
    researchOpenerRef.current = opener?.dataset.placeService === "offer"
      && opener.dataset.servicePlaceId === desiredSubject.originVenueId
      && resolveCommercePlaceB(desiredSubject.originVenueId)?.originKind === "research"
      && opener.closest("[role='dialog']")?.querySelector<HTMLElement>("[data-testid='researched-food-detail']")?.dataset.researchId === desiredSubject.originVenueId
      ? { placeId: desiredSubject.originVenueId, action: "offer" }
      : null
  }, [activeAtOpen, desiredSubject])

  useEffect(() => {
    if (offerPresence.value !== null || !restoreAfterExitRef.current) return
    restoreAfterExitRef.current = false
    const restorationSerial = restorationSerialRef.current
    const exactOpener = exactOpenerRef.current
    exactOpenerRef.current = null
    const researchOpener = researchOpenerRef.current
    researchOpenerRef.current = null
    let cancelFallback: (() => void) | undefined
    const frame = window.requestAnimationFrame(() => {
      if (restorationSerial !== restorationSerialRef.current || desiredWasOpenRef.current) return
      const active = document.activeElement
      const claimed = active instanceof HTMLElement
        && active !== document.body
        && active !== document.documentElement
        && active.isConnected
        && !active.closest("[inert],[aria-hidden='true']")
      if (claimed) return
      if (exactOpener?.isConnected && isRenderedFocusable(exactOpener)) {
        exactOpener.focus({ preventScroll: true })
        return
      }
      // Research detail is remounted behind the exiting payment sheet. Its
      // initial focus runs while it is still inert, so restore this exact
      // place/action only after exit, without changing global sheet timing.
      if (!exactOpener?.isConnected && researchOpener) {
        const replacement = Array.from(document.querySelectorAll<HTMLButtonElement>("button[data-service-place-id][data-place-service]"))
          .find(button => button.dataset.servicePlaceId === researchOpener.placeId
            && button.dataset.placeService === researchOpener.action
            && button.closest("[role='dialog']")?.querySelector<HTMLElement>("[data-testid='researched-food-detail']")?.dataset.researchId === researchOpener.placeId
            && isRenderedFocusable(button))
        if (replacement) {
          replacement.focus({ preventScroll: true })
          return
        }
      }
      cancelFallback = focusFirstAvailableDestination(COMMERCE_FALLBACK_DESTINATIONS)
    })
    return () => {
      window.cancelAnimationFrame(frame)
      cancelFallback?.()
    }
  }, [offerPresence.phase, offerPresence.value])

  const [linkSubject, setLinkSubject] = useState<WalletSheetSubject | null>(null)
  const [fundingOpen, setFundingOpen] = useState(false)
  const [fundingPurpose, setFundingPurpose] = useState<FundingSheetSubject["purpose"]>("payment")
  const linkSerialRef = useRef(0)
  const linkReturnFocusRef = useRef<WalletFocusReturn | null>(null)
  const linkReturnRequiresOfferRef = useRef(false)
  const linkCloseRequestedRef = useRef(false)
  const linkWasPresentRef = useRef(false)
  const fundingReturnFocusRef = useRef<FundingFocusReturn | null>(null)
  const fundingCloseRequestedRef = useRef(false)
  const fundingWasPresentRef = useRef(false)

  useLayoutEffect(() => {
    if (desiredSubject) return
    setLinkSubject((current) => current?.context.startsWith("offer-wallet:") ? null : current)
    setFundingOpen(false)
  }, [desiredSubject])

  useLayoutEffect(() => {
    if (state.tab === "id") return
    setLinkSubject((current) => current?.context.startsWith("wallet:") ? null : current)
  }, [state.tab])

  useEffect(() => {
    const openWallet = (event: Event) => {
      const trigger = event instanceof CustomEvent ? (event.detail as { trigger?: unknown } | null)?.trigger : null
      if (!(trigger instanceof HTMLButtonElement) || !trigger.isConnected) return
      linkSerialRef.current += 1
      linkReturnFocusRef.current = {
        exact: trigger,
        fallbackSelectors: ["[data-testid='wallet-link-open']", "#ondo-active-panel"],
      }
      linkReturnRequiresOfferRef.current = false
      linkCloseRequestedRef.current = false
      setLinkSubject({
        boundarySeen: state.commerceLocalBoundarySeen,
        context: `wallet:${linkSerialRef.current}`,
        locale: state.locale,
        reviewMode,
      })
    }
    window.addEventListener(COMMERCE_WALLET_OPEN_EVENT, openWallet)
    return () => window.removeEventListener(COMMERCE_WALLET_OPEN_EVENT, openWallet)
  }, [reviewMode, state.commerceLocalBoundarySeen, state.locale])

  const desiredLinkSubject = linkSubject?.context.startsWith("offer-wallet:")
    ? desiredSubject ? linkSubject : null
    : state.tab === "id" ? linkSubject : null
  const linkPresence = useSheetPresence(desiredLinkSubject)
  const linkPresentedPhase = desiredLinkSubject && linkPresence.phase === "open" ? "open" : "closing"
  const fundingSubject = useMemo<FundingSheetSubject | null>(() => presented ? {
    context: `offer:${presented.originVenueId}`,
    purpose: fundingPurpose,
    returnVenueName: presented.transactionVenueName,
    returnShortageKrw: Math.max(0, Math.round((stableCommerceQuoteDebitB(presented.commerce) - stableCommerceBalanceB(presented.commerce)) * 1_000)),
    locale: presented.locale,
    source: presented.fundingSource,
    walletReady: presented.walletStatus === "ready",
  } : null, [presented, fundingPurpose])
  const desiredFundingSubject = fundingOpen && desiredSubject && fundingSubject ? fundingSubject : null
  const fundingPresence = useSheetPresence(desiredFundingSubject)
  const fundingPresentedPhase = desiredFundingSubject && fundingPresence.phase === "open" ? "open" : "closing"

  useLayoutEffect(() => {
    if (linkPresence.value !== null) {
      linkWasPresentRef.current = true
      return
    }
    if (!linkWasPresentRef.current) return
    linkWasPresentRef.current = false
    linkCloseRequestedRef.current = false
    const focusReturn = linkReturnFocusRef.current
    const returnRequiresOffer = linkReturnRequiresOfferRef.current
    linkReturnFocusRef.current = null
    linkReturnRequiresOfferRef.current = false
    if (returnRequiresOffer && !desiredWasOpenRef.current) return
    let cancelFallback: (() => void) | undefined
    const frame = window.requestAnimationFrame(() => {
      if (focusReturn?.exact.isConnected && isRenderedFocusable(focusReturn.exact)) {
        focusReturn.exact.focus({ preventScroll: true })
        return
      }
      if (focusReturn) cancelFallback = focusFirstAvailableDestination(focusReturn.fallbackSelectors)
    })
    return () => {
      window.cancelAnimationFrame(frame)
      cancelFallback?.()
    }
  }, [linkPresence.phase, linkPresence.value])

  useLayoutEffect(() => {
    if (fundingPresence.value !== null) {
      fundingWasPresentRef.current = true
      return
    }
    if (!fundingWasPresentRef.current) return
    fundingWasPresentRef.current = false
    fundingCloseRequestedRef.current = false
    const focusReturn = fundingReturnFocusRef.current
    fundingReturnFocusRef.current = null
    if (!desiredWasOpenRef.current) return
    let cancelFallback: (() => void) | undefined
    const frame = window.requestAnimationFrame(() => {
      if (focusReturn?.exact.isConnected && isRenderedFocusable(focusReturn.exact)) {
        focusReturn.exact.focus({ preventScroll: true })
        return
      }
      if (focusReturn) cancelFallback = focusFirstAvailableDestination(focusReturn.fallbackSelectors)
    })
    return () => {
      window.cancelAnimationFrame(frame)
      cancelFallback?.()
    }
  }, [fundingPresence.phase, fundingPresence.value])

  function openLink(trigger: HTMLButtonElement) {
    linkSerialRef.current += 1
    linkReturnFocusRef.current = {
      exact: trigger,
      fallbackSelectors: ["[data-testid='payment-confirm']", "[data-testid='commerce-origin-return']"],
    }
    linkReturnRequiresOfferRef.current = true
    linkCloseRequestedRef.current = false
    if (!presented) return
    setLinkSubject({
      boundarySeen: state.commerceLocalBoundarySeen,
      context: `offer-wallet:${presented.key}:${linkSerialRef.current}`,
      locale: presented.locale,
      reviewMode: presented.reviewMode,
    })
  }

  function closeLink() {
    if (linkCloseRequestedRef.current) return
    linkCloseRequestedRef.current = true
    setLinkSubject(null)
  }

  function openFunding(trigger: HTMLButtonElement, purpose: FundingSheetSubject["purpose"]) {
    fundingReturnFocusRef.current = {
      exact: trigger,
      fallbackSelectors: ["[data-testid='commerce-funding-source'] button", "[data-testid='payment-confirm']"],
    }
    fundingCloseRequestedRef.current = false
    setFundingPurpose(purpose)
    setFundingOpen(true)
  }

  function closeFunding() {
    if (fundingCloseRequestedRef.current) return
    fundingCloseRequestedRef.current = true
    setFundingOpen(false)
  }

  return <>
    {presented ? <CanonicalCommerceOfferB
      key={presented.key}
      commerce={presented.commerce}
      locale={presented.locale}
      presenceState={presentedPhase}
      venueId={presented.transactionVenueId}
      venueName={presented.transactionVenueName}
      originVenueId={presented.originVenueId}
      originVenueName={presented.originVenueName}
      crossVenueReceipt={presented.crossVenueReceipt}
      walletStatus={presented.walletStatus}
      fundingSource={presented.fundingSource}
      reviewMode={presented.reviewMode}
      onConnect={openLink}
      onOpenFunding={openFunding}
      onClose={() => actions.returnFromCommerceOrigin()}
    /> : null}
    {linkPresence.value ? <WalletConnectSheet
      key={linkPresence.value.context}
      locale={linkPresence.value.locale}
      boundarySeen={linkPresence.value.boundarySeen}
      presenceState={linkPresentedPhase}
      subject={linkPresence.value.context}
      reviewMode={linkPresence.value.reviewMode}
      onAcknowledge={actions.acknowledgeCommerceLocalBoundary}
      onClose={closeLink}
      onReturn={actions.setCommerceWalletStatus}
    /> : null}
    {fundingPresence.value ? <FundingSourceSheet
      locale={fundingPresence.value.locale}
      source={fundingPresence.value.source}
      subject={fundingPresence.value.context}
      purpose={fundingPresence.value.purpose}
      returnVenueName={fundingPresence.value.returnVenueName}
      returnShortageKrw={fundingPresence.value.returnShortageKrw}
      walletReady={fundingPresence.value.walletReady}
      presenceState={fundingPresentedPhase}
      onSelect={actions.setCommerceFundingSource}
      onClose={closeFunding}
    /> : null}
  </>
}

type WalletFundingOpenRequest = Readonly<{
  serial: number
  subject: FundingSheetSubject
  trigger: HTMLButtonElement
}>

const COMMERCE_WALLET_FUNDING_OPEN_EVENT = "ondo-b-commerce-wallet-funding-open"

function openWalletFundingSheet(trigger: HTMLButtonElement, subject: Omit<FundingSheetSubject, "context">) {
  window.dispatchEvent(new CustomEvent(COMMERCE_WALLET_FUNDING_OPEN_EVENT, { detail: { subject, trigger } }))
}

/**
 * The wallet tab is replaceable content, so its modal cannot be owned by the
 * tab itself. This mount stays in the product overlay graph long enough to
 * paint the complete exit even when navigation removes the opener and the
 * whole wallet panel in the same commit.
 */
export function WalletFundingMountB() {
  const { state, actions } = useOndoB()
  const [request, setRequest] = useState<WalletFundingOpenRequest | null>(null)
  const requestRef = useRef(request)
  requestRef.current = request
  const serialRef = useRef(0)
  const closeRequestedRef = useRef(false)
  const wasPresentRef = useRef(false)
  const returnFocusRef = useRef<FundingFocusReturn | null>(null)
  const restorationSerialRef = useRef(0)

  useEffect(() => {
    const open = (event: Event) => {
      const detail = event instanceof CustomEvent
        ? event.detail as { subject?: Omit<FundingSheetSubject, "context">; trigger?: unknown } | null
        : null
      if (!(detail?.trigger instanceof HTMLButtonElement) || !detail.trigger.isConnected || !detail.subject) return
      serialRef.current += 1
      restorationSerialRef.current += 1
      closeRequestedRef.current = false
      returnFocusRef.current = {
        exact: detail.trigger,
        fallbackSelectors: [
          "[data-testid='wallet-funding-change']",
          "[data-testid='wallet-payment-method'] button",
          "#ondo-active-panel",
          "[aria-current='page']",
        ],
      }
      const nextRequest = {
        serial: serialRef.current,
        subject: { ...detail.subject, context: `wallet:${serialRef.current}` },
        trigger: detail.trigger,
      }
      requestRef.current = nextRequest
      setRequest(nextRequest)
    }
    window.addEventListener(COMMERCE_WALLET_FUNDING_OPEN_EVENT, open)
    return () => window.removeEventListener(COMMERCE_WALLET_FUNDING_OPEN_EVENT, open)
  }, [])

  // A history transition can remove a tab-local opener without changing the
  // funding request first. Observe that ownership boundary instead of relying
  // only on a particular navigation API to remember to close the sheet.
  useEffect(() => {
    if (!request) return
    const closeWhenOwnerLeaves = () => {
      if (request.trigger.isConnected || requestRef.current?.serial !== request.serial) return
      restorationSerialRef.current += 1
      requestRef.current = null
      setRequest((current) => current?.serial === request.serial ? null : current)
    }
    const observer = new MutationObserver(closeWhenOwnerLeaves)
    observer.observe(document.body, { childList: true, subtree: true })
    closeWhenOwnerLeaves()
    return () => observer.disconnect()
  }, [request])

  useLayoutEffect(() => {
    if (state.tab === "id" || requestRef.current === null) return
    restorationSerialRef.current += 1
    requestRef.current = null
    setRequest((current) => current === null ? current : null)
  }, [state.tab])

  const desiredSubject = state.tab === "id" ? request?.subject ?? null : null
  const presence = useSheetPresence(desiredSubject)
  const presentedPhase = desiredSubject && presence.phase === "open" ? "open" : "closing"

  useLayoutEffect(() => {
    if (presence.value !== null) {
      wasPresentRef.current = true
      return
    }
    if (!wasPresentRef.current) return
    wasPresentRef.current = false
    closeRequestedRef.current = false
    const focusReturn = returnFocusRef.current
    returnFocusRef.current = null
    const restorationSerial = restorationSerialRef.current
    let cancelFallback: (() => void) | undefined
    const frame = window.requestAnimationFrame(() => {
      if (restorationSerial !== restorationSerialRef.current || requestRef.current) return
      const active = document.activeElement
      const claimed = active instanceof HTMLElement
        && active !== document.body
        && active !== document.documentElement
        && active.isConnected
        && !active.closest("[inert],[aria-hidden='true']")
      if (claimed) return
      if (focusReturn?.exact.isConnected && isRenderedFocusable(focusReturn.exact)) {
        focusReturn.exact.focus({ preventScroll: true })
        return
      }
      if (focusReturn) cancelFallback = focusFirstAvailableDestination(focusReturn.fallbackSelectors)
    })
    return () => {
      window.cancelAnimationFrame(frame)
      cancelFallback?.()
    }
  }, [presence.phase, presence.value])

  function close() {
    if (closeRequestedRef.current) return
    closeRequestedRef.current = true
    restorationSerialRef.current += 1
    requestRef.current = null
    setRequest(null)
  }

  return presence.value ? <FundingSourceSheet
    locale={presence.value.locale}
    source={presence.value.source}
    subject={presence.value.context}
    purpose={presence.value.purpose}
    walletReady={presence.value.walletReady}
    presenceState={presentedPhase}
    onSelect={actions.setCommerceFundingSource}
    onClose={close}
  /> : null
}

export function IdWalletCommerceB() {
  const { state, actions } = useOndoB()
  const reviewMode = useQaControls()
  const linkButtonRef = useRef<HTMLButtonElement>(null)
  const locale = state.locale
  const copy = COPY[locale]
  const walletStatus: OndoBCommerceWalletStatus = state.commerceWalletStatus
  const commerce = state.commerceSession
  const balance = stableCommerceBalanceB(commerce)
  const visibleBalance = reviewMode ? balance : 0
  const venueLocale = locale
  const receiptVenue = state.commerceReceiptVenueId ? resolveCommercePlaceB(state.commerceReceiptVenueId) : null
  const receiptVenueName = receiptVenue?.name[venueLocale] ?? null
  const order = stableCommerceOrderB(commerce)
  const orders = stableCommerceOrdersB(commerce).filter(item => item.status !== "idle" || item.confirmationPending)
  const words = (en: string, ko: string, ja: string) => locale === "ko" ? ko : locale === "ja" ? ja : en
  const fundingCopy = FUNDING_COPY[locale]
  const activeFundingSource: OndoBCommerceFundingSource = state.commerceFundingSource
  const walletPresentationState = walletStatus === "ready" && !reviewMode ? "empty" : walletStatus

  function openReceiptPlace() {
    if (!receiptVenue) return
    if (receiptVenue.originKind === "canonical") openSavedBDiscoveryVenue(receiptVenue.id, receiptVenue.cityId)
    actions.setSurface(receiptVenue.originKind === "canonical" ? { kind: "venue", venueId: receiptVenue.id } : { kind: "map" })
    actions.setTab("ondo")
    window.requestAnimationFrame(() => requestPlaceServiceReturnB(receiptVenue.id, "offer"))
  }

  function openBenefitPlace() {
    actions.setTab("ondo")
    actions.setSurface({ kind: "map" })
    window.requestAnimationFrame(() => requestBalancePlacesB())
  }

  return (
    <section className={styles.root} data-testid="ondo-b-id-wallet-commerce" data-wallet={walletStatus} data-visual-direction="apple-wallet-flow8" aria-labelledby="id-wallet-commerce-title">
      <div className={styles.heading}><p data-testid="wallet-eyebrow">{copy.eyebrow}</p><h2 id="id-wallet-commerce-title">{copy.title}</h2><span>{copy.body}</span></div>

      <section className={styles.balanceCard} data-testid="wallet-balance" data-flow8-object="wallet" data-wallet-state={walletPresentationState}>
        <div className={styles.balanceTop}><span>{copy.balance}</span>{walletStatus !== "disconnected" ? <small data-status={walletPresentationState}>{walletStatus === "ready" ? reviewMode ? <BadgeCheck size={15} aria-hidden="true" /> : <CircleDollarSign size={15} aria-hidden="true" /> : <RefreshCcw size={14} aria-hidden="true" />}<span>{walletStatus === "ready" ? reviewMode ? copy.balanceReady : copy.balanceEmptyStatus : copy.balanceFailed}</span></small> : null}</div>
        <div className={styles.balanceAmount}>
          <strong data-testid="wallet-display-equivalent">{walletStatus === "ready" ? formatKrwFromSettlementUnits(visibleBalance, locale) : "—"}</strong>
          <span data-testid="wallet-test-balance">{walletStatus === "ready" ? reviewMode ? words("Travel balance", "여행 잔액", "旅の残高") : copy.balanceEmptyReady : copy.balanceEmpty}</span>
          {walletStatus === "ready" && reviewMode ? <small className={styles.balanceReview} data-testid="wallet-review-provenance" data-review-provenance="review"><ShieldCheck size={13} aria-hidden="true" />{copy.balanceReview}</small> : null}
          {reviewMode && stableCommerceHeldKrwB(commerce) > 0 ? <small className={styles.balanceReview} data-testid="wallet-payment-hold"><Clock3 size={13} aria-hidden="true" />{locale === "ko" ? "보류" : locale === "ja" ? "保留" : "On hold"} {formatKrw(stableCommerceHeldKrwB(commerce), locale)} · {locale === "ko" ? "사용 가능" : locale === "ja" ? "利用可能" : "Available"} {formatKrw(Math.max(0, visibleBalance * 1_000 - stableCommerceHeldKrwB(commerce)), locale)}</small> : null}
        </div>
        <div className={styles.balanceFooter}>
          {walletStatus === "ready" ? <p>{reviewMode ? copy.balanceSource : copy.balanceSourceEmpty}</p> : null}
          {walletStatus === "ready" ? (
            reviewMode
              ? <button type="button" className={styles.balanceAction} aria-label={copy.disconnect} onClick={() => actions.setCommerceWalletStatus("disconnected")}><span className={styles.balanceActionFull}>{copy.disconnect}</span><span className={styles.balanceActionCompact} aria-hidden="true">{copy.disconnectCompact}</span></button>
              : <button type="button" className={styles.balanceAction} data-testid="wallet-funding-primary" data-wallet-primary="funding" aria-label={fundingCopy.chooseFunding} onClick={(event) => openWalletFundingSheet(event.currentTarget, { locale, source: activeFundingSource, purpose: "topup", walletReady: true })}><CircleDollarSign size={17} aria-hidden="true" /><span className={styles.balanceActionFull}>{fundingCopy.chooseFunding}</span><span className={styles.balanceActionCompact} aria-hidden="true">{fundingCopy.addFunds}</span></button>
          ) : (
            <button ref={linkButtonRef} type="button" className={styles.balanceAction} data-testid="wallet-link-open" aria-label={walletStatus === "failed" ? copy.reconnect : copy.connect} onClick={(event) => openCommerceWalletSheet(event.currentTarget)}><WalletCards size={17} aria-hidden="true" /><span className={styles.balanceActionFull}>{walletStatus === "failed" ? copy.reconnect : copy.connect}</span><span className={styles.balanceActionCompact} aria-hidden="true">{walletStatus === "failed" ? copy.reconnectCompact : copy.connectCompact}</span></button>
          )}
        </div>
      </section>

      <div className={styles.walletMapActions}>
        {walletStatus === "ready" ? <button type="button" className={styles.secondary} data-testid="wallet-add-funds" onClick={event => openWalletFundingSheet(event.currentTarget, { locale, source: activeFundingSource, purpose: "topup", walletReady: true })}>{fundingCopy.addFunds}</button> : null}
        <details className={styles.privacy} data-testid="wallet-balance-info"><summary><Info size={16} aria-hidden="true" />{words("About this balance", "잔액 안내", "残高について")}</summary><p>{FUNDING_COPY[locale].technicalBody}</p></details>
      </div>

      <div className={styles.dashboardGrid}>
        <section className={styles.benefitCard} data-testid="wallet-benefit">
          <div className={styles.cardHeading}><Gift size={20} aria-hidden="true" /><span>{copy.benefits}</span><small>{commerce.status === "paid" && commerce.voucherApplied ? copy.benefitUsed : copy.benefitState}</small></div>
          <h3>{copy.benefitTitle(formatKrwFromSettlementUnits(STABLE_B_VOUCHER_VALUE, locale))}</h3><p>{copy.benefitBody}</p>
          <button type="button" data-testid="wallet-balance-places" onClick={openBenefitPlace}><MapPin size={18} aria-hidden="true" />{words("Find places to use it", "잔액으로 이용할 곳 보기", "残高を使える場所を見る")}<ChevronRight size={18} aria-hidden="true" /></button>
        </section>

        <section className={styles.methodCard} data-testid="wallet-payment-method" data-funding-source={activeFundingSource}>
          <div className={styles.cardHeading}><CreditCard size={20} aria-hidden="true" /><span>{fundingCopy.selected}</span></div>
          <h3>{fundingSourceLabel(locale, activeFundingSource)}</h3>
          <p>{activeFundingSource === "travel_balance"
            ? walletStatus === "ready" ? reviewMode ? fundingCopy.ready : fundingCopy.addFunds : fundingCopy.setup
            : fundingCopy.provider}</p>
          <button type="button" data-testid="wallet-funding-change" onClick={(event) => openWalletFundingSheet(event.currentTarget, { locale, source: activeFundingSource, purpose: "payment", walletReady: walletStatus === "ready" })}>{fundingCopy.change}<ChevronRight size={16} aria-hidden="true" /></button>
        </section>

        <section className={styles.activityCard} data-testid="wallet-activity">
          <div className={styles.cardHeading}><Clock3 size={20} aria-hidden="true" /><span>{copy.activity}</span></div>
          {(orders.length > 1 || orders.length === 1 && commerce.status === "idle") ? <div className={styles.orderHistory} data-testid="wallet-order-history" role="group" aria-label={words("Choose a visit", "장소별 이용 내역", "場所別の利用履歴")}>{[...orders].reverse().map(item => {
            const context = stableCommerceOrderB(item)
            const place = resolveCommercePlaceB(context.venueId)
            return <button type="button" key={context.orderId} data-testid="wallet-order-select" data-order-id={context.orderId} aria-pressed={context.orderId === order.orderId} onClick={() => actions.selectCommerceOrder(context.orderId)}><span><strong>{place?.name[locale] ?? context.venueId}</strong><small>{item.status === "refunded" ? words("Refunded", "환불 완료", "返金済み") : item.status === "paid" ? words("Payment receipt", "결제 영수증", "決済の控え") : words("Check payment", "결제 확인", "決済を確認")}</small></span><b>{formatKrw(item.chargedDebit * 1_000 || item.lockedQuote?.finalDebit && item.lockedQuote.finalDebit * 1_000 || 0, locale)}</b></button>
          })}</div> : null}
          {commerce.status === "paid" || commerce.status === "refunded" ? (
            <details className={styles.activityReceipt} data-testid="wallet-activity-receipt">
              <summary><ReceiptText size={22} aria-hidden="true" /><span><strong>{commerce.status === "refunded" ? `${copy.refundedActivity} ${formatKrwFromSettlementUnits(commerce.chargedDebit, locale)}` : `${copy.paidActivity} ${formatKrwFromSettlementUnits(commerce.chargedDebit, locale)}`}</strong><small>{receiptVenueName ? `${copy.activityVenue} ${receiptVenueName}` : copy.activityReceipt}</small></span><ChevronRight size={17} aria-hidden="true" /></summary>
              <div><span>{commerce.status === "refunded" ? copy.originalPayment : copy.activityReceipt}</span><code>{commerce.receiptId}</code></div>
              {commerce.status === "refunded" ? <div><span>{copy.refundReference}</span><code>{commerce.refundOperations?.filter(item => item.phase === "settled").at(-1)?.receiptId ?? STABLE_B_REFUND_RECEIPT_ID}</code></div> : null}
              <CommerceRefundsB key={order.orderId} locale={locale} scope="wallet" reviewMode={reviewMode} />
              {receiptVenue ? <button type="button" data-testid="wallet-activity-place" onClick={openReceiptPlace}><MapPin size={16} aria-hidden="true" />{copy.activityPlace}<ChevronRight size={16} aria-hidden="true" /></button> : null}
            </details>
          ) : reviewMode && commerce.confirmationPending && commerce.paymentOperation ? <section className={operationStyles.paymentOptions} data-testid="wallet-pending-payment"><div className={operationStyles.body}><Clock3 size={20} aria-hidden="true" /><strong>{locale === "ko" ? "확인 중인 결제" : locale === "ja" ? "確認中の決済" : "Payment to check"}</strong><span>{formatKrw(commerce.paymentOperation.amountKrw, locale)}</span><button type="button" data-testid="wallet-payment-resume" onClick={() => actions.openMealBenefitFromPlace(order.venueId, { orderId: order.orderId })}>{locale === "ko" ? "같은 결제 확인" : locale === "ja" ? "同じ決済を確認" : "Check this payment"}</button></div></section> : orders.length === 0 ? <div className={styles.emptyActivity} data-testid="wallet-purchases-empty"><ReceiptText size={25} aria-hidden="true" /><div><h3>{copy.noActivity}</h3><p>{copy.noActivityBody}</p></div></div> : null}
        </section>
      </div>

      <details className={styles.privacy} data-testid="wallet-privacy"><summary><ShieldCheck size={17} aria-hidden="true" />{copy.privacy}</summary><p>{copy.privacyBody}</p><p><Info size={15} aria-hidden="true" />{copy.testTruth}</p></details>

    </section>
  )
}
