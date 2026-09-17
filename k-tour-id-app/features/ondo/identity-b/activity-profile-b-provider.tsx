"use client"

import type { ReactNode } from "react"
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { hasQaSessionOptIn, readQaRuntime } from "../shared/ui/use-qa-controls"

export const B_ACTIVITY_PROFILE_SESSION_KEY = "ondo-b.activity-profile.v1"
export const B_ACTIVITY_PROFILE_CLEAR_EVENT = "ondo:b:activity-profile-clear"
const LEGACY_SESSION_KEY = "ondo.session.v3"
const MAX_ACCEPTED_EVIDENCE = 40
const ACTIVITY_RECORD_VERSION = 2

export type BAnimationFrameScheduler = {
  requestAnimationFrame(callback: FrameRequestCallback): number
  cancelAnimationFrame(handle: number): void
}

/** Keep a synchronous write pending through one real paint boundary. */
export function scheduleAfterNextPaintB(scheduler: BAnimationFrameScheduler, mutation: () => void) {
  let cancelled = false
  let handle = scheduler.requestAnimationFrame(() => {
    if (cancelled) return
    handle = scheduler.requestAnimationFrame(() => {
      if (!cancelled) mutation()
    })
  })
  return () => {
    cancelled = true
    scheduler.cancelAnimationFrame(handle)
  }
}

export type BProfileField = { value: string; consent: boolean }
export type BActivityProfile = {
  displayName: string
  from: BProfileField
  livesIn: BProfileField
  languages: { value: string[]; consent: boolean }
}
export type BPublicActivityProfile = {
  displayName: string
  from?: string
  livesIn?: string
  languages?: string[]
}
export type BReputation = {
  visit: "new" | "recent" | "repeat"
  contribution: "new" | "helpful" | "established"
  meetup: "new" | "reliable" | "established"
}
export type BActivityAxis = keyof BReputation
export type BActivityEvidenceReceipt = {
  evidenceId: string
  axes: BActivityAxis[]
  addsVisitStamp: boolean
  recordedAt: string
  provenance: {
    truth: "LOCAL_INTERACTION" | "REVIEW_FIXTURE"
    source: "local_signal" | "user_action" | "review_fixture"
  }
}
export type BActivityProfileState = {
  hydrated: boolean
  profile: BActivityProfile
  reputation: BReputation
  stamps: number
  acceptedEvidenceIds: string[]
  evidenceReceipts: BActivityEvidenceReceipt[]
}

export type BActivityPersistResult = "accepted" | "duplicate" | "invalid" | "storage_failed" | "related_failed"
type BActivityProfileContextValue = {
  state: BActivityProfileState
  actions: {
    updateProfile(profile: BActivityProfile): boolean
    recordActivityAxes(evidenceId: string, axes: readonly BActivityAxis[], commitRelated?: () => boolean): BActivityPersistResult
    recordUniqueVisit(evidenceId: string): BActivityPersistResult
    recordContribution(evidenceId: string): BActivityPersistResult
    recordMeetup(evidenceId: string): BActivityPersistResult
    clearSession(): boolean
  }
}

const EMPTY_PROFILE: BActivityProfile = {
  displayName: "Traveler",
  from: { value: "", consent: false },
  livesIn: { value: "", consent: false },
  languages: { value: [], consent: false },
}

const DEFAULT_STATE: BActivityProfileState = {
  hydrated: false,
  profile: EMPTY_PROFILE,
  reputation: { visit: "new", contribution: "new", meetup: "new" },
  stamps: 0,
  acceptedEvidenceIds: [],
  evidenceReceipts: [],
}

const BActivityProfileContext = createContext<BActivityProfileContextValue | null>(null)

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : ""
}

function cleanStringList(value: unknown) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => cleanText(item, 30)).filter(Boolean))].slice(0, 5)
}

function cleanField(value: unknown): BProfileField {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { value: "", consent: false }
  const field = value as Record<string, unknown>
  const cleaned = cleanText(field.value, 60)
  return { value: cleaned, consent: Boolean(cleaned) && field.consent === true }
}

