import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtempSync, realpathSync, lstatSync, rmSync, symlinkSync, writeFileSync, readFileSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHmac } from "node:crypto"
import { createJournalStorage, createReleaseOperator, readApiResponse } from "../../scripts/hackathon-hosted-sui-operator.mjs"
import { HOSTED_SUI_BRANCH, PROJECT_ID, ORG_ID } from "../../scripts/hackathon-hosted-sui-build.mjs"
import { CURRENT_GEMINI_MODEL, LEGACY_GEMINI_MODEL, PROVIDER_ADDED_KEYS, PROVIDER_SECRET_KEYS } from "../../scripts/hackathon-hosted-provider-inputs.mjs"

// Pure synthetic API/state fixtures. Never invoke the operational wrapper,
// read a real auth/run file, contact Vercel, create an env, or deploy anything.
const SHA = "a".repeat(40), REPORT = "b".repeat(64), TIME = Date.parse("2026-09-28T10:00:00Z")
const sourceBranch = "feat/hackathon-readiness-preview-20260925"
const copy = value => structuredClone(value)
function fixture() {
  const sourceValues = { KV_REST_API_URL: "https://fixture.upstash.io", KV_REST_API_TOKEN: "fixture-token-".repeat(4), HK_CX_PREVIEW_ACCESS_CODE: "FixtureAccessCode_".repeat(3) }
  const secrets = { credentialSeed: "c".repeat(64), issuer: "issuer-fixture-only-".repeat(4), agent: "agent-fixture-only-".repeat(4) }
  const providerInputs = { NEXT_PUBLIC_GOOGLE_CLIENT_ID: "1-fixture.apps.googleusercontent.com", GEMINI_API_KEY: "synthetic-gemini-not-a-key", HK_ZKLOGIN_SALT_SEED: "e".repeat(64), HK_OMNIONE_RPC_URL: "https://stage-chainapi.omnione.net/?token=synthetic", HK_OMNIONE_PRIVATE_KEY: "0x" + "1".repeat(64) }
  const envs = Object.keys(sourceValues).map((key, i) => ({ id: `source_${i}`, key, target: ["preview"], gitBranch: sourceBranch }))
  const calls = [], deployments = new Map(), syntheticValues = new Map()
  let stored = null, saves = 0, counter = 0, currentSha = SHA, locked = false
  let postHook, patchHook, createdShape = "object", deploymentHook, providerReadHook
  const api = async (path, method = "GET", body) => {
    calls.push({ path, method }) // Deliberately do not retain request values.
    if (path === "/v2/user") return { user: { username: "jaewook-9643" } }
    if (path === `/v9/projects/${PROJECT_ID}`) return { id: PROJECT_ID, accountId: ORG_ID, name: "ondo", rootDirectory: "k-tour-id-app", link: { org: "woogieboogie-jl", repo: "k-tour-id", type: "github", repoId: 123 } }
    if (path.startsWith(`/v1/projects/${PROJECT_ID}/env/`)) {
      const item = envs.find(item => item.id === path.split("/").at(-1))
      assert.ok(item && sourceValues[item.key], "only approved synthetic source reads")
      return { ...copy(item), decrypted: true, value: sourceValues[item.key] }
    }
    if (path === `/v10/projects/${PROJECT_ID}/env`) {
      if (method === "GET") return { envs: copy(envs) }
      assert.equal(method, "POST"); assert.equal(locked, true)
      assert.ok(stored.targets[body.target[0]].entries[body.key].intentAt, "durable intent precedes POST")
      const { value: _neverRetain, ...metadata } = body
      syntheticValues.set(`${body.target[0]}:${body.key}`, _neverRetain)
      const item = { ...copy(metadata), id: `env_${++counter}`, createdAt: TIME + counter, updatedAt: TIME + counter }
      envs.push(item)
      if (postHook) await postHook(item)
      return { created: createdShape === "object" ? copy(item) : [copy(item)], failed: [] }
    }
    if (path.startsWith(`/v9/projects/${PROJECT_ID}/env/`) && method === "PATCH") {
      const item = envs.find(item => item.id === path.split("/").at(-1))
      assert.equal(locked, true); assert.ok(["HK_MODE_CX", "HK_AI_MODE", "GEMINI_MODEL"].includes(item?.key))
      assert.deepEqual(body, { value: item.key === "HK_MODE_CX" ? "cx" : item.key === "GEMINI_MODEL" ? CURRENT_GEMINI_MODEL : "gemini" })
      assert.ok(stored.targets[item.target[0]][item.key === "HK_MODE_CX" ? "cxMigration" : item.key === "GEMINI_MODEL" ? "geminiMigration" : "providerMigration"].modeIntentAt)
      syntheticValues.set(`${item.target[0]}:${item.key}`, body.value)
      item.updatedAt = TIME + ++counter
      if (patchHook) await patchHook(item)
      return copy(item)
    }
    if (path === "/v13/deployments" && method === "POST") {
      assert.equal(body.gitSource.repoId, "123", "normalize only digit-validated repository ID")
      const target = body.target === "production" ? "production" : "preview"
      const intent = stored.targets[target].deployments[body.gitSource.sha]
      assert.equal(intent.nonce, body.meta.ktourHostedSuiRelease, "deployment intent precedes POST")
      const d = { id: `dpl_fixture${++counter}`, projectId: PROJECT_ID, ownerId: ORG_ID, url: `fixture-${counter}.vercel.app`, readyState: "QUEUED", target: target === "preview" ? null : target,
        regions: ["icn1"], meta: { ...copy(body.meta), githubCommitRef: HOSTED_SUI_BRANCH, githubCommitSha: body.gitSource.sha } }
      deployments.set(d.id, d)
      if (deploymentHook) await deploymentHook(d)
      return copy(d)
    }
    if (path.startsWith("/v13/deployments/") && method === "GET") { assert.ok(deployments.has(path.split("/").at(-1))); return copy(deployments.get(path.split("/").at(-1))) }
    assert.fail(`Unexpected fixture endpoint ${method} ${path}`)
  }
  const run = createReleaseOperator({ api, readSecrets: () => copy(secrets), readProviderInputs: () => { providerReadHook?.(); return copy(providerInputs) }, localCheck: () => currentSha, now: () => TIME, nonce: () => (++counter).toString(16).padStart(32, "0"),
    loadJournal: () => copy(stored), saveJournal: value => { saves++; stored = copy(value) },
    withLock: async (_action, task) => { assert.equal(locked, false); locked = true; try { return await task() } finally { locked = false } } })
  return { run, envs, calls, deployments, secrets, sourceValues, providerInputs, journal: () => copy(stored), saves: () => saves,
    // Reconstruct a historical 2.5 journal without real secrets or remote calls.
    legacy(target) {
      const state = stored.targets[target]
      delete state.geminiModel
      syntheticValues.set(`${target}:GEMINI_MODEL`, LEGACY_GEMINI_MODEL)
      state.fingerprint = createHmac("sha256", secrets.credentialSeed).update(JSON.stringify(Object.keys(state.entries).map(key => [key, syntheticValues.get(`${target}:${key}`)]))).digest("hex")
    },
    postCount: () => calls.filter(call => call.method === "POST").length,
    shape: value => { createdShape = value }, postHook: value => { postHook = value }, patchHook: value => { patchHook = value }, deploymentHook: value => { deploymentHook = value }, providerReadHook: value => { providerReadHook = value }, sha: value => { currentSha = value } }
}
const rejects = (promise, name) => assert.rejects(promise, { message: `release_${name}` })

