import { expect, test } from "@playwright/test"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { CITIES, PLACES, STORIES, results, type City, type Locale } from "../../features/ondo/discovery-preview/fixtures"
import { discoveryCollectionPlacesB, discoveryDemoTemperatureB, discoveryStoriesForCityB } from "../../features/ondo/map/discovery-collection-model-b"
import { researchFoodMediaB, researchedFoodByIdB } from "../../features/ondo/map/researched-food-b"

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const locales: Locale[] = ["ko", "en", "ja"]
const storyIds: Record<City, string[]> = {
  seoul: ["sesame", "seoul-cafes", "seoul-table"],
  busan: ["busan-market", "busan-coffee", "busan-table"],
  jeju: ["screen", "jeju-kpop", "jeju-table"],
}
const bounds: Record<City, [number, number, number, number]> = {
  seoul: [37, 38, 126, 128], busan: [35, 36, 128, 130], jeju: [33, 34, 126, 127],
}
function publicHttps(value: string) {
  const url = new URL(value)
  expect(url.protocol).toBe("https:")
  expect(url.username + url.password).toBe("")
  expect(url.hash).toBe("")
  expect(url.hostname).not.toMatch(/^(localhost|127\.|0\.)/)
  return url
}

test("REGIONAL-STORIES-001 each city owns exactly three stable, unique stories and unique place records", () => {
  expect(Object.keys(CITIES).sort()).toEqual(Object.keys(storyIds).sort())
  expect(STORIES).toHaveLength(9)
  expect(new Set(STORIES.map(story => story.id)).size).toBe(STORIES.length)
  expect(new Set(PLACES.map(place => place.id)).size).toBe(PLACES.length)
  for (const city of Object.keys(storyIds) as City[]) {
    expect(discoveryStoriesForCityB(city).map(story => story.id)).toEqual(storyIds[city])
    for (const locale of locales) expect(CITIES[city][locale].trim()).not.toBe("")
  }
})

test("REGIONAL-STORIES-002 all stories have two complete localized paragraphs and exact same-city stop notes", () => {
  for (const story of STORIES) {
    expect(story.paragraphs, story.id).toHaveLength(2)
    expect(story.places.length, story.id).toBeGreaterThan(0)
    expect(new Set(story.places).size, story.id).toBe(story.places.length)
    expect(Object.keys(story.stopNotes).sort(), story.id).toEqual([...story.places].sort())
    for (const locale of locales) {
      const copy = [story.title[locale], story.intro[locale], ...story.paragraphs.map(paragraph => paragraph[locale]), ...story.places.map(id => story.stopNotes[id][locale])]
      for (const value of copy) {
        expect(value.trim().length, `${story.id}/${locale}`).toBeGreaterThan(5)
        expect(value, `${story.id}/${locale}`).not.toMatch(/undefined|null|TODO|TBD/)
      }
    }
    expect(results({ city: story.city, mode: "story", story: story.id }, "all", []).map(place => place.id)).toEqual(story.places)
    const context = { city: story.city, category: "all", editorialCategory: "all", after19: false, balanceOnly: false }
    expect(discoveryCollectionPlacesB(story.id, context).map(place => place.id)).toEqual(story.places)
    for (const id of story.places) expect(PLACES.find(place => place.id === id)?.city, id).toBe(story.city)
    for (const other of Object.keys(storyIds) as City[]) if (other !== story.city) {
      expect(results({ city: other, mode: "story", story: story.id }, "all", [])).toEqual([])
      expect(discoveryCollectionPlacesB(story.id, { ...context, city: other })).toEqual([])
    }
  }
})

test("REGIONAL-STORIES-003 source URLs are public HTTPS, distinct, and retain the primary story source", () => {
  const regionalHosts = new Set(["www.visitbusan.net", "visitbusan.net", "english.visitkorea.or.kr", "japanese.visitkorea.or.kr", "www.visitjeju.net", "www.gozipfish.com", "momos.co.kr", "www.momos.co.kr", "waveoncoffee.com", "www.waveoncoffee.com", "guide.michelin.com"])
  for (const story of STORIES) {
    const sources = story.sources ?? [{ label: "Original source", url: story.source }]
    expect(sources.some(source => source.url === story.source), story.id).toBe(true)
    expect(new Set(sources.map(source => source.url)).size, story.id).toBe(sources.length)
    for (const source of sources) {
      expect(source.label.trim()).not.toBe("")
      const url = publicHttps(source.url)
      if (story.city === "busan" || story.id === "jeju-table") expect(regionalHosts.has(url.hostname), source.url).toBe(true)
    }
  }
  for (const place of PLACES) publicHttps(place.source)
})

