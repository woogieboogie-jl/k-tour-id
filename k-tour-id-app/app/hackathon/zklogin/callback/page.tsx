"use client"

// Google OAuth (implicit id_token) return for zkLogin. The JWT arrives in the URL
// fragment (never sent to the server by the browser). We move it to sessionStorage
// for the pending operation and return to the map, where the journey resumes.
import { useEffect, useState } from "react"

export default function ZkLoginCallbackPage() {
  const [message, setMessage] = useState("Signing you in…")
  useEffect(() => {
    try {
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""))
      const idToken = hash.get("id_token")
      const state = hash.get("state")
      if (!idToken || !state || !/^op_[A-Za-z0-9_-]{8,}$/.test(state)) { setMessage("Login did not return a token. You can close this page."); return }
      window.sessionStorage.setItem(`ondo-b.hackathon.jwt:${state}`, idToken)
      window.history.replaceState(null, "", window.location.pathname)
      window.location.replace(`/?hk=${encodeURIComponent(state)}`)
    } catch {
      setMessage("Could not complete login in this browser.")
    }
  }, [])
  return <main style={{ padding: 24, fontFamily: "system-ui" }}><p>{message}</p></main>
}
