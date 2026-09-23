import { expect, test } from "@playwright/test"
import {
  enterBDiscoveryCity,
  goBackFromBDiscovery,
  initializeBDiscoveryHistory,
  normalizeBDiscoveryHistoryForActiveDocument,
  openBDiscoveryCollection,
  openBDiscoveryCollectionPlace,
  openBDiscoveryEditorialDetail,
  openBDiscoveryEditorialPlace,
  openBDiscoveryVenue,
  readBDiscoveryHistory,
  replaceBDiscoveryCityContext,
  type BDiscoveryHistoryEntry,
} from "../../features/ondo/map/b-discovery-history"

const FOOD = "research-seoul-onion-anguk"
const MARKET = "lab-seoul-jungbu-market"
const SIGHT = "jeju-seongsan-ilchulbong"
const VENUE = "mois-0021cd596bc5b2a922ad"
const CAMERA = { longitude: 126.97, latitude: 37.56, zoom: 13.25, bearing: 7, pitch: 23 }

/** Browser-free history stack: exercises the production helpers, sanitizers
 * and URLs. It does not stand in for DOM focus, MapLibre or browser E2E. */
function withHistory(path: string, check: (environment: {
  history: ContractHistory
  url: () => URL
  entry: () => BDiscoveryHistoryEntry
}) => void) {
  let url = new URL(path, "http://localhost:3142")
  const nextTree = { segment: "preserve-next-state" }
  class HistoryStack {
    entries = [{ state: { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: nextTree } as unknown, url: url.href }]
    index = 0
    replacements = 0
    get state() { return this.entries[this.index].state }
    set state(state: unknown) { this.entries[this.index].state = state }
    get length() { return this.entries.length }
    replaceState(state: unknown, _unused: string, requested?: string | URL | null) {
      this.replacements += 1
      if (requested != null) url = new URL(String(requested), url)
      this.entries[this.index] = { state, url: url.href }
    }
    pushState(state: unknown, _unused: string, requested?: string | URL | null) {
      if (requested != null) url = new URL(String(requested), url)
      this.entries.splice(this.index + 1)
      this.entries.push({ state, url: url.href })
      this.index += 1
    }
    go(delta: number) {
      const next = this.index + delta
      if (next < 0 || next >= this.length) return
      this.index = next
      url = new URL(this.entries[next].url)
    }
    back() { this.go(-1) }
    forward() { this.go(1) }
  }
  const history = new HistoryStack()
  const storage = new Map<string, string>()
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window")
  const previousHistory = Object.getOwnPropertyDescriptor(globalThis, "History")
  Object.defineProperty(globalThis, "History", { configurable: true, value: HistoryStack })
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    history,
    location: {
      get origin() { return url.origin }, get pathname() { return url.pathname },
      get search() { return url.search }, get hash() { return url.hash }, get href() { return url.href },
    },
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  } })
  try {
    check({ history, url: () => url, entry: () => readBDiscoveryHistory()! })
    expect((history.state as Record<string, unknown>).__PRIVATE_NEXTJS_INTERNALS_TREE).toBe(nextTree)
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow)
    else Reflect.deleteProperty(globalThis, "window")
    if (previousHistory) Object.defineProperty(globalThis, "History", previousHistory)
    else Reflect.deleteProperty(globalThis, "History")
  }
}

type ContractHistory = {
  entries: { state: unknown; url: string }[]
  index: number; state: unknown; length: number; replacements: number
  back(): void; forward(): void
}

function initialize() { return initializeBDiscoveryHistory(id => id === VENUE ? "seoul" : undefined) }

test("COLLECTION-HISTORY-001 legacy entries remain v4 without new optional keys or extra steps", () => {
  withHistory("/?city=seoul&view=list&q=noodles&category=korean", ({ history, entry, url }) => {
    initialize()
    expect(history.length).toBe(2)
    expect(entry()).toMatchObject({ v: 4, level: "city", city: "seoul", view: "list", query: "noodles", category: "korean" })
    const raw = (history.state as Record<string, unknown>).__ondoBDiscovery
    expect(raw).not.toHaveProperty("collection")
    expect(raw).not.toHaveProperty("collectionSelection")
    expect(raw).not.toHaveProperty("discoveryPlaceId")
    const replacements = history.replacements
    normalizeBDiscoveryHistoryForActiveDocument()
    expect(history.replacements).toBe(replacements)
    expect(url().searchParams.has("collection")).toBe(false)
  })
})

test("COLLECTION-HISTORY-002 story Back restores the exact city filters, list scroll, layer and camera", () => {
  withHistory("/?city=seoul", ({ history, entry }) => {
    initialize()
    replaceBDiscoveryCityContext({ city: "seoul", view: "list", query: "coffee", category: "night", editorialCategory: "food", layer: "after19", listScroll: 731, camera: CAMERA })
    const before = entry()
    expect(openBDiscoveryCollection("sesame")).toMatchObject({ collection: "sesame", query: "", category: "all", editorialCategory: "all", layer: "after19" })
    expect(entry()).not.toHaveProperty("camera")
    expect((history.entries[history.index - 1].state as { __ondoBDiscovery: BDiscoveryHistoryEntry }).__ondoBDiscovery.camera).toEqual(CAMERA)
    expect(history.length).toBe(3)
    expect(goBackFromBDiscovery("city")).toBe(true)
    expect(entry()).toEqual(before)
    history.forward()
    expect(entry().collection).toBe("sesame")
  })
})

