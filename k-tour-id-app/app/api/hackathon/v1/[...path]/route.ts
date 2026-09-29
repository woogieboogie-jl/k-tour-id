// /api/hackathon/v1 — isolated BFF for the demo entitlement journey.
// Not a vendor API. Every mutating call is same-origin + session-bound.
import { NextResponse } from "next/server"
import { hkPublicConfig, HK_CONSENT_VERSION } from "@/lib/hackathon/config"
import { assertSameOrigin, ensureSession, getSession, requireSession } from "@/lib/hackathon/session"
import { digestOf, HkError } from "@/lib/hackathon/util"
import { guideReadiness } from "@/lib/hackathon/guide-policy"
import { providerOperationAction } from "@/lib/hackathon/provider-operation"
import { safeHkError } from "@/lib/hackathon/public-error"
import { readStore } from "@/lib/hackathon/store"
import * as svc from "@/lib/hackathon/service"
import { currentEpoch } from "@/lib/hackathon/adapters/sui"
import { proveZkLogin, zkLoginConfigured } from "@/lib/hackathon/adapters/zklogin"
import { canonicalMapVenueById } from "@/lib/ondo/venues/map-data"
import { isCxPreview, isReadinessPreview, previewReadOnlyResponse } from "@/lib/hackathon/preview-readiness"
import { cxReadinessResponse } from "@/lib/hackathon/cx-readiness"
import { assertCxPreviewOrigin, assertCxPreviewTarget, cxPreviewBody, cxPreviewRouteAllowed, grantCxPreviewAccess, requireCxPreviewAccess } from "@/lib/hackathon/cx-preview-access"
import { assertIntegrationPreviewBody, assertIntegrationPreviewOrigin, assertIntegrationPreviewTarget, grantIntegrationPreviewAccess, integrationPreviewBody, integrationPreviewRouteAllowed, requireIntegrationPreviewAccess, requiresIntegrationPreviewAccess } from "@/lib/hackathon/integration-preview-access"
import { isHostedSuiProfile, hostedSuiRouteAllowed, assertHostedSuiBody } from "@/lib/hackathon/hosted-sui-profile"
import { assertHostedSuiTarget, assertHostedSuiOrigin, requireHostedSuiAccess, grantHostedSuiAccess } from "@/lib/hackathon/hosted-sui-access"
import { isGuideProductionProfile } from "@/lib/hackathon/guide-production-profile"
import { assertGuideProductionTarget, assertGuideProductionOrigin, requireGuideProductionAccess, grantGuideProductionAccess, guideProductionRouteAllowed, assertGuideProductionBody } from "@/lib/hackathon/guide-production-access"
import { isGuideJourney } from "@/lib/hackathon/guide-contract"
import { jitIdentity } from "@/lib/hackathon/jit-identity"
import { jitIdentityRouteAllowed, assertJitIdentityBody } from "@/lib/hackathon/jit-identity-routes"
import { refreshJitImportedIdentity } from "@/lib/hackathon/jit-identity-import"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// Sui build+execute+verify chains several RPC round trips; give the function headroom on Vercel.
export const maxDuration = 60

type Ctx = { params: Promise<{ path: string[] }> }

function cxProjection(data: unknown): unknown {
  if (!isCxPreview() || !data || typeof data !== "object") return data
  const value = data as Record<string, unknown>
  if (value.operation) return { ...value, operation: cxProjection(value.operation) }
  if (!value.operationId) return data
  const identity = value.identity as Record<string, unknown> | null
  const verified = identity?.mode === "cx" && identity.personVerified === true
  return { ...value,
    identity: identity ? { ...identity, subjectRef: "", providerTransactionRef: "" } : null,
    allowedActions: verified ? ["return"] : value.allowedActions,
    safeNextAction: verified ? "return" : value.safeNextAction,
  }
}
function json(data: unknown, status = 200) { return NextResponse.json(cxProjection(data), { status, headers: { "cache-control": "no-store" } }) }
function err(e: unknown) {
  const failure = safeHkError(e, { cxPreview: isCxPreview() })
  return json({ error: failure.error }, failure.status)
}
async function body(req: Request): Promise<Record<string, unknown>> {
  try { const b = await req.json(); return b && typeof b === "object" ? b : {} } catch { return {} }
}
const str = (v: unknown, max = 4096) => (typeof v === "string" && v.length <= max ? v : "")
const locale = (v: unknown): "ko" | "en" | "ja" => (v === "en" || v === "ja" ? v : "ko")

