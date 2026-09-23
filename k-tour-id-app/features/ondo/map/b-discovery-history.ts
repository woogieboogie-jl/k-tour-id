import { captureQaControls, hasReviewSessionOptIn } from "../shared/ui/use-qa-controls"
import { SAMPLE_ENVIRONMENT_ENABLED } from "../contracts/sample-environment"
import { isEditorialPlaceId, type EditorialPlaceB } from "../pulse-b/japan-first-pulse-model-b"
import { isCanonicalVenueId, type CanonicalVenueId } from "@/lib/ondo/venues/canonical-allowlist"
import { canonicalMapVenueById } from "@/lib/ondo/venues/map-data"
import { discoveryCollectionCityB, discoveryPlaceByIdB, isDiscoveryCollectionIdB, type DiscoveryCollectionIdB } from "./discovery-collection-model-b"
import {
  MY_KOREA_PLACE_RETURN_HISTORY_KEY,
  createMyKoreaPlaceReturnJourneyId,
  createMyKoreaPlaceReturnOrigin,
  createMyKoreaPlaceReturnPlace,
  readMyKoreaPlaceReturnFromHistoryState,
  sanitizeMyKoreaPlaceReturnReceipt,
  withMyKoreaPlaceReturnHistoryState,
  withoutMyKoreaPlaceReturnHistoryState,
  type MyKoreaPlaceReturnReceiptB,
} from "../my/my-korea-place-return-b"

export type BDiscoveryCity = "seoul" | "busan" | "jeju"
export type BDiscoveryView = "map" | "list"
export type BDiscoveryCategory = "all" | "korean" | "casual" | "japanese" | "chinese" | "global" | "night" | "specialty"
export type BDiscoveryEditorialCategory = "all" | "screen-location" | "food" | "market" | "culture-shopping"
export type BDiscoveryLayer = "standard" | "after19"
export type BDiscoverySheetSnap = "closed" | "peek" | "detail"
export type BDiscoveryCamera = {
  longitude: number
  latitude: number
  zoom: number
  bearing: number
  pitch: number
}

type BDiscoveryFocus =
  | { kind: "city"; city: BDiscoveryCity }
  | { kind: "venue"; venueId: string }
  | { kind: "editorial-place"; editorialPlaceId: EditorialPlaceB["id"] }
  | { kind: "discovery-place"; discoveryPlaceId: string }
  | { kind: "search" }
  | { kind: "editorial" }
  | { kind: "view-toggle" }

export type BDiscoveryHistoryEntry = {
  v: 4
  documentId: string
  level: "nation" | "city" | "peek" | "detail"
  city?: BDiscoveryCity
  view: BDiscoveryView
  query: string
  category: BDiscoveryCategory
  editorialCategory: BDiscoveryEditorialCategory
  layer: BDiscoveryLayer
  sheetSnap: BDiscoverySheetSnap
  listScroll: number
  camera?: BDiscoveryCamera
  venueId?: string
  editorialPlaceId?: EditorialPlaceB["id"]
  collection?: DiscoveryCollectionIdB
  discoveryPlaceId?: string
  collectionSelection?: string
  focus?: BDiscoveryFocus
}

const HISTORY_KEY = "__ondoBDiscovery"
export const B_DISCOVERY_ROUTE = "/"
export const B_DISCOVERY_TRAVERSAL_EVENT = "ondo:b-discovery-traversal"
export const MY_KOREA_PLACE_RETURN_TRAVERSAL_EVENT = "ondo:b-my-korea-place-return-traversal"
const MAX_QUERY_LENGTH = 120
const MAX_LIST_SCROLL = 10_000_000
const VENUE_ID_PATTERN = /^mois-[a-z0-9]{20}$/
let activeDocumentId: string | undefined
let traversalGuardReferences = 0
let pendingPeekTraversalVenueId: string | undefined
let traversalFocusVersion = 0
let cancelTraversalFocus: (() => void) | undefined
let myKoreaTraversalGuardReferences = 0
const trustedMyKoreaTraversalEvents = new WeakSet<Event>()

export type BDiscoveryTraversalDetail = {
  entry: BDiscoveryHistoryEntry
  preservedState: unknown
}

export type MyKoreaPlaceReturnTraversalDetailB = {
  receipt: MyKoreaPlaceReturnReceiptB
}

function documentId() {
  if (typeof window === "undefined") return "server"
  activeDocumentId ??= crypto.randomUUID()
  return activeDocumentId
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
}

function cityValue(value: unknown): BDiscoveryCity | undefined {
  return value === "seoul" || value === "busan" || value === "jeju" ? value : undefined
}

function viewValue(value: unknown): BDiscoveryView {
  return value === "list" ? "list" : "map"
}

function categoryValue(value: unknown): BDiscoveryCategory {
  return value === "korean" || value === "casual" || value === "japanese" || value === "chinese"
    || value === "global" || value === "night" || value === "specialty"
    ? value
    : "all"
}

function editorialCategoryValue(value: unknown): BDiscoveryEditorialCategory {
  return value === "screen-location" || value === "food" || value === "market" || value === "culture-shopping"
    ? value
    : "all"
}

function layerValue(value: unknown): BDiscoveryLayer {
  return value === "after19" ? "after19" : "standard"
}

function sheetSnapForLevel(level: BDiscoveryHistoryEntry["level"]): BDiscoverySheetSnap {
  return level === "detail" ? "detail" : level === "peek" ? "peek" : "closed"
}

function listScrollValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.min(MAX_LIST_SCROLL, Math.round(value))
    : 0
}

function cameraValue(value: unknown): BDiscoveryCamera | undefined {
  if (!isRecord(value)) return undefined
  const { longitude, latitude, zoom, bearing, pitch } = value
  if (typeof longitude !== "number" || !Number.isFinite(longitude) || longitude < -180 || longitude > 180
    || typeof latitude !== "number" || !Number.isFinite(latitude) || latitude < -85 || latitude > 85
    || typeof zoom !== "number" || !Number.isFinite(zoom) || zoom < 0 || zoom > 24
    || typeof bearing !== "number" || !Number.isFinite(bearing) || bearing < -360 || bearing > 360
    || typeof pitch !== "number" || !Number.isFinite(pitch) || pitch < 0 || pitch > 85) return undefined
  return { longitude, latitude, zoom, bearing, pitch }
}

function venueValue(value: unknown): string | undefined {
  return typeof value === "string" && VENUE_ID_PATTERN.test(value) ? value : undefined
}

function editorialPlaceValue(value: unknown): EditorialPlaceB["id"] | undefined {
  return isEditorialPlaceId(value) ? value : undefined
}

function collectionValue(value: unknown, city: BDiscoveryCity | undefined): DiscoveryCollectionIdB | undefined {
  if (!city || !isDiscoveryCollectionIdB(value)) return undefined
  const collectionCity = discoveryCollectionCityB(value)
  return !collectionCity || collectionCity === city ? value : undefined
}

function collectionSelectionValue(value: unknown, city: BDiscoveryCity | undefined): string | undefined {
  if (typeof value !== "string" || !city) return undefined
  const place = discoveryPlaceByIdB(value)
  return place?.city === city ? place.id : undefined
}

