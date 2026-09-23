import { expect, test } from "@playwright/test"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  DISCOVERY_COLLECTION_COPY_B,
  discoveryCollectionCityB,
  discoveryCollectionPlacesB,
  discoveryCollectionSourceB,
  discoveryCollectionTitleB,
  discoveryMoodFromQueryB,
  discoveryPlaceByIdB,
  discoveryStoryForCityB,
  isDiscoveryCollectionIdB,
  type DiscoveryCollectionIdB,
} from "../../features/ondo/map/discovery-collection-model-b"
import { researchedFoodByIdB } from "../../features/ondo/map/researched-food-b"
import { editorialPlaceById } from "../../features/ondo/pulse-b/japan-first-pulse-model-b"

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const collections: DiscoveryCollectionIdB[] = ["hot", "cool", "sesame", "screen"]
const base = { city: "seoul", category: "all", editorialCategory: "all", after19: false, balanceOnly: false }
const hotIds = ["research-seoul-onion-anguk", "research-seoul-geumdwaeji-sikdang", "research-seoul-london-bagel-dosan"]
const coolIds = ["research-seoul-hakrim-dabang", "research-seoul-gosari-express", "research-seoul-okdongsik"]
const marketId = "lab-seoul-jungbu-market"
const sightIds = ["jeju-seongsan-ilchulbong", "jeju-gwangchigi-beach"]
const allIds = [...hotIds, ...coolIds, marketId, ...sightIds]
const ids = (id: DiscoveryCollectionIdB, overrides: Partial<typeof base> = {}) => discoveryCollectionPlacesB(id, { ...base, ...overrides }).map(place => place.id)

test("COLLECTION-MODEL-001 collection IDs and story cities are bounded; moods do not choose a city", () => {
  for (const id of collections) expect(isDiscoveryCollectionIdB(id)).toBe(true)
  for (const invalid of [null, undefined, "HOT", "unknown", "__proto__", {}, [], 0]) expect(isDiscoveryCollectionIdB(invalid)).toBe(false)
  expect(discoveryCollectionCityB("sesame")).toBe("seoul")
  expect(discoveryCollectionCityB("screen")).toBe("jeju")
  expect(discoveryCollectionCityB("hot")).toBeUndefined()
  expect(discoveryCollectionCityB("cool")).toBeUndefined()
  expect(discoveryStoryForCityB("seoul")?.id).toBe("sesame")
  expect(discoveryStoryForCityB("jeju")?.id).toBe("screen")
  expect(discoveryStoryForCityB("busan")).toBeUndefined()
  expect(discoveryStoryForCityB("unknown")).toBeUndefined()
})

test("COLLECTION-MODEL-002 Seoul has exactly three stable Hot and three distinct Cool examples", () => {
  expect(ids("hot")).toEqual(hotIds)
  expect(ids("cool")).toEqual(coolIds)
  expect(new Set([...ids("hot"), ...ids("cool")]).size).toBe(6)
  for (const id of [...hotIds, ...coolIds]) {
    const place = discoveryPlaceByIdB(id)!
    const source = researchedFoodByIdB(id)!
    expect(place.city).toBe("seoul")
    expect(place.name).toEqual(source.name)
    expect(place.latitude).toBe(source.latitude)
    expect(place.longitude).toBe(source.longitude)
    expect(place.kind).toBe(source.kind)
  }
})

test("COLLECTION-MODEL-003 category filters intersect the fixed set without refilling to three", () => {
  expect(ids("hot", { category: "korean" })).toEqual([hotIds[1]])
  expect(ids("cool", { category: "korean" })).toEqual([coolIds[1], coolIds[2]])
  expect(ids("hot", { category: "night" })).toEqual([hotIds[0], hotIds[2]])
  expect(ids("cool", { category: "night" })).toEqual([coolIds[0]])
  for (const category of ["casual", "japanese", "chinese", "global", "specialty", "unknown"]) {
    expect(ids("hot", { category })).toEqual([])
    expect(ids("cool", { category })).toEqual([])
  }
})

