import { isCanonicalVenueId } from "@/lib/ondo/venues/canonical-allowlist"
import { resolveCommercePlaceB } from "../commerce-b/place-service-registry-b"
import type { OndoBLocalSignalTag } from "../shared/state/ondo-b-provider"
import { isOndoBTableVenuePair, ondoBTablePolicyById } from "../connect/table-policy-b"
import {
  createStableCommerceBLockedQuoteFromMode,
  isStableCommerceBLockedQuote,
  sameStableCommerceBLockedQuote,
  STABLE_B_OFFER_VENUE_ID,
  type StableCommerceBLockedQuote,
} from "../commerce-b/stable-commerce-model-b"
import {
  createDeterministicReturnToToken,
  hasExactOwnKeys,
  hashReturnToSnapshot,
  type CanonicalSnapshotValue,
  type ReturnToSnapshotHash,
} from "../contracts/return-to-integrity"
import { isLiveReviewFixtureExecution, type FixtureId, type ReviewFixtureExecution } from "../contracts/execution-mode"
import { evaluateKPassService, isKPassPresentationBinding, sameKPassPresentationBinding, type KPassDemoCredential, type KPassPresentationBinding } from "../contracts/kpass-capabilities"
import type { OndoBPresentationRequest, OndoBPresentationResolution } from "./ktour-id-setup-model-b"
import { EXPERIENCE_CAMPAIGN_ID_B, EXPERIENCE_PLACE_ID_B } from "../experience-b/experience-model-b"
import { clearJitAuthorizations, forgetJitAuthorization, hasJitConsumedReceipt } from "./jit-identity-authority-b"

export const B_ACTION_GATE_TTL_MS = 15 * 60 * 1000
export const B_ACTION_AXIS_TTL_MS = 60 * 60 * 1000
export const B_ACTION_GATE_SESSION_KEY = "ondo-b.action-gates.v1"
export const B_ACTION_GATE_REQUEST_EVENT = "ondo:b:action-gate-request"
export const B_ACTION_GATE_READY_EVENT = "ondo:b:action-gate-ready"
export const B_ACTION_GATE_COMPLETE_EVENT = "ondo:b:action-gate-complete"
export const B_ACTION_GATE_CANCEL_EVENT = "ondo:b:action-gate-cancel"
export const B_ACTION_AXIS_SESSION_EVENT = "ondo:b:action-axis-session"

export type BActionGateKind = "account" | "person" | "age" | "payment_kyc"
export type BActionGateCta = "JOIN_TABLE" | "SUBMIT_LOCAL_SIGNAL" | "START_CHECKOUT" | "MINT_BADGE" | "REDEEM_DEMO_ENTITLEMENT"
export type BPersonRouteB = "mobile_id_cx" | "mobile_residence_card" | "passport_ekyc"

type BActionReturnBase = {
  version: 1
  tokenId: string
  gatePlan: readonly BActionGateKind[]
  createdAt: string
  expiresAt: string
  consumedAt: string | null
}

export type BTableActionReturn = BActionReturnBase & {
  cta: "JOIN_TABLE"
  tableId: string
  venueId: string
}

export type BLocalSignalActionReturn = BActionReturnBase & {
  cta: "SUBMIT_LOCAL_SIGNAL"
  venueId: string
}

export type BCheckoutActionReturn = BActionReturnBase & {
  cta: "START_CHECKOUT"
  venueId: string
}

export type BBadgeActionReturn = BActionReturnBase & {
  cta: "MINT_BADGE"
}

export type BExperienceActionReturn = BActionReturnBase & {
  cta: "REDEEM_DEMO_ENTITLEMENT"; venueId: typeof EXPERIENCE_PLACE_ID_B
  campaignId: typeof EXPERIENCE_CAMPAIGN_ID_B; intentId: string
}
export type BActionReturnTo = BTableActionReturn | BLocalSignalActionReturn | BCheckoutActionReturn | BBadgeActionReturn | BExperienceActionReturn

const TABLE_ID = /^table-[a-z0-9-]{1,80}$/
const DRAFT_NONCE = /^[a-z0-9:-]{1,180}$/i
const RETURN_TO_SNAPSHOT_HASH = /^RT-HASH-[a-f0-9]{16}$/
const LOCAL_SIGNAL_TAGS = new Set<OndoBLocalSignalTag>(["calm_now", "lively_now", "quick_stop", "welcoming"])

export type BTablePrivateActionContext = { cta: "JOIN_TABLE"; draft: string }
export type BLocalSignalPrivateActionContext = {
  cta: "SUBMIT_LOCAL_SIGNAL"
  draftNonce: string
  tags: OndoBLocalSignalTag[]
  note: string
  /** Ephemeral object URL used only to keep the draft visually anchored. */
  photoPreviewUrl: string | null
}
export type BCheckoutPrivateActionContext = { cta: "START_CHECKOUT"; quote: StableCommerceBLockedQuote }
export type BExperiencePrivateActionContext = { cta: "REDEEM_DEMO_ENTITLEMENT"; intentId: string; campaignId: typeof EXPERIENCE_CAMPAIGN_ID_B }
export type BActionPrivateContext = BTablePrivateActionContext | BLocalSignalPrivateActionContext | BCheckoutPrivateActionContext | BExperiencePrivateActionContext

// Drafts live only for the lifetime of this mounted JS context. The persisted
// envelope contains an opaque token plus allowlisted public entity ids; a page
// reload intentionally cannot reconstruct private text or Local Signal tags.
type BPrivateActionRecord = Readonly<{
  snapshotHash: ReturnToSnapshotHash
  context: BActionPrivateContext
}>
const privateActionContextByToken = new Map<string, BPrivateActionRecord>()
// A consumed action whose terminal journal could not be made durable must not
// invoke a product callback again in this mounted runtime. The normal recovery
// path removes this key only after the exact pending action is verified by
// readback, which means every retry starts with a fresh consume.
const blockedFinalizationAttempts = new Set<string>()

function samePrivateActionContext(left: BActionPrivateContext, right: BActionPrivateContext) {
  if (left.cta !== right.cta) return false
  if (left.cta === "REDEEM_DEMO_ENTITLEMENT" && right.cta === "REDEEM_DEMO_ENTITLEMENT") return left.intentId === right.intentId && left.campaignId === right.campaignId
  if (left.cta === "JOIN_TABLE" && right.cta === "JOIN_TABLE") return left.draft === right.draft
  if (left.cta === "SUBMIT_LOCAL_SIGNAL" && right.cta === "SUBMIT_LOCAL_SIGNAL") {
    return left.draftNonce === right.draftNonce
      && left.note === right.note
      && left.photoPreviewUrl === right.photoPreviewUrl
      && left.tags.length === right.tags.length
      && left.tags.every((tag, index) => tag === right.tags[index])
  }
  return left.cta === "START_CHECKOUT" && right.cta === "START_CHECKOUT"
    && sameStableCommerceBLockedQuote(left.quote, right.quote)
}

function privateBindingHash(value: BActionReturnTo): ReturnToSnapshotHash | null {
  return hashBActionReturnTo(value.consumedAt === null ? value : { ...value, consumedAt: null })
}

function rememberPrivateActionContext(value: BActionReturnTo, context: BActionPrivateContext) {
  const snapshotHash = privateBindingHash(value)
  if (!snapshotHash) return false
  const existing = privateActionContextByToken.get(value.tokenId)
  if (existing) return existing.snapshotHash === snapshotHash && samePrivateActionContext(existing.context, context)
  privateActionContextByToken.set(value.tokenId, { snapshotHash, context })
  return true
}

function forgetPrivateActionContext(tokenId: string) {
  privateActionContextByToken.delete(tokenId)
  presentationRequestByToken.delete(tokenId)
  presentationApprovalExpectationByToken.delete(tokenId)
}

/**
 * Retire the process-only authority created for an action that was never
 * accepted by the session journal. The full public envelope is required so a
 * stale/replayed token can never erase another action's private context.
 */
export function discardUnrequestedBActionPrivateContext(expected: BActionReturnTo) {
  if (expected.consumedAt !== null) return false
  const expectedHash = privateBindingHash(expected)
  const record = privateActionContextByToken.get(expected.tokenId)
  if (!expectedHash || !record || record.snapshotHash !== expectedHash || record.context.cta !== expected.cta) return false
  forgetPrivateActionContext(expected.tokenId)
  return true
}

