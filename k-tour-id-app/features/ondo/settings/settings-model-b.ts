import { isGlobalAfter19AgeCurrent, restoreGlobalAfter19B } from "../after19/after19-global-b-model"
import { restoreBActionGateSession, type BActionAxisStatus } from "../identity-b/action-gate-contract-b"
import { isSimulatedCredentialActiveB, type OndoBSimulatedCredential } from "../identity-b/ktour-id-setup-model-b"
import type { OndoBPlannedTableRef } from "../my/my-korea-model"
import type { PulseLocalEvidenceB } from "../pulse-b/pulse-model-b"
import type { EditorialPlaceB } from "../pulse-b/japan-first-pulse-model-b"
import { PLACE_MEMORY_KEY_B, personalPlaceByIdB, sanitizePlaceMemoriesB, type PlaceMemoriesB } from "../place/place-memory-model-b"
import {
  sanitizeOndoBAppearancePreference,
  type OndoBAppearancePreference,
} from "../shared/state/ondo-b-appearance"
import {
  B_DEVICE_KEY,
  type OndoBAccountStatus,
  type OndoBCommerceFundingSource,
  type OndoBCommerceReceipt,
  type OndoBCommerceWalletStatus,
} from "../shared/state/ondo-b-provider"
import {
  ONDO_B_DISCOVERY_PREFERENCES,
  ondoBDiscoveryPreferenceCapability,
  type OndoBDiscoveryPreference,
  type OndoBLocale,
} from "../shared/state/ondo-b-preferences"

export type SettingsPreferenceSectionB = "food" | "dietary"

const PREFERENCE_ORDER = ONDO_B_DISCOVERY_PREFERENCES.map(({ id }) => id)
const SETTINGS_EDITABLE_PREFERENCE_IDS_B = PREFERENCE_ORDER.filter((id) => (
  ondoBDiscoveryPreferenceCapability(id) !== "unsupported_legacy"
))

export const SETTINGS_PREFERENCE_SECTIONS_B: ReadonlyArray<{
  id: SettingsPreferenceSectionB
  preferences: readonly OndoBDiscoveryPreference[]
}> = [
  {
    id: "food",
    preferences: SETTINGS_EDITABLE_PREFERENCE_IDS_B.filter((id) => (
      ONDO_B_DISCOVERY_PREFERENCES.find((preference) => preference.id === id)!.group === "meal"
    )),
  },
  {
    id: "dietary",
    preferences: SETTINGS_EDITABLE_PREFERENCE_IDS_B.filter((id) => (
      ONDO_B_DISCOVERY_PREFERENCES.find((preference) => preference.id === id)!.group === "dietary"
    )),
  },
]

export function normalizeSettingsPreferencesB(value: readonly OndoBDiscoveryPreference[]) {
  const selected = new Set(value)
  return PREFERENCE_ORDER.filter((id) => selected.has(id))
}

/** Consumer-editable values only; unsupported legacy bytes stay off-screen. */
export function settingsEditablePreferencesB(value: readonly OndoBDiscoveryPreference[]) {
  const selected = new Set(value)
  return SETTINGS_EDITABLE_PREFERENCE_IDS_B.filter((id) => selected.has(id))
}

/**
 * Merges a Settings draft with the stored unsupported values. This lets the UI
 * stop promising controls that do nothing without silently rewriting an older
 * user's device state.
 */
export function mergeSettingsPreferenceDraftB(
  persisted: readonly OndoBDiscoveryPreference[],
  draft: readonly OndoBDiscoveryPreference[],
) {
  const unsupportedLegacy = normalizeSettingsPreferencesB(persisted).filter((id) => (
    ondoBDiscoveryPreferenceCapability(id) === "unsupported_legacy"
  ))
  return normalizeSettingsPreferencesB([
    ...unsupportedLegacy,
    ...settingsEditablePreferencesB(draft),
  ])
}

export function clearSettingsEditablePreferencesB(
  persisted: readonly OndoBDiscoveryPreference[],
) {
  return normalizeSettingsPreferencesB(persisted).filter((id) => (
    ondoBDiscoveryPreferenceCapability(id) === "unsupported_legacy"
  ))
}

