// Exact isolated 3183 BFF. No inherited credentials, dotenv, production build,
// provider health/write probes, file deletion, wallet reset or remote invocation.
import { constants, existsSync, openSync, fstatSync, readFileSync, closeSync, lstatSync, realpathSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { spawn } from "node:child_process"
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const required = ["HK_OPENDID_BRIDGE_URL", "HK_OPENDID_BRIDGE_TOKEN", "HK_OPENDID_OWNER_BINDING_SECRET", "HK_OPENDID_TRUSTED_ORIGIN", "HK_OPENDID_ISSUER_DID", "HK_OPENDID_SCHEMA_ID", "HK_OPENDID_ADMIN_TOKEN", "HK_OPENDID_CAS_URL", "HK_OPENDID_TA_URL", "HK_OPENDID_DID_API_URL", "HK_ISSUER_SIGNING_SEED", "HK_CAMPAIGN_ENDS_AT"]
const optional = ["HK_CX_API_KEY"]
const fail = () => { throw new Error("local_native_configuration_invalid") }
export function nativeLocalEnvironment(config, inherited = process.env, now = Date.now()) {
  if (!config || typeof config !== "object" || Array.isArray(config) || Object.keys(config).some(k => !required.includes(k) && !optional.includes(k)) || required.some(k => !Object.hasOwn(config, k))) fail()
  for (const value of Object.values(config)) if (typeof value !== "string" || !/^[\x21-\x7e]{1,4096}$/.test(value)) fail()
  for (const name of ["HK_OPENDID_BRIDGE_TOKEN", "HK_OPENDID_OWNER_BINDING_SECRET", "HK_OPENDID_ADMIN_TOKEN", "HK_ISSUER_SIGNING_SEED"]) if (config[name].length < 32) fail()
  const deadline = Date.parse(config.HK_CAMPAIGN_ENDS_AT)
  if (!Number.isFinite(deadline) || deadline <= now || deadline > now + 7 * 86_400_000) fail()
  // Port pins are coordinated with the separate submission stack, not the
  // active Claude lane. No remote origin or loopback alias can replace them.
  const pins = { HK_OPENDID_BRIDGE_URL: "http://127.0.0.1:3193", HK_OPENDID_TRUSTED_ORIGIN: "http://127.0.0.1:3193", HK_OPENDID_CAS_URL: "http://127.0.0.1:19403", HK_OPENDID_TA_URL: "http://127.0.0.1:19400", HK_OPENDID_DID_API_URL: "http://127.0.0.1:19405" }
  for (const [name, value] of Object.entries(pins)) if (config[name] !== value) fail()
  if (config.HK_OPENDID_ISSUER_DID !== "did:omn:issuer" || config.HK_OPENDID_SCHEMA_ID !== "http://127.0.0.1:19401/issuer/api/v1/vc/vcschema?name=vc.schema.ktour.pass") fail()
  const env = Object.fromEntries(["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL"].filter(k => inherited[k]).map(k => [k, inherited[k]]))
  return { ...env, ...config, NODE_ENV: "development", NEXT_TELEMETRY_DISABLED: "1", NEXT_PUBLIC_HK_ENABLED: "1", NEXT_PUBLIC_HK_DEMO_ENTRY: "1", NEXT_PUBLIC_HK_CX_BROWSER_QR: "0", NEXT_PUBLIC_HK_LOCAL_NATIVE: "local-native-20260930-v1", HK_LOCAL_NATIVE: "local-native-20260930-v1", HK_API_ENABLED: "1", HK_ISOLATED_MOCK: "0", HK_MODE_CX: "cx", HK_MODE_OPENDID: "opendid", HK_AI_MODE: "rule", HK_CX_BASE_URL: "https://cx.raonsecure.co.kr:18543", HK_CX_PROVIDER: "comdl", HK_CX_ZKP_TYPE: "AdultVerify", HK_STORE_KEY: "ktour:local-native:3183:v1", HK_DATA_DIR: ".data/native-binding-3183", HK_CAMPAIGN_ID: "ktour-local-native-3183-v1", HK_OPENDID_HOLDER_BINDING_ENABLED: "1", HK_OPENDID_BRIDGE_ALLOW_LOOPBACK: "1" }
}
export function readNativeLocalConfig(path) {
  const absolute = resolve(path), dir = dirname(absolute), parent = lstatSync(dir)
  if (realpathSync(dir) !== dir || !parent.isDirectory() || parent.uid !== process.getuid() || (parent.mode & 0o777) !== 0o700) fail()
  const fd = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW)
  try { const st = fstatSync(fd); if (!st.isFile() || st.nlink !== 1 || st.uid !== process.getuid() || (st.mode & 0o777) !== 0o600 || st.size > 32768) fail(); return JSON.parse(readFileSync(fd, "utf8")) }
  finally { closeSync(fd) }
}
async function main() {
  const [action, path, extra] = process.argv.slice(2)
  if (!["--check", "--dev"].includes(action) || !path || extra) fail()
  for (const name of [".env", ".env.local", ".env.development", ".env.development.local", ".env.production", ".env.production.local"]) if (existsSync(resolve(root, name))) throw new Error("local_native_dotenv_refused")
  const env = nativeLocalEnvironment(readNativeLocalConfig(path))
  if (action === "--check") { console.log(JSON.stringify({ valid: true, origin: "http://127.0.0.1:3183", providerCalls: 0, storage: ".data/native-binding-3183", productionAllowed: false })); return }
  const child = spawn(process.execPath, [resolve(root, "node_modules/next/dist/bin/next"), "dev", "--webpack", "-H", "127.0.0.1", "-p", "3183"], { cwd: root, env, stdio: "inherit" })
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child.kill(signal))
  child.once("error", () => { console.error("local_native_start_failed"); process.exitCode = 1 })
  child.once("close", code => { process.exitCode = code ?? 1 })
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { console.error("local_native_configuration_invalid"); process.exitCode = 1 })