export function privateContextForBAction(value: BActionReturnTo): BActionPrivateContext | null {
  const record = privateActionContextByToken.get(value.tokenId)
  const snapshotHash = privateBindingHash(value)
  const context = record?.context
  if (!record || !snapshotHash || record.snapshotHash !== snapshotHash || !context || context.cta !== value.cta) return null
  if (context.cta === "SUBMIT_LOCAL_SIGNAL") return { ...context, tags: [...context.tags] }
  if (context.cta === "START_CHECKOUT") return { ...context, quote: { ...context.quote } }
  return { ...context }
}

export function hasRequiredPrivateContextForBAction(value: BActionReturnTo) {
  return value.cta === "MINT_BADGE" || privateContextForBAction(value) !== null
}

export function gatePlanForBAction(
  cta: BActionGateCta,
  context?: { tableId?: unknown },
): readonly BActionGateKind[] {
  if (cta === "JOIN_TABLE") {
    const table = ondoBTablePolicyById(context?.tableId)
    // Callers that have not supplied a registered Table must not receive a
    // permissive fallback plan. Hydration rejects that envelope outright; the
    // maximum canonical Table plan keeps any pre-validation caller fail-safe.
    if (!table) return ["account", "person", "age"]
    return [
      "account",
      ...(table.requiresPerson ? ["person" as const] : []),
      ...(table.alcohol ? ["age" as const] : []),
    ]
  }
  if (cta === "SUBMIT_LOCAL_SIGNAL") return ["account", "person"]
  if (cta === "REDEEM_DEMO_ENTITLEMENT") return ["account", "person"]
  if (cta === "START_CHECKOUT") return ["account", "payment_kyc"]
  return ["person"]
}

/** A contextual K-Tour presentation is an adjacent action step, not a gate. */
export function requiresBActionPresentation(value: BActionReturnTo) {
  if (value.cta === "REDEEM_DEMO_ENTITLEMENT") return true
  if (value.cta === "JOIN_TABLE") return ondoBTablePolicyById(value.tableId)?.requiresKTourPresentation === true
  const context = privateContextForBAction(value)
  return value.cta === "START_CHECKOUT" && context?.cta === "START_CHECKOUT" && context.quote.benefitMode === "ktour"
}

export function bActionPresentationPurpose(value: BActionReturnTo) {
  return value.cta === "REDEEM_DEMO_ENTITLEMENT" ? "person" as const : "visitor_benefit" as const
}

function base(cta: BActionGateCta, gatePlan: readonly BActionGateKind[], now: Date): BActionReturnBase {
  const createdAt = now.toISOString()
  return {
    version: 1,
    tokenId: createDeterministicReturnToToken(cta, now),
    gatePlan,
    createdAt,
    expiresAt: new Date(now.getTime() + B_ACTION_GATE_TTL_MS).toISOString(),
    consumedAt: null,
  }
}

export function createBTableActionReturn(input: { tableId: string; venueId: string; draft: string; now?: Date }): BTableActionReturn {
  if (!TABLE_ID.test(input.tableId) || !isOndoBTableVenuePair(input.tableId, input.venueId)) throw new Error("Invalid Table return context")
  const now = input.now ?? new Date()
  const returnTo = { ...base("JOIN_TABLE", gatePlanForBAction("JOIN_TABLE", input), now), cta: "JOIN_TABLE" as const, tableId: input.tableId, venueId: input.venueId }
  if (!rememberPrivateActionContext(returnTo, { cta: "JOIN_TABLE", draft: input.draft.trim().slice(0, 280) })) throw new Error("Action token collision")
  return returnTo
}

export function createBLocalSignalActionReturn(input: {
  venueId: string
  draftNonce: string
  tags: readonly OndoBLocalSignalTag[]
  note: string
  photoPreviewUrl?: string | null
  now?: Date
}): BLocalSignalActionReturn {
  if (!isCanonicalVenueId(input.venueId) || !DRAFT_NONCE.test(input.draftNonce)) throw new Error("Invalid Local Signal return context")
  const now = input.now ?? new Date()
  const returnTo = {
    ...base("SUBMIT_LOCAL_SIGNAL", gatePlanForBAction("SUBMIT_LOCAL_SIGNAL"), now),
    cta: "SUBMIT_LOCAL_SIGNAL" as const,
    venueId: input.venueId,
  }
  if (!rememberPrivateActionContext(returnTo, {
    cta: "SUBMIT_LOCAL_SIGNAL",
    draftNonce: input.draftNonce,
    tags: [...new Set(input.tags.filter((tag) => LOCAL_SIGNAL_TAGS.has(tag)))],
    note: input.note.slice(0, 240),
    photoPreviewUrl: input.photoPreviewUrl?.startsWith("blob:") ? input.photoPreviewUrl : null,
  })) throw new Error("Action token collision")
  return returnTo
}

export function createBCheckoutActionReturn(input: { venueId: string; quote?: StableCommerceBLockedQuote; useKTourBenefit?: boolean; now?: Date }): BCheckoutActionReturn {
  const place = resolveCommercePlaceB(input.venueId)
  if (!place?.commerce) throw new Error("Invalid checkout return context")
  const now = input.now ?? new Date()
  const quote = input.quote ?? createStableCommerceBLockedQuoteFromMode(
    input.useKTourBenefit ? "ktour" : "standard",
    new Date(now.getTime() + B_ACTION_GATE_TTL_MS),
    place.commerce,
  )
  if (!isStableCommerceBLockedQuote(quote, now) || quote.offerId !== place.commerce.offerId) throw new Error("Invalid checkout quote")
  const returnTo = {
    ...base("START_CHECKOUT", gatePlanForBAction("START_CHECKOUT"), now),
    cta: "START_CHECKOUT" as const,
    venueId: input.venueId,
  }
  if (!rememberPrivateActionContext(returnTo, { cta: "START_CHECKOUT", quote: { ...quote } })) throw new Error("Action token collision")
  return returnTo
}

export function createBBadgeActionReturn(input: { now?: Date } = {}): BBadgeActionReturn {
  const now = input.now ?? new Date()
  return { ...base("MINT_BADGE", gatePlanForBAction("MINT_BADGE"), now), cta: "MINT_BADGE" }
}

export function createBExperienceActionReturn(input: { venueId: string; campaignId: string; intentId: string; now?: Date }): BExperienceActionReturn {
  if (input.venueId !== EXPERIENCE_PLACE_ID_B || input.campaignId !== EXPERIENCE_CAMPAIGN_ID_B || !/^EXP-[a-z0-9-]{8,80}$/i.test(input.intentId)) throw new Error("Invalid experience context")
  const returnTo: BExperienceActionReturn = { ...base("REDEEM_DEMO_ENTITLEMENT", gatePlanForBAction("REDEEM_DEMO_ENTITLEMENT"), input.now ?? new Date()),
    cta: "REDEEM_DEMO_ENTITLEMENT", venueId: EXPERIENCE_PLACE_ID_B, campaignId: EXPERIENCE_CAMPAIGN_ID_B, intentId: input.intentId }
  if (!rememberPrivateActionContext(returnTo, { cta: "REDEEM_DEMO_ENTITLEMENT", intentId: input.intentId, campaignId: EXPERIENCE_CAMPAIGN_ID_B })) throw new Error("Action token collision")
  return returnTo
}

function samePlan(value: unknown, expected: readonly BActionGateKind[]) {
  return Array.isArray(value) && value.length === expected.length && value.every((gate, index) => gate === expected[index])
}

function hasExactKeys(candidate: Record<string, unknown>, specific: readonly string[], venueRequired = true) {
  const baseKeys = ["version", "tokenId", "gatePlan", "createdAt", "expiresAt", "consumedAt", "cta", ...(venueRequired ? ["venueId"] : [])]
  return hasExactOwnKeys(candidate, [...baseKeys, ...specific])
}

