"use client"

import { useEffect } from "react"
import type { Map as MapLibreMap } from "maplibre-gl"
import type { PersonalPlaceB } from "./place-memory-model-b"
import styles from "./content-place-shell-b.module.css"

/** A selected native place, not an activity score or merchant capability. */
export function PersonalPlaceMapPinB({ map, place }: { map: MapLibreMap | null; place: PersonalPlaceB | null }) {
  const id = place?.id, name = place?.name, longitude = place?.longitude, latitude = place?.latitude
  useEffect(() => {
    if (!map || !id || !name || longitude === undefined || latitude === undefined) return
    let disposed = false, remove: (() => void) | undefined
    const cleanup = () => { disposed = true; remove?.() }
    map.on("remove", cleanup)
    void import("maplibre-gl").then(({ Marker }) => {
      if (disposed) return
      const node = document.createElement("div")
      node.className = styles.selectedPin
      node.dataset.personalPlacePin = id
      node.setAttribute("role", "img")
      node.setAttribute("aria-label", name)
      node.textContent = name
      const marker = new Marker({ element: node, anchor: "bottom" }).setLngLat([longitude, latitude]).addTo(map)
      remove = () => marker.remove()
    }).catch(cleanup)
    return () => { map.off("remove", cleanup); cleanup() }
  }, [map, id, name, longitude, latitude])
  return null
}
