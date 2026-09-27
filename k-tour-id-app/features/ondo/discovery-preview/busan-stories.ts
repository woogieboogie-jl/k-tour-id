import { RESEARCHED_FOOD_B, researchFoodMediaB } from "../map/researched-food-b"
import { words, type Place, type Story, type Words } from "./discovery-content-types"

const SOURCE = {
  gukje: "https://www.visitbusan.net/index.do?lang_cd=en&menuCd=DOM_000000301003001000&uc_seq=399",
  bupyeong: "https://www.visitbusan.net/index.do?lang_cd=en&menuCd=DOM_000000301003001000&uc_seq=400",
  momos: "https://www.visitbusan.net/index.do?menuCd=DOM_000000202002001000&uc_seq=2158",
  waveon: "https://www.visitbusan.net/index.do?lang_cd=en&menuCd=DOM_000000301002001000&uc_seq=174",
  moemiljip: "https://guide.michelin.com/en/busan-region/busan_1025838/restaurant/moemiljip",
  songheonjip: "https://guide.michelin.com/en/busan-region/busan_1025838/restaurant/songheonjip",
} as const
const MARKET_IMAGE = "/editorial/food/ondo-category-casual-v1.jpg"
const COFFEE_IMAGE = "/editorial/food/coffee-croissant-illustration-v1.jpg"
const TABLE_IMAGE = "/editorial/food/tteokgalbi-illustration-v1.jpg"
const ILLUSTRATION_CREDIT = "K-Tour ID · Editorial illustration"

function researchedPlace(id: string, reason: Words, source: string, imageAlt: Words): Place {
  const place = RESEARCHED_FOOD_B.find(candidate => candidate.id === id)
  if (!place || place.city !== "busan") throw new Error(`Invalid Busan story place: ${id}`)
  const media = researchFoodMediaB(place)
  const image = media.photograph?.src ?? media.src
  if (!image) throw new Error(`Missing Busan story illustration: ${id}`)
  return {
    id, city: "busan", name: place.name, area: place.district, kind: place.kind,
    latitude: place.latitude, longitude: place.longitude, reason, source,
    image, imageAlt: media.photograph?.alt ?? imageAlt, illustration: !media.photograph,
    credit: media.photograph && place.photo ? `${place.photo.credit} · ${place.photo.license}` : ILLUSTRATION_CREDIT,
    ...(media.photograph && place.photo ? { photoSource: place.photo.sourceUrl, licenseUrl: place.photo.licenseUrl } : {}),
  }
}

