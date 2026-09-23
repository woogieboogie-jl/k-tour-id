"use client"

import type { CircleLayerSpecification, EaseToOptions, ExpressionSpecification, GeoJSONSource, JumpToOptions, Map as MapLibreMap, MapLayerMouseEvent, SymbolLayerSpecification } from "maplibre-gl"
import type { MutableRefObject, RefObject } from "react"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { flushSync } from "react-dom"
import { ArrowLeft, ChevronRight, Copyright, Info, Languages, Layers2, List, LocateFixed, LocateOff, Map as MapIcon, MapPin, MoonStar, Search, SlidersHorizontal, X } from "lucide-react"
import { KOREA_OUTLINE_COORDINATES } from "@/lib/map/korea-atlas-data"
import { ondoBasemapLabel, ondoMapPalette, ondoMapStyle } from "@/lib/ondo/map/ondo-map-style"
import type { CanonicalMapVenue, VenuePrimaryCategory } from "@/lib/ondo/venues/contracts"
import { CANONICAL_MAP_VENUES_COMPACT } from "@/lib/ondo/venues/map-data"
import { venueDisplayName, venueDistrictLabel } from "@/lib/ondo/venues/display"
import { mapFoodIntentAliases } from "@/lib/ondo/venues/map-discovery-aliases"
import { GlobalAfter19B } from "../after19/after19-global-b"
import {
  PULSE_CITY_STATUS,
  PULSE_DISCLOSURE,
  pulseForVenue,
  pulseLevelLabel,
  type PulseConfidenceB,
  type PulseFreshnessB,
  type PulseLevelB,
  type PulseLocalEvidenceB,
} from "../pulse-b/pulse-model-b"
import { editorialPlaceById, JAPAN_FIRST_LAUNCH_CONTENT, JEJU_EDITORIAL_COVERAGE_INTENSITY_LABEL, JEJU_EDITORIAL_COVERAGE_LABEL, JEJU_EDITORIAL_PLACES, JEJU_EDITORIAL_SEEDS, JEJU_EDITORIAL_TEMPERATURE, JEJU_EDITORIAL_UNSCORED_LABEL, PULSE_COMPOSITION_DISCLOSURE, PULSE_PRODUCTION_DRIVER_DISCLOSURE, jejuEditorialCoverageIntensity, jejuEditorialCoverageSummary, type EditorialPlaceB, type JejuEditorialCoverageIntensityB } from "../pulse-b/japan-first-pulse-model-b"
import { ONDO_B_DISCOVERY_PREFERENCES, type OndoBDiscoveryPreference, type OndoBLegacyDiscoveryIntent, type OndoBLocale, type OndoBPersona } from "../shared/state/ondo-b-preferences"
import { useOndoB } from "../shared/state/ondo-b-provider"
import { OndoBrandLockupB } from "../shared/ui/ondo-brand-lockup-b"
import { SampleInfoButtonB, SAMPLE_INFO_EVENT, sampleInfoCopyB } from "../shared/ui/sample-info-button-b"
import { readQaRuntime } from "../shared/ui/use-qa-controls"
import { useReviewSampleSession } from "../shared/ui/use-qa-controls"
import { JapanFirstDiscoveryB } from "./japan-first-discovery-b"
import { DiscoveryCollectionPinsB, DiscoveryCollectionResultsB, DiscoveryMarketDetailB, DiscoveryMoodSuggestionsB, DiscoveryStoryHintB } from "./discovery-collection-b"
import { discoveryCollectionPlacesB, discoveryMoodFromQueryB, discoveryPlaceByIdB, type DiscoveryCollectionIdB } from "./discovery-collection-model-b"
import { MapOptionsB } from "./map-options-b"
import { TemperatureTimelineB } from "./temperature-timeline-b"
import { TravelerActivityMapB } from "./traveler-activity-map-b"
import { RESEARCHED_FOOD_B, researchedFoodByIdB, researchFoodMatchesB } from "./researched-food-b"
import { ResearchedFoodListB, ResearchedFoodPanelB } from "./researched-food-panel-b"
import { MapBalanceEntryB } from "./map-balance-entry-b"
import { registerPlaceServiceMapCaptureB } from "./place-service-map-return-b"
import { PLACE_SERVICE_RETURN_EVENT_B, SHOW_BALANCE_PLACES_EVENT_B, resolveCommercePlaceB } from "../commerce-b/place-service-registry-b"
import { B_DISCOVERY_FOCUS_EVENT, readBDiscoveryFocusRequest, type BDiscoveryFocusRequest } from "./b-discovery-focus"
import { classifyBDiscoveryPreferencePresentation, orderBCanonicalDiscoveryPlaces } from "./b-discovery-personalization"
import { CanonicalVenueCapsuleB } from "./canonical-venue-capsule-b"
import {
  PLACE_RETURN_UI_RESTORE_EVENT,
  readPlaceReturnUiRestoreEvent,
  registerPlaceReturnCameraReader,
  type PlaceReturnUiSnapshotB,
} from "./place-return-ui-snapshot-b"
import {
  B_DISCOVERY_TRAVERSAL_EVENT,
  enterBDiscoveryCity,
  focusBDiscoveryTarget,
  goBackFromBDiscovery,
  initializeBDiscoveryHistory,
  installBDiscoveryTraversalGuard,
  normalizeBDiscoveryHistoryForActiveDocument,
  openBDiscoveryEditorialPlace,
  openBDiscoveryCollection,
  openBDiscoveryCollectionPlace,
  openBDiscoveryVenue,
  readBDiscoveryHistory,
  readBDiscoveryTraversal,
  readMyKoreaPlaceReturnNavigation,
  replaceBDiscoveryCityContext,
  replaceBDiscoveryHistoryForActiveDocument,
  type BDiscoveryCamera,
  type BDiscoveryCategory,
  type BDiscoveryEditorialCategory,
  type BDiscoveryHistoryEntry,
} from "./b-discovery-history"
import styles from "./map-b.module.css"

type CityId = "seoul" | "busan" | "jeju"
type ViewMode = "map" | "list"
type MapLayoutMode = "measuring" | "ultra-short" | "compact-map" | "spacious-map"
type LocationState = "idle" | "locating" | "ready" | "denied" | "unsupported"
type UserLocation = { longitude: number; latitude: number }
type EditorialCategory = "all" | EditorialPlaceB["category"]
type DiscoveryIntent = OndoBPersona | OndoBLegacyDiscoveryIntent
type ServiceMapSnapshotB = {
  placeId: string; city: CityId; view: ViewMode; query: string; category: BDiscoveryCategory
  editorialCategory: EditorialCategory; listScroll: number; camera?: BDiscoveryCamera
  balancePlacesOnly: boolean; history: BDiscoveryHistoryEntry | null; detailScroll: number
  expandedDisclosures: string[]
  collection: DiscoveryCollectionIdB | null; collectionSelection: string | null
}
const BALANCE_MAP_COPY = {
  ko: { places: "사용할 곳", clear: "사용할 곳 필터 해제", filter: "사용할 곳 보기" },
  en: { places: "Places to use it", clear: "Clear places-to-use filter", filter: "See places to use it" },
  ja: { places: "使える場所", clear: "使える場所フィルターを解除", filter: "使える場所を見る" },
} as const
const SEARCH_MAX_LENGTH = 120
const MAP_LOAD_CONTEXT_DELAY_MS = 800
const MAP_LOAD_FALLBACK_DELAY_MS = 5_000
// Leave enough main-thread/frame margin for the public 520 ms tap-to-settle
// budget on a mobile device. Chrome choreography remains one continuous beat.
const CITY_FOCUS_DURATION_MS = 340
const CITY_FOCUS_SETTLE_GUARD_MS = 400
const NATION_RETURN_DURATION_MS = 440
const CITY_PERSPECTIVE_PITCH = 28

const MOBILE_CHROME_COPY = {
  en: { options: "Options", optionsLabel: "Map options and filters", search: "Search places or areas" },
  ko: { options: "옵션", optionsLabel: "지도 옵션과 필터", search: "장소·지역 검색" },
  ja: { options: "設定", optionsLabel: "地図の設定とフィルター", search: "場所・エリアを検索" },
} as const

// A sample has one visual signal. Keep the independent directory/curated data
// intact, but do not stack its fixed heat and oversized cores over the replay.
const SNAPSHOT_SIGNAL_LAYERS = new Set([
  "ondo-temperature-field", "ondo-after19-eligible-field", "ondo-after19-eligible-points",
  "ondo-pulse-halo", "ondo-pulse-halo-rising", "ondo-pulse-halo-warming",
  "ondo-pulse-points", "ondo-pulse-points-rising", "ondo-pulse-points-warming",
  "ondo-selected-pulse-outer", "ondo-selected-pulse-outer-rising", "ondo-selected-pulse-outer-warming",
  "ondo-selected-pulse", "ondo-selected-pulse-rising", "ondo-selected-pulse-warming",
  "ondo-pulse-hit", "ondo-pulse-hit-rising", "ondo-pulse-hit-warming",
])

const SOURCE_ID = "MOIS_LOCALDATA_GENERAL_RESTAURANTS"
const SOURCE_DATE = CANONICAL_MAP_VENUES_COMPACT[0]?.sourceSnapshotAt.slice(0, 10) ?? "2026-08-19"
const CITY = {
  seoul: { center: [126.978, 37.5665] as [number, number], zoom: 10.1, label: { en: "Seoul", ko: "서울", ja: "ソウル" } },
  busan: { center: [129.0756, 35.1796] as [number, number], zoom: 10.05, label: { en: "Busan", ko: "부산", ja: "釜山" } },
  jeju: { center: [126.54, 33.38] as [number, number], zoom: 9.2, label: { en: "Jeju", ko: "제주", ja: "済州" } },
}

const JEJU_EDITORIAL_FALLBACK_IMAGES: Record<EditorialPlaceB["category"], string> = {
  "screen-location": "/editorial/japan-first-c18-jeju-screen-route.jpg",
  food: "/editorial/japan-first-c20-jeju-kpop-route.jpg",
  market: "/editorial/japan-first-c18-jeju-screen-route.jpg",
  "culture-shopping": "/editorial/japan-first-c20-jeju-kpop-route.jpg",
}

function editorialPlaceMoodImage(place: EditorialPlaceB) {
  const storyImage = place.storyIds
    .map((storyId) => JAPAN_FIRST_LAUNCH_CONTENT.find((story) => story.id === storyId)?.editorialMedia?.src)
    .find((source): source is string => Boolean(source))
  return storyImage ?? JEJU_EDITORIAL_FALLBACK_IMAGES[place.category]
}

const COPY = {
  en: {
    tagline: "Korea food & travel map",
    title: "Find your next stop in Korea.",
    body: "Food maps for Seoul and Busan, plus travel ideas across Jeju.",
    coverage: "Korea map · 3 regions",
    openMap: "Open map",
    source: "LOCALDATA source snapshot · Aug 19, 2026",
    sourceBoundary: "Listed in LOCALDATA at the source date. Check today’s hours, menu, prices and payment support with the place.",
    search: "Place, district or category",
    list: "List",
    map: "Map",
    back: "Korea map",
    records: "places",
    officialName: "Official Korean source name",
    categoryBasis: "Category normalized from the official business type",
    more: "Load 30 more",
    mapA11y: "The map is visual. Use plus, minus and arrow keys to move it, or open the List for keyboard-accessible directory results.",
    editorialMapA11y: "The Jeju map shows island places and travel stories. Open a pin to see the place, its source and save action.",
    mapUnavailable: "The map could not load. All 200 places remain available in the list.",
    mapLimited: "Map details unavailable",
    retryMap: "Retry map",
    offlineTitle: "Offline",
    offlineSource: "The place list is still available; map tiles may be unavailable.",
    locationUnavailable: "Your location was not used. Search or choose a place from the list.",
    locating: "Finding your location…",
    locationReady: "You’re here",
    locationDenied: "Enable location in browser settings, then try again.",
    locationUnsupported: "This browser cannot share a location. Search and the full place list still work.",
    locate: "My location",
    retryLocation: "Try my location again",
    locationDisclosure: "Location stays in this tab. OpenFreeMap receives map-area requests.",
    nearest: "nearest place",
    mapLoading: "Loading the map…",
    editorialMapLoading: "Loading the Jeju map…",
    noResultsTitle: "No places match",
    noResultsBody: "Clear the search and category to see every place in this city.",
    noResultsBodyLocked: "Clear the search to see every bar and pub in this city.",
    clearResults: "Clear search and category",
    clearSearch: "Clear search",
    mapKey: "Place temperature · place groups",
    mapKeyBody: "Outlined numbers group nearby places. Small dots are individual places.",
    mapKeyDetails: "How to read this map",
    mapCredits: "Map credits",
    pulseActive: "Place temperature · curated food signal",
    pulseGrowing: "Place temperature · coverage growing",
    pulseExplore: "Place temperature · limited signals",
    pulseSignals: "curated signals",
    pulseLocal: "Your Local Signal is included on this device",
    jejuStatus: "Island picks",
    jejuTruth: "Colour follows the density of verified editorial places — not live crowding or popularity.",
    jejuMapTruth: "Jeju map",
    officialSourceScope: "Seoul and Busan · LOCALDATA places",
    jejuSourceScope: "Jeju · VISITKOREA editorial places",
    editorialMapUnavailable: "The map could not load. Jeju place links and stories remain available.",
    aboutMap: "About this Korea map",
    mapScopeSummary: "Seoul · Busan · Jeju",
    methodology: "How place temperature works",
    filterLabel: "Food category",
    recentSaveFailed: "The place opened, but this device could not update Recently viewed.",
  },
  ko: {
    tagline: "한국 음식·여행 지도",
    title: "한국에서 다음 장소를 찾아보세요.",
    body: "서울·부산의 먹거리와 제주 여행 아이디어를 한 지도에서 둘러보세요.",
    coverage: "대한민국 지도 · 3개 지역",
    openMap: "지도 열기",
    source: "LOCALDATA 출처 스냅샷 · 2026. 8. 19.",
    sourceBoundary: "출처 기준일에 LOCALDATA에 등록된 장소입니다. 오늘의 영업시간·메뉴·가격·결제는 장소에 확인해 주세요.",
    search: "장소명, 지역 또는 업태",
    list: "목록",
    map: "지도",
    back: "대한민국 지도",
    records: "장소",
    officialName: "공식 출처 한글명",
    categoryBasis: "LOCALDATA 장소 유형을 바탕으로 정리한 분류",
    more: "30개 더 보기",
    mapA11y: "지도는 시각 정보입니다. 더하기, 빼기와 방향키로 움직이거나 키보드로 탐색할 수 있는 목록을 여세요.",
    editorialMapA11y: "제주 지도에는 섬의 장소와 여행 이야기가 표시됩니다. 핀을 열면 장소와 출처를 보고 저장할 수 있어요.",
    mapUnavailable: "지도를 불러오지 못했어요. 장소 200곳은 목록에서 계속 볼 수 있어요.",
    mapLimited: "지도 배경을 불러오지 못했어요",
    retryMap: "지도 다시 불러오기",
    offlineTitle: "오프라인",
    offlineSource: "장소 목록은 계속 볼 수 있지만 지도 타일은 표시되지 않을 수 있어요.",
    locationUnavailable: "현재 위치를 사용하지 않았어요. 검색하거나 목록에서 장소를 골라보세요.",
    locating: "현재 위치를 찾는 중…",
    locationReady: "현재 위치",
    locationDenied: "브라우저 설정에서 위치 권한을 켠 뒤 다시 시도하세요.",
    locationUnsupported: "이 브라우저에서는 위치를 공유할 수 없어요. 검색과 전체 장소 목록은 그대로 쓸 수 있어요.",
    locate: "내 위치",
    retryLocation: "내 위치 다시 시도",
    locationDisclosure: "위치는 이 탭에만 남습니다. OpenFreeMap은 지도 영역 요청을 받습니다.",
    nearest: "가장 가까운 장소",
    mapLoading: "지도를 불러오는 중…",
    editorialMapLoading: "제주 지도를 불러오는 중…",
    noResultsTitle: "일치하는 장소가 없어요",
    noResultsBody: "검색어와 분류를 초기화하면 이 도시의 모든 장소를 볼 수 있어요.",
    noResultsBodyLocked: "검색어를 지우면 이 도시의 주점을 모두 볼 수 있어요.",
    clearResults: "검색어와 업태 초기화",
    clearSearch: "검색어 지우기",
    mapKey: "장소 온도 · 장소 묶음",
    mapKeyBody: "테두리 숫자는 가까운 장소 묶음, 작은 점은 개별 장소를 뜻합니다.",
    mapKeyDetails: "지도 읽는 법",
    mapCredits: "지도 출처",
    pulseActive: "장소 온도 · 선별 식음료 신호",
    pulseGrowing: "장소 온도 · 신호 범위 확장 중",
    pulseExplore: "장소 온도 · 신호 부족",
    pulseSignals: "선별 신호",
    pulseLocal: "이 기기의 로컬 시그널이 포함됨",
    jejuStatus: "섬의 추천 장소",
    jejuTruth: "색의 강도는 확인된 편집 장소의 밀도를 따르며, 실시간 혼잡도나 인기 순위가 아닙니다.",
    jejuMapTruth: "제주 지도",
    officialSourceScope: "서울·부산 · LOCALDATA 장소",
    jejuSourceScope: "제주 · VISITKOREA 편집 장소",
    editorialMapUnavailable: "지도를 불러오지 못했어요. 제주 장소 링크와 이야기는 계속 볼 수 있어요.",
    aboutMap: "대한민국 지도 안내",
    mapScopeSummary: "서울 · 부산 · 제주",
    methodology: "장소 온도 알아보기",
    filterLabel: "음식 분류",
    recentSaveFailed: "장소는 열었지만 이 기기의 최근 본 목록에는 저장하지 못했어요.",
  },
  ja: {
    tagline: "韓国フード・旅行マップ",
    title: "韓国で次の場所を見つけよう。",
    body: "ソウル・釜山の食と済州の旅のアイデアを、ひとつの地図で探せます。",
    coverage: "韓国マップ・3地域",
    openMap: "地図を開く",
    source: "LOCALDATA出典スナップショット・2026年8月19日",
    sourceBoundary: "出典日時点でLOCALDATAに掲載された場所です。現在の営業時間、メニュー、価格、決済は店舗で確認してください。",
    search: "場所・エリア・業種を検索",
    list: "リスト",
    map: "地図",
    back: "韓国マップ",
    records: "場所",
    officialName: "韓国語の公式名称",
    categoryBasis: "LOCALDATAの場所タイプをもとに整理した分類",
    more: "さらに30件",
    mapA11y: "地図は視覚情報です。プラス、マイナス、矢印キーで動かすか、キーボードで使えるリストを開いてください。",
    editorialMapA11y: "済州の地図には島の場所と旅のストーリーを表示します。ピンを開くと場所、情報源、保存操作を確認できます。",
    mapUnavailable: "地図を読み込めませんでした。200か所はリストで引き続き確認できます。",
    mapLimited: "地図の背景を読み込めませんでした",
    retryMap: "地図を再読み込み",
    offlineTitle: "オフライン",
    offlineSource: "場所のリストは引き続き利用できますが、地図タイルを表示できない場合があります。",
    locationUnavailable: "現在地は使用しませんでした。検索するか、リストから場所を選んでください。",
    locating: "現在地を確認中…",
    locationReady: "現在地",
    locationDenied: "ブラウザ設定で位置情報を許可し、もう一度お試しください。",
    locationUnsupported: "このブラウザでは現在地を共有できません。検索と場所のリストは引き続き利用できます。",
    locate: "現在地",
    retryLocation: "現在地を再試行",
    locationDisclosure: "位置情報はこのタブ内にのみ残ります。OpenFreeMapには地図範囲のリクエストが送られます。",
    nearest: "最寄りの場所",
    mapLoading: "地図を読み込み中…",
    editorialMapLoading: "済州の地図を読み込み中…",
    noResultsTitle: "一致する場所がありません",
    noResultsBody: "検索語と分類を解除すると、この都市のすべての場所を確認できます。",
    noResultsBodyLocked: "検索語を解除すると、この都市の居酒屋・パブを確認できます。",
    clearResults: "検索語と業種を解除",
    clearSearch: "検索語を解除",
    mapKey: "スポットのにぎわい・場所グループ",
    mapKeyBody: "枠付きの数字は近くの場所のまとまり、小さな点は個別の場所です。",
    mapKeyDetails: "地図の見方",
    mapCredits: "地図クレジット",
    pulseActive: "スポットのにぎわい・選定した飲食シグナル",
    pulseGrowing: "スポットのにぎわい・シグナル範囲を拡大中",
    pulseExplore: "スポットのにぎわい・シグナル不足",
    pulseSignals: "キュレーションシグナル",
    pulseLocal: "この端末のローカルシグナルを含みます",
    jejuStatus: "島のおすすめ",
    jejuTruth: "色の強さは確認済み編集スポットの密度を示し、リアルタイムの混雑や人気順位ではありません。",
    jejuMapTruth: "済州マップ",
    officialSourceScope: "ソウル・釜山・LOCALDATA掲載場所",
    jejuSourceScope: "済州・VISITKOREAの編集スポット",
    editorialMapUnavailable: "地図を読み込めませんでした。済州の場所リンクとストーリーは引き続き確認できます。",
    aboutMap: "韓国マップについて",
    mapScopeSummary: "ソウル・釜山・済州",
    methodology: "にぎわいの見方",
    filterLabel: "飲食カテゴリー",
    recentSaveFailed: "場所は開きましたが、この端末の最近見た場所には保存できませんでした。",
  },
} satisfies Record<OndoBLocale, Record<string, string>>

const MAP_UI = {
  en: { atlas: "Korea overview map showing Seoul, Busan, and Jeju", clearSearch: "Clear search", mapRegion: "Korea food map", editorialRegion: "Jeju travel map", officialGroups: "Place groups", pulseRange: "Low → Peak", pulseLegend: "Place temperature level legend", pulsePlaces: "Places by temperature", mapAttribution: "Map attribution", shortList: "List view on a short screen", locationTab: "Location · this tab only", locationOff: "Location off · Search still works", locationUnavailable: "Location unavailable", freshness: "freshness", confidence: "confidence", directoryKind: "Explore", editorialKind: "Explore" },
  ko: { atlas: "서울·부산·제주를 표시한 대한민국 탐색 지도", clearSearch: "검색어 지우기", mapRegion: "한국 먹거리 지도", editorialRegion: "제주 여행 지도", officialGroups: "장소 묶음", pulseRange: "여유 → 피크", pulseLegend: "장소 온도 단계 범례", pulsePlaces: "장소별 온도", mapAttribution: "지도 출처", shortList: "좁은 화면에서 목록 보기 사용 중", locationTab: "위치 · 이 탭에서만", locationOff: "위치 꺼짐 · 검색은 계속 가능", locationUnavailable: "위치 미지원", freshness: "최신성", confidence: "신뢰도", directoryKind: "탐색", editorialKind: "탐색" },
  ja: { atlas: "ソウル・釜山・済州を示す韓国マップ", clearSearch: "検索語を消去", mapRegion: "韓国フードマップ", editorialRegion: "済州トラベルマップ", officialGroups: "場所のまとまり", pulseRange: "ゆったり → ピーク", pulseLegend: "スポットのにぎわいレベルの凡例", pulsePlaces: "スポット別のにぎわい", mapAttribution: "地図の出典", shortList: "高さの低い画面ではリスト表示", locationTab: "現在地・このタブ内のみ", locationOff: "位置情報オフ・検索は利用可能", locationUnavailable: "位置情報を利用できません", freshness: "更新状況", confidence: "確度", directoryKind: "探す", editorialKind: "探す" },
} satisfies Record<OndoBLocale, Record<string, string>>

const TEMPERATURE_NAME: Record<OndoBLocale, string> = {
  en: "Place temperature",
  ko: "장소 온도",
  ja: "スポットのにぎわい",
}

const TEMPERATURE_FRESHNESS: Record<PulseFreshnessB, Record<OndoBLocale, string>> = {
  "curated-snapshot": { en: "curated snapshot", ko: "선별 스냅샷", ja: "選定スナップショット" },
  growing: { en: "recently updated", ko: "최근 업데이트", ja: "最近更新" },
  limited: { en: "limited signals", ko: "신호 부족", ja: "シグナル不足" },
}

const TEMPERATURE_CONFIDENCE: Record<PulseConfidenceB, Record<OndoBLocale, string>> = {
  high: { en: "high", ko: "높음", ja: "高い" },
  medium: { en: "medium", ko: "보통", ja: "中程度" },
  low: { en: "low", ko: "낮음", ja: "低い" },
  limited: { en: "limited", ko: "신호 부족", ja: "限定的" },
}

const EDITORIAL_COVERAGE_RANGE: Record<OndoBLocale, string> = {
  en: "sparser → denser",
  ko: "분산 → 밀집",
  ja: "分散 → 密集",
}

const NEXT_LOCALE: Record<OndoBLocale, OndoBLocale> = { en: "ja", ja: "ko", ko: "en" }
const NEXT_LOCALE_LABEL: Record<OndoBLocale, string> = { en: "JA", ja: "KO", ko: "EN" }
const NEXT_LOCALE_ACCESSIBLE_LABEL: Record<OndoBLocale, string> = {
  en: "Switch to Japanese",
  ja: "韓国語に切り替える",
  ko: "영어로 전환",
}

const CATEGORY: Record<BDiscoveryCategory, { en: string; ko: string; ja: string; compact: Record<OndoBLocale, string>; short: string }> = {
  all: { en: "All", ko: "전체", ja: "すべて", compact: { en: "All", ko: "전체", ja: "すべて" }, short: "ALL" },
  korean: { en: "Korean", ko: "한식", ja: "韓国料理", compact: { en: "Korean", ko: "한식", ja: "韓国料理" }, short: "K" },
  casual: { en: "Quick service", ko: "분식·간편식", ja: "軽食・ファストフード", compact: { en: "Quick", ko: "분식", ja: "軽食" }, short: "Q" },
  japanese: { en: "Japanese", ko: "일식", ja: "日本料理", compact: { en: "Japanese", ko: "일식", ja: "日本料理" }, short: "J" },
  chinese: { en: "Chinese", ko: "중식", ja: "中華料理", compact: { en: "Chinese", ko: "중식", ja: "中華" }, short: "C" },
  global: { en: "Western & international", ko: "경양식·외국음식", ja: "洋食・各国料理", compact: { en: "Western", ko: "외국음식", ja: "洋食・各国" }, short: "G" },
  night: { en: "Pubs & cafés", ko: "주점·카페", ja: "パブ・カフェ", compact: { en: "Pubs & cafés", ko: "주점·카페", ja: "パブ・カフェ" }, short: "P" },
  specialty: { en: "Grills & specialty", ko: "구이·횟집·전문점", ja: "焼き物・専門店", compact: { en: "Grills", ko: "구이·횟집", ja: "焼き物・専門" }, short: "S" },
}

const AFTER19_NIGHT_CATEGORY: Record<OndoBLocale, string> = {
  en: "Bars & pubs",
  ko: "바·주점",
  ja: "バー・パブ",
}

const EDITORIAL_CATEGORY: Record<EditorialCategory, Record<OndoBLocale, string>> = {
  all: { en: "All", ko: "전체", ja: "すべて" },
  food: { en: "Food", ko: "먹거리", ja: "グルメ" },
  market: { en: "Markets", ko: "시장", ja: "市場" },
  "screen-location": { en: "Screen locations", ko: "촬영지", ja: "ロケ地" },
  "culture-shopping": { en: "Culture & shopping", ko: "문화·쇼핑", ja: "文化・買い物" },
}
const EDITORIAL_CATEGORY_OPTIONS: readonly EditorialCategory[] = ["all", "food", "market", "screen-location"]

const MAP_VENUES = Object.freeze([...CANONICAL_MAP_VENUES_COMPACT].sort((left, right) => (
  left.districtId.localeCompare(right.districtId, "ko") || left.name.ko.localeCompare(right.name.ko, "ko")
)))

