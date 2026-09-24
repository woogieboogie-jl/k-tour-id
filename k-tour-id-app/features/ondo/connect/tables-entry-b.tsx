"use client"

import type { ChangeEvent, KeyboardEvent, ReactNode } from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, ArrowLeft, CalendarClock, Check, ChevronRight, CircleDollarSign, ClipboardList, Flag, ImageOff, ImagePlus, Languages, LoaderCircle, MapPin, MessageCircle, RotateCcw, ShieldCheck, Star, UserRoundX, UsersRound, Utensils, X } from "lucide-react"
import { canonicalMapVenueById } from "@/lib/ondo/venues/map-data"
import { venueDistrictLabel, venueNamePresentation } from "@/lib/ondo/venues/display"
import { editorialPlaceById } from "../pulse-b/japan-first-pulse-model-b"
import {
  abandonPendingBAction,
  actionReturnFromBEvent,
  B_ACTION_GATE_CANCEL_EVENT,
  B_ACTION_GATE_COMPLETE_EVENT,
  B_ACTION_GATE_READY_EVENT,
  consumePendingBActionAtMutation,
  createBTableActionReturn,
  finalizeConsumedBActionWithMutation,
  privateContextForBAction,
  requestBActionGate,
  restoreBActionGateSession,
  type BTableActionReturn,
} from "../identity-b/action-gate-contract-b"
import { ACTIVE_TABLE_ID, TABLE_VENUE_ID, bTableCheckInFixtureEvidenceId } from "./table-policy-b"
import { B_TABLE_ACTIVITY_CLEAR_EVENT, B_TABLE_ACTIVITY_SESSION_KEY, clearBTableActivity, readBTableActivity, readBTableFeedback, readBTableReport, restoreBTableActivitySnapshot, writeBTableActivity, writeBTableFeedback, writeBTableReport, type BTableFeedback } from "./table-activity-b"
import { isGlobalAfter19AgeCurrent, restoreGlobalAfter19B } from "../after19/after19-global-b-model"
import { useBActivityProfile } from "../identity-b/activity-profile-b-provider"
import type { OndoBLocale } from "../shared/state/ondo-b-preferences"
import { useOndoB } from "../shared/state/ondo-b-provider"
import { focusFirstAvailableDestination } from "../shared/ui/focus-destination"
import { isRenderedFocusable } from "../shared/ui/is-rendered-focusable"
import { ONDO_MODAL_PRIORITY } from "../shared/ui/modal-layer-priority"
import { useDocumentScrollLock, useModalIsolation } from "../shared/ui/use-modal-isolation"
import { useSheetPresence } from "../shared/ui/use-sheet-presence"
import { ProfileReputationEntryB, type ProfileHostExitGuardB } from "../identity-b/profile-reputation-b"
import { qaReviewFixtureOptions, readQaRuntime, useReviewSampleSession } from "../shared/ui/use-qa-controls"
import { requestReservationSampleB, RESERVATION_SAMPLE_CHANGE_EVENT, RESERVATION_SAMPLE_KEY, restoreReservationB, type ReservationRecordB } from "../reservation-b/reservation-model-b"
import { RESERVATION_COPY_B } from "../reservation-b/reservation-copy-b"
import { requestPlaceServiceReturnB, resolveCommercePlaceB } from "../commerce-b/place-service-registry-b"
import { ondoBProductTimeline, type OndoBProductTimelineOverride } from "../shared/time/product-timeline-b"
import { ONDO_B_TABLE, ONDO_B_TABLES, initialTableRuntime, ondoBTableById, ondoBTableTimeline, reduceTableRuntime, type OndoBTable, type TableAvailabilityState, type TableRuntime } from "./table-model"
import styles from "./pulse-table-b.module.css"

export { ACTIVE_TABLE_ID, TABLE_VENUE_ID } from "./table-policy-b"
export const ONDO_OPEN_TABLE_EVENT = "ondo:b:open-table"
export const MAX_TABLE_CHAT_IMAGE_BYTES = 10 * 1024 * 1024
const TABLE_CHAT_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"])
const actionGateSessionOptions = qaReviewFixtureOptions

type TableView = "detail" | "confirm" | "chat"
type MessageState = "sending" | "sent" | "failed"
type ChatMessage = { id: number; text: string; imageUrl: string | null; state: MessageState }
type ReportReason = "no_show" | "behavior" | "other"
type ReportReceipt = { reason: ReportReason; participantBlocked: boolean }
type SocialLocale = OndoBLocale
type TablesQaRuntime = {
  tableMessage?: "failure"
  tableJoin?: "network" | "policy" | "full" | "cancelled"
  tableAvailability?: "open" | "full" | "closed" | "cancelled"
  productTimeline?: OndoBProductTimelineOverride
}

const TABLE_MESSAGE_SETTLE_DELAY_MS = 600
const TABLE_ARRIVAL_SETTLE_DELAY_MS = 420
const TABLE_COMPLETION_EVENT_DELAY_MS = 360
const TABLE_JOIN_SETTLE_DELAY_MS = 360
const FOCUSABLE = "button:not([disabled]),[href],input:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1'])"

