import type { JitIdentityEligibility } from "@/lib/hackathon/jit-identity-contract"

export type JitIdentityReadStateB = "loading" | "ready" | "unavailable"
export type Age19ReadinessB = "loading" | "unavailable" | "proof_required" | "not_verified" | "verified" | "expired"

/** Display only. This never authorizes After19 or infers 19+ from Person/AdultVerify. */
export function age19ReadinessB(status: JitIdentityEligibility | null, readState: JitIdentityReadStateB, now: number): Age19ReadinessB {
  if (readState === "loading") return "loading"
  if (readState !== "ready" || !status || status.execution !== "provider" || status.provider !== "omnione_cx") return "unavailable"
  const age = status.age19
  if (age.state !== "verified") return age.state
  const expiry = Date.parse(age.expiresAt ?? "")
  if (!Number.isFinite(now) || !Number.isFinite(expiry)) return "unavailable"
  return expiry > now ? "verified" : "expired"
}

const COPY = {
  ko: {
    loading: "19세 이상 상태 확인 중", unavailable: "19세 이상 상태를 확인할 수 없어요", proof_required: "19세 이상 확인 필요",
    not_verified: "19세 이상 결과가 확인되지 않았어요", verified: "19세 이상 확인됨 · OmniOne CX", expired: "19세 이상 확인 만료",
    guidance: "지도에서 After19를 열면 해당 목적에 별도로 동의하고 확인해요. 이 상태 표시만으로 야간 추천이 열리지는 않아요.",
  },
  en: {
    loading: "Checking 19+ status", unavailable: "19+ status unavailable", proof_required: "19+ check required",
    not_verified: "19+ result not confirmed", verified: "19+ confirmed · OmniOne CX", expired: "19+ check expired",
    guidance: "Open After19 on the map for separate purpose consent and verification. This status alone does not open night recommendations.",
  },
  ja: {
    loading: "19歳以上の状態を確認中", unavailable: "19歳以上の状態を確認できません", proof_required: "19歳以上の確認が必要",
    not_verified: "19歳以上の結果は未確認です", verified: "19歳以上を確認済み · OmniOne CX", expired: "19歳以上の確認は期限切れです",
    guidance: "地図のAfter19を開き、その目的に別途同意して確認します。この状態表示だけでは夜のおすすめは開きません。",
  },
} as const

export function age19ReadinessCopyB(locale: "ko" | "en" | "ja", state: Age19ReadinessB) {
  return { label: COPY[locale][state], guidance: COPY[locale].guidance }
}