// Both market pins describe public market areas, never a particular vendor.
// Gukje uses KTO's named Youth Street point, not a claimed market centroid.
// Coordinate and media provenance: docs/BUSAN_STORY_SOURCES_2026-09-27.md.
export const BUSAN_STORY_PLACES: Place[] = [{
  id: "editorial-busan-gukje-market", city: "busan", kind: "food",
  name: words("국제시장 · 젊음의거리", "Gukje Market · Youth Street", "国際市場・若者通り"),
  area: words("중구 · 부산", "Jung-gu · Busan", "中区・釜山"),
  reason: words("장보기 골목에서 만나는 시장 한 입", "A market bite between shopping alleys", "買い物の路地で楽しむ市場の一口"),
  latitude: 35.1015616857, longitude: 129.0283237293,
  image: MARKET_IMAGE,
  imageAlt: words("분식 분위기 일러스트 · 시장 실경 아님", "Street-food illustration, not a photograph of the market", "軽食のイメージイラスト・市場の実景ではありません"),
  illustration: true, credit: ILLUSTRATION_CREDIT, source: SOURCE.gukje,
}, {
  id: "editorial-busan-bupyeong-market", city: "busan", kind: "food",
  name: words("부평깡통시장", "Bupyeong Kkangtong Market", "富平カントン市場"),
  area: words("중구 · 부산", "Jung-gu · Busan", "中区・釜山"),
  reason: words("어묵과 유부주머니를 따라 걷는 골목", "Market lanes of fish cakes and tofu pockets", "練り物や油揚げの巾着を探す路地"),
  latitude: 35.1015921962, longitude: 129.0260517037,
  image: MARKET_IMAGE,
  imageAlt: words("분식 분위기 일러스트 · 시장 실경 아님", "Street-food illustration, not a photograph of the market", "軽食のイメージイラスト・市場の実景ではありません"),
  illustration: true, credit: ILLUSTRATION_CREDIT, source: SOURCE.bupyeong,
}, researchedPlace(
  "research-busan-momos-yeongdo",
  words("항구에서 만나는 원두의 여정", "From green bean to cup by the harbour", "港で出会うコーヒー豆の旅"),
  SOURCE.momos,
  words("커피와 빵 분위기 일러스트 · 매장 사진 아님", "Coffee-and-pastry illustration, not venue photography", "コーヒーとパンのイラスト・店舗写真ではありません"),
), researchedPlace(
  "research-busan-waveon-coffee",
  words("기장 바다 곁에서 고르는 커피 한 잔", "A coffee stop by Gijang’s coast", "機張の海辺で選ぶコーヒー"),
  SOURCE.waveon,
  words("커피와 빵 분위기 일러스트 · 매장 사진 아님", "Coffee-and-pastry illustration, not venue photography", "コーヒーとパンのイラスト・店舗写真ではありません"),
), researchedPlace(
  "research-busan-moemiljip",
  words("마린시티에서 만나는 들기름 메밀국수", "Perilla-oil buckwheat noodles in Marine City", "マリンシティで味わうエゴマ油のそば"),
  SOURCE.moemiljip,
  words("메밀국수 분위기 일러스트 · 실제 메뉴 사진 아님", "Buckwheat-noodle illustration, not the restaurant’s dish", "そばのイメージイラスト・実際の料理写真ではありません"),
), researchedPlace(
  "research-busan-songheonjip",
  words("민락의 집 한 채에서 맛보는 숯불 떡갈비", "Charcoal-grilled tteokgalbi in a Millak house", "民楽の一軒家で味わう炭火トッカルビ"),
  SOURCE.songheonjip,
  words("떡갈비 분위기 일러스트 · 실제 메뉴 사진 아님", "Tteokgalbi illustration, not the restaurant’s dish", "トッカルビのイメージイラスト・実際の料理写真ではありません"),
)]

