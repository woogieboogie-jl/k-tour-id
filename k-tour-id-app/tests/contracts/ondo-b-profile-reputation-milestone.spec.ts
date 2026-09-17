import { expect, test } from "@playwright/test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { applyBActivityReviewFixture, restoreBActivityProfile } from "../../features/ondo/identity-b/activity-profile-b-provider"

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8")

test("B-PROFILE-001 optional profile sanitizes every consented field and never imports identity nationality", () => {
  const restored = restoreBActivityProfile({
    profile: {
      displayName: "  Mina   Park  ",
      from: { value: "  Canada  ", consent: true },
      livesIn: { value: "Seoul", consent: false },
      languages: { value: ["English", "日本語", "English", 91], consent: true },
      nationality: "must-not-copy",
      dateOfBirth: "must-not-copy",
    },
  })

  expect(restored.profile).toEqual({
    displayName: "Mina Park",
    from: { value: "Canada", consent: true },
    livesIn: { value: "Seoul", consent: false },
    languages: { value: ["English", "日本語"], consent: true },
  })
  expect(restored.profile).not.toHaveProperty("nationality")
  expect(restored.profile).not.toHaveProperty("dateOfBirth")
})

test("B-PROFILE-002 serialized activity cannot self-assert; the explicit in-memory review harness stays bounded", () => {
  const forged = restoreBActivityProfile({
    reputation: {
      identity: "verified",
      visit: "repeat",
      contribution: "established",
      meetup: "reliable",
      trustScore: 99,
    },
    stamps: 99,
    acceptedEvidenceIds: [
      "visit:seoul-seongsu-gukbap",
      "visit:seoul-seongsu-gukbap",
      "contribution:tip-1",
      "payment:must-not-count",
    ],
  })

  expect(forged.reputation).toEqual({ visit: "new", contribution: "new", meetup: "new" })
  expect(forged.stamps).toBe(0)
  expect(forged.acceptedEvidenceIds).toEqual([])

  const reviewEvent = (evidenceId: string, axes: ("visit" | "contribution" | "meetup")[], addVisitStamp: boolean) => ({ evidenceId, axes, addVisitStamp })
  const mounted = applyBActivityReviewFixture([
    ...Array.from({ length: 10 }, (_, index) => reviewEvent(`visit:qa-${index + 1}`, ["visit"], true)),
    reviewEvent("contribution:qa-1", ["contribution"], false),
    reviewEvent("contribution:qa-2", ["contribution"], false),
    reviewEvent("meetup:qa-1", ["meetup"], false),
  ])
  expect(mounted.reputation).toEqual({ visit: "repeat", contribution: "established", meetup: "reliable" })
  expect(mounted.reputation).not.toHaveProperty("identity")
  expect(mounted.reputation).not.toHaveProperty("trustScore")
  expect(mounted.stamps).toBe(10)
  expect(mounted.acceptedEvidenceIds).toHaveLength(13)
})