test("COLLECTION-MODEL-004 After19 never upgrades an unsupported food, cafe or market into a night venue", () => {
  for (const id of ["hot", "cool", "sesame"] as const) {
    for (const category of ["all", "korean", "night"]) expect(ids(id, { after19: true, category })).toEqual([])
  }
  // A pure filter toggle leaves the base examples intact; it does not consume
  // or mutate the fixed set while the lens is on.
  expect(ids("hot")).toEqual(hotIds)
  expect(ids("cool")).toEqual(coolIds)
})

test("COLLECTION-MODEL-005 the balance-only filter cannot invent payment eligibility", () => {
  for (const id of collections) {
    const city = discoveryCollectionCityB(id) ?? "seoul"
    expect(ids(id, { city, balanceOnly: true })).toEqual([])
    expect(ids(id, { city, balanceOnly: true, after19: true })).toEqual([])
  }
})

test("COLLECTION-MODEL-006 Jeju keeps two source-backed sights without inferring night eligibility", () => {
  expect(ids("screen", { city: "jeju" })).toEqual(sightIds)
  expect(ids("screen", { city: "jeju", after19: true })).toEqual(sightIds)
  expect(ids("screen", { city: "jeju", editorialCategory: "screen-location" })).toEqual(sightIds)
  for (const editorialCategory of ["food", "market", "culture-shopping"]) expect(ids("screen", { city: "jeju", editorialCategory })).toEqual([])
  for (const id of sightIds) {
    const place = discoveryPlaceByIdB(id)!
    const editorial = editorialPlaceById(id)!
    expect(place.kind).toBe("sight")
    expect(place.latitude).toBe(editorial.location.latitude)
    expect(place.longitude).toBe(editorial.location.longitude)
    expect(place.source).toBe(editorial.placeSourceUrl)
    expect(place).not.toHaveProperty("after19Eligible")
  }
  expect(discoveryPlaceByIdB(sightIds[0])?.reason.ko).toContain("폭싹 속았수다")
  expect(discoveryPlaceByIdB(sightIds[1])?.reason.ko).toContain("웰컴투 삼달리")
})

test("COLLECTION-MODEL-007 no collection silently changes cities or returns a cross-city fallback", () => {
  expect(ids("sesame")).toEqual([marketId])
  expect(ids("sesame", { city: "jeju" })).toEqual([])
  expect(ids("screen", { city: "seoul" })).toEqual([])
  for (const id of ["hot", "cool"] as const) expect(ids(id, { city: "jeju" })).toEqual([])
  for (const id of collections) {
    expect(ids(id, { city: "busan" })).toEqual([])
    expect(ids(id, { city: "unknown" })).toEqual([])
  }
})

test("COLLECTION-MODEL-008 only complete localized mood commands match, never substrings in a place query", () => {
  for (const query of ["hot", "HOT", "  Hot  ", "핫", "ホット"]) expect(discoveryMoodFromQueryB(query)).toBe("hot")
  for (const query of ["cool", "COOL", "\tCool\n", "쿨", "クール"]) expect(discoveryMoodFromQueryB(query)).toBe("cool")
  for (const query of ["", "   ", "Hotdog", "hot dog", "hot Seoul", "cool cafe", "school", "핫플", "ホットコーヒー", "クールな場所", "hot/cool"]) expect(discoveryMoodFromQueryB(query)).toBeNull()
})

