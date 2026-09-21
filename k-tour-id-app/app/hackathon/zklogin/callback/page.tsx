"use client"

// Google OAuth (implicit id_token) return for zkLogin. The JWT arrives in the URL
// fragment (never sent to the server by the browser). We move it to sessionStorage
// for the pending operation and return to the map, where the journey resumes.
import { useEffect, useRef, useState } from "react"
import { readPendingHackathon } from "@/features/ondo/hackathon-b/hackathon-campaign"
import { readSigner, writeSigner } from "@/features/ondo/hackathon-b/hackathon-client"
import { readOAuthReturn } from "@/features/ondo/hackathon-b/hackathon-oauth-return"
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
  useEffect(() => {
    if (handled.current) return
    handled.current = true
    const fragment = window.location.hash, query = window.location.search
    // Strip credentials even on cancelled, malformed or unrelated callbacks.
    window.history.replaceState(null, "", window.location.pathname)
    try {
      const pending = readPendingHackathon()
      if (pending) setLocale(pending.locale)
      else {
        const saved = JSON.parse(localStorage.getItem("ondo-b.device.v1") ?? "{}")
        setLocale(saved.locale === "ko" || saved.locale === "ja" ? saved.locale : "en")
      }
      const id = pending?.resumeOperationId
      const signer = id ? readSigner(id) : null
      const target = id ? `/?hk=${encodeURIComponent(id)}` : "/"
      setReturnTo(target)
      const result = readOAuthReturn(fragment, query, signer?.kind === "zklogin" && signer.jwtPending ? signer.oauthState : undefined)
      if (!id || !signer || signer.kind !== "zklogin" || result.status !== "accepted") { setFailed(true); return }
      window.sessionStorage.setItem(`ondo-b.hackathon.jwt:${id}`, result.token)
      writeSigner(id, { ...signer, oauthState: undefined }) // one return per login attempt
      window.location.replace(target)
    } catch {
      setFailed(true)
    }
  }, [])
  const copy = COPY[locale]
  return <main className={styles.page} lang={locale}>
    <section className={styles.card} aria-live="polite">
      <p className={styles.brand}>K-Tour ID</p>
      <h1>{failed ? copy.stopped : copy.waiting}</h1>
      {failed ? <><p>{copy.body}</p><a href={returnTo} data-testid="hackathon-login-return">{returnTo === "/" ? copy.map : copy.back}</a></> : null}
    </section>
  </main>
}
