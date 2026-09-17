"use client"

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Bookmark, CalendarDays, ChevronRight, FlaskConical, History, LockKeyhole, MapPin, MessageSquareText, ReceiptText, Trash2 } from "lucide-react"
import { venueNamePresentation, venueDistrictLabel } from "@/lib/ondo/venues/display"
import { canonicalMapVenueById } from "@/lib/ondo/venues/map-data"
import {
  openMyKoreaSavedBDiscoveryEditorialPlace,
  openMyKoreaSavedBDiscoveryVenue,
} from "../map/b-discovery-history"
import { editorialPlaceById, type EditorialPlaceB } from "../pulse-b/japan-first-pulse-model-b"
import type { OndoBLocale } from "../shared/state/ondo-b-preferences"
import { useOndoB } from "../shared/state/ondo-b-provider"
import { ondoBProductTimeline } from "../shared/time/product-timeline-b"
import { ondoBTableById, ondoBTableTimeline } from "../connect/table-model"
import styles from "../shared/ui/production-local.module.css"
import { ONDO_MODAL_PRIORITY } from "../shared/ui/modal-layer-priority"
import { useModalIsolation } from "../shared/ui/use-modal-isolation"
import savedStyles from "./saved-entry-b.module.css"
import {
  editorialMemoryCardViewModelB,
  officialMemoryCardViewModelB,
  resolveVisibleMyKoreaMemorySequenceB,
  type MyKoreaMemoryCardViewModelB,
} from "./memory-venue-card-b-model"
import { MyKoreaMemoryThumbnailB, MyKoreaMemoryVenueCardB } from "./memory-venue-card-b"
import { MY_KOREA_TABLE_CATALOG, resolveSavedRemovalFocusIndex } from "./my-korea-model"
import { KoreaMemoryMapB } from "./korea-memory-map-b"
import { PrivateNote } from "./private-note"
import { STABLE_B_KRW_PRICE, STABLE_B_OOKRW_PRICE, stableCommerceOrderB } from "../commerce-b/stable-commerce-model-b"
import { resolveCommercePlaceB, requestPlaceServiceReturnB } from "../commerce-b/place-service-registry-b"
import { ProfileReputationEntryB } from "../identity-b/profile-reputation-b"

const ONDO_OPEN_TABLE_EVENT = "ondo:b:open-table"

