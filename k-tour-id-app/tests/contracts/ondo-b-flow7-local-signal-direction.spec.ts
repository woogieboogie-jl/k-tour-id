import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { expect, test } from "@playwright/test"

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8")

test("FLOW7-DIR-001 Local Signal declares one Apple contribution and Strava completion grammar", () => {
  const signal = source("features/ondo/local-signal-b/local-signal-layer-b.tsx")
  const styles = source("features/ondo/local-signal-b/local-signal-layer-b.module.css")

  expect(signal).toContain('data-visual-direction="apple-contribution-strava"')
  expect(signal).toContain("data-signal-stage={flow.outcome}")
  expect(signal).toContain("data-photo-stage={photoStage}")
  expect(signal).toContain('data-testid="local-signal-photo-slot"')
  expect(signal).toContain("data-upl-state={flow.upload}")

  for (const token of [
    "--signal-ink",
    "--signal-paper",
    "--signal-coral",
    "--signal-plum",
    "--signal-mint",
    "--signal-motion-fast: 180ms",
    "--signal-motion-state: 240ms",
    "--signal-motion-complete: 320ms",
  ]) expect(styles).toContain(token)

  expect(styles).toContain("@media (prefers-reduced-motion: reduce)")
  expect(styles).toMatch(/min-height:\s*(?:4[4-9]|[5-9]\d)px/)
  expect(styles).toContain(":focus-visible")
})

test("FLOW7-TRUTH-002 every Local Signal action and recovery state remains reachable without public claims", () => {
  const signal = source("features/ondo/local-signal-b/local-signal-layer-b.tsx")
  const walkthrough = source("features/ondo/identity-b/local-check-walkthrough-b.tsx")

  for (const testId of [
    "ondo-b-local-signal",
    "local-signal-draft",
    "local-signal-photo-input",
    "local-signal-photo-replace",
    "local-signal-photo-remove",
    "local-signal-photo-error",
    "local-signal-photo-retry",
    "local-signal-photo-choose-another",
    "local-signal-privacy",
    "local-signal-privacy-toggle",
    "local-signal-person-check",
    "local-signal-post",
    "local-signal-result",
    "local-signal-return",
    "local-signal-discard",
  ]) expect(signal).toContain(`data-testid=\"${testId}\"`)
  expect(signal).toContain('data-testid={flow.outcome === "failed" ? "local-signal-post-error" : undefined}')

  for (const truth of [
    "Note and photo stay private",
    "This never changes the public temperature",
    "Your draft is unchanged",
    "No public post was created",
    "failure",
    "unavailable",
    "expired",
  ]) expect(`${signal}\n${walkthrough}`).toContain(truth)

  expect(signal).toContain('flow.outcome === "unique"')
  expect(signal).toContain('flow.outcome === "duplicate"')
  expect(`${signal}\n${walkthrough}`).not.toMatch(/public reputation|uploaded successfully|shared publicly|verified visit|official Pulse score increased/i)
})

test("FLOW7-PERSIST-003 only canonical tag IDs and post time enter device history", () => {
  const provider = source("features/ondo/shared/state/ondo-b-provider.tsx")
  const signal = source("features/ondo/local-signal-b/local-signal-layer-b.tsx")
  const model = source("features/ondo/local-signal-b/local-signal-model-b.ts")
  const my = source("features/ondo/my/saved-entry-b.tsx")

  for (const evidence of [
    "localSignalPostedVenueIds",
    "localPulseEvidenceByVenue",
    "safeTags",
    "postedAt",
    "markLocalSignalPosted",
    "state.localSignalPostedVenueIds",
  ]) expect(`${provider}\n${signal}\n${my}`).toContain(evidence)

  const deviceType = provider.slice(provider.indexOf("type OndoBDeviceState"), provider.indexOf("const B_DEVICE_KEY"))
  expect(deviceType).not.toMatch(/localSignalDraft|photoFile|photoUrl|note:/)
  expect(signal).toContain("const result = activityActions.recordActivityAxes(")
  expect(signal).toContain("payload.evidenceId")
  expect(signal).toContain("payload.axes")
  expect(model).toContain('LOCAL_SIGNAL_MUTATION_AXES_B = ["visit", "contribution"]')
  expect(model).toContain('const id = `activity:${identity.evidenceRef}:${identity.subjectRef}`')
  expect(signal).toContain("() => actions.markLocalSignalPosted(activeVenue.id)")
  expect(signal).toContain('return result === "accepted" || result === "duplicate"')
  expect(signal).toContain('sendFlow({ type: "save_failed" })')
  const mutationFactory = model.slice(model.indexOf("export function createLocalSignalMutationPayloadB"))
  expect(mutationFactory).not.toMatch(/note:\s*input\.note|photo:\s*input\.photo/)
})

