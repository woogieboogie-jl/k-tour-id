import { expect, test } from "@playwright/test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8")
const setup = source("features/ondo/identity-b/ktour-id-setup-b.tsx")
const css = source("features/ondo/identity-b/ktour-id-setup-b.module.css")

test("KTOUR-MEANING-001 method choice is the first focus owner with concise route guidance", () => {
  const method = setup.slice(setup.indexOf('{phase === "method_select"'), setup.indexOf('{phase === "consent"'))

  expect(method).toContain('data-identity-initial-focus={sampleRecovery || id === "mobile_id" ? true : undefined}')
  expect(method).toContain('routes.filter(route => !sampleRecovery || route.id === state.identityCredential?.method)')
  expect(setup).toContain('if (sampleRecovery && nextMethod !== state.identityCredential?.method) return')
  expect(method).not.toContain("copy.lead")
  expect(method).toContain("<small>{sumsubEnabled && !sampleRecovery && !fullPassChecks && !reviewMode && id === \"passport_ekyc\" ? sandboxDisclosure.scope : note}</small>")
  for (const note of ["mobileNote", "residenceNote", "passportNote"]) expect(setup).toContain(`note: copy.${note}`)
  expect(method).not.toMatch(/mobileNote|residenceNote|passportNote|OmniOne|provider|optional/i)
  expect(method.match(/className=\{styles\.route\}/g)).toHaveLength(1)
})

test("KTOUR-MEANING-002 consent keeps the human decision visible and folds provider and retention detail", () => {
  const consent = setup.slice(setup.indexOf('{phase === "consent"'), setup.indexOf('{phase === "cx_handoff_preview"'))
  const methodDetails = setup.slice(setup.indexOf("function methodDetails"), setup.indexOf("function progressStep"))

  const visibleFacts = consent.indexOf("<Disclosure rows=")
  const technicalDisclosure = consent.indexOf("<Disclosure label={copy.consentDetails}")
  expect(visibleFacts).toBeGreaterThanOrEqual(0)
  expect(technicalDisclosure).toBeGreaterThan(visibleFacts)
  for (const id of [
    "identity-consent-requester",
    "identity-consent-purpose",
    "identity-consent-evidence",
  ]) expect(consent.slice(visibleFacts, technicalDisclosure)).toContain(id)
  expect(consent.slice(visibleFacts, technicalDisclosure)).not.toMatch(/identity-consent-(?:provider|retention)/)
  expect(consent.slice(technicalDisclosure)).toContain("identity-consent-retention")
  expect(consent.slice(technicalDisclosure)).toContain("identity-consent-provider")
  expect(methodDetails).toContain("evidence: copy.passportEvidence")
  expect(methodDetails).toMatch(/provider:.*copy\.passportEvidence/)
  expect(methodDetails).not.toMatch(/provider:.*copy\.passportNote/)
  for (const evidence of ["Passport check", "여권 확인", "パスポート確認"]) expect(setup).toContain(evidence)
  expect(setup).toContain('<PassportOcrStepB locale={state.locale} reviewMode={reviewMode}')
  expect(setup).toContain('setPhase(method === "passport_ekyc" ? "document_preview" : "cx_handoff_preview")')
  expect(consent).not.toContain("copy.consentBody")
  expect(consent).toContain("data-identity-initial-focus")
})