const PULSE_RANK = Object.freeze({ limited: 0, low: 1, warming: 2, rising: 3, hot: 4, peak: 5 } as const)
const PULSE_LEVEL_EXPRESSION: ExpressionSpecification = [
  "match", ["get", "visualRank"],
  5, "#7A2048",
  4, "#C94832",
  3, "#E6843B",
  2, "#EBC463",
  1, "#EFE1B7",
  "#CFCAC0",
]
const EDITORIAL_COVERAGE_COLOR: ExpressionSpecification = [
  "match", ["get", "coverageIntensity"],
  "dense", "#9A2C4F",
  "clustered", "#E57A3A",
  "#D9BF73",
]
const OVERVIEW_SIGNAL_COLOR_LIGHT: ExpressionSpecification = [
  "match", ["get", "signal"],
  "active", "#722044",
  "growing", "#e77a32",
  "editorial", "#D9BF73",
  "#8a857e",
]
const OVERVIEW_SIGNAL_COLOR_DARK: ExpressionSpecification = [
  "match", ["get", "signal"],
  "active", "#d65b91",
  "growing", "#f09249",
  "editorial", "#F0A366",
  "#b8b5b1",
]
const TEMPERATURE_POINT_COLOR_EXPRESSION: ExpressionSpecification = [
  "case",
  ["==", ["get", "signalKind"], "verified-editorial"], EDITORIAL_COVERAGE_COLOR,
  PULSE_LEVEL_EXPRESSION,
]
const AFTER19_PULSE_LEVEL_EXPRESSION: ExpressionSpecification = [
  "match", ["get", "visualRank"],
  5, "#FF3FA4",
  4, "#FF604D",
  3, "#FF9A3D",
  2, "#FFD45A",
  1, "#E7F26D",
  "#8A8D98",
]
const PULSE_HEAT_COLOR: ExpressionSpecification = [
  "interpolate", ["linear"], ["heatmap-density"],
  0, "rgba(255,217,138,0)",
  0.16, "rgba(255,217,138,.24)",
  0.36, "rgba(255,155,85,.48)",
  0.6, "rgba(239,89,71,.64)",
  0.8, "rgba(206,73,58,.76)",
  1, "rgba(122,32,72,.88)",
]
const EDITORIAL_COVERAGE_HEAT_COLOR: ExpressionSpecification = [
  "interpolate", ["linear"], ["heatmap-density"],
  0, "rgba(217,191,115,0)",
  0.2, "rgba(217,191,115,.2)",
  0.45, "rgba(229,122,58,.38)",
  0.7, "rgba(201,72,50,.52)",
  1, "rgba(154,44,79,.7)",
]
const AFTER19_HEAT_COLOR: ExpressionSpecification = [
  "interpolate", ["linear"], ["heatmap-density"],
  0, "rgba(242,184,75,0)",
  0.14, "rgba(242,184,75,.24)",
  0.38, "rgba(255,112,67,.54)",
  0.64, "rgba(255,79,154,.76)",
  0.84, "rgba(255,79,154,.9)",
  1, "rgba(255,143,199,.98)",
]
const AFTER19_ELIGIBLE_FILTER: ExpressionSpecification = ["==", ["get", "after19Eligible"], true]
const AFTER19_UNCURATED_ELIGIBLE_FILTER: ExpressionSpecification = [
  "all",
  AFTER19_ELIGIBLE_FILTER,
  ["==", ["get", "curatedSignal"], false],
]

const SELECTED_CAPSULE_IMAGE_ID = "ondo-selected-pulse-capsule"

function selectedCapsuleImage(dark = false) {
  const width = 64
  const height = 48
  const radius = 20
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const nearestX = Math.max(radius, Math.min(width - radius - 1, x))
      const nearestY = Math.max(radius, Math.min(height - radius - 1, y))
      const distance = Math.hypot(x - nearestX, y - nearestY)
      if (distance > radius) continue
      const offset = (y * width + x) * 4
      const edge = distance > radius - 2 || x < 2 || x >= width - 2 || y < 2 || y >= height - 2
      data[offset] = edge ? (dark ? 76 : 216) : (dark ? 30 : 255)
      data[offset + 1] = edge ? (dark ? 80 : 220) : (dark ? 33 : 255)
      data[offset + 2] = edge ? (dark ? 86 : 222) : (dark ? 38 : 255)
      data[offset + 3] = edge ? 230 : 248
    }
  }
  return { width, height, data }
}

const KOREA_ATLAS_CITY_COORDINATES = {
  seoul: { latitude: 37.5665, longitude: 126.978 },
  busan: { latitude: 35.1796, longitude: 129.0756 },
  jeju: { latitude: 33.4996, longitude: 126.5312 },
} as const satisfies Record<CityId, { latitude: number; longitude: number }>

function fitNationOverview(map: MapLibreMap, container: HTMLElement, duration = 0) {
  const { width, height } = container.getBoundingClientRect()
  const dockSpace = parseFloat(getComputedStyle(container).getPropertyValue("--ondo-map-dock-space")) || 0
  map.fitBounds([[124.4, 32.2], [131.6, 39.4]], {
    padding: width >= 801
      ? { top: 82, right: 54, bottom: 58, left: Math.round(width * .38) }
      : { top: Math.min(142, Math.round((height - dockSpace) * .2)), right: 28, bottom: 70 + dockSpace, left: 28 },
    maxZoom: 6.2,
    pitch: 0,
    bearing: 0,
    duration,
  })
}

function resultCount(count: number, locale: OndoBLocale) {
  if (locale === "ko") return `장소 ${count}곳`
  if (locale === "ja") return `${count}か所`
  return `${count} ${count === 1 ? "place" : "places"}`
}

const PERSONALIZATION_COPY = {
  en: { empty: "Set your tastes", title: "Your map", edit: "Edit discovery choices", boundary: "All places remain visible." },
  ko: { empty: "취향 설정", title: "나의 지도", edit: "탐색 선택 편집", boundary: "모든 장소는 그대로 표시됩니다." },
  ja: { empty: "好みを設定", title: "自分のマップ", edit: "探索設定を編集", boundary: "すべての場所はそのまま表示されます。" },
} satisfies Record<OndoBLocale, Record<string, string>>

const PERSPECTIVE_COPY = {
  en: { name: "Tilt map", flat: "Return to a flat map", tilted: "View a gently tilted map" },
  ko: { name: "지도 기울기", flat: "평면 지도로 돌아가기", tilted: "지도를 살짝 기울여 보기" },
  ja: { name: "地図の傾き", flat: "平面の地図に戻す", tilted: "地図を少し傾ける" },
} as const

const PERSONA_MAP_CONTEXT: Record<DiscoveryIntent, Record<OndoBLocale, string>> = {
  travelling: { en: "Near me", ko: "지금 가까운 곳", ja: "今いる場所の近く" },
  preparing: { en: "Plan ahead", ko: "여행 전에 둘러보기", ja: "旅行前に探す" },
  local_contributor: { en: "Local notes", ko: "로컬 메모", ja: "ローカルメモ" },
  short_trip: { en: "Plan this trip", ko: "이번 여행", ja: "今回の旅" },
  nearby: { en: "Near me", ko: "지금 가까운 곳", ja: "今いる場所の近く" },
  living: { en: "Everyday places", ko: "일상 속 장소", ja: "暮らしの場所" },
}

function PersonalizationLens({ locale, persona, preferences, mapInteractive, onEdit }: {
  locale: OndoBLocale
  persona: DiscoveryIntent | null
  preferences: readonly OndoBDiscoveryPreference[]
  mapInteractive: boolean
  onEdit(): void
}) {
  const copy = PERSONALIZATION_COPY[locale]
  const presentedPreferences = classifyBDiscoveryPreferencePresentation(preferences)
  const visiblePreferenceIds = [...presentedPreferences.effective, ...presentedPreferences.dietaryUnknown]
  const labels = visiblePreferenceIds.map((preferenceId) => {
    const label = ONDO_B_DISCOVERY_PREFERENCES.find(({ id }) => id === preferenceId)?.label[locale]
    return label && presentedPreferences.dietaryUnknown.includes(preferenceId) ? `${label} ?` : label
  }).filter((label): label is string => Boolean(label))
  const visibleLabels = labels.slice(0, 2)
  const remainder = Math.max(0, labels.length - visibleLabels.length)
  const summary = visibleLabels.length
    ? `${visibleLabels.join(" · ")}${remainder ? locale === "ko" ? ` 외 ${remainder}` : locale === "ja" ? ` ほか${remainder}` : ` +${remainder}` : ""}`
    : persona
      ? PERSONA_MAP_CONTEXT[persona][locale]
      : copy.empty
  const accessibleSummary = labels.length ? labels.join(", ") : summary

  return (
    <div
      className={styles.preferenceSummary}
      data-testid="ondo-b-preference-summary"
      data-persona={persona ?? "none"}
      data-preference-count={visiblePreferenceIds.length}
      data-preference-ids={visiblePreferenceIds.join(",") || "none"}
      data-suppressed-preference-count={presentedPreferences.unsupportedLegacy.length}
      aria-hidden={!mapInteractive ? true : undefined}
      inert={!mapInteractive ? true : undefined}
    >
      <button
        type="button"
        data-testid="ondo-b-personalization-edit"
        data-preference-count={visiblePreferenceIds.length}
        aria-label={labels.length || persona
          ? `${copy.title}: ${accessibleSummary}. ${copy.edit}. ${copy.boundary}`
          : `${copy.empty}. ${copy.edit}. ${copy.boundary}`}
        onClick={onEdit}
      >
        <i className={styles.preferenceIcon} aria-hidden="true"><SlidersHorizontal size={19} /></i>
        <span className={styles.srOnly} data-testid="ondo-b-personalization-summary"><b>{copy.title}</b><small>{summary}</small></span>
      </button>
    </div>
  )
}

type PersistentMapController = {
  focusCity(city: CityId, onComplete: () => void): boolean
}

type PendingCityIntent = {
  city: CityId
  keyboardModality: boolean
  requestedAt: number
  historyMode?: "enter" | "replace"
}

function cityPulseStatus(cityId: CityId, locale: OndoBLocale) {
  if (cityId === "jeju") return `${TEMPERATURE_NAME[locale]} · ${JEJU_EDITORIAL_COVERAGE_LABEL[locale]} · ${JEJU_EDITORIAL_UNSCORED_LABEL[locale]}`
  return PULSE_CITY_STATUS[cityId] === "active" ? COPY[locale].pulseActive : COPY[locale].pulseGrowing
}

function distanceInMeters(from: UserLocation, venue: Pick<CanonicalMapVenue, "longitude" | "latitude">) {
  const radians = (degrees: number) => degrees * Math.PI / 180
  const earthRadius = 6_371_000
  const latitudeDelta = radians(venue.latitude - from.latitude)
  const longitudeDelta = radians(venue.longitude - from.longitude)
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(from.latitude)) * Math.cos(radians(venue.latitude)) * Math.sin(longitudeDelta / 2) ** 2
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function displayDistance(distance: number, locale: OndoBLocale) {
  if (distance < 1_000) return locale === "ko" ? `${Math.max(10, Math.round(distance / 10) * 10)}m 거리` : locale === "ja" ? `${Math.max(10, Math.round(distance / 10) * 10)}m先` : `${Math.max(10, Math.round(distance / 10) * 10)} m away`
  const kilometers = (distance / 1_000).toFixed(distance < 10_000 ? 1 : 0)
  return locale === "ko" ? `${kilometers}km 거리` : locale === "ja" ? `${kilometers}km先` : `${kilometers} km away`
}

type MapMotionOptions = JumpToOptions & Pick<EaseToOptions, "easing">

function moveMap(map: MapLibreMap, options: MapMotionOptions) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    map.jumpTo(options)
    return
  }
  map.easeTo({ ...options, duration: CITY_FOCUS_DURATION_MS })
}

function cameraSnapshot(map: MapLibreMap): BDiscoveryCamera {
  const center = map.getCenter()
  return {
    longitude: center.lng,
    latitude: center.lat,
    zoom: map.getZoom(),
    bearing: map.getBearing(),
    pitch: map.getPitch(),
  }
}

function NationDirectory({ locale, persona, preferences, mapState, sampleMotion, onEditPreferences, onSelect, controllerRef, overlayRef }: {
  locale: OndoBLocale
  persona: DiscoveryIntent | null
  preferences: readonly OndoBDiscoveryPreference[]
  mapState: "idle" | "loading" | "ready" | "error"
  sampleMotion: boolean
  onEditPreferences(): void
  onSelect(city: CityId, keyboardModality: boolean, requestedAt: number): void
  controllerRef: MutableRefObject<PersistentMapController | null>
  overlayRef: RefObject<HTMLDivElement | null>
}) {
  const copy = COPY[locale]
  const [departingCity, setDepartingCity] = useState<CityId | null>(null)
  const { state: { tab: activeAtlasTab } } = useOndoB()
  const [documentVisible, setDocumentVisible] = useState(true)
  const [atlasInView, setAtlasInView] = useState(false)
  const [reducedAtlasMotion, setReducedAtlasMotion] = useState(true)
  const [atlasMotionPaused, setAtlasMotionPaused] = useState(false)
  const atlasElementRef = useRef<HTMLDivElement>(null)
  const countryName = locale === "en" ? "Korea" : locale === "ko" ? "한국" : "韓国"
  const countryIndex = copy.title.indexOf(countryName)
  const selectionSequenceRef = useRef(0)
  useEffect(() => () => {
    selectionSequenceRef.current += 1
  }, [])
  useEffect(() => {
    const syncVisibility = () => setDocumentVisible(document.visibilityState === "visible")
    syncVisibility()
    document.addEventListener("visibilitychange", syncVisibility)
    return () => document.removeEventListener("visibilitychange", syncVisibility)
  }, [])
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)")
    const syncMotion = () => setReducedAtlasMotion(preference.matches)
    syncMotion()
    preference.addEventListener("change", syncMotion)
    const atlas = atlasElementRef.current
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([entry]) => setAtlasInView(entry.isIntersecting && entry.intersectionRatio >= .1), { threshold: .1 })
    if (atlas && observer) observer.observe(atlas)
    else setAtlasInView(true)
    return () => {
      preference.removeEventListener("change", syncMotion)
      observer?.disconnect()
    }
  }, [])
  const atlasMotionPlaying = sampleMotion && mapState === "ready" && documentVisible && atlasInView
    && activeAtlasTab === "ondo" && !reducedAtlasMotion && !atlasMotionPaused && departingCity === null
  const atlasMotionLabel = atlasMotionPaused
    ? locale === "ko" ? "지도 움직임 재생" : locale === "ja" ? "地図のアニメーションを再生" : "Play map ambience"
    : locale === "ko" ? "지도 움직임 일시정지" : locale === "ja" ? "地図のアニメーションを一時停止" : "Pause map ambience"
  const cityNodes: Array<{
    id: CityId
    signalState: "active" | "growing" | "limited"
    regionRole: "official-directory" | "editorial-collection"
    officialCount?: number
    directorySource?: string
    editorialCount?: number
    truthKind?: "editorial-region"
    accessibleTruth: string
    labelOffset: { x: number; y: number }
    coordinates: { latitude: number; longitude: number }
  }> = [
    {
      id: "seoul",
      signalState: "active",
      regionRole: "official-directory",
      officialCount: 200,
      directorySource: SOURCE_ID,
      accessibleTruth: cityPulseStatus("seoul", locale),
      labelOffset: { x: -72, y: -18 },
      coordinates: KOREA_ATLAS_CITY_COORDINATES.seoul,
    },
    {
      id: "busan",
      signalState: "growing",
      regionRole: "official-directory",
      officialCount: 200,
      directorySource: SOURCE_ID,
      accessibleTruth: cityPulseStatus("busan", locale),
      labelOffset: { x: 28, y: -18 },
      coordinates: KOREA_ATLAS_CITY_COORDINATES.busan,
    },
    {
      id: "jeju",
      signalState: JEJU_EDITORIAL_TEMPERATURE.level,
      regionRole: "editorial-collection",
      editorialCount: JEJU_EDITORIAL_PLACES.length,
      truthKind: "editorial-region",
      accessibleTruth: cityPulseStatus("jeju", locale),
      labelOffset: { x: 28, y: -18 },
      coordinates: KOREA_ATLAS_CITY_COORDINATES.jeju,
    },
  ]
  return (
    <section
      className={styles.nation}
      data-testid="ondo-b-nation"
      aria-busy={mapState === "idle" || mapState === "loading" ? true : undefined}
    >
      <div
        ref={atlasElementRef}
        className={`${styles.dotMap} ${styles.koreaAtlas}`}
        data-testid="ondo-b-korea-atlas"
        data-visual-object="living-atlas"
        data-map-presentation={mapState === "error" ? "fallback" : mapState === "ready" ? "ready" : "loading"}
        data-thermal-intro={sampleMotion && mapState === "ready" ? "sample" : "still"}
        data-thermal-intro-paused={!documentVisible || departingCity !== null}
        data-atlas-motion={atlasMotionPlaying ? "playing" : "paused"}
        data-atlas-reduced-motion={reducedAtlasMotion}
        data-departing-city={departingCity ?? undefined}
      >
        <div className={styles.nationIntro}>
          <h1>{copy.title.slice(0, countryIndex)}<span className={styles.nationCountry}>{countryName}</span>{copy.title.slice(countryIndex + countryName.length)}</h1>
        </div>
        <div ref={overlayRef} className={styles.atlasPlot} data-testid="ondo-b-atlas-plot">
          {cityNodes.map((cityNode) => (
            <button
              key={cityNode.id}
              type="button"
              className={styles.cityNode}
              data-city={cityNode.id}
              data-region-role={cityNode.regionRole}
              data-signal-state={cityNode.signalState}
              data-label-side={cityNode.labelOffset.x < 0 ? "left" : "right"}
              data-temperature-score={cityNode.id === "jeju" ? "none" : undefined}
              data-official-count={cityNode.officialCount}
              data-directory-source={cityNode.directorySource}
              data-editorial-count={cityNode.editorialCount}
              data-editorial-candidate-count={cityNode.id === "jeju" ? JEJU_EDITORIAL_SEEDS.length - JEJU_EDITORIAL_PLACES.length : undefined}
              data-truth-kind={cityNode.truthKind}
              data-atlas-pin="true"
              data-departing={departingCity === cityNode.id ? "true" : undefined}
              data-atlas-latitude={cityNode.coordinates.latitude}
              data-atlas-longitude={cityNode.coordinates.longitude}
              onClick={(event) => {
                const keyboardModality = event.detail === 0
                const requestedAt = performance.now()
                const sequence = selectionSequenceRef.current + 1
                selectionSequenceRef.current = sequence
                setDepartingCity(cityNode.id)
                // Coalesce multiple programmatic/same-turn intents, but do not
                // defer the winning camera start to the next animation frame.
                // flushSync commits the city shell in this turn; its layout
                // effect starts the MapLibre camera before the next paint.
                queueMicrotask(() => {
                  if (selectionSequenceRef.current !== sequence) return
                  flushSync(() => {
                    const started = controllerRef.current?.focusCity(cityNode.id, () => onSelect(cityNode.id, keyboardModality, requestedAt)) ?? false
                    if (!started) onSelect(cityNode.id, keyboardModality, requestedAt)
                  })
                })
              }}
              aria-label={`${CITY[cityNode.id].label[locale]} · ${cityNode.accessibleTruth} · ${copy.openMap}`}
            >
              <i aria-hidden="true"><b className={styles.atlasSignalRipple} /></i>
              <span>
                <strong>{CITY[cityNode.id].label[locale]}</strong>
              </span>
            </button>
          ))}
        </div>
        {sampleMotion && mapState === "ready" && !reducedAtlasMotion ? <button
          type="button"
          className={styles.atlasMotionButton}
          data-testid="ondo-b-atlas-motion"
          aria-label={atlasMotionLabel}
          title={atlasMotionLabel}
          aria-pressed={!atlasMotionPaused}
          disabled={departingCity !== null}
          onClick={() => setAtlasMotionPaused(paused => !paused)}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            {atlasMotionPaused ? <path d="M5 3.5 12 8l-7 4.5Z" fill="currentColor" /> : <path d="M5.5 4v8M10.5 4v8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
          </svg>
          <span>{locale === "ko" ? "지도 움직임" : locale === "ja" ? "地図の動き" : "Map ambience"}</span>
        </button> : null}
        <PersonalizationLens
          locale={locale}
          persona={persona}
          preferences={preferences}
          mapInteractive={mapState === "ready" && departingCity === null}
          onEdit={onEditPreferences}
        />
      </div>
    </section>
  )
}

type PersonalizedVenueRow = Readonly<{
  venue: CanonicalMapVenue
  matchCount: number
  dietaryUnknown: boolean
}>

function personalizedCanonicalVenueRows(
  venues: readonly CanonicalMapVenue[],
  localPulseEvidenceByVenue: Record<string, PulseLocalEvidenceB>,
  persona: OndoBPersona | null,
  preferences: readonly OndoBDiscoveryPreference[],
): readonly PersonalizedVenueRow[] {
  // Preserve the existing temperature/source order as the tie-breaker. Taste
  // choices add a keyline and presentation order only; they never rewrite the
  // place, its temperature, source class, or eligibility.
  const baseline = venues.map((venue, index) => ({
    venue,
    index,
    pulse: pulseForVenue(venue.id, localPulseEvidenceByVenue[venue.id] ?? null),
  })).sort((left, right) => {
    if (left.pulse.score != null && right.pulse.score != null) return right.pulse.score - left.pulse.score
    if (left.pulse.score != null) return -1
    if (right.pulse.score != null) return 1
    return left.index - right.index
  })
  if (preferences.length === 0) {
    return baseline.map(({ venue }) => ({ venue, matchCount: 0, dietaryUnknown: false }))
  }
  return orderBCanonicalDiscoveryPlaces(baseline.map(({ venue }) => venue), {
    ...(persona ? { intent: persona } : {}),
    preferences,
  }).map(({ place, matchCount, dietaryUnknown }) => ({
    venue: place,
    matchCount,
    dietaryUnknown,
  }))
}

function toFeatureCollection(
  venues: readonly CanonicalMapVenue[],
  localPulseEvidenceByVenue: Record<string, PulseLocalEvidenceB> = {},
  selectedVenueId: string | null = null,
  personalMatchCountByVenue: Readonly<Record<string, number>> = {},
): GeoJSON.FeatureCollection<GeoJSON.Point, { id: string; name: string; category: VenuePrimaryCategory; curatedSignal: boolean; after19Eligible: boolean; selected: boolean; personalMatchCount: number; personalKeyline: boolean }> {
  return {
    type: "FeatureCollection",
    features: venues.map((venue) => {
      const pulse = pulseForVenue(venue.id, localPulseEvidenceByVenue[venue.id] ?? null)
      return {
        type: "Feature",
        id: venue.id,
        geometry: { type: "Point", coordinates: [venue.longitude, venue.latitude] },
        properties: {
          id: venue.id,
          name: venue.name.ko,
          category: venue.primaryCategory,
          curatedSignal: pulse.score != null,
          after19Eligible: venue.after19PresentationEligible,
          selected: venue.id === selectedVenueId,
          personalMatchCount: personalMatchCountByVenue[venue.id] ?? 0,
          personalKeyline: (personalMatchCountByVenue[venue.id] ?? 0) > 0,
        },
      }
    }),
  }
}

type TemperatureFeatureProperties = {
  id: string
  entryKind: "venue" | "editorial"
  pulseLevel: string
  pulseRank: number
  layoutRank: number
  visualRank: number
  heatWeight: number
  pulseScore: number | null
  mapAnchor: boolean
  selectedMarkerLabel: string
  selected: boolean
  signalKind: "curated-place" | "verified-editorial"
  coverageIntensity: "not-applicable" | JejuEditorialCoverageIntensityB
  after19Eligible: boolean
}

const EDITORIAL_COVERAGE_VISUAL_RANK: Readonly<Record<JejuEditorialCoverageIntensityB, number>> = Object.freeze({
  sparse: 3,
  clustered: 4,
  dense: 5,
})

function editorialCoverageVisualRank(place: EditorialPlaceB) {
  return EDITORIAL_COVERAGE_VISUAL_RANK[jejuEditorialCoverageIntensity(place)]
}

function toTemperatureFeatureCollection(
  city: CityId,
  venues: readonly CanonicalMapVenue[],
  localPulseEvidenceByVenue: Record<string, PulseLocalEvidenceB> = {},
  locale: OndoBLocale,
  selectedVenueId: string | null = null,
  selectedEditorialPlaceId: string | null = null,
  editorialPlaces: readonly EditorialPlaceB[] = JEJU_EDITORIAL_PLACES,
): GeoJSON.FeatureCollection<GeoJSON.Point, TemperatureFeatureProperties> {
  if (city === "jeju") {
    return {
      type: "FeatureCollection",
      features: editorialPlaces.map((place) => {
        const coverageIntensity = jejuEditorialCoverageIntensity(place)
        const coverageRank = editorialCoverageVisualRank(place)
        return {
          type: "Feature" as const,
          id: place.id,
          geometry: { type: "Point" as const, coordinates: [place.location.longitude, place.location.latitude] },
          properties: {
            id: place.id,
            entryKind: "editorial" as const,
            pulseLevel: JEJU_EDITORIAL_TEMPERATURE.level,
            pulseRank: PULSE_RANK[JEJU_EDITORIAL_TEMPERATURE.level],
            layoutRank: PULSE_RANK[JEJU_EDITORIAL_TEMPERATURE.level],
            // Jeju reuses the shared field/halo/core and warm color grammar;
            // intensity varies only with verified-place coverage. It has no
            // numeric score and never claims live traffic or popularity.
            visualRank: coverageRank,
            heatWeight: Math.max(0.72, coverageRank / EDITORIAL_COVERAGE_VISUAL_RANK.dense),
            pulseScore: null,
            mapAnchor: true,
            selectedMarkerLabel: place.name[locale],
            selected: place.id === selectedEditorialPlaceId,
            signalKind: "verified-editorial" as const,
            coverageIntensity,
            after19Eligible: false,
          },
        }
      }),
    }
  }
  const rows = venues.flatMap((venue) => {
    const pulse = pulseForVenue(venue.id, localPulseEvidenceByVenue[venue.id] ?? null)
    return pulse.score == null && venue.id !== selectedVenueId ? [] : [{ venue, pulse }]
  })
  const mapAnchorIds = new Set([...rows]
    .filter(({ pulse }) => pulse.score != null)
    .sort((left, right) => (right.pulse.score ?? 0) - (left.pulse.score ?? 0) || left.venue.id.localeCompare(right.venue.id))
    .slice(0, 8)
    .map(({ venue }) => venue.id))
  return {
    type: "FeatureCollection",
    features: rows.map(({ venue, pulse }) => ({
        type: "Feature" as const,
        id: venue.id,
        geometry: { type: "Point" as const, coordinates: [venue.longitude, venue.latitude] },
        properties: {
          id: venue.id,
          entryKind: "venue" as const,
          pulseLevel: pulse.level,
          pulseRank: PULSE_RANK[pulse.level],
          layoutRank: PULSE_RANK[pulse.level],
          visualRank: PULSE_RANK[pulse.level],
          heatWeight: Math.max(0, PULSE_RANK[pulse.level] / PULSE_RANK.peak),
          pulseScore: pulse.score,
          mapAnchor: mapAnchorIds.has(venue.id) || venue.id === selectedVenueId,
          selectedMarkerLabel: venueDisplayName(venue.name.ko, locale),
          selected: venue.id === selectedVenueId,
          signalKind: "curated-place" as const,
          coverageIntensity: "not-applicable" as const,
          after19Eligible: venue.after19PresentationEligible,
        },
      })),
  }
}

function toUserLocationFeatureCollection(location: UserLocation | null): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: "FeatureCollection",
    features: location ? [{ type: "Feature", geometry: { type: "Point", coordinates: [location.longitude, location.latitude] }, properties: {} }] : [],
  }
}

function overviewCityFeatureCollection(): GeoJSON.FeatureCollection<GeoJSON.Point, { id: CityId; signal: "active" | "growing" | "editorial" }> {
  return {
    type: "FeatureCollection",
    features: (["seoul", "busan", "jeju"] as const).map((id) => ({
      type: "Feature",
      id,
      geometry: { type: "Point", coordinates: [KOREA_ATLAS_CITY_COORDINATES[id].longitude, KOREA_ATLAS_CITY_COORDINATES[id].latitude] },
      properties: { id, signal: id === "seoul" ? "active" : id === "busan" ? "growing" : "editorial" },
    })),
  }
}

