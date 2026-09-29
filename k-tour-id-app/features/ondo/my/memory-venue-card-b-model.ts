import type { CanonicalMapVenue, VenuePrimaryCategory } from "@/lib/ondo/venues/contracts"
import { venueDistrictLabel, venueNamePresentation } from "@/lib/ondo/venues/display"
import {
  JAPAN_FIRST_LAUNCH_CONTENT,
  type EditorialPlaceB,
} from "../pulse-b/japan-first-pulse-model-b"
import type { OndoBLocale } from "../shared/state/ondo-b-preferences"
import type { PersonalPlaceB } from "../place/place-memory-model-b"

export type MyKoreaMemorySourceKindB = "official_directory" | "editorial_place" | "discovery_place"
export type MyKoreaMemoryMediaKindB = "category_illustration" | "editorial_illustration" | "pictogram_fallback"

export type MyKoreaMemoryCardViewModelB = Readonly<{
  objectId: string
  objectNamespace: "canonical-venue" | "jeju-editorial-place" | "discovery-place"
  title: string
  subtitle: string
  accessibleLabel: string
  source: Readonly<{
    kind: MyKoreaMemorySourceKindB
    label: string
    officialRecord: boolean
  }>
  recordProvenance: Readonly<{
    sourceId: string
    label: string
  }>
  media: Readonly<{
    kind: MyKoreaMemoryMediaKindB
    src: string | null
    mediaSourceId: string
    exactVenuePhoto: false
    alt: string
    label: string
    mediaCredit: string
    rights: Readonly<{
      mode: "bundled_category_art" | "ondo_original" | "interface_pictogram"
      label: string
    }>
    disclosureLabel: string
    recordSourceLabel: string
    mediaCreditLabel: string
    rightsLabel: string
    fallbackLabel: string
    failureLabel: string
    crop: string
  }>
}>

const COPY = {
  en: {
    official: "Official directory",
    editorial: "Travel story",
    illustration: "Category illustration",
    illustrationCredit: "Category illustration · not a photo of this place",
    storyImage: "Story image",
    editorialPlace: "Travel place",
    imageDetails: "Image details",
    unavailable: "Image unavailable",
    recordSource: "Place source",
    mediaCreditLabel: "Image credit",
    rightsLabel: "Rights",
    categoryRights: "Bundled category artwork",
    editorialRights: "K-Tour ID original",
    pictogramCredit: "Interface pictogram",
    pictogramRights: "No external image",
  },
  ko: {
    official: "공식 디렉터리",
    editorial: "여행 이야기",
    illustration: "카테고리 일러스트",
    illustrationCredit: "카테고리 일러스트 · 이 장소의 실제 사진이 아님",
    storyImage: "스토리 이미지",
    editorialPlace: "여행 장소",
    imageDetails: "이미지 정보",
    unavailable: "이미지를 불러올 수 없음",
    recordSource: "장소 출처",
    mediaCreditLabel: "이미지 크레딧",
    rightsLabel: "권리",
    categoryRights: "앱 내 카테고리 아트",
    editorialRights: "K-Tour ID 오리지널",
    pictogramCredit: "인터페이스 픽토그램",
    pictogramRights: "외부 이미지 없음",
  },
  ja: {
    official: "公式ディレクトリ",
    editorial: "旅ストーリー",
    illustration: "カテゴリーイラスト",
    illustrationCredit: "カテゴリーイラスト・この場所の実写ではありません",
    storyImage: "ストーリー画像",
    editorialPlace: "旅スポット",
    imageDetails: "画像について",
    unavailable: "画像を表示できません",
    recordSource: "場所の出典",
    mediaCreditLabel: "画像クレジット",
    rightsLabel: "権利",
    categoryRights: "アプリ内カテゴリーアート",
    editorialRights: "K-Tour ID オリジナル",
    pictogramCredit: "インターフェースピクトグラム",
    pictogramRights: "外部画像なし",
  },
} as const

const CATEGORY_COPY: Record<VenuePrimaryCategory, Record<OndoBLocale, string>> = {
  korean: { en: "Korean", ko: "한식", ja: "韓国料理" },
  casual: { en: "Quick service", ko: "분식·간편식", ja: "軽食・ファストフード" },
  japanese: { en: "Japanese", ko: "일식", ja: "日本料理" },
  chinese: { en: "Chinese", ko: "중식", ja: "中華料理" },
  global: { en: "Western & international", ko: "경양식·외국음식", ja: "洋食・各国料理" },
  night: { en: "Pubs & cafés", ko: "주점·카페", ja: "パブ・カフェ" },
  specialty: { en: "Grills & specialty", ko: "구이·횟집·전문점", ja: "焼き物・専門店" },
}

