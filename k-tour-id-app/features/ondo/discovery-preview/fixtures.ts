import { RESEARCHED_FOOD_B, researchFoodMediaB } from "../map/researched-food-b"
import { JEJU_EDITORIAL_PLACES } from "../pulse-b/japan-first-pulse-model-b"

export type Locale = "ko" | "en" | "ja"
export type City = "seoul" | "jeju"
export type Mood = "hot" | "cool"
export type Kind = "all" | "cafe" | "food"
export type Words = Record<Locale, string>
export const words = (ko: string, en: string, ja: string): Words => ({ ko, en, ja })
export type Place = {
  id: string; city: City; name: Words; area: Words; reason: Words
  latitude: number; longitude: number; kind: "cafe" | "food" | "sight"
  image: string; imageAlt: Words; illustration: boolean; credit: string; source: string
  photoSource?: string; licenseUrl?: string
}
export type Story = { id: string; city: City; title: Words; image: string; places: string[]; source: string }
export type Scope = { city: City; mode: "explore" | "story" | "hot" | "cool" | "search" | "saved"; story?: string; query?: string }

function food(id: string, reason: Words, fallback: string): Place {
  const place = RESEARCHED_FOOD_B.find(p => p.id === id)
  if (!place || place.city === "busan" || place.kind === "bar") throw new Error(`Invalid discovery fixture: ${id}`)
  const media = researchFoodMediaB(place)
  return {
    id, city: place.city, name: place.name, area: place.district, reason,
    latitude: place.latitude, longitude: place.longitude, kind: place.kind,
    image: media.photograph?.src ?? fallback,
    imageAlt: media.photograph?.alt ?? words("음식 분위기 일러스트", "Food illustration", "食のイメージイラスト"),
    illustration: !media.photograph,
    credit: media.photograph ? `${place.photo?.credit} · ${place.photo?.license}` : "K-Tour ID · Editorial illustration",
    source: place.sources[0].url,
    ...(media.photograph && place.photo ? { photoSource: place.photo.sourceUrl, licenseUrl: place.photo.licenseUrl } : {}),
  }
}

// Fixed editorial demo sets, never live temperature, attendance or a low-score sort.
export const MOODS: Record<Mood, string[]> = {
  hot: ["research-seoul-onion-anguk", "research-seoul-geumdwaeji-sikdang", "research-seoul-london-bagel-dosan"],
  cool: ["research-seoul-hakrim-dabang", "research-seoul-gosari-express", "research-seoul-okdongsik"],
}
const foodPlaces = [
  food(MOODS.hot[0], words("한옥에서 커피와 빵", "Coffee & bread in a hanok", "韓屋でコーヒーとパン"), "/editorial/food/coffee-croissant-illustration-v1.jpg"),
  food(MOODS.hot[1], words("한국식 숯불구이 한 끼", "A Korean barbecue stop", "韓国式の炭火焼きを一食"), "/editorial/food/ondo-category-korean-v1.jpg"),
  food(MOODS.hot[2], words("베이글로 시작하는 하루", "Start with a bagel", "ベーグルで始める一日"), "/editorial/food/coffee-croissant-illustration-v1.jpg"),
  food(MOODS.cool[0], words("오래된 다방의 비엔나커피", "Vienna coffee, old Seoul", "老舗喫茶のウインナーコーヒー"), "/editorial/food/coffee-croissant-illustration-v1.jpg"),
  food(MOODS.cool[1], words("고사리로 만나는 비건 한 끼", "A different bowl: vegan gosari", "ワラビで楽しむヴィーガンの一食"), "/editorial/food/perilla-noodles-illustration-v1.jpg"),
  food(MOODS.cool[2], words("맑은 돼지곰탕 한 그릇", "A clear bowl of pork gomtang", "澄んだ豚コムタンを一杯"), "/editorial/food/ondo-category-specialty-v1.jpg"),
]

