import { canonicalMapVenueById } from "@/lib/ondo/venues/map-data"
import { venueNamePresentation } from "@/lib/ondo/venues/display"
import { editorialPlaceById } from "../pulse-b/japan-first-pulse-model-b"
import { researchedFoodByIdB } from "../map/researched-food-b"
import { discoveryPlaceByIdB } from "../map/discovery-collection-model-b"
import type { OndoBLocale } from "../shared/state/ondo-b-preferences"

export const PLACE_MEMORY_KEY_B = "ondo-b.place-memories.v1"
export const PLACE_MEMORY_NOTE_LIMIT_B = 1_000
export type PersonalPlaceB = { id: string; city: "seoul" | "busan" | "jeju"; kind: "canonical" | "editorial" | "discovery"; name: string; address: string; latitude: number; longitude: number; source: string }
/** Native IDs only. A research record never impersonates an official merchant. */
export function personalPlaceByIdB(id: string, locale: OndoBLocale = "en"): PersonalPlaceB | null {
  const canonical = canonicalMapVenueById(id)
  if (canonical) return { id, city: canonical.cityId, kind: "canonical", name: venueNamePresentation(canonical.name.ko, locale).officialName, address: "", latitude: canonical.latitude, longitude: canonical.longitude, source: canonical.sourceRefId }
  const editorial = editorialPlaceById(id)
  if (editorial) return { id, city: "jeju", kind: "editorial", name: editorial.name[locale], address: locale === "ko" ? editorial.address.ko : editorial.address.en, latitude: editorial.location.latitude, longitude: editorial.location.longitude, source: editorial.placeSourceUrl }
  const research = researchedFoodByIdB(id)
  if (research) return { id, city: research.city, kind: "discovery", name: research.name[locale], address: research.address, latitude: research.latitude, longitude: research.longitude, source: research.sources[0]?.url ?? research.coordinateSourceUrl }
  const discovery = discoveryPlaceByIdB(id)
  if (discovery) return { id, city: discovery.city, kind: "discovery", name: discovery.name[locale], address: discovery.area[locale], latitude: discovery.latitude, longitude: discovery.longitude, source: discovery.source }
  return null
}

export type PlaceMemoryB = { saved: boolean; note: string; visitedAt: string | null }
export type PlaceMemoriesB = Record<string, PlaceMemoryB>
export function sanitizePlaceMemoriesB(value: unknown): PlaceMemoriesB {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const result: PlaceMemoriesB = {}
  for (const [id, raw] of Object.entries(value).slice(0, 500)) {
    if (!personalPlaceByIdB(id) || !raw || typeof raw !== "object" || Array.isArray(raw)) continue
    const record = raw as Record<string, unknown>
    const note = typeof record.note === "string" ? record.note.slice(0, PLACE_MEMORY_NOTE_LIMIT_B) : ""
    const visitedAt = typeof record.visitedAt === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(record.visitedAt) && Number.isFinite(Date.parse(record.visitedAt)) ? record.visitedAt : null
    // Existing official/editorial bookmarks remain owned by their established store.
    const saved = personalPlaceByIdB(id)?.kind === "discovery" && record.saved === true
    if (saved || note || visitedAt) result[id] = { saved, note, visitedAt }
  }
  return result
}

/** A private diary is not a visit proof, stamp, identity result or entitlement. */
export function updatePlaceMemoryB(current: PlaceMemoriesB, id: string, patch: Partial<PlaceMemoryB>): PlaceMemoriesB | null {
  if (!personalPlaceByIdB(id)) return null
  if (patch.note !== undefined && (typeof patch.note !== "string" || patch.note.length > PLACE_MEMORY_NOTE_LIMIT_B)) return null
  const record = { ...(current[id] ?? { saved: false, note: "", visitedAt: null }), ...patch }
  const next = sanitizePlaceMemoriesB({ ...current, [id]: record })
  // A bounded sanitizer must not turn a dropped new record into a successful save.
  const expected = sanitizePlaceMemoriesB({ [id]: record })[id]
  return JSON.stringify(next[id]) === JSON.stringify(expected) ? next : null
}