function overviewRouteFeatureCollection(): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  return {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [KOREA_ATLAS_CITY_COORDINATES.seoul.longitude, KOREA_ATLAS_CITY_COORDINATES.seoul.latitude],
          [128.05, 36.65],
          [KOREA_ATLAS_CITY_COORDINATES.busan.longitude, KOREA_ATLAS_CITY_COORDINATES.busan.latitude],
          [127.82, 34.28],
          [KOREA_ATLAS_CITY_COORDINATES.jeju.longitude, KOREA_ATLAS_CITY_COORDINATES.jeju.latitude],
        ],
      },
      properties: {},
    }],
  }
}

function koreaLandFeatureCollection(): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  return {
    type: "FeatureCollection",
    features: KOREA_OUTLINE_COORDINATES.map((coordinates) => ({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: coordinates.map((ring) => ring.map(([longitude, latitude]) => [longitude, latitude])) },
      properties: {},
    })),
  }
}

function collectionFilterSignature(city: string | undefined | null, query: string, category: string, editorialCategory: string, balance: boolean, collection: DiscoveryCollectionIdB | null, after19: boolean) {
  const base = `${city ?? "nation"}:${query.trim()}:${city === "jeju" ? editorialCategory : category}:${balance}`
  return collection ? `${base}:${collection}:${after19}` : base
}

function focusCollectionPlaces(map: MapLibreMap, places: readonly { longitude: number; latitude: number }[]) {
  if (!places.length) return
  // Collections frame several selectable photo pins on a flat map. The city
  // overview may retain asymmetric padding and tilt; both distort a bounds fit.
  map.stop()
  map.jumpTo({ pitch: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 } })
  const node = map.getContainer()
  const bounds = node.getBoundingClientRect()
  const shell = node.parentElement
  const header = shell?.querySelector('[data-testid="ondo-b-city-header"]')?.getBoundingClientRect()
  const tray = shell?.querySelector('[data-testid="map-discovery-results"]')?.getBoundingClientRect()
  const sidePanel = tray && tray.width < bounds.width * .55 && bounds.width >= 600
  const chrome = shell?.querySelector('[data-testid="ondo-b-map-chrome"]')?.getBoundingClientRect()
  const top = Math.max(80, (header?.bottom ?? bounds.top + 120) - bounds.top + 35)
  const bottom = sidePanel ? Math.max(76, bounds.bottom - (chrome?.top ?? bounds.bottom - 76) + 35) : tray ? Math.max(90, bounds.bottom - tray.top + 35) : 120
  const camera = map.cameraForBounds([
    [Math.min(...places.map(p => p.longitude)), Math.min(...places.map(p => p.latitude))],
    [Math.max(...places.map(p => p.longitude)), Math.max(...places.map(p => p.latitude))],
  ], { padding: { top, bottom: Math.min(bottom, Math.max(60, bounds.height - top - 24)), left: sidePanel ? tray.right - bounds.left + 45 : 54, right: 54 }, maxZoom: places.length === 1 ? 14.2 : 13 })
  // cameraForBounds incorporates the panel inset into the center. Keep runtime
  // padding zero so the app's existing camera history restores exact pixels.
  if (camera) {
    map.jumpTo({ ...camera, pitch: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 } })
    const entry = readBDiscoveryHistory()
    if (entry?.level === "city" && entry.collection) replaceBDiscoveryCityContext({ ...entry, camera: cameraSnapshot(map) })
  }
}

function focusFilteredVenues(map: MapLibreMap, venues: readonly { longitude: number; latitude: number }[]) {
  if (venues.length === 0) return
  if (venues.length === 1) {
    map.jumpTo({ center: [venues[0].longitude, venues[0].latitude], zoom: 15 })
    return
  }
  const mapContainer = map.getContainer()
  const bounds = mapContainer.getBoundingClientRect()
  const dockSpace = parseFloat(getComputedStyle(mapContainer).getPropertyValue("--ondo-map-dock-space")) || 0
  const container = { width: bounds.width, height: bounds.height - dockSpace }
  const shortLandscape = container.height <= 500 && container.width > container.height
  const horizontalPadding = Math.round(Math.max(24, Math.min(72, container.width * 0.08)))
  const topPadding = shortLandscape
    ? Math.round(Math.max(144, Math.min(168, container.height * 0.4)))
    : Math.round(Math.max(150, Math.min(220, container.height * 0.3)))
  const bottomPadding = shortLandscape
    ? Math.round(Math.max(52, Math.min(76, container.height * 0.17)))
    : Math.round(Math.max(104, Math.min(160, container.height * 0.22)))
  const longitudes = venues.map((venue) => venue.longitude)
  const latitudes = venues.map((venue) => venue.latitude)
  map.fitBounds([
    [Math.min(...longitudes), Math.min(...latitudes)],
    [Math.max(...longitudes), Math.max(...latitudes)],
  ], {
    duration: 0,
    maxZoom: 14.5,
    padding: { top: topPadding, right: horizontalPadding, bottom: bottomPadding + dockSpace, left: horizontalPadding },
  })
}

function cityOverviewBounds(
  city: CityId,
  venues: readonly CanonicalMapVenue[],
  editorialPlaces: readonly EditorialPlaceB[],
  sample = false,
) {
  // Frame the illustrated activity, not remote directory outliers. This is a
  // camera choice only: every directory place remains searchable/pannable.
  const illustrated = sample && city !== "jeju" ? venues.filter((venue) => pulseForVenue(venue.id).score != null) : []
  const points = [
    ...(illustrated.length > 1 ? illustrated : venues).map((venue) => [venue.longitude, venue.latitude] as const),
    ...RESEARCHED_FOOD_B.filter(place => place.city === city).map(place => [place.longitude, place.latitude] as const),
    ...(city === "jeju"
      ? editorialPlaces.map((place) => [place.location.longitude, place.location.latitude] as const)
      : []),
  ]
  if (points.length === 0) points.push(CITY[city].center)
  const longitudes = points.map(([longitude]) => longitude)
  const latitudes = points.map(([, latitude]) => latitude)
  return [
    [Math.min(...longitudes), Math.min(...latitudes)],
    [Math.max(...longitudes), Math.max(...latitudes)],
  ] as [[number, number], [number, number]]
}

function cityOverviewPadding(root: HTMLElement) {
  const rootBox = root.getBoundingClientRect()
  const dockSpace = parseFloat(getComputedStyle(root).getPropertyValue("--ondo-map-dock-space")) || 0
  const headerBox = root.querySelector<HTMLElement>("[data-testid='ondo-b-city-header']")?.getBoundingClientRect()
  const locationBox = root.querySelector<HTMLElement>("[data-testid='ondo-b-location-message']")?.getBoundingClientRect()
  const keyBox = root.querySelector<HTMLElement>("[data-testid='ondo-b-map-key']")?.getBoundingClientRect()
  const compactLandscape = rootBox.width >= 600 && rootBox.height <= 500
  // The largest temperature aura is 34px. A 52px horizontal inset keeps the
  // complete signal (and its tap target) inside narrow portrait viewports.
  const horizontal = 52
  return {
    top: Math.ceil(Math.max(headerBox?.bottom ?? rootBox.top, locationBox?.bottom ?? rootBox.top) - rootBox.top + 26),
    right: horizontal,
    bottom: Math.ceil(rootBox.bottom - (keyBox?.top ?? rootBox.bottom) + (compactLandscape ? 48 : 26) + dockSpace),
    left: horizontal,
  }
}

function VenueList({ venues, locale, localPulseEvidenceByVenue, personalMatchCountByVenue, dietaryUnknownByVenue, selectedVenueId, visibleCount, nightSubsetActive = false, onClear, onMore, onSelect }: {
  venues: readonly CanonicalMapVenue[]
  locale: OndoBLocale
  localPulseEvidenceByVenue: Record<string, PulseLocalEvidenceB>
  personalMatchCountByVenue: Readonly<Record<string, number>>
  dietaryUnknownByVenue: Readonly<Record<string, boolean>>
  selectedVenueId: string | null
  visibleCount: number
  nightSubsetActive?: boolean
  onClear(): void
  onMore(): void
  onSelect(venue: CanonicalMapVenue): void
}) {
  const copy = COPY[locale]
  const orderedVenues = useMemo(() => venues.map((venue, index) => ({
    venue,
    index,
    pulse: pulseForVenue(venue.id, localPulseEvidenceByVenue[venue.id] ?? null),
  })), [localPulseEvidenceByVenue, venues])
  return (
    <ul className={styles.venueList} data-testid="ondo-b-venue-list">
      {orderedVenues.slice(0, visibleCount).map(({ venue, pulse }) => {
        const personalMatchCount = personalMatchCountByVenue[venue.id] ?? 0
        return (
          <li
            key={venue.id}
            data-venue-id={venue.id}
            data-pulse-priority={pulse.score == null ? undefined : pulse.level}
            data-personalization-match-count={personalMatchCount}
            data-personalized-match={personalMatchCount > 0 ? "true" : "false"}
            data-dietary-evidence={dietaryUnknownByVenue[venue.id] ? "unknown" : undefined}
          >
            <CanonicalVenueCapsuleB
              venue={venue}
              locale={locale}
              localEvidence={localPulseEvidenceByVenue[venue.id] ?? null}
              matchCount={personalMatchCount}
              dietaryUnknown={dietaryUnknownByVenue[venue.id]}
              selected={selectedVenueId === venue.id}
              onOpen={() => onSelect(venue)}
            />
          </li>
        )
      })}
      {visibleCount < venues.length ? <li className={styles.loadMore}><button type="button" onClick={onMore}>{copy.more}</button></li> : null}
      {!venues.length ? <li className={styles.empty} data-testid="ondo-b-empty-results"><div role="status"><strong>{copy.noResultsTitle}</strong><span>{nightSubsetActive ? copy.noResultsBodyLocked : copy.noResultsBody}</span></div><button type="button" onClick={onClear}>{nightSubsetActive ? copy.clearSearch : copy.clearResults}</button></li> : null}
    </ul>
  )
}

function EditorialPlaceList({ places, locale, selectedPlaceId, onClear, onSelect }: {
  places: readonly EditorialPlaceB[]
  locale: OndoBLocale
  selectedPlaceId: EditorialPlaceB["id"] | null
  onClear(): void
  onSelect(place: EditorialPlaceB): void
}) {
  const copy = COPY[locale]
  return (
    <ul className={styles.venueList} data-testid="ondo-b-editorial-place-list" data-list-grammar="shared-place-cards" data-truth-kind="editorial-place-list">
      {places.map((place) => {
        const category = EDITORIAL_CATEGORY[place.category][locale]
        const moodImage = editorialPlaceMoodImage(place)
        const secondaryName = locale === "en" ? place.name.ko : place.name.en
        const coverageIntensity = jejuEditorialCoverageIntensity(place)
        const temperatureSummary = jejuEditorialCoverageSummary(place, locale, TEMPERATURE_NAME[locale])
        return (
          <li key={place.id} className={styles.editorialListItem} data-editorial-place-id={place.id} data-pulse-priority={JEJU_EDITORIAL_TEMPERATURE.level} data-coverage-intensity={coverageIntensity}>
            <button
              type="button"
              onClick={() => onSelect(place)}
              data-editorial-place-opener={place.id}
              aria-haspopup="dialog"
              aria-expanded={selectedPlaceId === place.id}
              aria-controls={selectedPlaceId === place.id ? "editorial-place-dialog" : undefined}
              aria-label={`${place.name[locale]} · ${category} · ${temperatureSummary}`}
            >
              <span
                className={styles.venueMedia}
                data-image-kind="editorial-mood"
                data-photo-kind="editorial-collection"
                data-photo-state="pending"
                data-fallback="JEJU"
                aria-hidden="true"
              >
                <img
                  src={moodImage}
                  alt=""
                  width={720}
                  height={720}
                  loading="lazy"
                  decoding="async"
                  onLoad={(event) => event.currentTarget.parentElement?.setAttribute("data-photo-state", "loaded")}
                  onError={(event) => {
                    event.currentTarget.hidden = true
                    event.currentTarget.parentElement?.setAttribute("data-photo-state", "error")
                  }}
                />
              </span>
              <span>
                <small>{category} · {CITY.jeju.label[locale]}</small>
                <strong>{place.name[locale]}</strong>
                <span
                  className={styles.listPulse}
                  data-testid="ondo-b-list-pulse"
                  data-pulse-level={JEJU_EDITORIAL_TEMPERATURE.level}
                  data-coverage-intensity={coverageIntensity}
                  data-pulse-numeric="hidden"
                  aria-hidden="true"
                >
                  <span className={styles.listPulseSignal} aria-hidden="true"><i /><i /><i /></span>
                </span>
                <small className={styles.transliterationTruth}>{secondaryName}</small>
              </span>
              <ChevronRight size={17} />
            </button>
          </li>
        )
      })}
      {!places.length ? <li className={styles.empty} data-testid="ondo-b-empty-results"><div role="status"><strong>{copy.noResultsTitle}</strong><span>{copy.noResultsBody}</span></div><button type="button" onClick={onClear}>{copy.clearResults}</button></li> : null}
    </ul>
  )
}