test("FLOW7-RETURN-004 nested Person checks preserve exact draft/place and own modal isolation", () => {
  const signal = source("features/ondo/local-signal-b/local-signal-layer-b.tsx")
  const coordinator = source("features/ondo/identity-b/action-gate-coordinator-b.tsx")
  const contract = source("features/ondo/identity-b/action-gate-contract-b.ts")
  const sheet = source("features/ondo/shared/ui/sheet-b.tsx")
  const isolation = source("features/ondo/shared/ui/use-modal-isolation.ts")

  expect(signal).toContain("<SheetB")
  expect(signal).toContain('variant="full-task"')
  expect(sheet).toContain("useModalIsolation(!suspended, layerRef)")
  expect(coordinator).toContain("useModalIsolation(Boolean(pending && readyTokenId !== pending.tokenId && (activeGate || expiredReturn)), layerRef)")
  expect(isolation).toContain('element.setAttribute("inert", "")')
  expect(signal).toContain("B_ACTION_GATE_READY_EVENT")
  expect(signal).toContain("createBLocalSignalActionReturn")
  expect(contract).toContain('cta: "SUBMIT_LOCAL_SIGNAL"')
  expect(signal).toContain("activeDraft.note")
  expect(signal).toContain("activeDraft.tags")
  expect(signal).toContain("activeVenue.id")
  expect(signal).toContain("sameLocalSignalDraftBindingB(gateBinding, currentBinding)")
  expect(sheet).toContain('event.key !== "Escape"')
})

test("FLOW7-SESSION-005 Person results are exact, expiring, session-only common envelopes", () => {
  const signal = source("features/ondo/local-signal-b/local-signal-layer-b.tsx")
  const contract = source("features/ondo/identity-b/action-gate-contract-b.ts")
  const coordinator = source("features/ondo/identity-b/action-gate-coordinator-b.tsx")
  const provider = source("features/ondo/shared/state/ondo-b-provider.tsx")

  for (const field of ["venueId", "draftNonce", "tags", "note", "createdAt", "expiresAt", "consumedAt"]) {
    expect(contract).toContain(field)
  }
  expect(contract).toContain("B_ACTION_AXIS_TTL_MS")
  expect(contract).toContain("B_ACTION_GATE_SESSION_KEY")
  expect(contract).toContain("isBActionReturnPending")
  expect(contract).toContain("hasExactKeys")
  expect(coordinator).toContain("restoreBActionGateSession(window.sessionStorage, new Date(), actionGateSessionOptions())")
  expect(signal).toContain("restoreBActionGateSession(window.sessionStorage, new Date(), actionGateSessionOptions())")
  expect(signal).toMatch(/exactGateSession\.expiresAt\s*<=\s*Date\.now\(\)/)

  const deviceType = provider.slice(provider.indexOf("type OndoBDeviceState"), provider.indexOf("const B_DEVICE_KEY"))
  expect(deviceType).not.toMatch(/draftNonce|createdAt|expiresAt|gateSession|personReady|paymentKyc/)
})