function cleanProfile(value: unknown): BActivityProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return EMPTY_PROFILE
  const profile = value as Record<string, unknown>
  const languages = profile.languages && typeof profile.languages === "object" && !Array.isArray(profile.languages)
    ? profile.languages as Record<string, unknown>
    : {}
  const languageValues = cleanStringList(languages.value)
  return {
    displayName: cleanText(profile.displayName, 40) || EMPTY_PROFILE.displayName,
    from: cleanField(profile.from),
    livesIn: cleanField(profile.livesIn),
    languages: { value: languageValues, consent: languageValues.length > 0 && languages.consent === true },
  }
}

function legacyProfile(value: unknown): BActivityProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return EMPTY_PROFILE
  const profile = value as Record<string, unknown>
  const from = cleanText(profile.from, 60)
  const livesIn = cleanText(profile.livesIn, 60)
  const languages = cleanStringList(profile.languages)
  return {
    displayName: cleanText(profile.displayName, 40) || EMPTY_PROFILE.displayName,
    from: { value: from, consent: Boolean(from) && profile.shareFrom === true },
    livesIn: { value: livesIn, consent: Boolean(livesIn) && profile.shareLivesIn === true },
    languages: { value: languages, consent: languages.length > 0 && profile.shareLanguages === true },
  }
}

/**
 * The only profile shape that may cross the public-view boundary. Optional
 * fields are omitted rather than masked so private values never enter that
 * DOM subtree or a future public payload by accident.
 */
export function publicBActivityProfile(value: BActivityProfile): BPublicActivityProfile {
  const profile = cleanProfile(value)
  return {
    displayName: profile.displayName,
    ...(profile.from.consent ? { from: profile.from.value } : {}),
    ...(profile.livesIn.consent ? { livesIn: profile.livesIn.value } : {}),
    ...(profile.languages.consent ? { languages: [...profile.languages.value] } : {}),
  }
}

function sameAxes(left: readonly BActivityAxis[], right: readonly BActivityAxis[]) {
  return left.length === right.length && left.every((axis) => right.includes(axis))
}

/**
 * Browser storage has no authority to prove activity. Hydration therefore
 * restores field-level profile consent only and resets every positive axis,
 * receipt, accepted id, and stamp in both production and QA builds.
 */
export function restoreBActivityProfile(value: unknown): Omit<BActivityProfileState, "hydrated"> {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
  return {
    profile: cleanProfile(record.profile),
    reputation: { visit: "new", contribution: "new", meetup: "new" },
    stamps: 0,
    acceptedEvidenceIds: [],
    evidenceReceipts: [],
  }
}

export function restoreLegacyBActivityProfile(value: unknown): Omit<BActivityProfileState, "hydrated"> {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
  return {
    profile: legacyProfile(record.profile),
    reputation: { visit: "new", contribution: "new", meetup: "new" },
    stamps: 0,
    acceptedEvidenceIds: [],
    evidenceReceipts: [],
  }
}

function serializable(state: BActivityProfileState) {
  return { version: ACTIVITY_RECORD_VERSION, profile: cleanProfile(state.profile) }
}

type BActivityProfileStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">

/**
 * Publish one exact activity-profile record and verify what storage accepted.
 * Ignored or mismatched writes are rolled back before the caller may publish
 * React state. Web Storage's specified atomic-failure behavior is the boundary;
 * non-standard mutate-then-throw stores are not treated as successful.
 */
export function publishBActivityProfileStorage(
  storage: BActivityProfileStorage,
  nextRaw: string | null,
): { ok: boolean; previousRaw: string | null } {
  let previousRaw: string | null
  try {
    previousRaw = storage.getItem(B_ACTIVITY_PROFILE_SESSION_KEY)
  } catch {
    return { ok: false, previousRaw: null }
  }
  const write = (raw: string | null) => {
    if (raw == null) storage.removeItem(B_ACTIVITY_PROFILE_SESSION_KEY)
    else storage.setItem(B_ACTIVITY_PROFILE_SESSION_KEY, raw)
  }
  try {
    write(nextRaw)
    if (storage.getItem(B_ACTIVITY_PROFILE_SESSION_KEY) === nextRaw) return { ok: true, previousRaw }
  } catch {
    // Restore the previous exact bytes below; React state remains unchanged.
  }
  try {
    write(previousRaw)
    storage.getItem(B_ACTIVITY_PROFILE_SESSION_KEY)
  } catch {
    // A failed rollback still cannot publish success or mutate React state.
  }
  return { ok: false, previousRaw }
}

