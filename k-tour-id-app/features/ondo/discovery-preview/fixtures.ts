import { RESEARCHED_FOOD_B, researchFoodMediaB } from "../map/researched-food-b"
import { JEJU_EDITORIAL_PLACES } from "../pulse-b/japan-first-pulse-model-b"

export type Locale = "ko" | "en" | "ja"
export type City = "seoul" | "jeju"
export type Mood = "hot" | "warm" | "cool"
export type StoryId = "sesame" | "screen" | "seoul-cafes" | "seoul-table" | "jeju-kpop"
export type Kind = "all" | "cafe" | "food"
export type Words = Record<Locale, string>
export const words = (ko: string, en: string, ja: string): Words => ({ ko, en, ja })
export type Place = {
  id: string; city: City; name: Words; area: Words; reason: Words
  latitude: number; longitude: number; kind: "cafe" | "food" | "bar" | "sight"
  image: string; imageAlt: Words; illustration: boolean; credit: string; source: string
  photoSource?: string; licenseUrl?: string
}
export type Story = {
  id: StoryId; city: City; title: Words; image: string; places: string[]; source: string
  sources?: { label: string; url: string }[]
  intro: Words; paragraphs: Words[]; stopNotes: Record<string, Words>
}
export type Scope = { city: City; mode: "explore" | "story" | Mood | "search" | "saved"; story?: string; query?: string }

function food(id: string, reason: Words, fallback: string, source?: string): Place {
  const place = RESEARCHED_FOOD_B.find(p => p.id === id)
  if (!place || place.city === "busan") throw new Error(`Invalid discovery fixture: ${id}`)
  const media = researchFoodMediaB(place)
  return {
    id, city: place.city, name: place.name, area: place.district, reason,
    latitude: place.latitude, longitude: place.longitude, kind: place.kind,
    image: media.photograph?.src ?? fallback,
    imageAlt: media.photograph?.alt ?? (place.kind === "bar" ? words("칵테일 분위기 일러스트", "Cocktail illustration", "カクテルのイラスト") : words("음식 분위기 일러스트", "Food illustration", "食のイメージイラスト")),
    illustration: !media.photograph,
    credit: media.photograph ? `${place.photo?.credit} · ${place.photo?.license}` : "K-Tour ID · Editorial illustration",
    source: source ?? place.sources[0].url,
    ...(media.photograph && place.photo ? { photoSource: place.photo.sourceUrl, licenseUrl: place.photo.licenseUrl } : {}),
  }
}