function discoveryPlaceValue(value: unknown, city: BDiscoveryCity | undefined): string | undefined {
  const id = collectionSelectionValue(value, city)
  return id && discoveryPlaceByIdB(id)?.kind !== "sight" ? id : undefined
}

function withoutCollection(entry: BDiscoveryHistoryEntry): BDiscoveryHistoryEntry {
  const { collection: _collection, collectionSelection: _selection, discoveryPlaceId: _place, ...rest } = entry
  return rest
}

function queryValue(value: unknown): string {
  return typeof value === "string" ? value.slice(0, MAX_QUERY_LENGTH) : ""
}

function focusValue(value: unknown): BDiscoveryFocus | undefined {
  if (!isRecord(value)) return undefined
  if (value.kind === "city") {
    const city = cityValue(value.city)
    return city ? { kind: "city", city } : undefined
  }
  if (value.kind === "venue") {
    const venueId = venueValue(value.venueId)
    return venueId ? { kind: "venue", venueId } : undefined
  }
  if (value.kind === "editorial-place") {
    const editorialPlaceId = editorialPlaceValue(value.editorialPlaceId)
    return editorialPlaceId ? { kind: "editorial-place", editorialPlaceId } : undefined
  }
  if (value.kind === "discovery-place" && typeof value.discoveryPlaceId === "string") {
    const place = discoveryPlaceByIdB(value.discoveryPlaceId)
    return place && place.kind !== "sight" ? { kind: "discovery-place", discoveryPlaceId: place.id } : undefined
  }
  if (value.kind === "search" || value.kind === "editorial" || value.kind === "view-toggle") return { kind: value.kind }
  return undefined
}

function sanitizeEntry(value: unknown): BDiscoveryHistoryEntry | null {
  if (!isRecord(value) || (value.v !== 1 && value.v !== 2 && value.v !== 3 && value.v !== 4)) return null
  const level = value.level
  if (level !== "nation" && level !== "city" && level !== "peek" && level !== "detail") return null
  const city = cityValue(value.city)
  const venueId = venueValue(value.venueId)
  const editorialPlaceId = editorialPlaceValue(value.editorialPlaceId)
  const collection = level === "nation" ? undefined : collectionValue(value.collection, city)
  const discoveryPlaceId = collection ? discoveryPlaceValue(value.discoveryPlaceId, city) : undefined
  const collectionSelection = collection ? collectionSelectionValue(value.collectionSelection, city) : undefined
  if (level !== "nation" && !city) return null
  if ((level === "peek" || level === "detail") && [venueId, editorialPlaceId, discoveryPlaceId].filter(Boolean).length !== 1) return null
  if (discoveryPlaceId && level === "detail") return null
  if (editorialPlaceId && city !== "jeju") return null
  const rawFocus = focusValue(value.focus)
  const focus = rawFocus?.kind === "discovery-place" && (!collection || !discoveryPlaceValue(rawFocus.discoveryPlaceId, city)) ? undefined : rawFocus
  const sheetSnap = sheetSnapForLevel(level)
  const camera = level === "nation" ? cameraValue(value.camera) : cameraValue(value.camera)
  return {
    v: 4,
    documentId: typeof value.documentId === "string" ? value.documentId.slice(0, 64) : "legacy",
    level,
    city: level === "nation" ? undefined : city,
    view: level === "nation" ? "map" : viewValue(value.view),
    query: level === "nation" ? "" : queryValue(value.query),
    category: level === "nation" || value.v === 1 ? "all" : categoryValue(value.category),
    editorialCategory: level === "nation" ? "all" : editorialCategoryValue(value.editorialCategory),
    layer: level === "nation" ? "standard" : layerValue(value.layer),
    sheetSnap,
    listScroll: level === "nation" ? 0 : listScrollValue(value.listScroll),
    ...(camera ? { camera } : {}),
    venueId: level === "peek" || level === "detail" ? venueId : undefined,
    editorialPlaceId: level === "peek" || level === "detail" ? editorialPlaceId : undefined,
    ...(collection && !venueId ? { collection } : {}),
    ...(collection && !venueId && collectionSelection ? { collectionSelection } : {}),
    ...(level === "peek" && discoveryPlaceId ? { discoveryPlaceId } : {}),
    focus: level === "nation"
      ? focus?.kind === "city" ? focus : undefined
      : level === "city" ? focus : undefined,
  }
}

function canonicalEntry(entry: BDiscoveryHistoryEntry, nextDocumentId = entry.documentId): BDiscoveryHistoryEntry {
  return {
    v: 4,
    documentId: nextDocumentId,
    level: entry.level,
    ...(entry.city ? { city: entry.city } : {}),
    view: entry.view,
    query: entry.query,
    category: entry.category,
    editorialCategory: entry.editorialCategory,
    layer: entry.layer,
    sheetSnap: sheetSnapForLevel(entry.level),
    listScroll: entry.listScroll,
    ...(entry.camera ? { camera: entry.camera } : {}),
    ...(entry.venueId ? { venueId: entry.venueId } : {}),
    ...(entry.editorialPlaceId ? { editorialPlaceId: entry.editorialPlaceId } : {}),
    ...(entry.collection ? { collection: entry.collection } : {}),
    ...(entry.discoveryPlaceId ? { discoveryPlaceId: entry.discoveryPlaceId } : {}),
    ...(entry.collectionSelection ? { collectionSelection: entry.collectionSelection } : {}),
    ...(entry.focus ? { focus: entry.focus } : {}),
  }
}

function exactCanonicalValue(actual: unknown, expected: unknown): boolean {
  if (!isRecord(expected)) return Object.is(actual, expected)
  if (!isRecord(actual)) return false
  const actualKeys = Reflect.ownKeys(actual)
  const expectedKeys = Reflect.ownKeys(expected)
  return actualKeys.length === expectedKeys.length
    && expectedKeys.every((key) => actualKeys.includes(key)
      && exactCanonicalValue(Reflect.get(actual, key), Reflect.get(expected, key)))
}

function clearPendingBDiscoveryTraversalFocus() {
  cancelTraversalFocus?.()
  pendingPeekTraversalVenueId = undefined
  traversalFocusVersion += 1
}

function dispatchBDiscoveryEntryTraversal(entry: BDiscoveryHistoryEntry, preservedState: unknown) {
  cancelTraversalFocus?.()
  pendingPeekTraversalVenueId = entry.level === "peek" ? entry.venueId : undefined
  const focusVersion = ++traversalFocusVersion
  if ((entry.level === "nation" || entry.level === "city") && entry.focus) {
    let frame = 0
    let timeout = 0
    let observer: MutationObserver | undefined
    const cleanup = () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timeout)
      observer?.disconnect()
      if (cancelTraversalFocus === cleanup) cancelTraversalFocus = undefined
    }
    const focusAfterCommit = () => {
      if (traversalFocusVersion !== focusVersion) {
        cleanup()
        return
      }
      const target = focusBDiscoveryTarget(entry)
      if (target) {
        // Restore keyboard position without treating traversal as a fresh
        // request to open a search menu (which would cover restored results).
        target.dataset.discoveryRestoringFocus = "true"
        try { target.focus({ preventScroll: true }) }
        finally { delete target.dataset.discoveryRestoringFocus }
        if (document.activeElement === target) {
          cleanup()
          return
        }
      }
    }
    observer = new MutationObserver(focusAfterCommit)
    observer.observe(document.documentElement, { childList: true, subtree: true })
    frame = window.requestAnimationFrame(focusAfterCommit)
    timeout = window.setTimeout(cleanup, 3_000)
    cancelTraversalFocus = cleanup
  }
  window.dispatchEvent(new CustomEvent<BDiscoveryTraversalDetail>(B_DISCOVERY_TRAVERSAL_EVENT, {
    detail: { entry, preservedState },
  }))
}

