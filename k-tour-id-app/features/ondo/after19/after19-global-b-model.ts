import type { FixtureId, LocalActualExecution, ReviewFixtureExecution } from "../contracts/execution-mode"
import { CX_AGE19_POLICY, type JitIdentityReceipt } from "@/lib/hackathon/jit-identity-contract"

export const GLOBAL_AFTER19_PREFERENCE_KEY = "ondo-b.after19.preferences.v1"
export const GLOBAL_AFTER19_SESSION_KEY = "ondo-b.after19.session.v1"
export const GLOBAL_AFTER19_SESSION_EVENT = "ondo-b-after19-session-change"
export const GLOBAL_AFTER19_AGE_TTL_MS = 24 * 60 * 60 * 1000

const LEGACY_PREFERENCE_KEY = "ondo.preferences.v3"
const LEGACY_SESSION_KEY = "ondo.session.v3"
const REVIEW_FIXTURE_ID = /^FX-[A-Z0-9][A-Z0-9-]{1,95}$/

export type GlobalAfter19PreferenceB = {
  version: 1
  autoOpen: boolean
}

export type GlobalAfter19ReviewValueB = {
  predicate: "AGE_GTE_19"
  outcome: "eligible"
}

export type GlobalAfter19LocalDeclarationValueB = GlobalAfter19ReviewValueB

export type GlobalAfter19ReviewPredicateReceiptB = {
  schema: "review-age-predicate.v1"
  predicate: "AGE_GTE_19"
  outcome: "eligible"
  issuerType: "REVIEW_FIXTURE"
  provenanceTruth: "SIMULATED"
  fixtureId: FixtureId
  issuedAt: string
  expiresAt: string
  disclosure: "predicate_only"
}

export type GlobalAfter19LocalPredicateReceiptB = {
  schema: "local-age-declaration.v1"
  predicate: "AGE_GTE_19"
  outcome: "eligible"
  issuerType: "LOCAL_DECLARATION"
  provenanceTruth: "SELF_DECLARED"
  issuedAt: string
  expiresAt: string
  disclosure: "night_view_only"
}

type GlobalAfter19CxReceiptB = {
  schema: "cx-age-predicate.v1"; predicate: "AGE_GTE_19"; outcome: "eligible"
  issuerType: "OMNIONE_CX"; provenanceTruth: "SERVER_VERIFIED"; issuedAt: string; expiresAt: string
  disclosure: "predicate_only"; requestId: string; receipt: JitIdentityReceipt
}
export type GlobalAfter19PredicateReceiptB = GlobalAfter19ReviewPredicateReceiptB | GlobalAfter19LocalPredicateReceiptB | GlobalAfter19CxReceiptB
// Authority is never reconstructed from browser storage/JSON. Only the
// current document's successfully consumed server receipt can create this.
const cxReceipts = new WeakSet<object>()
export function completeGlobalAfter19CxCheckB(receipt: JitIdentityReceipt, requestId: string, now = new Date()): GlobalAfter19SessionB | null {
  if (receipt.context.action !== "after19_access" || receipt.context.purpose !== "age19" || receipt.context.venueId !== null || receipt.context.tableId !== null ||
    receipt.age19Verified !== true || receipt.age19Policy !== CX_AGE19_POLICY || receipt.provider !== "omnione_cx" ||
    !/^idn_[A-Za-z0-9_-]{16,32}$/.test(requestId) || Date.parse(receipt.expiresAt) <= now.getTime() || Date.parse(receipt.evidenceExpiresAt) <= now.getTime()) return null
  const predicate: GlobalAfter19CxReceiptB = { schema: "cx-age-predicate.v1", predicate: "AGE_GTE_19", outcome: "eligible", issuerType: "OMNIONE_CX", provenanceTruth: "SERVER_VERIFIED",
    issuedAt: receipt.authorizedAt, expiresAt: new Date(Math.min(Date.parse(receipt.expiresAt), Date.parse(receipt.evidenceExpiresAt))).toISOString(), disclosure: "predicate_only", requestId, receipt }
  cxReceipts.add(predicate)
  return { version: 1, age: "eligible", ageExpiresAt: predicate.expiresAt, eligibilityReceipt: predicate, mode: "on", activation: "manual", expiryNotice: false }
}

