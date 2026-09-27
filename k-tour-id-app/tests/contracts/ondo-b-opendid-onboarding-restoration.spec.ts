import { expect, test } from "@playwright/test"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  createPresentationRequestB,
  createSimulatedCredentialB,
  isPresentationRequestActiveB,
  isSimulatedCredentialActiveB,
  KTOUR_ID_CREDENTIAL_TTL_MS,
  KTOUR_ID_PRESENTATION_TTL_MS,
  resolvePresentationRequestB,
} from "../../features/ondo/identity-b/ktour-id-setup-model-b"

const root = process.cwd()
const source = (path: string) => {
  const absolute = resolve(root, path)
  return existsSync(absolute) ? readFileSync(absolute, "utf8") : ""
}

const setup = source("features/ondo/identity-b/ktour-id-setup-b.tsx")
const passportOcr = source("features/ondo/identity-b/passport-ocr-step-b.tsx")
const passportOcrCss = source("features/ondo/identity-b/passport-ocr-step-b.module.css")
const passportFace = source("features/ondo/identity-b/passport-face-step-b.tsx")
const handoff = source("features/ondo/identity-b/identity-handoff-step-b.tsx")
const holder = source("features/ondo/identity-b/identity-holder-step-b.tsx")
const setupSurfaces = [setup, passportOcr, passportFace, handoff, holder].join("\n")
const model = source("features/ondo/identity-b/ktour-id-setup-model-b.ts")
const provider = source("features/ondo/shared/state/ondo-b-provider.tsx")
const onboarding = source("features/ondo/onboarding/official-directory-onboarding.tsx")
const traveler = source("features/ondo/identity-b/traveler-id-entry-b.tsx")
const product = source("features/ondo/app/ondo-product-b.tsx")
const setupCopy = setup.slice(setup.indexOf("const COPY"), setup.indexOf("const FOCUSABLE"))

test("OPENDID-B-MODEL-001 credential readiness expires at the exact two-hour boundary", () => {
  const issuedAt = 1_000
  const credential = createSimulatedCredentialB("passport_ekyc", issuedAt)
  expect(isSimulatedCredentialActiveB(credential, issuedAt)).toBe(true)
  expect(isSimulatedCredentialActiveB(credential, issuedAt + KTOUR_ID_CREDENTIAL_TTL_MS - 1)).toBe(true)
  expect(isSimulatedCredentialActiveB(credential, issuedAt + KTOUR_ID_CREDENTIAL_TTL_MS)).toBe(false)
})

test("OPENDID-B-MODEL-002 presentation nonce expires and can be consumed only once", () => {
  const issuedAt = 5_000
  const request = createPresentationRequestB(issuedAt, "nonce:contract")
  expect(request.nonce).toBe("nonce:contract")
  expect(isPresentationRequestActiveB(request, issuedAt + KTOUR_ID_PRESENTATION_TTL_MS - 1)).toBe(true)

  const approved = resolvePresentationRequestB(request, "approve", issuedAt + 1)
  expect(approved).toMatchObject({ approved: true, code: null })
  expect(approved.request.consumedAt).toBe(issuedAt + 1)
  expect(resolvePresentationRequestB(approved.request, "approve", issuedAt + 2)).toMatchObject({
    approved: false,
    code: "PRESENTATION_REPLAY",
  })
  expect(resolvePresentationRequestB(createPresentationRequestB(issuedAt), "deny", issuedAt + 1)).toMatchObject({
    approved: false,
    code: "PRESENTATION_DENIED",
  })
  expect(resolvePresentationRequestB(request, "approve", issuedAt + KTOUR_ID_PRESENTATION_TTL_MS)).toMatchObject({
    approved: false,
    code: "PRESENTATION_REQUEST_EXPIRED",
  })
})