export type DemoTemperature = { band: Mood; intensity: number; source: "editorial-demo" }
// One deliberately fixed demonstration dataset, NOT observed demand, quality,
// current attendance, opening status, or verified quietness. Unknown stays unknown.
// Each place belongs to exactly one band; band filters never rerank/relabel it.
export const DEMO_TEMPERATURE: Readonly<Record<string, DemoTemperature>> = Object.freeze({
  "research-seoul-onion-anguk": Object.freeze({ band: "hot", intensity: 88, source: "editorial-demo" }),
  "research-seoul-geumdwaeji-sikdang": Object.freeze({ band: "hot", intensity: 84, source: "editorial-demo" }),
  "research-seoul-london-bagel-dosan": Object.freeze({ band: "hot", intensity: 80, source: "editorial-demo" }),
  "research-seoul-3rd-samgyetang": Object.freeze({ band: "warm", intensity: 60, source: "editorial-demo" }),
  "research-seoul-zest": Object.freeze({ band: "warm", intensity: 56, source: "editorial-demo" }),
  "research-seoul-bar-cham": Object.freeze({ band: "warm", intensity: 52, source: "editorial-demo" }),
  "research-seoul-hakrim-dabang": Object.freeze({ band: "cool", intensity: 30, source: "editorial-demo" }),
  "research-seoul-gosari-express": Object.freeze({ band: "cool", intensity: 26, source: "editorial-demo" }),
  "research-seoul-okdongsik": Object.freeze({ band: "cool", intensity: 22, source: "editorial-demo" }),
})
export const MOODS: Record<Mood, string[]> = {
  hot: Object.keys(DEMO_TEMPERATURE).filter(id => DEMO_TEMPERATURE[id].band === "hot"),
  warm: Object.keys(DEMO_TEMPERATURE).filter(id => DEMO_TEMPERATURE[id].band === "warm"),
  cool: Object.keys(DEMO_TEMPERATURE).filter(id => DEMO_TEMPERATURE[id].band === "cool"),
}
const foodPlaces = [
  food(MOODS.hot[0], words("한옥에서 커피와 빵", "Coffee & bread in a hanok", "韓屋でコーヒーとパン"), "/editorial/food/coffee-croissant-illustration-v1.jpg"),
  food(MOODS.hot[1], words("한국식 숯불구이 한 끼", "A Korean barbecue stop", "韓国式の炭火焼きを一食"), "/editorial/food/ondo-category-korean-v1.jpg"),
  food(MOODS.hot[2], words("베이글로 시작하는 하루", "Start with a bagel", "ベーグルで始める一日"), "/editorial/food/coffee-croissant-illustration-v1.jpg"),
  food(MOODS.cool[0], words("오래된 다방의 비엔나커피", "Vienna coffee, old Seoul", "老舗喫茶のウインナーコーヒー"), "/editorial/food/coffee-croissant-illustration-v1.jpg"),
  food(MOODS.cool[1], words("고사리로 만나는 비건 한 끼", "A different bowl: vegan gosari", "ワラビで楽しむヴィーガンの一食"), "/editorial/food/perilla-noodles-illustration-v1.jpg"),
  food(MOODS.cool[2], words("맑은 돼지곰탕 한 그릇", "A clear bowl of pork gomtang", "澄んだ豚コムタンを一杯"), "/editorial/food/ondo-category-specialty-v1.jpg"),
  food(MOODS.warm[0], words("서초에서 만나는 삼계탕 한 그릇", "A samgyetang stop in Seocho", "瑞草で味わうサムゲタン"), "/editorial/food/ondo-category-specialty-v1.jpg", "https://guide.michelin.com/en/seoul-capital-area/kr-seoul/restaurant/3rd-samgyetang"),
  food(MOODS.warm[1], words("지역 식재료로 풀어낸 칵테일", "Cocktails with local ingredients", "地域の食材を生かしたカクテル"), "/editorial/food/ondo-category-night-v1.jpg", "https://www.theworlds50best.com/discovery/Establishments/South-Korea/Seoul/Zest.html"),
  food(MOODS.warm[2], words("한옥에서 만나는 한국의 술", "Korean spirits in a hanok", "韓屋で出会う韓国のお酒"), "/editorial/food/ondo-category-night-v3.jpg", "https://www.theworlds50best.com/discovery/Establishments/South-Korea/Seoul/Bar-Cham.html"),
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

const jejuKpopPlaces: Place[] = ["jeju-donsadon", "jeju-oneunjeong-gimbap"].map((id, index) => {
  const place = JEJU_EDITORIAL_PLACES.find(p => p.id === id)!
  return {
    id, city: "jeju", name: place.name, kind: "food",
    area: index === 0 ? words("제주시 · 제주", "Jeju City · Jeju", "済州市・済州") : words("서귀포 · 제주", "Seogwipo · Jeju", "西帰浦・済州"),
    reason: index === 0 ? words("K-pop 미식 안내 속 흑돼지 한 끼", "Black pork from a K-pop food guide", "K-popグルメ案内の黒豚料理")
      : words("서귀포에서 고르는 김밥 한 줄", "A gimbap stop in Seogwipo", "西帰浦で選ぶキンパ"),
    latitude: place.location.latitude, longitude: place.location.longitude,
    image: "/editorial/japan-first-c20-jeju-kpop-route.jpg",
    imageAlt: words("제주 미식 여행 일러스트", "Jeju food trip illustration", "済州グルメ旅のイラスト"), illustration: true,
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
}, ...jejuPlaces, ...jejuKpopPlaces]

export const STORIES: Story[] = [{
  id: "sesame", city: "seoul", title: words("참기름 따라, 시장으로", "Follow the sesame oil", "ゴマ油を探しに市場へ"),
  image: "/editorial/japan-first-c01-sesame-oil.jpg", places: ["lab-seoul-jungbu-market"],
  source: "https://rurubu.jp/andmore/article/25110",
  intro: words(
    "여행의 기억을 한 병에 담는다면 어떤 향일까요? 참기름 이야기를 따라 서울 중부시장으로 가봅니다.",
    "What would a trip smell like in a bottle? Follow a sesame-oil story to Seoul’s Jungbu Market.",
    "旅の思い出をひと瓶に詰めるなら、どんな香りでしょうか。ゴマ油の物語をたどり、ソウルの中部市場へ。",
  ),
  paragraphs: [words(
    "일본 여행 매체 Rurubu & more는 중부시장에서 깨를 볶고 짜서 병에 담는 참기름 전문점을 소개합니다. 익숙한 양념도 만드는 과정을 따라가면 여행에서 만나는 새로운 이야기가 됩니다.",
    "Japanese travel guide Rurubu & more visits Jungbu Market’s oil specialists, following sesame seeds from roasting to bottling. An everyday ingredient becomes a reason to explore.",
    "日本の旅行メディア、るるぶ&more.は、中部市場でゴマを煎り、搾って瓶に詰める専門店を紹介しています。身近な調味料も、できるまでを知ると旅の楽しみになります。",
  ), words(
    "참기름은 나물에, 들기름은 메밀국수에. 원문이 소개하는 먹는 방법을 떠올리며, 집에서 즐기고 싶은 한 병을 골라보는 건 어떨까요?",
    "Sesame oil for seasoned vegetables; perilla oil for buckwheat noodles. The article’s serving ideas offer a starting point for choosing a flavour to take home.",
    "ナムルにはゴマ油、そばにはエゴマ油。記事で紹介された食べ方をヒントに、自宅で楽しみたいひと瓶を考えてみませんか。",
  )],
  stopNotes: {
    "lab-seoul-jungbu-market": words(
      "원문 속 참기름 전문점들이 있는 중부시장이에요. 핀은 시장 전체의 위치이며, 개별 가게 정보는 원문에서 확인할 수 있어요.",
      "The market behind the oil story. This pin marks the market, not an individual shop; follow the source for shop details.",
      "記事のゴマ油専門店がある中部市場です。ピンは市場の位置を示しており、個々のお店の情報は元の記事で確認できます。",
    ),
  },
}, {
  id: "screen", city: "jeju", title: words("드라마 속 제주로", "Step into a Jeju scene", "ドラマの済州へ"),
  image: "/editorial/japan-first-c18-jeju-screen-route.jpg", places: jejuPlaces.map(p => p.id),
  source: "https://japanese.visitkorea.or.kr/svc/contents/contentsView.do?vcontsId=222180",
  intro: words(
    "드라마가 끝나도 마음에 남는 풍경이 있죠. 서로 다른 두 작품을 따라 제주 성산의 두 장소를 만나보세요.",
    "Some landscapes stay with you after a drama ends. Explore two places around Seongsan through two different stories.",
    "ドラマが終わっても、心に残る風景があります。異なる二つの作品を手がかりに、済州・城山の二つの場所を訪ねてみましょう。",
  ),
  paragraphs: [words(
    "VISITKOREA는 성산일출봉을 〈폭싹 속았수다〉의 촬영지로 소개합니다. 화면 속 풍경을 떠올리며, 이번에는 자신의 시선으로 그 장소를 바라보세요.",
    "VISITKOREA links Seongsan Ilchulbong to When Life Gives You Tangerines. Recall the landscape on screen, then imagine seeing it through your own eyes.",
    "VISITKOREAは城山日出峰を『おつかれさま』のロケ地として紹介しています。画面で見た風景を思い出しながら、今度は自分の目で眺めてみませんか。",
  ), words(
    "광치기해변은 같은 안내에서 〈웰컴투 삼달리〉의 촬영지로 이어집니다. 한 작품의 정해진 코스가 아니라, 서로 다른 이야기를 떠올리며 마음이 가는 장소를 고르는 여행이에요.",
    "The same guide connects Gwangchigi Beach with Welcome to Samdal-ri. These are two stories to choose from, not a prescribed route through one drama.",
    "同じガイドはクァンチギ海岸を『サムダルリへようこそ』のロケ地として紹介しています。一作品の決まったコースではなく、それぞれの物語から気になる場所を選ぶ旅です。",
  )],
  stopNotes: {
    "jeju-seongsan-ilchulbong": words(
      "〈폭싹 속았수다〉와 연결되는 장소예요. VISITKOREA의 촬영지 안내를 바탕으로 골랐어요.",
      "A When Life Gives You Tangerines location, selected from VISITKOREA’s filming guide.",
      "『おつかれさま』につながる場所。VISITKOREAのロケ地案内をもとに選びました。",
    ),
    "jeju-gwangchigi-beach": words(
      "〈웰컴투 삼달리〉와 연결되는 해변이에요. 성산일출봉과는 다른 작품의 장소로 함께 소개해요.",
      "A Welcome to Samdal-ri beach location, paired here with a place from a different drama.",
      "『サムダルリへようこそ』につながる海岸。城山日出峰とは異なる作品の場所として紹介しています。",
    ),
  },
}, {
  id: "seoul-cafes", city: "seoul", title: words("커피 한 잔, 서울의 시간", "Seoul, one coffee at a time", "コーヒーで出会うソウルの時間"),
  image: "/editorial/food/coffee-croissant-illustration-v1.jpg", places: ["research-seoul-onion-anguk", "research-seoul-hakrim-dabang"],
  source: "https://english.visitkorea.or.kr/svc/contents/contentsView.do?vcontsId=191156",
  sources: [
    { label: "VISITKOREA · Onion Anguk", url: "https://english.visitkorea.or.kr/svc/contents/contentsView.do?vcontsId=191156" },
    { label: "VISITKOREA · Hakrim", url: "https://english.visitkorea.or.kr/svc/contents/contentsView.do?vcontsId=47863" },
  ],
  intro: words(
    "서울의 시간을 커피 한 잔으로 만나볼까요? 관광공사의 두 장소 소개를 바탕으로 한옥 카페와 오래된 다방을 함께 골랐어요.",
    "Meet a little of Seoul’s past over coffee. Our pairing brings together a hanok café and an old dabang, using two VISITKOREA place guides.",
    "コーヒーを一杯、ソウルの時間に触れてみませんか。観光公社の二つの施設紹介をもとに、韓屋カフェと昔ながらの喫茶店を組み合わせました。",
  ),
  paragraphs: [words(
    "어니언 안국은 1920년대 한옥의 대청마루와 마당을 살린 카페예요. 빵과 커피를 고르기 전, 지붕과 마루가 만드는 공간도 잠깐 바라보세요.",
    "Onion Anguk occupies a 1920s hanok with its wooden hall and courtyard preserved. Before choosing bread and coffee, take a moment to notice the building around you.",
    "オニオン安国は、1920年代の韓屋の板の間と中庭を生かしたカフェ。パンとコーヒーを選ぶ前に、屋根や床がつくる空間にも目を向けてみてください。",
  ), words(
    "대학로의 학림은 1956년에 문을 연 다방으로, 비엔나커피와 예술가들의 흔적이 소개돼요. 두 곳은 하나의 공식 코스가 아니라 취향에 따라 고르는 대안이에요. 현재 좌석이나 대기 상황은 확인되지 않았어요.",
    "Hakrim opened in 1956; its guide highlights Vienna coffee and its ties to artists. Choose whichever stop appeals to you: this is our pairing, not an official route or a promise of available seats.",
    "大学路の学林は1956年開業。ウインナーコーヒーや芸術家たちとの歴史が紹介されています。二店は公式コースではなく、好みで選ぶ候補です。現在の空席や待ち時間は確認していません。",
  )],
  stopNotes: {
    "research-seoul-onion-anguk": words("한옥의 마당과 대청마루를 만나는 안국의 카페예요.", "The Anguk café with a hanok courtyard and wooden hall.", "韓屋の中庭と板の間に出会う、安国のカフェ。"),
    "research-seoul-hakrim-dabang": words("1956년부터 이어진 대학로 다방의 시간을 만나보세요.", "A Daehak-ro dabang whose story began in 1956.", "1956年から続く、大学路の喫茶店の時間に触れて。"),
  },
}, {
  id: "seoul-table", city: "seoul", title: words("한 그릇으로 만나는 서울", "Two bowls, two sides of Seoul", "一杯から出会うソウル"),
  image: "/editorial/food/perilla-noodles-illustration-v1.jpg", places: ["research-seoul-gosari-express", "research-seoul-okdongsik"],
  source: "https://www.badcarrotgroup.com/kr/location",
  sources: [
    { label: "BAD CARROT · Gosari Express", url: "https://www.badcarrotgroup.com/kr/location" },
    { label: "MICHELIN Guide · Gosari Express", url: "https://guide.michelin.com/kr/en/seoul-capital-area/kr-seoul/restaurant/gosari-express" },
    { label: "VISITKOREA · Okdongsik", url: "https://english.visitkorea.or.kr/svc/whereToGo/locIntrdn/rgnContentsView.do?vcontsId=191592" },
  ],
  intro: words(
    "오늘은 어떤 한 그릇이 끌리나요? 고사리를 내세운 비건 면 요리와 맑은 돼지곰탕을 각 장소의 소개에서 골라 함께 담았어요.",
    "What kind of bowl would you choose today? Our edit pairs gosari-led vegan noodles with clear pork soup, drawing on each place’s own guide.",
    "今日はどんな一杯に惹かれますか。各店の紹介をもとに、ワラビを生かしたヴィーガン麺と澄んだ豚コムタンを組み合わせました。",
  ),
  paragraphs: [words(
    "고사리 익스프레스는 신당동 중앙시장에 있는 비건 면 요리점이에요. 미쉐린 가이드는 고사리 오일 소스를 활용한 비빔면 등 식물성 재료의 새로운 쓰임을 소개합니다.",
    "Gosari Express is a vegan noodle shop in Sindang’s Jungang Market. The MICHELIN Guide describes its gosari oil sauce and plant-based dishes, including bibim noodles.",
    "ゴサリ・エクスプレスは新堂洞の中央市場にあるヴィーガン麺の店。ミシュランガイドは、ワラビのオイルソースを使うビビン麺など、植物性素材の楽しみ方を紹介しています。",
  ), words(
    "서교동 옥동식은 맑은 돼지곰탕을 중심으로 한 곳이에요. 서로 다른 동네와 재료를 비교해 마음이 가는 한 곳을 고르세요. 한 동네의 도보 코스나 두 곳 모두의 비건 메뉴를 뜻하지는 않아요.",
    "Okdongsik in Seogyo-dong centres on clear pork soup. Pick a neighbourhood and a flavour; these are alternatives, not a walking route. Only the Gosari stop is presented as vegan.",
    "西橋洞のオクトンシクは、澄んだ豚コムタンが中心。街と味を比べて、気になる一店を選んでください。徒歩コースではなく、ヴィーガンとして紹介するのはゴサリの一店だけです。",
  )],
  stopNotes: {
    "research-seoul-gosari-express": words("중부시장과는 다른 신당동 중앙시장의 비건 면 요리점이에요.", "Vegan noodles in Sindang’s Jungang Market, not Jungbu Market.", "中部市場とは別の、新堂洞・中央市場にあるヴィーガン麺の店。"),
    "research-seoul-okdongsik": words("맑은 돼지곰탕을 고른다면 서교동의 이 한 그릇이에요.", "The Seogyo-dong option for clear pork gomtang.", "澄んだ豚コムタンを選ぶなら、西橋洞のこの一杯。"),
  },
}, {
  id: "jeju-kpop", city: "jeju", title: words("K-pop 이야기 따라, 제주 한 끼", "A Jeju bite, a K-pop story", "K-popの物語と済州の一食"),
  image: "/editorial/japan-first-c20-jeju-kpop-route.jpg", places: jejuKpopPlaces.map(place => place.id),
  source: "https://japanese.visitkorea.or.kr/svc/whereToGo/hdrdslt/hdrdsltView.do?crsSn=372386",
  intro: words(
    "좋아하는 음악이 여행의 식탁까지 이어질 수 있죠. VISITKOREA의 K-pop 제주 미식 안내에서 위치가 연결된 두 곳을 골랐어요.",
    "A favourite song can lead to a new food stop. These two mapped places come from VISITKOREA’s K-pop dining guide to Jeju.",
    "好きな音楽が、旅先の食卓につながることも。VISITKOREAのK-pop済州グルメ案内から、地図で紹介できる二店を選びました。",
  ),
  paragraphs: [words(
    "돈사돈은 관광공사가 K-pop 아티스트의 방문 이야기와 함께 소개한 제주 흑돼지 식당이에요. 스타를 만나는 장소가 아니라, 그 이야기를 계기로 제주 음식에 관심을 가져보는 곳으로 담았어요.",
    "The guide introduces Donsadon’s Jeju black pork through stories of K-pop artists’ visits. Let that story spark an interest in the food; it is not an invitation to meet a performer.",
    "トンサドンは、K-popアーティストの訪問談とともに紹介される済州黒豚の店。その物語を料理へのきっかけに。本人との出会いを案内するものではありません。",
  ), words(
    "서귀포의 오는정김밥도 같은 안내에 등장해요. 북쪽 제주시의 돈사돈과 남쪽 서귀포의 김밥집은 걸어서 잇는 코스가 아니니, 자신의 이동 방향에 맞춰 골라보세요. 주문 방식과 영업 정보는 방문 전 원문과 매장 안내를 확인해 주세요.",
    "Oneunjeong Gimbap appears in the same guide, in Seogwipo. It is not a walk from Donsadon in northern Jeju City. Choose a stop that fits your plans and check the source and shop for current ordering arrangements.",
    "西帰浦のオヌンジョンキンパも同じ案内に登場します。北側の済州市にあるトンサドンと徒歩で結ぶコースではありません。移動方向に合わせて選び、注文方法や営業情報は訪問前に確認してください。",
  )],
  stopNotes: {
    "jeju-donsadon": words("K-pop 미식 안내에 등장하는 제주시의 흑돼지 식당이에요.", "The Jeju City black-pork stop in the K-pop food guide.", "K-popグルメ案内に登場する、済州市の黒豚料理店。"),
    "jeju-oneunjeong-gimbap": words("같은 안내 속 서귀포 김밥집이에요. 주문 방식은 매장에 확인해 주세요.", "The guide’s Seogwipo gimbap stop; check ordering with the shop.", "同じ案内の西帰浦キンパ店。注文方法はお店に確認を。"),
  },
}]
export const CITIES = { seoul: words("서울", "Seoul", "ソウル"), jeju: words("제주", "Jeju", "済州") }
export function searchMood(query: string): Mood | null {
  const q = query.trim().toLocaleLowerCase()
  return ["hot", "핫", "ホット"].includes(q) ? "hot" : ["warm", "웜", "ウォーム"].includes(q) ? "warm" : ["cool", "쿨", "クール"].includes(q) ? "cool" : null
}
export function results(scope: Scope, kind: Kind, saved: readonly string[]): Place[] {
  const ids = scope.mode === "story" ? STORIES.find(s => s.id === scope.story)?.places
    : scope.mode === "hot" || scope.mode === "warm" || scope.mode === "cool" ? MOODS[scope.mode]
    : scope.mode === "saved" ? saved : scope.mode === "explore" && scope.city === "seoul" ? MOODS.hot : null
  const candidates = ids ? ids.map(id => PLACES.find(p => p.id === id)!).filter(Boolean) : PLACES
  return candidates.filter(p => p.city === scope.city && (kind === "all" || p.kind === kind)
    && (scope.mode !== "search" || [...Object.values(p.name), ...Object.values(p.area), ...Object.values(p.reason)].join(" ").toLocaleLowerCase().includes((scope.query ?? "").trim().toLocaleLowerCase())))
}
