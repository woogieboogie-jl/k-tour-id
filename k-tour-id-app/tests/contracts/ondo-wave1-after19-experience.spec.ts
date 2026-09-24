import { readFileSync } from "node:fs"
import { expect, test } from "@playwright/test"
import {
  completeGlobalAfter19LocalConfirmationB,
  completeGlobalAfter19ReviewB,
  recordGlobalAfter19ReviewEligibilityB,
  sanitizeGlobalAfter19Session,
} from "../../features/ondo/after19/after19-global-b-model"
import { createReviewFixtureAuthority, localActual, reviewFixture } from "../../features/ondo/contracts/execution-mode"

const source = (path: string) => readFileSync(path, "utf8")
const NOW = new Date("2026-09-03T12:00:00.000Z")

function ageReview() {
  const authority = createReviewFixtureAuthority({
    qaRuntimeEnabled: true,
    explicitlyRequested: true,
    fixtureId: "FX-AGE-GLOBAL-001",
  })
  if (!authority) throw new Error("Missing explicit review authority")
  return reviewFixture(authority, {
    outcome: "success",
    value: { predicate: "AGE_GTE_19" as const, outcome: "eligible" as const },
    now: NOW,
  })
}

test("W1-AFTER19-001 normal route creates only an explicit local night-view declaration", () => {
  const ui = source("features/ondo/after19/after19-global-b.tsx")
  const model = source("features/ondo/after19/after19-global-b-model.ts")

  expect(ui).toContain('if (!qaOutcome)')
  expect(ui).toContain('localActual("age_declaration"')
  expect(ui).toContain('providerUnavailable("age")')
  expect(ui).toContain('setGateView("unavailable")')
  expect(ui).toContain('qaOutcome !== "success"')
  expect(ui).toContain("completeGlobalAfter19ReviewB(execution, completedAt)")
  expect(ui).toContain("completeGlobalAfter19LocalConfirmationB(execution, completedAt)")
  expect(ui).toContain('setGateView("pending")')
  expect(model).toContain('issuerType: "LOCAL_DECLARATION"')
  expect(model).toContain('provenanceTruth: "SELF_DECLARED"')
  expect(model).not.toMatch(/LOCAL_SELF_ATTESTATION|recordGlobalAfter19AgeEligibilityB|completeGlobalAfter19AgeB/)

  const local = completeGlobalAfter19LocalConfirmationB(localActual("age_declaration", {
    predicate: "AGE_GTE_19" as const,
    outcome: "eligible" as const,
  }), NOW)
  expect(sanitizeGlobalAfter19Session(local, NOW)).toEqual(local)
})

test("W1-AFTER19-002 a review result remains review-only across storage restoration", () => {
  const eligible = recordGlobalAfter19ReviewEligibilityB(ageReview(), NOW)
  const active = completeGlobalAfter19ReviewB(ageReview(), NOW)
  const canonicalPlace = source("features/ondo/place/canonical-place-overlay.tsx")
  const globalAfter19 = source("features/ondo/after19/after19-global-b.tsx")

  expect(active).toMatchObject({
    age: "eligible",
    mode: "on",
    eligibilityReceipt: {
      issuerType: "REVIEW_FIXTURE",
      provenanceTruth: "SIMULATED",
      fixtureId: "FX-AGE-GLOBAL-001",
    },
  })
  expect(sanitizeGlobalAfter19Session(eligible, NOW).age).toBe("unverified")
  expect(sanitizeGlobalAfter19Session(eligible, NOW, { allowReviewFixture: true }).age).toBe("eligible")
  expect(sanitizeGlobalAfter19Session(active, NOW).mode).toBe("off")
  expect(sanitizeGlobalAfter19Session(active, NOW, { allowReviewFixture: true })).toMatchObject({ age: "eligible", mode: "on" })
  expect(globalAfter19).toContain("writeGuestAfter19MemoryB(detail, now, { allowReviewFixture: reviewMode })")
  expect(canonicalPlace).toContain("sanitizeGlobalAfter19Session(detail, now, qaReviewFixtureOptions())")
  expect(canonicalPlace).not.toMatch(/\? sanitizeGlobalAfter19Session\(detail\)\s*:/)
})

