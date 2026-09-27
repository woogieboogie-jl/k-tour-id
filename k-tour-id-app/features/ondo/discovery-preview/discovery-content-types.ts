export type Locale = "ko" | "en" | "ja"
export type City = "seoul" | "busan" | "jeju"
export type Mood = "hot" | "warm" | "cool"
export type StoryId = "sesame" | "screen" | "seoul-cafes" | "seoul-table" | "jeju-kpop" | "jeju-table" | "busan-market" | "busan-coffee" | "busan-table"
export type Kind = "all" | "cafe" | "food"
export type Words = Record<Locale, string>
export const words = (ko: string, en: string, ja: string): Words => ({ ko, en, ja })
export type Place = {
  id: string; city: City; name: Words; area: Words; reason: Words
  latitude: number; longitude: number; kind: "cafe" | "food" | "bar" | "sight"
  image: string; imageAlt: Words; illustration: boolean; credit: string; source: string
  photoSource?: string; licenseUrl?: string
}
export type Story = {
  id: StoryId; city: City; title: Words; image: string; places: string[]; source: string
  sources?: { label: string; url: string }[]
  intro: Words; paragraphs: Words[]; stopNotes: Record<string, Words>
}
export type Scope = { city: City; mode: "explore" | "story" | Mood | "search" | "saved"; story?: string; query?: string }
