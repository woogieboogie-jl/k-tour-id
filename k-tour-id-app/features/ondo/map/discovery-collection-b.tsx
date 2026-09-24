"use client"

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react"
import type { Map as MapLibreMap, Marker } from "maplibre-gl"
import { ArrowUpRight, BookOpen, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Flame, Info, List, MapPin, Sparkles, Sun, X } from "lucide-react"
import type { Story } from "../discovery-preview/fixtures"
import { SheetB } from "../shared/ui/sheet-b"
import {
  DISCOVERY_COLLECTION_COPY_B,
  discoveryCollectionSourceB,
  discoveryCollectionStoryB,
  discoveryCollectionTitleB,
  discoveryDemoTemperatureB,
  isDiscoveryCollectionIdB,
  type DiscoveryCollectionIdB,
  type DiscoveryPlaceB,
} from "./discovery-collection-model-b"
import styles from "./discovery-collection-b.module.css"

type Locale = "ko" | "en" | "ja"
const LABELS = {
  ko: { previous: "이전 장소", next: "다음 장소", unavailable: "이미지를 불러오지 못했어요", photo: "원본 이미지", license: "이용 조건", suggestions: "분위기로 찾기", art: "그림" },
  en: { previous: "Previous place", next: "Next place", unavailable: "Image unavailable", photo: "Original image", license: "Image license", suggestions: "Explore a mood", art: "Art" },
  ja: { previous: "前の場所", next: "次の場所", unavailable: "画像を読み込めませんでした", photo: "元の画像", license: "利用条件", suggestions: "雰囲気で探す", art: "イラスト" },
} as const

const READING = {
  ko: { read: "이야기 펼치기", collapse: "이야기 접기", stops: "이야기 속 장소", sesame: "참기름과 시장", screen: "드라마 속 제주", picks: "편집 추천", missing: "이 지역의 추천은 준비 중이에요", filters: "선택한 조건에 맞는 추천이 없어요", recover: "조건 살펴보기", alternative: "이 지역 이야기 보기", market: "시장 둘러보기", marketNote: "지도는 중부시장을 가리켜요. 원문에 소개된 개별 점포의 위치나 현재 영업 여부를 뜻하지는 않아요." },
  en: { read: "Read the story", collapse: "Close the story", stops: "Places in this story", sesame: "Sesame & the market", screen: "Jeju on screen", picks: "Editorial picks", missing: "Picks for this city are still to come", filters: "No picks match your current filters", recover: "Review filters", alternative: "Explore this city’s story", market: "Explore the market", marketNote: "The pin marks Jungbu Market, not an individual oil shop. Check the original article for the featured shops; current opening hours have not been confirmed." },
  ja: { read: "物語を読む", collapse: "物語を閉じる", stops: "物語のスポット", sesame: "ゴマ油と市場", screen: "ドラマの済州", picks: "編集部のおすすめ", missing: "この地域のおすすめは準備中です", filters: "今の条件に合うおすすめはありません", recover: "条件を確認", alternative: "この地域の物語へ", market: "市場をめぐる", marketNote: "ピンは中部市場を示しています。個別のお店の位置や現在の営業状況を示すものではありません。紹介店は元の記事をご確認ください。" },
} as const

const DISCOVERY_CONTROLS = {
  ko: { stories: "이 지역 이야기", carousel: "가로 카드 모음", storyHelp: "옆으로 넘기거나 방향키로 이야기를 살펴보세요. 누르면 읽을 수 있어요.", temperature: "탐색 온도", all: "전체", reset: "전체 보기", bands: "온도별 추천", truth: "편집한 탐색 예시이며 실시간 인기나 혼잡도가 아니에요.", hot: "Hot · 활기찬 탐색", warm: "Warm · 편안한 탐색", cool: "Cool · 차분한 탐색", showList: "목록 보기" },
  en: { stories: "Stories in this city", carousel: "carousel", storyHelp: "Swipe or use the arrow keys to explore stories. Select a card to read it.", temperature: "Discovery temperature", all: "All", reset: "Show all", bands: "Temperature picks", truth: "Editorial discovery examples, not live popularity or crowding.", hot: "Hot · lively discovery", warm: "Warm · easygoing discovery", cool: "Cool · calm discovery", showList: "Show list" },
  ja: { stories: "この地域の物語", carousel: "カルーセル", storyHelp: "横にスワイプするか矢印キーで物語を選べます。カードを押すと読めます。", temperature: "探し方の温度", all: "すべて", reset: "すべて見る", bands: "温度別のおすすめ", truth: "編集した探索例です。リアルタイムの人気や混雑ではありません。", hot: "Hot · にぎやかな発見", warm: "Warm · 気軽な発見", cool: "Cool · 落ち着いた発見", showList: "リストを見る" },
} as const

export type DiscoveryTemperatureB = "hot" | "warm" | "cool"
const TEMPERATURE_BANDS: readonly DiscoveryTemperatureB[] = ["hot", "warm", "cool"]

/** The parent owns positioning and filtering. Dragging only previews locally;
 * cancellation, opening the control and external selection never commit. */
