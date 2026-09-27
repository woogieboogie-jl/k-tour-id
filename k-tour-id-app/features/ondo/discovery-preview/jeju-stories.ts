import { RESEARCHED_FOOD_B, researchFoodMediaB } from "../map/researched-food-b"
import { words, type Place, type Story, type Words } from "./discovery-content-types"

const WOOJIN_SOURCE = "https://www.visitjeju.net/kr/detail/view?contentsid=CNTS_000000000018375"
const GOZIP_SOURCE = "https://www.visitjeju.net/kr/detail/view?contentsid=CNTS_000000000021950"
const MEAL_ILLUSTRATION = "/editorial/food/ondo-category-korean-v1.jpg"

function jejuFood(id: string, reason: Words, source: string): Place {
  const place = RESEARCHED_FOOD_B.find(candidate => candidate.id === id)
  if (!place || place.city !== "jeju" || place.kind !== "food") throw new Error(`Invalid Jeju story place: ${id}`)
  const media = researchFoodMediaB(place)
  return {
    id: place.id, city: "jeju", name: place.name, area: place.district,
    latitude: place.latitude, longitude: place.longitude, kind: "food", reason,
    image: media.photograph?.src ?? MEAL_ILLUSTRATION,
    imageAlt: media.photograph?.alt ?? words(
      "한식 식탁 일러스트 · 이 매장이나 메뉴의 사진이 아닙니다",
      "Korean meal illustration, not a photograph of this venue or its dishes",
      "韓国料理のイメージイラスト。この店や料理の写真ではありません",
    ),
    illustration: !media.photograph,
    credit: media.photograph ? `${place.photo?.credit} · ${place.photo?.license}` : "K-Tour ID · Editorial illustration",
    source,
    ...(media.photograph && place.photo ? { photoSource: place.photo.sourceUrl, licenseUrl: place.photo.licenseUrl } : {}),
  }
}

// Existing research IDs and coordinates are reused, not new or inferred pins.
export const JEJU_ADDITIONAL_PLACES: Place[] = [
  jejuFood("research-jeju-woojin-haejangguk", words(
    "고사리와 돼지고기를 푹 끓인 제주 한 그릇",
    "Jeju soup with slow-cooked bracken and pork",
    "ワラビと豚肉をじっくり煮込んだ済州の一杯",
  ), WOOJIN_SOURCE),
  jejuFood("research-jeju-gozip-dolwurock-jungmun", words(
    "중문에서 만나는 우럭조림 한 상",
    "A braised-rockfish meal in Jungmun",
    "中文で味わうウロクの煮付けの膳",
  ), GOZIP_SOURCE),
]

export const JEJU_ADDITIONAL_STORIES: Story[] = [{
  id: "jeju-table", city: "jeju",
  title: words("고사리 한 그릇, 바다 한 상", "A bowl of Jeju, a taste of the sea", "ワラビの一杯、海の一膳"),
  image: MEAL_ILLUSTRATION,
  places: JEJU_ADDITIONAL_PLACES.map(place => place.id),
  source: WOOJIN_SOURCE,
  sources: [
    { label: "VisitJeju · 우진해장국", url: WOOJIN_SOURCE },
    { label: "VisitJeju · 고집돌우럭 중문점", url: GOZIP_SOURCE },
    { label: "고집돌우럭 · 중문점 안내", url: "https://www.gozipfish.com/map1" },
  ],
  intro: words(
    "제주를 한 끼로 기억한다면, 고사리의 부드러움일까요, 생선조림 한 점일까요? 비짓제주의 두 장소 소개에서 서로 다른 식탁을 골랐어요.",
    "Which taste of Jeju would stay with you: a spoonful of bracken soup or a bite of braised fish? Two VisitJeju place guides offer different ways to choose a meal.",
    "済州の一食を思い出すなら、やわらかなワラビのスープ、それとも魚の煮付けでしょうか。VisitJejuの二つの施設紹介から、異なる食卓を選びました。",
  ),
  paragraphs: [words(
    "제주시 우진해장국의 고사리육개장은 고사리와 돼지고기를 오래 끓여 만드는 제주 향토음식이에요. 비짓제주는 재료가 부드럽게 풀어져 죽처럼 걸쭉해지는 질감을 소개합니다. 익숙한 ‘육개장’이라는 이름 안에서 제주만의 한 그릇을 만나보세요.",
    "At Woojin Haejangguk in Jeju City, bracken and pork are simmered together for a local take on yukgaejang. VisitJeju describes ingredients softened into a thick, almost porridge-like soup: a different texture behind a familiar Korean dish name.",
    "済州市のウジンヘジャングクでは、ワラビと豚肉を長く煮込む郷土料理、コサリユッケジャンに出会えます。VisitJejuが紹介するのは、具材がやわらかくほどけ、おかゆのようにとろみのついたスープ。ユッケジャンという名前から、済州ならではの一杯を知るきっかけに。",
  ), words(
    "남쪽 중문의 고집돌우럭은 우럭조림과 낭푼밥상을 소개하는 곳이에요. 국 한 그릇 대신 생선 요리와 밥상을 고르고 싶다면 중문점을 살펴보세요. 북쪽 제주시의 우진해장국과 묶은 공식 코스나 도보 동선은 아니니, 오늘의 이동 방향에 맞춰 한 곳을 골라보세요.",
    "In Jungmun on the island’s south side, Gozip Dolwurock introduces braised rockfish and a nangpun-style meal. Consider this branch if fish and a spread of dishes appeal more than a bowl of soup. These northern and southern stops are alternatives, not an official itinerary or a walking route.",
    "島の南側、中文のコジプトルウロクは、ウロクの煮付けとナンプンの食膳を紹介しています。スープ一杯より魚料理とご飯の膳に惹かれるなら、中文店を候補に。北側の済州市の店と結ぶ公式コースや徒歩ルートではないので、その日の移動方向に合わせて選んでください。",
  )],
  stopNotes: {
    "research-jeju-woojin-haejangguk": words(
      "제주시 서사로의 고사리육개장 식당이에요. 고사리와 돼지고기를 함께 끓이는 음식이라 채식 메뉴로 소개하지 않아요.",
      "The Seosa-ro stop in Jeju City. Its bracken soup contains pork; this is not a vegetarian recommendation.",
      "済州市・西沙路のコサリユッケジャンの店。ワラビと豚肉を煮込む料理で、菜食メニューとしての紹介ではありません。",
    ),
    "research-jeju-gozip-dolwurock-jungmun": words(
      "핀은 서귀포시 일주서로 879의 중문점이에요. 같은 이름의 제주공항점·함덕점과 구분하고, 메뉴와 주문 방식은 매장 안내를 확인하세요.",
      "This pin is the Jungmun branch at 879 Iljuseo-ro, Seogwipo, not the airport or Hamdeok branch. Check the shop’s current menu and ordering details.",
      "ピンは西帰浦市・一周西路879の中文店です。空港店・咸徳店とは別なので、店舗と現在のメニュー・注文方法を確認してください。",
    ),
  },
}]
