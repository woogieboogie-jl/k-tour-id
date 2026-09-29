import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { createGuidePreviewOperator, validateGuideManifest } from "../../scripts/hackathon-guide-preview-operator.mjs"
import { GUIDE_INACTIVE_VALUES, GUIDE_PREPARATION_SCOPE as S } from "../../scripts/hackathon-guide-prepare.mjs"

// Synthetic transport and journal only. Never execute the CLI, open auth files,
// contact Vercel, provision configuration, deploy, or access a ledger.
const NOW = Date.parse("2026-09-29T04:00:00Z"), SHA = "a".repeat(40), SOURCE = "b".repeat(40), HASH = "c".repeat(64)
const copy = value => structuredClone(value)
function fixture() {
  let journal = null, locked = false, localCalls = 0, time = NOW, postHook, localHook
  const calls = [], deployments = new Map()
  const values = { ...GUIDE_INACTIVE_VALUES }
  const envs = Object.keys(values).map((key, i) => ({ id: `guide_env_${i}`, key, target: ["preview"], gitBranch: S.branch, type: "encrypted", comment: "ktour-guide-preparation/v1:runtime-off", createdAt: NOW, updatedAt: NOW }))
  const project = { id: S.project, accountId: S.team, name: "ondo", rootDirectory: "k-tour-id-app", link: { type: "github", org: "woogieboogie-jl", repo: "k-tour-id", repoId: 123 } }
  const api = async (path, method = "GET", body) => {
    calls.push({ path, method, ...(body ? { body: copy(body) } : {}) })
    if (path === "/v2/user") return { user: { username: "jaewook-9643" } }
    if (path === `/v9/projects/${S.project}`) return copy(project)
    if (path === `/v10/projects/${S.project}/env`) { assert.equal(method, "GET"); return { envs: copy(envs) } }
    if (path.startsWith(`/v1/projects/${S.project}/env/`)) {
      const item = envs.find(e => e.id === path.split("/").at(-1)); assert.ok(item && Object.hasOwn(values, item.key), "only pinned public values may be read")
      return { ...copy(item), decrypted: true, value: values[item.key] }
    }
    if (path === "/v13/deployments") {
      assert.equal(method, "POST"); assert.equal(locked, true)
      const intent = journal.deployments[SHA]; assert.ok(intent.sentAt, "journal saved before remote write")
      assert.equal(body.meta.ktourGuideInactive, intent.nonce)
      const deployment = { id: "dpl_fixtureGuide1", projectId: S.project, ownerId: S.team, target: null, url: "guide-fixture.vercel.app", readyState: "BUILDING", regions: ["icn1"],
        meta: { ...copy(body.meta), githubCommitRef: S.branch, githubCommitSha: SHA } }
      deployments.set(deployment.id, deployment)
      if (postHook) await postHook(deployment)
      return copy(deployment)
    }
    if (path.startsWith("/v13/deployments/")) { assert.equal(method, "GET"); return copy(deployments.get(path.split("/").at(-1))) }
    assert.fail(`unexpected synthetic API ${method} ${path}`)
  }
  const run = createGuidePreviewOperator({ api, now: () => time, nonce: () => "d".repeat(32), localCheck: () => { localCalls++; if (localHook) localHook(localCalls); return { sha: SHA, sourceSha: SOURCE, manifestDigest: HASH } },
    loadJournal: () => copy(journal), saveJournal: value => { assert.equal(locked, true); journal = copy(value) },
    withLock: async (_action, fn) => { assert.equal(locked, false); locked = true; try { return await fn() } finally { locked = false } } })
  return { run, calls, envs, values, project, deployments, journal: () => copy(journal), posts: () => calls.filter(c => c.method === "POST"), postHook: hook => { postHook = hook }, localHook: hook => { localHook = hook }, time: value => { time = value } }
}

test("guide manifest accepts only the pinned manifest, with no alias/env/project mutation fields", () => {
  const manifest = JSON.parse(readFileSync(new URL("../../vercel.guide.json", import.meta.url), "utf8"))
  assert.equal(validateGuideManifest(manifest), manifest)
  for (const value of [{ ...manifest, buildCommand: "next build" }, { ...manifest, git: { deploymentEnabled: true } }, { ...manifest, regions: ["iad1"] }, { ...manifest, alias: ["ktour-id.vercel.app"] }, { ...manifest, env: { HK_GUIDE_PRODUCTION_ENABLED: "1" } }, { ...manifest, projectSettings: {} }]) assert.throws(() => validateGuideManifest(value), /guide_preview_manifest/)
})

test("inactive guide plan verifies public preparation only, does not create journal or deployment", async () => {
  const f = fixture(), plan = await f.run("plan")
  assert.equal(plan.target, "preview"); assert.equal(plan.runtimeEnabled, false); assert.equal(plan.providerVerified, false); assert.equal(plan.signingAllowed, false)
  assert.equal(plan.sha, SHA); assert.equal(plan.sourceSha, SOURCE); assert.match(plan.environmentDigest, /^[a-f0-9]{64}$/)
  assert.equal(f.journal(), null); assert.equal(f.posts().length, 0)
})

