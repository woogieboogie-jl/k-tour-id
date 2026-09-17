"use client"

import type { KeyboardEvent } from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, BadgeCheck, BookOpenCheck, ChevronRight, CircleUserRound, CreditCard, HeartHandshake, IdCard, LoaderCircle, MapPin, RotateCcw, ShieldCheck, Sparkles, Smartphone, Timer, UserRoundCheck, Waves, X } from "lucide-react"
import { venueLabelById } from "@/lib/ondo/venues/display"
import { editorialPlaceById } from "../pulse-b/japan-first-pulse-model-b"
import { resolveCommercePlaceB } from "../commerce-b/place-service-registry-b"
import { createKPassPresentationBinding, evaluateKPassService } from "../contracts/kpass-capabilities"
import { EXPERIENCE_COPY_B } from "../experience-b/experience-copy-b"
import { requestExperienceB } from "../experience-b/experience-model-b"
import { kpassDecisionLabel, kpassDecisionRecovery } from "./kpass-decision-copy"
import { createReviewFixtureAuthority, providerUnavailable, reviewFixture, type ProviderUnavailableExecution, type ReviewFixtureExecution, type ReviewFixtureOutcome } from "../contracts/execution-mode"
import {
  GLOBAL_AFTER19_SESSION_EVENT,
  isGlobalAfter19AgeCurrent,
  persistGlobalAfter19SessionB,
  recordGlobalAfter19ReviewEligibilityB,
  restoreGlobalAfter19B,
  type GlobalAfter19SessionB,
} from "../after19/after19-global-b-model"
import { ONDO_OPEN_TABLE_EVENT } from "../connect/tables-entry-b"
import { useOndoB } from "../shared/state/ondo-b-provider"
import { isRenderedFocusable } from "../shared/ui/is-rendered-focusable"
import { ONDO_MODAL_PRIORITY } from "../shared/ui/modal-layer-priority"
import { useModalIsolation } from "../shared/ui/use-modal-isolation"
import { enterReviewSample, qaReviewFixtureOptions, readQaRuntime, useQaControls } from "../shared/ui/use-qa-controls"
import {
  createPresentationRequestB,
  isPresentationRequestActiveB,
  isSimulatedCredentialActiveB,
  isPersonOnlySimulatedCredentialB,
  resolvePresentationRequestB,
  type OndoBPresentationRequest,
} from "./ktour-id-setup-model-b"
import {
  B_ACTION_GATE_CANCEL_EVENT,
  B_ACTION_AXIS_SESSION_EVENT,
  B_ACTION_GATE_COMPLETE_EVENT,
  B_ACTION_GATE_READY_EVENT,
  B_ACTION_GATE_REQUEST_EVENT,
  DEFAULT_B_ACTION_GATE_SESSION,
  abandonPendingBAction,
  authorizeBActionPresentationDecision,
  bActionPresentationPurpose,
  createBActionReviewAxis,
  hasBActionPresentationApproval,
  hashBActionReturnTo,
  isBActionReturnPending,
  persistBActionGateSession,
  privateContextForBAction,
  recordBActionPresentationApproval,
  registerBActionPresentationRequest,
  requiresBActionPresentation,
  renewExpiredPendingBAction,
  restoreBActionGateSession,
  type BActionAxis,
  type BActionGateKind,
  type BActionGateOutcome,
  type BActionGateSession,
  type BPersonRouteB,
  type BActionReturnTo,
} from "./action-gate-contract-b"
import styles from "./action-gate-coordinator-b.module.css"

const FOCUSABLE = "button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex='-1'])"

type GateView = "intro" | "failure" | "unavailable" | "unsupported" | "expired"
type GateRenderView = GateView | "processing" | "success"
type GateQaOutcome = "failure" | "unavailable" | "expired"
type GateTerminalStatus = GateQaOutcome | "unsupported"
type BActionCoordinatorStep = BActionGateKind | "credential"
type ResidenceAvailability = "supported" | "unsupported" | "outage"
type QaRuntime = {
  actionGate?: Partial<Record<BActionCoordinatorStep, GateQaOutcome>>
  eligibility?: "success" | "cancel" | "failure" | "unavailable" | "expired"
  after19?: GateQaOutcome
  paymentKyc?: GateQaOutcome
  residenceCard?: ResidenceAvailability
}
type PersonReviewOutcome = "success" | "cancel" | GateQaOutcome
type PersonExecutionDecision = Readonly<{
  execution: ProviderUnavailableExecution | ReviewFixtureExecution<{ axis: "person"; route: BPersonRouteB }>
  unavailableStatus: "unavailable" | "unsupported"
}>
type PendingAgeReview = { tokenId: string; session: GlobalAfter19SessionB; execution?: ReviewFixtureExecution<{ predicate: "AGE_GTE_19"; outcome: "eligible" }> }
type PendingPersonReview = { tokenId: string; execution: ReviewFixtureExecution<{ axis: "person"; route: BPersonRouteB }> }
type PendingPaymentReview = { tokenId: string; execution: ReviewFixtureExecution<{ axis: "payment_kyc" }> }
type TableIntentWindow = Window & {
  __ONDO_B_TABLE_INTENT__?: { tableId: string; venueId: string; mode: string; draft?: string }
}

