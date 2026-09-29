"use client"

import { BookOpen, Check, ChevronRight, Clock3, LoaderCircle, MapPin, ShieldCheck } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { requestPlaceServiceReturnB } from "../commerce-b/place-service-registry-b"
import { evaluateKPassService } from "../contracts/kpass-capabilities"
import { capturePlaceServiceMapReturnB } from "../map/place-service-map-return-b"
import { useOndoB } from "../shared/state/ondo-b-provider"
import { SheetB } from "../shared/ui/sheet-b"
import { QA_RUNTIME_ENABLED, qaReviewFixtureOptions, useReviewSampleSession } from "../shared/ui/use-qa-controls"
import { requestHackathonOpenB } from "../hackathon-b/hackathon-campaign"
import {
  B_ACTION_GATE_CANCEL_EVENT, B_ACTION_GATE_COMPLETE_EVENT, B_ACTION_GATE_READY_EVENT,
  actionReturnFromBEvent, consumePendingBActionAtMutation, createBExperienceActionReturn,
  finalizeConsumedBAction, requestBActionGate, restoreBActionGateSession,
  type BExperienceActionReturn,
} from "../identity-b/action-gate-contract-b"
import { EXPERIENCE_COPY_B } from "./experience-copy-b"
import {
  createExperienceMockPermitB, EXPERIENCE_CAMPAIGN_ID_B, EXPERIENCE_CHANNEL_B, EXPERIENCE_CHANGED_EVENT_B,
  EXPERIENCE_OPEN_EVENT_B, EXPERIENCE_PLACE_ID_B, hasExperiencePermitB, requestExperienceB,
  type ExperienceCommandB, type ExperienceContextB, type ExperiencePermitB, type ExperienceRecordB,
} from "./experience-model-b"
import { commitExperienceB, openExperienceB, readExperienceB } from "./experience-store-b"
import styles from "./experience-b.module.css"

const OPEN_KEY = "ktour.experience-save-open.v2"
type Scenario = "success" | "executionUnknown" | "executionFailure" | "serviceBlocked" | "auditDelay" | "auditFailure" | "cancelRace"

/** Public reading is free; only the explicit save action starts verification. */
export function ExperienceEntryB({ placeId, locale }: { placeId: string; locale: "en" | "ko" | "ja" }) {
  if (placeId !== EXPERIENCE_PLACE_ID_B) return null
  const t = EXPERIENCE_COPY_B[locale]
  return <button type="button" className={styles.entry} data-testid="experience-open" data-place-service="experience" data-place-return-section="experience" data-service-place-id={placeId} onClick={() => {
    capturePlaceServiceMapReturnB(placeId)
    requestExperienceB(placeId)
  }}><BookOpen size={23} aria-hidden="true" /><span><strong>{t.entry}</strong><small>{t.entryHint}</small></span><ChevronRight size={18} aria-hidden="true" /></button>
}

export function ExperienceMountB() {
  return <PublicExperienceB />
}

function GuideContentB({ locale }: { locale: "en" | "ko" | "ja" }) {
  const t = EXPERIENCE_COPY_B[locale]
  return <section className={styles.guide} data-testid="experience-guide-content"><h2>{t.guideHeading}</h2>{([[t.guide1, t.guide1Body], [t.guide2, t.guide2Body], [t.guide3, t.guide3Body]] as const).map(([heading, text], index) => <div key={heading}><span>{String(index + 1).padStart(2, "0")}</span><article><h3>{heading}</h3><p>{text}</p></article></div>)}</section>
}

/** Reading owns only an in-memory view. Do not initialize the save store,
 * action gate, permit, or execution observer until Add to my pass is chosen. */