function myKoreaPlaceReceiptMatchesDiscoveryEntry(
  receipt: MyKoreaPlaceReturnReceiptB,
  entry: BDiscoveryHistoryEntry,
) {
  if (receipt.phase !== "place" || (entry.level !== "peek" && entry.level !== "detail")) return false
  return receipt.sourceKind === "official"
    ? entry.venueId === receipt.venueId && entry.editorialPlaceId === undefined
    : entry.editorialPlaceId === receipt.editorialPlaceId && entry.venueId === undefined
}

export function readMyKoreaPlaceReturnNavigation(state?: unknown) {
  const source = state === undefined
    ? typeof window === "undefined" ? null : window.history.state
    : state
  const receipt = readMyKoreaPlaceReturnFromHistoryState(source)
  const entry = readBDiscoveryHistory(source)
  if (!receipt || !entry || (receipt.phase === "place" && !myKoreaPlaceReceiptMatchesDiscoveryEntry(receipt, entry))) return null
  return { receipt, entry } as const
}

function dispatchMyKoreaPlaceReturnTraversal(event: PopStateEvent) {
  const navigation = readMyKoreaPlaceReturnNavigation(event.state)
  if (!navigation) return false
  const { receipt, entry } = navigation

  event.stopImmediatePropagation()
  const traversalEvent = new CustomEvent<MyKoreaPlaceReturnTraversalDetailB>(MY_KOREA_PLACE_RETURN_TRAVERSAL_EVENT, {
    detail: { receipt },
  })
  trustedMyKoreaTraversalEvents.add(traversalEvent)
  window.dispatchEvent(traversalEvent)

  // The Explore map remains mounted while another tab is visible, so a place
  // return still needs the normal discovery traversal (for example detail ->
  // peek). A cold mount can also initialize from history.state.
  if (receipt.phase === "place" && traversalGuardReferences > 0) {
    dispatchBDiscoveryEntryTraversal(entry, event.state)
  } else {
    clearPendingBDiscoveryTraversalFocus()
  }
  return true
}

function dispatchBDiscoveryTraversal(event: PopStateEvent) {
  if (window.location.pathname !== B_DISCOVERY_ROUTE) {
    clearPendingBDiscoveryTraversalFocus()
    return
  }
  const entry = readBDiscoveryHistory(event.state)
  if (dispatchMyKoreaPlaceReturnTraversal(event)) return
  if (!entry) {
    clearPendingBDiscoveryTraversalFocus()
    return
  }
  event.stopImmediatePropagation()
  dispatchBDiscoveryEntryTraversal(entry, event.state)
}

export function consumeBDiscoveryPeekTraversalFocus(venueId: string) {
  const safeVenueId = venueValue(venueId)
  if (!safeVenueId || pendingPeekTraversalVenueId !== safeVenueId) return false
  pendingPeekTraversalVenueId = undefined
  return true
}

export function installBDiscoveryTraversalGuard() {
  traversalGuardReferences += 1
  if (traversalGuardReferences === 1 && myKoreaTraversalGuardReferences === 0) window.addEventListener("popstate", dispatchBDiscoveryTraversal, { capture: true })
  return () => {
    traversalGuardReferences = Math.max(0, traversalGuardReferences - 1)
    if (traversalGuardReferences === 0 && myKoreaTraversalGuardReferences === 0) {
      clearPendingBDiscoveryTraversalFocus()
      window.removeEventListener("popstate", dispatchBDiscoveryTraversal, { capture: true })
    }
  }
}

export function installMyKoreaPlaceReturnTraversalGuard() {
  myKoreaTraversalGuardReferences += 1
  if (myKoreaTraversalGuardReferences === 1 && traversalGuardReferences === 0) window.addEventListener("popstate", dispatchBDiscoveryTraversal, { capture: true })
  return () => {
    myKoreaTraversalGuardReferences = Math.max(0, myKoreaTraversalGuardReferences - 1)
    if (myKoreaTraversalGuardReferences === 0 && traversalGuardReferences === 0) {
      clearPendingBDiscoveryTraversalFocus()
      window.removeEventListener("popstate", dispatchBDiscoveryTraversal, { capture: true })
    }
  }
}

export function readMyKoreaPlaceReturnTraversal(event: Event) {
  if (!trustedMyKoreaTraversalEvents.has(event)
    || !(event instanceof CustomEvent)
    || event.type !== MY_KOREA_PLACE_RETURN_TRAVERSAL_EVENT
    || !isRecord(event.detail)) return null
  const receipt = sanitizeMyKoreaPlaceReturnReceipt(event.detail.receipt)
  return receipt ? { receipt } satisfies MyKoreaPlaceReturnTraversalDetailB : null
}

export function readBDiscoveryTraversal(event: Event) {
  if (!(event instanceof CustomEvent) || event.type !== B_DISCOVERY_TRAVERSAL_EVENT || !isRecord(event.detail)) return null
  const entry = sanitizeEntry(event.detail.entry)
  return entry ? { entry, preservedState: event.detail.preservedState } satisfies BDiscoveryTraversalDetail : null
}

function mergedState(
  entry: BDiscoveryHistoryEntry,
  preservedState?: unknown,
  preserveOrigin = false,
  explicitReceipt?: MyKoreaPlaceReturnReceiptB,
) {
  const preserved = isRecord(preservedState) ? preservedState : {}
  const current = isRecord(window.history.state) ? window.history.state : {}
  const combined = { ...preserved, ...current }
  const withoutReceipt = withoutMyKoreaPlaceReturnHistoryState(combined) ?? {}
  const base = { ...withoutReceipt, [HISTORY_KEY]: entry }
  const receipt = explicitReceipt ?? readMyKoreaPlaceReturnFromHistoryState(combined)
  const shouldPreserveReceipt = receipt && (
    (preserveOrigin && receipt.phase === "origin")
    || myKoreaPlaceReceiptMatchesDiscoveryEntry(receipt, entry)
  )
  return shouldPreserveReceipt
    ? withMyKoreaPlaceReturnHistoryState(base, receipt) ?? base
    : base
}

