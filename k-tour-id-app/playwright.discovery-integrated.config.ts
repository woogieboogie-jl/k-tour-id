import { defineConfig, devices } from "@playwright/test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const evidence = process.env.KTOUR_INTEGRATED_QA_RUN ?? mkdtempSync(path.join(tmpdir(), "ktour-map-discovery-qa-"))
process.env.KTOUR_INTEGRATED_QA_RUN = evidence
console.log(`Integrated discovery QA evidence: ${evidence}`)

export default defineConfig({
  testDir: "tests/e2e", testMatch: ["ktour-map-discovery-integrated.spec.ts", "ktour-map-discovery-adversarial.spec.ts"],
  outputDir: evidence,
  reporter: [["list"], ["json", { outputFile: path.join(evidence, "results.json") }]],
  workers: 1, retries: 0, timeout: 60_000, expect: { timeout: 15_000 },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3142",
    screenshot: "only-on-failure", trace: "retain-on-failure",
    colorScheme: "light", locale: "en-US", timezoneId: "Asia/Seoul",
  },
  projects: [{ name: "integrated-mobile-chromium", use: { ...devices["iPhone 13"], browserName: "chromium", viewport: { width: 390, height: 844 } } }],
  webServer: process.env.PLAYWRIGHT_BASE_URL ? undefined : {
    command: "node scripts/hackathon-local.mjs dev 3142", url: "http://127.0.0.1:3142/", reuseExistingServer: false,
  },
})
