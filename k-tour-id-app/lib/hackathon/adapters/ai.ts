// Bounded AI proposal ("혜택 도우미"). The model only PROPOSES one allowed
// action for the designated venue/campaign; it never decides eligibility
// (DID verifier + server policy do) and cannot change target/recipient/amount.
// Inputs are de-identified (no VC, JWT, salt, keys, names). Output is
// schema-validated; anything outside the allowlist is rejected and recorded.
import { geminiGenerate } from "@/lib/gemini"
import { hkConfig } from "../config"
import { digestOf, nowIso, randomId } from "../util"
import type { ProposalOutput, ProposalSummary } from "../types"

const SYSTEM = `You are ONDO's perk assistant for a hackathon demo. You receive ONE venue and ONE campaign that a verified traveler is eligible for.
Return ONLY a JSON object with exactly these keys:
{"action":"redeem_demo_entitlement","target":{"venueId":"<given>","campaignId":"<given>"},"title":"<=40 chars","summary":"<=140 chars, what the traveler gets","rationale":"<=200 chars, why now","language":"ko|en|ja"}
Rules: action MUST be "redeem_demo_entitlement"; target MUST equal the given ids; no money amounts, no discounts, no reservations, no other venues; no personal data; write in the requested language. No markdown, no extra keys.`

function ruleProposal(input: ProposalInput): ProposalOutput {
  const t = input.language
  const name = input.venueName
  return {
    action: "redeem_demo_entitlement",
    target: { venueId: input.venueId, campaignId: input.campaignId },
    title: t === "ko" ? `${name} 체험 혜택` : t === "ja" ? `${name} 体験特典` : `${name} experience perk`,
    summary: t === "ko" ? "확인된 K-Tour 패스로 이 장소의 해커톤 체험 혜택을 1회 사용할 수 있어요." : t === "ja" ? "確認済みのK-Tourパスで、この場所のハッカソン体験特典を1回使えます。" : "Your verified K-Tour pass unlocks this place's one-time hackathon experience perk.",
    rationale: t === "ko" ? `${input.timeOfDay} 방문 기준으로 지금 사용하는 것이 좋아요. 금전 가치 없음.` : t === "ja" ? `${input.timeOfDay}の訪問なら今使うのがおすすめ。金銭価値はありません。` : `Best used during your ${input.timeOfDay} visit. No cash value.`,
    language: t,
  }
}

export type ProposalInput = { venueId: string; campaignId: string; venueName: string; category: string; district: string; language: "ko" | "en" | "ja"; timeOfDay: string; policyVersion: number }

const INJECTION = /(ignore (all|previous|prior)|system prompt|developer mode|transfer|send (sui|coin|token)|private key|seed phrase|amount|₩|\$\d|discount|refund|reservation)/i

function validate(raw: unknown, input: ProposalInput): { ok: true; output: ProposalOutput } | { ok: false; reason: string } {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "not_object" }
  const o = raw as Record<string, unknown>
  if (o.action !== "redeem_demo_entitlement") return { ok: false, reason: "action_not_allowed" }
  const target = o.target as Record<string, unknown> | undefined
  if (!target || target.venueId !== input.venueId || target.campaignId !== input.campaignId) return { ok: false, reason: "target_mismatch" }
  const str = (k: string, max: number) => typeof o[k] === "string" && (o[k] as string).trim().length > 0 && (o[k] as string).length <= max ? (o[k] as string).trim() : null
  const title = str("title", 60), summary = str("summary", 200), rationale = str("rationale", 260)
  if (!title || !summary || !rationale) return { ok: false, reason: "text_invalid" }
  if (INJECTION.test(`${title} ${summary} ${rationale}`)) return { ok: false, reason: "guard_tripped" }
  const language = o.language === "en" || o.language === "ja" ? o.language : "ko"
  return { ok: true, output: { action: "redeem_demo_entitlement", target: { venueId: input.venueId, campaignId: input.campaignId }, title, summary, rationale, language } }
}

export async function proposePerk(input: ProposalInput): Promise<ProposalSummary> {
  const c = hkConfig().ai
  const inputDigest = digestOf({ ...input, promptVersion: c.promptVersion })
  let output: ProposalOutput
  let mode: "gemini" | "rule" = c.mode
  let model = c.mode === "gemini" ? c.model : "rule-v1"
  let injectionSuspected = false, schemaValid = true
  if (c.mode === "gemini" && process.env.GEMINI_API_KEY) {
    const message = JSON.stringify({ venue: { id: input.venueId, name: input.venueName, category: input.category, district: input.district }, campaign: { id: input.campaignId, kind: "non_financial_experience_perk", usesLeft: 1 }, context: { timeOfDay: input.timeOfDay, language: input.language } })
    const res = await geminiGenerate({ key: process.env.GEMINI_API_KEY, system: SYSTEM, message, maxOutputTokens: 400, temperature: 0.3 })
    let parsed: unknown = null
    if (res.reply) { try { parsed = JSON.parse(res.reply.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim()) } catch { parsed = null } }
    const v = validate(parsed, input)
    if (v.ok) output = v.output
    else { schemaValid = false; injectionSuspected = v.reason === "guard_tripped"; output = ruleProposal(input); mode = "rule"; model = `rule-v1 (gemini rejected: ${v.reason})` }
  } else {
    output = ruleProposal(input)
    mode = "rule"; model = "rule-v1"
  }
  const outputDigest = digestOf(output)
  const proposalId = randomId("prop")
  const proposalDigest = digestOf({ proposalId, inputDigest, outputDigest, promptVersion: c.promptVersion, policyVersion: input.policyVersion, model })
  return { proposalId, mode, model, promptVersion: c.promptVersion, policyVersion: input.policyVersion, inputDigest, output, outputDigest, proposalDigest, createdAt: nowIso(), guard: { injectionSuspected, schemaValid } }
}
