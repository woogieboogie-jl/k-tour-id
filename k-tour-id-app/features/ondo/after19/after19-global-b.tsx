"use client"

import type { KeyboardEvent, SyntheticEvent } from "react"
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { AlertTriangle, ChevronRight, LoaderCircle, MapPin, MoonStar, RotateCcw, X } from "lucide-react"
import { canonicalMapVenueById } from "@/lib/ondo/venues/map-data"
import { venueDisplayName } from "@/lib/ondo/venues/display"
import { readBDiscoveryHistory, restoreBDiscoveryCityContext, restoreBDiscoveryVenueContext } from "../map/b-discovery-history"
import {
  dispatchPlaceReturnUiRestore,
  type PlaceReturnUiSnapshotB,
} from "../map/place-return-ui-snapshot-b"
import type { OndoBLocale } from "../shared/state/ondo-b-preferences"
import { isRenderedFocusable } from "../shared/ui/is-rendered-focusable"
import { ONDO_MODAL_PRIORITY } from "../shared/ui/modal-layer-priority"
import { useDocumentScrollLock, useModalIsolation } from "../shared/ui/use-modal-isolation"
import { useSheetPresence } from "../shared/ui/use-sheet-presence"
import { readQaRuntime, useQaControls } from "../shared/ui/use-qa-controls"
import { createReviewFixtureAuthority, localActual, providerUnavailable, reviewFixture } from "../contracts/execution-mode"
import {
  canAutoOpenGlobalAfter19B,
  completeGlobalAfter19LocalConfirmationB,
  completeGlobalAfter19ReviewB,
  DEFAULT_GLOBAL_AFTER19_PREFERENCE,
  DEFAULT_GLOBAL_AFTER19_SESSION,
  GLOBAL_AFTER19_PREFERENCE_KEY,
  GLOBAL_AFTER19_SESSION_EVENT,
  GLOBAL_AFTER19_SESSION_KEY,
  isGlobalAfter19AgeCurrent,
  isGlobalAfter19NightViewCurrent,
  persistGlobalAfter19SessionB,
  rollbackPersistedGlobalAfter19SessionB,
  restoreGlobalAfter19B,
  sanitizeGlobalAfter19Session,
  type GlobalAfter19PreferenceB,
  type GlobalAfter19SessionB,
} from "./after19-global-b-model"
import {
  completePlaceAfter19Return,
  isPlaceAfter19ReturnPending,
  PLACE_AFTER19_RETURN_REQUEST_EVENT,
  renewPlaceAfter19Return,
  renewPreparedPlaceAfter19Return,
  restorePlaceAfter19ReturnSession,
  type PlaceAfter19ReturnB,
  type PlaceAfter19ReturnOutcomeB,
} from "./after19-place-return-b-model"
import { readGuestAfter19MemoryB, writeGuestAfter19MemoryB } from "./after19-guest-memory-b"
import styles from "./after19-global-b.module.css"

export type GlobalAfter19ContextB = {
  cityId: "seoul" | "busan" | "jeju"
  cityLabel: string
  venueId: string | null
  venueLabel: string | null
}

type GlobalAfter19BProps = {
  locale: OndoBLocale
  context: GlobalAfter19ContextB
  accountActive?: boolean
  noticeTarget?: HTMLElement | null
  onActiveChange?(active: boolean, activation: GlobalAfter19SessionB["activation"]): void
  hideTrigger?: boolean
  externalOpenRequest?: number
  returnFocusSelector?: string
}

type Notice = "off" | "expired" | null
type GateView = "intro" | "pending" | "failure" | "unavailable" | "expired" | "checkExpired"

type GlobalAfter19GatePresentationB = Readonly<{
  key: string
  locale: OndoBLocale
  context: GlobalAfter19ContextB
  gateView: GateView
  placeReturn: PlaceAfter19ReturnB | null
  preference: GlobalAfter19PreferenceB
  reviewRequested: boolean
  reviewResult: boolean
}>

type GlobalAfter19ExitIntentB =
  | Readonly<{ kind: "opener"; opener: HTMLElement | null; venueId: string | null }>
  | Readonly<{ kind: "active-control" }>
  | Readonly<{
      kind: "place"
      returnTo: PlaceAfter19ReturnB
      exactVenue: boolean
      uiSnapshot: PlaceReturnUiSnapshotB
    }>

type GlobalAfter19ExitPlanB = GlobalAfter19ExitIntentB & Readonly<{ serial: number }>

const FOCUSABLE = "button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex='-1'])"
const REVIEW_CHECK_DELAY_MS = 900
const EXIT_FOCUS_RETRY_MS = 50
const EXIT_FOCUS_RETRY_LIMIT = 24