test("W1-AFTER19-003 unavailable is a map escape, not a retry that becomes success", () => {
  const ui = source("features/ondo/after19/after19-global-b.tsx")

  expect(ui).toContain('data-testid={escapeOnly ? "global-after19-general"')
  expect(ui).toContain("onClick={escapeOnly ? cancelGate")
  expect(ui).toContain("{!escapeOnly ? <button")
  expect(ui).toContain("const expiredWithoutReview = returnExpired && !reviewRequested")
  expect(ui).not.toContain("consumedQaOutcomeRef")
})

test("W1-AFTER19-004 exact Place context is validated before success consumption", () => {
  const ui = source("features/ondo/after19/after19-global-b.tsx")
  const returnModel = source("features/ondo/after19/after19-place-return-b-model.ts")

  expect(ui).toContain("if (!venue)")
  expect(ui).toContain('finishPlaceReturn("cancel", completedAt)')
  expect(ui.indexOf("const completed = completePlaceAfter19Return")).toBeLessThan(ui.indexOf("const exactVenue = restorePlaceContext(placeReturn)"))
  expect(returnModel).toContain("consumePendingPlaceAfter19Return")
  expect(returnModel).toContain("createReturnToConsumptionExpectation")
  expect(returnModel).toContain("consumeReturnToOnce")
  expect(returnModel).toContain("publicExpectation.snapshotHash !== callerExpectation.snapshotHash")
  expect(returnModel).toContain("privateUiExpectation !== hashPlaceReturnUiSnapshot(privateUiSnapshot)")
})

test("W1-AFTER19-005 the first mobile decision stays concise and non-technical", () => {
  const ui = source("features/ondo/after19/after19-global-b.tsx")
  const css = source("features/ondo/after19/after19-global-b.module.css")

  for (const phrase of [
    'title: "Night view"',
    'title: "밤 지도"',
    'title: "夜の地図"',
    'primary: "I’m 19 or older"',
    'primary: "만 19세 이상이에요"',
    'primary: "19歳以上です"',
    'generalMap: "Keep browsing"',
    'generalPlace: "View general details"',
  ]) expect(ui).toContain(phrase)
  expect(ui).toContain("<details className={styles.boundary}>")
  expect(ui).toContain('data-testid="global-after19-close"')
  expect(ui).toContain('gateView === "pending" ? t.checkingTitle')
  expect(ui).toContain('data-single-action={gateView === "pending" || escapeOnly ? "true" : "false"}')
  expect(ui).toContain('data-review-result={reviewResult ? "true" : "false"}')
  expect(ui).not.toContain('className={styles.reviewBadge}')
  expect(ui).toContain('<small>{session.activation === "auto" ? t.activeAuto : t.activeManual} · {context.cityLabel}</small>')
  for (const badge of ['reviewResult: "Review result · no external check"', 'reviewResult: "검토용 결과 · 외부 확인 없음"', 'reviewResult: "レビュー用結果 · 外部確認なし"']) {
    expect(ui).toContain(badge)
  }
  expect(css).not.toContain(".reviewBadge")
  expect(ui).toContain('className={styles.activeGlyph}')
  expect(css).toContain("display: inline-flex")
  expect(ui).toContain('data-testid="global-after19-review-provenance"')
  expect(ui).toContain('data-testid="global-after19-review-scope"')
  expect(ui).toContain("reviewRequested && !reviewResult")
  expect(ui).toMatch(/Review only · no external check|검토 전용 · 외부 확인 없음|レビュー専用 · 外部確認なし/)
  expect(ui).toContain("SIMULATED")
  expect(ui).not.toMatch(/No provider is connected|Local confirmation only|private predicate check/)
})