const COPY = {
  en: {
    eyebrow: "YOUR TRIP",
    title: "My Korea",
    boundary: "Your saved places, meal plans, and recent discoveries.",
    localPrivacy: "About saved activity",
    localPrivacyBody: "Saved places, recent views, joined Tables, Local Signals, and private notes stay in this browser. They are not reservations or synced activity.",
    savedTitle: "Saved places",
    savedBody: "Food places and travel ideas you chose to keep.",
    savedEmpty: "Nothing saved yet",
    savedEmptyBody: "Save a place from Explore and it will appear here.",
    explore: "Explore places",
    remove: "Remove from saved",
    removeEditorial: "Remove from saved",
    removeBody: "Only this saved bookmark will be removed. Your private note and activity will stay.",
    removeEditorialBody: "Only this saved bookmark will be removed. Your activity will stay.",
    removeCancel: "Keep it",
    removeConfirm: "Remove from saved",
    removing: "Removing…",
    removeFailed: "Couldn’t remove it. Nothing changed. Try again.",
    editorialBoundary: "Travel story",
    recentTitle: "Recently viewed places",
    recentBody: "Food places and travel stories stay easy to tell apart here.",
    recentEmpty: "No recently viewed places",
    recentEmptyBody: "Open a food place from Explore to start this list.",
    viewed: "Viewed",
    plannedTitle: "Planned meals",
    plannedBody: "Your confirmed Tables appear here.",
    plannedEmpty: "No planned meals",
    plannedEmptyBody: "Confirm a Table seat to keep it here.",
    localPreview: "Meal plan",
    openTables: "Open Table",
    contributionsTitle: "Local Signal history",
    contributionsBody: "Successful Local Signals you explicitly post appear here.",
    contributionsEmpty: "No Local Signals yet",
    contributionsEmptyBody: "This stays empty until you add a Local Signal.",
    contributed: "Local Signal added",
    recentSaveFailed: "The place opened, but Recently viewed could not be updated.",
    receiptsTitle: "Selected purchase",
    receiptsBody: "This purchase and its refunds. Open your wallet for all purchases.",
    receiptBoundary: "No charge made · private record",
    paid: "Payment saved",
    refunded: "Payment undone",
    originalPayment: "Original balance record",
    refundReference: "Refund reference",
    receiptDetails: "Receipt details",
    openWallet: "Open wallet",
    openReceiptPlace: "Open exact place",
    openLabs: "Open Labs",
  },
  ko: {
    eyebrow: "나의 여행",
    title: "내 한국",
    boundary: "저장한 장소와 식사 계획, 최근 발견을 한곳에서 확인하세요.",
    localPrivacy: "저장 활동 안내",
    localPrivacyBody: "저장한 장소, 최근 조회, 참여한 테이블, 로컬 시그널과 개인 메모는 이 브라우저에만 남습니다. 예약이나 동기화된 활동 기록이 아닙니다.",
    savedTitle: "저장한 장소",
    savedBody: "직접 저장한 음식 장소와 여행 아이디어입니다.",
    savedEmpty: "아직 저장한 장소가 없어요",
    savedEmptyBody: "탐색에서 다시 보고 싶은 장소를 저장하면 여기에 나타나요.",
    explore: "장소 탐색하기",
    remove: "저장에서 삭제",
    removeEditorial: "저장에서 삭제",
    removeBody: "저장한 북마크만 삭제됩니다. 개인 메모와 활동 기록은 그대로 남아요.",
    removeEditorialBody: "저장한 북마크만 삭제됩니다. 다른 활동 기록은 그대로 남아요.",
    removeCancel: "유지하기",
    removeConfirm: "저장에서 삭제",
    removing: "삭제 중…",
    removeFailed: "삭제하지 못했어요. 바뀐 내용은 없습니다. 다시 시도해 주세요.",
    editorialBoundary: "여행 이야기",
    recentTitle: "최근 본 장소",
    recentBody: "음식 장소와 여행 이야기를 쉽게 구분해 보여줍니다.",
    recentEmpty: "최근 본 장소가 없어요",
    recentEmptyBody: "탐색에서 음식 장소를 열면 이 목록이 시작됩니다.",
    viewed: "조회함",
    plannedTitle: "식사 계획",
    plannedBody: "확정한 테이블이 여기에 나타나요.",
    plannedEmpty: "식사 계획이 없어요",
    plannedEmptyBody: "테이블 좌석을 확정하면 여기에 남습니다.",
    localPreview: "일정 저장됨",
    openTables: "테이블 열기",
    contributionsTitle: "로컬 시그널 기록",
    contributionsBody: "직접 게시에 성공한 로컬 시그널이 여기에 나타납니다.",
    contributionsEmpty: "아직 로컬 시그널이 없어요",
    contributionsEmptyBody: "로컬 시그널을 남기기 전까지 비어 있습니다.",
    contributed: "로컬 시그널 남김",
    recentSaveFailed: "장소는 열었지만 최근 본 목록은 업데이트하지 못했어요.",
    receiptsTitle: "선택한 구매",
    receiptsBody: "이 구매와 환불 기록이에요. 전체 구매는 지갑에서 확인하세요.",
    receiptBoundary: "실제 결제 없음 · 비공개 기록",
    paid: "결제 저장",
    refunded: "결제 되돌림",
    originalPayment: "원 잔액 기록",
    refundReference: "환불 참조",
    receiptDetails: "영수증 상세",
    openWallet: "지갑 열기",
    openReceiptPlace: "이 장소 열기",
    openLabs: "Labs 열기",
  },
  ja: {
    eyebrow: "旅の記録",
    title: "マイ韓国",
    boundary: "保存した場所、食事の予定、最近の発見をまとめて確認できます。",
    localPrivacy: "保存したアクティビティについて",
    localPrivacyBody: "保存した場所、最近見た場所、参加したテーブル、ローカルシグナル、プライベートメモはこのブラウザにのみ残ります。予約や同期されたアクティビティではありません。",
    savedTitle: "保存した場所",
    savedBody: "保存した食の場所と旅のアイデアです。",
    savedEmpty: "まだ保存した場所はありません",
    savedEmptyBody: "「探す」で気になる場所を保存すると、ここに表示されます。",
    explore: "場所を探す",
    remove: "保存から削除",
    removeEditorial: "保存から削除",
    removeBody: "保存したブックマークだけを削除します。プライベートメモとアクティビティは残ります。",
    removeEditorialBody: "保存したブックマークだけを削除します。ほかのアクティビティは残ります。",
    removeCancel: "残す",
    removeConfirm: "保存から削除",
    removing: "削除中…",
    removeFailed: "削除できませんでした。変更はありません。もう一度お試しください。",
    editorialBoundary: "旅ストーリー",
    recentTitle: "最近見た場所",
    recentBody: "食の場所と旅ストーリーを見分けやすく表示します。",
    recentEmpty: "最近見た場所はありません",
    recentEmptyBody: "「探す」で食の場所を開くと、ここに追加されます。",
    viewed: "閲覧済み",
    plannedTitle: "食事の予定",
    plannedBody: "確定したTableがここに表示されます。",
    plannedEmpty: "食事の予定はありません",
    plannedEmptyBody: "テーブルの席を確定すると、ここに残ります。",
    localPreview: "予定を保存",
    openTables: "テーブルを開く",
    contributionsTitle: "ローカルシグナル履歴",
    contributionsBody: "自分で投稿し、完了したローカルシグナルが表示されます。",
    contributionsEmpty: "ローカルシグナルはまだありません",
    contributionsEmptyBody: "ローカルシグナルを投稿するまで、ここは空のままです。",
    contributed: "ローカルシグナルを追加",
    recentSaveFailed: "場所は開きましたが、「最近見た場所」を更新できませんでした。",
    receiptsTitle: "選択した購入",
    receiptsBody: "この購入と返金の記録です。すべての購入はウォレットで確認できます。",
    receiptBoundary: "実際の決済なし・非公開の記録",
    paid: "支払いを保存",
    refunded: "支払いを取り消し",
    originalPayment: "元の残高記録",
    refundReference: "返金参照",
    receiptDetails: "レシートの詳細",
    openWallet: "ウォレットを開く",
    openReceiptPlace: "このお店を開く",
    openLabs: "Labsを開く",
  },
} as const