function PublicExperienceB() {
  const { state } = useOndoB()
  const sample = useReviewSampleSession()
  // Retain the old simulator only in an explicitly compiled QA build. A public
  // review preference must never choose mock saving over the server journey.
  const sampleSave = QA_RUNTIME_ENABLED && sample
  const t = EXPERIENCE_COPY_B[state.locale]
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [resume, setResume] = useState(false)
  const [scenario, setScenario] = useState<Scenario>("success")
  const origin = useRef<"place" | "pass">("place")
  useEffect(() => {
    const requested = (event: Event) => {
      const detail = (event as CustomEvent).detail
      if (detail?.placeId !== EXPERIENCE_PLACE_ID_B) return
      origin.current = detail.source === "pass" ? "pass" : "place"
      setOpen(true)
    }
    window.addEventListener(EXPERIENCE_OPEN_EVENT_B, requested)
    try {
      const savedOrigin = sampleSave ? sessionStorage.getItem(OPEN_KEY) : null
      if (savedOrigin === "place" || savedOrigin === "pass") {
        origin.current = savedOrigin; setResume(true); setOpen(true); setSaving(true)
      }
    } catch { /* Public reading requires no storage. */ }
    return () => window.removeEventListener(EXPERIENCE_OPEN_EVENT_B, requested)
  }, [sampleSave])
  function close() {
    setOpen(false); setSaving(false)
    if (origin.current === "place") requestPlaceServiceReturnB(EXPERIENCE_PLACE_ID_B, "experience")
    else window.setTimeout(() => {
      const row = document.querySelector<HTMLButtonElement>("[data-testid='server-guide-open'], [data-testid='experience-saved-guide']")
      if (document.activeElement === document.body && row && !row.closest("[inert], [aria-hidden='true']")) row.focus({ preventScroll: true })
    }, 180)
  }
  function readAgain() {
    try { sessionStorage.removeItem(OPEN_KEY) } catch { /* The public guide remains readable. */ }
    setResume(false); setSaving(false)
  }
  function saveToPass() {
    if (sampleSave) { setResume(false); setSaving(true); return }
    if (requestHackathonOpenB({ venueId: EXPERIENCE_PLACE_ID_B, locale: state.locale, source: "guide", returnTo: origin.current })) setOpen(false)
  }
  if (!open) return null
  if (saving) return <ExperienceFlowB initialScenario={scenario} resume={resume} origin={origin.current} onClose={close} onRead={readAgain} />
  return <SheetB label={t.publicTitle} locale={state.locale} onClose={close} variant="full-task" size="full" header={<strong>{t.publicTitle}</strong>}
    shouldRestoreFocus={() => origin.current === "pass"} initialFocusSelector="[data-testid='experience-public-heading']"
    footer={<div className={styles.footer}><small className={styles.footerHint}>{t.readingFree}</small><button type="button" className={styles.primary} data-testid="experience-add-to-pass" onClick={saveToPass}>{t.addToPass}<ChevronRight size={18} aria-hidden="true" /></button></div>}>
    <article className={styles.body} data-testid="experience-public-guide">
      <div className={styles.eyebrow}><span><MapPin size={14} aria-hidden="true" />{t.place}</span></div>
      <h1 tabIndex={-1} data-testid="experience-public-heading">{t.publicTitle}</h1><p className={styles.lead}>{t.publicBody}</p>
      <GuideContentB locale={state.locale} />
      {sampleSave ? <details className={styles.details} data-testid="experience-public-details"><summary>{t.details}<ChevronRight size={16} aria-hidden="true" /></summary><p>{t.boundary}</p><p>{t.detailsBody}</p><label>{t.scenario}<select data-testid="experience-public-scenario" value={scenario} onChange={event => setScenario(event.target.value as Scenario)}>{(["success", "executionUnknown", "executionFailure", "serviceBlocked", "auditDelay", "auditFailure", "cancelRace"] as const).map(value => <option key={value} value={value}>{t[value]}</option>)}</select></label></details> : null}
    </article>
  </SheetB>
}