test("W1-AFTER19-006 review provenance is an explicit anchored disclosure with exact focus return", () => {
  const ui = source("features/ondo/after19/after19-global-b.tsx")
  const css = source("features/ondo/after19/after19-global-b.module.css")

  expect(ui).toContain('data-testid="global-after19-review-toggle"')
  expect(ui).toContain('aria-expanded={reviewDetailsOpen}')
  expect(ui).toContain('aria-controls={reviewDetailsOpen ? "global-after19-review-details" : undefined}')
  expect(ui).toContain('{reviewDetailsOpen && reviewResult && reviewReceipt ? (')
  expect(ui).toContain('id="global-after19-review-details"')
  expect(ui).toContain('aria-labelledby="global-after19-review-details-title"')
  expect(ui).toContain('<div><dt>{t.reviewMode}</dt><dd>SIMULATED</dd></div>')
  expect(ui).toContain('<div><dt>{t.reviewReference}</dt><dd>{reviewReceipt.fixtureId}</dd></div>')
  expect(ui).toContain('new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" })')
  expect(ui).not.toMatch(/data-after19-(?:age-expires-at|predicate|issuer-type|provenance|fixture-id)=/)

  expect(ui).toContain('reviewDetailsCloseRef.current?.focus({ preventScroll: true })')
  expect(ui).toContain('event.key !== "Escape" || !reviewDetailsRef.current?.contains(document.activeElement)')
  // Review-detail close restores the explicit review trigger when it still
  // exists, then resolves the external opener only when this layer is trigger-
  // hidden. Gate teardown uses the broader helper below, including the map
  // options/view-toggle fallbacks when the original trigger was removed.
  expect(ui).toContain('const target = reviewToggleRef.current ?? (returnFocusSelector ? resolveExternalOpener() : null)')
  expect(ui).toContain('target?.focus({ preventScroll: true })')
  expect(ui).toContain('window.requestAnimationFrame(() => {\n      const target = reviewToggleRef.current ?? (returnFocusSelector ? resolveExternalOpener() : null)')
  expect(ui).toContain('plan.kind === "active-control" ? "[data-testid=\'global-after19-review-toggle\']" : null')
  expect(ui).toContain('plan.kind === "active-control" ? "[data-testid=\'global-after19-banner\'] button" : null')
  expect(ui).toContain('"[data-testid=\'global-after19-toggle\']"')
  expect(ui).toContain('"[data-testid=\'ondo-b-view-toggle\']"')
  expect(ui).toContain('.find(isVisibleDestination)')
  expect(ui).toContain('focusVisibleDestination(destination)')
  expect(ui).toContain('frame = window.requestAnimationFrame(restoreAfterRemoval)')
  expect(ui).toContain('reviewContextRef.current === nextContext')
  expect(ui).toContain('[context.cityId, context.venueId]')
  expect(ui).toContain('if (!reviewDetailsOpen || (session.mode === "on" && reviewResult)) return')
  expect(ui).toContain('[reviewDetailsOpen, reviewResult, session.mode]')
  expect(ui).toContain('closeReviewDetails(false)')
  expect(ui).toContain('data-testid="global-after19-turn-off"')

  const disclosureStart = ui.indexOf('id="global-after19-review-details"')
  const disclosureEnd = ui.indexOf("</section>", disclosureStart)
  const disclosure = ui.slice(disclosureStart, disclosureEnd)
  expect(disclosure).not.toMatch(/role="dialog"|aria-modal|backdrop/i)

  expect(css).toContain("position: absolute")
  expect(css).toContain("top: calc(100% + 8px)")
  expect(css).toContain("max-height: min(64dvh, 360px)")
  expect(css).toContain("min-height: 44px")
  expect(css).toContain("pointer-events: auto")
  for (const copy of [
    'reviewDetailsTitle: "Review details"',
    'reviewDetailsTitle: "검토 정보"',
    'reviewDetailsTitle: "レビュー情報"',
    'reviewExpires: "Expires"',
    'reviewExpires: "만료"',
    'reviewExpires: "有効期限"',
  ]) expect(ui).toContain(copy)
})
