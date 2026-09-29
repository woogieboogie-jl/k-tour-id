import { isCanonicalVenueId, type CanonicalVenueId } from "@/lib/ondo/venues/canonical-allowlist"
import { isEditorialPlaceId, type EditorialPlaceB } from "../pulse-b/japan-first-pulse-model-b"
import { hasExactOwnKeys } from "../contracts/return-to-integrity"
import { personalPlaceByIdB } from "../place/place-memory-model-b"

/**
 * Public, navigation-only context for returning from a canonical Place to the
 * exact saved item that opened it. This receipt intentionally belongs to
 * history.state, never device preferences or session activity storage.
 */
export const MY_KOREA_PLACE_RETURN_HISTORY_KEY = "__ondoBMyKoreaReturn"
export const MY_KOREA_PLACE_RETURN_MAX_SCROLL_TOP = 10_000_000
export const MY_KOREA_SAVED_HEADING_ID = "my-korea-saved-heading"
export const MY_KOREA_SAVED_HEADING_SELECTOR = `#${MY_KOREA_SAVED_HEADING_ID}`
export const MY_KOREA_SAVED_OFFICIAL_OPENER_ATTRIBUTE = "data-my-korea-saved-official"
export const MY_KOREA_SAVED_EDITORIAL_OPENER_ATTRIBUTE = "data-my-korea-saved-editorial"
export const MY_KOREA_SAVED_DISCOVERY_OPENER_ATTRIBUTE = "data-my-korea-saved-discovery"

const JOURNEY_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const JOURNEY_ID = /^MYK-B-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const BASE_KEYS = ["v", "journeyId", "phase", "section", "scrollTop", "sourceKind"] as const

export type MyKoreaPlaceReturnJourneyIdB = `MYK-B-${string}`

type MyKoreaPlaceReturnBaseB = Readonly<{
  v: 1
  journeyId: MyKoreaPlaceReturnJourneyIdB
  phase: "origin" | "place"
  section: "saved"
  scrollTop: number
}>

export type MyKoreaPlaceReturnTargetB =
  | Readonly<{ sourceKind: "official"; venueId: CanonicalVenueId; editorialPlaceId?: never; discoveryPlaceId?: never }>
  | Readonly<{ sourceKind: "editorial"; venueId?: never; editorialPlaceId: EditorialPlaceB["id"]; discoveryPlaceId?: never }>
  | Readonly<{ sourceKind: "discovery"; venueId?: never; editorialPlaceId?: never; discoveryPlaceId: string }>

export type MyKoreaPlaceReturnReceiptB = MyKoreaPlaceReturnBaseB & MyKoreaPlaceReturnTargetB

export type MyKoreaPlaceReturnOriginInputB = Readonly<{
  journeyId: MyKoreaPlaceReturnJourneyIdB
  scrollTop: number
}> & MyKoreaPlaceReturnTargetB

export type MyKoreaPlaceReturnFocusTargetB = Readonly<{
  openerSelector: string
  fallbackId: typeof MY_KOREA_SAVED_HEADING_ID
  fallbackSelector: typeof MY_KOREA_SAVED_HEADING_SELECTOR
}>

function isPlainRecord(value: unknown): value is Record<PropertyKey, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isJourneyId(value: unknown): value is MyKoreaPlaceReturnJourneyIdB {
  return typeof value === "string" && JOURNEY_ID.test(value)
}

function isBoundedScrollTop(value: unknown): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= 0
    && value <= MY_KOREA_PLACE_RETURN_MAX_SCROLL_TOP
}

/** Convert a caller-supplied crypto.randomUUID() value into a scoped ID. */
export function createMyKoreaPlaceReturnJourneyId(uuid: string): MyKoreaPlaceReturnJourneyIdB | null {
  const normalized = uuid.toLowerCase()
  return JOURNEY_UUID.test(normalized) ? `MYK-B-${normalized}` : null
}

export function sanitizeMyKoreaPlaceReturnReceipt(value: unknown): MyKoreaPlaceReturnReceiptB | null {
  if (!isPlainRecord(value)
    || value.v !== 1
    || !isJourneyId(value.journeyId)
    || (value.phase !== "origin" && value.phase !== "place")
    || value.section !== "saved"
    || !isBoundedScrollTop(value.scrollTop)
    || (value.sourceKind !== "official" && value.sourceKind !== "editorial" && value.sourceKind !== "discovery")) return null

  const sourceKey = value.sourceKind === "official" ? "venueId" : value.sourceKind === "editorial" ? "editorialPlaceId" : "discoveryPlaceId"
  if (!hasExactOwnKeys(value as Record<string, unknown>, [...BASE_KEYS, sourceKey])) return null

  const scrollTop = Object.is(value.scrollTop, -0) ? 0 : value.scrollTop
  if (value.sourceKind === "discovery") {
    if (typeof value.discoveryPlaceId !== "string" || personalPlaceByIdB(value.discoveryPlaceId)?.kind !== "discovery") return null
    return Object.freeze({ v: 1, journeyId: value.journeyId, phase: value.phase, section: "saved", scrollTop, sourceKind: "discovery", discoveryPlaceId: value.discoveryPlaceId })
  }
  if (value.sourceKind === "official") {
    if (!isCanonicalVenueId(value.venueId)) return null
    return Object.freeze({
      v: 1,
      journeyId: value.journeyId,
      phase: value.phase,
      section: "saved",
      scrollTop,
      sourceKind: "official",
      venueId: value.venueId,
    })
  }
  if (!isEditorialPlaceId(value.editorialPlaceId)) return null
  return Object.freeze({
    v: 1,
    journeyId: value.journeyId,
    phase: value.phase,
    section: "saved",
    scrollTop,
    sourceKind: "editorial",
    editorialPlaceId: value.editorialPlaceId,
  })
}