export type GlobalAfter19SessionB = {
  version: 1
  age: "unverified" | "eligible"
  ageExpiresAt: string | null
  eligibilityReceipt: GlobalAfter19PredicateReceiptB | null
  mode: "off" | "on" | "manual-off"
  activation: "manual" | "auto" | null
  expiryNotice: boolean
}

export type GlobalAfter19RestoreB = {
  preference: GlobalAfter19PreferenceB
  session: GlobalAfter19SessionB
  preferenceSource: "current" | "legacy" | "default"
  sessionSource: "current" | "legacy" | "default"
}

export type GlobalAfter19RestoreOptionsB = {
  allowReviewFixture?: boolean
}

type StorageRead = Pick<Storage, "getItem">
type StorageWrite = Pick<Storage, "getItem" | "setItem" | "removeItem">

export type PersistedGlobalAfter19SessionB = Readonly<{
  previousRaw: string | null
  persistedRaw: string
}>

export const DEFAULT_GLOBAL_AFTER19_PREFERENCE: GlobalAfter19PreferenceB = {
  version: 1,
  autoOpen: true,
}

export const DEFAULT_GLOBAL_AFTER19_SESSION: GlobalAfter19SessionB = {
  version: 1,
  age: "unverified",
  ageExpiresAt: null,
  eligibilityReceipt: null,
  mode: "off",
  activation: null,
  expiryNotice: false,
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function parseStored(storage: StorageRead | null, key: string): unknown {
  if (!storage) return null
  try {
    const raw = storage.getItem(key)
    return raw == null ? null : JSON.parse(raw)
  } catch {
    return null
  }
}

function hasStored(storage: StorageRead | null, key: string): boolean {
  if (!storage) return false
  try {
    return storage.getItem(key) !== null
  } catch {
    return false
  }
}

function validExpiry(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 48) return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}

function predicateReceipt(value: unknown, expiry: string, allowReviewFixture: boolean): GlobalAfter19PredicateReceiptB | null {
  if (value && typeof value === "object" && cxReceipts.has(value)) {
    const receipt = value as GlobalAfter19CxReceiptB
    return receipt.expiresAt === expiry && Date.parse(receipt.issuedAt) < Date.parse(expiry) ? receipt : null
  }
  const current = record(value)
  const issuedAt = validExpiry(current.issuedAt)
  const receiptExpiry = validExpiry(current.expiresAt)
  if (current.predicate !== "AGE_GTE_19"
    || current.outcome !== "eligible"
    || !issuedAt
    || !receiptExpiry
    || Date.parse(receiptExpiry) !== Date.parse(expiry)
    || Date.parse(receiptExpiry) - Date.parse(issuedAt) !== GLOBAL_AFTER19_AGE_TTL_MS
    || Date.parse(issuedAt) >= Date.parse(receiptExpiry)) return null

  if (current.schema === "local-age-declaration.v1"
    && current.disclosure === "night_view_only"
    && current.issuerType === "LOCAL_DECLARATION"
    && current.provenanceTruth === "SELF_DECLARED") {
    return {
      schema: "local-age-declaration.v1",
      predicate: "AGE_GTE_19",
      outcome: "eligible",
      issuerType: "LOCAL_DECLARATION",
      provenanceTruth: "SELF_DECLARED",
      issuedAt,
      expiresAt: receiptExpiry,
      disclosure: "night_view_only",
    }
  }

  if (!allowReviewFixture
    || current.schema !== "review-age-predicate.v1"
    || current.disclosure !== "predicate_only"
    || current.issuerType !== "REVIEW_FIXTURE"
    || current.provenanceTruth !== "SIMULATED"
    || typeof current.fixtureId !== "string"
    || !REVIEW_FIXTURE_ID.test(current.fixtureId)) return null
  return {
    schema: "review-age-predicate.v1",
    predicate: "AGE_GTE_19",
    outcome: "eligible",
    issuerType: "REVIEW_FIXTURE",
    provenanceTruth: "SIMULATED",
    fixtureId: current.fixtureId as FixtureId,
    issuedAt,
    expiresAt: receiptExpiry,
    disclosure: "predicate_only",
  }
}

