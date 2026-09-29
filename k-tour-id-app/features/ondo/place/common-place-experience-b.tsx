"use client"

import { type ReactNode, useState } from "react"
import { Bookmark, Check, Footprints, Navigation } from "lucide-react"
import { useOndoB } from "../shared/state/ondo-b-provider"
import type { OndoBLocale } from "../shared/state/ondo-b-preferences"
import { ExperienceEntryB } from "../experience-b/experience-b"
import { PrivateNote } from "../my/private-note"
import { PlaceDetailActionsB } from "./place-detail-actions-b"
import { personalPlaceByIdB } from "./place-memory-model-b"
import { usePlaceMemoriesB, writePlaceMemoryB } from "./place-memory-b"
import styles from "./common-place-experience-b.module.css"

const COPY = {
  ko: { title: "장소 상세", save: "내 한국에 저장", remove: "내 한국에서 삭제", directions: "길찾기", memories: "가이드·여행 기록", visited: "내 방문 기록 남기기", undo: "방문 기록 지우기", recorded: "내 여행에 기록했어요", local: "개인 기록 · 이 브라우저에 저장돼요. 인증된 방문이나 혜택 이용 기록은 아니에요.", failed: "이 기기에 저장하지 못했어요. 다시 시도해 주세요." },
  en: { title: "Place details", save: "Save to My Korea", remove: "Remove from My Korea", directions: "Directions", memories: "Guides & memories", visited: "Add a personal visit", undo: "Remove personal visit", recorded: "In your travel journal", local: "Private record, saved in this browser. Not a verified visit or perk receipt.", failed: "Couldn’t save on this device. Please try again." },
  ja: { title: "スポット詳細", save: "マイ韓国に保存", remove: "マイ韓国から削除", directions: "ルート", memories: "ガイド・旅の記録", visited: "自分の訪問メモを残す", undo: "訪問メモを削除", recorded: "旅の記録に保存しました", local: "このブラウザに保存される個人メモです。認証済みの訪問や特典利用の記録ではありません。", failed: "この端末に保存できませんでした。もう一度お試しください。" },
} as const
export const commonPlaceTitleB = (locale: OndoBLocale) => COPY[locale].title

export function PlaceJournalB({ placeId, locale }: { placeId: string; locale: OndoBLocale }) {
  const memories = usePlaceMemoriesB()
  const [failed, setFailed] = useState(false)
  const place = personalPlaceByIdB(placeId, locale)
  if (!place) return null
  const copy = COPY[locale]
  const visitedAt = memories[placeId]?.visitedAt
  return <div className={styles.journal} data-testid="place-personal-journal" data-place-id={placeId} data-provenance="self-reported-local">
    <button type="button" className={styles.visit} data-testid="place-personal-visit" aria-pressed={Boolean(visitedAt)} onClick={() => setFailed(!writePlaceMemoryB(placeId, { visitedAt: visitedAt ? null : new Date().toISOString() }))}>
      {visitedAt ? <Check size={18} aria-hidden="true" /> : <Footprints size={18} aria-hidden="true" />}<span>{visitedAt ? copy.undo : copy.visited}</span>
    </button>
    {visitedAt ? <p role="status">{copy.recorded} · {visitedAt.slice(0, 10)}</p> : null}
    <PrivateNote key={placeId} venueId={placeId} venueName={place.name} />
    <details className={styles.local}><summary>{locale === "ko" ? "기록 안내" : locale === "ja" ? "記録について" : "About this record"}</summary><p>{copy.local}</p></details>
    {failed ? <p role="alert">{copy.failed}</p> : null}
  </div>
}

/** One complete decision body, not just a shared CTA: source context is additive;
 * identity → context → place conditions → supported services → personal journey
 * → bookmark/directions is the same for directory, story and map entry points.
 * Fragment output preserves the established canonical desktop grid and focus owners. */
export function CommonPlaceExperienceB({ placeId, locale, identity, context, temperature, table, onSave, saved: savedOverride, directions, classes = {}, saveTestId = "place-save", directionsTestId = "place-directions", onOffer, offerTestId, actionsTestId, tripTestId = "place-trip-actions", decisionsTestId = "place-decisions" }: {
  placeId: string; locale: OndoBLocale; identity: ReactNode; context?: ReactNode; temperature?: ReactNode; table?: ReactNode
  onSave?: () => void; saved?: boolean; directions: string
  classes?: { actions?: string; trip?: string; decisions?: string; saveLabel?: string }
  saveTestId?: string; directionsTestId?: string; onOffer?: () => void; offerTestId?: string; actionsTestId?: string; tripTestId?: string; decisionsTestId?: string
}) {
  const { state, actions } = useOndoB()
  const memories = usePlaceMemoriesB()
  const [error, setError] = useState(false)
  const place = personalPlaceByIdB(placeId, locale)
  if (!place) return null
  const copy = COPY[locale]
  const saved = savedOverride ?? (place.kind === "canonical" ? state.savedVenueIds.includes(placeId) : place.kind === "editorial" ? state.savedEditorialPlaceIds.some(id => id === placeId) : memories[placeId]?.saved === true)
  const toggle = () => {
    if (onSave) { onSave(); return }
    if (place.kind === "canonical") { actions.toggleSavedVenue(placeId); return }
    if (place.kind === "editorial") { setError(!actions.toggleSavedEditorialPlace(placeId as Parameters<typeof actions.toggleSavedEditorialPlace>[0])); return }
    setError(!writePlaceMemoryB(placeId, { saved: !saved }))
  }
  return <>
    {identity}
    {context}
    {temperature}
    <PlaceDetailActionsB placeId={placeId} locale={locale} className={classes.actions} testId={actionsTestId} onOffer={onOffer} offerTestId={offerTestId} includeGuide={false} />
    <section className={classes.trip ?? styles.trip} data-testid={tripTestId} data-common-place-section="memories" data-place-id={placeId} aria-label={copy.memories}>
      <h3>{copy.memories}</h3>
      <ExperienceEntryB placeId={placeId} locale={locale} />
      <PlaceJournalB key={`journal-${placeId}`} placeId={placeId} locale={locale} />
    </section>
    {table}
    <div className={classes.decisions ?? styles.decisions} data-testid={decisionsTestId} data-common-place-section="decisions" data-place-id={placeId} data-place-return-section="decisions">
      <button type="button" onClick={toggle} aria-label={saved ? copy.remove : copy.save} aria-pressed={saved} data-testid={saveTestId} data-place-return-focus="save"><Bookmark size={18} aria-hidden="true" /><span className={classes.saveLabel}>{saved ? copy.remove : copy.save}</span></button>
      <a href={directions} target="_blank" rel="noopener noreferrer" aria-label={copy.directions} title={copy.directions} data-testid={directionsTestId} data-place-return-focus="directions"><Navigation size={18} aria-hidden="true" /><span className={styles.srOnly}>{copy.directions}</span></a>
    </div>
    {error ? <p role="alert" className={styles.error}>{copy.failed}</p> : null}
  </>
}