export function isBActionReturnStructurallyValid(value: unknown): value is BActionReturnTo {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  if (candidate.version !== 1 || (candidate.cta !== "JOIN_TABLE" && candidate.cta !== "SUBMIT_LOCAL_SIGNAL" && candidate.cta !== "START_CHECKOUT" && candidate.cta !== "MINT_BADGE" && candidate.cta !== "REDEEM_DEMO_ENTITLEMENT")) return false
  const createdAt = typeof candidate.createdAt === "string" ? Date.parse(candidate.createdAt) : Number.NaN
  const expiresAt = typeof candidate.expiresAt === "string" ? Date.parse(candidate.expiresAt) : Number.NaN
  if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt) || expiresAt - createdAt !== B_ACTION_GATE_TTL_MS) return false
  if (candidate.tokenId !== `RT-${candidate.cta}-${createdAt}` || (candidate.consumedAt !== null && typeof candidate.consumedAt !== "string")) return false
  if (typeof candidate.consumedAt === "string") {
    const consumedAt = Date.parse(candidate.consumedAt)
    if (!Number.isFinite(consumedAt) || consumedAt < createdAt || consumedAt > expiresAt) return false
  }
  if (!samePlan(candidate.gatePlan, gatePlanForBAction(candidate.cta, candidate))) return false
  if (candidate.cta === "MINT_BADGE") return hasExactKeys(candidate, [], false)
  if (typeof candidate.venueId !== "string") return false
  if (candidate.cta === "REDEEM_DEMO_ENTITLEMENT") return hasExactKeys(candidate, ["campaignId", "intentId"]) && candidate.venueId === EXPERIENCE_PLACE_ID_B && candidate.campaignId === EXPERIENCE_CAMPAIGN_ID_B && typeof candidate.intentId === "string" && /^EXP-[a-z0-9-]{8,80}$/i.test(candidate.intentId)
  if (candidate.cta === "JOIN_TABLE") return hasExactKeys(candidate, ["tableId"])
    && typeof candidate.tableId === "string" && TABLE_ID.test(candidate.tableId) && isOndoBTableVenuePair(candidate.tableId, candidate.venueId)
  if (candidate.cta === "SUBMIT_LOCAL_SIGNAL") return hasExactKeys(candidate, []) && isCanonicalVenueId(candidate.venueId)
  return hasExactKeys(candidate, []) && Boolean(resolveCommercePlaceB(candidate.venueId)?.commerce)
}

export function isBActionReturnPending(value: unknown, now = new Date()): value is BActionReturnTo {
  return isBActionReturnStructurallyValid(value)
    && value.consumedAt === null
    && Date.parse(value.createdAt) <= now.getTime()
    && Date.parse(value.expiresAt) > now.getTime()
}

export function snapshotBActionReturnTo(value: BActionReturnTo): CanonicalSnapshotValue | null {
  if (!isBActionReturnStructurallyValid(value)) return null
  return {
    consumedAt: value.consumedAt,
    createdAt: value.createdAt,
    cta: value.cta,
    expiresAt: value.expiresAt,
    gatePlan: [...value.gatePlan],
    tableId: value.cta === "JOIN_TABLE" ? value.tableId : null,
    tokenId: value.tokenId,
    venueId: value.cta === "MINT_BADGE" ? null : value.venueId,
    version: value.version,
    ...(value.cta === "REDEEM_DEMO_ENTITLEMENT" ? { campaignId: value.campaignId, intentId: value.intentId } : {}),
  }
}

export function hashBActionReturnTo(value: BActionReturnTo): ReturnToSnapshotHash | null {
  const snapshot = snapshotBActionReturnTo(value)
  return snapshot ? hashReturnToSnapshot(snapshot) : null
}

/** Event-only outcome metadata is not part of the signed/bound return
 * envelope. Strip that one allowlisted field before strict snapshot checks;
 * never loosen the envelope validator to accept arbitrary extra fields. */
export function actionReturnFromBEvent(value: unknown): BActionReturnTo | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const { gateOutcome, ...envelope } = value as Record<string, unknown>
  if (gateOutcome !== undefined && !["cancel", "denied", "failure", "unavailable", "unsupported", "expired"].includes(String(gateOutcome))) return null
  return isBActionReturnStructurallyValid(envelope) ? envelope : null
}

function sameBActionReturn(left: BActionReturnTo, right: BActionReturnTo) {
  const leftHash = hashBActionReturnTo(left)
  return leftHash !== null && leftHash === hashBActionReturnTo(right)
}

function createRenewedBActionReturnTo(value: BActionReturnTo, now: Date): BActionReturnTo | null {
  const context = privateContextForBAction(value)
  if (value.cta === "REDEEM_DEMO_ENTITLEMENT") {
    if (!context || context.cta !== "REDEEM_DEMO_ENTITLEMENT") return null
    return createBExperienceActionReturn({ venueId: value.venueId, campaignId: value.campaignId, intentId: value.intentId, now })
  }
  if (value.cta === "JOIN_TABLE") {
    if (!context || context.cta !== "JOIN_TABLE") return null
    return createBTableActionReturn({ tableId: value.tableId, venueId: value.venueId, draft: context.draft, now })
  }
  if (value.cta === "SUBMIT_LOCAL_SIGNAL") {
    if (!context || context.cta !== "SUBMIT_LOCAL_SIGNAL") return null
    return createBLocalSignalActionReturn({ venueId: value.venueId, draftNonce: context.draftNonce, tags: context.tags, note: context.note, photoPreviewUrl: context.photoPreviewUrl, now })
  }
  if (value.cta === "START_CHECKOUT") {
    if (!context || context.cta !== "START_CHECKOUT") return null
    const renewedQuote = createStableCommerceBLockedQuoteFromMode(
      context.quote.benefitMode,
      new Date(now.getTime() + B_ACTION_GATE_TTL_MS),
    )
    return createBCheckoutActionReturn({ venueId: value.venueId, quote: renewedQuote, now })
  }
  return createBBadgeActionReturn({ now })
}

export function renewBActionReturnTo(value: BActionReturnTo, now = new Date()): BActionReturnTo | null {
  const renewed = createRenewedBActionReturnTo(value, now)
  if (renewed) forgetPrivateActionContext(value.tokenId)
  return renewed
}

export function consumeBActionReturnTo(value: BActionReturnTo, satisfied: ReadonlySet<BActionGateKind>, now = new Date()): BActionReturnTo | null {
  if (!isBActionReturnPending(value, now) || value.gatePlan.some((gate) => !satisfied.has(gate))) return null
  return { ...value, consumedAt: now.toISOString() }
}

export type BActionGateSessionOptions = Readonly<{ allowReviewFixture?: boolean; credential?: KPassDemoCredential | null }>

export function requestBActionGate(returnTo: BActionReturnTo, options: BActionGateSessionOptions = {}) {
  const rejectUnrequestedAction = () => {
    discardUnrequestedBActionPrivateContext(returnTo)
    return false
  }
  if (typeof window === "undefined" || !isBActionReturnPending(returnTo) || !hasRequiredPrivateContextForBAction(returnTo)) return rejectUnrequestedAction()
  try {
    const current = restoreBActionGateSession(window.sessionStorage, new Date(), options)
    if (current.pending && isBActionReturnPending(current.pending)
      && (current.pending.tokenId !== returnTo.tokenId || !sameBActionReturn(current.pending, returnTo))) return rejectUnrequestedAction()
    const personRoute = current.pending?.tokenId === returnTo.tokenId ? current.personRoute : null
    const presentation = current.pending?.tokenId === returnTo.tokenId ? current.presentation : null
    if (!persistBActionGateSession(window.sessionStorage, { ...current, pending: returnTo, personRoute, presentation, outcome: null }, new Date(), options)) return rejectUnrequestedAction()
  } catch {
    return rejectUnrequestedAction()
  }
  window.dispatchEvent(new CustomEvent(B_ACTION_GATE_REQUEST_EVENT, { detail: returnTo }))
  return true
}

