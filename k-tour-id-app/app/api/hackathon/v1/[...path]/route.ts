// /api/hackathon/v1 — isolated BFF for the demo entitlement journey.
// Not a vendor API. Every mutating call is same-origin + session-bound.
import { NextResponse } from "next/server"
import { hkPublicConfig, HK_CONSENT_VERSION } from "@/lib/hackathon/config"
import { assertSameOrigin, ensureSession, requireSession } from "@/lib/hackathon/session"
import { HkError, digestOf } from "@/lib/hackathon/util"
import { readStore } from "@/lib/hackathon/store"
import * as svc from "@/lib/hackathon/service"
import { currentEpoch, suiKeys } from "@/lib/hackathon/adapters/sui"
import { proveZkLogin, zkLoginConfigured } from "@/lib/hackathon/adapters/zklogin"
import { canonicalMapVenueById } from "@/lib/ondo/venues/map-data"
import { isReadinessPreview, previewReadOnlyResponse } from "@/lib/hackathon/preview-readiness"
import { cxReadinessResponse } from "@/lib/hackathon/cx-readiness"
import { redisReadinessResponse } from "@/lib/hackathon/redis-readiness"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// Sui build+execute+verify chains several RPC round trips; give the function headroom on Vercel.
export const maxDuration = 60

type Ctx = { params: Promise<{ path: string[] }> }

function json(data: unknown, status = 200) { return NextResponse.json(data, { status, headers: { "cache-control": "no-store" } }) }
function err(e: unknown) {
  if (e instanceof HkError) return json({ error: { code: e.code, message: e.message, retryable: e.retryable } }, e.status)
  const message = e instanceof Error ? e.message : "unknown"
  console.error("[hackathon]", e)
  return json({ error: { code: "internal", message: message.slice(0, 300), retryable: true } }, 500)
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
    if (path[0] === "config") return json(hkPublicConfig())
    if (path[0] === "me") { const s = await ensureSession(); return json({ sessionId: s.sessionId.slice(0, 8) + "…", hasSubject: Boolean(s.subjectRef) }) }
    if (path[0] === "places" && path[2] === "demo-entitlements") {
      const s = await ensureSession()
      const cfg = hkPublicConfig()
      if (path[1] !== cfg.campaign.venueId) return json({ supported: false, campaign: null, operation: null })
      // Only an in-progress operation is resumable; finished ones stay reachable via /operations/{id} and the evidence screen.
      const live = await readStore((db) => Object.values(db.operations).filter((o) => o.sessionId === s.sessionId && o.campaignId === cfg.campaign.campaignId && o.status === "pending").sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null)
      const redeemed = await readStore((db) => (s.subjectRef ? db.redemptions[`${s.subjectRef}::${cfg.campaign.campaignId}`] ?? null : null))
      return json({ supported: true, campaign: cfg.campaign, modes: cfg.modes, consentVersion: HK_CONSENT_VERSION, operation: live ? svc.toResult(live) : null, redeemed: redeemed ? { redemptionRef: redeemed.redemptionRef, redeemedAt: redeemed.redeemedAt } : null })
    }
    if (path[0] === "operations" && path[1]) {
      const s = await requireSession()
      const op = await svc.loadOperation(s.sessionId, path[1])
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
  if (isReadinessPreview()) {
    const { path } = await ctx.params
    // Temporary operator-authenticated smoke: isolated TTL keys only. No app
    // session, provider, journey ledger, or signing/chain code is reachable.
    if (path.length === 2 && path[0] === "readiness" && path[1] === "redis") return redisReadinessResponse(req)
    return previewReadOnlyResponse()
  }
  if (process.env.HK_API_ENABLED !== "1" || process.env.NEXT_PUBLIC_HK_ENABLED !== "1") return json({ error: { code: "not_found" } }, 404)
  const { path } = await ctx.params
  try {
    await assertSameOrigin()
    if (path[0] === "sessions") { const s = await ensureSession(); return json({ ok: true, sessionId: s.sessionId.slice(0, 8) + "…" }) }
    if (path[0] === "zklogin" && path[1] === "prove") {
      const b = await body(req)
      const out = await proveZkLogin({ jwt: str(b.jwt, 8192), extendedEphemeralPublicKey: str(b.extendedEphemeralPublicKey, 512), maxEpoch: Number(b.maxEpoch), jwtRandomness: str(b.jwtRandomness, 128) })
      return json({ address: out.address, inputs: out.inputs, maxEpoch: Number(b.maxEpoch) })
    }
    const s = await ensureSession()
    if (path[0] === "operations" && !path[1]) {
      const b = await body(req)
      const venueId = str(b.venueId, 120)
      const vc = venueCtx(venueId, locale(b.locale))
      return json(await svc.createOperation({ sessionId: s.sessionId, venueId, consentVersion: str(b.consentVersion, 64), locale: vc.locale, venueName: vc.venueName }))
    }
    if (path[0] === "operations" && path[1]) {
      const id = path[1]; const action = path.slice(2).join("/"); const b = await body(req)
      switch (action) {
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
        case "sui/agent-address": return json({ agent: suiKeys().agentAddress })
        default: return json({ error: { code: "not_found", message: action } }, 404)
      }
    }
    return json({ error: { code: "not_found" } }, 404)
  } catch (e) { return err(e) }
}