test("Gemini upgrade preserves old journal preparation and changes only the model once", async () => {
  const f = fixture(); await f.run("prepare-preview"); await f.run("enable-cx-preview"); await f.run("enable-providers-preview"); f.legacy("preview")
  await f.run("prepare-preview")
  const before = copy(f.envs), writes = f.calls.filter(c => c.method !== "GET").length
  const plan = await f.run("plan-gemini-preview")
  assert.equal(plan.fromModel, LEGACY_GEMINI_MODEL); assert.equal(plan.model, CURRENT_GEMINI_MODEL)
  assert.deepEqual(plan.wouldUpdate, ["GEMINI_MODEL"])
  assert.equal(f.calls.filter(c => c.method !== "GET").length, writes)
  await f.run("upgrade-gemini-preview")
  assert.equal(f.calls.filter(c => c.method !== "GET").length, writes + 1)
  for (const row of before.filter(r => r.key !== "GEMINI_MODEL")) assert.deepEqual(f.envs.find(r => r.id === row.id), row)
  assert.equal(f.journal().targets.preview.geminiModel, CURRENT_GEMINI_MODEL)
  assert.equal((await f.run("upgrade-gemini-preview")).alreadyEnabled, true)
  await f.run("prepare-preview"); await f.run("enable-public-cx-preview"); await f.run("deploy-preview")
})

test("Gemini production requires same-SHA READY model evidence and composes with public CX", async () => {
  const f = fixture(); await f.run("prepare-preview"); await f.run("enable-cx-preview"); await f.run("prepare-production")
  const cx = await f.run("deploy-preview"); f.deployments.get(cx.id).readyState = "READY"
  await f.run("mark-preview-passed", cx.id, REPORT); await f.run("enable-cx-production")
  f.sha("c".repeat(40)); await f.run("prepare-preview"); await f.run("prepare-production"); await f.run("enable-providers-preview")
  const connected = await f.run("deploy-preview"); f.deployments.get(connected.id).readyState = "READY"
  await f.run("mark-preview-passed", connected.id, REPORT); await f.run("enable-providers-production")
  f.legacy("preview"); f.legacy("production")
  f.sha("d".repeat(40)); await f.run("prepare-preview"); await f.run("prepare-production")
  await rejects(f.run("upgrade-gemini-production"), "preview_tests_required")
  await f.run("upgrade-gemini-preview"); await f.run("enable-public-cx-preview")
  const p = await f.run("deploy-preview"); f.deployments.get(p.id).readyState = "READY"
  await rejects(f.run("upgrade-gemini-production"), "preview_tests_required")
  await f.run("mark-preview-passed", p.id, REPORT)
  let productionInputReads = 0
  f.providerReadHook(() => {
    if (++productionInputReads > 1) f.providerInputs.GEMINI_API_KEY = "synthetic-late-production-rotation"
  })
  await f.run("upgrade-gemini-production")
  assert.equal(productionInputReads, 1, "production model and public-preview fingerprints share one input snapshot")
  f.providerReadHook(undefined)
  await f.run("enable-public-cx-production")
  assert.equal((await f.run("deploy-production")).target, "production")
})