export type BActionAxisStatus = "unverified" | "eligible" | "failed" | "unavailable" | "unsupported" | "expired"
export type BActionAxisGate = "person" | "payment_kyc"
export type BActionAxisReviewReceipt = Readonly<{
  issuer: "ONDO_REVIEW_FIXTURE"
  executionTruth: "FIXTURE_REVIEW"
  provenanceTruth: "SIMULATED"
  fixtureId: FixtureId
  issuedAt: string
  expiresAt: string
}>
export type BActionAxis = {
  status: BActionAxisStatus
  expiresAt: string | null
  reviewReceipt?: BActionAxisReviewReceipt
}
export type BActionGateOutcome = {
  tokenId: string
  gate: BActionGateKind
  status: "failure" | "unavailable" | "unsupported" | "expired"
}
export type BActionConsumptionMarker = {
  tokenId: string
  cta: BActionGateCta
  consumedAt: string
  snapshotHash: ReturnToSnapshotHash
}
export type BActionPresentationMarker = {
  tokenId: string
  approvedAt: string
}
const B_ACTION_PRESENTATION_AUTHORITY = Symbol("b-action-presentation-authority")
export type BActionPresentationAuthority = Readonly<{
  tokenId: string
  snapshotHash: ReturnToSnapshotHash
  approvedAt: string
  [B_ACTION_PRESENTATION_AUTHORITY]: true
}>
type BActionPresentationRequestExpectation = Readonly<{
  snapshotHash: ReturnToSnapshotHash
  request: OndoBPresentationRequest
}>
type BActionPresentationApprovalExpectation = Readonly<{
  snapshotHash: ReturnToSnapshotHash
  approvedAt: string
  phase: "authorized" | "recorded"
  binding?: KPassPresentationBinding
}>
const presentationRequestByToken = new Map<string, BActionPresentationRequestExpectation>()
const presentationApprovalExpectationByToken = new Map<string, BActionPresentationApprovalExpectation>()
const usedPresentationAuthorities = new WeakSet<object>()
type BActionAxisReviewExpectation = Readonly<{ gate: BActionAxisGate; receipt: BActionAxisReviewReceipt }>
const liveReviewAxisExpectations = new WeakMap<object, BActionAxisReviewExpectation>()
const reviewAxisExpectationsByStorage = new WeakMap<object, Map<BActionAxisGate, BActionAxisReviewReceipt>>()

function samePresentationRequest(left: OndoBPresentationRequest, right: OndoBPresentationRequest) {
  return left.nonce === right.nonce
    && left.issuedAt === right.issuedAt
    && left.expiresAt === right.expiresAt
    && left.consumedAt === right.consumedAt
    && (left.binding === undefined && right.binding === undefined || sameKPassPresentationBinding(left.binding, right.binding))
}

function isExactPresentationRequest(value: unknown): value is OndoBPresentationRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const request = value as Record<string, unknown>
  return hasExactOwnKeys(request, request.binding === undefined ? ["nonce", "issuedAt", "expiresAt", "consumedAt"] : ["nonce", "issuedAt", "expiresAt", "consumedAt", "binding"])
    && (request.binding === undefined || isKPassPresentationBinding(request.binding))
    && typeof request.nonce === "string"
    && request.nonce.length > 0
    && typeof request.issuedAt === "number"
    && Number.isFinite(request.issuedAt)
    && typeof request.expiresAt === "number"
    && Number.isFinite(request.expiresAt)
    && (request.consumedAt === null || (typeof request.consumedAt === "number" && Number.isFinite(request.consumedAt)))
}

export function registerBActionPresentationRequest(expected: BActionReturnTo, request: OndoBPresentationRequest) {
  const snapshotHash = privateBindingHash(expected)
  if (request.binding && (request.binding.purpose !== bActionPresentationPurpose(expected) || expected.cta === "MINT_BADGE" || request.binding.audience !== expected.venueId)) return false
  if (expected.cta === "REDEEM_DEMO_ENTITLEMENT" && !request.binding) return false
  if (!isExactPresentationRequest(request) || !snapshotHash || !isBActionReturnPending(expected, new Date(request.issuedAt)) || !requiresBActionPresentation(expected)
    || request.consumedAt !== null || request.issuedAt < Date.parse(expected.createdAt)
    || request.expiresAt <= request.issuedAt) return false
  const current = presentationRequestByToken.get(expected.tokenId)
  if (current) {
    if (current.snapshotHash !== snapshotHash || request.issuedAt < current.request.issuedAt) return false
    if (samePresentationRequest(current.request, request)) return true
  }
  presentationRequestByToken.set(expected.tokenId, { snapshotHash, request: { ...request, ...(request.binding ? { binding: Object.freeze({ ...request.binding, requestedClaims: Object.freeze([...request.binding.requestedClaims]) }) } : {}) } })
  return true
}

export function authorizeBActionPresentationDecision(
  expected: BActionReturnTo,
  resolution: OndoBPresentationResolution,
): BActionPresentationAuthority | null {
  const snapshotHash = privateBindingHash(expected)
  const staged = presentationRequestByToken.get(expected.tokenId)
  if (!resolution || typeof resolution !== "object" || Array.isArray(resolution)
    || !hasExactOwnKeys(resolution as unknown as Record<string, unknown>, ["request", "approved", "code"])
    || !isExactPresentationRequest(resolution.request)) return null
  const consumedAt = resolution.request.consumedAt
  if (!snapshotHash || !staged || staged.snapshotHash !== snapshotHash
    || resolution.approved !== true || resolution.code !== null || consumedAt === null
    || !samePresentationRequest(staged.request, { ...resolution.request, consumedAt: null })
    || consumedAt < staged.request.issuedAt || consumedAt >= staged.request.expiresAt
    || consumedAt > Date.parse(expected.expiresAt)) return null
  const approvedAt = new Date(consumedAt).toISOString()
  presentationRequestByToken.delete(expected.tokenId)
  presentationApprovalExpectationByToken.set(expected.tokenId, { snapshotHash, approvedAt, phase: "authorized", ...(staged.request.binding ? { binding: staged.request.binding } : {}) })
  return Object.freeze({
    tokenId: expected.tokenId,
    snapshotHash,
    approvedAt,
    [B_ACTION_PRESENTATION_AUTHORITY]: true as const,
  })
}
export type BPersonRouteSelectionB = {
  tokenId: string
  route: BPersonRouteB
}
export type BActionGateSession = {
  version: 1
  person: BActionAxis
  payment: BActionAxis
  pending: BActionReturnTo | null
  // A route is an explicit, non-sensitive choice scoped to one pending token.
  // It contains no nationality, residence status, document data, or provider result.
  personRoute: BPersonRouteSelectionB | null
  // One opaque action token plus its approval time is enough to resume the
  // exact action. No holder, document, DID/VC, provider response or claim is stored.
  presentation: BActionPresentationMarker | null
  // Only a non-sensitive receipt is persisted across the synchronous
  // consume -> device-mutation boundary. Draft text, tags and place context
  // must never survive in the consumed slot.
  lastConsumed: BActionConsumptionMarker | null
  outcome: BActionGateOutcome | null
}

const blankAxis = (): BActionAxis => ({ status: "unverified", expiresAt: null })
export const DEFAULT_B_ACTION_GATE_SESSION: BActionGateSession = { version: 1, person: blankAxis(), payment: blankAxis(), pending: null, personRoute: null, presentation: null, lastConsumed: null, outcome: null }

function reviewFixtureMatchesGate(fixtureId: string, gate: BActionAxisGate) {
  return gate === "person" ? /^FX-PER-[A-Z0-9-]+$/.test(fixtureId) : /^FX-PKY-[A-Z0-9-]+$/.test(fixtureId)
}

