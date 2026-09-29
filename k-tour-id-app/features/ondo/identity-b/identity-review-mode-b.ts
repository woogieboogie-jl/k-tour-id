"use client"
import { useEffect, useState } from "react"
import { REVIEW_FLOW_CHANGE_EVENT } from "../shared/ui/use-qa-controls"

/** Identity defaults to its actual provider, independently of sample commerce. */
export function identityReviewOptionsB() {
  return { allowReviewFixture: typeof window !== "undefined" && new URLSearchParams(window.location.search).get("review") === "1" } as const
}
export function useIdentityReviewModeB() {
  const [review, setReview] = useState(false)
  useEffect(() => { const update = () => setReview(identityReviewOptionsB().allowReviewFixture); update(); window.addEventListener(REVIEW_FLOW_CHANGE_EVENT, update); window.addEventListener("popstate", update); return () => { window.removeEventListener(REVIEW_FLOW_CHANGE_EVENT, update); window.removeEventListener("popstate", update) } }, [])
  return review
}