export function settingsPreferencesEqualB(
  left: readonly OndoBDiscoveryPreference[],
  right: readonly OndoBDiscoveryPreference[],
) {
  const normalizedLeft = normalizeSettingsPreferencesB(left)
  const normalizedRight = normalizeSettingsPreferencesB(right)
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((id, index) => id === normalizedRight[index])
}

export function settingsPreferenceSummaryB(
  locale: OndoBLocale,
  preferences: readonly OndoBDiscoveryPreference[],
) {
  const normalized = settingsEditablePreferencesB(preferences)
  const labels = normalized.slice(0, 2).map((id) => ONDO_B_DISCOVERY_PREFERENCES.find((item) => item.id === id)!.label[locale])
  return { labels, overflow: Math.max(0, normalized.length - labels.length), total: normalized.length }
}

export type SettingsReadinessB = "ready" | "not_set" | "expired" | "failed" | "unavailable" | "unsupported" | "pending"

export type SettingsPrivacySnapshotB = Readonly<{
  storageAvailable: boolean
  categoryCount: number
  discovery: Readonly<{ saved: number; recent: number; preferences: number; privateNotes: number }>
  together: Readonly<{ tables: number; signals: number }>
  identity: Readonly<{
    account: SettingsReadinessB
    person: SettingsReadinessB
    age: SettingsReadinessB
    payment: SettingsReadinessB
    ktourId: SettingsReadinessB
  }>
  balance: Readonly<{ status: SettingsReadinessB; records: number; fundingChanged: boolean }>
  app: Readonly<{ locale: OndoBLocale; appearancePreference: OndoBAppearancePreference; after19AutoOpen: boolean }>
}>

type StorageReadB = Pick<Storage, "getItem">

export type SettingsPrivacyStateB = Readonly<{
  locale: OndoBLocale
  appearancePreference?: OndoBAppearancePreference
  onboarding: "ONB-NEW" | "ONB-IN-PROGRESS" | "ONB-COMPLETE"
  account: OndoBAccountStatus
  discoveryPreferences: readonly OndoBDiscoveryPreference[]
  savedVenueIds: readonly string[]
  savedEditorialPlaceIds: readonly EditorialPlaceB["id"][]
  privateNotesByVenue: Readonly<Record<string, string>>
  recentVenueIds: readonly string[]
  recentEditorialPlaceIds: readonly EditorialPlaceB["id"][]
  plannedTableRefs: readonly OndoBPlannedTableRef[]
  localSignalPostedVenueIds: readonly string[]
  localPulseEvidenceByVenue: Readonly<Record<string, PulseLocalEvidenceB>>
  identityCredential: OndoBSimulatedCredential | null
  commerceWalletStatus: OndoBCommerceWalletStatus
  commerceFundingSource: OndoBCommerceFundingSource
  commerceReceipts: readonly OndoBCommerceReceipt[]
}>

function axisReadiness(status: BActionAxisStatus): SettingsReadinessB {
  if (status === "eligible") return "ready"
  if (status === "unverified") return "not_set"
  return status
}

export function unavailableSettingsPrivacySnapshotB(state: SettingsPrivacyStateB): SettingsPrivacySnapshotB {
  return {
    storageAvailable: false,
    categoryCount: 0,
    discovery: { saved: 0, recent: 0, preferences: 0, privateNotes: 0 },
    together: { tables: 0, signals: 0 },
    identity: { account: "unavailable", person: "unavailable", age: "unavailable", payment: "unavailable", ktourId: "unavailable" },
    balance: { status: "unavailable", records: 0, fundingChanged: false },
    app: {
      locale: state.locale,
      appearancePreference: sanitizeOndoBAppearancePreference(state.appearancePreference),
      after19AutoOpen: true,
    },
  }
}

/**
 * Builds the Settings disclosure from canonical, sanitized state only. It does
 * not expose storage keys, provider payloads, documents, holder data, or
 * review-fixture identifiers.
 */