test("FLOW7-MEDIA-006 invalid replacement never destroys a prepared local preview", () => {
  const signal = source("features/ondo/local-signal-b/local-signal-layer-b.tsx")

  expect(signal).toContain("const previousUrl = photoUrlRef.current")
  expect(signal).toMatch(/try\s*\{[\s\S]*URL\.createObjectURL\(file\)[\s\S]*\}\s*catch/)
  expect(signal).toMatch(/LOCAL_SIGNAL_PHOTO_TYPES\.has\(file\.type\)[\s\S]*file\.size > MAX_LOCAL_SIGNAL_PHOTO_BYTES[\s\S]*URL\.createObjectURL/)
  expect(signal).toContain("if (previousUrl) URL.revokeObjectURL(previousUrl)")
  expect(signal).toMatch(/URL\.createObjectURL\(file\)[\s\S]*(?:await\s+decodeLocalSignalPhoto|await\s+candidateImage\.decode)/)
  expect(signal).toContain("photoPreparationRef")
  expect(signal).toContain("URL.revokeObjectURL(candidateUrl)")
  expect(signal).toContain("setPhotoCanRetry(false)")
})

test("FLOW7-COPY-007 local-only draft copy never promises benefit or public contribution", () => {
  const signal = source("features/ondo/local-signal-b/local-signal-layer-b.tsx")
  const place = source("features/ondo/place/canonical-place-overlay.tsx")

  expect(`${signal}\n${place}`).not.toMatch(/help another traveler|help another visitor|다른 여행자|다른 방문자|ほかの旅行者|ほかの訪問者/i)
  for (const truth of [
    'header: "Place signal"',
    'header: "장소 느낌"',
    'header: "スポットの印象"',
    "Saving may ask for an account, then a one-time person check",
    "Only this place, your picks and the time are kept on this device",
    "이 장소와 선택한 느낌, 시각만 기기에 남아요",
    "この場所、選んだ印象、時刻だけが端末に残ります",
    "계정 생성 후 일회성 본인 확인",
    "アカウント作成後、一度だけ本人確認",
  ]) expect(signal).toContain(truth)
  for (const consumerTruth of [
    'data-testid={`local-signal-tag-${tag.id}`}',
    'data-testid="local-signal-note"',
    'data-testid="local-signal-photo-input"',
    "Added to your visits",
    "내 방문에 담았어요",
    "訪問履歴に追加しました",
    "Couldn’t save. Your draft is still here.",
  ]) expect(signal).toContain(consumerTruth)
  expect(signal).not.toMatch(/FROM THIS OFFICIAL PLACE|Identity check complete|posted marker|게시 표시|投稿済みの印|Pulse evidence|tag IDs|로컬 Pulse 근거|태그 ID|Pulse根拠|タグID/)
  expect(signal).not.toMatch(/Pick what fits|하나 이상 골라|1つ以上選んで/)
  for (const consumerAction of ['action: "Continue to save"', 'action: "저장하러 가기"', 'action: "保存へ進む"', 'confirmAction: "Save to my visits"', 'confirmAction: "내 방문에 저장"', 'confirmAction: "訪問履歴に保存"']) expect(signal).toContain(consumerAction)
  expect(signal).not.toMatch(/장소 온도|이 온도 남기기|スポット温度|この温度を残す/)
})

