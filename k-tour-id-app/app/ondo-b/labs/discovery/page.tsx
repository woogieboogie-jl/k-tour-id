import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { DiscoveryPreview } from "@/features/ondo/discovery-preview/discovery-preview"

export const metadata: Metadata = {
  title: "Discovery studio · K-Tour ID",
  robots: { index: false, follow: false },
}

// Local design review only. No production entry point, SDK, service or account.
export default function DiscoveryPreviewPage() {
  if (process.env.NODE_ENV !== "development") notFound()
  return <DiscoveryPreview />
}