type BActivitySnapshot = Pick<BActivityProfileState, "reputation" | "stamps" | "acceptedEvidenceIds" | "evidenceReceipts">
type BActivityMutation = {
  evidenceId: string
  axes: readonly BActivityAxis[]
  addVisitStamp: boolean
  receipt?: BActivityEvidenceReceipt
}

const ACTIVITY_AXES = new Set<BActivityAxis>(["visit", "contribution", "meetup"])

function validEvidenceId(evidenceId: string) {
  return /^(visit|contribution|meetup|activity):[a-z0-9][a-z0-9:_-]{0,119}$/i.test(evidenceId)
}

function advanceAxis(reputation: BReputation, axis: BActivityAxis): BReputation {
  if (axis === "visit") return { ...reputation, visit: reputation.visit === "new" ? "recent" : "repeat" }
  if (axis === "contribution") return { ...reputation, contribution: reputation.contribution === "new" ? "helpful" : "established" }
  return { ...reputation, meetup: reputation.meetup === "new" ? "reliable" : "established" }
}

function createActivityReceipt(mutation: BActivityMutation, recordedAt = new Date()): BActivityEvidenceReceipt | null {
  const axes = [...new Set(mutation.axes)]
  if (mutation.evidenceId.startsWith("activity:local-signal:") && sameAxes(axes, ["visit", "contribution"]) && !mutation.addVisitStamp) {
    return { evidenceId: mutation.evidenceId, axes, addsVisitStamp: false, recordedAt: recordedAt.toISOString(), provenance: { truth: "LOCAL_INTERACTION", source: "local_signal" } }
  }
  if (mutation.evidenceId.startsWith("contribution:") && sameAxes(axes, ["contribution"]) && !mutation.addVisitStamp) {
    return { evidenceId: mutation.evidenceId, axes, addsVisitStamp: false, recordedAt: recordedAt.toISOString(), provenance: { truth: "LOCAL_INTERACTION", source: "user_action" } }
  }
  if (mutation.evidenceId.startsWith("meetup:") && sameAxes(axes, ["meetup"]) && !mutation.addVisitStamp) {
    return { evidenceId: mutation.evidenceId, axes, addsVisitStamp: false, recordedAt: recordedAt.toISOString(), provenance: { truth: "LOCAL_INTERACTION", source: "user_action" } }
  }
  const reviewVisit = mutation.evidenceId.startsWith("visit:") && sameAxes(axes, ["visit"]) && mutation.addVisitStamp
  const reviewTable = mutation.evidenceId.startsWith("activity:table:")
    && (sameAxes(axes, ["visit"]) || sameAxes(axes, ["meetup", "contribution"]))
    && !mutation.addVisitStamp
  if (reviewVisit || reviewTable) {
    return { evidenceId: mutation.evidenceId, axes, addsVisitStamp: mutation.addVisitStamp, recordedAt: recordedAt.toISOString(), provenance: { truth: "REVIEW_FIXTURE", source: "review_fixture" } }
  }
  return null
}