export function sanitizeGlobalAfter19Preference(value: unknown): GlobalAfter19PreferenceB {
  const current = record(value)
  return {
    version: 1,
    autoOpen: current.version === 1 && typeof current.autoOpen === "boolean"
      ? current.autoOpen
      : DEFAULT_GLOBAL_AFTER19_PREFERENCE.autoOpen,
  }
}

export function sanitizeGlobalAfter19Session(
  value: unknown,
  now = new Date(),
  options: GlobalAfter19RestoreOptionsB = {},
): GlobalAfter19SessionB {
  const current = record(value)
  if (current.version !== 1) return { ...DEFAULT_GLOBAL_AFTER19_SESSION }

  const expiry = validExpiry(current.ageExpiresAt)
  const receipt = expiry ? predicateReceipt(current.eligibilityReceipt, expiry, options.allowReviewFixture === true) : null
  const eligible = current.age === "eligible" && expiry !== null && receipt !== null && Date.parse(expiry) > now.getTime()
  const requestedMode = current.mode === "on" || current.mode === "manual-off" ? current.mode : "off"
  const mode = requestedMode === "on" && !eligible ? "off" : requestedMode
  const activation = mode === "on" && (current.activation === "manual" || current.activation === "auto")
    ? current.activation
    : null

  return {
    version: 1,
    age: eligible ? "eligible" : "unverified",
    ageExpiresAt: eligible ? expiry : null,
    eligibilityReceipt: eligible ? receipt : null,
    mode,
    activation,
    expiryNotice: current.expiryNotice === true || (current.age === "eligible" && !eligible),
  }
}

/**
 * Account-scoped age state crosses the UI/event success boundary only after
 * an exact set/readback check. Callers must keep the original action pending
 * when this returns false.
 */
export function persistGlobalAfter19SessionB(
  storage: StorageWrite,
  next: GlobalAfter19SessionB,
  now = new Date(),
  options: GlobalAfter19RestoreOptionsB = {},
) {
  const canonical = sanitizeGlobalAfter19Session(next, now, options)
  const encoded = JSON.stringify(canonical)
  if (encoded !== JSON.stringify(next)) return null
  let previous: string | null
  try {
    previous = storage.getItem(GLOBAL_AFTER19_SESSION_KEY)
  } catch {
    return null
  }
  try {
    storage.setItem(GLOBAL_AFTER19_SESSION_KEY, encoded)
    const readback = storage.getItem(GLOBAL_AFTER19_SESSION_KEY)
    const restored = readback ? sanitizeGlobalAfter19Session(JSON.parse(readback), now, options) : null
    if (readback === encoded && restored && JSON.stringify(restored) === encoded) {
      return { previousRaw: previous, persistedRaw: encoded } satisfies PersistedGlobalAfter19SessionB
    }
  } catch {
    // Roll back below. A Storage implementation may mutate before throwing.
  }
  try {
    if (previous === null) storage.removeItem(GLOBAL_AFTER19_SESSION_KEY)
    else storage.setItem(GLOBAL_AFTER19_SESSION_KEY, previous)
  } catch {
    // The caller still keeps protected UI/event success closed.
  }
  return null
}

export function rollbackPersistedGlobalAfter19SessionB(
  storage: StorageWrite,
  persisted: PersistedGlobalAfter19SessionB,
) {
  try {
    if (storage.getItem(GLOBAL_AFTER19_SESSION_KEY) !== persisted.persistedRaw) return false
    if (persisted.previousRaw === null) storage.removeItem(GLOBAL_AFTER19_SESSION_KEY)
    else storage.setItem(GLOBAL_AFTER19_SESSION_KEY, persisted.previousRaw)
    return storage.getItem(GLOBAL_AFTER19_SESSION_KEY) === persisted.previousRaw
  } catch {
    return false
  }
}

function migrateLegacyPreference(value: unknown): GlobalAfter19PreferenceB {
  const legacy = record(value)
  return {
    version: 1,
    autoOpen: typeof legacy.autoNight === "boolean" ? legacy.autoNight : DEFAULT_GLOBAL_AFTER19_PREFERENCE.autoOpen,
  }
}

function migrateLegacySession(value: unknown): GlobalAfter19SessionB {
  const legacy = record(value)
  const hadAgeClaim = legacy.age === "AGE-VERIFIED" || validExpiry(legacy.ageExpiresAt) !== null
  return {
    version: 1,
    age: "unverified",
    ageExpiresAt: null,
    eligibilityReceipt: null,
    mode: legacy.after19 === "A19-MANUAL-OFF" ? "manual-off" : "off",
    activation: null,
    expiryNotice: hadAgeClaim,
  }
}

