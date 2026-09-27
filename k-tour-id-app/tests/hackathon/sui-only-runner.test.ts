import assert from "node:assert/strict"
import { after, test } from "node:test"
import { mkdtemp, chmod, readFile, readdir, realpath, stat, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runSuiOnly, SUI_ONLY_PIN as PIN, fileSuiOnlyRepository, type SuiOnlyJournal, type SuiOnlyOptions, type SuiOnlyServices, type SuiOnlyRepository } from "../../lib/hackathon/sui-only-runner"
import { parseSuiOnlyArguments } from "../../scripts/hackathon-sui-only"
import { unsignedRehearsal } from "../../scripts/hackathon-sui-readiness"
import { assertSerializedGasBudget } from "../../lib/hackathon/adapters/sui"
import { Transaction } from "@mysten/sui/transactions"

const originalFetch = globalThis.fetch
let networkAttempts = 0
globalThis.fetch = async () => { networkAttempts++; throw new Error("no_network_in_fixtures") }
after(() => { globalThis.fetch = originalFetch; assert.equal(networkAttempts, 0) })
const NOW = Date.parse("2026-09-27T00:00:00Z"), holder = `0x${"11".repeat(32)}`, objectId = `0x${"22".repeat(32)}`
const operationId = "e928260a-abce-4a71-8a1c-d8a3729355bd", token = "fixture-operator-access-not-a-real-key"
const digests = { issue: "1".repeat(43), delegation: "2".repeat(43), execution: "3".repeat(43) }
const env = () => ({ NODE_ENV: "test", HK_ISOLATED_MOCK: "0", HK_SUI_NETWORK: "testnet", HK_SUI_GRPC_URL: PIN.rpc, HK_SUI_PACKAGE_ID: PIN.package, HK_SUI_CAMPAIGN_ID: PIN.campaign, HK_SUI_CAMPAIGN_INITIAL_VERSION: String(PIN.version), HK_SUI_ONLY_OPERATOR_TOKEN: token, HK_SUI_ONLY_USER_ADDRESS: holder, HK_SUI_ISSUER_SECRET_KEY: "fixture-presence-only", HK_SUI_AGENT_SECRET_KEY: "fixture-presence-only", HK_SUI_ONLY_USER_SECRET_KEY: "fixture-presence-only" })
const options = (mode: SuiOnlyOptions["mode"] = "execute"): SuiOnlyOptions => ({ mode, operationId, operatorExpiresAt: "2026-09-27T00:20:00Z", accessToken: token, gasBudgetMIST: 10_000_000, acknowledgeFixture: true })
function setup() {
  let stored: SuiOnlyJournal | null = null, locked = false
  const calls: string[] = []
  const repository: SuiOnlyRepository = { async exclusive(_id, work) {
    if (locked) throw new Error("fixture_lock_busy")
    locked = true
    try { return await work(async () => structuredClone(stored), async j => { calls.push("save"); stored = structuredClone(j) }) } finally { locked = false }
  } }
  const proof = (stage: keyof typeof digests) => ({ digest: digests[stage], ...(stage === "issue" ? { entitlement: { objectId, version: "1", digest: digests.issue } } : stage === "delegation" ? { grant: { objectId, initialSharedVersion: "2" } } : { recordId: objectId }) })
  const services: SuiOnlyServices = {
    async inspect() { calls.push("inspect"); return { chain: PIN.chain, campaign: PIN.campaign, type: `${PIN.package}::entitlement::Campaign`, version: String(PIN.version), issuer: PIN.issuer, agent: PIN.agent, policy: 1, active: true, sponsorCoinBalance: "100000000" } },
    async roles() { calls.push("roles"); return { issuer: PIN.issuer, agent: PIN.agent, sponsor: PIN.issuer, holder } },
    async submit(stage, j, before) { calls.push(`prepare:${stage}`); assert.equal(stored?.steps[stage].state, "preparing"); await before(digests[stage]); assert.equal(stored?.steps[stage].digest, digests[stage]); calls.push(`broadcast:${stage}`); return proof(stage) },
    async recover(stage, digest) { calls.push(`recover:${stage}`); assert.equal(digest, digests[stage]); return proof(stage) },
  }
  return { env: env(), now: () => NOW, repository, services, calls, get: () => structuredClone(stored), set: (j: SuiOnlyJournal) => { stored = structuredClone(j) } }
}

