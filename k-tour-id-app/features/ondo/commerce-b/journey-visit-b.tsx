"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Check, ChevronRight, Stamp } from "lucide-react"
import { canonicalMapVenueById } from "@/lib/ondo/venues/map-data"
import { venueNamePresentation, venueDistrictLabel } from "@/lib/ondo/venues/display"
import type { OndoBLocale } from "../shared/state/ondo-b-preferences"
import { useBActivityProfile } from "../identity-b/activity-profile-b-provider"
import { requestJourneyStampsB } from "../identity-b/journey-stamps-navigation-b"
import { SheetB } from "../shared/ui/sheet-b"
import { useSheetPresence } from "../shared/ui/use-sheet-presence"
import { useQaControls } from "../shared/ui/use-qa-controls"
import { VisitStampReceiptB } from "./visit-stamp-receipt-b"
import styles from "./journey-visit-b.module.css"

const COPY = {
  en: { title: "Journey stamps", add: "Keep this stop in your pass", saved: "This stop is in your pass", unavailable: "About visit stamps", sheet: "Your visit", place: "Back to this place", receipt: "Back to receipt", collection: "View stamps" },
  ko: { title: "여행 스탬프", add: "이 장소를 패스에 기록해요", saved: "패스에 기록한 장소예요", unavailable: "방문 스탬프 안내", sheet: "방문 기록", place: "이 장소로 돌아가기", receipt: "영수증으로 돌아가기", collection: "스탬프 보기" },
  ja: { title: "旅のスタンプ", add: "この場所をパスに記録", saved: "パスに記録した場所です", unavailable: "訪問スタンプについて", sheet: "訪問の記録", place: "この場所に戻る", receipt: "明細に戻る", collection: "スタンプを見る" },
} as const

/** The same optional visit action is reachable before or after a payment.
 * Opening, saving a place, or paying never awards a stamp. */
export function JourneyVisitEntryB({ locale, venueId, context = "place" }: { locale: OndoBLocale; venueId: string; context?: "place" | "receipt" }) {
  const { state } = useBActivityProfile()
  const review = useQaControls()
  const [open, setOpen] = useState(false)
  const presence = useSheetPresence(open ? venueId : null)
  const collectionPending = useRef(false)
  const collectionHandoff = useRef(false)
  const entryRef = useRef<HTMLButtonElement>(null)
  const venue = canonicalMapVenueById(venueId)
  const recorded = review && state.acceptedEvidenceIds.includes(`visit:${venueId}`)
  const copy = COPY[locale]
  const returnRef = useRef<HTMLButtonElement>(null)
  const previouslyRecorded = useRef(recorded)

  useEffect(() => {
    const justRecorded = recorded && !previouslyRecorded.current
    previouslyRecorded.current = recorded
    if (!justRecorded || !open) return
    // The confirmation button disappears after success. Hand keyboard focus
    // to the next action instead of leaving it on body (where Escape is lost).
    const frame = window.requestAnimationFrame(() => returnRef.current?.focus({ preventScroll: true }))
    return () => window.cancelAnimationFrame(frame)
  }, [recorded, open])

  useEffect(() => {
    if (presence.phase !== "closed" || !collectionPending.current) return
    collectionPending.current = false
    const frame = window.requestAnimationFrame(() => {
      entryRef.current?.focus({ preventScroll: true })
      requestJourneyStampsB()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [presence.phase])

  // If an outer context is replaced, no delayed handoff can resurrect it.
  useEffect(() => () => { collectionPending.current = false }, [])

  if (!venue) return null
  const name = venueNamePresentation(venue.name.ko, locale)
  // Keep the dialog out of the place/receipt's scrolling content. SheetB uses
  // canvas-relative viewport coordinates; nesting it in an overflow container
  // can clip its header when saving changes the content and footer height.
  const canvas = typeof document === "undefined" ? null : document.querySelector("[data-testid='ondo-canvas']")

  return <>
    <button ref={entryRef} type="button" className={styles.entry} data-testid={context === "place" ? "canonical-journey-open" : "receipt-journey-open"} data-recorded={recorded} onClick={() => { collectionHandoff.current = false; setOpen(true) }}>
      <span className={styles.glyph}>{recorded ? <Check size={20} aria-hidden="true" /> : <Stamp size={20} aria-hidden="true" />}</span>
      <span className={styles.entryText}><strong>{copy.title}</strong><small>{recorded ? copy.saved : review ? copy.add : copy.unavailable}</small></span>
      <ChevronRight size={18} aria-hidden="true" />
    </button>
    {presence.value && canvas ? createPortal(<SheetB locale={locale} label={copy.sheet} header={copy.sheet} variant="decision" modalPriority={140} presenceState={presence.phase} navigation="back" onClose={() => setOpen(false)} shouldRestoreFocus={() => !collectionHandoff.current}
      footer={recorded ? <div className={styles.actions}>
        <button ref={returnRef} type="button" className={styles.primary} data-testid="journey-visit-return" onClick={() => setOpen(false)}>{context === "place" ? copy.place : copy.receipt}</button>
        <button type="button" className={styles.secondary} data-testid="journey-visit-pass" onClick={() => { collectionHandoff.current = true; collectionPending.current = true; setOpen(false) }}>{copy.collection}<ChevronRight size={16} aria-hidden="true" /></button>
      </div> : undefined}>
      <div className={styles.content} data-testid="journey-visit-sheet" data-venue-id={venueId} data-recorded={recorded}>
        <header className={styles.place}><small>{venueDistrictLabel(venue.cityId, venue.districtId, locale)}</small><h2>{name.officialName}</h2>{locale !== "ko" && name.transliteration ? <p>{name.transliteration}</p> : null}</header>
        <VisitStampReceiptB locale={locale} venueId={venueId} active={open && presence.phase === "open"} />
      </div>
    </SheetB>, canvas) : null}
  </>
}
