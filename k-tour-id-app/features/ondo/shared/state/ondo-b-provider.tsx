"use client"

import type { ReactNode } from "react"
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import {
  CANONICAL_PRIVATE_NOTE_MAX_LENGTH,
  isCanonicalVenueId,
  sanitizeCanonicalVenueIds,
  sanitizeCanonicalVenueNotes,
} from "@/lib/ondo/venues/canonical-allowlist"
import type { OndoBPlannedTableRef } from "../../my/my-korea-model"
import {
  recordPlannedTable,
  recordRecentVenue,
  removePlannedTable,
  sanitizeLocalSignalVenueIds,
  sanitizePlannedTableRefs,
  sanitizeRecentVenueIds,
} from "../../my/my-korea-model"
import type {
  OndoBDiscoveryArea,
  OndoBDiscoveryIntent,
  OndoBDiscoveryPreference,
  OndoBLegacyDiscoveryIntent,
  OndoBLocale,
  OndoBPersona,
} from "./ondo-b-preferences"
import {
  normalizeOndoBDiscoveryArea,
  normalizeOndoBDiscoveryIntent,
  ONDO_B_DISCOVERY_PREFERENCES,
} from "./ondo-b-preferences"
import { clearAllPrivateNoteDraftMemory } from "./private-note-draft-memory"
import { evaluateKPassService, isKPassScenario, restoreKPassDemoRefundClaims, type KPassScenario } from "../../contracts/kpass-capabilities"
import type { ReviewFixtureExecution } from "../../contracts/execution-mode"
import { FUNDING_RAIL_SESSION_KEY_B, type FundingRailReceiptB } from "../../commerce-b/funding-rail-model-b"
import { resolveCommercePlaceB, requestPlaceServiceReturnB } from "../../commerce-b/place-service-registry-b"
import { RESERVATION_SAMPLE_KEY } from "../../reservation-b/reservation-model-b"
import { ACCOUNT_SERVICES_SAMPLE_KEY_B } from "../../settings/account-services-sample-model-b"
import type { PulseLocalEvidenceB, PulseLocalSignalTagB } from "../../pulse-b/pulse-model-b"
import {
  createStableCommerceBState,
  creditStableCommerceFundingB,
  isCommerceSampleResponseB,
  stableCommerceRefundedKrwB,
  STABLE_B_OFFER_ID,
  STABLE_B_OFFER_VENUE_ID,
  STABLE_B_OPENING_BALANCE,
  STABLE_B_OOKRW_PRICE,
  STABLE_B_PAYMENT_OPERATION_ID,
  STABLE_B_RECEIPT_ID,
  STABLE_B_REFUND_OPERATION_ID,
  STABLE_B_REFUND_RECEIPT_ID,
  STABLE_B_VOUCHER_VALUE,
  stableCommerceBalanceB,
  stableCommerceBReducer,
  stableCommerceOrderB,
  stableCommerceOrdersB,
  openStableCommerceOrderB,
  selectStableCommerceOrderB,
  type StableCommerceBAction,
  type StableCommerceBState,
  type CommerceOrderContextB,
} from "../../commerce-b/stable-commerce-model-b"
import {
  completeKPassDemoAgeProofB,
  recoverSimulatedCredentialB,
  createSimulatedCredentialB,
  createPersonOnlySimulatedCredentialB,
  type KPassAgeProofValueB,
  type OndoBIdentityMethod,
  type OndoBIdentitySetupOrigin,
  type OndoBSimulatedCredential,
} from "../../identity-b/ktour-id-setup-model-b"
import {
  B_ACTION_AXIS_SESSION_EVENT,
  B_ACTION_GATE_SESSION_KEY,
  DEFAULT_B_ACTION_GATE_SESSION,
  forgetBActionGateRuntimeAuthorityAfterReset,
  restoreBActionGateSession,
  persistBActionGateSession,
  isBExperiencePersonHandoffCurrent,
  type BExperiencePersonHandoff,
} from "../../identity-b/action-gate-contract-b"
import {
  DEFAULT_GLOBAL_AFTER19_PREFERENCE,
  DEFAULT_GLOBAL_AFTER19_SESSION,
  GLOBAL_AFTER19_PREFERENCE_KEY,
  GLOBAL_AFTER19_SESSION_EVENT,
  GLOBAL_AFTER19_SESSION_KEY,
} from "../../after19/after19-global-b-model"
import { clearGuestAfter19MemoryB } from "../../after19/after19-guest-memory-b"
import { DEFAULT_PLACE_AFTER19_RETURN_SESSION, PLACE_AFTER19_RETURN_SESSION_KEY } from "../../after19/after19-place-return-b-model"
import { PLACE_RETURN_UI_SNAPSHOT_SESSION_KEY } from "../../map/place-return-ui-snapshot-b"
import {
  B_ACTIVITY_PROFILE_CLEAR_EVENT,
  B_ACTIVITY_PROFILE_SESSION_KEY,
  restoreBActivityProfile,
} from "../../identity-b/activity-profile-b-provider"
import { isEditorialPlaceId, sanitizeEditorialPlaceIds, type EditorialPlaceB } from "../../pulse-b/japan-first-pulse-model-b"
import { B_TABLE_ACTIVITY_CLEAR_EVENT, B_TABLE_ACTIVITY_SESSION_KEY } from "../../connect/table-activity-b"
import {
  browserPrefersDarkAppearance,
  ONDO_B_DEVICE_STORAGE_KEY,
  readBrowserOndoBAppearanceSnapshot,
  resetOndoBAppearanceDocument,
  resolveOndoBAppearance,
  sanitizeOndoBAppearancePreference,
  syncOndoBAppearanceDocument,
  type OndoBAppearancePreference,
  type OndoBResolvedAppearance,
} from "./ondo-b-appearance"
import {
  consumeBAccountReturnTo,
  createBAccountSaveTransactionMarker,
  createBAccountReturnTo,
  createBEditorialAccountReturnTo,
  discardBAccountReturnTo,
  finalizeConsumedBAccountReturnTo,
  isBAccountReturnToUsable,
  restoreBAccountSaveTransactionMarker,
  restoreConsumedBAccountReturnTo,
  type BAccountReturnToEnvelope,
  type BAccountSaveTransactionMarker,
} from "../../contracts/return-to-b"
import { qaReviewFixtureOptions, readQaScenario } from "../ui/use-qa-controls"
import { REVIEW_PROVENANCE_TRUTH } from "../../contracts/execution-mode"

export type OndoBTab = "ondo" | "my" | "tables" | "id" | "settings"
export type OndoBSurface = { kind: "map" } | { kind: "venue"; venueId: string } | { kind: "editorial_place"; editorialPlaceId: EditorialPlaceB["id"] } | { kind: "labs" }
export type OndoBSaveStatus = "SAV-IDLE" | "SAV-SAVED" | "SAV-FAILED"
export type OndoBAccountStatus = "ACC-GUEST" | "ACC-CREATING" | "ACC-ACTIVE"
export type OndoBPersistedAccountStatus = Exclude<OndoBAccountStatus, "ACC-CREATING">
export type OndoBLocalSignalTag = PulseLocalSignalTagB
export type OndoBLocalSignalDraft = {
  venueId: string
  tags: OndoBLocalSignalTag[]
  note: string
}
export type OndoBCommerceOrigin = { kind: "canonical_place" | "editorial_place" | "research_place"; venueId: string }
export type OndoBCommerceWalletStatus = "disconnected" | "failed" | "ready"
export type OndoBCommerceFundingSource = "travel_balance" | "krw_bank" | "card_wallet" | "digital_dollar"
export type OndoBCommerceReceipt = {
  executionTruth: "FIXTURE_REVIEW"
  provenanceTruth: typeof REVIEW_PROVENANCE_TRUTH
  receiptId: string
  refundReceiptId: string | null
  offerId: string
  orderId?: string
  refundedKrw?: number
  venueId: string
  status: "paid" | "refunded"
  paidOOKRW: number
  benefitOOKRW: number
  balanceOOKRW: number
}

export type OndoBState = {
  hydrated: boolean
  locale: OndoBLocale
  appearancePreference: OndoBAppearancePreference
  resolvedAppearance: OndoBResolvedAppearance
  tab: OndoBTab
  surface: OndoBSurface
  onboarding: "ONB-NEW" | "ONB-IN-PROGRESS" | "ONB-COMPLETE"
  account: OndoBAccountStatus
  accountReturnTo: BAccountReturnToEnvelope | null
  accountSaveTransaction: BAccountSaveTransactionMarker | null
  accountSaveRecoveryBlocked: boolean
  persona: OndoBPersona | null
  discoveryArea: OndoBDiscoveryArea
  discoveryPreferences: OndoBDiscoveryPreference[]
  savedVenueIds: string[]
  savedEditorialPlaceIds: EditorialPlaceB["id"][]
  saveStatusByVenue: Record<string, OndoBSaveStatus>
  privateNotesByVenue: Record<string, string>
  recentVenueIds: string[]
  recentEditorialPlaceIds: EditorialPlaceB["id"][]
  plannedTableRefs: OndoBPlannedTableRef[]
  localSignalPostedVenueIds: string[]
  localPulseEvidenceByVenue: Record<string, PulseLocalEvidenceB>
  localInteractionBoundarySeen: boolean
  identitySetupOrigin: OndoBIdentitySetupOrigin | null
  identityCredential: OndoBSimulatedCredential | null
  identityDemoScenario: KPassScenario
  commerceReceiptCredentialId?: string | null
  commerceLocalBoundarySeen: boolean
  commerceOrigin: OndoBCommerceOrigin | null
  commerceWalletStatus: OndoBCommerceWalletStatus
  commerceFundingSource: OndoBCommerceFundingSource
  commerceSession: StableCommerceBState
  commerceReceiptVenueId: string | null
  commerceReceipts: OndoBCommerceReceipt[]
  localSignalDraft: OndoBLocalSignalDraft | null
  toast: string | null
}

export type OndoBOnboardingDraft = Readonly<{
  intent: OndoBDiscoveryIntent
  area: OndoBDiscoveryArea
  preferences: readonly OndoBDiscoveryPreference[]
}>

export type OndoBOnboardingCommitResult =
  | Readonly<{ ok: true; persisted: true }>
  | Readonly<{ ok: false; reason: "storage" | "invalid" }>

export type OndoBOnboardingEscapeResult = Readonly<{ ok: true; persisted: boolean }>

export type OndoBClearDeviceContentResult =
  | Readonly<{ ok: true; outcome: "cleared" }>
  | Readonly<{ ok: false; outcome: "storage_failed"; rollback: "complete" | "incomplete" }>

export function sanitizeBOnboardingDraft(value: unknown): OndoBOnboardingDraft | null {
  if (!value || typeof value !== "object") return null
  const record = value as Record<string, unknown>
  const intent = normalizeOndoBDiscoveryIntent(record.intent)
  const area = normalizeOndoBDiscoveryArea(record.area)
  const preferences = sanitizeDiscoveryPreferences(record.preferences)
  const requestedPreferences = Array.isArray(record.preferences) ? [...new Set(record.preferences)] : []
  if (!intent || (record.area != null && area === null) || requestedPreferences.length !== preferences.length) return null
  if ((intent === "nearby" || intent === "living") && area === null) return null
  return { intent, area, preferences }
}

