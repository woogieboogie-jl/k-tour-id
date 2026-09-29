"use client"

import { useSyncExternalStore } from "react"
import { PLACE_MEMORY_KEY_B, sanitizePlaceMemoriesB, updatePlaceMemoryB, type PlaceMemoriesB, type PlaceMemoryB } from "./place-memory-model-b"

const EVENT = "ondo:b:place-memories"
const EMPTY: PlaceMemoriesB = Object.freeze({})
let cachedRaw: string | null | undefined
let cached: PlaceMemoriesB = EMPTY
function snapshot() {
  if (typeof window === "undefined") return EMPTY
  try {
    const raw = localStorage.getItem(PLACE_MEMORY_KEY_B)
    if (raw !== cachedRaw) { const next = raw ? sanitizePlaceMemoriesB(JSON.parse(raw)) : EMPTY; cachedRaw = raw; cached = next }
    return cached
  } catch { return EMPTY }
}
function subscribe(listener: () => void) {
  const storage = (event: StorageEvent) => { if (event.key === PLACE_MEMORY_KEY_B || event.key === null) listener() }
  window.addEventListener(EVENT, listener)
  window.addEventListener("storage", storage)
  return () => { window.removeEventListener(EVENT, listener); window.removeEventListener("storage", storage) }
}
export function usePlaceMemoriesB() { return useSyncExternalStore(subscribe, snapshot, () => EMPTY) }
export function writePlaceMemoryB(id: string, patch: Partial<PlaceMemoryB>) {
  try {
    const raw = localStorage.getItem(PLACE_MEMORY_KEY_B)
    const next = updatePlaceMemoryB(raw ? sanitizePlaceMemoriesB(JSON.parse(raw)) : {}, id, patch)
    if (!next) return false
    const serialized = JSON.stringify(next)
    localStorage.setItem(PLACE_MEMORY_KEY_B, serialized)
    if (localStorage.getItem(PLACE_MEMORY_KEY_B) !== serialized) return false
    window.dispatchEvent(new Event(EVENT))
    return true
  } catch { return false }
}
