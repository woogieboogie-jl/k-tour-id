"use client"

import { useEffect, useRef, useState } from "react"
import { CheckCircle2, ShieldCheck, Smartphone } from "lucide-react"
import { JIT_IDENTITY_CONSENT, type JitIdentityContext, type JitIdentityEligibility, type JitIdentityRequest } from "@/lib/hackathon/jit-identity-contract"
import { JIT_ACCESS_PATHS, JitIdentityError, jitAppLink, jitIdentityCall, jitQrSource, parseJitEligibility, parseJitRequest } from "./jit-identity-client-b"
import styles from "./jit-identity-check-b.module.css"

const COPY = {
  ko: { title: "필요할 때, 본인 확인", body: "선택한 행동에 필요한 본인 여부만 확인해요. 작성 중인 내용은 그대로 유지돼요.", supported: "대한민국 모바일 신분증", passport: "일본 여권을 포함한 해외 여권 확인은 별도 서비스예요. 이 모바일 신분증 연결로 여권을 확인하지 않아요.", consent: "이 행동을 위해 OmniOne CX의 본인 확인 결과를 사용하는 데 동의합니다.", start: "동의하고 계속", mobile: "이 휴대폰에서 확인", qr: "다른 휴대폰으로 확인", qrAlt: "모바일 신분증 확인 QR", wait: "신분증 앱에서 확인을 마친 뒤 결과를 확인해 주세요.", refresh: "확인 결과 가져오기", reconcile: "같은 요청 다시 확인", ready: "본인 확인 완료", return: "원래 하던 일로 돌아가기", cancel: "중단하고 돌아가기", unavailable: "지금은 본인 확인을 시작할 수 없어요. 지도 탐색과 개인 저장은 계속 이용할 수 있어요.", unknown: "처리 결과를 아직 확인하지 못했어요. 같은 요청을 확인해 주세요. 새 인증이나 원래 행동을 자동으로 실행하지 않아요.", terminal: "이 요청으로는 계속할 수 없어요. 원래 화면으로 돌아가 다시 시작해 주세요.", age: "이 테이블에는 19세 이상 확인이 필요해요. 현재 연결은 이 조건을 증명하지 못해 참여 요청을 진행할 수 없어요. 야간 지도 설정과는 별개예요.", access: "접근 코드 확인", accessBody: "제한된 연동 경로예요. 받은 접근 코드를 입력하면 같은 작업을 이어갈 수 있어요.", code: "접근 코드", grant: "접근 확인", details: "확인 범위", boundary: "예약·결제·혜택 사용은 별도 동의가 필요해요. 이 확인만으로 거래, 신분증 발급, 방문 인증이 완료되지는 않아요.", personFresh: "이 세션에서 확인된 본인 정보가 있어요. 이 행동에 사용하려면 동의해 주세요.", busy: "확인 중…", expired: "요청 시간이 만료됐어요. 원래 화면에서 다시 시작해 주세요.", openApp: "신분증 앱 열기" },
  ja: { title: "必要なときに、本人確認", body: "選んだ操作に必要な本人確認だけを行います。入力中の内容はそのまま残ります。", supported: "韓国のモバイル身分証", passport: "日本を含む海外パスポートの確認は別サービスです。このモバイル身分証連携ではパスポートを確認できません。", consent: "この操作のために、OmniOne CXの本人確認結果を利用することに同意します。", start: "同意して続ける", mobile: "このスマートフォンで確認", qr: "別のスマートフォンで確認", qrAlt: "モバイル身分証の確認QR", wait: "身分証アプリで確認を終えたら、結果を確認してください。", refresh: "確認結果を取得", reconcile: "同じリクエストを確認", ready: "本人確認が完了しました", return: "元の操作に戻る", cancel: "中止して戻る", unavailable: "現在、本人確認を開始できません。地図の閲覧や個人用の保存は引き続き利用できます。", unknown: "処理結果をまだ確認できません。同じリクエストを確認してください。新しい認証や元の操作を自動で実行しません。", terminal: "このリクエストでは続けられません。元の画面に戻って、もう一度始めてください。", age: "このテーブルには19歳以上の証明が必要です。現在の連携ではこの条件を証明できないため、参加リクエストを進められません。夜の地図設定とは別です。", access: "アクセスコードの確認", accessBody: "アクセスが制限された連携です。受け取ったコードを入力して、同じ操作を続けてください。", code: "アクセスコード", grant: "アクセスを確認", details: "確認の範囲", boundary: "予約・決済・特典の利用には別途同意が必要です。この確認だけで取引、身分証の発行、訪問の証明が完了することはありません。", personFresh: "このセッションには本人確認済みの情報があります。この操作に利用するには同意してください。", busy: "確認中…", expired: "リクエストの期限が切れました。元の画面からやり直してください。", openApp: "身分証アプリを開く" },
  en: { title: "Identity, only when needed", body: "Confirm only what this action needs. Your unfinished work stays here.", supported: "Korean Mobile ID", passport: "Japanese and other foreign passports need a separate service. This Mobile ID connection does not verify passports.", consent: "I agree to use the OmniOne CX identity result for this action.", start: "Agree and continue", mobile: "Use this phone", qr: "Use another phone", qrAlt: "Mobile ID verification QR", wait: "Finish in your ID app, then check the result here.", refresh: "Check verification result", reconcile: "Check this request", ready: "Identity confirmed", return: "Return to my action", cancel: "Stop and return", unavailable: "Identity verification cannot start right now. You can still explore the map and save places privately.", unknown: "The result is not confirmed yet. Check the same request. We will not automatically start another verification or perform your action.", terminal: "This request cannot continue. Return to your original screen to start again.", age: "This Table requires proof of being 19 or older. The current connection cannot establish that condition, so the request cannot proceed. Night-map settings are separate.", access: "Confirm access", accessBody: "This connection has restricted access. Enter your access code to continue the same task.", code: "Access code", grant: "Confirm access", details: "What this confirms", boundary: "Bookings, payments and benefits need separate consent. This check does not complete a transaction, issue an ID, or prove a visit.", personFresh: "Your identity is confirmed for this session. Consent is still needed to use it for this action.", busy: "Checking…", expired: "This request has expired. Return to your original screen to start again.", openApp: "Open ID app" },
} as const