function sanitizeReviewReceipt(
  value: unknown,
  gate: BActionAxisGate,
  axisExpiry: string,
  now: Date,
  options: BActionGateSessionOptions,
  expected: BActionAxisReviewReceipt | null,
): BActionAxisReviewReceipt | null {
  if (options.allowReviewFixture !== true || !value || typeof value !== "object" || Array.isArray(value)) return null
  const receipt = value as Record<string, unknown>
  if (!hasExactOwnKeys(receipt, ["issuer", "executionTruth", "provenanceTruth", "fixtureId", "issuedAt", "expiresAt"])) return null
  const issuedAtMs = typeof receipt.issuedAt === "string" ? Date.parse(receipt.issuedAt) : Number.NaN
  const receiptExpiryMs = typeof receipt.expiresAt === "string" ? Date.parse(receipt.expiresAt) : Number.NaN
  if (receipt.issuer !== "ONDO_REVIEW_FIXTURE"
    || receipt.executionTruth !== "FIXTURE_REVIEW"
    || receipt.provenanceTruth !== "SIMULATED"
    || typeof receipt.fixtureId !== "string"
    || !reviewFixtureMatchesGate(receipt.fixtureId, gate)
    || !Number.isFinite(issuedAtMs)
    || !Number.isFinite(receiptExpiryMs)
    || issuedAtMs > now.getTime()
    || receiptExpiryMs <= issuedAtMs
    || new Date(receiptExpiryMs).toISOString() !== axisExpiry
    || new Date(receiptExpiryMs).toISOString() !== receipt.expiresAt) return null
  const sanitized: BActionAxisReviewReceipt = {
    issuer: "ONDO_REVIEW_FIXTURE",
    executionTruth: "FIXTURE_REVIEW",
    provenanceTruth: "SIMULATED",
    fixtureId: receipt.fixtureId as FixtureId,
    issuedAt: new Date(issuedAtMs).toISOString(),
    expiresAt: axisExpiry,
  }
  return expected && JSON.stringify(sanitized) === JSON.stringify(expected) ? sanitized : null
}

export function createBActionReviewAxis(
  gate: BActionAxisGate,
  execution: ReviewFixtureExecution<{ axis: BActionAxisGate }>,
  now = new Date(),
): BActionAxis | null {
  if (!isLiveReviewFixtureExecution(execution)
    || execution.mode !== "review"
    || execution.executionTruth !== "FIXTURE_REVIEW"
    || execution.provenanceTruth !== "SIMULATED"
    || execution.externalProviderConnected !== false
    || execution.externalEffect !== "none"
    || execution.result !== "FIXTURE_SUCCESS"
    || execution.value.axis !== gate
    || !reviewFixtureMatchesGate(execution.fixtureId, gate)) return null
  const issuedAtMs = Date.parse(execution.recordedAt)
  if (!Number.isFinite(issuedAtMs) || issuedAtMs > now.getTime()) return null
  const expiresAt = new Date(now.getTime() + B_ACTION_AXIS_TTL_MS).toISOString()
  const reviewReceipt = Object.freeze({
    issuer: "ONDO_REVIEW_FIXTURE" as const,
    executionTruth: "FIXTURE_REVIEW" as const,
    provenanceTruth: "SIMULATED" as const,
    fixtureId: execution.fixtureId,
    issuedAt: new Date(issuedAtMs).toISOString(),
    expiresAt,
  })
  const axis: BActionAxis = Object.freeze({
    status: "eligible",
    expiresAt,
    reviewReceipt,
  })
  liveReviewAxisExpectations.set(axis, { gate, receipt: reviewReceipt })
  return axis
}

function sanitizeAxis(
  value: unknown,
  gate: BActionAxisGate,
  now: Date,
  options: BActionGateSessionOptions,
  expected: BActionAxisReviewReceipt | null,
): BActionAxis {
  if (!value || typeof value !== "object" || Array.isArray(value)) return blankAxis()
  const axis = value as Record<string, unknown>
  const expiry = typeof axis.expiresAt === "string" && Number.isFinite(Date.parse(axis.expiresAt)) ? new Date(axis.expiresAt).toISOString() : null
  if (axis.status === "eligible") {
    if (!expiry) return blankAxis()
    const reviewReceipt = sanitizeReviewReceipt(axis.reviewReceipt, gate, expiry, now, options, expected)
    if (!reviewReceipt) return blankAxis()
    return Date.parse(expiry) > now.getTime()
      ? { status: "eligible", expiresAt: expiry, reviewReceipt }
      : { status: "expired", expiresAt: expiry, reviewReceipt }
  }
  if (axis.status === "expired" && expiry) {
    const reviewReceipt = sanitizeReviewReceipt(axis.reviewReceipt, gate, expiry, now, options, expected)
    if (reviewReceipt && Date.parse(expiry) <= now.getTime()) return { status: "expired", expiresAt: expiry, reviewReceipt }
  }
  if (axis.status === "unsupported") return gate === "person" ? { status: "unsupported", expiresAt: null } : blankAxis()
  return axis.status === "failed" || axis.status === "unavailable" || axis.status === "expired" ? { status: axis.status, expiresAt: null } : blankAxis()
}

function parse(storage: Pick<Storage, "getItem">, key: string): unknown {
  try { const raw = storage.getItem(key); return raw ? JSON.parse(raw) : null } catch { return null }
}

function sanitizeConsumptionMarker(value: unknown): BActionConsumptionMarker | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const cta = record.cta
  const consumedAt = typeof record.consumedAt === "string" ? Date.parse(record.consumedAt) : Number.NaN
  if ((cta !== "JOIN_TABLE" && cta !== "SUBMIT_LOCAL_SIGNAL" && cta !== "START_CHECKOUT" && cta !== "MINT_BADGE" && cta !== "REDEEM_DEMO_ENTITLEMENT")
    || typeof record.tokenId !== "string"
    || !Number.isFinite(consumedAt)) return null
  // Accept the previous full-envelope representation only to migrate it
  // one-way into this payload-free marker on the next persistence write.
  if (isBActionReturnStructurallyValid(value) && value.consumedAt !== null) {
    const snapshotHash = hashBActionReturnTo(value)
    return snapshotHash
      ? { tokenId: value.tokenId, cta: value.cta, consumedAt: value.consumedAt, snapshotHash }
      : null
  }
  if (!hasExactOwnKeys(record, ["tokenId", "cta", "consumedAt", "snapshotHash"])
    || typeof record.snapshotHash !== "string"
    || !RETURN_TO_SNAPSHOT_HASH.test(record.snapshotHash)) return null
  return {
    tokenId: record.tokenId,
    cta,
    consumedAt: new Date(consumedAt).toISOString(),
    snapshotHash: record.snapshotHash as ReturnToSnapshotHash,
  }
}

