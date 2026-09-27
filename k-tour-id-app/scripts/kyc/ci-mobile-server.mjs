// CI-only orchestration. Never load provider credentials or reuse an existing server.
import { spawn } from "node:child_process"
import { appendFileSync, createWriteStream, existsSync, mkdirSync, readFileSync } from "node:fs"
import { createServer } from "node:net"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const origin = "http://127.0.0.1:3139"
const reportPath = resolve(appRoot, "artifacts/qa/mobile-compat/results.json")
const projects = ["mobile-chromium", "mobile-webkit"]
const expectedPerBrowser = 33
const branchRef = "refs/heads/integration/autonomous-finish-20260927"

export function assertCiContext(env) {
  if (env.CI !== "true" || env.GITHUB_ACTIONS !== "true" || env.GITHUB_REF !== branchRef
    || !["push", "workflow_dispatch"].includes(env.GITHUB_EVENT_NAME)) {
    throw new Error("Mobile CI runner requires the dedicated GitHub Actions branch")
  }
}

export function browserEnvironment(env) {
  const safe = {}
  for (const name of ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "DISPLAY", "XDG_RUNTIME_DIR"])
    if (env[name]) safe[name] = env[name]
  return { ...safe, CI: "true", NEXT_TELEMETRY_DISABLED: "1", PLAYWRIGHT_BASE_URL: origin }
}

export function summarizeReport(report) {
  const counts = Object.fromEntries(projects.map(name => [name, { passed: 0, failed: 0, skipped: 0, total: 0 }]))
  let unknownProjects = 0
  function visit(suite) {
    for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) {
      const row = counts[test.projectName]
      if (!row) { unknownProjects += 1; continue }
      row.total += 1
      const results = test.results ?? []
      if (test.status === "skipped" || results.at(-1)?.status === "skipped") row.skipped += 1
      else if (test.status === "expected" && test.expectedStatus === "passed"
        && results.length === 1 && results[0].status === "passed") row.passed += 1
      else row.failed += 1
    }
    for (const child of suite.suites ?? []) visit(child)
  }
  for (const suite of report.suites ?? []) visit(suite)
  const errors = (report.errors ?? []).length
  const ok = errors === 0 && unknownProjects === 0 && Object.values(counts).every(row =>
    row.total === expectedPerBrowser && row.passed === expectedPerBrowser && row.failed === 0 && row.skipped === 0)
  return { ok, counts, errors, unknownProjects }
}

function writeSummary() {
  let summary
  try { summary = summarizeReport(JSON.parse(readFileSync(reportPath, "utf8"))) }
  catch { summary = summarizeReport({}); summary.errors += 1 }
  const lines = ["## Mobile compatibility — no-provider fixtures", "",
    "| Browser | Passed | Failed/incomplete | Skipped | Collected |", "| --- | ---: | ---: | ---: | ---: |"]
  for (const [name, row] of Object.entries(summary.counts))
    lines.push(`| ${name} | ${row.passed} | ${row.failed} | ${row.skipped} | ${row.total}/${expectedPerBrowser} |`)
  lines.push("", `Overall: ${summary.ok ? "PASS" : "INCOMPLETE / FAIL"}; report errors: ${summary.errors}; unknown projects: ${summary.unknownProjects}.`, "",
    "Each browser must pass all 33 cases without retries or skips. These are Linux browser fixtures, not an actual iPhone, camera, Sumsub SDK, identity approval, OAuth login, or chain transaction.", "")
  const text = lines.join("\n")
  process.stdout.write(text)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text)
  return summary.ok
}

async function assertUnusedPort() {
  await new Promise((resolveReady, reject) => {
    const probe = createServer()
    probe.once("error", () => reject(new Error("Refusing to reuse an existing loopback server")))
    probe.listen(3139, "127.0.0.1", () => probe.close(resolveReady))
  })
}

