#!/usr/bin/env node
// Operator-only, loopback Sui Testnet lane. Never imports an existing wallet or
// provider environment. Generated secrets stay outside Git with mode 0600.
import { createHash, randomBytes } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, lstatSync, realpathSync, openSync, closeSync, fsyncSync, renameSync, unlinkSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, resolve, basename } from "node:path"
import { fileURLToPath } from "node:url"
import { spawn } from "node:child_process"
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519"
import { SuiGrpcClient } from "@mysten/sui/grpc"
import { Transaction, TransactionDataBuilder } from "@mysten/sui/transactions"

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const root = resolve(homedir(), ".local/share/ktour-sui-e2e")
const [action, requestedDir] = process.argv.slice(2)
const client = new SuiGrpcClient({ network: "testnet", baseUrl: "https://fullnode.testnet.sui.io:443" })
const moduleHash = "f266e663f8045ecef8806fe0fc1ddf77ae74acf97c32d90dec2dbb38d6b94ffc"
const chainId = "69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD"
// Atomic replacement + durable file/directory sync, including the prebroadcast
// digest journal. Interrupted writes cannot erase the last complete manifest.
const write = (file, data) => {
  const temporary = `${file}.${randomBytes(8).toString("hex")}.tmp`
  const fd = openSync(temporary, "wx", 0o600)
  try { writeFileSync(fd, JSON.stringify(data, null, 2) + "\n"); fsyncSync(fd) } finally { closeSync(fd) }
  renameSync(temporary, file)
  const directoryFd = openSync(dirname(file), "r")
  try { fsyncSync(directoryFd) } finally { closeSync(directoryFd) }
}
const read = file => JSON.parse(readFileSync(file, "utf8"))
const hash = value => createHash("sha256").update(value).digest("hex")
const owned = path => {
  const stat = lstatSync(path)
  if (stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o077)) throw new Error("unsafe_owned_path")
  return stat
}