const COPY = {
  en: {
    accountTitle: "Create an account to continue",
    accountBody: "You’ll return to the same action when it’s ready.",
    accountHeader: "Account",
    accountTableTitle: "Create an account to join this Table",
    accountSignalTitle: "Create an account to add this place note",
    accountCheckoutTitle: "Create an account to continue payment",
    accountJitBody: "You’ll return to the same place and unfinished action automatically.",
    accountProcessingTitle: "Creating your account…",
    accountProcessingBody: "Your unfinished action stays here.",
    accountDetails: "Account and privacy",
    accountBoundary: "This creates an account for this session. Identity, 19+, K-Tour ID and payment are requested only when needed.",
    checkoutPaymentTitle: "One last check before payment",
    checkoutPaymentBody: "After this check, we’ll continue the payment you approved. If the place or amount has changed, you’ll review it again.",
    checkoutPaymentAction: "Confirm and continue",
    checkoutDetails: "Privacy and check details",
    checkoutCancel: "Back to payment",
    notNow: "Not now",
    personTitle: "Confirm one person",
    personBody: "Choose a method for this action.",
    personProcessingTitle: "Checking one result…",
    personProcessingBody: "Your original action stays here.",
    personSuccessTitle: "Review result ready",
    personSuccessBody: "No external service confirmation",
    ageProcessingTitle: "Checking 19+…",
    ageProcessingBody: "Your Table and note stay here.",
    ageSuccessTitle: "19+ review result ready",
    ageSuccessBody: "Returning to your Table…",
    paymentProcessingTitle: "Checking payment readiness…",
    paymentProcessingBody: "Your order, benefit and amount stay unchanged.",
    paymentSuccessTitle: "Payment review result ready",
    paymentSuccessBody: "Returning to the same payment…",
    ageTitle: "Confirm 19+",
    ageBody: "Continue to this Table without sharing your birth date.",
    credentialMissingTitle: "Set up K-Tour ID to continue",
    credentialMissingBody: "Your place and unfinished action stay right here.",
    credentialTableTitle: "Share eligibility with this Table?",
    credentialCheckoutTitle: "Use your K-Tour benefit here?",
    credentialBody: "Approve one minimum eligibility check for this action only.",
    credentialSetupAction: "Set up K-Tour ID",
    credentialApproveAction: "Approve once",
    credentialDenyAction: "Not now",
    credentialDetails: "Provider details",
    credentialPredicate: "K-Tour travel eligibility · yes/no only",
    credentialRetention: "This request only · no reusable ID or personal data",
    paymentTitle: "Check payment readiness",
    paymentBody: "Return to the same order when the check is complete. Nothing is charged here.",
    accountAction: "Continue with a visit account",
    personAction: "Agree and confirm",
    mobileAction: "Agree and confirm",
    residenceAction: "Check availability",
    passportAction: "Agree and confirm",
    routeChoiceLegend: "Choose a method",
    routeChoiceMobile: "Mobile ID",
    routeChoiceResidence: "Residence Card",
    routeChoicePassport: "Passport",
    routeUnavailable: "Unavailable now",
    routeUnsupported: "Not supported",
    routeReview: "Review path",
    chooseAnother: "Choose another method",
    reviewTruth: "Review result · no external service confirmation",
    providerDetails: "How this works",
    privacyDetails: "Privacy details",
    ageBoundary: "No date of birth is requested or stored. Only a temporary 19+ result returns to this Table; it is not a rule for the venue.",
    routeLabel: "Selected ID",
    mobileTitle: "Mobile ID",
    mobileNote: "Uses an OmniOne CX handoff when connected. Nothing is sent here.",
    residenceTitle: "Mobile Residence Card",
    residenceNote: "This option is not connected here yet.",
    passportTitle: "Passport",
    passportNote: "A separate passport check is used when connected.",
    residenceUnavailableTitle: "Mobile Residence Card is not connected yet",
    residenceUnavailableBody: "Choose the passport option instead, or return to what you were doing.",
    residenceUnsupportedTitle: "This Residence Card is not supported",
    residenceUnsupportedBody: "Use Passport instead. Your original action is unchanged.",
    usePassport: "Use passport instead",
    ageAction: "Confirm 19+ and continue",
    paymentAction: "Prepare Payment check and continue",
    returnLabel: "Return to",
    table: "Table and host note",
    signal: "Place note",
    checkout: "Place payment",
    badge: "Travel keepsake",
    truth: "No identity provider is connected. Identity data is not sent and no credential is created.",
    cancel: "Go back",
    failureTitle: "This check did not complete",
    failureBody: "The exact action context is unchanged. Nothing was submitted, joined, or paid.",
    unavailableTitle: "This check is unavailable",
    unavailableBody: "Continue with prepared sample data, or return without changing your action.",
    sampleAction: "Continue with sample",
    expiredTitle: "The check or return path expired",
    expiredBody: "Refresh the same return path to continue without losing its registered context.",
    retry: "Try again",
    renew: "Refresh return path",
    consentRequester: "Requested by",
    consentRequesterValue: "K-Tour ID Travel Pass",
    consentPurpose: "Used for",
    consentPurposeValue: "Add your place note and return to it.",
    consentMinimum: "Answer shared",
    consentMinimumValue: "Person · yes/no only — separate from 19+",
    consentRetention: "Kept for",
    consentRetentionValue: "This tab · up to 1 hour — no personal data saved",
    returnDraft: "Review your unfinished note",
    planLabel: "Required checks",
    planAccount: "Account",
    planPerson: "Identity",
    planAge: "19+",
    planCredential: "K-Tour ID",
    planPayment: "Payment",
  },
  ko: {
    accountTitle: "계정을 만들고 계속하세요",
    accountBody: "준비되면 하던 작업으로 바로 돌아갑니다.",
    accountHeader: "계정",
    accountTableTitle: "이 Table에 참여하려면 계정이 필요해요",
    accountSignalTitle: "이 장소에 지금 분위기를 남기려면 계정이 필요해요",
    accountCheckoutTitle: "결제를 계속하려면 계정이 필요해요",
    accountJitBody: "같은 장소와 하던 작업으로 바로 돌아갑니다.",
    accountProcessingTitle: "계정을 만들고 있어요…",
    accountProcessingBody: "하던 작업을 그대로 유지해요.",
    accountDetails: "계정과 개인정보",
    accountBoundary: "이 세션에서 쓸 계정을 만듭니다. 본인·19+·K-Tour ID·결제 확인은 필요할 때만 각각 요청해요.",
    checkoutPaymentTitle: "결제 전 마지막 확인",
    checkoutPaymentBody: "확인이 끝나면 앞서 동의한 결제를 이어가요. 장소나 금액이 바뀌었다면 다시 확인합니다.",
    checkoutPaymentAction: "확인하고 결제 이어가기",
    checkoutDetails: "개인정보 및 확인 안내",
    checkoutCancel: "결제로 돌아가기",
    notNow: "나중에",
    personTitle: "한 사람 확인",
    personBody: "이 행동에 사용할 방법을 선택하세요.",
    personProcessingTitle: "필요한 결과만 확인 중…",
    personProcessingBody: "하던 작업은 그대로 유지돼요.",
    personSuccessTitle: "검토 결과가 준비됐어요",
    personSuccessBody: "외부 서비스 확인 없음",
    ageProcessingTitle: "19+ 확인 중…",
    ageProcessingBody: "테이블과 메모는 그대로 유지돼요.",
    ageSuccessTitle: "19+ 검토 결과가 준비됐어요",
    ageSuccessBody: "테이블로 돌아갑니다…",
    paymentProcessingTitle: "결제 준비 상태 확인 중…",
    paymentProcessingBody: "주문과 혜택, 금액은 그대로 유지돼요.",
    paymentSuccessTitle: "결제 검토 결과가 준비됐어요",
    paymentSuccessBody: "같은 결제로 돌아갑니다…",
    ageTitle: "19+ 확인",
    ageBody: "생년월일을 공유하지 않고 이 테이블로 계속하세요.",
    credentialMissingTitle: "K-Tour ID를 준비하고 계속하세요",
    credentialMissingBody: "장소와 하던 작업은 그대로 유지됩니다.",
    credentialTableTitle: "이 테이블에 여행 자격을 공유할까요?",
    credentialCheckoutTitle: "여기서 K-Tour 혜택을 사용할까요?",
    credentialBody: "이 작업에 필요한 최소 자격만 한 번 확인합니다.",
    credentialSetupAction: "K-Tour ID 준비",
    credentialApproveAction: "이번 한 번만 승인",
    credentialDenyAction: "나중에",
    credentialDetails: "연결 방식",
    credentialPredicate: "K-Tour 여행 자격 · 예/아니오만",
    credentialRetention: "이번 요청에만 사용 · 재사용 ID나 개인정보 없음",
    paymentTitle: "결제 준비 확인",
    paymentBody: "확인이 끝나면 같은 결제로 돌아갑니다. 여기서는 청구되지 않아요.",
    accountAction: "방문 계정으로 계속",
    personAction: "동의하고 확인",
    mobileAction: "동의하고 확인",
    residenceAction: "연결 확인",
    passportAction: "동의하고 확인",
    routeChoiceLegend: "확인 방법 선택",
    routeChoiceMobile: "모바일 신분증",
    routeChoiceResidence: "외국인등록증",
    routeChoicePassport: "여권",
    routeUnavailable: "현재 이용할 수 없음",
    routeUnsupported: "지원하지 않음",
    routeReview: "검토 경로",
    chooseAnother: "다른 방법 선택",
    reviewTruth: "검토용 결과 · 외부 서비스 확인 없음",
    providerDetails: "확인 방식",
    privacyDetails: "개인정보 안내",
    ageBoundary: "생년월일은 요청하거나 저장하지 않습니다. 임시 19+ 결과만 이 테이블로 돌아오며 장소 자체의 규칙으로 표시하지 않습니다.",
    routeLabel: "선택한 신분증",
    mobileTitle: "모바일 신분증",
    mobileNote: "연결된 환경에서는 OmniOne CX로 이어집니다. 여기서는 실제 요청을 보내지 않아요.",
    residenceTitle: "모바일 외국인등록증",
    residenceNote: "이 경로는 아직 연결되지 않았어요.",
    passportTitle: "여권",
    passportNote: "연결되면 별도의 여권 확인 경로를 사용해요.",
    residenceUnavailableTitle: "모바일 외국인등록증 경로는 아직 연결 전이에요",
    residenceUnavailableBody: "여권 경로를 선택하거나 하던 작업으로 돌아갈 수 있어요.",
    residenceUnsupportedTitle: "이 외국인등록증 방식은 지원하지 않아요",
    residenceUnsupportedBody: "여권으로 계속할 수 있어요. 하던 작업은 그대로입니다.",
    usePassport: "여권으로 대신 확인",
    ageAction: "19+ 확인하고 계속",
    paymentAction: "결제 확인 준비하고 계속",
    returnLabel: "돌아갈 곳",
    table: "테이블과 호스트 메모",
    signal: "작성 중인 장소 메모",
    checkout: "매장 결제",
    badge: "여행 기념 배지",
    truth: "연결된 신원확인 기관이 없습니다. 신원 정보는 전송하지 않고 자격증명도 만들지 않아요.",
    cancel: "돌아가기",
    failureTitle: "확인을 완료하지 못했어요",
    failureBody: "정확한 작업 맥락은 그대로입니다. 게시·참여·결제된 내용은 없습니다.",
    unavailableTitle: "지금은 확인할 수 없어요",
    unavailableBody: "준비된 샘플로 이어보거나, 진행 중인 작업을 바꾸지 않고 돌아가세요.",
    sampleAction: "샘플로 계속",
    expiredTitle: "확인 또는 복귀 경로가 만료됐어요",
    expiredBody: "등록된 맥락을 잃지 않고 같은 복귀 경로를 새로 만들어 계속하세요.",
    retry: "다시 시도",
    renew: "복귀 경로 새로 만들기",
    consentRequester: "요청자",
    consentRequesterValue: "K-Tour ID 여행 패스",
    consentPurpose: "사용 목적",
    consentPurposeValue: "장소의 지금 분위기를 남기고 작성 중이던 메모로 돌아갑니다.",
    consentMinimum: "공유되는 답변",
    consentMinimumValue: "본인 여부 · 예/아니오만 · 19+와 별개",
    consentRetention: "저장 범위",
    consentRetentionValue: "이 탭 · 최대 1시간 · 개인정보 저장 안 함",
    returnDraft: "작성 중인 메모 확인",
    planLabel: "필요한 확인",
    planAccount: "계정",
    planPerson: "본인",
    planAge: "19+",
    planCredential: "K-Tour ID",
    planPayment: "결제",
  },
  ja: {
    accountTitle: "アカウントを作成して続ける",
    accountBody: "準備ができたら同じ操作に戻ります。",
    accountHeader: "アカウント",
    accountTableTitle: "このTableに参加するにはアカウントが必要です",
    accountSignalTitle: "この場所に今の雰囲気を残すにはアカウントが必要です",
    accountCheckoutTitle: "お支払いを続けるにはアカウントが必要です",
    accountJitBody: "同じ場所と途中の操作に自動で戻ります。",
    accountProcessingTitle: "アカウントを作成しています…",
    accountProcessingBody: "途中の操作をそのまま保持します。",
    accountDetails: "アカウントとプライバシー",
    accountBoundary: "このセッションで使うアカウントを作成します。本人、19+、K-Tour ID、決済確認は必要な時だけ個別に行います。",
    checkoutPaymentTitle: "お支払い前の最後の確認",
    checkoutPaymentBody: "確認後、先ほど同意したお支払いを続けます。お店や金額が変わった場合は、もう一度内容を確認します。",
    checkoutPaymentAction: "確認して支払いを続ける",
    checkoutDetails: "プライバシーと確認の詳細",
    checkoutCancel: "お支払いに戻る",
    notNow: "今はしない",
    personTitle: "一人であることを確認",
    personBody: "この操作に使う方法を選んでください。",
    personProcessingTitle: "必要な結果を確認中…",
    personProcessingBody: "元の操作はそのまま残ります。",
    personSuccessTitle: "検証結果の準備ができました",
    personSuccessBody: "外部サービスによる確認なし",
    ageProcessingTitle: "19歳以上を確認中…",
    ageProcessingBody: "Tableとメモはそのまま残ります。",
    ageSuccessTitle: "19歳以上の検証結果が準備できました",
    ageSuccessBody: "Tableに戻ります…",
    paymentProcessingTitle: "決済準備を確認中…",
    paymentProcessingBody: "注文、特典、金額はそのままです。",
    paymentSuccessTitle: "決済のレビュー結果が準備できました",
    paymentSuccessBody: "同じお支払いに戻ります…",
    ageTitle: "19歳以上の確認",
    ageBody: "生年月日を共有せずに、このTableへ進みます。",
    credentialMissingTitle: "K-Tour IDを準備して続ける",
    credentialMissingBody: "場所と途中の操作はそのまま残ります。",
    credentialTableTitle: "このTableに旅行資格を共有しますか？",
    credentialCheckoutTitle: "ここでK-Tour特典を使いますか？",
    credentialBody: "この操作に必要な最小限の資格だけを一度確認します。",
    credentialSetupAction: "K-Tour IDを準備",
    credentialApproveAction: "今回だけ承認",
    credentialDenyAction: "今はしない",
    credentialDetails: "接続方法",
    credentialPredicate: "K-Tour旅行資格 · 可否のみ",
    credentialRetention: "このリクエストのみ・再利用IDや個人情報なし",
    paymentTitle: "支払い準備を確認",
    paymentBody: "確認後は同じ支払いに戻ります。この画面では請求されません。",
    accountAction: "トリップアカウントで続ける",
    personAction: "同意して確認",
    mobileAction: "同意して確認",
    residenceAction: "接続を確認",
    passportAction: "同意して確認",
    routeChoiceLegend: "確認方法を選択",
    routeChoiceMobile: "モバイルID",
    routeChoiceResidence: "在留カード",
    routeChoicePassport: "パスポート",
    routeUnavailable: "現在利用できません",
    routeUnsupported: "非対応",
    routeReview: "検証用ルート",
    chooseAnother: "別の方法を選ぶ",
    reviewTruth: "検証用の結果・外部サービスによる確認なし",
    providerDetails: "確認方法",
    privacyDetails: "プライバシーの詳細",
    ageBoundary: "生年月日は要求・保存しません。一時的な19歳以上の結果だけがこのTableに戻り、店舗の規則としては表示しません。",
    routeLabel: "選んだ身分証",
    mobileTitle: "モバイルID",
    mobileNote: "接続環境ではOmniOne CXへ進みます。ここでは実際の送信を行いません。",
    residenceTitle: "モバイル在留カード",
    residenceNote: "この経路はまだ接続されていません。",
    passportTitle: "パスポート",
    passportNote: "接続時は別のパスポート確認を利用します。",
    residenceUnavailableTitle: "モバイル在留カード経路はまだ接続されていません",
    residenceUnavailableBody: "パスポート経路を選ぶか、途中の操作に戻れます。",
    residenceUnsupportedTitle: "この在留カード方式には対応していません",
    residenceUnsupportedBody: "パスポートで続けられます。元の操作はそのままです。",
    usePassport: "パスポートで確認",
    ageAction: "19歳以上を確認して続ける",
    paymentAction: "決済確認を準備して続ける",
    returnLabel: "戻る場所",
    table: "テーブルとホストへのメモ",
    signal: "編集中の場所メモ",
    checkout: "お店への支払い",
    badge: "旅の記念バッジ",
    truth: "本人確認事業者には接続されていません。本人情報は送信せず、資格情報も作成しません。",
    cancel: "戻る",
    failureTitle: "確認を完了できませんでした",
    failureBody: "操作の正確なコンテキストは変わりません。投稿、参加、決済は行われていません。",
    unavailableTitle: "現在この確認を利用できません",
    unavailableBody: "用意されたサンプルで続けるか、操作を変更せずに戻れます。",
    sampleAction: "サンプルで続ける",
    expiredTitle: "確認または戻り先の有効期限が切れました",
    expiredBody: "登録済みのコンテキストを失わず、同じ戻り先を更新して続けてください。",
    retry: "もう一度試す",
    renew: "戻り先を更新",
    consentRequester: "リクエスト元",
    consentRequesterValue: "K-Tour ID トラベルパス",
    consentPurpose: "使用目的",
    consentPurposeValue: "場所の今の雰囲気を残し、編集中のメモへ戻ります。",
    consentMinimum: "共有する回答",
    consentMinimumValue: "本人であること・可否のみ・19歳以上とは別",
    consentRetention: "保存範囲",
    consentRetentionValue: "このタブ・最長1時間・個人情報は保存しません",
    returnDraft: "入力中のメモを確認",
    planLabel: "必要な確認",
    planAccount: "アカウント",
    planPerson: "本人",
    planAge: "19+",
    planCredential: "K-Tour ID",
    planPayment: "決済",
  },
} as const