const COPY = {
  en: {
    eyebrow: "Upcoming meals",
    pastEyebrow: "Previous Tables",
    title: "K-Tour ID Tables",
    intro: "Place-based meal plans you can review and keep in My Korea.",
    privacy: "Table privacy",
    truth: "Your saved plan, notes and photos stay on this device.",
    official: "Place",
    officialBoundary: "This place anchors the plan. No booking is sent to the venue.",
    bookingTruth: "Local meal plan only · no seat or venue booking is sent.",
    timeLabel: "When",
    menuLabel: "Food plan",
    menu: "Share two savoury plates; order together",
    languageLabel: "Languages",
    language: "Korean + English",
    costLabel: "Expected share",
    cost: "About ₩18,000 each",
    participantsLabel: "Plan size",
    participants: "Up to 4 people",
    formatLabel: "Format",
    format: "Shared plates",
    open: "View Table",
    close: "Close Table",
    ageNotice: "19+ Table · eligibility is checked only when you choose to join.",
    draftLabel: "Note for this plan",
    draftHint: "Language or food preference (optional)",
    join: "Save this meal plan",
    confirmTitle: "Add this plan?",
    returnTitle: "Your Table, place, and note are unchanged.",
    confirm: "Add to My Korea",
    joinedTitle: "Plan saved",
    joinedBody: "Find it in My Korea. Nothing was sent to the place or another person.",
    openChat: "Open plan notes",
    chatTitle: "Plan notes",
    arrivalDetails: "Chat & arrival details",
    chatBoundary: "Use this space for your own meetup notes. Everything stays on this device.",
    compose: "Add a plan note",
    attach: "Add photo",
    replacePhoto: "Replace photo",
    removePhoto: "Remove attached photo",
    messagePhotoAlt: "Photo in your Table message",
    selectedPhotoAlt: "Photo selected for your Table message",
    photoTypeError: "Choose a JPEG, PNG, or WebP photo.",
    photoSizeError: "Choose a photo that is 10 MB or smaller.",
    send: "Add",
    addingHere: "Adding…",
    addedHere: "Added here",
    addedHereBoundary: "Added only on this device. Nothing was sent.",
    sendFailed: "Message could not be added.",
    retry: "Retry",
    activitySaveFailed: "Couldn’t save this activity. Try again.",
    checkIn: "Mark arrival",
    checkingIn: "Checking arrival…",
    checkedIn: "Arrival marked",
    completing: "Wrapping up the Table…",
    feedbackTitle: "How was the Table?",
    helpful: "Helpful table",
    welcoming: "Easy to follow",
    feedback: "Save feedback",
    feedbackSaved: "Saved in this tab only. No public rating or reputation was created.",
    meetup: "Meetup",
    contribution: "Feedback",
    meetupValue: "Private arrival note",
    contributionValue: "Selected here",
    report: "Report",
    reportTitle: "Report this message?",
    reportConfirm: "Save report",
    reportDone: "Report saved here.",
    reportNotSent: "Saved only on this device.",
    reportReasonLegend: "What happened?",
    reportReasonNoShow: "No-show",
    reportReasonBehavior: "Uncomfortable behavior",
    reportReasonOther: "Something else",
    reportBlockWithReport: "Also hide the sample note",
    reportSaveFailed: "Couldn’t save this report. Try again.",
    block: "Block",
    blocked: "The sample note is hidden on this device.",
    leave: "Remove plan",
    leaveTitle: "Remove this meal plan?",
    leaveConfirm: "Remove plan",
    keep: "Keep plan",
    cancelSafety: "Cancel",
    stay: "Keep this plan",
    blockTitle: "Hide the sample note?",
    blockConfirm: "Hide note",
    blockTarget: "Sample note · stored only on this device",
    reportTarget: "Sample note · saved only on this device and not sent anywhere.",
    leaveTarget: "Night bites, one shared table",
    undo: "Undo",
    checkInBoundary: "Your arrival note is private. It doesn’t verify your live location or attendance.",
    tableHeader: "K-Tour ID Table",
    tableOpen: "Plan available",
    tableClosed: "Table closed",
    tableTitle: "Night bites, one shared table",
    tableSubtitle: "A relaxed Friday meal in Gangnam",
    pastJoin: "This meal plan has ended",
    joinSaveFailed: "My Korea could not save the plan. Nothing was booked. Try again.",
    leaveSaveFailed: "My Korea could not remove the plan. It is still saved. Try again.",
    closeSaveFailed: "This Table could not close safely. Try again.",
    joinRequesting: "Saving your plan…",
    joinNetwork: "The plan was not saved.",
    joinPolicy: "This plan cannot be saved right now.",
    joinFull: "This plan is unavailable.",
    joinCancelled: "This plan is no longer available.",
    retryJoin: "Try again",
    otherTables: "View other Tables",
    chatLocked: "Plan notes open after the plan is saved.",
    imageUnavailable: "Photo unavailable",
    venueUnavailable: "Place information is unavailable.",
    minMessage: "Meet by the entrance.",
    jaeMessage: "English or Korean both work.",
    planNote: "Meetup note",
    languageNote: "Language note",
    you: "You",
  },
  ko: {
    eyebrow: "함께할 식사",
    pastEyebrow: "지난 테이블",
    title: "K-Tour ID 테이블",
    intro: "장소와 연결된 식사 계획을 확인하고 My Korea에 보관하세요.",
    privacy: "테이블 개인정보",
    truth: "저장한 계획·메모·사진은 이 기기에만 남아요.",
    official: "장소",
    officialBoundary: "이 장소는 계획의 기준점이며, 장소로 예약이 전송되지는 않아요.",
    bookingTruth: "로컬 식사 계획 · 좌석이나 장소 예약은 전송되지 않아요.",
    timeLabel: "시간",
    menuLabel: "음식 계획",
    menu: "짭짤한 요리 두 가지를 함께 주문해 나눠요",
    languageLabel: "언어",
    language: "한국어 + 영어",
    costLabel: "예상 분담",
    cost: "1인 약 18,000원",
    participantsLabel: "계획 인원",
    participants: "최대 4명",
    formatLabel: "형식",
    format: "함께 나누는 요리",
    open: "테이블 보기",
    close: "테이블 닫기",
    ageNotice: "19+ 테이블 · 참여할 때만 자격을 확인해요.",
    draftLabel: "이 계획의 메모",
    draftHint: "언어·음식 선호 (선택)",
    join: "식사 계획 저장",
    confirmTitle: "이 계획을 추가할까요?",
    returnTitle: "테이블·장소·메모가 그대로 유지됐어요.",
    confirm: "My Korea에 추가",
    joinedTitle: "계획을 저장했어요",
    joinedBody: "My Korea에서 다시 볼 수 있어요. 장소나 다른 사람에게 전송된 내용은 없어요.",
    openChat: "계획 메모 열기",
    chatTitle: "계획 메모",
    arrivalDetails: "채팅·도착 안내",
    chatBoundary: "내 모임 메모를 남겨보세요. 모든 내용은 이 기기에만 남아요.",
    compose: "계획 메모 추가",
    attach: "사진 추가",
    replacePhoto: "사진 교체",
    removePhoto: "첨부 사진 삭제",
    messagePhotoAlt: "내 테이블 메시지에 담긴 사진",
    selectedPhotoAlt: "테이블 메시지에 추가할 사진",
    photoTypeError: "JPEG, PNG 또는 WebP 사진을 선택해 주세요.",
    photoSizeError: "10 MB 이하의 사진을 선택해 주세요.",
    send: "추가",
    addingHere: "추가 중…",
    addedHere: "여기에 추가됨",
    addedHereBoundary: "이 기기에만 추가했어요. 어디에도 전송하지 않았습니다.",
    sendFailed: "메시지를 추가하지 못했어요.",
    retry: "다시 시도",
    activitySaveFailed: "활동을 저장하지 못했어요. 다시 시도해 주세요.",
    checkIn: "도착 표시",
    checkingIn: "도착 확인 중…",
    checkedIn: "도착 표시됨",
    completing: "테이블을 마무리하는 중…",
    feedbackTitle: "테이블은 어땠나요?",
    helpful: "도움이 된 테이블",
    welcoming: "이해하기 쉬운 계획",
    feedback: "피드백 저장",
    feedbackSaved: "이 탭에만 저장했어요. 공개 평점이나 평판은 생성되지 않았습니다.",
    meetup: "만남",
    contribution: "피드백",
    meetupValue: "비공개 도착 표시",
    contributionValue: "여기에서 선택됨",
    report: "신고",
    reportTitle: "이 메시지를 신고할까요?",
    reportConfirm: "신고 저장",
    reportDone: "여기에 신고를 저장했어요.",
    reportNotSent: "이 기기에만 저장돼요.",
    reportReasonLegend: "무슨 일이 있었나요?",
    reportReasonNoShow: "약속 불참",
    reportReasonBehavior: "불편한 언행",
    reportReasonOther: "기타",
    reportBlockWithReport: "예시 메모도 숨기기",
    reportSaveFailed: "신고를 저장하지 못했어요. 다시 시도해 주세요.",
    block: "차단",
    blocked: "이 기기에서 예시 메모를 숨겼어요.",
    leave: "계획 삭제",
    leaveTitle: "이 식사 계획을 삭제할까요?",
    leaveConfirm: "계획 삭제",
    keep: "계획 유지",
    cancelSafety: "취소",
    stay: "이 계획 유지",
    blockTitle: "예시 메모를 숨길까요?",
    blockConfirm: "메모 숨기기",
    blockTarget: "예시 메모 · 이 기기에만 저장",
    reportTarget: "예시 메모 · 이 기기에만 저장되며 어디에도 전송되지 않아요.",
    leaveTarget: "야식 한 상, 함께 앉는 테이블",
    undo: "실행 취소",
    checkInBoundary: "도착 표시는 비공개이며, 실시간 위치나 실제 참석을 확인하지 않아요.",
    tableHeader: "K-Tour ID 테이블",
    tableOpen: "저장 가능한 계획",
    tableClosed: "종료된 테이블",
    tableTitle: "야식 한 상, 함께 앉는 테이블",
    tableSubtitle: "강남에서 가볍게 나누는 금요일 저녁",
    pastJoin: "이 식사 계획은 종료됐어요",
    joinSaveFailed: "My Korea에 계획을 저장하지 못했어요. 예약된 내용은 없습니다. 다시 시도해 주세요.",
    leaveSaveFailed: "My Korea에서 계획을 삭제하지 못했어요. 기존 계획은 그대로예요. 다시 시도해 주세요.",
    closeSaveFailed: "테이블을 안전하게 닫지 못했어요. 다시 시도해 주세요.",
    joinRequesting: "계획을 저장하는 중…",
    joinNetwork: "계획을 저장하지 못했어요.",
    joinPolicy: "지금은 이 계획을 저장할 수 없어요.",
    joinFull: "이 계획은 지금 이용할 수 없어요.",
    joinCancelled: "이 계획은 더 이상 이용할 수 없어요.",
    retryJoin: "다시 시도",
    otherTables: "다른 테이블 보기",
    chatLocked: "계획을 저장하면 메모를 열 수 있어요.",
    imageUnavailable: "사진을 표시할 수 없어요",
    venueUnavailable: "장소 정보를 불러올 수 없어요.",
    minMessage: "입구 옆에서 만나기.",
    jaeMessage: "영어와 한국어 모두 가능.",
    planNote: "만남 메모",
    languageNote: "언어 메모",
    you: "나",
  },
  ja: {
    eyebrow: "これからの食事",
    pastEyebrow: "終了したTable",
    title: "K-Tour ID テーブル",
    intro: "場所を起点にした食事プランを確認し、マイ韓国に保存できます。",
    privacy: "Tableのプライバシー",
    truth: "保存したプラン、メモ、写真はこの端末内だけに残ります。",
    official: "場所",
    officialBoundary: "この場所はプランの基点です。店舗への予約送信はありません。",
    bookingTruth: "端末内の食事プランです。席や店舗の予約は送信されません。",
    timeLabel: "日時",
    menuLabel: "食事プラン",
    menu: "料理を2品、一緒に注文してシェア",
    languageLabel: "使用言語",
    language: "韓国語＋英語",
    costLabel: "予想負担額",
    cost: "1人約₩18,000",
    participantsLabel: "予定人数",
    participants: "最大4人",
    formatLabel: "形式",
    format: "料理をシェア",
    open: "Tableを見る",
    close: "Tableを閉じる",
    ageNotice: "19+のTableです。参加を選んだときだけ年齢条件を確認します。",
    draftLabel: "このプランのメモ",
    draftHint: "言語・食の希望（任意）",
    join: "食事プランを保存",
    confirmTitle: "このプランを追加しますか？",
    returnTitle: "Table、場所、メモはそのままです。",
    confirm: "マイ韓国に追加",
    joinedTitle: "プランを保存しました",
    joinedBody: "マイ韓国から確認できます。店舗やほかの人には送信されていません。",
    openChat: "プランメモを開く",
    chatTitle: "プランメモ",
    arrivalDetails: "チャット・到着記録",
    chatBoundary: "自分用の集合メモを残せます。すべてこの端末内だけに残ります。",
    compose: "プランメモを追加",
    attach: "写真を追加",
    replacePhoto: "写真を変更",
    removePhoto: "添付写真を削除",
    messagePhotoAlt: "自分のTableメッセージに添付した写真",
    selectedPhotoAlt: "Tableメッセージに追加する写真",
    photoTypeError: "JPEG、PNG、WebPの写真を選んでください。",
    photoSizeError: "10 MB以下の写真を選んでください。",
    send: "追加",
    addingHere: "追加中…",
    addedHere: "ここに追加済み",
    addedHereBoundary: "この端末内だけに追加しました。外部には送信していません。",
    sendFailed: "メッセージを追加できませんでした。",
    retry: "もう一度試す",
    activitySaveFailed: "アクティビティを保存できませんでした。もう一度お試しください。",
    checkIn: "到着を記録",
    checkingIn: "到着を確認中…",
    checkedIn: "到着を記録済み",
    completing: "Tableを完了しています…",
    feedbackTitle: "Tableはいかがでしたか？",
    helpful: "役に立つTable",
    welcoming: "わかりやすいプラン",
    feedback: "フィードバックを保存",
    feedbackSaved: "このタブ内だけに保存しました。公開評価や評判は作成されていません。",
    meetup: "集合",
    contribution: "フィードバック",
    meetupValue: "非公開の到着記録",
    contributionValue: "ここで選択",
    report: "報告",
    reportTitle: "このメッセージを報告しますか？",
    reportConfirm: "報告を保存",
    reportDone: "ここに報告を保存しました。",
    reportNotSent: "この端末内だけに保存されます。",
    reportReasonLegend: "何がありましたか？",
    reportReasonNoShow: "無断欠席",
    reportReasonBehavior: "不快な言動",
    reportReasonOther: "その他",
    reportBlockWithReport: "サンプルメモも非表示にする",
    reportSaveFailed: "報告を保存できませんでした。もう一度お試しください。",
    block: "ブロック",
    blocked: "この端末でサンプルメモを非表示にしました。",
    leave: "プランを削除",
    leaveTitle: "この食事プランを削除しますか？",
    leaveConfirm: "プランを削除",
    keep: "プランを残す",
    cancelSafety: "キャンセル",
    stay: "このプランを残す",
    blockTitle: "サンプルメモを非表示にしますか？",
    blockConfirm: "メモを非表示",
    blockTarget: "サンプルメモ・この端末内だけに保存",
    reportTarget: "サンプルメモ・この端末内だけに保存され、外部には送信されません。",
    leaveTarget: "夜のひと皿を囲むTable",
    undo: "元に戻す",
    checkInBoundary: "到着記録は非公開で、現在地や実際の参加を確認するものではありません。",
    tableHeader: "K-Tour ID テーブル",
    tableOpen: "保存できるプラン",
    tableClosed: "終了したTable",
    tableTitle: "夜のひと皿を囲むTable",
    tableSubtitle: "江南で気軽に楽しむ金曜の夕食",
    pastJoin: "この食事プランは終了しました",
    joinSaveFailed: "マイ韓国にプランを保存できませんでした。予約は作成されていません。もう一度お試しください。",
    leaveSaveFailed: "マイ韓国からプランを削除できませんでした。保存内容はそのままです。もう一度お試しください。",
    closeSaveFailed: "Tableを安全に閉じられませんでした。もう一度お試しください。",
    joinRequesting: "プランを保存中…",
    joinNetwork: "プランを保存できませんでした。",
    joinPolicy: "現在このプランは保存できません。",
    joinFull: "このプランは現在利用できません。",
    joinCancelled: "このプランは利用できなくなりました。",
    retryJoin: "もう一度試す",
    otherTables: "ほかのTableを見る",
    chatLocked: "プランを保存するとメモを開けます。",
    imageUnavailable: "写真を表示できません",
    venueUnavailable: "場所の情報を利用できません。",
    minMessage: "入口の横で待ち合わせ。",
    jaeMessage: "英語・韓国語に対応。",
    planNote: "集合メモ",
    languageNote: "言語メモ",
    you: "自分",
  },
} as const satisfies Record<SocialLocale, Record<string, string>>

type TableCopy = (typeof COPY)[SocialLocale]

function reportReasonLabel(reason: ReportReason, copy: TableCopy) {
  if (reason === "no_show") return copy.reportReasonNoShow
  if (reason === "behavior") return copy.reportReasonBehavior
  return copy.reportReasonOther
}

const TABLE_EDITORIAL = {
  en: { alt: "Four travelers sharing a Korean meal", caption: "Shared dinner inspiration" },
  ko: { alt: "한국 음식을 함께 나누는 여행자 네 명", caption: "함께하는 저녁 식사 이미지" },
  ja: { alt: "韓国料理を囲む4人の旅行者", caption: "一緒に楽しむ夕食のイメージ" },
} satisfies Record<SocialLocale, { alt: string; caption: string }>

function reviewAvailability(table: OndoBTable, isUpcoming: boolean): TableAvailabilityState {
  if (!isUpcoming) return "TAV-CLOSED"
  const review = readQaRuntime<TablesQaRuntime>()?.tableAvailability
  if (review === "full") return "TAV-FULL"
  if (review === "closed") return "TAV-CLOSED"
  if (review === "cancelled") return "TAV-CANCELLED"
  return table.availability
}

function runtimeStatusCopy(runtime: TableRuntime, copy: TableCopy) {
  if (runtime.availability === "TAV-CANCELLED") return copy.joinCancelled
  if (runtime.availability === "TAV-CLOSED") return copy.pastJoin
  if (runtime.availability === "TAV-FULL" || runtime.failure === "TFR-FULL") return copy.joinFull
  if (runtime.failure === "TFR-NETWORK") return copy.joinNetwork
  if (runtime.failure === "TFR-POLICY") return copy.joinPolicy
  if (runtime.membership === "TMB-REQUESTING") return copy.joinRequesting
  return copy.tableOpen
}