const COPY = {
  en: {
    chip: "19+",
    chipLabel: "Open After 19",
    active: "After 19",
    activeAuto: "Opened after 19:00 KST",
    activeManual: "On now",
    turnOff: "Turn off After 19 now",
    title: "Night view",
    body: "See places that fit a night out on this map.",
    checkingTitle: "Opening night view",
    checkingBody: "One moment…",
    close: "Close 19+ check",
    jejuBody: "Switch this Jeju map to night view.",
    truth: "Category does not confirm opening hours or alcohol service.",
    jejuTruth: "Jeju keeps the same places and stories in its night view.",
    context: "Return to",
    venue: "Selected place",
    city: "Current map",
    boundary: "Before you continue",
    boundaryBody: "This choice opens night view in this tab. Your birth date is not stored.",
    auto: "Open after 19:00 KST once turned on",
    primary: "I’m 19 or older",
    cancel: "Not now",
    generalMap: "Keep browsing",
    generalPlace: "View general details",
    failedTitle: "Couldn't confirm 19+",
    failedBody: "Your place and map are still here.",
    unavailableTitle: "19+ isn't available yet",
    unavailableBody: "You can keep browsing the same place and map.",
    checkExpiredTitle: "Confirmation expired",
    checkExpiredBody: "Try again or keep browsing this place.",
    expiredReturnTitle: "This return request expired",
    expiredReturnBody: "Check 19+ again or stay with the restored Place context.",
    missingVenue: "That place is no longer available. Return to the same city discovery view.",
    retry: "Try again",
    reviewResult: "Review result · no external check",
    reviewScope: "Review only · no external check",
    reviewDetailsTitle: "Review details",
    openReviewDetails: "Open review details",
    closeReviewDetails: "Close review details",
    reviewMode: "Mode",
    reviewReference: "Reference",
    reviewExpires: "Expires",
    turnOffAction: "Turn off",
    offNotice: "After 19 is off for this tab and will not reopen automatically.",
    undo: "Turn back on",
    expired: "The 19+ result expired. The same map remains open.",
    checkAgain: "Check again",
    dismiss: "Dismiss",
  },
  ko: {
    chip: "19+",
    chipLabel: "After 19 열기",
    active: "After 19",
    activeAuto: "한국 시간 19:00 이후 자동으로 열림",
    activeManual: "지금 켜짐",
    turnOff: "After 19 바로 끄기",
    title: "밤 지도",
    body: "지금 지도에서 밤에 어울리는 장소만 모아봐요.",
    checkingTitle: "밤 지도를 여는 중",
    checkingBody: "잠시만 기다려 주세요…",
    close: "19+ 확인 닫기",
    jejuBody: "제주 지도를 밤 보기로 전환해요.",
    truth: "영업시간과 주류 제공 여부는 장소에서 확인해 주세요.",
    jejuTruth: "제주의 장소와 이야기는 밤 보기에서도 그대로 유지돼요.",
    context: "돌아갈 곳",
    venue: "선택한 장소",
    city: "현재 지도",
    boundary: "계속하기 전에",
    boundaryBody: "이 선택은 이 탭에서만 밤 지도를 열어요. 생년월일은 저장하지 않아요.",
    auto: "한 번 켠 뒤 한국 시간 19:00 이후 자동으로 열기",
    primary: "만 19세 이상이에요",
    cancel: "나중에",
    generalMap: "계속 둘러보기",
    generalPlace: "일반 정보 보기",
    failedTitle: "19+를 확인하지 못했어요",
    failedBody: "장소와 지도는 그대로예요.",
    unavailableTitle: "아직 19+ 확인을 연결할 수 없어요",
    unavailableBody: "같은 장소와 지도를 계속 둘러볼 수 있어요.",
    checkExpiredTitle: "확인이 만료됐어요",
    checkExpiredBody: "다시 확인하거나 이 장소를 계속 둘러보세요.",
    expiredReturnTitle: "장소 복귀 요청이 만료됐어요",
    expiredReturnBody: "19+를 다시 확인하거나 복구된 장소 탐색 화면에 머물 수 있어요.",
    missingVenue: "해당 장소를 더 이상 찾을 수 없어 같은 도시의 탐색 화면으로 돌아갑니다.",
    retry: "다시 시도",
    reviewResult: "검토용 결과 · 외부 확인 없음",
    reviewScope: "검토 전용 · 외부 확인 없음",
    reviewDetailsTitle: "검토 정보",
    openReviewDetails: "검토 정보 열기",
    closeReviewDetails: "검토 정보 닫기",
    reviewMode: "방식",
    reviewReference: "참조",
    reviewExpires: "만료",
    turnOffAction: "끄기",
    offNotice: "이 탭에서 After 19를 껐으며 자동으로 다시 열리지 않습니다.",
    undo: "다시 켜기",
    expired: "19+ 결과가 만료됐어요. 같은 지도는 그대로 열려 있습니다.",
    checkAgain: "다시 확인",
    dismiss: "닫기",
  },
  ja: {
    chip: "19+",
    chipLabel: "After 19を開く",
    active: "After 19",
    activeAuto: "韓国時間19:00以降に自動で開始",
    activeManual: "現在オン",
    turnOff: "After 19を今すぐオフにする",
    title: "夜の地図",
    body: "この地図のまま、夜のお出かけに合う場所を表示します。",
    checkingTitle: "夜の地図を開いています",
    checkingBody: "少しお待ちください…",
    close: "19歳以上の確認を閉じる",
    jejuBody: "済州の地図を夜表示に切り替えます。",
    truth: "営業時間や酒類提供の有無は各店舗でご確認ください。",
    jejuTruth: "済州の場所とストーリーは夜表示でもそのまま残ります。",
    context: "戻る場所",
    venue: "選択中の場所",
    city: "現在の地図",
    boundary: "続ける前に",
    boundaryBody: "この選択は、このタブで夜の地図を開くためだけに使います。生年月日は保存しません。",
    auto: "一度オンにした後、韓国時間19:00以降に自動で開く",
    primary: "19歳以上です",
    cancel: "あとで",
    generalMap: "このまま見る",
    generalPlace: "通常情報を見る",
    failedTitle: "19歳以上を確認できませんでした",
    failedBody: "場所と地図はそのままです。",
    unavailableTitle: "現在は19歳以上を確認できません",
    unavailableBody: "同じ場所と地図をそのまま見られます。",
    checkExpiredTitle: "確認の有効期限が切れました",
    checkExpiredBody: "もう一度確認するか、この場所をそのまま見られます。",
    expiredReturnTitle: "場所への復帰リクエストの有効期限が切れました",
    expiredReturnBody: "19歳以上をもう一度確認するか、復元した場所の探索画面にとどまれます。",
    missingVenue: "この場所は利用できなくなったため、同じ都市の探索画面に戻ります。",
    retry: "もう一度試す",
    reviewResult: "レビュー用結果 · 外部確認なし",
    reviewScope: "レビュー専用 · 外部確認なし",
    reviewDetailsTitle: "レビュー情報",
    openReviewDetails: "レビュー情報を開く",
    closeReviewDetails: "レビュー情報を閉じる",
    reviewMode: "方式",
    reviewReference: "参照",
    reviewExpires: "有効期限",
    turnOffAction: "オフにする",
    offNotice: "このタブではAfter 19をオフにし、自動では再開しません。",
    undo: "もう一度オンにする",
    expired: "19+結果の有効期限が切れました。同じ地図は開いたままです。",
    checkAgain: "もう一度確認",
    dismiss: "閉じる",
  },
} as const satisfies Record<OndoBLocale, Record<string, string>>

function writeStorage(storage: Storage, key: string, value: unknown) {
  try {
    storage.setItem(key, JSON.stringify(value))
  } catch {
    // The in-memory tab state remains usable when browser storage is blocked.
  }
}

