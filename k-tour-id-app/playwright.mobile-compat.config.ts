import { defineConfig, devices } from "@playwright/test"

// Deliberately separate from release CI: these are local, no-provider fixtures.
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3139"
if (!["127.0.0.1", "localhost"].includes(new URL(baseURL).hostname)) {
  throw new Error("Mobile compatibility fixtures require a loopback review server")
}

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: [
    "ondo-sumsub-sandbox.spec.ts",
    "ktour-public-release-smoke.spec.ts",
    "ktour-regional-story-parity.spec.ts",
    "ktour-mobile-return-compat.spec.ts",
  ],
  outputDir: "artifacts/qa/mobile-compat",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter: [["list"], ["json", { outputFile: "artifacts/qa/mobile-compat/results.json" }]],
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    locale: "en-US",
    timezoneId: "Asia/Seoul",
    colorScheme: "light",
    serviceWorkers: "block",
    screenshot: "only-on-failure",
    trace: "off",
    video: "off",
  },
  projects: ["chromium", "webkit"].map(browserName => ({
    name: `mobile-${browserName}`,
    use: { ...devices["iPhone 13"], browserName: browserName as "chromium" | "webkit", deviceScaleFactor: 1, viewport: { width: 390, height: 844 } },
  })),
})