test("COLLECTION-HISTORY-003 moods preserve category and layer; replacement, not state leakage, follows Back", () => {
  withHistory("/?city=seoul&category=korean", ({ history, entry }) => {
    initialize()
    replaceBDiscoveryCityContext({ city: "seoul", view: "map", query: "rice", category: "korean", layer: "after19" })
    expect(openBDiscoveryCollection("hot")).toMatchObject({ collection: "hot", query: "hot", category: "korean", layer: "after19" })
    const length = history.length
    openBDiscoveryCollection("hot")
    expect(history.length).toBe(length)
    expect(openBDiscoveryCollection("cool")).toMatchObject({ collection: "cool", query: "cool", category: "korean" })
    history.back()
    expect(entry().collection).toBe("hot")
    history.back()
    expect(entry()).toMatchObject({ query: "rice", category: "korean", layer: "after19" })
    expect(entry()).not.toHaveProperty("collection")
  })
})

test("COLLECTION-HISTORY-004 research peek Back/Forward preserves the result selection and exact place", () => {
  withHistory("/?city=seoul", ({ history, entry, url }) => {
    initialize()
    openBDiscoveryCollection("hot")
    expect(openBDiscoveryCollectionPlace(FOOD)).toBe(true)
    expect(entry()).toMatchObject({ level: "peek", sheetSnap: "peek", collection: "hot", discoveryPlaceId: FOOD, collectionSelection: FOOD })
    expect(url().searchParams.get("discoveryPlaceId")).toBe(FOOD)
    expect(goBackFromBDiscovery("peek")).toBe(true)
    expect(entry()).toMatchObject({ level: "city", collection: "hot", collectionSelection: FOOD, focus: { kind: "discovery-place", discoveryPlaceId: FOOD } })
    expect(url().searchParams.has("discoveryPlaceId")).toBe(false)
    history.forward()
    expect(entry().discoveryPlaceId).toBe(FOOD)
    const length = history.length
    initialize()
    expect(history.length).toBe(length)
    expect(entry().discoveryPlaceId).toBe(FOOD)
  })
})

test("COLLECTION-HISTORY-005 direct research URL creates nation, city, collection and peek in order", () => {
  withHistory(`/?city=seoul&collection=hot&discoveryPlaceId=${FOOD}&detail=1&review=0`, ({ history, entry, url }) => {
    expect(initialize()).toMatchObject({ level: "peek", collection: "hot", discoveryPlaceId: FOOD })
    expect(history.length).toBe(4)
    expect(url().searchParams.get("detail")).toBeNull()
    history.back()
    expect(entry()).toMatchObject({ level: "city", collection: "hot", collectionSelection: FOOD })
    history.back()
    expect(entry()).toMatchObject({ level: "city", city: "seoul", query: "" })
    expect(entry()).not.toHaveProperty("collection")
    history.back()
    expect(entry().level).toBe("nation")
    expect(url().searchParams.get("review")).toBe("0")
  })
})

test("COLLECTION-HISTORY-006 selected result URL survives reload without opening its detail", () => {
  withHistory(`/?city=seoul&collection=cool&collectionSelection=${FOOD}`, ({ history, entry, url }) => {
    initialize()
    expect(history.length).toBe(3)
    expect(entry()).toMatchObject({ level: "city", collection: "cool", collectionSelection: FOOD })
    expect(url().searchParams.get("collectionSelection")).toBe(FOOD)
    expect(entry()).not.toHaveProperty("discoveryPlaceId")
  })
})

test("COLLECTION-HISTORY-007 same-city updates preserve scope; explicit null and a new city clear it", () => {
  withHistory("/?city=seoul", ({ entry }) => {
    initialize()
    openBDiscoveryCollection("sesame")
    const context = { city: "seoul" as const, view: "map" as const, query: "", category: "all" as const }
    replaceBDiscoveryCityContext({ ...context, collectionSelection: MARKET })
    replaceBDiscoveryCityContext({ ...context, camera: CAMERA, listScroll: 23 })
    expect(entry()).toMatchObject({ collection: "sesame", collectionSelection: MARKET, camera: CAMERA, listScroll: 23 })
    replaceBDiscoveryCityContext({ ...context, collectionSelection: null })
    expect(entry()).not.toHaveProperty("collectionSelection")
    expect(entry().collection).toBe("sesame")
    replaceBDiscoveryCityContext({ ...context, collection: null, collectionSelection: MARKET })
    expect(entry()).not.toHaveProperty("collection")
    expect(entry()).not.toHaveProperty("collectionSelection")
    openBDiscoveryCollection("hot")
    replaceBDiscoveryCityContext({ ...context, city: "busan" })
    expect(entry()).not.toHaveProperty("collection")
    expect(entry()).not.toHaveProperty("collectionSelection")
  })
})

