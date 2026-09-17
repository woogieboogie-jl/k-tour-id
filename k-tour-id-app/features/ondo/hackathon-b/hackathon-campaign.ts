import { requestPlaceServiceReturnB } from "../commerce-b/place-service-registry-b"

/** Designated venue for the hackathon demo entitlement (one venue, one campaign).
 * The server is the authority (HK_CAMPAIGN_VENUE_ID); this constant only decides
 * where the CTA renders. Keep in sync with the server env. */
export const HACKATHON_CAMPAIGN_VENUE_ID = process.env.NEXT_PUBLIC_HK_CAMPAIGN_VENUE_ID ?? "mois-0021cd596bc5b2a922ad"
export const HACKATHON_ENABLED = process.env.NEXT_PUBLIC_HK_ENABLED !== "0"
/** Demo shortcut: a floating map button + `/hackathon` deep link that jump to the
 * designated venue so the journey can be clicked through without searching the map.
 * Off by default (visual tests); set NEXT_PUBLIC_HK_DEMO_ENTRY=1 in .env.local. */
export const HACKATHON_DEMO_ENTRY = HACKATHON_ENABLED && process.env.NEXT_PUBLIC_HK_DEMO_ENTRY === "1"

export const HACKATHON_OPEN_EVENT_B = "ondo:b:hackathon-open"
export const HACKATHON_PENDING_KEY = "ondo-b.hackathon.pending.v1"

/** Autopilot: `execute` stops after the on-chain agent execution (step 7) so the
 * final "confirm and use" stays a human tap; `redeem` runs through the service
 * redemption (step 8) and the OmniOne record (step 9). Undefined = manual. */
export type HackathonAuto = "execute" | "redeem"
export type HackathonOpenDetail = { venueId: string; locale: "en" | "ko" | "ja"; resumeOperationId?: string; auto?: HackathonAuto }

export function isHackathonVenue(venueId: unknown) {
  return HACKATHON_ENABLED && typeof venueId === "string" && venueId === HACKATHON_CAMPAIGN_VENUE_ID
}

export function requestHackathonOpenB(detail: HackathonOpenDetail) {
  if (typeof window === "undefined") return false
  window.dispatchEvent(new CustomEvent<HackathonOpenDetail>(HACKATHON_OPEN_EVENT_B, { detail }))
  return true
}

/** Open the designated venue's place sheet (offer section), where the perk CTA lives.
 * Uses the map's own return path, so the venue opens exactly like a post-service
 * return (city switch included). A short delay lets the map register its listener
 * when this is called right after first paint (`/hackathon` deep link). */
export function openHackathonVenueB(delayMs = 0, auto?: HackathonAuto, locale: HackathonOpenDetail["locale"] = "ko") {
  if (typeof window === "undefined") return
  window.setTimeout(() => {
    if (!requestPlaceServiceReturnB(HACKATHON_CAMPAIGN_VENUE_ID, "offer")) return
    // The place sheet opens at its compact level; expand it (same as tapping
    // "Place details") and bring the perk CTA into view. Demo convenience only.
    let tries = 0
    const reveal = () => {
      const cta = document.querySelector<HTMLElement>("[data-testid='hackathon-entitlement-open']")
      if (cta) {
        cta.scrollIntoView({ block: "center" }); cta.focus({ preventScroll: true })
        // Autopilot: don't wait for the tap on the CTA; open the journey with the flag set.
        if (auto) requestHackathonOpenB({ venueId: HACKATHON_CAMPAIGN_VENUE_ID, locale, auto })
        return
      }
      document.querySelector<HTMLButtonElement>("[data-testid='canonical-place-details']")?.click()
      if (++tries < 40) window.setTimeout(reveal, 150)
    }
    window.setTimeout(reveal, 200)
  }, delayMs)
}

export function readPendingHackathon(): HackathonOpenDetail | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.sessionStorage.getItem(HACKATHON_PENDING_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as HackathonOpenDetail & { savedAt?: number }
    if (!parsed.venueId || !parsed.resumeOperationId) return null
    if (parsed.savedAt && Date.now() - parsed.savedAt > 60 * 60 * 1000) { window.sessionStorage.removeItem(HACKATHON_PENDING_KEY); return null }
    return parsed
  } catch { return null }
}
export function writePendingHackathon(detail: HackathonOpenDetail | null) {
  if (typeof window === "undefined") return
  try {
    if (!detail) window.sessionStorage.removeItem(HACKATHON_PENDING_KEY)
    else window.sessionStorage.setItem(HACKATHON_PENDING_KEY, JSON.stringify({ ...detail, savedAt: Date.now() }))
  } catch { /* storage unavailable */ }
}
