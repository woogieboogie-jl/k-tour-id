"use client"

import { useEffect, useRef, useState } from "react"
import type { Map as LibreMap, Marker, PaddingOptions } from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"
import { MapPin, RotateCw } from "lucide-react"
import { ondoMapStyle } from "@/lib/ondo/map/ondo-map-style"
import type { City, Locale, Place } from "./fixtures"
import styles from "./preview.module.css"

export type Camera = { center: [number, number]; zoom: number; bearing: number; pitch: number; padding: PaddingOptions }
function visiblePadding(node: HTMLElement) {
  const wide = node.clientWidth >= 900 || (node.clientWidth > node.clientHeight && node.clientWidth >= 600)
  return wide ? { top: 90, bottom: 65, left: 440, right: 75 }
    : { top: node.clientHeight <= 640 ? 90 : 150, bottom: Math.min(290, node.clientHeight * .37), left: 68, right: 68 }
}
export function PreviewMap({ places, selected, city, locale, dark, viewKey, restore, onSelect, cameraRef, onCameraChange }: {
  places: Place[]; selected: string | null; city: City; locale: Locale; dark: boolean; viewKey: string
  restore: Camera | null; onSelect(id: string): void; cameraRef: { current: Camera | null }; onCameraChange(): void
}) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<LibreMap | null>(null)
  const markers = useRef<{ marker: Marker; button: HTMLButtonElement; id: string }[]>([])
  const select = useRef(onSelect)
  select.current = onSelect
  const cameraChanged = useRef(onCameraChange)
  cameraChanged.current = onCameraChange
  const currentPlaces = useRef(places)
  const selectedRef = useRef(selected)
  currentPlaces.current = places
  selectedRef.current = selected
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [rendered, setRendered] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const initial = useRef({ city, locale, dark })

  useEffect(() => {
    let disposed = false
    let instance: LibreMap | undefined
    let observer: ResizeObserver | undefined
    setFailed(false)
    setRendered(false)
    const deadline = setTimeout(() => { if (!disposed) setFailed(true) }, 9000)
    import("maplibre-gl").then(({ Map }) => {
      if (disposed || !container.current) return
      const start = initial.current
      instance = new Map({
        container: container.current, style: ondoMapStyle(start.locale, start.dark ? "dark" : "light"),
        center: start.city === "seoul" ? [126.989, 37.556] : [126.934, 33.455],
        zoom: 11.7, maxZoom: 17, minZoom: 7, pitch: 0, attributionControl: false,
      })
      map.current = instance
      instance.on("error", () => { if (!disposed) setFailed(true) })
      instance.on("load", () => { if (!disposed) setReady(true) })
      instance.on("idle", () => {
        if (!disposed && instance?.isSourceLoaded("openmaptiles") && instance.areTilesLoaded() && instance.queryRenderedFeatures().length > 0) {
          clearTimeout(deadline)
          setFailed(false)
          setRendered(true)
        }
      })
      instance.on("moveend", () => {
        if (!instance || disposed) return
        cameraRef.current = { center: instance.getCenter().toArray() as [number, number], zoom: instance.getZoom(), bearing: instance.getBearing(), pitch: instance.getPitch(), padding: instance.getPadding() }
        cameraChanged.current()
      })
      let previousSize = ""
      observer = new ResizeObserver(() => {
        if (!instance) return
        instance.resize()
        const node = instance.getContainer()
        const nextSize = `${node.clientWidth}:${node.clientHeight}`
        const point = currentPlaces.current.find(p => p.id === selectedRef.current)
        if (previousSize && previousSize !== nextSize && point) {
          // Keep the selected stop reachable when the tray moves to a side panel.
          // Preserve zoom/bearing; this is viewport correction, not a new search.
          instance.easeTo({ center: [point.longitude, point.latitude], padding: visiblePadding(node), duration: 0 })
        }
        previousSize = nextSize
      })
      observer.observe(container.current)
    }).catch(() => { if (!disposed) setFailed(true) })
    return () => {
      disposed = true
      clearTimeout(deadline)
      observer?.disconnect()
      markers.current.forEach(m => m.marker.remove())
      markers.current = []
      instance?.remove()
      map.current = null
      setReady(false)
    }
  }, [attempt, cameraRef])

  useEffect(() => {
    const instance = map.current
    if (!instance || !ready) return
    // Appearance changes are visual only. No app theme, account or storage writes.
    setRendered(false)
    instance.setStyle(ondoMapStyle(locale, dark ? "dark" : "light"))
  }, [locale, dark, ready])

  useEffect(() => {
    const instance = map.current
    if (!instance || !ready) return
    setRendered(false)
    let disposed = false
    import("maplibre-gl").then(({ Marker, LngLatBounds }) => {
      if (disposed) return
      markers.current.forEach(m => m.marker.remove())
      markers.current = places.map((place, index) => {
        const button = document.createElement("button")
        button.type = "button"
        button.className = styles.pin
        button.dataset.placeId = place.id
        button.dataset.selected = String(place.id === selected)
        button.setAttribute("aria-label", place.name[locale])
        button.setAttribute("aria-pressed", String(place.id === selected))
        const img = document.createElement("img")
        img.src = place.image
        img.alt = ""
        const number = document.createElement("span")
        number.textContent = String(index + 1)
        button.append(img, number)
        button.addEventListener("click", () => select.current(place.id))
        const marker = new Marker({ element: button, anchor: "center" }).setLngLat([place.longitude, place.latitude]).addTo(instance)
        return { marker, button, id: place.id }
      })
      // fitBounds and easeTo do not necessarily leave identical persistent padding.
      // Restore the actual transform, not a newly calculated content inset.
      if (restore) { instance.jumpTo(restore); return }
      const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 650
      const node = instance.getContainer()
      const padding = visiblePadding(node)
      if (places.length) {
        const bounds = new LngLatBounds()
        places.forEach(p => bounds.extend([p.longitude, p.latitude]))
        instance.fitBounds(bounds, { padding, maxZoom: places.length === 1 ? 14.8 : 13, duration })
      } else {
        instance.easeTo({ center: city === "seoul" ? [126.989, 37.556] : [126.934, 33.455], zoom: 11.7, padding, duration })
      }
    })
    return () => { disposed = true }
    // Selection and locale have their own effects; they must not refit a panned map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, viewKey, restore])

  useEffect(() => {
    markers.current.forEach(({ button, id }) => {
      button.dataset.selected = String(id === selected)
      button.setAttribute("aria-pressed", String(id === selected))
      const place = places.find(p => p.id === id)
      if (place) button.setAttribute("aria-label", place.name[locale])
    })
  }, [selected, locale, places])

  return <>
    <div className={styles.map} ref={container} data-testid="discovery-map" data-rendered={rendered} aria-label={locale === "ko" ? "장소 지도" : locale === "ja" ? "場所の地図" : "Place map"} />
    {!rendered && !failed && <div className={styles.mapLoading} role="status" aria-label={locale === "ko" ? "지도 불러오는 중" : locale === "ja" ? "地図を読み込み中" : "Loading map"}><MapPin size={24} aria-hidden="true" /></div>}
    {failed && <div className={styles.mapNotice} role="status">
      <span>{locale === "ko" ? "지도를 불러오지 못했어요. 아래 장소는 볼 수 있어요." : locale === "ja" ? "地図を読み込めません。下の場所は見られます。" : "Map unavailable. You can still explore the places below."}</span>
      <button type="button" onClick={() => setAttempt(n => n + 1)} aria-label={locale === "ko" ? "지도 다시 불러오기" : "Retry map"}><RotateCw size={18} /></button>
    </div>}
    <div className={styles.attribution}>
      <a href="https://openfreemap.org/" target="_blank" rel="noreferrer">OpenFreeMap</a>{" · "}
      <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a>
    </div>
  </>
}