const CATEGORY_ART: Readonly<Record<VenuePrimaryCategory, readonly string[]>> = Object.freeze({
  korean: Object.freeze(["/editorial/food/ondo-category-korean-v1.jpg"]),
  casual: Object.freeze(["/editorial/food/ondo-category-casual-v1.jpg"]),
  japanese: Object.freeze(["/editorial/food/ondo-category-japanese-v1.jpg"]),
  chinese: Object.freeze(["/editorial/food/ondo-category-chinese-v1.jpg"]),
  global: Object.freeze(["/editorial/food/ondo-category-global-v1.jpg"]),
  night: Object.freeze([
    "/editorial/food/ondo-category-night-v1.jpg",
    "/editorial/food/ondo-category-night-v2.jpg",
    "/editorial/food/ondo-category-night-v3.jpg",
  ]),
  specialty: Object.freeze(["/editorial/food/ondo-category-specialty-v1.jpg"]),
})

const ATTACHED_EDITORIAL_MEDIA: ReadonlySet<string> = new Set([
  "/editorial/japan-first-c18-jeju-screen-route.jpg",
  "/editorial/japan-first-c20-jeju-kpop-route.jpg",
] as const)

const CROP_PRESETS = Object.freeze([
  "50% 50%",
  "44% 48%",
  "56% 48%",
  "50% 42%",
  "50% 58%",
] as const)

function stableHash(value: string) {
  let hash = 2_166_136_261
  for (const character of value) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16_777_619)
  }
  return hash >>> 0
}

function stableMember<T>(values: readonly T[], seed: string): T {
  return values[stableHash(seed) % values.length]
}

export function stableMyKoreaMemoryCropB(objectNamespace: MyKoreaMemoryCardViewModelB["objectNamespace"], objectId: string) {
  return stableMember(CROP_PRESETS, `${objectNamespace}:${objectId}:crop`)
}

/**
 * Resolves crops for the visible order, not for a locale-specific label. The
 * same ordered object/source IDs therefore produce the same result on reload
 * and in every language. Adjacent cards never repeat the same source+crop
 * pair, even when they share one category or story illustration.
 */
export function resolveVisibleMyKoreaMemorySequenceB(models: readonly MyKoreaMemoryCardViewModelB[]): readonly MyKoreaMemoryCardViewModelB[] {
  let previousPair: string | null = null
  return Object.freeze(models.map((model) => {
    const initialIndex = stableHash(`${model.objectNamespace}:${model.objectId}:crop`) % CROP_PRESETS.length
    let cropIndex = initialIndex
    let pair = `${model.media.mediaSourceId}|${CROP_PRESETS[cropIndex]}`
    if (pair === previousPair) {
      cropIndex = (cropIndex + 1 + (stableHash(`${model.objectId}:adjacent`) % (CROP_PRESETS.length - 1))) % CROP_PRESETS.length
      if (cropIndex === initialIndex) cropIndex = (cropIndex + 1) % CROP_PRESETS.length
      pair = `${model.media.mediaSourceId}|${CROP_PRESETS[cropIndex]}`
    }
    previousPair = pair
    if (model.media.crop === CROP_PRESETS[cropIndex]) return model
    return Object.freeze({
      ...model,
      media: Object.freeze({ ...model.media, crop: CROP_PRESETS[cropIndex] }),
    })
  }))
}