export function restoreGlobalAfter19B(
  deviceStorage: StorageRead | null,
  sessionStorage: StorageRead | null,
  now = new Date(),
  options: GlobalAfter19RestoreOptionsB = {},
): GlobalAfter19RestoreB {
  const hasPreference = hasStored(deviceStorage, GLOBAL_AFTER19_PREFERENCE_KEY)
  const hasSession = hasStored(sessionStorage, GLOBAL_AFTER19_SESSION_KEY)
  const hasLegacyPreference = !hasPreference && hasStored(deviceStorage, LEGACY_PREFERENCE_KEY)
  const hasLegacySession = !hasSession && hasStored(sessionStorage, LEGACY_SESSION_KEY)

  return {
    preference: hasPreference
      ? sanitizeGlobalAfter19Preference(parseStored(deviceStorage, GLOBAL_AFTER19_PREFERENCE_KEY))
      : hasLegacyPreference
        ? migrateLegacyPreference(parseStored(deviceStorage, LEGACY_PREFERENCE_KEY))
        : { ...DEFAULT_GLOBAL_AFTER19_PREFERENCE },
    session: hasSession
      ? sanitizeGlobalAfter19Session(parseStored(sessionStorage, GLOBAL_AFTER19_SESSION_KEY), now, options)
      : hasLegacySession
        ? migrateLegacySession(parseStored(sessionStorage, LEGACY_SESSION_KEY))
        : { ...DEFAULT_GLOBAL_AFTER19_SESSION },
    preferenceSource: hasPreference ? "current" : hasLegacyPreference ? "legacy" : "default",
    sessionSource: hasSession ? "current" : hasLegacySession ? "legacy" : "default",
  }
}

function isGlobalAfter19ReceiptCurrent(session: GlobalAfter19SessionB, now = new Date()): boolean {
  const receipt = session.eligibilityReceipt
  if (session.age !== "eligible"
    || session.ageExpiresAt === null
    || receipt?.predicate !== "AGE_GTE_19"
    || receipt.outcome !== "eligible"
    || Date.parse(receipt.expiresAt) !== Date.parse(session.ageExpiresAt)
    || (receipt.issuerType === "OMNIONE_CX" ? !cxReceipts.has(receipt) : Date.parse(receipt.expiresAt) - Date.parse(receipt.issuedAt) !== GLOBAL_AFTER19_AGE_TTL_MS)
    || Date.parse(session.ageExpiresAt) <= now.getTime()) return false
  return true
}

/**
 * A current predicate that may satisfy a protected age prerequisite.
 * A local declaration deliberately does not qualify: it opens only the visual
 * night-browsing lens and cannot authorize an alcohol/table/checkout action.
 */
export function isGlobalAfter19AgeCurrent(session: GlobalAfter19SessionB, now = new Date()): boolean {
  if (!isGlobalAfter19ReceiptCurrent(session, now)) return false
  const receipt = session.eligibilityReceipt
  return receipt?.issuerType === "REVIEW_FIXTURE"
    && receipt.provenanceTruth === "SIMULATED"
    && REVIEW_FIXTURE_ID.test(receipt.fixtureId)
}

/** A bounded local declaration is sufficient only for the tab-local night map. */
export function isGlobalAfter19NightViewCurrent(session: GlobalAfter19SessionB, now = new Date()): boolean {
  if (!isGlobalAfter19ReceiptCurrent(session, now)) return false
  const receipt = session.eligibilityReceipt
  if (receipt?.issuerType === "OMNIONE_CX") return cxReceipts.has(receipt)
  if (receipt?.issuerType === "LOCAL_DECLARATION") {
    return receipt.provenanceTruth === "SELF_DECLARED" && receipt.disclosure === "night_view_only"
  }
  return receipt?.issuerType === "REVIEW_FIXTURE"
    && receipt.provenanceTruth === "SIMULATED"
    && REVIEW_FIXTURE_ID.test(receipt.fixtureId)
}

