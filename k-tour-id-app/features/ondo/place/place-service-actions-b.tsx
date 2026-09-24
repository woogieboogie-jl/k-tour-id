"use client"

import { CalendarClock, ChevronRight, WalletCards } from "lucide-react"
import type { ReactNode } from "react"
import { resolveCommercePlaceB } from "../commerce-b/place-service-registry-b"
import { capturePlaceServiceMapReturnB } from "../map/place-service-map-return-b"
import { requestReservationSampleB } from "../reservation-b/reservation-model-b"
import { useOndoB } from "../shared/state/ondo-b-provider"
import { useReviewSampleSession } from "../shared/ui/use-qa-controls"
import styles from "./place-service-actions-b.module.css"
import { ExperienceEntryB } from "../experience-b/experience-b"

const COPY = {
  ko: { offer: "결제 금액 확인", benefit: "최대", discount: "할인", reserve: "매장 예약", reserveHint: "날짜 · 인원 선택" },
  en: { offer: "Review payment", benefit: "Up to", discount: "off", reserve: "Reserve a table", reserveHint: "Date · party size" },
  ja: { offer: "支払いを確認", benefit: "最大", discount: "割引", reserve: "お店を予約", reserveHint: "日付・人数を選ぶ" },
} as const

/** A peek offers one supported next action, never a new row of product tools.
 * Directions remain reachable in the full place details. */
export function PlacePeekActionsB({ placeId, locale, className, details, directions, directionsFirst = false, onOffer, actionTestId = "peek-place-service" }: {
  placeId: string; locale: "en" | "ko" | "ja"; className: string
  details: (hasService: boolean) => ReactNode; directions: ReactNode; directionsFirst?: boolean; onOffer?: () => void
  actionTestId?: string
}) {
  const { actions } = useOndoB()
  const sampleMode = useReviewSampleSession()
  const registered = resolveCommercePlaceB(placeId)
  const place = sampleMode && registered && (registered.commerce || registered.reservation) ? registered : null
  const copy = COPY[locale]
  return <div className={className} data-peek-has-service={Boolean(place)}>
    {place ? <><button type="button" data-testid={actionTestId} data-place-service={place.commerce ? "offer" : "reservation"} data-place-return-section="offer" data-capability-mode="sample" data-service-place-id={place.id} data-visual-priority="primary" onClick={() => {
      capturePlaceServiceMapReturnB(place.id)
      if (place.commerce) { if (onOffer) onOffer(); else actions.openMealBenefitFromPlace(place.id) }
      else requestReservationSampleB({ venueId: place.id })
    }}>{place.commerce ? <WalletCards size={17} aria-hidden="true" /> : <CalendarClock size={17} aria-hidden="true" />}{place.commerce ? copy.offer : copy.reserve}</button>{details(true)}</> : directionsFirst ? <>{directions}{details(false)}</> : <>{details(false)}{directions}</>}
  </div>
}

/** Capabilities are an explicit walkthrough registry, never inferred from a
 * guide entry or directory record. Production hides these sample actions. */
export function PlaceServiceActionsB({ placeId, locale, onOffer, offerTestId, offerInFooter = false, presentation = "default", includeGuide = true }: {
  placeId: string
  locale: "en" | "ko" | "ja"
  onOffer?: () => void
  offerTestId?: string
  /** One action owner: a research detail can place the offer in its footer. */
  offerInFooter?: boolean
  /** Canonical detail owns a separate freely readable guide group. */
  includeGuide?: boolean
  /** Compact service rows in full detail; other entry points retain tiles. */
  presentation?: "default" | "place-detail"
}) {
  const { actions } = useOndoB()
  const sampleMode = useReviewSampleSession()
  const place = resolveCommercePlaceB(placeId)
  if (!sampleMode || !place || (!place.commerce && !place.reservation)) return null
  const copy = COPY[locale]
  const guide = includeGuide ? <ExperienceEntryB placeId={placeId} locale={locale} /> : null
  return <>{presentation === "place-detail" ? guide : null}{(!offerInFooter && place.commerce) || place.reservation ? <section className={styles.actions} data-testid="place-service-actions" data-service-layout={presentation === "place-detail" ? "rows" : "tiles"} data-service-place-id={place.id} data-place-return-section="offer" data-capability-mode="sample">
    {place.commerce && !offerInFooter ? <button type="button" className={styles.primary} data-testid={offerTestId ?? "place-offer-open"} data-place-service="offer" data-offer-id={place.commerce.offerId} onClick={() => {
      capturePlaceServiceMapReturnB(place.id)
      if (onOffer) onOffer()
      else actions.openMealBenefitFromPlace(place.id)
    }}>
      <WalletCards size={20} aria-hidden="true" /><span><strong>{copy.offer}</strong><small>{copy.benefit} ₩{place.commerce.benefitKrw.toLocaleString("en-US")} {copy.discount}</small></span><ChevronRight size={18} aria-hidden="true" />
    </button> : null}
    {place.reservation ? <button type="button" className={styles.secondary} data-testid="place-reservation-open" data-place-service="reservation" onClick={() => {
      capturePlaceServiceMapReturnB(place.id)
      requestReservationSampleB({ venueId: place.id })
    }}>
      <CalendarClock size={20} aria-hidden="true" /><span><strong>{copy.reserve}</strong><small>{copy.reserveHint}</small></span><ChevronRight size={18} aria-hidden="true" />
    </button> : null}
  </section> : null}{presentation === "default" ? guide : null}</>
}