function sanitizePersonRoute(value: unknown, pending: BActionReturnTo | null): BPersonRouteSelectionB | null {
  if (!pending || !pending.gatePlan.includes("person") || !value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (Object.keys(record).length !== 2 || record.tokenId !== pending.tokenId) return null
  if (record.route !== "mobile_id_cx" && record.route !== "mobile_residence_card" && record.route !== "passport_ekyc") return null
  return { tokenId: pending.tokenId, route: record.route }
}

function sanitizePresentation(value: unknown, pending: BActionReturnTo | null): BActionPresentationMarker | null {
  if (!pending || !requiresBActionPresentation(pending) || !value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const approvedAt = typeof record.approvedAt === "string" ? Date.parse(record.approvedAt) : Number.NaN
  const snapshotHash = privateBindingHash(pending)
  const expected = presentationApprovalExpectationByToken.get(pending.tokenId)
  if (Object.keys(record).length !== 2 || record.tokenId !== pending.tokenId || !Number.isFinite(approvedAt)) return null
  if (approvedAt < Date.parse(pending.createdAt) || approvedAt > Date.parse(pending.expiresAt)) return null
  if (!snapshotHash || !expected || expected.phase !== "recorded" || expected.snapshotHash !== snapshotHash || expected.approvedAt !== new Date(approvedAt).toISOString()) return null
  return { tokenId: pending.tokenId, approvedAt: new Date(approvedAt).toISOString() }
}

function sanitizeBActionGateSession(
  value: unknown,
  now: Date,
  options: BActionGateSessionOptions,
  expectations: ReadonlyMap<BActionAxisGate, BActionAxisReviewReceipt> = new Map(),
): BActionGateSession {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_B_ACTION_GATE_SESSION, person: blankAxis(), payment: blankAxis() }
  const record = value as Record<string, unknown>
  if (record.version !== 1) return { ...DEFAULT_B_ACTION_GATE_SESSION, person: blankAxis(), payment: blankAxis() }
  const pending = isBActionReturnStructurallyValid(record.pending)
    && record.pending.consumedAt === null
    && hasRequiredPrivateContextForBAction(record.pending)
      ? record.pending
      : null
  const personRoute = sanitizePersonRoute(record.personRoute, pending)
  const candidateOutcome = record.outcome && typeof record.outcome === "object" && !Array.isArray(record.outcome) ? record.outcome as Record<string, unknown> : null
  const outcome = pending && candidateOutcome?.tokenId === pending.tokenId
    && pending.gatePlan.includes(candidateOutcome.gate as BActionGateKind)
    && (candidateOutcome.status === "failure" || candidateOutcome.status === "unavailable" || candidateOutcome.status === "unsupported" || candidateOutcome.status === "expired")
    && (candidateOutcome.status !== "unsupported" || (candidateOutcome.gate === "person" && personRoute?.route === "mobile_residence_card"))
    ? { tokenId: pending.tokenId, gate: candidateOutcome.gate as BActionGateKind, status: candidateOutcome.status as BActionGateOutcome["status"] } satisfies BActionGateOutcome
    : null
  return {
    version: 1,
    person: sanitizeAxis(record.person, "person", now, options, expectations.get("person") ?? null),
    payment: sanitizeAxis(record.payment, "payment_kyc", now, options, expectations.get("payment_kyc") ?? null),
    pending,
    personRoute,
    presentation: sanitizePresentation(record.presentation, pending),
    lastConsumed: sanitizeConsumptionMarker(record.lastConsumed),
    outcome,
  }
}

function migrateLegacyActionAxes(_storage: Pick<Storage, "getItem">, _now: Date): BActionGateSession {
  // A legacy string has neither review authority nor a bounded provenance
  // receipt. It cannot satisfy Person or Payment in the B action plan.
  return { ...DEFAULT_B_ACTION_GATE_SESSION, person: blankAxis(), payment: blankAxis() }
}

export function restoreBActionGateSession(
  storage: Pick<Storage, "getItem">,
  now = new Date(),
  options: BActionGateSessionOptions = {},
): BActionGateSession {
  let hasCurrent = false
  try { hasCurrent = storage.getItem(B_ACTION_GATE_SESSION_KEY) !== null } catch { return { ...DEFAULT_B_ACTION_GATE_SESSION, person: blankAxis(), payment: blankAxis() } }
  if (!hasCurrent) {
    if (storage && typeof storage === "object") reviewAxisExpectationsByStorage.delete(storage)
    return migrateLegacyActionAxes(storage, now)
  }
  const value = parse(storage, B_ACTION_GATE_SESSION_KEY)
  const currentExpectations = storage && typeof storage === "object"
    ? reviewAxisExpectationsByStorage.get(storage) ?? new Map<BActionAxisGate, BActionAxisReviewReceipt>()
    : new Map<BActionAxisGate, BActionAxisReviewReceipt>()
  const restored = sanitizeBActionGateSession(value, now, options, currentExpectations)
  if (storage && typeof storage === "object") {
    const retained = new Map<BActionAxisGate, BActionAxisReviewReceipt>()
    if ((restored.person.status === "eligible" || restored.person.status === "expired") && restored.person.reviewReceipt) retained.set("person", restored.person.reviewReceipt)
    if ((restored.payment.status === "eligible" || restored.payment.status === "expired") && restored.payment.reviewReceipt) retained.set("payment_kyc", restored.payment.reviewReceipt)
    if (retained.size) reviewAxisExpectationsByStorage.set(storage, retained)
    else reviewAxisExpectationsByStorage.delete(storage)
  }
  return restored
}

export function persistBActionGateSession(
  storage: Pick<Storage, "getItem" | "setItem">,
  session: BActionGateSession,
  now = new Date(),
  options: BActionGateSessionOptions = {},
) {
  const previousExpectations = storage && typeof storage === "object"
    ? reviewAxisExpectationsByStorage.get(storage) ?? new Map<BActionAxisGate, BActionAxisReviewReceipt>()
    : new Map<BActionAxisGate, BActionAxisReviewReceipt>()
  const stagedExpectations = new Map(previousExpectations)
  for (const [gate, axis] of [["person", session.person], ["payment_kyc", session.payment]] as const) {
    const live = axis && typeof axis === "object" ? liveReviewAxisExpectations.get(axis) : undefined
    if (live?.gate === gate) stagedExpectations.set(gate, live.receipt)
  }
  const sanitized = sanitizeBActionGateSession(session, now, options, stagedExpectations)
  const nextRaw = JSON.stringify(sanitized)
  try {
    storage.setItem(B_ACTION_GATE_SESSION_KEY, nextRaw)
    if (storage.getItem(B_ACTION_GATE_SESSION_KEY) !== nextRaw) return false
    if (storage && typeof storage === "object") {
      const retained = new Map<BActionAxisGate, BActionAxisReviewReceipt>()
      if ((sanitized.person.status === "eligible" || sanitized.person.status === "expired") && sanitized.person.reviewReceipt) retained.set("person", sanitized.person.reviewReceipt)
      if ((sanitized.payment.status === "eligible" || sanitized.payment.status === "expired") && sanitized.payment.reviewReceipt) retained.set("payment_kyc", sanitized.payment.reviewReceipt)
      if (retained.size) reviewAxisExpectationsByStorage.set(storage, retained)
      else reviewAxisExpectationsByStorage.delete(storage)
    }
    return true
  } catch {
    return false
  }
}

export function hasBActionPresentationApproval(session: BActionGateSession, pending: BActionReturnTo | null, credential?: KPassDemoCredential | null, now = Date.now()) {
  if (!pending || session.presentation?.tokenId !== pending.tokenId) return false
  const snapshotHash = privateBindingHash(pending)
  const expected = presentationApprovalExpectationByToken.get(pending.tokenId)
  if (expected?.binding && (!credential || expected.binding.credentialId !== credential.credentialId || evaluateKPassService(credential, { service: expected.binding.purpose, now }).status !== "allowed")) return false
  return Boolean(snapshotHash && expected?.phase === "recorded" && expected.snapshotHash === snapshotHash && expected.approvedAt === session.presentation.approvedAt)
}

export type BExperiencePersonHandoff = Readonly<{
  tokenId: string; intentId: string; snapshotHash: ReturnToSnapshotHash
  route: "mobile_id_cx"; receiptIssuedAt: string; receiptExpiresAt: string
}>
const liveExperiencePersonHandoffs = new WeakSet<object>()
function currentExperiencePersonHandoff(storage: Pick<Storage, "getItem">, now: Date, options: BActionGateSessionOptions): BExperiencePersonHandoff | null {
  if (options.allowReviewFixture !== true || options.credential) return null
  const session = restoreBActionGateSession(storage, now, options)
  const pending = session.pending
  const receipt = session.person.reviewReceipt
  if (!pending || pending.cta !== "REDEEM_DEMO_ENTITLEMENT" || !isBActionReturnPending(pending, now)
    || session.personRoute?.tokenId !== pending.tokenId || session.personRoute.route !== "mobile_id_cx"
    || session.person.status !== "eligible" || !receipt || receipt.fixtureId !== "FX-PER-CX-SUCCESS"
    || receipt.issuer !== "ONDO_REVIEW_FIXTURE" || receipt.executionTruth !== "FIXTURE_REVIEW" || receipt.provenanceTruth !== "SIMULATED"
    || Date.parse(receipt.issuedAt) < Date.parse(pending.createdAt) || Date.parse(receipt.expiresAt) <= now.getTime()) return null
  const snapshotHash = hashBActionReturnTo(pending)
  return snapshotHash ? { tokenId: pending.tokenId, intentId: pending.intentId, snapshotHash, route: "mobile_id_cx", receiptIssuedAt: receipt.issuedAt, receiptExpiresAt: receipt.expiresAt } : null
}

/** Reuse only a live, same-action prepared Mobile ID result. Persisted JSON
 * cannot mint this process-only handoff or an identity credential. */
export function createBExperiencePersonHandoff(storage: Pick<Storage, "getItem">, now = new Date(), options: BActionGateSessionOptions = {}): BExperiencePersonHandoff | null {
  const snapshot = currentExperiencePersonHandoff(storage, now, options)
  if (!snapshot) return null
  const handoff = Object.freeze(snapshot)
  liveExperiencePersonHandoffs.add(handoff)
  return handoff
}
export function isBExperiencePersonHandoffCurrent(storage: Pick<Storage, "getItem">, expected: BExperiencePersonHandoff, now = new Date(), options: BActionGateSessionOptions = {}) {
  if (!expected || !liveExperiencePersonHandoffs.has(expected)) return false
  const current = currentExperiencePersonHandoff(storage, now, options)
  return Boolean(current && current.tokenId === expected.tokenId && current.intentId === expected.intentId && current.snapshotHash === expected.snapshotHash
    && current.route === expected.route && current.receiptIssuedAt === expected.receiptIssuedAt && current.receiptExpiresAt === expected.receiptExpiresAt)
}

export function recordBActionPresentationApproval(
  storage: Pick<Storage, "getItem" | "setItem">,
  expected: BActionReturnTo,
  authority: BActionPresentationAuthority,
  now = new Date(),
  options: BActionGateSessionOptions = {},
): BActionGateSession | null {
  const latest = restoreBActionGateSession(storage, now, options)
  const snapshotHash = privateBindingHash(expected)
  const approval = presentationApprovalExpectationByToken.get(expected.tokenId)
  if (!authority || typeof authority !== "object" || authority[B_ACTION_PRESENTATION_AUTHORITY] !== true
    || usedPresentationAuthorities.has(authority)
    || authority.tokenId !== expected.tokenId
    || authority.snapshotHash !== snapshotHash
    || authority.approvedAt !== approval?.approvedAt
    || approval?.snapshotHash !== snapshotHash
    || approval.phase !== "authorized") return null
  if (!latest.pending || latest.pending.tokenId !== expected.tokenId || !sameBActionReturn(latest.pending, expected)
    || !isBActionReturnPending(latest.pending, now) || !requiresBActionPresentation(latest.pending)) return null
  const next: BActionGateSession = {
    ...latest,
    presentation: { tokenId: latest.pending.tokenId, approvedAt: authority.approvedAt },
    outcome: null,
  }
  presentationApprovalExpectationByToken.set(expected.tokenId, { ...approval, phase: "recorded" })
  if (!persistBActionGateSession(storage, next, now, options)) {
    presentationApprovalExpectationByToken.set(expected.tokenId, approval)
    return null
  }
  usedPresentationAuthorities.add(authority)
  return next
}

export function updateBActionAxisSession<G extends BActionAxisGate>(
  storage: Pick<Storage, "getItem" | "setItem">,
  gate: G,
  status: BActionAxisStatus,
  now = new Date(),
  options: BActionGateSessionOptions & {
    reviewExecution?: ReviewFixtureExecution<{ axis: G }>
  } = {},
): BActionGateSession | null {
  if (status === "unsupported" && gate !== "person") return null
  const current = restoreBActionGateSession(storage, now, options)
  const axis: BActionAxis | null = status === "eligible"
    ? options.allowReviewFixture === true && options.reviewExecution
      ? createBActionReviewAxis(gate, options.reviewExecution, now)
      : null
    : { status, expiresAt: null }
  if (!axis) return null
  const next = {
    ...current,
    person: gate === "person" ? axis : current.person,
    payment: gate === "payment_kyc" ? axis : current.payment,
  }
  return persistBActionGateSession(storage, next, now, options) ? next : null
}

export function consumePendingBActionAtMutation(
  storage: Pick<Storage, "getItem" | "setItem">,
  expected: BActionReturnTo,
  satisfied: ReadonlySet<BActionGateKind>,
  now = new Date(),
  options: BActionGateSessionOptions = {},
): BActionReturnTo | null {
  const latest = restoreBActionGateSession(storage, now, options)
  if (!latest.pending || latest.pending.tokenId !== expected.tokenId || !sameBActionReturn(latest.pending, expected)) return null
  if (!hasRequiredPrivateContextForBAction(latest.pending)) return null
  // A client status or persisted fixture can never authorize production identity.
  // The actual provider's single-use receipt must match this precise pending intent.
  if (!options.allowReviewFixture && (latest.pending.gatePlan.includes("person") || latest.pending.gatePlan.includes("age"))
    && !hasJitConsumedReceipt(latest.pending.tokenId, hashBActionReturnTo(latest.pending), now.getTime())) return null
  if (requiresBActionPresentation(latest.pending) && !hasBActionPresentationApproval(latest, latest.pending, options.credential, now.getTime())) return null
  // Old receipts cannot authorize an action with a now-expired/revoked pass or
  // changed predicate. Re-evaluate at the last possible mutation boundary.
  if (options.credential) {
    for (const service of ["person", "age"] as const) {
      if (latest.pending.gatePlan.includes(service) && evaluateKPassService(options.credential, { service, now: now.getTime() }).status !== "allowed") return null
    }
    if (latest.pending.cta === "START_CHECKOUT") {
      const context = privateContextForBAction(latest.pending)
      if (context?.cta !== "START_CHECKOUT" || evaluateKPassService(options.credential, { service: "payment", amountKrw: context.quote.finalDebit * 1_000, paymentKyc: satisfied.has("payment_kyc"), now: now.getTime() }).status !== "allowed") return null
    }
  }
  const consumed = consumeBActionReturnTo(latest.pending, satisfied, now)
  if (!consumed) return null
  const snapshotHash = hashBActionReturnTo(consumed)
  if (!snapshotHash) return null
  const lastConsumed: BActionConsumptionMarker = { tokenId: consumed.tokenId, cta: consumed.cta, consumedAt: consumed.consumedAt!, snapshotHash }
  const next = { ...latest, pending: null, personRoute: null, presentation: null, lastConsumed, outcome: null }
  return persistBActionGateSession(storage, next, now, options) ? consumed : null
}

function hasExactConsumedMarker(session: BActionGateSession, consumed: BActionReturnTo) {
  const snapshotHash = hashBActionReturnTo(consumed)
  return !session.pending
    && session.lastConsumed?.tokenId === consumed.tokenId
    && session.lastConsumed.cta === consumed.cta
    && session.lastConsumed.consumedAt === consumed.consumedAt
    && consumed.consumedAt !== null
    && snapshotHash !== null
    && session.lastConsumed.snapshotHash === snapshotHash
}

function hasExactRestoredPending(session: BActionGateSession, consumed: BActionReturnTo) {
  const pending = { ...consumed, consumedAt: null }
  return session.lastConsumed === null
    && session.pending !== null
    && sameBActionReturn(session.pending, pending)
    && session.pending.consumedAt === null
}

function sameSanitizedBActionGateSession(left: BActionGateSession, right: BActionGateSession) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function consumedFinalizationKey(consumed: BActionReturnTo) {
  const snapshotHash = hashBActionReturnTo(consumed)
  return snapshotHash && consumed.consumedAt !== null
    ? `${consumed.tokenId}:${consumed.consumedAt}:${snapshotHash}`
    : null
}

function persistExactBActionGateSession(
  storage: Pick<Storage, "getItem" | "setItem">,
  session: BActionGateSession,
  now: Date,
  options: BActionGateSessionOptions,
) {
  const expectations = storage && typeof storage === "object"
    ? reviewAxisExpectationsByStorage.get(storage) ?? new Map<BActionAxisGate, BActionAxisReviewReceipt>()
    : new Map<BActionAxisGate, BActionAxisReviewReceipt>()
  const target = sanitizeBActionGateSession(session, now, options, expectations)
  return persistBActionGateSession(storage, target, now, options)
    && sameSanitizedBActionGateSession(restoreBActionGateSession(storage, now, options), target)
}

function retrySessionForConsumedBAction(
  storage: Pick<Storage, "getItem">,
  latest: BActionGateSession,
  consumed: BActionReturnTo,
  now: Date,
  options: BActionGateSessionOptions,
): BActionGateSession | null {
  const pending = { ...consumed, consumedAt: null }
  if (!isBActionReturnPending(pending, now) || !hasRequiredPrivateContextForBAction(pending)) return null
  const approval = presentationApprovalExpectationByToken.get(consumed.tokenId)
  const presentation = requiresBActionPresentation(consumed) && approval?.phase === "recorded"
    ? { tokenId: consumed.tokenId, approvedAt: approval.approvedAt }
    : null
  if (requiresBActionPresentation(consumed) && !presentation) return null
  return sanitizeBActionGateSession({
    ...latest,
    pending,
    personRoute: null,
    presentation,
    lastConsumed: null,
    outcome: null,
  }, now, options, storage && typeof storage === "object"
    ? reviewAxisExpectationsByStorage.get(storage) ?? new Map()
    : new Map())
}

function restoreExactPendingAfterFinalizationFailure(
  storage: Pick<Storage, "getItem" | "setItem">,
  latest: BActionGateSession,
  consumed: BActionReturnTo,
  now: Date,
  options: BActionGateSessionOptions,
) {
  const retry = retrySessionForConsumedBAction(storage, latest, consumed, now, options)
  return retry !== null && persistExactBActionGateSession(storage, retry, now, options)
}

function persistTerminalTombstone(
  storage: Pick<Storage, "getItem" | "setItem">,
  latest: BActionGateSession,
  now: Date,
  options: BActionGateSessionOptions,
) {
  return persistExactBActionGateSession(storage, {
    ...latest,
    pending: null,
    personRoute: null,
    presentation: null,
    lastConsumed: null,
    outcome: null,
  }, now, options)
}

export function restoreConsumedBActionAfterMutationFailure(
  storage: Pick<Storage, "getItem" | "setItem">,
  consumed: BActionReturnTo,
  now = new Date(),
  options: BActionGateSessionOptions = {},
) {
  const latest = restoreBActionGateSession(storage, now, options)
  if (!hasExactConsumedMarker(latest, consumed)) return false
  return restoreExactPendingAfterFinalizationFailure(storage, latest, consumed, now, options)
}

/**
 * Finalize the one-shot journal before publishing a related product mutation.
 *
 * `commit` must itself be an atomic boolean writer: `false` means it published
 * no state. The helper verifies the terminal journal by readback before calling
 * it, retains private context until both sides succeed, and reconstructs the
 * exact pending action when either side fails. A failed rollback remains
 * fail-closed: no completion event or success UI may be emitted by the caller.
 */
export function finalizeConsumedBActionWithMutation(
  storage: Pick<Storage, "getItem" | "setItem">,
  consumed: BActionReturnTo,
  commit: () => boolean,
  now = new Date(),
  options: BActionGateSessionOptions = {},
) {
  const latest = restoreBActionGateSession(storage, now, options)
  const attemptKey = consumedFinalizationKey(consumed)
  if (!attemptKey || blockedFinalizationAttempts.has(attemptKey) || !hasExactConsumedMarker(latest, consumed)) return false
  blockedFinalizationAttempts.add(attemptKey)

  const terminal = sanitizeBActionGateSession({
    ...latest,
    personRoute: null,
    presentation: null,
    lastConsumed: null,
    outcome: null,
  }, now, options, storage && typeof storage === "object"
    ? reviewAxisExpectationsByStorage.get(storage) ?? new Map()
    : new Map())
  const terminalWritten = persistExactBActionGateSession(storage, terminal, now, options)
  if (!terminalWritten) {
    if (restoreExactPendingAfterFinalizationFailure(storage, latest, consumed, now, options)) {
      blockedFinalizationAttempts.delete(attemptKey)
    } else if (persistTerminalTombstone(storage, latest, now, options)) {
      forgetPrivateActionContext(consumed.tokenId)
    }
    return false
  }

  let committed = false
  try { committed = commit() === true } catch { committed = false }
  if (!committed) {
    if (restoreExactPendingAfterFinalizationFailure(storage, latest, consumed, now, options)
      && hasExactRestoredPending(restoreBActionGateSession(storage, now, options), consumed)) {
      blockedFinalizationAttempts.delete(attemptKey)
    } else if (persistTerminalTombstone(storage, latest, now, options)) {
      forgetPrivateActionContext(consumed.tokenId)
    }
    return false
  }

  forgetPrivateActionContext(consumed.tokenId)
  blockedFinalizationAttempts.delete(attemptKey)
  return true
}

export function finalizeConsumedBAction(
  storage: Pick<Storage, "getItem" | "setItem">,
  consumed: BActionReturnTo,
  now = new Date(),
  options: BActionGateSessionOptions = {},
) {
  const latest = restoreBActionGateSession(storage, now, options)
  const attemptKey = consumedFinalizationKey(consumed)
  if (!attemptKey || blockedFinalizationAttempts.has(attemptKey) || !hasExactConsumedMarker(latest, consumed)) return false
  blockedFinalizationAttempts.add(attemptKey)
  const persisted = persistTerminalTombstone(storage, latest, now, options)
  if (persisted) {
    forgetPrivateActionContext(consumed.tokenId)
    blockedFinalizationAttempts.delete(attemptKey)
    return true
  }
  if (restoreExactPendingAfterFinalizationFailure(storage, latest, consumed, now, options)) {
    blockedFinalizationAttempts.delete(attemptKey)
  } else if (persistTerminalTombstone(storage, latest, now, options)) {
    forgetPrivateActionContext(consumed.tokenId)
  }
  return false
}

export function abandonPendingBAction(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  expected: BActionReturnTo,
  now = new Date(),
  options: BActionGateSessionOptions = {},
  onDurable?: (pending: BActionReturnTo) => void,
) {
  const latest = restoreBActionGateSession(storage, now, options)
  // A token is only one field of the authority envelope. Never let a stale or
  // mutated same-token snapshot retire the currently durable action.
  if (!latest.pending || latest.pending.tokenId !== expected.tokenId || !sameBActionReturn(latest.pending, expected)) return false
  if (persistBActionGateSession(storage, { ...latest, pending: null, personRoute: null, presentation: null, outcome: null }, now, options)) {
    try { onDurable?.(latest.pending) } finally { forgetPrivateActionContext(expected.tokenId); forgetJitAuthorization(expected.tokenId) }
    return true
  }
  // Privacy-first fallback: if a browser refuses the bounded rewrite, remove
  // the complete gate record so a discarded draft cannot survive a reload.
  try {
    storage.removeItem(B_ACTION_GATE_SESSION_KEY)
    if (storage.getItem(B_ACTION_GATE_SESSION_KEY) !== null) return false
    if (storage && typeof storage === "object") reviewAxisExpectationsByStorage.delete(storage)
    try { onDurable?.(latest.pending) } finally { forgetPrivateActionContext(expected.tokenId); forgetJitAuthorization(expected.tokenId) }
    return true
  } catch {
    return false
  }
}

/** Called only after an enclosing reset transaction has itself been verified. */
export function forgetBActionGateRuntimeAuthorityAfterReset(storage: object) {
  clearJitAuthorizations()
  privateActionContextByToken.clear()
  presentationRequestByToken.clear()
  presentationApprovalExpectationByToken.clear()
  reviewAxisExpectationsByStorage.delete(storage)
}

export function clearBActionGateSession(storage: Pick<Storage, "getItem" | "removeItem">) {
  try {
    storage.removeItem(B_ACTION_GATE_SESSION_KEY)
    if (storage.getItem(B_ACTION_GATE_SESSION_KEY) !== null) return false
  } catch {
    return false
  }
  forgetBActionGateRuntimeAuthorityAfterReset(storage)
  return true
}

/**
 * Renew an expired return and durably replace the exact pending session before
 * retiring its private context. A failed write leaves the original mounted
 * context available for cancel/retry and never publishes the new return.
 */
export function renewExpiredPendingBAction(
  storage: Pick<Storage, "getItem" | "setItem">,
  expected: BActionReturnTo,
  now = new Date(),
  options: BActionGateSessionOptions = {},
): Readonly<{ pending: BActionReturnTo; session: BActionGateSession }> | null {
  const latest = restoreBActionGateSession(storage, now, options)
  if (!latest.pending || latest.pending.tokenId !== expected.tokenId || !sameBActionReturn(latest.pending, expected)
    || isBActionReturnPending(latest.pending, now)) return null
  const renewed = createRenewedBActionReturnTo(latest.pending, now)
  if (!renewed) return null
  const personRoute = latest.personRoute
    ? { tokenId: renewed.tokenId, route: latest.personRoute.route }
    : null
  const next: BActionGateSession = {
    ...latest,
    pending: renewed,
    personRoute,
    presentation: null,
    lastConsumed: null,
    outcome: null,
  }
  if (!persistBActionGateSession(storage, next, now, options)) {
    forgetPrivateActionContext(renewed.tokenId)
    return null
  }
  forgetPrivateActionContext(expected.tokenId)
  return { pending: renewed, session: next }
}