export type OndoBActions = {
  setLocale(locale: OndoBLocale): boolean
  setAppearancePreference(preference: OndoBAppearancePreference): boolean
  setTab(tab: OndoBTab): void
  setSurface(surface: OndoBSurface): void
  /** @deprecated New onboarding commits one local draft atomically. */
  setPersona(persona: OndoBPersona | OndoBLegacyDiscoveryIntent): boolean
  setDiscoveryPreferences(preferences: OndoBDiscoveryPreference[]): boolean
  resetDiscoveryPreferences(): void
  beginOnboarding(): void
  cancelOnboarding(): OndoBOnboardingEscapeResult
  completeOnboarding(draft: OndoBOnboardingDraft): OndoBOnboardingCommitResult
  skipOnboarding(): OndoBOnboardingEscapeResult
  resetOnboarding(): boolean
  beginAccountSave(venueId: string): boolean
  beginEditorialAccountSave(editorialPlaceId: EditorialPlaceB["id"]): boolean
  cancelAccountSave(): boolean
  beginAccountActivation(): boolean
  cancelAccountActivation(): void
  activateAccount(): boolean
  completeAccountSave(): "saved" | "save_failed" | "account_failed"
  saveVenue(venueId: string): void
  toggleSavedVenue(venueId: string): void
  toggleSavedEditorialPlace(editorialPlaceId: EditorialPlaceB["id"]): boolean
  setPrivateNote(venueId: string, note: string): boolean
  openLocalSignal(venueId: string): void
  updateLocalSignalDraft(update: Pick<OndoBLocalSignalDraft, "tags" | "note">): void
  closeLocalSignal(): void
  recordRecentVenue(venueId: string): boolean
  recordRecentEditorialPlace(editorialPlaceId: EditorialPlaceB["id"]): boolean
  recordPlannedTable(tableId: string, venueId: string): boolean
  removePlannedTable(tableId: string): boolean
  markLocalSignalPosted(venueId: string): boolean
  acknowledgeLocalInteractionBoundary(): boolean
  openIdentitySetup(origin: OndoBIdentitySetupOrigin): void
  closeIdentitySetup(): void
  completeIdentitySetup(method: OndoBIdentityMethod, options?: { sampleRecovery?: true; issuanceScope?: "person"; experiencePersonHandoff?: BExperiencePersonHandoff }): boolean
  completeAgeProof(execution: ReviewFixtureExecution<KPassAgeProofValueB>): boolean
  setIdentityDemoScenario(scenario: KPassScenario | "guest"): boolean
  acknowledgeCommerceLocalBoundary(): boolean
  setCommerceWalletStatus(status: OndoBCommerceWalletStatus): void
  setCommerceFundingSource(source: OndoBCommerceFundingSource): boolean
  creditSampleFunding(execution: ReviewFixtureExecution<FundingRailReceiptB>): boolean
  dispatchCommerce(action: StableCommerceBAction): boolean
  recordCommerceReceipt(receipt: OndoBCommerceReceipt): boolean
  openMealBenefitFromPlace(venueId: string, options?: { newOrder?: boolean; orderId?: string }): boolean
  selectCommerceOrder(orderId: string): boolean
  returnFromCommerceOrigin(): boolean
  clearBDeviceContent(): OndoBClearDeviceContentResult
  notify(message: string): void
  discardToast(): void
}

export type OndoBDeviceState = {
  locale: OndoBLocale
  appearancePreference: OndoBAppearancePreference
  onboarding: "ONB-NEW" | "ONB-COMPLETE"
  persona: OndoBPersona | null
  discoveryArea: OndoBDiscoveryArea
  discoveryPreferences: OndoBDiscoveryPreference[]
  savedVenueIds: string[]
  savedEditorialPlaceIds: EditorialPlaceB["id"][]
  accountSaveTransaction: BAccountSaveTransactionMarker | null
  privateNotesByVenue: Record<string, string>
  recentVenueIds: string[]
  recentEditorialPlaceIds: EditorialPlaceB["id"][]
  plannedTableRefs: OndoBPlannedTableRef[]
  localSignalPostedVenueIds: string[]
  localPulseEvidenceByVenue: Record<string, PulseLocalEvidenceB>
  localInteractionBoundarySeen: boolean
  commerceLocalBoundarySeen: boolean
  commerceFundingSource: OndoBCommerceFundingSource
  commerceReceipts: OndoBCommerceReceipt[]
}

export const B_DEVICE_KEY = ONDO_B_DEVICE_STORAGE_KEY
const B_PLACE_MEMORY_KEY = "ondo-b.place-memories.v1"
export const B_ACCOUNT_SESSION_KEY = "ondo-b.account.v1"
const LEGACY_SESSION_KEY = "ondo.session.v3"
const B_PREFERENCES = new Set(ONDO_B_DISCOVERY_PREFERENCES.map((preference) => preference.id))
const B_LOCAL_SIGNAL_TAGS = new Set<OndoBLocalSignalTag>(["calm_now", "lively_now", "quick_stop", "welcoming"])
const B_LOCAL_SIGNAL_NOTE_MAX_LENGTH = 240
const B_COMMERCE_RECEIPT_LIMIT = 8
const B_COMMERCE_FUNDING_SOURCES = new Set<OndoBCommerceFundingSource>(["travel_balance", "krw_bank", "card_wallet", "digital_dollar"])

function sanitizeDiscoveryPreferences(value: unknown): OndoBDiscoveryPreference[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is OndoBDiscoveryPreference => B_PREFERENCES.has(item as OndoBDiscoveryPreference)))]
    : []
}

type BStorageBoundary = Pick<Storage, "getItem" | "setItem" | "removeItem">

function restoreStorageValue(storage: BStorageBoundary, key: string, previous: string | null) {
  try {
    if (previous === null) storage.removeItem(key)
    else storage.setItem(key, previous)
    return storage.getItem(key) === previous
  } catch {
    return false
  }
}

function writeStorageValueWithReadback(storage: BStorageBoundary, key: string, next: string) {
  let previous: string | null
  try {
    previous = storage.getItem(key)
    storage.setItem(key, next)
    if (storage.getItem(key) === next) return true
  } catch {
    // WHATWG Storage writes are atomic: a thrown set does not publish a new
    // value. The rollback below also covers an ignored write/read mismatch.
    try { previous = storage.getItem(key) } catch { return false }
  }
  restoreStorageValue(storage, key, previous)
  return false
}

function removeStorageValueWithReadback(storage: BStorageBoundary, key: string) {
  let previous: string | null
  try {
    previous = storage.getItem(key)
    storage.removeItem(key)
    if (storage.getItem(key) === null) return true
  } catch {
    try { previous = storage.getItem(key) } catch { return false }
  }
  restoreStorageValue(storage, key, previous)
  return false
}

export function sanitizeCommerceReceipts(value: unknown): OndoBCommerceReceipt[] {
  if (!Array.isArray(value)) return []
  const receipts = value.flatMap((item): OndoBCommerceReceipt[] => {
    if (!item || typeof item !== "object") return []
    const receipt = item as Record<string, unknown>
    if (receipt.executionTruth !== "FIXTURE_REVIEW" || receipt.provenanceTruth !== REVIEW_PROVENANCE_TRUTH) return []
    if (typeof receipt.orderId === "string") {
      const place = resolveCommercePlaceB(receipt.venueId)
      if (!place?.commerce || receipt.offerId !== place.commerce.offerId || !/^(sample-order:[a-zA-Z0-9-]{1,80}|ONDO-LOCAL-OP-20260825-001)$/.test(receipt.orderId)
        || typeof receipt.receiptId !== "string" || receipt.receiptId !== (receipt.orderId === STABLE_B_PAYMENT_OPERATION_ID ? STABLE_B_RECEIPT_ID : `${receipt.orderId}:receipt`)
        || (receipt.status !== "paid" && receipt.status !== "refunded")
        || (receipt.benefitOOKRW !== 0 && receipt.benefitOOKRW !== place.commerce.benefitKrw / 1_000)
        || receipt.paidOOKRW !== place.commerce.grossKrw / 1_000 - Number(receipt.benefitOOKRW)
        || typeof receipt.balanceOOKRW !== "number" || !Number.isFinite(receipt.balanceOOKRW) || receipt.balanceOOKRW < 0
        || !Number.isSafeInteger(receipt.refundedKrw) || Number(receipt.refundedKrw) < 0 || Number(receipt.refundedKrw) > Number(receipt.paidOOKRW) * 1_000
        || (receipt.status === "refunded" && receipt.refundedKrw !== Number(receipt.paidOOKRW) * 1_000)) return []
      return [{ executionTruth: "FIXTURE_REVIEW", provenanceTruth: REVIEW_PROVENANCE_TRUTH,
        orderId: receipt.orderId, receiptId: receipt.receiptId, refundReceiptId: typeof receipt.refundReceiptId === "string" ? receipt.refundReceiptId : null,
        offerId: place.commerce.offerId, venueId: place.id, status: receipt.status,
        paidOOKRW: Number(receipt.paidOOKRW), benefitOOKRW: Number(receipt.benefitOOKRW), balanceOOKRW: receipt.balanceOOKRW, refundedKrw: Number(receipt.refundedKrw) }]
    }
    if (receipt.receiptId !== STABLE_B_RECEIPT_ID || receipt.offerId !== STABLE_B_OFFER_ID || receipt.venueId !== STABLE_B_OFFER_VENUE_ID) return []
    if (receipt.status !== "paid" && receipt.status !== "refunded") return []
    if (receipt.status === "paid" ? receipt.refundReceiptId !== null : receipt.refundReceiptId !== STABLE_B_REFUND_RECEIPT_ID) return []
    const benefitOOKRW = receipt.benefitOOKRW === STABLE_B_VOUCHER_VALUE
      ? STABLE_B_VOUCHER_VALUE
      : receipt.benefitOOKRW === 0 ? 0 : null
    const paidOOKRW = benefitOOKRW == null || receipt.paidOOKRW !== STABLE_B_OOKRW_PRICE - benefitOOKRW
      ? null
      : receipt.paidOOKRW
    const expectedBalance = paidOOKRW == null
      ? null
      : receipt.status === "paid" ? STABLE_B_OPENING_BALANCE - paidOOKRW : STABLE_B_OPENING_BALANCE
    const balanceOOKRW = receipt.balanceOOKRW === expectedBalance ? expectedBalance : null
    if (paidOOKRW === null || benefitOOKRW === null || balanceOOKRW === null) return []
    return [{
      executionTruth: "FIXTURE_REVIEW",
      provenanceTruth: REVIEW_PROVENANCE_TRUTH,
      receiptId: STABLE_B_RECEIPT_ID,
      refundReceiptId: receipt.status === "refunded" ? STABLE_B_REFUND_RECEIPT_ID : null,
      offerId: "meal-offer-gukbap",
      venueId: receipt.venueId,
      status: receipt.status,
      paidOOKRW,
      benefitOOKRW,
      balanceOOKRW,
    }]
  })
  return receipts
    .filter((receipt, index, all) => all.findIndex((candidate) => candidate.receiptId === receipt.receiptId) === index)
    .slice(0, B_COMMERCE_RECEIPT_LIMIT)
}

