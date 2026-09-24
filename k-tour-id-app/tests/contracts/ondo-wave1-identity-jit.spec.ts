import { expect, test } from "@playwright/test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8")

const coordinator = source("features/ondo/identity-b/action-gate-coordinator-b.tsx")
const coordinatorCss = source("features/ondo/identity-b/action-gate-coordinator-b.module.css")
const directCheck = source("features/ondo/identity-b/local-check-walkthrough-b.tsx")
const setup = source("features/ondo/identity-b/ktour-id-setup-b.tsx")
const setupCss = source("features/ondo/identity-b/ktour-id-setup-b.module.css")
const passport = source("features/ondo/identity-b/passport-ocr-step-b.tsx")
const face = source("features/ondo/identity-b/passport-face-step-b.tsx")
const holder = source("features/ondo/identity-b/identity-holder-step-b.tsx")
const handoff = source("features/ondo/identity-b/identity-handoff-step-b.tsx")
const passportCss = source("features/ondo/identity-b/passport-ocr-step-b.module.css")
const account = source("features/ondo/identity-b/account-save-gate-b.tsx")
const traveler = source("features/ondo/identity-b/traveler-id-entry-b.tsx")
const qaControls = source("features/ondo/shared/ui/use-qa-controls.ts")

test("W1-ID-001 normal unavailable, local Account and explicit review fixture are separate execution modes", () => {
  expect(account).toContain('localActual("account"')
  expect(account).toContain('execution.result !== "LOCAL_COMMITTED"')

  for (const consumer of [coordinator, directCheck, setup]) {
    expect(consumer).toContain("providerUnavailable")
    expect(consumer).toContain("createReviewFixtureAuthority")
    expect(consumer).toContain("reviewFixture")
  }
  expect(coordinator).toContain('if (!reviewMode) return { execution: providerUnavailable("person"), unavailableStatus: "unavailable" }')
  expect(coordinator).toContain('gate === "age" && reviewMode')
  expect(coordinator).toContain('data-testid="age-review-scope"')
  expect(directCheck).toContain('if (!reviewMode)')
  expect(setup).toContain('execution.result !== "FIXTURE_SUCCESS"')
  expect(`${coordinator}\n${directCheck}\n${setup}`).not.toContain("recordGlobalAfter19AgeEligibilityB")
  expect(`${coordinator}\n${directCheck}\n${setup}`).toContain("data-execution-mode")
  expect(`${coordinator}\n${directCheck}\n${setup}`).toMatch(/Review path|검토 경로|検証用ルート/)
  expect(`${coordinator}\n${directCheck}\n${setup}`).toMatch(/no external service confirmation|외부 서비스 확인 없음|外部サービスによる確認なし/)
})

test("W1-ID-002 Person methods disclose only at choice and preserve independent Account, Person, Age and Payment axes", () => {
  for (const method of ["mobile_id", "mobile_residence_card", "passport_ekyc"]) {
    expect(`${coordinator}\n${directCheck}\n${setup}`).toContain(`"${method}"`)
  }
  expect(setup).toContain('const steps = [copy.chooseStep, copy.checkStep, copy.issueStep]')
  expect(setup).toContain('if (origin === "action_gate")')
  expect(coordinator).toContain('data-testid="action-gate-presentation"')
  expect(coordinator).toContain('data-testid="action-gate-presentation-requester"')
  expect(coordinator).toContain('data-testid="credential-visible-predicate"')
  expect(coordinator).toContain('data-testid="credential-visible-retention"')
  expect(traveler).toContain('data-testid="traveler-id-account"')
  expect(traveler).toContain('data-testid="traveler-id-person"')
  expect(traveler).toContain('data-testid="traveler-id-age"')
  expect(traveler).toContain('data-testid="traveler-id-payment"')
  expect(traveler).toContain('data-testid="traveler-id-credential"')
})