const actionGateSessionOptions = qaReviewFixtureOptions

function personRouteForIdentityMethod(method: "mobile_id" | "mobile_residence_card" | "passport_ekyc" | null): BPersonRouteB | null {
  if (method === "mobile_id") return "mobile_id_cx"
  return method
}

function writeAccountGlobalAge(session: GlobalAfter19SessionB, accountActive: boolean) {
  // The coordinator only reaches Age through JOIN_TABLE's canonical
  // Account → Person → Age plan. Guest/manual After19 keeps its result in the
  // current action memory and must never create this session receipt.
  if (!accountActive) return false
  const persisted = persistGlobalAfter19SessionB(
    window.sessionStorage,
    session,
    new Date(),
    qaReviewFixtureOptions(),
  )
  if (!persisted) return false
  window.dispatchEvent(new CustomEvent(GLOBAL_AFTER19_SESSION_EVENT, { detail: session }))
  return true
}

function axisReady(axis: BActionAxis, now: Date) {
  return axis.status === "eligible" && axis.expiresAt !== null && Date.parse(axis.expiresAt) > now.getTime()
}

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
  // A frame-count-only transition can stretch to many seconds when a mobile
  // browser throttles rAF. Retain the intended visible beats but cap the wait
  // at their 60 Hz duration so the next decision never appears frozen.
  timeout = window.setTimeout(finish, Math.max(0, count * 17 + 34))
  return () => {
    completed = true
    window.cancelAnimationFrame(frame)
    window.clearTimeout(timeout)
  }
}

function returnLabel(returnTo: BActionReturnTo, copy: (typeof COPY)[keyof typeof COPY]) {
  if (returnTo.cta === "REDEEM_DEMO_ENTITLEMENT") return EXPERIENCE_COPY_B[copy === COPY.ko ? "ko" : copy === COPY.ja ? "ja" : "en"].title
  if (returnTo.cta === "JOIN_TABLE") return copy.table
  if (returnTo.cta === "SUBMIT_LOCAL_SIGNAL") return copy.signal
  if (returnTo.cta === "MINT_BADGE") return copy.badge
  return copy.checkout
}

function personReviewFixtureId(route: BPersonRouteB, outcome: PersonReviewOutcome, residenceAvailability: ResidenceAvailability | null) {
  const method = route === "mobile_id_cx" ? "CX" : route === "mobile_residence_card" ? "RESIDENCE" : "PASSPORT"
  const result = outcome === "failure"
    ? "FAIL"
    : outcome === "unavailable"
      ? residenceAvailability === "unsupported" ? "UNSUPPORTED" : residenceAvailability === "outage" ? "OUTAGE" : "UNAVAILABLE"
      : outcome.toUpperCase()
  return `FX-PER-${method}-${result}`
}

function normalizeGateQaOutcome(value: unknown): GateQaOutcome | null {
  if (value === "failure" || value === "unavailable" || value === "expired") return value
  // `unsupported` cannot be injected as a generic axis result. Only the
  // allowlisted Residence availability fixture below may publish that state.
  return value === "unsupported" ? "unavailable" : null
}

function normalizePersonReviewOutcome(value: unknown): PersonReviewOutcome | null {
  if (value === "success" || value === "cancel") return value
  return normalizeGateQaOutcome(value)
}