test("Gemini upgrade rejects input rotations and ambiguous PATCH without retry", async () => {
  for (const kind of ["rotation", "ambiguous", "submitted"]) {
    const f = fixture(); await f.run("prepare-preview"); await f.run("enable-cx-preview"); await f.run("enable-providers-preview"); f.legacy("preview")
    if (kind === "rotation") f.providerInputs.GEMINI_API_KEY = "synthetic-rotated-key"
    if (kind === "ambiguous") f.patchHook(() => { throw new Error("secret provider outcome") })
    if (kind === "submitted") await f.run("deploy-preview")
    await rejects(f.run("upgrade-gemini-preview"), kind === "rotation" ? "prepared_values_changed" : kind === "ambiguous" ? "gemini_migration_outcome_unknown" : "gemini_requires_new_revision")
    const writes = f.calls.filter(c => c.method !== "GET").length
    if (kind === "ambiguous") {
      await rejects(f.run("upgrade-gemini-preview"), "target_not_prepared")
      await rejects(f.run("deploy-preview"), "target_not_prepared")
      await rejects(f.run("prepare-preview"), "gemini_migration_incomplete")
    }
    assert.equal(f.calls.filter(c => c.method !== "GET").length, writes)
  }
})

test("Gemini transition derives both target fingerprints from one immutable input snapshot", async () => {
  const f = fixture(); await f.run("prepare-preview"); await f.run("enable-cx-preview"); await f.run("enable-providers-preview"); f.legacy("preview")
  let reads = 0
  f.providerReadHook(() => {
    if (++reads > 1) f.providerInputs.GEMINI_API_KEY = "synthetic-concurrent-rotation"
  })
  await f.run("upgrade-gemini-preview")
  assert.equal(reads, 1)
  f.providerReadHook(undefined)
  await f.run("prepare-preview")
})

test("public CX migration adds only dual identity flags, preserves protected inputs and is idempotent", async () => {
  const f = fixture(); await f.run("prepare-preview"); await f.run("enable-cx-preview"); await f.run("enable-providers-preview")
  const before = copy(f.envs), count = f.calls.filter(c => c.method !== "GET").length
  const p = await f.run("plan-public-cx-preview")
  assert.deepEqual(p.wouldCreate, ["NEXT_PUBLIC_HK_PUBLIC_CX", "HK_PUBLIC_CX"])
  assert.equal(f.calls.filter(c => c.method !== "GET").length, count)
  await f.run("enable-public-cx-preview")
  for (const row of before) assert.deepEqual(f.envs.find(item => item.id === row.id), row)
  assert.equal(f.journal().targets.preview.publicCxEnabled, true)
  const after = f.calls.filter(c => c.method !== "GET").length
  assert.equal((await f.run("enable-public-cx-preview")).alreadyEnabled, true)
  await f.run("prepare-preview")
  assert.equal(f.calls.filter(c => c.method !== "GET").length, after)
})
test("public CX cannot open an unconnected profile or an already submitted revision", async () => {
  const f = fixture(); await f.run("prepare-preview")
  await rejects(f.run("enable-public-cx-preview"), "public_cx_requires_connected")
  await f.run("enable-cx-preview"); await f.run("enable-providers-preview"); await f.run("deploy-preview")
  await rejects(f.run("enable-public-cx-preview"), "public_cx_requires_new_revision")
})

test("public production opens only after same-SHA public READY preview evidence", async () => {
  const f = fixture()
  await f.run("prepare-preview"); await f.run("enable-cx-preview"); await f.run("prepare-production")
  const cx = await f.run("deploy-preview"); f.deployments.get(cx.id).readyState = "READY"
  await f.run("mark-preview-passed", cx.id, REPORT); await f.run("enable-cx-production")
  f.sha("c".repeat(40)); await f.run("prepare-preview"); await f.run("prepare-production")
  await f.run("enable-providers-preview")
  const connected = await f.run("deploy-preview"); f.deployments.get(connected.id).readyState = "READY"
  await f.run("mark-preview-passed", connected.id, REPORT); await f.run("enable-providers-production")
  f.sha("d".repeat(40)); await f.run("prepare-preview"); await f.run("prepare-production")
  await rejects(f.run("enable-public-cx-production"), "preview_tests_required")
  await f.run("enable-public-cx-preview")
  const candidate = await f.run("deploy-preview"); f.deployments.get(candidate.id).readyState = "READY"
  await rejects(f.run("enable-public-cx-production"), "preview_tests_required")
  await f.run("mark-preview-passed", candidate.id, REPORT)
  const before = copy(f.envs)
  await f.run("enable-public-cx-production")
  for (const row of before) assert.deepEqual(f.envs.find(item => item.id === row.id), row)
  assert.equal((await f.run("deploy-production")).target, "production")
})

