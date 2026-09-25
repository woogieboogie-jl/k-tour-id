import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { HeaderPreview } from "./header-preview"
import { isReadinessPreview } from "@/lib/hackathon/preview-readiness"

export const metadata: Metadata = {
  title: "헤더 비교실 · K-Tour ID",
  robots: { index: false, follow: false },
}

export const dynamic = "force-dynamic"

// Development and the credential-free local mock lane only.
export default function HeaderPreviewPage() {
  if (isReadinessPreview()) notFound()
  if (process.env.NODE_ENV !== "development" && process.env.HK_ISOLATED_MOCK !== "1") notFound()
  return <HeaderPreview />
}