function resolveTablePlaceContext(table: OndoBTable, locale: SocialLocale) {
  const venue = canonicalMapVenueById(table.venueId)
  if (venue) {
    const presentation = venueNamePresentation(venue.name.ko, locale)
    return {
      name: locale === "ko" ? presentation.officialName : presentation.transliteration,
      sourceName: presentation.officialName,
      district: venueDistrictLabel(venue.cityId, venue.districtId, locale),
      kind: "official" as const,
    }
  }
  const place = editorialPlaceById(table.venueId)
  return place ? {
    name: place.name[locale],
    sourceName: place.name.ko,
    district: table.presentation.city[locale],
    kind: "editorial" as const,
  } : null
}

function tablePlanValues(table: OndoBTable, locale: SocialLocale, copy: TableCopy) {
  if (table.id === ACTIVE_TABLE_ID) return {
    menu: copy.menu,
    language: copy.language,
    cost: copy.cost,
    participants: copy.participants,
    format: copy.format,
  }
  return {
    menu: table.presentation.menu[locale],
    language: locale === "ko" ? "한국어 · 영어 · 일본어" : locale === "ja" ? "韓国語・英語・日本語" : "Korean · English · Japanese",
    cost: locale === "ko" ? `1인 약 ${table.estimatedPriceKRW.toLocaleString("ko-KR")}원` : locale === "ja" ? `1人約₩${table.estimatedPriceKRW.toLocaleString("en-US")}` : `About ₩${table.estimatedPriceKRW.toLocaleString("en-US")} each`,
    participants: locale === "ko" ? `최대 ${table.seatsTotal}명` : locale === "ja" ? `最大${table.seatsTotal}人` : `Up to ${table.seatsTotal} people`,
    format: table.presentation.format[locale],
  }
}

function isConfirmedMembership(runtime: TableRuntime) {
  return runtime.membership === "TMB-CONFIRMED" || runtime.membership === "TMB-CHECKED-IN" || runtime.membership === "TMB-COMPLETED"
}

function freezeTableActionReturn(value: BTableActionReturn): BTableActionReturn {
  return Object.freeze({ ...value, gatePlan: Object.freeze([...value.gatePlan]) })
}

