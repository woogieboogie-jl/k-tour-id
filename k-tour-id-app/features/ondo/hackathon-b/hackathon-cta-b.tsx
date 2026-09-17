"use client"

import { ChevronRight, Ticket } from "lucide-react"
import { capturePlaceServiceMapReturnB } from "../map/place-service-map-return-b"
import { isHackathonVenue, requestHackathonOpenB } from "./hackathon-campaign"
import styles from "./hackathon-b.module.css"

const COPY = {
  ko: { title: "체험 혜택 보기", hint: "신원 확인 후 1회 · 해커톤 체험용" },
  en: { title: "See experience perk", hint: "One-time after identity check · hackathon demo" },
  ja: { title: "体験特典を見る", hint: "本人確認後1回 · ハッカソン体験用" },
} as const

/** Real integration entry (not a sample capability). Renders only for the designated venue. */
export function HackathonEntitlementCtaB({ venueId, locale }: { venueId: string; locale: "en" | "ko" | "ja" }) {
  if (!isHackathonVenue(venueId)) return null
  const copy = COPY[locale]
  return (
    <button type="button" className={styles.cta} data-testid="hackathon-entitlement-open" data-place-service="hackathon" data-place-return-section="offer" onClick={() => {
      capturePlaceServiceMapReturnB(venueId)
      requestHackathonOpenB({ venueId, locale })
    }}>
      <Ticket size={20} aria-hidden="true" /><span><strong>{copy.title}</strong><small>{copy.hint}</small></span><ChevronRight size={18} aria-hidden="true" />
    </button>
  )
}
