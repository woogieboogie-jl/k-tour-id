import { DEMO_TEMPERATURE, MOODS, PLACES, STORIES, searchMood, type Place, type Locale, type Story, type StoryId, type Mood } from "../discovery-preview/fixtures"
import { researchedFoodByIdB, researchFoodMatchesB } from "./researched-food-b"

export type DiscoveryCollectionIdB = Mood | StoryId
export type DiscoveryMoodB = Mood
export type DiscoveryStoryIdB = StoryId
export type DiscoveryPlaceB = Place
export function isDiscoveryMoodB(value: unknown): value is Mood { return value === "hot" || value === "warm" || value === "cool" }
export function isDiscoveryCollectionIdB(value: unknown): value is DiscoveryCollectionIdB {
  return isDiscoveryMoodB(value) || STORIES.some(story => story.id === value)
}
export function discoveryCollectionCityB(id: DiscoveryCollectionIdB) {
  return STORIES.find(story => story.id === id)?.city
}
export function discoveryPlaceByIdB(id: unknown) { return PLACES.find(place => place.id === id) }
export const discoveryMoodFromQueryB = searchMood
export function discoveryStoriesForCityB(city: string) { return STORIES.filter(story => story.city === city) }
export function discoveryStoryForCityB(city: string) { return discoveryStoriesForCityB(city)[0] }
export function discoveryCollectionStoryB(id: DiscoveryCollectionIdB): Story | undefined { return STORIES.find(story => story.id === id) }
export function discoveryMoodLabelB(id: Mood) { return id === "hot" ? "Hot" : id === "warm" ? "Warm" : "Cool" }
export function discoveryDemoTemperatureB(id: unknown) {
  return typeof id === "string" && Object.hasOwn(DEMO_TEMPERATURE, id) ? DEMO_TEMPERATURE[id] : undefined
}
export function discoveryCollectionTitleB(id: DiscoveryCollectionIdB, locale: Locale) {
  return isDiscoveryMoodB(id) ? discoveryMoodLabelB(id) : STORIES.find(story => story.id === id)!.title[locale]
}
export function discoveryCollectionSourceB(id: DiscoveryCollectionIdB) { return STORIES.find(story => story.id === id)?.source }

/** Fixed editorial examples, not a live popularity or crowding signal.
 * An active lens is an intersection with existing map restrictions, never a
 * reason to refill the result count from a different city or category. */
export function discoveryCollectionPlacesB(id: DiscoveryCollectionIdB, context: {
  city: string; category: string; editorialCategory: string; after19: boolean; balanceOnly: boolean; query?: string
}) {
  const ids = isDiscoveryMoodB(id) ? MOODS[id] : STORIES.find(story => story.id === id)?.places ?? []
  // Typed band commands keep their existing meaning. Selecting a temperature
  // facet over an ordinary place query intersects the established search;
  // it never replaces that query with a new recommendation universe.
  const query = isDiscoveryMoodB(id) && context.query && !searchMood(context.query) ? context.query.trim() : ""
  return ids.flatMap(placeId => {
    const place = discoveryPlaceByIdB(placeId)
    if (!place || place.city !== context.city) return []
    if (query) {
      const researched = researchedFoodByIdB(place.id)
      const matches = researched ? researchFoodMatchesB(researched, query)
        : [...Object.values(place.name), ...Object.values(place.area), ...Object.values(place.reason)].join(" ").toLocaleLowerCase().includes(query.toLocaleLowerCase())
      if (!matches) return []
    }
    // No fixture is a declared payment-capable or adult-night venue.
    if (context.balanceOnly || (context.after19 && place.kind !== "sight")) return []
    if (place.city === "jeju") {
      if (context.editorialCategory !== "all" && context.editorialCategory !== (place.kind === "sight" ? "screen-location" : "food")) return []
    } else if (context.category !== "all" && !(context.category === "korean" && place.kind === "food") && !(context.category === "night" && (place.kind === "cafe" || place.kind === "bar"))) return []
    return [place]
  })
}

export const DISCOVERY_COLLECTION_COPY_B = {
  ko: { story: "이야기 따라", close: "이전 지도로", open: "장소 보기", info: "추천 안내", truth: "관심·활기를 표현한 고정 데모예요. 실시간 인기나 혼잡도는 아니에요. Cool도 조용함을 보장하지 않아요.", empty: "지금 조건에 맞는 곳이 없어요", back: "이전 지도로", original: "원문 보기", source: "장소 정보", illustration: "일러스트", map: "지도에서 보기", hot: "활기 있는 발견", warm: "적당한 활기", cool: "차분한 무드" },
  en: { story: "Follow a story", close: "Previous map", open: "View place", info: "About these picks", truth: "Fixed attention/activity demo, not live popularity or crowding. Cool suggests a laid-back mood, not guaranteed quiet.", empty: "No picks for these filters", back: "Previous map", original: "Original story", source: "Place information", illustration: "Illustration", map: "On map", hot: "Lively discoveries", warm: "A little buzz", cool: "A laid-back mood" },
  ja: { story: "物語をたどる", close: "前の地図へ", open: "場所を見る", info: "おすすめについて", truth: "関心・活気を表す固定デモです。リアルタイムの人気や混雑ではありません。Coolも静かさを保証しません。", empty: "この条件のスポットはありません", back: "前の地図へ", original: "元の記事", source: "場所の情報", illustration: "イラスト", map: "地図で見る", hot: "活気を楽しむ", warm: "ほどよい活気", cool: "ゆったり気分" },
} as const