export function createMyKoreaPlaceReturnOrigin(
  input: MyKoreaPlaceReturnOriginInputB,
): MyKoreaPlaceReturnReceiptB | null {
  return sanitizeMyKoreaPlaceReturnReceipt({
    ...input,
    v: 1,
    phase: "origin",
    section: "saved",
  })
}

export function createMyKoreaPlaceReturnPlace(
  origin: unknown,
): MyKoreaPlaceReturnReceiptB | null {
  const canonical = sanitizeMyKoreaPlaceReturnReceipt(origin)
  if (!canonical || canonical.phase !== "origin") return null
  return sanitizeMyKoreaPlaceReturnReceipt({ ...canonical, phase: "place" })
}

export function readMyKoreaPlaceReturnFromHistoryState(
  historyState: unknown,
): MyKoreaPlaceReturnReceiptB | null {
  if (!isPlainRecord(historyState)
    || !Object.prototype.hasOwnProperty.call(historyState, MY_KOREA_PLACE_RETURN_HISTORY_KEY)) return null
  return sanitizeMyKoreaPlaceReturnReceipt(historyState[MY_KOREA_PLACE_RETURN_HISTORY_KEY])
}

/**
 * Return a shallow history-state envelope. Unrelated Next/browser values are
 * retained by reference; only this feature's namespaced receipt is replaced.
 */
export function withMyKoreaPlaceReturnHistoryState(
  historyState: unknown,
  receipt: unknown,
): Record<PropertyKey, unknown> | null {
  const canonical = sanitizeMyKoreaPlaceReturnReceipt(receipt)
  if (!canonical || (historyState != null && !isPlainRecord(historyState))) return null
  const preserved = historyState == null ? {} : historyState
  return { ...preserved, [MY_KOREA_PLACE_RETURN_HISTORY_KEY]: canonical }
}

export function withoutMyKoreaPlaceReturnHistoryState(
  historyState: unknown,
): Record<PropertyKey, unknown> | null {
  if (historyState == null) return {}
  if (!isPlainRecord(historyState)) return null
  const { [MY_KOREA_PLACE_RETURN_HISTORY_KEY]: _receipt, ...preserved } = historyState
  return preserved
}

export function isSameMyKoreaPlaceReturnSource(left: unknown, right: unknown) {
  const first = sanitizeMyKoreaPlaceReturnReceipt(left)
  const second = sanitizeMyKoreaPlaceReturnReceipt(right)
  if (!first || !second || first.sourceKind !== second.sourceKind) return false
  return first.sourceKind === "official" && second.sourceKind === "official"
    ? first.venueId === second.venueId
    : first.sourceKind === "editorial" && second.sourceKind === "editorial"
      ? first.editorialPlaceId === second.editorialPlaceId
      : first.sourceKind === "discovery" && second.sourceKind === "discovery" && first.discoveryPlaceId === second.discoveryPlaceId
}

/** A place receipt may unwind only to its exact, same-source origin receipt. */
export function isMyKoreaPlaceReturnPair(origin: unknown, place: unknown) {
  const canonicalOrigin = sanitizeMyKoreaPlaceReturnReceipt(origin)
  const canonicalPlace = sanitizeMyKoreaPlaceReturnReceipt(place)
  return Boolean(canonicalOrigin
    && canonicalPlace
    && canonicalOrigin.phase === "origin"
    && canonicalPlace.phase === "place"
    && canonicalOrigin.journeyId === canonicalPlace.journeyId
    && canonicalOrigin.section === canonicalPlace.section
    && canonicalOrigin.scrollTop === canonicalPlace.scrollTop
    && isSameMyKoreaPlaceReturnSource(canonicalOrigin, canonicalPlace))
}

export function myKoreaPlaceReturnOpenerSelector(receipt: unknown): string | null {
  const canonical = sanitizeMyKoreaPlaceReturnReceipt(receipt)
  if (!canonical) return null
  return canonical.sourceKind === "official"
    ? `[${MY_KOREA_SAVED_OFFICIAL_OPENER_ATTRIBUTE}='${canonical.venueId}']`
    : canonical.sourceKind === "editorial" ? `[${MY_KOREA_SAVED_EDITORIAL_OPENER_ATTRIBUTE}='${canonical.editorialPlaceId}']`
    : `[${MY_KOREA_SAVED_DISCOVERY_OPENER_ATTRIBUTE}='${canonical.discoveryPlaceId}']`
}

export function myKoreaPlaceReturnFocusTarget(receipt: unknown): MyKoreaPlaceReturnFocusTargetB | null {
  const openerSelector = myKoreaPlaceReturnOpenerSelector(receipt)
  return openerSelector ? Object.freeze({
    openerSelector,
    fallbackId: MY_KOREA_SAVED_HEADING_ID,
    fallbackSelector: MY_KOREA_SAVED_HEADING_SELECTOR,
  }) : null
}
