import { MOODS, PLACES, STORIES, searchMood, type Place, type Locale } from "../discovery-preview/fixtures"

export type DiscoveryCollectionIdB = "hot" | "cool" | "sesame" | "screen"
export type DiscoveryPlaceB = Place
export function isDiscoveryCollectionIdB(value: unknown): value is DiscoveryCollectionIdB {
  return value === "hot" || value === "cool" || value === "sesame" || value === "screen"
}
export function discoveryCollectionCityB(id: DiscoveryCollectionIdB) {
  return id === "sesame" ? "seoul" : id === "screen" ? "jeju" : undefined
}
export function discoveryPlaceByIdB(id: unknown) { return PLACES.find(place => place.id === id) }
export const discoveryMoodFromQueryB = searchMood
export function discoveryStoryForCityB(city: string) { return STORIES.find(story => story.city === city) }
export function discoveryCollectionTitleB(id: DiscoveryCollectionIdB, locale: Locale) {
  return id === "hot" ? "Hot" : id === "cool" ? "Cool" : STORIES.find(story => story.id === id)!.title[locale]
}
export function discoveryCollectionSourceB(id: DiscoveryCollectionIdB) { return STORIES.find(story => story.id === id)?.source }

/** Fixed editorial examples, not a live popularity or crowding signal.
 * An active lens is an intersection with existing map restrictions, never a
 * reason to refill the result count from a different city or category. */
export function discoveryCollectionPlacesB(id: DiscoveryCollectionIdB, context: {
  city: string; category: string; editorialCategory: string; after19: boolean; balanceOnly: boolean
}) {
  const ids = id === "hot" || id === "cool" ? MOODS[id] : STORIES.find(story => story.id === id)?.places ?? []
  return ids.flatMap(placeId => {
    const place = discoveryPlaceByIdB(placeId)
    if (!place || place.city !== context.city) return []
    // No fixture is a declared payment-capable or adult-night venue.
    if (context.balanceOnly || (context.after19 && place.kind !== "sight")) return []
    if (place.city === "jeju") {
      if (context.editorialCategory !== "all" && context.editorialCategory !== (place.kind === "sight" ? "screen-location" : "food")) return []
    } else if (context.category !== "all" && !(context.category === "korean" && place.kind === "food") && !(context.category === "night" && place.kind === "cafe")) return []
    return [place]
  })
}

export const DISCOVERY_COLLECTION_COPY_B = {
  ko: { story: "이야기 따라", close: "이전 지도로", open: "장소 보기", info: "추천 안내", truth: "편집한 추천 예시예요. 실시간 인기나 혼잡도는 아니에요.", empty: "지금 조건에 맞는 곳이 없어요", back: "이전 지도로", original: "원문 보기", source: "장소 정보", illustration: "일러스트", map: "지도에서 보기", hot: "많이 찾는 분위기", cool: "색다른 발견" },
  en: { story: "Follow a story", close: "Previous map", open: "View place", info: "About these picks", truth: "Fixed editorial examples, not live popularity or crowding.", empty: "No picks for these filters", back: "Previous map", original: "Original story", source: "Place information", illustration: "Illustration", map: "On map", hot: "The familiar favourites", cool: "A different discovery" },
  ja: { story: "物語をたどる", close: "前の地図へ", open: "場所を見る", info: "おすすめについて", truth: "編集したおすすめの例です。リアルタイムの人気や混雑ではありません。", empty: "この条件のスポットはありません", back: "前の地図へ", original: "元の記事", source: "場所の情報", illustration: "イラスト", map: "地図で見る", hot: "定番の雰囲気", cool: "新しい発見" },
} as const