export function readSettingsPrivacySnapshotB(input: {
  state: SettingsPrivacyStateB
  deviceStorage: StorageReadB
  sessionStorage: StorageReadB
  now?: Date
  allowReviewFixture?: boolean
}): SettingsPrivacySnapshotB {
  const now = input.now ?? new Date()
  let memories: PlaceMemoriesB
  try {
    // Reading both stores is part of the availability claim. A successful read
    // may return null; that is an empty state, not a storage failure.
    input.deviceStorage.getItem(B_DEVICE_KEY)
    input.sessionStorage.getItem("ondo-b.account.v1")
    const memoryRaw = input.deviceStorage.getItem(PLACE_MEMORY_KEY_B)
    memories = sanitizePlaceMemoriesB(memoryRaw ? JSON.parse(memoryRaw) : null)
  } catch {
    return unavailableSettingsPrivacySnapshotB(input.state)
  }

  const action = restoreBActionGateSession(input.sessionStorage, now, { allowReviewFixture: input.allowReviewFixture })
  const after19 = restoreGlobalAfter19B(input.deviceStorage, input.sessionStorage, now, { allowReviewFixture: input.allowReviewFixture })
  const saved = input.state.savedVenueIds.length + input.state.savedEditorialPlaceIds.length + Object.values(memories).filter(record => record.saved).length
  const recent = input.state.recentVenueIds.length + input.state.recentEditorialPlaceIds.length
  const preferences = normalizeSettingsPreferencesB(input.state.discoveryPreferences).length
  const privateNotes = Object.keys(input.state.privateNotesByVenue).length + Object.entries(memories).filter(([id, record]) => record.note && personalPlaceByIdB(id)?.kind !== "canonical").length
  const tables = input.state.plannedTableRefs.length
  const signals = new Set([
    ...input.state.localSignalPostedVenueIds,
    ...Object.keys(input.state.localPulseEvidenceByVenue),
  ]).size
  const account = input.state.account === "ACC-ACTIVE" ? "ready" : input.state.account === "ACC-CREATING" ? "pending" : "not_set"
  const age = isGlobalAfter19AgeCurrent(after19.session, now)
    ? "ready"
    : after19.session.expiryNotice ? "expired" : "not_set"
  const ktourId = input.state.identityCredential
    ? isSimulatedCredentialActiveB(input.state.identityCredential, now.getTime()) ? "ready" : "expired"
    : "not_set"
  const balanceRecords = input.state.commerceReceipts.length
  const balanceStatus = input.state.commerceWalletStatus === "ready"
    ? "ready"
    : input.state.commerceWalletStatus === "failed" ? "failed" : "not_set"

  const hasDiscovery = input.state.onboarding === "ONB-COMPLETE" || saved + recent + preferences + privateNotes > 0 || Object.values(memories).some(record => record.visitedAt)
  const hasTogether = tables + signals > 0
  const hasIdentity = account !== "not_set" || action.person.status !== "unverified" || action.payment.status !== "unverified"
    || age !== "not_set" || ktourId !== "not_set"
  const hasBalance = balanceRecords > 0 || input.state.commerceFundingSource !== "travel_balance" || balanceStatus !== "not_set"
  // Language is a real app setting even when its current value is English.
  const categoryCount = [hasDiscovery, hasTogether, hasIdentity, hasBalance, true].filter(Boolean).length

  return {
    storageAvailable: true,
    categoryCount,
    discovery: { saved, recent, preferences, privateNotes },
    together: { tables, signals },
    identity: {
      account,
      person: axisReadiness(action.person.status),
      age,
      payment: axisReadiness(action.payment.status),
      ktourId,
    },
    balance: {
      status: balanceStatus,
      records: balanceRecords,
      fundingChanged: input.state.commerceFundingSource !== "travel_balance",
    },
    app: {
      locale: input.state.locale,
      appearancePreference: sanitizeOndoBAppearancePreference(input.state.appearancePreference),
      after19AutoOpen: after19.preference.autoOpen,
    },
  }
}
