import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtempSync, realpathSync, lstatSync, rmSync, symlinkSync, writeFileSync, readFileSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createJournalStorage, createReleaseOperator, readApiResponse } from "../../scripts/hackathon-hosted-sui-operator.mjs"
import { HOSTED_SUI_BRANCH, PROJECT_ID, ORG_ID } from "../../scripts/hackathon-hosted-sui-build.mjs"

// Pure synthetic API/state fixtures. Never invoke the operational wrapper,
// read a real auth/run file, contact Vercel, create an env, or deploy anything.
const SHA = "a".repeat(40), REPORT = "b".repeat(64), TIME = Date.parse("2026-09-28T10:00:00Z")
const sourceBranch = "feat/hackathon-readiness-preview-20260925"
const copy = value => structuredClone(value)
function fixture() {
  const sourceValues = { KV_REST_API_URL: "https://fixture.upstash.io", KV_REST_API_TOKEN: "fixture-token-".repeat(4), HK_CX_PREVIEW_ACCESS_CODE: "FixtureAccessCode_".repeat(3) }
  const secrets = { credentialSeed: "c".repeat(64), issuer: "issuer-fixture-only-".repeat(4), agent: "agent-fixture-only-".repeat(4) }
  const envs = Object.keys(sourceValues).map((key, i) => ({ id: `source_${i}`, key, target: ["preview"], gitBranch: sourceBranch }))
  const calls = [], deployments = new Map()
  let stored = null, saves = 0, counter = 0, currentSha = SHA, locked = false
  let postHook, createdShape = "object", deploymentHook
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
      const item = { ...copy(metadata), id: `env_${++counter}`, createdAt: TIME + counter, updatedAt: TIME + counter }
      envs.push(item)
      if (postHook) await postHook(item)
      return { created: createdShape === "object" ? copy(item) : [copy(item)], failed: [] }
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
  const run = createReleaseOperator({ api, readSecrets: () => copy(secrets), localCheck: () => currentSha, now: () => TIME, nonce: () => (++counter).toString(16).padStart(32, "0"),
    loadJournal: () => copy(stored), saveJournal: value => { saves++; stored = copy(value) },
    withLock: async (_action, task) => { assert.equal(locked, false); locked = true; try { return await task() } finally { locked = false } } })
  return { run, envs, calls, deployments, secrets, sourceValues, journal: () => copy(stored), saves: () => saves,
    postCount: () => calls.filter(call => call.method === "POST").length,
    shape: value => { createdShape = value }, postHook: value => { postHook = value }, deploymentHook: value => { deploymentHook = value }, sha: value => { currentSha = value } }
}
const rejects = (promise, name) => assert.rejects(promise, { message: `release_${name}` })

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
