import { expect, test } from "@playwright/test"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  DISCOVERY_COLLECTION_COPY_B,
  discoveryCollectionCityB,
  discoveryCollectionPlacesB,
  discoveryCollectionStoryB,
  discoveryCollectionSourceB,
  discoveryCollectionTitleB,
  discoveryDemoTemperatureB,
  discoveryMoodFromQueryB,
  discoveryMoodLabelB,
  discoveryPlaceByIdB,
  discoveryStoriesForCityB,
  discoveryStoryForCityB,
  isDiscoveryCollectionIdB,
  isDiscoveryMoodB,
  type DiscoveryCollectionIdB,
} from "../../features/ondo/map/discovery-collection-model-b"
import { researchedFoodByIdB } from "../../features/ondo/map/researched-food-b"
import { editorialPlaceById } from "../../features/ondo/pulse-b/japan-first-pulse-model-b"

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const collections: DiscoveryCollectionIdB[] = ["hot", "warm", "cool", "sesame", "screen", "seoul-cafes", "seoul-table", "jeju-kpop"]
const base = { city: "seoul", category: "all", editorialCategory: "all", after19: false, balanceOnly: false, query: "" }
const hotIds = ["research-seoul-onion-anguk", "research-seoul-geumdwaeji-sikdang", "research-seoul-london-bagel-dosan"]
const coolIds = ["research-seoul-hakrim-dabang", "research-seoul-gosari-express", "research-seoul-okdongsik"]
const warmIds = ["research-seoul-3rd-samgyetang", "research-seoul-zest", "research-seoul-bar-cham"]
const marketId = "lab-seoul-jungbu-market"
const sightIds = ["jeju-seongsan-ilchulbong", "jeju-gwangchigi-beach"]
const kpopIds = ["jeju-donsadon", "jeju-oneunjeong-gimbap"]
const allIds = [...hotIds, ...warmIds, ...coolIds, marketId, ...sightIds, ...kpopIds]
const ids = (id: DiscoveryCollectionIdB, overrides: Partial<typeof base> = {}) => discoveryCollectionPlacesB(id, { ...base, ...overrides }).map(place => place.id)

test("COLLECTION-MODEL-001 collection IDs and story cities are bounded; moods do not choose a city", () => {
  for (const id of collections) expect(isDiscoveryCollectionIdB(id)).toBe(true)
  for (const invalid of [null, undefined, "HOT", "unknown", "__proto__", {}, [], 0]) expect(isDiscoveryCollectionIdB(invalid)).toBe(false)
  expect(discoveryCollectionCityB("sesame")).toBe("seoul")
  expect(discoveryCollectionCityB("screen")).toBe("jeju")
  expect(discoveryCollectionCityB("hot")).toBeUndefined()
  expect(discoveryCollectionCityB("warm")).toBeUndefined()
  expect(discoveryCollectionCityB("cool")).toBeUndefined()
  expect(discoveryCollectionCityB("seoul-cafes")).toBe("seoul")
  expect(discoveryCollectionCityB("seoul-table")).toBe("seoul")
  expect(discoveryCollectionCityB("jeju-kpop")).toBe("jeju")
  expect(discoveryStoryForCityB("seoul")?.id).toBe("sesame")
  expect(discoveryStoryForCityB("jeju")?.id).toBe("screen")
  expect(discoveryStoryForCityB("busan")).toBeUndefined()
  expect(discoveryStoryForCityB("unknown")).toBeUndefined()
})