export function PulseTablesEntryB() {
  const { state, actions } = useOndoB()
  const publicSample = useReviewSampleSession()
  const [reservationHistory, setReservationHistory] = useState<ReservationRecordB[]>([])
  const [sampleJoin, setSampleJoin] = useState<"success" | NonNullable<TablesQaRuntime["tableJoin"]>>("success")
  const [sampleMessage, setSampleMessage] = useState(false)
  const credentialRef = useRef(state.identityCredential)
  credentialRef.current = state.identityCredential
  const { actions: activityActions } = useBActivityProfile()
  const locale = state.locale
  const socialLocale: SocialLocale = locale
  const t = COPY[socialLocale]
  const reservationCopy = RESERVATION_COPY_B[locale]
  useEffect(() => {
    const sync = () => {
      if (!publicSample) { setReservationHistory([]); return }
      try {
        const stored = restoreReservationB(JSON.parse(window.sessionStorage.getItem(RESERVATION_SAMPLE_KEY) ?? "null"))
        setReservationHistory(stored ? [stored, ...stored.history].filter(record => record.draft.venueId && record.operationId) : [])
      } catch { setReservationHistory([]) }
    }
    sync()
    window.addEventListener(RESERVATION_SAMPLE_CHANGE_EVENT, sync)
    window.addEventListener(B_TABLE_ACTIVITY_CLEAR_EVENT, sync)
    return () => {
      window.removeEventListener(RESERVATION_SAMPLE_CHANGE_EVENT, sync)
      window.removeEventListener(B_TABLE_ACTIVITY_CLEAR_EVENT, sync)
    }
  }, [publicSample])
  const [productTimeline] = useState(() => ondoBProductTimeline(Date.now(), readQaRuntime<TablesQaRuntime>()?.productTimeline ?? null))
  const [tableClockNow, setTableClockNow] = useState(() => Date.now())
  const [activeTableId, setActiveTableId] = useState(ACTIVE_TABLE_ID)
  const activeTable = ondoBTableById(activeTableId) ?? ONDO_B_TABLE
  const activeTableTimeline = ondoBTableTimeline(activeTable, productTimeline, locale)
  const tableStartsAtMs = activeTableTimeline.startsAtMs
  const isUpcoming = tableClockNow < tableStartsAtMs
  const activeVenueId = activeTable.venueId
  const activeTableRef = useRef(activeTable)
  activeTableRef.current = activeTable
  const plannedAtMount = state.plannedTableRefs.some(({ tableId, venueId }) => tableId === activeTable.id && venueId === activeVenueId)
  const [runtime, setRuntime] = useState<TableRuntime>(() => initialTableRuntime(
    { ...activeTable, availability: reviewAvailability(activeTable, isUpcoming) },
    plannedAtMount ? "confirmed" : "none",
  ))
  const runtimeRef = useRef(runtime)
  runtimeRef.current = runtime
  const [selected, setSelected] = useState(false)
  const tableSheetPresence = useSheetPresence(selected ? `${activeTable.id}:${activeVenueId}` : null)
  const tableClosing = tableSheetPresence.phase === "closing"
  const [draft, setDraft] = useState("")
  const [returnTo, setReturnTo] = useState<BTableActionReturn | null>(null)
  const returnToRef = useRef(returnTo)
  returnToRef.current = returnTo
  const [tableView, setTableView] = useState<TableView>("detail")
  const [joinRequestPending, setJoinRequestPending] = useState(false)
  const [chatLockedNotice, setChatLockedNotice] = useState(false)
  const [closePersistError, setClosePersistError] = useState(false)
  const [editorialImageFailed, setEditorialImageFailed] = useState(false)
  const [listImageFailedIds, setListImageFailedIds] = useState<Set<string>>(() => new Set())
  const [detailImageFailed, setDetailImageFailed] = useState(false)
  const [chatImageFailed, setChatImageFailed] = useState(false)
  const [failedMessageImages, setFailedMessageImages] = useState<Set<number>>(() => new Set())
  const [reportOpen, setReportOpen] = useState(false)
  const [reportReason, setReportReason] = useState<ReportReason | null>(null)
  const [reportBlock, setReportBlock] = useState(false)
  const [reportReceipt, setReportReceipt] = useState<ReportReceipt | null>(null)
  const [blockOpen, setBlockOpen] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [joinPersistError, setJoinPersistError] = useState(false)
  const [leavePersistError, setLeavePersistError] = useState(false)
  const [compose, setCompose] = useState("")
  const [chatImage, setChatImage] = useState<string | null>(null)
  const [chatImageError, setChatImageError] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [arrivalChecking, setArrivalChecking] = useState(false)
  const [feedback, setFeedback] = useState<BTableFeedback | null>(null)
  const [feedbackSaved, setFeedbackSaved] = useState(false)
  const [activityPersistError, setActivityPersistError] = useState(false)
  const [reportPersistError, setReportPersistError] = useState(false)
  const safetyOpen = reportOpen || blockOpen || leaveOpen
  const layerRef = useRef<HTMLDivElement | null>(null)
  const detailRef = useRef<HTMLElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const openerRef = useRef<HTMLButtonElement | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const restoreFocusAfterExitRef = useRef(false)
  const tableExitVisualSnapshotRef = useRef<ReactNode>(null)
  const profileHostExitGuardRef = useRef<ProfileHostExitGuardB | null>(null)
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const reportButtonRef = useRef<HTMLButtonElement | null>(null)
  const blockButtonRef = useRef<HTMLButtonElement | null>(null)
  const leaveButtonRef = useRef<HTMLButtonElement | null>(null)
  const blockUndoRef = useRef<HTMLButtonElement | null>(null)
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const objectUrlsRef = useRef(new Set<string>())
  const messageTimersRef = useRef(new Map<number, number>())
  const arrivalTimerRef = useRef<number | null>(null)
  const completionTimerRef = useRef<number | null>(null)
  const joinTimerRef = useRef<number | null>(null)
  const tableInteractionEpochRef = useRef(0)
  const nextMessageIdRef = useRef(0)
  const failedMessageOnceRef = useRef(false)
  const failedJoinOnceRef = useRef(false)
  const registerProfileHostExitGuard = useCallback((guard: ProfileHostExitGuardB | null) => {
    profileHostExitGuardRef.current = guard
  }, [])

  const checkedIn = runtime.membership === "TMB-CHECKED-IN" || runtime.membership === "TMB-COMPLETED"
  const tableCompleted = runtime.membership === "TMB-COMPLETED"
  const joinStage = tableView === "chat" && runtime.chatAccess === "CHA-OPEN"
    ? "chat"
    : tableView === "confirm"
      ? "confirm"
      : isConfirmedMembership(runtime)
        ? "joined"
        : "idle"

  useModalIsolation(tableSheetPresence.value !== null, layerRef)
  useDocumentScrollLock(tableSheetPresence.value !== null)

  useEffect(() => {
    if (!state.hydrated) return
    const joinedInThisSession = state.plannedTableRefs.some(({ tableId, venueId }) => tableId === activeTable.id && venueId === activeVenueId)
    const activity = joinedInThisSession ? readBTableActivity(window.sessionStorage, activeTable.id) : null
    setRuntime((current) => {
      const membership = activity === "completed" ? "TMB-COMPLETED" : activity === "checked_in" ? "TMB-CHECKED-IN" : joinedInThisSession ? "TMB-CONFIRMED" : current.membership === "TMB-LEFT" ? "TMB-LEFT" : "TMB-NONE"
      const next = reduceTableRuntime(current, { type: "RESTORE_MEMBERSHIP", membership })
      runtimeRef.current = next
      return next
    })
    if (!joinedInThisSession && tableView === "chat") {
      setTableView("detail")
      setChatLockedNotice(true)
    }
  }, [activeTable.id, activeVenueId, state.hydrated, state.plannedTableRefs])

  useEffect(() => {
    transitionRuntime({ type: "AVAILABILITY_CHANGED", availability: reviewAvailability(activeTable, isUpcoming) })
  }, [activeTable, isUpcoming])

  useEffect(() => {
    if (!safetyOpen) return
    function ownSafetyEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return
      const activeDecision = document.querySelector<HTMLElement>("[data-testid='table-safety-decision']")
      if (!activeDecision || activeDecision.closest("[inert],[aria-hidden='true']")) return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (reportOpen) {
        setReportOpen(false)
        window.requestAnimationFrame(() => reportButtonRef.current?.focus({ preventScroll: true }))
      } else if (blockOpen) {
        setBlockOpen(false)
        window.requestAnimationFrame(() => blockButtonRef.current?.focus({ preventScroll: true }))
      } else {
        setLeaveOpen(false)
        setLeavePersistError(false)
        window.requestAnimationFrame(() => leaveButtonRef.current?.focus({ preventScroll: true }))
      }
    }
    window.addEventListener("keydown", ownSafetyEscape, true)
    return () => window.removeEventListener("keydown", ownSafetyEscape, true)
  }, [blockOpen, leaveOpen, reportOpen, safetyOpen])

  const placeContext = useMemo(() => resolveTablePlaceContext(activeTable, locale), [activeTable, locale])
  const district = placeContext?.district ?? ""

  function transitionRuntime(event: Parameters<typeof reduceTableRuntime>[1]) {
    setRuntime((current) => {
      const next = reduceTableRuntime(current, event)
      runtimeRef.current = next
      return next
    })
  }

  function expireJoinAtMutation(pending: BTableActionReturn | null) {
    const now = Date.now()
    if (now < tableStartsAtMs) return false
    const currentTable = activeTableRef.current
    const stored = pending ?? restoreBActionGateSession(window.sessionStorage, new Date(), actionGateSessionOptions()).pending
    if (stored?.cta === "JOIN_TABLE" && stored.tableId === currentTable.id && stored.venueId === currentTable.venueId) {
      if (!abandonPendingBAction(window.sessionStorage, stored, new Date(), actionGateSessionOptions())) {
        setClosePersistError(true)
        setJoinPersistError(true)
      }
    }
    setTableClockNow(now)
    transitionRuntime({ type: "AVAILABILITY_CHANGED", availability: "TAV-CLOSED" })
    if (stored == null || restoreBActionGateSession(window.sessionStorage, new Date(), actionGateSessionOptions()).pending?.tokenId !== stored.tokenId) {
      returnToRef.current = null
      setReturnTo(null)
      setTableView("detail")
      setJoinPersistError(false)
    }
    return true
  }

  useEffect(() => {
    if (!isUpcoming) return
    const remaining = tableStartsAtMs - Date.now()
    if (remaining <= 0) {
      expireJoinAtMutation(null)
      return
    }
    const timer = window.setTimeout(() => expireJoinAtMutation(null), Math.min(remaining + 25, 2_147_000_000))
    return () => window.clearTimeout(timer)
  }, [activeTable.id, activeVenueId, isUpcoming, tableClockNow, tableStartsAtMs])

  useEffect(() => {
    function openFromPlace(event?: Event) {
      const detail = event instanceof CustomEvent ? event.detail as { tableId?: string; venueId?: string; mode?: string; draft?: string } : null
      const pending = window.__ONDO_B_TABLE_INTENT__ as (typeof window.__ONDO_B_TABLE_INTENT__ & { draft?: string })
      const intent = detail ?? pending
      if (!intent) return
      const requestedTable = ondoBTableById(intent.tableId)
      if (!requestedTable || requestedTable.venueId !== intent.venueId) return
      window.__ONDO_B_TABLE_INTENT__ = undefined
      const hasPlan = state.plannedTableRefs.some(({ tableId, venueId }) => tableId === requestedTable.id && venueId === requestedTable.venueId)
      const requestedTimeline = ondoBTableTimeline(requestedTable, productTimeline, locale)
      const nextRuntime = initialTableRuntime(
        { ...requestedTable, availability: reviewAvailability(requestedTable, tableClockNow < requestedTimeline.startsAtMs) },
        hasPlan ? "confirmed" : "none",
      )
      if (!abandonCurrentPendingBeforeOpen()) return
      const nextDraft = (detail?.draft ?? pending?.draft ?? "").slice(0, 280)
      prepareTableOpen()
      resetTableEphemeralState(requestedTable, nextDraft)
      activeTableRef.current = requestedTable
      setActiveTableId(requestedTable.id)
      runtimeRef.current = nextRuntime
      setRuntime(nextRuntime)
      const requestedMode = detail?.mode ?? pending?.mode
      if (requestedMode === "chat" && runtimeRef.current.chatAccess === "CHA-OPEN" && isConfirmedMembership(runtimeRef.current)) {
        setTableView("chat")
        setChatLockedNotice(false)
      } else {
        setTableView("detail")
        setChatLockedNotice(requestedMode === "chat")
      }
      selectedRef.current = true
      setSelected(true)
    }
    openFromPlace()
    window.addEventListener(ONDO_OPEN_TABLE_EVENT, openFromPlace)
    return () => window.removeEventListener(ONDO_OPEN_TABLE_EVENT, openFromPlace)
  }, [locale, productTimeline, state.plannedTableRefs, tableClockNow])

  useEffect(() => {
    function gateComplete(event: Event) {
      const detail = event instanceof CustomEvent ? event.detail as BTableActionReturn : null
      if (!detail || detail.cta !== "JOIN_TABLE" || detail.tableId !== activeTableRef.current.id || detail.venueId !== activeTableRef.current.venueId || detail.consumedAt !== null) return
      if (expireJoinAtMutation(detail)) return
      const frozenDetail = freezeTableActionReturn(detail)
      const context = privateContextForBAction(frozenDetail)
      if (!context || context.cta !== "JOIN_TABLE") {
        abandonPendingBAction(window.sessionStorage, detail, new Date(), actionGateSessionOptions())
        setJoinPersistError(true)
        returnToRef.current = null
        setReturnTo(null)
        setTableView("detail")
        return
      }
      setDraft(context.draft)
      returnToRef.current = frozenDetail
      setReturnTo(frozenDetail)
      setTableView("confirm")
      setChatLockedNotice(false)
      window.requestAnimationFrame(() => focusFirstAvailableDestination(["[data-testid='table-join-confirm']"]))
    }
    function gateCancel(event: Event) {
      const detail = event instanceof CustomEvent ? actionReturnFromBEvent(event.detail) : null
      if (!detail || detail.cta !== "JOIN_TABLE" || detail.tableId !== activeTableRef.current.id || detail.venueId !== activeTableRef.current.venueId) return
      const context = privateContextForBAction(detail)
      if (context?.cta === "JOIN_TABLE") setDraft(context.draft)
      returnToRef.current = null
      setReturnTo(null)
      setTableView("detail")
      window.requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-testid='table-join']")?.focus({ preventScroll: true }))
    }
    window.addEventListener(B_ACTION_GATE_READY_EVENT, gateComplete)
    window.addEventListener(B_ACTION_GATE_CANCEL_EVENT, gateCancel)
    return () => {
      window.removeEventListener(B_ACTION_GATE_READY_EVENT, gateComplete)
      window.removeEventListener(B_ACTION_GATE_CANCEL_EVENT, gateCancel)
    }
  }, [])

  useEffect(() => () => {
    invalidateTableAsyncWork()
    releaseTableObjectUrls()
  }, [])

  useEffect(() => {
    function restoreActivity() {
      const stage = readBTableActivity(window.sessionStorage, activeTable.id)
      const receipt = readBTableReport(window.sessionStorage, activeTable.id)
      const savedFeedback = readBTableFeedback(window.sessionStorage, activeTable.id)
      const hasPlan = state.plannedTableRefs.some(({ tableId, venueId }) => tableId === activeTable.id && venueId === activeVenueId)
      setRuntime((current) => {
        const membership = hasPlan && stage === "completed" ? "TMB-COMPLETED" : hasPlan && stage === "checked_in" ? "TMB-CHECKED-IN" : hasPlan ? "TMB-CONFIRMED" : current.membership === "TMB-LEFT" ? "TMB-LEFT" : "TMB-NONE"
        const next = reduceTableRuntime(current, { type: "RESTORE_MEMBERSHIP", membership })
        runtimeRef.current = next
        return next
      })
      setFeedback(savedFeedback)
      setFeedbackSaved(Boolean(savedFeedback))
      setReportReceipt(receipt)
      setBlocked(receipt?.participantBlocked ?? false)
    }
    restoreActivity()
    window.addEventListener(B_TABLE_ACTIVITY_CLEAR_EVENT, restoreActivity)
    return () => window.removeEventListener(B_TABLE_ACTIVITY_CLEAR_EVENT, restoreActivity)
  }, [activeTable.id, activeVenueId, state.plannedTableRefs])

  useEffect(() => {
    if (tableSheetPresence.phase !== "open") return
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus({ preventScroll: true }))
    return () => window.cancelAnimationFrame(frame)
  }, [tableSheetPresence.phase, tableSheetPresence.value])

  useEffect(() => {
    if (tableSheetPresence.value !== null || !restoreFocusAfterExitRef.current) return
    restoreFocusAfterExitRef.current = false
    const returnTarget = returnFocusRef.current
    returnFocusRef.current = null
    tableExitVisualSnapshotRef.current = null
    let cancelFallback = () => {}
    const frame = window.requestAnimationFrame(() => {
      if (selectedRef.current) return
      if (returnTarget?.isConnected && isRenderedFocusable(returnTarget)) {
        returnTarget.focus({ preventScroll: true })
        return
      }
      cancelFallback = focusFirstAvailableDestination([
        `[data-testid='table-open-${activeTable.id}']`,
        "[data-testid='tables-entry']",
      ])
    })
    return () => { window.cancelAnimationFrame(frame); cancelFallback() }
  }, [activeTable.id, tableSheetPresence.value])

  useEffect(() => {
    if (tableSheetPresence.value === null) return
    const viewport = window.visualViewport
    const syncVisualViewport = () => {
      const height = viewport?.height ?? window.innerHeight
      const top = viewport?.offsetTop ?? 0
      const keyboardInset = Math.max(0, window.innerHeight - height - top)
      layerRef.current?.style.setProperty("--table-viewport-height", `${height}px`)
      layerRef.current?.style.setProperty("--table-viewport-top", `${top}px`)
      layerRef.current?.style.setProperty("--table-keyboard-inset", `${keyboardInset}px`)
      if (document.activeElement instanceof HTMLTextAreaElement && detailRef.current?.contains(document.activeElement)) {
        document.activeElement.scrollIntoView({ block: "nearest" })
      }
    }
    syncVisualViewport()
    viewport?.addEventListener("resize", syncVisualViewport)
    viewport?.addEventListener("scroll", syncVisualViewport)
    window.addEventListener("resize", syncVisualViewport)
    return () => {
      viewport?.removeEventListener("resize", syncVisualViewport)
      viewport?.removeEventListener("scroll", syncVisualViewport)
      window.removeEventListener("resize", syncVisualViewport)
    }
  }, [tableSheetPresence.value])

  useEffect(() => {
    if (tableSheetPresence.value === null || safetyOpen) return
    function closeDetailOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return
      if (document.querySelector("[data-testid='ondo-b-action-gate']")) return
      const profileDecision = document.querySelector<HTMLElement>("[data-testid='profile-discard-prompt']")
      if (profileDecision && !profileDecision.closest("[inert],[aria-hidden='true']")) return
      if (layerRef.current?.closest("[inert],[aria-hidden='true']")) return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (tableClosing) return
      closeTable()
    }
    window.addEventListener("keydown", closeDetailOnEscape, true)
    return () => window.removeEventListener("keydown", closeDetailOnEscape, true)
  }, [safetyOpen, tableClosing, tableSheetPresence.value])

  if (!placeContext) return <section className={styles.entry} data-testid="tables-entry" role="alert">{t.venueUnavailable}</section>

  function prepareTableOpen() {
    restoreFocusAfterExitRef.current = false
    if (!selectedRef.current && layerRef.current?.isConnected) {
      profileHostExitGuardRef.current?.resumeAfterInterruptedExit()
    }
    if (layerRef.current?.isConnected) return
    const active = document.activeElement
    returnFocusRef.current = active instanceof HTMLElement && active !== document.body
      ? active
      : openerRef.current
  }

  function abandonCurrentPendingBeforeOpen() {
    const pending = returnToRef.current
    if (!pending) return true
    if (!abandonPendingBAction(window.sessionStorage, pending, new Date(), actionGateSessionOptions())) {
      setClosePersistError(true)
      setJoinPersistError(true)
      return false
    }
    returnToRef.current = null
    return true
  }

  function resetTableEphemeralState(nextTable: OndoBTable | null, nextDraft = "") {
    invalidateTableAsyncWork()
    releaseTableObjectUrls()
    const storedReport = nextTable ? readBTableReport(window.sessionStorage, nextTable.id) : null
    const storedFeedback = nextTable ? readBTableFeedback(window.sessionStorage, nextTable.id) : null

    setDraft(nextDraft)
    returnToRef.current = null
    setReturnTo(null)
    setTableView("detail")
    setJoinRequestPending(false)
    setChatLockedNotice(false)
    setClosePersistError(false)
    setDetailImageFailed(false)
    setChatImageFailed(false)
    setFailedMessageImages(new Set())
    setReportOpen(false)
    setReportReason(null)
    setReportBlock(false)
    setReportReceipt(storedReport)
    setBlockOpen(false)
    setBlocked(storedReport?.participantBlocked ?? false)
    setLeaveOpen(false)
    setJoinPersistError(false)
    setLeavePersistError(false)
    setCompose("")
    setChatImage(null)
    setChatImageError(null)
    setMessages([])
    setArrivalChecking(false)
    setFeedback(storedFeedback)
    setFeedbackSaved(Boolean(storedFeedback))
    setActivityPersistError(false)
    setReportPersistError(false)
    if (imageInputRef.current) imageInputRef.current.value = ""
  }

  function openTable(table: OndoBTable) {
    const hasPlan = state.plannedTableRefs.some(({ tableId, venueId }) => tableId === table.id && venueId === table.venueId)
    const selectedTimeline = ondoBTableTimeline(table, productTimeline, locale)
    const nextRuntime = initialTableRuntime(
      { ...table, availability: reviewAvailability(table, tableClockNow < selectedTimeline.startsAtMs) },
      hasPlan ? "confirmed" : "none",
    )
    if (!abandonCurrentPendingBeforeOpen()) return
    prepareTableOpen()
    resetTableEphemeralState(table)
    activeTableRef.current = table
    runtimeRef.current = nextRuntime
    setActiveTableId(table.id)
    setRuntime(nextRuntime)
    selectedRef.current = true
    setSelected(true)
  }

  function closeTable() {
    if (tableClosing) return
    const profileGuard = profileHostExitGuardRef.current
    if (profileGuard) {
      profileGuard.requestExit(commitCloseTable)
      return
    }
    commitCloseTable()
  }

  function commitCloseTable(): boolean {
    // `returnTo` is the frozen authority envelope for the exact confirmation
    // visible in this sheet. A same-Table journal entry is not interchangeable:
    // abandon only when the complete durable envelope is still identical.
    const pending = returnTo
    if (pending) {
      const abandoned = abandonPendingBAction(window.sessionStorage, pending, new Date(), actionGateSessionOptions())
      if (!abandoned) {
        setClosePersistError(true)
        setJoinPersistError(true)
        return false
      }
    }
    resetTableEphemeralState(null)
    restoreFocusAfterExitRef.current = true
    selectedRef.current = false
    setSelected(false)
    return true
  }

  function continueFromTable(nextAction: () => void) {
    if (tableClosing) return
    const exit = () => {
      if (!commitCloseTable()) return false
      restoreFocusAfterExitRef.current = false
      window.requestAnimationFrame(nextAction)
      return true
    }
    const profileGuard = profileHostExitGuardRef.current
    if (profileGuard) profileGuard.requestExit(exit)
    else exit()
  }

  function returnToTablePlace() {
    const venueId = activeTableRef.current.venueId
    if (!resolveCommercePlaceB(venueId)) return
    continueFromTable(() => {
      actions.setTab("ondo")
      window.requestAnimationFrame(() => requestPlaceServiceReturnB(venueId, "table"))
    })
  }

  function reserveTablePlace() {
    const venueId = activeTableRef.current.venueId
    if (!resolveCommercePlaceB(venueId)?.reservation) return
    continueFromTable(() => requestReservationSampleB({ venueId }))
  }

  function beginJoin() {
    if (expireJoinAtMutation(null)) return
    if (runtimeRef.current.availability !== "TAV-OPEN" || joinRequestPending) return
    if (runtimeRef.current.membership === "TMB-FAILED" && returnTo && (runtimeRef.current.failure === "TFR-NETWORK" || runtimeRef.current.failure === "TFR-POLICY")) {
      confirmJoin()
      return
    }
    requestBActionGate(createBTableActionReturn({ tableId: activeTable.id, venueId: activeVenueId, draft }), actionGateSessionOptions())
  }

  function confirmJoin() {
    const pending = returnTo
    if (joinRequestPending || joinTimerRef.current != null || expireJoinAtMutation(pending)) return
    if (!pending || runtimeRef.current.availability !== "TAV-OPEN") {
      setJoinPersistError(true)
      return
    }
    setJoinPersistError(false)
    setClosePersistError(false)
    setTableView("detail")
    const requested = reduceTableRuntime(runtimeRef.current, { type: "REQUEST_JOIN" })
    if (requested.membership !== "TMB-REQUESTING") {
      setJoinPersistError(true)
      return
    }
    runtimeRef.current = requested
    setRuntime(requested)
    setJoinRequestPending(true)
    const operationEpoch = tableInteractionEpochRef.current
    const joinTimer = window.setTimeout(() => {
      if (joinTimerRef.current !== joinTimer) return
      joinTimerRef.current = null
      if (operationEpoch !== tableInteractionEpochRef.current
        || !selectedRef.current
        || activeTableRef.current.id !== pending.tableId
        || activeTableRef.current.venueId !== pending.venueId) return
      setJoinRequestPending(false)
      if (expireJoinAtMutation(pending)) return

      const fixture = publicSample && sampleJoin !== "success" ? sampleJoin : readQaRuntime<TablesQaRuntime>()?.tableJoin
      const oneShotFailure = fixture && !failedJoinOnceRef.current ? fixture : null
      if (oneShotFailure) failedJoinOnceRef.current = true
      if (oneShotFailure === "cancelled") {
        transitionRuntime({ type: "ORGANIZER_CANCELLED" })
        if (abandonPendingBAction(window.sessionStorage, pending, new Date(), actionGateSessionOptions())) {
          returnToRef.current = null
          setReturnTo(null)
        } else setClosePersistError(true)
        return
      }
      if (oneShotFailure === "network" || oneShotFailure === "policy" || oneShotFailure === "full") {
        transitionRuntime({ type: "JOIN_FAILED", reason: oneShotFailure })
        if (oneShotFailure === "full") {
          if (abandonPendingBAction(window.sessionStorage, pending, new Date(), actionGateSessionOptions())) {
            returnToRef.current = null
            setReturnTo(null)
          } else setClosePersistError(true)
        }
        return
      }

      const targetTable = ondoBTableById(pending.tableId)
      if (!targetTable || targetTable.venueId !== pending.venueId) {
        transitionRuntime({ type: "JOIN_FAILED", reason: "policy" })
        setJoinPersistError(true)
        return
      }
      const actionSession = restoreBActionGateSession(window.sessionStorage, new Date(), actionGateSessionOptions())
      const satisfied = new Set<"account" | "person" | "age">()
      if (state.account === "ACC-ACTIVE") satisfied.add("account")
      if (actionSession.person.status === "eligible" && actionSession.person.expiresAt && Date.parse(actionSession.person.expiresAt) > Date.now()) satisfied.add("person")
      const age = restoreGlobalAfter19B(
        window.localStorage,
        window.sessionStorage,
        new Date(),
        qaReviewFixtureOptions(),
      ).session
      if (isGlobalAfter19AgeCurrent(age)) satisfied.add("age")
      const consumed = consumePendingBActionAtMutation(window.sessionStorage, pending, satisfied, new Date(), { ...actionGateSessionOptions(), credential: credentialRef.current })
      if (!consumed) {
        transitionRuntime({ type: "JOIN_FAILED", reason: "network" })
        setJoinPersistError(true)
        return
      }
      const finalized = finalizeConsumedBActionWithMutation(
        window.sessionStorage,
        consumed,
        () => actions.recordPlannedTable(targetTable.id, targetTable.venueId),
        new Date(),
        actionGateSessionOptions(),
      )
      if (!finalized) {
        transitionRuntime({ type: "JOIN_FAILED", reason: "network" })
        setJoinPersistError(true)
        return
      }
      transitionRuntime({ type: "JOIN_CONFIRMED" })
      setJoinPersistError(false)
      returnToRef.current = null
      setReturnTo(null)
      window.dispatchEvent(new CustomEvent(B_ACTION_GATE_COMPLETE_EVENT, { detail: consumed }))
      window.requestAnimationFrame(() => focusFirstAvailableDestination(["[data-testid='table-open-chat']"]))
    }, TABLE_JOIN_SETTLE_DELAY_MS)
    joinTimerRef.current = joinTimer
  }

  function saveFeedback() {
    if (!feedback || runtimeRef.current.membership !== "TMB-COMPLETED" || runtimeRef.current.chatAccess !== "CHA-OPEN") return
    const result = activityActions.recordActivityAxes(
      `activity:table:${activeTable.id}:feedback`,
      ["meetup", "contribution"],
      () => writeBTableFeedback(window.sessionStorage, activeTable.id, feedback),
    )
    const saved = result === "accepted" || result === "duplicate"
    setActivityPersistError(!saved)
    if (saved) setFeedbackSaved(true)
  }

  function markArrival() {
    if (arrivalChecking || runtimeRef.current.membership !== "TMB-CONFIRMED" || runtimeRef.current.chatAccess !== "CHA-OPEN") return
    clearActivityTimers()
    setActivityPersistError(false)
    setArrivalChecking(true)
    const operationEpoch = tableInteractionEpochRef.current
    const targetTable = activeTableRef.current
    const arrivalTimer = window.setTimeout(() => {
      if (arrivalTimerRef.current !== arrivalTimer) return
      arrivalTimerRef.current = null
      if (operationEpoch !== tableInteractionEpochRef.current
        || !selectedRef.current
        || activeTableRef.current.id !== targetTable.id
        || activeTableRef.current.venueId !== targetTable.venueId) return
      const evidenceId = bTableCheckInFixtureEvidenceId(targetTable.id, targetTable.venueId)
      const result = evidenceId ? activityActions.recordActivityAxes(
        evidenceId,
        ["visit"],
        () => writeBTableActivity(window.sessionStorage, targetTable.id, "checked_in"),
      ) : "invalid"
      const saved = result === "accepted" || result === "duplicate"
      setArrivalChecking(false)
      setActivityPersistError(!saved)
      if (!saved) return
      transitionRuntime({ type: "CHECK_IN" })
      const completionTimer = window.setTimeout(() => {
        if (completionTimerRef.current !== completionTimer) return
        completionTimerRef.current = null
        completeTable(targetTable, operationEpoch)
      }, TABLE_COMPLETION_EVENT_DELAY_MS)
      completionTimerRef.current = completionTimer
    }, TABLE_ARRIVAL_SETTLE_DELAY_MS)
    arrivalTimerRef.current = arrivalTimer
  }

  function completeTable(targetTable = activeTableRef.current, operationEpoch = tableInteractionEpochRef.current) {
    if (operationEpoch !== tableInteractionEpochRef.current
      || !selectedRef.current
      || activeTableRef.current.id !== targetTable.id
      || activeTableRef.current.venueId !== targetTable.venueId) return
    if (runtimeRef.current.membership !== "TMB-CHECKED-IN") return
    const completed = writeBTableActivity(window.sessionStorage, targetTable.id, "completed")
    setActivityPersistError(!completed)
    if (completed) transitionRuntime({ type: "COMPLETE" })
  }

  function retryActivity() {
    setActivityPersistError(false)
    if (tableCompleted) {
      saveFeedback()
      return
    }
    if (checkedIn) {
      completeTable()
      return
    }
    markArrival()
  }

  function openChat() {
    if (runtimeRef.current.chatAccess !== "CHA-OPEN" || !isConfirmedMembership(runtimeRef.current)) {
      setTableView("detail")
      setChatLockedNotice(true)
      window.requestAnimationFrame(() => focusFirstAvailableDestination(["[data-testid='table-join']", "[data-testid='table-other-tables']"]))
      return
    }
    setChatLockedNotice(false)
    setTableView("chat")
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => detailRef.current?.querySelector<HTMLElement>("[data-testid='table-chat']")?.scrollIntoView({ block: "start" }))
    })
  }

  function confirmLeave() {
    if (!isConfirmedMembership(runtimeRef.current)) {
      setLeaveOpen(false)
      setTableView("detail")
      setChatLockedNotice(true)
      return
    }
    let activitySnapshot: string | null
    try {
      activitySnapshot = window.sessionStorage.getItem(B_TABLE_ACTIVITY_SESSION_KEY)
    } catch {
      setLeavePersistError(true)
      return
    }
    if (!clearBTableActivity(window.sessionStorage, activeTable.id)) {
      setLeavePersistError(true)
      return
    }
    const removed = actions.removePlannedTable(activeTable.id)
    if (!removed) {
      restoreBTableActivitySnapshot(window.sessionStorage, activitySnapshot)
      setLeavePersistError(true)
      return
    }
    setLeavePersistError(false)
    resetTableEphemeralState(null)
    transitionRuntime({ type: "LEAVE" })
    focusFirstAvailableDestination(["[data-testid='table-detail'] [data-testid='table-join']"])
  }

  function restoreSafetyFocus(ref: typeof reportButtonRef) {
    window.requestAnimationFrame(() => ref.current?.focus({ preventScroll: true }))
  }

  function openReport() {
    setReportPersistError(false)
    setReportReason(null)
    setReportBlock(false)
    setReportOpen(true)
  }

  function confirmReport() {
    if (!reportReason) return
    const receipt = { reason: reportReason, participantBlocked: reportBlock }
    if (!writeBTableReport(window.sessionStorage, activeTable.id, receipt)) {
      setReportPersistError(true)
      return
    }
    setReportPersistError(false)
    setReportReceipt(receipt)
    if (reportBlock) setBlocked(true)
    setReportOpen(false)
    setReportReason(null)
    setReportBlock(false)
    restoreSafetyFocus(reportButtonRef)
  }

  function cancelReport() { setReportOpen(false); setReportReason(null); setReportBlock(false); setReportPersistError(false); restoreSafetyFocus(reportButtonRef) }
  function undoBlock() {
    if (reportReceipt?.participantBlocked) {
      const receipt = { ...reportReceipt, participantBlocked: false }
      if (!writeBTableReport(window.sessionStorage, activeTable.id, receipt)) {
        setReportPersistError(true)
        return
      }
      setReportPersistError(false)
      setReportReceipt(receipt)
    }
    setBlocked(false)
    restoreSafetyFocus(blockButtonRef)
  }
  function cancelBlock() { setBlockOpen(false); restoreSafetyFocus(blockButtonRef) }
  function cancelLeave() { setLeaveOpen(false); setLeavePersistError(false); restoreSafetyFocus(leaveButtonRef) }

  function chooseImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    if (!TABLE_CHAT_IMAGE_TYPES.has(file.type)) {
      setChatImageError(t.photoTypeError)
      event.target.value = ""
      return
    }
    if (file.size > MAX_TABLE_CHAT_IMAGE_BYTES) {
      setChatImageError(t.photoSizeError)
      event.target.value = ""
      return
    }
    if (chatImage) {
      URL.revokeObjectURL(chatImage)
      objectUrlsRef.current.delete(chatImage)
    }
    const url = URL.createObjectURL(file)
    objectUrlsRef.current.add(url)
    setChatImage(url)
    setChatImageFailed(false)
    setChatImageError(null)
    event.target.value = ""
  }

  function removeChatImage() {
    if (chatImage) {
      URL.revokeObjectURL(chatImage)
      objectUrlsRef.current.delete(chatImage)
    }
    setChatImage(null)
    setChatImageFailed(false)
    setChatImageError(null)
  }

  function clearMessageTimers() {
    for (const timer of messageTimersRef.current.values()) window.clearTimeout(timer)
    messageTimersRef.current.clear()
  }

  function clearActivityTimers() {
    if (arrivalTimerRef.current != null) window.clearTimeout(arrivalTimerRef.current)
    if (completionTimerRef.current != null) window.clearTimeout(completionTimerRef.current)
    arrivalTimerRef.current = null
    completionTimerRef.current = null
  }

  function invalidateTableAsyncWork() {
    tableInteractionEpochRef.current += 1
    if (joinTimerRef.current != null) window.clearTimeout(joinTimerRef.current)
    joinTimerRef.current = null
    clearMessageTimers()
    clearActivityTimers()
  }

  function releaseTableObjectUrls() {
    for (const url of objectUrlsRef.current) URL.revokeObjectURL(url)
    objectUrlsRef.current.clear()
  }

  function settleMessage(id: number, nextState: Exclude<MessageState, "sending">) {
    const previousTimer = messageTimersRef.current.get(id)
    if (previousTimer != null) window.clearTimeout(previousTimer)
    const operationEpoch = tableInteractionEpochRef.current
    const tableId = activeTableRef.current.id
    const timer = window.setTimeout(() => {
      if (messageTimersRef.current.get(id) !== timer) return
      messageTimersRef.current.delete(id)
      if (operationEpoch !== tableInteractionEpochRef.current || !selectedRef.current || activeTableRef.current.id !== tableId) return
      setMessages((current) => current.map((message) => message.id === id && message.state === "sending" ? { ...message, state: nextState } : message))
    }, TABLE_MESSAGE_SETTLE_DELAY_MS)
    messageTimersRef.current.set(id, timer)
  }

  function sendMessage() {
    if (runtimeRef.current.chatAccess !== "CHA-OPEN" || !isConfirmedMembership(runtimeRef.current)) {
      setTableView("detail")
      setChatLockedNotice(true)
      return
    }
    if (!compose.trim() && (!chatImage || chatImageFailed)) return
    const shouldFail = ((publicSample && sampleMessage) || readQaRuntime<TablesQaRuntime>()?.tableMessage === "failure") && !failedMessageOnceRef.current
    if (shouldFail) failedMessageOnceRef.current = true
    const id = ++nextMessageIdRef.current
    setMessages((current) => [...current, { id, text: compose.trim(), imageUrl: chatImage, state: "sending" }])
    setCompose(""); setChatImage(null); setChatImageFailed(false)
    settleMessage(id, shouldFail ? "failed" : "sent")
  }

  function retryMessage(id: number) {
    if (runtimeRef.current.chatAccess !== "CHA-OPEN" || !isConfirmedMembership(runtimeRef.current)) return
    setMessages((current) => current.map((message) => message.id === id && message.state === "failed" ? { ...message, state: "sending" } : message))
    settleMessage(id, "sent")
  }

  function removeFailedMessageImage(id: number) {
    setMessages((current) => current.map((message) => message.id === id && message.state === "failed" ? { ...message, imageUrl: null } : message))
    setFailedMessageImages((current) => {
      const next = new Set(current)
      next.delete(id)
      return next
    })
  }

  function handleDetailKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (tableClosing) { event.preventDefault(); event.stopPropagation(); return }
    if (document.querySelector("[data-testid='ondo-b-action-gate']")) return
    const profileDecision = detailRef.current?.querySelector<HTMLElement>("[data-testid='profile-discard-prompt']")
    if (profileDecision && !profileDecision.closest("[inert],[aria-hidden='true']")) return
    if (event.key === "Escape" && safetyOpen) {
      event.preventDefault()
      if (reportOpen) cancelReport()
      else if (blockOpen) cancelBlock()
      else cancelLeave()
      return
    }
    if (event.key === "Escape") { event.preventDefault(); closeTable(); return }
    if (event.key !== "Tab") return
    const focusable = Array.from(detailRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(isRenderedFocusable)
    const first = focusable[0]
    const last = focusable.at(-1)
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  const canRequestSeat = runtime.availability === "TAV-OPEN" && !joinRequestPending
  const canRetryJoin = runtime.membership === "TMB-FAILED" && (runtime.failure === "TFR-NETWORK" || runtime.failure === "TFR-POLICY") && Boolean(returnTo)
  const mustChooseAnotherTable = runtime.availability === "TAV-FULL" || runtime.availability === "TAV-CLOSED" || runtime.availability === "TAV-CANCELLED"
  const currentTableStatus = runtimeStatusCopy(runtime, t)
  const activePlanValues = tablePlanValues(activeTable, locale, t)

  return (
    <section className={styles.entry} data-testid="tables-entry" data-page-typography="root" data-visual-direction="timeleft-warm-atlas">
      <header className={styles.entryHeader} data-page-title-frame>
        <p>{isUpcoming ? t.eyebrow : t.pastEyebrow}</p><h1 data-page-title>{t.title}</h1><span>{t.intro}</span>
      </header>

      {publicSample && <button type="button" className={styles.reservationEntry} data-testid="tables-reservation-open" onClick={() => requestReservationSampleB()}><CalendarClock size={20} aria-hidden="true" /><span><strong>{locale === "ko" ? "매장 예약" : locale === "ja" ? "席を予約" : "Book a restaurant"}</strong><small>{locale === "ko" ? "서울 · 부산 · 제주 · 샘플" : locale === "ja" ? "ソウル・釜山・済州・サンプル" : "Seoul · Busan · Jeju · Sample"}</small></span><ChevronRight size={18} aria-hidden="true" /></button>}

      {publicSample && reservationHistory.length > 0 ? <section className={styles.reservationHistory} aria-label={reservationCopy.history} data-testid="tables-reservation-history">
        <h2>{reservationCopy.history}</h2>
        {reservationHistory.map(record => <button type="button" key={record.draft.venueId} className={styles.reservationEntry} data-testid={`reservation-history-${record.draft.venueId}`} data-venue-id={record.draft.venueId} data-operation-id={record.operationId ?? ""} onClick={() => requestReservationSampleB({ venueId: record.draft.venueId! })}>
          <CalendarClock size={20} aria-hidden="true" /><span><strong>{record.draft.venueName?.[locale]}</strong><small>{record.draft.date} · {record.draft.time} KST · {record.draft.party} {reservationCopy.party}</small><small>{record.phase === "draft" ? reservationCopy.restore : reservationCopy[record.phase]}</small></span><ChevronRight size={18} aria-hidden="true" />
        </button>)}
      </section> : null}

      <figure className={styles.editorialBand} data-testid="tables-editorial-image">
        {editorialImageFailed
          ? <div className={styles.mediaFallback} data-testid="tables-editorial-image-fallback"><ImageOff size={22} aria-hidden="true" /><span>{t.imageUnavailable}</span></div>
          : <img src="/editorial/people/ondo-tables-dinner-v2-landscape.jpg" alt={TABLE_EDITORIAL[socialLocale].alt} aria-describedby="tables-editorial-provenance" onError={() => setEditorialImageFailed(true)} />}
        <figcaption id="tables-editorial-provenance">{TABLE_EDITORIAL[socialLocale].caption}</figcaption>
      </figure>

      <div className={styles.cards}>
        {ONDO_B_TABLES.map((table) => {
          const cardPlace = resolveTablePlaceContext(table, locale)
          if (!cardPlace) return null
          const cardTimeline = ondoBTableTimeline(table, productTimeline, locale)
          const cardUpcoming = tableClockNow < cardTimeline.startsAtMs
          const planned = state.plannedTableRefs.some(({ tableId, venueId }) => tableId === table.id && venueId === table.venueId)
          const cardRuntime = table.id === activeTable.id
            ? runtime
            : initialTableRuntime({ ...table, availability: reviewAvailability(table, cardUpcoming) }, planned ? "confirmed" : "none")
          const cardStatus = runtimeStatusCopy(cardRuntime, t)
          const planValues = tablePlanValues(table, locale, t)
          return <article key={table.id} className={styles.cardActive} data-testid={`table-card-${table.id}`} data-table-state={cardUpcoming ? "TABLE-OPEN" : "TABLE-CLOSED"} data-table-availability={cardRuntime.availability} data-table-membership={cardRuntime.membership} data-table-failure={cardRuntime.failure} data-chat-access={cardRuntime.chatAccess} data-place-kind={cardPlace.kind}>
            <div className={styles.cardTop}><span>{cardStatus}</span><ClipboardList size={18} aria-hidden="true" /></div>
            <figure className={styles.cardMedia} data-testid="table-card-image">
              {listImageFailedIds.has(table.id)
                ? <div className={styles.mediaFallback} data-testid="table-card-image-fallback"><ImageOff size={22} aria-hidden="true" /><span>{t.imageUnavailable}</span></div>
                : <img src={table.presentation.imageSrc} alt={table.presentation.imageAlt[locale]} onError={() => setListImageFailedIds((current) => new Set(current).add(table.id))} />}
              {table.presentation.imageCaption ? <figcaption>{table.presentation.imageCaption[locale]}</figcaption> : null}
            </figure>
            <h2>{table.presentation.title[locale]}</h2>
            <p className={styles.cardPlaceName}><MapPin size={15} aria-hidden="true" />{cardPlace.name}</p>
            <PlaceContext venueName={cardPlace.name} sourceName={cardPlace.sourceName} district={cardPlace.district} kind={cardPlace.kind} copy={t} />
            <PlanFields copy={t} values={planValues} schedule={cardTimeline.schedule} context="card" />
            <button type="button" className={styles.openButton} data-testid={`table-open-${table.id}`} onClick={() => openTable(table)}>{t.open}<ChevronRight size={17} aria-hidden="true" /></button>
          </article>
        })}
      </div>

      {tableSheetPresence.value !== null ? (<>
        <div ref={layerRef} className={styles.layer} role="dialog" aria-modal="true" aria-labelledby="table-b-title" aria-busy={tableClosing ? "true" : undefined} data-testid="table-detail" data-ondo-layer="detail" data-modal-layer-priority={ONDO_MODAL_PRIORITY.detail} data-table-subject={tableSheetPresence.value} data-table-presence={tableSheetPresence.phase} data-table-id={activeTable.id} data-venue-id={activeVenueId} data-join-stage={joinStage} data-table-availability={runtime.availability} data-table-membership={runtime.membership} data-table-failure={runtime.failure} data-chat-access={runtime.chatAccess}
          onClickCapture={(event) => { if (tableClosing) { event.preventDefault(); event.stopPropagation(); event.nativeEvent.stopImmediatePropagation() } }}
          onPointerDownCapture={(event) => { if (tableClosing) { event.preventDefault(); event.stopPropagation(); event.nativeEvent.stopImmediatePropagation() } }}
          onKeyDownCapture={(event) => { if (tableClosing) { event.preventDefault(); event.stopPropagation(); event.nativeEvent.stopImmediatePropagation() } }}>
          <button type="button" className={styles.backdrop} tabIndex={-1} aria-hidden="true" disabled={safetyOpen || tableClosing} onClick={closeTable} />
          {(() => {
            const liveTableSurface = <article ref={detailRef} className={styles.detail} data-join-stage={joinStage} data-table-availability={runtime.availability} data-table-membership={runtime.membership} data-table-failure={runtime.failure} data-chat-access={runtime.chatAccess} onKeyDown={handleDetailKeyDown}>
            <header className={styles.detailHeader}>
              <button ref={closeRef} type="button" onClick={closeTable} aria-label={t.close}><ArrowLeft size={18} aria-hidden="true" /></button>
              <span>{t.tableHeader}</span>
              <span aria-hidden="true" />
            </header>
            <div className={styles.detailBody}>
              <p className={styles.detailEyebrow}>{district} · {currentTableStatus}</p>
              <h2 id="table-b-title">{activeTable.presentation.title[locale]}</h2>
              {publicSample && <details className={styles.sampleCases}><summary>{locale === "ko" ? "샘플 상황 선택" : locale === "ja" ? "サンプルケース" : "Sample scenarios"}</summary>
                <label>{locale === "ko" ? "계획 저장" : locale === "ja" ? "プランを保存" : "Save plan"}<select data-testid="table-sample-join" value={sampleJoin} disabled={joinRequestPending || Boolean(returnTo) || isConfirmedMembership(runtime)} onChange={event => { setSampleJoin(event.target.value as typeof sampleJoin); failedJoinOnceRef.current = false; transitionRuntime({ type: "AVAILABILITY_CHANGED", availability: reviewAvailability(activeTable, isUpcoming) }) }}>
                  <option value="success">{locale === "ko" ? "정상" : locale === "ja" ? "正常" : "Success"}</option><option value="network">{locale === "ko" ? "응답 실패" : locale === "ja" ? "応答失敗" : "Network failure"}</option><option value="full">{locale === "ko" ? "만석" : locale === "ja" ? "満席" : "Full"}</option><option value="cancelled">{locale === "ko" ? "주최자 취소" : locale === "ja" ? "主催者が中止" : "Organizer cancelled"}</option><option value="policy">{locale === "ko" ? "조건 변경" : locale === "ja" ? "条件変更" : "Policy changed"}</option>
                </select></label>
                <label>{locale === "ko" ? "메모 응답" : locale === "ja" ? "メモの応答" : "Note response"}<select data-testid="table-sample-message" value={sampleMessage ? "failure" : "success"} onChange={event => { setSampleMessage(event.target.value === "failure"); failedMessageOnceRef.current = false }}><option value="success">{locale === "ko" ? "정상" : locale === "ja" ? "正常" : "Success"}</option><option value="failure">{locale === "ko" ? "첫 응답 실패" : locale === "ja" ? "最初の応答が失敗" : "Fail first response"}</option></select></label>
              </details>}
              <figure className={styles.detailMedia} data-testid="table-detail-image">
                {detailImageFailed
                  ? <div className={styles.mediaFallback} data-testid="table-detail-image-fallback"><ImageOff size={22} aria-hidden="true" /><span>{t.imageUnavailable}</span></div>
                  : <img src={activeTable.presentation.imageSrc} alt={activeTable.presentation.imageAlt[locale]} onError={() => setDetailImageFailed(true)} />}
                {activeTable.presentation.imageCaption ? <figcaption>{activeTable.presentation.imageCaption[locale]}</figcaption> : null}
              </figure>
              <PlaceContext venueName={placeContext.name} sourceName={placeContext.sourceName} district={district} kind={placeContext.kind} copy={t} />
              <PlanFields copy={t} values={activePlanValues} schedule={activeTableTimeline.schedule} context="detail" />
              {activeTable.alcohol ? <aside className={styles.ageNotice}><ShieldCheck size={18} aria-hidden="true" /><span>{t.ageNotice}</span></aside> : null}

              {closePersistError ? <p className={styles.persistError} data-testid="table-close-save-error" role="alert"><AlertTriangle size={16} aria-hidden="true" />{t.closeSaveFailed}<button type="button" onClick={closeTable}>{t.retry}</button></p> : null}
              {chatLockedNotice ? <p className={styles.lockedStatus} data-testid="table-chat-locked" role="status"><ShieldCheck size={17} aria-hidden="true" />{t.chatLocked}</p> : null}

              {joinStage === "idle" ? <section className={styles.joinPanel}>
                <p className={styles.bookingTruth}><ClipboardList size={17} aria-hidden="true" />{t.bookingTruth}</p>
                <label htmlFor="table-join-draft">{t.draftLabel}</label>
                <textarea id="table-join-draft" data-testid="table-join-draft" maxLength={280} value={draft} placeholder={t.draftHint} disabled={!canRequestSeat || runtime.membership === "TMB-REQUESTING"} onChange={(event) => setDraft(event.target.value)} />
                <details className={styles.tablePrivacy} data-testid="tables-truth-notice"><summary>{t.privacy}</summary><p>{t.truth}</p></details>
                {(runtime.membership === "TMB-REQUESTING" || runtime.membership === "TMB-FAILED" || mustChooseAnotherTable) ? <p className={styles.runtimeStatus} data-testid="table-join-recovery" role={runtime.membership === "TMB-REQUESTING" ? "status" : "alert"} aria-live="polite"><span aria-hidden="true" />{currentTableStatus}</p> : null}
                <button type="button" className={styles.primary} data-testid="table-join" disabled={!canRequestSeat || runtime.membership === "TMB-REQUESTING" || mustChooseAnotherTable} aria-busy={joinRequestPending} onClick={beginJoin}>{joinRequestPending ? t.joinRequesting : canRetryJoin ? t.retryJoin : t.join}</button>
                {mustChooseAnotherTable ? <button type="button" className={styles.secondary} data-testid="table-other-tables" onClick={closeTable}>{t.otherTables}</button> : null}
              </section> : null}

              {joinStage === "confirm" && returnTo ? <section className={styles.confirmation} data-testid="table-join-confirmation" data-return-table={returnTo.tableId} data-return-venue={returnTo.venueId}>
                <Check size={24} aria-hidden="true" /><h3>{t.confirmTitle}</h3><p>{t.returnTitle}</p>
                {draft ? <blockquote data-testid="after19-return">{draft}</blockquote> : null}
                {joinPersistError ? <p className={styles.persistError} data-testid="table-join-save-error" role="alert"><AlertTriangle size={16} aria-hidden="true" />{t.joinSaveFailed}</p> : null}
                <button type="button" className={styles.primary} data-testid="table-join-confirm" disabled={joinRequestPending} aria-busy={joinRequestPending} onClick={confirmJoin}>{joinRequestPending ? t.joinRequesting : t.confirm}</button>
              </section> : null}

              {joinStage === "joined" ? <section className={styles.joined}>
                <UsersRound size={25} aria-hidden="true" /><h3>{t.joinedTitle}</h3><p>{t.joinedBody}</p>
                <button type="button" className={styles.primary} data-testid="table-open-chat" onClick={openChat}><MessageCircle size={17} aria-hidden="true" />{t.openChat}</button>
              </section> : null}

              {joinStage === "chat" ? <section className={styles.chat} data-testid="table-chat">
                <header><span><UsersRound size={18} aria-hidden="true" />{t.chatTitle}</span></header>
                <div className={styles.messages}>
                  <p><strong>{t.planNote}</strong><span>{t.minMessage}</span></p>
                  {!blocked ? <p><strong>{t.languageNote}</strong><span>{t.jaeMessage}</span></p> : null}
                  {messages.map((message) => <article key={message.id} className={styles.myMessage} data-testid="table-message" data-state={message.state} aria-busy={message.state === "sending"}>
                    <strong>{t.you}</strong>
                    {message.imageUrl ? failedMessageImages.has(message.id)
                      ? <div className={styles.mediaFallback} data-testid="table-message-image-fallback"><ImageOff size={19} aria-hidden="true" /><span>{t.imageUnavailable}</span></div>
                      : <img src={message.imageUrl} alt={t.messagePhotoAlt} onError={() => setFailedMessageImages((current) => new Set(current).add(message.id))} /> : null}
                    {message.text ? <span>{message.text}</span> : null}
                    {message.state === "sending" ? <span className={styles.messageState} data-testid="table-message-status" role="status" aria-live="polite" aria-atomic="true"><span className={styles.messageSpinner} aria-hidden="true" />{t.addingHere}</span> : null}
                    {message.state === "sent" ? <span className={styles.messageState} data-testid="table-message-status" role="status" aria-live="polite" aria-atomic="true"><Check size={13} aria-hidden="true" />{t.addedHere}<span className={styles.srOnly}>. {t.addedHereBoundary}</span></span> : null}
                    {message.state === "failed" ? <span className={styles.messageError}><span data-testid="table-message-status" role="alert" aria-live="assertive" aria-atomic="true">{t.sendFailed}</span><button type="button" data-testid="table-message-retry" onClick={() => retryMessage(message.id)}><RotateCcw size={14} aria-hidden="true" />{t.retry}</button>{message.imageUrl ? <button type="button" data-testid="table-message-image-remove" onClick={() => removeFailedMessageImage(message.id)}><X size={14} aria-hidden="true" />{t.removePhoto}</button> : null}</span> : null}
                  </article>)}
                </div>
                <div className={styles.composer}>
                  {chatImage ? <div className={styles.chatImage}>{chatImageFailed
                    ? <div className={styles.mediaFallback} data-testid="table-chat-image-fallback"><ImageOff size={19} aria-hidden="true" /><span>{t.imageUnavailable}</span></div>
                    : <img src={chatImage} alt={t.selectedPhotoAlt} onError={() => { setChatImageFailed(true); setChatImageError(t.imageUnavailable) }} />}<button type="button" onClick={removeChatImage} aria-label={t.removePhoto}><X size={15} aria-hidden="true" /></button></div> : null}
                  {chatImageError ? <p className={styles.messageError} data-testid="table-chat-image-error" role="alert">{chatImageError}</p> : null}
                  <label><span>{t.compose}</span><textarea data-testid="table-chat-compose" value={compose} onChange={(event) => setCompose(event.target.value)} /></label>
                  <input ref={imageInputRef} className={styles.fileInput} type="file" accept="image/jpeg,image/png,image/webp" aria-label={t.attach} data-testid="table-chat-image" tabIndex={-1} onChange={chooseImage} />
                  <div><button type="button" className={styles.attachButton} onClick={() => imageInputRef.current?.click()}><ImagePlus size={17} aria-hidden="true" />{chatImage ? t.replacePhoto : t.attach}</button><button type="button" className={styles.sendButton} data-testid="table-message-send" disabled={!compose.trim() && (!chatImage || chatImageFailed)} onClick={sendMessage}><MessageCircle size={17} aria-hidden="true" />{t.send}</button></div>
                </div>
                <div className={styles.checkInGroup}>
                  <button type="button" className={checkedIn ? styles.checkedIn : styles.checkIn} data-testid="table-check-in" data-arrival-state={arrivalChecking ? "checking" : tableCompleted ? "completed" : checkedIn ? "checked-in" : "idle"} disabled={arrivalChecking || checkedIn} aria-busy={arrivalChecking} onClick={markArrival}>{arrivalChecking ? <LoaderCircle className={styles.messageSpinner} size={17} aria-hidden="true" /> : <MapPin size={17} aria-hidden="true" />}{arrivalChecking ? t.checkingIn : checkedIn ? t.checkedIn : t.checkIn}</button>
                  {checkedIn && !tableCompleted && !activityPersistError ? <p className={styles.completionStatus} role="status" aria-live="polite"><LoaderCircle className={styles.messageSpinner} size={14} aria-hidden="true" />{t.completing}</p> : null}
                  <details className={styles.arrivalDisclosure} data-testid="table-arrival-details">
                    <summary>{t.arrivalDetails}<ChevronRight size={16} aria-hidden="true" /></summary>
                    <div><p>{t.chatBoundary}</p><p>{t.checkInBoundary}</p></div>
                  </details>
                  {activityPersistError ? <div className={styles.activityError} data-testid="table-activity-save-error" role="alert"><span><AlertTriangle size={16} aria-hidden="true" />{t.activitySaveFailed}</span><button type="button" data-testid="table-activity-retry" onClick={retryActivity}><RotateCcw size={14} aria-hidden="true" />{t.retry}</button></div> : null}
                </div>
                {tableCompleted ? <section className={styles.feedback}>
                  <h3>{t.feedbackTitle}</h3><div><button type="button" aria-pressed={feedback === "helpful"} onClick={() => setFeedback("helpful")}><Star size={16} aria-hidden="true" />{t.helpful}</button><button type="button" aria-pressed={feedback === "welcoming"} onClick={() => setFeedback("welcoming")}><UsersRound size={16} aria-hidden="true" />{t.welcoming}</button></div>
                  <button type="button" className={styles.primary} data-testid="table-feedback-submit" disabled={!feedback} onClick={saveFeedback}>{t.feedback}</button>
                  {feedbackSaved ? <aside className={styles.reputationReceipt} data-testid="table-reputation-receipt"><strong>{t.feedbackSaved}</strong><dl><div><dt>{t.meetup}</dt><dd>{t.meetupValue}</dd></div><div><dt>{t.contribution}</dt><dd>{feedback === "helpful" ? t.helpful : feedback === "welcoming" ? t.welcoming : t.contributionValue}</dd></div></dl></aside> : null}
                </section> : null}
                {reportReceipt ? <aside className={styles.reportReceipt} role="status" data-testid="table-report-receipt" data-participant-blocked={reportReceipt.participantBlocked ? "true" : "false"}>
                  <Check size={18} aria-hidden="true" />
                  <span><strong>{t.reportDone}</strong><small>{reportReasonLabel(reportReceipt.reason, t)} · {t.reportNotSent}</small></span>
                </aside> : null}
                {blocked ? <p className={styles.status} role="status">{t.blocked}<button ref={blockUndoRef} type="button" data-testid="table-block-undo" onClick={undoBlock}>{t.undo}</button></p> : null}
                {reportPersistError && !reportOpen ? <p className={styles.persistError} data-testid="table-report-save-error" role="alert"><AlertTriangle size={16} aria-hidden="true" />{t.reportSaveFailed}</p> : null}
                <div className={styles.safetyActions}><button ref={reportButtonRef} type="button" data-testid="table-report" disabled={safetyOpen} onClick={openReport}><Flag size={16} aria-hidden="true" />{t.report}</button><button ref={blockButtonRef} type="button" data-testid="table-block" disabled={blocked || safetyOpen} onClick={() => setBlockOpen(true)}><UserRoundX size={16} aria-hidden="true" />{t.block}</button><button ref={leaveButtonRef} type="button" data-testid="table-leave" disabled={safetyOpen} onClick={() => setLeaveOpen(true)}><X size={16} aria-hidden="true" />{t.leave}</button></div>
                {reportOpen ? <ConfirmPanel title={t.reportTitle} target={t.reportTarget} confirm={t.reportConfirm} cancel={t.cancelSafety} confirmTestId="table-report-confirm" confirmDisabled={!reportReason} error={reportPersistError ? t.reportSaveFailed : null} errorTestId="table-report-save-error" onConfirm={confirmReport} onCancel={cancelReport}>
                  <fieldset className={styles.reportReasons} data-testid="table-report-reasons"><legend>{t.reportReasonLegend}</legend><div>{([
                    ["no_show", t.reportReasonNoShow],
                    ["behavior", t.reportReasonBehavior],
                    ["other", t.reportReasonOther],
                  ] as const).map(([reason, label]) => <label key={reason} data-selected={reportReason === reason ? "true" : "false"}><input type="radio" name="table-report-reason" value={reason} checked={reportReason === reason} onChange={() => setReportReason(reason)} data-testid={`table-report-reason-${reason}`} /><span>{label}</span></label>)}</div></fieldset>
                  <label className={styles.reportBlockOption}><input type="checkbox" checked={reportBlock} onChange={(event) => setReportBlock(event.target.checked)} data-testid="table-report-block" />{t.reportBlockWithReport}</label>
                </ConfirmPanel> : null}
                {blockOpen ? <ConfirmPanel title={t.blockTitle} target={t.blockTarget} confirm={t.blockConfirm} cancel={t.cancelSafety} confirmTestId="table-block-confirm" onConfirm={() => { setBlocked(true); setBlockOpen(false); window.requestAnimationFrame(() => blockUndoRef.current?.focus({ preventScroll: true })) }} onCancel={cancelBlock} /> : null}
                {leaveOpen ? <ConfirmPanel title={t.leaveTitle} target={activeTable.presentation.title[locale]} confirm={t.leaveConfirm} cancel={t.stay} confirmTestId="table-leave-confirm" error={leavePersistError ? t.leaveSaveFailed : null} errorTestId="table-leave-save-error" onConfirm={confirmLeave} onCancel={cancelLeave} /> : null}
              </section> : null}
              <div className={styles.detailCompanions} data-testid="table-companion-actions">
                <button type="button" className={styles.secondary} data-testid="table-return-place" onClick={returnToTablePlace}>{reservationCopy.returnPlace}<MapPin size={17} aria-hidden="true" /></button>
                {publicSample && resolveCommercePlaceB(activeVenueId)?.reservation ? <button type="button" className={styles.secondary} data-testid="table-reservation-open" onClick={reserveTablePlace}>{reservationCopy.title}<CalendarClock size={17} aria-hidden="true" /></button> : null}
              </div>
              <div className={styles.detailProfile}>
                <ProfileReputationEntryB locale={locale} accountActive={state.account === "ACC-ACTIVE"} origin="table_host" registerHostExitGuard={registerProfileHostExitGuard} />
              </div>
            </div>
            </article>
            if (selected) tableExitVisualSnapshotRef.current = liveTableSurface
            return selected ? liveTableSurface : tableExitVisualSnapshotRef.current ?? liveTableSurface
          })()}
        </div>
      </>) : null}
    </section>
  )
}

