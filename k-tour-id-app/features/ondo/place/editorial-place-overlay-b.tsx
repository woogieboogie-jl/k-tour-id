"use client"

import type { KeyboardEvent, SyntheticEvent } from "react"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { ArrowLeft, ArrowUpRight, Bookmark, ChevronRight, Database, MapPin, Navigation, UsersRound, X } from "lucide-react"
import { B_DISCOVERY_TRAVERSAL_EVENT, closeBDiscoveryPlace, goBackFromBDiscovery, openBDiscoveryEditorialDetail, readBDiscoveryHistory, readBDiscoveryTraversal, readMyKoreaPlaceReturnNavigation } from "../map/b-discovery-history"
import { SampleActivityMeterB } from "../map/sample-activity-meter-b"
import { editorialPlaceById, JAPAN_FIRST_LAUNCH_CONTENT, JEJU_EDITORIAL_TEMPERATURE, jejuEditorialCoverageIntensity } from "../pulse-b/japan-first-pulse-model-b"
import { useOndoB } from "../shared/state/ondo-b-provider"
import type { OndoBLocale } from "../shared/state/ondo-b-preferences"
import { isRenderedFocusable } from "../shared/ui/is-rendered-focusable"
import { ONDO_MODAL_PRIORITY } from "../shared/ui/modal-layer-priority"
import { useDocumentScrollLock, useModalIsolation } from "../shared/ui/use-modal-isolation"
import type { SheetPresencePhase } from "../shared/ui/use-sheet-presence"
import { ONDO_B_JEJU_TABLE } from "../connect/table-model"
import { capturePlaceServiceMapReturnB } from "../map/place-service-map-return-b"
import { PlacePeekActionsB, PlaceServiceActionsB } from "./place-service-actions-b"
import styles from "./editorial-place-overlay-b.module.css"

const FOCUSABLE = "a[href],button:not([disabled]),summary,[tabindex]:not([tabindex='-1'])"
const ONDO_OPEN_TABLE_EVENT = "ondo:b:open-table"

type EditorialPlaceOverlayBProps = {
  editorialPlaceId: NonNullable<ReturnType<typeof editorialPlaceById>>["id"]
  locale: OndoBLocale
  presenceState: Exclude<SheetPresencePhase, "closed">
}

type EditorialPlaceVisualSnapshot = Readonly<{
  expanded: boolean
  locale: OndoBLocale
  saveError: boolean
  saved: boolean
}>

const COPY = {
  en: {
    truth: "Jeju travel place",
    boundary: "Travel guide",
    address: "Address",
    directions: "Directions",
    save: "Save to My Korea",
    saved: "Saved in My Korea",
    remove: "Remove from My Korea",
    source: "Place source",
    sourceDetails: "Source details",
    details: "Place details",
    back: "Back to place summary",
    screenPlace: "Filming location",
    editorialPlace: "Editorial pick",
    noScore: "An editorial travel recommendation, not a popularity or crowding score.",
    imageSource: "Hero image",
    collection: "Story source",
    checked: "Place page and embedded map checked Aug 28, 2026",
    close: "Close place",
    saveFailed: "This device could not update the saved place. Try again.",
    table: "Join a Table",
    tableHint: "Dinner in Bukchon",
    browseTables: "Browse Tables",
  },
  ko: {
    truth: "제주 여행 장소",
    boundary: "여행 가이드",
    address: "주소",
    directions: "길찾기",
    save: "내 한국에 저장",
    saved: "내 한국에 저장됨",
    remove: "내 한국에서 삭제",
    source: "장소 출처",
    sourceDetails: "출처 정보",
    details: "장소 상세",
    back: "장소 요약으로",
    screenPlace: "촬영지",
    editorialPlace: "편집 추천",
    noScore: "여행 콘텐츠에 소개된 장소이며, 인기·혼잡 점수를 제공하지 않아요.",
    imageSource: "대표 이미지",
    collection: "이야기 출처",
    checked: "장소 페이지와 내장 지도를 2026년 8월 28일 확인",
    close: "장소 닫기",
    saveFailed: "이 기기의 저장 장소를 업데이트하지 못했어요. 다시 시도해 주세요.",
    table: "테이블 참여",
    tableHint: "북촌에서 함께하는 저녁",
    browseTables: "테이블 둘러보기",
  },
  ja: {
    truth: "済州の旅スポット",
    boundary: "旅ガイド",
    address: "住所",
    directions: "経路を見る",
    save: "マイ韓国に保存",
    saved: "マイ韓国に保存済み",
    remove: "マイ韓国から削除",
    source: "スポット情報源",
    sourceDetails: "情報源の詳細",
    details: "スポット詳細",
    back: "スポット概要に戻る",
    screenPlace: "ロケ地",
    editorialPlace: "編集部のおすすめ",
    noScore: "旅行コンテンツのおすすめです。人気度や混雑度のスコアではありません。",
    imageSource: "メイン画像",
    collection: "ストーリー情報源",
    checked: "スポットページと埋め込み地図を2026年8月28日に確認",
    close: "スポットを閉じる",
    saveFailed: "この端末の保存内容を更新できませんでした。もう一度お試しください。",
    table: "Tableに参加",
    tableHint: "北村で囲む夕食",
    browseTables: "Tableを見る",
  },
} as const

