"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Check, ChevronRight, Compass, MapPin, Sparkles, Stamp } from "lucide-react"
import { canonicalMapVenueById } from "@/lib/ondo/venues/map-data"
import { venueDistrictLabel, venueNamePresentation } from "@/lib/ondo/venues/display"
import { openSavedBDiscoveryVenue, readBDiscoveryHistory } from "../map/b-discovery-history"
import { canonicalVenueMoodImage } from "../map/canonical-venue-capsule-b"
import { FoodPhotoB } from "../map/food-photo-b"
import type { OndoBLocale } from "../shared/state/ondo-b-preferences"
import { useOndoB } from "../shared/state/ondo-b-provider"
import { isRenderedProgrammaticFocusTarget } from "../shared/ui/is-rendered-focusable"
import { SheetB } from "../shared/ui/sheet-b"
import { useReviewSampleSession } from "../shared/ui/use-qa-controls"
import { useSheetPresence } from "../shared/ui/use-sheet-presence"
import { useBActivityProfile, type BActivityEvidenceReceipt } from "./activity-profile-b-provider"
import { JOURNEY_STAMPS_OPEN_EVENT_B, requestJourneyKeepsakeB, requestJourneyStampsB } from "./journey-stamps-navigation-b"
import styles from "./journey-stamps-b.module.css"

const COPY = {
  en: {
    title: "Journey stamps", empty: "Every journey starts with a place.", explore: "Explore places", collection: "View collection",
    recent: "Latest stamp", review: "Review only · resets on reload", complete: "Ten places, one little keepsake.", keepsake: "View keepsake",
    collectionBody: "Little moments from your journey.", emptyTitle: "Your first place is waiting", emptyBody: "Explore Korea. Review visit stamps will appear here.",
    about: "About these stamps", boundary: "Review records only, not verified visits. Stamps reset on reload. Opening a place or paying never adds a stamp.",
    unknown: "Place details unavailable", session: "This session", openFailed: "Couldn’t open this place. Your stamps are unchanged.", recentFailed: "The place is open, but its recent history could not be saved.",
    unavailable: "Visit verification isn’t connected yet.", unavailableTitle: "Stamps aren’t available yet", unavailableBody: "You can still explore places freely. No account or identity check is needed.",
    progress: (count: number) => `${count} of 10 journey stamps`, visit: (number: number) => `Visit stamp ${number}`, recorded: (date: string) => `Recorded ${date}`,
  },
  ko: {
    title: "여행 스탬프", empty: "여행은 한 장소에서 시작돼요.", explore: "장소 둘러보기", collection: "모아 보기",
    recent: "최근 스탬프", review: "검토용 · 새로고침하면 초기화", complete: "열 곳의 기록, 작은 기념품 하나.", keepsake: "기념품 보기",
    collectionBody: "여행에서 모은 작은 순간들.", emptyTitle: "첫 번째 장소를 만나보세요", emptyBody: "한국을 둘러보세요. 검토용 방문 스탬프가 여기에 모여요.",
    about: "스탬프 안내", boundary: "실제 방문을 확인한 기록이 아닌 검토용 기록입니다. 새로고침하면 초기화돼요. 장소를 열거나 결제하는 것만으로 스탬프가 추가되지는 않아요.",
    unknown: "장소 정보 없음", session: "현재 세션", openFailed: "장소를 열지 못했어요. 스탬프는 그대로예요.", recentFailed: "장소는 열렸지만 최근 기록을 저장하지 못했어요.",
    unavailable: "아직 방문 확인 서비스가 연결되지 않았어요.", unavailableTitle: "스탬프는 아직 준비 중이에요", unavailableBody: "장소는 자유롭게 둘러볼 수 있어요. 계정이나 본인 확인은 필요 없어요.",
    progress: (count: number) => `여행 스탬프 10개 중 ${count}개`, visit: (number: number) => `방문 스탬프 ${number}`, recorded: (date: string) => `${date} 기록`,
  },
  ja: {
    title: "旅のスタンプ", empty: "旅は、ひとつの場所から。", explore: "場所を探す", collection: "コレクションを見る",
    recent: "最新のスタンプ", review: "レビュー用 · 再読み込みでリセット", complete: "10か所の記録を、小さな記念に。", keepsake: "記念アイテムを見る",
    collectionBody: "旅で集めた、小さなひととき。", emptyTitle: "最初の場所を探しましょう", emptyBody: "韓国を探索。レビュー用の訪問スタンプがここに集まります。",
    about: "スタンプについて", boundary: "実際の訪問を確認した記録ではなく、レビュー用の記録です。再読み込みでリセットされます。場所を開くことや支払いだけでは増えません。",
    unknown: "場所の詳細はありません", session: "現在のセッション", openFailed: "場所を開けませんでした。スタンプは変更されていません。", recentFailed: "場所は開きましたが、最近の履歴を保存できませんでした。",
    unavailable: "訪問確認サービスはまだ接続されていません。", unavailableTitle: "スタンプはまだ準備中です", unavailableBody: "場所は自由に探せます。アカウントや本人確認は不要です。",
    progress: (count: number) => `旅のスタンプ10個中${count}個`, visit: (number: number) => `訪問スタンプ ${number}`, recorded: (date: string) => `${date}に記録`,
  },
} as const