function ExperienceFlowB({ initialScenario, resume, origin, onClose, onRead }: { initialScenario: Scenario; resume: boolean; origin: "place" | "pass"; onClose(): void; onRead(): void }) {
  const { state } = useOndoB()
  const t = EXPERIENCE_COPY_B[state.locale]
  const [open, setOpen] = useState(false)
  const [record, setRecord] = useState<ExperienceRecordB | null>(null)
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [gatePending, setGatePending] = useState(false)
  const [consent, setConsent] = useState(false)
  const [scenario, setScenario] = useState<Scenario>(initialScenario)
  const [permitVersion, setPermitVersion] = useState(0)
  const [clock, setClock] = useState(Date.now)
  const recordRef = useRef(record); recordRef.current = record
  const stateRef = useRef(state); stateRef.current = state
  const openRef = useRef(open); openRef.current = open
  const busyRef = useRef(false)
  const permitRef = useRef<ExperiencePermitB | null>(null)
  const expectedGateRef = useRef<BExperienceActionReturn | null>(null)
  const channelRef = useRef<BroadcastChannel | null>(null)
  const mountedRef = useRef(true)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const returningRef = useRef(false)
  const autoAttemptRef = useRef<string | null>(null)
  const startCheckRef = useRef(!resume)

  function context(): ExperienceContextB {
    return { sampleMode: qaReviewFixtureOptions().allowReviewFixture === true, now: Date.now(), credential: stateRef.current.identityCredential, permit: permitRef.current }
  }
  function publish(next: ExperienceRecordB) {
    if (!mountedRef.current) return
    if (recordRef.current?.intentId === next.intentId && recordRef.current.revision > next.revision) return
    recordRef.current = next; setRecord(next); setClock(Date.now())
    channelRef.current?.postMessage({ changed: true })
    window.dispatchEvent(new Event(EXPERIENCE_CHANGED_EVENT_B))
  }
  async function refresh() {
    try {
      const next = await readExperienceB()
      if (next && mountedRef.current && (!recordRef.current || recordRef.current.intentId !== next.intentId || recordRef.current.revision <= next.revision)) { recordRef.current = next; setRecord(next); setClock(Date.now()); setError(false) }
    } catch { if (mountedRef.current) setError(true) }
  }
  async function commit(command: ExperienceCommandB, expected = recordRef.current): Promise<ExperienceRecordB | null> {
    if (busyRef.current || !expected) return null
    busyRef.current = true; setBusy(true)
    try {
      const result = await commitExperienceB(expected, command, context)
      publish(result.record); setError(!result.changed)
      return result.changed ? result.record : null
    } catch { if (mountedRef.current) setError(true); return null }
    finally { busyRef.current = false; if (mountedRef.current) setBusy(false) }
  }
  async function show() {
    returningRef.current = false
    setOpen(true); setConsent(false)
    try {
      let next = await openExperienceB()
      if (next.authorization === "granted") next = (await commitExperienceB(next, { type: "execution", outcome: "unknown" }, context)).record
      if (!mountedRef.current) return
      const pending = restoreBActionGateSession(sessionStorage, new Date(), qaReviewFixtureOptions()).pending
      if (pending?.cta === "REDEEM_DEMO_ENTITLEMENT" && pending.intentId === next.intentId) { expectedGateRef.current = pending; setGatePending(true) }
      if (recordRef.current?.intentId === next.intentId && recordRef.current.revision > next.revision) return
      recordRef.current = next; setRecord(next); setError(false)
      try { sessionStorage.setItem(OPEN_KEY, origin) } catch { /* Reopening from the place still reads the same durable history. */ }
    } catch { if (mountedRef.current) setError(true) }
  }
  function leave() {
    returningRef.current = true
    setOpen(false); setConsent(false)
    try { sessionStorage.removeItem(OPEN_KEY) } catch { /* Never convert close into revoke or success. */ }
    // Closing pauses this local simulator. A granted operation resumes through
    // explicit same-intent status checking, never an assumed cancellation.
    if (recordRef.current?.authorization === "granted") void commit({ type: "execution", outcome: "unknown" })
    onClose()
  }
  function beginCheck() {
    const current = recordRef.current
    if (!current || busyRef.current || gatePending) return
    const request = createBExperienceActionReturn({ venueId: current.placeId, campaignId: current.campaignId, intentId: current.intentId })
    expectedGateRef.current = request
    setConsent(false); setError(false)
    setGatePending(true)
    if (!requestBActionGate(request, qaReviewFixtureOptions())) { expectedGateRef.current = null; setGatePending(false); setError(true); return }
  }
  async function checked(event: Event) {
    const detail = actionReturnFromBEvent(event instanceof CustomEvent ? event.detail : null)
    const expected = expectedGateRef.current
    if (!detail || detail.cta !== "REDEEM_DEMO_ENTITLEMENT" || !expected || detail.tokenId !== expected.tokenId || detail.intentId !== recordRef.current?.intentId) return
    const credential = stateRef.current.identityCredential
    const now = new Date()
    const options = { ...qaReviewFixtureOptions(), credential }
    const session = restoreBActionGateSession(sessionStorage, now, options)
    const satisfied = new Set<"account" | "person">()
    if (stateRef.current.account === "ACC-ACTIVE") satisfied.add("account")
    if (session.person.status === "eligible" && session.person.expiresAt && Date.parse(session.person.expiresAt) > now.getTime()) satisfied.add("person")
    const consumed = consumePendingBActionAtMutation(sessionStorage, expected, satisfied, now, options)
    if (!consumed || consumed.cta !== "REDEEM_DEMO_ENTITLEMENT" || !finalizeConsumedBAction(sessionStorage, consumed, now, options)) { setError(true); setGatePending(false); return }
    permitRef.current = createExperienceMockPermitB(consumed.intentId, credential, now.getTime())
    expectedGateRef.current = null; setGatePending(false); setPermitVersion(value => value + 1)
    window.dispatchEvent(new CustomEvent(B_ACTION_GATE_COMPLETE_EVENT, { detail: consumed }))
    const latest = await readExperienceB().catch(() => null)
    if (!latest || latest.intentId !== consumed.intentId || !permitRef.current) { setError(true); return }
    recordRef.current = latest; setRecord(latest)
    if (["none", "expired", "failed", "revoked"].includes(latest.authorization)) await commit({ type: "propose" })
    else setError(false)
  }
  const checkedRef = useRef(checked); checkedRef.current = checked
  const showRef = useRef(show); showRef.current = show
  useEffect(() => {
    mountedRef.current = true
    const ready = (event: Event) => { void checkedRef.current(event) }
    const cancelled = (event: Event) => {
      const detail = actionReturnFromBEvent(event instanceof CustomEvent ? event.detail : null)
      if (detail?.cta !== "REDEEM_DEMO_ENTITLEMENT" || detail.tokenId !== expectedGateRef.current?.tokenId) return
      expectedGateRef.current = null; permitRef.current = null; setGatePending(false); setConsent(false); setPermitVersion(value => value + 1)
      onRead()
    }
    window.addEventListener(B_ACTION_GATE_READY_EVENT, ready)
    window.addEventListener(B_ACTION_GATE_CANCEL_EVENT, cancelled)
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(EXPERIENCE_CHANNEL_B) : null
    channelRef.current = channel
    if (channel) channel.onmessage = () => { if (openRef.current) void refresh() }
    const focus = () => { if (openRef.current) void refresh() }
    window.addEventListener("focus", focus)
    void showRef.current()
    return () => {
      mountedRef.current = false; channel?.close(); channelRef.current = null
      window.removeEventListener(B_ACTION_GATE_READY_EVENT, ready)
      window.removeEventListener(B_ACTION_GATE_CANCEL_EVENT, cancelled)
      window.removeEventListener("focus", focus)
    }
  }, [])
  useEffect(() => {
    if (!open) return
    const timer = window.setInterval(() => setClock(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [open])
  const livePermit = record ? hasExperiencePermitB(record, { ...context(), now: clock }) : false
  const stage = !record ? "loading" : record.fulfillment === "fulfilled" ? "complete" : record.fulfillment === "blocked" ? "blocked"
    : record.cancelRequested && record.authorization === "unknown" ? "cancelPending"
    : record.authorization === "revoked" ? "cancelled" : record.authorization === "expired" ? "expired"
    : record.authorization === "unknown" ? "unknown" : record.authorization === "failed" ? "failed"
    : record.authorization === "consumed" ? "pending" : record.authorization === "granted" ? "running"
    : record.scope && livePermit ? "proposal" : "offer"

  useEffect(() => {
    if (!record || !startCheckRef.current || gatePending || error) return
    startCheckRef.current = false
    if (stage === "offer" && record.authorization === "none") beginCheck()
  // Only the explicit Add to my pass click may begin this check automatically.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record, gatePending, error, stage])

  useEffect(() => {
    if (!open || gatePending || busy || !record) return
    const key = `${record.intentId}:${record.revision}:${stage}`
    if (autoAttemptRef.current === key) return
    let command: ExperienceCommandB | null = null
    if (record.scope && record.scope.expiresAt <= clock && ["none", "granted", "failed"].includes(record.authorization)) command = { type: "expire" }
    else if (stage === "running" && livePermit) command = { type: "execution", outcome: scenario === "executionUnknown" ? "unknown" : scenario === "executionFailure" ? "failure" : "success" }
    else if (stage === "pending" && (record.cancelRequested || Boolean(record.scope && record.scope.expiresAt <= clock)
      || Boolean(state.identityCredential && evaluateKPassService(state.identityCredential, { service: "person", now: clock }).status !== "allowed"))) command = { type: "fulfill", outcome: "blocked" }
    else if (stage === "pending" && livePermit) command = { type: "fulfill", outcome: scenario === "serviceBlocked" ? "blocked" : "success" }
    else if (stage === "complete" && record.audit === "pending" && !["auditDelay", "auditFailure"].includes(scenario)) command = { type: "audit", outcome: "success" }
    else if (stage === "complete" && record.audit === "pending" && scenario === "auditFailure") command = { type: "audit", outcome: "failure" }
    if (!command) return
    const action = command
    const delay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 250 : 750
    const expected = record
    const timer = window.setTimeout(() => { autoAttemptRef.current = key; void commit(action, expected) }, delay)
    return () => window.clearTimeout(timer)
  // Each durable revision may be automatically advanced at most once. Retry is explicit.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, record, stage, clock, gatePending, busy, livePermit, permitVersion, scenario, state.identityCredential])
  useEffect(() => {
    if (!open || gatePending || state.identitySetupOrigin) return
    const frame = requestAnimationFrame(() => headingRef.current?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(frame)
  }, [open, stage, gatePending, state.identitySetupOrigin])
  useEffect(() => { setConsent(false) }, [record?.scope?.proposalDigest, state.identityCredential?.credentialId])

  if (!open) return null
  const body = stage === "proposal" ? t.readyBody : stage === "offer" || stage === "loading" ? t.offerBody : t[`${stage}Body` as keyof typeof t]
  const title = stage === "proposal" ? t.readyTitle : stage === "offer" || stage === "loading" ? t.offerTitle : t[stage as keyof typeof t]
  const needsCheck = record && !livePermit && ["offer", "proposal", "failed", "pending", "running"].includes(stage)
  const footer = <div className={styles.footer}>
    {stage === "offer" || stage === "expired" || stage === "cancelled" || stage === "failed" ? <button type="button" className={styles.primary} data-testid="experience-check" disabled={busy || !record} onClick={beginCheck}>{stage === "offer" ? t.check : t.retry}<ShieldCheck size={18} aria-hidden="true" /></button>
      : stage === "proposal" ? <button type="button" className={styles.primary} data-testid="experience-approve" disabled={!consent || busy || !record?.scope || !livePermit || record.scope.expiresAt <= clock} onClick={() => { if (record?.scope) void commit({ type: "approve", proposalDigest: record.scope.proposalDigest }) }}>{t.approve}<ChevronRight size={18} aria-hidden="true" /></button>
        : needsCheck ? <button type="button" className={styles.primary} data-testid="experience-recheck" disabled={busy} onClick={beginCheck}>{t.recheck}<ShieldCheck size={18} aria-hidden="true" /></button>
          : stage === "unknown" || stage === "cancelPending" ? <button type="button" className={styles.primary} data-testid="experience-check-result" disabled={busy} onClick={() => { if (record) void commit(stage === "cancelPending" ? { type: "resolve_cancel", outcome: scenario === "cancelRace" ? "consumed" : "revoked" } : { type: "reconcile_execution", outcome: "success", executionRef: `${record.intentId}:execution` }) }}>{t.checkResult}</button> : null}
    <button type="button" className={styles.secondary} data-testid="experience-return" onClick={leave}>{origin === "pass" ? t.savedGuides : t.back}<MapPin size={17} aria-hidden="true" /></button>
  </div>
  return <SheetB label={t.title} locale={state.locale} onClose={leave} variant="full-task" size="full" header={<strong>{t.title}</strong>} footer={footer}
    suspended={gatePending || state.identitySetupOrigin !== null} shouldRestoreFocus={() => !returningRef.current} initialFocusSelector="[data-testid='experience-heading']">
    <article className={styles.body} data-testid="experience-flow" data-stage={stage} data-intent-id={record?.intentId} data-place-id={EXPERIENCE_PLACE_ID_B} data-campaign-id={EXPERIENCE_CAMPAIGN_ID_B} data-authorization={record?.authorization} data-fulfillment={record?.fulfillment} data-audit={record?.audit} data-used-count={record?.usedCount} data-execution-count={record?.executionCount}>
      <div className={styles.eyebrow}><span><MapPin size={14} aria-hidden="true" />{t.place}</span><small>{t.sample}</small></div>
      <div className={styles.hero}>{!error && ["running", "pending", "loading"].includes(stage) ? <LoaderCircle className={styles.spinner} size={30} aria-hidden="true" /> : stage === "complete" ? <Check size={32} aria-hidden="true" /> : <BookOpen size={30} aria-hidden="true" />}</div>
      <h1 ref={headingRef} tabIndex={-1} data-testid="experience-heading">{title}</h1>
      <p className={styles.lead} aria-live="polite">{body}</p>
      {error ? <div role="alert" className={styles.notice} data-testid="experience-storage-error"><p>{t.error}</p><button type="button" onClick={() => record ? void refresh() : void show()}>{t.refresh}</button></div> : null}
      {stage === "offer" ? <p className={styles.notice} data-testid="experience-boundary">{t.boundary}</p> : null}
      {stage === "proposal" && record?.scope ? <>
        <section className={styles.scope} data-testid="experience-scope"><small>{t.helper}</small><h2>{t.scope}</h2><dl><div><dt>{t.recipient}</dt><dd>{t.noMoney}</dd></div><div><dt>{t.expiry}</dt><dd><Clock3 size={15} aria-hidden="true" /><time dateTime={new Date(record.scope.expiresAt).toISOString()}>{new Date(record.scope.expiresAt).toLocaleTimeString(state.locale, { hour: "2-digit", minute: "2-digit" })}</time></dd></div></dl></section>
        <p className={styles.notice}>{t.boundary}</p><label className={styles.consent}><input type="checkbox" data-testid="experience-consent" checked={consent} onChange={event => setConsent(event.target.checked)} /><span>{t.consent}</span></label>
      </> : null}
      <GuideContentB locale={state.locale} />
      {stage === "complete" ? <>
        <div className={styles.notice} data-testid="experience-audit-status"><p>{record?.audit === "confirmed" ? t.auditConfirmed : record?.audit === "failed" ? t.auditFailed : t.auditPending}</p>{record?.audit !== "confirmed" ? <button type="button" data-testid="experience-audit-retry" disabled={busy} onClick={() => void commit({ type: "audit", outcome: "success" })}>{t.auditRetry}</button> : null}</div>
      </> : null}
      {["running", "unknown", "pending"].includes(stage) && !record?.cancelRequested ? <button type="button" className={styles.textButton} data-testid="experience-stop" disabled={busy} onClick={() => void commit({ type: "request_cancel" })}>{t.stop}</button> : null}
      <details className={styles.details} data-testid="experience-details"><summary>{t.details}<ChevronRight size={16} aria-hidden="true" /></summary><p>{t.detailsBody}</p><p>{t.boundary}</p>
        {record && ["none", "expired", "revoked", "failed"].includes(record.authorization) ? <label>{t.scenario}<select data-testid="experience-scenario" value={scenario} onChange={event => setScenario(event.target.value as Scenario)}>{(["success", "executionUnknown", "executionFailure", "serviceBlocked", "auditDelay", "auditFailure", "cancelRace"] as const).map(value => <option key={value} value={value}>{t[value]}</option>)}</select></label> : null}
        {record ? <dl className={styles.receipt} data-testid="experience-receipt"><div><dt>{t.authLabel}</dt><dd>{record.authorization}</dd></div><div><dt>{t.serviceLabel}</dt><dd>{record.fulfillment}</dd></div><div><dt>{t.auditLabel}</dt><dd>{record.audit}</dd></div>{[record.intentId, record.executionRef, record.fulfillmentRef, record.auditRef].filter(Boolean).map(reference => <div key={reference!}><dd>{reference}</dd></div>)}</dl> : null}
      </details>
    </article>
  </SheetB>
}