function entryUrl(entry: BDiscoveryHistoryEntry) {
  const url = new URL(B_DISCOVERY_ROUTE, window.location.origin)
  const explicitReview = new URLSearchParams(window.location.search).get("review")
  // A sample build is already a demo: rewriting its first '/' into '?review=1'
  // needlessly reconciles Next's router during hydration. Keep explicit choices
  // and session opt-outs without turning the default environment into a URL seam.
  if (explicitReview === "0" || explicitReview === "1") url.searchParams.set("review", explicitReview)
  else if (SAMPLE_ENVIRONMENT_ENABLED && !hasReviewSessionOptIn()) url.searchParams.set("review", "0")
  else if (!SAMPLE_ENVIRONMENT_ENABLED && hasReviewSessionOptIn()) url.searchParams.set("review", "1")
  if (entry.level !== "nation" && entry.city) {
    url.searchParams.set("city", entry.city)
    if (entry.view === "list") url.searchParams.set("view", "list")
    if (entry.query) url.searchParams.set("q", entry.query)
    if (entry.category !== "all") url.searchParams.set("category", entry.category)
    if (entry.city === "jeju" && entry.editorialCategory !== "all") url.searchParams.set("editorialCategory", entry.editorialCategory)
    if (entry.collection) url.searchParams.set("collection", entry.collection)
    if (entry.collection && entry.collectionSelection) url.searchParams.set("collectionSelection", entry.collectionSelection)
  }
  if ((entry.level === "peek" || entry.level === "detail") && entry.venueId) {
    url.searchParams.set("venueId", entry.venueId)
    if (entry.level === "detail") url.searchParams.set("detail", "1")
  }
  if ((entry.level === "peek" || entry.level === "detail") && entry.editorialPlaceId) {
    url.searchParams.set("editorialPlaceId", entry.editorialPlaceId)
    if (entry.level === "detail") url.searchParams.set("detail", "1")
  }
  if (entry.level === "peek" && entry.collection && entry.discoveryPlaceId) url.searchParams.set("discoveryPlaceId", entry.discoveryPlaceId)
  return `${url.pathname}${url.search}`
}

function historyStateMatchesCanonical(entry: BDiscoveryHistoryEntry, preservedState?: unknown, preserveOrigin = false) {
  const rawState = window.history.state
  if (!isRecord(rawState)) return false
  const expectedState = mergedState(entry, preservedState, preserveOrigin)
  const rawKeys = Reflect.ownKeys(rawState)
  const expectedKeys = Reflect.ownKeys(expectedState)
  if (rawKeys.length !== expectedKeys.length || !expectedKeys.every((key) => rawKeys.includes(key))) return false
  return expectedKeys.every((key) => key === HISTORY_KEY || key === MY_KOREA_PLACE_RETURN_HISTORY_KEY
    ? exactCanonicalValue(Reflect.get(rawState, key), key === HISTORY_KEY ? entry : Reflect.get(expectedState, key))
    : Object.is(Reflect.get(rawState, key), Reflect.get(expectedState, key)))
}

function replaceEntry(
  entry: BDiscoveryHistoryEntry,
  preservedState?: unknown,
  preserveOrigin = false,
  explicitReceipt?: MyKoreaPlaceReturnReceiptB,
) {
  const canonical = canonicalEntry(entry)
  History.prototype.replaceState.call(window.history, mergedState(canonical, preservedState, preserveOrigin, explicitReceipt), "", entryUrl(canonical))
}

function pushEntry(entry: BDiscoveryHistoryEntry, explicitReceipt?: MyKoreaPlaceReturnReceiptB) {
  const canonical = canonicalEntry(entry)
  History.prototype.pushState.call(window.history, mergedState(canonical, undefined, false, explicitReceipt), "", entryUrl(canonical))
}

export function replaceBDiscoveryUrl(url: string) {
  const requested = new URL(url, window.location.origin)
  const current = readBDiscoveryHistory()
  const nextUrl = requested.pathname === B_DISCOVERY_ROUTE && current
    ? entryUrl(current)
    : `${requested.pathname}${requested.search}${requested.hash}`
  const nextState = current
    ? mergedState(canonicalEntry(current))
    : withoutMyKoreaPlaceReturnHistoryState(window.history.state) ?? window.history.state
  History.prototype.replaceState.call(window.history, nextState, "", nextUrl)
}

export function readBDiscoveryHistory(state?: unknown): BDiscoveryHistoryEntry | null {
  const source = state === undefined
    ? typeof window === "undefined" ? null : window.history.state
    : state
  return isRecord(source) ? sanitizeEntry(source[HISTORY_KEY]) : null
}

export function replaceBDiscoveryHistoryForActiveDocument(entry: unknown, preservedState?: unknown) {
  const existing = sanitizeEntry(entry)
  if (!existing) return null
  const current = canonicalEntry(existing, documentId())
  const preserveOrigin = readMyKoreaPlaceReturnFromHistoryState(preservedState)?.phase === "origin"
    || (preservedState === undefined && readMyKoreaPlaceReturnFromHistoryState(window.history.state)?.phase === "origin")
  // Next patches the History prototype and treats even an identical
  // replaceState call as a router reconciliation. The traversal stabilizer
  // calls this more than once by design. Only the exact raw allowlisted entry,
  // URL, and preserved outer state may skip the rewrite: comparing sanitized
  // entries here would let private or unknown raw fields survive indefinitely.
  const canonicalUrl = new URL(entryUrl(current), window.location.origin).href
  if (historyStateMatchesCanonical(current, preservedState, preserveOrigin) && window.location.href === canonicalUrl) return current
  replaceEntry(current, preservedState, preserveOrigin)
  return current
}

export function normalizeBDiscoveryHistoryForActiveDocument() {
  const existing = readBDiscoveryHistory()
  if (!existing) return null
  return replaceBDiscoveryHistoryForActiveDocument(existing)
}

export type BDiscoveryCityContext = {
  city: BDiscoveryCity
  view: BDiscoveryView
  query: string
  category: BDiscoveryCategory
  editorialCategory?: BDiscoveryEditorialCategory
  layer?: BDiscoveryLayer
  listScroll?: number
  camera?: BDiscoveryCamera
  focus?: "search" | "view-toggle"
  collection?: DiscoveryCollectionIdB
  collectionSelection?: string
}

export function restoreBDiscoveryCityContext(input: BDiscoveryCityContext): BDiscoveryHistoryEntry | null
export function restoreBDiscoveryCityContext(input: unknown) {
  if (!isRecord(input)) return null
  const city = cityValue(input.city)
  const view = input.view === "map" || input.view === "list" ? input.view : undefined
  const category = input.category === "all"
    || input.category === "korean" || input.category === "casual" || input.category === "japanese"
    || input.category === "chinese" || input.category === "global" || input.category === "night"
    || input.category === "specialty"
    ? input.category
    : undefined
  const focus = input.focus === undefined
    ? undefined
    : input.focus === "search" || input.focus === "view-toggle"
      ? { kind: input.focus } as const
      : null
  const camera = input.camera === undefined ? undefined : cameraValue(input.camera)
  if (!city || !view || !category || focus === null || typeof input.query !== "string" || (input.camera !== undefined && !camera)) return null
  return replaceBDiscoveryHistoryForActiveDocument({
    v: 4,
    documentId: documentId(),
    level: "city",
    city,
    view,
    query: queryValue(input.query),
    category,
    editorialCategory: editorialCategoryValue(input.editorialCategory),
    layer: layerValue(input.layer),
    sheetSnap: "closed",
    listScroll: listScrollValue(input.listScroll),
    ...(camera ? { camera } : {}),
    ...(focus ? { focus } : {}),
    ...(collectionValue(input.collection, city) ? { collection: collectionValue(input.collection, city), collectionSelection: collectionSelectionValue(input.collectionSelection, city) } : {}),
  } satisfies BDiscoveryHistoryEntry)
}