async function main() {
  if (process.env.VERCEL) throw new Error("loopback_only")
  if (action === "prepare") {
    if (requestedDir) throw new Error("prepare_takes_no_existing_path")
    mkdirSync(root, { recursive: true, mode: 0o700 })
    if (!owned(root).isDirectory() || realpathSync(root) !== root) throw new Error("unsafe_root")
    const dir = mkdtempSync(resolve(root, "run-20260928-"))
    const issuer = Ed25519Keypair.generate(), agent = Ed25519Keypair.generate()
    write(resolve(dir, "private.json"), { issuer: issuer.getSecretKey(), agent: agent.getSecretKey(), credentialSeed: randomBytes(32).toString("hex") })
    const manifest = { schema: "ktour-selfhosted-testnet/v1", createdAt: new Date().toISOString(), network: "testnet", chainId, moduleHash, issuer: issuer.toSuiAddress(), agent: agent.toSuiAddress(), sponsor: issuer.toSuiAddress(), transactions: {} }
    write(resolve(dir, "manifest.json"), manifest)
    console.log(JSON.stringify({ directory: dir, ...manifest }))
    return
  }
  if (!requestedDir || !["status", "fund", "publish", "campaign", "dev"].includes(action)) throw new Error("invalid_action")
  const dir = resolve(requestedDir)
  if (dirname(dir) !== root || !basename(dir).startsWith("run-20260928-") || realpathSync(dir) !== dir || !owned(root).isDirectory() || !owned(dir).isDirectory()) throw new Error("unsafe_run_directory")
  const lockPath = resolve(dir, ".operator.lock")
  // Never remove another process's lock automatically, including after a crash.
  const lock = openSync(lockPath, "wx", 0o600)
  writeFileSync(lock, JSON.stringify({ pid: process.pid, action, at: new Date().toISOString() })); fsyncSync(lock); closeSync(lock)
  try {
  const secretPath = resolve(dir, "private.json")
  for (const file of [secretPath, resolve(dir, "manifest.json")]) {
    const stat = owned(file)
    if (!stat.isFile() || stat.size > 16384) throw new Error("unsafe_run_file")
  }
  const secrets = read(secretPath), manifestPath = resolve(dir, "manifest.json"), m = read(manifestPath)
  const issuer = Ed25519Keypair.fromSecretKey(secrets.issuer), agent = Ed25519Keypair.fromSecretKey(secrets.agent)
  if (m.schema !== "ktour-selfhosted-testnet/v1" || m.network !== "testnet" || m.chainId !== chainId || m.moduleHash !== moduleHash || m.issuer !== issuer.toSuiAddress() || m.agent !== agent.toSuiAddress() || m.sponsor !== m.issuer) throw new Error("manifest_mismatch")
  const info = await client.ledgerService.getServiceInfo({}, { abort: AbortSignal.timeout(15000) }).response
  if (info.chainId !== chainId) throw new Error("wrong_chain")
  const save = () => write(manifestPath, m)
  if (action === "status") {
    console.log(JSON.stringify({ ...m, balance: await client.getBalance({ owner: m.issuer }) }))
    return
  }
  if (action === "fund") {
    if (m.faucetAttemptedAt) throw new Error("faucet_already_requested_check_balance")
    m.faucetAttemptedAt = new Date().toISOString(); save()
    const response = await fetch("https://faucet.testnet.sui.io/v2/gas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ FixedAmountRequest: { recipient: m.issuer } }), signal: AbortSignal.timeout(30000) })
    m.faucetHttpStatus = response.status; save()
    console.log(JSON.stringify({ action, status: response.status, recipient: m.issuer, balance: await client.getBalance({ owner: m.issuer }) }))
    return
  }
  // Persist digest BEFORE broadcast. Re-entry only looks up this digest: it
  // never rebuilds or re-broadcasts a transaction whose outcome is ambiguous.
  async function execute(stage, transaction, budget) {
    if (m.transactions[stage]) {
      const r = await client.getTransaction({ digest: m.transactions[stage].digest, include: { effects: true, events: true } })
      const tx = r.Transaction ?? r.FailedTransaction
      if (tx?.digest !== m.transactions[stage].digest || !tx?.status.success) throw new Error("prior_transaction_not_confirmed")
      m.transactions[stage].status = "success"; save()
      return tx
    }
    transaction.setSender(m.issuer); transaction.setGasBudget(budget)
    const bytes = await transaction.build({ client })
    const digest = TransactionDataBuilder.getDigestFromBytes(bytes)
    const signature = (await issuer.signTransaction(bytes)).signature
    m.transactions[stage] = { digest, status: "prepared", budgetMIST: budget, preparedAt: new Date().toISOString() }; save()
    const r = await client.executeTransaction({ transaction: bytes, signatures: [signature], include: { effects: true, events: true } })
    const tx = r.Transaction ?? r.FailedTransaction
    if (tx?.digest !== digest) throw new Error("receipt_digest_mismatch")
    m.transactions[stage].status = tx.status.success ? "success" : "failed"; save()
    if (!tx.status.success) throw new Error("transaction_failed")
    await client.waitForTransaction({ digest, timeout: 30000 })
    return tx
  }
  if (action === "publish") {
    const bundle = read(resolve(appRoot, "../move/ondo_entitlement/bytecode-testnet-v1.79.0.json"))
    if (bundle.modules.length !== 1 || hash(Buffer.from(bundle.modules[0], "base64")) !== moduleHash || bundle.dependencies.length !== 2 || !bundle.dependencies.every((x, i) => BigInt(x) === BigInt(i + 1))) throw new Error("compiled_bundle_mismatch")
    const tx = new Transaction()
    const cap = tx.publish({ modules: bundle.modules, dependencies: bundle.dependencies })
    tx.transferObjects([cap], m.issuer)
    const result = await execute("publish", tx, 100_000_000)
    const created = result.effects.changedObjects.filter(x => x.idOperation === "Created")
    for (const ref of created) {
      const object = (await client.getObject({ objectId: ref.objectId })).object
      if (object.type?.endsWith("::entitlement::AdminCap")) {
        if (object.owner.$kind !== "AddressOwner" || object.owner.AddressOwner !== m.issuer) throw new Error("admin_owner_mismatch")
        m.adminCap = object.objectId; m.packageId = object.type.split("::")[0]
      }
    }
    if (!m.adminCap || !m.packageId) throw new Error("published_admin_cap_missing")
    save(); console.log(JSON.stringify(m)); return
  }
  if (action === "campaign") {
    if (!m.packageId || !m.adminCap) throw new Error("publish_first")
    const tx = new Transaction()
    tx.moveCall({ target: `${m.packageId}::entitlement::create_campaign`, arguments: [tx.object(m.adminCap), tx.pure.vector("u8", Array.from(new TextEncoder().encode("hk-identity-perk-v1"))), tx.pure.address(m.issuer), tx.pure.address(m.agent), tx.pure.u64(1)] })
    const result = await execute("campaign", tx, 20_000_000)
    const event = result.events.find(x => x.eventType === `${m.packageId}::entitlement::CampaignCreated`)
    const campaign = event?.json?.campaign
    if (!campaign) throw new Error("campaign_event_missing")
    const object = (await client.getObject({ objectId: campaign, include: { json: true } })).object
    if (object.type !== `${m.packageId}::entitlement::Campaign` || object.owner.$kind !== "Shared" || object.json.issuer !== m.issuer || object.json.agent !== m.agent || object.json.active !== true) throw new Error("campaign_mismatch")
    m.campaignId = campaign; m.campaignInitialVersion = object.owner.Shared.initialSharedVersion
    save(); console.log(JSON.stringify(m)); return
  }
  if (!m.campaignId || !m.campaignInitialVersion) throw new Error("campaign_first")
  for (const name of [".env", ".env.local", ".env.development", ".env.development.local", ".env.production", ".env.production.local"]) {
    if (existsSync(resolve(appRoot, name))) throw new Error("env_file_not_allowed")
  }
  const env = Object.fromEntries(["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "SystemRoot", "LANG", "LC_ALL"].filter(x => process.env[x]).map(x => [x, process.env[x]]))
  Object.assign(env, { NEXT_TELEMETRY_DISABLED: "1", NEXT_PUBLIC_HK_ENABLED: "1", NEXT_PUBLIC_HK_DEMO_ENTRY: "1", NEXT_PUBLIC_HK_CX_BROWSER_QR: "0", NEXT_PUBLIC_ONDO_QA_CONTROLS: "1", HK_ISOLATED_MOCK: "0", HK_API_ENABLED: "1", HK_MODE_CX: "mock", HK_MODE_OPENDID: "mock", HK_AI_MODE: "rule", HK_DATA_DIR: resolve(dir, "ledger"), HK_ISSUER_SIGNING_SEED: secrets.credentialSeed, HK_SUI_NETWORK: "testnet", HK_SUI_GRPC_URL: "https://fullnode.testnet.sui.io:443", HK_SUI_PACKAGE_ID: m.packageId, HK_SUI_CAMPAIGN_ID: m.campaignId, HK_SUI_CAMPAIGN_INITIAL_VERSION: String(m.campaignInitialVersion), HK_SUI_ISSUER_SECRET_KEY: secrets.issuer, HK_SUI_AGENT_SECRET_KEY: secrets.agent, HK_SUI_SPONSOR_SECRET_KEY: secrets.issuer })
  const child = spawn(process.execPath, [resolve(appRoot, "node_modules/next/dist/bin/next"), "dev", "--webpack", "-H", "127.0.0.1", "-p", "3160"], { cwd: appRoot, env, stdio: "inherit" })
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child.kill(signal))
  await new Promise((resolveChild, rejectChild) => {
    child.once("error", rejectChild)
    child.once("close", code => { process.exitCode = code ?? 1; resolveChild() })
  })
  } finally { unlinkSync(lockPath) }
}

main().catch(() => { console.error("Self-hosted Testnet step failed. No automatic retry was performed; inspect the public manifest and reconcile before continuing."); process.exitCode = 1 })