export function isGlobalAfter19ReviewResultB(
  session: GlobalAfter19SessionB,
): session is GlobalAfter19SessionB & { eligibilityReceipt: GlobalAfter19ReviewPredicateReceiptB } {
  return session.eligibilityReceipt?.issuerType === "REVIEW_FIXTURE"
    && session.eligibilityReceipt.provenanceTruth === "SIMULATED"
    && REVIEW_FIXTURE_ID.test(session.eligibilityReceipt.fixtureId)
}

export function completeGlobalAfter19LocalConfirmationB(
  execution: LocalActualExecution<GlobalAfter19LocalDeclarationValueB>,
  now = new Date(),
): GlobalAfter19SessionB {
  if (execution.mode !== "normal"
    || execution.executionTruth !== "LOCAL_ACTUAL"
    || execution.result !== "LOCAL_COMMITTED"
    || execution.scope !== "age_declaration"
    || execution.externalEffect !== "none"
    || execution.value.predicate !== "AGE_GTE_19"
    || execution.value.outcome !== "eligible"
    || !Number.isFinite(now.getTime())) {
    throw new Error("An explicit local 19+ declaration is required")
  }
  const issuedAt = now.toISOString()
  const expiresAt = new Date(now.getTime() + GLOBAL_AFTER19_AGE_TTL_MS).toISOString()
  return {
    version: 1,
    age: "eligible",
    ageExpiresAt: expiresAt,
    eligibilityReceipt: {
      schema: "local-age-declaration.v1",
      predicate: "AGE_GTE_19",
      outcome: "eligible",
      issuerType: "LOCAL_DECLARATION",
      provenanceTruth: "SELF_DECLARED",
      issuedAt,
      expiresAt,
      disclosure: "night_view_only",
    },
    mode: "on",
    activation: "manual",
    expiryNotice: false,
  }
}

export function isKoreanAfter19(now = new Date()): boolean {
  const hour = Number(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(now).find((part) => part.type === "hour")?.value)
  return Number.isFinite(hour) && hour >= 19
}

export function canAutoOpenGlobalAfter19B(
  preference: GlobalAfter19PreferenceB,
  session: GlobalAfter19SessionB,
  now = new Date(),
): boolean {
  return preference.autoOpen
    && session.mode !== "manual-off"
    && isGlobalAfter19NightViewCurrent(session, now)
    && isKoreanAfter19(now)
}

export function recordGlobalAfter19ReviewEligibilityB(
  execution: ReviewFixtureExecution<GlobalAfter19ReviewValueB>,
  now = new Date(execution.recordedAt),
): GlobalAfter19SessionB {
  if (execution.result !== "FIXTURE_SUCCESS"
    || execution.mode !== "review"
    || execution.executionTruth !== "FIXTURE_REVIEW"
    || execution.value.predicate !== "AGE_GTE_19"
    || execution.value.outcome !== "eligible"
    || execution.provenanceTruth !== "SIMULATED"
    || execution.externalProviderConnected !== false
    || execution.externalEffect !== "none"
    || !REVIEW_FIXTURE_ID.test(execution.fixtureId)
    || !Number.isFinite(Date.parse(execution.recordedAt))
    || !Number.isFinite(now.getTime())
    || now.toISOString() !== new Date(execution.recordedAt).toISOString()) {
    throw new Error("An explicit successful 19+ review fixture is required")
  }
  const issuedAt = now.toISOString()
  const expiresAt = new Date(now.getTime() + GLOBAL_AFTER19_AGE_TTL_MS).toISOString()
  return {
    version: 1,
    age: "eligible",
    ageExpiresAt: expiresAt,
    eligibilityReceipt: {
      schema: "review-age-predicate.v1",
      predicate: "AGE_GTE_19",
      outcome: "eligible",
      issuerType: "REVIEW_FIXTURE",
      provenanceTruth: "SIMULATED",
      fixtureId: execution.fixtureId,
      issuedAt,
      expiresAt,
      disclosure: "predicate_only",
    },
    mode: "off",
    activation: null,
    expiryNotice: false,
  }
}

export function completeGlobalAfter19ReviewB(
  execution: ReviewFixtureExecution<GlobalAfter19ReviewValueB>,
  now = new Date(execution.recordedAt),
): GlobalAfter19SessionB {
  return {
    ...recordGlobalAfter19ReviewEligibilityB(execution, now),
    mode: "on",
    activation: "manual",
  }
}