export type BDiscoveryVenueContext = {
  city: BDiscoveryCity
  view: BDiscoveryView
  query: string
  category: BDiscoveryCategory
  editorialCategory?: BDiscoveryEditorialCategory
  layer?: BDiscoveryLayer
  listScroll?: number
  camera?: BDiscoveryCamera
  venueId: string
  level: "peek" | "detail"
}

export function restoreBDiscoveryVenueContext(input: BDiscoveryVenueContext): BDiscoveryHistoryEntry | null
export function restoreBDiscoveryVenueContext(input: unknown) {
  if (!isRecord(input)) return null
  const city = cityValue(input.city)
  const view = input.view === "map" || input.view === "list" ? input.view : undefined
  const category = input.category === "all"
    || input.category === "korean" || input.category === "casual" || input.category === "japanese"
    || input.category === "chinese" || input.category === "global" || input.category === "night"
    || input.category === "specialty"
    ? input.category
    : undefined
  const venueId = venueValue(input.venueId)
  const level = input.level === "peek" || input.level === "detail" ? input.level : undefined
  const camera = input.camera === undefined ? undefined : cameraValue(input.camera)
  if (!city || !view || !category || !venueId || !level || typeof input.query !== "string" || (input.camera !== undefined && !camera)) return null
  return replaceBDiscoveryHistoryForActiveDocument({
    v: 4,
    documentId: documentId(),
    level,
    city,
    view,
    query: queryValue(input.query),
    category,
    editorialCategory: editorialCategoryValue(input.editorialCategory),
    layer: layerValue(input.layer),
    sheetSnap: sheetSnapForLevel(level),
    listScroll: listScrollValue(input.listScroll),
    ...(camera ? { camera } : {}),
    venueId,
  } satisfies BDiscoveryHistoryEntry)
}

export function initializeBDiscoveryHistory(venueCity: (venueId: string) => BDiscoveryCity | undefined) {
  captureQaControls(window.location.search)
  const existing = normalizeBDiscoveryHistoryForActiveDocument()
  if (existing) return existing

  const url = new URL(window.location.href)
  const rawVenueId = venueValue(url.searchParams.get("venueId"))
  const rawEditorialPlaceId = editorialPlaceValue(url.searchParams.get("editorialPlaceId"))
  const rawDiscoveryPlace = discoveryPlaceByIdB(url.searchParams.get("discoveryPlaceId") ?? "")
  const rawDiscoveryPlaceId = rawDiscoveryPlace && rawDiscoveryPlace.kind !== "sight" ? rawDiscoveryPlace.id : undefined
  const ambiguousTarget = [rawVenueId, rawEditorialPlaceId, rawDiscoveryPlaceId].filter(Boolean).length > 1
  const requestedVenueId = ambiguousTarget ? undefined : rawVenueId
  const requestedEditorialPlaceId = ambiguousTarget ? undefined : rawEditorialPlaceId
  const resolvedVenueCity = requestedVenueId ? venueCity(requestedVenueId) : undefined
  const requestedCity = resolvedVenueCity ?? (requestedEditorialPlaceId ? "jeju" : cityValue(url.searchParams.get("city")))
  const requestedCollection = requestedVenueId ? undefined : collectionValue(url.searchParams.get("collection"), requestedCity)
  const requestedDiscoveryPlaceId = !ambiguousTarget && requestedCollection ? discoveryPlaceValue(rawDiscoveryPlaceId, requestedCity) : undefined
  const requestedCollectionSelection = requestedCollection ? collectionSelectionValue(url.searchParams.get("collectionSelection"), requestedCity) : undefined
  const requestedView = viewValue(url.searchParams.get("view"))
  const requestedCategory = categoryValue(url.searchParams.get("category"))
  const requestedEditorialCategory = editorialCategoryValue(url.searchParams.get("editorialCategory"))
  const requestedQuery = queryValue(url.searchParams.get("q"))
  const wantsDetail = url.searchParams.get("detail") === "1"
  const nation: BDiscoveryHistoryEntry = { v: 4, documentId: documentId(), level: "nation", view: "map", query: "", category: "all", editorialCategory: "all", layer: "standard", sheetSnap: "closed", listScroll: 0 }
  replaceEntry(nation)
  if (!requestedCity) return nation

  const city: BDiscoveryHistoryEntry = {
    v: 4,
    documentId: documentId(),
    level: "city",
    city: requestedCity,
    view: requestedView,
    query: requestedCollection ? "" : requestedQuery,
    category: requestedCategory,
    editorialCategory: requestedCity === "jeju" ? requestedEditorialCategory : "all",
    layer: "standard",
    sheetSnap: "closed",
    listScroll: 0,
    focus: { kind: requestedCity === "jeju" ? "editorial" : "search" },
  }
  pushEntry(city)
  let placeContext = city
  if (requestedCollection) {
    const collection = openBDiscoveryCollection(requestedCollection)
    if (collection) {
      placeContext = { ...collection, ...(requestedCollectionSelection ? { collectionSelection: requestedCollectionSelection } : {}) }
      replaceEntry(placeContext)
    }
  }
  if (requestedDiscoveryPlaceId) {
    openBDiscoveryCollectionPlace(requestedDiscoveryPlaceId)
    return readBDiscoveryHistory()!
  }
  if (requestedEditorialPlaceId) {
    const peek: BDiscoveryHistoryEntry = { ...placeContext, level: "peek", editorialPlaceId: requestedEditorialPlaceId, focus: undefined }
    pushEntry(peek)
    if (!wantsDetail) return peek
    const detail: BDiscoveryHistoryEntry = { ...peek, level: "detail" }
    pushEntry(detail)
    return detail
  }
  if (!requestedVenueId || !resolvedVenueCity) return placeContext

  const peek: BDiscoveryHistoryEntry = { ...city, level: "peek", venueId: requestedVenueId, focus: undefined }
  pushEntry(peek)
  if (!wantsDetail) return peek

  const detail: BDiscoveryHistoryEntry = { ...peek, level: "detail" }
  pushEntry(detail)
  return detail
}

export function enterBDiscoveryCity(city: BDiscoveryCity) {
  const current = readBDiscoveryHistory()
  if (current?.level === "nation") replaceEntry({ ...current, focus: { kind: "city", city } })
  const next: BDiscoveryHistoryEntry = { v: 4, documentId: documentId(), level: "city", city, view: "map", query: "", category: "all", editorialCategory: "all", layer: "standard", sheetSnap: "closed", listScroll: 0, focus: { kind: city === "jeju" ? "editorial" : "search" } }
  pushEntry(next)
  return next
}