test("COLLECTION-MODEL-002 Seoul has three stable examples in each disjoint Hot/Warm/Cool band", () => {
  expect(ids("hot")).toEqual(hotIds)
  expect(ids("warm")).toEqual(warmIds)
  expect(ids("cool")).toEqual(coolIds)
  expect(new Set([...ids("hot"), ...ids("warm"), ...ids("cool")]).size).toBe(9)
  for (const id of [...hotIds, ...warmIds, ...coolIds]) {
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
  expect(ids("warm", { category: "korean" })).toEqual([warmIds[0]])
  expect(ids("cool", { category: "korean" })).toEqual([coolIds[1], coolIds[2]])
  expect(ids("hot", { category: "night" })).toEqual([hotIds[0], hotIds[2]])
  expect(ids("warm", { category: "night" })).toEqual(warmIds.slice(1))
  expect(ids("cool", { category: "night" })).toEqual([coolIds[0]])
  for (const category of ["casual", "japanese", "chinese", "global", "specialty", "unknown"]) {
    expect(ids("hot", { category })).toEqual([])
    expect(ids("warm", { category })).toEqual([])
    expect(ids("cool", { category })).toEqual([])
  }
})

test("COLLECTION-MODEL-004 After19 never upgrades an unsupported food, cafe or market into a night venue", () => {
  for (const id of ["hot", "warm", "cool", "sesame", "seoul-cafes", "seoul-table"] as const) {
    for (const category of ["all", "korean", "night"]) expect(ids(id, { after19: true, category })).toEqual([])
  }
  // A pure filter toggle leaves the base examples intact; it does not consume
  // or mutate the fixed set while the lens is on.
  expect(ids("hot")).toEqual(hotIds)
  expect(ids("warm")).toEqual(warmIds)
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
  for (const id of ["hot", "warm", "cool"] as const) expect(ids(id, { city: "jeju" })).toEqual([])
  for (const id of ["sesame", "seoul-cafes", "seoul-table"] as const) expect(ids(id, { city: "jeju" })).toEqual([])
  expect(ids("jeju-kpop", { city: "seoul" })).toEqual([])
  for (const id of collections) {
    expect(ids(id, { city: "busan" })).toEqual([])
    expect(ids(id, { city: "unknown" })).toEqual([])
  }
})

test("COLLECTION-MODEL-008 only complete localized mood commands match, never substrings in a place query", () => {
  for (const query of ["hot", "HOT", "  Hot  ", "핫", "ホット"]) expect(discoveryMoodFromQueryB(query)).toBe("hot")
  for (const query of ["cool", "COOL", "\tCool\n", "쿨", "クール"]) expect(discoveryMoodFromQueryB(query)).toBe("cool")
  for (const query of ["warm", "WARM", "  Warm  ", "웜", "ウォーム"]) expect(discoveryMoodFromQueryB(query)).toBe("warm")
  for (const query of ["", "   ", "Hotdog", "hot dog", "hot Seoul", "cool cafe", "school", "핫플", "ホットコーヒー", "クールな場所", "hot/cool", "warm coffee", "warming", "ウォームアップ"]) expect(discoveryMoodFromQueryB(query)).toBeNull()
})

test("COLLECTION-MODEL-009 registry records contain public place facts and localized copy, not service authority", () => {
  expect(new Set(allIds).size).toBe(14)
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
  expect(discoveryCollectionSourceB("warm")).toBeUndefined()
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
  expect(DISCOVERY_COLLECTION_COPY_B.ko.truth).toContain("조용함을 보장하지 않아요")
  expect(DISCOVERY_COLLECTION_COPY_B.en.truth).toContain("not guaranteed quiet")
  expect(DISCOVERY_COLLECTION_COPY_B.ja.truth).toContain("静かさを保証しません")
})

test("COLLECTION-MODEL-013 city carousels expose three Seoul and two Jeju stories without changing the legacy first story", () => {
  expect(discoveryStoriesForCityB("seoul").map(story => story.id)).toEqual(["sesame", "seoul-cafes", "seoul-table"])
  expect(discoveryStoriesForCityB("jeju").map(story => story.id)).toEqual(["screen", "jeju-kpop"])
  expect(discoveryStoriesForCityB("busan")).toEqual([])
  expect(discoveryStoriesForCityB("__proto__")).toEqual([])
  const stories = discoveryStoriesForCityB("seoul")
  stories.pop()
  expect(discoveryStoriesForCityB("seoul")).toHaveLength(3)
  for (const mood of ["hot", "warm", "cool"] as const) expect(discoveryCollectionStoryB(mood)).toBeUndefined()
})

test("COLLECTION-MODEL-014 every story has complete localized prose, source links and notes for actual same-city stops", () => {
  for (const city of ["seoul", "jeju"]) for (const story of discoveryStoriesForCityB(city)) {
    expect(discoveryCollectionStoryB(story.id)).toBe(story)
    expect(story.paragraphs).toHaveLength(2)
    expect(new Set(story.places).size).toBe(story.places.length)
    expect(story.places.length).toBeGreaterThan(0)
    expect(ids(story.id, { city })).toEqual(story.places)
    expect(Object.keys(story.stopNotes).sort()).toEqual([...story.places].sort())
    expect(existsSync(path.join(appRoot, "public", story.image))).toBe(true)
    for (const locale of ["ko", "en", "ja"] as const) {
      for (const value of [story.title[locale], story.intro[locale], ...story.paragraphs.map(paragraph => paragraph[locale]), ...story.places.map(id => story.stopNotes[id][locale])]) {
        expect(value.trim().length).toBeGreaterThan(5)
        expect(value).not.toMatch(/undefined|null/)
      }
    }
    for (const id of story.places) expect(discoveryPlaceByIdB(id)?.city).toBe(city)
    const sources = story.sources ?? [{ label: "Original source", url: story.source }]
    expect(sources.some(source => source.url === story.source)).toBe(true)
    expect(new Set(sources.map(source => source.url)).size).toBe(sources.length)
    for (const source of sources) {
      expect(source.label.trim()).not.toBe("")
      expect(new URL(source.url).protocol).toBe("https:")
      expect(new URL(source.url).username + new URL(source.url).password).toBe("")
    }
  }
  // These pairings are our edit, not a claim that one publisher created a route.
  expect(discoveryCollectionStoryB("seoul-cafes")?.sources).toHaveLength(2)
  expect(discoveryCollectionStoryB("seoul-table")?.sources).toHaveLength(3)
  expect(discoveryCollectionStoryB("seoul-table")?.stopNotes[coolIds[1]].ko).toContain("중부시장과는 다른")
})

test("COLLECTION-MODEL-015 temperature is one immutable demo signal per place; missing evidence never becomes Cool", () => {
  for (const band of ["hot", "warm", "cool"] as const) {
    expect(isDiscoveryMoodB(band)).toBe(true)
    expect(discoveryMoodLabelB(band)).toBe(band[0].toUpperCase() + band.slice(1))
    for (const id of ids(band)) {
      const signal = discoveryDemoTemperatureB(id)!
      expect(signal.band).toBe(band)
      expect(signal.source).toBe("editorial-demo")
      expect(signal.intensity).toBeGreaterThanOrEqual(0)
      expect(signal.intensity).toBeLessThanOrEqual(100)
      expect(Object.isFrozen(signal)).toBe(true)
      expect(Object.keys(signal).sort()).toEqual(["band", "intensity", "source"])
      for (const other of ["hot", "warm", "cool"] as const) if (other !== band) expect(ids(other)).not.toContain(id)
    }
  }
  expect(Math.min(...hotIds.map(id => discoveryDemoTemperatureB(id)!.intensity))).toBeGreaterThan(Math.max(...warmIds.map(id => discoveryDemoTemperatureB(id)!.intensity)))
  expect(Math.min(...warmIds.map(id => discoveryDemoTemperatureB(id)!.intensity))).toBeGreaterThan(Math.max(...coolIds.map(id => discoveryDemoTemperatureB(id)!.intensity)))
  for (const value of [null, undefined, {}, "", "__proto__", "toString", "unknown", marketId, ...sightIds, ...kpopIds]) expect(discoveryDemoTemperatureB(value)).toBeUndefined()
  for (const value of [null, undefined, "sesame", "screen", "WARM", "cold", "__proto__"]) expect(isDiscoveryMoodB(value)).toBe(false)
})

test("COLLECTION-MODEL-016 Jeju K-pop reuses verified editorial identities and coordinates without adding adult or payment eligibility", () => {
  expect(ids("jeju-kpop", { city: "jeju" })).toEqual(kpopIds)
  expect(ids("jeju-kpop", { city: "jeju", editorialCategory: "food" })).toEqual(kpopIds)
  expect(ids("jeju-kpop", { city: "jeju", editorialCategory: "screen-location" })).toEqual([])
  expect(ids("jeju-kpop", { city: "jeju", after19: true })).toEqual([])
  for (const id of kpopIds) {
    const place = discoveryPlaceByIdB(id)!
    const editorial = editorialPlaceById(id)!
    expect(editorial.storyIds).toContain("C20")
    expect(place.latitude).toBe(editorial.location.latitude)
    expect(place.longitude).toBe(editorial.location.longitude)
    expect(place.source).toBe(editorial.placeSourceUrl)
    expect(place.kind).toBe("food")
    expect(place).not.toHaveProperty("after19Eligible")
  }
})

test("COLLECTION-MODEL-017 temperature facets intersect existing localized place and signature searches", () => {
  expect(ids("hot", { query: "  Onion  " })).toEqual([hotIds[0]])
  expect(ids("cool", { query: "비엔나커피" })).toEqual([coolIds[0]])
  expect(ids("warm", { query: "samgyetang" })).toEqual([warmIds[0]])
  expect(ids("warm", { query: "칵테일" })).toEqual(warmIds.slice(1))
  expect(ids("hot", { query: "팡도르" })).toEqual([hotIds[0]])
  const context = Object.freeze({ ...base, query: "not-a-matching-place" })
  expect(discoveryCollectionPlacesB("warm", context)).toEqual([])
  expect(context.query).toBe("not-a-matching-place")
  // Clearing the facet does not mutate its stable base inventory.
  expect(ids("warm")).toEqual(warmIds)
})

test("COLLECTION-MODEL-018 only exact band commands bypass free-query intersection; stories retain their own scope", () => {
  for (const query of ["hot", " Warm ", "쿨", "ウォーム", "", "   "]) expect(ids("warm", { query })).toEqual(warmIds)
  for (const query of ["hotdog", "warm coffee", "school", "ウォームアップ"]) expect(ids("warm", { query })).toEqual([])
  expect(ids("seoul-cafes", { query: "unrelated preceding search" })).toEqual([hotIds[0], coolIds[0]])
  expect(ids("screen", { city: "jeju", query: "prior Seoul search" })).toEqual(sightIds)
})

test("COLLECTION-MODEL-019 text intersections still respect city, category, balance and After19 without replenishing", () => {
  expect(ids("warm", { query: "칵테일", category: "night" })).toEqual(warmIds.slice(1))
  expect(ids("warm", { query: "칵테일", category: "korean" })).toEqual([])
  expect(ids("warm", { query: "칵테일", after19: true })).toEqual([])
  expect(ids("warm", { query: "칵테일", balanceOnly: true })).toEqual([])
  expect(ids("warm", { query: "칵테일", city: "jeju" })).toEqual([])
  expect(ids("cool", { query: "비엔나커피", category: "korean" })).toEqual([])
})
