import assert from "node:assert/strict"
import { test } from "node:test"
import { readFileSync } from "node:fs"
import { prepareGuideConfiguration, readGuidePreparationResponse, GUIDE_INACTIVE_VALUES as VALUES, GUIDE_PREPARATION_SCOPE as S, GUIDE_PRIVATE_INPUT_NAMES } from "../../scripts/hackathon-guide-prepare.mjs"
import { guideBuildEnv } from "../../scripts/hackathon-guide-build.mjs"

const KEYS = Object.keys(VALUES), FLAG = "HK_GUIDE_PRODUCTION_ENABLED", MARKER = "ktour-guide-preparation/v1:runtime-off"
const at = Date.parse("2026-09-29T00:00:00Z")
function fixture() {
  let seq = 0, now = at, begun = false
  const rows = [], values = new Map(), calls = [], saved = []
  const row = (key, overrides = {}, value = VALUES[key]) => {
    const r = { id: `env_fixture_${++seq}`, key, type: "encrypted", target: ["preview"], gitBranch: S.branch, comment: MARKER, createdAt: at, updatedAt: at, ...overrides }
    rows.push(r); values.set(r.id, value); return r
  }
  const f = { rows, values, calls, saved, row, writes: 0, before: undefined, afterWrite: undefined, project: {}, user: "jaewook-9643", setNow: v => { now = v } }
  const io = {
    now: () => now,
    api: async (path, method = "GET", body) => {
      calls.push({ path, method, body }); await f.before?.(path, method)
      if (path === "/v2/user") return { user: { username: f.user } }
      if (path === `/v9/projects/${S.project}`) return { id: S.project, accountId: S.team, name: "ondo", rootDirectory: "k-tour-id-app", link: { type: "github", org: "woogieboogie-jl", repo: "k-tour-id" }, ...f.project }
      if (path === `/v10/projects/${S.project}/env` && method === "GET") return { envs: structuredClone(rows) }
      if (path.startsWith(`/v1/projects/${S.project}/env/`) && method === "GET") {
        const r = rows.find(r => path.endsWith("/" + r.id)); assert.ok(r); assert.ok(KEYS.includes(r.key), "private values must never be read")
        return { ...r, decrypted: true, value: values.get(r.id) }
      }
      assert.equal(method, "POST"); assert.equal(path, `/v10/projects/${S.project}/env`); assert.equal(begun, true)
      assert.ok(KEYS.includes(body.key)); assert.equal(body.value, VALUES[body.key]); assert.deepEqual(body.target, ["preview"]); assert.equal(body.gitBranch, S.branch)
      const flag = rows.find(r => r.key === FLAG)
      if (body.key !== FLAG) assert.equal(values.get(flag.id), "0", "runtime is off before every write")
      const r = row(body.key); f.writes++; await f.afterWrite?.(r)
      return { created: structuredClone(r), failed: [] }
    },
    begin: value => { assert.equal(begun, false); begun = true; saved.push(structuredClone(value)) },
    save: value => { assert.equal(begun, true); saved.push(structuredClone(value)) },
  }
  f.run = (apply = true) => prepareGuideConfiguration(io, apply)
  return f
}
const rejected = async (p, code) => assert.rejects(p, { message: `guide_preparation_${code}` })

test("response reads are byte-bounded, cancelled and never return provider error bodies", async () => {
  assert.deepEqual(await readGuidePreparationResponse(new Response('{"ok":true}')), { ok: true })
  await rejected(readGuidePreparationResponse(new Response("secret-error-body", { status: 403 })), "read_failed")
  await rejected(readGuidePreparationResponse(new Response("secret-error-body", { status: 403 }), "POST"), "unconfirmed_write")
  await rejected(readGuidePreparationResponse(new Response("{}", { headers: { "content-length": "2000001" } })), "response")
  await rejected(readGuidePreparationResponse(new Response("not-json")), "response")
  let cancelled = false
  const stream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(2_000_001)) }, cancel() { cancelled = true } })
  await rejected(readGuidePreparationResponse(new Response(stream)), "response")
  assert.equal(cancelled, true)
})