type RemovalTarget =
  | { kind: "official"; id: string; model: MyKoreaMemoryCardViewModelB }
  | { kind: "editorial"; id: EditorialPlaceB["id"]; model: MyKoreaMemoryCardViewModelB }

const SAVED_EMPTY_LABEL: Record<OndoBLocale, string> = {
  en: "No saved places",
  ko: "저장한 장소 없음",
  ja: "保存した場所なし",
}

const JA_TABLE_TITLE: Record<keyof typeof MY_KOREA_TABLE_CATALOG, string> = {
  "table-busan-gijang-dinner": "機張で囲む小さな夕食",
  "table-seoul-night-bites": "夜食を囲む、ひとつのテーブル",
  "table-jeju-haenyeo-supper": "海女の物語を囲む夕食",
}

function savedListLabel(locale: OndoBLocale, count: number) {
  if (locale === "ko") return `저장한 장소 ${count}곳`
  if (locale === "ja") return `保存した場所 ${count}件`
  return `${count} saved places`
}

function personalVenueName(name: string, locale: OndoBLocale) {
  return venueNamePresentation(name, locale)
}

function personalDistrictLabel(cityId: "seoul" | "busan", districtId: string, locale: OndoBLocale) {
  return venueDistrictLabel(cityId, districtId, locale)
}

function formatReceiptKrw(settlementUnits: number, locale: OndoBLocale) {
  const numberLocale = locale === "ko" ? "ko-KR" : locale === "ja" ? "ja-JP" : "en-US"
  return new Intl.NumberFormat(numberLocale, {
    style: "currency",
    currency: "KRW",
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: 0,
  }).format(settlementUnits * (STABLE_B_KRW_PRICE / STABLE_B_OOKRW_PRICE))
}

function removalQuestion(locale: OndoBLocale, placeName: string) {
  if (locale === "ko") return `${placeName} · 저장에서 삭제할까요?`
  if (locale === "ja") return `${placeName}を保存から削除しますか？`
  return `Remove ${placeName} from saved?`
}