test("KTOUR-MEANING-003 setup stays three steps and only a protected-action origin can reach one-shot presentation", () => {
  const request = setup.slice(setup.indexOf('{phase === "presentation_request"'), setup.indexOf('{phase === "presentation_consent"'))
  const visibleFacts = request.indexOf("<Disclosure rows=")
  const retentionDisclosure = request.indexOf("<Disclosure label={copy.consentDetails}")

  expect(setup).toContain("[copy.chooseStep, copy.checkStep, sandboxPassport ? sandboxDisclosure.returnStep : copy.issueStep]")
  expect(setup).not.toContain("[copy.chooseStep, copy.checkStep, copy.issueStep, copy.presentStep]")
  expect(setup).toContain('origin === "action_gate" ? <button')
  expect(setup).toContain('data-testid="k-tour-id-presentation-open"')
  expect(setup).toContain("onClick={openPresentation}")
  for (const id of [
    "identity-presentation-requester",
    "identity-presentation-purpose",
    "identity-presentation-evidence",
    "identity-presentation-retention",
    "identity-presentation-predicate",
    "k-tour-id-presentation-approve",
    "k-tour-id-result-back",
  ]) expect(setup).toContain(id)
  expect(visibleFacts).toBeGreaterThanOrEqual(0)
  expect(retentionDisclosure).toBeGreaterThan(visibleFacts)
  expect(request.slice(visibleFacts, retentionDisclosure)).not.toContain("identity-presentation-retention")
  expect(request.slice(retentionDisclosure)).toContain("identity-presentation-retention")
  expect(setup).toMatch(/data-identity-initial-focus[^>]*data-testid="k-tour-id-continue"/)
  expect(setup).toMatch(/data-identity-initial-focus[^>]*data-testid="k-tour-id-presentation-approve"/)
  expect(setup).toMatch(/data-identity-initial-focus[^>]*data-testid="k-tour-id-result-back"/)
})

test("KTOUR-MEANING-004 technical truth stays progressive without visible environment labels", () => {
  const copy = setup.slice(setup.indexOf("const COPY"), setup.indexOf("const FOCUSABLE"))

  expect(setup).toContain('<details className={styles.protocolDetails} data-compact="true">')
  expect(setup).toContain('data-testid="k-tour-id-private-boundary"')
  expect(setup).toContain("No identity service is connected, no DID or VC is issued")
  expect(copy).not.toMatch(/\b(?:simulated|demo|test)\b/i)
  expect(copy).toContain("No ID app opens and no personal data is sent.")
})

test("KTOUR-MEANING-005 Residence fallback exposes the passport assurance limit before the alternate action", () => {
  const unavailable = setup.slice(setup.indexOf('{phase === "unavailable"'), setup.indexOf('{phase === "failed"'))
  const protocol = setup.slice(setup.indexOf('<details className={styles.protocolDetails}'), setup.indexOf('<span className={styles.contractOnly}'))

  expect(unavailable).toContain('body={method === "mobile_residence_card" ? copy.assurance : copy.unavailableBody}')
  expect(unavailable.indexOf("body={method")).toBeLessThan(unavailable.indexOf("primary={"))
  expect(unavailable).toContain('primary={sampleRecovery ? sampleCopy.startAgain : method === "mobile_residence_card" ? copy.usePassport : copy.another}')
  // New issuance may choose passport with its narrower assurance. Recovery
  // retains the original method and cannot silently switch to that alternative.
  expect(unavailable).toContain('sampleRecovery ? startFreshRequest() : method === "mobile_residence_card" ? chooseMethod("passport_ekyc")')
  expect(protocol).toContain("copy.unavailableTechnical")
  expect(protocol).not.toContain("copy.assurance")
  for (const assurance of [
    "A passport does not confirm registered-resident status or replace a Residence Card check.",
    "여권은 등록외국인 체류 자격을 확인하거나 외국인등록증 확인을 대신할 수 없어요.",
    "パスポートでは登録外国人としての在留資格を確認できず、在留カード確認の代わりにはなりません。",
  ]) expect(setup).toContain(assurance)
})

test("KTOUR-MEANING-006 mobile, short landscape and accessibility modes retain the controls", () => {
  expect(css).toContain("@media (max-width: 430px)")
  expect(css).toContain("@media (orientation: landscape) and (max-height: 500px)")
  expect(css).toContain("@media (prefers-reduced-motion: reduce)")
  expect(css).toContain("@media (forced-colors: active)")
  expect(css).toMatch(/\.iconButton[^}]*width:\s*44px[^}]*height:\s*44px/s)
  expect(css).toMatch(/\.primary,[\s\S]*?\.secondary[^}]*min-height:\s*48px/)
  expect(css).not.toMatch(/font-size:\s*(?:[0-9](?:\.[0-9]+)?|1[01](?:\.[0-9]+)?)px/)
})
