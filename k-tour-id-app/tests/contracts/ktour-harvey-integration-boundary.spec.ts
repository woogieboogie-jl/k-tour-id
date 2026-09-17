import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { expect, test } from "@playwright/test"

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8")

test("HK-BOUNDARY-01 full-stack entry and API require explicit opt-in", () => {
  expect(read("features/ondo/hackathon-b/hackathon-campaign.ts"))
    .toContain('HACKATHON_ENABLED = process.env.NEXT_PUBLIC_HK_ENABLED === "1"')
  const route = read("app/api/hackathon/v1/[...path]/route.ts")
  expect(route.match(/process\.env\.HK_API_ENABLED !== "1" \|\| process\.env\.NEXT_PUBLIC_HK_ENABLED !== "1"/g)).toHaveLength(2)
  expect(JSON.parse(read("vercel.json")).buildCommand).toBe("pnpm build:vercel:ondo-b")
  expect(JSON.parse(read("vercel.hackathon.json")).buildCommand).toBe("pnpm build:vercel:hackathon")
})

test("HK-BOUNDARY-02 safe local runner drops credentials and cannot reuse an unisolated build", () => {
  const runner = read("scripts/hackathon-local.mjs")
  expect(runner).toContain("const env = {}")
  expect(runner).not.toContain("...process.env")
  expect(runner).toContain('HK_ISOLATED_MOCK: "1"')
  expect(runner).toContain('HK_API_ENABLED: "1"')
  expect(runner).toContain('HK_MODE_CX: "mock"')
  expect(runner).toContain('HK_MODE_OPENDID: "mock"')
  expect(runner).toContain('NEXT_PUBLIC_HK_CX_BROWSER_QR: "0"')
  expect(runner).toContain('".env.local"')
  expect(runner).toContain('"127.0.0.1"')
  expect(runner).toContain("build.isolatedMock !== true || build.appRoot !== appRoot")
  expect(read("next.config.mjs")).not.toContain("ignoreBuildErrors")
})

test("HK-BOUNDARY-03 resumed navigation cannot authorize signing or execution", () => {
  const campaign = read("features/ondo/hackathon-b/hackathon-campaign.ts")
  const layer = read("features/ondo/hackathon-b/hackathon-layer-b.tsx")
  expect(campaign).toContain("manualHackathonDetail(parsed)")
  expect(campaign).not.toMatch(/auto\??:\s*["']/)
  expect(layer).not.toContain("setConsent(true)")
  expect(layer).not.toContain("setApproved(true)")
  expect(layer).not.toContain("hackathon-demo-entry-auto")
  expect(layer).not.toContain("hackathon-autopilot")
  for (const path of ["hackathon-campaign.ts", "hackathon-client.ts", "hackathon-layer-b.tsx"]) {
    expect(read(`features/ondo/hackathon-b/${path}`)).not.toContain("localStorage")
  }
})