test("W1-ID-003 current Passport review is a redacted-sample connector boundary with no raw capture", () => {
  expect(passport).toContain('type PassportReviewStage = "sample" | "permission" | "denied" | "capture" | "checking" | "review"')
  expect(passport).toContain('data-review-fixture="redacted-passport"')
  expect(passport).toContain('data-review-stage={stage === "review" ? "ocr-nfc-complete" : stage === "checking" ? "sample-check" : "ocr-nfc"}')
  expect(passport).toContain("OCR, NFC and face/liveness connector boundaries")
  expect(passport).toContain('data-testid="passport-ocr-processing"')
  expect(passport).toContain('data-testid="passport-ocr-review"')
  expect(setup).toContain('<PassportFaceStepB locale={state.locale} reviewMode={reviewMode}')
  expect(setup).toContain('<IdentityHolderStepB locale={state.locale} onPrepare={prepareHolder} onAcknowledge={finishHolder}')
  expect(face).toContain('data-testid="k-tour-id-passport-face"')
  expect(holder).toContain('data-testid="k-tour-id-holder-delivery"')
  expect(`${passport}\n${setup}\n${face}\n${holder}\n${handoff}`).not.toMatch(/<input[^>]+type=["']file["']/i)
  expect(`${passport}\n${setup}\n${face}\n${holder}\n${handoff}`).not.toMatch(/getUserMedia|MediaDevices|NDEFReader|FileReader|URL\.createObjectURL/)
  expect(passport).not.toContain("setTimeout")
  expect(passport).toContain('data-testid="passport-demo-nfc-read"')
})

test("W1-ID-004 exact action return stays anchored and normal unavailable can enter the explicit sample path", () => {
  for (const contract of [
    "privateContextForBAction",
    "restoreContext",
    "isBActionReturnPending",
    "abandonPendingBAction",
    "B_ACTION_GATE_READY_EVENT",
    "B_ACTION_GATE_CANCEL_EVENT",
  ]) expect(coordinator).toContain(contract)
  expect(coordinator).toContain('data-testid="action-gate-return-context"')
  expect(coordinator).toContain('data-testid="person-choose-another"')
  expect(coordinator).toContain('const sampleProviderUnavailable = (gate === "person" || gate === "age" || gate === "payment_kyc") && resolvedView === "unavailable" && !reviewMode')
  expect(coordinator).toContain('data-testid="action-gate-sample-continue"')
  expect(coordinator).toContain('if (!enterReviewSample()) return')
  expect(setup).toContain('primaryTestId="k-tour-id-sample-continue"')
  expect(setup).toContain('primaryTestId={!sampleRecovery && method === "mobile_residence_card" ? "k-tour-id-alternate-passport" : "k-tour-id-choose-another"}')
  expect(setup).toContain('if (sampleRecovery && nextMethod !== state.identityCredential?.method) return')
  expect(directCheck).toContain('data-testid="direct-check-sample-continue"')
  expect(`${coordinator}\n${directCheck}\n${setup}`).toContain("enterReviewSample")
  expect(passport).toContain('data-ocr-stage="unavailable"')
  expect(passport).not.toContain("passport-ocr-retry")
})

test("W1-ID-005 identity sheets retain mobile/landscape/reduced-motion containment and three locales", () => {
  for (const consumer of [coordinator, directCheck, setup, passport]) {
    expect(consumer).toMatch(/en:\s*\{/)
    expect(consumer).toMatch(/ko:\s*\{/)
    expect(consumer).toMatch(/ja:\s*\{/)
  }
  for (const css of [coordinatorCss, setupCss, passportCss]) {
    expect(css).toContain("@media")
    expect(css).toMatch(/max-width:\s*(?:350|360|430)px/)
    expect(css).toMatch(/orientation:\s*landscape/)
    expect(css).toContain("prefers-reduced-motion")
  }
  expect(coordinatorCss).toContain("100dvh")
  expect(setupCss).toContain("max-height: 100%")
  expect(passportCss).toContain("max-height: 500px")
  expect(`${coordinatorCss}\n${setupCss}\n${source("features/ondo/identity-b/local-check-walkthrough-b.module.css")}`).not.toMatch(/font-size:\s*(?:10|11)px/)
})

test("W1-ID-006 Guest 19+ review stays in current-action memory while Account may retain the minimal receipt", () => {
  expect(traveler).toContain("persistGlobalAfter19SessionB(window.sessionStorage, next, completedAt")
  expect(traveler).toContain("writeGuestAfter19MemoryB(next, completedAt")
  expect(traveler).toContain("if (!accountActive) window.sessionStorage.removeItem(GLOBAL_AFTER19_SESSION_KEY)")
  expect(traveler.indexOf("persistGlobalAfter19SessionB(window.sessionStorage, next, completedAt")).toBeLessThan(traveler.indexOf("setAfter19Session(committed)"))
  expect(traveler.indexOf("setAfter19Session(committed)")).toBeLessThan(traveler.indexOf("window.dispatchEvent(new CustomEvent(GLOBAL_AFTER19_SESSION_EVENT, { detail: committed }))"))
  expect(traveler).toContain("Guest age evidence is scoped to the current action/component only")
  expect(traveler).toContain("sanitizeGlobalAfter19Session(event.detail")
  expect(traveler).toContain('data-review-result={ageReviewResult ? "true" : "false"}')
  expect(traveler).toMatch(/Review result|검토용 결과|検証用の結果/)
})

test("W1-ID-007 the default sample preserves session opt-out and cannot enable authoring failure injection", () => {
  const shell = source("features/ondo/app/ondo-app-b.tsx")
  const sampleInfo = source("features/ondo/shared/ui/sample-info-button-b.tsx")
  const environment = source("features/ondo/contracts/sample-environment.ts")
  expect(environment).toContain('SAMPLE_ENVIRONMENT_ENABLED = process.env.NEXT_PUBLIC_ONDO_EXECUTION_MODE !== "provider"')
  expect(qaControls).toContain('if (choice === "0") return false')
  expect(qaControls).toContain('if (choice === "1") return true')
  expect(qaControls).toContain('return stored === "1" || (stored !== "0" && SAMPLE_ENVIRONMENT_ENABLED)')
  expect(qaControls).toContain('export const REVIEW_FLOW_CHANGE_EVENT = "ondo-review-flow-change"')
  expect(qaControls).toContain('export function enterReviewSample()')
  expect(qaControls).toContain('export function exitReviewSample()')
  expect(qaControls).toContain('window.sessionStorage.setItem(REVIEW_ENABLED_KEY, "1")')
  expect(qaControls).toContain('window.sessionStorage.setItem(REVIEW_ENABLED_KEY, "0")')
  expect(qaControls).not.toContain('window.sessionStorage.removeItem(REVIEW_ENABLED_KEY)')
  expect(qaControls).toContain('url.searchParams.set("review", "1")')
  expect(qaControls).toContain('url.searchParams.set("review", "0")')
  expect(qaControls).toContain('window.location.replace(`${url.pathname}${url.search}${url.hash}`)')
  expect(qaControls).toContain('else if (requestedReview !== null) window.sessionStorage.setItem(REVIEW_ENABLED_KEY, "0")')
  expect(qaControls).toContain('window.dispatchEvent(new Event(REVIEW_FLOW_CHANGE_EVENT))')
  expect(qaControls).toContain('window.addEventListener(REVIEW_FLOW_CHANGE_EVENT, sync)')
  expect(qaControls).toContain('if (!hasRuntimeQaSessionOptIn()) return undefined')
  expect(qaControls).toContain('if (!QA_RUNTIME_ENABLED || typeof window === "undefined") return false')
  expect(qaControls).toMatch(/export function readQaRuntime<T extends object>\(\) \{\s*if \(!hasQaSessionOptIn\(\)\) return undefined\s*if \(!hasRuntimeQaSessionOptIn\(\)\) return undefined/)
  expect(sampleInfo).toContain('export function SampleInfoButtonB()')
  expect(sampleInfo).toContain('const enabled = useReviewSampleSession()')
  expect(sampleInfo).toContain('if (!enabled) return null')
  expect(sampleInfo).toContain('data-testid="review-sample-indicator"')
  expect(sampleInfo).toContain('window.dispatchEvent(new Event(SAMPLE_INFO_EVENT))')
  expect(traveler).toContain('<SampleInfoButtonB />')
  expect(shell).toContain('window.addEventListener(SAMPLE_INFO_EVENT, open)')
  expect(shell).toContain('Map activity, travel balance, bookings and payments are samples.')
  expect(shell).toContain('The experience perk has its own connection information and consent steps.')
  expect(shell).toContain('Sample top-ups, bookings and payments create no real order or money movement.')
  expect(shell).toContain('onClick={exitReviewSample}')
  const sampleControlsStart = qaControls.indexOf("export function enterReviewSample")
  const sampleControlsEnd = qaControls.indexOf("function hasRuntimeQaSessionOptIn", sampleControlsStart)
  expect(sampleControlsStart).toBeGreaterThanOrEqual(0)
  expect(sampleControlsEnd).toBeGreaterThan(sampleControlsStart)
  const sampleControls = qaControls.slice(sampleControlsStart, sampleControlsEnd)
  expect(sampleControls).not.toContain("QA_ENABLED_KEY")
  expect(sampleControls).not.toContain("QA_SCENARIO_KEY")
})
