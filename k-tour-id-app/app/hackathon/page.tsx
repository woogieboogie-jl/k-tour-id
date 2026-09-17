import { redirect } from "next/navigation"

// Demo deep link: http://localhost:3000/hackathon → map opens the designated
// venue's place sheet, where the "체험 혜택 보기" CTA starts the journey.
// Active only when NEXT_PUBLIC_HK_DEMO_ENTRY=1 (see hackathon.env.example).
export const dynamic = "force-dynamic"

export default function HackathonEntryPage() {
  redirect("/?hk=start")
}
