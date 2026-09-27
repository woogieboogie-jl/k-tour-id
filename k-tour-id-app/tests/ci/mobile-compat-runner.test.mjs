import assert from "node:assert/strict"
import test from "node:test"
import { assertCiContext, browserEnvironment, ownedProcessGroupId, summarizeReport } from "../../scripts/kyc/ci-mobile-server.mjs"

const context = { CI: "true", GITHUB_ACTIONS: "true", GITHUB_REF: "refs/heads/integration/autonomous-finish-20260927", GITHUB_EVENT_NAME: "push" }
const result = (projectName, extra = {}) => ({ projectName, status: "expected", expectedStatus: "passed", results: [{ status: "passed" }], ...extra })
const fullReport = () => ({ errors: [], suites: [{ suites: [{ specs: [{ tests: ["mobile-chromium", "mobile-webkit"].flatMap(name => Array.from({ length: 33 }, () => result(name))) }] }] }] })

test("CI launcher rejects other branches, events, and local invocations", () => {
  assert.doesNotThrow(() => assertCiContext(context))
  assert.doesNotThrow(() => assertCiContext({ ...context, GITHUB_EVENT_NAME: "workflow_dispatch" }))
  for (const override of [{ CI: "" }, { GITHUB_ACTIONS: "" }, { GITHUB_REF: "refs/heads/main" }, { GITHUB_EVENT_NAME: "pull_request" }])
    assert.throws(() => assertCiContext({ ...context, ...override }))
})

test("browser children receive only allowlisted runtime data and a fixed loopback origin", () => {
  assert.deepEqual(browserEnvironment({ PATH: "/runtime", HOME: "/runner", SUMSUB_SECRET_KEY: "fixture-secret", GITHUB_TOKEN: "fixture-token", NODE_OPTIONS: "--require=untrusted", PLAYWRIGHT_BASE_URL: "https://remote.invalid", VERCEL_ENV: "production", HK_API_ENABLED: "1" }), {
    PATH: "/runtime", HOME: "/runner", CI: "true", NEXT_TELEMETRY_DISABLED: "1", PLAYWRIGHT_BASE_URL: "http://127.0.0.1:3139",
  })
})

test("detached cleanup derives only a positive owned child group", () => {
  assert.equal(ownedProcessGroupId({ child: { pid: 4242 } }), process.platform === "win32" ? null : 4242)
  assert.equal(ownedProcessGroupId({ child: { pid: 0 } }), null)
  assert.equal(ownedProcessGroupId({ child: { pid: -1 } }), null)
  assert.equal(ownedProcessGroupId({ child: {} }), null)
  assert.equal(ownedProcessGroupId(null), null)
})

test("summary requires all 33 expected passes separately in both browsers", () => {
  const summary = summarizeReport(fullReport())
  assert.equal(summary.ok, true)
  for (const row of Object.values(summary.counts)) assert.deepEqual(row, { passed: 33, failed: 0, skipped: 0, total: 33 })
  assert.equal(summarizeReport({}).ok, false)
  const report = fullReport()
  report.suites[0].suites[0].specs[0].tests.pop()
  assert.equal(summarizeReport(report).ok, false)
})

test("skipped, failed, flaky, unexpected projects, and report errors never count as all green", () => {
  for (const replacement of [
    result("mobile-webkit", { status: "skipped", results: [{ status: "skipped" }] }),
    result("mobile-webkit", { status: "unexpected", results: [{ status: "failed" }] }),
    result("mobile-webkit", { status: "flaky", results: [{ status: "failed" }, { status: "passed" }] }),
    result("mobile-webkit", { expectedStatus: "failed", results: [{ status: "failed" }] }),
    result("unrecognized-browser"),
  ]) {
    const report = fullReport()
    report.suites[0].suites[0].specs[0].tests[65] = replacement
    assert.equal(summarizeReport(report).ok, false)
  }
  assert.equal(summarizeReport({ ...fullReport(), errors: [{ message: "worker interrupted" }] }).ok, false)
})