test("ambiguous public flag creation never retries or deploys partial admission", async () => {
  const f = fixture(); await f.run("prepare-preview"); await f.run("enable-cx-preview"); await f.run("enable-providers-preview")
  f.postHook(() => { throw new Error("synthetic ambiguous response") })
  await rejects(f.run("enable-public-cx-preview"), "public_cx_migration_outcome_unknown")
  const writes = f.postCount()
  await rejects(f.run("enable-public-cx-preview"), "target_not_prepared")
  await rejects(f.run("deploy-preview"), "target_not_prepared")
  await rejects(f.run("prepare-preview"), "public_cx_migration_incomplete")
  assert.equal(f.postCount(), writes)
})

test("connected opt-in adds only reviewed provider rows, preserving shared budget/access/store/signers", async () => {
  const f = fixture(); await f.run("prepare-preview"); await f.run("enable-cx-preview")
  const before = copy(f.envs), count = f.calls.filter(c => c.method !== "GET").length
  const plan = await f.run("plan-providers-preview")
  assert.deepEqual(plan.wouldCreate, PROVIDER_ADDED_KEYS); assert.deepEqual(plan.wouldUpdate, ["HK_AI_MODE"])
  assert.equal(f.calls.filter(c => c.method !== "GET").length, count)
  await f.run("enable-providers-preview")
  for (const row of before.filter(row => row.key !== "HK_AI_MODE")) assert.deepEqual(f.envs.find(item => item.id === row.id), row)
  for (const key of PROVIDER_SECRET_KEYS) assert.equal(f.envs.find(item => item.gitBranch === HOSTED_SUI_BRANCH && item.key === key)?.type, "sensitive")
  const stored = f.journal(); assert.equal(stored.targets.preview.providersEnabled, true)
  assert.equal(stored.targets.preview.providerMigration.complete, true)
  for (const value of Object.values(f.providerInputs)) assert.equal(JSON.stringify(stored).includes(value), false)
  assert.equal((await f.run("prepare-preview")).runtimeProfile, "cx-sui-connected")
  const writes = f.calls.filter(c => c.method !== "GET").length
  assert.equal((await f.run("enable-providers-preview")).alreadyEnabled, true)
  assert.equal(f.calls.filter(c => c.method !== "GET").length, writes)
})

test("provider opt-in requires CX and a new revision, never reuses old preview proof", async () => {
  const f = fixture(); await f.run("prepare-preview")
  await rejects(f.run("enable-providers-preview"), "provider_requires_cx")
  await f.run("enable-cx-preview"); await f.run("deploy-preview")
  await rejects(f.run("enable-providers-preview"), "provider_requires_new_revision")
})

test("connected production requires same-SHA connected READY preview attestation", async () => {
  const f = fixture(); await f.run("prepare-preview"); await f.run("enable-cx-preview")
  await f.run("prepare-production")
  // First complete the pre-existing CX production migration, using its own revision.
  const prior = await f.run("deploy-preview"); f.deployments.get(prior.id).readyState = "READY"
  await f.run("mark-preview-passed", prior.id, REPORT); await f.run("enable-cx-production")
  f.sha("d".repeat(40)); await f.run("prepare-preview"); await f.run("prepare-production")
  await rejects(f.run("enable-providers-production"), "preview_tests_required")
  await f.run("enable-providers-preview")
  const p = await f.run("deploy-preview"); f.deployments.get(p.id).readyState = "READY"
  await rejects(f.run("enable-providers-production"), "preview_tests_required")
  await f.run("mark-preview-passed", p.id, REPORT)
  await f.run("enable-providers-production")
  assert.equal((await f.run("deploy-production")).target, "production")
})

test("connected candidate rotation or old input rotation cannot silently alter prepared fingerprint", async () => {
  for (const rotate of [f => { f.secrets.credentialSeed = "d".repeat(64) }, f => { f.sourceValues.HK_CX_PREVIEW_ACCESS_CODE = "Rotated_".repeat(8) }]) {
    const f = fixture(); await f.run("prepare-preview"); await f.run("enable-cx-preview"); rotate(f)
    const writes = f.postCount(); await rejects(f.run("enable-providers-preview"), "prepared_values_changed"); assert.equal(f.postCount(), writes)
  }
  const f = fixture(); await f.run("prepare-preview"); await f.run("enable-cx-preview"); await f.run("enable-providers-preview")
  f.providerInputs.HK_ZKLOGIN_SALT_SEED = "f".repeat(64)
  await rejects(f.run("prepare-preview"), "prepared_values_changed")
  await rejects(f.run("enable-providers-preview"), "prepared_values_changed")
})

test("late connected row conflict and malformed candidate fail before first mutation", async () => {
  const f = fixture(); await f.run("prepare-preview"); await f.run("enable-cx-preview")
  f.envs.push({ id: "foreign", key: PROVIDER_ADDED_KEYS.at(-1), target: ["preview"] })
  let writes = f.postCount(); await rejects(f.run("enable-providers-preview"), "existing_target_variable"); assert.equal(f.postCount(), writes)
  f.envs.pop(); f.providerInputs.GEMINI_API_KEY = "contains newline\n"
  writes = f.postCount(); await rejects(f.run("enable-providers-preview"), "provider_input"); assert.equal(f.postCount(), writes)
})