test("default preflight is key-presence only, no services/store or actual success claim", async () => {
  const fixture = setup(), result = await runSuiOnly({ mode: "preflight" }, fixture)
  assert.equal(result.mode, "preflight"); assert.equal("liveExecutionVerified" in result && result.liveExecutionVerified, false)
  assert.deepEqual(fixture.calls, [])
  assert.equal(JSON.stringify(result).includes("fixture-presence-only"), false)
})
test("three real-adapter seam stages journal before broadcast; duplicate never dispatches", async () => {
  const f = setup(), result = await runSuiOnly(options(), f)
  assert.equal("complete" in result && result.complete, true)
  assert.deepEqual(f.calls.filter(s => s.startsWith("broadcast")), ["broadcast:issue", "broadcast:delegation", "broadcast:execution"])
  assert.equal(result.identityVerified, false); assert.equal(result.zkLoginVerified, false)
  assert.equal("benefitRedeemed" in result && result.benefitRedeemed, false)
  const count = f.calls.length
  const duplicate = await runSuiOnly(options(), f)
  assert.equal("duplicate" in duplicate && duplicate.duplicate, true)
  assert.deepEqual(f.calls.slice(count), ["inspect"])
})
test("unauthorized, expired, wrong target/profile and excessive gas stop before any I/O", async () => {
  const cases: Array<(o: SuiOnlyOptions, e: Record<string, string>) => void> = [
    o => { o.accessToken = "wrong-fixture-access-token-xxxxxxxxxxxx" },
    o => { o.operatorExpiresAt = "2026-09-26T23:59:59Z" },
    o => { o.acknowledgeFixture = false }, o => { o.gasBudgetMIST = PIN.maxGasMIST + 1 },
    (_o,e) => { e.HK_SUI_NETWORK = "mainnet" }, (_o,e) => { e.HK_SUI_CAMPAIGN_ID = objectId },
    (_o,e) => { e.HK_SUI_GRPC_URL = "https://foreign.invalid" }, (_o,e) => { e.VERCEL = "1" },
    (_o,e) => { e.NEXT_PUBLIC_HK_CX_PREVIEW = "1" }, (_o,e) => { e.HK_ISOLATED_MOCK = "1" },
  ]
  for (const mutate of cases) { const f = setup(), o = options(); mutate(o, f.env); await assert.rejects(runSuiOnly(o,f), /sui_only_/); assert.deepEqual(f.calls, []) }
})
test("read-only chain inspection validates current chain, campaign, roles, active policy and coin gas", async () => {
  for (const patch of [{chain:"foreign"},{campaign:objectId},{issuer:holder},{agent:holder},{policy:2},{active:false},{version:"1"},{sponsorCoinBalance:"0"}]) {
    const f = setup(), inspect = f.services.inspect
    f.services.inspect = async () => ({ ...await inspect(), ...patch })
    await assert.rejects(runSuiOnly(options(), f), /sui_only_(chain_binding|campaign_not_ready|sponsor_gas)/)
    assert.deepEqual(f.calls, ["inspect"])
  }
  const f = setup(); await runSuiOnly(options("inspect"), f); assert.deepEqual(f.calls,["inspect"])
})
test("signer roles bind issuer, agent, explicit demo holder and issuer-only sponsor", async () => {
  const f = setup(); f.services.roles = async () => ({issuer:PIN.issuer,agent:PIN.agent,sponsor:holder,holder})
  await assert.rejects(runSuiOnly(options(),f),/sui_only_signer_roles/); assert.equal(f.get(),null)
})
test("missing execution keys stop before public RPC and read-only inspection needs no keys", async () => {
  const f=setup();f.env.HK_SUI_ISSUER_SECRET_KEY=''
  await assert.rejects(runSuiOnly(options(),f),/sui_only_keys_missing/)
  assert.deepEqual(f.calls,[])
  await runSuiOnly(options('inspect'),f);assert.deepEqual(f.calls,['inspect'])
})
test("lost submission response becomes unknown; execute/resume never resend; reconcile only reads saved hash", async () => {
  const f = setup(), submit = f.services.submit
  f.services.submit = async (stage,j,before) => { const result=await submit(stage,j,before); if(stage==='delegation') throw new Error('fixture-private-provider-body'); return result }
  const lost = await runSuiOnly(options(),f)
  assert.equal("steps" in lost && lost.steps.delegation.state,"unknown")
  assert.equal(JSON.stringify(lost).includes('fixture-private'),false)
  const count=f.calls.filter(c=>c.startsWith('broadcast')).length
  await runSuiOnly(options("resume"),f); await runSuiOnly(options("execute"),f)
  assert.equal(f.calls.filter(c=>c.startsWith('broadcast')).length,count)
  await runSuiOnly(options("reconcile"),f)
  assert.equal(f.get()?.steps.delegation.state,'confirmed')
  assert.equal(f.get()?.steps.execution.state,'new')
  await runSuiOnly(options("resume"),f)
  assert.equal(f.get()?.steps.execution.state,'confirmed')
  assert.deepEqual(f.calls.filter(c=>c.startsWith('broadcast')),['broadcast:issue','broadcast:delegation','broadcast:execution'])
})
test("reconcile and duplicate summary remain readable after gas spending or campaign deactivation/role change", async () => {
  const f=setup(), submit=f.services.submit, inspect=f.services.inspect
  f.services.submit=async(stage,j,before)=>{const result=await submit(stage,j,before);if(stage==='issue')throw new Error('lost');return result}
  await runSuiOnly(options(),f)
  f.services.inspect=async()=>({...await inspect(),sponsorCoinBalance:'0',active:false,agent:holder,issuer:holder})
  const duplicate=await runSuiOnly(options(),f);assert.equal('duplicate'in duplicate&&duplicate.duplicate,true)
  const recovered=await runSuiOnly(options('reconcile'),f)
  assert.equal('steps'in recovered&&recovered.steps.issue.state,'confirmed')
  assert.deepEqual(f.calls.filter(c=>c.startsWith('broadcast')),['broadcast:issue'])
  await assert.rejects(runSuiOnly(options('resume'),f),/sui_only_campaign_not_ready/)
})
test("cancellation before broadcast preserves a no-hash claim and cannot retry", async () => {
  const f=setup(), controller=new AbortController()
  f.services.submit=async (_stage,_j,before)=>{controller.abort();await before(digests.issue);throw new Error('unreachable')}
  await runSuiOnly({...options(),signal:controller.signal},f)
  assert.equal(f.get()?.steps.issue.state,'unknown'); assert.equal(f.get()?.steps.issue.digest,null)
  await runSuiOnly(options('reconcile'),f); await runSuiOnly(options('resume'),f)
  assert.equal(f.calls.some(c=>c.startsWith('broadcast')||c.startsWith('recover')),false)
})
test("a timed-out adapter cannot broadcast late, and its durable claim blocks a new attempt", async () => {
  const f=setup(); let rejected=false
  f.services.submit=async (_stage,_j,before)=>{await new Promise(r=>setTimeout(r,25));try{await before(digests.issue)}catch{rejected=true;throw new Error('stopped')}throw new Error('unexpected')}
  await runSuiOnly(options(),{...f,stageTimeoutMs:5})
  await new Promise(r=>setTimeout(r,35)); assert.equal(rejected,true)
  assert.equal(f.get()?.steps.issue.state,'unknown');assert.equal(f.get()?.steps.issue.digest,null)
})
test("approval expiring during preparation cannot broadcast", async () => {
  const f=setup();let clock=NOW;f.now=()=>clock
  f.services.submit=async(_stage,_j,before)=>{clock+=31*60_000;await before(digests.issue);throw new Error('unreachable')}
  await runSuiOnly(options(),f);assert.equal(f.get()?.steps.issue.state,'unknown');assert.equal(f.get()?.steps.issue.digest,null)
})
test("recovery persistence failure never returns a confirmed success summary", async () => {
  const f=setup();f.services.submit=async(_stage,_j,before)=>{await before(digests.issue);throw new Error('lost')}
  await runSuiOnly(options(),f)
  const repository:SuiOnlyRepository={exclusive:(_id,work)=>work(async()=>f.get(),async()=>{throw new Error('fixture_disk_failure')})}
  await assert.rejects(runSuiOnly(options('reconcile'),{...f,repository}),/fixture_disk_failure/)
  assert.equal(f.get()?.steps.issue.state,'unknown')
})
test("foreign recovery digest and corrupt scope never confirm or restart", async () => {
  const f=setup(); f.services.submit=async(_s,_j,before)=>{await before(digests.issue);throw new Error('lost')}
  await runSuiOnly(options(),f)
  f.services.recover=async()=>({digest:digests.delegation,entitlement:{objectId,version:'1',digest:digests.issue}})
  await runSuiOnly(options('reconcile'),f);assert.equal(f.get()?.steps.issue.state,'unknown')
  const j=f.get()!;j.scope.actionCommitment=`0x${'ff'.repeat(32)}`;f.set(j)
  await assert.rejects(runSuiOnly(options('resume'),f),/sui_only_journal_scope/)
})
test("concurrent same operation has one owner and one issuance", async () => {
  const f=setup(); const values=await Promise.allSettled([runSuiOnly(options(),f),runSuiOnly(options(),f)])
  assert.equal(values.filter(v=>v.status==='fulfilled').length,1)
  assert.equal(f.calls.filter(c=>c==='broadcast:issue').length,1)
})
test("private durable file journal survives reopening, excludes signing material, rejects broad permissions", async () => {
  const dir=await realpath(await mkdtemp(join(tmpdir(),'ktour-sui-only-fixture-')))
  try {
    await chmod(dir,0o700); const f=setup(); const repository=fileSuiOnlyRepository(dir)
    await runSuiOnly(options(),{...f,repository})
    const file=join(dir,`${operationId}.json`), saved=await readFile(file,'utf8')
    assert.equal((await stat(file)).mode&0o077,0);assert.equal(/secret|signature|txBytes|fixture-presence/.test(saved),false)
    assert.deepEqual(await readdir(dir),[`${operationId}.json`])
    const result=await runSuiOnly(options(),{...setup(),repository:fileSuiOnlyRepository(dir)})
    assert.equal('duplicate'in result&&result.duplicate,true)
    await chmod(dir,0o755);await assert.rejects(runSuiOnly(options(),{...setup(),repository}),/sui_only_journal_directory/)
  } finally { await rm(dir,{recursive:true,force:true}) }
})
test("gas approval is checked against serialized BCS, not only CLI metadata",async()=>{
  const metadata=JSON.parse(await readFile(new URL('../../../move/ondo_entitlement/deploy-info.testnet.json',import.meta.url),'utf8'))
  const rows=await unsignedRehearsal(metadata)
  for(const row of rows){const tx=Transaction.from(row.bytes);tx.setGasBudget(10_000_000);const bytes=await tx.build();assert.doesNotThrow(()=>assertSerializedGasBudget(bytes,10_000_000));assert.throws(()=>assertSerializedGasBudget(bytes,9_999_999));assert.throws(()=>assertSerializedGasBudget(bytes,NaN))}
})
test("CLI defaults read-only and rejects arbitrary URL, token arguments, duplication or ambiguous mode",()=>{
  assert.deepEqual(parseSuiOnlyArguments([]),{mode:'preflight'})
  for(const args of [['--url=https://foreign.invalid'],['--token=secret'],['--mode=execute','--mode=execute'],['--mode=live'],['--gas-mist=-1']])assert.throws(()=>parseSuiOnlyArguments(args),/sui_only_arguments/)
})
