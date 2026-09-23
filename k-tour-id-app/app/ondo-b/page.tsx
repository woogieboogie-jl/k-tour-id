import { permanentRedirect } from "next/navigation"

const DISCOVERY_QUERY_KEYS = ["category", "city", "collection", "collectionSelection", "detail", "discoveryPlaceId", "editorialPlaceId", "q", "venueId", "view"] as const

type LegacyOndoBPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function LegacyOndoBPage({ searchParams }: LegacyOndoBPageProps) {
  const requested = await searchParams
  const canonical = new URLSearchParams()
  for (const key of DISCOVERY_QUERY_KEYS) {
    const value = requested[key]
    if (typeof value === "string" && value.length <= 160) canonical.set(key, value)
  }
  const query = canonical.toString()
  permanentRedirect(query ? `/?${query}` : "/")
}