export const BUSAN_STORIES: Story[] = [{
  id: "busan-market", city: "busan",
  title: words("골목마다 한 입, 부산의 시장", "Two markets, a taste of Busan", "路地をめぐる、釜山の市場"),
  image: MARKET_IMAGE,
  places: ["editorial-busan-gukje-market", "editorial-busan-bupyeong-market"],
  source: SOURCE.gukje,
  sources: [
    { label: "Visit Busan · Gukje Market", url: SOURCE.gukje },
    { label: "Visit Busan · Bupyeong Kkangtong Market", url: SOURCE.bupyeong },
  ],
  intro: words(
    "장보기와 간식 사이에서 부산의 골목을 만나보세요. 서로 이웃한 국제시장과 부평깡통시장을 가볍게 둘러보는 이야기예요.",
    "Let shopping and a small bite lead you into Busan’s lanes. Gukje and neighbouring Bupyeong Kkangtong Market offer two ways to explore the same area.",
    "買い物と軽食の間に、釜山の路地を歩いてみませんか。隣り合う国際市場と富平カントン市場、それぞれの楽しみを探します。",
  ),
  paragraphs: [words(
    "국제시장은 생활용품과 옷, 작은 물건을 구경하다 먹거리 골목으로 이어지는 곳이에요. 비짓부산은 비빔당면과 충무김밥, 어묵을 시장의 맛으로 소개합니다. 눈에 들어온 물건 하나, 궁금한 음식 하나를 고르며 천천히 둘러보세요.",
    "At Gukje Market, shopping lanes and food stops sit side by side. Visit Busan highlights spicy glass noodles, Chungmu gimbap and fish cakes. Browse first, then let a small dish become your next stop.",
    "国際市場では、日用品や服、小物を眺めた先に食の路地が続きます。Visit Busanはビビンタンミョン、忠武キンパ、練り物を紹介。気になる品と一皿を探しながら歩いてみてください。",
  ), words(
    "옆의 부평깡통시장에서는 어묵과 떡볶이, 당면과 채소를 넣은 유부주머니가 또 다른 한 입이 돼요. 두 핀은 개별 가게가 아닌 시장 구역을 가리킵니다. 특정 노점이나 야시장 운영을 보장하는 코스는 아니니, 방문할 때 열려 있는 가게 안내를 확인해 주세요.",
    "Next door, Bupyeong Kkangtong Market brings fish cakes, tteokbokki and tofu pockets filled with glass noodles and vegetables. Our pins mark market areas, not individual stalls. Check the shops you find on arrival; this is not a promise that a particular vendor or night market is operating.",
    "隣の富平カントン市場では、練り物やトッポッキ、春雨と野菜を包む油揚げの巾着も楽しみの一つ。ピンは個店ではなく市場のエリアです。特定の屋台や夜市の営業を保証するコースではないため、訪問時に各店の案内を確認してください。",
  )],
  stopNotes: {
    "editorial-busan-gukje-market": words(
      "핀은 국제시장 젊음의거리의 대표 위치예요. 개별 음식점의 위치나 시장 전체의 중심점을 뜻하지 않아요.",
      "The pin marks Gukje Market’s Youth Street, not a particular food stall or the centre of the entire market.",
      "ピンは国際市場の若者通りの代表地点です。特定の飲食店や市場全体の中心点ではありません。",
    ),
    "editorial-busan-bupyeong-market": words(
      "부평1길 48의 시장 대표 위치예요. 어묵과 유부주머니 등 먹거리는 골목의 개별 가게에서 살펴보세요.",
      "The market location at 48 Bupyeong 1-gil. Explore individual shops for fish cakes and tofu pockets.",
      "富平1ギル48の市場代表地点。練り物や油揚げの巾着は、路地の各店で探してみてください。",
    ),
  },
}, {
  id: "busan-coffee", city: "busan",
  title: words("항구의 커피, 바다의 한 잔", "Harbour coffee, coastal views", "港のコーヒー、海辺の一杯"),
  image: COFFEE_IMAGE,
  places: ["research-busan-momos-yeongdo", "research-busan-waveon-coffee"],
  source: SOURCE.momos,
  sources: [
    { label: "Visit Busan · Momos Roastery & Coffee Bar", url: SOURCE.momos },
    { label: "Visit Busan · Waveon Coffee", url: SOURCE.waveon },
  ],
  intro: words(
    "커피 한 잔을 고르는 일이 오늘 바라볼 풍경을 고르는 일이 되기도 하죠. 영도의 항구와 기장의 해안 중, 마음이 가는 방향을 골라보세요.",
    "Choosing a coffee can mean choosing a view. Head towards Yeongdo’s harbour or Gijang’s coast, depending on where the day takes you.",
    "コーヒーを選ぶことが、今日見る景色を選ぶことにも。影島の港と機張の海辺から、行きたい方向を選んでみてください。",
  ),
  paragraphs: [words(
    "영도의 모모스 로스터리 & 커피바는 선착장을 바꾼 공간이에요. 비짓부산은 생두 보관부터 로스팅과 추출까지 이어지는 과정을 이곳의 특징으로 소개합니다. 한 잔이 완성되기 전, 원두가 지나온 길에도 눈길을 줘보세요.",
    "Momos Roastery & Coffee Bar occupies a former landing place in Yeongdo. Visit Busan describes a space where green-bean storage, roasting and brewing come into view. Follow the bean’s journey before settling into your cup.",
    "影島のモモス・ロースタリー＆コーヒーバーは、船着き場を改装した空間。Visit Busanは生豆の保管、焙煎、抽出の流れを紹介しています。一杯になるまでの豆の道のりにも目を向けてみませんか。",
  ), words(
    "기장의 웨이브온커피는 바다 전망과 드립커피를 함께 소개하는 곳이에요. 공식 안내에는 월내라떼도 등장합니다. 영도와 기장은 떨어져 있으니 두 곳을 걸어서 잇기보다, 그날 이동 방향에 맞는 한 곳을 골라 쉬어가세요.",
    "Waveon Coffee pairs Gijang’s coast with drip coffee; the official guide also lists its Wolnae latte. Yeongdo and Gijang are separate destinations, not a walking pair. Choose the stop that fits your day rather than rushing between both.",
    "機張のウェーブオンコーヒーは、海の眺めとドリップコーヒーが紹介される店。公式案内にはウォルネラテも登場します。影島と機張は離れているため、徒歩で巡る二店ではなく、その日の移動に合う一店を選んでひと休みを。",
  )],
  stopNotes: {
    "research-busan-momos-yeongdo": words(
      "봉래나루로 160의 영도 로스터리예요. 다른 모모스 지점이 아닌 항구 쪽 공간으로 안내해요.",
      "The Yeongdo roastery at 160 Bongnaenaru-ro, not another Momos branch.",
      "蓬莱ナル路160の影島ロースタリーです。モモスの別支店ではなく、港側の店舗を案内しています。",
    ),
    "research-busan-waveon-coffee": words(
      "기장군 장안읍 해맞이로 286의 해안 카페예요. 영도에서 이어 걷는 코스가 아니에요.",
      "The coastal café at 286 Haemaji-ro, Jangan-eup, Gijang—not a walk from Yeongdo.",
      "機張郡長安邑ヘマジ路286の海辺のカフェ。影島から歩いてつなぐコースではありません。",
    ),
  },
}, {
  id: "busan-table", city: "busan",
  title: words("메밀 한 그릇, 숯불 한 접시", "Buckwheat or charcoal grill?", "そばの一杯、炭火の一皿"),
  image: TABLE_IMAGE,
  places: ["research-busan-moemiljip", "research-busan-songheonjip"],
  source: SOURCE.moemiljip,
  sources: [
    { label: "MICHELIN Guide · Moemiljip", url: SOURCE.moemiljip },
    { label: "MICHELIN Guide · Songheonjip", url: SOURCE.songheonjip },
  ],
  intro: words(
    "들기름 향의 메밀국수와 숯불에 구운 떡갈비. 해운대와 수영의 서로 다른 한 끼를 놓고, 오늘 끌리는 맛을 골라보세요.",
    "Perilla-oil buckwheat noodles or charcoal-grilled tteokgalbi? Two different meals in Haeundae and Suyeong offer a choice for today’s appetite.",
    "エゴマ油のそば、それとも炭火焼きのトッカルビ。海雲台と水営の異なる一食から、今日食べたい味を選んでみてください。",
  ),
  paragraphs: [words(
    "마린시티의 뫼밀집은 국산 메밀을 직접 제분해 면을 만드는 곳으로 미쉐린 가이드가 소개해요. 들기름 메밀국수와 냉메밀, 매콤한 비빔면처럼 같은 메밀도 먹는 방식에 따라 인상이 달라집니다. 자신의 취향에 맞는 한 그릇을 떠올려보세요.",
    "The MICHELIN Guide describes Moemiljip in Marine City as milling Korean buckwheat in-house. Perilla-oil, cold and spicy bibim preparations offer different ways to meet the same ingredient. Choose the bowl that sounds right to you.",
    "ミシュランガイドは、マリンシティのメミルジプを韓国産そばの自家製粉店として紹介。エゴマ油、冷たいそば、辛口のビビン麺と、同じ素材でも食べ方で印象が変わります。好みに合う一杯を思い浮かべてみてください。",
  ), words(
    "민락의 송헌집은 주택을 고친 공간에서 숯불 떡갈비를 내요. 가이드는 밥과 반찬, 된장찌개를 곁들이는 식탁을 소개합니다. 두 식당은 한 번에 두 끼를 먹는 코스가 아니라, 머무는 동네와 먹고 싶은 음식에 따라 고르는 대안이에요.",
    "Songheonjip in Millak serves charcoal-grilled tteokgalbi in a converted house, with rice, side dishes and doenjang stew described in the guide. These are alternatives for one meal, not a two-lunch itinerary: choose by neighbourhood and appetite.",
    "民楽のソンホンジプは、住宅を改装した空間で炭火トッカルビを提供。ガイドはご飯、おかず、テンジャンチゲを添える食卓を紹介しています。二食を続けるコースではなく、滞在する街と食べたい料理で選ぶ二つの候補です。",
  )],
  stopNotes: {
    "research-busan-moemiljip": words(
      "마린시티3로 23 오렌지프라자 2층의 메밀국수집이에요. 건물 안의 층 안내도 함께 확인해 주세요.",
      "Buckwheat noodles on the second floor of Orange Plaza, 23 Marine City 3-ro. Check the building’s floor signs.",
      "マリンシティ3路23、オレンジプラザ2階のそば店です。建物内のフロア案内も確認してください。",
    ),
    "research-busan-songheonjip": words(
      "민락로19번길 18의 떡갈비집이에요. 메밀국수 대신 숯불구이와 밥 한 상을 고를 때의 한 곳이에요.",
      "Tteokgalbi at 18 Millak-ro 19beon-gil—the charcoal-grill-and-rice option rather than noodles.",
      "民楽路19番ギル18のトッカルビ店。そばではなく炭火焼きとご飯を選びたいときの一軒です。",
    ),
  },
}]