export function replaceBDiscoveryCityContext(input: Pick<BDiscoveryHistoryEntry, "city" | "view" | "query" | "category"> & Partial<Pick<BDiscoveryHistoryEntry, "editorialCategory" | "layer" | "listScroll" | "camera">> & { focus?: BDiscoveryFocus; collection?: DiscoveryCollectionIdB | null; collectionSelection?: string | null }) {
  const current = readBDiscoveryHistory()
  if (current?.level !== "city" || !input.city) return current
  const collection = collectionValue(input.collection === undefined && input.city === current.city ? current.collection : input.collection, input.city)
  const collectionSelection = collection ? collectionSelectionValue(input.collectionSelection === undefined && collection === current.collection && input.city === current.city ? current.collectionSelection : input.collectionSelection, input.city) : undefined
  const requestedFocus = input.focus ?? current.focus
  const focus = requestedFocus?.kind === "discovery-place" && (!collection || !discoveryPlaceValue(requestedFocus.discoveryPlaceId, input.city)) ? undefined : requestedFocus
  const next: BDiscoveryHistoryEntry = {
    v: 4,
    documentId: documentId(),
    level: "city",
    city: input.city,
    view: viewValue(input.view),
    query: queryValue(input.query),
    category: categoryValue(input.category),
    editorialCategory: editorialCategoryValue(input.editorialCategory ?? current.editorialCategory),
    layer: layerValue(input.layer ?? current.layer),
    sheetSnap: "closed",
    listScroll: listScrollValue(input.listScroll ?? current.listScroll),
    ...((input.camera ?? current.camera) ? { camera: cameraValue(input.camera ?? current.camera) } : {}),
    focus,
    ...(collection ? { collection } : {}),
    ...(collectionSelection ? { collectionSelection } : {}),
  }
  replaceEntry(next)
  return next
}

/** Add one result scope above the exact city context; never silently switch cities. */
export function openBDiscoveryCollection(id: DiscoveryCollectionIdB): BDiscoveryHistoryEntry | null {
  const current = readBDiscoveryHistory()
  const collection = collectionValue(id, current?.city)
  if (current?.level !== "city" || !collection) return null
  if (current.collection === collection) return current
  const mood = collection === "hot" || collection === "cool"
  // The new result scope will frame its own places; the parent retains the
  // exact previous camera. Never reload a new collection at its parent's fit.
  const { camera: _parentCamera, ...context } = withoutCollection(current)
  const next: BDiscoveryHistoryEntry = {
    ...context,
    collection,
    query: mood ? collection : "",
    category: mood ? current.category : "all",
    editorialCategory: mood ? current.editorialCategory : "all",
    listScroll: 0,
    focus: { kind: "search" },
  }
  pushEntry(next)
  return next
}

/** Research/market details have a single peek; Jeju sights retain editorial navigation. */
export function openBDiscoveryCollectionPlace(id: string) {
  const current = readBDiscoveryHistory()
  const discoveryPlaceId = discoveryPlaceValue(id, current?.city)
  if (current?.level !== "city" || !current.collection || !discoveryPlaceId) return false
  const selected: BDiscoveryHistoryEntry = { ...current, collectionSelection: discoveryPlaceId }
  replaceEntry({ ...selected, focus: { kind: "discovery-place", discoveryPlaceId } })
  pushEntry({ ...selected, level: "peek", discoveryPlaceId, focus: undefined })
  return true
}

export function openBDiscoveryVenue(venueId: string) {
  const current = readBDiscoveryHistory()
  const safeVenueId = venueValue(venueId)
  if (current?.level !== "city" || !current.city || !safeVenueId) return false
  replaceEntry({ ...current, focus: { kind: "venue", venueId: safeVenueId } })
  pushEntry({ ...withoutCollection(current), level: "peek", venueId: safeVenueId, focus: undefined })
  return true
}

export function openBDiscoveryAlternativeVenue(currentVenueId: string, alternativeVenueId: string) {
  const current = readBDiscoveryHistory()
  const safeCurrentVenueId = venueValue(currentVenueId)
  const safeAlternativeVenueId = venueValue(alternativeVenueId)
  if ((current?.level !== "peek" && current?.level !== "detail")
    || !safeCurrentVenueId
    || current.venueId !== safeCurrentVenueId
    || !safeAlternativeVenueId
    || safeAlternativeVenueId === safeCurrentVenueId) return false
  replaceEntry({ ...withoutCollection(current), level: "peek", venueId: safeAlternativeVenueId, focus: undefined })
  return true
}

export function openBDiscoveryEditorialPlace(editorialPlaceId: EditorialPlaceB["id"]) {
  const current = readBDiscoveryHistory()
  const safeEditorialPlaceId = editorialPlaceValue(editorialPlaceId)
  if (!safeEditorialPlaceId || current?.city !== "jeju") return false
  const selected = current.collection ? { ...current, collectionSelection: collectionSelectionValue(safeEditorialPlaceId, current.city) } : current
  if (current.level === "peek") {
    replaceEntry({ ...selected, venueId: undefined, discoveryPlaceId: undefined, editorialPlaceId: safeEditorialPlaceId, focus: undefined })
    return true
  }
  if (current.level !== "city") return false
  replaceEntry({ ...selected, focus: { kind: "editorial-place", editorialPlaceId: safeEditorialPlaceId } })
  pushEntry({ ...selected, level: "peek", editorialPlaceId: safeEditorialPlaceId, focus: undefined })
  return true
}

function myKoreaSavedPlacePeek(
  current: BDiscoveryHistoryEntry,
  target: { sourceKind: "official"; venueId: CanonicalVenueId; city: BDiscoveryCity }
    | { sourceKind: "editorial"; editorialPlaceId: EditorialPlaceB["id"]; city: "jeju" },
): BDiscoveryHistoryEntry {
  const preserveCityContext = current.city === target.city
  const base: BDiscoveryHistoryEntry = {
    v: 4,
    documentId: documentId(),
    level: "peek",
    city: target.city,
    view: preserveCityContext ? current.view : "map",
    query: preserveCityContext ? current.query : "",
    category: preserveCityContext ? current.category : "all",
    editorialCategory: target.city === "jeju" && preserveCityContext ? current.editorialCategory : "all",
    layer: preserveCityContext ? current.layer : "standard",
    sheetSnap: "peek",
    listScroll: preserveCityContext ? current.listScroll : 0,
    ...(preserveCityContext && current.camera ? { camera: current.camera } : {}),
  }
  return target.sourceKind === "official"
    ? { ...base, venueId: target.venueId }
    : { ...base, editorialPlaceId: target.editorialPlaceId }
}

