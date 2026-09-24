"use client"

import type { KeyboardEvent, SyntheticEvent } from "react"
import { createRef, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react"
import { ArrowLeft, BadgeCheck, Blocks, Bookmark, Check, ChevronRight, CircleHelp, CircleMinus, Clock3, CreditCard, Fingerprint, Languages, Landmark, LoaderCircle, MapPin, MoonStar, Navigation, Newspaper, NotebookPen, RotateCcw, Split, Store, ThermometerSun, TriangleAlert, Utensils, UsersRound, X } from "lucide-react"
import type { CanonicalVenueDetail, CanonicalVenueDetailResponse } from "@/lib/ondo/venues/detail-contract"
import { canonicalMapVenueById } from "@/lib/ondo/venues/map-data"
import { venueDistrictLabel, venueNamePresentation } from "@/lib/ondo/venues/display"
import {
  DEFAULT_GLOBAL_AFTER19_SESSION,
  GLOBAL_AFTER19_SESSION_EVENT,
  isGlobalAfter19NightViewCurrent,
  isGlobalAfter19ReviewResultB,
  restoreGlobalAfter19B,
  sanitizeGlobalAfter19Session,
  type GlobalAfter19SessionB,
} from "../after19/after19-global-b-model"
import { readGuestAfter19MemoryB } from "../after19/after19-guest-memory-b"
import {
  createPlaceAfter19Return,
  PLACE_AFTER19_RETURN_COMPLETE_EVENT,
  PLACE_AFTER19_RETURN_REQUEST_EVENT,
  requestPlaceAfter19Return,
  restorePlaceAfter19ReturnSession,
} from "../after19/after19-place-return-b-model"
import { B_DISCOVERY_TRAVERSAL_EVENT, closeBDiscoveryPlace, consumeBDiscoveryPeekTraversalFocus, goBackFromBDiscovery, openBDiscoveryAlternativeVenue, openBDiscoveryDetail, readBDiscoveryHistory, readBDiscoveryTraversal, readMyKoreaPlaceReturnNavigation } from "../map/b-discovery-history"
import {
  PLACE_RETURN_DETAIL_SECTIONS,
  PLACE_RETURN_FOCUS_TARGETS,
  PLACE_RETURN_OPEN_SECTIONS,
  PLACE_RETURN_UI_RESTORE_EVENT,
  readPlaceReturnCamera,
  readPlaceReturnUiRestoreEvent,
  type PlaceReturnDetailSectionB,
  type PlaceReturnFocusTargetB,
  type PlaceReturnOpenSectionB,
  type PlaceReturnUiSnapshotInputB,
} from "../map/place-return-ui-snapshot-b"
import { pulseAlternativesForVenue, pulseForVenue, pulseLevelLabel, type PulseLocalSignalTagB } from "../pulse-b/pulse-model-b"
import { SampleActivityMeterB } from "../map/sample-activity-meter-b"
import { FoodPhotoB } from "../map/food-photo-b"
import { canonicalVenueMoodImage } from "../map/canonical-venue-capsule-b"
import { ONDO_B_TABLES, ondoBTableTimeline } from "../connect/table-model"
import { capturePlaceServiceMapReturnB } from "../map/place-service-map-return-b"
import { PlacePeekActionsB, PlaceServiceActionsB } from "./place-service-actions-b"
import { JourneyVisitEntryB } from "../commerce-b/journey-visit-b"
import { ExperienceEntryB } from "../experience-b/experience-b"
import { HackathonEntitlementCtaB } from "../hackathon-b/hackathon-cta-b"
import {
  canonicalFactFreshness,
  canonicalFactState,
  canonicalFactStateWithRetry,
  nextCanonicalFactFreshnessTransition,
  sanitizeCanonicalFactState,
  sanitizeEvidenceSourceClass,
  type CanonicalFactState,
  type CanonicalFactRetry,
  type EvidenceSourceClass,
} from "../contracts/evidence"
import { useOndoB } from "../shared/state/ondo-b-provider"
import type { OndoBLocale } from "../shared/state/ondo-b-preferences"
import { ondoBProductTimeline, type OndoBProductTimelineOverride } from "../shared/time/product-timeline-b"
import { isRenderedFocusable } from "../shared/ui/is-rendered-focusable"
import { ONDO_MODAL_PRIORITY } from "../shared/ui/modal-layer-priority"
import { useDocumentScrollLock, useModalIsolation, useModalVisualViewport } from "../shared/ui/use-modal-isolation"
import { qaReviewFixtureOptions, readQaRuntime } from "../shared/ui/use-qa-controls"
import type { SheetPresencePhase } from "../shared/ui/use-sheet-presence"
import styles from "./canonical-place.module.css"

const OFFICIAL_DIRECTORY_SOURCE_CONTRACT = "LOCALDATA place information"
export const ONDO_OPEN_TABLE_EVENT = "ondo:b:open-table"
type FactKey = "hours" | "card" | "menu" | "language"
type EvidenceQaStateOverride = {
  state?: unknown
  sourceClass?: unknown
  value?: unknown
  observedAt?: unknown
  recoverable?: unknown
}
type PlaceQaRuntime = {
  productTimeline?: OndoBProductTimelineOverride
  evidenceFacts?: Partial<Record<FactKey, EvidenceQaStateOverride>>
}

type CanonicalPlaceOverlayProps = {
  locale: OndoBLocale
  presenceState: Exclude<SheetPresencePhase, "closed">
  venueId: string
}

type CanonicalPlaceVisualSnapshot = Readonly<{
  after19Session: GlobalAfter19SessionB
  after19Unlocked: boolean
  detail: CanonicalVenueDetail | null
  detailState: "idle" | "loading" | "ready" | "error"
  evidenceClockNow: number
  expanded: boolean
  factRetry: CanonicalFactRetry | null
  ignoredQaFactKeys: readonly FactKey[]
  localPulseEvidence: ReturnType<typeof pulseForVenue>["localEvidence"]
  localSignalPosted: boolean
  locale: OndoBLocale
  openFactKey: FactKey | null
  saved: boolean
  saveStatus: string
  tableClockNow: number
}>

const COPY = {
  en: {
    active: "Official directory",
    source: "Source",
    sourceBody: "Ministry of the Interior and Safety · LOCALDATA food-service dataset",
    sourceBoundary: "Listed in LOCALDATA at the source date. Check today’s opening directly with the place.",
    before: "Information not provided by this source",
    unknown: "Not provided by this source",
    unknownShort: "Not provided",
    hours: "Current opening hours",
    card: "Foreign-issued card support",
    menu: "Menu and prices",
    language: "English-language support",
    hoursShort: "Hours",
    cardShort: "Cards",
    menuShort: "Menu",
    languageShort: "Language",
    category: "Place type",
    licence: "Source status",
    activeLicence: "Listed at source date",
    opened: "First listed",
    modified: "Source record updated",
    details: "Place details",
    directions: "Directions",
    save: "Save to My Korea",
    saved: "Saved to My Korea",
    removeSaved: "Remove from Saved",
    localSignal: "Add a place note",
    localSignalPosted: "Add a place note",
    demoOffer: "Meal benefit",
    demoOfferBody: "₩22,000 − ₩3,000",
    demoOfferPrice: "Pay ₩19,000",
    close: "Close place",
    back: "Back to place summary",
    saveFailed: "Couldn’t save this place. The selected place remains open.",
    retrySave: "Try saving again",
    detailLoading: "Loading address…",
    detailUnavailable: "Couldn’t load the address",
    retryDetail: "Retry place details",
    sourceSnapshot: "Source snapshot",
    sourceRecord: "LOCALDATA management ID",
    sourceReference: "Source reference",
    detailsToCheck: "4 details to check",
    beforeTitle: "Before you go",
    factYes: "Available",
    factNo: "Unavailable",
    factConditional: "Check details",
    factUnknown: "Not confirmed",
    factLoading: "Checking…",
    factStale: "May be outdated",
    factError: "Couldn’t load",
    officialSource: "Official directory",
    factSourceBoundary: "This directory does not include this detail.",
    onRecord: "On record",
    quickActions: "More place actions",
    pulseSignals: "recent signals",
    pulseLimited: "Explore · limited signals",
    pulseConfidence: "Confidence",
    pulseFreshness: "Freshness",
    pulseEvidence: "About this place temperature",
    temperature: "Place temperature",
    pulseHigh: "High",
    pulseMedium: "Medium",
    pulseLow: "Low",
    pulseLimitedConfidence: "Limited",
    pulseFixedSnapshot: "Curated snapshot",
    pulseGrowingSnapshot: "Recently updated",
    pulseTooHot: "Too hot?",
    pulseTooHotBody: "Compare a calmer place from the same curated area.",
    pulseAlternative: "Open calmer place",
    pulseLocalEvidence: "Your recent signal",
    table: "Dine with travelers",
    tableBody: (schedule: string) => `${schedule} · Korean + English · 1 seat left`,
    tableClosedBody: "This Table has ended · view details",
    browseTables: "Browse all Tables",
    after19: "19+ required",
    after19Body: "You’ll verify after choosing Join.",
    after19Preview: "After 19",
    after19Unlock: "Turn on After 19",
    after19Ready: "On",
    after19Review: "Review result · no external check",
    pulseBoundary: "Curated visit signals · not live crowding or official venue facts.",
  },
  ko: {
    active: "공식 등록 정보",
    source: "출처",
    sourceBody: "행정안전부 · LOCALDATA 음식점 데이터",
    sourceBoundary: "출처 기준일에 LOCALDATA에 등록된 장소입니다. 오늘 영업 여부는 장소에 직접 확인해 주세요.",
    before: "이 출처에서 제공하지 않는 정보",
    unknown: "이 출처에서 제공하지 않음",
    unknownShort: "미제공",
    hours: "현재 영업시간",
    card: "해외 발급 카드 지원",
    menu: "메뉴와 가격",
    language: "영어 지원",
    hoursShort: "영업",
    cardShort: "카드",
    menuShort: "메뉴",
    languageShort: "언어",
    category: "장소 유형",
    licence: "출처 상태",
    activeLicence: "출처 기준일 등록",
    opened: "최초 등록일",
    modified: "출처 기록 수정일",
    details: "장소 상세",
    directions: "길찾기",
    save: "저장",
    saved: "저장됨",
    removeSaved: "저장 취소",
    localSignal: "지금 분위기 남기기",
    localSignalPosted: "지금 분위기 남기기",
    demoOffer: "식사 혜택",
    demoOfferBody: "₩22,000 − ₩3,000",
    demoOfferPrice: "결제 ₩19,000",
    close: "장소 닫기",
    back: "장소 요약으로",
    saveFailed: "장소를 저장하지 못했어요. 선택한 장소 화면은 그대로 유지됩니다.",
    retrySave: "다시 저장",
    detailLoading: "주소를 불러오는 중…",
    detailUnavailable: "주소를 불러오지 못했어요",
    retryDetail: "장소 상세 다시 불러오기",
    sourceSnapshot: "출처 스냅샷",
    sourceRecord: "LOCALDATA 관리번호",
    sourceReference: "출처 참조",
    detailsToCheck: "확인할 정보 4개",
    beforeTitle: "가기 전 확인",
    factYes: "이용 가능",
    factNo: "이용 불가",
    factConditional: "조건 확인",
    factUnknown: "확인된 정보 없음",
    factLoading: "확인 중…",
    factStale: "오래된 정보",
    factError: "불러오지 못함",
    officialSource: "공식 등록 정보",
    factSourceBoundary: "이 등록 정보에는 해당 항목이 없어요.",
    onRecord: "기록에 있음",
    quickActions: "장소 빠른 기능",
    pulseSignals: "최근 시그널",
    pulseLimited: "탐색 · 신호 부족",
    pulseConfidence: "신뢰도",
    pulseFreshness: "최신성",
    pulseEvidence: "장소 온도의 근거",
    temperature: "장소 온도",
    pulseHigh: "높음",
    pulseMedium: "보통",
    pulseLow: "낮음",
    pulseLimitedConfidence: "신호 부족",
    pulseFixedSnapshot: "선별 스냅샷",
    pulseGrowingSnapshot: "최근 업데이트",
    pulseTooHot: "너무 핫한가요?",
    pulseTooHotBody: "같은 선별 지역에서 더 여유로운 장소를 살펴보세요.",
    pulseAlternative: "더 여유로운 장소 열기",
    pulseLocalEvidence: "내 최근 신호",
    table: "여행자와 함께 먹기",
    tableBody: (schedule: string) => `${schedule} · 한국어 + 영어 · 1자리 남음`,
    tableClosedBody: "종료된 테이블 · 상세 보기",
    browseTables: "전체 테이블 보기",
    after19: "19+ 필수",
    after19Body: "참여를 누른 뒤 확인해요.",
    after19Preview: "After 19",
    after19Unlock: "After 19 켜기",
    after19Ready: "켜짐",
    after19Review: "검토 결과 · 외부 확인 없음",
    pulseBoundary: "선별된 방문 시그널 · 실시간 혼잡도나 공식 장소 정보가 아니에요.",
  },
  ja: {
    active: "公的登録情報",
    source: "出典",
    sourceBody: "韓国行政安全部・LOCALDATA飲食店データ",
    sourceBoundary: "出典日時点でLOCALDATAに掲載された場所です。現在の営業状況は店舗に確認してください。",
    before: "この出典では確認できない情報",
    unknown: "この出典では確認できません",
    unknownShort: "情報なし",
    hours: "現在の営業時間",
    card: "海外発行カードへの対応",
    menu: "メニューと価格",
    language: "日本語・英語への対応",
    hoursShort: "営業時間",
    cardShort: "カード",
    menuShort: "メニュー",
    languageShort: "言語",
    category: "場所タイプ",
    licence: "出典での状態",
    activeLicence: "出典日時点で掲載",
    opened: "初回掲載日",
    modified: "出典記録の更新日",
    details: "場所の詳細",
    directions: "経路を見る",
    save: "保存",
    saved: "保存済み",
    removeSaved: "保存を解除",
    localSignal: "今の雰囲気を残す",
    localSignalPosted: "今の雰囲気を残す",
    demoOffer: "食事特典",
    demoOfferBody: "₩22,000 − ₩3,000",
    demoOfferPrice: "お支払い ₩19,000",
    close: "場所を閉じる",
    back: "場所の概要に戻る",
    saveFailed: "場所を保存できませんでした。選択中の場所は開いたままです。",
    retrySave: "もう一度保存",
    detailLoading: "住所を読み込み中…",
    detailUnavailable: "住所を読み込めませんでした",
    retryDetail: "場所の詳細を再読み込み",
    sourceSnapshot: "出典スナップショット",
    sourceRecord: "LOCALDATA管理番号",
    sourceReference: "出典参照",
    detailsToCheck: "確認する情報 4件",
    beforeTitle: "行く前に確認",
    factYes: "利用可能",
    factNo: "利用不可",
    factConditional: "条件を確認",
    factUnknown: "確認情報なし",
    factLoading: "確認中…",
    factStale: "情報が古い可能性があります",
    factError: "読み込めませんでした",
    officialSource: "公的登録情報",
    factSourceBoundary: "この登録情報には、この項目が含まれていません。",
    onRecord: "記録あり",
    quickActions: "場所のクイック操作",
    pulseSignals: "最近のシグナル",
    pulseLimited: "探索中・シグナル不足",
    pulseConfidence: "確度",
    pulseFreshness: "更新状況",
    pulseEvidence: "このにぎわいの根拠",
    temperature: "スポットのにぎわい",
    pulseHigh: "高い",
    pulseMedium: "中程度",
    pulseLow: "低い",
    pulseLimitedConfidence: "シグナル不足",
    pulseFixedSnapshot: "選定スナップショット",
    pulseGrowingSnapshot: "最近更新",
    pulseTooHot: "混みそう？",
    pulseTooHotBody: "同じ選定エリアから、より落ち着いた場所を比べられます。",
    pulseAlternative: "落ち着いた場所を開く",
    pulseLocalEvidence: "自分の最近のシグナル",
    table: "旅行者と食事",
    tableBody: (schedule: string) => `${schedule}・韓国語＋英語・残り1席`,
    tableClosedBody: "終了したTable・詳細を見る",
    browseTables: "すべてのテーブルを見る",
    after19: "19歳以上の確認が必要",
    after19Body: "参加を選んだ後に確認します。",
    after19Preview: "After 19",
    after19Unlock: "After 19をオンにする",
    after19Ready: "オン",
    after19Review: "レビュー結果・外部確認なし",
    pulseBoundary: "選定した訪問シグナルに基づく参考値です。リアルタイムの混雑状況でも、公式の場所情報でもありません。",
  },
} as const

const EVIDENCE_COPY = {
  en: {
    title: "Evidence", source: "Source", close: "Close evidence", observed: "Observed", freshness: "Freshness", current: "Current", stale: "May be outdated",
    value: "What the source says", retry: "Try again", unavailableValue: "Not available", conditionalValue: "Check directly with the place",
    official_directory: "Official directory", editorial: "Editorial source", ondo: "K-Tour ID signal", merchant: "Place-provided",
    opendid: "OpenDID credential", eas: "EAS attestation",
    official_directoryNote: "Public directory record", editorialNote: "Linked editorial source", ondoNote: "A recent K-Tour ID signal",
    merchantNote: "Information supplied by the place", opendidNote: "A credential presented through OpenDID", easNote: "An EAS attestation",
  },
  ko: {
    title: "근거", source: "출처", close: "근거 닫기", observed: "확인 시점", freshness: "최신성", current: "현재", stale: "오래됐을 수 있음",
    value: "출처에서 확인된 내용", retry: "다시 시도", unavailableValue: "이용 불가", conditionalValue: "장소에 직접 확인하세요",
    official_directory: "공식 등록 정보", editorial: "편집 출처", ondo: "K-Tour ID 신호", merchant: "장소 제공",
    opendid: "OpenDID 자격 증명", eas: "EAS 증명",
    official_directoryNote: "공개 등록 정보", editorialNote: "연결된 편집 출처", ondoNote: "최근 K-Tour ID 신호",
    merchantNote: "장소에서 제공한 정보", opendidNote: "OpenDID로 제시한 자격 증명", easNote: "EAS 증명",
  },
  ja: {
    title: "根拠", source: "出典", close: "根拠を閉じる", observed: "確認日時", freshness: "更新状況", current: "最新", stale: "古い可能性あり",
    value: "出典の内容", retry: "もう一度試す", unavailableValue: "利用不可", conditionalValue: "店舗に直接確認してください",
    official_directory: "公的登録情報", editorial: "編集情報", ondo: "K-Tour ID シグナル", merchant: "店舗提供",
    opendid: "OpenDID資格情報", eas: "EAS証明",
    official_directoryNote: "公開登録情報", editorialNote: "リンクされた編集情報", ondoNote: "最近のK-Tour ID シグナル",
    merchantNote: "店舗から提供された情報", opendidNote: "OpenDIDで提示された資格情報", easNote: "EAS証明",
  },
} as const

const CATEGORY = {
  korean: { en: "Korean", ko: "한식", ja: "韓国料理" },
  casual: { en: "Quick service", ko: "분식·간편식", ja: "軽食・ファストフード" },
  japanese: { en: "Japanese", ko: "일식", ja: "日本料理" },
  chinese: { en: "Chinese", ko: "중식", ja: "中華料理" },
  global: { en: "Western & international", ko: "경양식·외국음식", ja: "洋食・各国料理" },
  night: { en: "Pubs & cafés", ko: "주점·카페", ja: "パブ・カフェ" },
  specialty: { en: "Grills & specialty", ko: "구이·횟집·전문점", ja: "焼き物・専門店" },
} as const

const FOCUSABLE = "a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex='-1'])"

function evidenceValue(value: unknown, fallback: string) {
  if (typeof value === "boolean") return value ? "Yes" : "No"
  return typeof value === "string" && value.trim() ? value : fallback
}

function factEvidenceValue(state: CanonicalFactState, value: unknown, locale: "en" | "ko" | "ja") {
  const evidenceCopy = EVIDENCE_COPY[locale]
  if (state === "no") return evidenceCopy.unavailableValue
  if (typeof value === "string" && value.trim()) return value.trim()
  if (state === "yes") return COPY[locale].factYes
  if (state === "conditional") return evidenceCopy.conditionalValue
  return null
}

function SourceClassGlyph({ sourceClass }: { sourceClass: EvidenceSourceClass }) {
  if (sourceClass === "official_directory") return <Landmark size={18} aria-hidden="true" />
  if (sourceClass === "editorial") return <Newspaper size={18} aria-hidden="true" />
  if (sourceClass === "ondo") return <ThermometerSun size={18} aria-hidden="true" />
  if (sourceClass === "merchant") return <Store size={18} aria-hidden="true" />
  if (sourceClass === "opendid") return <Fingerprint size={18} aria-hidden="true" />
  if (sourceClass === "eas") return <Blocks size={18} aria-hidden="true" />
  return <Landmark size={18} aria-hidden="true" />
}

function sourceClassNote(sourceClass: EvidenceSourceClass, locale: "en" | "ko" | "ja") {
  const copy = EVIDENCE_COPY[locale]
  if (sourceClass === "editorial") return copy.editorialNote
  if (sourceClass === "ondo") return copy.ondoNote
  if (sourceClass === "merchant") return copy.merchantNote
  if (sourceClass === "opendid") return copy.opendidNote
  if (sourceClass === "eas") return copy.easNote
  return copy.official_directoryNote
}

function factStateLabel(state: CanonicalFactState, locale: "en" | "ko" | "ja") {
  const copy = COPY[locale]
  if (state === "yes") return copy.factYes
  if (state === "no") return copy.factNo
  if (state === "conditional") return copy.factConditional
  if (state === "loading") return copy.factLoading
  if (state === "stale") return copy.factStale
  if (state === "error") return copy.factError
  return copy.factUnknown
}

function FactStateGlyph({ state }: { state: CanonicalFactState }) {
  if (state === "yes") return <Check size={17} aria-hidden="true" />
  if (state === "no") return <CircleMinus size={17} aria-hidden="true" />
  if (state === "conditional") return <Split size={17} aria-hidden="true" />
  if (state === "loading") return <LoaderCircle className={styles.factSpinner} size={17} aria-hidden="true" />
  if (state === "stale") return <Clock3 size={17} aria-hidden="true" />
  if (state === "error") return <TriangleAlert size={17} aria-hidden="true" />
  if (state === "unknown") return <CircleHelp size={17} aria-hidden="true" />
  return <CircleHelp size={17} aria-hidden="true" />
}

function localTagLabel(tag: PulseLocalSignalTagB, locale: "en" | "ko" | "ja") {
  const labels = {
    calm_now: { en: "Calm right now", ko: "지금은 여유로움", ja: "今はゆったり" },
    lively_now: { en: "Lively right now", ko: "지금은 활기참", ja: "今はにぎやか" },
    quick_stop: { en: "Good for a quick stop", ko: "빠르게 들르기 좋음", ja: "短時間で立ち寄りやすい" },
    welcoming: { en: "Welcoming service", ko: "친절한 응대", ja: "親しみやすい対応" },
  } as const
  return labels[tag][locale]
}

export function CanonicalPlaceOverlay({ locale: mountedLocale, presenceState, venueId }: CanonicalPlaceOverlayProps) {
  const { state, actions } = useOndoB()
  const closing = presenceState === "closing"
  const closingRef = useRef(closing)
  closingRef.current = closing
  const exitRequestedRef = useRef(false)
  const wasClosingRef = useRef(closing)
  if (wasClosingRef.current && !closing) exitRequestedRef.current = false
  wasClosingRef.current = closing
  const [expanded, setExpanded] = useState(() => readBDiscoveryHistory()?.level === "detail")
  const [detail, setDetail] = useState<CanonicalVenueDetail | null>(null)
  const [detailState, setDetailState] = useState<"idle" | "loading" | "ready" | "error">("idle")
  const [detailAttempt, setDetailAttempt] = useState(0)
  const [openFactKey, setOpenFactKey] = useState<FactKey | null>(null)
  const [factRetry, setFactRetry] = useState<CanonicalFactRetry | null>(null)
  const [ignoredQaFactKeys, setIgnoredQaFactKeys] = useState<FactKey[]>([])
  const [qaEvidenceFacts] = useState(() => readQaRuntime<PlaceQaRuntime>()?.evidenceFacts ?? null)
  const [productTimeline] = useState(() => ondoBProductTimeline(Date.now(), readQaRuntime<PlaceQaRuntime>()?.productTimeline ?? null))
  const [tableClockNow, setTableClockNow] = useState(() => Date.now())
  const [evidenceClockNow, setEvidenceClockNow] = useState(() => Date.now())
  const placeTable = ONDO_B_TABLES.find((table) => table.venueId === venueId)
  const tableStartsAtMs = placeTable ? ondoBTableTimeline(placeTable, productTimeline, mountedLocale).startsAtMs : productTimeline.tableStartsAtMs
  const liveTableUpcoming = tableClockNow < tableStartsAtMs
  const [after19Session, setAfter19Session] = useState<GlobalAfter19SessionB>(DEFAULT_GLOBAL_AFTER19_SESSION)
  const [after19Handoff, setAfter19Handoff] = useState(false)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const layerRef = useRef<HTMLDivElement | null>(null)
  const detailRef = useRef<HTMLElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  // The detail branch is not mounted while the compact peek is showing. Give
  // the viewport/isolation hooks a new ref when that branch mounts so their
  // layout effects cannot permanently observe the earlier null ref.
  const evidenceLayerRef = useMemo(() => createRef<HTMLDivElement>(), [expanded])
  const evidenceCloseRef = useRef<HTMLButtonElement | null>(null)
  const factOpenerRefs = useRef<Partial<Record<FactKey, HTMLButtonElement>>>({})
  const evidenceReturnScrollRef = useRef(0)
  const evidenceTitleId = useId()
  const peekRef = useRef<HTMLDivElement | null>(null)
  const openRef = useRef<HTMLButtonElement | null>(null)
  const peekTraversalFocusPendingRef = useRef(false)
  const after19AccessRef = useRef<HTMLElement | null>(null)
  const venue = canonicalMapVenueById(venueId)
  const accountActive = state.account === "ACC-ACTIVE"
  const liveSaved = state.savedVenueIds.includes(venueId) || state.saveStatusByVenue[venueId] === "SAV-SAVED"
  const liveSaveStatus = state.saveStatusByVenue[venueId] ?? "SAV-IDLE"
  const liveLocalSignalPosted = state.localSignalPostedVenueIds.includes(venueId)
  const livePulse = pulseForVenue(venueId, state.localPulseEvidenceByVenue[venueId] ?? null)
  const liveVisualSnapshot: CanonicalPlaceVisualSnapshot = {
    after19Session,
    after19Unlocked: after19Session.mode === "on" && isGlobalAfter19NightViewCurrent(after19Session),
    detail,
    detailState,
    evidenceClockNow,
    expanded,
    factRetry,
    ignoredQaFactKeys,
    localPulseEvidence: livePulse.localEvidence,
    localSignalPosted: liveLocalSignalPosted,
    locale: mountedLocale,
    openFactKey,
    saved: liveSaved,
    saveStatus: liveSaveStatus,
    tableClockNow,
  }
  const visualSnapshotRef = useRef(liveVisualSnapshot)
  if (!closing && !exitRequestedRef.current) visualSnapshotRef.current = liveVisualSnapshot
  const visualSnapshot = closing || exitRequestedRef.current ? visualSnapshotRef.current : liveVisualSnapshot
  const locale = visualSnapshot.locale
  const copy = COPY[locale]

  useEffect(() => {
    if (!liveTableUpcoming) return
    const remaining = tableStartsAtMs - Date.now()
    if (remaining <= 0) {
      setTableClockNow(Date.now())
      return
    }
    const timer = window.setTimeout(() => setTableClockNow(Date.now()), Math.min(remaining + 25, 2_147_000_000))
    return () => window.clearTimeout(timer)
  }, [liveTableUpcoming, tableClockNow, tableStartsAtMs])

  useEffect(() => {
    peekTraversalFocusPendingRef.current = false
    setDetail(null)
    setDetailState("idle")
    setDetailAttempt(0)
    setOpenFactKey(null)
    setFactRetry(null)
    setIgnoredQaFactKeys([])
    setEvidenceClockNow(Date.now())
    if (!venueId) {
      setExpanded(false)
      return
    }
    const historyEntry = readBDiscoveryHistory()
    setExpanded(historyEntry?.level === "detail" && historyEntry.venueId === venueId)
  }, [venueId])

  useEffect(() => {
    const syncHistory = (event: Event) => {
      const entry = readBDiscoveryTraversal(event)?.entry
      if (!entry || entry.venueId !== venueId) return
      peekTraversalFocusPendingRef.current = entry.level === "peek"
      setExpanded(entry.level === "detail")
    }
    window.addEventListener(B_DISCOVERY_TRAVERSAL_EVENT, syncHistory)
    return () => window.removeEventListener(B_DISCOVERY_TRAVERSAL_EVENT, syncHistory)
  }, [venueId])

  useEffect(() => {
    if (expanded && !closing) layerRef.current?.focus({ preventScroll: true })
  }, [closing, expanded])

  useEffect(() => {
    if (!venueId || expanded || closing) return
    const storedTraversalFocus = consumeBDiscoveryPeekTraversalFocus(venueId)
    if (peekTraversalFocusPendingRef.current || storedTraversalFocus) {
      let frame: number | null = null
      const focusDetails = (attempt = 0) => {
        const target = openRef.current
        if (target?.isConnected && !target.closest("[inert],[aria-hidden='true']")) {
          target.focus({ preventScroll: true })
          if (document.activeElement === target) {
            peekTraversalFocusPendingRef.current = false
            return
          }
        }
        if (attempt < 7) frame = window.requestAnimationFrame(() => focusDetails(attempt + 1))
        else peekTraversalFocusPendingRef.current = false
      }
      frame = window.requestAnimationFrame(() => focusDetails())
      return () => { if (frame != null) window.cancelAnimationFrame(frame) }
    }
    const frame = window.requestAnimationFrame(() => peekRef.current?.focus({ preventScroll: true }))
    return () => window.cancelAnimationFrame(frame)
  }, [closing, expanded, venueId])

  const retainedRootRef = closing
    ? visualSnapshot.expanded ? layerRef : peekRef
    : expanded ? layerRef : peekRef
  const parentModalActive = Boolean(venueId) && (closing || !after19Handoff)
  useModalIsolation(parentModalActive, retainedRootRef)
  useDocumentScrollLock(parentModalActive)
  useModalIsolation(Boolean(closing ? visualSnapshot.openFactKey : openFactKey), evidenceLayerRef)
  useModalVisualViewport(evidenceLayerRef)

  useLayoutEffect(() => {
    if (!closing) return
    const consumeClosingKey = (event: globalThis.KeyboardEvent) => {
      const retainedLayer = visualSnapshotRef.current.expanded ? layerRef.current : peekRef.current
      if (retainedLayer?.closest("[inert],[aria-hidden='true']")) return
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    window.addEventListener("keydown", consumeClosingKey, true)
    return () => window.removeEventListener("keydown", consumeClosingKey, true)
  }, [closing])

  useLayoutEffect(() => {
    if (!closing) exitRequestedRef.current = false
  }, [closing, venueId])

  useEffect(() => {
    if (!openFactKey || closing) return
    window.requestAnimationFrame(() => evidenceCloseRef.current?.focus({ preventScroll: true }))
  }, [closing, openFactKey])

  useEffect(() => {
    const syncAfter19 = (event?: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : null
      const now = new Date()
      // A Guest may use the same-tab event result, but never restores an age
      // receipt from storage after reload. Account-scoped sessions keep their
      // existing bounded sessionStorage behavior.
      setAfter19Session(detail
        ? sanitizeGlobalAfter19Session(detail, now, qaReviewFixtureOptions())
        : accountActive
          ? restoreGlobalAfter19B(window.localStorage, window.sessionStorage, now, qaReviewFixtureOptions()).session
          : readGuestAfter19MemoryB(now, qaReviewFixtureOptions()))
    }
    syncAfter19()
    window.addEventListener(GLOBAL_AFTER19_SESSION_EVENT, syncAfter19)
    return () => window.removeEventListener(GLOBAL_AFTER19_SESSION_EVENT, syncAfter19)
  }, [accountActive])

  useEffect(() => {
    const pending = restorePlaceAfter19ReturnSession(window.sessionStorage).publicEnvelope
    setAfter19Handoff(Boolean(pending))

    const requested = () => {
      const latest = restorePlaceAfter19ReturnSession(window.sessionStorage).publicEnvelope
      if (latest) setAfter19Handoff(true)
    }
    const completed = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail as { tokenId?: unknown } : null
      if (!pending || detail?.tokenId !== pending.tokenId) {
        const latest = restorePlaceAfter19ReturnSession(window.sessionStorage)
        if (latest.publicEnvelope?.venueId === venueId) return
      }
      setAfter19Handoff(false)
      const focusAccess = (attempt = 0) => {
        const target = after19AccessRef.current
        if (target?.isConnected && !target.closest("[inert],[aria-hidden='true']")) {
          target.focus({ preventScroll: true })
          if (document.activeElement === target) return
        }
        if (attempt < 7) window.requestAnimationFrame(() => focusAccess(attempt + 1))
      }
      window.requestAnimationFrame(() => focusAccess())
    }
    window.addEventListener(PLACE_AFTER19_RETURN_REQUEST_EVENT, requested)
    window.addEventListener(PLACE_AFTER19_RETURN_COMPLETE_EVENT, completed)
    return () => {
      window.removeEventListener(PLACE_AFTER19_RETURN_REQUEST_EVENT, requested)
      window.removeEventListener(PLACE_AFTER19_RETURN_COMPLETE_EVENT, completed)
    }
  }, [venueId])

  useEffect(() => {
    let frame = 0
    let timeout = 0
    const restoreUi = (event: Event) => {
      const snapshot = readPlaceReturnUiRestoreEvent(event)
      if (!snapshot || snapshot.venueId !== venueId) return
      setExpanded(true)
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timeout)
      const apply = (attempt = 0) => {
        const body = bodyRef.current
        const root = detailRef.current
        if (!body || !root) {
          if (attempt < 10) frame = window.requestAnimationFrame(() => apply(attempt + 1))
          return
        }
        root.querySelectorAll<HTMLDetailsElement>("details[data-place-return-open-section]").forEach((disclosure) => {
          const section = disclosure.dataset.placeReturnOpenSection as PlaceReturnOpenSectionB | undefined
          disclosure.open = Boolean(section && snapshot.detail.openSections.includes(section))
        })
        body.scrollTop = Math.min(snapshot.detail.scrollTop, Math.max(0, body.scrollHeight - body.clientHeight))
        const preferred = root.querySelector<HTMLElement>(`[data-place-return-focus='${snapshot.detail.focus}']`)
        const section = root.querySelector<HTMLElement>(`[data-place-return-section='${snapshot.detail.section}']`)
        const fallback = section?.querySelector<HTMLElement>("button,summary,[href],[tabindex]") ?? section ?? after19AccessRef.current
        const target = preferred?.isConnected ? preferred : fallback
        if (target && !target.closest("[inert],[aria-hidden='true']")) {
          target.focus({ preventScroll: true })
          body.scrollTop = Math.min(snapshot.detail.scrollTop, Math.max(0, body.scrollHeight - body.clientHeight))
        }
        if (attempt < 2) frame = window.requestAnimationFrame(() => apply(attempt + 1))
      }
      frame = window.requestAnimationFrame(() => apply())
      timeout = window.setTimeout(() => apply(3), 350)
    }
    window.addEventListener(PLACE_RETURN_UI_RESTORE_EVENT, restoreUi)
    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timeout)
      window.removeEventListener(PLACE_RETURN_UI_RESTORE_EVENT, restoreUi)
    }
  }, [venueId])

  useEffect(() => {
    const baselineObservedAt = detail?.sourceSnapshotAt ?? venue?.sourceSnapshotAt
    const observedAtValues = (["hours", "card", "menu", "language"] as const).map((factKey) => {
      const qaObservedAt = qaEvidenceFacts?.[factKey]?.observedAt
      return typeof qaObservedAt === "string" && Number.isFinite(Date.parse(qaObservedAt)) ? qaObservedAt : baselineObservedAt
    })
    const transitionAt = nextCanonicalFactFreshnessTransition(observedAtValues, new Date(evidenceClockNow))
    if (transitionAt == null) return
    const timer = window.setTimeout(
      () => setEvidenceClockNow(Date.now()),
      Math.min(2_147_000_000, Math.max(16, transitionAt - Date.now())),
    )
    return () => window.clearTimeout(timer)
  }, [detail?.sourceSnapshotAt, evidenceClockNow, qaEvidenceFacts, venue?.sourceSnapshotAt])

  useEffect(() => {
    const rowRetry = factRetry?.phase === "loading" ? factRetry : null
    if (!expanded || !venueId || (!rowRetry && detail?.id === venueId)) return
    let disposed = false
    let requestFrame: number | null = null
    if (!rowRetry) setDetailState("loading")
    requestFrame = window.requestAnimationFrame(() => {
      requestFrame = null
      fetch(`/api/ondo/venues/${encodeURIComponent(venueId)}`)
        .then(async (response) => {
          if (!response.ok) throw new Error(`Venue detail request failed: ${response.status}`)
          return response.json() as Promise<CanonicalVenueDetailResponse>
        })
        .then((payload) => {
          if (disposed) return
          if (payload.venue.id !== venueId) throw new Error("Venue detail id mismatch")
          setDetail(payload.venue)
          setDetailState("ready")
          if (rowRetry) setFactRetry((current) => current?.factKey === rowRetry.factKey ? null : current)
        })
        .catch(() => {
          if (disposed) return
          if (rowRetry) setFactRetry((current) => current?.factKey === rowRetry.factKey ? { ...rowRetry, phase: "error" } : current)
          else setDetailState("error")
        })
    })
    return () => {
      disposed = true
      if (requestFrame != null) window.cancelAnimationFrame(requestFrame)
    }
  }, [detail?.id, detailAttempt, expanded, factRetry, venueId])

  if (!venue) return null
  const renderedDetail = visualSnapshot.detail
  const renderedDetailState = visualSnapshot.detailState
  const renderedFactRetry = visualSnapshot.factRetry
  const renderedIgnoredQaFactKeys = visualSnapshot.ignoredQaFactKeys
  const renderedOpenFactKey = visualSnapshot.openFactKey
  const name = venueNamePresentation(venue.name.ko, locale)
  const district = venueDistrictLabel(venue.cityId, venue.districtId, locale)
  const category = CATEGORY[venue.primaryCategory][locale]
  const addressEvidence = renderedDetail?.address.road.value ? renderedDetail.address.road : renderedDetail?.address.lot.value ? renderedDetail.address.lot : null
  const address = addressEvidence?.value ?? (renderedDetailState === "error" ? copy.detailUnavailable : renderedDetailState === "ready" ? copy.unknown : copy.detailLoading)
  const saved = visualSnapshot.saved
  const saveStatus = visualSnapshot.saveStatus
  const localSignalPosted = visualSnapshot.localSignalPosted
  const pulse = pulseForVenue(venue.id, visualSnapshot.localPulseEvidence ?? null)
  const tableUpcoming = visualSnapshot.tableClockNow < tableStartsAtMs
  const pulseAlternatives = pulseAlternativesForVenue(venue.id)
  // The compact decision communicates temperature through the meter. Keep
  // the accessible name qualitative too, instead of repeating an internal
  // score/status badge in the primary experience.
  const pulseTitle = `${copy.temperature} · ${pulseLevelLabel(pulse.level, locale)}`
  const confidence = ({ high: copy.pulseHigh, medium: copy.pulseMedium, low: copy.pulseLow, limited: copy.pulseLimitedConfidence } as const)[pulse.confidence]
  const fixedSnapshot = pulse.updatedAt
    ? `${pulse.freshness === "growing" ? copy.pulseGrowingSnapshot : copy.pulseFixedSnapshot} · ${pulse.updatedAt.slice(0, 16).replace("T", " ")} UTC`
    : copy.pulseLimited
  const currentVenueId = venue.id
  const currentVenueCity = venue.cityId
  const after19Unlocked = visualSnapshot.after19Unlocked
  const directions = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${venue.latitude},${venue.longitude}`)}`
  const visitFacts = [
    { key: "hours" as FactKey, label: copy.hours, shortLabel: copy.hoursShort, icon: Clock3, evidence: renderedDetail?.facts.openingHours },
    { key: "card" as FactKey, label: copy.card, shortLabel: copy.cardShort, icon: CreditCard, evidence: renderedDetail?.facts.foreignCardAccepted },
    { key: "menu" as FactKey, label: copy.menu, shortLabel: copy.menuShort, icon: Utensils, evidence: renderedDetail?.facts.menu },
    { key: "language" as FactKey, label: copy.language, shortLabel: copy.languageShort, icon: Languages, evidence: renderedDetail?.facts.englishSupport },
  ].map((fact) => {
    const qa = renderedIgnoredQaFactKeys.includes(fact.key) ? undefined : qaEvidenceFacts?.[fact.key]
    const hasQaValue = Boolean(qa && Object.prototype.hasOwnProperty.call(qa, "value"))
    const value = hasQaValue ? qa?.value : fact.evidence?.value
    const observedAt = typeof qa?.observedAt === "string" && Number.isFinite(Date.parse(qa.observedAt))
      ? qa.observedAt
      : renderedDetail?.sourceSnapshotAt ?? venue.sourceSnapshotAt
    const freshness = canonicalFactFreshness(observedAt, new Date(visualSnapshot.evidenceClockNow))
    const baseline = canonicalFactState({ requestState: renderedDetailState, truth: fact.evidence?.truth, value, freshness })
    const sourceState = qa ? sanitizeCanonicalFactState(qa.state, baseline) : baseline
    const factState = canonicalFactStateWithRetry(renderedFactRetry, fact.key, sourceState)
    const sourceClass = qa ? sanitizeEvidenceSourceClass(qa.sourceClass) : "official_directory"
    return {
      ...fact,
      state: factState,
      sourceClass,
      sourceValue: factEvidenceValue(factState, value, locale),
      observedAt,
      freshness,
      recoverable: qa?.recoverable !== false,
    }
  })
  const openFact = renderedOpenFactKey ? visitFacts.find((fact) => fact.key === renderedOpenFactKey) ?? null : null
  const evidenceCopy = EVIDENCE_COPY[locale]

  function openEvidence(factKey: FactKey, opener: HTMLButtonElement) {
    if (closingRef.current || exitRequestedRef.current) return
    factOpenerRefs.current[factKey] = opener
    evidenceReturnScrollRef.current = bodyRef.current?.scrollTop ?? 0
    setOpenFactKey(factKey)
  }

  function closeEvidence() {
    if (closingRef.current || exitRequestedRef.current) return
    const factKey = openFactKey
    setOpenFactKey(null)
    window.requestAnimationFrame(() => {
      if (bodyRef.current) bodyRef.current.scrollTop = evidenceReturnScrollRef.current
      if (factKey) factOpenerRefs.current[factKey]?.focus({ preventScroll: true })
    })
  }

  function retryEvidence(factKey: FactKey) {
    if (closingRef.current || exitRequestedRef.current) return
    setIgnoredQaFactKeys((current) => current.includes(factKey) ? current : [...current, factKey])
    setFactRetry({ factKey, phase: "loading" })
    setDetailAttempt((attempt) => attempt + 1)
  }

  function handleEvidenceKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (closingRef.current || exitRequestedRef.current) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      closeEvidence()
      return
    }
    if (event.key !== "Tab") return
    const focusable = Array.from(evidenceLayerRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(isRenderedFocusable)
    const first = focusable[0]
    const last = focusable.at(-1)
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
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

  function close() {
    if (!beginFinalDismiss()) return
    if (closeBDiscoveryPlace()) return
    actions.setSurface({ kind: "map" })
  }

  function closeDetails() {
    if (closingRef.current || exitRequestedRef.current) return
    peekTraversalFocusPendingRef.current = true
    if (goBackFromBDiscovery("detail")) return
    setExpanded(false)
  }

  function handleDetailKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (closingRef.current || exitRequestedRef.current) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (event.key === "Escape") {
      event.preventDefault()
      if (readMyKoreaPlaceReturnNavigation()?.receipt.phase === "place") {
        close()
        return
      }
      closeDetails()
      return
    }
    if (event.key !== "Tab") return
    const focusable = Array.from(detailRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
      .filter(isRenderedFocusable)
    const first = focusable[0]
    const last = focusable.at(-1)
    if (!first || !last) return
    if (document.activeElement === event.currentTarget) {
      event.preventDefault()
      ;(event.shiftKey ? last : first).focus()
      return
    }
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  function handlePeekKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (closingRef.current || exitRequestedRef.current) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (event.key === "Escape") {
      event.preventDefault()
      close()
      return
    }
    if (event.key !== "Tab") return
    const focusable = Array.from(peekRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
      .filter(isRenderedFocusable)
    const first = focusable[0]
    const last = focusable.at(-1)
    if (!first || !last) return
    if (document.activeElement === event.currentTarget) {
      event.preventDefault()
      ;(event.shiftKey ? last : first).focus()
      return
    }
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  function toggleSave() {
    if (closingRef.current || exitRequestedRef.current) return
    if (saved) actions.toggleSavedVenue(currentVenueId)
    else actions.saveVenue(currentVenueId)
  }

  function openPulseAlternative(alternativeVenueId: string) {
    if (closingRef.current || exitRequestedRef.current) return
    const alternativeVenue = canonicalMapVenueById(alternativeVenueId)
    if (!alternativeVenue || alternativeVenue.cityId !== currentVenueCity
      || !openBDiscoveryAlternativeVenue(currentVenueId, alternativeVenue.id)) return
    actions.recordRecentVenue(alternativeVenue.id)
    actions.setSurface({ kind: "venue", venueId: alternativeVenue.id })
    setExpanded(false)
  }

  function openTableFromPlace() {
    if (!placeTable || !beginFinalDismiss()) return
    capturePlaceServiceMapReturnB(currentVenueId)
    window.__ONDO_B_TABLE_INTENT__ = { tableId: placeTable.id, venueId: currentVenueId, mode: "view" }
    actions.setTab("tables")
    window.setTimeout(() => window.dispatchEvent(new CustomEvent(ONDO_OPEN_TABLE_EVENT, {
      detail: { tableId: placeTable.id, venueId: currentVenueId, mode: "view" },
    })), 0)
  }

  function browseAllTables() {
    if (!beginFinalDismiss()) return
    actions.setTab("tables")
  }

  function openMealBenefitFromPlace() {
    if (!beginFinalDismiss()) return
    if (!actions.openMealBenefitFromPlace(currentVenueId)) exitRequestedRef.current = false
  }

  function openLocalSignalFromPlace() {
    if (closingRef.current || exitRequestedRef.current) return
    actions.openLocalSignal(currentVenueId)
  }

  function openAfter19FromPlace() {
    if (closingRef.current || exitRequestedRef.current || after19Unlocked) return
    const historyEntry = readBDiscoveryHistory()
    if (historyEntry?.level !== "detail" || historyEntry.venueId !== currentVenueId || historyEntry.city !== currentVenueCity) return
    const now = new Date()
    const returnTo = createPlaceAfter19Return({ venueId: currentVenueId, now })
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const rawSection = active?.closest<HTMLElement>("[data-place-return-section]")?.dataset.placeReturnSection
    const section = typeof rawSection === "string" && (PLACE_RETURN_DETAIL_SECTIONS as readonly string[]).includes(rawSection)
      ? rawSection as PlaceReturnDetailSectionB
      : "after19"
    const rawFocus = active?.closest<HTMLElement>("[data-place-return-focus]")?.dataset.placeReturnFocus
    const focus = typeof rawFocus === "string" && (PLACE_RETURN_FOCUS_TARGETS as readonly string[]).includes(rawFocus)
      ? rawFocus as PlaceReturnFocusTargetB
      : "after19_unlock"
    const openSections = Array.from(detailRef.current?.querySelectorAll<HTMLDetailsElement>("details[data-place-return-open-section][open]") ?? [])
      .map((disclosure) => disclosure.dataset.placeReturnOpenSection)
      .filter((value): value is PlaceReturnOpenSectionB => typeof value === "string" && (PLACE_RETURN_OPEN_SECTIONS as readonly string[]).includes(value))
    const snapshotVenue = canonicalMapVenueById(currentVenueId)
    if (!snapshotVenue) return
    const camera = readPlaceReturnCamera() ?? {
      longitude: snapshotVenue.longitude,
      latitude: snapshotVenue.latitude,
      zoom: 15,
      bearing: 0,
      pitch: 0,
    }
    const privateUiSnapshot: PlaceReturnUiSnapshotInputB = {
      tokenId: returnTo.tokenId,
      venueId: currentVenueId,
      camera,
      detail: {
        sheetSnap: "detail",
        section,
        openSections,
        scrollTop: bodyRef.current?.scrollTop ?? 0,
        focus,
      },
    }
    if (requestPlaceAfter19Return(returnTo, privateUiSnapshot, now)) {
      setAfter19Handoff(true)
      return
    }
  }

  if (!visualSnapshot.expanded) return (
    <div id="canonical-place-dialog" ref={peekRef} className={styles.peek} role="dialog" aria-modal="true" aria-label={`${name.officialName} · ${name.officialNameLabel}`} aria-busy={closing ? "true" : undefined} tabIndex={-1} data-testid="canonical-place-peek" data-place-service-scroll="true" data-modal-layer-priority={ONDO_MODAL_PRIORITY.peek} data-place-presence={presenceState} data-venue-id={venue.id} onKeyDown={handlePeekKeyDown} onClickCapture={consumeClosingInput} onPointerDownCapture={consumeClosingInput} onKeyDownCapture={consumeClosingInput}>
      <div className={styles.grabber} />
      <button type="button" className={styles.close} onClick={close} aria-label={copy.close}><X size={18} /></button>
      <section className={styles.peekIdentityStage} data-testid="canonical-place-identity-stage" data-pulse-level={pulse.level}>
        <div className={styles.peekFood}><FoodPhotoB src={canonicalVenueMoodImage(venue)} locale={locale} compact /></div>
        <div className={styles.peekFoodIdentity}>
        <div className={styles.meta}><span>{district} · {category}</span><i className={styles.srOnly}>{copy.active}</i></div>
        <h2>{name.officialName}</h2>
        <div
          className={`${styles.nameProvenance} ${locale === "ko" ? styles.srOnly : ""}`}
          data-testid="canonical-name-provenance"
          aria-label={`${name.officialNameLabel}: ${name.officialName}. ${name.transliterationLabel}: ${name.transliteration}`}
        >
          <span className={styles.srOnly}>{name.officialNameLabel}</span>
          <strong>{name.transliteration}</strong>
          <small className={styles.srOnly}>{name.transliterationLabel}</small>
        </div>
        </div>
      </section>
      <SampleActivityMeterB city={venue.cityId} venueId={venue.id} locale={locale} onContribute={openLocalSignalFromPlace} contributionPosted={Boolean(pulse.localEvidence)} fallback={<section className={styles.pulsePeek} role="group" aria-label={pulseTitle} data-testid="canonical-place-pulse" data-pulse-level={pulse.level} data-pulse-numeric="hidden">
        <span className={styles.pulseVisualLabel} aria-hidden="true">{copy.temperature}</span>
        <span className={styles.pulseVisualMeter} data-testid="canonical-place-temperature-meter" aria-hidden="true"><i /></span>
        {pulse.localEvidence ? <span className={styles.srOnly} data-testid="pulse-local-device-evidence">{copy.pulseLocalEvidence} · {pulse.localEvidence.tags.map((tag) => localTagLabel(tag, locale)).join(" · ")}</span> : null}
      </section>} />
      <span
        className={styles.srOnly}
        data-testid="canonical-place-source-summary"
        data-source-presentation="nonvisual-metadata"
        data-source-contract={OFFICIAL_DIRECTORY_SOURCE_CONTRACT}
      >{copy.active}. {copy.sourceBoundary}</span>
      <PlacePeekActionsB placeId={venue.id} locale={locale} className={styles.peekActions} onOffer={openMealBenefitFromPlace}
        details={hasService => <button ref={openRef} type="button" onClick={() => { openBDiscoveryDetail(venue.id); setExpanded(true) }} data-testid="canonical-place-details" data-visual-priority={hasService ? "secondary" : "primary"}>{copy.details}<ChevronRight size={17} /></button>}
        directions={<a href={directions} target="_blank" rel="noreferrer" data-testid="canonical-venue-directions" data-visual-priority="secondary"><Navigation size={17} />{copy.directions}</a>} />
    </div>
  )

  return (
    <div id="canonical-place-dialog" ref={layerRef} className={styles.layer} role={openFact ? undefined : "dialog"} aria-modal={openFact ? undefined : "true"} aria-labelledby={openFact ? undefined : "canonical-place-title"} aria-busy={closing ? "true" : undefined} tabIndex={-1} data-testid="canonical-place-overlay" data-modal-layer-priority={ONDO_MODAL_PRIORITY.detail} data-place-presence={presenceState} data-venue-id={venue.id} data-save-state={saveStatus} data-detail-source={venue.sourceRefId} data-source-snapshot={venue.sourceSnapshotAt.slice(0, 10)} onKeyDown={handleDetailKeyDown} onClickCapture={consumeClosingInput} onPointerDownCapture={consumeClosingInput} onKeyDownCapture={consumeClosingInput}>
      <button type="button" className={styles.backdrop} onClick={closeDetails} aria-label={copy.back} tabIndex={-1} />
      <article ref={detailRef} className={styles.detail} data-place-return-sheet-snap="detail">
        <header>
          <button ref={closeRef} type="button" onClick={closeDetails} aria-label={copy.back} data-place-return-focus="detail_back"><ArrowLeft size={19} /></button>
          <span>{district}</span>
          <button type="button" onClick={close} aria-label={copy.close} data-place-return-focus="detail_close"><X size={19} /></button>
        </header>
        <div ref={bodyRef} className={styles.body} data-place-return-scroll="detail" data-place-service-scroll="true">
          <section className={styles.detailIdentityStage} data-testid="canonical-place-identity-stage" data-pulse-level={pulse.level} data-place-return-section="identity">
            <div className={styles.placeAtmosphere} data-testid="canonical-place-atmosphere" aria-hidden="true"><i /><i /><i /></div>
            <span className={styles.detailCategoryPictogram} role="img" aria-label={`${category} · ${name.officialName}`}><Utensils size={22} aria-hidden="true" /></span>
            <p className={styles.eyebrow}>{district} · {category}</p>
            <h2 id="canonical-place-title">{name.officialName}</h2>
            <div
              className={`${styles.detailNameProvenance} ${locale === "ko" ? styles.srOnly : ""}`}
              data-testid="canonical-detail-name-provenance"
              aria-label={`${name.officialNameLabel}: ${name.officialName}. ${name.transliterationLabel}: ${name.transliteration}`}
            >
              <span className={styles.srOnly}>{name.officialNameLabel}</span>
              <strong>{name.transliteration}</strong>
              <small className={styles.srOnly}>{name.transliterationLabel}</small>
            </div>
            {renderedDetailState === "error" ? (
              <section className={styles.detailError} role="alert" data-detail-state="error" data-address-truth="ERROR">
                <p><MapPin size={16} />{copy.detailUnavailable}</p>
                <button type="button" onClick={() => { setDetail(null); setDetailState("loading"); setDetailAttempt((attempt) => attempt + 1) }}>{copy.retryDetail}</button>
              </section>
            ) : (
              <p className={styles.address} role={renderedDetailState === "loading" ? "status" : undefined} aria-live={renderedDetailState === "loading" ? "polite" : undefined} data-detail-state={renderedDetailState} data-address-truth={addressEvidence?.truth ?? (renderedDetailState === "ready" ? "UNKNOWN" : renderedDetailState.toUpperCase())}><MapPin size={16} />{address}</p>
            )}
          </section>

          <details className={styles.pulsePanel} data-testid="canonical-place-pulse" data-pulse-level={pulse.level} data-pulse-numeric="hidden" data-place-return-section="temperature" data-place-return-open-section="temperature">
            <summary aria-label={pulseTitle} data-place-return-focus="temperature">
              <div><span>{copy.temperature}</span><h3 className={styles.srOnly}>{pulseTitle}</h3><span className={styles.pulseVisualMeter} data-testid="canonical-place-temperature-meter" aria-hidden="true"><i /></span></div>
              <ChevronRight size={18} aria-hidden="true" />
            </summary>
            <div className={styles.pulsePanelBody}>
            <p className={styles.pulseBoundary}>{copy.pulseBoundary}</p>
            <dl>
              {pulse.score == null ? null : <div data-testid="pulse-score"><dt>{copy.temperature}</dt><dd>{pulse.score}</dd></div>}
              {pulse.signalCount == null ? null : <div data-testid="pulse-signal-count"><dt>{copy.pulseSignals}</dt><dd>{pulse.signalCount}</dd></div>}
              <div data-testid="pulse-confidence"><dt>{copy.pulseConfidence}</dt><dd>{confidence}</dd></div>
              <div><dt>{copy.pulseFreshness}</dt><dd>{fixedSnapshot}</dd></div>
            </dl>
            <div className={styles.pulseEvidence} data-testid="pulse-evidence">
              <strong>{copy.pulseEvidence}</strong>
              <ul>{pulse.evidence.map((item, index) => <li key={`${item.origin}-${index}`} data-origin={item.origin}>{item.label[locale].replace(/walkthrough/gi, "curated visit").replace(/둘러보기/g, "방문")}</li>)}</ul>
              {pulse.localEvidence ? <p data-testid="pulse-local-device-evidence"><b>{copy.pulseLocalEvidence}</b> · {pulse.localEvidence.tags.map((tag) => localTagLabel(tag, locale)).join(" · ")} · {pulse.localEvidence.postedAt.slice(0, 16).replace("T", " ")} UTC</p> : null}
            </div>
            {pulseAlternatives.length ? (
              <section className={styles.pulseAlternatives} data-testid="pulse-too-hot">
                <h4>{copy.pulseTooHot}</h4>
                <p>{copy.pulseTooHotBody}</p>
                <div>{pulseAlternatives.map((alternative) => {
                  const alternativeVenue = canonicalMapVenueById(alternative.venueId)
                  if (!alternativeVenue) return null
                  const alternativeName = venueNamePresentation(alternativeVenue.name.ko, locale).officialName
                  return <button key={alternative.venueId} type="button" data-testid="pulse-alternative" data-venue-id={alternative.venueId} aria-label={`${copy.pulseAlternative}: ${alternativeName}, ${copy.temperature} ${alternative.score}, ${pulseLevelLabel(alternative.level, locale)}`} onClick={() => openPulseAlternative(alternative.venueId)}><span><strong>{alternativeName}</strong><small>{copy.temperature} {alternative.score} · {pulseLevelLabel(alternative.level, locale)}</small></span><ChevronRight size={17} aria-hidden="true" /></button>
                })}</div>
              </section>
            ) : null}
            </div>
          </details>

          <section className={styles.placeActions} data-testid="canonical-place-actions" aria-label={locale === "ko" ? "이 장소에서 할 수 있는 일" : locale === "ja" ? "この場所でできること" : "At this place"}>
            <PlaceServiceActionsB placeId={currentVenueId} locale={locale} onOffer={openMealBenefitFromPlace} offerTestId="canonical-meal-benefit-open" presentation="place-detail" includeGuide={false} />
            <HackathonEntitlementCtaB venueId={currentVenueId} locale={locale} />
          </section>
          <section className={styles.tripActions} data-testid="canonical-trip-actions" aria-labelledby="canonical-trip-actions-title">
            <h3 id="canonical-trip-actions-title">{locale === "ko" ? "가이드·여행 기록" : locale === "ja" ? "ガイド・旅の記録" : "Guides & memories"}</h3>
            <ExperienceEntryB placeId={currentVenueId} locale={locale} />
            <JourneyVisitEntryB key={`journey-${currentVenueId}`} locale={locale} venueId={currentVenueId} />
          </section>
          {placeTable ? (
            <section className={styles.tableActions} aria-label={copy.table} data-place-return-section="table">
              <button type="button" className={styles.tablePrimary} onClick={openTableFromPlace} data-testid="canonical-place-table" data-place-service="table">
                <UsersRound size={18} aria-hidden="true" />
                <span><strong>{copy.table}</strong><small>{tableUpcoming ? ondoBTableTimeline(placeTable, productTimeline, locale).schedule : copy.tableClosedBody}</small></span>
                <ChevronRight size={17} aria-hidden="true" />
              </button>
              {placeTable.alcohol ? <aside className={styles.eligibilityChip} data-testid="canonical-after19-required">
                <BadgeCheck size={18} aria-hidden="true" />
                <span><strong>{copy.after19}</strong><small>{copy.after19Body}</small></span>
              </aside> : null}
            </section>
          ) : null}
          <div className={styles.decisionActions} data-testid="canonical-place-decisions" data-place-return-section="decisions">
            <button type="button" onClick={toggleSave} aria-label={saved ? copy.removeSaved : copy.save} aria-pressed={saved} data-testid="canonical-venue-save" data-visual-priority="secondary" data-place-return-focus="save"><Bookmark size={18} /><span className={styles.saveActionLabel}>{saved ? copy.removeSaved : copy.save}</span></button>
            <a href={directions} target="_blank" rel="noreferrer" aria-label={copy.directions} title={copy.directions} data-testid="canonical-venue-primary-directions" data-visual-priority="secondary" data-place-return-focus="directions"><Navigation size={18} aria-hidden="true" /></a>
          </div>

          <section className={styles.before} data-testid="canonical-place-details-to-check" data-place-return-section="pre_visit" tabIndex={-1}>
            <header className={styles.beforeHeader} data-place-return-focus="pre_visit" tabIndex={-1}>
              <h3 className={styles.beforeHeading}><span>{copy.beforeTitle}</span><span className={styles.srOnly}>{copy.detailsToCheck}</span></h3>
            </header>
            <div className={styles.beforeContent}>
              {visitFacts.map((fact) => {
                const FactIcon = fact.icon
                const status = factStateLabel(fact.state, locale)
                const opened = renderedOpenFactKey === fact.key
                const disclosureId = `canonical-evidence-${fact.key}`
                return <div key={fact.key} className={styles.factRow} data-fact-key={fact.key} data-fact-state={fact.state} data-fact-open={opened ? "true" : "false"} data-source-class={fact.sourceClass}>
                  <button type="button" className={styles.factDecision} aria-label={`${fact.label}: ${status}. ${evidenceCopy[fact.sourceClass]}`} aria-expanded={opened} aria-controls={disclosureId} onClick={(event) => opened ? closeEvidence() : openEvidence(fact.key, event.currentTarget)}>
                    <span className={styles.factGlyph} aria-hidden="true"><FactIcon size={18} /><span className={styles.factStateMark}><FactStateGlyph state={fact.state} /></span></span>
                    <span className={styles.factText}>
                      <strong><span className={styles.factLongLabel} data-fact-label="long">{fact.label}</span><span className={styles.factShortLabel} data-fact-label="short">{fact.shortLabel}</span></strong>
                      {fact.sourceValue ? <small className={styles.factValue}>{fact.sourceValue}</small> : null}
                      <em className={fact.state === "unknown" ? styles.factStatusHidden : undefined} role={fact.state === "unknown" ? undefined : "status"}>{status}</em>
                    </span>
                    {fact.sourceClass === "official_directory" ? null : <span className={styles.factSource}><SourceClassGlyph sourceClass={fact.sourceClass} />{evidenceCopy[fact.sourceClass]}</span>}
                    <ChevronRight className={styles.factChevron} size={16} aria-hidden="true" />
                  </button>
                </div>
              })}
            </div>
          </section>

          <section ref={after19AccessRef} className={styles.after19Access} tabIndex={-1} aria-label={`${copy.after19Preview} · ${after19Unlocked ? copy.after19Ready : copy.after19Unlock}`} data-testid="canonical-after19-access" data-after19-focus-target="persistent" data-after19-venue-status={after19Unlocked ? "unlocked" : "locked"} data-after19-venue-id={currentVenueId} data-place-return-section="after19" data-place-return-focus="after19_access">
            <MoonStar size={18} aria-hidden="true" />
            <span>
              <strong>{copy.after19Preview}</strong>
              {after19Unlocked && isGlobalAfter19ReviewResultB(visualSnapshot.after19Session)
                ? <small data-testid="canonical-after19-review-provenance">{copy.after19Review}</small>
                : null}
            </span>
            {after19Unlocked ? <em role="status"><BadgeCheck size={15} aria-hidden="true" />{copy.after19Ready}</em> : <button type="button" onClick={openAfter19FromPlace} data-testid="canonical-after19-unlock" data-visual-priority="secondary" data-place-return-focus="after19_unlock">{copy.after19Unlock}<ChevronRight size={15} aria-hidden="true" /></button>}
          </section>

          <section className={styles.utilityActions} role="group" aria-label={copy.quickActions} data-testid="canonical-place-utilities" data-utility-layout={placeTable ? "contextual" : "standalone"} data-place-return-section="utilities">
            {placeTable ? null : (
              <button type="button" onClick={browseAllTables} data-testid="canonical-venue-tables" aria-label={copy.browseTables}>
                <UsersRound size={20} aria-hidden="true" />
                <span className={styles.utilityLabel}>{copy.browseTables}</span>
              </button>
            )}
            <button type="button" onClick={openLocalSignalFromPlace} data-testid="canonical-local-signal-open" aria-label={localSignalPosted ? copy.localSignalPosted : copy.localSignal}>
              <NotebookPen size={20} aria-hidden="true" />
              <span className={styles.utilityLabel}>{localSignalPosted ? copy.localSignalPosted : copy.localSignal}</span>
            </button>
          </section>

          {saveStatus === "SAV-FAILED" ? <section className={styles.saveError} role="alert" data-testid="canonical-save-error"><p>{copy.saveFailed}</p><button type="button" onClick={() => actions.saveVenue(currentVenueId)} data-testid="canonical-save-retry" data-visual-priority="primary">{copy.retrySave}</button></section> : null}

          <span
            className={styles.srOnly}
            data-testid="canonical-source-evidence"
            data-source-presentation="nonvisual-metadata"
            data-source-contract={OFFICIAL_DIRECTORY_SOURCE_CONTRACT}
            data-place-return-section="source"
          >{copy.active}. {copy.sourceBoundary}</span>

        </div>
      </article>
      <div
          id={openFact ? `canonical-evidence-${openFact.key}` : undefined}
          ref={evidenceLayerRef}
          className={styles.evidenceLayer}
          role={openFact ? "dialog" : undefined}
          aria-modal={openFact ? "true" : undefined}
          aria-labelledby={openFact ? evidenceTitleId : undefined}
          data-testid="canonical-evidence-drawer"
          data-fact-key={openFact?.key}
          data-fact-state={openFact?.state}
          data-source-class={openFact?.sourceClass}
          data-modal-layer-priority={ONDO_MODAL_PRIORITY.fullTask}
          hidden={!openFact}
          onKeyDown={handleEvidenceKeyDown}
        >
        {openFact ? <>
          <div className={styles.evidenceBackdrop} aria-hidden="true" onClick={closeEvidence} />
          <section className={styles.evidenceDrawer} data-testid="canonical-evidence-sheet">
            <header>
              <span className={styles.evidenceSourceGlyph}><SourceClassGlyph sourceClass={openFact.sourceClass} /></span>
              <div><small data-testid="canonical-evidence-venue">{name.officialName} · {evidenceCopy.title}</small><h3 id={evidenceTitleId}>{openFact.label}</h3></div>
              <button ref={evidenceCloseRef} type="button" aria-label={evidenceCopy.close} onClick={closeEvidence}><X size={20} aria-hidden="true" /></button>
            </header>
            <div className={styles.evidenceDrawerBody}>
              <p className={styles.evidenceState} role="status" aria-live="polite" aria-atomic="true" data-evidence-state={openFact.state}>
                <span aria-hidden="true"><FactStateGlyph state={openFact.state} /></span>
                <strong>{factStateLabel(openFact.state, locale)}</strong>
              </p>
              {openFact.sourceValue ? <section className={styles.evidenceValue}><small>{evidenceCopy.value}</small><strong>{openFact.sourceValue}</strong></section> : null}
              <dl className={styles.evidenceMeta}>
                <div><dt>{evidenceCopy.source}</dt><dd><SourceClassGlyph sourceClass={openFact.sourceClass} />{evidenceCopy[openFact.sourceClass]}</dd></div>
                <div><dt>{evidenceCopy.observed}</dt><dd>{openFact.observedAt.slice(0, 10)}</dd></div>
                <div><dt>{evidenceCopy.freshness}</dt><dd>{openFact.freshness === "stale" ? evidenceCopy.stale : evidenceCopy.current}</dd></div>
              </dl>
              <p className={styles.evidenceBoundary}>{openFact.sourceClass === "official_directory" ? copy.factSourceBoundary : sourceClassNote(openFact.sourceClass, locale)}</p>
              {openFact.state === "error" && openFact.recoverable ? <button type="button" className={styles.evidenceRetry} data-testid="canonical-evidence-retry" onClick={() => retryEvidence(openFact.key)}><RotateCcw size={17} aria-hidden="true" />{evidenceCopy.retry}</button> : null}
            </div>
          </section>
        </> : null}
      </div>
    </div>
  )
}