test("guide preparation manifest matches the guarded build and never replaces deployed vercel.json", () => {
  const manifest = JSON.parse(readFileSync(new URL("../../vercel.guide.json", import.meta.url))), current = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url)))
  assert.equal(manifest.buildCommand, "node scripts/hackathon-guide-build.mjs"); assert.deepEqual(manifest.regions, ["icn1"]); assert.equal(manifest.git.deploymentEnabled, false)
  assert.equal(current.buildCommand, "node scripts/hackathon-hosted-sui-build.mjs")
  const built = guideBuildEnv({ PATH: "/fixture" })
  for (const name of KEYS.filter(k => k in built)) assert.equal(VALUES[name], built[name], name)
})
test("plan is guide-specific, metadata-only and never reports activation or real provider success", async () => {
  const f = fixture(); for (const key of GUIDE_PRIVATE_INPUT_NAMES) f.row(key, { type: "sensitive" }, "sensitive-unreturned-fixture")
  const r = await f.run(false)
  assert.equal(r.runtimeEnabled, false); assert.equal(r.providerVerified, false); assert.equal(r.signingAllowed, false)
  assert.equal(r.secretsRead, 0); assert.equal(f.writes, 0); assert.equal(f.saved.length, 0)
  assert.ok(r.privateConfiguration.every(x => x.branchRowPresent && x.validity === "not_verified"))
  assert.ok(!JSON.stringify(r).includes("sensitive-unreturned-fixture"))
  assert.deepEqual(r.wouldCreate, KEYS)
})
test("public preparation writes only fixed inactive Preview literals with durable intents first", async () => {
  const f = fixture(), r = await f.run()
  assert.equal(f.writes, KEYS.length); assert.equal(f.saved.at(-1).complete, true)
  assert.equal(r.runtimeEnabled, false); assert.equal(r.secretsRead, 0)
  assert.equal(f.calls.find(c => c.method === "POST").body.key, FLAG)
  for (const c of f.calls.filter(c => c.method === "POST")) assert.equal(c.body.type, "encrypted")
})
test("already prepared public values are revalidated without new writes or a new journal", async () => {
  const f = fixture(); KEYS.forEach(k => f.row(k))
  const r = await f.run(); assert.equal(r.mutation, false); assert.equal(f.writes, 0); assert.equal(f.saved.length, 0)
})
for (const override of [{ gitBranch: undefined }, { target: ["preview", "production"] }, { comment: "unowned" }, { type: "sensitive" }, { customEnvironmentIds: ["wrong"] }]) {
  test(`foreign/shadow configuration fails before any writes: ${JSON.stringify(override)}`, async () => {
    const f = fixture(); f.row(KEYS.at(-1), override); await rejected(f.run(), "scope"); assert.equal(f.writes, 0); assert.equal(f.saved.length, 0)
  })
}
test("wrong account/project and duplicate shadow rows cannot prepare", async () => {
  for (const wrong of ["account", "project", "shadow"]) {
    const f = fixture()
    if (wrong === "account") f.user = "unapproved"
    if (wrong === "project") f.project.accountId = "other-team"
    if (wrong === "shadow") { f.row(FLAG); f.row(FLAG) }
    await rejected(f.run(), wrong === "shadow" ? "shadowed_variable" : "project"); assert.equal(f.writes, 0)
  }
})
test("runtime enabled or public value drift refuses, never silently overwrites", async () => {
  const f = fixture(); f.row(FLAG, {}, "1"); await rejected(f.run(), "value_drift"); assert.equal(f.writes, 0)
  const g = fixture(); g.afterWrite = r => { if (g.writes === 1) g.values.set(r.id, "1") }
  await rejected(g.run(), "value_drift"); assert.equal(g.writes, 1); assert.equal(g.saved.at(-1).complete, false)
})
test("fresh metadata drift in any future row stops the next write", async () => {
  const f = fixture(); f.afterWrite = () => { if (f.writes === 1) f.row(KEYS.at(-1), { comment: "foreign-writer" }) }
  await rejected(f.run(), "scope"); assert.equal(f.writes, 1)
})
test("unknown write outcome is journaled once and never blindly replayed", async () => {
  const f = fixture(); f.afterWrite = () => { throw new Error("synthetic_lost_response") }
  await assert.rejects(f.run(), /synthetic_lost_response/); assert.equal(f.writes, 1)
  assert.equal(f.saved.at(-1).entries.length, 1); assert.equal(f.saved.at(-1).entries[0].after, undefined)
})
test("expiry before preparation or during the sequence stops without extending the window", async () => {
  const f = fixture(); f.setNow(Date.parse(VALUES.HK_GUIDE_EXPIRES_AT)); await rejected(f.run(), "expired"); assert.equal(f.writes, 0)
  const g = fixture(); g.afterWrite = () => g.setNow(Date.parse(VALUES.HK_GUIDE_EXPIRES_AT))
  await rejected(g.run(), "expired"); assert.equal(g.writes, 1)
})