function venueCtx(venueId: string, loc: "ko" | "en" | "ja") {
  const v = canonicalMapVenueById(venueId)
  return { venueName: v?.name?.ko ?? venueId, category: String(v?.primaryCategory ?? "restaurant"), district: String(v?.districtId ?? ""), locale: loc }
}

export async function GET(req: Request, ctx: Ctx) {
  const requestedPath = (await ctx.params).path
  // Public fixed readiness summary. No session/provider request or credential
  // is created; eligible integration profiles may read committed budget state.
  if (req.method === "GET" && requestedPath.length === 2 && requestedPath[0] === "guide" && requestedPath[1] === "readiness" &&
    !new URL(req.url).search && !new URL(req.url).hash && process.env.HK_API_ENABLED === "1" && process.env.NEXT_PUBLIC_HK_ENABLED === "1") {
    return json(await guideReadiness())
  }
  if (isGuideProductionProfile()) {
    try {
      assertGuideProductionTarget(req)
      if (!guideProductionRouteAllowed(req.method, requestedPath) || new URL(req.url).search || new URL(req.url).hash) throw new HkError("guide_production_scope", "Guide scope required", 403)
      requireGuideProductionAccess(req)
    } catch (e) { return err(e) }
  }
  if (isHostedSuiProfile()) {
    try {
      assertHostedSuiTarget(req)
      const { path } = await ctx.params
      if (!hostedSuiRouteAllowed(req.method, path) || new URL(req.url).search || new URL(req.url).hash) return json({ error: { code: "hosted_sui_scope" } }, 403)
      requireHostedSuiAccess(req)
    } catch (e) { return err(e) }
  }
  // The integration branch is locked even if its public flag was omitted.
  // This boundary must precede every other profile/session/provider branch.
  if (requiresIntegrationPreviewAccess()) {
    try {
      assertIntegrationPreviewTarget(req)
      const { path } = await ctx.params
      if (!integrationPreviewRouteAllowed(req.method, path) || new URL(req.url).search || new URL(req.url).hash) return json({ error: { code: "integration_preview_scope" } }, 403)
      requireIntegrationPreviewAccess(req)
    } catch (e) { return err(e) }
  }
  if (isCxPreview()) {
    try {
      assertCxPreviewTarget(req)
      const { path } = await ctx.params
      if (!cxPreviewRouteAllowed(req.method, path) || new URL(req.url).search) return json({ error: { code: "cx_preview_scope" } }, 403)
      requireCxPreviewAccess(req)
    } catch (e) { return err(e) }
  }
  // Before runtime flags, session access or service work. Build flags alone
  // do not populate Vercel's server runtime environment.
  if (isReadinessPreview()) {
    const { path } = await ctx.params
    // One temporary public-catalogue GET from the actual Preview function.
    // Never creates a provider transaction or accesses identity/session data.
    if (path.length === 2 && path[0] === "readiness" && path[1] === "cx") return cxReadinessResponse(req)
    return path.length === 1 && path[0] === "config"
      ? json(hkPublicConfig())
      : previewReadOnlyResponse()
  }
  if (process.env.HK_API_ENABLED !== "1" || process.env.NEXT_PUBLIC_HK_ENABLED !== "1") return json({ error: { code: "not_found" } }, 404)
  const { path } = await ctx.params
  try {
    if (path[0] === "identity" && jitIdentityRouteAllowed("GET", path)) {
      if (path[1] === "eligibility") return json(await jitIdentity.eligibility((await getSession())?.sessionId ?? null))
      const s = await requireSession()
      return json(path[3] === "receipt" ? await jitIdentity.receipt(s.sessionId, path[2]) : await jitIdentity.get(s.sessionId, path[2]))
    }
    if (path.length === 2 && path[0] === "guide" && path[1] === "collection") {
      const s = await requireSession()
      return json(await svc.guideCollection(s.sessionId))
    }
    if (path[0] === "config") {
      const config = hkPublicConfig()
      if (isGuideProductionProfile()) {
        const ready = (await guideReadiness()).ready
        return json({ ...config, capabilities: { opendidProviderReady: ready, chainExecutionEnabled: ready, redemptionEnabled: ready } })
      }
      return json(config)
    }
    if (path[0] === "me") { const s = await ensureSession(); return json({ sessionId: s.sessionId.slice(0, 8) + "…", hasSubject: Boolean(s.subjectRef) }) }
    if (path[0] === "places" && path[2] === "demo-entitlements") {
      const s = await ensureSession()
      const cfg = hkPublicConfig()
      if (path[1] !== cfg.campaign.venueId) return json({ supported: false, campaign: null, operation: null })
      // Only an in-progress operation is resumable; finished ones stay reachable via /operations/{id} and the evidence screen.
      const live = await readStore((db) => {
        const op = Object.values(db.operations).filter((o) => o.kind !== "identity_check" && o.sessionId === s.sessionId && o.campaignId === cfg.campaign.campaignId && o.status === "pending").sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
        if (op) refreshJitImportedIdentity(db, op)
        return op
      })
      const redeemed = await readStore((db) => (s.subjectRef ? db.redemptions[`${s.subjectRef}::${cfg.campaign.campaignId}`] ?? null : null))
      return json({ supported: true, campaign: cfg.campaign, modes: cfg.modes, consentVersion: HK_CONSENT_VERSION, operation: live ? svc.toResult(live) : null, redeemed: redeemed ? { redemptionRef: redeemed.redemptionRef, redeemedAt: redeemed.redeemedAt } : null })
    }
    if (path[0] === "operations" && path[1]) {
      const s = await requireSession()
      const op = await svc.loadOperation(s.sessionId, path[1])
      if (isGuideProductionProfile() && !isGuideJourney(op)) throw new HkError("guide_production_scope", "Guide scope required", 403)
      if (path[2] === "evidence") return json(svc.evidence(op))
      return json(svc.toResult(op))
    }
    if (path[0] === "zklogin" && path[1] === "params") {
      const epoch = zkLoginConfigured() ? await currentEpoch() : 0
      return json({ configured: zkLoginConfigured(), googleClientId: hkPublicConfig().sui.googleClientId, maxEpoch: epoch + 2, epoch })
    }
    return json({ error: { code: "not_found" } }, 404)
  } catch (e) { return err(e) }
}

