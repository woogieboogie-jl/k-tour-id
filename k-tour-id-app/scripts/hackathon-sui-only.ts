// No dotenv, credential discovery, implicit wallet generation, provider or app store.
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"
import { fileSuiOnlyRepository, liveSuiOnlyServices, runSuiOnly, type SuiOnlyOptions } from "../lib/hackathon/sui-only-runner"

export function parseSuiOnlyArguments(args: string[]): SuiOnlyOptions {
  const options: SuiOnlyOptions = { mode: "preflight" }
  const seen = new Set<string>()
  for (const arg of args) {
    const separator = arg.indexOf("="), key = separator < 0 ? arg : arg.slice(0, separator), value = separator < 0 ? "" : arg.slice(separator + 1)
    if (seen.has(key)) throw new Error("sui_only_arguments")
    seen.add(key)
    if (key === "--mode" && ["preflight", "inspect", "execute", "resume", "reconcile"].includes(value)) options.mode = value as SuiOnlyOptions["mode"]
    else if (key === "--operation" && /^[0-9a-f-]{36}$/.test(value)) options.operationId = value
    else if (key === "--expires-at" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(value)) options.operatorExpiresAt = value
    else if (key === "--gas-mist" && /^[1-9]\d{0,8}$/.test(value)) options.gasBudgetMIST = Number(value)
    else if (key === "--ack-fixture-identity-demo-signer" && !value) options.acknowledgeFixture = true
    else throw new Error("sui_only_arguments")
  }
  return options
}

export async function suiOnlyCli(args: string[], env: NodeJS.ProcessEnv = process.env) {
  const options = parseSuiOnlyArguments(args)
  // Two separate channels, neither a CLI argument nor printed. An authorized
  // wrapper supplies the presented token without storing it in the journal.
  options.accessToken = env.HK_SUI_ONLY_ACCESS_TOKEN
  const directory = env.HK_SUI_ONLY_JOURNAL_DIR ?? ""
  if (["execute", "resume", "reconcile"].includes(options.mode) && (!directory || /^(\/tmp|\/private\/tmp)(\/|$)/.test(directory))) throw new Error("sui_only_durable_directory_required")
  const controller = new AbortController()
  const cancel = () => controller.abort()
  process.once("SIGINT", cancel); process.once("SIGTERM", cancel)
  try { return await runSuiOnly({ ...options, signal: controller.signal }, { env, services: liveSuiOnlyServices(env), repository: fileSuiOnlyRepository(directory) }) }
  finally { process.removeListener("SIGINT", cancel); process.removeListener("SIGTERM", cancel) }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await suiOnlyCli(process.argv.slice(2))
    console.log(JSON.stringify(result))
    if ("complete" in result && !result.complete) process.exitCode = 2
  }
  catch (error) {
    const code = error instanceof Error && /^sui_only_[a-z_]+$/.test(error.message) ? error.message : "sui_only_stopped"
    console.log(JSON.stringify({ ok: false, code, identityVerified: false, zkLoginVerified: false, benefitRedeemed: false }))
    process.exitCode = 1
  }
  // A timed-out gRPC request must not keep an operator invocation alive. Its
  // saved claim/digest remains unresolved; killing it never authorizes replay.
  setTimeout(() => process.exit(Number(process.exitCode ?? 0)), 250).unref()
}