test("FLOW7-CONTEXT-007 canonical place, picks and local photo stay visually anchored through Person", () => {
  const signal = source("features/ondo/local-signal-b/local-signal-layer-b.tsx")
  const coordinator = source("features/ondo/identity-b/action-gate-coordinator-b.tsx")
  const contract = source("features/ondo/identity-b/action-gate-contract-b.ts")
  const styles = source("features/ondo/local-signal-b/local-signal-layer-b.module.css")

  expect(signal).toContain("canonicalVenueMoodImage(activeVenue)")
  expect(signal).toContain('data-source-class="category_illustration"')
  expect(signal).toContain('aria-label={copy.categoryImage}')
  expect(signal).not.toContain('data-source-class="official_directory"')
  expect(signal).toContain('data-testid="local-signal-draft-anchor"')
  expect(signal).toContain('data-testid="local-signal-anchor-photo"')
  expect(contract).toContain("photoPreviewUrl: string | null")
  expect(contract).toContain('input.photoPreviewUrl?.startsWith("blob:")')
  expect(coordinator).toContain('data-testid="action-gate-signal-anchor"')
  expect(coordinator).toContain("(!reviewTransition || signalContext)")
  // Stop each match at its own closing brace: a later rule must not satisfy
  // the base preview contract, or collapse preparing/error states by accident.
  const rules = (selector: string) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    return [...styles.matchAll(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^{}]*)\\}`, "g"))].map(match => match[1])
  }
  const rule = (selector: string) => {
    const bodies = rules(selector)
    expect(bodies, `One explicit rule for ${selector}`).toHaveLength(1)
    return bodies[0]
  }
  const basePhotoRules = rules(".photo")
  expect(basePhotoRules.length).toBeGreaterThan(0)
  const basePhoto = basePhotoRules[0]
  expect(basePhoto).toMatch(/aspect-ratio:\s*4\s*\/\s*3\s*;/)
  expect(basePhoto).not.toMatch(/(?:^|;)\s*(?:height|min-height|max-height)\s*:/)
  // A later landscape max-width is fine; it must not replace the aspect ratio
  // or impose a fixed height on selected, preparing or failed media.
  for (const later of basePhotoRules.slice(1)) expect(later).not.toMatch(/(?:aspect-ratio|(?:^|;)\s*(?:height|min-height|max-height))\s*:/)
  const emptySelector = '.photo[data-photo-stage="empty"][data-has-preview="false"]'
  const emptyPhoto = rule(emptySelector)
  expect(emptyPhoto).toMatch(/aspect-ratio:\s*auto\s*;/)
  expect(emptyPhoto).toMatch(/(?:^|;)\s*height:\s*72px\s*;/)
  const directPhotoRules = [...styles.matchAll(/(?:^|\n)\s*(\.photo(?:\[[^\]]+\])*)\s*\{([^{}]*)\}/g)]
  const geometryOverrides = directPhotoRules.filter(([, selector, body]) => selector !== ".photo" && /(?:aspect-ratio|(?:^|;)\s*(?:height|min-height|max-height))\s*:/.test(body))
  expect(geometryOverrides.map(([, selector]) => selector)).toEqual([emptySelector])
  const emptyAction = rule(`${emptySelector} > .photoAdd`)
  expect(emptyAction).toMatch(/justify-content:\s*flex-start\s*;/)
  expect(emptyAction).toMatch(/padding-inline:\s*16px\s*;/)
  expect(emptyAction).toMatch(/font-size:\s*15px\s*;/)
  expect(emptyAction).toMatch(/border:\s*0\s*;/)
  expect(signal).toContain('data-photo-stage={photoStage} data-has-preview={photoUrl ? "true" : "false"}')
  expect(signal).toContain('const photoStage = photoPreparing ? "loading" : photoError ?? (flow.upload === "UPL-PREVIEW" || photoUrl ? "ready" : "empty")')
  // The selected-image error overlay stays spacious; loading and recovery
  // controls are unaffected by the compact, empty-only state.
  const recovery = rule(".photo figcaption button, .photo > p button")
  expect(recovery).toMatch(/min-height:\s*44px\s*;/)
  const previewError = rule('.photo[data-has-preview="true"] > p')
  expect(previewError).toMatch(/height:\s*auto\s*;/)
  expect(previewError).toMatch(/min-height:\s*64px\s*;/)
  expect(rule(".photo > .photoLoading")).toMatch(/display:\s*flex\s*;/)
  expect(styles).toContain("@media (max-width: 360px)")
  expect(styles).toContain("orientation: landscape")
})

test("FLOW7-DATA-008 restored Local Signal history and evidence are one canonical bounded intersection", () => {
  const provider = source("features/ondo/shared/state/ondo-b-provider.tsx")

  expect(provider).toContain("const restoredLocalSignalVenueIds = sanitizeLocalSignalVenueIds")
  expect(provider).toContain("const localSignalPostedVenueIds = restoredLocalSignalVenueIds.filter")
  expect(provider).toContain("const boundedLocalPulseEvidenceByVenue = Object.fromEntries")
  expect(provider).toContain("localSignalPostedVenueIds,")
  expect(provider).toContain("localPulseEvidenceByVenue: boundedLocalPulseEvidenceByVenue")
})

test("FLOW7-STORAGE-009 Settings keeps a persistent inline retry decision when clear fails", () => {
  const settings = source("features/ondo/settings/settings-entry-b.tsx")
  const provider = source("features/ondo/shared/state/ondo-b-provider.tsx")

  expect(settings).toContain("data-testid=\"ondo-b-clear-device-error\"")
  expect(settings).toContain('role="alert"')
  expect(settings).toContain('result.rollback === "complete"')
  expect(settings).toContain('setDeleteError(result.rollback === "complete" ? "unchanged" : "uncertain")')
  expect(settings).toContain("actions.notify(COPY[state.locale].deleted)")
  expect(provider).toContain('rollback: "complete" | "incomplete"')
  expect(provider).toContain('outcome: "storage_failed"')
})

test("FLOW7-TRAVERSAL-010 browser traversal discards the ephemeral draft and cannot resurrect it on Forward", () => {
  const signal = source("features/ondo/local-signal-b/local-signal-layer-b.tsx")
  expect(signal).toContain("B_DISCOVERY_TRAVERSAL_EVENT")
  expect(signal).toContain('window.addEventListener(B_DISCOVERY_TRAVERSAL_EVENT')
  expect(signal).toContain("actions.closeLocalSignal()")
})

test("FLOW7-PRIVACY-010A failed abandon keeps the exact draft mounted across close, edit, photo and traversal", () => {
  const signal = source("features/ondo/local-signal-b/local-signal-layer-b.tsx")
  const contract = source("features/ondo/identity-b/action-gate-contract-b.ts")

  expect(contract).toContain("export function discardUnrequestedBActionPrivateContext")
  expect(contract).toContain("record.snapshotHash !== expectedHash")
  expect(contract).toMatch(/function requestBActionGate[\s\S]*discardUnrequestedBActionPrivateContext\(returnTo\)/)

  const discard = signal.slice(signal.indexOf("function discardPendingSignalAction"), signal.indexOf("function finishAndReturnToPlace"))
  expect(discard).toContain("if (!abandonPendingBAction")
  expect(discard).toContain("setAbandonError(true)")
  expect(discard).toContain("return false")
  const finish = signal.slice(signal.indexOf("function finishAndReturnToPlace"), signal.indexOf("function requestClose"))
  expect(finish.indexOf("if (!discardPendingSignalAction")).toBeLessThan(finish.indexOf("actions.closeLocalSignal()"))
  expect(finish).not.toContain("releasePhotoUrl()")
  const invalidate = signal.slice(signal.indexOf("function invalidateGateBinding"), signal.indexOf("function toggleTag"))
  expect(invalidate.indexOf("if (!discardPendingSignalAction")).toBeLessThan(invalidate.indexOf("setGateBinding(null)"))
  const traversal = signal.slice(signal.indexOf("const discardOnTraversal"), signal.indexOf("window.addEventListener(B_DISCOVERY_TRAVERSAL_EVENT"))
  expect(traversal).not.toContain("releasePhotoUrl()")
  expect(traversal.indexOf("return")).toBeLessThan(traversal.indexOf("actions.closeLocalSignal()"))
  expect(signal).toContain("if (!discardPendingSignalAction(gateBinding?.revision ?? draftRevision)) return")
  expect(signal).toContain("if (!invalidateGateBinding()) return")
  expect(signal).toContain("if (!invalidateGateBinding()) {")
  expect(signal).toContain("URL.revokeObjectURL(candidateUrl)")
  expect(signal).toContain("event.stopImmediatePropagation()")
  expect(signal).toContain("{ capture: true }")
  expect(signal).toContain('data-testid="local-signal-abandon-error"')
  expect(signal).toContain("Your draft is still here. Try again.")
})

test("FLOW7-RUNTIME-011 every successful mutation bounds ids and evidence to the same twelve-entry intersection", () => {
  const provider = source("features/ondo/shared/state/ondo-b-provider.tsx")
  expect(provider).toContain("const nextLocalSignalPostedVenueIds = sanitizeLocalSignalVenueIds")
  expect(provider).toContain("const nextLocalPulseEvidenceByVenue = Object.fromEntries")
  expect(provider).toContain("localSignalPostedVenueIds: nextLocalSignalPostedVenueIds")
  expect(provider).toContain("localPulseEvidenceByVenue: nextLocalPulseEvidenceByVenue")
})

test("FLOW7-VIS-012 photo recovery and Local Signal consent keep one reachable decision viewport", () => {
  const signal = source("features/ondo/local-signal-b/local-signal-layer-b.tsx")
  const styles = source("features/ondo/local-signal-b/local-signal-layer-b.module.css")
  const sheet = source("features/ondo/shared/ui/sheet-b.tsx")
  const checkStyles = source("features/ondo/identity-b/local-check-walkthrough-b.module.css")
  expect(signal).toContain("photoSectionRef")
  expect(signal).toContain("photoErrorRef")
  expect(styles).toContain("scroll-margin-bottom: 104px")
  expect(styles).toMatch(/\.truth\s*>\s*summary\s*\{[\s\S]*min-height:\s*4[5-9]px/)
  expect(styles).toMatch(/\.body\s*\{[\s\S]*overflow-y:\s*auto/)
  expect(styles).toMatch(/\.layer\s*\{[\s\S]*overflow:\s*hidden/)
  expect(sheet).toContain('data-sheet-scroll-owner="true"')
  expect(checkStyles).toContain('.layer[data-check-origin="local_signal"]')
  expect(checkStyles).toMatch(/max-width:\s*430px[\s\S]*data-check-origin="local_signal"[\s\S]*\.actions[\s\S]*order:\s*5/)
})

test("FLOW7-EVIDENCE-013 desktop evidence captures the settled app root at CSS-pixel scale", () => {
  const e2e = source("tests/e2e/ondo-b-flow7-local-signal-direction.spec.ts")
  const capture = e2e.slice(e2e.indexOf("async function quietCapture"), e2e.indexOf("async function sharedPlacePulseTuple"))

  expect(capture).toContain("await document.fonts.ready")
  expect(capture).toMatch(/requestAnimationFrame\(\(\) => requestAnimationFrame/)
  expect(capture).toContain('page.getByTestId("ondo-b-root")')
  expect(capture).toContain("await root.screenshot")
  expect(capture).toContain('>= 1200 ? "css" : "device"')
  expect(capture).not.toContain("await page.screenshot")
})

test("FLOW7-JIT-014 identity checks keep one visible answer and progressively disclose provider detail", () => {
  const walkthrough = source("features/ondo/identity-b/local-check-walkthrough-b.tsx")
  const coordinator = source("features/ondo/identity-b/action-gate-coordinator-b.tsx")
  const checkStyles = source("features/ondo/identity-b/local-check-walkthrough-b.module.css")
  const gateStyles = source("features/ondo/identity-b/action-gate-coordinator-b.module.css")
  const consentStart = walkthrough.indexOf('phase === "consent"')
  const consentEnd = walkthrough.indexOf('phase === "processing"', consentStart)
  const contentStart = coordinator.indexOf('className={`${styles.content}')
  const contentEnd = coordinator.indexOf('<div className={styles.actions}', contentStart)
  expect(consentStart).toBeGreaterThanOrEqual(0)
  expect(consentEnd).toBeGreaterThan(consentStart)
  expect(contentStart).toBeGreaterThanOrEqual(0)
  expect(contentEnd).toBeGreaterThan(contentStart)
  const consent = walkthrough.slice(consentStart, consentEnd)
  const gateContent = coordinator.slice(contentStart, contentEnd)

  for (const marker of ['data-testid="consent-minimum"', 'data-testid="consent-retention"', 'data-testid="local-check-boundary"']) {
    expect(consent).toContain(marker)
  }
  expect(gateContent).toContain('data-testid="action-gate-return-context"')
  expect(gateContent).toContain("styles.hero")

  expect(consent.indexOf('data-testid="consent-minimum"')).toBeLessThan(consent.indexOf('data-testid="local-check-boundary"'))
  expect(consent.indexOf('data-testid="consent-retention"')).toBeLessThan(consent.indexOf('data-testid="local-check-boundary"'))
  expect(consent).toMatch(/<details[^>]*data-testid="local-check-boundary"[\s\S]*data-testid="consent-requester"[\s\S]*data-testid="consent-purpose"[\s\S]*<\/details>/)
  const providerBoundary = consent.slice(consent.indexOf('data-testid="local-check-boundary"'), consent.indexOf('</details>') + 10)
  expect(providerBoundary).not.toContain('data-testid="consent-minimum"')
  expect(providerBoundary).not.toContain('data-testid="consent-retention"')
  expect(consent).not.toContain("styles.heroIcon")
  expect(walkthrough).toContain("textarea:not([disabled]),summary,[tabindex]")
  expect(walkthrough).toContain("[boundaryError, phase, result]")
  expect(walkthrough).toContain("data-local-check-error-focus")
  expect(walkthrough).toContain('scrollIntoView({ block: "nearest" })')
  expect(walkthrough).toMatch(/accountFailure \? \([\s\S]*data-testid="direct-person-account-retry" onClick=\{prepareAccount\}/)
  for (const answer of [
    "Person · yes/no only — separate from 19+",
    "본인 여부 · 예/아니오만 · 19+와 별개",
    "本人であること・はい／いいえのみ・19歳以上とは別",
    "This tab · up to 1 hour · no personal data saved",
    "이 탭 · 최대 1시간 · 개인정보 저장 안 함",
    "このタブ・最長1時間・個人情報は保存しません",
  ]) expect(walkthrough).toContain(answer)
  for (const oneRequest of [
    "This request only · no reusable ID or personal data",
    "이번 요청에만 사용 · 재사용 ID나 개인정보 없음",
    "このリクエストのみ・再利用IDや個人情報なし",
  ]) expect(coordinator).toContain(oneRequest)
  expect(gateContent.indexOf('data-testid="action-gate-return-context"')).toBeLessThan(gateContent.indexOf("styles.hero"))
  expect(coordinator).toMatch(/data-testid="person-decision-truth"[\s\S]*data-testid="person-provider-disclosure"/)
  expect(coordinator).toMatch(/data-testid="credential-decision-truth"[\s\S]*data-testid="credential-presentation-details"/)
  expect(coordinator).toMatch(/<details className=\{styles\.disclosure\} data-testid="person-provider-disclosure">[\s\S]*data-testid="consent-requester"[\s\S]*data-testid="consent-purpose"[\s\S]*<\/details>/)
  expect(coordinator).toContain('data-testid="action-gate-presentation-provider"')
  expect(coordinator).toMatch(/<details className=\{styles\.returnDraft\}><summary>\{copy\.returnDraft\}[\s\S]*<blockquote>\{privateContext\.(draft|note)\}<\/blockquote><\/details>/)
  expect(coordinator).toContain("[data-action-gate-initial-focus]")
  expect(checkStyles).toContain("position: sticky")
  expect(checkStyles).toContain("@media (max-width: 430px)")
  expect(checkStyles).toContain("overflow-wrap: anywhere")
  expect(gateStyles).toContain(".plan li span")
  expect(gateStyles).toContain("grid-template-columns: minmax(0, 1fr)")
  expect(gateStyles).toContain(".decisionTruth,.disclosure")
  expect(gateStyles).toContain(".returnDraft summary")
  expect(gateStyles).toContain("max-height: none")
  expect(gateStyles).not.toContain("max-height: 2.65em")
  expect(gateStyles).not.toContain("text-overflow: ellipsis")
})
