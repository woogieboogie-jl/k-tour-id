// Local UX inspection only. No provider credentials are inherited or read.
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const action = process.argv[2] ?? "dev"
const port = process.argv[3] ?? "3139"
if (!["dev", "build", "start"].includes(action) || !/^\d+$/.test(port) || +port < 1024 || +port > 65535) throw new Error("Expected dev/build/start and an unprivileged port")
for (const file of [".env", ".env.local", ".env.development", ".env.development.local", ".env.production", ".env.production.local"]) {
  if (existsSync(resolve(root, file))) throw new Error("Use this clean worktree without " + file)
}
const env = {}
for (const name of ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL"]) if (process.env[name]) env[name] = process.env[name]
Object.assign(env, {
  NEXT_TELEMETRY_DISABLED: "1",
  NEXT_PUBLIC_ONDO_SUMSUB_SANDBOX: "1",
  NEXT_PUBLIC_ONDO_QA_CONTROLS: "1",
  NEXT_PUBLIC_HK_ENABLED: "0",
  HK_API_ENABLED: "0",
  HK_ISOLATED_MOCK: "1",
  SUMSUB_MODE: "sandbox",
})
const args = action === "build" ? ["build", "--webpack"] : [action, ...(action === "dev" ? ["--webpack"] : []), "-H", "127.0.0.1", "-p", port]
const child = spawn(process.execPath, [resolve(root, "node_modules/next/dist/bin/next"), ...args], { cwd: root, env, stdio: "inherit" })
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child.kill(signal))
child.once("error", () => { console.error("Local preview failed to start"); process.exitCode = 1 })
child.once("close", code => { process.exitCode = code ?? 1 })