test("COLLECTION-HISTORY-008 wrong city, unknown ID, sight-as-research and missing collection fail closed", () => {
  withHistory("/?city=seoul", ({ history, entry }) => {
    initialize()
    expect(openBDiscoveryCollectionPlace(FOOD)).toBe(false)
    expect(openBDiscoveryCollection("screen")).toBeNull()
    openBDiscoveryCollection("hot")
    const length = history.length
    expect(openBDiscoveryCollectionPlace("unknown-place")).toBe(false)
    expect(openBDiscoveryCollectionPlace(SIGHT)).toBe(false)
    expect(history.length).toBe(length)
    const base = entry()
    for (const invalid of [
      { ...base, level: "peek", discoveryPlaceId: SIGHT },
      { ...base, level: "peek", city: "jeju", discoveryPlaceId: FOOD },
      { ...base, level: "peek", collection: undefined, discoveryPlaceId: FOOD },
      { ...base, level: "detail", discoveryPlaceId: FOOD },
      { ...base, level: "peek", discoveryPlaceId: FOOD, venueId: VENUE },
    ]) expect(readBDiscoveryHistory({ __ondoBDiscovery: invalid })).toBeNull()
  })
})

test("COLLECTION-HISTORY-009 Jeju sights retain the editorial peek/detail path and collection on return", () => {
  withHistory("/?city=jeju", ({ history, entry }) => {
    initialize()
    openBDiscoveryCollection("screen")
    expect(openBDiscoveryCollectionPlace(SIGHT)).toBe(false)
    expect(openBDiscoveryEditorialPlace(SIGHT)).toBe(true)
    expect(entry()).toMatchObject({ level: "peek", collection: "screen", editorialPlaceId: SIGHT, collectionSelection: SIGHT })
    expect(openBDiscoveryEditorialDetail(SIGHT)).toBe(true)
    expect(entry()).toMatchObject({ level: "detail", editorialPlaceId: SIGHT, collection: "screen" })
    history.back()
    history.back()
    expect(entry()).toMatchObject({ level: "city", collection: "screen", collectionSelection: SIGHT })
  })
})

test("COLLECTION-HISTORY-010 canonical places clear the child scope without destroying their collection parent", () => {
  withHistory("/?city=seoul", ({ history, entry }) => {
    initialize()
    openBDiscoveryCollection("hot")
    replaceBDiscoveryCityContext({ city: "seoul", view: "map", query: "hot", category: "all", collectionSelection: FOOD })
    expect(openBDiscoveryVenue(VENUE)).toBe(true)
    expect(entry()).toMatchObject({ level: "peek", venueId: VENUE })
    expect(entry()).not.toHaveProperty("collection")
    expect(entry()).not.toHaveProperty("collectionSelection")
    history.back()
    expect(entry()).toMatchObject({ level: "city", collection: "hot", collectionSelection: FOOD })
    enterBDiscoveryCity("jeju")
    expect(entry()).not.toHaveProperty("collection")
  })
})

test("COLLECTION-HISTORY-011 normalization removes private fields and foreign selection then becomes idempotent", () => {
  withHistory("/?city=seoul&collection=hot", ({ history, entry }) => {
    initialize()
    const envelope = history.state as Record<string, unknown>
    history.state = { ...envelope, __ondoBDiscovery: { ...entry(), collectionSelection: SIGHT, privateDraft: "not retained", focus: { kind: "discovery-place", discoveryPlaceId: SIGHT } } }
    normalizeBDiscoveryHistoryForActiveDocument()
    expect(entry().collection).toBe("hot")
    expect(entry()).not.toHaveProperty("collectionSelection")
    expect(entry().focus).toBeUndefined()
    expect((history.state as Record<string, unknown>).__ondoBDiscovery).not.toHaveProperty("privateDraft")
    const replacements = history.replacements
    normalizeBDiscoveryHistoryForActiveDocument()
    expect(history.replacements).toBe(replacements)
  })
})

test("COLLECTION-HISTORY-012 direct cross-city and ambiguous targets never open a mixed place envelope", () => {
  for (const path of [
    `/?city=jeju&collection=screen&discoveryPlaceId=${FOOD}`,
    `/?city=seoul&collection=screen&discoveryPlaceId=${FOOD}`,
    `/?city=seoul&collection=hot&discoveryPlaceId=${FOOD}&venueId=${VENUE}`,
  ]) withHistory(path, ({ entry, url }) => {
    initialize()
    expect(entry().level).toBe("city")
    expect(entry()).not.toHaveProperty("discoveryPlaceId")
    expect(entry()).not.toHaveProperty("venueId", VENUE)
    expect(url().searchParams.get("discoveryPlaceId")).toBeNull()
  })
})
