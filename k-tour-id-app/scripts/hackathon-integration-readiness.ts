// Offline-only CLI. Secret values are accepted only as bounded JSON on stdin;
// never put them in argv, shell history, dotenv files, or ambient process.env.
import { runIntegrationReadiness, READINESS_ENV_NAMES, type IntegrationReadinessOptions } from "../lib/hackathon/integration-readiness"

const args = process.argv.slice(2)
if (!(args.length === 1 && args[0] === "--offline") && !(args.length === 2 && args[0] === "--offline" && args[1] === "--stdin")) {
  process.stdout.write(JSON.stringify({ ok: false, error: "offline_required" }) + "\n")
  process.exitCode = 1
} else {
  const options: IntegrationReadinessOptions = {}
  if (args.some(arg => arg !== "--offline" && arg !== "--stdin")) {
    process.stdout.write(JSON.stringify({ ok: false, error: "invalid_arguments" }) + "\n")
    process.exitCode = 1
  } else if (args.includes("--stdin")) {
    try {
      let size = 0
      const chunks: Buffer[] = []
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([(async () => {
          for await (const chunk of process.stdin) {
            const bytes = Buffer.from(chunk); size += bytes.length
            if (size > 32 * 1024) throw new Error()
            chunks.push(bytes)
          }
        })(), new Promise<never>((_, reject) => { timer = setTimeout(() => { process.stdin.destroy(); reject(new Error()) }, 10_000) })])
      } finally { clearTimeout(timer) }
      const raw = Buffer.concat(chunks).toString("utf8")
      const parsed: unknown = JSON.parse(raw)
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error()
      for (const [name, value] of Object.entries(parsed)) {
        if (name === "env") {
          if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error()
          options.env = value as IntegrationReadinessOptions["env"]
        } else if (name === "availableInputs") {
          if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error()
          for (const [key, v] of Object.entries(value)) if (!READINESS_ENV_NAMES.includes(key as never) || typeof v !== "boolean") throw new Error()
          options.availableInputs = value as IntegrationReadinessOptions["availableInputs"]
        } else if (name === "aiRequested" || name === "zkLoginRequested") {
          if (typeof value !== "boolean") throw new Error()
          options[name] = value
        } else throw new Error()
      }
      const report = runIntegrationReadiness(options)
      process.stdout.write(JSON.stringify(report, null, 2) + "\n")
      process.exitCode = report.ok ? 0 : 1
    } catch { process.stdout.write(JSON.stringify({ ok: false, error: "stdin_input_invalid" }) + "\n"); process.exitCode = 1 }
  } else {
    const report = runIntegrationReadiness(options)
    process.stdout.write(JSON.stringify(report, null, 2) + "\n")
    process.exitCode = report.ok ? 0 : 1
  }
}