export async function POST(req: Request, ctx: Ctx) {
  let checkedBody: Record<string, unknown> | undefined
  const guideProduction = isGuideProductionProfile()
  if (guideProduction) {
    try {
      assertGuideProductionTarget(req)
      const { path } = await ctx.params
      if (!guideProductionRouteAllowed(req.method, path) || new URL(req.url).search || new URL(req.url).hash) throw new HkError("guide_production_scope", "Guide scope required", 403)
      assertGuideProductionOrigin(req)
      if (path[0] === "guide" && path[1] === "access") {
        const b = await integrationPreviewBody(req)
        assertGuideProductionBody(path, b)
        return grantGuideProductionAccess(req, b.accessCode)
      }
      requireGuideProductionAccess(req)
      checkedBody = await integrationPreviewBody(req)
      assertGuideProductionBody(path, checkedBody)
    } catch (e) { return err(e) }
  }
  const hostedSui = isHostedSuiProfile()
  if (hostedSui) {
    try {
      assertHostedSuiTarget(req)
      const { path } = await ctx.params
      if (!hostedSuiRouteAllowed(req.method, path) || new URL(req.url).search || new URL(req.url).hash) return json({ error: { code: "hosted_sui_scope" } }, 403)
      assertHostedSuiOrigin(req)
      if (path[0] === "hosted") {
        const b = await integrationPreviewBody(req)
        assertHostedSuiBody(path, b)
        return grantHostedSuiAccess(req, b.accessCode)
      }
      requireHostedSuiAccess(req)
      checkedBody = await integrationPreviewBody(req)
      assertHostedSuiBody(path, checkedBody)
    } catch (e) { return err(e) }
  }
  const integrationPreview = requiresIntegrationPreviewAccess()
  if (integrationPreview) {
    try {
      assertIntegrationPreviewTarget(req)
      const { path } = await ctx.params
      if (!integrationPreviewRouteAllowed(req.method, path) || new URL(req.url).search || new URL(req.url).hash) return json({ error: { code: "integration_preview_scope" } }, 403)
      assertIntegrationPreviewOrigin(req)
      if (path[0] === "integration") {
        const b = await integrationPreviewBody(req)
        assertIntegrationPreviewBody(path, b)
        return grantIntegrationPreviewAccess(req, b.accessCode)
      }
      requireIntegrationPreviewAccess(req)
      checkedBody = await integrationPreviewBody(req)
      assertIntegrationPreviewBody(path, checkedBody)
    } catch (e) { return err(e) }
  }
  if (isReadinessPreview()) return previewReadOnlyResponse()
  if (isCxPreview()) {
    try {
      assertCxPreviewTarget(req)
      const { path } = await ctx.params
      if (!cxPreviewRouteAllowed(req.method, path) || new URL(req.url).search) return json({ error: { code: "cx_preview_scope" } }, 403)
      assertCxPreviewOrigin(req)
      if (path[0] === "preview") {
        const b = await cxPreviewBody(req)
        if (Object.keys(b).some(key => key !== "accessCode")) return json({ error: { code: "bad_request" } }, 400)
        return grantCxPreviewAccess(req, b.accessCode)
      }
      requireCxPreviewAccess(req)
      checkedBody = await cxPreviewBody(req)
      const fields = path.length === 1 && path[0] === "operations" ? ["venueId", "consentVersion", "locale"]
        : path[3] === "start" ? ["mobile"] : []
      if (Object.keys(checkedBody).some(key => !fields.includes(key)) ||
        (path[3] === "start" && typeof checkedBody.mobile !== "boolean")) {
        return json({ error: { code: "cx_preview_body", message: "Only the identity preview request is accepted." } }, 400)
      }
    } catch (e) { return err(e) }
  }
  if (process.env.HK_API_ENABLED !== "1" || process.env.NEXT_PUBLIC_HK_ENABLED !== "1") return json({ error: { code: "not_found" } }, 404)
  const { path } = await ctx.params
  try {
    // Integration already required exact Origin + immutable proxy agreement.
    if (!integrationPreview && !hostedSui && !guideProduction) await assertSameOrigin()
    if (path[0] === "identity" && jitIdentityRouteAllowed("POST", path)) {
      const b = checkedBody ?? await integrationPreviewBody(req)
      assertJitIdentityBody(path, b)
      const s = path.length === 2 ? await ensureSession() : await requireSession()
      if (path.length === 2) return json(await jitIdentity.create(s.sessionId, b))
      if (path[1] === "authorizations") return json(await jitIdentity.consume(s.sessionId, path[2], b))
      if (path[3] === "start") return json(await jitIdentity.start(s.sessionId, path[2], b.mobile as boolean))
      if (path[3] === "complete") return json(await jitIdentity.complete(s.sessionId, path[2]))
      return json(await jitIdentity.cancel(s.sessionId, path[2]))
    }
    if (path[0] === "sessions") { const s = await ensureSession(); return json({ ok: true, sessionId: s.sessionId.slice(0, 8) + "…" }) }
    if (path[0] === "zklogin" && path[1] === "prove") {
      const b = checkedBody ?? await body(req)
      const out = await proveZkLogin({ jwt: str(b.jwt, 8192), extendedEphemeralPublicKey: str(b.extendedEphemeralPublicKey, 512), maxEpoch: Number(b.maxEpoch), jwtRandomness: str(b.jwtRandomness, 128) })
      return json({ address: out.address, inputs: out.inputs, maxEpoch: Number(b.maxEpoch) })
    }
    const s = await ensureSession()
    if (path.length === 2 && path[0] === "guide" && path[1] === "operations") {
      const b = checkedBody ?? await integrationPreviewBody(req)
      if (Object.keys(b).some(key => !["venueId", "consentVersion", "locale"].includes(key))) throw new HkError("bad_request", "Invalid guide request", 400)
      const venueId = str(b.venueId, 120), vc = venueCtx(venueId, locale(b.locale))
      return json(await svc.createOperation({ sessionId: s.sessionId, venueId, consentVersion: str(b.consentVersion, 64), locale: vc.locale, venueName: vc.venueName }, true))
    }
    if (path[0] === "operations" && !path[1]) {
      const b = checkedBody ?? await body(req)
      const venueId = str(b.venueId, 120)
      const vc = venueCtx(venueId, locale(b.locale))
      if (Boolean(b.identityAuthorizationRef) !== Boolean(b.identityContextDigest)) throw new HkError("bad_request", "Incomplete identity approval", 400)
      return json(await svc.createOperation({ sessionId: s.sessionId, venueId, consentVersion: str(b.consentVersion, 64), locale: vc.locale, venueName: vc.venueName,
        ...(b.identityAuthorizationRef ? { identityAuthorizationRef: str(b.identityAuthorizationRef, 80), identityContextDigest: str(b.identityContextDigest, 80) } : {}) }))
    }
    if (path[0] === "operations" && path[1]) {
      const id = path[1]; const action = path.slice(2).join("/")
      if (guideProduction && !isGuideJourney(await svc.loadOperation(s.sessionId, id))) throw new HkError("guide_production_scope", "Guide scope required", 403)
      const b = checkedBody ?? await (path[2] === "provider" ? integrationPreviewBody(req) : body(req))
      switch (action) {
        case "provider/issuance/start": case "provider/issuance/refresh":
        case "provider/presentation/start": case "provider/presentation/refresh": case "provider/cancel": {
          if (Object.keys(b).length) throw new HkError("bad_request", "Provider actions do not accept client claims", 400)
          const result = await providerOperationAction(s.sessionId, id, action.slice("provider/".length) as "issuance/start" | "issuance/refresh" | "presentation/start" | "presentation/refresh" | "cancel")
          return json({ operation: svc.toResult(result.record), provider: result.provider })
        }
        case "identity/start": return json(await svc.identityStart(s.sessionId, id, Boolean(b.mobile)))
        case "identity/complete": {
          const sample = b.sample && typeof b.sample === "object" ? { outcome: (["verified", "cancelled", "failed", "expired"].includes(String((b.sample as { outcome?: string }).outcome)) ? String((b.sample as { outcome?: string }).outcome) : "verified") as "verified" | "cancelled" | "failed" | "expired", subjectSeed: str((b.sample as { subjectSeed?: string }).subjectSeed, 64) || "sample-person-1" } : undefined
          return json(await svc.identityComplete(s.sessionId, id, sample))
        }
        case "credential/issue": {
          const alg = b.alg === "ECDSA-P256" ? "ECDSA-P256" : "Ed25519"
          return json(await svc.credentialIssue(s.sessionId, id, { publicKeyPem: str(b.publicKeyPem, 1200), alg }))
        }
        case "credential/holder-ack": return json(await svc.credentialHolderAck(s.sessionId, id, { signatureB64: str(b.signatureB64, 512) }))
        case "presentation/request": return json(await svc.presentationRequest(s.sessionId, id))
        case "presentation/submit": return json(await svc.presentationSubmit(s.sessionId, id, { presentationId: str(b.presentationId, 64), disclosed: b.disclosed && typeof b.disclosed === "object" ? (b.disclosed as Record<string, unknown>) : {}, signatureB64: str(b.signatureB64, 512) }))
        case "presentation/deny": return json(await svc.presentationDeny(s.sessionId, id))
        case "proposal": { const op = await svc.loadOperation(s.sessionId, id); return json(await svc.proposalCreate(s.sessionId, id, venueCtx(op.venueId, locale(b.locale)))) }
        case "delegation/prepare": return json(await svc.delegationPrepare(s.sessionId, id, { userAddress: str(b.userAddress, 70), signer: b.signer === "zklogin" ? "zklogin" : "demo", walletProof: { message: str((b.walletProof as { message?: string })?.message, 256), signature: str((b.walletProof as { signature?: string })?.signature, 4096) }, approvedProposalDigest: str(b.approvedProposalDigest, 80) }))
        case "delegation/submit": return json(await svc.delegationSubmit(s.sessionId, id, { txBytesDigest: str(b.txBytesDigest, 80), userSignature: str(b.userSignature, 8192) }))
        case "agent/run": return json(await svc.agentRun(s.sessionId, id))
        case "redeem": return json(await svc.redeem(s.sessionId, id, { idempotencyKey: str(b.idempotencyKey, 80) || "default", bodyDigest: digestOf({ idempotencyKey: b.idempotencyKey ?? "default" }) }))
        case "cancel": return json(await svc.cancel(s.sessionId, id))
        case "reconcile": return json(await svc.reconcile(s.sessionId, id))
        case "sui/agent-address": {
          await svc.loadOperation(s.sessionId, id)
          return json({ agent: svc.chainAgentAddress() })
        }
        default: return json({ error: { code: "not_found", message: "The requested action could not be found." } }, 404)
      }
    }
    return json({ error: { code: "not_found" } }, 404)
  } catch (e) { return err(e) }
}
