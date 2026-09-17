"use client"

/** Navigation only: opening a collection never creates visit evidence. */
export const JOURNEY_STAMPS_OPEN_EVENT_B = "ktour:journey-stamps:open"
export const JOURNEY_KEEPSAKE_OPEN_EVENT_B = "ktour:journey-keepsake:open"

export function requestJourneyStampsB() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(JOURNEY_STAMPS_OPEN_EVENT_B))
}

export function requestJourneyKeepsakeB() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(JOURNEY_KEEPSAKE_OPEN_EVENT_B))
}