export function commerceSessionFromReceipts(receipts: readonly OndoBCommerceReceipt[]): StableCommerceBState {
  const receipt = receipts[0]
  const initial = createStableCommerceBState()
  if (!receipt) return initial
  const paymentLedger: StableCommerceBState["ledger"] = [
    {
      operationId: STABLE_B_PAYMENT_OPERATION_ID,
      receiptId: STABLE_B_RECEIPT_ID,
      side: "holder",
      amount: -receipt.paidOOKRW,
      kind: "PAYMENT",
    },
    {
      operationId: STABLE_B_PAYMENT_OPERATION_ID,
      receiptId: STABLE_B_RECEIPT_ID,
      side: "merchant",
      amount: receipt.paidOOKRW,
      kind: "PAYMENT",
    },
  ]
  const refundLedger: StableCommerceBState["ledger"] = receipt.status === "refunded" ? [
    {
      operationId: STABLE_B_REFUND_OPERATION_ID,
      receiptId: STABLE_B_REFUND_RECEIPT_ID,
      side: "holder",
      amount: receipt.paidOOKRW,
      kind: "REFUND",
    },
    {
      operationId: STABLE_B_REFUND_OPERATION_ID,
      receiptId: STABLE_B_REFUND_RECEIPT_ID,
      side: "merchant",
      amount: -receipt.paidOOKRW,
      kind: "REFUND",
    },
  ] : []
  return {
    ...initial,
    status: receipt.status,
    voucher: receipt.status === "paid" && receipt.benefitOOKRW > 0 ? "consumed" : "available",
    benefitRecommendation: receipt.benefitOOKRW > 0 ? "accepted" : "declined",
    confirmationCount: 1,
    receiptCount: 1,
    refundCount: receipt.status === "refunded" ? 1 : 0,
    chargedDebit: receipt.paidOOKRW,
    voucherApplied: receipt.benefitOOKRW > 0,
    redemptionCount: receipt.status === "paid" && receipt.benefitOOKRW > 0 ? 1 : 0,
    receiptId: receipt.receiptId,
    lastOutcome: "success",
    ledger: paymentLedger.concat(refundLedger),
  }
}

function initialState(): OndoBState {
  return {
    hydrated: false,
    locale: "en",
    appearancePreference: "system",
    resolvedAppearance: "light",
    tab: "ondo",
    surface: { kind: "map" },
    onboarding: "ONB-NEW",
    account: "ACC-GUEST",
    accountReturnTo: null,
    accountSaveTransaction: null,
    accountSaveRecoveryBlocked: false,
    persona: null,
    discoveryArea: null,
    discoveryPreferences: [],
    savedVenueIds: [],
    savedEditorialPlaceIds: [],
    saveStatusByVenue: {},
    privateNotesByVenue: {},
    recentVenueIds: [],
    recentEditorialPlaceIds: [],
    plannedTableRefs: [],
    localSignalPostedVenueIds: [],
    localPulseEvidenceByVenue: {},
    localInteractionBoundarySeen: false,
    identitySetupOrigin: null,
    identityCredential: null,
    identityDemoScenario: "adult_visitor",
    commerceLocalBoundarySeen: false,
    commerceOrigin: null,
    commerceWalletStatus: "disconnected",
    commerceFundingSource: "travel_balance",
    commerceSession: createStableCommerceBState(),
    commerceReceiptVenueId: null,
    commerceReceipts: [],
    localSignalDraft: null,
    toast: null,
  }
}

function preferredBrowserLocale(): OndoBLocale {
  if (typeof navigator === "undefined") return "en"
  return navigator.languages.some((language) => language.toLowerCase().startsWith("ja")) ? "ja" : "en"
}

const DEVICE_MESSAGE = {
  locale: { en: "Language could not be saved on this device.", ko: "언어 설정을 이 기기에 저장하지 못했어요.", ja: "言語設定をこの端末に保存できませんでした。" },
  appearance: { en: "Appearance could not be saved on this device.", ko: "화면 설정을 이 기기에 저장하지 못했어요.", ja: "表示設定をこの端末に保存できませんでした。" },
  persona: { en: "Intent could not be saved.", ko: "이용 목적을 저장하지 못했어요.", ja: "利用目的を保存できませんでした。" },
  choices: { en: "Choices could not be saved.", ko: "선택을 저장하지 못했어요.", ja: "選択内容を保存できませんでした。" },
  clearChoices: { en: "Choices could not be cleared.", ko: "선택을 초기화하지 못했어요.", ja: "選択内容をリセットできませんでした。" },
  setup: { en: "Using these choices for this visit. They could not be saved on this device.", ko: "이번 이용에는 선택을 반영했어요. 이 기기에는 저장하지 못했습니다.", ja: "今回の利用には反映しました。この端末には保存できませんでした。" },
  guest: { en: "Guest Explore is open for this visit. It could not be saved on this device.", ko: "이번 이용에는 게스트 탐색을 열었어요. 이 기기에는 저장하지 못했습니다.", ja: "今回はゲストで地図を開きました。この端末には保存できませんでした。" },
  account: { en: "The account step could not start in this tab.", ko: "이 탭에서 계정 절차를 시작하지 못했어요.", ja: "このタブでアカウント手続きを開始できませんでした。" },
} satisfies Record<string, Record<OndoBLocale, string>>

function isProductionPath() {
  return typeof window !== "undefined" && window.location.pathname === "/"
}

export function isBAccountSaveTransactionTargetPresent(
  marker: BAccountSaveTransactionMarker,
  savedVenueIds: readonly string[],
  savedEditorialPlaceIds: readonly EditorialPlaceB["id"][],
) {
  return marker.targetKind === "canonical"
    ? savedVenueIds.includes(marker.targetId)
    : savedEditorialPlaceIds.includes(marker.targetId as EditorialPlaceB["id"])
}

export function restoreBDeviceState(value: unknown): OndoBDeviceState {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {}
  const persona = normalizeOndoBDiscoveryIntent(record.persona)
  const discoveryArea = normalizeOndoBDiscoveryArea(record.discoveryArea)
  const persistedIntentIsKnown = record.persona == null || persona !== null
  const onboardingIsCoherent = persistedIntentIsKnown
    && ((persona !== "nearby" && persona !== "living") || discoveryArea !== null)
  const accountSaveTransaction = restoreBAccountSaveTransactionMarker(record.accountSaveTransaction)
  // The transaction marker is an integrity/quarantine signal, never authority
  // to add or remove a Save. A legitimate prepared record already contains the
  // exact pre-action membership in this same atomic device value.
  const savedVenueIds = sanitizeCanonicalVenueIds(record.savedVenueIds)
  const savedEditorialPlaceIds = sanitizeEditorialPlaceIds(record.savedEditorialPlaceIds)
  const localPulseRecord = record.localPulseEvidenceByVenue && typeof record.localPulseEvidenceByVenue === "object"
    ? record.localPulseEvidenceByVenue as Record<string, unknown>
    : {}
  const restoredLocalPulseEvidenceByVenue = Object.fromEntries(Object.entries(localPulseRecord).flatMap(([venueId, value]) => {
    if (!isCanonicalVenueId(venueId) || !value || typeof value !== "object") return []
    const evidence = value as Record<string, unknown>
    const tags = Array.isArray(evidence.tags)
      ? [...new Set(evidence.tags.filter((tag): tag is OndoBLocalSignalTag => B_LOCAL_SIGNAL_TAGS.has(tag as OndoBLocalSignalTag)))]
      : []
    const postedAt = typeof evidence.postedAt === "string" && !Number.isNaN(Date.parse(evidence.postedAt)) ? evidence.postedAt : null
    return tags.length && postedAt ? [[venueId, { tags, postedAt } satisfies PulseLocalEvidenceB]] : []
  }))
  const restoredLocalSignalVenueIds = sanitizeLocalSignalVenueIds(record.localSignalPostedVenueIds)
  const localSignalPostedVenueIds = restoredLocalSignalVenueIds.filter((venueId) => restoredLocalPulseEvidenceByVenue[venueId] !== undefined)
  const boundedLocalPulseEvidenceByVenue = Object.fromEntries(localSignalPostedVenueIds.map((venueId) => [venueId, restoredLocalPulseEvidenceByVenue[venueId]]))
  const commerceReceipts = sanitizeCommerceReceipts(record.commerceReceipts)
  return {
    locale: record.locale === "ko" || record.locale === "ja" ? record.locale : "en",
    appearancePreference: sanitizeOndoBAppearancePreference(record.appearancePreference),
    onboarding: record.onboarding === "ONB-COMPLETE" && onboardingIsCoherent ? "ONB-COMPLETE" : "ONB-NEW",
    persona,
    discoveryArea,
    discoveryPreferences: sanitizeDiscoveryPreferences(record.discoveryPreferences),
    savedVenueIds,
    savedEditorialPlaceIds,
    accountSaveTransaction,
    privateNotesByVenue: sanitizeCanonicalVenueNotes(record.privateNotesByVenue),
    recentVenueIds: sanitizeRecentVenueIds(record.recentVenueIds),
    recentEditorialPlaceIds: sanitizeEditorialPlaceIds(record.recentEditorialPlaceIds).slice(0, 8),
    plannedTableRefs: sanitizePlannedTableRefs(record.plannedTableRefs),
    localSignalPostedVenueIds,
    localPulseEvidenceByVenue: boundedLocalPulseEvidenceByVenue,
    localInteractionBoundarySeen: record.localInteractionBoundarySeen === true,
    commerceLocalBoundarySeen: record.commerceLocalBoundarySeen === true,
    commerceFundingSource: B_COMMERCE_FUNDING_SOURCES.has(record.commerceFundingSource as OndoBCommerceFundingSource)
      ? record.commerceFundingSource as OndoBCommerceFundingSource
      : "travel_balance",
    commerceReceipts,
  }
}

function deviceState(state: OndoBState): OndoBDeviceState {
  return restoreBDeviceState({
    locale: state.locale,
    appearancePreference: state.appearancePreference,
    onboarding: state.onboarding,
    persona: state.persona,
    discoveryArea: state.discoveryArea,
    discoveryPreferences: state.discoveryPreferences,
    savedVenueIds: state.savedVenueIds,
    savedEditorialPlaceIds: state.savedEditorialPlaceIds,
    accountSaveTransaction: state.accountSaveTransaction,
    privateNotesByVenue: state.privateNotesByVenue,
    recentVenueIds: state.recentVenueIds,
    recentEditorialPlaceIds: state.recentEditorialPlaceIds,
    plannedTableRefs: state.plannedTableRefs,
    localSignalPostedVenueIds: state.localSignalPostedVenueIds,
    localPulseEvidenceByVenue: state.localPulseEvidenceByVenue,
    localInteractionBoundarySeen: state.localInteractionBoundarySeen,
    commerceLocalBoundarySeen: state.commerceLocalBoundarySeen,
    commerceFundingSource: state.commerceFundingSource,
    // Review-fixture results are current-session evidence only. They must not
    // hydrate a production-looking ready wallet or paid receipt after reload.
    commerceReceipts: [],
  })
}

export function persistBDeviceStateToStorage(storage: BStorageBoundary, value: unknown) {
  return writeStorageValueWithReadback(storage, B_DEVICE_KEY, JSON.stringify(restoreBDeviceState(value)))
}

function persistBDeviceState(state: OndoBState) {
  if (!isProductionPath() || state.accountSaveRecoveryBlocked) return false
  return persistBDeviceStateToStorage(window.localStorage, deviceState(state))
}

export function transitionCanonicalSavedVenueMembershipB<TState extends {
  savedVenueIds: string[]
  saveStatusByVenue: Record<string, OndoBSaveStatus>
}>(current: TState, venueId: string, shouldSave: boolean): TState {
  const alreadySaved = current.savedVenueIds.includes(venueId)
  return {
    ...current,
    savedVenueIds: shouldSave
      ? alreadySaved ? current.savedVenueIds : [...current.savedVenueIds, venueId]
      : current.savedVenueIds.filter((id) => id !== venueId),
    saveStatusByVenue: {
      ...current.saveStatusByVenue,
      [venueId]: shouldSave ? "SAV-SAVED" : "SAV-IDLE",
    },
  }
}