test("ambiguous connected secret POST or mode PATCH never retries or deploys partial config", async () => {
  for (const kind of ["post", "patch"]) {
    const f = fixture(); await f.run("prepare-preview"); await f.run("enable-cx-preview")
    f[kind + "Hook"](() => { throw new Error("secret provider outcome") })
    await rejects(f.run("enable-providers-preview"), "provider_migration_outcome_unknown")
    const count = f.calls.length
    await rejects(f.run("enable-providers-preview"), "target_not_prepared")
    await rejects(f.run("deploy-preview"), "target_not_prepared")
    assert.equal(f.calls.slice(count).some(c => c.method !== "GET"), false)
    assert.equal(JSON.stringify(f.journal()).includes("secret provider outcome"), false)
  }
})

test("CX migration changes only public CX connection values, preserving all signing/access/store rows", async () => {
  const f = fixture(); await f.run("prepare-preview")
  const before = copy(f.envs), writes = () => f.calls.filter(c => c.method !== "GET").length
  const count = writes(), plan = await f.run("plan-cx-preview")
  assert.deepEqual(plan.wouldUpdate, ["HK_MODE_CX"]); assert.equal(writes(), count)
  await f.run("enable-cx-preview")
  assert.equal(writes() - count, 4)
  for (const row of before.filter(row => row.key !== "HK_MODE_CX")) assert.deepEqual(f.envs.find(item => item.id === row.id), row)
  assert.equal(f.journal().targets.preview.cxEnabled, true)
  assert.equal(f.journal().targets.preview.cxMigration.complete, true)
  assert.equal((await f.run("prepare-preview")).runtimeProfile, "cx-sui")
  await f.run("enable-cx-preview"); assert.equal(writes(), count + 4)
})

test("CX production switch requires a CX-configured tested same-revision preview", async () => {
  const f = fixture(); await f.run("prepare-preview"); await f.run("prepare-production")
  await rejects(f.run("enable-cx-production"), "preview_tests_required")
  await f.run("enable-cx-preview")
  const preview = await f.run("deploy-preview"); f.deployments.get(preview.id).readyState = "READY"
  await rejects(f.run("enable-cx-production"), "preview_tests_required")
  await f.run("mark-preview-passed", preview.id, REPORT)
  await f.run("enable-cx-production")
  assert.equal((await f.run("deploy-production")).target, "production")
})

test("CX switch cannot reuse an earlier Sui-only deployment at the same revision", async () => {
  const f = fixture(); await f.run("prepare-preview"); await f.run("deploy-preview")
  await rejects(f.run("enable-cx-preview"), "cx_requires_new_revision")
})

test("CX provider row conflicts fail before writes; other branches are untouched", async () => {
  const f = fixture(); await f.run("prepare-preview")
  f.envs.push({ id: "othercx", key: "HK_CX_PROVIDER", target: ["preview"], gitBranch: HOSTED_SUI_BRANCH })
  const count = f.postCount()
  await rejects(f.run("enable-cx-preview"), "existing_target_variable")
  assert.equal(f.postCount(), count)
})

test("CX migration rejects changed source access or signing seed before all writes", async () => {
  for (const rotate of [f => { f.sourceValues.HK_CX_PREVIEW_ACCESS_CODE = "RotatedCode_".repeat(4) }, f => { f.secrets.credentialSeed = "d".repeat(64) }]) {
    const f = fixture(); await f.run("prepare-preview"); rotate(f)
    const count = f.calls.length
    await rejects(f.run("enable-cx-preview"), "prepared_values_changed")
    assert.equal(f.calls.slice(count).some(c => c.method !== "GET"), false)
    assert.equal(f.journal().targets.preview.cxMigration, undefined)
  }
})

test("CX switch never retries an ambiguous mode PATCH or deploys partial configuration", async () => {
  const f = fixture(); await f.run("prepare-preview")
  f.patchHook(() => { throw new Error("private upstream response") })
  await rejects(f.run("enable-cx-preview"), "cx_migration_outcome_unknown")
  const count = f.calls.length
  await rejects(f.run("enable-cx-preview"), "target_not_prepared")
  await rejects(f.run("deploy-preview"), "target_not_prepared")
  assert.equal(f.calls.slice(count).some(c => c.method !== "GET"), false)
  assert.equal(JSON.stringify(f.journal()).includes("private upstream response"), false)
})

for (const shape of ["object", "array"]) test(`handles official created ${shape} and idempotently reconciles metadata`, async () => {
  const f = fixture(); f.shape(shape)
  const first = await f.run("prepare-preview"), count = f.postCount()
  assert.ok(first.created.length > 20)
  const second = await f.run("prepare-preview")
  assert.equal(f.postCount(), count); assert.deepEqual(second.created, [])
  assert.equal(f.journal().targets.preview.complete, true)
  for (const value of [...Object.values(f.secrets), ...Object.values(f.sourceValues)]) assert.equal(JSON.stringify(f.journal()).includes(value), false)
})