type JourneyStamp = { key: string; receipt?: BActivityEvidenceReceipt; venue: ReturnType<typeof canonicalMapVenueById>; number: number }

/** Receipts describe this in-memory collection; viewing it never creates evidence. */
function journeyStamps(receipts: readonly BActivityEvidenceReceipt[], count: number): JourneyStamp[] {
  const visits = receipts.filter(receipt => receipt.addsVisitStamp && receipt.evidenceId.startsWith("visit:")).slice(-count).reverse()
  return Array.from({ length: count }, (_, index) => {
    const receipt = visits[index]
    return {
      key: receipt?.evidenceId ?? `unavailable:${index}`,
      receipt,
      venue: receipt ? canonicalMapVenueById(receipt.evidenceId.slice("visit:".length)) : undefined,
      number: count - index,
    }
  })
}

function recordedDate(receipt: BActivityEvidenceReceipt | undefined, locale: OndoBLocale) {
  if (!receipt) return null
  const date = new Date(receipt.recordedAt)
  if (!Number.isFinite(date.getTime())) return null
  return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : locale === "ja" ? "ja-JP" : "en-US", { month: "short", day: "numeric" }).format(date)
}

function StampProgress({ count, locale }: { count: number; locale: OndoBLocale }) {
  return <div className={styles.progress} role="img" aria-label={COPY[locale].progress(count)}>
    {Array.from({ length: 10 }, (_, index) => <span key={index} data-filled={index < count} aria-hidden="true">{index < count ? <Check size={12} strokeWidth={2.8} /> : null}</span>)}
  </div>
}