test("one explicit Preview deployment, exact revision, no projectSettings/target/alias/env override; repeated command is GET only", async () => {
  const f = fixture(), result = await f.run("deploy-preview")
  assert.equal(result.runtimeEnabled, false); assert.equal(result.id, "dpl_fixtureGuide1")
  const payload = f.posts()[0].body
  assert.deepEqual(Object.keys(payload).sort(), ["gitSource", "meta", "name", "project"])
  assert.deepEqual(payload.gitSource, { type: "github", repoId: "123", ref: S.branch, sha: SHA })
  assert.equal(f.posts().length, 1)
  f.deployments.get(result.id).readyState = "READY"
  assert.equal((await f.run("inspect")).state, "READY")
  assert.equal((await f.run("deploy-preview")).replayed, true)
  assert.equal(f.posts().length, 1)
})

test("unknown POST outcome retains durable intent and never auto-retries", async () => {
  const f = fixture(); f.postHook(() => { throw new Error("synthetic timeout") })
  await assert.rejects(f.run("deploy-preview"), /guide_preview_outcome_unknown/)
  assert.ok(f.journal().deployments[SHA].sentAt); assert.equal(f.journal().deployments[SHA].id, undefined)
  await assert.rejects(f.run("deploy-preview"), /guide_preview_outcome_unknown/)
  assert.equal(f.posts().length, 1)
})

test("unbound deployment response cannot be accepted or retried", async () => {
  for (const mutate of [d => { d.target = "production" }, d => { d.projectId = "wrong" }, d => { d.meta.githubCommitSha = "e".repeat(40) }, d => { d.meta.ktourGuideSource = "f".repeat(40) }, d => { d.meta.ktourGuideInactive = "wrong" }, d => { d.customEnvironment = { id: "custom" } }]) {
    const f = fixture(); f.postHook(mutate)
    await assert.rejects(f.run("deploy-preview"), /guide_preview_deployment_binding/)
    await assert.rejects(f.run("deploy-preview"), /guide_preview_outcome_unknown/)
    assert.equal(f.posts().length, 1)
  }
})

test("missing preparation, active flag, wrong branch/global shadow and private effective config all refuse before POST", async () => {
  for (const mutate of [f => f.envs.pop(), f => { f.values.HK_GUIDE_PRODUCTION_ENABLED = "1" }, f => { delete f.envs[0].gitBranch }, f => f.envs.push({ id: "private", key: "HK_GUIDE_ACCESS_SECRET", target: ["preview"], gitBranch: S.branch }), f => f.envs.push({ id: "private", key: "HK_SUI_ISSUER_SECRET_KEY", target: ["preview"] })]) {
    const f = fixture(); mutate(f)
    await assert.rejects(f.run("deploy-preview"), /guide_(?:preview|preparation)_/)
    assert.equal(f.posts().length, 0); assert.equal(f.journal(), null)
  }
})

test("public metadata drift after first validation refuses before intent or POST", async () => {
  const f = fixture(); f.localHook(count => { if (count === 2) f.envs[0].updatedAt++ })
  await assert.rejects(f.run("deploy-preview"), /guide_preview_drift/)
  assert.equal(f.posts().length, 0); assert.equal(f.journal(), null)
})

test("global and branch UPSTASH/ENOKI credentials are refused without decrypting them", async () => {
  for (const key of ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "ENOKI_API_KEY"]) {
    for (const gitBranch of [undefined, S.branch]) {
      const f = fixture(); f.envs.push({ id: "inherited_private", key, target: ["preview"], ...(gitBranch ? { gitBranch } : {}) })
      await assert.rejects(f.run("deploy-preview"), /guide_preview_unexpected_configuration/)
      assert.equal(f.posts().length, 0)
      assert.equal(f.calls.some(c => c.path.endsWith("/inherited_private")), false)
    }
  }
})

test("wrong project, invalid repository ID, expiry and unsupported action cannot deploy", async () => {
  for (const mutate of [f => { f.project.accountId = "wrong" }, f => { f.project.link.repoId = "123/not-a-repository" }, f => f.time(Date.parse("2026-10-01T00:00:00Z"))]) {
    const f = fixture(); mutate(f); await assert.rejects(f.run("deploy-preview"), /guide_(?:preview|preparation)_/); assert.equal(f.posts().length, 0)
  }
  const f = fixture()
  for (const action of ["deploy-production", "promote", "prepare", "retry", "delete"]) await assert.rejects(f.run(action), /guide_preview_action/)
  await assert.rejects(f.run("inspect"), /guide_preview_not_submitted/)
  assert.equal(f.posts().length, 0)
})

test("inspect refuses READY in the wrong region and environment drift after submission", async () => {
  const f = fixture(), d = await f.run("deploy-preview")
  Object.assign(f.deployments.get(d.id), { readyState: "READY", regions: ["iad1"] })
  await assert.rejects(f.run("inspect"), /guide_preview_deployment_binding/)
  f.envs[0].updatedAt++
  await assert.rejects(f.run("inspect"), /guide_preview_drift/)
  assert.equal(f.posts().length, 1)
})