export function SavedEntryB() {
  const { state, actions } = useOndoB()
  const locale = state.locale
  const copy = COPY[locale]
  const [productTimeline] = useState(() => ondoBProductTimeline())
  const [removalTarget, setRemovalTarget] = useState<RemovalTarget | null>(null)
  const [removalState, setRemovalState] = useState<"idle" | "removing" | "failed">("idle")
  const removalTitleId = useId()
  const removalBodyId = useId()
  const removalCancelRef = useRef<HTMLButtonElement>(null)
  const removalConfirmRef = useRef<HTMLButtonElement>(null)
  const removalReturnRef = useRef<HTMLButtonElement | null>(null)
  const removalLayerRef = useRef<HTMLDivElement>(null)
  const removalStateRef = useRef(removalState)
  const removalFocusIndexRef = useRef(0)
  const pendingRemovalFocusRef = useRef(false)
  const savedSectionRef = useRef<HTMLElement>(null)
  const savedHeadingRef = useRef<HTMLHeadingElement>(null)
  const saved = state.savedVenueIds.flatMap((venueId) => {
    const venue = canonicalMapVenueById(venueId)
    return venue ? [venue] : []
  })
  const recent = state.recentVenueIds.flatMap((venueId) => {
    const venue = canonicalMapVenueById(venueId)
    return venue ? [venue] : []
  })
  const savedEditorial = state.savedEditorialPlaceIds.flatMap((placeId) => {
    const place = editorialPlaceById(placeId)
    return place ? [place] : []
  })
  const recentEditorial = state.recentEditorialPlaceIds.flatMap((placeId) => {
    const place = editorialPlaceById(placeId)
    return place ? [place] : []
  })
  const unresolvedSavedMemoryModels = [
    ...saved.map((venue) => officialMemoryCardViewModelB(venue, locale)),
    ...savedEditorial.map((place) => editorialMemoryCardViewModelB(place, locale)),
  ]
  const unresolvedRecentMemoryModels = [
    ...recent.map((venue) => officialMemoryCardViewModelB(venue, locale)),
    ...recentEditorial.map((place) => editorialMemoryCardViewModelB(place, locale)),
  ]
  const visibleMemoryModels = resolveVisibleMyKoreaMemorySequenceB([
    ...unresolvedSavedMemoryModels,
    ...unresolvedRecentMemoryModels,
  ])
  const savedMemoryModels = visibleMemoryModels.slice(0, unresolvedSavedMemoryModels.length)
  const recentMemoryModels = visibleMemoryModels.slice(unresolvedSavedMemoryModels.length)
  const planned = state.plannedTableRefs.flatMap((reference) => {
    const table = MY_KOREA_TABLE_CATALOG[reference.tableId]
    const sourceTable = ondoBTableById(reference.tableId)
    if (!table || !sourceTable) return []
    const venue = table.placeKind === "official" ? canonicalMapVenueById(reference.venueId) : undefined
    const editorialPlace = table.placeKind === "editorial" ? editorialPlaceById(reference.venueId) : undefined
    if (!venue && !editorialPlace) return []
    return [{ reference, table, sourceTable, venue, editorialPlace }]
  })
  const contributions = state.localSignalPostedVenueIds.flatMap((venueId) => {
    const venue = canonicalMapVenueById(venueId)
    return venue ? [venue] : []
  })
  const receiptOrder = stableCommerceOrderB(state.commerceSession)
  const receiptPlace = resolveCommercePlaceB(receiptOrder.venueId)
  const receiptVenue = canonicalMapVenueById(receiptOrder.venueId)
  const paymentReceiptId = state.commerceSession.receiptId ?? receiptOrder.receiptId
  const settledRefunds = (state.commerceSession.refundOperations ?? []).filter(operation => operation.phase === "settled" && operation.receiptId)
  const mappedOfficialVenues = [
    ...saved,
    ...recent,
    ...planned.flatMap(({ venue }) => venue ? [venue] : []),
    ...contributions,
    ...(receiptVenue && (state.commerceSession.status === "paid" || state.commerceSession.status === "refunded") ? [receiptVenue] : []),
  ]
  const memoryCityCounts = {
    seoul: new Set(mappedOfficialVenues.filter((venue) => venue.cityId === "seoul").map((venue) => venue.id)).size,
    busan: new Set(mappedOfficialVenues.filter((venue) => venue.cityId === "busan").map((venue) => venue.id)).size,
    jeju: new Set([
      ...savedEditorial,
      ...recentEditorial,
      ...planned.flatMap(({ editorialPlace }) => editorialPlace ? [editorialPlace] : []),
    ].map((place) => place.id)).size,
  } as const
  const isEmptyJourney = saved.length === 0
    && savedEditorial.length === 0
    && recent.length === 0
    && recentEditorial.length === 0
    && planned.length === 0
    && contributions.length === 0
    && state.commerceSession.status !== "paid"
    && state.commerceSession.status !== "refunded"

  useModalIsolation(Boolean(removalTarget), removalLayerRef)

  useLayoutEffect(() => {
    if (removalTarget || !pendingRemovalFocusRef.current) return
    pendingRemovalFocusRef.current = false
    const openers = Array.from(savedSectionRef.current?.querySelectorAll<HTMLButtonElement>("[data-saved-place-opener]") ?? [])
    const focusIndex = resolveSavedRemovalFocusIndex(removalFocusIndexRef.current, openers.length)
    const destination = focusIndex === null ? savedHeadingRef.current : openers[focusIndex]
    destination?.focus({ preventScroll: true })
  }, [removalTarget, state.savedEditorialPlaceIds, state.savedVenueIds])

  useEffect(() => {
    removalStateRef.current = removalState
  }, [removalState])

  useEffect(() => {
    if (removalTarget && removalState === "failed") {
      window.requestAnimationFrame(() => removalConfirmRef.current?.focus())
    }
  }, [removalState, removalTarget])

  useEffect(() => {
    if (!removalTarget) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    window.requestAnimationFrame(() => removalCancelRef.current?.focus())
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || removalStateRef.current === "removing") return
      event.preventDefault()
      closeRemovalDialog()
    }
    document.addEventListener("keydown", escape)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener("keydown", escape)
    }
  }, [removalTarget])

  useEffect(() => {
    if (!removalTarget || removalState !== "removing") return
    if (removalTarget.kind === "official") {
      if (!state.savedVenueIds.includes(removalTarget.id)) {
        finishRemoval()
        return
      }
      if (state.saveStatusByVenue[removalTarget.id] === "SAV-FAILED") {
        setRemovalState("failed")
      }
      return
    }
    if (!state.savedEditorialPlaceIds.includes(removalTarget.id)) finishRemoval()
  }, [removalState, removalTarget, state.saveStatusByVenue, state.savedEditorialPlaceIds, state.savedVenueIds])

  function openRemovalDialog(target: RemovalTarget, trigger: HTMLButtonElement) {
    const openers = Array.from(savedSectionRef.current?.querySelectorAll<HTMLButtonElement>("[data-saved-place-opener]") ?? [])
    const targetOpener = trigger.closest("article")?.querySelector<HTMLButtonElement>("[data-saved-place-opener]") ?? null
    removalFocusIndexRef.current = Math.max(0, targetOpener ? openers.indexOf(targetOpener) : 0)
    removalReturnRef.current = trigger
    setRemovalState("idle")
    setRemovalTarget(target)
  }

  function closeRemovalDialog() {
    const returnTo = removalReturnRef.current
    setRemovalTarget(null)
    setRemovalState("idle")
    window.requestAnimationFrame(() => returnTo?.focus())
  }

  function finishRemoval() {
    pendingRemovalFocusRef.current = true
    setRemovalTarget(null)
    setRemovalState("idle")
  }

  function confirmRemoval() {
    if (!removalTarget || removalState === "removing") return
    setRemovalState("removing")
    if (removalTarget.kind === "official") {
      actions.toggleSavedVenue(removalTarget.id)
      return
    }
    if (!actions.toggleSavedEditorialPlace(removalTarget.id)) {
      setRemovalState("failed")
    }
  }

  function trapRemovalFocus(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return
    const first = removalCancelRef.current
    const last = removalConfirmRef.current
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  function openVenue(venueId: string, cityId: "seoul" | "busan") {
    const scrollOwner = document.querySelector<HTMLElement>("[data-testid='ondo-scroll-region']")
    if (!openMyKoreaSavedBDiscoveryVenue(venueId, cityId, scrollOwner?.scrollTop ?? 0)) return
    if (!actions.recordRecentVenue(venueId)) actions.notify(copy.recentSaveFailed)
    // Keep the peek selected while revealing the already-mounted Explore map.
    // Resetting to `map` here would erase the traversal applied by MapEntry.
    actions.setSurface({ kind: "venue", venueId })
    actions.setTab("ondo")
  }

  function openEditorialPlace(editorialPlaceId: EditorialPlaceB["id"]) {
    const scrollOwner = document.querySelector<HTMLElement>("[data-testid='ondo-scroll-region']")
    if (!openMyKoreaSavedBDiscoveryEditorialPlace(editorialPlaceId, scrollOwner?.scrollTop ?? 0)) return
    if (!actions.recordRecentEditorialPlace(editorialPlaceId)) actions.notify(copy.recentSaveFailed)
    actions.setSurface({ kind: "editorial_place", editorialPlaceId })
    actions.setTab("ondo")
  }

  function openMemoryPlace(model: MyKoreaMemoryCardViewModelB) {
    if (model.objectNamespace === "canonical-venue") {
      const venue = canonicalMapVenueById(model.objectId)
      if (venue) openVenue(venue.id, venue.cityId)
      return
    }
    const place = editorialPlaceById(model.objectId)
    if (place) openEditorialPlace(place.id)
  }

  function openPlannedTable(tableId: string, venueId: string) {
    window.__ONDO_B_TABLE_INTENT__ = { tableId, venueId, mode: "view" }
    actions.setTab("tables")
    window.setTimeout(() => window.dispatchEvent(new CustomEvent(ONDO_OPEN_TABLE_EVENT, {
      detail: { tableId, venueId, mode: "view" },
    })), 0)
  }

  function openExplore() {
    actions.setSurface({ kind: "map" })
    actions.setTab("ondo")
    window.requestAnimationFrame(() => document.getElementById("ondo-active-panel")?.focus())
  }

  const plannedSection = (
    <section key="planned" className={styles.activitySection} data-testid="my-korea-planned" aria-labelledby="my-korea-planned-heading">
      <div className={styles.activityHeading}><CalendarDays size={19} aria-hidden="true" /><span><h2 id="my-korea-planned-heading">{copy.plannedTitle}</h2><p>{copy.plannedBody}</p></span></div>
      {planned.length === 0 ? <ActivityEmpty testId="my-korea-planned-empty" title={copy.plannedEmpty} body={copy.plannedEmptyBody} /> : (
        <div className={styles.referenceList}>
          {planned.map(({ reference, table, sourceTable, venue, editorialPlace }) => {
            const localizedTable = {
              title: locale === "ja" ? JA_TABLE_TITLE[reference.tableId] : table.title[locale],
              schedule: ondoBTableTimeline(sourceTable, productTimeline, locale).schedule,
            }
            const placeName = venue
              ? personalVenueName(venue.name.ko, locale).officialName
              : editorialPlace?.name[locale] ?? reference.venueId
            return <article key={reference.tableId} className={styles.planReference} data-testid={`planned-table-${reference.tableId}`}><span className={styles.localBadge}>{copy.localPreview}</span><h3>{localizedTable.title}</h3><p>{localizedTable.schedule} · {placeName}</p><button type="button" onClick={() => openPlannedTable(reference.tableId, reference.venueId)}>{copy.openTables}<ChevronRight size={16} aria-hidden="true" /></button></article>
          })}
        </div>
      )}
    </section>
  )

  const savedSection = (
    <section ref={savedSectionRef} key="saved" className={styles.activitySection} data-testid="ondo-b-saved-entry" aria-labelledby="my-korea-saved-heading">
      <div className={styles.activityHeading}><Bookmark size={19} aria-hidden="true" /><span><h2 ref={savedHeadingRef} tabIndex={-1} id="my-korea-saved-heading">{copy.savedTitle}</h2><p>{copy.savedBody}</p></span></div>
      {saved.length === 0 && savedEditorial.length === 0 ? (
        <div className={styles.compactEmpty} aria-label={SAVED_EMPTY_LABEL[locale]}>
          <h3>{copy.savedEmpty}</h3>
          <p>{copy.savedEmptyBody}</p>
          <button type="button" onClick={openExplore}>{copy.explore}</button>
        </div>
      ) : (
        <div className={styles.savedList} aria-label={savedListLabel(locale, saved.length + savedEditorial.length)}>
          {savedMemoryModels.map((model, index) => {
            const venue = model.objectNamespace === "canonical-venue" ? canonicalMapVenueById(model.objectId) : undefined
            const place = model.objectNamespace === "jeju-editorial-place" ? editorialPlaceById(model.objectId) : undefined
            if (!venue && !place) return null
            return (
              <MyKoreaMemoryVenueCardB
                key={`${model.objectNamespace}:${model.objectId}`}
                model={model}
                fit="adaptive"
                priority={index === 0}
                cardTestId={venue ? `saved-card-${venue.id}` : `saved-editorial-card-${place!.id}`}
                action={{
                  label: model.accessibleLabel,
                  onActivate: () => openMemoryPlace(model),
                  testId: venue ? `saved-venue-${venue.id}` : `saved-editorial-${place!.id}`,
                  savedOpener: true,
                }}
                utilities={<div className={savedStyles.savedUtilities} data-has-note={venue ? "true" : "false"}>
                  {venue ? <PrivateNote venueId={venue.id} venueName={model.title} /> : null}
                  <button className={`${styles.remove} ${savedStyles.removeAction}`} type="button" aria-label={`${venue ? copy.remove : copy.removeEditorial}: ${model.title}`} title={`${venue ? copy.remove : copy.removeEditorial}: ${model.title}`} onClick={(event) => openRemovalDialog(venue
                    ? { kind: "official", id: venue.id, model }
                    : { kind: "editorial", id: place!.id, model }, event.currentTarget)}>
                    <Trash2 size={16} aria-hidden="true" />
                    <span className={styles.srOnly}>{venue ? copy.remove : copy.removeEditorial}</span>
                  </button>
                </div>}
              />
            )
          })}
        </div>
      )}
    </section>
  )

  return (
    <div className={styles.screen} data-testid="ondo-b-my-korea-entry" data-visual-direction="warm-living-atlas" data-empty-journey={isEmptyJourney ? "true" : "false"}>
      <header className={styles.header}>
        <h1>{copy.title}</h1>
      </header>

      <div className={styles.memoryStage}>
        <KoreaMemoryMapB locale={locale} cityCounts={memoryCityCounts} />

      {isEmptyJourney ? (
        <div className={styles.memoryEmpty} data-testid="my-korea-empty-memory">
          <Bookmark size={21} aria-hidden="true" />
          <strong>{copy.savedEmpty}</strong>
          <button type="button" data-testid="my-korea-empty-explore" onClick={openExplore}>{copy.explore}<ChevronRight size={17} aria-hidden="true" /></button>
        </div>
      ) : null}

      {!isEmptyJourney ? <div className={styles.activitySections}>
        {saved.length > 0 || savedEditorial.length > 0 || pendingRemovalFocusRef.current ? savedSection : null}
        {planned.length > 0 ? plannedSection : null}

        {recent.length > 0 || recentEditorial.length > 0 ? <section className={styles.activitySection} data-testid="my-korea-recent" aria-labelledby="my-korea-recent-heading">
          <div className={styles.activityHeading}><History size={19} aria-hidden="true" /><span><h2 id="my-korea-recent-heading">{copy.recentTitle}</h2><p>{copy.recentBody}</p></span></div>
          {recent.length === 0 && recentEditorial.length === 0 ? <ActivityEmpty testId="my-korea-recent-empty" title={copy.recentEmpty} body={copy.recentEmptyBody} /> : (
            <div className={styles.referenceList} data-memory-list="recent">
              {recentMemoryModels.map((model, index) => (
                <MyKoreaMemoryVenueCardB
                  key={`${model.objectNamespace}:${model.objectId}`}
                  model={model}
                  fit="adaptive"
                  priority={savedMemoryModels.length === 0 && index === 0}
                  cardTestId={`recent-card-${model.objectId}`}
                  action={{
                    label: model.accessibleLabel,
                    onActivate: () => openMemoryPlace(model),
                    testId: model.objectNamespace === "canonical-venue" ? `recent-venue-${model.objectId}` : `recent-editorial-${model.objectId}`,
                  }}
                />
              ))}
            </div>
          )}
        </section> : null}

        {state.commerceSession.status === "paid" || state.commerceSession.status === "refunded" ? (
          <section className={styles.activitySection} data-testid="my-korea-receipts" aria-labelledby="my-korea-receipts-heading">
            <div className={styles.activityHeading}><ReceiptText size={19} aria-hidden="true" /><span><h2 id="my-korea-receipts-heading">{copy.receiptsTitle}</h2><p>{copy.receiptsBody}</p></span></div>
            <div className={styles.referenceList}>
              <article className={`${styles.planReference} ${savedStyles.receiptCard}`} data-testid="my-korea-selected-purchase" data-order-id={receiptOrder.orderId} data-venue-id={receiptOrder.venueId}>
                <span className={styles.localBadge}>{state.commerceSession.status === "refunded" ? `${copy.refunded} ${formatReceiptKrw(state.commerceSession.chargedDebit, locale)}` : `${copy.paid} ${formatReceiptKrw(state.commerceSession.chargedDebit, locale)}`}</span>
                <h3>{receiptVenue ? personalVenueName(receiptVenue.name.ko, locale).officialName : receiptPlace?.name[locale] ?? copy.receiptsTitle}</h3>
                <span className={savedStyles.receiptBoundary} data-testid="my-korea-receipt-boundary"><LockKeyhole size={14} aria-hidden="true" />{copy.receiptBoundary}</span>
                <details className={styles.receiptDetails} data-testid="my-korea-receipt-details">
                  <summary>{copy.receiptDetails}<ChevronRight size={15} aria-hidden="true" /></summary>
                  <p data-testid="my-korea-payment-reference">{copy.originalPayment}: {paymentReceiptId}</p>
                  {settledRefunds.map(operation => <p key={operation.operationId} data-testid="my-korea-refund-reference">{copy.refundReference}: {operation.receiptId}</p>)}
                </details>
                <div className={savedStyles.receiptActions}>
                  {receiptPlace ? <button type="button" className={savedStyles.receiptPrimary} data-testid="my-korea-receipt-place" onClick={() => requestPlaceServiceReturnB(receiptPlace.id)}>{copy.openReceiptPlace}<ChevronRight size={16} aria-hidden="true" /></button> : receiptVenue ? <button type="button" className={savedStyles.receiptPrimary} data-testid="my-korea-receipt-place" onClick={() => openVenue(receiptVenue.id, receiptVenue.cityId)}>{copy.openReceiptPlace}<ChevronRight size={16} aria-hidden="true" /></button> : null}
                  <button type="button" className={receiptPlace || receiptVenue ? savedStyles.receiptSecondary : savedStyles.receiptPrimary} data-testid="my-korea-receipt-wallet" onClick={() => actions.setTab("id")}>{copy.openWallet}<ChevronRight size={16} aria-hidden="true" /></button>
                </div>
              </article>
            </div>
          </section>
        ) : null}

        {contributions.length > 0 ? <section className={styles.activitySection} data-testid="my-korea-contributions" aria-labelledby="my-korea-contributions-heading">
          <div className={styles.activityHeading}><MessageSquareText size={19} aria-hidden="true" /><span><h2 id="my-korea-contributions-heading">{copy.contributionsTitle}</h2><p>{copy.contributionsBody}</p></span></div>
          {contributions.length === 0 ? <ActivityEmpty testId="my-korea-contributions-empty" title={copy.contributionsEmpty} body={copy.contributionsEmptyBody} /> : (
            <div className={styles.referenceList}>
              {contributions.map((venue) => {
                const name = personalVenueName(venue.name.ko, locale)
                return <button key={venue.id} type="button" className={styles.referenceCard} data-testid={`contribution-venue-${venue.id}`} onClick={() => openVenue(venue.id, venue.cityId)}><MessageSquareText size={18} aria-hidden="true" /><span><strong>{name.officialName}</strong><small>{copy.contributed}</small></span><ChevronRight size={18} aria-hidden="true" /></button>
              })}
            </div>
          )}
        </section> : null}
      </div> : null}
      </div>

      <ProfileReputationEntryB locale={locale} accountActive={state.account === "ACC-ACTIVE"} origin="my_korea" />

      <details className={styles.localPrivacy} data-testid="my-korea-local-privacy">
        <summary><LockKeyhole size={16} aria-hidden="true" /><span>{copy.localPrivacy}</span><ChevronRight size={16} aria-hidden="true" /></summary>
        <p>{copy.localPrivacyBody}</p>
      </details>

      <button className={styles.labsEntry} type="button" data-testid="open-labs" onClick={() => actions.setSurface({ kind: "labs" })}>
        <FlaskConical size={18} aria-hidden="true" />
        <span><strong>Labs</strong></span>
        <ChevronRight size={17} aria-hidden="true" />
        <span className={styles.srOnly}>{copy.openLabs}</span>
      </button>

      {removalTarget && typeof document !== "undefined" ? createPortal(
        <div ref={removalLayerRef} className={savedStyles.removeLayer} data-modal-layer-priority={ONDO_MODAL_PRIORITY.critical}>
          <div
            className={savedStyles.removeDialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby={removalTitleId}
            aria-describedby={removalBodyId}
            data-testid="saved-remove-dialog"
            onKeyDown={trapRemovalFocus}
          >
            <div className={savedStyles.removeScroll} data-testid="saved-remove-scroll" data-sheet-scroll-owner="true">
              <div className={savedStyles.removePreview} data-removal-object-id={removalTarget.model.objectId}>
                <MyKoreaMemoryThumbnailB model={removalTarget.model} />
                <span><strong>{removalTarget.model.title}</strong><small>{removalTarget.model.source.label}</small></span>
              </div>
              <h2 id={removalTitleId}>{removalQuestion(locale, removalTarget.model.title)}</h2>
              <p id={removalBodyId}>{removalTarget.kind === "editorial" ? copy.removeEditorialBody : copy.removeBody}</p>
              {removalState === "failed" ? <p role="alert">{copy.removeFailed}</p> : null}
            </div>
            <div className={savedStyles.removeActions}>
              <button ref={removalCancelRef} type="button" disabled={removalState === "removing"} onClick={closeRemovalDialog}>{copy.removeCancel}</button>
              <button ref={removalConfirmRef} type="button" disabled={removalState === "removing"} onClick={confirmRemoval}>{removalState === "removing" ? copy.removing : copy.removeConfirm}</button>
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </div>
  )
}

function ActivityEmpty({ testId, title, body }: { testId: string; title: string; body: string }) {
  return <div className={styles.compactEmpty} data-testid={testId}><h3>{title}</h3><p>{body}</p></div>
}