test("REGIONAL-STORIES-004 coordinates remain in their city and researched pins preserve source identity", () => {
  for (const place of PLACES) {
    const [south, north, west, east] = bounds[place.city]
    expect(Number.isFinite(place.latitude), place.id).toBe(true)
    expect(Number.isFinite(place.longitude), place.id).toBe(true)
    expect(place.latitude, place.id).toBeGreaterThan(south)
    expect(place.latitude, place.id).toBeLessThan(north)
    expect(place.longitude, place.id).toBeGreaterThan(west)
    expect(place.longitude, place.id).toBeLessThan(east)
    for (const locale of locales) for (const value of [place.name[locale], place.area[locale], place.reason[locale], place.imageAlt[locale]]) expect(value.trim(), `${place.id}/${locale}`).not.toBe("")
    const researched = researchedFoodByIdB(place.id)
    if (!researched) continue
    expect(place.city).toBe(researched.city)
    expect(place.name).toEqual(researched.name)
    expect(place.latitude).toBe(researched.latitude)
    expect(place.longitude).toBe(researched.longitude)
    expect(place.kind).toBe(researched.kind)
  }
  expect(STORIES.find(story => story.id === "jeju-table")?.places).toEqual(["research-jeju-woojin-haejangguk", "research-jeju-gozip-dolwurock-jungmun"])
  expect(STORIES.find(story => story.id === "jeju-kpop")?.places).toEqual(["jeju-donsadon", "jeju-oneunjeong-gimbap"])
})

test("REGIONAL-STORIES-005 local media cannot be relabelled as unlicensed or unrelated venue photographs", () => {
  for (const story of STORIES) {
    expect(story.image).toMatch(/^\/editorial\//)
    expect(existsSync(path.join(appRoot, "public", story.image)), story.id).toBe(true)
  }
  for (const place of PLACES) {
    expect(place.image).toMatch(/^\/(editorial|media)\//)
    expect(existsSync(path.join(appRoot, "public", place.image)), place.id).toBe(true)
    expect(place.credit.trim(), place.id).not.toBe("")
    if (place.illustration) {
      expect(place.image, place.id).toMatch(/^\/editorial\//)
      expect(place.credit, place.id).toContain("Editorial illustration")
      expect(place.photoSource, place.id).toBeUndefined()
      expect(place.licenseUrl, place.id).toBeUndefined()
      expect(place.imageAlt.ko, place.id).toContain("일러스트")
      expect(place.imageAlt.en.toLowerCase(), place.id).toContain("illustration")
      expect(place.imageAlt.ja, place.id).toContain("イラスト")
    } else {
      const researched = researchedFoodByIdB(place.id)
      expect(researched?.photo, place.id).toBeTruthy()
      const photograph = researchFoodMediaB(researched!).photograph
      expect(photograph, place.id).toBeTruthy()
      expect(place.image).toBe(photograph!.src)
      expect(place.imageAlt).toEqual(photograph!.alt)
      expect(place.photoSource).toBe(researched!.photo!.sourceUrl)
      expect(place.licenseUrl).toBe(researched!.photo!.licenseUrl)
      publicHttps(place.photoSource!)
      publicHttps(place.licenseUrl!)
    }
  }
})

test("REGIONAL-STORIES-006 new regional stories do not invent temperature, night or payment eligibility", () => {
  for (const story of STORIES.filter(story => story.city === "busan" || story.id === "jeju-table")) {
    const context = { city: story.city, category: "all", editorialCategory: "all", after19: false, balanceOnly: false }
    expect(discoveryCollectionPlacesB(story.id, { ...context, balanceOnly: true })).toEqual([])
    expect(discoveryCollectionPlacesB(story.id, { ...context, after19: true })).toEqual([])
    for (const id of story.places) {
      const place = PLACES.find(place => place.id === id)!
      expect(discoveryDemoTemperatureB(id)).toBeUndefined()
      for (const key of ["commerce", "payment", "offerId", "reservation", "credential", "live", "crowdCount", "rating", "after19Eligible"]) expect(place, id).not.toHaveProperty(key)
    }
  }
})