test("late batch conflict is rejected before first env POST or journal write", async () => {
  const f = fixture()
  f.envs.push({ id: "unrelated", key: "HK_SUI_SPONSOR_SECRET_KEY", target: ["preview"], gitBranch: HOSTED_SUI_BRANCH })
  await rejects(f.run("prepare-preview"), "existing_target_variable")
  assert.equal(f.postCount(), 0); assert.equal(f.saves(), 0)
})

test("global-preview or multi-target variables cannot be adopted or overwritten", async () => {
  for (const target of [["preview"], ["preview", "production"]]) {
    const f = fixture(); f.envs.push({ id: "unrelated", key: "HK_MODE_CX", target })
    await rejects(f.run("prepare-preview"), "existing_target_variable")
    assert.equal(f.postCount(), 0)
  }
})

test("GET-only planning never creates journal, lock or provider variables", async () => {
  const f = fixture(), plan = await f.run("plan-preview")
  assert.equal(plan.mutation, false); assert.ok(plan.wouldCreate.length > 20)
  assert.equal(f.saves(), 0); assert.equal(f.postCount(), 0); assert.equal(f.journal(), null)
})

test("a lost create response recovers only its exact journal-marked row without repost", async () => {
  const f = fixture(); let failed = false
  f.postHook(() => { if (!failed) { failed = true; throw new Error("synthetic-secret-must-not-escape") } })
  await rejects(f.run("prepare-preview"), "environment_outcome_unknown")
  assert.equal(f.postCount(), 1)
  const firstId = f.envs.at(-1).id
  const resumed = await f.run("prepare-preview")
  assert.equal(resumed.reconciledCount, 1)
  assert.equal(f.envs.filter(item => item.id === firstId).length, 1)
  assert.equal(f.postCount(), Object.keys(f.journal().targets.preview.entries).length)
})

test("an indeterminate missing create is never automatically retried", async () => {
  const f = fixture()
  f.postHook(() => { f.envs.pop(); throw new Error("synthetic transport failure") })
  await rejects(f.run("prepare-preview"), "environment_outcome_unknown")
  await rejects(f.run("prepare-preview"), "environment_outcome_unknown")
  assert.equal(f.postCount(), 1)
})

for (const field of ["comment", "type", "gitBranch", "id", "updatedAt"]) test(`recorded env ${field} drift blocks without mutations`, async () => {
  const f = fixture(); await f.run("prepare-preview")
  const item = f.envs.find(item => item.gitBranch === HOSTED_SUI_BRANCH)
  item[field] = field === "updatedAt" ? item.updatedAt + 1 : "unrelated"
  const count = f.postCount()
  await assert.rejects(f.run("prepare-preview"), /release_environment_(scope|drift)/)
  assert.equal(f.postCount(), count)
})

test("source rotation cannot silently rekey a prepared environment", async () => {
  const f = fixture(); await f.run("prepare-preview"); const count = f.postCount()
  f.sourceValues.HK_CX_PREVIEW_ACCESS_CODE = "ChangedFixtureCode_".repeat(3)
  await rejects(f.run("prepare-preview"), "prepared_values_changed")
  assert.equal(f.postCount(), count)
})

test("deployment refuses incomplete preparation before any create", async () => {
  const f = fixture()
  await rejects(f.run("deploy-preview"), "target_not_prepared")
  await rejects(f.run("deploy-production"), "target_not_prepared")
  assert.equal(f.postCount(), 0)
})

test("production requires same-SHA READY preview plus explicit report attestation", async () => {
  const f = fixture(); await f.run("prepare-preview"); await f.run("prepare-production")
  await rejects(f.run("deploy-production"), "preview_tests_required")
  const preview = await f.run("deploy-preview")
  await rejects(f.run("mark-preview-passed", preview.id, REPORT), "preview_not_ready")
  f.deployments.get(preview.id).readyState = "READY"
  await rejects(f.run("deploy-production"), "preview_tests_required")
  const attested = await f.run("mark-preview-passed", preview.id, REPORT)
  assert.equal(attested.mutation, "local-journal-only")
  const production = await f.run("deploy-production")
  assert.equal(production.target, "production")
  const count = f.postCount()
  const replay = await f.run("deploy-production")
  assert.equal(replay.replayed, true); assert.equal(replay.id, production.id); assert.equal(f.postCount(), count)
})

test("preview region mismatch and changed revision cannot promote", async () => {
  const f = fixture(); await f.run("prepare-preview"); await f.run("prepare-production")
  const preview = await f.run("deploy-preview"), d = f.deployments.get(preview.id)
  d.readyState = "READY"; d.regions = ["iad1"]
  await rejects(f.run("mark-preview-passed", preview.id, REPORT), "preview_not_ready")
  d.regions = ["icn1"]; await f.run("mark-preview-passed", preview.id, REPORT)
  f.sha("d".repeat(40))
  await rejects(f.run("deploy-production"), "target_not_prepared")
})

