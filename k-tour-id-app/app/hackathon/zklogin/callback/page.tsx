"use client"

// Google OAuth (implicit id_token) return for zkLogin. The JWT arrives in the URL
// fragment (never sent to the server by the browser). We move it to sessionStorage
// for the pending operation and return to the map, where the journey resumes.
import { useEffect, useRef, useState } from "react"
import { readPendingHackathon } from "@/features/ondo/hackathon-b/hackathon-campaign"
import { api, canBeginGoogleHere, clearZkLoginOAuthAttempt, readSigner, writeSigner } from "@/features/ondo/hackathon-b/hackathon-client"
import { readOAuthReturn } from "@/features/ondo/hackathon-b/hackathon-oauth-return"
import { validZkLoginAttemptView } from "@/lib/hackathon/zklogin-attempt-contract"
import { isCxPreview, isReadinessPreview } from "@/lib/hackathon/preview-readiness"
import styles from "./return.module.css"

const COPY = {
  ko: { waiting: "로그인 결과를 확인하고 있어요", stopped: "로그인을 마치지 않았어요", body: "진행하던 장소로 돌아가 다시 시도할 수 있어요. 혜택 사용이나 실행은 승인되지 않았습니다.", back: "진행하던 장소로", map: "지도로 돌아가기" },
  en: { waiting: "Checking your sign-in", stopped: "Sign-in wasn't completed", body: "Return to your place to try again. No perk use or execution was approved.", back: "Return to my place", map: "Return to map" },
  ja: { waiting: "ログイン結果を確認しています", stopped: "ログインは完了していません", body: "元の場所に戻ってやり直せます。特典の利用や実行は承認されていません。", back: "元の場所に戻る", map: "地図に戻る" },
}

export default function ZkLoginCallbackPage() {
  const [locale, setLocale] = useState<keyof typeof COPY>("en")
  const [failed, setFailed] = useState(false)
  const [returnTo, setReturnTo] = useState("/")
  const handled = useRef(false)
  const alive = useRef(false)
  useEffect(() => {
    alive.current = true
    if (handled.current) return () => { alive.current = false }
    handled.current = true
    const fragment = window.location.hash, query = window.location.search
    // Scrub after parent effects initialize, while validating the captured
    // return immediately. Use the router-aware history API so a later render
    // cannot restore its previous canonical URL containing the OAuth fragment.
    const scheduleScrub = (afterScrub?: () => void) => window.setTimeout(() => {
      try {
        window.history.replaceState(null, "", window.location.pathname)
        // Even a stalled return navigation must leave no token in this URL.
        // Persist/consume an accepted return only after scrubbing succeeds.
        if (alive.current) afterScrub?.()
      } catch {
        setFailed(true)
      }
    }, 0)
    // This preview must not accept or store even a well-formed OAuth return.
    if (isReadinessPreview()) { setFailed(true); scheduleScrub(); return }
    if (isCxPreview()) { setFailed(true); scheduleScrub(); return }
    if (!canBeginGoogleHere()) { setFailed(true); scheduleScrub(); return }
    try {
      const pending = readPendingHackathon()
      if (pending) setLocale(pending.locale)
      else {
        const saved = JSON.parse(localStorage.getItem("ondo-b.device.v1") ?? "{}")
        setLocale(saved.locale === "ko" || saved.locale === "ja" ? saved.locale : "en")
      }
      const id = pending?.resumeOperationId
      const signer = id ? readSigner(id) : null
      // The venue is navigation context only. Keep it in the return URL so a
      // cold document can restore the matching bounded discovery snapshot.
      const target = id && pending ? `/?venueId=${encodeURIComponent(pending.venueId)}&detail=1&hk=${encodeURIComponent(id)}` : "/"
      setReturnTo(target)
      const result = readOAuthReturn(fragment, query, signer?.kind === "zklogin" && signer.jwtPending ? signer.oauthState : undefined)
      if (!id || !signer || signer.kind !== "zklogin" || !signer.attemptId || !signer.attemptExpiresAt || Date.parse(signer.attemptExpiresAt) <= Date.now() || signer.proofRequestSent || result.status !== "accepted") {
        if (id) clearZkLoginOAuthAttempt(id)
        setFailed(true); scheduleScrub()
        return
      }
      const attemptId = signer.attemptId
      // Scrub first; a GET verifies the original HttpOnly session/operation is
      // still current. No proof POST, signing or execution occurs on return.
      scheduleScrub(() => { void api.zkStatus(id, attemptId).then(status => {
        const current = readSigner(id), currentPending = readPendingHackathon()
        if (!alive.current || currentPending?.resumeOperationId !== id || current?.kind !== "zklogin" || current.attemptId !== attemptId || current.oauthState !== signer.oauthState || !current.jwtPending || current.proofRequestSent ||
          !validZkLoginAttemptView(status, id, attemptId) || status.status !== "pending" || status.maxEpoch !== signer.maxEpoch || status.expiresAt !== signer.attemptExpiresAt || Date.parse(status.expiresAt) <= Date.now()) { if (alive.current) setFailed(true); return }
        window.sessionStorage.setItem(`ondo-b.hackathon.jwt:${id}`, result.token)
        writeSigner(id, { ...current, oauthState: undefined })
        window.location.replace(target)
      }).catch(() => { if (alive.current) setFailed(true) }) })
    } catch {
      setFailed(true); scheduleScrub()
    }
    return () => { alive.current = false }
  }, [])
  const copy = COPY[locale]
  return <main className={styles.page} lang={locale} data-testid="hackathon-login-callback" data-state={failed ? "failed" : "checking"}>
    <section className={styles.card} aria-live="polite">
      <p className={styles.brand}>K-Tour ID</p>
      <h1>{failed ? copy.stopped : copy.waiting}</h1>
      {failed ? <><p>{copy.body}</p><a href={returnTo} data-testid="hackathon-login-return">{returnTo === "/" ? copy.map : copy.back}</a></> : null}
    </section>
  </main>
}