function PlaceContext({ venueName, sourceName, district, kind, copy }: { venueName: string; sourceName: string; district: string; kind: "official" | "editorial"; copy: TableCopy }) {
  return <section className={styles.official} data-testid="table-place-context" data-place-context="venue" data-place-kind={kind}><strong><MapPin size={14} aria-hidden="true" />{copy.official}</strong><p>{venueName} · {district}</p>{venueName !== sourceName ? <small lang="ko">{sourceName}</small> : null}</section>
}

function PlanFields({ copy, values, schedule, context }: { copy: TableCopy; values: { menu: string; language: string; cost: string; participants: string; format: string }; schedule: string; context: "card" | "detail" }) {
  const fields = [
    { id: "table-sample-time", kind: "time", icon: CalendarClock, label: copy.timeLabel, value: schedule, teaser: true },
    { id: "table-sample-participants", kind: "seats", icon: UsersRound, label: copy.participantsLabel, value: values.participants, teaser: true },
    { id: "table-meeting-point", kind: "format", icon: Utensils, label: copy.formatLabel, value: values.format, teaser: false },
    { id: "table-sample-menu", kind: "menu", icon: ClipboardList, label: copy.menuLabel, value: values.menu, teaser: false },
    { id: "table-sample-language", kind: "language", icon: Languages, label: copy.languageLabel, value: values.language, teaser: false },
    { id: "table-sample-cost", kind: "cost", icon: CircleDollarSign, label: copy.costLabel, value: values.cost, teaser: true },
  ]
  return <section className={styles.plan} data-plan-context={context}><dl>{fields.map(({ id, kind, icon: Icon, label, value, teaser }) => <div key={id} data-testid={id} data-fact-kind={kind} data-card-teaser={context === "card" && teaser ? "true" : undefined}><dt><Icon size={15} aria-hidden="true" />{label}</dt><dd>{value}</dd></div>)}</dl></section>
}

