"use client"

import type { ReactNode } from "react"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { Bookmark, MapPinned, Settings, UtensilsCrossed, WalletCards } from "lucide-react"
import { SheetB } from "../shared/ui/sheet-b"
import { SAMPLE_INFO_EVENT } from "../shared/ui/sample-info-button-b"
import { IntegrationDemoB } from "../integration-demo-b/integration-demo-b"
import { ReservationSampleB } from "../reservation-b/reservation-b"
import { JourneyStampsOverlayB } from "../identity-b/journey-stamps-b"
import { JourneyKeepsakeB } from "../labs/labs-entry"
import { requestReservationSampleB } from "../reservation-b/reservation-model-b"
import { OndoBProvider, useOndoB, type OndoBTab } from "../shared/state/ondo-b-provider"
import { ONDO_MODAL_ENTRY_EVENT } from "../shared/ui/use-modal-isolation"
import { exitReviewSample, useReviewSampleSession } from "../shared/ui/use-qa-controls"
import {
  B_DISCOVERY_TRAVERSAL_EVENT,
  MY_KOREA_PLACE_RETURN_TRAVERSAL_EVENT,
  clearMyKoreaPlaceReturnHistory,
  installMyKoreaPlaceReturnTraversalGuard,
  readBDiscoveryTraversal,
  readMyKoreaPlaceReturnNavigation,
  readMyKoreaPlaceReturnTraversal,
} from "../map/b-discovery-history"
import {
  myKoreaPlaceReturnFocusTarget,
  type MyKoreaPlaceReturnReceiptB,
} from "../my/my-korea-place-return-b"
import styles from "./ondo-shell.module.css"

export type OndoBAppSlots = {
  explore: ReactNode
  saved: ReactNode
  tables: ReactNode
  travelerId: ReactNode
  settings: ReactNode
  overlays?: ReactNode
}

const B_NAV: Array<{ id: OndoBTab; icon: typeof MapPinned }> = [
  { id: "ondo", icon: MapPinned },
  { id: "my", icon: Bookmark },
  { id: "tables", icon: UtensilsCrossed },
  { id: "id", icon: WalletCards },
  { id: "settings", icon: Settings },
]

const B_NAV_COPY = {
  en: { ondo: "Explore", my: "My Korea", tables: "Tables", id: "ID · Wallet", settings: "Settings" },
  ko: { ondo: "탐색", my: "내 한국", tables: "테이블", id: "ID · 지갑", settings: "설정" },
  ja: { ondo: "探す", my: "マイ韓国", tables: "テーブル", id: "ID・ウォレット", settings: "設定" },
} as const

const B_NAV_DISPLAY_COPY = B_NAV_COPY

const B_NAV_ARIA_COPY = {
  en: { ondo: "Explore", my: "My Korea, saved and recent places", tables: "Dining tables", id: "K-Tour ID and wallet", settings: "Settings" },
  ko: { ondo: "탐색", my: "내 한국, 저장 및 최근 장소", tables: "함께 먹는 테이블", id: "K-Tour ID와 지갑", settings: "설정" },
  ja: { ondo: "探す", my: "マイ韓国、保存した場所と履歴", tables: "食事テーブル", id: "K-Tour IDとウォレット", settings: "設定" },
} as const

const SHELL_COPY = {
  en: { app: "K-Tour ID Korea food and travel app", content: "content", nav: "Main navigation", skipNav: "Skip to main navigation", navigationError: "Couldn't switch tabs. Try again.", sample: "Sample", exitSample: "Exit sample and return to the regular app" },
  ko: { app: "K-Tour ID 한국 먹거리·여행 앱", content: "콘텐츠", nav: "주요 메뉴", skipNav: "주요 메뉴로 건너뛰기", navigationError: "탭을 바꾸지 못했어요. 다시 시도해 주세요.", sample: "샘플", exitSample: "샘플을 종료하고 일반 앱으로 돌아가기" },
  ja: { app: "K-Tour ID 韓国フード・旅行アプリ", content: "コンテンツ", nav: "メインメニュー", skipNav: "メインメニューへ移動", navigationError: "タブを切り替えられませんでした。もう一度お試しください。", sample: "サンプル", exitSample: "サンプルを終了して通常のアプリに戻る" },
} as const