export type BAccountSessionState = {
  account: OndoBPersistedAccountStatus
  returnTo: BAccountReturnToEnvelope | null
}

type BAccountSaveTransactionResult<TState> =
  | { outcome: "saved"; nextState: TState; consumed: BAccountReturnToEnvelope }
  | { outcome: "save_failed" | "account_failed"; nextState: null; consumed: BAccountReturnToEnvelope | null }

type BAccountSaveTransactionState = {
  savedVenueIds: string[]
  savedEditorialPlaceIds: EditorialPlaceB["id"][]
  accountSaveTransaction: BAccountSaveTransactionMarker | null
}

/**
 * The Account axis and the saved object are one visible action but live in two
 * storage records. This small transaction boundary keeps the public return
 * pending until both writes succeed, then tombstones it exactly once. Tests
 * inject the writers so forged returns and write failures can prove mutation 0.
 */
export function commitBAccountSaveTransaction<TState extends BAccountSaveTransactionState>(input: {
  currentState: TState
  returnTo: unknown
  rollbackSession: BAccountSessionState
  buildNextState(consumed: BAccountReturnToEnvelope): TState
  persistDevice(state: TState): boolean
  persistAccount(session: BAccountSessionState): boolean
  abortBeforePersist?(consumed: BAccountReturnToEnvelope): boolean
  now?: Date
}): BAccountSaveTransactionResult<TState> {
  const consumed = consumeBAccountReturnTo(input.returnTo, input.now)
  if (!consumed) return { outcome: "account_failed", nextState: null, consumed: null }
  if (input.abortBeforePersist?.(consumed)) {
    restoreConsumedBAccountReturnTo(consumed, input.now)
    return { outcome: "save_failed", nextState: null, consumed }
  }

  const targetWasSaved = consumed.targetKind === "canonical"
    ? input.currentState.savedVenueIds.includes(consumed.venueId)
    : input.currentState.savedEditorialPlaceIds.includes(consumed.editorialPlaceId)
  const preparedMarker = createBAccountSaveTransactionMarker(consumed, targetWasSaved, "prepared")
  const preparedState = { ...input.currentState, accountSaveTransaction: preparedMarker } as TState
  // The prepared marker and the pre-action Save membership share one atomic
  // localStorage value. Any later partial session write therefore still
  // hydrates as Guest without exposing a newly saved target.
  if (!input.persistDevice(preparedState)) {
    restoreConsumedBAccountReturnTo(consumed, input.now)
    return { outcome: "save_failed", nextState: null, consumed }
  }
  if (!input.persistAccount({ account: "ACC-ACTIVE", returnTo: null })) {
    input.persistDevice(input.currentState)
    restoreConsumedBAccountReturnTo(consumed, input.now)
    return { outcome: "account_failed", nextState: null, consumed }
  }
  const nextState = input.buildNextState(consumed)
  const terminalMarker = createBAccountSaveTransactionMarker(consumed, targetWasSaved, "terminal")
  const terminalState = { ...nextState, accountSaveTransaction: terminalMarker } as TState
  if (!input.persistDevice(terminalState)) {
    input.persistAccount(input.rollbackSession)
    input.persistDevice(input.currentState)
    restoreConsumedBAccountReturnTo(consumed, input.now)
    return { outcome: "save_failed", nextState: null, consumed }
  }
  if (!finalizeConsumedBAccountReturnTo(consumed)) {
    input.persistAccount(input.rollbackSession)
    input.persistDevice(input.currentState)
    restoreConsumedBAccountReturnTo(consumed, input.now)
    return { outcome: "account_failed", nextState: null, consumed }
  }
  return { outcome: "saved", nextState: terminalState, consumed }
}

export function persistPendingBAccountReturn(input: {
  account: OndoBPersistedAccountStatus
  returnTo: BAccountReturnToEnvelope
  persistAccount(session: BAccountSessionState): boolean
  now?: Date
}) {
  if (!isBAccountReturnToUsable(input.returnTo, input.now)) return false
  if (input.persistAccount({ account: input.account, returnTo: input.returnTo })) return true
  discardBAccountReturnTo(input.returnTo)
  return false
}

export function clearPendingBAccountReturn(input: {
  account: OndoBPersistedAccountStatus
  returnTo: BAccountReturnToEnvelope
  persistAccount(session: BAccountSessionState): boolean
}) {
  // Clear durable state first. If that write fails, the expectation and the
  // mounted overlay both remain retryable rather than claiming cancellation.
  if (!input.persistAccount({ account: input.account, returnTo: null })) return false
  discardBAccountReturnTo(input.returnTo)
  return true
}

export function restoreBAccountSession(value: unknown, now = new Date()): BAccountSessionState {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {}
  const account = record.account === "ACC-ACTIVE" ? "ACC-ACTIVE" : "ACC-GUEST"
  const candidate = record.returnTo && typeof record.returnTo === "object"
    ? record.returnTo as BAccountReturnToEnvelope
    : null
  return {
    account,
    returnTo: account === "ACC-GUEST" && isBAccountReturnToUsable(candidate, now) ? candidate : null,
  }
}

export function persistBAccountSessionToStorage(storage: BStorageBoundary, session: BAccountSessionState) {
  return writeStorageValueWithReadback(storage, B_ACCOUNT_SESSION_KEY, JSON.stringify(session))
}

function quarantineStoredBAccountSession(storage: BStorageBoundary, session: BAccountSessionState) {
  if (persistBAccountSessionToStorage(storage, session)) return true
  // If an ignored/mismatched replacement cannot be proven, delete and verify
  // the stale public token. Re-seed the safe Account-only snapshot when the
  // storage boundary accepts it; absence is still safer than replayable bytes.
  try {
    storage.removeItem(B_ACCOUNT_SESSION_KEY)
    if (storage.getItem(B_ACCOUNT_SESSION_KEY) !== null) return false
  } catch {
    return false
  }
  return persistBAccountSessionToStorage(storage, session) || (() => {
    try { return storage.getItem(B_ACCOUNT_SESSION_KEY) === null } catch { return false }
  })()
}

export function restoreStoredBAccountSession(
  storage: BStorageBoundary,
  stored: string,
  now = new Date(),
): BAccountSessionState {
  const fallback: BAccountSessionState = { account: "ACC-GUEST", returnTo: null }
  let parsed: unknown
  try { parsed = JSON.parse(stored) } catch {
    quarantineStoredBAccountSession(storage, fallback)
    return fallback
  }

  const record = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null
  const exactSessionKeys = record
    ? Object.keys(record).length === 2
      && Object.prototype.hasOwnProperty.call(record, "account")
      && Object.prototype.hasOwnProperty.call(record, "returnTo")
    : false
  const restored = exactSessionKeys
    ? restoreBAccountSession(record, now)
    : { account: record?.account === "ACC-ACTIVE" ? "ACC-ACTIVE" as const : "ACC-GUEST" as const, returnTo: null }
  const canonical = JSON.stringify(restored)
  if (stored !== canonical) quarantineStoredBAccountSession(storage, restored)
  return restored
}

export function reconcileBAccountSaveHydration(input: {
  device: OndoBDeviceState
  accountSession: BAccountSessionState
  persistedMarkerPresent: boolean
}) {
  if (!input.persistedMarkerPresent) {
    return { device: input.device, accountSession: input.accountSession, blocked: false }
  }
  const marker = input.device.accountSaveTransaction
  const targetPresent = marker
    ? isBAccountSaveTransactionTargetPresent(marker, input.device.savedVenueIds, input.device.savedEditorialPlaceIds)
    : false
  const markerMatchesStoredMembership = Boolean(marker && (marker.phase === "terminal"
    ? targetPresent
    : marker.targetWasSaved === targetPresent))
  if (marker?.phase === "terminal" && markerMatchesStoredMembership) {
    return { device: input.device, accountSession: input.accountSession, blocked: false }
  }

  // A prepared record must describe the membership already present in the same
  // atomic value. Corrupt, forged, incomplete, or interrupted markers all fail
  // closed to Guest, but none may rewrite the user's existing Saves.
  return {
    device: {
      ...input.device,
      accountSaveTransaction: null,
      privateNotesByVenue: sanitizeCanonicalVenueNotes(input.device.privateNotesByVenue),
    },
    accountSession: { account: "ACC-GUEST", returnTo: null } as BAccountSessionState,
    blocked: true,
  }
}

export function settleBAccountSaveHydration(input: {
  restoredDevice: OndoBDeviceState
  reconciliation: ReturnType<typeof reconcileBAccountSaveHydration>
  persistGuest(session: BAccountSessionState): boolean
}) {
  if (!input.reconciliation.blocked) {
    return { ...input.reconciliation, devicePersistenceBlocked: false }
  }
  const guestPersisted = input.persistGuest(input.reconciliation.accountSession)
  return {
    ...input.reconciliation,
    // Never clear/quarantine the durable marker before the Guest session has
    // exact readback. Retaining it keeps every reload fail-closed even when
    // localStorage itself would accept a later write.
    device: guestPersisted ? input.reconciliation.device : input.restoredDevice,
    devicePersistenceBlocked: !guestPersisted,
  }
}

function persistBAccountSession(session: BAccountSessionState) {
  if (!isProductionPath()) return false
  // Persist an explicit Guest value too. It prevents a deliberate B reset or
  // cancelled migration from re-importing an older A-owned Account record on
  // the next reload, while the legacy bytes remain untouched.
  return persistBAccountSessionToStorage(window.sessionStorage, session)
}

function readBAccountSession(): BAccountSessionState {
  try {
    const stored = window.sessionStorage.getItem(B_ACCOUNT_SESSION_KEY)
    if (stored !== null) return restoreStoredBAccountSession(window.sessionStorage, stored)

    // One-way compatibility for the documented pre-B session seam. Only the
    // Account axis is admitted; B never imports the legacy provider and never
    // reads or migrates Person, age, payment, profile, gate, or reputation.
    // The legacy record remains byte-for-byte owned by its original surface.
    const legacyStored = window.sessionStorage.getItem(LEGACY_SESSION_KEY)
    const legacy = legacyStored === null ? null : JSON.parse(legacyStored) as Record<string, unknown>
    const migrated = restoreBAccountSession({ account: legacy?.account })
    if (migrated.account === "ACC-ACTIVE") persistBAccountSession(migrated)
    return migrated
  } catch {
    return { account: "ACC-GUEST", returnTo: null }
  }
}

const OndoBContext = createContext<{ state: OndoBState; actions: OndoBActions } | null>(null)