export function BActionGateCoordinator() {
  const { state, actions } = useOndoB()
  const reviewMode = useQaControls()
  const [session, setSession] = useState<BActionGateSession>(DEFAULT_B_ACTION_GATE_SESSION)
  const [ageSession, setAgeSession] = useState<GlobalAfter19SessionB | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [clock, setClock] = useState(() => new Date())
  const [view, setView] = useState<GateRenderView>("intro")
  const [readyTokenId, setReadyTokenId] = useState<string | null>(null)
  const [observedResidenceAvailability, setObservedResidenceAvailability] = useState<ResidenceAvailability | null>(null)
  const [presentationRequest, setPresentationRequest] = useState<OndoBPresentationRequest | null>(null)
  const autoOpenedCredentialRef = useRef<string | null>(null)
  const personReviewRef = useRef<PendingPersonReview | null>(null)
  const ageReviewRef = useRef<PendingAgeReview | null>(null)
  const paymentReviewRef = useRef<PendingPaymentReview | null>(null)
  const layerRef = useRef<HTMLDivElement | null>(null)
  const dialogRef = useRef<HTMLElement | null>(null)
  const pending = session.pending
  const copy = COPY[state.locale]
  const personRoute = pending && session.personRoute?.tokenId === pending.tokenId ? session.personRoute.route : null
  const configuredResidenceAvailability: ResidenceAvailability = reviewMode
    ? readQaRuntime<QaRuntime>()?.residenceCard ?? "supported"
    : "outage"
  const residenceAvailability = observedResidenceAvailability ?? configuredResidenceAvailability

  const restoreContext = useCallback((returnTo: BActionReturnTo) => {
    const privateContext = privateContextForBAction(returnTo)
    if (returnTo.cta === "REDEEM_DEMO_ENTITLEMENT") return privateContext?.cta === "REDEEM_DEMO_ENTITLEMENT" && requestExperienceB(returnTo.venueId)
    if (returnTo.cta === "JOIN_TABLE") {
      if (!privateContext || privateContext.cta !== "JOIN_TABLE") return false
      actions.setTab("tables")
      ;(window as TableIntentWindow).__ONDO_B_TABLE_INTENT__ = { tableId: returnTo.tableId, venueId: returnTo.venueId, mode: "view", draft: privateContext.draft }
      window.setTimeout(() => window.dispatchEvent(new CustomEvent(ONDO_OPEN_TABLE_EVENT, { detail: { tableId: returnTo.tableId, venueId: returnTo.venueId, mode: "view", draft: privateContext.draft } })), 0)
      return true
    }
    if (returnTo.cta === "SUBMIT_LOCAL_SIGNAL") {
      if (!privateContext || privateContext.cta !== "SUBMIT_LOCAL_SIGNAL") return false
      actions.setTab("ondo")
      actions.setSurface({ kind: "venue", venueId: returnTo.venueId })
      actions.openLocalSignal(returnTo.venueId)
      actions.updateLocalSignalDraft({ tags: privateContext.tags, note: privateContext.note })
      return true
    }
    if (returnTo.cta === "MINT_BADGE") {
      // The focused keepsake task owns its caller and remains mounted under
      // this gate. Do not replace its venue/collection with the generic Labs.
      if (document.querySelector('[data-testid="journey-keepsake-overlay"]')) return true
      actions.setTab("id")
      actions.setSurface({ kind: "labs" })
      return true
    }
    return actions.openMealBenefitFromPlace(returnTo.venueId)
  }, [actions])

  useEffect(() => {
    if (!state.hydrated || hydrated) return
    const restored = restoreBActionGateSession(window.sessionStorage, new Date(), actionGateSessionOptions())
    const restoredAge = restoreGlobalAfter19B(window.localStorage, window.sessionStorage, new Date(), qaReviewFixtureOptions()).session
    persistBActionGateSession(window.sessionStorage, restored, new Date(), actionGateSessionOptions())
    setSession(restored)
    setAgeSession(restoredAge)
    setView(restored.outcome?.status ?? (restored.pending && !isBActionReturnPending(restored.pending) ? "expired" : "intro"))
    setHydrated(true)
    if (restored.pending) restoreContext(restored.pending)
  }, [hydrated, restoreContext, state.hydrated])

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 15_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    function requested(event: Event) {
      const detail = event instanceof CustomEvent ? event.detail : null
      // The coarse expiry clock can predate a return token created between its
      // 15-second ticks. Anchor this render to the request itself so a fresh
      // token is never misread as coming from the future.
      const requestedAt = new Date()
      const restored = restoreBActionGateSession(window.sessionStorage, requestedAt, actionGateSessionOptions())
      if (!detail || restored.pending?.tokenId !== detail.tokenId) return
      setClock(requestedAt)
      setSession(restored)
      setReadyTokenId(null)
      setPresentationRequest(null)
      personReviewRef.current = null
      ageReviewRef.current = null
      paymentReviewRef.current = null
      autoOpenedCredentialRef.current = null
      setObservedResidenceAvailability(null)
      setView("intro")
    }
    function syncAge() { setAgeSession(restoreGlobalAfter19B(window.localStorage, window.sessionStorage, new Date(), qaReviewFixtureOptions()).session) }
    function syncActionAxes() { setSession(restoreBActionGateSession(window.sessionStorage, new Date(), actionGateSessionOptions())) }
    function completed() {
      setSession(restoreBActionGateSession(window.sessionStorage, new Date(), actionGateSessionOptions()))
      setReadyTokenId(null)
    }
    window.addEventListener(B_ACTION_GATE_REQUEST_EVENT, requested)
    window.addEventListener(GLOBAL_AFTER19_SESSION_EVENT, syncAge)
    window.addEventListener(B_ACTION_AXIS_SESSION_EVENT, syncActionAxes)
    window.addEventListener(B_ACTION_GATE_COMPLETE_EVENT, completed)
    return () => {
      window.removeEventListener(B_ACTION_GATE_REQUEST_EVENT, requested)
      window.removeEventListener(GLOBAL_AFTER19_SESSION_EVENT, syncAge)
      window.removeEventListener(B_ACTION_AXIS_SESSION_EVENT, syncActionAxes)
      window.removeEventListener(B_ACTION_GATE_COMPLETE_EVENT, completed)
    }
  }, [])

  const satisfied = useMemo(() => {
    const result = new Set<BActionGateKind>()
    if (state.account === "ACC-ACTIVE") result.add("account")
    if (axisReady(session.person, clock) && (!state.identityCredential || evaluateKPassService(state.identityCredential, { service: "person" }).status === "allowed")) result.add("person")
    if (ageSession && isGlobalAfter19AgeCurrent(ageSession, clock) && (!state.identityCredential || evaluateKPassService(state.identityCredential, { service: "age" }).status === "allowed")) result.add("age")
    if (axisReady(session.payment, clock)) result.add("payment_kyc")
    return result
  }, [ageSession, clock, pending, session, state.account, state.identityCredential])

  const canonicalGate = pending?.gatePlan.find((gate) => !satisfied.has(gate)) ?? null
  const checkoutContext = pending ? privateContextForBAction(pending) : null
  const paymentDecision = state.identityCredential && checkoutContext?.cta === "START_CHECKOUT" && axisReady(session.payment, clock)
    ? evaluateKPassService(state.identityCredential, { service: "payment", paymentKyc: true, amountKrw: checkoutContext.quote.finalDebit * 1_000 }) : null
  const paymentBlocked = paymentDecision && paymentDecision.status !== "allowed" ? paymentDecision : null
  const presentationNeeded = Boolean(pending && !canonicalGate && requiresBActionPresentation(pending) && !hasBActionPresentationApproval(session, pending, state.identityCredential))
  const activeGate: BActionCoordinatorStep | null = canonicalGate ?? (paymentBlocked ? "payment_kyc" : presentationNeeded ? "credential" : null)
  const serviceDecision = state.identityCredential && activeGate && ["person", "age", "credential"].includes(activeGate)
    ? evaluateKPassService(state.identityCredential, { service: activeGate === "credential" && pending ? bActionPresentationPurpose(pending) : activeGate as "person" | "age" }) : null
  const blockedDecision = activeGate === "payment_kyc" ? paymentBlocked : serviceDecision?.status !== "allowed" ? serviceDecision : null
  const expiredReturn = pending ? !isBActionReturnPending(pending, clock) : false
  // `clock` advances on a coarse expiry interval and can predate a credential
  // issued between ticks. Evaluate against the render time so a just-issued
  // credential is immediately usable; the interval still triggers expiry
  // re-renders for an open gate.
  const credentialActive = Boolean(state.identityCredential && isSimulatedCredentialActiveB(state.identityCredential, Date.now()))
  useModalIsolation(Boolean(pending && readyTokenId !== pending.tokenId && (activeGate || expiredReturn)), layerRef)

  useEffect(() => {
    if (activeGate !== "person" || !pending || personRoute || !credentialActive || blockedDecision || !state.identityCredential) return
    selectPersonRoute(state.identityCredential.method === "mobile_id" ? "mobile_id_cx" : state.identityCredential.method)
  // The prepared credential selects its own source; it does not grant Person
  // until the traveler consents to this particular action below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGate, pending?.tokenId, personRoute, credentialActive, state.identityCredential, blockedDecision?.reason])

  useEffect(() => {
    if (!pending || activeGate !== "credential") {
      setPresentationRequest(null)
      return
    }
    if (!credentialActive) {
      setPresentationRequest(null)
      if (!state.identityCredential && state.identitySetupOrigin === null && autoOpenedCredentialRef.current !== pending.tokenId) {
        autoOpenedCredentialRef.current = pending.tokenId
        actions.openIdentitySetup("action_gate")
      }
      return
    }
    if (!presentationRequest) {
      if (!state.identityCredential || pending.cta === "MINT_BADGE" || blockedDecision) return
      const request = createPresentationRequestB(Date.now(), `action:${pending.tokenId}:${Date.now()}`, createKPassPresentationBinding(state.identityCredential.credentialId, bActionPresentationPurpose(pending), { audience: pending.venueId, domain: window.location.origin }))
      if (!registerBActionPresentationRequest(pending, request)) {
        fail("credential", "failure")
        return
      }
      setPresentationRequest(request)
    }
  }, [actions, activeGate, credentialActive, pending, presentationRequest, state.identitySetupOrigin, state.identityCredential, blockedDecision?.reason])

  useEffect(() => {
    if (!pending || activeGate !== "credential" || !presentationRequest || view !== "intro") return
    const delay = presentationRequest.expiresAt - Date.now()
    if (delay <= 0) {
      fail("credential", "expired")
      return
    }
    const timer = window.setTimeout(() => fail("credential", "expired"), delay + 16)
    return () => window.clearTimeout(timer)
  // `fail` writes the latest pending token and is intentionally scoped by the
  // request identity captured in this effect.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGate, pending?.tokenId, presentationRequest, view])

  useEffect(() => {
    if (!pending || !activeGate) return
    const frame = window.requestAnimationFrame(() => {
      const layer = layerRef.current
      // Let a higher-priority portal isolate a newly mounted lower gate before
      // it can claim focus. Immediate Escape is owned independently below.
      if (!layer || layer.closest("[inert],[aria-hidden='true']")) return
      const dialog = dialogRef.current
      ;(dialog?.querySelector<HTMLElement>("[data-action-gate-initial-focus]") ?? dialog)?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeGate, pending?.tokenId, view])

  useEffect(() => {
    if (!pending || activeGate !== "account" || view !== "processing") return
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    return runAfterFrames(() => {
      const now = new Date()
      const latest = restoreBActionGateSession(window.sessionStorage, now, actionGateSessionOptions())
      const sameReturn = latest.pending
        && hashBActionReturnTo(latest.pending) === hashBActionReturnTo(pending)
      if (!sameReturn || !latest.pending || !isBActionReturnPending(latest.pending, now)) {
        actions.cancelAccountActivation()
        fail("account", "expired")
        return
      }
      // The exact pending action is made durable before Account activation.
      // A refused action-session write therefore cannot leave ACC-ACTIVE
      // behind a failure screen or require a second compensating write.
      if (!commit({ ...latest, outcome: null })) {
        actions.cancelAccountActivation()
        fail("account", "failure")
        return
      }
      if (!actions.activateAccount()) {
        actions.cancelAccountActivation()
        fail("account", "failure")
        return
      }
      setView("intro")
    }, reducedMotion ? 0 : 10)
  // Account is local actual, but it still exposes a cancellable pending frame
  // before persistence and revalidates the exact return at the commit edge.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGate, pending?.tokenId, state.account, view])

  useEffect(() => {
    if (!pending || activeGate !== "person" || view !== "processing") return
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    return runAfterFrames(() => {
      const now = new Date()
      const latest = restoreBActionGateSession(window.sessionStorage, now, actionGateSessionOptions())
      if (latest.pending?.tokenId !== pending.tokenId || !isBActionReturnPending(latest.pending, now)) {
        fail("person", "expired")
        return
      }
      if (latest.personRoute?.tokenId !== pending.tokenId) {
        fail("person", "failure")
        return
      }
      if (!reviewMode || personReviewRef.current?.tokenId !== pending.tokenId || personReviewRef.current.execution.result !== "FIXTURE_SUCCESS") {
        fail("person", "unavailable")
        return
      }
      setView("success")
    }, reducedMotion ? 0 : 12)
  // The check is deliberately local and ephemeral: the external provider is
  // not represented as connected, and eligibility is not written yet.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGate, pending?.tokenId, reviewMode, view])

  useEffect(() => {
    if (!pending || activeGate !== "person" || view !== "success") return
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    return runAfterFrames(() => {
      const now = new Date()
      const latest = restoreBActionGateSession(window.sessionStorage, now, actionGateSessionOptions())
      if (latest.pending?.tokenId !== pending.tokenId || !isBActionReturnPending(latest.pending, now)) {
        fail("person", "expired")
        return
      }
      const staged = personReviewRef.current
      if (!reviewMode || staged?.tokenId !== pending.tokenId || staged.execution.result !== "FIXTURE_SUCCESS") {
        fail("person", "unavailable")
        return
      }
      const person = createBActionReviewAxis("person", staged.execution, now)
      if (!person || !commit({ ...latest, person, outcome: null })) {
        fail("person", "failure")
        return
      }
      personReviewRef.current = null
      setView("intro")
    }, reducedMotion ? 36 : 54)
  // Commit only after the visible success result, so choosing a route or
  // pressing Continue can never masquerade as an external provider response.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGate, pending?.tokenId, reviewMode, view])

  useEffect(() => {
    if (!pending || activeGate !== "payment_kyc" || view !== "processing") return
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    return runAfterFrames(() => {
      const now = new Date()
      const latest = restoreBActionGateSession(window.sessionStorage, now, actionGateSessionOptions())
      const sameReturn = latest.pending
        && hashBActionReturnTo(latest.pending) === hashBActionReturnTo(pending)
      const privateContext = latest.pending ? privateContextForBAction(latest.pending) : null
      if (!sameReturn || !latest.pending || !isBActionReturnPending(latest.pending, now)) {
        fail("payment_kyc", "expired")
        return
      }
      if (latest.pending.cta !== "START_CHECKOUT" || privateContext?.cta !== "START_CHECKOUT" || state.account !== "ACC-ACTIVE") {
        fail("payment_kyc", "failure")
        return
      }
      if (!reviewMode || paymentReviewRef.current?.tokenId !== pending.tokenId || paymentReviewRef.current.execution.result !== "FIXTURE_SUCCESS") {
        fail("payment_kyc", "unavailable")
        return
      }
      setView("success")
    }, reducedMotion ? 0 : 12)
  // Keep the review result ephemeral until both pending and result frames are visible.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGate, pending?.tokenId, reviewMode, state.account, view])

  useEffect(() => {
    if (!pending || activeGate !== "payment_kyc" || view !== "success") return
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    return runAfterFrames(() => {
      const now = new Date()
      const latest = restoreBActionGateSession(window.sessionStorage, now, actionGateSessionOptions())
      const sameReturn = latest.pending
        && hashBActionReturnTo(latest.pending) === hashBActionReturnTo(pending)
      const privateContext = latest.pending ? privateContextForBAction(latest.pending) : null
      if (!sameReturn || !latest.pending || !isBActionReturnPending(latest.pending, now)) {
        fail("payment_kyc", "expired")
        return
      }
      if (latest.pending.cta !== "START_CHECKOUT" || privateContext?.cta !== "START_CHECKOUT" || state.account !== "ACC-ACTIVE") {
        fail("payment_kyc", "failure")
        return
      }
      const staged = paymentReviewRef.current
      if (!reviewMode || staged?.tokenId !== pending.tokenId || staged.execution.result !== "FIXTURE_SUCCESS") {
        fail("payment_kyc", "unavailable")
        return
      }
      const payment = createBActionReviewAxis("payment_kyc", staged.execution, now)
      if (!payment || !commit({ ...latest, payment, outcome: null })) { fail("payment_kyc", "failure"); return }
      paymentReviewRef.current = null
      setView("intro")
    }, reducedMotion ? 36 : 54)
  // Commit only after a visible result and a second exact-return/account check.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGate, pending?.tokenId, reviewMode, state.account, view])

  useEffect(() => {
    if (!pending || activeGate !== "age" || view !== "processing") return
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    return runAfterFrames(() => {
      const now = new Date()
      const latest = restoreBActionGateSession(window.sessionStorage, now, actionGateSessionOptions())
      const staged = ageReviewRef.current
      if (latest.pending?.tokenId !== pending.tokenId || !isBActionReturnPending(latest.pending, now)) {
        fail("age", "expired")
        return
      }
      if (latest.pending.cta !== "JOIN_TABLE" || state.account !== "ACC-ACTIVE") {
        fail("age", "failure")
        return
      }
      if (!reviewMode || staged?.tokenId !== pending.tokenId) {
        fail("age", "unavailable")
        return
      }
      setView("success")
    }, reducedMotion ? 0 : 12)
  // Review completion remains ephemeral until the pending and result frames
  // have both been visible. No Guest receipt is written in this phase.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGate, pending?.tokenId, reviewMode, state.account, view])

  useEffect(() => {
    if (!pending || activeGate !== "age" || view !== "success") return
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    return runAfterFrames(() => {
      const now = new Date()
      const latest = restoreBActionGateSession(window.sessionStorage, now, actionGateSessionOptions())
      const staged = ageReviewRef.current
      if (latest.pending?.tokenId !== pending.tokenId || !isBActionReturnPending(latest.pending, now)) {
        fail("age", "expired")
        return
      }
      if (latest.pending.cta !== "JOIN_TABLE" || state.account !== "ACC-ACTIVE") {
        fail("age", "failure")
        return
      }
      if (!reviewMode || staged?.tokenId !== pending.tokenId) {
        fail("age", "unavailable")
        return
      }
      if (state.identityCredential?.claims.ageOver19 === null) {
        if (!staged.execution || !actions.completeAgeProof(staged.execution)) { fail("age", "failure"); return }
      } else if (state.identityCredential && evaluateKPassService(state.identityCredential, { service: "age", now: now.getTime() }).status !== "allowed") { fail("age", "failure"); return }
      if (!commit({ ...latest, outcome: null })) { fail("age", "failure"); return }
      if (!writeAccountGlobalAge(staged.session, state.account === "ACC-ACTIVE")) { fail("age", "failure"); return }
      setAgeSession(staged.session)
      ageReviewRef.current = null
      setView("intro")
    }, reducedMotion ? 36 : 54)
  // Persist only after a visible review result and after revalidating the
  // exact JOIN_TABLE return plus its Account prerequisite.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGate, pending?.tokenId, reviewMode, state.account, view])

  useEffect(() => {
    if (!pending || readyTokenId === pending.tokenId || (!activeGate && !expiredReturn)) return
    const ownEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return
      const layer = layerRef.current
      // A higher-priority portal can temporarily isolate this gate. In that
      // case Escape belongs to the exposed modal, not this inert descendant.
      if (!layer || layer.closest("[inert],[aria-hidden='true']")) return
      event.preventDefault()
      event.stopImmediatePropagation()
      cancel()
    }
    document.addEventListener("keydown", ownEscape, true)
    return () => document.removeEventListener("keydown", ownEscape, true)
  }, [activeGate, expiredReturn, pending?.tokenId, readyTokenId])

  useEffect(() => {
    if (!pending || session.personRoute || !pending.gatePlan.includes("person")) return
    const route = personRouteForIdentityMethod(state.identityCredential?.method ?? null)
    if (!route) return
    const next: BActionGateSession = { ...session, personRoute: { tokenId: pending.tokenId, route } }
    if (persistBActionGateSession(window.sessionStorage, next, new Date(), actionGateSessionOptions())) setSession(next)
  }, [pending, session, state.identityCredential?.method])

  useEffect(() => {
    if (!pending || !isBActionReturnPending(pending, clock) || activeGate) return
    releaseReady(pending)
  // releaseReady is deliberately reached only after a state/axis transition makes the full plan true.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGate, clock, pending, satisfied])

  function commit(next: BActionGateSession) {
    if (!persistBActionGateSession(window.sessionStorage, next, new Date(), actionGateSessionOptions())) return false
    setSession(next)
    window.dispatchEvent(new CustomEvent(B_ACTION_AXIS_SESSION_EVENT, { detail: next }))
    return true
  }

  function gateOutcome(gate: BActionCoordinatorStep): GateQaOutcome | null {
    const qa = readQaRuntime<QaRuntime>()
    const explicitValue: unknown = qa?.actionGate?.[gate]
    const explicit = normalizeGateQaOutcome(explicitValue)
    if (explicitValue !== undefined) delete qa?.actionGate?.[gate]
    if (explicitValue !== undefined) return explicit ?? "unavailable"
    if (gate === "age" && qa?.after19) { const outcome = qa.after19; delete qa.after19; return outcome }
    if ((gate === "person" || gate === "age") && qa?.eligibility && qa.eligibility !== "success" && qa.eligibility !== "cancel") {
      const outcome = qa.eligibility
      delete qa.eligibility
      return outcome
    }
    if (gate === "payment_kyc" && qa?.paymentKyc) { const outcome = qa.paymentKyc; delete qa.paymentKyc; return outcome }
    return null
  }

  function personExecution(route: BPersonRouteB): PersonExecutionDecision {
    if (!reviewMode) return { execution: providerUnavailable("person"), unavailableStatus: "unavailable" }
    const qa = readQaRuntime<QaRuntime>()
    let outcome: PersonReviewOutcome = "success"
    let availabilityDroveOutcome = false
    const explicitValue: unknown = qa?.actionGate?.person
    const explicit = normalizePersonReviewOutcome(explicitValue)
    if (explicitValue !== undefined) {
      outcome = explicit ?? "unavailable"
      delete qa?.actionGate?.person
    } else if (qa?.eligibility) {
      outcome = normalizePersonReviewOutcome(qa.eligibility) ?? "unavailable"
      delete qa.eligibility
    } else if (route === "mobile_residence_card" && residenceAvailability !== "supported") {
      outcome = "unavailable"
      availabilityDroveOutcome = true
    }
    if (route === "mobile_residence_card" && qa?.residenceCard) delete qa.residenceCard

    const authority = createReviewFixtureAuthority({
      qaRuntimeEnabled: reviewMode,
      explicitlyRequested: reviewMode,
      fixtureId: personReviewFixtureId(route, outcome, availabilityDroveOutcome ? residenceAvailability : null),
    })
    const execution = !authority
      ? providerUnavailable("person")
      : outcome === "success"
      ? reviewFixture<{ axis: "person"; route: BPersonRouteB }>(authority, { outcome: "success", value: { axis: "person", route } })
      : reviewFixture<{ axis: "person"; route: BPersonRouteB }>(authority, { outcome: outcome as Exclude<ReviewFixtureOutcome, "success"> })
    return {
      execution,
      unavailableStatus: availabilityDroveOutcome && residenceAvailability === "unsupported" ? "unsupported" : "unavailable",
    }
  }

  function paymentExecution(): ProviderUnavailableExecution | ReviewFixtureExecution<{ axis: "payment_kyc" }> {
    if (!reviewMode) return providerUnavailable("payment_kyc")
    const injected = gateOutcome("payment_kyc")
    const outcome: "success" | GateQaOutcome = injected ?? "success"
    const authority = createReviewFixtureAuthority({
      qaRuntimeEnabled: reviewMode,
      explicitlyRequested: reviewMode,
      fixtureId: `FX-PKY-${outcome === "failure" ? "FAIL" : outcome.toUpperCase()}`,
    })
    if (!authority) return providerUnavailable("payment_kyc")
    return outcome === "success"
      ? reviewFixture<{ axis: "payment_kyc" }>(authority, { outcome: "success", value: { axis: "payment_kyc" } })
      : reviewFixture<{ axis: "payment_kyc" }>(authority, { outcome: outcome as Exclude<ReviewFixtureOutcome, "success"> })
  }

  function fail(gate: BActionCoordinatorStep, status: GateTerminalStatus) {
    if (!pending) return
    const terminalStatus: GateTerminalStatus = status === "unsupported"
      && (!reviewMode || gate !== "person" || personRoute !== "mobile_residence_card")
      ? "unavailable"
      : status
    if (gate === "person") personReviewRef.current = null
    if (gate === "age") ageReviewRef.current = null
    if (gate === "payment_kyc") paymentReviewRef.current = null
    if (gate === "credential") {
      setView(terminalStatus)
      return
    }
    const outcome: BActionGateOutcome = { tokenId: pending.tokenId, gate, status: terminalStatus }
    const axisStatus: BActionAxis["status"] = terminalStatus === "failure" ? "failed" : terminalStatus
    const next: BActionGateSession = {
      ...session,
      person: gate === "person" ? { status: axisStatus, expiresAt: null } : session.person,
      payment: gate === "payment_kyc" ? { status: axisStatus, expiresAt: null } : session.payment,
      outcome,
    }
    commit(next)
    setView(terminalStatus)
  }

  function confirm() {
    const actionAt = new Date()
    if (!pending || !activeGate || !isBActionReturnPending(pending, actionAt)) { setView("expired"); return }
    if (blockedDecision && !(activeGate === "age" && blockedDecision.reason === "age_proof_required")) return
    if (activeGate === "person" && !personRoute) return
    if (activeGate === "person") {
      const decision = personExecution(personRoute!)
      const execution = decision.execution
      if (execution.result === "PROVIDER_UNAVAILABLE" || execution.result === "FIXTURE_UNAVAILABLE") {
        fail(activeGate, decision.unavailableStatus)
        return
      }
      if (execution.result === "FIXTURE_CANCEL") {
        cancel()
        return
      }
      if (execution.result === "FIXTURE_FAILURE") {
        fail(activeGate, "failure")
        return
      }
      if (execution.result === "FIXTURE_EXPIRED") {
        fail(activeGate, "expired")
        return
      }
      personReviewRef.current = { tokenId: pending.tokenId, execution }
      setView("processing")
      return
    }
    if (activeGate === "payment_kyc") {
      const execution = paymentExecution()
      if (execution.result === "PROVIDER_UNAVAILABLE" || execution.result === "FIXTURE_UNAVAILABLE") {
        fail(activeGate, "unavailable")
        return
      }
      if (execution.result === "FIXTURE_FAILURE") {
        fail(activeGate, "failure")
        return
      }
      if (execution.result === "FIXTURE_EXPIRED") {
        fail(activeGate, "expired")
        return
      }
      if (execution.result === "FIXTURE_CANCEL") {
        cancel()
        return
      }
      paymentReviewRef.current = { tokenId: pending.tokenId, execution }
      setView("processing")
      return
    }
    const injected = gateOutcome(activeGate)
    if (injected) { fail(activeGate, injected); return }

    if (activeGate === "account") {
      if (!actions.beginAccountActivation()) { fail(activeGate, "failure"); return }
      setView("processing")
      return
    }
    if (activeGate === "credential") {
      if (!credentialActive) {
        autoOpenedCredentialRef.current = pending.tokenId
        actions.openIdentitySetup("action_gate")
        return
      }
      if (!state.identityCredential || pending.cta === "MINT_BADGE") return
      const binding = createKPassPresentationBinding(state.identityCredential.credentialId, bActionPresentationPurpose(pending), { audience: pending.venueId, domain: window.location.origin })
      const request = presentationRequest ?? createPresentationRequestB(Date.now(), `action:${pending.tokenId}:${Date.now()}`, binding)
      const resolution = resolvePresentationRequestB(request, "approve", Date.now(), binding)
      setPresentationRequest(resolution.request)
      if (!resolution.approved) {
        fail(activeGate, "expired")
        return
      }
      const authority = authorizeBActionPresentationDecision(pending, resolution)
      if (!authority) { fail(activeGate, "failure"); return }
      const next = recordBActionPresentationApproval(window.sessionStorage, pending, authority, new Date(), actionGateSessionOptions())
      if (!next) { fail(activeGate, "failure"); return }
      setSession(next)
      window.dispatchEvent(new CustomEvent(B_ACTION_AXIS_SESSION_EVENT, { detail: next }))
      setView("intro")
      return
    }
    if (activeGate === "age") {
      if (pending.cta !== "JOIN_TABLE" || state.account !== "ACC-ACTIVE") { fail(activeGate, "failure"); return }
      if (!state.identityCredential) { actions.openIdentitySetup("action_gate"); return }
      const ageDecision = evaluateKPassService(state.identityCredential, { service: "age", now: actionAt.getTime() })
      if (ageDecision.status !== "allowed" && ageDecision.reason !== "age_proof_required") return
      const authority = createReviewFixtureAuthority({
        qaRuntimeEnabled: reviewMode,
        explicitlyRequested: reviewMode,
        fixtureId: "FX-AGE-SUCCESS",
      })
      if (!authority) { fail(activeGate, "unavailable"); return }
      const execution = reviewFixture(authority, {
        outcome: "success",
        value: { predicate: "AGE_GTE_19" as const, outcome: "eligible" as const },
        now: actionAt,
      })
      const eligible = recordGlobalAfter19ReviewEligibilityB(execution, actionAt)
      const nextAge = ageSession?.mode === "manual-off" ? { ...eligible, mode: "manual-off" as const } : eligible
      ageReviewRef.current = { tokenId: pending.tokenId, session: nextAge, execution }
      setView("processing")
      return
    }
  }

  function usePassportAlternative() {
    if (!pending || activeGate !== "person" || personRoute !== "mobile_residence_card") return
    selectPersonRoute("passport_ekyc")
  }

  function selectPersonRoute(route: BPersonRouteB) {
    if (!pending || activeGate !== "person" || !isBActionReturnPending(pending, new Date())) return
    if (route === "mobile_residence_card") setObservedResidenceAvailability(residenceAvailability)
    const next: BActionGateSession = {
      ...session,
      person: { status: "unverified", expiresAt: null },
      personRoute: { tokenId: pending.tokenId, route },
      outcome: null,
    }
    if (!reviewMode) {
      const unavailable: BActionGateSession = {
        ...next,
        person: { status: "unavailable", expiresAt: null },
        outcome: { tokenId: pending.tokenId, gate: "person", status: "unavailable" },
      }
      if (!commit(unavailable)) { setView("failure"); return }
      setView("unavailable")
      return
    }
    if (!commit(next)) { setView("failure"); return }
    setView("intro")
  }

  function chooseAnotherPersonRoute() {
    if (!pending || activeGate !== "person") return
    const next: BActionGateSession = {
      ...session,
      person: { status: "unverified", expiresAt: null },
      personRoute: null,
      outcome: null,
    }
    if (!commit(next)) { setView("failure"); return }
    setView("intro")
  }

  function continueWithSample() {
    if (!pending || !activeGate || !["person", "age", "payment_kyc"].includes(activeGate)) return
    if (!enterReviewSample()) return
    // Keep the exact pending token, selected method and private return context.
    // The existing review state machine takes over on the next decision; no
    // provider call or duplicate demo-only return path is introduced here.
    setView("intro")
  }

  function releaseReady(returnTo: BActionReturnTo) {
    if (readyTokenId === returnTo.tokenId) return
    // `clock` is intentionally coarse and exists only to refresh expiry UI.
    // A receipt may have been issued after its last tick, so every durable
    // return boundary must validate against a fresh instant.
    const readyAt = new Date()
    const latest = restoreBActionGateSession(window.sessionStorage, readyAt, actionGateSessionOptions())
    if (latest.pending?.tokenId !== returnTo.tokenId) return
    setReadyTokenId(returnTo.tokenId)
    restoreContext(returnTo)
    window.setTimeout(() => window.dispatchEvent(new CustomEvent(B_ACTION_GATE_READY_EVENT, { detail: returnTo })), 0)
  }

  function cancel(gateOutcomeOverride?: "cancel" | "denied") {
    if (!pending) return
    const cancelAt = new Date()
    const latest = restoreBActionGateSession(window.sessionStorage, cancelAt, actionGateSessionOptions())
    if (latest.pending?.tokenId !== pending.tokenId) return
    const returning = latest.pending
    const gateOutcome = gateOutcomeOverride ?? (latest.outcome?.tokenId === returning.tokenId ? latest.outcome.status : "cancel")
    // Durable abandon is the publication boundary. Until it succeeds, the
    // overlay, private action context and consumer draft all stay untouched.
    if (!abandonPendingBAction(window.sessionStorage, returning, cancelAt, actionGateSessionOptions(), () => {
      actions.cancelAccountActivation()
      personReviewRef.current = null
      ageReviewRef.current = null
      paymentReviewRef.current = null
      restoreContext(returning)
      window.dispatchEvent(new CustomEvent(B_ACTION_GATE_CANCEL_EVENT, { detail: { ...returning, gateOutcome } }))
    })) {
      setView("failure")
      return
    }
    setSession(restoreBActionGateSession(window.sessionStorage, cancelAt, actionGateSessionOptions()))
    setReadyTokenId(null)
  }

  function denyPresentation() {
    if (!pending || activeGate !== "credential") return cancel()
    if (presentationRequest && isPresentationRequestActiveB(presentationRequest)) {
      setPresentationRequest(resolvePresentationRequestB(presentationRequest, "deny").request)
    }
    cancel("denied")
  }

  function retry() {
    if (!pending) return
    const retryAt = new Date()
    if (!isBActionReturnPending(pending, retryAt)) {
      const renewed = renewExpiredPendingBAction(window.sessionStorage, pending, retryAt, actionGateSessionOptions())
      if (!renewed) { setView("failure"); return }
      setSession(renewed.session)
      window.dispatchEvent(new CustomEvent(B_ACTION_AXIS_SESSION_EVENT, { detail: renewed.session }))
      restoreContext(renewed.pending)
    } else {
      if (!commit({ ...session, outcome: null })) { setView("failure"); return }
    }
    setPresentationRequest(null)
    personReviewRef.current = null
    ageReviewRef.current = null
    paymentReviewRef.current = null
    setView("intro")
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancel(); return }
    if (event.key !== "Tab") return
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(isRenderedFocusable)
    const first = focusable[0]
    const last = focusable.at(-1)
    if (!first || !last) return
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last.focus({ preventScroll: true }) }
    else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) { event.preventDefault(); first.focus({ preventScroll: true }) }
  }

  if (!hydrated || !pending || readyTokenId === pending.tokenId) return null
  // A fully satisfied live plan releases on the effect above. Keep that
  // handoff visually silent instead of flashing the last gate for one frame.
  if (!expiredReturn && !activeGate) return null
  const resolvedView: GateRenderView = expiredReturn ? "expired" : view
  const gate = activeGate ?? pending.gatePlan.at(-1) ?? "account"
  const isCheckout = pending.cta === "START_CHECKOUT"
  const isExperience = pending.cta === "REDEEM_DEMO_ENTITLEMENT"
  const experienceCopy = EXPERIENCE_COPY_B[state.locale]
  const isCredential = gate === "credential"
  const credentialNeedsSetup = isCredential && !credentialActive
  const accountContextTitle = isExperience ? experienceCopy.gateTitle : pending.cta === "JOIN_TABLE" ? copy.accountTableTitle : pending.cta === "SUBMIT_LOCAL_SIGNAL" ? copy.accountSignalTitle : copy.accountCheckoutTitle
  const residenceUnavailable = gate === "person" && personRoute === "mobile_residence_card" && resolvedView === "unavailable"
  const residenceUnsupported = gate === "person" && personRoute === "mobile_residence_card" && resolvedView === "unsupported"
  const residenceIssue = residenceUnavailable || residenceUnsupported
  const sampleProviderUnavailable = (gate === "person" || gate === "age" || gate === "payment_kyc") && resolvedView === "unavailable" && !reviewMode
  const reviewTransition = (gate === "person" || gate === "age" || gate === "payment_kyc") && (resolvedView === "processing" || resolvedView === "success")
  const accountTransition = gate === "account" && resolvedView === "processing"
  const statusTransition = reviewTransition || accountTransition
  const title = resolvedView === "processing" ? gate === "account" ? copy.accountProcessingTitle : gate === "age" ? copy.ageProcessingTitle : gate === "payment_kyc" ? copy.paymentProcessingTitle : copy.personProcessingTitle
    : resolvedView === "success" ? gate === "age" ? copy.ageSuccessTitle : gate === "payment_kyc" ? copy.paymentSuccessTitle : copy.personSuccessTitle
      : resolvedView === "failure" ? copy.failureTitle
    : residenceUnsupported ? copy.residenceUnsupportedTitle
      : residenceUnavailable ? copy.residenceUnavailableTitle
      : resolvedView === "unavailable" ? copy.unavailableTitle
      : resolvedView === "expired" ? copy.expiredTitle
        : gate === "account" ? accountContextTitle
          : gate === "person" ? copy.personTitle
            : isCredential ? credentialNeedsSetup ? copy.credentialMissingTitle : isExperience ? experienceCopy.presentationTitle : pending.cta === "JOIN_TABLE" ? copy.credentialTableTitle : copy.credentialCheckoutTitle
              : gate === "age" ? copy.ageTitle
                : isCheckout ? copy.checkoutPaymentTitle : copy.paymentTitle
  const body = resolvedView === "processing" ? gate === "account" ? copy.accountProcessingBody : gate === "age" ? copy.ageProcessingBody : gate === "payment_kyc" ? copy.paymentProcessingBody : copy.personProcessingBody
    : resolvedView === "success" ? gate === "age" ? copy.ageSuccessBody : gate === "payment_kyc" ? copy.paymentSuccessBody : copy.personSuccessBody
      : resolvedView === "failure" ? copy.failureBody
    : residenceUnsupported ? copy.residenceUnsupportedBody
      : residenceUnavailable ? copy.residenceUnavailableBody
      : resolvedView === "unavailable" ? copy.unavailableBody
      : resolvedView === "expired" ? copy.expiredBody
        : gate === "account" ? copy.accountJitBody
          : gate === "person" ? copy.personBody
            : isCredential ? credentialNeedsSetup ? copy.credentialMissingBody : isExperience ? experienceCopy.presentationBody : copy.credentialBody
              : gate === "age" ? copy.ageBody
                : isCheckout ? copy.checkoutPaymentBody : copy.paymentBody
  const action = gate === "account" ? copy.accountAction
    : gate === "person" ? personRoute === "mobile_residence_card" ? copy.residenceAction : copy.personAction
      : isCredential ? credentialNeedsSetup ? copy.credentialSetupAction : copy.credentialApproveAction
        : gate === "age" ? copy.ageAction : isCheckout ? copy.checkoutPaymentAction : copy.paymentAction
  const cancelLabel = isCredential ? copy.credentialDenyAction : isCheckout ? copy.checkoutCancel : gate === "account" ? copy.notNow : copy.cancel
  const headerLabel = gate === "account" ? copy.accountHeader : gate === "person" ? copy.planPerson : isCredential ? copy.planCredential : gate === "age" ? copy.planAge : copy.planPayment
  const returnVenueLabel = pending.cta === "MINT_BADGE"
    ? null
    : resolveCommercePlaceB(pending.venueId)?.name[state.locale] ?? venueLabelById(pending.venueId, state.locale) ?? editorialPlaceById(pending.venueId)?.name[state.locale]
  const privateContext = privateContextForBAction(pending)
  const signalContext = privateContext?.cta === "SUBMIT_LOCAL_SIGNAL" ? privateContext : null
  const signalTagIcons = { calm_now: Waves, lively_now: Sparkles, quick_stop: Timer, welcoming: HeartHandshake } as const
  const GateIcon = gate === "account" ? CircleUserRound : gate === "person" ? UserRoundCheck : isCredential ? ShieldCheck : gate === "age" ? BadgeCheck : CreditCard
  const PersonRouteIcon = personRoute === "mobile_id_cx" ? Smartphone : personRoute === "mobile_residence_card" ? IdCard : personRoute === "passport_ekyc" ? BookOpenCheck : null
  const personRouteTitle = personRoute === "mobile_id_cx" ? copy.mobileTitle : personRoute === "mobile_residence_card" ? copy.residenceTitle : personRoute === "passport_ekyc" ? copy.passportTitle : null
  const personRouteNote = personRoute === "mobile_id_cx" ? copy.mobileNote : personRoute === "mobile_residence_card" ? copy.residenceNote : personRoute === "passport_ekyc" ? copy.passportNote : null
  const decisionDescriptionId = gate === "person" && personRoute
      ? "action-person-decision-truth"
      : isCredential && !credentialNeedsSetup
        ? "action-credential-decision-truth"
        : undefined
  const routeChoices = [
    { route: "mobile_id_cx", label: copy.routeChoiceMobile, availability: reviewMode ? "review" : "unavailable", availabilityLabel: reviewMode ? copy.routeReview : copy.routeUnavailable, Icon: Smartphone },
    { route: "mobile_residence_card", label: copy.routeChoiceResidence, availability: reviewMode ? residenceAvailability : "unavailable", availabilityLabel: residenceAvailability === "supported" ? copy.routeReview : residenceAvailability === "unsupported" ? copy.routeUnsupported : copy.routeUnavailable, Icon: IdCard },
    { route: "passport_ekyc", label: copy.routeChoicePassport, availability: reviewMode ? "review" : "unavailable", availabilityLabel: reviewMode ? copy.routeReview : copy.routeUnavailable, Icon: BookOpenCheck },
  ] as const

  const ReturnIcon = pending.cta === "MINT_BADGE" ? BadgeCheck : MapPin
  const additionalPassChecks = reviewMode && blockedDecision?.reason === "service_not_entitled"
    && isPersonOnlySimulatedCredentialB(state.identityCredential)

  if (blockedDecision && !expiredReturn && view !== "processing" && view !== "success") return <div ref={layerRef} className={styles.layer} data-testid="ondo-b-action-gate" data-ondo-layer="critical" data-modal-layer-priority={ONDO_MODAL_PRIORITY.critical} data-active-gate={gate} data-gate-view="policy" data-return-cta={pending.cta}>
    <div className={styles.backdrop} aria-hidden="true" />
    <section ref={dialogRef} className={styles.dialog} role="dialog" tabIndex={-1} aria-modal="true" aria-labelledby="b-action-gate-title" onKeyDown={handleKeyDown} data-testid="kpass-policy-decision" data-reason={blockedDecision.reason}>
      <header><span><ShieldCheck size={18} aria-hidden="true" />K-Tour ID</span><button type="button" aria-label={cancelLabel} onClick={() => cancel()}><X size={18} aria-hidden="true" /></button></header>
      <div className={styles.body}><div className={styles.content}><div className={styles.hero}><ShieldCheck size={31} aria-hidden="true" /></div><h2 id="b-action-gate-title">{kpassDecisionLabel(blockedDecision, state.locale)}</h2><p className={styles.lead}>{kpassDecisionRecovery(blockedDecision, state.locale)}</p></div>
        <div className={styles.actions}>{additionalPassChecks ? <button type="button" className={styles.primary} data-action-gate-initial-focus data-testid="kpass-additional-checks-open" onClick={() => actions.openIdentitySetup("action_gate")}>{experienceCopy.additionalChecks}<ChevronRight size={17} aria-hidden="true" /></button> : null}{blockedDecision.reason === "age_proof_required" ? <button type="button" className={styles.primary} data-action-gate-initial-focus data-testid="kpass-request-age-proof" onClick={confirm}>{state.locale === "ko" ? "나이 증명 확인" : state.locale === "ja" ? "年齢の証明を確認" : "Confirm age proof"}<ShieldCheck size={17} aria-hidden="true" /></button> : null}<button type="button" className={additionalPassChecks || blockedDecision.reason === "age_proof_required" ? styles.secondary : styles.primary} data-action-gate-initial-focus={!additionalPassChecks && blockedDecision.reason !== "age_proof_required" ? true : undefined} data-testid="kpass-policy-return" onClick={() => cancel(gate === "credential" ? "denied" : "cancel")}>{isExperience ? experienceCopy.back : gate === "credential" ? state.locale === "ko" ? "혜택 없이 계속" : state.locale === "ja" ? "特典なしで続ける" : "Continue without benefit" : cancelLabel}<ChevronRight size={17} aria-hidden="true" /></button></div>
      </div>
    </section>
  </div>

  return (
    <div ref={layerRef} className={styles.layer} data-testid="ondo-b-action-gate" data-ondo-layer="critical" data-modal-layer-priority={ONDO_MODAL_PRIORITY.critical} data-active-gate={gate} data-person-route={gate === "person" ? personRoute ?? "unselected" : undefined} data-gate-view={resolvedView} data-return-cta={pending.cta} data-execution-mode={gate === "person" || gate === "age" || gate === "payment_kyc" ? reviewMode ? "review" : "normal" : undefined}>
      <div className={styles.backdrop} aria-hidden="true" />
      <section ref={dialogRef} className={styles.dialog} role="dialog" tabIndex={-1} aria-modal="true" aria-labelledby="b-action-gate-title" data-testid={gate === "person" ? "ondo-b-local-check-walkthrough" : gate === "age" ? "after19-walkthrough" : gate === "payment_kyc" ? "payment-check-walkthrough" : undefined} data-check-kind={gate} data-check-phase={gate === "person" ? resolvedView === "intro" ? personRoute ? "consent" : "route" : resolvedView === "success" ? "result" : resolvedView : gate === "age" || gate === "payment_kyc" ? resolvedView === "intro" ? "decision" : resolvedView === "success" ? "result" : resolvedView : undefined} data-check-origin={pending.cta === "SUBMIT_LOCAL_SIGNAL" ? "local_signal" : pending.cta === "JOIN_TABLE" ? "table" : isExperience ? "experience" : "checkout"} data-visual-direction={gate === "age" && pending.cta === "JOIN_TABLE" ? "timeleft-checkpoint" : undefined} onKeyDown={handleKeyDown}>
        <header><span><ShieldCheck size={18} aria-hidden="true" />{headerLabel}</span><button type="button" aria-label={cancelLabel} onClick={() => cancel()}><X size={18} aria-hidden="true" /></button></header>
        <div className={styles.body}>
          <div className={`${styles.content} ${statusTransition ? styles.transitionContent : ""}`} data-testid={resolvedView === "processing" ? gate === "account" ? "account-gate-processing" : "local-check-processing" : resolvedView === "success" ? "local-check-result" : undefined} data-result={resolvedView === "success" ? "success" : undefined} aria-live={statusTransition ? "polite" : undefined} aria-busy={resolvedView === "processing" ? true : undefined}>
            {(!reviewTransition || signalContext) ? <section className={`${styles.returnContext} ${signalContext ? styles.signalReturnContext : ""}`} data-testid="action-gate-return-context" data-place-context={pending.cta === "MINT_BADGE" ? undefined : "venue"} data-return-venue={pending.cta === "MINT_BADGE" ? "none" : pending.venueId} data-return-table={pending.cta === "JOIN_TABLE" ? pending.tableId : "none"} data-return-nonce={signalContext?.draftNonce ?? "none"}>
              <small>{copy.returnLabel}</small><strong><ReturnIcon size={15} aria-hidden="true" />{returnVenueLabel ?? returnLabel(pending, copy)}</strong>
              {returnVenueLabel ? <span>{returnLabel(pending, copy)}</span> : null}
              {signalContext ? <div className={styles.returnSignal} data-testid="action-gate-signal-anchor" data-selected-count={signalContext.tags.length} data-photo={signalContext.photoPreviewUrl ? "preview" : "none"} aria-label={`${signalContext.tags.length} · ${copy.signal}`}>
                <span aria-hidden="true">{signalContext.tags.slice(0, 3).map((tag) => {
                  const SignalIcon = signalTagIcons[tag]
                  return <i key={tag}><SignalIcon size={14} /></i>
                })}</span>
                <b>{signalContext.tags.length}</b>
                {signalContext.photoPreviewUrl ? <img src={signalContext.photoPreviewUrl} alt="" /> : null}
              </div> : null}
              {privateContext?.cta === "JOIN_TABLE" && privateContext.draft ? <details className={styles.returnDraft}><summary>{copy.returnDraft}<ChevronRight size={15} aria-hidden="true" /></summary><blockquote>{privateContext.draft}</blockquote></details> : null}
              {privateContext?.cta === "SUBMIT_LOCAL_SIGNAL" && privateContext.note ? <details className={styles.returnDraft}><summary>{copy.returnDraft}<ChevronRight size={15} aria-hidden="true" /></summary><blockquote>{privateContext.note}</blockquote></details> : null}
            </section> : null}
            <div className={resolvedView === "intro" ? styles.hero : resolvedView === "processing" || resolvedView === "success" ? styles.heroStatus : styles.heroError}>{resolvedView === "processing" ? <LoaderCircle className={styles.spinner} size={31} aria-hidden="true" /> : resolvedView === "success" ? <BadgeCheck size={31} aria-hidden="true" /> : resolvedView === "intro" ? <GateIcon size={31} aria-hidden="true" /> : <AlertTriangle size={31} aria-hidden="true" />}</div>
            <h2 id="b-action-gate-title" tabIndex={resolvedView === "processing" || resolvedView === "success" ? -1 : undefined} data-action-gate-initial-focus={resolvedView === "processing" || resolvedView === "success" ? true : undefined}>{title}</h2>
            {(resolvedView !== "processing" || gate === "account") && !(gate === "person" && resolvedView === "intro") ? <p className={styles.lead}>{body}</p> : null}
            {gate === "person" && reviewMode ? <p className={styles.reviewScope} data-testid="person-review-scope"><ShieldCheck size={15} aria-hidden="true" />{copy.reviewTruth}</p> : null}
            {gate === "age" && reviewMode ? <p className={styles.reviewScope} data-testid="age-review-scope"><ShieldCheck size={15} aria-hidden="true" />{copy.reviewTruth}</p> : null}
            {gate === "payment_kyc" && reviewMode ? <p className={styles.reviewScope} data-testid="payment-review-scope"><ShieldCheck size={15} aria-hidden="true" />{copy.reviewTruth}</p> : null}
            {gate === "person" && resolvedView === "intro" && !state.identityCredential ? <fieldset className={styles.routeChoices} data-testid="person-route-choices">
              <legend>{copy.routeChoiceLegend}</legend>
              <div>{routeChoices.map(({ route, label, availability, availabilityLabel, Icon }, index) => <button key={route} type="button" aria-pressed={personRoute === route} data-action-gate-initial-focus={!personRoute && index === 0 ? true : undefined} data-selected={personRoute === route ? "true" : "false"} data-availability={availability} data-testid={`person-route-choice-${route}`} onClick={() => selectPersonRoute(route)}><Icon size={18} aria-hidden="true" /><span><strong>{label}</strong><small>{availabilityLabel}</small></span></button>)}</div>
            </fieldset> : null}
            {gate === "person" && personRoute && PersonRouteIcon && resolvedView !== "intro" ? <section className={styles.personRoute} data-testid={`person-route-${personRoute}`} data-route-status={residenceUnsupported ? "unsupported" : residenceUnavailable ? "unavailable" : resolvedView === "failure" ? "failed" : "ready"}>
              <span className={styles.personRouteIcon}><PersonRouteIcon size={21} aria-hidden="true" /></span>
              <span><small>{copy.routeLabel}</small><strong>{personRouteTitle}</strong></span>
            </section> : null}
            {isCredential && !credentialNeedsSetup && resolvedView === "intro" ? <section className={styles.personRoute} data-testid="action-gate-presentation" data-request-active={presentationRequest ? isPresentationRequestActiveB(presentationRequest) : false}>
              <span className={styles.personRouteIcon}><ShieldCheck size={21} aria-hidden="true" /></span>
              <span><small>{pending.cta === "JOIN_TABLE" || isExperience ? returnLabel(pending, copy) : copy.checkout}</small><strong data-testid="action-gate-presentation-requester">{returnVenueLabel ?? returnLabel(pending, copy)}</strong></span>
            </section> : null}
            {!reviewTransition && resolvedView === "intro" && gate === "person" && personRoute ? <section id="action-person-decision-truth" className={styles.decisionTruth} data-testid="person-decision-truth">
              <p data-testid="consent-minimum"><ShieldCheck size={16} aria-hidden="true" /><span><small>{copy.consentMinimum}</small><strong>{isExperience ? experienceCopy.proof : copy.consentMinimumValue}</strong></span></p>
              <p data-testid="consent-retention"><span aria-hidden="true">↳</span><span><small>{copy.consentRetention}</small><strong>{copy.consentRetentionValue}</strong></span></p>
            </section> : null}
            {!reviewTransition && resolvedView === "intro" && isCredential && !credentialNeedsSetup ? <section id="action-credential-decision-truth" className={styles.decisionTruth} data-testid="credential-decision-truth">
              <p data-testid="credential-visible-predicate"><ShieldCheck size={16} aria-hidden="true" /><span><small>{copy.consentMinimum}</small><strong>{isExperience ? experienceCopy.proof : copy.credentialPredicate}</strong></span></p>
              <p data-testid="credential-visible-retention"><span aria-hidden="true">↳</span><span><small>{copy.consentRetention}</small><strong>{copy.credentialRetention}</strong></span></p>
            </section> : null}
            {!statusTransition && gate === "account" ? <details className={`${styles.disclosure} ${styles.accountDisclosure}`} data-testid="account-privacy-disclosure">
              <summary>{copy.accountDetails}<ChevronRight size={17} aria-hidden="true" /></summary>
              <div><p className={styles.truth}><ShieldCheck size={16} aria-hidden="true" />{copy.accountBoundary}</p></div>
            </details> : !reviewTransition && gate === "person" ? <details className={styles.disclosure} data-testid="person-provider-disclosure">
              <summary>{copy.providerDetails}<ChevronRight size={17} aria-hidden="true" /></summary>
              <div>
                {personRouteNote ? <p className={styles.routeNote}>{personRouteNote}</p> : null}
                <p className={styles.truth}><ShieldCheck size={16} aria-hidden="true" />{copy.truth}</p>
                {resolvedView === "intro" ? <section className={styles.consent} data-testid="local-check-consent">
                  <p data-testid="consent-requester"><small>{copy.consentRequester}</small><strong>{copy.consentRequesterValue}</strong></p>
                  <p data-testid="consent-purpose"><small>{copy.consentPurpose}</small><strong>{isExperience ? experienceCopy.presentationBody : copy.consentPurposeValue}</strong></p>
                </section> : null}
              </div>
            </details> : !reviewTransition && isCredential ? <details className={styles.disclosure} data-testid="credential-presentation-details">
              <summary>{copy.credentialDetails}<ChevronRight size={17} aria-hidden="true" /></summary>
              <div><p className={styles.truth} data-testid="action-gate-presentation-provider"><ShieldCheck size={16} aria-hidden="true" />{copy.truth}</p></div>
            </details> : !reviewTransition && isCheckout ? <details className={`${styles.disclosure} ${styles.checkoutDisclosure}`} data-testid="payment-privacy-disclosure">
              <summary>{copy.checkoutDetails}<ChevronRight size={17} aria-hidden="true" /></summary>
              <div><p className={styles.truth}><ShieldCheck size={16} aria-hidden="true" />{copy.truth}</p></div>
            </details> : !reviewTransition ? <details className={styles.disclosure} data-testid="age-privacy-disclosure">
              <summary>{copy.privacyDetails}<ChevronRight size={17} aria-hidden="true" /></summary>
              <div><p className={styles.truth}><ShieldCheck size={16} aria-hidden="true" />{copy.ageBoundary}</p></div>
            </details> : null}
          </div>
          {!statusTransition ? <div className={styles.actions} data-testid={resolvedView === "intro" ? undefined : "local-check-result"} data-result={resolvedView === "intro" ? undefined : resolvedView}>
            {resolvedView === "intro" ? gate !== "person" || personRoute ? <button type="button" className={styles.primary} data-action-gate-initial-focus data-testid={gate === "person" ? "local-check-boundary-continue" : gate === "age" ? "after19-start" : "action-gate-confirm"} aria-describedby={decisionDescriptionId} data-presentation-decision={isCredential && !credentialNeedsSetup ? "approve" : undefined} data-credential-action={isCredential && credentialNeedsSetup ? "setup" : undefined} onClick={confirm}>{action}<ChevronRight size={17} aria-hidden="true" /></button> : null
              : sampleProviderUnavailable ? <button type="button" className={styles.primary} data-action-gate-initial-focus data-testid="action-gate-sample-continue" onClick={continueWithSample}>{copy.sampleAction}<ChevronRight size={17} aria-hidden="true" /></button>
              : residenceIssue ? <button type="button" className={styles.primary} data-action-gate-initial-focus data-testid="local-check-passport-alternate" onClick={usePassportAlternative}><BookOpenCheck size={17} aria-hidden="true" />{copy.usePassport}</button>
                : gate === "person" && resolvedView === "unavailable" ? <button type="button" className={styles.primary} data-action-gate-initial-focus data-testid="person-choose-another" onClick={chooseAnotherPersonRoute}>{copy.chooseAnother}<ChevronRight size={17} aria-hidden="true" /></button>
                  : <button type="button" className={styles.primary} data-action-gate-initial-focus data-testid="action-gate-retry" onClick={retry}><RotateCcw size={17} aria-hidden="true" />{resolvedView === "expired" ? copy.renew : copy.retry}</button>}
            <button type="button" className={styles.secondary} data-testid="action-gate-cancel" data-presentation-decision={isCredential ? "deny" : undefined} onClick={isCredential ? denyPresentation : () => cancel()}>{cancelLabel}</button>
          </div> : null}
        </div>
      </section>
    </div>
  )
}
