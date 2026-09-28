import { defineConfig, devices } from "@playwright/test"

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3158"
const url = new URL(baseURL)
if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Integration access fixtures require loopback")

export default defineConfig({
  testDir: "tests/e2e", testMatch: "ktour-integration-access.spec.ts",
  outputDir: "artifacts/qa/integration-access", workers: 1, retries: 0,
  forbidOnly: Boolean(process.env.CI), timeout: 30000, expect: { timeout: 8000 },
  reporter: [["list"], ["json", { outputFile: "artifacts/qa/integration-access/results.json" }]],
  use: { ...devices["iPhone 13"], browserName: "chromium", baseURL, serviceWorkers: "block", screenshot: "only-on-failure", trace: "retain-on-failure" },
})
