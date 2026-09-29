"use client"

import { BookOpen, ChevronRight } from "lucide-react"
import { useEffect, useState } from "react"
import { QA_RUNTIME_ENABLED, useReviewSampleSession } from "../shared/ui/use-qa-controls"
import { EXPERIENCE_COPY_B } from "./experience-copy-b"
import { EXPERIENCE_CHANGED_EVENT_B, EXPERIENCE_PLACE_ID_B, requestExperienceB } from "./experience-model-b"
import { readExperienceB } from "./experience-store-b"
import styles from "./experience-b.module.css"

/** A local collection entry, never an identity claim or permission to act. */
export function SavedExperienceB({ locale }: { locale: "en" | "ko" | "ja" }) {
  const sample = useReviewSampleSession()
  return QA_RUNTIME_ENABLED && sample ? <SavedGuideB locale={locale} /> : null
}

function SavedGuideB({ locale }: { locale: "en" | "ko" | "ja" }) {
  const [saved, setSaved] = useState(false)
  const t = EXPERIENCE_COPY_B[locale]
  useEffect(() => {
    let active = true
    const refresh = async () => {
      try {
        // No new database/record, including browsers without IDB enumeration.
        const record = await readExperienceB(true)
        if (active) setSaved(record?.fulfillment === "fulfilled")
      } catch { if (active) setSaved(false) }
    }
    void refresh()
    window.addEventListener(EXPERIENCE_CHANGED_EVENT_B, refresh)
    window.addEventListener("focus", refresh)
    return () => { active = false; window.removeEventListener(EXPERIENCE_CHANGED_EVENT_B, refresh); window.removeEventListener("focus", refresh) }
  }, [])
  if (!saved) return null
  return <section className={styles.savedGuides} data-testid="experience-saved-guides"><h2>{t.savedGuides}</h2>
    <button type="button" className={styles.entry} data-testid="experience-saved-guide" onClick={() => requestExperienceB(EXPERIENCE_PLACE_ID_B, "pass")}><BookOpen size={23} aria-hidden="true" /><span><strong>{t.guideHeading}</strong><small>{t.savedGuideHint}</small></span><ChevronRight size={18} aria-hidden="true" /></button>
  </section>
}