export function JourneyStampsCardB({ locale }: { locale: OndoBLocale }) {
  const { state } = useBActivityProfile()
  const { actions } = useOndoB()
  const review = useReviewSampleSession()
  const count = review ? Math.min(10, Math.max(0, state.stamps)) : 0
  const copy = COPY[locale]
  const recent = journeyStamps(state.evidenceReceipts, count)[0]
  const recentName = recent?.venue ? venueNamePresentation(recent.venue.name.ko, locale).officialName : recent ? copy.visit(recent.number) : null

  function explore() {
    actions.setSurface({ kind: "map" })
    actions.setTab("ondo")
    window.requestAnimationFrame(() => {
      const destination = Array.from(document.querySelectorAll<HTMLElement>("[data-testid='ondo-b-search'], [data-testid='ondo-b-nation'] button, [aria-current='page']")).find(isRenderedProgrammaticFocusTarget)
      destination?.focus({ preventScroll: true })
    })
  }

  return <article className={styles.card} data-testid="ondo-b-stamp-milestone" data-stamps={count} data-mode={review ? "review" : "unavailable"}>
    <div className={styles.cardHeading}>
      <span className={styles.icon}><Stamp size={20} strokeWidth={1.6} aria-hidden="true" /></span>
      <div><h2>{copy.title}</h2><p>{!review ? copy.unavailable : count === 10 ? copy.complete : count === 0 ? copy.empty : copy.recent}</p></div>
      {review ? <strong className={styles.count} aria-label={copy.progress(count)}>{count}<span>/10</span></strong> : null}
    </div>
    {review ? <StampProgress count={count} locale={locale} /> : null}
    {recentName ? <p className={styles.recent}><MapPin size={14} aria-hidden="true" /><span>{recentName}</span></p> : null}
    {review ? <p className={styles.review} data-testid="journey-stamps-lifetime">{copy.review}</p> : null}
    <div className={styles.cardActions}>
      <button type="button" data-testid={count ? "journey-stamps-open" : "journey-stamps-explore"} onClick={count ? requestJourneyStampsB : explore}>
        {count ? copy.collection : copy.explore}<ChevronRight size={16} aria-hidden="true" />
      </button>
    </div>
    {count === 10 ? <button type="button" className={styles.keepsake} data-testid="open-labs-milestone" onClick={requestJourneyKeepsakeB}><Sparkles size={16} aria-hidden="true" />{copy.keepsake}<ChevronRight size={16} aria-hidden="true" /></button> : null}
  </article>
}