export function EditorialPlaceOverlayB({ editorialPlaceId, locale: mountedLocale, presenceState }: EditorialPlaceOverlayBProps) {
  const { state, actions } = useOndoB()
  const closing = presenceState === "closing"
  const closingRef = useRef(closing)
  closingRef.current = closing
  const exitRequestedRef = useRef(false)
  const wasClosingRef = useRef(closing)
  if (wasClosingRef.current && !closing) exitRequestedRef.current = false
  wasClosingRef.current = closing
  const layerRef = useRef<HTMLDivElement | null>(null)
  const peekRef = useRef<HTMLDivElement | null>(null)
  const openRef = useRef<HTMLButtonElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const peekTraversalFocusPendingRef = useRef(false)
  const [saveError, setSaveError] = useState(false)
  const [expanded, setExpanded] = useState(() => readBDiscoveryHistory()?.level === "detail")
  const place = editorialPlaceById(editorialPlaceId)
  const liveSaved = place ? state.savedEditorialPlaceIds.includes(place.id) : false
  const liveVisualSnapshot: EditorialPlaceVisualSnapshot = {
    expanded,
    locale: mountedLocale,
    saveError,
    saved: liveSaved,
  }
  const visualSnapshotRef = useRef(liveVisualSnapshot)
  if (!closing && !exitRequestedRef.current) visualSnapshotRef.current = liveVisualSnapshot
  const visualSnapshot = closing || exitRequestedRef.current ? visualSnapshotRef.current : liveVisualSnapshot
  const expandedView = visualSnapshot.expanded
  const locale = visualSnapshot.locale
  const copy = COPY[locale]
  const saved = visualSnapshot.saved

  useModalIsolation(Boolean(place), expandedView ? layerRef : peekRef)
  useDocumentScrollLock(Boolean(place))

  useEffect(() => {
    setSaveError(false)
    if (!place) {
      setExpanded(false)
      return
    }
    const history = readBDiscoveryHistory()
    setExpanded(history?.level === "detail" && history.editorialPlaceId === place.id)
  }, [place])

  useEffect(() => {
    const syncHistory = (event: Event) => {
      const entry = readBDiscoveryTraversal(event)?.entry
      if (!entry || entry.editorialPlaceId !== editorialPlaceId) return
      peekTraversalFocusPendingRef.current = entry.level === "peek"
      setExpanded(entry.level === "detail")
    }
    window.addEventListener(B_DISCOVERY_TRAVERSAL_EVENT, syncHistory)
    return () => window.removeEventListener(B_DISCOVERY_TRAVERSAL_EVENT, syncHistory)
  }, [editorialPlaceId])

  useEffect(() => {
    if (!place || closing) return
    const frame = window.requestAnimationFrame(() => {
      const target = expandedView
        ? closeRef.current
        : peekTraversalFocusPendingRef.current
          ? openRef.current
          : peekRef.current
      target?.focus({ preventScroll: true })
      if (!expandedView && document.activeElement === openRef.current) peekTraversalFocusPendingRef.current = false
    })
    return () => window.cancelAnimationFrame(frame)
  }, [closing, expandedView, place])

  useEffect(() => {
    if (!closing) exitRequestedRef.current = false
  }, [closing, editorialPlaceId])

  useLayoutEffect(() => {
    if (!closing) return
    const consumeClosingKey = (event: globalThis.KeyboardEvent) => {
      const activeLayer = expandedView ? layerRef.current : peekRef.current
      if (activeLayer?.closest("[inert],[aria-hidden='true']")) return
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    window.addEventListener("keydown", consumeClosingKey, true)
    return () => window.removeEventListener("keydown", consumeClosingKey, true)
  }, [closing, expandedView])

  if (!place) return null
  const activePlace = place
  const coverageIntensity = jejuEditorialCoverageIntensity(activePlace)
  const editorialLabel = activePlace.category === "screen-location" ? copy.screenPlace : copy.editorialPlace
  const editorialSummary = `${editorialLabel} · ${copy.noScore}`
  const address = locale === "ko" ? activePlace.address.ko : activePlace.address.en
  const stories = activePlace.storyIds.flatMap((storyId) => {
    const story = JAPAN_FIRST_LAUNCH_CONTENT.find((item) => item.id === storyId)
    return story ? [story] : []
  })
  const fallbackJejuStory = JAPAN_FIRST_LAUNCH_CONTENT.find((item) => item.id === "C18")
  const heroMedia = stories.find((story) => story.editorialMedia)?.editorialMedia ?? fallbackJejuStory?.editorialMedia
  const directions = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${activePlace.location.latitude},${activePlace.location.longitude}`)}`
  const table = activePlace.id === ONDO_B_JEJU_TABLE.venueId ? ONDO_B_JEJU_TABLE : null

  function close() {
    if (closingRef.current || exitRequestedRef.current) return
    exitRequestedRef.current = true
    if (closeBDiscoveryPlace()) return
    actions.setSurface({ kind: "map" })
  }

  function closeDetails() {
    if (closingRef.current || exitRequestedRef.current) return
    peekTraversalFocusPendingRef.current = true
    if (goBackFromBDiscovery("detail")) return
    setExpanded(false)
  }

  function trapFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (closingRef.current || exitRequestedRef.current) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (event.key === "Escape") {
      event.preventDefault()
      if (expandedView && readMyKoreaPlaceReturnNavigation()?.receipt.phase === "place") close()
      else if (expandedView) closeDetails()
      else close()
      return
    }
    if (event.key !== "Tab") return
    const activeRoot = expandedView ? layerRef.current : peekRef.current
    const focusable = Array.from(activeRoot?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
      .filter(isRenderedFocusable)
    const first = focusable[0]
    const last = focusable.at(-1)
    if (!first || !last) return
    if (document.activeElement === activeRoot) {
      event.preventDefault()
      ;(event.shiftKey ? last : first).focus()
      return
    }
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  function toggleSaved() {
    if (closingRef.current || exitRequestedRef.current) return
    setSaveError(false)
    if (!actions.toggleSavedEditorialPlace(activePlace.id)) setSaveError(true)
  }

  function openDetails() {
    if (closingRef.current || exitRequestedRef.current) return
    if (!openBDiscoveryEditorialDetail(activePlace.id)) return
    setExpanded(true)
  }

  function openTable() {
    if (closingRef.current || exitRequestedRef.current) return
    exitRequestedRef.current = true
    if (table) capturePlaceServiceMapReturnB(activePlace.id)
    if (table) window.__ONDO_B_TABLE_INTENT__ = { tableId: table.id, venueId: table.venueId, mode: "view" }
    actions.setTab("tables")
    if (table) window.setTimeout(() => window.dispatchEvent(new CustomEvent(ONDO_OPEN_TABLE_EVENT, {
      detail: { tableId: table.id, venueId: table.venueId, mode: "view" },
    })), 0)
  }

  function consumeClosingInput(event: SyntheticEvent) {
    if (!closingRef.current && !exitRequestedRef.current) return
    event.preventDefault()
    event.stopPropagation()
    event.nativeEvent.stopImmediatePropagation()
  }

  if (!expandedView) return (
    <div id="editorial-place-dialog" ref={peekRef} className={styles.peek} role="dialog" aria-modal="true" aria-label={activePlace.name[locale]} aria-busy={closing ? "true" : undefined} tabIndex={-1} data-testid="ondo-b-editorial-place-peek" data-place-service-scroll="true" data-modal-layer-priority={ONDO_MODAL_PRIORITY.peek} data-editorial-place-id={activePlace.id} data-editorial-presence={presenceState} onClickCapture={consumeClosingInput} onPointerDownCapture={consumeClosingInput} onKeyDownCapture={consumeClosingInput} onKeyDown={trapFocus}>
      <div className={styles.grabber} />
      <button type="button" className={styles.close} onClick={close} aria-label={copy.close}><X size={18} aria-hidden="true" /></button>
      <section className={styles.peekIdentity}>
        {heroMedia ? <figure className={styles.peekMedia} aria-hidden="true"><img src={heroMedia.src} alt="" /></figure> : null}
        <div className={styles.peekCopy}>
          <p>{activePlace.sourceCollection[locale]}</p>
          <h2>{activePlace.name[locale]}</h2>
          <small>{locale === "en" ? activePlace.name.ko : activePlace.name.en}</small>
        </div>
      </section>
      <SampleActivityMeterB city="jeju" venueId={activePlace.id} locale={locale} fallback={<section className={styles.editorialContext} role="group" aria-label={editorialSummary} data-coverage-intensity={coverageIntensity} data-temperature-model={JEJU_EDITORIAL_TEMPERATURE.model} data-editorial-temperature-mode={JEJU_EDITORIAL_TEMPERATURE.mode} data-temperature-score="none" data-temperature-visual-grammar="editorial-label" data-pulse-numeric="hidden">
        <MapPin size={16} aria-hidden="true" /><span>{editorialLabel}</span>
      </section>} />
      <details className={styles.recordSummary} data-testid="editorial-place-source-summary">
        <summary><span><strong>{copy.source}</strong><small>VISITKOREA</small></span><ChevronRight size={16} aria-hidden="true" /></summary>
        <p>{copy.checked}</p>
        <p>{copy.noScore}</p>
      </details>
      <PlacePeekActionsB placeId={activePlace.id} locale={locale} className={styles.peekActions}
        details={hasService => <button ref={openRef} type="button" onClick={openDetails} data-testid="ondo-b-editorial-place-details" data-visual-priority={hasService ? "secondary" : "primary"}>{copy.details}<ChevronRight size={17} aria-hidden="true" /></button>}
        directions={<a href={directions} target="_blank" rel="noreferrer" data-testid="ondo-b-editorial-place-directions" data-visual-priority="secondary"><Navigation size={17} aria-hidden="true" />{copy.directions}</a>} />
    </div>
  )

  return (
    <div id="editorial-place-dialog" ref={layerRef} className={styles.layer} role="dialog" aria-modal="true" aria-labelledby="editorial-place-title" aria-busy={closing ? "true" : undefined} tabIndex={-1} data-testid="ondo-b-editorial-place-overlay" data-modal-layer-priority={ONDO_MODAL_PRIORITY.detail} data-editorial-place-id={place.id} data-editorial-presence={presenceState} data-truth-kind="editorial-place" data-official-record="false" data-pulse-eligible="false" data-save-state={saved ? "saved" : "idle"} onClickCapture={consumeClosingInput} onPointerDownCapture={consumeClosingInput} onKeyDownCapture={consumeClosingInput} onKeyDown={trapFocus}>
      <button type="button" className={styles.backdrop} onClick={closeDetails} aria-label={copy.back} tabIndex={-1} />
      <article className={styles.sheet}>
        <header>
          <button ref={closeRef} type="button" onClick={closeDetails} aria-label={copy.back}><ArrowLeft size={19} aria-hidden="true" /></button>
          <span><MapPin size={17} aria-hidden="true" />{copy.truth}</span>
          <button type="button" onClick={close} aria-label={copy.close}><X size={19} aria-hidden="true" /></button>
        </header>
        <div className={styles.body} data-place-service-scroll="true">
          {heroMedia ? (
            <figure className={styles.hero} data-testid="ondo-b-editorial-place-hero">
              <img src={heroMedia.src} alt={heroMedia.alt[locale]} />
            </figure>
          ) : null}
          <section className={styles.identity} data-testid="ondo-b-editorial-place-identity">
            <p>{place.sourceCollection[locale]}</p>
            <h2 id="editorial-place-title">{place.name[locale]}</h2>
          </section>
          <PlaceServiceActionsB placeId={activePlace.id} locale={locale} />
          <section className={styles.editorialContext} role="group" aria-label={editorialSummary} data-testid="ondo-b-editorial-place-temperature" data-coverage-intensity={coverageIntensity} data-temperature-model={JEJU_EDITORIAL_TEMPERATURE.model} data-editorial-temperature-mode={JEJU_EDITORIAL_TEMPERATURE.mode} data-temperature-score="none" data-temperature-visual-grammar="editorial-label" data-pulse-numeric="hidden">
            <MapPin size={16} aria-hidden="true" /><span>{editorialLabel}</span>
          </section>
          <p className={styles.address}><MapPin size={17} aria-hidden="true" /><span><b>{copy.address}</b><span lang={locale === "ko" ? "ko" : "en"}>{address}</span></span></p>
          <div className={styles.actions}>
            <button type="button" onClick={toggleSaved} aria-label={saved ? copy.remove : copy.save} aria-pressed={saved} data-testid="ondo-b-editorial-place-save"><Bookmark size={18} aria-hidden="true" /><span className={styles.saveLabel}>{saved ? copy.remove : copy.save}</span></button>
            <a href={directions} target="_blank" rel="noreferrer" aria-label={copy.directions} title={copy.directions} data-testid="ondo-b-editorial-place-directions" data-visual-priority="secondary"><Navigation size={18} aria-hidden="true" /></a>
          </div>
          {activePlace.category === "food" ? <button type="button" className={styles.tableAction} onClick={openTable} data-place-service={table ? "table" : undefined} data-testid={table ? "ondo-b-editorial-place-table" : "ondo-b-editorial-place-browse-tables"}>
            <UsersRound size={19} aria-hidden="true" />
            <span><strong>{table ? copy.table : copy.browseTables}</strong>{table ? <small>{copy.tableHint}</small> : null}</span>
            <ChevronRight size={18} aria-hidden="true" />
          </button> : null}
          {visualSnapshot.saveError ? <p className={styles.error} role="alert">{copy.saveFailed}</p> : null}
          <details className={styles.sources} aria-label={copy.source}>
            <summary aria-label={copy.sourceDetails}><span><Database size={17} aria-hidden="true" /><b>VISITKOREA</b></span><ChevronRight size={17} aria-hidden="true" /></summary>
            <div className={styles.sourceBody}>
              <p>{copy.checked}</p>
              <p>{copy.noScore}</p>
              {heroMedia ? <p className={styles.mediaCredit}><b>{copy.imageSource}</b><span>{heroMedia.credit[locale]}</span></p> : null}
              <a href={place.placeSourceUrl} target="_blank" rel="noreferrer"><span><b>{copy.source}</b><small>VISITKOREA · {place.location.coordinateSource}</small></span><ArrowUpRight size={17} aria-hidden="true" /></a>
              {stories.map((story) => <a key={story.id} href={story.sourceReferences[0].url} target="_blank" rel="noreferrer"><span><b>{copy.collection}</b><small>{story.title[locale]}</small></span><ArrowUpRight size={17} aria-hidden="true" /></a>)}
            </div>
          </details>
        </div>
      </article>
    </div>
  )
}