test("COLLECTION-MODEL-009 registry records contain public place facts and localized copy, not service authority", () => {
  expect(new Set(allIds).size).toBe(9)
  for (const id of allIds) {
    const place = discoveryPlaceByIdB(id)!
    expect(place.id).toBe(id)
    expect(Number.isFinite(place.latitude)).toBe(true)
    expect(Number.isFinite(place.longitude)).toBe(true)
    expect(place.latitude).toBeGreaterThan(33)
    expect(place.latitude).toBeLessThan(39)
    expect(place.longitude).toBeGreaterThan(124)
    expect(place.longitude).toBeLessThan(130)
    for (const locale of ["ko", "en", "ja"] as const) {
      for (const value of [place.name[locale], place.area[locale], place.reason[locale], place.imageAlt[locale]]) {
        expect(value.trim()).not.toBe("")
        expect(value).not.toMatch(/undefined|null/)
      }
    }
    for (const key of ["commerce", "payment", "offerId", "reservation", "credential", "live", "crowdCount", "rating"]) expect(place).not.toHaveProperty(key)
    const source = new URL(place.source)
    expect(source.protocol).toBe("https:")
    expect(source.username + source.password).toBe("")
  }
  for (const invalid of [undefined, null, {}, "", "not-a-place", "__proto__"]) expect(discoveryPlaceByIdB(invalid)).toBeUndefined()
})

test("COLLECTION-MODEL-010 sesame story points to the official market centroid, not an invented oil-shop pin", () => {
  const market = discoveryPlaceByIdB(marketId)!
  expect(market.name.ko).toBe("중부시장")
  expect(market.latitude).toBe(37.565086413185)
  expect(market.longitude).toBe(127.001921980041)
  expect(new URL(market.source).searchParams.get("vcontsId")).toBe("86289")
  expect(discoveryCollectionSourceB("sesame")).toBe("https://rurubu.jp/andmore/article/25110")
  expect(discoveryCollectionSourceB("screen")).toBe("https://japanese.visitkorea.or.kr/svc/contents/contentsView.do?vcontsId=222180")
  expect(discoveryCollectionSourceB("hot")).toBeUndefined()
  expect(discoveryCollectionSourceB("cool")).toBeUndefined()
})

test("COLLECTION-MODEL-011 images resolve locally; actual photographs carry separate source and license", () => {
  const photographs: string[] = []
  for (const id of allIds) {
    const place = discoveryPlaceByIdB(id)!
    expect(place.image).toMatch(/^\/(editorial|media)\//)
    expect(existsSync(path.join(appRoot, "public", place.image))).toBe(true)
    expect(place.credit.trim()).not.toBe("")
    if (place.illustration) {
      expect(place.credit).toContain("Editorial illustration")
      expect(place.photoSource).toBeUndefined()
    } else {
      photographs.push(id)
      expect(new URL(place.photoSource!).protocol).toBe("https:")
      expect(new URL(place.licenseUrl!).protocol).toBe("https:")
    }
  }
  expect(photographs).toEqual([hotIds[0], coolIds[0]])
})

test("COLLECTION-MODEL-012 selectors do not mutate context or records, and every locale preserves the sample boundary", () => {
  const before = allIds.map(id => JSON.stringify(discoveryPlaceByIdB(id)))
  const context = Object.freeze({ ...base, category: "korean" })
  for (const id of collections) discoveryCollectionPlacesB(id, context)
  expect(context).toEqual({ ...base, category: "korean" })
  expect(allIds.map(id => JSON.stringify(discoveryPlaceByIdB(id)))).toEqual(before)
  for (const locale of ["ko", "en", "ja"] as const) {
    for (const id of collections) expect(discoveryCollectionTitleB(id, locale).trim()).not.toBe("")
    expect(DISCOVERY_COLLECTION_COPY_B[locale].empty.trim()).not.toBe("")
    expect(DISCOVERY_COLLECTION_COPY_B[locale].cool.trim()).not.toBe("")
  }
  expect(DISCOVERY_COLLECTION_COPY_B.ko.truth).toContain("실시간 인기나 혼잡도는 아니")
  expect(DISCOVERY_COLLECTION_COPY_B.en.truth).toContain("not live popularity or crowding")
  expect(DISCOVERY_COLLECTION_COPY_B.ja.truth).toContain("リアルタイムの人気や混雑ではありません")
})