export function MapEntryB() {
  const { state, actions } = useOndoB()
  const sampleEnvironment = useReviewSampleSession()
  const locale = state.locale
  const copy = COPY[locale]
  const cityRootNode = useRef<HTMLElement | null>(null)
  const mapNode = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const nationOverlayRef = useRef<HTMLDivElement | null>(null)
  const nationControllerRef = useRef<PersistentMapController | null>(null)
  const openEditorialPlaceDetailRef = useRef<(place: EditorialPlaceB) => void>(() => {})
  const currentCityRef = useRef<CityId | null>(null)
  const filteredMapRef = useRef(false)
  const userLocationRef = useRef<UserLocation | null>(null)
  const zoomFocusOwnedRef = useRef(false)
  const retryFocusPending = useRef(false)
  const locationRequestRef = useRef(0)
  const filterCameraSignatureRef = useRef("")
  const mapModeRef = useRef<CityId | "nation" | null>(null)
  const pendingCityFocusRef = useRef<CityId | null>(null)
  const pendingCityKeyboardFocusRef = useRef(false)
  const pendingCityIntentRef = useRef<PendingCityIntent | null>(null)
  const entryTransitionCleanupRef = useRef<(() => void) | null>(null)
  const semanticFocusSequenceRef = useRef(0)
  const semanticFocusHandlerRef = useRef<(city: CityId | null) => void>(() => {})
  const pendingSemanticPreviewRef = useRef<{ city: CityId | null } | null>(null)
  const historyInitializedRef = useRef(false)
  const localeRef = useRef(locale)
  const pendingNationFocusRef = useRef<CityId | null>(null)
  const resolvedAppearanceRef = useRef(state.resolvedAppearance)
  const after19LensActiveRef = useRef(false)
  const nationProjectionGenerationRef = useRef(0)
  const nationProjectionCleanupRef = useRef<(() => void) | null>(null)
  const pendingHistoryCameraRef = useRef<{ city: CityId; camera: BDiscoveryCamera } | null>(null)
  const pendingListScrollRef = useRef(0)
  const listPanelRef = useRef<HTMLDivElement | null>(null)
  const listScrollTimerRef = useRef<number | null>(null)
  const retryAttemptCleanupRef = useRef<(() => void) | null>(null)
  const [city, setCity] = useState<CityId | null>(null)
  const [view, setView] = useState<ViewMode>("map")
  const [query, setQuery] = useState("")
  const [collection, setCollection] = useState<DiscoveryCollectionIdB | null>(null)
  const [collectionSelection, setCollectionSelection] = useState<string | null>(null)
  const [collectionDetailId, setCollectionDetailId] = useState<string | null>(null)
  const [discoverySearchOpen, setDiscoverySearchOpen] = useState(false)
  const searchOriginRef = useRef<BDiscoveryHistoryEntry | null>(null)
  const [category, setCategory] = useState<BDiscoveryCategory>("all")
  const [editorialCategory, setEditorialCategory] = useState<EditorialCategory>("all")
  const [mapState, setMapState] = useState<"idle" | "loading" | "ready" | "error">("idle")
  const [mapProgressVisible, setMapProgressVisible] = useState(false)
  const [mapPartialFailure, setMapPartialFailure] = useState(false)
  const [visibleCount, setVisibleCount] = useState(30)
  const [retryToken, setRetryToken] = useState(0)
  const [mapAttempt, setMapAttempt] = useState(1)
  const [retryListForeground, setRetryListForeground] = useState(false)
  const [locationState, setLocationState] = useState<LocationState>("idle")
  const [locationDetailsOpen, setLocationDetailsOpen] = useState(false)
  const [mapFeedbackTarget, setMapFeedbackTarget] = useState<HTMLDivElement | null>(null)
  const mapFeedbackRootRef = useRef<HTMLDivElement | null>(null)
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null)
  const [online, setOnline] = useState(true)
  const [mapLayoutMode, setMapLayoutMode] = useState<MapLayoutMode>("measuring")
  const [mapRootBlockSize, setMapRootBlockSize] = useState(0)
  const [compactChrome, setCompactChrome] = useState(false)
  const [mapOptionsOpen, setMapOptionsOpen] = useState(false)
  const [editorialOpen, setEditorialOpen] = useState(false)
  const [after19Active, setAfter19Active] = useState(false)
  const [mapTilted, setMapTilted] = useState(false)
  const [entryTransitionCity, setEntryTransitionCity] = useState<CityId | null>(null)
  const [pendingReturnUi, setPendingReturnUi] = useState<PlaceReturnUiSnapshotB | null>(null)
  const [historyRestoreVersion, setHistoryRestoreVersion] = useState(0)
  const [draftPersonalization, setDraftPersonalization] = useState<BDiscoveryFocusRequest["personalization"] | null>(null)
  const [balancePlacesOnly, setBalancePlacesOnly] = useState(false)
  const balancePlacesActive = sampleEnvironment && balancePlacesOnly
  const balancePlacesActiveRef = useRef(balancePlacesActive)
  balancePlacesActiveRef.current = balancePlacesActive
  const serviceMapSnapshotsRef = useRef(new Map<string, ServiceMapSnapshotB>())
  const serviceCaptureRef = useRef<(placeId: string) => boolean>(() => false)
  const serviceReturnRef = useRef<(event: Event) => void>(() => {})
  const balancePlacesRequestRef = useRef<(event: Event) => void>(() => {})
  const balanceFilterReturnRef = useRef<Pick<ServiceMapSnapshotB, "city" | "view" | "query" | "category" | "editorialCategory" | "listScroll" | "camera" | "collection" | "collectionSelection"> | null>(null)
  useEffect(() => {
    const unregister = registerPlaceServiceMapCaptureB(placeId => serviceCaptureRef.current(placeId))
    const restore = (event: Event) => serviceReturnRef.current(event)
    const filter = (event: Event) => balancePlacesRequestRef.current(event)
    window.addEventListener(PLACE_SERVICE_RETURN_EVENT_B, restore)
    window.addEventListener(SHOW_BALANCE_PLACES_EVENT_B, filter)
    return () => {
      unregister()
      window.removeEventListener(PLACE_SERVICE_RETURN_EVENT_B, restore)
      window.removeEventListener(SHOW_BALANCE_PLACES_EVENT_B, filter)
    }
  }, [])
  useEffect(() => { setMapOptionsOpen(false) }, [city, state.tab])
  useEffect(() => { if (!compactChrome) setMapOptionsOpen(false) }, [compactChrome])
  currentCityRef.current = city
  localeRef.current = locale
  resolvedAppearanceRef.current = state.resolvedAppearance

  const beginNationProjection = useCallback((map: MapLibreMap, container: HTMLElement) => {
    nationProjectionCleanupRef.current?.()
    const generation = nationProjectionGenerationRef.current + 1
    nationProjectionGenerationRef.current = generation
    container.dataset.mapProjectionGeneration = String(generation)
    container.dataset.mapProjectionSettled = "false"
    delete container.dataset.mapProjectionSettledGeneration

    let moveEndListener: (() => void) | null = null
    let renderListener: (() => void) | null = null
    let revealFrame: number | null = null
    let revealSettleFrame: number | null = null
    let disposed = false
    let revealScheduled = false

    const isCurrent = () => !disposed
      && generation === nationProjectionGenerationRef.current
      && !currentCityRef.current
      && mapRef.current === map
      && mapNode.current === container

    const cleanup = () => {
      if (disposed) return
      disposed = true
      if (moveEndListener) map.off("moveend", moveEndListener)
      if (renderListener) map.off("render", renderListener)
      if (revealFrame != null) window.cancelAnimationFrame(revealFrame)
      if (revealSettleFrame != null) window.cancelAnimationFrame(revealSettleFrame)
      moveEndListener = null
      renderListener = null
      revealFrame = null
      revealSettleFrame = null
      if (nationProjectionCleanupRef.current === cleanup) nationProjectionCleanupRef.current = null
    }

    const waitForRenderThenPaint = (): void => {
      if (!isCurrent()) {
        cleanup()
        return
      }
      if (revealScheduled) return
      revealScheduled = true
      renderListener = () => {
        renderListener = null
        revealFrame = window.requestAnimationFrame(() => {
          revealFrame = null
          revealSettleFrame = window.requestAnimationFrame(() => {
            revealSettleFrame = null
            if (!isCurrent()) {
              cleanup()
              return
            }
            if (map.isMoving()) {
              revealScheduled = false
              waitForMoveThenPaint()
              return
            }
            container.dataset.mapProjectionSettledGeneration = String(generation)
            container.dataset.mapProjectionSettled = "true"
            cleanup()
          })
        })
      }
      map.once("render", renderListener)
      map.triggerRepaint()
    }

    const waitForMoveThenPaint = (): void => {
      if (!isCurrent()) {
        cleanup()
        return
      }
      if (!map.isMoving()) {
        waitForRenderThenPaint()
        return
      }
      if (moveEndListener) return
      moveEndListener = () => {
        moveEndListener = null
        waitForRenderThenPaint()
      }
      map.once("moveend", moveEndListener)
    }

    nationProjectionCleanupRef.current = cleanup
    return { generation, isCurrent, waitForMoveThenPaint, cleanup }
  }, [])
  // After 19 derives an approved night subset without rewriting the user's
  // saved query/category context. Turning it off therefore restores the base
  // discovery view without a second snapshot or history mutation. Jeju stays
  // editorial because its sources do not establish night eligibility.
  const after19ThemeActive = after19Active
  const after19NightSubsetActive = after19Active && !balancePlacesActive && (city === "seoul" || city === "busan")
  after19LensActiveRef.current = after19ThemeActive
  const selectedVenueId = state.surface.kind === "venue" ? state.surface.venueId : null
  const [selectedEditorialPlaceId, setSelectedEditorialPlaceId] = useState<EditorialPlaceB["id"] | null>(null)
  const [selectedResearchId, setSelectedResearchId] = useState<string | null>(null)
  const [researchReturnFocus, setResearchReturnFocus] = useState<{ placeId: string; focus: "offer" | "reservation" | "table" } | null>(null)
  const selectedResearch = selectedResearchId ? researchedFoodByIdB(selectedResearchId) : null
  // A commerce handoff hides this sheet without losing its exact research id.
  useEffect(() => { setSelectedResearchId(current => researchedFoodByIdB(current ?? "")?.city === city ? current : null) }, [city])
  useEffect(() => {
    const close = () => { if (!readBDiscoveryHistory()?.discoveryPlaceId) setSelectedResearchId(null) }
    window.addEventListener("popstate", close)
    return () => window.removeEventListener("popstate", close)
  }, [])
  const selectedVenue = selectedVenueId ? CANONICAL_MAP_VENUES_COMPACT.find((venue) => venue.id === selectedVenueId) ?? null : null
  const selectedEditorialPlace = editorialPlaceById(selectedEditorialPlaceId) ?? null
  const selectedPulse = selectedVenue ? pulseForVenue(selectedVenue.id, state.localPulseEvidenceByVenue[selectedVenue.id] ?? null) : null
  const effectiveView: ViewMode = mapState === "error" || retryListForeground || mapLayoutMode === "ultra-short" ? "list" : view
  const categoryOptions = Object.keys(CATEGORY) as BDiscoveryCategory[]
  const categoryRailItems: readonly BDiscoveryCategory[] = categoryOptions
  const effectiveCategory: BDiscoveryCategory = after19NightSubsetActive ? "night" : category
  const collectionPlaces = useMemo(() => collection && city ? discoveryCollectionPlacesB(collection, { city, category, editorialCategory, after19: after19ThemeActive, balanceOnly: balancePlacesActive }) : [], [collection, city, category, editorialCategory, after19ThemeActive, balancePlacesActive])
  const collectionSelected = collectionPlaces.some(place => place.id === collectionSelection) ? collectionSelection : collectionPlaces[0]?.id ?? null
  const collectionMarket = collectionDetailId && !researchedFoodByIdB(collectionDetailId) ? discoveryPlaceByIdB(collectionDetailId) : null
  const visibleResultCount = collection ? collectionPlaces.length : null

  useEffect(() => setEditorialOpen(false), [city])

  // Explore stays mounted while another destination is active so the map,
  // camera, filters and local selection do not restart on every dock round
  // trip. Resize only after the preserved panel is visible again.
  useLayoutEffect(() => {
    if (state.tab !== "ondo") return
    let firstFrame = window.requestAnimationFrame(() => {
      firstFrame = window.requestAnimationFrame(() => mapRef.current?.resize())
    })
    return () => window.cancelAnimationFrame(firstFrame)
  }, [state.tab])

  useEffect(() => () => {
    entryTransitionCleanupRef.current?.()
    nationProjectionCleanupRef.current?.()
  }, [])

  useEffect(() => {
    const onDiscoveryFocus = (event: Event) => {
      const request = readBDiscoveryFocusRequest(event instanceof CustomEvent ? event.detail : null)
      if (!request) return
      if (request.personalization) setDraftPersonalization(request.personalization)
      else if (request.city === null) setDraftPersonalization(null)
      const sequence = semanticFocusSequenceRef.current + 1
      semanticFocusSequenceRef.current = sequence
      queueMicrotask(() => {
        if (semanticFocusSequenceRef.current !== sequence) return
        semanticFocusHandlerRef.current(request.city)
      })
    }
    window.addEventListener(B_DISCOVERY_FOCUS_EVENT, onDiscoveryFocus)
    return () => window.removeEventListener(B_DISCOVERY_FOCUS_EVENT, onDiscoveryFocus)
  }, [])

  useLayoutEffect(() => {
    if (!city || pendingCityFocusRef.current !== city) return
    pendingCityFocusRef.current = null
    const keyboardModality = pendingCityKeyboardFocusRef.current
    pendingCityKeyboardFocusRef.current = false
    const focusEnteredCity = () => {
      const target = keyboardModality
        ? document.querySelector<HTMLInputElement>("[data-testid='ondo-b-search']")
          ?? document.querySelector<HTMLElement>("[data-testid='ondo-b-city-back']")
        : document.querySelector<HTMLElement>("[data-testid='ondo-b-city-back']")
      target?.focus({ preventScroll: true })
    }
    focusEnteredCity()
    window.requestAnimationFrame(focusEnteredCity)
  }, [city])

  useLayoutEffect(() => {
    if (city || !pendingNationFocusRef.current) return
    const returningCity = pendingNationFocusRef.current
    pendingNationFocusRef.current = null
    let frame = 0
    let timeout = 0
    let observer: MutationObserver | null = null
    let cancelled = false
    let ownsFocusChange = false
    const cleanup = () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timeout)
      observer?.disconnect()
      document.removeEventListener("focusin", cancelForNewFocus, true)
      document.removeEventListener("pointerdown", cancelForPointerIntent, true)
      document.removeEventListener("keydown", cancelForKeyboardIntent, true)
    }
    const returningTarget = () => document.querySelector<HTMLElement>(`[data-testid='ondo-b-nation'] [data-city='${returningCity}']`)
    const cancel = () => {
      cancelled = true
      cleanup()
    }
    const cancelForNewFocus = (event: FocusEvent) => {
      if (ownsFocusChange || !(event.target instanceof HTMLElement)) return
      const target = returningTarget()
      if (target && (event.target === target || target.contains(event.target))) return
      if (event.target === document.body || event.target === document.documentElement || !event.target.isConnected) return
      cancel()
    }
    const cancelForPointerIntent = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return
      const target = returningTarget()
      if (target && (event.target === target || target.contains(event.target))) return
      cancel()
    }
    const cancelForKeyboardIntent = (event: KeyboardEvent) => {
      if (event.key === "Tab" || event.key.startsWith("Arrow") || ["Enter", " ", "Escape"].includes(event.key)) cancel()
    }
    const focusReturnedCity = () => {
      if (cancelled || mapNode.current?.dataset.mapProjectionSettled !== "true") return false
      const target = returningTarget()
      if (!target || target.closest("[inert]") || getComputedStyle(target).visibility === "hidden") return false
      const active = document.activeElement
      const activeIsRetiredMapFocus = active instanceof HTMLElement
        && Boolean(mapNode.current?.contains(active))
        && (active === mapRef.current?.getCanvas()
          || active.getAttribute("aria-hidden") === "true"
          || Boolean(active.closest("[aria-hidden='true'], [inert]"))
          || active.tabIndex < 0)
      if (active instanceof HTMLElement
        && active.isConnected
        && active !== document.body
        && active !== document.documentElement
        && active !== target
        && !target.contains(active)
        && !activeIsRetiredMapFocus) {
        cancel()
        return false
      }
      ownsFocusChange = true
      target.focus({ preventScroll: true })
      ownsFocusChange = false
      if (document.activeElement !== target) return false
      cleanup()
      return true
    }
    const retryAfterPaint = () => {
      if (cancelled || focusReturnedCity()) return
      frame = window.requestAnimationFrame(retryAfterPaint)
    }
    observer = new MutationObserver(focusReturnedCity)
    if (mapNode.current) observer.observe(mapNode.current, { attributes: true, attributeFilter: ["data-map-projection-settled"] })
    document.addEventListener("focusin", cancelForNewFocus, true)
    document.addEventListener("pointerdown", cancelForPointerIntent, true)
    document.addEventListener("keydown", cancelForKeyboardIntent, true)
    timeout = window.setTimeout(() => {
      focusReturnedCity()
      cleanup()
    }, 2_000)
    // Arm the deadline before the synchronous first attempt. A city target can
    // already be ready here; if it focuses immediately, cleanup must be able to
    // cancel every pending refocus path instead of leaving a late focus steal.
    retryAfterPaint()
    return () => {
      cleanup()
    }
  }, [city])

  useLayoutEffect(() => {
    const root = cityRootNode.current
    if (!city || !root) return
    const rememberFocusOwner = (event: FocusEvent) => {
      zoomFocusOwnedRef.current = event.target instanceof Element
        && root.contains(event.target)
        && Boolean(event.target.closest(".maplibregl-ctrl-group"))
    }
    document.addEventListener("focusin", rememberFocusOwner)
    return () => document.removeEventListener("focusin", rememberFocusOwner)
  }, [city])

  useLayoutEffect(() => {
    if (!city || !cityRootNode.current) return
    const root = cityRootNode.current
    let previousMode: MapLayoutMode = "measuring"
    const applyLayout = (width: number, height: number) => {
      const usesUltraShortList = height < 260
        || (width < 480 && height < 360)
      setCompactChrome((width < 600 && height >= 360 || Boolean(collection) && width < 900 && height >= 300) && !usesUltraShortList)
      const nextMode: MapLayoutMode = usesUltraShortList
        ? "ultra-short"
        : width <= 430 || (width > height && height <= 568)
          ? "compact-map"
          : "spacious-map"
      if (nextMode === previousMode) {
        setMapRootBlockSize(height)
        return
      }
      if (nextMode !== "spacious-map" && (zoomFocusOwnedRef.current || document.activeElement?.closest(".maplibregl-ctrl-group"))) {
        zoomFocusOwnedRef.current = false
        const focusVisibleSuccessor = () => {
          const target = nextMode === "ultra-short"
            ? document.querySelector<HTMLInputElement>("[data-testid='ondo-b-search']")
            : document.querySelector<HTMLButtonElement>("[data-testid='ondo-b-view-toggle']")
          target?.focus({ preventScroll: true })
        }
        focusVisibleSuccessor()
        window.requestAnimationFrame(focusVisibleSuccessor)
      }
      previousMode = nextMode
      setMapRootBlockSize(height)
      setMapLayoutMode(nextMode)
    }
    const observer = new ResizeObserver(([entry]) => applyLayout(entry.contentRect.width, entry.contentRect.height))
    observer.observe(root)
    const bounds = root.getBoundingClientRect()
    applyLayout(bounds.width, bounds.height)
    return () => observer.disconnect()
  }, [city, Boolean(collection)])

  useLayoutEffect(() => {
    if (!state.hydrated) return
    let stabilizationFrame: number | null = null
    let stabilizationTimer: number | null = null
    const stabilizeHistoryEntry = (entry: BDiscoveryHistoryEntry, preservedState: unknown) => {
      if (stabilizationFrame != null) window.cancelAnimationFrame(stabilizationFrame)
      if (stabilizationTimer != null) window.clearTimeout(stabilizationTimer)
      const preserveEntry = () => {
        const current = normalizeBDiscoveryHistoryForActiveDocument()
        replaceBDiscoveryHistoryForActiveDocument(current ?? entry, preservedState)
      }
      stabilizationFrame = window.requestAnimationFrame(() => {
        stabilizationFrame = null
        preserveEntry()
        stabilizationTimer = window.setTimeout(() => {
          stabilizationTimer = null
          preserveEntry()
        }, 50)
      })
    }
    const applyHistoryEntry = (entry: BDiscoveryHistoryEntry) => {
      if (entry.level === "nation" && entry.focus?.kind === "city") pendingNationFocusRef.current = entry.focus.city
      setCity(entry.city ?? null)
      setView(entry.view)
      setQuery(entry.query)
      setCategory(entry.category)
      setEditorialCategory(entry.editorialCategory)
      setCollection(entry.collection ?? null)
      setCollectionSelection(entry.collectionSelection ?? null)
      setCollectionDetailId(entry.discoveryPlaceId ?? null)
      setSelectedResearchId(entry.discoveryPlaceId && researchedFoodByIdB(entry.discoveryPlaceId) ? entry.discoveryPlaceId : null)
      setDiscoverySearchOpen(false)
      searchOriginRef.current = null
      if (entry.camera) filterCameraSignatureRef.current = collectionFilterSignature(entry.city, entry.query, entry.category, entry.editorialCategory, balancePlacesActiveRef.current, entry.collection ?? null, after19LensActiveRef.current)
      pendingHistoryCameraRef.current = entry.city && entry.camera ? { city: entry.city, camera: entry.camera } : null
      pendingListScrollRef.current = entry.listScroll
      setHistoryRestoreVersion((version) => version + 1)
      setSelectedEditorialPlaceId(entry.editorialPlaceId ?? (entry.focus?.kind === "editorial-place" ? entry.focus.editorialPlaceId : null))
      if (state.onboarding !== "ONB-IN-PROGRESS" && (entry.level === "peek" || entry.level === "detail") && entry.venueId) actions.setSurface({ kind: "venue", venueId: entry.venueId })
      else if (state.onboarding !== "ONB-IN-PROGRESS" && (entry.level === "peek" || entry.level === "detail") && entry.editorialPlaceId) actions.setSurface({ kind: "editorial_place", editorialPlaceId: entry.editorialPlaceId })
      else actions.setSurface({ kind: "map" })
      return entry
    }
    const onTraversal = (event: Event) => {
      const traversal = readBDiscoveryTraversal(event)
      if (!traversal) return
      const entry = replaceBDiscoveryHistoryForActiveDocument(traversal.entry, traversal.preservedState)
      if (entry) {
        stabilizeHistoryEntry(applyHistoryEntry(entry), traversal.preservedState)
      }
    }
    window.addEventListener(B_DISCOVERY_TRAVERSAL_EVENT, onTraversal)
    const removeTraversalGuard = installBDiscoveryTraversalGuard()
    // External sign-in replaces the document, unlike an in-app place service.
    // Restore UI context only for the same pending venue and a cold history;
    // never override native Back/Forward or treat this snapshot as authority.
    // Read the bounded DTO here without importing the full-stack hackathon
    // client into the standalone map bundle.
    if (process.env.NEXT_PUBLIC_HK_ENABLED === "1" && !readBDiscoveryHistory()) {
      try {
        const pending = JSON.parse(sessionStorage.getItem("ondo-b.hackathon.pending.v1") ?? "null")
        const context = readBDiscoveryHistory({ __ondoBDiscovery: pending?.returnContext })
        const requestedVenue = new URLSearchParams(window.location.search).get("venueId")
        const venue = CANONICAL_MAP_VENUES_COMPACT.find(item => item.id === requestedVenue)
        const age = typeof pending?.savedAt === "number" ? Date.now() - pending.savedAt : Number.NaN
        if (pending?.resumeOperationId && Number.isFinite(age) && age >= 0 && age < 60 * 60 * 1000
          && context?.venueId === pending.venueId && context?.venueId === requestedVenue && context?.city === venue?.cityId
          && (context?.level === "peek" || context?.level === "detail")) replaceBDiscoveryHistoryForActiveDocument(context)
      } catch { /* absent or invalid return data cannot change discovery */ }
    }
    const initialState = window.history.state
    const initialized = initializeBDiscoveryHistory((venueId) => CANONICAL_MAP_VENUES_COMPACT.find((venue) => venue.id === venueId)?.cityId)
    const onboardingNation: BDiscoveryHistoryEntry = {
      v: 4,
      documentId: initialized.documentId,
      level: "nation",
      view: "map",
      query: "",
      category: "all",
      editorialCategory: "all",
      layer: "standard",
      sheetSnap: "closed",
      listScroll: 0,
    }
    // A completed onboarding area is the user's first discovery context on a
    // plain reload. Explicit city/place history remains more specific and wins.
    const subsequentOnboardingCommit = historyInitializedRef.current && state.onboarding === "ONB-COMPLETE"
    // Only an explicitly started setup previews the nation canvas. Fresh
    // visitors can enter a city directly without answering discovery questions.
    let initial = state.onboarding === "ONB-IN-PROGRESS"
      ? replaceBDiscoveryHistoryForActiveDocument(onboardingNation, initialState) ?? onboardingNation
      : state.onboarding === "ONB-COMPLETE" && state.discoveryArea && initialized.level === "nation"
        ? enterBDiscoveryCity(state.discoveryArea)
        : initialized
    // During onboarding, area choices are camera-only previews. A later
    // successful completion may replace an existing city context, but it never
    // displaces a more specific open place receipt.
    if (subsequentOnboardingCommit && state.discoveryArea && initialized.level === "city" && initialized.city !== state.discoveryArea) {
      initial = replaceBDiscoveryCityContext({
        city: state.discoveryArea,
        view: "map",
        query: "",
        category: "all",
        editorialCategory: "all",
        layer: "standard",
        listScroll: 0,
      }) ?? initialized
    }
    historyInitializedRef.current = true
    stabilizeHistoryEntry(applyHistoryEntry(initial), initialState)
    return () => {
      removeTraversalGuard()
      window.removeEventListener(B_DISCOVERY_TRAVERSAL_EVENT, onTraversal)
      if (stabilizationFrame != null) window.cancelAnimationFrame(stabilizationFrame)
      if (stabilizationTimer != null) window.clearTimeout(stabilizationTimer)
    }
  }, [actions, state.discoveryArea, state.hydrated, state.onboarding])

  useEffect(() => () => {
    if (listScrollTimerRef.current != null) window.clearTimeout(listScrollTimerRef.current)
    retryAttemptCleanupRef.current?.()
  }, [])

  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    update()
    window.addEventListener("online", update)
    window.addEventListener("offline", update)
    return () => {
      window.removeEventListener("online", update)
      window.removeEventListener("offline", update)
    }
  }, [])

  useEffect(() => {
    const restore = (event: Event) => {
      const snapshot = readPlaceReturnUiRestoreEvent(event)
      if (snapshot) setPendingReturnUi(snapshot)
    }
    window.addEventListener(PLACE_RETURN_UI_RESTORE_EVENT, restore)
    return () => window.removeEventListener(PLACE_RETURN_UI_RESTORE_EVENT, restore)
  }, [])

  const venues = useMemo(() => MAP_VENUES.filter((venue) => {
    if (collection) return false
    if (!city || venue.cityId !== city) return false
    if (balancePlacesActive && !resolveCommercePlaceB(venue.id)?.commerce) return false
    if (effectiveCategory !== "all" && venue.primaryCategory !== effectiveCategory) return false
    if (after19NightSubsetActive && !venue.after19PresentationEligible) return false
    const categoryCopy = CATEGORY[venue.primaryCategory]
    const haystack = `${venue.name.ko} ${venue.name.en} ${venueDisplayName(venue.name.ko, "en")} ${categoryCopy.ko} ${categoryCopy.en} ${venue.districtId} ${venueDistrictLabel(venue.cityId, venue.districtId, "en")} ${mapFoodIntentAliases(venue.name.ko).join(" ")}`.toLowerCase()
    return !query.trim() || haystack.includes(query.trim().toLowerCase())
  }), [after19NightSubsetActive, balancePlacesActive, city, collection, effectiveCategory, query])
  const activePersonalization = state.onboarding === "ONB-IN-PROGRESS" && draftPersonalization
    ? draftPersonalization
    : { intent: state.persona, preferences: state.discoveryPreferences }
  const personalizedVenueRows = useMemo(() => personalizedCanonicalVenueRows(
    venues,
    state.localPulseEvidenceByVenue,
    activePersonalization.intent,
    activePersonalization.preferences,
  ), [activePersonalization.intent, activePersonalization.preferences, state.localPulseEvidenceByVenue, venues])
  const personalizedVenues = useMemo(() => personalizedVenueRows.map(({ venue }) => venue), [personalizedVenueRows])
  const personalMatchCountByVenue = useMemo(() => Object.fromEntries(
    personalizedVenueRows.map(({ venue, matchCount }) => [venue.id, matchCount]),
  ), [personalizedVenueRows])
  const dietaryUnknownByVenue = useMemo(() => Object.fromEntries(
    personalizedVenueRows.map(({ venue, dietaryUnknown }) => [venue.id, dietaryUnknown]),
  ), [personalizedVenueRows])
  const editorialPlaces = useMemo(() => JEJU_EDITORIAL_PLACES.filter((place) => {
    if (collection) return collectionPlaces.some(item => item.id === place.id)
    if (balancePlacesActive && !resolveCommercePlaceB(place.id)?.commerce) return false
    if (editorialCategory !== "all" && place.category !== editorialCategory) return false
    const haystack = `${place.name.en} ${place.name.ko} ${place.name.ja} ${place.address.en} ${place.address.ko} ${place.sourceCollection.en} ${place.sourceCollection.ko} ${place.sourceCollection.ja}`.toLowerCase()
    return !query.trim() || haystack.includes(query.trim().toLowerCase())
  }), [balancePlacesActive, collection, collectionPlaces, editorialCategory, query])
  const filteredMap = Boolean(collection) || balancePlacesActive || query.trim().length > 0 || (city === "jeju" ? editorialCategory !== "all" : category !== "all")
  const curatedPulseVenues = useMemo(() => venues.flatMap((venue) => {
    const pulse = pulseForVenue(venue.id, state.localPulseEvidenceByVenue[venue.id] ?? null)
    return pulse.score == null ? [] : [{ venue, pulse }]
  }).sort((left, right) => (right.pulse.score ?? 0) - (left.pulse.score ?? 0)), [state.localPulseEvidenceByVenue, venues])
  const researchedFoods = useMemo(() => RESEARCHED_FOOD_B.filter(place => {
    if (collection) return collectionPlaces.some(item => item.id === place.id)
    if (place.city !== city || !researchFoodMatchesB(place, query)) return false
    if (balancePlacesActive && !resolveCommercePlaceB(place.id)?.commerce) return false
    if (after19ThemeActive && !balancePlacesActive) return place.kind === "bar"
    if (city === "jeju") return editorialCategory === "all" || editorialCategory === "food"
    if (category === "all") return true
    return category === "night" ? place.kind === "bar" || place.kind === "cafe" : category === "korean" && place.kind === "food"
  }), [balancePlacesActive, city, collection, collectionPlaces, query, after19ThemeActive, editorialCategory, category])
  const temperatureSamplePoints = useMemo(() => [...(city === "jeju"
    ? editorialPlaces.map((place) => ({ id: place.id, longitude: place.location.longitude, latitude: place.location.latitude }))
    : curatedPulseVenues.map(({ venue }) => ({ id: venue.id, longitude: venue.longitude, latitude: venue.latitude }))),
    ...researchedFoods.map(place => ({ id: place.id, longitude: place.longitude, latitude: place.latitude })),
  ], [city, curatedPulseVenues, editorialPlaces, researchedFoods])
  filteredMapRef.current = filteredMap
  const nearestVenue = useMemo(() => {
    if (!userLocation || !venues.length) return null
    return venues.reduce<{ venue: CanonicalMapVenue; distance: number } | null>((nearest, venue) => {
      const distance = distanceInMeters(userLocation, venue)
      return nearest == null || distance < nearest.distance ? { venue, distance } : nearest
    }, null)
  }, [userLocation, venues])
  const nearestEditorialPlace = useMemo(() => {
    if (!userLocation || city !== "jeju" || !editorialPlaces.length) return null
    return editorialPlaces.reduce<{ place: EditorialPlaceB; distance: number } | null>((nearest, place) => {
      const distance = distanceInMeters(userLocation, { longitude: place.location.longitude, latitude: place.location.latitude })
      return nearest == null || distance < nearest.distance ? { place, distance } : nearest
    }, null)
  }, [city, editorialPlaces, userLocation])
  const locationMessage = !online
    ? `${copy.offlineTitle} · ${copy.offlineSource} ${copy.locationDisclosure}`
    : locationState === "idle"
      ? copy.locationDisclosure
      : locationState === "locating"
        ? copy.locating
      : locationState === "ready" && nearestEditorialPlace
        ? `${copy.locationReady} · ${nearestEditorialPlace.place.name[locale]} ${displayDistance(nearestEditorialPlace.distance, locale)} · ${copy.nearest}`
        : locationState === "ready" && nearestVenue
          ? `${copy.locationReady} · ${venueDisplayName(nearestVenue.venue.name.ko, locale)} ${displayDistance(nearestVenue.distance, locale)} · ${copy.nearest}`
          : locationState === "ready"
            ? copy.locationReady
            : locationState === "denied"
              ? copy.locationDenied
              : copy.locationUnsupported
  const locationSummary = !online
    ? copy.offlineTitle
    : locationState === "idle"
      ? MAP_UI[locale].locationTab
      : locationState === "denied"
        ? MAP_UI[locale].locationOff
        : locationState === "unsupported"
          ? MAP_UI[locale].locationUnavailable
          : locationState === "locating"
            ? copy.locating
            : copy.locationReady
  const locationNeedsRecovery = !online || locationState === "denied" || locationState === "unsupported"

  useLayoutEffect(() => {
    const root = cityRootNode.current
    const stack = mapFeedbackRootRef.current
    if (!root || !stack || !mapFeedbackTarget) return
    const header = root.querySelector<HTMLElement>("[data-testid='ondo-b-city-header']")
    const utilities = root.querySelector<HTMLElement>("[data-testid='ondo-b-map-utility-cluster']")
    const chrome = root.querySelector<HTMLElement>("[data-testid='ondo-b-map-chrome']")
    const layout = () => {
      const bounds = root.getBoundingClientRect()
      const bottom = (node: HTMLElement | null) => node && node.getClientRects().length ? node.getBoundingClientRect().bottom - bounds.top : 0
      // Share one flow region below the actual controls. Notice text and an
      // expanded location explanation never require guessed vertical offsets.
      const top = Math.max(bottom(header), bottom(utilities)) + 8
      const chromeTop = chrome?.getBoundingClientRect().top ?? bounds.bottom
      const limit = chromeTop > bounds.top + top ? Math.min(bounds.bottom, chromeTop) : bounds.bottom
      stack.style.setProperty("--map-feedback-top", `${top}px`)
      stack.style.setProperty("--map-feedback-height", `${Math.max(44, limit - bounds.top - top - 8)}px`)
    }
    const observer = new ResizeObserver(layout)
    for (const node of [root, header, utilities, chrome]) if (node) observer.observe(node)
    layout()
    return () => observer.disconnect()
  }, [city, compactChrome, editorialOpen, mapFeedbackTarget, mapLayoutMode, after19ThemeActive])

  useEffect(() => { setVisibleCount(30) }, [category, city, query])

  useEffect(() => {
    if (!selectedVenueId) return
    const selected = CANONICAL_MAP_VENUES_COMPACT.find((venue) => venue.id === selectedVenueId)
    if (selected) setCity(selected.cityId)
  }, [selectedVenueId])

  useEffect(() => {
    if (selectedEditorialPlaceId) setCity("jeju")
  }, [selectedEditorialPlaceId])

  useEffect(() => {
    if (!state.hydrated || !mapNode.current || mapRef.current) return
    let disposed = false
    let failed = false
    let settled = false
    let basemapMetadataLoaded = false
    let basemapTileLoaded = false
    let resourceFailure = false
    let localFramePainted = false
    let loadDeadline: number | undefined
    let progressDelay: number | undefined
    let pulseAnimationFrame: number | null = null
    let readyFrame: number | null = null
    let readySettleFrame: number | null = null
    let qaImportDelayTimer: number | null = null
    const attemptStartedAt = performance.now()
    mapNode.current.dataset.mapAttemptStartedAt = attemptStartedAt.toFixed(2)
    delete mapNode.current.dataset.mapFallbackAt
    mapNode.current.dataset.basemapMetadata = "pending"
    mapNode.current.dataset.basemapTile = "pending"
    const showMapFallback = () => {
      if (disposed || settled) return
      if (loadDeadline != null) window.clearTimeout(loadDeadline)
      if (progressDelay != null) window.clearTimeout(progressDelay)
      const pendingIntent = pendingCityIntentRef.current
      if (pendingIntent) flushSync(() => commitCityIntent(pendingIntent, { allowWithoutCamera: true }))
      setMapProgressVisible(false)
      setMapState("error")
      setRetryListForeground(false)
    }
    const failMap = () => {
      if (disposed || failed || settled) return
      failed = true
      showMapFallback()
    }
    const finishMap = (partial = false) => {
      if (disposed || failed || settled || !basemapMetadataLoaded || !basemapTileLoaded) return
      settled = true
      if (loadDeadline != null) window.clearTimeout(loadDeadline)
      if (progressDelay != null) window.clearTimeout(progressDelay)
      setMapPartialFailure(partial || resourceFailure)
      setMapProgressVisible(false)
      // Publish the interactive targets only after the final camera projection
      // has painted twice. Without this boundary an extremely fast pointer can
      // catch a beacon between MapLibre's initial fit and its geographic point.
      readyFrame = window.requestAnimationFrame(() => {
        readySettleFrame = window.requestAnimationFrame(() => {
          if (disposed || failed) return
          setMapState("ready")
          setRetryListForeground(false)
          if (retryFocusPending.current) {
            retryFocusPending.current = false
            window.setTimeout(() => document.querySelector<HTMLElement>("[data-testid='ondo-b-view-toggle']")?.focus({ preventScroll: true }), 0)
          }
        })
      })
    }
    setMapState("loading")
    setMapProgressVisible(false)
    setMapPartialFailure(false)
    progressDelay = window.setTimeout(() => {
      if (!disposed && !failed) setMapProgressVisible(true)
    }, MAP_LOAD_CONTEXT_DELAY_MS)
    loadDeadline = window.setTimeout(() => {
      // Five seconds is a foreground deadline, not a fatal construction error.
      // Keep the same-state List usable while the graph continues loading;
      // only a later real idle receipt may publish Ready. An untouched Map
      // request can recover, while explicit fallback List use stays in List.
      if (localFramePainted) setMapPartialFailure(true)
      if (mapNode.current) mapNode.current.dataset.mapFallbackAt = performance.now().toFixed(2)
      showMapFallback()
    }, MAP_LOAD_FALLBACK_DELAY_MS)
    const qaMapRuntime = readQaRuntime<{ mapImportDelayMs?: unknown }>()
    const qaMapImportDelay = typeof qaMapRuntime?.mapImportDelayMs === "number" && Number.isFinite(qaMapRuntime.mapImportDelayMs)
      ? Math.min(2_000, Math.max(0, Math.round(qaMapRuntime.mapImportDelayMs)))
      : 0
    if (qaMapImportDelay > 0) mapNode.current.dataset.qaMapImportDelay = String(qaMapImportDelay)
    const loadMapLibrary = async () => {
      if (qaMapImportDelay > 0) {
        await new Promise<void>((resolve) => {
          qaImportDelayTimer = window.setTimeout(resolve, qaMapImportDelay)
        })
      }
      return import("maplibre-gl")
    }
    void loadMapLibrary().then(({ AJAXError, Map, NavigationControl }) => {
      if (disposed || !mapNode.current) return
      // Initialize only the geographic canvas in its current lens so an active
      // After 19 session cannot flash a daylight map while MapLibre settles.
      // Global appearance still owns overview signals and every app surface.
      const initialMapAppearance = resolvedAppearanceRef.current
      const initialMapDark = initialMapAppearance === "dark"
      const initialOverviewSignalColor = initialMapDark ? OVERVIEW_SIGNAL_COLOR_DARK : OVERVIEW_SIGNAL_COLOR_LIGHT
      const initialCity = currentCityRef.current
      const initialFilteredVenue = initialCity && filteredMapRef.current && venues.length === 1 ? venues[0] : null
      const initialEditorialPlace = initialCity === "jeju" ? selectedEditorialPlace : null
      const instance = new Map({
        container: mapNode.current,
        style: ondoMapStyle(locale, initialMapAppearance, after19LensActiveRef.current),
        center: initialFilteredVenue
          ? [initialFilteredVenue.longitude, initialFilteredVenue.latitude]
          : initialEditorialPlace
            ? [initialEditorialPlace.location.longitude, initialEditorialPlace.location.latitude]
            : initialCity
              ? CITY[initialCity].center
              : [127.7, 35.8],
        zoom: initialFilteredVenue || initialEditorialPlace ? 15 : initialCity ? CITY[initialCity].zoom : 5.4,
        pitch: initialCity ? CITY_PERSPECTIVE_PITCH : 0,
        minZoom: 4.6,
        maxZoom: 18,
        attributionControl: false,
        cooperativeGestures: false,
        locale: locale === "ko" ? {
          "Map.Title": "지도",
          "NavigationControl.ZoomIn": "지도 확대",
          "NavigationControl.ZoomOut": "지도 축소",
          "CooperativeGesturesHandler.WindowsHelpText": "Ctrl 키를 누른 채 스크롤하여 지도를 확대하거나 축소하세요",
          "CooperativeGesturesHandler.MacHelpText": "⌘ 키를 누른 채 스크롤하여 지도를 확대하거나 축소하세요",
          "CooperativeGesturesHandler.MobileHelpText": "두 손가락으로 지도를 움직이세요",
        } : locale === "ja" ? {
          "Map.Title": "地図",
          "NavigationControl.ZoomIn": "地図を拡大",
          "NavigationControl.ZoomOut": "地図を縮小",
          "CooperativeGesturesHandler.WindowsHelpText": "Ctrlキーを押しながらスクロールして地図を拡大・縮小します",
          "CooperativeGesturesHandler.MacHelpText": "⌘キーを押しながらスクロールして地図を拡大・縮小します",
          "CooperativeGesturesHandler.MobileHelpText": "2本の指で地図を動かします",
        } : undefined,
      })
      mapRef.current = instance
      // Failed requests can still make MapLibre report idle. Require real
      // metadata and at least one successfully loaded geographic tile.
      instance.on("sourcedata", (event) => {
        if (event.sourceId === "openmaptiles" && event.sourceDataType === "metadata") {
          basemapMetadataLoaded = true
          instance.getContainer().dataset.basemapMetadata = "ready"
        }
        const tile = (event as typeof event & { tile?: { state?: string } }).tile
        if (event.sourceId === "openmaptiles" && tile?.state === "loaded") {
          basemapTileLoaded = true
          instance.getContainer().dataset.basemapTile = "ready"
        }
      })
      const projectCityNodes = () => {
        if (!mapNode.current) return
        const center = instance.getCenter()
        mapNode.current.dataset.mapZoom = instance.getZoom().toFixed(3)
        mapNode.current.dataset.mapCenter = `${center.lng.toFixed(5)},${center.lat.toFixed(5)}`
        if (!nationOverlayRef.current || currentCityRef.current) return
        const mapBox = mapNode.current.getBoundingClientRect()
        const overlayBox = nationOverlayRef.current.getBoundingClientRect()
        for (const projectedCity of ["seoul", "busan", "jeju"] as const) {
          const coordinates = KOREA_ATLAS_CITY_COORDINATES[projectedCity]
          const point = instance.project([coordinates.longitude, coordinates.latitude])
          const cityNode = nationOverlayRef.current.querySelector<HTMLElement>(`[data-city='${projectedCity}']`)
          if (!cityNode) continue
          const x = point.x + mapBox.left - overlayBox.left
          const y = point.y + mapBox.top - overlayBox.top
          cityNode.style.setProperty("--atlas-map-x", `${x.toFixed(2)}px`)
          cityNode.style.setProperty("--atlas-map-y", `${y.toFixed(2)}px`)
          cityNode.dataset.mapX = x.toFixed(2)
          cityNode.dataset.mapY = y.toFixed(2)
          cityNode.dataset.mapProjected = "true"
        }
      }
      instance.on("render", projectCityNodes)
      nationControllerRef.current = {
        focusCity(nextCity, onComplete) {
          if (currentCityRef.current) return false
          onComplete()
          return true
        },
      }
      // Tile and source requests can fail independently while the style and
      // cached map remain usable. Classify those as recoverable evidence rather
      // than silently swallowing them or replacing the map with the fallback.
      // A non-network construction error still fails closed immediately.
      instance.on("error", (event) => {
        const message = event.error?.message ?? ""
        const resourceEvent = event as typeof event & { tile?: unknown }
        const recoverable = resourceEvent.tile != null
          || event.error instanceof AJAXError
          || /^AJAXError:/i.test(message)
          || /\b(?:failed to fetch|networkerror|load failed|the operation was aborted|aborterror|request timed out|timed out)\b/i.test(message)
        if (recoverable) {
          resourceFailure = true
          setMapPartialFailure(true)
        }
        else failMap()
      })
      instance.addControl(new NavigationControl({ showCompass: false }), "bottom-right")
      // `load` waits for every initially visible tile. A single unavailable
      // basemap tile would therefore poison an otherwise usable map and its
      // local ONDO layers. `style.load` is the correct construction boundary:
      // the style graph is ready, while independent tiles may still recover.
      instance.once("style.load", () => {
        if (disposed || failed) return
        try {
          instance.addSource("ondo-korea-land", { type: "geojson", data: koreaLandFeatureCollection() })
          instance.addSource("ondo-overview-route", { type: "geojson", data: overviewRouteFeatureCollection() })
          instance.addSource("ondo-overview-cities", { type: "geojson", data: overviewCityFeatureCollection() })
          instance.addSource("ondo-directory", {
            type: "geojson",
            data: toFeatureCollection(venues, state.localPulseEvidenceByVenue, selectedVenueId, personalMatchCountByVenue),
            cluster: true,
            clusterRadius: 48,
            clusterMaxZoom: 13,
          })
          instance.addSource("ondo-after19-lens", {
            type: "geojson",
            data: toFeatureCollection(venues, state.localPulseEvidenceByVenue, selectedVenueId, personalMatchCountByVenue),
          })
          instance.addSource("ondo-pulse", {
            type: "geojson",
            data: initialCity
              ? toTemperatureFeatureCollection(initialCity, venues, state.localPulseEvidenceByVenue, locale, selectedVenueId, selectedEditorialPlaceId, editorialPlaces)
              : { type: "FeatureCollection", features: [] },
          })
          instance.addSource("ondo-user-location", { type: "geojson", data: toUserLocationFeatureCollection(userLocationRef.current) })
          instance.addSource("ondo-night-dim", {
            type: "geojson",
            data: {
              type: "FeatureCollection",
              features: [{
                type: "Feature",
                properties: {},
                geometry: { type: "Polygon", coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]] },
              }],
            },
          })
          instance.addImage(SELECTED_CAPSULE_IMAGE_ID, selectedCapsuleImage(initialMapDark), {
            pixelRatio: 2,
            stretchX: [[20, 44]],
            stretchY: [[20, 28]],
            content: [16, 12, 48, 36],
          })
          instance.addLayer({ id: "ondo-korea-land-fill", type: "fill", source: "ondo-korea-land", maxzoom: 7.7, paint: { "fill-color": initialMapDark ? "#17191b" : "#fcfcfa", "fill-opacity": 0.98 } })
          instance.addLayer({ id: "ondo-overview-route-halo", type: "line", source: "ondo-overview-route", maxzoom: 8.3, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": initialMapDark ? "rgba(17,19,21,.12)" : "rgba(255,255,255,.84)", "line-width": 3.2 } })
          instance.addLayer({ id: "ondo-overview-route", type: "line", source: "ondo-overview-route", maxzoom: 8.3, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": initialMapDark ? "rgba(211,207,201,.56)" : "rgba(87,79,73,.46)", "line-width": 1.25, "line-dasharray": [1.5, 5] } })
          instance.addLayer({ id: "ondo-korea-coastline", type: "line", source: "ondo-korea-land", maxzoom: 8.3, layout: { "line-join": "round" }, paint: { "line-color": initialMapDark ? "rgba(226,228,230,.68)" : "rgba(78,73,68,.58)", "line-width": ["interpolate", ["linear"], ["zoom"], 4.6, 1, 7, 1.2] } })
          instance.addLayer({ id: "ondo-overview-city-aura", type: "circle", source: "ondo-overview-cities", maxzoom: 8.3, paint: { "circle-color": initialOverviewSignalColor, "circle-radius": ["match", ["get", "signal"], "active", 30, "growing", 26, 23], "circle-opacity": ["match", ["get", "signal"], "active", .18, "growing", .15, .12], "circle-blur": .72 } })
          instance.addLayer({ id: "ondo-overview-city-core", type: "circle", source: "ondo-overview-cities", maxzoom: 8.3, paint: { "circle-color": initialOverviewSignalColor, "circle-radius": 5.5, "circle-opacity": .96, "circle-stroke-color": initialMapDark ? "#111315" : "#fff", "circle-stroke-width": 2 } })
          instance.addLayer({ id: "ondo-night-dim", type: "fill", source: "ondo-night-dim", paint: { "fill-color": "#080810", "fill-opacity": 0 } })
          instance.addLayer({
            id: "ondo-clusters",
            type: "circle",
            source: "ondo-directory",
            filter: ["has", "point_count"],
            paint: {
              "circle-color": "rgba(255,255,255,0.84)",
              "circle-radius": ["step", ["get", "point_count"], 7, 15, 9, 50, 12],
              "circle-stroke-color": ["step", ["get", "point_count"], "rgba(74,70,65,.30)", 15, "rgba(155,68,52,.38)", 50, "rgba(122,32,72,.48)"],
              "circle-stroke-width": ["step", ["get", "point_count"], 1, 15, 1.25, 50, 1.6],
              "circle-opacity": 0.9,
              "circle-blur": 0.02,
            },
          })
          instance.addLayer({ id: "ondo-points", type: "circle", source: "ondo-directory", filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "curatedSignal"], false]], paint: { "circle-color": "#716d67", "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 2.6, 15, 4.2], "circle-opacity": 0.66, "circle-stroke-width": 0 } })
          instance.addLayer({ id: "ondo-cluster-hit", type: "circle", source: "ondo-directory", filter: ["has", "point_count"], paint: { "circle-color": "rgba(0,0,0,0.01)", "circle-radius": 22, "circle-stroke-width": 0 } })
          instance.addLayer({ id: "ondo-points-hit", type: "circle", source: "ondo-directory", filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "curatedSignal"], false]], paint: { "circle-color": "rgba(0,0,0,0.01)", "circle-radius": 22, "circle-stroke-width": 0 } })
          const unshiftedPulseFilter: ExpressionSpecification = ["all", ["!=", ["get", "layoutRank"], 3], ["!=", ["get", "layoutRank"], 2]]
          const risingPulseFilter: ExpressionSpecification = ["==", ["get", "layoutRank"], 3]
          const warmingPulseFilter: ExpressionSpecification = ["==", ["get", "layoutRank"], 2]
          const mapAnchor: ExpressionSpecification = ["==", ["get", "mapAnchor"], true]
          const progressivePointOpacity: ExpressionSpecification = [
            "interpolate", ["linear"], ["zoom"],
            11.8, ["case", mapAnchor, 0.98, 0],
            12.35, ["case", mapAnchor, 0.98, 0.9],
          ]
          const pulsePointPaint: CircleLayerSpecification["paint"] = { "circle-color": TEMPERATURE_POINT_COLOR_EXPRESSION, "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 4.5, 15, 6.2], "circle-opacity": progressivePointOpacity, "circle-stroke-width": 0, "circle-blur": 0.08 }
          pulsePointPaint["circle-radius"] = [
            "interpolate", ["linear"], ["get", "visualRank"],
            0, 3.5,
            1, 4,
            2, 5,
            3, 6.5,
            4, 8,
            5, 10,
          ]
          const pulseHaloOpacity: ExpressionSpecification = [
            "interpolate", ["linear"], ["get", "visualRank"],
            0, 0.04,
            1, 0.08,
            2, 0.13,
            3, 0.19,
            4, 0.25,
            5, 0.3,
          ]
          const progressiveHaloOpacity: ExpressionSpecification = [
            "interpolate", ["linear"], ["zoom"],
            11.8, ["case", mapAnchor, pulseHaloOpacity, 0],
            12.35, pulseHaloOpacity,
          ]
          const progressiveHitRadius: ExpressionSpecification = [
            "step", ["zoom"], ["case", mapAnchor, 22, 0],
            12.35, 22,
          ]
          const pulseHaloPaint: CircleLayerSpecification["paint"] = {
            "circle-color": TEMPERATURE_POINT_COLOR_EXPRESSION,
            "circle-radius": [
              "interpolate", ["linear"], ["get", "visualRank"],
              0, 8,
              1, 11,
              2, 15,
              3, 20,
              4, 27,
              5, 34,
            ],
            "circle-blur": 0.84,
            "circle-opacity": progressiveHaloOpacity,
            "circle-stroke-width": 0,
          }
          instance.addLayer({
            id: "ondo-temperature-field",
            type: "heatmap",
            source: "ondo-pulse",
            minzoom: 8,
            maxzoom: 15,
            paint: {
              "heatmap-weight": ["get", "heatWeight"],
              "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 8, 0.72, 12, 1.02, 15, 0.72],
              "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 8, 22, 12, 36, 15, 48],
              "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 8, 0.3, 12, 0.45, 15, 0.25],
              "heatmap-color": city === "jeju" ? EDITORIAL_COVERAGE_HEAT_COLOR : PULSE_HEAT_COLOR,
            },
          })
          instance.addLayer({
            id: "ondo-after19-eligible-field",
            type: "heatmap",
            source: "ondo-after19-lens",
            filter: AFTER19_ELIGIBLE_FILTER,
            minzoom: 8,
            maxzoom: 15,
            paint: {
              "heatmap-weight": 0.86,
              "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 8, 0.72, 12, 1.02, 15, 0.72],
              "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 8, 22, 12, 36, 15, 48],
              "heatmap-opacity": 0,
              "heatmap-color": AFTER19_HEAT_COLOR,
            },
          })
          instance.addLayer({ id: "ondo-pulse-halo", type: "circle", source: "ondo-pulse", filter: unshiftedPulseFilter, paint: pulseHaloPaint })
          instance.addLayer({ id: "ondo-pulse-halo-rising", type: "circle", source: "ondo-pulse", filter: risingPulseFilter, paint: pulseHaloPaint })
          instance.addLayer({ id: "ondo-pulse-halo-warming", type: "circle", source: "ondo-pulse", filter: warmingPulseFilter, paint: pulseHaloPaint })
          instance.addLayer({ id: "ondo-pulse-points", type: "circle", source: "ondo-pulse", filter: unshiftedPulseFilter, layout: { "circle-sort-key": ["get", "visualRank"] }, paint: pulsePointPaint })
          instance.addLayer({ id: "ondo-pulse-points-rising", type: "circle", source: "ondo-pulse", filter: risingPulseFilter, layout: { "circle-sort-key": ["get", "visualRank"] }, paint: pulsePointPaint })
          instance.addLayer({ id: "ondo-pulse-points-warming", type: "circle", source: "ondo-pulse", filter: warmingPulseFilter, layout: { "circle-sort-key": ["get", "visualRank"] }, paint: pulsePointPaint })
          instance.addLayer({
            id: "ondo-personalized-keyline",
            type: "circle",
            source: "ondo-directory",
            filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "personalKeyline"], true]],
            minzoom: 10.8,
            paint: {
              "circle-color": "rgba(255,255,255,0)",
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 10.8, 9.5, 15, 13],
              "circle-stroke-color": "rgba(24,23,21,.9)",
              "circle-stroke-width": 1.8,
              "circle-stroke-opacity": 0.94,
            },
          })
          instance.addLayer({
            id: "ondo-after19-eligible-points",
            type: "circle",
            source: "ondo-after19-lens",
            filter: AFTER19_UNCURATED_ELIGIBLE_FILTER,
            minzoom: 10.8,
            paint: {
              "circle-color": "#FF3FA4",
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 10.8, 3.8, 15, 6.2],
              "circle-opacity": 0,
              "circle-blur": 0.08,
              "circle-stroke-color": "rgba(255,255,255,.92)",
              "circle-stroke-width": 1.4,
            },
          })
          instance.addLayer({ id: "ondo-pulse-hit", type: "circle", source: "ondo-pulse", filter: unshiftedPulseFilter, paint: { "circle-color": "rgba(0,0,0,0.01)", "circle-radius": progressiveHitRadius, "circle-stroke-width": 0 } })
          instance.addLayer({ id: "ondo-pulse-hit-rising", type: "circle", source: "ondo-pulse", filter: risingPulseFilter, paint: { "circle-color": "rgba(0,0,0,0.01)", "circle-radius": progressiveHitRadius, "circle-stroke-width": 0 } })
          instance.addLayer({ id: "ondo-pulse-hit-warming", type: "circle", source: "ondo-pulse", filter: warmingPulseFilter, paint: { "circle-color": "rgba(0,0,0,0.01)", "circle-radius": progressiveHitRadius, "circle-stroke-width": 0 } })
          const selectedUnshiftedPulseFilter: ExpressionSpecification = ["all", ["==", ["get", "selected"], true], unshiftedPulseFilter]
          const selectedRisingPulseFilter: ExpressionSpecification = ["all", ["==", ["get", "selected"], true], risingPulseFilter]
          const selectedWarmingPulseFilter: ExpressionSpecification = ["all", ["==", ["get", "selected"], true], warmingPulseFilter]
          const selectedPulseOuterPaint: CircleLayerSpecification["paint"] = { "circle-color": TEMPERATURE_POINT_COLOR_EXPRESSION, "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 34, 15, 50], "circle-blur": 0.88, "circle-opacity": 0.18, "circle-stroke-width": 0 }
          const selectedPulsePaint: CircleLayerSpecification["paint"] = { "circle-color": TEMPERATURE_POINT_COLOR_EXPRESSION, "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 8, 15, 10], "circle-opacity": 1, "circle-blur": 0.02, "circle-stroke-color": "#111111", "circle-stroke-width": 2.2, "circle-stroke-opacity": 1 }
          instance.addLayer({ id: "ondo-selected-pulse-outer", type: "circle", source: "ondo-pulse", filter: selectedUnshiftedPulseFilter, paint: selectedPulseOuterPaint })
          instance.addLayer({ id: "ondo-selected-pulse", type: "circle", source: "ondo-pulse", filter: selectedUnshiftedPulseFilter, paint: selectedPulsePaint })
          instance.addLayer({ id: "ondo-selected-pulse-outer-rising", type: "circle", source: "ondo-pulse", filter: selectedRisingPulseFilter, paint: selectedPulseOuterPaint })
          instance.addLayer({ id: "ondo-selected-pulse-rising", type: "circle", source: "ondo-pulse", filter: selectedRisingPulseFilter, paint: selectedPulsePaint })
          instance.addLayer({ id: "ondo-selected-pulse-outer-warming", type: "circle", source: "ondo-pulse", filter: selectedWarmingPulseFilter, paint: selectedPulseOuterPaint })
          instance.addLayer({ id: "ondo-selected-pulse-warming", type: "circle", source: "ondo-pulse", filter: selectedWarmingPulseFilter, paint: selectedPulsePaint })
          const selectedCapsuleLayout: SymbolLayerSpecification["layout"] = {
            "icon-image": SELECTED_CAPSULE_IMAGE_ID,
            "icon-text-fit": "both",
            "icon-text-fit-padding": [7, 12, 7, 12],
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            "text-field": ["get", "selectedMarkerLabel"],
            "text-font": ["Noto Sans Bold"],
            "text-size": 12,
            "text-max-width": 24,
            "text-letter-spacing": 0.01,
            "text-offset": [0, 2.8],
            "text-allow-overlap": true,
            "text-ignore-placement": true,
          }
          const selectedCapsulePaint: SymbolLayerSpecification["paint"] = { "text-color": "#29231f", "text-halo-color": "rgba(255,253,249,.4)", "text-halo-width": 0.5 }
          instance.addLayer({ id: "ondo-selected-pulse-capsule", type: "symbol", source: "ondo-pulse", filter: selectedUnshiftedPulseFilter, layout: selectedCapsuleLayout, paint: selectedCapsulePaint })
          instance.addLayer({ id: "ondo-selected-pulse-capsule-rising", type: "symbol", source: "ondo-pulse", filter: selectedRisingPulseFilter, layout: selectedCapsuleLayout, paint: selectedCapsulePaint })
          instance.addLayer({ id: "ondo-selected-pulse-capsule-warming", type: "symbol", source: "ondo-pulse", filter: selectedWarmingPulseFilter, layout: selectedCapsuleLayout, paint: selectedCapsulePaint })
          instance.addLayer({ id: "ondo-user-location-halo", type: "circle", source: "ondo-user-location", paint: { "circle-color": "rgba(32,32,30,0.16)", "circle-radius": 14, "circle-stroke-color": "rgba(255,255,255,0.9)", "circle-stroke-width": 1 } })
          instance.addLayer({ id: "ondo-user-location-point", type: "circle", source: "ondo-user-location", paint: { "circle-color": "#20201e", "circle-radius": 6, "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 } })

          if (initialCity && !initialFilteredVenue && !filteredMapRef.current && cityRootNode.current) {
            instance.fitBounds(cityOverviewBounds(initialCity, venues, editorialPlaces, sampleEnvironment), {
              padding: cityOverviewPadding(cityRootNode.current),
              maxZoom: CITY[initialCity].zoom,
              pitch: CITY_PERSPECTIVE_PITCH,
              duration: 0,
            })
          } else if (!initialCity && mapNode.current) {
            fitNationOverview(instance, mapNode.current)
            projectCityNodes()
          }

          const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
          if (cityRootNode.current) cityRootNode.current.dataset.pulseMotionApplied = reducedMotion ? "static" : "one-shot"
          const duration = 240
          const pulseHaloLayers = ["ondo-pulse-halo", "ondo-pulse-halo-rising", "ondo-pulse-halo-warming"] as const
          if (reducedMotion) pulseHaloLayers.forEach((layerId) => instance.setPaintProperty(layerId, "circle-opacity", progressiveHaloOpacity))
          else {
            const startedAt = performance.now()
            const anchorBloom = (opacity: number): ExpressionSpecification => ["case", mapAnchor, opacity, 0]
            pulseHaloLayers.forEach((layerId) => instance.setPaintProperty(layerId, "circle-opacity", anchorBloom(0.46)))
            const animatePulse = (timestamp: number) => {
              if (disposed) return
              const progress = Math.min(1, (timestamp - startedAt) / duration)
              const eased = 1 - (1 - progress) ** 3
              pulseHaloLayers.forEach((layerId) => instance.setPaintProperty(layerId, "circle-opacity", anchorBloom(0.46 - eased * 0.26)))
              if (progress < 1) pulseAnimationFrame = window.requestAnimationFrame(animatePulse)
              else pulseHaloLayers.forEach((layerId) => instance.setPaintProperty(layerId, "circle-opacity", progressiveHaloOpacity))
            }
            pulseAnimationFrame = window.requestAnimationFrame(animatePulse)
          }

          const updatePulseMarkerFit = () => {
            if (disposed || !cityRootNode.current) return
            const root = cityRootNode.current
            const rootBox = root.getBoundingClientRect()
            const headerBox = root.querySelector<HTMLElement>("[data-testid='ondo-b-city-header']")?.getBoundingClientRect()
            const utilityBox = root.querySelector<HTMLElement>("[data-testid='ondo-b-map-utility-cluster']")?.getBoundingClientRect()
            const keyBox = root.querySelector<HTMLElement>("[data-testid='ondo-b-map-key']")?.getBoundingClientRect()
            const resultBox = root.querySelector<HTMLElement>("[data-testid='ondo-b-result-bar']")?.getBoundingClientRect()
            const overlayBoxes = [headerBox, utilityBox, keyBox, resultBox].filter((box): box is DOMRect => box != null)
            const pointIsReadable = (pointX: number, pointY: number) => {
              const clientX = rootBox.left + pointX
              const clientY = rootBox.top + pointY
              if (clientX < rootBox.left + 18 || clientX > rootBox.right - 18
                || clientY < rootBox.top + 18 || clientY > rootBox.bottom - 18) return false
              return !overlayBoxes.some((box) => clientX >= box.left - 10 && clientX <= box.right + 10
                && clientY >= box.top - 10 && clientY <= box.bottom + 10)
            }
            const detailSignalsVisible = instance.getZoom() >= 12.35
            const pulseFeatures = instance.querySourceFeatures("ondo-pulse")
              .filter((feature) => feature.geometry.type === "Point"
                && (feature.properties?.entryKind === "editorial" || Number(feature.properties?.pulseScore ?? -1) >= 0)
                && (detailSignalsVisible || feature.properties?.mapAnchor === true))
            const allInside = pulseFeatures.length > 0 && pulseFeatures.every((feature) => {
              if (feature.geometry.type !== "Point") return true
              const point = instance.project(feature.geometry.coordinates as [number, number])
              return pointIsReadable(point.x, point.y)
            })
            const clusterFeatures = instance.queryRenderedFeatures({ layers: ["ondo-clusters"] })
              .filter((feature) => feature.geometry.type === "Point")
            // ONDO temperature is intentionally the primary visual layer. An
            // anchor may overlap the edge of an official group, but the group
            // remains readable when MapLibre still renders its count feature.
            const clustersReadable = clusterFeatures.length > 0
            root.dataset.pulseMarkersReadable = String(allInside)
            root.dataset.pulseOfficialClustersReadable = String(clustersReadable)
          }
          instance.on("moveend", updatePulseMarkerFit)
          // A first idle can occur before the GeoJSON source has exposed its
          // features. Keep this listener live so source updates and mode
          // changes replace that provisional `false` receipt with the actual
          // post-render marker fit.
          instance.on("idle", updatePulseMarkerFit)
          window.setTimeout(updatePulseMarkerFit, 240)
        } catch {
          failMap()
          return
        }
        instance.on("click", "ondo-cluster-hit", async (event: MapLayerMouseEvent) => {
          // Sample cores own their direct hit area; do not also expand an
          // underlying directory cluster during the same pointer gesture.
          if (instance.getLayer("ondo-sample-temperature-hit") && instance.queryRenderedFeatures(event.point, { layers: ["ondo-sample-temperature-hit"] }).length) return
          const feature = event.features?.[0]
          const clusterId = feature?.properties?.cluster_id
          const source = instance.getSource("ondo-directory") as GeoJSONSource
          if (!feature || typeof clusterId !== "number") return
          const zoom = await source.getClusterExpansionZoom(clusterId)
          if (feature.geometry.type === "Point") moveMap(instance, { center: feature.geometry.coordinates as [number, number], zoom })
        })
        instance.on("click", "ondo-points-hit", (event: MapLayerMouseEvent) => {
          if (instance.getLayer("ondo-sample-temperature-hit") && instance.queryRenderedFeatures(event.point, { layers: ["ondo-sample-temperature-hit"] }).length) return
          const id = event.features?.[0]?.properties?.id
          if (typeof id === "string" && CANONICAL_MAP_VENUES_COMPACT.some((venue) => venue.id === id)) {
            openBDiscoveryVenue(id)
            if (!actions.recordRecentVenue(id)) actions.notify(COPY[localeRef.current].recentSaveFailed)
            actions.setSurface({ kind: "venue", venueId: id })
          }
        })
        const pulseInteractiveLayers = ["ondo-pulse-hit", "ondo-pulse-hit-rising", "ondo-pulse-hit-warming"] as const
        pulseInteractiveLayers.forEach((layerId) => {
          instance.on("click", layerId, (event: MapLayerMouseEvent) => {
            const id = event.features?.[0]?.properties?.id
            const entryKind = event.features?.[0]?.properties?.entryKind
            if (entryKind === "editorial") {
              const place = editorialPlaceById(id)
              if (place) openEditorialPlaceDetailRef.current(place)
            } else if (typeof id === "string" && CANONICAL_MAP_VENUES_COMPACT.some((venue) => venue.id === id)) {
              openBDiscoveryVenue(id)
              if (!actions.recordRecentVenue(id)) actions.notify(COPY[localeRef.current].recentSaveFailed)
              actions.setSurface({ kind: "venue", venueId: id })
            }
          })
        })
        instance.on("mouseenter", "ondo-cluster-hit", () => { instance.getCanvas().style.cursor = "pointer" })
        instance.on("mouseenter", "ondo-points-hit", () => { instance.getCanvas().style.cursor = "pointer" })
        pulseInteractiveLayers.forEach((layerId) => instance.on("mouseenter", layerId, () => { instance.getCanvas().style.cursor = "pointer" }))
        instance.on("mouseleave", "ondo-cluster-hit", () => { instance.getCanvas().style.cursor = "" })
        instance.on("mouseleave", "ondo-points-hit", () => { instance.getCanvas().style.cursor = "" })
        pulseInteractiveLayers.forEach((layerId) => instance.on("mouseleave", layerId, () => { instance.getCanvas().style.cursor = "" }))
        if (initialCity && filteredMapRef.current) focusFilteredVenues(instance, venues)
        instance.once("render", () => {
          // An intent can arrive while the MapLibre chunk/style graph is still
          // being built. Keep it visibly pending until the first real canvas
          // paint, then start the camera in that render boundary. Starting
          // inside `style.load` would claim readiness before geography paints;
          // waiting an additional frame here would make the response feel late.
          localFramePainted = true
          const pendingIntentAtFirstPaint = pendingCityIntentRef.current
          if (pendingIntentAtFirstPaint && !currentCityRef.current) {
            instance.getContainer().dataset.cityFocusCameraReadyAt = performance.now().toFixed(2)
            // Do not start an ease while MapLibre is still inside its own
            // first-render stack. That makes the animation compete with the
            // graph's remaining paint work and can stretch a nominal journey
            // well past its hard cap. A microtask begins immediately after
            // that stack unwinds (without adding another animation frame), and
            // re-reads the ref so a newer early tap always wins.
            queueMicrotask(() => {
              if (disposed || currentCityRef.current) return
              const latestPendingIntent = pendingCityIntentRef.current
              if (!latestPendingIntent) return
              flushSync(() => commitCityIntent(latestPendingIntent))
            })
            return
          }
          pulseAnimationFrame = window.requestAnimationFrame(() => {
            if (pendingSemanticPreviewRef.current) previewDiscoveryFocus(pendingSemanticPreviewRef.current.city)
          })
        })
        // `idle` means the initial style, sources and currently visible remote
        // resources have settled. It is the truthful completion boundary;
        // the first local render alone is not a loaded basemap receipt.
        instance.on("idle", () => finishMap())
        instance.triggerRepaint()
      })
    }).catch(failMap)
    return () => {
      disposed = true
      retryAttemptCleanupRef.current?.()
      retryAttemptCleanupRef.current = null
      if (loadDeadline != null) window.clearTimeout(loadDeadline)
      if (progressDelay != null) window.clearTimeout(progressDelay)
      if (pulseAnimationFrame != null) window.cancelAnimationFrame(pulseAnimationFrame)
      if (readyFrame != null) window.cancelAnimationFrame(readyFrame)
      if (readySettleFrame != null) window.cancelAnimationFrame(readySettleFrame)
      if (qaImportDelayTimer != null) window.clearTimeout(qaImportDelayTimer)
      nationControllerRef.current = null
      mapModeRef.current = null
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [actions, retryToken, state.hydrated])

  useLayoutEffect(() => {
    const map = mapRef.current
    const container = mapNode.current
    // Failed remote tiles can leave the local atlas and its projected city
    // controls usable. Keep their geometry fitted after a viewport change too.
    if (!map || !container || city || (mapState !== "ready" && mapState !== "error")) return

    let lastWidth = container.getBoundingClientRect().width
    let lastHeight = container.getBoundingClientRect().height
    let refitSequence = 0
    let refitFrame: number | null = null
    let ownedProjectionCleanup: (() => void) | null = null

    const cancelPendingProjection = () => {
      if (refitFrame != null) window.cancelAnimationFrame(refitFrame)
      refitFrame = null
      if (ownedProjectionCleanup && nationProjectionCleanupRef.current === ownedProjectionCleanup) ownedProjectionCleanup()
      ownedProjectionCleanup = null
    }

    const scheduleNationRefit = (force = false) => {
      if (currentCityRef.current || mapRef.current !== map || mapNode.current !== container) return
      const { width, height } = container.getBoundingClientRect()
      if (width < 1 || height < 1) return
      if (!force && Math.abs(width - lastWidth) < .5 && Math.abs(height - lastHeight) < .5) return
      lastWidth = width
      lastHeight = height
      refitSequence += 1
      const sequence = refitSequence
      cancelPendingProjection()
      const projection = beginNationProjection(map, container)
      ownedProjectionCleanup = projection.cleanup
      refitFrame = window.requestAnimationFrame(() => {
        refitFrame = null
        if (sequence !== refitSequence || !projection.isCurrent()) return
        map.stop()
        map.resize()
        fitNationOverview(map, container)
        const next = container.getBoundingClientRect()
        if (Math.abs(next.width - lastWidth) >= .5 || Math.abs(next.height - lastHeight) >= .5) {
          scheduleNationRefit(true)
          return
        }
        projection.waitForMoveThenPaint()
      })
    }

    const observer = new ResizeObserver(() => scheduleNationRefit())
    const handleWindowResize = () => scheduleNationRefit()
    observer.observe(container)
    window.addEventListener("resize", handleWindowResize)
    return () => {
      refitSequence += 1
      observer.disconnect()
      window.removeEventListener("resize", handleWindowResize)
      cancelPendingProjection()
    }
  }, [beginNationProjection, city, mapState])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (map.getLayer("place-labels")) map.setLayoutProperty("place-labels", "text-field", ondoBasemapLabel(locale))
    const labels = locale === "ko"
      ? { map: "지도", zoomIn: "지도 확대", zoomOut: "지도 축소" }
      : locale === "ja"
        ? { map: "地図", zoomIn: "地図を拡大", zoomOut: "地図を縮小" }
        : { map: "Map", zoomIn: "Zoom in", zoomOut: "Zoom out" }
    const canvas = map.getCanvas()
    canvas.setAttribute("aria-label", labels.map)
    const zoomIn = map.getContainer().querySelector<HTMLElement>(".maplibregl-ctrl-zoom-in")
    const zoomOut = map.getContainer().querySelector<HTMLElement>(".maplibregl-ctrl-zoom-out")
    for (const [control, label] of [[zoomIn, labels.zoomIn], [zoomOut, labels.zoomOut]] as const) {
      if (!control) continue
      control.setAttribute("aria-label", label)
      control.setAttribute("title", label)
    }
    map.triggerRepaint()
  }, [locale, mapState, retryToken])

  useLayoutEffect(() => {
    const map = mapRef.current
    const canvas = map?.getCanvas()
    if (!map || !canvas) return

    // The nation atlas owns the accessible city controls while this persistent
    // canvas only supplies visual geography underneath them. Keep the hidden
    // canvas out of the keyboard tree, then restore native map interaction once
    // a city is open.
    canvas.tabIndex = city ? 0 : -1
    if (city) canvas.removeAttribute("aria-hidden")
    else {
      canvas.setAttribute("aria-hidden", "true")
      const active = document.activeElement
      if (active instanceof HTMLElement && map.getContainer().contains(active)) active.blur()
    }
  }, [city, mapState])

  useEffect(() => {
    const map = mapRef.current
    if (!map || mapState === "idle" || mapState === "error") return
    return registerPlaceReturnCameraReader(() => {
      const center = map.getCenter()
      return {
        longitude: center.lng,
        latitude: center.lat,
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
      }
    })
  }, [mapState, retryToken])

  useEffect(() => {
    const map = mapRef.current
    if (!map || mapState !== "ready") return
    const reflectPerspective = () => {
      const pitch = map.getPitch()
      setMapTilted(pitch > 8)
      map.getContainer().dataset.mapPitch = pitch.toFixed(1)
      const relief = map.getLayer("buildings-relief")
      map.getContainer().dataset.buildingRelief = relief?.type ?? "none"
      const visibleBuildings = relief && map.getZoom() >= 14
        ? map.queryRenderedFeatures({ layers: ["buildings-relief"] }).filter((feature) => Number(feature.properties.render_height) > Number(feature.properties.render_min_height ?? 0))
        : []
      map.getContainer().dataset.visibleBuildingReliefCount = String(visibleBuildings.length)
    }
    reflectPerspective()
    map.on("moveend", reflectPerspective)
    map.on("idle", reflectPerspective)
    return () => { map.off("moveend", reflectPerspective); map.off("idle", reflectPerspective) }
  }, [mapState, retryToken])

  useEffect(() => {
    const map = mapRef.current
    if (!city || !map || mapState !== "ready") return
    const preserveCamera = () => {
      // A final MapLibre `moveend` can arrive after the shell has already
      // traversed back to a My Korea origin. That retired map must not replace
      // the saved origin's exact discovery context (or its return receipt).
      const activeHistory = readBDiscoveryHistory()
      if (readMyKoreaPlaceReturnNavigation()?.receipt.phase === "origin"
        || activeHistory?.level !== "city"
        || activeHistory.city !== city) return
      replaceBDiscoveryCityContext({
        city,
        view,
        query,
        category,
        editorialCategory,
        layer: after19ThemeActive ? "after19" : "standard",
        listScroll: listPanelRef.current?.scrollTop ?? pendingListScrollRef.current,
        camera: cameraSnapshot(map),
      })
    }
    map.on("moveend", preserveCamera)
    return () => { map.off("moveend", preserveCamera) }
  }, [after19ThemeActive, category, city, editorialCategory, mapState, query, view])

  useEffect(() => {
    if (!city) return
    const current = normalizeBDiscoveryHistoryForActiveDocument()
    if (!current || current.city !== city || current.layer === (after19ThemeActive ? "after19" : "standard")) return
    replaceBDiscoveryCityContext({
      city,
      view,
      query,
      category,
      editorialCategory,
      layer: after19ThemeActive ? "after19" : "standard",
      listScroll: current.listScroll,
      ...(current.camera ? { camera: current.camera } : {}),
    })
  }, [after19ThemeActive, category, city, editorialCategory, query, view])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.getLayer("ondo-night-dim")) return
    const baseDark = state.resolvedAppearance === "dark"
    const basemapPalette = ondoMapPalette(state.resolvedAppearance, after19ThemeActive)
    const overviewSignalColor = baseDark ? OVERVIEW_SIGNAL_COLOR_DARK : OVERVIEW_SIGNAL_COLOR_LIGHT
    const officialColor: ExpressionSpecification = after19ThemeActive
      ? ["case", AFTER19_ELIGIBLE_FILTER, AFTER19_PULSE_LEVEL_EXPRESSION, PULSE_LEVEL_EXPRESSION]
      : PULSE_LEVEL_EXPRESSION
    const color: ExpressionSpecification = [
      "case",
      ["==", ["get", "signalKind"], "verified-editorial"], EDITORIAL_COVERAGE_COLOR,
      officialColor,
    ]
    // The Thermal Lens owns only cartography and temperature signals. Global
    // Light/Dark continues to own navigation, sheets and application chrome.
    // A cool moonlit base keeps roads legible without reading as global Dark.
    map.setPaintProperty("ondo-night-dim", "fill-opacity", 0)
    map.setPaintProperty("canvas", "background-color", basemapPalette.canvas)
    map.setPaintProperty("park", "fill-color", basemapPalette.park)
    map.setPaintProperty("park", "fill-opacity", basemapPalette.parkOpacity)
    map.setPaintProperty("water", "fill-color", basemapPalette.water)
    map.setPaintProperty("buildings", "fill-color", basemapPalette.building)
    map.setPaintProperty("buildings", "fill-outline-color", basemapPalette.buildingLine)
    map.setPaintProperty("buildings", "fill-opacity", basemapPalette.buildingOpacity)
    if (map.getLayer("buildings-relief")) {
      map.setPaintProperty("buildings-relief", "fill-extrusion-color", basemapPalette.buildingExtrusion)
      map.setPaintProperty("buildings-relief", "fill-extrusion-opacity", basemapPalette.buildingExtrusionOpacity)
    }
    if (map.hasImage(SELECTED_CAPSULE_IMAGE_ID)) map.updateImage(SELECTED_CAPSULE_IMAGE_ID, selectedCapsuleImage(baseDark))
    map.setPaintProperty("roads-minor", "line-color", basemapPalette.minorRoad)
    map.setPaintProperty("roads-major", "line-color", basemapPalette.majorRoad)
    map.setPaintProperty("roads-secondary", "line-color", basemapPalette.secondaryRoad)
    map.setPaintProperty("city-boundaries", "line-color", basemapPalette.boundary)
    map.setPaintProperty("place-labels", "text-color", basemapPalette.label)
    map.setPaintProperty("place-labels", "text-halo-color", basemapPalette.labelHalo)
    map.setPaintProperty("place-labels", "text-halo-width", basemapPalette.labelHaloWidth)
    if (map.getLayer("ondo-korea-land-fill")) map.setPaintProperty("ondo-korea-land-fill", "fill-color", baseDark ? "#17191b" : "#fcfcfa")
    if (map.getLayer("ondo-overview-route-halo")) map.setPaintProperty("ondo-overview-route-halo", "line-color", baseDark ? "rgba(17,19,21,.12)" : "rgba(255,255,255,.84)")
    if (map.getLayer("ondo-overview-route")) map.setPaintProperty("ondo-overview-route", "line-color", baseDark ? "rgba(211,207,201,.56)" : "rgba(87,79,73,.46)")
    if (map.getLayer("ondo-korea-coastline")) map.setPaintProperty("ondo-korea-coastline", "line-color", baseDark ? "rgba(226,228,230,.68)" : "rgba(78,73,68,.58)")
    if (map.getLayer("ondo-overview-city-aura")) map.setPaintProperty("ondo-overview-city-aura", "circle-color", overviewSignalColor)
    if (map.getLayer("ondo-overview-city-core")) {
      map.setPaintProperty("ondo-overview-city-core", "circle-color", overviewSignalColor)
      map.setPaintProperty("ondo-overview-city-core", "circle-stroke-color", baseDark ? "#111315" : "#fff")
    }
    if (map.getLayer("ondo-temperature-field")) {
      map.setPaintProperty("ondo-temperature-field", "heatmap-color", city === "jeju" ? EDITORIAL_COVERAGE_HEAT_COLOR : PULSE_HEAT_COLOR)
      map.setPaintProperty("ondo-temperature-field", "heatmap-opacity", after19ThemeActive
        ? ["interpolate", ["linear"], ["zoom"], 8, 0.08, 12, 0.14, 15, 0.08]
        : ["interpolate", ["linear"], ["zoom"], 8, 0.3, 12, 0.45, 15, 0.25])
    }
    if (map.getLayer("ondo-after19-eligible-field")) {
      map.setPaintProperty("ondo-after19-eligible-field", "heatmap-opacity", after19ThemeActive
        ? ["interpolate", ["linear"], ["zoom"], 8, 0.28, 12, 0.46, 15, 0.26]
        : 0)
    }
    if (map.getLayer("ondo-after19-eligible-points")) {
      map.setPaintProperty("ondo-after19-eligible-points", "circle-opacity", after19ThemeActive ? 0.96 : 0)
    }
    for (const layerId of [
      "ondo-pulse-halo", "ondo-pulse-halo-rising", "ondo-pulse-halo-warming",
      "ondo-pulse-points", "ondo-pulse-points-rising", "ondo-pulse-points-warming",
      "ondo-selected-pulse-outer", "ondo-selected-pulse-outer-rising", "ondo-selected-pulse-outer-warming",
      "ondo-selected-pulse", "ondo-selected-pulse-rising", "ondo-selected-pulse-warming",
    ]) {
      if (map.getLayer(layerId)) map.setPaintProperty(layerId, "circle-color", color)
    }
    if (map.getLayer("ondo-clusters")) {
      map.setPaintProperty("ondo-clusters", "circle-color", baseDark ? "rgba(31,34,38,.88)" : "rgba(255,255,255,.84)")
      map.setPaintProperty("ondo-clusters", "circle-stroke-color", after19ThemeActive
        ? ["step", ["get", "point_count"], baseDark ? "rgba(233,231,238,.42)" : "rgba(112,71,99,.32)", 15, "rgba(194,79,99,.52)", 50, "rgba(152,42,101,.72)"]
        : baseDark
          ? ["step", ["get", "point_count"], "rgba(255,255,255,.30)", 15, "rgba(230,132,59,.48)", 50, "rgba(196,72,70,.62)"]
          : ["step", ["get", "point_count"], "rgba(74,70,65,.30)", 15, "rgba(155,68,52,.38)", 50, "rgba(122,32,72,.48)"])
    }
    if (map.getLayer("ondo-points")) map.setPaintProperty("ondo-points", "circle-color", baseDark ? "#aeb4ba" : "#716d67")
    if (map.getLayer("ondo-personalized-keyline")) map.setPaintProperty("ondo-personalized-keyline", "circle-stroke-color", baseDark ? "rgba(255,247,251,.92)" : "rgba(24,23,21,.9)")
    for (const layerId of ["ondo-selected-pulse-capsule", "ondo-selected-pulse-capsule-rising", "ondo-selected-pulse-capsule-warming"]) {
      if (!map.getLayer(layerId)) continue
      map.setPaintProperty(layerId, "text-color", baseDark ? "#f3f5f7" : "#29231f")
      map.setPaintProperty(layerId, "text-halo-color", baseDark ? "rgba(12,14,16,.72)" : "rgba(255,255,255,.4)")
      map.setPaintProperty(layerId, "text-halo-width", 0.5)
    }
  }, [after19ThemeActive, city, mapState, state.resolvedAppearance])

  useEffect(() => {
    const directorySource = mapRef.current?.getSource("ondo-directory") as GeoJSONSource | undefined
    const after19LensSource = mapRef.current?.getSource("ondo-after19-lens") as GeoJSONSource | undefined
    const pulseSource = mapRef.current?.getSource("ondo-pulse") as GeoJSONSource | undefined
    if (directorySource && city) {
      const venueFeatures = toFeatureCollection(venues, state.localPulseEvidenceByVenue, selectedVenueId, personalMatchCountByVenue)
      void directorySource.setData(venueFeatures)
      if (after19LensSource) void after19LensSource.setData(venueFeatures)
      if (pulseSource) void pulseSource.setData(collection ? { type: "FeatureCollection", features: [] } : toTemperatureFeatureCollection(city, venues, state.localPulseEvidenceByVenue, locale, selectedVenueId, selectedEditorialPlaceId, editorialPlaces))
      const filterSignature = collectionFilterSignature(city, query, category, editorialCategory, balancePlacesActive, collection, after19ThemeActive)
      const filterChanged = filterCameraSignatureRef.current !== filterSignature
      filterCameraSignatureRef.current = filterSignature
      if (collection && filterChanged) window.requestAnimationFrame(() => {
        // Let the responsive header/tray finish the same React commit before
        // reading their bounds, especially when entering a short landscape.
        if (mapRef.current && readBDiscoveryHistory()?.collection === collection) focusCollectionPlaces(mapRef.current, collectionPlaces)
      })
      else if (filteredMap && filterChanged && !selectedVenueId) focusFilteredVenues(mapRef.current!, [
        ...venues, ...researchedFoods,
        ...(city === "jeju" ? editorialPlaces.map(place => place.location) : []),
      ])
    } else if (directorySource && !city) {
      void directorySource.setData({ type: "FeatureCollection", features: [] })
      if (after19LensSource) void after19LensSource.setData({ type: "FeatureCollection", features: [] })
      if (pulseSource) void pulseSource.setData({ type: "FeatureCollection", features: [] })
    }
  // `venues` can change while MapLibre is still loading (for example when a
  // user types a search immediately after entering a city). In that case the
  // source does not exist yet and this effect returns early. Re-run once the
  // map reaches `ready` so the source and camera always receive the current
  // filtered collection instead of the load callback's initial closure.
  }, [after19ThemeActive, balancePlacesActive, category, city, collection, collectionPlaces, editorialCategory, editorialPlaces, filteredMap, locale, mapState, personalMatchCountByVenue, query, selectedEditorialPlaceId, selectedVenueId, state.localPulseEvidenceByVenue, venues, researchedFoods])

  useLayoutEffect(() => {
    const map = mapRef.current
    if (!map || mapState === "idle" || !map.getLayer("ondo-overview-city-core")) return
    const nextMode: CityId | "nation" = city ?? "nation"
    if (mapModeRef.current === nextMode) return
    const isInitialMode = mapModeRef.current == null
    mapModeRef.current = nextMode
    const nationProjection = nextMode === "nation"
      ? beginNationProjection(map, map.getContainer())
      : null
    if (!nationProjection) {
      nationProjectionCleanupRef.current?.()
      nationProjectionGenerationRef.current += 1
      map.getContainer().dataset.mapProjectionGeneration = String(nationProjectionGenerationRef.current)
      map.getContainer().dataset.mapProjectionSettled = "false"
      delete map.getContainer().dataset.mapProjectionSettledGeneration
    }
    map.stop()
    const overviewLayers = ["ondo-korea-land-fill", "ondo-overview-route-halo", "ondo-overview-route", "ondo-korea-coastline", "ondo-overview-city-aura", "ondo-overview-city-core"]
    const cityLayers = map.getStyle().layers
      .map(({ id }) => id)
      .filter((id) => id.startsWith("ondo-") && !overviewLayers.includes(id) && id !== "ondo-night-dim")
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const pendingHistoryCamera = city && pendingHistoryCameraRef.current?.city === city
      ? pendingHistoryCameraRef.current.camera
      : null
    const animateCityEntry = Boolean(city && entryTransitionCity === city && !reducedMotion && !pendingHistoryCamera)
    const setFinalModeLayers = () => {
      for (const layerId of overviewLayers) if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", city ? "none" : "visible")
      for (const layerId of cityLayers) if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", city && !(sampleEnvironment && SNAPSHOT_SIGNAL_LAYERS.has(layerId)) ? "visible" : "none")
    }
    if (animateCityEntry) {
      // Keep the already-painted atlas geography during the camera journey.
      // Rendering every city heat/halo/symbol layer while MapLibre is also
      // fetching and zooming can starve frames on mobile software renderers.
      // City layers appear at the destination; the persistent basemap never
      // blanks or swaps.
      for (const layerId of overviewLayers) if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", "visible")
      for (const layerId of cityLayers) if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", "none")
    } else {
      setFinalModeLayers()
    }
    const gestureHandlers = [map.scrollZoom, map.boxZoom, map.dragRotate, map.dragPan, map.keyboard, map.doubleClickZoom, map.touchZoomRotate]
    gestureHandlers.forEach((handler) => city ? handler.enable() : handler.disable())
    map.getContainer().dataset.mapMode = city ? "city" : "nation"
    map.resize()
    if (city) {
      const requestedAt = Number(map.getContainer().dataset.cityFocusRequestedAt ?? performance.now())
      const startedAt = performance.now()
      map.getContainer().dataset.cityFocusStartedAt = startedAt.toFixed(2)
      map.getContainer().dataset.cityFocusStartDelay = Math.max(0, startedAt - requestedAt).toFixed(2)
      map.getContainer().dataset.cityFocusTarget = city
      map.getContainer().dataset.cityFocusDuration = reducedMotion ? "0" : String(CITY_FOCUS_DURATION_MS)
      map.getContainer().dataset.cityFocusPhase = "active"
      const root = cityRootNode.current
      const camera = root
        ? map.cameraForBounds(cityOverviewBounds(city, venues, editorialPlaces, sampleEnvironment), {
            padding: cityOverviewPadding(root),
            maxZoom: CITY[city].zoom,
          })
        : null
      const historyCamera = pendingHistoryCamera
      pendingHistoryCameraRef.current = null
      const destination = historyCamera
        ? { center: [historyCamera.longitude, historyCamera.latitude] as [number, number], zoom: historyCamera.zoom, bearing: historyCamera.bearing, pitch: historyCamera.pitch }
        : { ...(camera ?? { center: CITY[city].center, zoom: CITY[city].zoom }), pitch: CITY_PERSPECTIVE_PITCH, bearing: 0 }
      if (entryTransitionCity !== city || historyCamera) map.jumpTo(destination)
      else moveMap(map, {
        ...destination,
        easing: (progress) => progress < .5 ? 4 * progress ** 3 : 1 - ((-2 * progress + 2) ** 3) / 2,
      })
      entryTransitionCleanupRef.current?.()
      let settled = false
      let settleFrame: number | null = null
      let settleGuard: number | null = null
      const settle = () => {
        if (settled) return
        settled = true
        if (settleFrame != null) window.cancelAnimationFrame(settleFrame)
        if (settleGuard != null) window.clearTimeout(settleGuard)
        map.off("moveend", settle)
        // This receipt measures the camera boundary only. Record it before
        // synchronously publishing the destination's richer marker layers;
        // their reveal is presentation work, not additional camera travel.
        map.getContainer().dataset.cityFocusPhase = "settled"
        map.getContainer().dataset.cityFocusSettledAt = performance.now().toFixed(2)
        if (animateCityEntry) {
          setFinalModeLayers()
          map.triggerRepaint()
        }
        setEntryTransitionCity((active) => active === city ? null : active)
      }
      const cleanup = () => {
        if (settleFrame != null) window.cancelAnimationFrame(settleFrame)
        if (settleGuard != null) window.clearTimeout(settleGuard)
        map.off("moveend", settle)
        if (entryTransitionCleanupRef.current === cleanup) entryTransitionCleanupRef.current = null
      }
      entryTransitionCleanupRef.current = cleanup
      if (reducedMotion) settleFrame = window.requestAnimationFrame(settle)
      else {
        map.once("moveend", settle)
        // This guard starts only when the real camera starts. An early tap can
        // remain visibly pending while MapLibre loads, but can never be marked
        // settled before a camera journey exists.
        settleGuard = window.setTimeout(settle, CITY_FOCUS_SETTLE_GUARD_MS)
      }
    } else if (mapNode.current) {
      // The first frame should already be the real Korea map. Animating from
      // MapLibre's constructor camera makes the projected city targets drift
      // under a pointer before the user has done anything. Keep the initial
      // fit atomic; only the deliberate city/back journey owns camera motion.
      fitNationOverview(map, mapNode.current, reducedMotion || isInitialMode ? 0 : NATION_RETURN_DURATION_MS)
      nationProjection?.waitForMoveThenPaint()
    }
  }, [beginNationProjection, city, editorialPlaces, entryTransitionCity, mapState, sampleEnvironment, venues])

  useEffect(() => {
    const map = mapRef.current
    if (!map || mapState !== "ready") return
    const visible = Boolean(city && !collection && !sampleEnvironment && entryTransitionCity !== city)
    for (const layer of SNAPSHOT_SIGNAL_LAYERS) {
      if (map.getLayer(layer)) map.setLayoutProperty(layer, "visibility", visible ? "visible" : "none")
    }
  }, [city, collection, entryTransitionCity, mapState, sampleEnvironment])

  useLayoutEffect(() => {
    const pending = pendingHistoryCameraRef.current
    const map = mapRef.current
    if (!pending || pending.city !== city || !map || mapModeRef.current !== city) return
    pendingHistoryCameraRef.current = null
    map.stop()
    map.jumpTo({
      center: [pending.camera.longitude, pending.camera.latitude],
      zoom: pending.camera.zoom,
      bearing: pending.camera.bearing,
      pitch: pending.camera.pitch,
    })
    map.getContainer().dataset.historyCamera = "restored"
  }, [city, historyRestoreVersion, mapState])

  useLayoutEffect(() => {
    if (!pendingReturnUi || mapState !== "ready" || selectedVenueId !== pendingReturnUi.venueId) return
    const map = mapRef.current
    if (!map) return
    map.stop()
    map.jumpTo({
      center: [pendingReturnUi.camera.longitude, pendingReturnUi.camera.latitude],
      zoom: pendingReturnUi.camera.zoom,
      bearing: pendingReturnUi.camera.bearing,
      pitch: pendingReturnUi.camera.pitch,
    })
    map.getContainer().dataset.placeReturnCamera = "restored"
    setPendingReturnUi(null)
  }, [mapState, pendingReturnUi, selectedVenueId])

  useEffect(() => {
    if (effectiveView !== "map" || !mapRef.current) return
    const frame = window.requestAnimationFrame(() => mapRef.current?.resize())
    return () => window.cancelAnimationFrame(frame)
  }, [effectiveView])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !collection || effectiveView !== "map") return
    // Only viewport changes reframe an open collection. Ordinary renders,
    // pin selection and Back retain the user's pan/zoom exactly.
    const container = map.getContainer()
    let previous = { width: container.clientWidth, height: container.clientHeight }
    let frame = 0
    const observer = new ResizeObserver(() => {
      const next = { width: container.clientWidth, height: container.clientHeight }
      if (next.width === previous.width && next.height === previous.height) return
      previous = next
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => { map.resize(); focusCollectionPlaces(map, collectionPlaces) })
    })
    observer.observe(container)
    return () => { observer.disconnect(); window.cancelAnimationFrame(frame) }
  }, [collection, collectionPlaces, effectiveView, mapState])

  useLayoutEffect(() => {
    if (effectiveView !== "list" || !listPanelRef.current) return
    const list = listPanelRef.current
    const scrollTop = pendingListScrollRef.current
    const frame = window.requestAnimationFrame(() => list.scrollTo({ top: scrollTop, behavior: "auto" }))
    return () => window.cancelAnimationFrame(frame)
  }, [city, effectiveView])

  useEffect(() => {
    userLocationRef.current = userLocation
    const source = mapRef.current?.getSource("ondo-user-location") as GeoJSONSource | undefined
    if (source) void source.setData(toUserLocationFeatureCollection(userLocation))
  }, [userLocation])

  function commitCityIntent(intent: PendingCityIntent, { allowWithoutCamera = false }: { allowWithoutCamera?: boolean } = {}) {
    const map = mapRef.current
    const cameraReady = Boolean(map?.getLayer("ondo-overview-city-core"))
    const mapContainer = map?.getContainer() ?? mapNode.current
    if (mapContainer) {
      mapContainer.dataset.cityFocusRequestedAt = intent.requestedAt.toFixed(2)
      mapContainer.dataset.cityFocusTarget = intent.city
      mapContainer.dataset.cityFocusPhase = cameraReady ? "requested" : "pending"
      delete mapContainer.dataset.cityFocusSettledAt
    }
    if (!cameraReady && !allowWithoutCamera) {
      pendingCityIntentRef.current = intent
      return false
    }
    pendingCityIntentRef.current = null
    const next = intent.city
    const nextCategory: BDiscoveryCategory = "all"
    setEntryTransitionCity(cameraReady ? next : null)
    map?.stop()
    pendingCityFocusRef.current = next
    pendingCityKeyboardFocusRef.current = intent.keyboardModality
    if (intent.historyMode === "replace" && currentCityRef.current) {
      replaceBDiscoveryCityContext({ city: next, view: "map", query: "", category: nextCategory, editorialCategory: "all", layer: after19ThemeActive ? "after19" : "standard", listScroll: 0, collection: null, collectionSelection: null })
    } else {
      enterBDiscoveryCity(next)
    }
    setCity(next)
    setView("map")
    setQuery("")
    setCollection(null)
    setCollectionSelection(null)
    setCollectionDetailId(null)
    setSelectedResearchId(null)
    setDiscoverySearchOpen(false)
    searchOriginRef.current = null
    setCategory(nextCategory)
    setEditorialCategory("all")
    replaceBDiscoveryCityContext({ city: next, view: "map", query: "", category: nextCategory, editorialCategory: "all", layer: after19ThemeActive ? "after19" : "standard", listScroll: 0, collection: null, collectionSelection: null })
    return true
  }

  function chooseCity(next: CityId, keyboardModality = false, requestedAt = performance.now()) {
    commitCityIntent({ city: next, keyboardModality, requestedAt })
  }

  function previewDiscoveryFocus(requestedCity: CityId | null) {
    const map = mapRef.current
    if (!map?.getLayer("ondo-overview-city-core")) {
      pendingSemanticPreviewRef.current = { city: requestedCity }
      if (mapNode.current) {
        mapNode.current.dataset.semanticPreviewTarget = requestedCity ?? "nation"
        mapNode.current.dataset.semanticPreviewPhase = "pending"
      }
      return false
    }
    pendingSemanticPreviewRef.current = null
    map.stop()
    const container = map.getContainer()
    const target = requestedCity ?? "nation"
    const previewSequence = semanticFocusSequenceRef.current
    container.dataset.semanticPreviewTarget = target
    container.dataset.semanticPreviewPhase = "active"
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const { width, height } = container.getBoundingClientRect()
    const previewPadding = width <= 430
      ? { top: 80, right: 32, bottom: Math.min(340, Math.round(height * .43)), left: 32 }
      : { top: 72, right: 48, bottom: Math.min(280, Math.round(height * .32)), left: 48 }
    const settle = () => {
      if (semanticFocusSequenceRef.current === previewSequence && container.dataset.semanticPreviewTarget === target) {
        container.dataset.semanticPreviewPhase = "settled"
      }
    }
    map.once("moveend", settle)
    if (requestedCity) {
      const previewVenues = MAP_VENUES.filter((venue) => venue.cityId === requestedCity)
      const camera = map.cameraForBounds(cityOverviewBounds(requestedCity, previewVenues, JEJU_EDITORIAL_PLACES), {
        padding: previewPadding,
        maxZoom: Math.max(8.2, CITY[requestedCity].zoom - .8),
      })
      const destination = camera ?? { center: CITY[requestedCity].center, zoom: CITY[requestedCity].zoom - .8 }
      moveMap(map, destination)
    } else {
      map.fitBounds([[124.4, 32.2], [131.6, 39.4]], {
        padding: previewPadding,
        maxZoom: 6.2,
        duration: reducedMotion ? 0 : NATION_RETURN_DURATION_MS,
      })
    }
    if (reducedMotion) window.requestAnimationFrame(settle)
    else window.setTimeout(settle, CITY_FOCUS_SETTLE_GUARD_MS)
    return true
  }

  semanticFocusHandlerRef.current = (requestedCity) => {
    previewDiscoveryFocus(requestedCity)
  }

  function selectVenue(venue: CanonicalMapVenue) {
    if (listScrollTimerRef.current != null) {
      window.clearTimeout(listScrollTimerRef.current)
      listScrollTimerRef.current = null
    }
    const listScroll = Math.max(0, Math.round(listPanelRef.current?.scrollTop ?? pendingListScrollRef.current))
    pendingListScrollRef.current = listScroll
    const camera = mapRef.current ? cameraSnapshot(mapRef.current) : undefined
    replaceBDiscoveryCityContext({
      city: venue.cityId,
      view,
      query,
      category,
      editorialCategory,
      layer: after19ThemeActive ? "after19" : "standard",
      listScroll,
      ...(camera ? { camera } : {}),
      focus: { kind: "venue", venueId: venue.id },
    })
    openBDiscoveryVenue(venue.id)
    if (!actions.recordRecentVenue(venue.id)) actions.notify(copy.recentSaveFailed)
    actions.setSurface({ kind: "venue", venueId: venue.id })
    if (mapRef.current) moveMap(mapRef.current, { center: [venue.longitude, venue.latitude], zoom: 15 })
  }

  function focusEditorialPlace(place: EditorialPlaceB) {
    if (city !== "jeju") return false
    replaceBDiscoveryCityContext({ city: "jeju", view, query, category, editorialCategory, layer: after19ThemeActive ? "after19" : "standard", listScroll: listPanelRef.current?.scrollTop ?? pendingListScrollRef.current, focus: { kind: "editorial-place", editorialPlaceId: place.id } })
    if (!openBDiscoveryEditorialPlace(place.id)) return false
    if (!actions.recordRecentEditorialPlace(place.id)) actions.notify(copy.recentSaveFailed)
    setSelectedEditorialPlaceId(place.id)
    actions.setSurface({ kind: "map" })
    setEditorialOpen(false)
    if (mapRef.current) moveMap(mapRef.current, { center: [place.location.longitude, place.location.latitude], zoom: 15 })
    return true
  }

  function openEditorialPlaceDetail(place: EditorialPlaceB) {
    if (!focusEditorialPlace(place)) return
    actions.setSurface({ kind: "editorial_place", editorialPlaceId: place.id })
  }
  openEditorialPlaceDetailRef.current = openEditorialPlaceDetail

  function adoptCollectionEntry(entry: BDiscoveryHistoryEntry) {
    setCollection(entry.collection ?? null)
    setCollectionSelection(entry.collectionSelection ?? null)
    setCollectionDetailId(null)
    setSelectedResearchId(null)
    setSelectedEditorialPlaceId(null)
    setQuery(entry.query)
    setCategory(entry.category)
    setEditorialCategory(entry.editorialCategory)
    setView(entry.view)
    setEditorialOpen(false)
    setMapOptionsOpen(false)
    setDiscoverySearchOpen(false)
    searchOriginRef.current = null
    actions.setSurface({ kind: "map" })
    if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur()
  }

  function openDiscoveryCollection(id: DiscoveryCollectionIdB) {
    if (!city) return
    // Typing 'hot' must not make Back return to a half-entered 'ho' search.
    // Keep the pre-search context in the app's existing history, not a second router.
    const origin = searchOriginRef.current
    if ((id === "hot" || id === "cool") && origin?.city === city && origin.level === "city") replaceBDiscoveryHistoryForActiveDocument(origin)
    else updateCityContext({ camera: mapRef.current ? cameraSnapshot(mapRef.current) : undefined })
    const entry = openBDiscoveryCollection(id)
    if (entry) adoptCollectionEntry(entry)
  }

  function selectCollectionPin(id: string) {
    if (!collectionPlaces.some(place => place.id === id)) return
    setCollectionSelection(id)
    updateCityContext({ collectionSelection: id })
  }

  function openCollectionPlace(id: string) {
    if (!collectionPlaces.some(place => place.id === id)) return
    selectCollectionPin(id)
    updateCityContext({ collectionSelection: id, camera: mapRef.current ? cameraSnapshot(mapRef.current) : undefined })
    const editorial = editorialPlaceById(id)
    if (editorial) { openEditorialPlaceDetail(editorial); return }
    if (!openBDiscoveryCollectionPlace(id)) return
    setCollectionDetailId(id)
    setSelectedResearchId(researchedFoodByIdB(id) ? id : null)
  }

  function closeCollectionPlace() {
    if (readBDiscoveryHistory()?.discoveryPlaceId && goBackFromBDiscovery("peek")) return
    setCollectionDetailId(null)
    setSelectedResearchId(null)
    setResearchReturnFocus(null)
  }

  function editDiscoveryQuery(nextQuery: string) {
    setQuery(nextQuery)
    setCollection(null)
    setCollectionSelection(null)
    setCollectionDetailId(null)
    updateCityContext({ query: nextQuery, collection: null, collectionSelection: null })
  }

  function updateCityContext(next: { view?: ViewMode; query?: string; category?: BDiscoveryCategory; editorialCategory?: BDiscoveryEditorialCategory; listScroll?: number; camera?: BDiscoveryCamera; collection?: DiscoveryCollectionIdB | null; collectionSelection?: string | null }) {
    if (!city) return
    replaceBDiscoveryCityContext({
      city,
      view: next.view ?? view,
      query: next.query ?? query,
      category: next.category ?? category,
      editorialCategory: next.editorialCategory ?? editorialCategory,
      layer: after19ThemeActive ? "after19" : "standard",
      listScroll: next.listScroll ?? listPanelRef.current?.scrollTop ?? pendingListScrollRef.current,
      ...(next.camera ? { camera: next.camera } : {}),
      ...(next.collection !== undefined ? { collection: next.collection } : {}),
      ...(next.collectionSelection !== undefined ? { collectionSelection: next.collectionSelection } : {}),
    })
  }

  serviceCaptureRef.current = (placeId) => {
    const place = resolveCommercePlaceB(placeId)
    if (!city || !place || place.cityId !== city) return false
    const detail = place.originKind === "research"
      ? document.querySelector<HTMLElement>("[data-testid='researched-food-detail']")?.closest<HTMLElement>("[data-sheet-scroll-owner]")
      : document.querySelector<HTMLElement>("[data-place-service-scroll]")
    const camera = mapRef.current ? cameraSnapshot(mapRef.current) : undefined
    const listScroll = listPanelRef.current?.scrollTop ?? pendingListScrollRef.current
    const history = readBDiscoveryHistory()
    serviceMapSnapshotsRef.current.set(placeId, {
      placeId, city, view, query, category, editorialCategory, balancePlacesOnly, collection, collectionSelection,
      listScroll, camera,
      history: history ? { ...history, listScroll, ...(camera ? { camera } : {}) } : null,
      detailScroll: detail?.scrollTop ?? 0,
      expandedDisclosures: Array.from(detail?.querySelectorAll<HTMLDetailsElement>("details[open][data-testid]") ?? []).map(node => node.dataset.testid!).filter(Boolean),
    })
    return true
  }

  serviceReturnRef.current = (event) => {
    const detail: unknown = event instanceof CustomEvent ? event.detail : null
    if (!detail || typeof detail !== "object" || !("placeId" in detail)) return
    const place = resolveCommercePlaceB(detail.placeId)
    if (!place) return
    const snapshot = serviceMapSnapshotsRef.current.get(place.id)
    actions.setTab("ondo")
    if (snapshot) {
      setCity(snapshot.city)
      setView(snapshot.view)
      setQuery(snapshot.query)
      setCategory(snapshot.category)
      setEditorialCategory(snapshot.editorialCategory)
      setBalancePlacesOnly(snapshot.balancePlacesOnly)
      setCollection(snapshot.collection)
      setCollectionSelection(snapshot.collectionSelection)
      setCollectionDetailId(snapshot.history?.discoveryPlaceId ?? null)
      pendingListScrollRef.current = snapshot.listScroll
      pendingHistoryCameraRef.current = snapshot.camera ? { city: snapshot.city, camera: snapshot.camera } : null
      filterCameraSignatureRef.current = collectionFilterSignature(snapshot.city, snapshot.query, snapshot.category, snapshot.editorialCategory, snapshot.balancePlacesOnly, snapshot.collection, after19ThemeActive)
      if (snapshot.history) replaceBDiscoveryHistoryForActiveDocument(snapshot.history)
      setHistoryRestoreVersion(version => version + 1)
    } else if (city !== place.cityId) {
      chooseCity(place.cityId)
    }
    setSelectedResearchId(place.originKind === "research" ? place.id : null)
    const editorial = place.originKind === "editorial" ? editorialPlaceById(place.id) : null
    setSelectedEditorialPlaceId(editorial?.id ?? null)
    if (place.originKind === "canonical") actions.setSurface({ kind: "venue", venueId: place.id })
    else if (editorial) actions.setSurface({ kind: "editorial_place", editorialPlaceId: editorial.id })
    else actions.setSurface({ kind: "map" })
    const focus = "focus" in detail && (detail.focus === "reservation" || detail.focus === "table" || detail.focus === "experience") ? detail.focus : "offer"
    setResearchReturnFocus(place.originKind === "research" ? { placeId: place.id, focus: focus === "experience" ? "offer" : focus } : null)
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      if (snapshot && listPanelRef.current) listPanelRef.current.scrollTop = snapshot.listScroll
      const scroll = place.originKind === "research"
        ? document.querySelector<HTMLElement>("[data-testid='researched-food-detail']")?.closest<HTMLElement>("[data-sheet-scroll-owner]")
        : document.querySelector<HTMLElement>("[data-place-service-scroll]")
      if (scroll && snapshot) {
        // Restore only named disclosures in this place's scroll owner before
        // restoring its position; collapsed content would clamp scrollTop.
        const expanded = new Set(snapshot.expandedDisclosures ?? [])
        scroll.querySelectorAll<HTMLDetailsElement>("details[data-testid]").forEach(node => {
          node.open = expanded.has(node.dataset.testid ?? "")
        })
        scroll.scrollTop = snapshot.detailScroll
      }
      const target = document.querySelector<HTMLElement>(`[data-place-service='${focus}']`)
      if (focus === "experience" && target && scroll) {
        // A resized viewport can put the restored row below the visible sheet.
        // Keep the original position unless this specific return focus is hidden.
        const row = target.getBoundingClientRect()
        const owner = scroll.getBoundingClientRect()
        if (row.top < Math.max(0, owner.top) || row.bottom > Math.min(window.innerHeight, owner.bottom)) {
          target.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" })
        }
      }
      target?.focus({ preventScroll: true })
    }))
  }

  function clearBalancePlaces() {
    setBalancePlacesOnly(false)
    const previous = balanceFilterReturnRef.current
    balanceFilterReturnRef.current = null
    if (!previous || previous.city !== city) return
    setView(previous.view)
    setQuery(previous.query)
    setCategory(previous.category)
    setEditorialCategory(previous.editorialCategory)
    setCollection(previous.collection)
    setCollectionSelection(previous.collectionSelection)
    pendingListScrollRef.current = previous.listScroll
    pendingHistoryCameraRef.current = previous.camera ? { city: previous.city, camera: previous.camera } : null
    filterCameraSignatureRef.current = collectionFilterSignature(previous.city, previous.query, previous.category, previous.editorialCategory, false, previous.collection, after19ThemeActive)
    updateCityContext(previous)
    setHistoryRestoreVersion(version => version + 1)
  }

  balancePlacesRequestRef.current = (event) => {
    if (!sampleEnvironment) return
    const detail: unknown = event instanceof CustomEvent ? event.detail : null
    const requested = detail && typeof detail === "object" && "cityId" in detail ? detail.cityId : null
    const nextCity = requested === "seoul" || requested === "busan" || requested === "jeju" ? requested : city ?? "seoul"
    if (city && !balancePlacesActive) balanceFilterReturnRef.current = {
      city, view, query, category, editorialCategory, collection, collectionSelection,
      listScroll: listPanelRef.current?.scrollTop ?? pendingListScrollRef.current,
      camera: mapRef.current ? cameraSnapshot(mapRef.current) : undefined,
    }
    actions.setTab("ondo")
    actions.setSurface({ kind: "map" })
    setSelectedResearchId(null)
    setSelectedEditorialPlaceId(null)
    setCollection(null)
    setCollectionSelection(null)
    setCollectionDetailId(null)
    if (city !== nextCity) chooseCity(nextCity)
    setBalancePlacesOnly(true)
    setQuery("")
    setCategory("all")
    setEditorialCategory("all")
    setView("map")
    setMapOptionsOpen(false)
    replaceBDiscoveryCityContext({ city: nextCity, view: "map", query: "", category: "all", editorialCategory: "all", listScroll: 0, collection: null, collectionSelection: null })
  }

  function rememberListScroll(scrollTop: number) {
    pendingListScrollRef.current = Math.max(0, Math.round(scrollTop))
    if (listScrollTimerRef.current != null) window.clearTimeout(listScrollTimerRef.current)
    listScrollTimerRef.current = window.setTimeout(() => {
      listScrollTimerRef.current = null
      updateCityContext({ listScroll: pendingListScrollRef.current })
    }, 120)
  }

  function preserveFallbackListIntent(event: { target: EventTarget | null }) {
    if (mapState !== "error" || view === "list" || !(event.target instanceof Element)) return
    if (event.target.closest("[data-testid='ondo-b-map-fallback-status']")) return
    if (!event.target.closest("[data-testid='ondo-b-list-panel'], [data-testid='ondo-b-search-shell'], [data-testid='ondo-b-category-rail']")) return
    // A late map response must not pull someone out of a list they have
    // started using. Pointer/key/wheel intent is distinct from restored scroll.
    setView("list")
    updateCityContext({ view: "list" })
  }

  function openMapOptions() {
    // Keep one keyboard/close owner when the guide is already open.
    setEditorialOpen(false)
    // Filtering the transport fallback is explicit list intent as well. A late
    // tile response must not switch the surface behind the options sheet.
    if (mapState === "error" && view !== "list") {
      setView("list")
      updateCityContext({ view: "list" })
    }
    setMapOptionsOpen(true)
  }

  function retryMap() {
    retryFocusPending.current = true
    // The fallback List remains the operable foreground while the cached map
    // retries behind it. Only a truthful Ready receipt may restore `view`.
    setRetryListForeground(true)
    setMapAttempt((attempt) => attempt + 1)
    setMapProgressVisible(false)
    setMapPartialFailure(false)
    const map = mapRef.current
    const canRetryInPlace = Boolean(
      map?.getContainer().dataset.basemapMetadata === "ready"
      && map.getContainer().dataset.basemapTile === "ready"
      && map.getLayer("ondo-overview-city-core")
      && map.getLayer("ondo-points-hit")
      && map.getLayer("ondo-pulse-hit")
      && map.getLayer("ondo-temperature-field")
      && map.getLayer("ondo-personalized-keyline")
      && map.getSource("ondo-directory")
      && map.getSource("ondo-pulse")
      && map.getSource("ondo-after19-lens"),
    )
    if (!map || !canRetryInPlace) {
      // A partially constructed graph is not a cached usable map. Recreate it
      // behind the still-operable List; never promote a half-built instance to
      // Ready merely because it later emitted `idle`.
      if (map) {
        map.remove()
        if (mapRef.current === map) mapRef.current = null
        nationControllerRef.current = null
      }
      setMapState("idle")
      setRetryToken((token) => token + 1)
      return
    }

    retryAttemptCleanupRef.current?.()
    let settled = false
    const progressDelay = window.setTimeout(() => {
      if (!settled) setMapProgressVisible(true)
    }, MAP_LOAD_CONTEXT_DELAY_MS)
    const deadline = window.setTimeout(() => {
      if (settled) return
      settled = true
      setMapProgressVisible(false)
      setMapPartialFailure(true)
      setMapState("error")
    }, MAP_LOAD_FALLBACK_DELAY_MS)
    const finish = () => {
      if (settled) return
      settled = true
      window.clearTimeout(progressDelay)
      window.clearTimeout(deadline)
      setMapProgressVisible(false)
      retryAttemptCleanupRef.current = null
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        setMapState("ready")
        setRetryListForeground(false)
        if (retryFocusPending.current) {
          retryFocusPending.current = false
          document.querySelector<HTMLElement>("[data-testid='ondo-b-view-toggle']")?.focus({ preventScroll: true })
        }
      }))
    }
    const cleanup = () => {
      window.clearTimeout(progressDelay)
      window.clearTimeout(deadline)
      map.off("idle", finish)
      if (retryAttemptCleanupRef.current === cleanup) retryAttemptCleanupRef.current = null
    }
    retryAttemptCleanupRef.current = cleanup
    map.once("idle", finish)
    setMapState("loading")
    map.stop()
    map.resize()
    const camera = cameraSnapshot(map)
    map.jumpTo({ center: [camera.longitude, camera.latitude], zoom: camera.zoom, bearing: camera.bearing, pitch: camera.pitch })
    map.triggerRepaint()
  }

  function locateUser() {
    const requestId = locationRequestRef.current + 1
    locationRequestRef.current = requestId
    const requestedCity = city
    if (!navigator.geolocation) {
      userLocationRef.current = null
      setUserLocation(null)
      setLocationState("unsupported")
      return
    }
    setLocationState("locating")
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      if (locationRequestRef.current !== requestId || currentCityRef.current !== requestedCity) return
      const nextLocation = { longitude: coords.longitude, latitude: coords.latitude }
      userLocationRef.current = nextLocation
      setUserLocation(nextLocation)
      setLocationState("ready")
      if (mapRef.current) moveMap(mapRef.current, { center: [nextLocation.longitude, nextLocation.latitude], zoom: 14 })
    }, () => {
      if (locationRequestRef.current !== requestId || currentCityRef.current !== requestedCity) return
      userLocationRef.current = null
      setUserLocation(null)
      setLocationState("denied")
    }, { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 })
  }

  const locationDisclosure = !compactChrome && effectiveView === "map" && mapState !== "error" ? (
    <details
      className={styles.locationMessage}
      data-testid="ondo-b-location-message"
      name="ondo-map-disclosure"
      data-message-kind={!online ? "offline" : locationState === "idle" ? "disclosure" : "status"}
      data-location-state={locationState}
      data-location-recovery={locationNeedsRecovery ? "true" : "false"}
      open={locationDetailsOpen}
      onToggle={event => setLocationDetailsOpen(event.currentTarget.open)}
    >
      <summary aria-label={locationSummary}>
        {locationNeedsRecovery ? <LocateOff size={18} aria-hidden="true" /> : <MapPin size={18} aria-hidden="true" />}
        <span>{locationSummary}</span>
        <ChevronRight size={16} aria-hidden="true" />
      </summary>
      <p id="ondo-b-location-message" role={!online || locationState !== "idle" ? "status" : undefined} data-testid="ondo-b-location-details">{locationMessage}</p>
    </details>
  ) : null

  if (!city) return (
    <div className={styles.compatRoot} data-testid="ondo-map-entry">
      <div
        ref={mapNode}
        className={`${styles.map} ${styles.persistentMap}`}
        data-testid="maplibre-map"
        data-map-mode="nation"
        data-map-state={mapState}
        data-map-appearance={state.resolvedAppearance}
        data-explore-lens={after19ThemeActive ? "after19" : "standard"}
        aria-hidden="true"
      />
      <section
        className={styles.root}
        data-testid="ondo-b-map-entry"
        data-hydrated={state.hydrated ? "true" : "false"}
        data-after19-active={after19ThemeActive ? "true" : "false"}
        data-map-appearance={state.resolvedAppearance}
        data-explore-lens={after19ThemeActive ? "after19" : "standard"}
        data-persona={state.persona ?? "none"}
        data-discovery-preferences={state.discoveryPreferences.join(",") || "none"}
      >
        <header className={styles.header}>
          <div className={styles.brand}><OndoBrandLockupB size="compact" /><small>{copy.tagline}</small></div>
          <div className={styles.headerActions}><SampleInfoButtonB />
          <button type="button" className={styles.language} aria-label={NEXT_LOCALE_ACCESSIBLE_LABEL[locale]} title={NEXT_LOCALE_ACCESSIBLE_LABEL[locale]} data-language-target={NEXT_LOCALE[locale]} onClick={() => actions.setLocale(NEXT_LOCALE[locale])}><Languages size={16} aria-hidden="true" />{NEXT_LOCALE_LABEL[locale]}</button>
          </div>
        </header>
        <NationDirectory
          locale={locale}
          persona={state.persona}
          preferences={state.discoveryPreferences}
          mapState={mapState}
          sampleMotion={sampleEnvironment}
          onEditPreferences={() => {
            if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
            actions.setTab("settings")
          }}
          onSelect={chooseCity}
          controllerRef={nationControllerRef}
          overlayRef={nationOverlayRef}
        />
      </section>
    </div>
  )

  return (
    <div className={styles.compatRoot} data-testid="ondo-map-entry">
      <div
        ref={mapNode}
        className={`${styles.map} ${styles.persistentMap}`}
        data-testid="maplibre-map"
        data-map-mode="city"
        data-layout-mode={mapLayoutMode}
        data-map-state={mapState}
        role="region"
        aria-label={city === "jeju" ? MAP_UI[locale].editorialRegion : MAP_UI[locale].mapRegion}
        aria-describedby="ondo-b-map-instruction ondo-b-result-truth"
        data-foreground={effectiveView === "map" ? "map" : "list"}
        data-map-appearance={state.resolvedAppearance}
        data-explore-lens={after19ThemeActive ? "after19" : "standard"}
        aria-hidden={editorialOpen || effectiveView !== "map" ? true : undefined}
        inert={editorialOpen ? true : undefined}
        data-editorial-inert={editorialOpen ? "true" : "false"}
      />
      <section
        ref={cityRootNode}
        onPointerDownCapture={preserveFallbackListIntent}
        onKeyDownCapture={preserveFallbackListIntent}
        onWheelCapture={preserveFallbackListIntent}
        className={`${styles.root} ${mapLayoutMode === "ultra-short" ? styles.ultraShort : ""}`}
        data-testid="ondo-b-map-entry"
        data-hydrated={state.hydrated ? "true" : "false"}
        data-city={city}
        data-discovery-collection={collection ?? "none"}
        data-entry-transition={entryTransitionCity === city ? "active" : "settled"}
        data-entry-origin={entryTransitionCity === city ? city : undefined}
        data-temperature-shell="city-map"
        data-compact-chrome={compactChrome ? "true" : "false"}
        data-sample-temperature={sampleEnvironment ? "true" : "false"}
        data-map-perspective={mapTilted ? "tilted" : "flat"}
        data-directory-source={city === "jeju" ? undefined : SOURCE_ID}
        data-source-date={city === "jeju" ? undefined : SOURCE_DATE}
        data-city-record-count={city === "jeju" ? undefined : MAP_VENUES.filter((venue) => venue.cityId === city).length}
        data-editorial-point-count={city === "jeju" ? JEJU_EDITORIAL_PLACES.length : undefined}
        data-editorial-temperature-mode={city === "jeju" ? JEJU_EDITORIAL_TEMPERATURE.mode : undefined}
        data-editorial-temperature-score={city === "jeju" ? "none" : undefined}
        data-result-count={visibleResultCount ?? (city === "jeju" ? editorialPlaces.length : venues.length) + researchedFoods.length}
        data-research-result-count={researchedFoods.length}
        data-balance-places-filter={balancePlacesActive ? "on" : "off"}
        data-map-state={mapState}
        data-map-progress={mapProgressVisible ? "visible" : "quiet"}
        data-map-partial-failure={mapPartialFailure ? "recoverable" : "none"}
        data-map-attempt={mapAttempt}
        data-connectivity={online ? "online" : "offline"}
        data-location-state={locationState}
        data-user-location={userLocation ? "present" : "absent"}
        data-cluster-grammar={city === "jeju" ? undefined : "official-record-count"}
        data-pulse-map-grammar="temperature-field-over-map-context"
        data-pulse-visual-grammar="aura-scale-selection-capsule"
        data-temperature-visual-grammar="shared-field-aura-core-scale-selection-capsule"
        data-marker-coordinate-authority="geojson-point-no-translate"
        data-temperature-noncolor-grammar={city === "jeju" ? "coverage-density-and-pattern" : "rank-and-core-size"}
        data-temperature-model={city === "jeju" ? JEJU_EDITORIAL_TEMPERATURE.model : "curated-scored"}
        data-pulse-motion="one-shot-bloom-reduced-safe"
        data-selected-pulse-grammar="one-shot-halo-place-capsule"
        data-curated-pulse-count={city === "jeju" ? undefined : curatedPulseVenues.length}
        data-pulse-map-anchor-count={city === "jeju" ? undefined : Math.min(8, curatedPulseVenues.length)}
        data-layout-mode={mapLayoutMode}
        data-requested-view={view}
        data-effective-view={effectiveView}
        data-map-root-block-size={mapRootBlockSize.toFixed(1)}
        data-selected-venue-id={selectedVenueId ?? "none"}
        data-selected-editorial-place-id={selectedEditorialPlaceId ?? "none"}
        data-after19-active={after19ThemeActive ? "true" : "false"}
        data-map-appearance={state.resolvedAppearance}
        data-explore-lens={after19ThemeActive ? "after19" : "standard"}
        data-after19-session-active={after19Active ? "true" : "false"}
        data-after19-lens-policy="derived-night-filter-preserve-discovery-state"
        data-after19-result-policy={after19Active ? (city === "jeju" ? "editorial-preserved-no-night-inference" : "approved-night-subset") : "base-discovery"}
        data-persona={state.persona ?? "none"}
        data-discovery-preferences={state.discoveryPreferences.join(",") || "none"}
        data-personalized-match-count={personalizedVenueRows.filter(({ matchCount }) => matchCount > 0).length}
      >
        <p id="ondo-b-map-instruction" className={styles.srOnly} aria-hidden={editorialOpen ? true : undefined}>{city === "jeju" ? copy.editorialMapA11y : copy.mapA11y}</p>
        <header className={styles.cityHeader} data-testid="ondo-b-city-header" onBlur={event => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { setDiscoverySearchOpen(false); searchOriginRef.current = null }
        }}>
          <div className={styles.topline}>
            <button type="button" className={styles.back} data-testid="ondo-b-city-back" aria-label={collection ? locale === "ko" ? "뒤로" : locale === "ja" ? "戻る" : "Back" : copy.back} onClick={() => {
              pendingNationFocusRef.current = city
              if (!goBackFromBDiscovery("city")) {
                setEntryTransitionCity(null)
                setCity(null)
              }
            }}><ArrowLeft size={18} /><span>{collection ? locale === "ko" ? "뒤로" : locale === "ja" ? "戻る" : "Back" : copy.back}</span></button>
            <div className={styles.cityTitle}><h1>{CITY[city].label[locale]}</h1>{compactChrome && sampleEnvironment ? <small className={styles.compactDemo}>{sampleInfoCopyB(locale).label}</small> : null}<small className={styles.srOnly} data-testid="ondo-b-pulse-city-status" data-pulse-city-status={city === "jeju" ? "editorial-limited" : PULSE_CITY_STATUS[city]}>{cityPulseStatus(city, locale)}</small></div>
            {compactChrome ? <button type="button" className={styles.mapOptionsButton} data-testid="ondo-b-map-options-open" aria-label={MOBILE_CHROME_COPY[locale].optionsLabel} aria-haspopup="dialog" aria-expanded={mapOptionsOpen} onClick={openMapOptions}><SlidersHorizontal size={17} aria-hidden="true" /><span>{MOBILE_CHROME_COPY[locale].options}</span>{(city === "jeju" ? editorialCategory : category) !== "all" ? <i className={styles.filterDot} aria-hidden="true" /> : null}</button> : <div className={styles.headerActions}><SampleInfoButtonB /><button type="button" className={styles.language} data-testid="ondo-b-language" aria-label={NEXT_LOCALE_ACCESSIBLE_LABEL[locale]} title={NEXT_LOCALE_ACCESSIBLE_LABEL[locale]} data-language-target={NEXT_LOCALE[locale]} onClick={() => actions.setLocale(NEXT_LOCALE[locale])}><Languages size={16} aria-hidden="true" />{NEXT_LOCALE_LABEL[locale]}</button></div>}
          </div>
          <div className={styles.search} role="search" data-testid="ondo-b-search-shell"><Search size={20} aria-hidden="true" /><input data-testid="ondo-b-search" aria-label={copy.search} value={query} maxLength={SEARCH_MAX_LENGTH}
            onFocus={event => {
              if (event.currentTarget.dataset.discoveryRestoringFocus) return
              updateCityContext({ camera: mapRef.current ? cameraSnapshot(mapRef.current) : undefined }); searchOriginRef.current = readBDiscoveryHistory(); setDiscoverySearchOpen(true)
            }}
            onClick={() => {
              if (!searchOriginRef.current) { updateCityContext({ camera: mapRef.current ? cameraSnapshot(mapRef.current) : undefined }); searchOriginRef.current = readBDiscoveryHistory() }
              setDiscoverySearchOpen(true)
            }}
            onChange={event => editDiscoveryQuery(event.target.value.slice(0, SEARCH_MAX_LENGTH))}
            onKeyDown={event => {
              if (event.nativeEvent.isComposing) return
              if (event.key === "Escape") { searchOriginRef.current = null; setDiscoverySearchOpen(false); event.currentTarget.blur() }
              if (event.key !== "Enter") return
              event.preventDefault()
              const mood = discoveryMoodFromQueryB(query)
              if (mood) openDiscoveryCollection(mood)
              else { searchOriginRef.current = null; setDiscoverySearchOpen(false); event.currentTarget.blur() }
            }}
            placeholder={compactChrome ? MOBILE_CHROME_COPY[locale].search : copy.search} />{query ? <button type="button" onClick={() => editDiscoveryQuery("")} aria-label={MAP_UI[locale].clearSearch}><X size={16} /></button> : null}{sampleEnvironment ? <MapBalanceEntryB onOpen={() => { updateCityContext({ camera: mapRef.current ? cameraSnapshot(mapRef.current) : undefined }); actions.setTab("id") }} /> : null}</div>
          {discoverySearchOpen ? <DiscoveryMoodSuggestionsB locale={locale} onSelect={openDiscoveryCollection} /> : null}
          {compactChrome ? null : after19NightSubsetActive ? <div className={styles.after19Context} data-testid="ondo-b-after19-context">
            <MoonStar className={styles.after19ContextIcon} size={15} aria-hidden="true" />
            <span>After 19 · {AFTER19_NIGHT_CATEGORY[locale]}</span>
          </div> : <div className={styles.rail} aria-label={copy.filterLabel} data-testid="ondo-b-category-rail">
            {city === "jeju" ? EDITORIAL_CATEGORY_OPTIONS.map((item) => (
              <button key={item} type="button" data-editorial-category={item} aria-label={EDITORIAL_CATEGORY[item][locale]} aria-pressed={editorialCategory === item} onClick={() => { setEditorialCategory(item); updateCityContext({ editorialCategory: item }) }}>{EDITORIAL_CATEGORY[item][locale]}</button>
            )) : categoryRailItems.map((item) => {
              const label = CATEGORY[item][locale]
              return <button
                key={item}
                type="button"
                data-category={item}
                aria-label={label}
                aria-pressed={category === item}
                onClick={() => {
                  setCategory(item)
                  updateCityContext({ category: item })
                }}
              >{mapLayoutMode === "ultra-short" ? CATEGORY[item].compact[locale] : label}</button>
            })}
          </div>}
        </header>

        {!compactChrome ? <PersonalizationLens
          locale={locale}
          persona={state.persona}
          preferences={state.discoveryPreferences}
          mapInteractive={mapState !== "error"}
          onEdit={() => {
            if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
            actions.setTab("settings")
          }}
        /> : null}

        <ul id="ondo-b-pulse-marker-accessible-detail" className={styles.srOnly} data-testid="ondo-b-pulse-marker-accessible-detail" aria-hidden={editorialOpen ? true : undefined}>
          {city === "jeju"
            ? editorialPlaces.map((place) => <li key={place.id}>{`${place.name[locale]} · ${jejuEditorialCoverageSummary(place, locale, TEMPERATURE_NAME[locale])}`}</li>)
            : curatedPulseVenues.map(({ venue, pulse }) => (
              <li key={venue.id}>
                {`${venueDisplayName(venue.name.ko, locale)} · ${TEMPERATURE_NAME[locale]} · ${pulseLevelLabel(pulse.level, locale)} · ${MAP_UI[locale].freshness} ${TEMPERATURE_FRESHNESS[pulse.freshness][locale]} · ${MAP_UI[locale].confidence} ${TEMPERATURE_CONFIDENCE[pulse.confidence][locale]}`}
              </li>
            ))}
        </ul>
        {!editorialOpen && effectiveView === "map" && (mapState === "idle" || mapState === "loading") && mapProgressVisible ? <div className={styles.mapLoading} role="status" data-testid="ondo-b-map-loading"><i aria-hidden="true" /><span>{city === "jeju" ? copy.editorialMapLoading : copy.mapLoading}</span></div> : null}
        {!editorialOpen && effectiveView === "map" && mapPartialFailure ? (
          <p className={styles.mapTransportStatus} role="status" data-testid="ondo-b-map-transport-status">
            <Info size={16} aria-hidden="true" /><span>{copy.mapLimited}</span>
          </p>
        ) : null}

        <div className={styles.mapUtilityCluster} data-testid="ondo-b-map-utility-cluster" data-editorial-open={editorialOpen ? "true" : "false"}>
          {!compactChrome && effectiveView === "map" && mapState === "ready" && !editorialOpen ? (
            <button
              type="button"
              className={styles.perspectiveToggle}
              data-testid="ondo-b-map-perspective"
              aria-label={PERSPECTIVE_COPY[locale].name}
              aria-pressed={mapTilted}
              title={mapTilted ? PERSPECTIVE_COPY[locale].flat : PERSPECTIVE_COPY[locale].tilted}
              disabled={entryTransitionCity === city}
              onClick={() => {
                const map = mapRef.current
                if (!map) return
                const pitch = map.getPitch() > 8 ? 0 : CITY_PERSPECTIVE_PITCH
                // Spatial perspective is independent of After 19
                // or appearance. Never replace the map or move a venue point.
                moveMap(map, { pitch, bearing: 0, easing: (progress) => 1 - (1 - progress) ** 3 })
              }}
            ><Layers2 size={19} aria-hidden="true" /></button>
          ) : null}
          {!locationNeedsRecovery ? locationDisclosure : null}
          {!compactChrome && effectiveView === "map" && mapState !== "error" ? <button type="button" className={styles.locate} data-testid="ondo-b-locate" data-location-state={locationState} data-online={online ? "true" : "false"} aria-describedby="ondo-b-location-message" aria-label={locationState === "denied" ? copy.retryLocation : copy.locate} onClick={locateUser}>{locationState === "denied" || locationState === "unsupported" ? <LocateOff size={19} aria-hidden="true" /> : <LocateFixed size={19} aria-hidden="true" />}</button> : null}
          <GlobalAfter19B
            locale={locale}
            accountActive={state.account === "ACC-ACTIVE"}
            context={{
              cityId: city,
              cityLabel: CITY[city].label[locale],
              venueId: selectedVenueId,
              venueLabel: selectedVenue ? venueDisplayName(selectedVenue.name.ko, locale) : null,
            }}
            onActiveChange={setAfter19Active}
            noticeTarget={mapFeedbackTarget}
          />
          {city === "seoul" || city === "jeju" ? <JapanFirstDiscoveryB locale={locale} city={city} open={editorialOpen} compactTrigger={compactChrome} returnFocusSelector={compactChrome ? "[data-testid='ondo-b-map-options-open']" : undefined} presentation={effectiveView === "list" || mapState === "error" ? "list" : "map"} onOpenChange={setEditorialOpen} onSelectEditorialPlace={city === "jeju" ? focusEditorialPlace : undefined} onSelectCollection={openDiscoveryCollection} /> : null}
        </div>
        <div ref={mapFeedbackRootRef} className={styles.mapFeedbackStack} data-testid="ondo-b-map-feedback" hidden={editorialOpen}>
          <div className={styles.mapFeedbackSlot}>{locationNeedsRecovery ? locationDisclosure : null}</div>
          <div ref={setMapFeedbackTarget} className={styles.mapFeedbackSlot} />
        </div>
        {effectiveView === "map" && mapState !== "error" && !locationNeedsRecovery && locationState !== "idle" ? (
          <span className={styles.srOnly} role="status" aria-live="polite" aria-atomic="true">{locationMessage}</span>
        ) : null}
        {effectiveView === "map" && mapState !== "error" && (!online || locationState === "denied" || locationState === "unsupported") ? (
          <span className={styles.srOnly} data-testid="ondo-b-location-announcement" role="alert" aria-live="assertive">{locationSummary}</span>
        ) : null}

        <div className={styles.mapChrome} data-testid="ondo-b-map-chrome">
          <div
            className={styles.resultBar}
            data-testid="ondo-b-result-bar"
            data-chrome-role="view-action"
            data-effective-view={effectiveView}
            data-result-count={visibleResultCount ?? (city === "jeju" ? editorialPlaces.length : venues.length) + researchedFoods.length}
            data-result-source={researchedFoods.length ? "directory-and-editorial-research" : city === "jeju" ? "editorial" : SOURCE_ID}
          >
            <span id="ondo-b-result-truth" className={styles.resultTruth} data-testid="ondo-b-result-truth" role="status" aria-live="polite" aria-atomic="true">
              <b>{mapPartialFailure && effectiveView === "map" ? copy.mapLimited : resultCount(visibleResultCount ?? (city === "jeju" ? editorialPlaces.length : venues.length) + researchedFoods.length, locale)}</b>
              {mapPartialFailure && effectiveView === "map" ? <small>{copy.offlineSource}</small> : null}
            </span>
            {mapState === "error" || mapLayoutMode === "ultra-short" ? (
              <span className={styles.forcedListLabel} data-testid="ondo-b-effective-view-label" aria-label={`${copy.list} · ${MAP_UI[locale].shortList}`}><List size={17} /><span>{copy.list}</span></span>
            ) : (
              <button
                type="button"
                aria-pressed={effectiveView === "list"}
                aria-describedby="ondo-b-result-truth"
                onClick={() => {
                  const nextView = view === "map" ? "list" : "map"
                  setView(nextView)
                  if (nextView === "map" && navigator.onLine) {
                    setMapPartialFailure(false)
                    mapRef.current?.triggerRepaint()
                  }
                  updateCityContext({ view: nextView })
                }}
                data-testid="ondo-b-view-toggle"
              >
                {effectiveView === "map" ? <List size={17} /> : <MapIcon size={17} />}
                <span className={styles.viewActionLabel}>{effectiveView === "map" ? copy.list : copy.map}</span>
              </button>
            )}
          </div>

          {effectiveView === "map" && mapState !== "error" && !collection ? (
            <aside
              className={`${styles.mapKey} ${sampleEnvironment ? styles.sampleTemperatureKey : ""}`}
              data-testid="ondo-b-map-key"
              data-pulse-key-presentation={city === "jeju" ? "compact-coverage" : "compact-gradient"}
              data-editorial-temperature-key={city === "jeju" ? "unscored" : undefined}
              data-temperature-model={city === "jeju" ? JEJU_EDITORIAL_TEMPERATURE.model : "curated-scored"}
              aria-label={city === "jeju"
                ? `${TEMPERATURE_NAME[locale]} · ${JEJU_EDITORIAL_COVERAGE_LABEL[locale]}. ${copy.jejuTruth}`
                : `${copy.mapKey}. ${copy.mapKeyBody} ${PULSE_DISCLOSURE[locale]}`}
            >
              {sampleEnvironment ? <TemperatureTimelineB
                key={city}
                map={mapState === "ready" && entryTransitionCity !== city ? mapRef.current : null}
                city={city}
                locale={locale}
                points={temperatureSamplePoints}
                active={state.tab === "ondo" && effectiveView === "map" && !editorialOpen}
                selectedVenueId={selectedVenueId ?? selectedEditorialPlaceId ?? selectedResearchId}
                onSelectPoint={(id) => {
                  if (researchedFoodByIdB(id)) { setSelectedResearchId(id); return }
                  const editorial = editorialPlaceById(id)
                  if (editorial) openEditorialPlaceDetailRef.current(editorial)
                  else {
                    const venue = CANONICAL_MAP_VENUES_COMPACT.find((item) => item.id === id)
                    if (venue) selectVenue(venue)
                  }
                }}
                after19={after19ThemeActive}
              /> : <div className={styles.pulseScale} data-testid="ondo-b-pulse-scale" data-editorial-coverage-scale={city === "jeju" ? "true" : undefined} aria-hidden="true">
                <i /><b>{TEMPERATURE_NAME[locale]}</b><small>{city === "jeju" ? EDITORIAL_COVERAGE_RANGE[locale] : MAP_UI[locale].pulseRange}</small>
              </div>}
              <details className={styles.mapKeyDetails} data-testid="ondo-b-map-key-details" name="ondo-map-disclosure">
                <summary aria-label={copy.mapKeyDetails}><span>{copy.mapKeyDetails}</span><ChevronRight size={16} /></summary>
                <div className={styles.mapKeyDetailsBody}>
                  <div className={styles.pulseLegend} data-testid="ondo-b-pulse-legend" aria-label={city === "jeju" ? JEJU_EDITORIAL_COVERAGE_LABEL[locale] : MAP_UI[locale].pulseLegend}>
                    {city === "jeju"
                      ? (["sparse", "clustered", "dense"] as const).map((intensity) => <span key={intensity} data-coverage-intensity={intensity}><i aria-hidden="true"><b /><b /><b /></i>{JEJU_EDITORIAL_COVERAGE_INTENSITY_LABEL[intensity][locale]}</span>)
                      : (["peak", "hot", "rising", "warming", "low", "limited"] as const).map((level) => <span key={level} data-level={level}><i />{pulseLevelLabel(level, locale)}</span>)}
                  </div>
                  {city === "jeju" ? null : <small>{copy.mapKeyBody}</small>}
                  <small data-testid="ondo-b-pulse-composition-disclosure">{city === "jeju" ? copy.jejuTruth : PULSE_COMPOSITION_DISCLOSURE[locale]}</small>
                  {city === "jeju" ? null : <details className={styles.methodologyDisclosure} data-testid="ondo-b-pulse-methodology">
                    <summary>{copy.methodology}<ChevronRight size={15} /></summary>
                    <dl className={styles.pulseCompositionRows} data-testid="ondo-b-pulse-production-drivers">
                      {PULSE_PRODUCTION_DRIVER_DISCLOSURE[locale].map((driver) => (
                        <div key={driver.id}>
                          <dt>{driver.label}</dt>
                          <dd><strong>{driver.state}</strong><span>{driver.detail}</span></dd>
                        </div>
                      ))}
                    </dl>
                    <ul className={styles.pulsePlaces} data-testid="ondo-b-map-pulse-places" aria-label={MAP_UI[locale].pulsePlaces}>
                      {curatedPulseVenues.map(({ venue, pulse }) => (
                        <li key={venue.id}>
                          <button
                            type="button"
                            data-venue-id={venue.id}
                            data-temperature-score={pulse.score}
                            data-level={pulse.level}
                            data-pulse-place-priority={pulse.level}
                            aria-label={`${venueDisplayName(venue.name.ko, locale)} · ${TEMPERATURE_NAME[locale]} · ${pulseLevelLabel(pulse.level, locale)} · ${MAP_UI[locale].freshness} ${TEMPERATURE_FRESHNESS[pulse.freshness][locale]} · ${MAP_UI[locale].confidence} ${TEMPERATURE_CONFIDENCE[pulse.confidence][locale]}`}
                            onClick={() => selectVenue(venue)}
                          >
                            <span>{venueDisplayName(venue.name.ko, locale)}</span>
                            <b>{pulse.score} · {pulseLevelLabel(pulse.level, locale)}</b>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </details>}
                </div>
              </details>
            </aside>
          ) : null}
          {effectiveView === "map" && mapState !== "error" ? (
            <footer className={styles.attribution} data-testid="ondo-b-attribution" data-attribution-presentation="compact-legal" aria-label={MAP_UI[locale].mapAttribution}>
              <details className={styles.creditDetails} data-testid="ondo-b-map-credit-details" name="ondo-map-disclosure">
                <summary aria-label={copy.mapCredits}><span>{copy.mapCredits}</span><Copyright size={16} /></summary>
                <div className={styles.creditDetailsBody}>
                  <a href="https://openfreemap.org/" target="_blank" rel="noreferrer">OpenFreeMap</a>
                  <a href="https://openmaptiles.org/" target="_blank" rel="noreferrer">© OpenMapTiles</a>
                  <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">Data from OpenStreetMap / ODbL</a>
                </div>
              </details>
            </footer>
          ) : null}
        </div>

        {effectiveView === "list" || mapState === "error" ? (
          <div ref={listPanelRef} className={styles.listPanel} data-testid="ondo-b-list-panel" onScroll={(event) => rememberListScroll(event.currentTarget.scrollTop)}>
            {balancePlacesActive ? <button type="button" className={styles.balanceFilter} data-testid="map-balance-places-filter" aria-label={BALANCE_MAP_COPY[locale].clear} aria-pressed="true" onClick={clearBalancePlaces}>{BALANCE_MAP_COPY[locale].places}<X size={13} aria-hidden="true" /></button> : null}
            {collection ? <DiscoveryCollectionResultsB id={collection} locale={locale} places={collectionPlaces} selected={collectionSelected} onSelect={selectCollectionPin} onOpen={openCollectionPlace} onClose={() => goBackFromBDiscovery("city")} layout="list" /> : <ResearchedFoodListB places={researchedFoods} locale={locale} onSelect={place => setSelectedResearchId(place.id)} />}
            {mapState === "error" ? <div className={styles.mapError} role="status" data-testid="ondo-b-map-fallback-status"><span>{city === "jeju" ? copy.editorialMapUnavailable : copy.mapUnavailable}</span><button type="button" onClick={retryMap}>{copy.retryMap}</button></div> : null}
            {retryListForeground && mapState === "loading" && mapProgressVisible ? <div className={styles.mapRetryStatus} role="status" data-testid="ondo-b-map-retry-status"><i aria-hidden="true" /><span>{city === "jeju" ? copy.editorialMapLoading : copy.mapLoading}</span></div> : null}
            {collection || researchedFoods.length > 0 && (city === "jeju" ? editorialPlaces.length === 0 : venues.length === 0) ? null : city === "jeju" ? (
              <EditorialPlaceList
                places={editorialPlaces}
                locale={locale}
                selectedPlaceId={selectedEditorialPlaceId}
                onClear={() => { setQuery(""); setEditorialCategory("all"); updateCityContext({ query: "", editorialCategory: "all" }) }}
                onSelect={openEditorialPlaceDetail}
              />
            ) : (
              <>
                <span className={styles.srOnly} data-testid="ondo-b-pulse-disclosure">{PULSE_DISCLOSURE[locale]}</span>
                <VenueList
                  venues={personalizedVenues}
                  locale={locale}
                  localPulseEvidenceByVenue={state.localPulseEvidenceByVenue}
                  personalMatchCountByVenue={personalMatchCountByVenue}
                  dietaryUnknownByVenue={dietaryUnknownByVenue}
                  selectedVenueId={selectedVenueId}
                  visibleCount={visibleCount}
                  nightSubsetActive={after19NightSubsetActive}
                  onClear={() => {
                    setQuery("")
                    if (after19NightSubsetActive) {
                      updateCityContext({ query: "" })
                      return
                    }
                    setCategory("all")
                    updateCityContext({ query: "", category: "all" })
                  }}
                  onMore={() => setVisibleCount((count) => Math.min(venues.length, count + 30))}
                  onSelect={selectVenue}
                />
              </>
            )}
          </div>
        ) : null}
        {effectiveView === "map" && !editorialOpen && !mapOptionsOpen && !discoverySearchOpen ? collection
          ? <DiscoveryCollectionResultsB id={collection} locale={locale} places={collectionPlaces} selected={collectionSelected} onSelect={selectCollectionPin} onOpen={openCollectionPlace} onClose={() => goBackFromBDiscovery("city")} layout="map" />
          : !query.trim() && !selectedVenueId && !selectedEditorialPlaceId && !selectedResearchId && !balancePlacesActive && !after19Active && !entryTransitionCity && state.surface.kind === "map"
            ? <DiscoveryStoryHintB city={city} locale={locale} onOpen={openDiscoveryCollection} /> : null : null}
        <DiscoveryCollectionPinsB map={mapState === "ready" ? mapRef.current : null} places={collectionPlaces} locale={locale} selected={collectionSelected} visible={Boolean(collection && effectiveView === "map" && !editorialOpen)} onSelect={selectCollectionPin} />
        {selectedVenue && selectedPulse ? <span className={styles.srOnly} role="status" data-testid="ondo-b-selected-marker-status">{`${venueDisplayName(selectedVenue.name.ko, locale)} · ${TEMPERATURE_NAME[locale]} · ${pulseLevelLabel(selectedPulse.level, locale)}`}</span> : null}
        {selectedEditorialPlace ? <span className={styles.srOnly} role="status" data-testid="ondo-b-selected-editorial-marker-status">{`${selectedEditorialPlace.name[locale]} · ${jejuEditorialCoverageSummary(selectedEditorialPlace, locale, TEMPERATURE_NAME[locale])}`}</span> : null}
        {userLocation ? <span className={styles.srOnly} data-testid="ondo-b-user-location-marker" data-longitude={userLocation.longitude} data-latitude={userLocation.latitude}>{copy.locationReady}</span> : null}
        {sampleEnvironment ? <TravelerActivityMapB map={mapState === "ready" ? mapRef.current : null} locale={locale}
          placeLabel={id => {
            const research = researchedFoodByIdB(id)
            if (research) return research.name[locale]
            const editorial = editorialPlaceById(id)
            if (editorial) return editorial.name[locale]
            const venue = CANONICAL_MAP_VENUES_COMPACT.find(item => item.id === id)
            return venue ? venueDisplayName(venue.name.ko, locale) : ""
          }}
          enabled={state.tab === "ondo" && !collection && effectiveView === "map" && !editorialOpen && !selectedVenueId && !selectedEditorialPlaceId && !selectedResearchId && !entryTransitionCity}
          onSelect={id => {
            if (researchedFoodByIdB(id)) { setSelectedResearchId(id); return }
            const editorial = editorialPlaceById(id)
            if (editorial) { openEditorialPlaceDetailRef.current(editorial); return }
            const venue = CANONICAL_MAP_VENUES_COMPACT.find(item => item.id === id)
            if (venue) selectVenue(venue)
          }} /> : null}
      </section>
      {balancePlacesActive && effectiveView === "map" ? <button type="button" className={`${styles.balanceFilter} ${styles.balanceFilterFloating}`} data-testid="map-balance-places-filter" aria-label={BALANCE_MAP_COPY[locale].clear} aria-pressed="true" onClick={clearBalancePlaces}>{BALANCE_MAP_COPY[locale].places}<X size={13} aria-hidden="true" /></button> : null}
      {compactChrome && mapOptionsOpen && state.tab === "ondo" ? <MapOptionsB
        locale={locale}
        cityLabel={CITY[city].label[locale]}
        categories={city === "jeju" ? EDITORIAL_CATEGORY_OPTIONS.map(id => ({ id, label: EDITORIAL_CATEGORY[id][locale], selected: editorialCategory === id })) : categoryRailItems.map(id => ({ id, label: CATEGORY[id][locale], selected: category === id }))}
        onCategory={(id) => {
          if (city === "jeju") {
            const next = EDITORIAL_CATEGORY_OPTIONS.find(item => item === id)
            if (next) { setEditorialCategory(next); updateCityContext({ editorialCategory: next }) }
          } else {
            const next = categoryRailItems.find(item => item === id)
            if (next) { setCategory(next); updateCityContext({ category: next }) }
          }
        }}
        categoryLocked={after19NightSubsetActive}
        resultLabel={resultCount(visibleResultCount ?? (city === "jeju" ? editorialPlaces.length : venues.length) + researchedFoods.length, locale)}
        canTilt={effectiveView === "map" && mapState === "ready" && entryTransitionCity !== city}
        tilted={mapTilted}
        onTogglePerspective={() => {
          const map = mapRef.current
          if (map) moveMap(map, { pitch: map.getPitch() > 8 ? 0 : CITY_PERSPECTIVE_PITCH, bearing: 0, easing: progress => 1 - (1 - progress) ** 3 })
        }}
        locationSummary={locationSummary}
        locationMessage={locationMessage}
        locateLabel={locationState === "denied" ? copy.retryLocation : copy.locate}
        onLocate={effectiveView === "map" && mapState !== "error" ? () => { flushSync(() => setMapOptionsOpen(false)); locateUser() } : undefined}
        onPreferences={() => { flushSync(() => setMapOptionsOpen(false)); actions.setTab("settings") }}
        onStories={city === "seoul" || city === "jeju" ? () => { flushSync(() => setMapOptionsOpen(false)); setEditorialOpen(true) } : undefined}
        languageLabel={locale === "en" ? "English" : locale === "ko" ? "한국어" : "日本語"}
        onLanguage={() => actions.setLocale(NEXT_LOCALE[locale])}
        onDemo={sampleEnvironment ? () => { flushSync(() => setMapOptionsOpen(false)); window.dispatchEvent(new Event(SAMPLE_INFO_EVENT)) } : undefined}
        onClose={() => setMapOptionsOpen(false)}
      /> : null}
      {collectionMarket && state.tab === "ondo" ? <DiscoveryMarketDetailB place={collectionMarket} locale={locale} onClose={closeCollectionPlace} /> : null}
      {selectedResearch && state.tab === "ondo" ? <ResearchedFoodPanelB place={selectedResearch} locale={locale} returnFocus={researchReturnFocus?.placeId === selectedResearch.id ? researchReturnFocus.focus : undefined} onClose={closeCollectionPlace} onMap={() => {
        if (readBDiscoveryHistory()?.discoveryPlaceId) { closeCollectionPlace(); return }
        setSelectedResearchId(null)
        setView("map")
        updateCityContext({ view: "map" })
        const map = mapRef.current
        if (map) { map.resize(); moveMap(map, { center: [selectedResearch.longitude, selectedResearch.latitude], zoom: 14.5 }) }
      }} /> : null}
    </div>
  )
}
