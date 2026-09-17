// Local integration lane. Never inherit provider credentials or load .env files.
import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const action = process.argv[2] ?? "dev"
if (!["build", "dev", "start"].includes(action)) throw new Error("Expected build, dev, or start")
const port = process.argv[3] ?? "3137"
if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535) throw new Error("Invalid local port")
for (const name of [".env", ".env.local", ".env.development", ".env.development.local", ".env.production", ".env.production.local"]) {
  if (existsSync(resolve(appRoot, name))) throw new Error(`Use a clean integration worktree without ${name}; provider credentials must not enter this lane`)
}
const env = {}
for (const name of ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "SystemRoot", "LANG", "LC_ALL"]) {
  if (process.env[name]) env[name] = process.env[name]
}
Object.assign(env, {
  NEXT_TELEMETRY_DISABLED: "1",
  NEXT_PUBLIC_HK_ENABLED: "1",
  NEXT_PUBLIC_HK_DEMO_ENTRY: "1",
  NEXT_PUBLIC_HK_CX_BROWSER_QR: "0",
  NEXT_PUBLIC_ONDO_QA_CONTROLS: "1",
  HK_ISOLATED_MOCK: "1",
  HK_API_ENABLED: "1",
  HK_MODE_CX: "mock",
  HK_MODE_OPENDID: "mock",
  HK_AI_MODE: "rule",
  HK_DATA_DIR: mkdtempSync(resolve(tmpdir(), "ktour-harvey-isolated-")),
})
const marker = resolve(appRoot, ".next/ktour-isolated-build.json")
if (action === "start") {
  const build = JSON.parse(readFileSync(marker, "utf8"))
  if (build.isolatedMock !== true || build.appRoot !== appRoot) throw new Error("Build this worktree with build:harvey:local before starting it")
}
const args = action === "build" ? ["build", "--webpack"] : [action, ...(action === "dev" ? ["--webpack"] : []), "-H", "127.0.0.1", "-p", port]
const child = spawn(process.execPath, [resolve(appRoot, "node_modules/next/dist/bin/next"), ...args], { cwd: appRoot, env, stdio: "inherit" })
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child.kill(signal))
child.once("error", (error) => { console.error(error.message); process.exitCode = 1 })
child.once("close", (code) => {
  if (action === "build" && code === 0) writeFileSync(marker, JSON.stringify({ isolatedMock: true, appRoot, builtAt: new Date().toISOString() }))
  process.exitCode = code ?? 1
})
