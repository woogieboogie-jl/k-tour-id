"use client"

import { HackathonEntitlementCtaB } from "../hackathon-b/hackathon-cta-b"
import { PlaceServiceActionsB } from "./place-service-actions-b"
import styles from "./place-detail-actions-b.module.css"

/** One downstream decision surface for map, editorial and story entries.
 * Source-specific context belongs above this block. Capabilities still decide
 * what exists: a guide pick never becomes an accepted merchant or CX venue. */
export function PlaceDetailActionsB({ placeId, locale, className, testId = "place-detail-actions", onOffer, offerTestId }: {
  placeId: string
  locale: "en" | "ko" | "ja"
  className?: string
  testId?: string
  onOffer?: () => void
  offerTestId?: string
}) {
  return <section className={`${styles.actions} ${className ?? ""}`} data-testid={testId} data-place-flow="shared" data-service-place-id={placeId}
    aria-label={locale === "ko" ? "이 장소에서 할 수 있는 일" : locale === "ja" ? "この場所でできること" : "At this place"}>
    <PlaceServiceActionsB placeId={placeId} locale={locale} onOffer={onOffer} offerTestId={offerTestId} presentation="place-detail" includeGuide={false} />
    <HackathonEntitlementCtaB venueId={placeId} locale={locale} />
  </section>
}