/** Global sheet: the caller's surface and tab remain intact until an explicit destination is chosen. */
export function JourneyStampsOverlayB() {
  const { state } = useBActivityProfile()
  const { state: ondo, actions } = useOndoB()
  const review = useReviewSampleSession()
  const [open, setOpen] = useState(false)
  const presence = useSheetPresence(open ? true : null)
  const destinationRef = useRef<(() => void) | null>(null)
  const handingOffRef = useRef(false)
  const focusFrameRef = useRef<number | null>(null)
  const locale = ondo.locale
  const copy = COPY[locale]
  const count = review ? Math.min(10, Math.max(0, state.stamps)) : 0
  const stamps = useMemo(() => journeyStamps(state.evidenceReceipts, count), [count, state.evidenceReceipts])

  useEffect(() => {
    const show = () => {
      if (focusFrameRef.current !== null) window.cancelAnimationFrame(focusFrameRef.current)
      destinationRef.current = null
      handingOffRef.current = false
      setOpen(true)
    }
    window.addEventListener(JOURNEY_STAMPS_OPEN_EVENT_B, show)
    return () => window.removeEventListener(JOURNEY_STAMPS_OPEN_EVENT_B, show)
  }, [])

  useEffect(() => {
    if (presence.phase !== "closed") return
    const destination = destinationRef.current
    destinationRef.current = null
    destination?.()
  }, [presence.phase])

  useEffect(() => () => {
    destinationRef.current = null
    if (focusFrameRef.current !== null) window.cancelAnimationFrame(focusFrameRef.current)
  }, [])

  function close() {
    if (!open) return
    destinationRef.current = null
    handingOffRef.current = false
    setOpen(false)
  }

  function handOff(destination: () => void) {
    if (!open) return
    handingOffRef.current = true
    destinationRef.current = destination
    setOpen(false)
  }

  function focusDestination(selector: string, attempt = 0) {
    focusFrameRef.current = window.requestAnimationFrame(() => {
      const target = Array.from(document.querySelectorAll<HTMLElement>(selector)).find(isRenderedProgrammaticFocusTarget)
      if (target) target.focus({ preventScroll: true })
      if ((!target || document.activeElement !== target) && attempt < 30) focusDestination(selector, attempt + 1)
    })
  }

  function explore() {
    handOff(() => {
      actions.setSurface({ kind: "map" })
      actions.setTab("ondo")
      focusDestination("[data-testid='ondo-b-search'], [data-testid='ondo-b-nation'] button, [aria-current='page']")
    })
  }

  function openPlace(stamp: JourneyStamp) {
    const venue = stamp.venue
    if (!venue) return
    handOff(() => {
      const current = readBDiscoveryHistory()
      const alreadyOpen = current?.venueId === venue.id && (current.level === "peek" || current.level === "detail")
      if (!alreadyOpen && !openSavedBDiscoveryVenue(venue.id, venue.cityId)) {
        actions.notify(copy.openFailed)
        handingOffRef.current = false
        setOpen(true)
        return
      }
      if (!actions.recordRecentVenue(venue.id)) actions.notify(copy.recentFailed)
      actions.setSurface({ kind: "venue", venueId: venue.id })
      actions.setTab("ondo")
      focusDestination("[data-testid='canonical-place-peek'], [data-testid='canonical-place-overlay']")
    })
  }

  if (presence.value === null) return null

  return <SheetB locale={locale} label={copy.title} onClose={close} variant="full-task" modalPriority={141} presenceState={presence.phase} shouldRestoreFocus={() => !handingOffRef.current} header={<h2 className={styles.sheetTitle}>{copy.title}</h2>}>
    <section className={styles.collection} data-testid="journey-stamps-collection" data-stamps={count} data-mode={review ? "review" : "unavailable"}>
      {review ? <><div className={styles.collectionHero}>
        <span className={styles.collectionIcon}><Stamp size={26} strokeWidth={1.4} aria-hidden="true" /></span>
        <div><p>{copy.collectionBody}</p><strong>{count}<span> / 10</span></strong></div>
      </div>
      <StampProgress count={count} locale={locale} />
      <p className={styles.review} data-testid="journey-stamps-lifetime">{copy.review}</p></> : null}
      {count ? <ol className={styles.placeList}>
        {stamps.map(stamp => {
          const date = recordedDate(stamp.receipt, locale)
          const name = stamp.venue ? venueNamePresentation(stamp.venue.name.ko, locale) : null
          const content = <>
            {stamp.venue ? <span className={styles.photo}><FoodPhotoB src={canonicalVenueMoodImage(stamp.venue)} locale={locale} compact /></span> : <span className={styles.unknownIcon}><Stamp size={23} strokeWidth={1.5} aria-hidden="true" /></span>}
            <span className={styles.placeCopy}>
              <strong>{name?.officialName ?? copy.visit(stamp.number)}</strong>
              {name && locale !== "ko" ? <small aria-label={name.transliterationLabel}>{name.transliteration}</small> : null}
              <small>{stamp.venue ? venueDistrictLabel(stamp.venue.cityId, stamp.venue.districtId, locale) : copy.unknown}</small>
              {date ? <time dateTime={stamp.receipt?.recordedAt}>{copy.recorded(date)}</time> : <small>{copy.session}</small>}
            </span>
            {stamp.venue ? <ChevronRight size={17} aria-hidden="true" /> : null}
          </>
          return <li key={stamp.key} data-testid="journey-stamp-row" data-venue-id={stamp.venue?.id}>
            {stamp.venue ? <button type="button" className={styles.placeRow} onClick={() => openPlace(stamp)}>{content}</button> : <div className={styles.placeRow}>{content}</div>}
          </li>
        })}
      </ol> : <div className={styles.empty}>
        <Compass size={31} strokeWidth={1.3} aria-hidden="true" /><h3>{review ? copy.emptyTitle : copy.unavailableTitle}</h3><p>{review ? copy.emptyBody : copy.unavailableBody}</p>
        <button type="button" className={styles.explore} onClick={explore}>{copy.explore}<ChevronRight size={17} aria-hidden="true" /></button>
      </div>}
      {count === 10 ? <button type="button" className={styles.keepsake} data-testid="journey-stamps-keepsake" onClick={requestJourneyKeepsakeB}><Sparkles size={17} aria-hidden="true" />{copy.keepsake}<ChevronRight size={17} aria-hidden="true" /></button> : null}
      {review ? <details className={styles.boundary}><summary>{copy.about}</summary><p>{copy.boundary}</p></details> : null}
    </section>
  </SheetB>
}