test("production cannot use a different configuration from the tested preview", async () => {
  const f = fixture(); await f.run("prepare-preview")
  const preview = await f.run("deploy-preview")
  f.deployments.get(preview.id).readyState = "READY"; await f.run("mark-preview-passed", preview.id, REPORT)
  f.sourceValues.HK_CX_PREVIEW_ACCESS_CODE = "ChangedFixtureCode_".repeat(3)
  await f.run("prepare-production")
  const count = f.postCount()
  await rejects(f.run("deploy-production"), "prepared_values_changed")
  assert.equal(f.postCount(), count)
})

test("unknown deployment outcome is read-reconciled by nonce, never resubmitted", async () => {
  const f = fixture(); await f.run("prepare-preview")
  f.deploymentHook(() => { throw new Error("synthetic transport failure") })
  await rejects(f.run("deploy-preview"), "deployment_outcome_unknown")
  const count = f.postCount(), [d] = f.deployments.values()
  await rejects(f.run("deploy-preview"), "deployment_outcome_unknown")
  const nonce = d.meta.ktourHostedSuiRelease
  d.meta.ktourHostedSuiRelease = "unrelated"
  await rejects(f.run("reconcile-deployment", d.id), "deployment_binding")
  d.meta.ktourHostedSuiRelease = nonce
  await f.run("reconcile-deployment", d.id)
  const replay = await f.run("deploy-preview")
  assert.equal(replay.id, d.id); assert.equal(f.postCount(), count)
})

test("HTTP validation failures preserve only status, allowlisted code and fixed field hints", async () => {
  const f = fixture(); await f.run("prepare-preview")
  f.deploymentHook(() => readApiResponse(Response.json({ error: { code: "bad_request", message: "Invalid gitSource repoId SECRET_RESPONSE_BODY", token: "SECRET_TOKEN" } }, { status: 400 })))
  await rejects(f.run("deploy-preview"), "deployment_rejected")
  const failure = f.journal().targets.preview.deployments[SHA].failure
  assert.equal(failure.httpStatus, 400); assert.equal(failure.providerCode, "bad_request")
  assert.deepEqual(failure.fieldHints, ["/gitSource/repoId", "/gitSource"])
  for (const raw of ["SECRET_RESPONSE_BODY", "SECRET_TOKEN"]) assert.equal(JSON.stringify(f.journal()).includes(raw), false)
  const info = await f.run("inspect")
  assert.equal(info.deploymentAttempts[0].failure.httpStatus, 400)
  for (const raw of ["SECRET_RESPONSE_BODY", "SECRET_TOKEN"]) assert.equal(JSON.stringify(info).includes(raw), false)
})

test("arbitrary provider codes and raw errors cannot enter diagnostics", async () => {
  for (const failure of [
    () => readApiResponse(Response.json({ error: { code: "SECRET_TOKEN_123", message: "SECRET_RAW_BODY" } }, { status: 403 })),
    () => readApiResponse(new Response("SECRET_NON_JSON_BODY", { status: 502 })),
    () => { throw new Error("SECRET_TRANSPORT_ERROR") },
  ]) {
    const f = fixture(); await f.run("prepare-preview"); f.deploymentHook(failure)
    await assert.rejects(f.run("deploy-preview"), /release_deployment_(rejected|outcome_unknown)/)
    const saved = f.journal().targets.preview.deployments[SHA].failure
    assert.equal(saved.providerCode, null); assert.deepEqual(saved.fieldHints, [])
    for (const raw of ["SECRET_TOKEN_123", "SECRET_RAW_BODY", "SECRET_NON_JSON_BODY", "SECRET_TRANSPORT_ERROR"]) assert.equal(JSON.stringify(f.journal()).includes(raw), false)
  }
})

test("reviewed new SHA can deploy once while preserving the old unknown intent", async () => {
  const f = fixture(); await f.run("prepare-preview")
  f.deploymentHook(() => { throw new Error("synthetic network failure") })
  await rejects(f.run("deploy-preview"), "deployment_outcome_unknown")
  const old = f.journal().targets.preview.deployments[SHA]
  const next = "e".repeat(40); f.sha(next); f.deploymentHook(undefined)
  await f.run("prepare-preview")
  const deployed = await f.run("deploy-preview")
  assert.equal(deployed.sha, next)
  assert.deepEqual(f.journal().targets.preview.deployments[SHA], old)
  const count = f.postCount(); await f.run("deploy-preview"); assert.equal(f.postCount(), count)
})

test("private deployment error message is bounded/redacted and absent from public diagnostics", async () => {
  const f = fixture(); await f.run("prepare-preview")
  const token = "synthetic-auth-token", opaque = "X".repeat(64)
  f.deploymentHook(() => readApiResponse(Response.json({ error: { code: "bad_request", message:
    `Invalid configuration: unsupported option. ${token} user@example.invalid https://example.invalid/token?key=secret Bearer short-token apiKey=short-secret ${opaque}\n${"details ".repeat(100)}` } }, { status: 400 }), { deploymentError: true, redactValues: [token] }))
  let thrown
  try { await f.run("deploy-preview") } catch (error) { thrown = error }
  assert.equal(thrown.message, "release_deployment_rejected")
  const detail = f.journal().targets.preview.deployments[SHA].failure.privateMessage
  assert.ok(detail.startsWith("Invalid configuration: unsupported option.")); assert.ok(detail.length <= 256)
  for (const raw of [token, "user@example.invalid", "short-token", "short-secret", opaque, "https://", "\n"]) assert.equal(detail.includes(raw), false)
  assert.equal(JSON.stringify(thrown.diagnostic).includes("unsupported option"), false)
  assert.equal(JSON.stringify(await f.run("inspect")).includes("unsupported option"), false)
})