export function applyBActivityEvidence(
  current: BActivitySnapshot,
  mutation: BActivityMutation,
): { result: Exclude<BActivityPersistResult, "storage_failed" | "related_failed">; snapshot: BActivitySnapshot } {
  const axes = [...new Set(mutation.axes)]
  if (!validEvidenceId(mutation.evidenceId) || axes.length === 0 || axes.some((axis) => !ACTIVITY_AXES.has(axis))) {
    return { result: "invalid", snapshot: current }
  }
  if (current.acceptedEvidenceIds.includes(mutation.evidenceId)) {
    return { result: "duplicate", snapshot: current }
  }
  const receipt = mutation.receipt ?? createActivityReceipt(mutation)
  if (!receipt || receipt.evidenceId !== mutation.evidenceId) return { result: "invalid", snapshot: current }
  const reputation = axes.reduce(advanceAxis, current.reputation)
  return {
    result: "accepted",
    snapshot: {
      reputation,
      stamps: mutation.addVisitStamp ? Math.min(10, current.stamps + 1) : current.stamps,
      acceptedEvidenceIds: [...current.acceptedEvidenceIds, mutation.evidenceId].slice(-MAX_ACCEPTED_EVIDENCE),
      evidenceReceipts: [...current.evidenceReceipts, receipt].slice(-MAX_ACCEPTED_EVIDENCE),
    },
  }
}

/**
 * Explicit in-memory review harness. It is read only from the QA-only window
 * seam and is never serialized or accepted by restoreBActivityProfile.
 */
export function applyBActivityReviewFixture(value: unknown): BActivitySnapshot {
  const initial: BActivitySnapshot = {
    reputation: { visit: "new", contribution: "new", meetup: "new" },
    stamps: 0,
    acceptedEvidenceIds: [],
    evidenceReceipts: [],
  }
  if (!Array.isArray(value)) return initial
  return value.slice(0, MAX_ACCEPTED_EVIDENCE).reduce<BActivitySnapshot>((snapshot, candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return snapshot
    const event = candidate as Record<string, unknown>
    const keys = Object.keys(event).sort()
    if (keys.length !== 3 || keys[0] !== "addVisitStamp" || keys[1] !== "axes" || keys[2] !== "evidenceId") return snapshot
    if (typeof event.evidenceId !== "string" || !Array.isArray(event.axes) || typeof event.addVisitStamp !== "boolean") return snapshot
    const axes = [...new Set(event.axes)]
    if (axes.length !== event.axes.length || axes.length === 0 || axes.some((axis) => !ACTIVITY_AXES.has(axis as BActivityAxis))) return snapshot
    const typedAxes = axes as BActivityAxis[]
    const validReviewShape = (event.evidenceId.startsWith("visit:") && sameAxes(typedAxes, ["visit"]) && event.addVisitStamp)
      || (event.evidenceId.startsWith("contribution:") && sameAxes(typedAxes, ["contribution"]) && !event.addVisitStamp)
      || (event.evidenceId.startsWith("meetup:") && sameAxes(typedAxes, ["meetup"]) && !event.addVisitStamp)
      || (event.evidenceId.startsWith("activity:table:")
        && (sameAxes(typedAxes, ["visit"]) || sameAxes(typedAxes, ["meetup", "contribution"]))
        && !event.addVisitStamp)
    if (!validReviewShape) return snapshot
    const receipt: BActivityEvidenceReceipt = {
      evidenceId: event.evidenceId,
      axes: typedAxes,
      addsVisitStamp: event.addVisitStamp,
      recordedAt: new Date().toISOString(),
      provenance: { truth: "REVIEW_FIXTURE", source: "review_fixture" },
    }
    const prepared = applyBActivityEvidence(snapshot, {
      evidenceId: receipt.evidenceId,
      axes: receipt.axes,
      addVisitStamp: receipt.addsVisitStamp,
      receipt,
    })
    return prepared.result === "accepted" ? prepared.snapshot : snapshot
  }, initial)
}

