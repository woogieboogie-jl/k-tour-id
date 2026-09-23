"use client"

import { useEffect, useId, useRef, useState } from "react"
import type { Map as MapLibreMap, Marker } from "maplibre-gl"
import { ArrowUpRight, ChevronLeft, ChevronRight, Flame, Info, MapPin, Sparkles, X } from "lucide-react"
import { SheetB } from "../shared/ui/sheet-b"
import {
  DISCOVERY_COLLECTION_COPY_B,
  discoveryCollectionSourceB,
  discoveryCollectionTitleB,
  discoveryStoryForCityB,
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

export function DiscoveryStoryHintB({ city, locale, onOpen }: {
  city: string; locale: Locale; onOpen(id: DiscoveryCollectionIdB): void
}) {
  const story = discoveryStoryForCityB(city)
  if (!story || !isDiscoveryCollectionIdB(story.id)) return null
  const id = story.id
  return <button type="button" className={styles.storyHint} data-testid="map-discovery-story" data-collection={id} onClick={() => onOpen(id)}>
    <DiscoveryPictureB key={story.image} src={story.image} alt="" illustration locale={locale} />
    <span className={styles.storyCopy}><small>{DISCOVERY_COLLECTION_COPY_B[locale].story}</small><strong>{story.title[locale]}</strong></span>
    <ChevronRight size={19} aria-hidden="true" />
  </button>
}

export function DiscoveryMoodSuggestionsB({ locale, onSelect }: {
  locale: Locale; onSelect(id: "hot" | "cool"): void
}) {
  const copy = DISCOVERY_COLLECTION_COPY_B[locale]
  return <div className={styles.suggestions} role="group" aria-label={LABELS[locale].suggestions}>
    <button type="button" data-testid="map-discovery-mood-hot" onPointerDown={event => event.preventDefault()} onClick={() => onSelect("hot")}><Flame size={19} aria-hidden="true" /><span><strong>Hot</strong><small>{copy.hot}</small></span><ChevronRight size={17} aria-hidden="true" /></button>
    <button type="button" data-testid="map-discovery-mood-cool" onPointerDown={event => event.preventDefault()} onClick={() => onSelect("cool")}><Sparkles size={19} aria-hidden="true" /><span><strong>Cool</strong><small>{copy.cool}</small></span><ChevronRight size={17} aria-hidden="true" /></button>
  </div>
}

export function DiscoveryCollectionResultsB({ id, locale, places, selected, onOpen, onSelect, onClose, layout }: {
  id: DiscoveryCollectionIdB; locale: Locale; places: DiscoveryPlaceB[]; selected: string | null
  onOpen(id: string): void; onSelect(id: string): void; onClose(): void; layout: "map" | "list"
}) {
  const copy = DISCOVERY_COLLECTION_COPY_B[locale]
  const label = LABELS[locale]
  const title = discoveryCollectionTitleB(id, locale)
  const source = discoveryCollectionSourceB(id)
  const aboutId = useId()
  const [aboutOpen, setAboutOpen] = useState(false)
  const rail = useRef<HTMLDivElement>(null)
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const current = useRef({ places, selected, onSelect, layout })
  current.current = { places, selected, onSelect, layout }
  const placeKey = places.map(place => place.id).join("|")
  const index = Math.max(0, places.findIndex(place => place.id === selected))
  const count = locale === "ko" ? `${places.length}곳` : locale === "ja" ? `${places.length}か所` : `${places.length} ${places.length === 1 ? "place" : "places"}`

  useEffect(() => {
    if (scrollTimer.current) clearTimeout(scrollTimer.current)
    const node = rail.current
    if (!node || layout !== "map" || !selected) return
    const cards = Array.from(node.children) as HTMLElement[]
    const card = cards.find(candidate => candidate.dataset.discoveryCard === selected)
    if (card && cards[0]) node.scrollTo({ left: card.offsetLeft - cards[0].offsetLeft, behavior: "instant" })
  }, [selected, layout, placeKey])

  useEffect(() => () => { if (scrollTimer.current) clearTimeout(scrollTimer.current) }, [])

  function handleScroll() {
    if (current.current.layout !== "map") return
    if (scrollTimer.current) clearTimeout(scrollTimer.current)
    scrollTimer.current = setTimeout(() => {
      const node = rail.current
      if (!node || current.current.layout !== "map") return
      const cards = Array.from(node.children) as HTMLElement[]
      if (!cards[0]) return
      const nearest = cards.reduce((best, card) => Math.abs(card.offsetLeft - cards[0].offsetLeft - node.scrollLeft) < Math.abs(best.offsetLeft - cards[0].offsetLeft - node.scrollLeft) ? card : best)
      const next = nearest.dataset.discoveryCard
      if (next && next !== current.current.selected && current.current.places.some(place => place.id === next)) current.current.onSelect(next)
    }, 120)
  }

  return <section className={styles.results} data-testid="map-discovery-results" data-collection={id} data-result-count={places.length} data-layout={layout} aria-label={title}>
    <header className={styles.resultsHeader}>
      <div className={styles.heading}><h2>{title}</h2><span>{count}</span></div>
      {layout === "map" && places.length > 1 ? <div className={styles.pager}>
        <button type="button" aria-label={label.previous} disabled={index === 0} onClick={() => onSelect(places[index - 1].id)}><ChevronLeft size={20} aria-hidden="true" /></button>
        <span aria-live="polite" aria-atomic="true">{index + 1}/{places.length}</span>
        <button type="button" aria-label={label.next} disabled={index >= places.length - 1} onClick={() => onSelect(places[index + 1].id)}><ChevronRight size={20} aria-hidden="true" /></button>
      </div> : null}
      <button type="button" className={styles.aboutToggle} aria-label={copy.info} title={copy.info} aria-expanded={aboutOpen} aria-controls={aboutId} onClick={() => setAboutOpen(open => !open)}><Info size={18} aria-hidden="true" /></button>
      <button type="button" className={styles.close} data-testid="map-discovery-close" aria-label={copy.close} onClick={onClose}><X size={20} aria-hidden="true" /></button>
    </header>
    {places.length ? <div className={styles.cards} ref={rail} onScroll={handleScroll}>
      {places.map((place, placeIndex) => <article className={styles.card} data-discovery-card={place.id} data-selected={place.id === selected} key={place.id}>
        <button type="button" className={styles.placeOpener} data-discovery-place-opener={place.id} aria-label={`${place.name[locale]} · ${copy.open}`} onFocus={() => { if (place.id !== selected) onSelect(place.id) }} onClick={() => onOpen(place.id)}>
          <DiscoveryPictureB src={place.image} alt={place.imageAlt[locale]} illustration={place.illustration} locale={locale} portraitTop={place.id === "research-seoul-hakrim-dabang"} />
          <span className={styles.placeCopy}><small>{placeIndex + 1} · {place.area[locale]}</small><strong>{place.name[locale]}</strong><span>{place.reason[locale]}</span></span>
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </article>)}
    </div> : <p className={styles.empty} role="status">{copy.empty}</p>}
    <p className={styles.aboutText} id={aboutId} hidden={!aboutOpen}>{copy.truth}</p>
    {source ? <footer className={styles.resultsFooter}><a href={source} target="_blank" rel="noopener noreferrer" data-testid="map-discovery-source">{copy.original}<ArrowUpRight size={15} aria-hidden="true" /></a></footer> : null}
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
      <details className={styles.marketSource}><summary>{copy.source}<ChevronRight size={17} aria-hidden="true" /></summary><p>{place.credit}</p><a href={place.source} target="_blank" rel="noopener noreferrer" data-testid="map-discovery-market-source">{copy.source}<ArrowUpRight size={15} aria-hidden="true" /></a>{place.photoSource ? <a href={place.photoSource} target="_blank" rel="noopener noreferrer">{LABELS[locale].photo}<ArrowUpRight size={15} aria-hidden="true" /></a> : null}{place.licenseUrl ? <a href={place.licenseUrl} target="_blank" rel="noopener noreferrer">{LABELS[locale].license}<ArrowUpRight size={15} aria-hidden="true" /></a> : null}</details>
    </article>
  </SheetB>
}