function OndoBShell({ slots }: { slots: OndoBAppSlots }) {
  const { state, actions } = useOndoB()
  const reviewSample = useReviewSampleSession()
  const [sampleInfoOpen, setSampleInfoOpen] = useState(false)
  const [integrationOpen, setIntegrationOpen] = useState(false)
  useEffect(() => {
    const open = () => setSampleInfoOpen(true)
    window.addEventListener(SAMPLE_INFO_EVENT, open)
    return () => window.removeEventListener(SAMPLE_INFO_EVENT, open)
  }, [])
  const canvasRef = useRef<HTMLElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const scrollPositions = useRef<Partial<Record<OndoBTab, number>>>({})
  const previousSurface = useRef(state.surface)
  const previousDocumentLanguage = useRef<string | null>(null)
  const appliedDocumentLanguage = useRef(state.locale)
  const pendingMyKoreaReturnFocus = useRef<MyKoreaPlaceReturnReceiptB | null>(null)
  const previousTab = useRef(state.tab)
  const [myKoreaReturnFocusVersion, setMyKoreaReturnFocusVersion] = useState(0)
  const activeNonExplore = state.tab === "my"
    ? slots.saved
    : state.tab === "tables"
      ? slots.tables
      : state.tab === "id"
        ? slots.travelerId
        : state.tab === "settings"
          ? slots.settings
          : null
  // Fresh visitors enter the map. Only explicitly started discovery setup owns
  // a modal; the server frame remains inert until preferences have hydrated.
  const onboardingActive = state.hydrated && state.onboarding === "ONB-IN-PROGRESS"

  useLayoutEffect(() => {
    previousDocumentLanguage.current = document.documentElement.lang
    const languageObserver = new MutationObserver(() => {
      if (document.documentElement.lang === appliedDocumentLanguage.current) return
      previousDocumentLanguage.current = document.documentElement.lang
      document.documentElement.lang = appliedDocumentLanguage.current
    })
    languageObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] })
    return () => {
      languageObserver.disconnect()
      if (document.documentElement.lang === appliedDocumentLanguage.current && previousDocumentLanguage.current) {
        document.documentElement.lang = previousDocumentLanguage.current
      }
    }
  }, [])

  useLayoutEffect(() => {
    appliedDocumentLanguage.current = state.locale
    document.documentElement.lang = state.locale
  }, [state.locale])

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const discard = () => actions.discardToast()
    canvas.addEventListener(ONDO_MODAL_ENTRY_EVENT, discard)
    if (canvas.dataset.ondoModalOpen === "true") discard()
    return () => canvas.removeEventListener(ONDO_MODAL_ENTRY_EVENT, discard)
  }, [actions])

  useEffect(() => {
    const before = previousSurface.current
    previousSurface.current = state.surface
    if (before.kind === "venue" || state.surface.kind !== "venue") return
    const timer = window.setTimeout(() => {
      const peek = document.querySelector<HTMLElement>("[data-testid='canonical-place-peek']")
      if (peek && !peek.contains(document.activeElement)) peek.focus({ preventScroll: true })
    }, 100)
    return () => window.clearTimeout(timer)
  }, [state.surface])

  useLayoutEffect(() => {
    if (!state.hydrated) return
    let surfaceFrame = 0
    const applyMyKoreaPlaceReturn = (receipt: MyKoreaPlaceReturnReceiptB) => {
      if (receipt.phase === "origin") {
        window.cancelAnimationFrame(surfaceFrame)
        scrollPositions.current.my = receipt.scrollTop
        pendingMyKoreaReturnFocus.current = receipt
        actions.setSurface({ kind: "map" })
        actions.setTab("my")
        setMyKoreaReturnFocusVersion((version) => version + 1)
        return
      }

      pendingMyKoreaReturnFocus.current = null
      const surface = receipt.sourceKind === "official"
        ? { kind: "venue" as const, venueId: receipt.venueId }
        : { kind: "editorial_place" as const, editorialPlaceId: receipt.editorialPlaceId }
      actions.setTab("ondo")
      actions.setSurface(surface)
      // MapEntry also consumes the discovery traversal when it is mounted. Its
      // generic editorial-peek fallback is `map`, so reassert the exact saved
      // Place surface after all synchronous traversal listeners have finished.
      surfaceFrame = window.requestAnimationFrame(() => actions.setSurface(surface))
    }
    const onMyKoreaTraversal = (event: Event) => {
      const traversal = readMyKoreaPlaceReturnTraversal(event)
      if (traversal) applyMyKoreaPlaceReturn(traversal.receipt)
    }
    const onDiscoveryTraversal = (event: Event) => {
      if (!readBDiscoveryTraversal(event)) return
      // Forward beyond a My origin, malformed My state, and Back beyond the
      // origin all need to remount Explore so it can initialize from history.
      actions.setTab("ondo")
    }
    window.addEventListener(MY_KOREA_PLACE_RETURN_TRAVERSAL_EVENT, onMyKoreaTraversal)
    window.addEventListener(B_DISCOVERY_TRAVERSAL_EVENT, onDiscoveryTraversal)
    const removeGuard = installMyKoreaPlaceReturnTraversalGuard()
    const initial = readMyKoreaPlaceReturnNavigation()
    if (initial) applyMyKoreaPlaceReturn(initial.receipt)
    return () => {
      window.cancelAnimationFrame(surfaceFrame)
      removeGuard()
      window.removeEventListener(MY_KOREA_PLACE_RETURN_TRAVERSAL_EVENT, onMyKoreaTraversal)
      window.removeEventListener(B_DISCOVERY_TRAVERSAL_EVENT, onDiscoveryTraversal)
    }
  }, [actions, state.hydrated])

  useLayoutEffect(() => {
    const region = contentRef.current
    if (!region) return
    const remembered = scrollPositions.current[state.tab] ?? 0
    region.scrollTop = Math.min(remembered, Math.max(0, region.scrollHeight - region.clientHeight))
  }, [state.tab])

  useLayoutEffect(() => {
    const before = previousTab.current
    previousTab.current = state.tab
    if (before === state.tab) return
    const active = document.activeElement
    if (active instanceof HTMLElement && active !== document.body && active.isConnected) return
    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => {
        const current = document.activeElement
        if (current instanceof HTMLElement && current !== document.body && current.isConnected) return
        contentRef.current?.focus({ preventScroll: true })
      })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [state.tab])

  useLayoutEffect(() => {
    const receipt = pendingMyKoreaReturnFocus.current
    const region = contentRef.current
    if (!receipt || receipt.phase !== "origin" || state.tab !== "my" || !region) return
    const focusTarget = myKoreaPlaceReturnFocusTarget(receipt)
    if (!focusTarget) return
    let firstFrame = 0
    let secondFrame = 0
    let timeout = 0
    let observer: MutationObserver | null = null
    const cleanup = () => {
      window.cancelAnimationFrame(firstFrame)
      window.cancelAnimationFrame(secondFrame)
      window.clearTimeout(timeout)
      observer?.disconnect()
    }
    const restore = () => {
      if (pendingMyKoreaReturnFocus.current?.journeyId !== receipt.journeyId || state.tab !== "my") {
        cleanup()
        return
      }
      const scrollTop = Math.min(receipt.scrollTop, Math.max(0, region.scrollHeight - region.clientHeight))
      region.scrollTop = scrollTop
      scrollPositions.current.my = scrollTop
      const opener = document.querySelector<HTMLElement>(focusTarget.openerSelector)
      const target = opener ?? document.getElementById(focusTarget.fallbackId) ?? region
      target.focus({ preventScroll: true })
      // Some engines reveal a focused element despite preventScroll. The
      // receipt remains the authority for the exact My Korea position.
      region.scrollTop = scrollTop
      scrollPositions.current.my = scrollTop
      pendingMyKoreaReturnFocus.current = null
      cleanup()
    }
    observer = new MutationObserver(restore)
    observer.observe(region, { childList: true, subtree: true })
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(restore)
    })
    timeout = window.setTimeout(() => {
      restore()
      cleanup()
    }, 3_000)
    return cleanup
  }, [myKoreaReturnFocusVersion, state.tab])

  useLayoutEffect(() => {
    const region = contentRef.current
    const canvas = canvasRef.current
    const dock = canvas?.querySelector<HTMLElement>("#ondo-main-nav")
    if (!region || !canvas || !dock) return
    const syncViewport = () => {
      region.style.setProperty("--ondo-scroll-viewport", `${region.clientHeight}px`)
      // The map paints behind the phone dock, but its interactive overlay
      // retains the original content lane. Measure the real dock (including
      // safe-area margins) rather than duplicating its size in map CSS.
      const dockStyle = getComputedStyle(dock)
      const dockSpace = window.matchMedia("(max-width: 800px)").matches && dockStyle.display !== "none"
        ? dock.offsetHeight + parseFloat(dockStyle.marginTop) + parseFloat(dockStyle.marginBottom)
        : 0
      canvas.style.setProperty("--ondo-map-dock-space", `${dockSpace}px`)
    }
    const observer = new ResizeObserver(syncViewport)
    observer.observe(region)
    observer.observe(dock)
    window.addEventListener("resize", syncViewport)
    syncViewport()
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", syncViewport)
      region.style.removeProperty("--ondo-scroll-viewport")
      canvas.style.removeProperty("--ondo-map-dock-space")
    }
  }, [])

  const selectTab = (tab: OndoBTab) => {
    const region = contentRef.current
    if (region) scrollPositions.current[state.tab] = region.scrollTop
    const activeMyKoreaReturn = readMyKoreaPlaceReturnNavigation()
    const clearedMyKoreaReturn = clearMyKoreaPlaceReturnHistory()
    if (activeMyKoreaReturn && !clearedMyKoreaReturn) {
      actions.notify(SHELL_COPY[state.locale].navigationError)
      return
    }
    // A deliberate dock choice owns the next focus target. Cancel any
    // scheduled My Korea restoration before abandoning its history journey.
    pendingMyKoreaReturnFocus.current = null
    if (tab === state.tab) {
      if (region) {
        region.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })
        scrollPositions.current[tab] = 0
      }
      return
    }
    actions.setTab(tab)
  }

  const activeLabel = B_NAV_COPY[state.locale][state.tab]

  return (
    <main
      className={styles.stage}
      data-ondo-locale={state.locale}
      data-testid="ondo-b-root"
      data-variant="B"
      data-locale={state.locale}
      data-appearance={state.resolvedAppearance}
      data-appearance-preference={state.appearancePreference}
      data-hydrated={state.hydrated ? "true" : "false"}
      aria-busy={!state.hydrated ? true : undefined}
      inert={!state.hydrated ? true : undefined}
    >
      <section ref={canvasRef} className={styles.canvas} aria-label={SHELL_COPY[state.locale].app} data-testid="ondo-canvas" data-responsive-shell="mobile-dock-desktop-rail">
        {!onboardingActive ? (
          <a
            className={styles.skipNav}
            href="#ondo-main-nav"
            onClick={() => window.requestAnimationFrame(() => document.querySelector<HTMLElement>("#ondo-main-nav button")?.focus({ preventScroll: true }))}
          >
            {SHELL_COPY[state.locale].skipNav}
          </a>
        ) : null}
        <div
          ref={contentRef}
          className={styles.content}
          id="ondo-active-panel"
          role="region"
          tabIndex={0}
          aria-label={`${activeLabel} ${SHELL_COPY[state.locale].content}`}
          data-active-tab={state.tab}
          data-scroll-owner="true"
          data-testid="ondo-scroll-region"
          onScroll={(event) => { scrollPositions.current[state.tab] = event.currentTarget.scrollTop }}
        >
          <div
            className={styles.explorePanel}
            data-testid="ondo-tab-panel-ondo"
            data-tab-panel="ondo"
            data-active={state.tab === "ondo" ? "true" : "false"}
            inert={state.tab === "ondo" ? undefined : true}
            aria-hidden={state.tab === "ondo" ? undefined : true}
          >
            {slots.explore}
          </div>
          {state.tab !== "ondo" ? (
            <div
              key={state.tab}
              className={styles.activePanel}
              data-testid={`ondo-tab-panel-${state.tab}`}
              data-tab-panel={state.tab}
              data-active="true"
            >
              {activeNonExplore}
            </div>
          ) : null}
        </div>
        {/* SheetB owns inert/aria-hidden while onboarding is present. Keeping a
            second React-owned snapshot here can restore stale `inert` after
            the retained exit and make the visible mobile dock untappable. */}
        <nav id="ondo-main-nav" className={styles.nav} data-testid="ondo-main-nav" data-nav-count="5" data-navigation-mode="responsive" data-nav-presentation="icon-only-mobile-labeled-desktop" aria-label={SHELL_COPY[state.locale].nav}>
          {B_NAV.map(({ id, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={state.tab === id ? styles.navActive : undefined}
              aria-current={state.tab === id ? "page" : undefined}
              aria-controls="ondo-active-panel"
              aria-label={B_NAV_ARIA_COPY[state.locale][id]}
              data-state={state.tab === id ? "selected" : "idle"}
              data-testid={`nav-${id}`}
              onFocus={(event) => event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" })}
              onClick={() => selectTab(id)}
            >
              <span className={styles.navIcon} aria-hidden="true">
                <Icon size={22} strokeWidth={state.tab === id ? 2.35 : 1.75} />
              </span>
              <small className={styles.navLabel} aria-hidden="true">{B_NAV_DISPLAY_COPY[state.locale][id]}</small>
            </button>
          ))}
        </nav>
        {slots.overlays}
        {sampleInfoOpen ? <SheetB locale={state.locale} label={SHELL_COPY[state.locale].sample} variant="peek" onClose={() => setSampleInfoOpen(false)} header={<span>{SHELL_COPY[state.locale].sample}</span>}>
          <div className={styles.sampleInfo}>
            <h2>{state.locale === "ko" ? "여행의 모든 흐름을 체험해 보세요" : state.locale === "ja" ? "旅の流れを体験しましょう" : "Try the whole journey"}</h2>
            <p>{state.locale === "ko" ? "인증·잔액·결제는 샘플입니다. 실제 확인이나 결제는 발생하지 않아요." : state.locale === "ja" ? "認証・残高・決済はサンプルです。実際の確認や支払いは行われません。" : "Identity checks, balances and payments are samples. No real verification or charges occur."}</p>
            <button type="button" onClick={() => { setSampleInfoOpen(false); actions.setTab("id") }}>{state.locale === "ko" ? "내 자격으로 할 수 있는 일" : state.locale === "ja" ? "資格で利用できること" : "What your pass unlocks"}</button>
            <button type="button" data-testid="integration-demo-open" onClick={() => { setSampleInfoOpen(false); setIntegrationOpen(true) }}>{state.locale === "ko" ? "파트너 검증 · 정산 체험" : state.locale === "ja" ? "店舗の確認・精算を体験" : "Partner verification & settlement"}</button>
            <button type="button" data-testid="reservation-demo-open" onClick={() => { setSampleInfoOpen(false); requestReservationSampleB() }}>{state.locale === "ko" ? "매장 예약 체험" : state.locale === "ja" ? "席の予約を体験" : "Try a restaurant booking"}</button>
            <details><summary>{state.locale === "ko" ? "연동 상태" : state.locale === "ja" ? "接続状況" : "Integration status"}</summary><p>{state.locale === "ko" ? "외부 인증·금융·체인은 연결 전입니다." : state.locale === "ja" ? "外部認証・決済・チェーンは未接続です。" : "External identity, financial and chain services are not connected."}</p><button type="button" onClick={exitReviewSample}>{SHELL_COPY[state.locale].exitSample}</button></details>
          </div>
        </SheetB> : null}
        {reviewSample ? <IntegrationDemoB open={integrationOpen} onClose={() => setIntegrationOpen(false)} /> : null}
        <ReservationSampleB />
        <JourneyStampsOverlayB />
        <JourneyKeepsakeB />
        {state.toast && !onboardingActive ? <div className={styles.toast} data-testid="ondo-toast" role="status">{state.toast}</div> : null}
      </section>
    </main>
  )
}

export function OndoAppB({ slots }: { slots: OndoBAppSlots }) {
  return <OndoBProvider><OndoBShell slots={slots} /></OndoBProvider>
}