function ConfirmPanel({ title, target, confirm, cancel, confirmTestId, confirmDisabled = false, error = null, errorTestId, children, onConfirm, onCancel }: {
  title: string
  target: string
  confirm: string
  cancel: string
  confirmTestId: string
  confirmDisabled?: boolean
  error?: string | null
  errorTestId?: string
  children?: ReactNode
  onConfirm(): void
  onCancel(): void
}) {
  const panelRef = useRef<HTMLElement | null>(null)
  const cancelRef = useRef<HTMLButtonElement | null>(null)

  useModalIsolation(true, panelRef)

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      panelRef.current?.scrollIntoView({ block: "end" })
      const initial = panelRef.current?.querySelector<HTMLElement>("[data-confirm-initial-focus]") ?? cancelRef.current
      initial?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    if (!error) return
    const frame = window.requestAnimationFrame(() => panelRef.current?.scrollIntoView({ block: "end" }))
    return () => window.cancelAnimationFrame(frame)
  }, [error])

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (panelRef.current?.closest("[inert],[aria-hidden='true']")) return
    event.stopPropagation()
    if (event.key === "Escape") {
      event.preventDefault()
      onCancel()
      return
    }
    if (event.key !== "Tab") return
    const focusable = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(isRenderedFocusable)
    const first = focusable[0]
    const last = focusable.at(-1)
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  return <section ref={panelRef} className={styles.inlineConfirm} role="alertdialog" aria-modal="true" aria-label={title} data-testid="table-safety-decision" data-modal-layer-priority={ONDO_MODAL_PRIORITY.fullTask} onKeyDown={handleKeyDown}>
    <AlertTriangle size={18} aria-hidden="true" />
    <strong>{title}</strong>
    <p className={styles.confirmTarget}>{target}</p>
    {children}
    {error ? <p className={styles.persistError} data-testid={errorTestId} role="alert"><AlertTriangle size={16} aria-hidden="true" />{error}</p> : null}
    <div><button type="button" data-testid={confirmTestId} disabled={confirmDisabled} onClick={onConfirm}>{confirm}</button><button ref={cancelRef} type="button" onClick={onCancel}>{cancel}</button></div>
  </section>
}