export function officialMemoryCardViewModelB(venue: CanonicalMapVenue, locale: OndoBLocale): MyKoreaMemoryCardViewModelB {
  const copy = COPY[locale]
  const name = venueNamePresentation(venue.name.ko, locale)
  const district = venueDistrictLabel(venue.cityId, venue.districtId, locale)
  const category = CATEGORY_COPY[venue.primaryCategory][locale]
  const media = stableMember(CATEGORY_ART[venue.primaryCategory], `${venue.id}:category-art`)

  return Object.freeze({
    objectId: venue.id,
    objectNamespace: "canonical-venue",
    title: name.officialName,
    subtitle: `${district} · ${category}`,
    accessibleLabel: `${name.officialNameLabel}: ${name.officialName}. ${name.transliterationLabel}: ${name.transliteration}. ${district}. ${category}. ${copy.official}`,
    source: Object.freeze({ kind: "official_directory", label: copy.official, officialRecord: true }),
    recordProvenance: Object.freeze({ sourceId: venue.sourceRefId, label: `LOCALDATA · ${copy.official}` }),
    media: Object.freeze({
      kind: "category_illustration",
      src: media,
      mediaSourceId: media,
      exactVenuePhoto: false,
      alt: "",
      label: copy.illustration,
      mediaCredit: copy.illustrationCredit,
      rights: Object.freeze({ mode: "bundled_category_art", label: copy.categoryRights }),
      disclosureLabel: copy.imageDetails,
      recordSourceLabel: copy.recordSource,
      mediaCreditLabel: copy.mediaCreditLabel,
      rightsLabel: copy.rightsLabel,
      fallbackLabel: copy.unavailable,
      failureLabel: copy.unavailable,
      crop: stableMyKoreaMemoryCropB("canonical-venue", venue.id),
    }),
  })
}

function attachedEditorialStoryMedia(place: EditorialPlaceB) {
  for (const storyId of place.storyIds) {
    if (storyId !== "C18" && storyId !== "C20") continue
    const content = JAPAN_FIRST_LAUNCH_CONTENT.find((candidate) => candidate.id === storyId)
    const media = content?.editorialMedia
    if (media && ATTACHED_EDITORIAL_MEDIA.has(media.src)) return media
  }
  return null
}

export function editorialMemoryCardViewModelB(place: EditorialPlaceB, locale: OndoBLocale): MyKoreaMemoryCardViewModelB {
  const copy = COPY[locale]
  const media = attachedEditorialStoryMedia(place)
  const address = locale === "ko" ? place.address.ko : place.address.en
  const collection = place.sourceCollection[locale]

  return Object.freeze({
    objectId: place.id,
    objectNamespace: "jeju-editorial-place",
    title: place.name[locale],
    subtitle: address,
    accessibleLabel: `${place.name[locale]}. ${copy.editorial}. ${address}`,
    source: Object.freeze({ kind: "editorial_place", label: copy.editorial, officialRecord: false }),
    recordProvenance: Object.freeze({ sourceId: place.placeSourceUrl, label: `${place.placeSourceLabel} · ${collection}` }),
    media: Object.freeze({
      kind: media ? "editorial_illustration" : "pictogram_fallback",
      src: media?.src ?? null,
      mediaSourceId: media?.src ?? `pictogram:${place.category}`,
      exactVenuePhoto: false,
      alt: media?.alt[locale] ?? "",
      label: media ? copy.storyImage : copy.editorialPlace,
      mediaCredit: media?.credit[locale] ?? copy.pictogramCredit,
      rights: Object.freeze(media
        ? { mode: "ondo_original" as const, label: copy.editorialRights }
        : { mode: "interface_pictogram" as const, label: copy.pictogramRights }),
      disclosureLabel: copy.imageDetails,
      recordSourceLabel: copy.recordSource,
      mediaCreditLabel: copy.mediaCreditLabel,
      rightsLabel: copy.rightsLabel,
      fallbackLabel: copy.editorialPlace,
      failureLabel: copy.unavailable,
      crop: stableMyKoreaMemoryCropB("jeju-editorial-place", place.id),
    }),
  })
}

/** A native research/market bookmark, not an official merchant or accepted perk. */
export function discoveryMemoryCardViewModelB(place: PersonalPlaceB, locale: OndoBLocale): MyKoreaMemoryCardViewModelB {
  const copy = COPY[locale]
  return {
    objectId: place.id, objectNamespace: "discovery-place", title: place.name, subtitle: place.address,
    accessibleLabel: `${place.name}. ${copy.editorial}. ${place.address}`,
    source: { kind: "discovery_place", label: copy.editorial, officialRecord: false },
    recordProvenance: { sourceId: place.source, label: place.source },
    media: { kind: "pictogram_fallback", src: null, mediaSourceId: "pictogram:place", exactVenuePhoto: false, alt: "", label: copy.editorialPlace,
      mediaCredit: copy.pictogramCredit, rights: { mode: "interface_pictogram", label: copy.pictogramRights }, disclosureLabel: copy.imageDetails,
      recordSourceLabel: copy.recordSource, mediaCreditLabel: copy.mediaCreditLabel, rightsLabel: copy.rightsLabel, fallbackLabel: copy.editorialPlace,
      failureLabel: copy.unavailable, crop: "50% 50%" },
  }
}