export function OndoBProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(initialState)
  const stateRef = useRef(state)
  const onboardingBeforeSetupRef = useRef<"ONB-NEW" | "ONB-COMPLETE" | null>(null)
  const failedSaveQaVenueIdsRef = useRef(new Set<string>())
  const toastGenerationRef = useRef(0)
  const toastTimerRef = useRef<number | null>(null)
  stateRef.current = state

  useEffect(() => {
    const blank = initialState()
    if (!isProductionPath()) {
      const next = {
        ...blank,
        resolvedAppearance: resolveOndoBAppearance(blank.appearancePreference, browserPrefersDarkAppearance()),
        hydrated: true,
      }
      stateRef.current = next
      setState(next)
      return
    }
    try {
      const stored = window.localStorage.getItem(B_DEVICE_KEY)
      const parsedDevice = stored === null ? { locale: preferredBrowserLocale() } : JSON.parse(stored)
      const persistedMarkerPresent = Boolean(parsedDevice && typeof parsedDevice === "object"
        && Object.prototype.hasOwnProperty.call(parsedDevice, "accountSaveTransaction")
        && (parsedDevice as Record<string, unknown>).accountSaveTransaction !== null)
      const restored = restoreBDeviceState(parsedDevice)
      const reconciliation = reconcileBAccountSaveHydration({
        device: restored,
        accountSession: readBAccountSession(),
        persistedMarkerPresent,
      })
      const settled = settleBAccountSaveHydration({
        restoredDevice: restored,
        reconciliation,
        persistGuest: persistBAccountSession,
      })
      const next: OndoBState = {
        ...blank,
        ...settled.device,
        resolvedAppearance: resolveOndoBAppearance(settled.device.appearancePreference, browserPrefersDarkAppearance()),
        account: settled.accountSession.account,
        accountReturnTo: settled.accountSession.returnTo,
        accountSaveRecoveryBlocked: settled.devicePersistenceBlocked,
        saveStatusByVenue: Object.fromEntries(settled.device.savedVenueIds.map((venueId) => [venueId, "SAV-SAVED" as const])),
          commerceOrigin: null,
          commerceReceipts: [],
          commerceWalletStatus: "disconnected",
          commerceSession: createStableCommerceBState(),
          commerceReceiptVenueId: null,
          hydrated: true,
      }
      stateRef.current = next
      setState(next)
      if (!settled.devicePersistenceBlocked) persistBDeviceState(next)
    } catch {
      const next = {
        ...blank,
        locale: preferredBrowserLocale(),
        resolvedAppearance: resolveOndoBAppearance(blank.appearancePreference, browserPrefersDarkAppearance()),
        hydrated: true,
      }
      stateRef.current = next
      setState(next)
    }
  }, [])

  const discardToast = useCallback(() => {
    toastGenerationRef.current += 1
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = null
    if (stateRef.current.toast === null) return
    const next = { ...stateRef.current, toast: null }
    stateRef.current = next
    setState(next)
  }, [])

  const notify = useCallback((message: string) => {
    const generation = toastGenerationRef.current + 1
    toastGenerationRef.current = generation
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current)
    const next = { ...stateRef.current, toast: message }
    stateRef.current = next
    setState(next)
    toastTimerRef.current = window.setTimeout(() => {
      if (toastGenerationRef.current !== generation) return
      toastTimerRef.current = null
      if (stateRef.current.toast !== message) return
      const cleared = { ...stateRef.current, toast: null }
      stateRef.current = cleared
      setState(cleared)
    }, 2_200)
  }, [])

  useEffect(() => () => {
    toastGenerationRef.current += 1
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current)
  }, [])

  const commit = useCallback((update: (current: OndoBState) => OndoBState) => {
    const next = update(stateRef.current)
    if (!persistBDeviceState(next)) return false
    stateRef.current = next
    setState(next)
    return true
  }, [])

  const commitEphemeral = useCallback((update: (current: OndoBState) => OndoBState) => {
    const next = update(stateRef.current)
    stateRef.current = next
    setState(next)
  }, [])

  useLayoutEffect(() => {
    // Full navigations already have the bootstrap's persisted/system truth.
    // Re-read that same narrow truth instead of painting initialState's light
    // fallback over it. On SPA return, cleanup removed the document attributes,
    // so this same synchronous path restores the theme before the next paint.
    const appearance = state.hydrated
      ? { preference: state.appearancePreference, theme: state.resolvedAppearance }
      : readBrowserOndoBAppearanceSnapshot()
    syncOndoBAppearanceDocument(appearance.preference, appearance.theme)
  }, [state.appearancePreference, state.hydrated, state.resolvedAppearance])

  useLayoutEffect(() => () => {
    resetOndoBAppearanceDocument()
  }, [])

  useEffect(() => {
    if (!state.hydrated || state.appearancePreference !== "system" || typeof window.matchMedia !== "function") return
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const syncSystemAppearance = () => {
      const resolvedAppearance = resolveOndoBAppearance("system", media.matches)
      if (stateRef.current.appearancePreference !== "system" || stateRef.current.resolvedAppearance === resolvedAppearance) return
      commitEphemeral((current) => current.appearancePreference === "system"
        ? { ...current, resolvedAppearance }
        : current)
    }
    media.addEventListener("change", syncSystemAppearance)
    syncSystemAppearance()
    return () => media.removeEventListener("change", syncSystemAppearance)
  }, [commitEphemeral, state.appearancePreference, state.hydrated])

  const persistCanonicalSavedVenue = useCallback((venueId: string, toggle: boolean) => {
    if (!isCanonicalVenueId(venueId) || !isProductionPath()) {
      const failed = { ...stateRef.current, saveStatusByVenue: { ...stateRef.current.saveStatusByVenue, [venueId]: "SAV-FAILED" as const } }
      stateRef.current = failed
      setState(failed)
      return false
    }
    const current = stateRef.current
    const alreadySaved = current.savedVenueIds.includes(venueId)
    const shouldSave = toggle ? !alreadySaved : true
    if (shouldSave && current.account !== "ACC-ACTIVE") return false
    if (shouldSave && readQaScenario() === "save-failed" && !failedSaveQaVenueIdsRef.current.has(venueId)) {
      failedSaveQaVenueIdsRef.current.add(venueId)
      const failed: OndoBState = { ...current, saveStatusByVenue: { ...current.saveStatusByVenue, [venueId]: "SAV-FAILED" } }
      stateRef.current = failed
      setState(failed)
      return false
    }
    const next = transitionCanonicalSavedVenueMembershipB(current, venueId, shouldSave)
    if (!persistBDeviceState(next)) {
      const failed: OndoBState = { ...current, saveStatusByVenue: { ...current.saveStatusByVenue, [venueId]: "SAV-FAILED" } }
      stateRef.current = failed
      setState(failed)
      return false
    }
    stateRef.current = next
    setState(next)
    return true
  }, [])

  const beginAccountSave = useCallback((venueId: string) => {
    if (!isCanonicalVenueId(venueId) || stateRef.current.account !== "ACC-GUEST") return false
    let returnTo: BAccountReturnToEnvelope
    try {
      returnTo = createBAccountReturnTo(venueId)
    } catch {
      return false
    }
    if (!persistPendingBAccountReturn({ account: "ACC-GUEST", returnTo, persistAccount: persistBAccountSession })) return false
    commitEphemeral((current) => ({ ...current, accountReturnTo: returnTo }))
    return true
  }, [commitEphemeral])

  const beginEditorialAccountSave = useCallback((editorialPlaceId: EditorialPlaceB["id"]) => {
    if (!isEditorialPlaceId(editorialPlaceId) || stateRef.current.account !== "ACC-GUEST") return false
    let returnTo: BAccountReturnToEnvelope
    try {
      returnTo = createBEditorialAccountReturnTo(editorialPlaceId)
    } catch {
      return false
    }
    if (!persistPendingBAccountReturn({ account: "ACC-GUEST", returnTo, persistAccount: persistBAccountSession })) return false
    commitEphemeral((current) => ({ ...current, accountReturnTo: returnTo }))
    return true
  }, [commitEphemeral])

  const cancelAccountSave = useCallback(() => {
    const current = stateRef.current
    const returnTo = current.accountReturnTo
    if (!returnTo) return false
    const account: OndoBPersistedAccountStatus = current.account === "ACC-ACTIVE" ? "ACC-ACTIVE" : "ACC-GUEST"
    const cleared = clearPendingBAccountReturn({ account, returnTo, persistAccount: persistBAccountSession })
    if (!cleared) {
      if (current.account === "ACC-CREATING") commitEphemeral((value) => ({ ...value, account: "ACC-GUEST" }))
      return false
    }
    commitEphemeral((value) => ({ ...value, account, accountReturnTo: null }))
    return true
  }, [commitEphemeral])

  const beginAccountActivation = useCallback(() => {
    // A same-frame double tap is an idempotent no-op. It must not turn the
    // already visible pending state into a failure or start a second commit.
    if (stateRef.current.account === "ACC-CREATING") return true
    if (stateRef.current.account !== "ACC-GUEST") return false
    commitEphemeral((current) => ({ ...current, account: "ACC-CREATING" }))
    return true
  }, [commitEphemeral])

  const cancelAccountActivation = useCallback(() => {
    if (stateRef.current.account !== "ACC-CREATING") return
    commitEphemeral((current) => ({ ...current, account: "ACC-GUEST" }))
  }, [commitEphemeral])

  const activateAccount = useCallback(() => {
    if (stateRef.current.account !== "ACC-CREATING") return false
    if (!persistBAccountSession({ account: "ACC-ACTIVE", returnTo: null })) return false
    commitEphemeral((current) => ({ ...current, account: "ACC-ACTIVE", accountReturnTo: null }))
    return true
  }, [commitEphemeral])

  const completeAccountSave = useCallback((): "saved" | "save_failed" | "account_failed" => {
    const current = stateRef.current
    const returnTo = current.accountReturnTo
    if (current.account !== "ACC-CREATING" || !returnTo) return "account_failed"
    let qaSaveFailed = false
    const transaction = commitBAccountSaveTransaction({
      currentState: current,
      returnTo,
      rollbackSession: { account: "ACC-GUEST", returnTo },
      buildNextState: (consumed): OndoBState => consumed.targetKind === "editorial"
        ? {
            ...current,
            savedEditorialPlaceIds: current.savedEditorialPlaceIds.includes(consumed.editorialPlaceId)
              ? current.savedEditorialPlaceIds
              : [...current.savedEditorialPlaceIds, consumed.editorialPlaceId],
          }
        : {
            ...current,
            savedVenueIds: current.savedVenueIds.includes(consumed.venueId)
              ? current.savedVenueIds
              : [...current.savedVenueIds, consumed.venueId],
            saveStatusByVenue: { ...current.saveStatusByVenue, [consumed.venueId]: "SAV-SAVED" },
          },
      persistDevice: persistBDeviceState,
      persistAccount: persistBAccountSession,
      abortBeforePersist: (consumed) => {
        if (consumed.targetKind === "editorial" || readQaScenario() !== "save-failed" || failedSaveQaVenueIdsRef.current.has(consumed.venueId)) return false
        failedSaveQaVenueIdsRef.current.add(consumed.venueId)
        qaSaveFailed = true
        return true
      },
    })
    if (transaction.outcome !== "saved") {
      const consumed = transaction.consumed
      const failed: OndoBState = {
        ...current,
        account: "ACC-GUEST",
        saveStatusByVenue: consumed?.targetKind === "canonical" && (qaSaveFailed || transaction.outcome === "save_failed")
          ? { ...current.saveStatusByVenue, [consumed.venueId]: "SAV-FAILED" }
          : current.saveStatusByVenue,
      }
      stateRef.current = failed
      setState(failed)
      return transaction.outcome
    }

    const completed: OndoBState = {
      ...transaction.nextState,
      account: "ACC-ACTIVE",
      accountReturnTo: null,
    }
    stateRef.current = completed
    setState(completed)
    return "saved"
  }, [])

  const actions = useMemo<OndoBActions>(() => ({
    setLocale: (locale) => {
      const saved = commit((current) => ({ ...current, locale }))
      if (!saved) notify(DEVICE_MESSAGE.locale[stateRef.current.locale])
      return saved
    },
    setAppearancePreference: (preference) => {
      if (preference !== "system" && preference !== "light" && preference !== "dark") return false
      const appearancePreference = sanitizeOndoBAppearancePreference(preference)
      const resolvedAppearance = resolveOndoBAppearance(appearancePreference, browserPrefersDarkAppearance())
      const saved = commit((current) => ({ ...current, appearancePreference, resolvedAppearance }))
      if (!saved) notify(DEVICE_MESSAGE.appearance[stateRef.current.locale])
      return saved
    },
    setTab: (tab) => commitEphemeral((current) => ({
      ...current,
      tab,
      surface: tab === "ondo" ? current.surface : { kind: "map" },
      commerceOrigin: tab === "id" ? current.commerceOrigin : null,
    })),
    setSurface: (surface) => commitEphemeral((current) => ({
      ...current,
      surface: surface.kind === "map" || surface.kind === "labs"
        ? surface
        : surface.kind === "venue" && isCanonicalVenueId(surface.venueId)
          ? surface
          : surface.kind === "editorial_place" && isEditorialPlaceId(surface.editorialPlaceId)
            ? surface
            : { kind: "map" },
    })),
    setPersona: (persona) => {
      const normalized = normalizeOndoBDiscoveryIntent(persona)
      if (!normalized) {
        notify(DEVICE_MESSAGE.persona[stateRef.current.locale])
        return false
      }
      const saved = commit((current) => ({ ...current, persona: normalized }))
      if (!saved) notify(DEVICE_MESSAGE.persona[stateRef.current.locale])
      return saved
    },
    setDiscoveryPreferences: (discoveryPreferences) => {
      const saved = commit((current) => ({ ...current, discoveryPreferences }))
      if (!saved) notify(DEVICE_MESSAGE.choices[stateRef.current.locale])
      return saved
    },
    resetDiscoveryPreferences: () => {
      if (!commit((current) => ({ ...current, discoveryPreferences: [] }))) notify(DEVICE_MESSAGE.clearChoices[stateRef.current.locale])
    },
    beginOnboarding: () => {
      if (stateRef.current.onboarding !== "ONB-IN-PROGRESS") onboardingBeforeSetupRef.current = stateRef.current.onboarding
      // Opening an optional editor must not erase the saved discovery choices.
      commitEphemeral((current) => ({ ...current, onboarding: "ONB-IN-PROGRESS", tab: "ondo", surface: { kind: "map" } }))
    },
    cancelOnboarding: () => {
      const next: OndoBState = {
        ...stateRef.current,
        onboarding: onboardingBeforeSetupRef.current ?? "ONB-NEW",
        tab: "ondo",
        surface: { kind: "map" },
      }
      onboardingBeforeSetupRef.current = null
      // Locale changes made inside setup may have persisted a NEW marker.
      // Restore the previous marker without committing any unconfirmed draft.
      const saved = persistBDeviceState(next)
      stateRef.current = next
      setState(next)
      if (!saved) notify(DEVICE_MESSAGE.guest[next.locale])
      return { ok: true, persisted: saved }
    },
    completeOnboarding: (draft) => {
      const normalized = sanitizeBOnboardingDraft(draft)
      if (!normalized) return { ok: false, reason: "invalid" }
      const next: OndoBState = {
        ...stateRef.current,
        onboarding: "ONB-COMPLETE",
        persona: normalized.intent,
        discoveryArea: normalized.area,
        discoveryPreferences: [...normalized.preferences],
        tab: "ondo",
        surface: { kind: "map" },
      }
      if (!persistBDeviceState(next)) return { ok: false, reason: "storage" }
      onboardingBeforeSetupRef.current = null
      stateRef.current = next
      setState(next)
      return { ok: true, persisted: true }
    },
    skipOnboarding: () => {
      const next: OndoBState = {
        ...stateRef.current,
        onboarding: "ONB-COMPLETE",
        persona: null,
        discoveryArea: null,
        discoveryPreferences: [],
        tab: "ondo",
        surface: { kind: "map" },
      }
      const saved = persistBDeviceState(next)
      stateRef.current = next
      setState(next)
      if (!saved) notify(DEVICE_MESSAGE.guest[next.locale])
      return { ok: true, persisted: saved }
    },
    resetOnboarding: () => {
      const saved = commit((current) => ({
        ...current,
        onboarding: "ONB-NEW",
        persona: null,
        discoveryArea: null,
        discoveryPreferences: [],
        tab: "ondo",
        surface: { kind: "map" },
      }))
      return saved
    },
    beginAccountSave,
    beginEditorialAccountSave,
    cancelAccountSave,
    beginAccountActivation,
    cancelAccountActivation,
    activateAccount,
    completeAccountSave,
    saveVenue: (venueId) => {
      if (stateRef.current.account === "ACC-ACTIVE") persistCanonicalSavedVenue(venueId, false)
      else if (!beginAccountSave(venueId)) notify(DEVICE_MESSAGE.account[stateRef.current.locale])
    },
    toggleSavedVenue: (venueId) => {
      if (stateRef.current.savedVenueIds.includes(venueId)) persistCanonicalSavedVenue(venueId, true)
      else if (stateRef.current.account === "ACC-ACTIVE") persistCanonicalSavedVenue(venueId, true)
      else if (!beginAccountSave(venueId)) notify(DEVICE_MESSAGE.account[stateRef.current.locale])
    },
    toggleSavedEditorialPlace: (editorialPlaceId) => {
      if (!isEditorialPlaceId(editorialPlaceId)) return false
      const saved = stateRef.current.savedEditorialPlaceIds.includes(editorialPlaceId)
      if (!saved && stateRef.current.account !== "ACC-ACTIVE") return beginEditorialAccountSave(editorialPlaceId)
      return commit((current) => ({
        ...current,
        savedEditorialPlaceIds: current.savedEditorialPlaceIds.includes(editorialPlaceId)
          ? current.savedEditorialPlaceIds.filter((id) => id !== editorialPlaceId)
          : [...current.savedEditorialPlaceIds, editorialPlaceId],
      }))
    },
    setPrivateNote: (venueId, note) => {
      if (!isCanonicalVenueId(venueId) || !stateRef.current.savedVenueIds.includes(venueId)) return false
      const normalized = note.trim().slice(0, CANONICAL_PRIVATE_NOTE_MAX_LENGTH)
      return commit((current) => {
        const privateNotesByVenue = { ...current.privateNotesByVenue }
        if (normalized) privateNotesByVenue[venueId] = normalized
        else delete privateNotesByVenue[venueId]
        return { ...current, privateNotesByVenue }
      })
    },
    openLocalSignal: (venueId) => {
      if (!isCanonicalVenueId(venueId)) return
      commitEphemeral((current) => ({
        ...current,
        localSignalDraft: current.localSignalDraft?.venueId === venueId
          ? current.localSignalDraft
          : { venueId, tags: [], note: "" },
      }))
    },
    updateLocalSignalDraft: ({ tags, note }) => {
      commitEphemeral((current) => current.localSignalDraft ? {
        ...current,
        localSignalDraft: {
          ...current.localSignalDraft,
          tags: [...new Set(tags.filter((tag): tag is OndoBLocalSignalTag => B_LOCAL_SIGNAL_TAGS.has(tag)))],
          note: note.slice(0, B_LOCAL_SIGNAL_NOTE_MAX_LENGTH),
        },
      } : current)
    },
    closeLocalSignal: () => commitEphemeral((current) => ({ ...current, localSignalDraft: null })),
    recordRecentVenue: (venueId) => {
      if (!isCanonicalVenueId(venueId)) return false
      return commit((current) => ({ ...current, recentVenueIds: recordRecentVenue(current.recentVenueIds, venueId) }))
    },
    recordRecentEditorialPlace: (editorialPlaceId) => {
      if (!isEditorialPlaceId(editorialPlaceId)) return false
      return commit((current) => ({
        ...current,
        recentEditorialPlaceIds: [editorialPlaceId, ...current.recentEditorialPlaceIds.filter((id) => id !== editorialPlaceId)].slice(0, 8),
      }))
    },
    recordPlannedTable: (tableId, venueId) => {
      const nextRefs = recordPlannedTable(stateRef.current.plannedTableRefs, tableId, venueId)
      if (!nextRefs.some((item) => item.tableId === tableId && item.venueId === venueId)) return false
      return commit((current) => ({ ...current, plannedTableRefs: recordPlannedTable(current.plannedTableRefs, tableId, venueId) }))
    },
    removePlannedTable: (tableId) => commit((current) => ({ ...current, plannedTableRefs: removePlannedTable(current.plannedTableRefs, tableId) })),
    markLocalSignalPosted: (venueId) => {
      if (!isCanonicalVenueId(venueId)) return false
      const draft = stateRef.current.localSignalDraft
      if (!draft || draft.venueId !== venueId) return false
      const safeTags = [...new Set(draft.tags.filter((tag): tag is OndoBLocalSignalTag => B_LOCAL_SIGNAL_TAGS.has(tag)))]
      if (!safeTags.length) return false
      const postedAt = new Date().toISOString()
      return commit((current) => {
        const nextLocalSignalPostedVenueIds = sanitizeLocalSignalVenueIds([venueId, ...current.localSignalPostedVenueIds.filter((id) => id !== venueId)])
        const candidateLocalPulseEvidenceByVenue = {
          ...current.localPulseEvidenceByVenue,
          [venueId]: { tags: safeTags, postedAt },
        }
        const nextLocalPulseEvidenceByVenue = Object.fromEntries(nextLocalSignalPostedVenueIds
          .filter((id) => candidateLocalPulseEvidenceByVenue[id])
          .map((id) => [id, candidateLocalPulseEvidenceByVenue[id]]))
        return {
          ...current,
          localSignalPostedVenueIds: nextLocalSignalPostedVenueIds,
          localPulseEvidenceByVenue: nextLocalPulseEvidenceByVenue,
        }
      })
    },
    acknowledgeLocalInteractionBoundary: () => commit((current) => ({ ...current, localInteractionBoundarySeen: true })),
    openIdentitySetup: (identitySetupOrigin) => commitEphemeral((current) => ({ ...current, identitySetupOrigin })),
    closeIdentitySetup: () => commitEphemeral((current) => ({ ...current, identitySetupOrigin: null })),
    completeIdentitySetup: (method, options) => {
      if (options?.sampleRecovery && !qaReviewFixtureOptions().allowReviewFixture) return false
      if (options?.issuanceScope === "person") {
        // Recheck the exact live receipt at the actual state mutation boundary.
        // A serialized receipt, prior pass or standalone flag cannot issue it.
        if (options.sampleRecovery || method !== "mobile_id" || !options.experiencePersonHandoff
          || stateRef.current.identityCredential || stateRef.current.identitySetupOrigin !== "action_gate") return false
        try {
          if (!isBExperiencePersonHandoffCurrent(window.sessionStorage, options.experiencePersonHandoff, new Date(), qaReviewFixtureOptions())) return false
        } catch { return false }
      }
      const recovered = options?.sampleRecovery ? recoverSimulatedCredentialB(stateRef.current.identityCredential) : null
      if (options?.sampleRecovery && (!recovered || recovered.method !== method)) return false
      commitEphemeral((current) => ({
      ...current,
      identityCredential: options?.issuanceScope === "person" ? createPersonOnlySimulatedCredentialB() : recovered ?? createSimulatedCredentialB(method, Date.now(), current.identityDemoScenario),
      // A protected action must observe credential issuance and setup closure
      // as one mounted-session transition. Publishing them separately lets the
      // coordinator render the still-missing credential between updates and
      // reopen a second setup layer over the presentation decision.
      identitySetupOrigin: current.identitySetupOrigin === "action_gate"
        ? null
        : current.identitySetupOrigin,
      }))
      return true
    },
    completeAgeProof: (execution) => {
      const options = qaReviewFixtureOptions()
      const now = new Date()
      const credential = completeKPassDemoAgeProofB(stateRef.current.identityCredential, execution, options, now.getTime())
      if (!credential) return false
      try {
        const previous = restoreBActionGateSession(window.sessionStorage, now, options)
        // Keep each existing axis and the pending action. Only an approval for
        // the old credential revision is invalidated here; the age flow owns
        // its separate, consented age receipt.
        const next = { ...previous, presentation: null }
        if (!persistBActionGateSession(window.sessionStorage, next, now, options)) return false
        commitEphemeral((current) => ({ ...current, identityCredential: credential }))
        window.dispatchEvent(new CustomEvent(B_ACTION_AXIS_SESSION_EVENT, { detail: next }))
        return true
      } catch { return false }
    },
    setIdentityDemoScenario: (scenario) => {
      if (!qaReviewFixtureOptions().allowReviewFixture || (scenario !== "guest" && !isKPassScenario(scenario))) return false
      // Changing a prepared persona never carries another persona's proof or
      // payment-KYC receipt forward. Preserve the unfinished action itself.
      try {
        const options = qaReviewFixtureOptions()
        const previousActionRaw = window.sessionStorage.getItem(B_ACTION_GATE_SESSION_KEY)
        const previousAgeRaw = window.sessionStorage.getItem(GLOBAL_AFTER19_SESSION_KEY)
        const previous = restoreBActionGateSession(window.sessionStorage, new Date(), options)
        const next = { ...previous, person: { status: "unverified" as const, expiresAt: null }, payment: { status: "unverified" as const, expiresAt: null }, presentation: null }
        // Clear the age receipt before publishing another persona, verifying
        // both writes. A failed reset keeps the old persona and restores the
        // old storage snapshot where possible; consumers resync either way.
        if (!removeStorageValueWithReadback(window.sessionStorage, GLOBAL_AFTER19_SESSION_KEY)
          || !persistBActionGateSession(window.sessionStorage, next, new Date(), options)) {
          restoreStorageValue(window.sessionStorage, B_ACTION_GATE_SESSION_KEY, previousActionRaw)
          restoreStorageValue(window.sessionStorage, GLOBAL_AFTER19_SESSION_KEY, previousAgeRaw)
          window.dispatchEvent(new Event(B_ACTION_AXIS_SESSION_EVENT))
          window.dispatchEvent(new Event(GLOBAL_AFTER19_SESSION_EVENT))
          return false
        }
        clearGuestAfter19MemoryB()
        commitEphemeral((current) => ({ ...current, identityDemoScenario: scenario === "guest" ? "adult_visitor" : scenario, identityCredential: scenario === "guest" ? null : createSimulatedCredentialB(current.identityCredential?.method ?? "passport_ekyc", Date.now(), scenario) }))
        window.dispatchEvent(new CustomEvent(B_ACTION_AXIS_SESSION_EVENT, { detail: next }))
        window.dispatchEvent(new Event(GLOBAL_AFTER19_SESSION_EVENT))
        return true
      } catch { return false }
    },
    acknowledgeCommerceLocalBoundary: () => commit((current) => ({ ...current, commerceLocalBoundarySeen: true })),
    setCommerceWalletStatus: (commerceWalletStatus) => commitEphemeral((current) => ({ ...current, commerceWalletStatus })),
    setCommerceFundingSource: (commerceFundingSource) => B_COMMERCE_FUNDING_SOURCES.has(commerceFundingSource)
      ? commit((current) => ({ ...current, commerceFundingSource }))
      : false,
    creditSampleFunding: (execution) => {
      const current = stateRef.current
      const commerceSession = creditStableCommerceFundingB(current.commerceSession, execution, qaReviewFixtureOptions())
      if (!commerceSession) return false
      if (commerceSession === current.commerceSession) return true
      // Funding includes creating the sample wallet, never identity or KYC.
      // Like other demo balances, this is confined to the mounted session.
      commitEphemeral(value => ({ ...value, commerceSession, commerceWalletStatus: "ready", commerceFundingSource: "travel_balance" }))
      return true
    },
    dispatchCommerce: (action) => {
      const current = stateRef.current
      const advanced = ["AUTHORIZE_PAYMENT", "PAYMENT_STATUS", "CAPTURE_REQUEST", "CAPTURE_RESULT", "VOID_AUTHORIZATION", "REFUND_REQUEST", "REFUND_RETRY", "REFUND_RESULT"].includes(action.type)
      if (advanced && !qaReviewFixtureOptions().allowReviewFixture) return false
      if (action.type === "AUTHORIZE_PAYMENT" || action.type === "PAYMENT_STATUS" || action.type === "CAPTURE_RESULT") {
        const operation = current.commerceSession.paymentOperation
        const quote = current.commerceSession.lockedQuote
        const stage = action.type === "AUTHORIZE_PAYMENT" ? "authorization" : action.type === "PAYMENT_STATUS" ? operation?.unknownStage : "capture"
        if (!quote || !stage || !isCommerceSampleResponseB(action.execution, { operationId: stableCommerceOrderB(current.commerceSession).operationId, stage, outcome: action.outcome, amountKrw: quote.finalDebit * 1_000 })) return false
      }
      if (action.type === "REFUND_RESULT") {
        const operation = current.commerceSession.refundOperations?.find(item => item.operationId === action.operationId)
        if (!operation || !isCommerceSampleResponseB(action.execution, { operationId: action.operationId, stage: "refund", outcome: action.outcome, amountKrw: operation.amountKrw })) return false
        if ((operation.phase === "settled" && action.outcome === "success") || (operation.phase === "failed" && action.outcome === "failure")) return true
      }
      if ((action.type === "AUTHORIZE_PAYMENT" || (action.type === "PAYMENT_STATUS" && current.commerceSession.paymentOperation?.unknownStage === "authorization")) && action.outcome === "success") {
        const checkedAt = new Date()
        let payment
        try { payment = restoreBActionGateSession(window.sessionStorage, checkedAt, qaReviewFixtureOptions()).payment } catch { return false }
        const paymentKyc = payment.status === "eligible" && Boolean(payment.expiresAt && Date.parse(payment.expiresAt) > checkedAt.getTime())
        const quote = current.commerceSession.lockedQuote
        if (!paymentKyc || !quote || (current.identityCredential && (evaluateKPassService(current.identityCredential, { service: "payment", amountKrw: quote.finalDebit * 1_000, paymentKyc, now: checkedAt.getTime() }).status !== "allowed"
          || (quote.benefitMode === "ktour" && evaluateKPassService(current.identityCredential, { service: "visitor_benefit", now: checkedAt.getTime() }).status !== "allowed")))) return false
      }
      let commerceSession = stableCommerceBReducer(current.commerceSession, action)
      if (advanced && commerceSession === current.commerceSession) return false
      const paidNow = action.type === "PAYMENT_RETURN" && action.outcome === "success" && current.commerceSession.status !== "paid" && commerceSession.status === "paid"
      const refundDeltaKrw = stableCommerceRefundedKrwB(commerceSession) - stableCommerceRefundedKrwB(current.commerceSession)
      const refundedNow = current.commerceSession.status === "paid" && commerceSession.status === "refunded"
      const order = stableCommerceOrderB(commerceSession)
      let identityCredential = current.identityCredential
      if (paidNow && identityCredential) {
        const checkedAt = new Date()
        let payment
        try { payment = restoreBActionGateSession(window.sessionStorage, checkedAt, qaReviewFixtureOptions()).payment }
        catch { return false }
        if (evaluateKPassService(identityCredential, { service: "payment", amountKrw: commerceSession.chargedDebit * 1_000, paymentKyc: payment.status === "eligible" && Boolean(payment.expiresAt && Date.parse(payment.expiresAt) > checkedAt.getTime()), now: checkedAt.getTime() }).status !== "allowed") return false
        if (commerceSession.voucherApplied && evaluateKPassService(identityCredential, { service: "visitor_benefit", now: checkedAt.getTime() }).status !== "allowed") return false
        identityCredential = { ...identityCredential, claims: { ...identityCredential.claims, paymentSpentKrw: identityCredential.claims.paymentSpentKrw + commerceSession.chargedDebit * 1_000, visitorBenefit: { ...identityCredential.claims.visitorBenefit, status: commerceSession.voucherApplied ? "used" : identityCredential.claims.visitorBenefit.status } } }
      }
      if (paidNow && commerceSession.voucherApplied && !identityCredential) return false
      if (refundDeltaKrw > 0) identityCredential = restoreKPassDemoRefundClaims(identityCredential, order.credentialId ?? current.commerceReceiptCredentialId, refundDeltaKrw, refundedNow && commerceSession.voucherApplied)
      if (paidNow) commerceSession = { ...commerceSession, order: { ...order, credentialId: current.identityCredential?.credentialId ?? null } }
      const venueId = order.venueId
      const commerceReceipts = venueId && (paidNow || refundDeltaKrw > 0)
        ? sanitizeCommerceReceipts([{
            executionTruth: "FIXTURE_REVIEW",
            provenanceTruth: REVIEW_PROVENANCE_TRUTH,
            orderId: order.orderId,
            receiptId: order.receiptId,
            refundReceiptId: commerceSession.refundOperations?.filter(item => item.phase === "settled").at(-1)?.receiptId ?? null,
            refundedKrw: stableCommerceRefundedKrwB(commerceSession),
            offerId: order.offerId,
            venueId,
            status: refundedNow ? "refunded" : "paid",
            paidOOKRW: commerceSession.chargedDebit,
            benefitOOKRW: commerceSession.voucherApplied ? order.benefitKrw / 1_000 : 0,
            balanceOOKRW: stableCommerceBalanceB(commerceSession),
          }, ...current.commerceReceipts])
        : current.commerceReceipts
      const next = {
        ...current,
        commerceSession,
        identityCredential,
        commerceReceiptCredentialId: paidNow ? current.identityCredential?.credentialId ?? null : current.commerceReceiptCredentialId,
        commerceReceiptVenueId: venueId,
        commerceReceipts,
      }
      if ((paidNow || refundDeltaKrw > 0) && !persistBDeviceState(next)) return false
      stateRef.current = next
      setState(next)
      return true
    },
    recordCommerceReceipt: (receipt) => commit((current) => ({ ...current, commerceReceipts: sanitizeCommerceReceipts([receipt, ...current.commerceReceipts]) })),
    selectCommerceOrder: (orderId) => {
      const current = stateRef.current
      const commerceSession = selectStableCommerceOrderB(current.commerceSession, orderId)
      if (!commerceSession) return false
      const order = stableCommerceOrderB(commerceSession)
      commitEphemeral(value => ({ ...value, commerceSession, commerceReceiptVenueId: order.venueId, commerceReceiptCredentialId: order.credentialId ?? null }))
      return true
    },
    openMealBenefitFromPlace: (venueId, options = {}) => {
      const place = resolveCommercePlaceB(venueId)
      if (!place?.commerce) return false
      const current = stateRef.current
      const existing = stableCommerceOrdersB(current.commerceSession).findLast(item => stableCommerceOrderB(item).venueId === venueId && (!options.orderId || stableCommerceOrderB(item).orderId === options.orderId))
      if (options.orderId && !existing) return false
      const legacyFirst = !current.commerceSession.order && !current.commerceSession.orders?.length && current.commerceSession.status === "idle" && venueId === STABLE_B_OFFER_VENUE_ID
      const orderId = options.orderId ?? (!options.newOrder && existing ? stableCommerceOrderB(existing).orderId : legacyFirst ? STABLE_B_PAYMENT_OPERATION_ID : `sample-order:${crypto.randomUUID()}`)
      const order: CommerceOrderContextB = !options.newOrder && existing ? stableCommerceOrderB(existing) : {
        orderId, venueId, offerId: place.commerce.offerId, grossKrw: place.commerce.grossKrw, benefitKrw: place.commerce.benefitKrw,
        operationId: orderId, receiptId: orderId === STABLE_B_PAYMENT_OPERATION_ID ? STABLE_B_RECEIPT_ID : `${orderId}:receipt`,
      }
      const opened = openStableCommerceOrderB(current.commerceSession, order)
      if (!opened) {
        notify(current.locale === "ko" ? "진행 중인 결제를 먼저 확인해 주세요." : current.locale === "ja" ? "進行中の決済を先に確認してください。" : "Check the pending payment first.")
        return false
      }
      const commerceSession = { ...opened, order }
      commitEphemeral((current) => ({
        ...current,
        tab: "id",
        surface: { kind: "map" },
        commerceOrigin: { kind: place.originKind === "canonical" ? "canonical_place" : place.originKind === "editorial" ? "editorial_place" : "research_place", venueId },
        commerceSession,
        commerceReceiptVenueId: commerceSession.status === "idle" ? null : venueId,
        commerceReceiptCredentialId: order.credentialId ?? null,
      }))
      return true
    },
    returnFromCommerceOrigin: () => {
      const origin = stateRef.current.commerceOrigin
      if (!origin || !resolveCommercePlaceB(origin.venueId)) return false
      commitEphemeral((current) => ({
        ...current,
        tab: "ondo",
        surface: origin.kind === "canonical_place" ? { kind: "venue", venueId: origin.venueId } : { kind: "map" },
        commerceOrigin: null,
      }))
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          requestPlaceServiceReturnB(origin.venueId, "offer")
          document.querySelector<HTMLElement>("[data-testid='canonical-meal-benefit-open']")?.focus({ preventScroll: true })
        })
      })
      return true
    },
    clearBDeviceContent: () => {
      let previous: {
        device: string | null
        placeMemories: string | null
        labs: string | null
        account: string | null
        actionGate: string | null
        after19Preference: string | null
        after19Session: string | null
        activityProfile: string | null
        tableActivity: string | null
        fundingRail: string | null
        reservation: string | null
        accountServices: string | null
        placeAfter19Return: string | null
        legacyPlaceReturnUi: string | null
      }
      try {
        previous = {
          device: window.localStorage.getItem(B_DEVICE_KEY),
          placeMemories: window.localStorage.getItem(B_PLACE_MEMORY_KEY),
          labs: window.sessionStorage.getItem("ondo-b.labs.v1"),
          account: window.sessionStorage.getItem(B_ACCOUNT_SESSION_KEY),
          actionGate: window.sessionStorage.getItem(B_ACTION_GATE_SESSION_KEY),
          after19Preference: window.localStorage.getItem(GLOBAL_AFTER19_PREFERENCE_KEY),
          after19Session: window.sessionStorage.getItem(GLOBAL_AFTER19_SESSION_KEY),
          activityProfile: window.sessionStorage.getItem(B_ACTIVITY_PROFILE_SESSION_KEY),
          tableActivity: window.sessionStorage.getItem(B_TABLE_ACTIVITY_SESSION_KEY),
          fundingRail: window.sessionStorage.getItem(FUNDING_RAIL_SESSION_KEY_B),
          reservation: window.sessionStorage.getItem(RESERVATION_SAMPLE_KEY),
          accountServices: window.sessionStorage.getItem(ACCOUNT_SERVICES_SAMPLE_KEY_B),
          placeAfter19Return: window.sessionStorage.getItem(PLACE_AFTER19_RETURN_SESSION_KEY),
          legacyPlaceReturnUi: window.sessionStorage.getItem(PLACE_RETURN_UI_SNAPSHOT_SESSION_KEY),
        }
      } catch {
        return { ok: false, outcome: "storage_failed", rollback: "complete" }
      }
      const restorePrevious = () => {
        let restored = true
        const restoreValue = (storage: Storage, key: string, value: string | null) => {
          if (!restoreStorageValue(storage, key, value)) restored = false
        }
        restoreValue(window.localStorage, B_DEVICE_KEY, previous.device)
        restoreValue(window.localStorage, B_PLACE_MEMORY_KEY, previous.placeMemories)
        restoreValue(window.sessionStorage, "ondo-b.labs.v1", previous.labs)
        restoreValue(window.sessionStorage, B_ACCOUNT_SESSION_KEY, previous.account)
        restoreValue(window.sessionStorage, B_ACTION_GATE_SESSION_KEY, previous.actionGate)
        restoreValue(window.localStorage, GLOBAL_AFTER19_PREFERENCE_KEY, previous.after19Preference)
        restoreValue(window.sessionStorage, GLOBAL_AFTER19_SESSION_KEY, previous.after19Session)
        restoreValue(window.sessionStorage, B_ACTIVITY_PROFILE_SESSION_KEY, previous.activityProfile)
        restoreValue(window.sessionStorage, B_TABLE_ACTIVITY_SESSION_KEY, previous.tableActivity)
        restoreValue(window.sessionStorage, FUNDING_RAIL_SESSION_KEY_B, previous.fundingRail)
        restoreValue(window.sessionStorage, RESERVATION_SAMPLE_KEY, previous.reservation)
        restoreValue(window.sessionStorage, ACCOUNT_SERVICES_SAMPLE_KEY_B, previous.accountServices)
        restoreValue(window.sessionStorage, PLACE_AFTER19_RETURN_SESSION_KEY, previous.placeAfter19Return)
        restoreValue(window.sessionStorage, PLACE_RETURN_UI_SNAPSHOT_SESSION_KEY, previous.legacyPlaceReturnUi)
        return restored
      }
      const tombstonesWritten = writeStorageValueWithReadback(window.sessionStorage, B_ACTION_GATE_SESSION_KEY, JSON.stringify(DEFAULT_B_ACTION_GATE_SESSION))
        && writeStorageValueWithReadback(window.sessionStorage, B_ACCOUNT_SESSION_KEY, JSON.stringify({ account: "ACC-GUEST", returnTo: null } satisfies BAccountSessionState))
        && writeStorageValueWithReadback(window.localStorage, GLOBAL_AFTER19_PREFERENCE_KEY, JSON.stringify(DEFAULT_GLOBAL_AFTER19_PREFERENCE))
        && writeStorageValueWithReadback(window.sessionStorage, GLOBAL_AFTER19_SESSION_KEY, JSON.stringify(DEFAULT_GLOBAL_AFTER19_SESSION))
        && writeStorageValueWithReadback(window.sessionStorage, B_ACTIVITY_PROFILE_SESSION_KEY, JSON.stringify(restoreBActivityProfile(null)))
        && writeStorageValueWithReadback(window.sessionStorage, B_TABLE_ACTIVITY_SESSION_KEY, JSON.stringify({ version: 1, byTableId: {} }))
        && writeStorageValueWithReadback(window.sessionStorage, PLACE_AFTER19_RETURN_SESSION_KEY, JSON.stringify(DEFAULT_PLACE_AFTER19_RETURN_SESSION))
      // The only destructive session mutation is last, after every tombstone
      // write has been verified, so a failed clear can restore the snapshot.
      const removedLegacySession = tombstonesWritten
        && removeStorageValueWithReadback(window.localStorage, B_PLACE_MEMORY_KEY)
        && removeStorageValueWithReadback(window.sessionStorage, FUNDING_RAIL_SESSION_KEY_B)
        && removeStorageValueWithReadback(window.sessionStorage, RESERVATION_SAMPLE_KEY)
        && removeStorageValueWithReadback(window.sessionStorage, ACCOUNT_SERVICES_SAMPLE_KEY_B)
        && removeStorageValueWithReadback(window.sessionStorage, PLACE_RETURN_UI_SNAPSHOT_SESSION_KEY)
        && removeStorageValueWithReadback(window.sessionStorage, "ondo-b.labs.v1")
      if (!removedLegacySession) {
        const restored = restorePrevious()
        return { ok: false, outcome: "storage_failed", rollback: restored ? "complete" : "incomplete" }
      }
      const cleared = commit((current) => ({
        ...current,
        account: "ACC-GUEST",
        accountReturnTo: null,
        accountSaveTransaction: null,
        accountSaveRecoveryBlocked: false,
        discoveryPreferences: [],
        savedVenueIds: [],
        savedEditorialPlaceIds: [],
        saveStatusByVenue: {},
        privateNotesByVenue: {},
        recentVenueIds: [],
        recentEditorialPlaceIds: [],
        plannedTableRefs: [],
        localSignalPostedVenueIds: [],
        localPulseEvidenceByVenue: {},
        localInteractionBoundarySeen: false,
        identitySetupOrigin: null,
        identityCredential: null,
        commerceLocalBoundarySeen: false,
        commerceOrigin: null,
        commerceWalletStatus: "disconnected",
        commerceFundingSource: "travel_balance",
        commerceSession: createStableCommerceBState(),
        commerceReceiptVenueId: null,
        commerceReceipts: [],
        localSignalDraft: null,
        surface: { kind: "map" },
      }))
      if (!cleared) {
        // Device content was not committed, so restore every session/local
        // value captured before the clear transaction.
        const restored = restorePrevious()
        return { ok: false, outcome: "storage_failed", rollback: restored ? "complete" : "incomplete" }
      } else {
        forgetBActionGateRuntimeAuthorityAfterReset(window.sessionStorage)
        clearGuestAfter19MemoryB()
        clearAllPrivateNoteDraftMemory()
        window.dispatchEvent(new Event("ondo:b:place-memories"))
        window.dispatchEvent(new CustomEvent(B_ACTION_AXIS_SESSION_EVENT, { detail: DEFAULT_B_ACTION_GATE_SESSION }))
        window.dispatchEvent(new CustomEvent(GLOBAL_AFTER19_SESSION_EVENT, { detail: DEFAULT_GLOBAL_AFTER19_SESSION }))
        window.dispatchEvent(new CustomEvent(B_ACTIVITY_PROFILE_CLEAR_EVENT))
        window.dispatchEvent(new CustomEvent(B_TABLE_ACTIVITY_CLEAR_EVENT))
      }
      return { ok: true, outcome: "cleared" }
    },
    notify,
    discardToast,
  }), [activateAccount, beginAccountActivation, beginAccountSave, beginEditorialAccountSave, cancelAccountActivation, cancelAccountSave, commit, commitEphemeral, completeAccountSave, discardToast, notify, persistCanonicalSavedVenue])

  const value = useMemo(() => ({ state, actions }), [actions, state])
  return <OndoBContext.Provider value={value}>{children}</OndoBContext.Provider>
}

export function useOndoB() {
  const value = useContext(OndoBContext)
  if (!value) throw new Error("useOndoB must be used inside OndoBProvider")
  return value
}