function removeStorage(storage: Storage, key: string) {
  try {
    storage.removeItem(key)
  } catch {
    // The in-memory current action remains usable when browser storage is blocked.
  }
}

function hasOperableFocus() {
  const active = document.activeElement
  return active instanceof HTMLElement
    && active !== document.body
    && active !== document.documentElement
    && active.isConnected
    && !active.closest("[inert],[aria-hidden='true']")
}

function isVisibleDestination(element: HTMLElement) {
  if (!element.isConnected || element.closest("[hidden],[inert],[aria-hidden='true']")) return false
  const style = window.getComputedStyle(element)
  return style.display !== "none"
    && style.visibility !== "hidden"
    && style.visibility !== "collapse"
    && element.getClientRects().length > 0
}

function focusVisibleDestination(element: HTMLElement) {
  if (!isVisibleDestination(element)) return false
  const previousTabIndex = element.getAttribute("tabindex")
  if (element.tabIndex < 0) element.setAttribute("tabindex", "-1")
  element.focus({ preventScroll: true })
  if (document.activeElement !== element) {
    if (previousTabIndex == null) element.removeAttribute("tabindex")
    else element.setAttribute("tabindex", previousTabIndex)
    return false
  }
  if (previousTabIndex == null) {
    element.addEventListener("blur", () => element.removeAttribute("tabindex"), { once: true })
  }
  return true
}