test("B-PROFILE-003 B activity is session-only, idempotent by evidence, and payment cannot increment a stamp", () => {
  const provider = source("features/ondo/identity-b/activity-profile-b-provider.tsx")
  const surface = source("features/ondo/identity-b/profile-reputation-b.tsx")
  const journey = source("features/ondo/identity-b/journey-stamps-b.tsx")
  const visitReceipt = source("features/ondo/commerce-b/visit-stamp-receipt-b.tsx")

  expect(provider).toContain('B_ACTIVITY_PROFILE_SESSION_KEY = "ondo-b.activity-profile.v1"')
  expect(provider).toContain('LEGACY_SESSION_KEY = "ondo.session.v3"')
  expect(provider).toContain("current.acceptedEvidenceIds.includes(mutation.evidenceId)")
  expect(provider).toContain('recordUniqueVisit: (evidenceId) => hasQaSessionOptIn()')
  expect(provider).toContain('? record({ evidenceId, axes: ["visit"], addVisitStamp: true })')
  expect(provider).not.toContain("localStorage")
  expect(provider).not.toMatch(/record\("payment"|payment.*stamps|stamps.*payment/i)
  expect(surface).toContain('data-testid="ondo-profile-panel"')
  expect(surface).toContain('data-testid="ondo-trust-panel"')
  expect(surface).not.toContain('data-testid="ondo-b-stamp-milestone"')
  expect(journey).toContain('data-testid="ondo-b-stamp-milestone"')
  expect(journey).toContain('data-testid="open-labs-milestone"')
  expect(surface).toContain('ja: {')
  expect(visitReceipt).toContain('const evidenceId = `visit:${venueId}`')
  expect(visitReceipt).toContain('data-testid="visit-proof-check"')
  expect(visitReceipt).toContain('data-testid="checkout-stamp-milestone"')
  expect(visitReceipt).toContain('data-testid="visit-stamp-details"')
  expect(visitReceipt).toMatch(/<details className=\{styles\.details\}[\s\S]*<summary>\{copy\.details\}[\s\S]*<p>\{copy\.boundary\}<\/p>[\s\S]*<\/details>/)
  expect(visitReceipt).not.toContain('<small className={styles.boundary}>{copy.boundary}</small>')
  expect(visitReceipt).toContain("One stamp per place. No purchase needed.")
  expect(visitReceipt).toContain("결제 없이도 기록할 수 있어요")
  expect(visitReceipt).toContain("支払いなしで記録できます")
  expect(visitReceipt).toContain('details: "Privacy & visit details"')
  expect(visitReceipt).toContain('details: "개인정보 및 방문 기록 안내"')
  expect(visitReceipt).toContain('details: "プライバシー・訪問記録の詳細"')
})

test("B-PROFILE-004 profile owns the full responsive ID canvas in short landscape", () => {
  const traveler = source("features/ondo/identity-b/traveler-id-entry-b.tsx")
  const travelerStyles = source("features/ondo/identity-b/traveler-id-entry-b.module.css")
  const profileStyles = source("features/ondo/identity-b/profile-reputation-b.module.css")

  expect(traveler).toContain("styles.profilePane")
  expect(travelerStyles).toContain(".profilePane { min-width: 0; }")
  expect(travelerStyles).toMatch(/orientation:\s*landscape[\s\S]*\.profilePane\s*\{\s*grid-column:\s*1 \/ -1;\s*grid-row:\s*3;/)
  expect(profileStyles).toMatch(/orientation:\s*landscape[\s\S]*\.root\s*\{\s*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/)
})

test("B-PROFILE-005 mobile meaning compression keeps actions named and exact truths available", () => {
  const traveler = source("features/ondo/identity-b/traveler-id-entry-b.tsx")
  const travelerStyles = source("features/ondo/identity-b/traveler-id-entry-b.module.css")
  const profile = source("features/ondo/identity-b/profile-reputation-b.tsx")
  const profileStyles = source("features/ondo/identity-b/profile-reputation-b.module.css")

  for (const label of ["copy.checkPerson", "copy.checkAge", "copy.credentialOpen"]) {
    expect(traveler).toContain(`aria-label={${label}}`)
  }
  for (const axis of ["traveler-id-account", "traveler-id-person", "traveler-id-age", "traveler-id-credential", "traveler-id-payment"]) {
    expect(traveler).toContain(`data-testid="${axis}"`)
  }
  expect(travelerStyles).toMatch(/@media \(max-width:\s*430px\)[\s\S]*\.actionLabel\s*\{\s*display:\s*none/)
  expect(travelerStyles).toContain("@media (forced-colors: active)")

  for (const field of ["draft.shareFrom", "draft.shareLivesIn", "draft.shareLanguages"]) {
    expect(profile).toContain(`consent={${field}}`)
  }
  expect(profile).toContain('<summary aria-label={copy.privacy}>')
  expect(source("features/ondo/identity-b/journey-stamps-b.tsx")).toContain("copy.boundary")
  expect(profile).toContain("copy.historyBoundary")
  expect(profileStyles).toMatch(/@media \(max-width:\s*350px\)[\s\S]*\.consentField\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/)
  expect(profileStyles).toContain("@media (forced-colors: active)")
})