const delay = ms => new Promise(done => setTimeout(done, ms))
function startOwnedProcess(args, env, stdio) {
  const child = spawn(process.execPath, args, { cwd: appRoot, env, stdio, detached: process.platform !== "win32" })
  const state = { child, done: false, code: 1, closed: undefined }
  state.closed = new Promise(done => {
    child.once("error", () => { state.done = true; state.code = 1; done(1) })
    child.once("close", code => { state.done = true; state.code = code ?? 1; done(state.code) })
  })
  return state
}

export function ownedProcessGroupId(state) {
  if (process.platform === "win32") return null
  const pid = state?.child?.pid
  return Number.isInteger(pid) && pid > 0 ? pid : null
}

async function stopOwnedProcess(state) {
  if (!state) return
  const signal = name => {
    if (process.platform === "win32") {
      if (!state.done) state.child.kill(name)
      return
    }
    const groupId = ownedProcessGroupId(state)
    if (groupId === null) return
    try { process.kill(-groupId, name) }
    catch (error) { if (error.code !== "ESRCH") throw error }
  }
  signal("SIGTERM")
  await Promise.race([state.closed, delay(5000)])
  if (!state.done) { signal("SIGKILL"); await state.closed }
  else {
    // The wrapper may have closed while a detached Next child remains.
    // Give SIGTERM a short grace period, then reap the owned group.
    await delay(250)
    signal("SIGKILL")
  }
}

async function runSuite() {
  assertCiContext(process.env)
  if (!existsSync(resolve(appRoot, ".next/BUILD_ID"))) throw new Error("Build the clean fixture app before running CI")
  if (existsSync(reportPath)) throw new Error("Refusing to reuse a previous browser report")
  await assertUnusedPort()
  mkdirSync(resolve(appRoot, "artifacts/qa"), { recursive: true })
  const log = createWriteStream(resolve(appRoot, "artifacts/qa/mobile-compat-server.log"), { flags: "wx", mode: 0o600 })
  await new Promise((ready, reject) => { log.once("open", ready); log.once("error", reject) })
  const env = browserEnvironment(process.env)
  const server = startOwnedProcess(["scripts/kyc/local-sumsub.mjs", "start", "3139"], env, ["ignore", log, log])
  let browser
  let interrupted = false
  const interrupt = () => { interrupted = true; void stopOwnedProcess(browser); void stopOwnedProcess(server) }
  process.once("SIGINT", interrupt)
  process.once("SIGTERM", interrupt)
  try {
    const deadline = Date.now() + 60_000
    let ready = false
    while (Date.now() < deadline && !interrupted) {
      if (server.done) throw new Error("Clean fixture server exited before readiness")
      try {
        const response = await fetch(origin, { redirect: "error", signal: AbortSignal.timeout(2000) })
        ready = response.status === 200
        await response.body?.cancel()
      } catch { /* Wait only for the freshly started server. */ }
      if (ready) break
      await delay(250)
    }
    if (!ready || interrupted) throw new Error("Clean fixture server did not become ready")
    const cli = fileURLToPath(import.meta.resolve("@playwright/test/cli"))
    browser = startOwnedProcess([cli, "test", "--config", "playwright.mobile-compat.config.ts",
      "--project", projects[0], "--project", projects[1]], env, "inherit")
    const outcome = await Promise.race([browser.closed.then(code => ({ code })), server.closed.then(() => ({ code: 1 }))])
    return interrupted ? 1 : outcome.code
  } finally {
    process.removeListener("SIGINT", interrupt)
    process.removeListener("SIGTERM", interrupt)
    await stopOwnedProcess(browser)
    await stopOwnedProcess(server)
    await new Promise(done => log.end(done))
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const args = process.argv.slice(2)
    if (args.length === 1 && args[0] === "--summary") process.exitCode = writeSummary() ? 0 : 1
    else if (args.length === 0) process.exitCode = await runSuite()
    else throw new Error("Expected no arguments or --summary")
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