export function GlobalAfter19B({ locale, context, accountActive = false, onActiveChange, noticeTarget = null, hideTrigger = false, externalOpenRequest, returnFocusSelector }: GlobalAfter19BProps) {
  const reviewMode = useQaControls()
  const [hydrated, setHydrated] = useState(false)
  const [preference, setPreference] = useState<GlobalAfter19PreferenceB>(DEFAULT_GLOBAL_AFTER19_PREFERENCE)
  const [session, setSession] = useState<GlobalAfter19SessionB>(DEFAULT_GLOBAL_AFTER19_SESSION)
  const [clock, setClock] = useState(() => new Date())
  const [gateOpen, setGateOpen] = useState(false)
  const [gateView, setGateView] = useState<GateView>("intro")
  const [placeReturn, setPlaceReturn] = useState<PlaceAfter19ReturnB | null>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const [reviewDetailsOpen, setReviewDetailsOpen] = useState(false)
  const layerRef = useRef<HTMLDivElement | null>(null)
  const dialogRef = useRef<HTMLElement | null>(null)
  const chipRef = useRef<HTMLButtonElement | null>(null)
  const primaryRef = useRef<HTMLButtonElement | null>(null)
  const headingRef = useRef<HTMLHeadingElement | null>(null)
  const activeOffRef = useRef<HTMLButtonElement | null>(null)
  const reviewToggleRef = useRef<HTMLButtonElement | null>(null)
  const reviewDetailsRef = useRef<HTMLElement | null>(null)
  const reviewDetailsCloseRef = useRef<HTMLButtonElement | null>(null)
  const reviewContextRef = useRef(`${context.cityId}:${context.venueId ?? "none"}`)
  const openerRef = useRef<HTMLElement | null>(null)
  const externalRequestRef = useRef(externalOpenRequest)
  const pendingTimerRef = useRef<number | null>(null)
  const gateOpenRef = useRef(gateOpen)
  const gateLifecycleSerialRef = useRef(0)
  const gateExitPlanRef = useRef<GlobalAfter19ExitPlanB | null>(null)
  const t = COPY[locale]
  const reviewReceipt = session.eligibilityReceipt?.issuerType === "REVIEW_FIXTURE"
    ? session.eligibilityReceipt
    : null
  const reviewResult = Boolean(reviewReceipt && isGlobalAfter19AgeCurrent(session, clock))
  const liveReviewRequested = reviewMode
    && readQaRuntime<{ after19Global?: "success" | "failure" | "unavailable" | "expired" }>()?.after19Global !== undefined
  const desiredGatePresentation = useMemo<GlobalAfter19GatePresentationB | null>(() => gateOpen ? {
    key: placeReturn ? `return:${placeReturn.tokenId}` : `direct:${context.cityId}:${context.venueId ?? "none"}`,
    locale,
    context: { ...context },
    gateView,
    placeReturn: placeReturn ? { ...placeReturn, gateQueue: ["age"] } : null,
    preference: { ...preference },
    reviewRequested: liveReviewRequested,
    reviewResult,
  } : null, [context.cityId, context.cityLabel, context.venueId, context.venueLabel, gateOpen, gateView, liveReviewRequested, locale, placeReturn, preference, reviewResult])
  const gatePresence = useSheetPresence(desiredGatePresentation)
  const gatePresentation = gatePresence.value
  const gateClosing = gatePresence.phase === "closing"

  gateOpenRef.current = gateOpen

  useModalIsolation(Boolean(gatePresentation), layerRef)
  useDocumentScrollLock(Boolean(gatePresentation))

  useEffect(() => {
    const now = new Date()
    const restored = restoreGlobalAfter19B(window.localStorage, accountActive ? window.sessionStorage : null, now, { allowReviewFixture: reviewMode })
    setPreference(restored.preference)
    const restoredSession = accountActive
      ? restored.session
      : readGuestAfter19MemoryB(now, { allowReviewFixture: reviewMode })
    setSession(restoredSession)
    setNotice(restoredSession.expiryNotice ? "expired" : null)
    writeStorage(window.localStorage, GLOBAL_AFTER19_PREFERENCE_KEY, restored.preference)
    if (accountActive) writeStorage(window.sessionStorage, GLOBAL_AFTER19_SESSION_KEY, restoredSession)
    else removeStorage(window.sessionStorage, GLOBAL_AFTER19_SESSION_KEY)
    const restoredReturn = restorePlaceAfter19ReturnSession(window.sessionStorage)
    if (restoredReturn.publicEnvelope) {
      gateOpenRef.current = true
      gateLifecycleSerialRef.current += 1
      gateExitPlanRef.current = null
      setPlaceReturn(restoredReturn.publicEnvelope)
      setGateView(isPlaceAfter19ReturnPending(restoredReturn.publicEnvelope) ? "intro" : "expired")
      setGateOpen(true)
    }
    setHydrated(true)
  }, [accountActive, reviewMode])

  useEffect(() => {
    if (!hydrated) return
    const now = new Date()
    const next = accountActive
      ? restoreGlobalAfter19B(window.localStorage, window.sessionStorage, now, { allowReviewFixture: reviewMode }).session
      : readGuestAfter19MemoryB(now, { allowReviewFixture: reviewMode })
    setSession(next)
    if (!accountActive) removeStorage(window.sessionStorage, GLOBAL_AFTER19_SESSION_KEY)
  }, [accountActive, hydrated, reviewMode])

  useEffect(() => {
    const requested = (event: Event) => {
      const tokenId = event instanceof CustomEvent ? (event.detail as { tokenId?: unknown } | null)?.tokenId : null
      const now = new Date()
      const restored = restorePlaceAfter19ReturnSession(window.sessionStorage, now)
      if (!restored.publicEnvelope || restored.publicEnvelope.tokenId !== tokenId) return
      clearPendingCheck()
      gateOpenRef.current = true
      gateLifecycleSerialRef.current += 1
      gateExitPlanRef.current = null
      setClock(now)
      setPlaceReturn(restored.publicEnvelope)
      setGateView(isPlaceAfter19ReturnPending(restored.publicEnvelope, now) ? "intro" : "expired")
      setNotice(null)
      setGateOpen(true)
    }
    window.addEventListener(PLACE_AFTER19_RETURN_REQUEST_EVENT, requested)
    return () => window.removeEventListener(PLACE_AFTER19_RETURN_REQUEST_EVENT, requested)
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const syncSession = (event: Event) => {
      const now = new Date()
      const detail = event instanceof CustomEvent ? event.detail : null
      const restoredSession = !accountActive && detail
        ? writeGuestAfter19MemoryB(detail, now, { allowReviewFixture: reviewMode })
        : restoreGlobalAfter19B(window.localStorage, accountActive ? window.sessionStorage : null, now, { allowReviewFixture: reviewMode }).session
      setClock(now)
      setSession(restoredSession)
      setNotice(restoredSession.expiryNotice ? "expired" : null)
      if (accountActive) writeStorage(window.sessionStorage, GLOBAL_AFTER19_SESSION_KEY, restoredSession)
      else removeStorage(window.sessionStorage, GLOBAL_AFTER19_SESSION_KEY)
    }
    window.addEventListener(GLOBAL_AFTER19_SESSION_EVENT, syncSession)
    return () => window.removeEventListener(GLOBAL_AFTER19_SESSION_EVENT, syncSession)
  }, [accountActive, reviewMode])

  useEffect(() => {
    if (!hydrated) return
    onActiveChange?.(session.mode === "on", session.activation)
  }, [hydrated, onActiveChange, session.activation, session.mode])

  useEffect(() => {
    if (!hydrated || externalOpenRequest === undefined || externalRequestRef.current === externalOpenRequest) return
    externalRequestRef.current = externalOpenRequest
    if (session.mode === "on") {
      if (hideTrigger) turnOff()
      else if (reviewResult) openReviewDetails()
      else turnOff()
    } else {
      openGate()
    }
  }, [externalOpenRequest, hydrated, reviewResult, session.mode])

  useEffect(() => {
    if (!hydrated) return
    if (session.age === "eligible" && !isGlobalAfter19NightViewCurrent(session, clock)) {
      commitSession({
        version: 1,
        age: "unverified",
        ageExpiresAt: null,
        eligibilityReceipt: null,
        mode: "off",
        activation: null,
        expiryNotice: true,
      })
      setNotice("expired")
      return
    }
    const autoEligible = canAutoOpenGlobalAfter19B(preference, session, clock)
    if (session.mode === "off" && autoEligible) {
      commitSession({ ...session, mode: "on", activation: "auto", expiryNotice: false })
    } else if (session.mode === "on" && session.activation === "auto" && !autoEligible) {
      commitSession({ ...session, mode: "off", activation: null })
    }
  }, [clock, hydrated, preference, session])

  useEffect(() => {
    if (placeReturn && !isPlaceAfter19ReturnPending(placeReturn, clock)) setGateView("expired")
  }, [clock, placeReturn])

  useEffect(() => {
    if (!gateOpen || gatePresence.phase !== "open" || !gatePresentation) return
    const frame = window.requestAnimationFrame(() => {
      const target = gatePresentation.gateView === "intro" ? primaryRef.current : headingRef.current
      target?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [gateOpen, gatePresence.phase, gatePresentation?.gateView, gatePresentation?.key])

  useEffect(() => () => {
    if (pendingTimerRef.current !== null) window.clearTimeout(pendingTimerRef.current)
  }, [])

  useEffect(() => {
    if (!gateOpen) return
    const ownEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || !dialogRef.current?.contains(document.activeElement)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      cancelGate()
    }
    document.addEventListener("keydown", ownEscape, true)
    return () => document.removeEventListener("keydown", ownEscape, true)
  }, [gateOpen, placeReturn])

  useLayoutEffect(() => {
    if (!gateClosing) return
    const consumeClosingKey = (event: globalThis.KeyboardEvent) => {
      const layer = layerRef.current
      if (!layer || layer.closest("[inert],[aria-hidden='true']")) return
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    window.addEventListener("keydown", consumeClosingKey, true)
    return () => window.removeEventListener("keydown", consumeClosingKey, true)
  }, [gateClosing])

  useEffect(() => {
    if (gatePresence.value !== null) return
    const plan = gateExitPlanRef.current
    if (!plan || gateOpenRef.current || plan.serial !== gateLifecycleSerialRef.current) return
    gateExitPlanRef.current = null
    let frame: number | null = null
    let timer: number | null = null
    let attempts = 0
    let exactUiRestored = false

    const restoreAfterRemoval = () => {
      frame = null
      timer = null
      if (gateOpenRef.current || plan.serial !== gateLifecycleSerialRef.current) return

      if (plan.kind === "place" && plan.exactVenue && !exactUiRestored) {
        exactUiRestored = true
        if (dispatchPlaceReturnUiRestore(plan.uiSnapshot, new Date())) return
      }

      if (hasOperableFocus()) return
      const exact = plan.kind === "opener"
        ? plan.opener
        : plan.kind === "active-control"
          ? reviewToggleRef.current ?? activeOffRef.current
          : null
      if (exact && isRenderedFocusable(exact)) {
        exact.focus({ preventScroll: true })
        if (document.activeElement === exact) return
      }

      const history = readBDiscoveryHistory()
      const venueSelector = plan.kind === "place"
        ? `[data-testid='canonical-after19-access'][data-after19-venue-id='${CSS.escape(plan.returnTo.venueId)}']`
        : plan.kind === "opener" && plan.venueId
          ? `[data-testid='canonical-after19-access'][data-after19-venue-id='${CSS.escape(plan.venueId)}']`
          : null
      const selectors = [
        venueSelector,
        plan.kind === "active-control" ? "[data-testid='global-after19-review-toggle']" : null,
        plan.kind === "active-control" ? "[data-testid='global-after19-banner'] button" : null,
        "[data-testid='global-after19-toggle']",
        plan.kind === "place" && history?.view === "list" ? "[data-testid='ondo-b-search']" : "[data-testid='ondo-b-view-toggle']",
        "[aria-current='page']",
        "#ondo-active-panel",
      ].filter((selector): selector is string => Boolean(selector))
      for (const selector of selectors) {
        const destination = Array.from(document.querySelectorAll<HTMLElement>(selector)).find(isVisibleDestination)
        if (destination && focusVisibleDestination(destination)) return
      }

      attempts += 1
      if (attempts < EXIT_FOCUS_RETRY_LIMIT) timer = window.setTimeout(restoreAfterRemoval, EXIT_FOCUS_RETRY_MS)
    }

    frame = window.requestAnimationFrame(restoreAfterRemoval)
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame)
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [gatePresence.value])

  useEffect(() => {
    if (!reviewDetailsOpen) return
    const frame = window.requestAnimationFrame(() => reviewDetailsCloseRef.current?.focus({ preventScroll: true }))
    const ownEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || !reviewDetailsRef.current?.contains(document.activeElement)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      closeReviewDetails(true)
    }
    document.addEventListener("keydown", ownEscape, true)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener("keydown", ownEscape, true)
    }
  }, [reviewDetailsOpen])

  useEffect(() => {
    const nextContext = `${context.cityId}:${context.venueId ?? "none"}`
    if (reviewContextRef.current === nextContext) return
    reviewContextRef.current = nextContext
    if (!reviewDetailsOpen) return
    setReviewDetailsOpen(false)
    window.requestAnimationFrame(() => {
      const target = reviewToggleRef.current ?? activeOffRef.current ?? chipRef.current
      target?.focus({ preventScroll: true })
    })
  }, [context.cityId, context.venueId])

  useEffect(() => {
    if (!reviewDetailsOpen || (session.mode === "on" && reviewResult)) return
    setReviewDetailsOpen(false)
    window.requestAnimationFrame(() => {
      const target = reviewToggleRef.current ?? activeOffRef.current ?? chipRef.current
      target?.focus({ preventScroll: true })
    })
  }, [reviewDetailsOpen, reviewResult, session.mode])

  function commitSession(next: GlobalAfter19SessionB, now = new Date(), accountAlreadyPersisted = false) {
    const canonical = sanitizeGlobalAfter19Session(next, now, { allowReviewFixture: reviewMode })
    if (JSON.stringify(canonical) !== JSON.stringify(next)) return false
    if (accountActive && !accountAlreadyPersisted && !persistGlobalAfter19SessionB(window.sessionStorage, canonical, now, { allowReviewFixture: reviewMode })) return false
    const committed = accountActive
      ? canonical
      : writeGuestAfter19MemoryB(canonical, now, { allowReviewFixture: reviewMode })
    setSession(committed)
    if (!accountActive) {
      removeStorage(window.sessionStorage, GLOBAL_AFTER19_SESSION_KEY)
    }
    window.dispatchEvent(new CustomEvent(GLOBAL_AFTER19_SESSION_EVENT, { detail: committed }))
    return true
  }

  function commitPreference(next: GlobalAfter19PreferenceB) {
    setPreference(next)
    writeStorage(window.localStorage, GLOBAL_AFTER19_PREFERENCE_KEY, next)
  }

  function resolveExternalOpener() {
    const selector = returnFocusSelector?.trim()
    if (selector) {
      try {
        const target = document.querySelector<HTMLElement>(selector)
        if (target && isRenderedFocusable(target)) return target
      } catch {
        // An invalid optional integration selector must not block the gate.
      }
    }
    return document.activeElement instanceof HTMLElement ? document.activeElement : chipRef.current
  }

  function openGate() {
    clearPendingCheck()
    gateOpenRef.current = true
    gateLifecycleSerialRef.current += 1
    gateExitPlanRef.current = null
    openerRef.current = resolveExternalOpener()
    setPlaceReturn(null)
    setGateView("intro")
    setNotice(null)
    setGateOpen(true)
  }

  function beginGateExit(intent: GlobalAfter19ExitIntentB) {
    clearPendingCheck()
    gateOpenRef.current = false
    const serial = gateLifecycleSerialRef.current + 1
    gateLifecycleSerialRef.current = serial
    gateExitPlanRef.current = { ...intent, serial } as GlobalAfter19ExitPlanB
    setGateOpen(false)
  }

  function openReviewDetails() {
    setReviewDetailsOpen(true)
  }

  function closeReviewDetails(restoreFocus: boolean) {
    setReviewDetailsOpen(false)
    if (!restoreFocus) return
    window.requestAnimationFrame(() => {
      const target = reviewToggleRef.current ?? (returnFocusSelector ? resolveExternalOpener() : null)
      target?.focus({ preventScroll: true })
    })
  }

  function clearPendingCheck() {
    if (pendingTimerRef.current === null) return
    window.clearTimeout(pendingTimerRef.current)
    pendingTimerRef.current = null
  }

  function cancelGate() {
    clearPendingCheck()
    if (placeReturn) {
      finishPlaceReturn("cancel")
      return
    }
    beginGateExit({ kind: "opener", opener: openerRef.current, venueId: context.venueId })
  }

  function finishConfirmedCheck(nextSession: GlobalAfter19SessionB, completedAt: Date) {
    if (placeReturn) {
      const venue = canonicalMapVenueById(placeReturn.venueId)
      if (!venue) {
        finishPlaceReturn("cancel", completedAt)
        return
      }
      const accountPersistence = accountActive
        ? persistGlobalAfter19SessionB(window.sessionStorage, nextSession, completedAt, { allowReviewFixture: reviewMode })
        : null
      if (accountActive && !accountPersistence) {
        setGateView("failure")
        return
      }
      if (!finishPlaceReturn("success", completedAt)) {
        if (accountPersistence) rollbackPersistedGlobalAfter19SessionB(window.sessionStorage, accountPersistence)
        return
      }
      if (!commitSession(nextSession, completedAt, accountActive)) setGateView("failure")
      return
    }
    if (!commitSession(nextSession, completedAt)) {
      setGateView("failure")
      return
    }
    beginGateExit({ kind: "active-control" })
  }

  function runCheck() {
    if (gateView === "pending") return
    const checkSerial = gateLifecycleSerialRef.current
    const now = new Date()
    setClock(now)
    if (placeReturn && !isPlaceAfter19ReturnPending(placeReturn, now)) {
      setGateView("expired")
      return
    }
    const qa = readQaRuntime<{ after19Global?: "success" | "failure" | "unavailable" | "expired" }>()
    const qaOutcome = qa?.after19Global
    setGateView("pending")
    clearPendingCheck()
    pendingTimerRef.current = window.setTimeout(() => {
      pendingTimerRef.current = null
      if (!gateOpenRef.current || gateLifecycleSerialRef.current !== checkSerial) return
      const completedAt = new Date()
      setClock(completedAt)
      if (placeReturn && !isPlaceAfter19ReturnPending(placeReturn, completedAt)) {
        setGateView("expired")
        return
      }
      if (!qaOutcome) {
        const execution = localActual("age_declaration", { predicate: "AGE_GTE_19" as const, outcome: "eligible" as const })
        finishConfirmedCheck(completeGlobalAfter19LocalConfirmationB(execution, completedAt), completedAt)
        return
      }
      if (qaOutcome === "unavailable") {
        const unavailable = providerUnavailable("age")
        if (unavailable.result === "PROVIDER_UNAVAILABLE") setGateView("unavailable")
        return
      }
      const authority = createReviewFixtureAuthority({
        qaRuntimeEnabled: reviewMode,
        explicitlyRequested: reviewMode,
        fixtureId: "FX-AGE-GLOBAL-001",
      })
      if (!authority) {
        setGateView("unavailable")
        return
      }
      if (qaOutcome !== "success") {
        const execution = reviewFixture(authority, { outcome: qaOutcome, now: completedAt })
        setGateView(execution.result === "FIXTURE_FAILURE" ? "failure" : execution.result === "FIXTURE_EXPIRED" ? "checkExpired" : "unavailable")
        return
      }
      const execution = reviewFixture(authority, {
        outcome: "success",
        value: { predicate: "AGE_GTE_19" as const, outcome: "eligible" as const },
        now: completedAt,
      })
      const nextSession = completeGlobalAfter19ReviewB(execution, completedAt)
      finishConfirmedCheck(nextSession, completedAt)
    }, REVIEW_CHECK_DELAY_MS)
  }

  function restorePlaceContext(returnTo: PlaceAfter19ReturnB) {
    const venue = canonicalMapVenueById(returnTo.venueId)
    const history = readBDiscoveryHistory()
    const fallbackCity = venue?.cityId ?? history?.city ?? context.cityId
    const fallbackView = history?.city === fallbackCity ? history.view : "map"
    const fallbackQuery = history?.city === fallbackCity ? history.query : ""
    const fallbackCategory = history?.city === fallbackCity ? history.category : "all"
    const exactHistory = venue && history?.city === venue.cityId && history.venueId === returnTo.venueId
      ? history
      : null
    const restored = venue && exactHistory
      ? restoreBDiscoveryVenueContext({
          city: venue.cityId,
          view: exactHistory.view,
          query: exactHistory.query,
          category: exactHistory.category,
          venueId: returnTo.venueId,
          level: "detail",
        })
      : restoreBDiscoveryCityContext({
          city: fallbackCity,
          view: fallbackView,
          query: fallbackQuery,
          category: fallbackCategory,
          focus: fallbackView === "list" ? "search" : "view-toggle",
        })
    if (restored) window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }))
    return Boolean(restored && venue && exactHistory)
  }

  function finishPlaceReturn(outcome: PlaceAfter19ReturnOutcomeB, now = new Date()) {
    clearPendingCheck()
    if (!placeReturn) return false
    // Compare-and-consume the exact canonical envelope before any navigation or
    // protected state mutation. A same-token payload edit therefore cannot
    // steer the restore destination.
    const completed = completePlaceAfter19Return(placeReturn, outcome, now)
    if (!completed) {
      setGateView("failure")
      return false
    }
    const exactVenue = restorePlaceContext(placeReturn)
    const exitIntent: GlobalAfter19ExitIntentB = {
      kind: "place",
      returnTo: placeReturn,
      exactVenue,
      uiSnapshot: completed.uiSnapshot,
    }
    setPlaceReturn(null)
    beginGateExit(exitIntent)
    return true
  }

  function retryExpiredPlaceReturn() {
    if (!placeReturn) return
    const venue = canonicalMapVenueById(placeReturn.venueId)
    if (!venue) {
      finishPlaceReturn("cancel")
      return
    }
    const now = new Date()
    setClock(now)
    const renewed = renewPlaceAfter19Return(placeReturn, now)
    if (!renewPreparedPlaceAfter19Return(window.sessionStorage, placeReturn, renewed, now)) {
      setGateView("failure")
      return
    }
    gateLifecycleSerialRef.current += 1
    gateExitPlanRef.current = null
    setPlaceReturn(renewed)
    setGateView("intro")
  }

  function turnOff() {
    closeReviewDetails(false)
    commitSession({ ...session, mode: "manual-off", activation: null, expiryNotice: false })
    setNotice("off")
    window.requestAnimationFrame(() => {
      const target = hideTrigger ? resolveExternalOpener() : chipRef.current
      target?.focus({ preventScroll: true })
    })
  }

  function undoOff() {
    if (isGlobalAfter19NightViewCurrent(session, clock)) {
      commitSession({ ...session, mode: "on", activation: "manual", expiryNotice: false })
      setNotice(null)
      window.requestAnimationFrame(() => {
        const target = reviewToggleRef.current ?? activeOffRef.current ?? (hideTrigger ? resolveExternalOpener() : null)
        target?.focus({ preventScroll: true })
      })
    } else {
      openGate()
    }
  }

  function dismissNotice() {
    setNotice(null)
    if (session.expiryNotice) commitSession({ ...session, expiryNotice: false })
    window.requestAnimationFrame(() => {
      const target = hideTrigger ? resolveExternalOpener() : chipRef.current
      target?.focus({ preventScroll: true })
    })
  }

  function consumeGateClosingInput(event: SyntheticEvent) {
    if (!gateClosing) return
    event.preventDefault()
    event.stopPropagation()
    event.nativeEvent.stopImmediatePropagation()
  }

  function handleGateKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (gateClosing) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      cancelGate()
      return
    }
    if (event.key !== "Tab") return
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
      .filter(isRenderedFocusable)
    const first = focusable[0]
    const last = focusable.at(-1)
    if (!first || !last) {
      event.preventDefault()
      dialogRef.current?.focus({ preventScroll: true })
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus({ preventScroll: true })
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus({ preventScroll: true })
    }
  }

  function renderGate(presentation: GlobalAfter19GatePresentationB) {
    const { context, gateView, locale, placeReturn, preference, reviewRequested, reviewResult } = presentation
    const t = COPY[locale]
    const returnVenue = placeReturn ? canonicalMapVenueById(placeReturn.venueId) : null
    const returnVenueLabel = returnVenue ? venueDisplayName(returnVenue.name.ko, locale) : null
    const returnCityId = returnVenue?.cityId ?? context.cityId
    const returnCityLabel = placeReturn
      ? ({
          en: { seoul: "Seoul", busan: "Busan", jeju: "Jeju" },
          ko: { seoul: "서울", busan: "부산", jeju: "제주" },
          ja: { seoul: "ソウル", busan: "釜山", jeju: "済州" },
        } as const)[locale][returnCityId]
      : context.cityLabel
    const contextLabel = returnVenueLabel ?? (placeReturn ? returnCityLabel : context.venueLabel ?? context.cityLabel)
    const contextKind = returnVenueLabel || (!placeReturn && context.venueLabel) ? t.venue : t.city
    const returnVenueId = placeReturn?.venueId ?? context.venueId
    const unavailable = gateView === "unavailable"
    const returnExpired = gateView === "expired"
    const checkExpired = gateView === "checkExpired"
    const expiredWithoutReview = returnExpired && !reviewRequested
    const escapeOnly = unavailable || expiredWithoutReview
    const retryable = gateView === "failure" || checkExpired || (returnExpired && reviewRequested)
    const generalLabel = returnVenueId ? t.generalPlace : t.generalMap

    const gate = (
      <div
        ref={layerRef}
        className={styles.layer}
        data-testid="global-after19-prompt-layer"
        data-ondo-layer="fullTask"
        data-modal-layer-priority={ONDO_MODAL_PRIORITY.fullTask}
        data-after19-gate-subject={presentation.key}
        data-after19-gate-presence={gatePresence.phase}
        aria-busy={gateClosing ? "true" : undefined}
        onClickCapture={consumeGateClosingInput}
        onPointerDownCapture={consumeGateClosingInput}
        onKeyDownCapture={consumeGateClosingInput}
      >
        <div className={styles.backdrop} aria-hidden="true" />
        <section ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="global-after19-title" tabIndex={-1} data-gate-view={gateView} onKeyDown={handleGateKeyDown}>
          <header
            className={styles.dialogHeader}
            aria-label={`${t.context} · ${contextKind}: ${contextLabel}`}
            data-testid="global-after19-return-context"
            data-return-cta={placeReturn?.cta ?? "OPEN_AFTER19"}
            data-return-city={returnCityId}
            data-return-venue={returnVenueId ?? "none"}
            data-return-level={placeReturn ? "detail" : context.venueId ? "detail" : "city"}
            data-return-focus={placeReturn ? "canonical-after19-access" : "global-after19-toggle"}
          >
            <span><MapPin size={18} aria-hidden="true" /><strong>{contextLabel}</strong>{returnVenueLabel || (!placeReturn && context.venueLabel) ? <small>{returnCityLabel}</small> : null}</span>
            <button type="button" className={styles.dialogClose} data-testid="global-after19-close" aria-label={t.close} onClick={cancelGate}><X size={18} aria-hidden="true" /></button>
          </header>
          <div className={styles.body}>
            {gateView === "pending" ? <LoaderCircle className={styles.heroPending} size={27} aria-hidden="true" /> : gateView === "failure" || unavailable || checkExpired ? <AlertTriangle className={styles.heroFailure} size={27} aria-hidden="true" /> : <span className={styles.hero} aria-hidden="true">19+</span>}
            <h2 ref={headingRef} id="global-after19-title" tabIndex={gateView === "intro" ? undefined : -1}>{gateView === "pending" ? t.checkingTitle : gateView === "failure" ? t.failedTitle : unavailable ? t.unavailableTitle : returnExpired ? t.expiredReturnTitle : checkExpired ? t.checkExpiredTitle : t.title}</h2>
            <p className={styles.lead} role={gateView === "pending" || unavailable ? "status" : gateView !== "intro" ? "alert" : undefined} aria-live={gateView === "pending" || unavailable ? "polite" : undefined} aria-atomic={gateView === "intro" ? undefined : true} data-testid={gateView === "intro" ? undefined : "global-after19-status"}>{gateView === "pending" ? t.checkingBody : gateView === "failure" ? t.failedBody : unavailable ? t.unavailableBody : returnExpired ? t.expiredReturnBody : checkExpired ? t.checkExpiredBody : context.cityId === "jeju" ? t.jejuBody : t.body}</p>
            {reviewRequested && !reviewResult ? <p className={styles.reviewScope} data-testid="global-after19-review-scope">{t.reviewScope}</p> : null}
            {placeReturn && !returnVenue ? <p className={styles.missingVenue}>{t.missingVenue}</p> : null}
            {gateView === "intro" ? (
              <>
                <details className={styles.boundary}><summary>{t.boundary}<ChevronRight size={16} aria-hidden="true" /></summary><div className={styles.boundaryBody}><p>{t.boundaryBody}<span>{context.cityId === "jeju" ? t.jejuTruth : t.truth}</span></p><button type="button" role="switch" aria-checked={preference.autoOpen} className={styles.autoSetting} onClick={() => commitPreference({ version: 1, autoOpen: !preference.autoOpen })}><span>{t.auto}</span><i aria-hidden="true"><b /></i></button></div></details>
              </>
            ) : null}
            <div className={styles.actions} data-single-action={gateView === "pending" || escapeOnly ? "true" : "false"}>
              {gateView === "pending" ? (
                <button type="button" className={styles.secondary} data-testid="global-after19-cancel" onClick={cancelGate}>{t.cancel}</button>
              ) : (
                <>
                  <button ref={primaryRef} type="button" className={styles.primary} data-testid={escapeOnly ? "global-after19-general" : retryable ? "global-after19-retry" : "global-after19-confirm"} onClick={escapeOnly ? cancelGate : returnExpired ? retryExpiredPlaceReturn : runCheck}>
                    {retryable ? <RotateCcw size={17} aria-hidden="true" /> : escapeOnly ? <MapPin size={17} aria-hidden="true" /> : <span className={styles.inlineAge} aria-hidden="true">19+</span>}
                    {escapeOnly ? generalLabel : retryable ? t.retry : t.primary}
                  </button>
                  {!escapeOnly ? <button type="button" className={styles.secondary} data-testid="global-after19-cancel" onClick={cancelGate}>{retryable ? generalLabel : t.cancel}</button> : null}
                </>
              )}
            </div>
          </div>
        </section>
      </div>
    )
    // The map controls have their own low stacking context (and can be
    // hidden in compact/list layouts). Keep only the trigger there: a gate
    // opened from a place must paint above the retained detail, not behind it.
    // The canvas also preserves appearance tokens and shared modal isolation.
    const canvas = typeof document === "undefined" ? null : document.querySelector("[data-testid='ondo-canvas']")
    return canvas ? createPortal(gate, canvas) : gate
  }

  if (!hydrated) return null

  const noticeContent = notice ? (
    <section className={styles.notice} role="status" data-notice-placement={noticeTarget ? "stack" : "inline"} data-testid={notice === "expired" ? "global-after19-expiry-notice" : "global-after19-off-notice"}>
      <span>{notice === "expired" ? t.expired : t.offNotice}</span>
      <button type="button" onClick={notice === "expired" ? openGate : undoOff}>{notice === "expired" ? t.checkAgain : t.undo}</button>
      <button type="button" className={styles.noticeDismiss} onClick={dismissNotice} aria-label={t.dismiss}><X size={16} aria-hidden="true" /></button>
    </section>
  ) : null

  return (
    <div
      className={styles.root}
      data-testid="ondo-b-after19-global"
      data-after19-mode={session.mode}
      data-after19-activation={session.activation ?? "none"}
      data-after19-age={session.age}
      data-context-city={context.cityId}
      data-context-venue={context.venueId ?? "none"}
    >
      {!hideTrigger && session.mode !== "on" ? (
        <button ref={chipRef} type="button" className={styles.chip} onClick={openGate} data-testid="global-after19-toggle" aria-label={t.chipLabel}>
          <MoonStar size={17} aria-hidden="true" /><span>{t.chip}</span>
        </button>
      ) : !hideTrigger ? (
        <section className={styles.banner} data-testid="global-after19-banner" data-activation={session.activation ?? "manual"} data-review-result={reviewResult ? "true" : "false"}>
          <MoonStar size={19} aria-hidden="true" />
          {reviewResult ? (
            <button
              ref={reviewToggleRef}
              type="button"
              className={styles.reviewToggle}
              data-testid="global-after19-review-toggle"
              aria-expanded={reviewDetailsOpen}
              aria-controls={reviewDetailsOpen ? "global-after19-review-details" : undefined}
              aria-label={reviewDetailsOpen ? t.closeReviewDetails : t.openReviewDetails}
              onClick={reviewDetailsOpen ? () => closeReviewDetails(true) : openReviewDetails}
            >
              <span className={styles.activeGlyph} aria-hidden="true">19+</span>
            </button>
          ) : (
            <>
              <span role="status">
                <strong>{t.chip}</strong>
                <small>{session.activation === "auto" ? t.activeAuto : t.activeManual} · {context.cityLabel}</small>
              </span>
              <button ref={activeOffRef} type="button" onClick={turnOff} aria-label={t.turnOff}><MoonStar size={17} aria-hidden="true" /><span className={styles.activeGlyph} aria-hidden="true">19+</span></button>
            </>
          )}
          {reviewDetailsOpen && reviewResult && reviewReceipt ? (
            <section
              ref={reviewDetailsRef}
              id="global-after19-review-details"
              className={styles.reviewDetails}
              aria-labelledby="global-after19-review-details-title"
              data-testid="global-after19-review-provenance"
            >
              <header>
                <div><MoonStar size={17} aria-hidden="true" /><strong id="global-after19-review-details-title">{t.reviewDetailsTitle}</strong></div>
                <button ref={reviewDetailsCloseRef} type="button" data-testid="global-after19-review-close" aria-label={t.closeReviewDetails} onClick={() => closeReviewDetails(true)}><X size={18} aria-hidden="true" /></button>
              </header>
              <dl>
                <div><dt>{t.reviewMode}</dt><dd>SIMULATED</dd></div>
                <div><dt>{t.reviewReference}</dt><dd>{reviewReceipt.fixtureId}</dd></div>
                <div><dt>{t.reviewExpires}</dt><dd><time dateTime={reviewReceipt.expiresAt}>{new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(reviewReceipt.expiresAt))}</time></dd></div>
              </dl>
              <button type="button" className={styles.reviewTurnOff} data-testid="global-after19-turn-off" onClick={turnOff}><MoonStar size={17} aria-hidden="true" /><span>{t.turnOffAction}</span></button>
            </section>
          ) : null}
        </section>
      ) : null}

      {noticeContent && noticeTarget ? createPortal(noticeContent, noticeTarget) : noticeContent}

      {gatePresentation ? renderGate(gatePresentation) : null}
    </div>
  )
}