function discoveryEntryFromCurrentUrl(): BDiscoveryHistoryEntry | null {
  if (typeof window === "undefined" || window.location.pathname !== B_DISCOVERY_ROUTE) return null
  const url = new URL(window.location.href)
  const requestedVenueId = venueValue(url.searchParams.get("venueId"))
  const requestedEditorialPlaceId = editorialPlaceValue(url.searchParams.get("editorialPlaceId"))
  const rawDiscoveryPlace = discoveryPlaceByIdB(url.searchParams.get("discoveryPlaceId") ?? "")
  const rawDiscoveryPlaceId = rawDiscoveryPlace && rawDiscoveryPlace.kind !== "sight" ? rawDiscoveryPlace.id : undefined
  if ([requestedVenueId, requestedEditorialPlaceId, rawDiscoveryPlaceId].filter(Boolean).length > 1) return null
  const resolvedVenueCity = requestedVenueId ? canonicalMapVenueById(requestedVenueId)?.cityId : undefined
  const requestedCity = resolvedVenueCity ?? (requestedEditorialPlaceId ? "jeju" : cityValue(url.searchParams.get("city")))
  const collection = requestedVenueId ? undefined : collectionValue(url.searchParams.get("collection"), requestedCity)
  const discoveryPlaceId = collection ? discoveryPlaceValue(rawDiscoveryPlaceId, requestedCity) : undefined
  const collectionSelection = collection ? collectionSelectionValue(url.searchParams.get("collectionSelection"), requestedCity) : undefined
  const nation: BDiscoveryHistoryEntry = {
    v: 4,
    documentId: documentId(),
    level: "nation",
    view: "map",
    query: "",
    category: "all",
    editorialCategory: "all",
    layer: "standard",
    sheetSnap: "closed",
    listScroll: 0,
  }
  if (!requestedCity) return nation
  const city: BDiscoveryHistoryEntry = {
    ...nation,
    level: "city",
    city: requestedCity,
    view: viewValue(url.searchParams.get("view")),
    query: queryValue(url.searchParams.get("q")),
    category: categoryValue(url.searchParams.get("category")),
    editorialCategory: requestedCity === "jeju" ? editorialCategoryValue(url.searchParams.get("editorialCategory")) : "all",
    ...(collection ? { collection } : {}),
    ...(collectionSelection ? { collectionSelection } : {}),
  }
  if (discoveryPlaceId) return { ...city, level: "peek", sheetSnap: "peek", discoveryPlaceId }
  const wantsDetail = url.searchParams.get("detail") === "1"
  if (requestedEditorialPlaceId) return {
    ...city,
    level: wantsDetail ? "detail" : "peek",
    sheetSnap: wantsDetail ? "detail" : "peek",
    editorialPlaceId: requestedEditorialPlaceId,
  }
  if (requestedVenueId && resolvedVenueCity) return {
    ...city,
    level: wantsDetail ? "detail" : "peek",
    sheetSnap: wantsDetail ? "detail" : "peek",
    venueId: requestedVenueId,
  }
  return city
}