test("OPENDID-B-001 restores the three truthful identity routes without provider substitution", () => {
  expect(setup).toContain('"mobile_id"')
  expect(setup).toContain('"mobile_residence_card"')
  expect(setup).toContain('"passport_ekyc"')
  expect(setup).toContain("OmniOne CX")
  expect(setup).toContain("Passport eKYC")
  expect(passportOcr).toContain("OCR, NFC and face/liveness connector boundaries")
  expect(setup).toContain("OpenDID")
  expect(model).toContain('credentialType: "KTourVisitorCredential"')

  expect(setup).toContain("Passport eKYC uses a separate provider — not OmniOne CX")
  expect(setup).toContain("No identity service is connected, no DID or VC is issued")
  const methodStep = setup.slice(setup.indexOf('{phase === "method_select"'), setup.indexOf('{phase === "consent"'))
  expect(methodStep).not.toMatch(/OmniOne|OpenDID|provider|NFC|OCR|face|liveness/i)
  expect(setup).toContain('<Disclosure label={copy.consentDetails}')
  expect(setup).not.toContain("Issuer: OmniOne")
  expect(setup).not.toContain("Recorded on OmniOne")
})

test("OPENDID-B-002 every route has one on-device boundary and never performs identity network or sensitive storage", () => {
  expect(setupSurfaces).not.toContain("SIMULATED")
  expect(setup).toContain("No identity provider or OpenDID service is connected")
  expect(setup).toContain('requesterValue: "K-Tour ID"')
  expect(setup).toContain("No Mobile ID payload, name, birth date, signed callback or provider result is stored")
  expect(setup).toContain("No residence-card payload, name, birth date, signed callback or provider result is stored")
  expect(setup).toContain("bundled redacted sample")
  expect(setup).toContain("No user image, passport field, face image or provider result is collected or stored")
  expect(setup).toContain('details.retention, "identity-consent-retention"')
  expect(passportOcr).toContain("No photo or personal details are collected.")
  expect(passportOcr).toContain('data-review-fixture="redacted-passport"')

  expect(setupSurfaces).not.toMatch(/\b(?:fetch|XMLHttpRequest|sendBeacon|WebSocket|FormData)\s*\(/)
  expect(setupSurfaces).not.toMatch(/(?:localStorage|sessionStorage)\.(?:setItem|getItem)/)
  expect(model).not.toMatch(/passport(?:Number|Image)|face(?:Image|Template)|birthDate|residentNumber/i)

  const deviceState = provider.slice(provider.indexOf("type OndoBDeviceState"), provider.indexOf("const B_DEVICE_KEY"))
  expect(deviceState).not.toMatch(/identitySetup|identityCredential|passport|face|liveness|issuerDid|credentialId/)
})

test("OPENDID-B-003 onboarding remains direct and actions open K-Tour ID just in time", () => {
  const intentStep = onboarding.slice(onboarding.indexOf('{step === "intent"'), onboarding.indexOf('{step === "area"'))
  const escapeHandler = onboarding.slice(onboarding.indexOf("const escape = () =>"), onboarding.indexOf("const goBack = () =>"))
  const finishHandler = onboarding.slice(onboarding.indexOf("const finish = () =>"), onboarding.indexOf("const next = () =>"))

  expect(intentStep).not.toMatch(/K-Tour ID|openIdentitySetup|identity provider|OmniOne|eKYC/i)
  expect(finishHandler).toContain("actions.completeOnboarding({ intent, area, preferences })")
  expect(finishHandler).toContain("requestBDiscoveryFocus")
  expect(finishHandler).not.toContain("openIdentitySetup")
  expect(escapeHandler).toContain("actions.cancelOnboarding()")
  expect(escapeHandler).toContain("resetMap()")
  expect(escapeHandler).not.toContain("openIdentitySetup")
  expect(onboarding).toContain('"onboarding-finish"')

  expect(traveler).toContain('data-testid="traveler-id-ktour-id-open"')
  expect(traveler).toContain('data-testid="traveler-id-credential"')
  expect(traveler).toContain("actions.openIdentitySetup(\"traveler_id\")")
  expect(product).toContain("<KTourIdSetupB")
})

test("OPENDID-B-004 setup owns explicit progress, recovery, return and focus states", () => {
  for (const contract of [
    "ondo-b-ktour-id-setup",
    "ktour-id-route-mobile-id",
    "ktour-id-route-residence-card",
    "ktour-id-route-passport",
    "ktour-id-mobile-handoff",
    "ktour-id-passport-face",
    "k-tour-id-holder-delivery",
    "k-tour-id-presentation-open",
    "ktour-id-setup-failure",
    "ktour-id-setup-unavailable",
    "ktour-id-setup-expired",
    "ktour-id-result",
    'aria-modal="true"',
    "useModalIsolation",
    "Escape",
    "requestAnimationFrame",
  ]) expect(setupSurfaces).toContain(contract)

  expect(model).toContain("expiresAt")
  expect(model).toContain("issuedAt")
  expect(model).toContain("10 * 60 * 1000")
  expect(provider).toContain("openIdentitySetup")
  expect(provider).toContain("closeIdentitySetup")
  expect(provider).toContain("completeIdentitySetup")
  expect(setup).not.toContain('actions.setCommerceWalletStatus("ready")')
  expect(setup).toContain('data-wallet-provisioning="separate"')
})

test("OPENDID-B-005 Account, Person, 19+, identity credential and Payment remain independent", () => {
  expect(traveler).toContain('data-testid="traveler-id-account"')
  expect(traveler).toContain('data-testid="traveler-id-person"')
  expect(traveler).toContain('data-testid="traveler-id-age"')
  expect(traveler).toContain('data-testid="traveler-id-credential"')
  expect(traveler).toContain('data-testid="traveler-id-payment"')
  expect(setup).toContain('data-wallet-provisioning="separate"')
  const completion = provider.slice(provider.indexOf("completeIdentitySetup:"), provider.indexOf("acknowledgeCommerceLocalBoundary:"))
  expect(completion).not.toMatch(/personOutcome|ageOutcome|commerceWalletStatus|account/)
})

test("OPENDID-B-006 EN, KO and JA carry equivalent provider and private-credential boundaries", () => {
  expect(setup).toMatch(/const COPY\s*=\s*\{[\s\S]*?en:\s*\{[\s\S]*?ko:\s*\{[\s\S]*?ja:\s*\{/)
  for (const truth of [
    "앱 안에서 쓰는 K-Tour 패스 상태는 이 브라우저 탭에만 저장됩니다",
    "신원 확인이나 공식 신분증이 아니며",
    "신원확인 서비스와 연결되지 않고 DID·VC를 발급하지 않습니다",
    "여권 eKYC는 OmniOne CX가 아닌 별도 제공자",
    "アプリ内で使うK-Tourパスの状態は、このブラウザタブだけに保存されます",
    "本人確認や公的身分証ではなく",
    "本人確認サービスには接続せず、DID・VCも発行しません",
    "パスポートeKYCはOmniOne CXではなく別の事業者",
  ]) expect(setup).toContain(truth)
})

test("OPENDID-B-007 existing B and A product seams remain frozen", () => {
  for (const testId of [
    "ondo-onboarding",
    "onboarding-step-intent",
    "onboarding-step-area",
    "onboarding-step-preferences",
    "travel-pass-card",
    "traveler-id-account",
    "traveler-id-person",
    "traveler-id-age",
    "traveler-id-payment",
  ]) expect(`${onboarding}\n${traveler}`).toContain(testId)

  expect(onboarding).toContain('data-testid={`persona-${id}`}')
  for (const intent of ['id: "short_trip"', 'id: "nearby"', 'id: "living"']) expect(onboarding).toContain(intent)

  expect(product).toContain("<CanonicalPlaceMount />")
  expect(product).toContain("<LocalSignalLayerB />")
  expect(product).toContain("<OfficialDirectoryOnboardingLayer />")
  expect(source("features/ondo/identity/gate-overlay.tsx")).toContain("export function GateOverlay")
})

test("OPENDID-B-008 freezes the complete consent-to-presentation state machine", () => {
  for (const phase of [
    '"method_select"',
    '"consent"',
    '"cx_handoff_preview"',
    '"document_preview"',
    '"face_liveness_preview"',
    '"provider_processing_preview"',
    '"holder_delivery_preview"',
    '"credential_ready"',
    '"presentation_request"',
    '"presentation_consent"',
    '"presentation_result"',
  ]) expect(setup).toContain(phase)

  for (const testId of [
    "k-tour-id-setup",
    "k-tour-id-environment",
    "k-tour-id-private-boundary",
    "k-tour-id-methods",
    "k-tour-id-method-mobile-id",
    "k-tour-id-method-mobile-residence-card",
    "k-tour-id-method-passport-ekyc",
    "k-tour-id-consent",
    "identity-consent-requester",
    "identity-consent-purpose",
    "identity-consent-provider",
    "identity-consent-evidence",
    "identity-consent-retention",
    "k-tour-id-wallet-separate",
    "k-tour-id-route-step",
    "k-tour-id-holder-delivery",
    "k-tour-id-credential",
    "k-tour-id-presentation-request",
    "k-tour-id-presentation-consent",
    "k-tour-id-presentation-result",
    "k-tour-id-failure",
    "k-tour-id-unavailable",
    "k-tour-id-expired",
    "k-tour-id-retry",
    "k-tour-id-cancel",
    "k-tour-id-return",
    "passport-ocr-start",
    "passport-ocr-processing",
    "passport-ocr-review",
  ]) expect(setupSurfaces).toContain(testId)
})

test("OPENDID-B-009 keeps integration status internal and moves technical truth into disclosure copy", () => {
  for (const truth of [
    'env: "K-Tour ID"',
    'envDetail: "No identity provider or OpenDID service is connected."',
    "This in-app K-Tour pass is saved only in this browser tab.",
    "It is not an identity check or official ID.",
    "No identity service is connected, no DID or VC is issued",
    'envDetail: "신원확인 기관이나 OpenDID 서비스에 연결하지 않습니다."',
    "앱 안에서 쓰는 K-Tour 패스 상태는 이 브라우저 탭에만 저장됩니다.",
    "신원 확인이나 공식 신분증이 아니며",
    'envDetail: "本人確認事業者やOpenDIDサービスには接続しません。"',
    "アプリ内で使うK-Tourパスの状態は、このブラウザタブだけに保存されます。",
    "本人確認や公的身分証ではなく",
  ]) expect(setup).toContain(truth)

  expect(setup).toContain('data-environment={sandboxPassport ? "sandbox" : "simulated"}')
  expect(setup).toContain('data-integration-status={sandboxPassport ? "sandbox_check" : "not_configured"}')
  expect(setupSurfaces).not.toMatch(/navigator\.(?:mediaDevices|credentials)|NDEFReader|showOpenFilePicker/)
  expect(passportOcr).not.toContain('type="file"')
  expect(passportOcr).not.toContain('capture="environment"')
  expect(passportOcr).toContain('data-review-fixture="redacted-passport"')
  expect(passportOcr).toContain('data-review-stage={stage === "review" ? "ocr-nfc-complete" : stage === "checking" ? "sample-check" : "ocr-nfc"}')
})

test("OPENDID-B-014 consent is route-specific while payment and protocol detail stay progressive", () => {
  expect(setup).toContain("mobileRetention")
  expect(setup).toContain("residenceRetention")
  expect(setup).toContain("passportRetention")
  expect(setup).not.toMatch(/mobileRetention:\s*"[^"]*(?:image|이미지|画像)/i)
  expect(setup).not.toMatch(/residenceRetention:\s*"[^"]*(?:image|이미지|画像)/i)
  expect(setup).toContain("K-Tour ID does not prepare or connect a balance. Add KRW or USD later in ID & Wallet.")
  expect(setup).toContain("K-Tour ID는 잔액을 만들거나 연결하지 않습니다. 원화·달러는 나중에 ID·지갑에서 준비하세요.")
  expect(setup).toContain("K-Tour IDは残高を作成・接続しません。KRWまたはUSDは後からID・ウォレットで追加できます。")
  expect(setup).toContain('data-testid="k-tour-id-wallet-separate"')
  expect(setup).toContain('data-wallet-provisioning="separate"')
  expect(setup).not.toContain('data-testid="identity-consent-wallet"')
  expect(setup).toContain('<details className={styles.protocolDetails}')
  expect(setup).toContain('className={styles.privateBoundary} data-testid="k-tour-id-technical-truth"')
  expect(setup).not.toContain('<span className={styles.contractOnly} data-testid="k-tour-id-technical-truth">')
  expect(setupCopy).not.toMatch(/\b(?:walkthrough|simulated|test)\b/i)
  expect(setupCopy).toContain("No ID app opens and no personal data is sent.")
  expect(traveler).not.toContain("Test wallet")
  expect(traveler).not.toContain("테스트 지갑")
  expect(traveler).not.toContain("テストウォレット")
})

test("OPENDID-B-015 archived source assets remain while identity uses the monochrome route mark", () => {
  for (const asset of [
    "public/brand/ktour-id-lockup-transparent.png",
    "public/brand/ktour-id-mark.png",
    "public/brand/ktour-id-mark-32.png",
  ]) expect(existsSync(resolve(root, asset))).toBe(true)
  const mark = readFileSync(resolve(root, "features/ondo/shared/ui/ktour-id-mark.tsx"), "utf8")
  expect(setup).toContain("<KTourIdMark")
  expect(setup).not.toContain('/brand/ktour-id-mark')
  expect(mark).toContain('data-ktour-mark="monochrome"')
  expect(mark).toContain('fill="currentColor"')
  expect(mark).not.toMatch(/<image|linearGradient|radialGradient/i)
  // The supplied silhouette uses a black/white luminance mask; only the
  // visible silhouette must inherit the surrounding foreground color.
  expect(mark.replace(/<mask\b[\s\S]*?<\/mask>/g, "")).not.toMatch(/#[0-9a-f]{3,8}/i)
  expect(setup).toContain('className={styles.brandMark}')
})

test("OPENDID-B-010 freezes deterministic recovery, credential status, and one-shot guards", () => {
  for (const code of [
    "IDENTITY_METHOD_UNAVAILABLE",
    "CONSENT_DECLINED",
    "DOCUMENT_PERMISSION_DENIED",
    "PASSPORT_NFC_UNSUPPORTED",
    "PASSPORT_READ_FAILED",
    "UNSUPPORTED_DOCUMENT",
    "DOCUMENT_AUTH_FAILED",
    "FACE_MISMATCH",
    "LIVENESS_FAILED",
    "RETRY_LIMIT_REACHED",
    "MANUAL_REVIEW_REQUIRED",
    "PROVIDER_TIMEOUT",
    "CALLBACK_INVALID",
    "IDENTITY_SESSION_EXPIRED",
    "ISSUER_UNAVAILABLE",
    "CREDENTIAL_ISSUANCE_FAILED",
    "HOLDER_DELIVERY_FAILED",
    "CREDENTIAL_EXPIRED",
    "CREDENTIAL_SUSPENDED",
    "CREDENTIAL_REVOKED",
    "PRESENTATION_REQUEST_EXPIRED",
    "PRESENTATION_DENIED",
    "PRESENTATION_REPLAY",
  ]) expect(`${model}\n${setup}`).toContain(code)

  for (const status of ["none", "simulated_ready", "expired", "suspended", "revoked"]) {
    expect(model).toContain(`"${status}"`)
  }
  expect(setup).toContain("issuedOnceRef")
  expect(setup).toContain("readQaRuntime<QaRuntime>()")
})

test("OPENDID-B-011 keeps the five axes independent and identity data out of device persistence", () => {
  const originalActions = [
    "beginOnboarding", "completeOnboarding", "skipOnboarding", "resetOnboarding", "setPersona",
    "setDiscoveryPreferences", "openLocalSignal", "closeLocalSignal", "acknowledgeCommerceLocalBoundary",
    "setCommerceWalletStatus", "dispatchCommerce", "clearBDeviceContent",
  ]
  for (const action of originalActions) expect(provider).toContain(action)

  const deviceState = provider.slice(provider.indexOf("type OndoBDeviceState"), provider.indexOf("const B_DEVICE_KEY"))
  expect(deviceState).not.toMatch(/identity|passport|credential|did|presentation/i)
  expect(provider).toContain("export const B_DEVICE_KEY = ONDO_B_DEVICE_STORAGE_KEY")
  expect(setupSurfaces).not.toMatch(/(?:localStorage|sessionStorage|indexedDB|caches)\./)
})

test("OPENDID-B-013 keeps passport review sample-only and cannot collect raw media", () => {
  expect(passportOcr).toContain('data-review-fixture="redacted-passport"')
  expect(passportOcr).toContain('data-review-stage={stage === "review" ? "ocr-nfc-complete" : stage === "checking" ? "sample-check" : "ocr-nfc"}')
  expect(passportOcr).toContain('reviewMode: boolean')
  expect(passportOcr).toContain('role="status"')
  expect(passportOcr).toContain('aria-live="polite"')
  // NFC is now an explicit sample decision, not an asynchronous busy state.
  expect(passportOcr).not.toContain("aria-busy")
  expect(passportOcr).not.toContain("setTimeout")
  expect(passportOcr).toContain('data-testid="passport-demo-nfc-read"')
  expect(passportOcr).toContain('onClick={() => setStage("review")}')
  expect(passportOcr).toContain("bundled redacted sample")
  expect(passportOcr).toContain("Camera and file upload stay unavailable")
  expect(passportOcr).not.toMatch(/type="file"|capture=|FileReader|readAsDataURL|URL\.createObjectURL|URL\.revokeObjectURL|FormData|fetch\s*\(/)
})

test("OPENDID-B-016 keeps the passport sample action in-flow and visible in compact viewports", () => {
  expect(passportOcrCss).toContain("@media (max-width: 350px) and (max-height: 600px)")
  expect(passportOcrCss).toContain("@media (orientation: landscape) and (max-height: 500px)")
  expect(passportOcrCss).toMatch(/\.root\[data-ocr-stage="sample"\]\s*\{[^}]*display:\s*grid/s)
  expect(passportOcrCss).toMatch(/\.root\[data-ocr-stage="sample"\] \.actions\s*\{[^}]*grid-column:\s*2;[^}]*grid-row:\s*4;/s)
  expect(passportOcrCss).not.toMatch(/\.actions\s*\{[^}]*position:\s*(?:fixed|sticky)/s)
})

test("OPENDID-B-012 keeps identity out of the first onboarding screen and starts with a concise method choice", () => {
  const intentStep = onboarding.slice(onboarding.indexOf('{step === "intent"'), onboarding.indexOf('{step === "area"'))
  const methodStep = setup.slice(setup.indexOf('{phase === "method_select"'), setup.indexOf('{phase === "consent"'))

  expect(onboarding.match(/data-testid="onboarding-step-intent"/g) ?? []).toHaveLength(1)
  expect(intentStep).not.toMatch(/K-Tour ID|openIdentitySetup|identity provider|OmniOne|eKYC/i)
  expect(onboarding).not.toContain('data-testid="k-tour-id-setup-open"')
  expect(methodStep).toContain("copy.title")
  expect(methodStep).toContain("<small>{sumsubEnabled && !sampleRecovery && !fullPassChecks && !reviewMode && id === \"passport_ekyc\" ? sandboxDisclosure.scope : note}</small>")
  expect(methodStep).toContain(".map(({ id, icon: Icon, title, note, oldId, newId })")
  expect(methodStep).toContain("routes.filter(route => !sampleRecovery || route.id === state.identityCredential?.method)")
  expect(methodStep).toContain('data-identity-initial-focus={sampleRecovery || id === "mobile_id" ? true : undefined}')
  for (const testId of [
    "k-tour-id-method-mobile-id",
    "k-tour-id-method-mobile-residence-card",
    "k-tour-id-method-passport-ekyc",
  ]) expect(setup).toContain(testId)
  expect(methodStep).not.toMatch(/mobileNote|residenceNote|passportNote|OmniOne|ON-DEVICE|registered foreign resident|optional/i)
  expect(setup).toContain('<details className={styles.protocolDetails}')
  expect(setup).toContain('data-testid="k-tour-id-technical-truth"')
  expect(setup).toContain('data-testid="k-tour-id-private-boundary"')
  expect(onboarding).not.toMatch(/persona[\s\S]{0,300}(?:mobile_id|mobile_residence_card|passport_ekyc)/)
})