test("explicit Preview retry archives proven HTTP 400 and sends at most one new request", async () => {
  const f = fixture(); await f.run("prepare-preview")
  f.deploymentHook(() => readApiResponse(Response.json({ error: { code: "bad_request", message: "Invalid configuration" } }, { status: 400 })))
  await rejects(f.run("deploy-preview"), "deployment_rejected")
  const previous = f.journal().targets.preview.deployments[SHA], count = f.postCount()
  f.deploymentHook(undefined)
  const retry = await f.run("retry-rejected-preview")
  assert.equal(retry.target, "preview"); assert.equal(f.postCount(), count + 1)
  assert.deepEqual(f.journal().targets.preview.deployments[SHA].previousAttempts, [previous])
  await rejects(f.run("retry-rejected-preview"), "preview_retry_not_rejected")
  assert.equal(f.postCount(), count + 1)
})

test("explicit retry refuses unknown, 408, 5xx, production, and repeated 400 retries", async () => {
  for (const status of [null, 408, 500]) {
    const f = fixture(); await f.run("prepare-preview")
    f.deploymentHook(() => { if (status === null) throw new Error("fixture unknown"); return readApiResponse(Response.json({ error: { code: "bad_request" } }, { status })) })
    await rejects(f.run("deploy-preview"), "deployment_outcome_unknown")
    const count = f.postCount()
    await rejects(f.run("retry-rejected-preview"), "preview_retry_not_rejected")
    await rejects(f.run("retry-rejected-production"), "arguments")
    assert.equal(f.postCount(), count)
  }
  const f = fixture(); await f.run("prepare-preview")
  f.deploymentHook(() => readApiResponse(Response.json({ error: { code: "bad_request" } }, { status: 400 })))
  await rejects(f.run("deploy-preview"), "deployment_rejected")
  await rejects(f.run("retry-rejected-preview"), "deployment_rejected")
  const count = f.postCount()
  await rejects(f.run("retry-rejected-preview"), "preview_retry_limit")
  assert.equal(f.postCount(), count)
})

test("metadata changes after preview attestation invalidate production permission", async () => {
  const f = fixture(); await f.run("prepare-preview"); await f.run("prepare-production")
  const preview = await f.run("deploy-preview")
  f.deployments.get(preview.id).readyState = "READY"; await f.run("mark-preview-passed", preview.id, REPORT)
  f.envs.find(item => item.gitBranch === HOSTED_SUI_BRANCH).updatedAt++
  const count = f.postCount()
  await rejects(f.run("deploy-production"), "environment_drift")
  assert.equal(f.postCount(), count)
})

test("inspect and status only read and do not change the private journal", async () => {
  const f = fixture(); await f.run("prepare-preview"); const preview = await f.run("deploy-preview")
  const before = f.journal(), saves = f.saves(), posts = f.postCount()
  assert.equal((await f.run("inspect")).mutation, false)
  assert.equal((await f.run("status", preview.id)).mutation, false)
  assert.deepEqual(f.journal(), before); assert.equal(f.saves(), saves); assert.equal(f.postCount(), posts)
})

test("private storage uses atomic 0600 files and refuses concurrent/stale locks", async () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "ktour-release-journal-test-")))
  try {
    const store = createJournalStorage(directory)
    assert.equal(store.load(), null)
    await store.lock("fixture", async () => {
      store.save({ test: 1 }); store.save({ test: 2 })
      assert.deepEqual(store.load(), { test: 2 })
      await rejects(store.lock("other", async () => assert.fail("must not enter")), "operator_locked")
    })
    const file = join(directory, "hosted-sui-release.json")
    assert.equal(lstatSync(file).mode & 0o777, 0o600)
    assert.deepEqual(readdirSync(directory), ["hosted-sui-release.json"])
    const lock = join(directory, ".hosted-sui-release.lock")
    writeFileSync(lock, "fixture-stale-lock", { mode: 0o600 })
    await rejects(store.lock("other", async () => assert.fail("must not enter")), "operator_locked")
    assert.equal(readFileSync(lock, "utf8"), "fixture-stale-lock")
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test("private storage rejects symlinked journal without touching its target", () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "ktour-release-symlink-test-")))
  try {
    const target = join(directory, "unrelated.json"); writeFileSync(target, "fixture-preserve", { mode: 0o600 })
    symlinkSync(target, join(directory, "hosted-sui-release.json"))
    const store = createJournalStorage(directory)
    assert.throws(() => store.load(), /release_journal_file/)
    assert.throws(() => store.save({ replaced: true }), /release_journal_file/)
    assert.equal(readFileSync(target, "utf8"), "fixture-preserve")
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