export function JitIdentityCheckB({ locale, context, onAuthorized, onCancel }: { locale: "ko" | "en" | "ja"; context: JitIdentityContext; onAuthorized(request: JitIdentityRequest): void; onCancel(): void }) {
  const t = COPY[locale]
  const [eligibility, setEligibility] = useState<JitIdentityEligibility | null>(null)
  const [request, setRequest] = useState<JitIdentityRequest | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [accessPath, setAccessPath] = useState<string | null>(null)
  const [accessCode, setAccessCode] = useState("")
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(Date.now)
  const active = useRef(true), inFlight = useRef(false), controller = useRef<AbortController | null>(null), latest = useRef(request)
  latest.current = request
  const attempted = useRef(false)
  const accepted = useRef(false)
  useEffect(() => {
    active.current = true
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => { active.current = false; controller.current?.abort(); controller.current = null; inFlight.current = false; window.clearInterval(timer); const id = latest.current?.requestId; if (!accepted.current && id) void jitIdentityCall(`identity/requests/${id}/cancel`, {}).catch(() => {}) }
  }, [])
  async function run(work: (signal: AbortSignal) => Promise<void>) {
    if (inFlight.current || !active.current) return
    inFlight.current = true; setBusy(true); setError(null)
    const current = new AbortController(); controller.current = current
    try { await work(current.signal) }
    catch (cause) { if (active.current && !current.signal.aborted) { if (cause instanceof JitIdentityError && cause.status === 401 && JIT_ACCESS_PATHS[cause.code]) { if (!latest.current) attempted.current = false; setAccessPath(JIT_ACCESS_PATHS[cause.code]) } else setError(cause instanceof JitIdentityError ? cause.code : "identity_response_invalid") } }
    finally { if (controller.current === current) { inFlight.current = false; controller.current = null; if (active.current) setBusy(false) } }
  }
  async function load(signal: AbortSignal) {
    const value = parseJitEligibility(await jitIdentityCall("identity/eligibility", undefined, signal))
    if (active.current && !signal.aborted) { setEligibility(value); setAccessPath(null) }
  }
  useEffect(() => { if (context.purpose !== "age19") void run(load) }, [context.contextDigest]) // key changes remount at the caller
  async function update(path: string, body: unknown | undefined, signal: AbortSignal) {
    const next = parseJitRequest(await jitIdentityCall(path, body, signal), context, latest.current?.requestId)
    if (!active.current || signal.aborted) return
    setRequest(next); latest.current = next
  }
  function stop() {
    active.current = false; controller.current?.abort()
    const id = latest.current?.requestId
    // Cancellation always discards local authority, even if provider cleanup is unavailable.
    accepted.current = true // This explicit cancellation owns cleanup; do not repeat it on unmount.
    if (id && latest.current?.status !== "completed") void jitIdentityCall(`identity/requests/${id}/cancel`, {}).catch(() => {})
    onCancel()
  }
  const expired = Boolean(request && (Date.parse(request.expiresAt) <= now || request.status === "authorized" && Date.parse(request.authorizationExpiresAt ?? "") <= now))
  const terminal = Boolean(request && ["denied", "cancelled", "expired", "completed"].includes(request.status))
  const handoff = !expired && request?.status === "handoff" && request.handoff && Date.parse(request.handoff.expiresAt) > now ? request.handoff : null
  const qr = handoff?.kind === "qr" ? jitQrSource(handoff.qrBase64) : null
  const appLinks = handoff?.kind === "app" ? [{ label: "iPhone", value: handoff.iosLink }, { label: "Android", value: handoff.androidLink }, { label: "Samsung Wallet", value: handoff.ssPayLink }].flatMap(({ label, value }) => { const link = jitAppLink(value); return link ? [{ label, link }] : [] }) : []
  return <div className={styles.body} data-testid="jit-identity-check" data-status={request?.status ?? (accessPath ? "access" : "consent")}>
    <div className={styles.brand}><ShieldCheck size={22} aria-hidden="true" />OmniOne CX</div>
    <h2>{request?.status === "authorized" && !expired ? t.ready : accessPath ? t.access : t.title}</h2>
    <p>{t.body}</p>
    {context.purpose === "age19" ? <p role="status" className={styles.notice} data-testid="jit-age-unsupported">{t.age}</p> : accessPath ? <form className={styles.card} onSubmit={event => { event.preventDefault(); const code = accessCode; setAccessCode(""); void run(async signal => { await jitIdentityCall(accessPath, { accessCode: code }, signal); await load(signal) }) }}><p>{t.accessBody}</p><label>{t.code}<input className={styles.input} type="password" autoComplete="off" value={accessCode} maxLength={128} onChange={event => setAccessCode(event.target.value)} /></label><button className={styles.primary} disabled={busy || !accessCode.trim()}>{t.grant}</button></form> : <>
      {!request && !attempted.current ? <><div className={styles.card}><strong><Smartphone size={18} aria-hidden="true" /> {t.supported}</strong><p>{t.passport}</p></div>{eligibility?.person.state === "verified" ? <p>{t.personFresh}</p> : null}{eligibility && !eligibility.canStart ? <p role="status">{t.unavailable}</p> : <><label className={styles.consent}><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} disabled={busy} data-testid="jit-identity-consent" /><span>{t.consent}</span></label><button className={styles.primary} disabled={busy || !consent || !eligibility?.canStart} data-testid="jit-identity-create" onClick={() => { attempted.current = true; void run(signal => update("identity/requests", { ...context, consentVersion: JIT_IDENTITY_CONSENT }, signal)) }}>{t.start}</button></>}</> : null}
      {request?.status === "awaiting_identity" && !expired && !error ? <div className={styles.actions}><button className={styles.primary} disabled={busy} data-testid="jit-identity-mobile" onClick={() => void run(signal => update(`identity/requests/${request.requestId}/start`, { mobile: true }, signal))}>{t.mobile}</button><button disabled={busy} data-testid="jit-identity-qr" onClick={() => void run(signal => update(`identity/requests/${request.requestId}/start`, { mobile: false }, signal))}>{t.qr}</button></div> : null}
      {handoff ? <div className={styles.card}>{qr ? <img src={qr} className={styles.qr} alt={t.qrAlt} /> : null}{appLinks.map(({ label, link }) => <a className={styles.link} key={label} href={link} target={link.startsWith("https:") ? "_blank" : undefined} rel="noreferrer noopener" data-testid="jit-identity-app-link">{t.openApp} · {label}</a>)}<p>{t.wait}</p></div> : null}
      {request?.status === "authorized" && !expired ? <button className={styles.primary} disabled={busy} data-testid="jit-identity-return" onClick={() => { if (!request.authorizationExpiresAt || Date.parse(request.authorizationExpiresAt) <= Date.now()) { setNow(Date.now()); return }; accepted.current = true; onAuthorized(request) }}><CheckCircle2 size={18} aria-hidden="true" />{t.return}</button> : null}
      {expired ? <p role="status">{t.expired}</p> : terminal ? <p role="status">{t.terminal}</p> : request && request.status !== "authorized" && request.status !== "awaiting_identity" && !error ? <button disabled={busy} className={styles.primary} data-testid="jit-identity-refresh" onClick={() => void run(signal => update(`identity/requests/${request.requestId}/${request.status === "handoff" ? "complete" : ""}`.replace(/\/$/, ""), request.status === "handoff" ? {} : undefined, signal))}>{t.refresh}</button> : null}
      {request && error ? <button disabled={busy} data-testid="jit-identity-reconcile" onClick={() => void run(signal => update(`identity/requests/${request.requestId}`, undefined, signal))}>{t.reconcile}</button> : null}
    </>}
    {error ? <p role="alert" className={styles.notice}>{attempted.current ? t.unknown : t.unavailable}</p> : null}
    {error && !request && !attempted.current && !accessPath ? <button disabled={busy} onClick={() => void run(load)}>{t.reconcile}</button> : null}
    {busy ? <p role="status">{t.busy}</p> : null}
    <button type="button" data-testid="jit-identity-cancel" onClick={stop}>{t.cancel}</button>
    <details className={styles.card}><summary>{t.details}</summary><p>{t.boundary}</p></details>
  </div>
}