export function TemperatureSpectrumB({ locale, selected, onChange, disabled = false, className }: {
  locale: Locale; selected: DiscoveryTemperatureB | null; onChange(value: DiscoveryTemperatureB | null): void
  disabled?: boolean; className?: string
}) {
  const copy = DISCOVERY_CONTROLS[locale]
  const [expanded, setExpanded] = useState(false)
  const [draft, setDraft] = useState<DiscoveryTemperatureB | null>(null)
  const root = useRef<HTMLElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const group = useRef<HTMLDivElement>(null)
  const drag = useRef<{ pointerId: number; value: DiscoveryTemperatureB } | null>(null)
  const panelId = useId()
  const truthId = useId()

  function cancelDrag() {
    const pointer = drag.current
    drag.current = null
    setDraft(null)
    if (pointer && group.current?.hasPointerCapture(pointer.pointerId)) group.current.releasePointerCapture(pointer.pointerId)
  }
  function close() { cancelDrag(); setExpanded(false) }
  function commit(value: DiscoveryTemperatureB | null, collapse = true) {
    cancelDrag()
    if (!disabled && value !== selected) onChange(value)
    if (collapse) { setExpanded(false); trigger.current?.focus({ preventScroll: true }) }
  }
  useEffect(() => {
    if (!expanded) return
    const dismiss = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) close()
    }
    document.addEventListener("pointerdown", dismiss, true)
    return () => document.removeEventListener("pointerdown", dismiss, true)
  }, [expanded])
  useEffect(() => { cancelDrag(); if (disabled) setExpanded(false) }, [disabled, selected])

  function bandAt(clientY: number): DiscoveryTemperatureB {
    const rect = group.current!.getBoundingClientRect()
    return TEMPERATURE_BANDS[Math.max(0, Math.min(2, Math.floor((clientY - rect.top) / (rect.height / 3))))]
  }
  function beginDrag(event: PointerEvent<HTMLDivElement>) {
    event.stopPropagation()
    if (disabled || !event.isPrimary || event.button !== 0 || drag.current) return
    event.preventDefault()
    const value = bandAt(event.clientY)
    drag.current = { pointerId: event.pointerId, value }
    setDraft(value)
    event.currentTarget.setPointerCapture(event.pointerId)
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-temperature-band="${value}"]`)?.focus({ preventScroll: true })
  }
  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    event.stopPropagation()
    if (drag.current?.pointerId !== event.pointerId) return
    event.preventDefault()
    const value = bandAt(event.clientY)
    drag.current.value = value
    setDraft(value)
  }
  function endDrag(event: PointerEvent<HTMLDivElement>) {
    event.stopPropagation()
    if (drag.current?.pointerId !== event.pointerId) return
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    if (event.clientX < rect.left - 12 || event.clientX > rect.right + 12 || event.clientY < rect.top - 12 || event.clientY > rect.bottom + 12) { cancelDrag(); return }
    commit(bandAt(event.clientY))
  }
  function handleKeys(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape" && expanded) { event.preventDefault(); event.stopPropagation(); close(); trigger.current?.focus({ preventScroll: true }); return }
    if (!expanded || !["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key) || !(event.target instanceof HTMLElement) || !event.target.dataset.temperatureBand) return
    event.preventDefault(); event.stopPropagation()
    const current = TEMPERATURE_BANDS.indexOf(event.target.dataset.temperatureBand as DiscoveryTemperatureB)
    const index = event.key === "Home" ? 0 : event.key === "End" ? 2 : Math.max(0, Math.min(2, current + (event.key === "ArrowDown" ? 1 : -1)))
    const next = TEMPERATURE_BANDS[index]
    commit(next, false)
    group.current?.querySelector<HTMLButtonElement>(`[data-temperature-band="${next}"]`)?.focus({ preventScroll: true })
  }
  return <section ref={root} className={`${styles.spectrum} ${className ?? ""}`} data-testid="map-temperature-spectrum" data-selected={selected ?? "all"} data-expanded={expanded} onKeyDown={handleKeys} onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onWheel={event => event.stopPropagation()} onBlur={event => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) close() }}>
    <button ref={trigger} type="button" className={styles.spectrumTrigger} data-testid="map-temperature-toggle" disabled={disabled} aria-label={`${copy.temperature}: ${selected ? `${selected} · ${DISCOVERY_COLLECTION_COPY_B[locale][selected]}` : copy.all}`} aria-expanded={expanded} aria-controls={panelId} onClick={() => expanded ? close() : setExpanded(true)}><span className={styles.spectrumSwatch} aria-hidden="true" /><span>{selected ? selected === "hot" ? "Hot" : selected === "warm" ? "Warm" : "Cool" : copy.all}</span><ChevronDown size={14} aria-hidden="true" /></button>
    {expanded ? <div id={panelId} className={styles.spectrumPanel}>
      <small className={styles.spectrumCaption}>{locale === "ko" ? "데모 온도" : locale === "ja" ? "デモの温度" : "Demo bands"}</small>
      <div ref={group} className={styles.spectrumBands} role="radiogroup" aria-label={copy.bands} aria-describedby={truthId} data-draft={draft ?? "none"} onPointerDown={beginDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={event => { event.stopPropagation(); cancelDrag() }} onLostPointerCapture={cancelDrag}>
        {TEMPERATURE_BANDS.map((band, index) => <button type="button" key={band} role="radio" className={styles.spectrumBand} data-testid={`map-temperature-${band}`} data-temperature-band={band} data-preview={draft === band} aria-label={`${band} · ${DISCOVERY_COLLECTION_COPY_B[locale][band]}`} aria-checked={selected === band} tabIndex={selected === band || selected === null && index === 0 ? 0 : -1} onClick={event => { event.stopPropagation(); if (event.detail === 0) commit(band) }}><i aria-hidden="true" /><span>{band === "hot" ? "Hot" : band === "warm" ? "Warm" : "Cool"}</span></button>)}
      </div>
      <button type="button" className={styles.spectrumReset} data-testid="map-temperature-reset" aria-pressed={selected === null} onClick={() => commit(null)}>{copy.reset}</button>
      <span id={truthId} className={styles.srOnly}>{DISCOVERY_COLLECTION_COPY_B[locale].truth}</span>
    </div> : null}
  </section>
}

/** Native horizontal scroll owns the gesture. Only a user-initiated settled
 * snap previews a story; mount, resize and controlled restoration are inert. */
export function DiscoveryStoryCarouselB({ stories, locale, selectedId, onPreview, onOpen, suspended = false, className }: {
  stories: readonly Story[]; locale: Locale; selectedId?: string | null
  onPreview(id: DiscoveryCollectionIdB): void; onOpen(id: DiscoveryCollectionIdB): void
  suspended?: boolean; className?: string
}) {
  const copy = DISCOVERY_CONTROLS[locale]
  const carousel = useRef<HTMLElement>(null)
  const rail = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const userScroll = useRef(false)
  const pointerDown = useRef(false)
  const suppressClick = useRef(false)
  const navigationTarget = useRef<number | null>(null)
  const [navigationIndex, setNavigationIndex] = useState<number | null>(null)
  const lastPreview = useRef<string | null>(selectedId ?? stories[0]?.id ?? null)
  const [visibleId, setVisibleId] = useState(selectedId ?? stories[0]?.id ?? null)
  const current = useRef({ stories, suspended, onPreview })
  current.current = { stories, suspended, onPreview }
  const storyKey = stories.map(story => story.id).join("|")
  const helpId = useId()
  function cancelPreview() {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    userScroll.current = false
    pointerDown.current = false
    navigationTarget.current = null
    setNavigationIndex(null)
  }
  useLayoutEffect(() => {
    cancelPreview()
    suppressClick.current = false
    const id = stories.find(story => story.id === selectedId)?.id ?? stories[0]?.id ?? null
    lastPreview.current = id
    setVisibleId(id)
    const node = rail.current
    const cards = node ? Array.from(node.children) as HTMLElement[] : []
    const card = cards.find(item => item.dataset.storyId === id)
    if (node && card && cards[0]) node.scrollTo({ left: card.offsetLeft - cards[0].offsetLeft, behavior: "instant" })
  }, [storyKey, selectedId, suspended])
  useEffect(() => {
    const node = rail.current
    if (!node) return
    // A newer map/page gesture wins over a queued story preview. Do not let
    // native scroll momentum take the camera back after that gesture.
    const cancelOutside = (event: Event) => {
      if (!(event.target instanceof Node) || !carousel.current?.contains(event.target)) cancelPreview()
    }
    document.addEventListener("pointerdown", cancelOutside, true)
    document.addEventListener("wheel", cancelOutside, { capture: true, passive: true })
    let width = node.clientWidth
    let height = node.clientHeight
    const resize = new ResizeObserver(() => {
      if (node.clientWidth !== width || node.clientHeight !== height) cancelPreview()
      width = node.clientWidth
      height = node.clientHeight
    })
    resize.observe(node)
    return () => {
      cancelPreview()
      resize.disconnect()
      document.removeEventListener("pointerdown", cancelOutside, true)
      document.removeEventListener("wheel", cancelOutside, true)
    }
  }, [storyKey])

  function settle() {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const node = rail.current
      if (!node || !userScroll.current || pointerDown.current || current.current.suspended) return
      const cards = Array.from(node.children) as HTMLElement[]
      if (!cards[0]) return
      // Buttons/keys name a precise destination. A compositor smooth-scroll
      // can dispatch its first scroll event after the debounce: do not consume
      // that explicit intent by measuring the still-visible previous card.
      const requested = navigationTarget.current
      const nearest = requested !== null && cards[requested]
        ? cards[requested]
        : cards.reduce((best, card) => Math.abs(card.offsetLeft - cards[0].offsetLeft - node.scrollLeft) < Math.abs(best.offsetLeft - cards[0].offsetLeft - node.scrollLeft) ? card : best)
      const id = nearest.dataset.storyId
      userScroll.current = false
      navigationTarget.current = null
      setNavigationIndex(null)
      if (!id || !isDiscoveryCollectionIdB(id) || !current.current.stories.some(story => story.id === id)) return
      if (requested !== null) node.scrollTo({ left: nearest.offsetLeft - cards[0].offsetLeft, behavior: "instant" })
      setVisibleId(id)
      if (id !== lastPreview.current) { lastPreview.current = id; current.current.onPreview(id) }
    }, 180)
  }
  function browseStory(index: number, focusCard = false) {
    const node = rail.current
    const cards = node ? Array.from(node.children) as HTMLElement[] : []
    if (!node || !cards.length || suspended) return
    const next = Math.max(0, Math.min(cards.length - 1, index))
    navigationTarget.current = next
    setNavigationIndex(next)
    userScroll.current = true
    pointerDown.current = false
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    node.scrollTo({ left: cards[next].offsetLeft - cards[0].offsetLeft, behavior: reduced ? "instant" : "smooth" })
    if (focusCard) cards[next].querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true })
    settle()
  }
  const visibleIndex = Math.max(0, stories.findIndex(story => story.id === visibleId))
  const controlsIndex = navigationIndex ?? visibleIndex
  function handleKeys(event: KeyboardEvent<HTMLDivElement>) {
    // Tab only moves focus. Arrow keys explicitly opt into a story preview.
    if (event.key === "Tab") { cancelPreview(); return }
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || suspended) return
    event.preventDefault(); event.stopPropagation()
    const node = rail.current
    const cards = node ? Array.from(node.children) as HTMLElement[] : []
    if (!node || !cards.length) return
    const focusedIndex = cards.findIndex(card => card.contains(document.activeElement))
    const activeIndex = focusedIndex >= 0 ? focusedIndex : Math.max(0, cards.findIndex(card => card.dataset.storyId === visibleId))
    const index = event.key === "Home" ? 0 : event.key === "End" ? cards.length - 1 : Math.max(0, Math.min(cards.length - 1, activeIndex + (event.key === "ArrowRight" ? 1 : -1)))
    browseStory(index, true)
  }
  if (!stories.length) return null
  return <aside ref={carousel} className={`${styles.storyCarousel} ${className ?? ""}`} data-testid="map-discovery-story-carousel" aria-label={copy.stories} aria-roledescription={copy.carousel} onBlur={event => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) cancelPreview() }}>
    <span id={helpId} className={styles.srOnly}>{copy.storyHelp}</span>
    <div ref={rail} className={styles.storyRail} aria-describedby={helpId} onKeyDown={handleKeys} onPointerDown={event => { event.stopPropagation(); if (!suspended) { navigationTarget.current = null; setNavigationIndex(null); userScroll.current = true; pointerDown.current = true; suppressClick.current = false } }} onPointerUp={event => { event.stopPropagation(); pointerDown.current = false; settle() }} onPointerCancel={event => {
      // Native touch scrolling cancels the pointer stream while the finger is
      // still down. Only touchend is a release; an idle debounce mid-swipe must
      // not commit the old card and discard the rest of the gesture.
      if (event.pointerType !== "touch") cancelPreview()
    }} onTouchEnd={event => { event.stopPropagation(); if (event.touches.length === 0) { pointerDown.current = false; settle() } }} onTouchCancel={event => { event.stopPropagation(); cancelPreview() }} onWheel={event => { event.stopPropagation(); if (event.deltaX || event.shiftKey) { navigationTarget.current = null; setNavigationIndex(null); userScroll.current = true; settle() } }} onScroll={() => { if (userScroll.current) { suppressClick.current = true; settle() } }}>
      {stories.map((story, index) => {
        const city = story.city === "seoul" ? { ko: "서울", en: "Seoul", ja: "ソウル" }[locale] : { ko: "제주", en: "Jeju", ja: "済州" }[locale]
        const count = locale === "ko" ? `장소 ${story.places.length}곳` : locale === "ja" ? `${story.places.length}か所` : `${story.places.length} ${story.places.length === 1 ? "place" : "places"}`
        return <article key={story.id} className={styles.storySlide} data-story-id={story.id} data-selected={visibleId === story.id} aria-roledescription={locale === "ko" ? "이야기" : locale === "ja" ? "物語" : "slide"} aria-label={`${index + 1}/${stories.length}`}>
          <button type="button" className={styles.storyCard} data-testid="map-discovery-story" data-collection={story.id} aria-label={`${story.title[locale]} · ${city} · ${count}. ${story.intro[locale]}`} disabled={suspended} onClick={event => { event.stopPropagation(); if (event.detail > 0 && suppressClick.current) { suppressClick.current = false; return } if (isDiscoveryCollectionIdB(story.id)) onOpen(story.id) }}>
            <DiscoveryPictureB src={story.image} alt="" illustration locale={locale} />
            <span className={styles.storyCardCopy}><small>{city} · {count}</small><strong>{story.title[locale]}</strong><span>{story.intro[locale]}</span></span>
          </button>
        </article>
      })}
    </div>
    {stories.length > 1 ? <div className={styles.storyNavigation}>
      <button type="button" className={styles.storyArrow} data-testid="map-story-previous" aria-label={locale === "ko" ? "이전 이야기" : locale === "ja" ? "前の物語" : "Previous story"} disabled={suspended || controlsIndex === 0} onClick={() => browseStory((navigationTarget.current ?? visibleIndex) - 1)}><ChevronLeft size={18} aria-hidden="true" /></button>
      <div className={styles.storyPosition} aria-live="polite" aria-atomic="true">{visibleIndex + 1} / {stories.length}</div>
      <button type="button" className={styles.storyArrow} data-testid="map-story-next" aria-label={locale === "ko" ? "다음 이야기" : locale === "ja" ? "次の物語" : "Next story"} disabled={suspended || controlsIndex === stories.length - 1} onClick={() => browseStory((navigationTarget.current ?? visibleIndex) + 1)}><ChevronRight size={18} aria-hidden="true" /></button>
    </div> : null}
  </aside>
}

// Reading position is presentation-only. It never changes discovery history,
// credentials or eligibility, and survives a place overlay's unmount/remount.
function readPosition(id: DiscoveryCollectionIdB): { expanded: boolean; top: number } {
  try {
    const value = JSON.parse(sessionStorage.getItem(`ktour-story-reading:${id}`) ?? "null")
    return { expanded: value?.expanded === true, top: typeof value?.top === "number" && Number.isFinite(value.top) ? Math.max(0, Math.min(10000, value.top)) : 0 }
  } catch { return { expanded: false, top: 0 } }
}

function DiscoveryPictureB({ src, alt, illustration, locale, portraitTop = false, fullLabel = false }: {
  src: string; alt: string; illustration: boolean; locale: Locale; portraitTop?: boolean; fullLabel?: boolean
}) {
  const [failedSource, setFailedSource] = useState<string | null>(null)
  const failed = failedSource === src
  return <span className={styles.picture} data-illustration={illustration}>
    {failed
      ? <span className={styles.imageFallback} role="img" aria-label={`${LABELS[locale].unavailable}. ${alt}`}><MapPin size={24} aria-hidden="true" /></span>
      : <img src={src} alt={alt} decoding="async" loading="lazy" onError={() => setFailedSource(src)} style={portraitTop ? { objectPosition: "50% 0%" } : undefined} />}
    {illustration && !failed ? <span className={styles.illustration} title={DISCOVERY_COLLECTION_COPY_B[locale].illustration} aria-label={DISCOVERY_COLLECTION_COPY_B[locale].illustration}>{fullLabel ? DISCOVERY_COLLECTION_COPY_B[locale].illustration : LABELS[locale].art}</span> : null}
  </span>
}

export function DiscoveryMoodSuggestionsB({ locale, onSelect }: {
  locale: Locale; onSelect(id: DiscoveryTemperatureB): void
}) {
  const copy = DISCOVERY_COLLECTION_COPY_B[locale]
  return <div className={styles.suggestions} role="group" aria-label={LABELS[locale].suggestions}>
    <button type="button" data-testid="map-discovery-mood-hot" onPointerDown={event => event.preventDefault()} onClick={() => onSelect("hot")}><Flame size={19} aria-hidden="true" /><span><strong>Hot</strong><small>{copy.hot}</small></span><ChevronRight size={17} aria-hidden="true" /></button>
    <button type="button" data-testid="map-discovery-mood-warm" onPointerDown={event => event.preventDefault()} onClick={() => onSelect("warm")}><Sun size={19} aria-hidden="true" /><span><strong>Warm</strong><small>{copy.warm}</small></span><ChevronRight size={17} aria-hidden="true" /></button>
    <button type="button" data-testid="map-discovery-mood-cool" onPointerDown={event => event.preventDefault()} onClick={() => onSelect("cool")}><Sparkles size={19} aria-hidden="true" /><span><strong>Cool</strong><small>{copy.cool}</small></span><ChevronRight size={17} aria-hidden="true" /></button>
  </div>
}

export function DiscoveryCollectionResultsB({ id, locale, places, selected, onOpen, onSelect, onClose, layout, viewControl, onShowList, suspended = false, unsupportedCity = false, onRecover, alternativeStory }: {
  id: DiscoveryCollectionIdB; locale: Locale; places: DiscoveryPlaceB[]; selected: string | null
  onOpen(id: string): void; onSelect(id: string): void; onClose(): void; layout: "map" | "list"
  viewControl?: ReactNode; onShowList?(): void; suspended?: boolean; unsupportedCity?: boolean; onRecover?(): void; alternativeStory?: { onOpen(): void }
}) {
  const copy = DISCOVERY_COLLECTION_COPY_B[locale]
  const label = LABELS[locale]
  const title = discoveryCollectionTitleB(id, locale)
  const source = discoveryCollectionSourceB(id)
  const story = discoveryCollectionStoryB(id)
  const readingCopy = READING[locale]
  const aboutId = useId()
  const [aboutOpen, setAboutOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const panel = useRef<HTMLElement>(null)
  const readingId = useId()
  const positionReady = useRef(false)
  const cancelReadingRestore = useRef<(() => void) | null>(null)
  const rail = useRef<HTMLDivElement>(null)
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const current = useRef({ places, selected, onSelect, layout, suspended })
  current.current = { places, selected, onSelect, layout, suspended }
  const placeKey = places.map(place => place.id).join("|")
  const index = Math.max(0, places.findIndex(place => place.id === selected))
  const count = locale === "ko" ? `${places.length}곳` : locale === "ja" ? `${places.length}か所` : `${places.length} ${places.length === 1 ? "place" : "places"}`

  useLayoutEffect(() => {
    positionReady.current = false
    if (suspended) return
    const saved = readPosition(id)
    setExpanded(saved.expanded)
    // A place peek can resize the background and clamp its scrollTop. Do not
    // overwrite the reader's bookmark with that programmatic movement. Wait
    // for the map's original bounds to return before restoring it.
    let frame = 0
    let finished = false
    const node = panel.current
    const observer = new ResizeObserver(() => restore())
    // A genuine viewport change may make an old bookmark unreachable. Bound
    // restoration, and always give a new user gesture priority over it.
    const deadline = window.setTimeout(() => restore(true), 500)
    function finish() {
      finished = true
      observer.disconnect()
      cancelAnimationFrame(frame)
      window.clearTimeout(deadline)
      cancelReadingRestore.current = null
      positionReady.current = true
    }
    function restore(acceptClamp = false) {
      if (finished || !node) return
      node.scrollTop = saved.top
      if (Math.abs(node.scrollTop - saved.top) < 1 || acceptClamp) finish()
    }
    cancelReadingRestore.current = finish
    if (node) observer.observe(node)
    frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => restore()) })
    return finish
  }, [id, layout, suspended])

  function rememberReading(nextExpanded = expanded, top = panel.current?.scrollTop ?? 0) {
    try { sessionStorage.setItem(`ktour-story-reading:${id}`, JSON.stringify({ expanded: nextExpanded, top })) } catch { /* browsing still works without storage */ }
  }

  function toggleReading() {
    const next = !expanded
    rememberReading(next, 0)
    setExpanded(next)
    if (panel.current) panel.current.scrollTop = 0
  }

  useEffect(() => {
    if (scrollTimer.current) clearTimeout(scrollTimer.current)
    const node = rail.current
    if (!node || layout !== "map" || !selected || suspended) return
    const cards = Array.from(node.children) as HTMLElement[]
    const card = cards.find(candidate => candidate.dataset.discoveryCard === selected)
    if (card && cards[0]) node.scrollTo({ left: card.offsetLeft - cards[0].offsetLeft, behavior: "instant" })
  }, [selected, layout, placeKey, suspended])

  useEffect(() => () => { if (scrollTimer.current) clearTimeout(scrollTimer.current) }, [])

  function handleScroll() {
    if (current.current.layout !== "map" || current.current.suspended) return
    if (scrollTimer.current) clearTimeout(scrollTimer.current)
    scrollTimer.current = setTimeout(() => {
      const node = rail.current
      if (!node || current.current.layout !== "map" || current.current.suspended) return
      const cards = Array.from(node.children) as HTMLElement[]
      if (!cards[0]) return
      const nearest = cards.reduce((best, card) => Math.abs(card.offsetLeft - cards[0].offsetLeft - node.scrollLeft) < Math.abs(best.offsetLeft - cards[0].offsetLeft - node.scrollLeft) ? card : best)
      const next = nearest.dataset.discoveryCard
      if (next && next !== current.current.selected && current.current.places.some(place => place.id === next)) current.current.onSelect(next)
    }, 120)
  }

  const pager = layout === "map" && places.length > 1 ? <div className={styles.pager}>
    <button type="button" aria-label={label.previous} disabled={index === 0} onClick={() => onSelect(places[index - 1].id)}><ChevronLeft size={20} aria-hidden="true" /></button>
    <span className={styles.srOnly} aria-live="polite" aria-atomic="true">{index + 1}/{places.length}</span>
    <button type="button" aria-label={label.next} disabled={index >= places.length - 1} onClick={() => onSelect(places[index + 1].id)}><ChevronRight size={20} aria-hidden="true" /></button>
  </div> : null

  const moodDescription = !story && (id === "hot" || id === "warm" || id === "cool") ? `${title} · ${copy[id]}` : ""
  return <section ref={panel} className={styles.results} data-testid="map-discovery-results" data-collection={id} data-kind={story ? "story" : "mood"} data-result-count={places.length} data-layout={layout} data-reading={expanded} aria-label={title} onPointerDown={() => cancelReadingRestore.current?.()} onWheel={() => cancelReadingRestore.current?.()} onTouchStart={() => cancelReadingRestore.current?.()} onKeyDown={() => cancelReadingRestore.current?.()} onScroll={() => { if (!suspended && positionReady.current) rememberReading() }}>
    <header className={styles.resultsHeader}>
      <div className={styles.heading}>{story ? null : <span>{readingCopy.picks} · {count}</span>}<h2 aria-label={story ? undefined : moodDescription}>{title}</h2></div>
      {!story ? pager : null}
      <button type="button" className={styles.close} data-testid="map-discovery-close" aria-label={copy.close} onClick={onClose}><X size={20} aria-hidden="true" /></button>
    </header>
    {story ? <div className={styles.storyContent}>
      <p className={styles.storyIntro} data-testid="map-discovery-story-intro">{story.intro[locale]}</p>
      <div className={styles.readControls}>
        <button type="button" className={styles.readToggle} data-testid="map-discovery-read-toggle" aria-expanded={expanded} aria-controls={readingId} onClick={toggleReading}><BookOpen size={17} aria-hidden="true" />{expanded ? readingCopy.collapse : readingCopy.read}{expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
        {pager}
      </div>
      <div id={readingId} hidden={!expanded} className={styles.readingBody} data-testid="map-discovery-story-body">
        <DiscoveryPictureB src={story.image} alt={title} illustration locale={locale} fullLabel />
        {story.paragraphs.map((paragraph, i) => <p key={i}>{paragraph[locale]}</p>)}
        {story.sources?.length ? <nav className={styles.storySources} aria-label={copy.source}>{story.sources.map(item => <a key={item.url} href={item.url} target="_blank" rel="noopener noreferrer">{item.label}<ArrowUpRight size={14} aria-hidden="true" /></a>)}</nav> : null}
        {places.length ? <nav aria-label={readingCopy.stops} className={styles.storyStops}>{places.map((place, i) => <button type="button" key={place.id} onClick={() => { rememberReading(); onSelect(place.id); onOpen(place.id) }}><span className={styles.stopNumber}>{i + 1}</span><span><strong>{place.name[locale]}</strong><small>{story.stopNotes[place.id]?.[locale] ?? place.reason[locale]}</small></span><ChevronRight size={18} aria-hidden="true" /></button>)}</nav> : null}
      </div>
    </div> : null}
    {places.length && layout === "list" ? <div className={styles.placesToolbar}><span>{story ? readingCopy.stops : readingCopy.picks} · {count}</span></div> : null}
    {places.length ? <div className={styles.cards} ref={rail} onScroll={handleScroll}>
      {places.map((place, placeIndex) => <article className={styles.card} data-discovery-card={place.id} data-selected={place.id === selected} data-city={place.city} data-temperature-band={discoveryDemoTemperatureB(place.id)?.band} data-temperature-source={discoveryDemoTemperatureB(place.id)?.source} key={place.id}>
        <button type="button" className={styles.placeOpener} data-discovery-place-opener={place.id} aria-label={`${place.name[locale]} · ${copy.open}`} onFocus={() => { if (place.id !== selected) onSelect(place.id) }} onClick={() => onOpen(place.id)}>
          <DiscoveryPictureB src={place.image} alt={place.imageAlt[locale]} illustration={place.illustration} locale={locale} portraitTop={place.id === "research-seoul-hakrim-dabang"} />
          <span className={styles.placeCopy}><small>{placeIndex + 1} / {places.length} · {place.area[locale]}</small><strong>{place.name[locale]}</strong><span>{place.reason[locale]}</span></span>
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </article>)}
    </div> : <div className={styles.empty} role="status" data-testid="map-discovery-empty" data-reason={unsupportedCity ? "city" : "filters"}><p>{unsupportedCity ? readingCopy.missing : readingCopy.filters}</p>{unsupportedCity && alternativeStory ? <button type="button" onClick={alternativeStory.onOpen}>{readingCopy.alternative}<ChevronRight size={17} /></button> : onRecover ? <button type="button" onClick={onRecover}>{readingCopy.recover}<ChevronRight size={17} /></button> : null}</div>}
    <p className={styles.aboutText} id={aboutId} hidden={!aboutOpen}>{story ? "" : `${moodDescription}. `}{copy.truth}</p>
    <footer className={styles.resultsFooter}>
      {onShowList && layout === "map" ? <button type="button" data-testid="map-discovery-show-list" onClick={onShowList}><List size={17} aria-hidden="true" />{DISCOVERY_CONTROLS[locale].showList}</button> : viewControl}
      <button type="button" className={styles.aboutToggle} aria-label={copy.info} title={copy.info} aria-expanded={aboutOpen} aria-controls={aboutId} onClick={() => setAboutOpen(open => !open)}><Info size={18} aria-hidden="true" /></button>
      {source ? <a href={source} target="_blank" rel="noopener noreferrer" data-testid="map-discovery-source">{copy.original}<ArrowUpRight size={15} aria-hidden="true" /></a> : null}
    </footer>
  </section>
}

type DiscoveryPin = { id: string; button: HTMLButtonElement; marker: Marker; dispose(): void }

/** Marker-only overlay: the persistent parent map owns camera/style/lifecycle. */
export function DiscoveryCollectionPinsB({ map, places, locale, selected, visible, onSelect }: {
  map: MapLibreMap | null; places: DiscoveryPlaceB[]; locale: Locale; selected: string | null; visible: boolean; onSelect(id: string): void
}) {
  const pins = useRef<DiscoveryPin[]>([])
  const current = useRef({ places, locale, selected, onSelect })
  current.current = { places, locale, selected, onSelect }
  const placeKey = places.map(place => `${place.id}:${place.latitude}:${place.longitude}:${place.image}:${place.illustration}`).join("|")

  useEffect(() => {
    if (!map || !visible) return
    let disposed = false
    const owned: DiscoveryPin[] = []
    const cleanup = () => {
      disposed = true
      for (const pin of owned.splice(0)) pin.dispose()
      if (pins.current === owned) pins.current = []
    }
    map.on("remove", cleanup)
    import("maplibre-gl").then(({ Marker }) => {
      if (disposed) return
      current.current.places.forEach((place, index) => {
        const button = document.createElement("button")
        button.type = "button"
        button.className = styles.pin
        button.dataset.discoveryPin = place.id
        button.dataset.city = place.city
        const temperature = discoveryDemoTemperatureB(place.id)
        if (temperature) { button.dataset.temperatureBand = temperature.band; button.dataset.temperatureSource = temperature.source }
        const image = document.createElement("img")
        image.src = place.image
        image.alt = ""
        image.decoding = "async"
        if (place.id === "research-seoul-hakrim-dabang") image.style.objectPosition = "50% 0%"
        const failedImage = () => { image.hidden = true }
        image.addEventListener("error", failedImage)
        const number = document.createElement("span")
        number.className = styles.pinNumber
        number.textContent = String(index + 1)
        button.append(image, number)
        if (place.illustration) {
          const mark = document.createElement("span")
          mark.className = styles.pinIllustration
          mark.textContent = "✧"
          mark.setAttribute("aria-hidden", "true")
          button.append(mark)
        }
        const choose = (event: MouseEvent) => { event.stopPropagation(); current.current.onSelect(place.id) }
        button.addEventListener("click", choose)
        const marker = new Marker({ element: button, anchor: "center" }).setLngLat([place.longitude, place.latitude]).addTo(map)
        owned.push({ id: place.id, button, marker, dispose: () => { button.removeEventListener("click", choose); image.removeEventListener("error", failedImage); marker.remove() } })
      })
      pins.current = owned
      updatePinLabels(owned, current.current)
    }).catch(cleanup)
    return () => { map.off("remove", cleanup); cleanup() }
  }, [map, visible, placeKey])

  useEffect(() => { updatePinLabels(pins.current, current.current) }, [selected, locale, placeKey])
  return null
}

function updatePinLabels(pins: DiscoveryPin[], state: { places: DiscoveryPlaceB[]; locale: Locale; selected: string | null }) {
  pins.forEach(({ id, button }, index) => {
    const place = state.places.find(candidate => candidate.id === id)
    if (!place) return
    const selected = state.selected === id
    button.dataset.selected = String(selected)
    button.setAttribute("aria-pressed", String(selected))
    button.setAttribute("aria-label", `${index + 1} · ${place.name[state.locale]}${place.illustration ? ` · ${DISCOVERY_COLLECTION_COPY_B[state.locale].illustration}` : ""}`)
    button.style.zIndex = selected ? "2" : "1"
  })
}

export function DiscoveryMarketDetailB({ place, locale, onClose }: {
  place: DiscoveryPlaceB; locale: Locale; onClose(): void
}) {
  const copy = DISCOVERY_COLLECTION_COPY_B[locale]
  return <SheetB locale={locale} label={place.name[locale]} variant="detail" header={<span>{copy.source}</span>} onClose={onClose}
    footer={<div className={styles.detailFooter}><button type="button" data-testid="map-discovery-market-on-map" onClick={onClose}><MapPin size={19} aria-hidden="true" />{copy.map}</button></div>}>
    <article className={styles.marketDetail} data-testid="map-discovery-market-detail" data-place-id={place.id}>
      <DiscoveryPictureB key={place.image} src={place.image} alt={place.imageAlt[locale]} illustration={place.illustration} locale={locale} fullLabel />
      <div className={styles.marketCopy}><small>{place.area[locale]}</small><h2>{place.name[locale]}</h2><p>{place.reason[locale]}</p></div>
      <section className={styles.marketVisit}><h3>{READING[locale].market}</h3><p>{discoveryCollectionStoryB("sesame")?.paragraphs[0]?.[locale]}</p><p>{READING[locale].marketNote}</p></section>
      <details className={styles.marketSource}><summary>{copy.source}<ChevronRight size={17} aria-hidden="true" /></summary><p>{place.credit}</p><a href={place.source} target="_blank" rel="noopener noreferrer" data-testid="map-discovery-market-source">{copy.source}<ArrowUpRight size={15} aria-hidden="true" /></a>{place.photoSource ? <a href={place.photoSource} target="_blank" rel="noopener noreferrer">{LABELS[locale].photo}<ArrowUpRight size={15} aria-hidden="true" /></a> : null}{place.licenseUrl ? <a href={place.licenseUrl} target="_blank" rel="noopener noreferrer">{LABELS[locale].license}<ArrowUpRight size={15} aria-hidden="true" /></a> : null}</details>
    </article>
  </SheetB>
}