function openMyKoreaSavedPlace(
  scrollTop: number,
  target: { sourceKind: "official"; venueId: CanonicalVenueId; city: BDiscoveryCity }
    | { sourceKind: "editorial"; editorialPlaceId: EditorialPlaceB["id"]; city: "jeju" },
) {
  if (typeof window === "undefined" || window.location.pathname !== B_DISCOVERY_ROUTE) return false
  // Next may reconcile a same-document URL after a browser Back and briefly
  // retain only its private outer state. The already-mounted map still shows
  // that URL, so recover the public discovery origin from the canonical URL
  // instead of making the user's saved-place card a no-op.
  const current = readBDiscoveryHistory() ?? discoveryEntryFromCurrentUrl()
  const journeyId = createMyKoreaPlaceReturnJourneyId(crypto.randomUUID())
  if (!current || !journeyId) return false
  const origin = target.sourceKind === "official"
    ? createMyKoreaPlaceReturnOrigin({ journeyId, scrollTop, sourceKind: "official", venueId: target.venueId })
    : createMyKoreaPlaceReturnOrigin({ journeyId, scrollTop, sourceKind: "editorial", editorialPlaceId: target.editorialPlaceId })
  const place = createMyKoreaPlaceReturnPlace(origin)
  if (!origin || !place) return false
  const peek = myKoreaSavedPlacePeek(current, target)
  const originalState = window.history.state
  const originalUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`
  try {
    replaceEntry(current, undefined, true, origin)
    pushEntry(peek, place)
    // pushState never emits popstate. Notify the mounted Explore map now so a
    // My Korea card opens its canonical peek before the shell reveals Explore.
    dispatchBDiscoveryEntryTraversal(peek, window.history.state)
    return true
  } catch {
    try {
      History.prototype.replaceState.call(window.history, originalState, "", originalUrl)
    } catch {
      // The caller receives failure and keeps My Korea mounted. A browser that
      // also rejects rollback is already outside the History contract.
    }
    return false
  }
}

/**
 * My Korea-only entry: exactly one peek child is added above the saved origin.
 * The caller should then select Explore and present the canonical venue peek.
 */
export function openMyKoreaSavedBDiscoveryVenue(
  venueId: string,
  venueCity: BDiscoveryCity,
  savedScrollTop: number,
) {
  const safeVenueId = venueValue(venueId)
  const safeVenueCity = cityValue(venueCity)
  return Boolean(isCanonicalVenueId(safeVenueId)
    && safeVenueCity
    && canonicalMapVenueById(safeVenueId)?.cityId === safeVenueCity
    && openMyKoreaSavedPlace(savedScrollTop, {
    sourceKind: "official",
    venueId: safeVenueId,
    city: safeVenueCity,
  }))
}

/** My Korea-only editorial entry; like official places, it starts at peek. */
export function openMyKoreaSavedBDiscoveryEditorialPlace(
  editorialPlaceId: EditorialPlaceB["id"],
  savedScrollTop: number,
) {
  const safeEditorialPlaceId = editorialPlaceValue(editorialPlaceId)
  return Boolean(safeEditorialPlaceId && openMyKoreaSavedPlace(savedScrollTop, {
    sourceKind: "editorial",
    editorialPlaceId: safeEditorialPlaceId,
    city: "jeju",
  }))
}

/**
 * Clear this journey only; unrelated Next/browser state and the URL survive.
 *
 * An origin has one or two forward children carrying the matching place
 * receipt. Replacing H0 alone would let Forward resurrect an explicitly
 * abandoned journey. Replace H0 first, then push the same sanitized envelope:
 * the browser truncates those forward children without changing the URL. The
 * previous same-URL entry is already cleared, so Back cannot revive it either.
 */
export function clearMyKoreaPlaceReturnHistory() {
  if (typeof window === "undefined" || !isRecord(window.history.state)
    || !Object.prototype.hasOwnProperty.call(window.history.state, MY_KOREA_PLACE_RETURN_HISTORY_KEY)) return false
  const originalState = window.history.state
  const receipt = readMyKoreaPlaceReturnFromHistoryState(window.history.state)
  const cleared = withoutMyKoreaPlaceReturnHistoryState(originalState)
  if (!cleared) return false
  try {
    History.prototype.replaceState.call(window.history, cleared, "")
    if (receipt?.phase === "origin") History.prototype.pushState.call(window.history, cleared, "")
    return true
  } catch {
    try {
      History.prototype.replaceState.call(window.history, originalState, "")
    } catch {
      // The caller fails closed. A browser rejecting both mutations is outside
      // the History contract, but the original in-memory receipt is retained.
    }
    return false
  }
}

export function openSavedBDiscoveryVenue(venueId: string, venueCity: BDiscoveryCity) {
  if (typeof window === "undefined" || window.location.pathname !== B_DISCOVERY_ROUTE) return false
  const safeVenueId = venueValue(venueId)
  const safeVenueCity = cityValue(venueCity)
  if (!safeVenueId || !safeVenueCity) return false

  const current = readBDiscoveryHistory()
  if (current?.level === "peek" && current.venueId === safeVenueId) return true
  if (current?.level === "detail" && current.venueId === safeVenueId) return returnToBDiscoveryPeek(safeVenueId)

  const city: BDiscoveryHistoryEntry = current?.level === "city" && current.city === safeVenueCity
    ? { ...current, focus: { kind: "venue", venueId: safeVenueId } }
    : { v: 4, documentId: documentId(), level: "city", city: safeVenueCity, view: "map", query: "", category: "all", editorialCategory: "all", layer: "standard", sheetSnap: "closed", listScroll: 0, focus: { kind: "venue", venueId: safeVenueId } }

  if (current?.level === "nation") {
    replaceEntry({ ...current, focus: { kind: "city", city: safeVenueCity } })
    pushEntry(city)
  } else if (current?.level === "city" && current.city === safeVenueCity) {
    replaceEntry(city)
  } else if (current) {
    pushEntry(city)
  } else {
    replaceEntry({ v: 4, documentId: documentId(), level: "nation", view: "map", query: "", category: "all", editorialCategory: "all", layer: "standard", sheetSnap: "closed", listScroll: 0, focus: { kind: "city", city: safeVenueCity } })
    pushEntry(city)
  }
  pushEntry({ ...withoutCollection(city), level: "peek", venueId: safeVenueId, focus: undefined })
  return true
}

export function openSavedBDiscoveryEditorialPlace(editorialPlaceId: EditorialPlaceB["id"]) {
  if (typeof window === "undefined" || window.location.pathname !== B_DISCOVERY_ROUTE) return false
  const safeEditorialPlaceId = editorialPlaceValue(editorialPlaceId)
  if (!safeEditorialPlaceId) return false
  const current = readBDiscoveryHistory()
  if (current?.level === "peek" && current.editorialPlaceId === safeEditorialPlaceId) return true
  if (current?.level === "detail" && current.editorialPlaceId === safeEditorialPlaceId) return returnToBDiscoveryEditorialPeek(safeEditorialPlaceId)
  const city: BDiscoveryHistoryEntry = current?.level === "city" && current.city === "jeju"
    ? { ...current, focus: { kind: "editorial-place", editorialPlaceId: safeEditorialPlaceId } }
    : { v: 4, documentId: documentId(), level: "city", city: "jeju", view: "map", query: "", category: "all", editorialCategory: "all", layer: "standard", sheetSnap: "closed", listScroll: 0, focus: { kind: "editorial-place", editorialPlaceId: safeEditorialPlaceId } }
  if (current?.level === "nation") {
    replaceEntry({ ...current, focus: { kind: "city", city: "jeju" } })
    pushEntry(city)
  } else if (current?.level === "city" && current.city === "jeju") replaceEntry(city)
  else if (current) pushEntry(city)
  else {
    replaceEntry({ v: 4, documentId: documentId(), level: "nation", view: "map", query: "", category: "all", editorialCategory: "all", layer: "standard", sheetSnap: "closed", listScroll: 0, focus: { kind: "city", city: "jeju" } })
    pushEntry(city)
  }
  pushEntry({ ...city, level: "peek", editorialPlaceId: safeEditorialPlaceId, focus: undefined })
  return true
}

export function openBDiscoveryDetail(venueId: string) {
  const current = readBDiscoveryHistory()
  const safeVenueId = venueValue(venueId)
  if (current?.level !== "peek" || current.venueId !== safeVenueId) return false
  pushEntry({ ...current, level: "detail" })
  return true
}

export function openBDiscoveryEditorialDetail(editorialPlaceId: EditorialPlaceB["id"]) {
  const current = readBDiscoveryHistory()
  const safeEditorialPlaceId = editorialPlaceValue(editorialPlaceId)
  if (current?.level !== "peek" || current.editorialPlaceId !== safeEditorialPlaceId) return false
  pushEntry({ ...current, level: "detail" })
  return true
}

export function goBackFromBDiscovery(expected: "city" | "peek" | "detail") {
  const current = readBDiscoveryHistory()
  if (current?.level !== expected) return false
  window.history.back()
  return true
}

export function returnToBDiscoveryPeek(venueId: string) {
  const current = readBDiscoveryHistory()
  if (current?.level !== "detail" || current.venueId !== venueValue(venueId)) return false
  window.history.back()
  return true
}

export function returnToBDiscoveryEditorialPeek(editorialPlaceId: EditorialPlaceB["id"]) {
  const current = readBDiscoveryHistory()
  if (current?.level !== "detail" || current.editorialPlaceId !== editorialPlaceValue(editorialPlaceId)) return false
  window.history.back()
  return true
}

export function closeBDiscoveryPlace() {
  const current = readBDiscoveryHistory()
  if (current?.level !== "peek" && current?.level !== "detail") return false
  window.history.go(current.level === "detail" ? -2 : -1)
  return true
}

export function focusBDiscoveryTarget(entry: BDiscoveryHistoryEntry) {
  const focus = entry.focus
  if (!focus) return null
  if (focus.kind === "city") return document.querySelector<HTMLElement>(`[data-testid='ondo-b-nation'] [data-city='${focus.city}']`)
  if (focus.kind === "venue") {
    return document.querySelector<HTMLElement>(`[data-venue-opener='${CSS.escape(focus.venueId)}']`)
      ?? document.querySelector<HTMLElement>("[data-testid='ondo-b-view-toggle']")
  }
  if (focus.kind === "editorial-place") {
    const collectionCard = entry.collection ? document.querySelector<HTMLElement>(`[data-discovery-place-opener='${CSS.escape(focus.editorialPlaceId)}']`) : null
    if (collectionCard) return collectionCard
    return document.querySelector<HTMLElement>(`[data-editorial-place-opener='${CSS.escape(focus.editorialPlaceId)}']`)
      ?? document.querySelector<HTMLElement>("[data-testid='ondo-b-japan-first-discovery'] > summary")
  }
  if (focus.kind === "discovery-place") {
    return document.querySelector<HTMLElement>(`[data-discovery-place-opener='${CSS.escape(focus.discoveryPlaceId)}']`)
      ?? document.querySelector<HTMLElement>("[data-testid='ondo-b-search']")
  }
  if (focus.kind === "search") return document.querySelector<HTMLElement>("[data-testid='ondo-b-search']")
  if (focus.kind === "editorial") return document.querySelector<HTMLElement>("[data-testid='ondo-b-japan-first-discovery'] > summary")
  return document.querySelector<HTMLElement>("[data-testid='ondo-b-view-toggle']")
}