export function BActivityProfileProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<BActivityProfileState>(DEFAULT_STATE)
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    let restored = restoreBActivityProfile(null)
    try {
      const ownRaw = window.sessionStorage.getItem(B_ACTIVITY_PROFILE_SESSION_KEY)
      if (ownRaw != null) {
        restored = restoreBActivityProfile(JSON.parse(ownRaw))
      } else {
        const legacyRaw = window.sessionStorage.getItem(LEGACY_SESSION_KEY)
        if (legacyRaw != null) {
          restored = restoreLegacyBActivityProfile(JSON.parse(legacyRaw))
          // Migration is one-way and additive: the legacy value is never changed
          // or removed, and identity/payment fields are never copied into this key.
          window.sessionStorage.setItem(B_ACTIVITY_PROFILE_SESSION_KEY, JSON.stringify(restored))
        }
      }
    } catch {
      restored = restoreBActivityProfile(null)
    }
    const reviewActivity = applyBActivityReviewFixture(readQaRuntime<{ profileActivityEvents?: unknown }>()?.profileActivityEvents)
    const next = { ...restored, ...(reviewActivity ?? {}), hydrated: true }
    stateRef.current = next
    setState(next)
  }, [])

  useEffect(() => {
    function clearFromDeviceReset() {
      const next = { ...DEFAULT_STATE, hydrated: true }
      stateRef.current = next
      setState(next)
    }
    window.addEventListener(B_ACTIVITY_PROFILE_CLEAR_EVENT, clearFromDeviceReset)
    return () => window.removeEventListener(B_ACTIVITY_PROFILE_CLEAR_EVENT, clearFromDeviceReset)
  }, [])

  const commit = useCallback((update: (current: BActivityProfileState) => BActivityProfileState) => {
    const current = stateRef.current
    const next = { ...update(current), hydrated: true }
    const publication = publishBActivityProfileStorage(window.sessionStorage, JSON.stringify(serializable(next)))
    if (!publication.ok) return false
    stateRef.current = next
    setState(next)
    return true
  }, [])

  const record = useCallback((mutation: BActivityMutation, commitRelated?: () => boolean): BActivityPersistResult => {
    const prepared = applyBActivityEvidence(stateRef.current, mutation)
    if (prepared.result === "invalid") return "invalid"
    if (prepared.result === "duplicate") {
      return !commitRelated || commitRelated() ? "duplicate" : "related_failed"
    }

    const next = { ...stateRef.current, ...prepared.snapshot, hydrated: true }
    const publication = publishBActivityProfileStorage(window.sessionStorage, JSON.stringify(serializable(next)))
    if (!publication.ok) return "storage_failed"
    let relatedCommitted = true
    try {
      relatedCommitted = !commitRelated || commitRelated()
    } catch {
      relatedCommitted = false
    }
    if (!relatedCommitted) {
      const rollback = publishBActivityProfileStorage(window.sessionStorage, publication.previousRaw)
      return rollback.ok ? "related_failed" : "storage_failed"
    }
    stateRef.current = next
    setState(next)
    return "accepted"
  }, [])

  const actions = useMemo<BActivityProfileContextValue["actions"]>(() => ({
    updateProfile: (profile) => commit((current) => ({ ...current, profile: cleanProfile(profile) })),
    recordActivityAxes: (evidenceId, axes, commitRelated) => record({ evidenceId, axes, addVisitStamp: false }, commitRelated),
    // Recheck live authority at mutation time, not only on a rendered button.
    // A local place ID is a sample fixture, never proof of a real-world visit.
    recordUniqueVisit: (evidenceId) => hasQaSessionOptIn()
      ? record({ evidenceId, axes: ["visit"], addVisitStamp: true })
      : "invalid",
    recordContribution: (evidenceId) => record({ evidenceId, axes: ["contribution"], addVisitStamp: false }),
    recordMeetup: (evidenceId) => record({ evidenceId, axes: ["meetup"], addVisitStamp: false }),
    clearSession: () => {
      const publication = publishBActivityProfileStorage(window.sessionStorage, null)
      if (!publication.ok) return false
      const next = { ...DEFAULT_STATE, hydrated: true }
      stateRef.current = next
      setState(next)
      return true
    },
  }), [commit, record])

  const value = useMemo(() => ({ state, actions }), [actions, state])
  return <BActivityProfileContext.Provider value={value}>{children}</BActivityProfileContext.Provider>
}

export function useBActivityProfile() {
  const value = useContext(BActivityProfileContext)
  if (!value) throw new Error("useBActivityProfile must be used inside BActivityProfileProvider")
  return value
}