const jejuPlaces: Place[] = ["jeju-seongsan-ilchulbong", "jeju-gwangchigi-beach"].map((id, index) => {
  const place = JEJU_EDITORIAL_PLACES.find(p => p.id === id)!
  return {
    id, city: "jeju", name: place.name, area: words("성산 · 제주", "Seongsan · Jeju", "城山・済州"), kind: "sight",
    reason: index === 0 ? words("〈폭싹 속았수다〉 속 풍경", "When Life Gives You Tangerines", "『おつかれさま』の風景")
      : words("〈웰컴투 삼달리〉 속 바다", "Welcome to Samdal-ri", "『サムダルリへようこそ』の海"),
    latitude: place.location.latitude, longitude: place.location.longitude,
    image: "/editorial/japan-first-c18-jeju-screen-route.jpg",
    imageAlt: words("제주 여행 일러스트", "Jeju travel illustration", "済州の旅のイラスト"), illustration: true,
    credit: "K-Tour ID · Editorial illustration", source: place.placeSourceUrl,
  }
})

export const PLACES: Place[] = [...foodPlaces, {
  // Official market centroid, NOT an invented pin for either oil shop.
  // VISITKOREA JSON-LD GeoCoordinates checked 2026-09-21, content 86289.
  id: "lab-seoul-jungbu-market", city: "seoul", kind: "food",
  name: words("중부시장", "Jungbu Market", "中部市場"),
  area: words("을지로 · 서울", "Euljiro · Seoul", "乙支路・ソウル"),
  reason: words("참기름 이야기가 시작된 시장", "The market behind the sesame-oil story", "ゴマ油の物語が始まる市場"),
  latitude: 37.565086413185, longitude: 127.001921980041,
  image: "/editorial/japan-first-c01-sesame-oil.jpg",
  imageAlt: words("참기름 시장 여행 일러스트", "Sesame-oil market illustration", "ゴマ油と市場のイラスト"),
  illustration: true, credit: "K-Tour ID · Editorial illustration",
  source: "https://english.visitkorea.or.kr/svc/contents/contentsView.do?vcontsId=86289",
}, ...jejuPlaces]

export const STORIES: Story[] = [{
  id: "sesame", city: "seoul", title: words("참기름 따라, 시장으로", "Follow the sesame oil", "ゴマ油を探しに市場へ"),
  image: "/editorial/japan-first-c01-sesame-oil.jpg", places: ["lab-seoul-jungbu-market"],
  source: "https://rurubu.jp/andmore/article/25110",
}, {
  id: "screen", city: "jeju", title: words("드라마 속 제주로", "Step into a Jeju scene", "ドラマの済州へ"),
  image: "/editorial/japan-first-c18-jeju-screen-route.jpg", places: jejuPlaces.map(p => p.id),
  source: "https://japanese.visitkorea.or.kr/svc/contents/contentsView.do?vcontsId=222180",
}]
export const CITIES = { seoul: words("서울", "Seoul", "ソウル"), jeju: words("제주", "Jeju", "済州") }
export function searchMood(query: string): Mood | null {
  const q = query.trim().toLocaleLowerCase()
  return ["hot", "핫", "ホット"].includes(q) ? "hot" : ["cool", "쿨", "クール"].includes(q) ? "cool" : null
}
export function results(scope: Scope, kind: Kind, saved: readonly string[]): Place[] {
  const ids = scope.mode === "story" ? STORIES.find(s => s.id === scope.story)?.places
    : scope.mode === "hot" || scope.mode === "cool" ? MOODS[scope.mode]
    : scope.mode === "saved" ? saved : scope.mode === "explore" && scope.city === "seoul" ? MOODS.hot : null
  const candidates = ids ? ids.map(id => PLACES.find(p => p.id === id)!).filter(Boolean) : PLACES
  return candidates.filter(p => p.city === scope.city && (kind === "all" || p.kind === kind)
    && (scope.mode !== "search" || [...Object.values(p.name), ...Object.values(p.area), ...Object.values(p.reason)].join(" ").toLocaleLowerCase().includes((scope.query ?? "").trim().toLocaleLowerCase())))
}
