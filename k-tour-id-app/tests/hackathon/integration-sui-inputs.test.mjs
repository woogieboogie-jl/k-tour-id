import assert from "node:assert/strict"
import { after, test } from "node:test"
import { prepareIntegrationInputs, validatedOwnInputs, PUBLIC, SCOPE } from "../../scripts/prepare-integration-sui-inputs.mjs"

// Synthetic I/O only: importing the script does not enter its operational CLI.
// No auth/private files, real environment values, provider calls or deployments.
const originalFetch = globalThis.fetch
globalThis.fetch = () => { throw new Error("fixture_network_forbidden") }
after(() => { globalThis.fetch = originalFetch })
const copy = value => structuredClone(value)
const TIME = Date.parse("2026-09-29T00:00:00Z")
const MODE = "HK_INTEGRATION_PREVIEW_ENABLED"
const PRIVATE = ["HK_SUI_ISSUER_SECRET_KEY", "HK_SUI_AGENT_SECRET_KEY", "HK_SUI_SPONSOR_SECRET_KEY"]
const EXPECTED_PUBLIC = {
  HK_INTEGRATION_SUI_TARGET: "selfhosted-testnet",
  HK_SUI_GRPC_URL: "https://fullnode.testnet.sui.io:443",
  HK_SUI_CHAIN_IDENTIFIER: "69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD",
  HK_SUI_EXPLORER: "https://suiscan.xyz/testnet",
  HK_SUI_PACKAGE_ID: "0x7a28a5e59d87e385f2eb3047ca2bbe76301627343f8d88eeb0f03733d4f2389e",
  HK_SUI_CAMPAIGN_ID: "0xa273ccd96315ae187b16eb3192c822795bc2031e6f79405739daec4a52275afd",
  HK_SUI_CAMPAIGN_INITIAL_VERSION: "349181963",
}
const PRIOR = {
  HK_SUI_PACKAGE_ID: "0xc5d26326ffd5267bb5b54625c1e2b9c03f7cca4753232d0b042c62ee74fd975d",
  HK_SUI_CAMPAIGN_ID: "0xe3fce96c9c9e1086ff20dd7453e16ff2c52d3d3324e6e4e34446c7d0dc2ecf16",
  HK_SUI_CAMPAIGN_INITIAL_VERSION: "349181955",
}
const SENTINELS = ["FIXTURE_ISSUER_SECRET_NEVER_OUTPUT", "FIXTURE_AGENT_SECRET_NEVER_OUTPUT"]
const rejects = (promise, code) => assert.rejects(promise, { message: `integration_inputs_${code}` })

function fixture() {
  const user = { user: { username: "jaewook-9643" } }
  const project = { id: SCOPE.project, accountId: SCOPE.team, name: "ondo", rootDirectory: "k-tour-id-app", link: { type: "github", org: "woogieboogie-jl", repo: "k-tour-id" } }
  const envs = [], values = new Map(), calls = [], history = []
  let counter = 0, journal = null, inputReads = 0, readHook, listHook, mutationHook, responseHook
  const input = { values: { ...copy(PUBLIC), HK_SUI_ISSUER_SECRET_KEY: SENTINELS[0], HK_SUI_AGENT_SECRET_KEY: SENTINELS[1], HK_SUI_SPONSOR_SECRET_KEY: SENTINELS[0] }, fingerprint: "a".repeat(64) }
  const add = (key, value, extra = {}) => {
    const item = { id: `fixture_${++counter}`, key, type: PRIVATE.includes(key) ? "sensitive" : "encrypted", target: ["preview"], gitBranch: SCOPE.branch, createdAt: TIME, updatedAt: TIME, ...extra }
    envs.push(item); values.set(item.id, value); return item
  }
  const find = key => envs.find(item => item.key === key && item.gitBranch === SCOPE.branch)
  add(MODE, "0"); add("HK_SUI_NETWORK", "testnet")
  for (const [key, value] of Object.entries(PRIOR)) add(key, value)
  const save = value => { assert.ok(journal, "exclusive journal must exist before save"); journal = copy(value); history.push(copy(value)) }
  const io = {
    inputs: () => { inputReads++; return copy(input) },
    begin: value => {
      if (journal) throw new Error("integration_inputs_journal")
      journal = copy(value); history.push(copy(value))
    },
    save,
    api: async (path, method = "GET", body) => {
      calls.push({ path, method }) // Never retain body values in fixture reports.
      if (method === "GET" && path === "/v2/user") return copy(user)
      if (method === "GET" && path === `/v9/projects/${SCOPE.project}`) return copy(project)
      if (method === "GET" && path === `/v10/projects/${SCOPE.project}/env`) {
        await listHook?.(); return { envs: copy(envs) }
      }
      if (method === "GET" && path.startsWith(`/v1/projects/${SCOPE.project}/env/`)) {
        const row = envs.find(item => item.id === path.split("/").at(-1))
        assert.ok(row, "read only an exact listed fixture environment ID")
        await readHook?.(row)
        return { ...copy(row), decrypted: true, value: values.get(row.id) }
      }
      assert.ok(method === "POST" || method === "PATCH", "no deployment, delete or activation transport")
      const row = method === "PATCH" ? envs.find(item => item.id === path.split("/").at(-1)) : undefined
      const key = method === "POST" ? body.key : row?.key
      assert.ok(Object.hasOwn(PUBLIC, key) || PRIVATE.includes(key), "writes are limited to approved input keys")
      assert.equal(values.get(find(MODE).id), "0", "runtime is off at every simulated write")
      assert.ok(journal && journal.complete === false)
      const intent = journal.entries.at(-1)
      assert.equal(intent.key, key); assert.equal(intent.method, method)
      assert.ok(intent.intentAt); assert.equal(intent.after, undefined, "fsynced intent precedes uncertain mutation")
      assert.equal(body.value, input.values[key])
      if (method === "POST") {
        assert.equal(path, `/v10/projects/${SCOPE.project}/env`)
        assert.deepEqual(body, { key, value: input.values[key], type: PRIVATE.includes(key) ? "sensitive" : "encrypted", target: ["preview"], gitBranch: SCOPE.branch, comment: "ktour-integration-inputs/20260929:runtime-off" })
      } else {
        assert.equal(path, `/v9/projects/${SCOPE.project}/env/${row.id}`)
        assert.ok(Object.hasOwn(PRIOR, key)); assert.deepEqual(body, { value: input.values[key] })
        assert.deepEqual(row.target, ["preview"]); assert.equal(row.gitBranch, SCOPE.branch)
        assert.deepEqual(intent.before, { id: row.id, createdAt: row.createdAt, updatedAt: row.updatedAt })
      }
      await mutationHook?.({ key, method, row })
      const result = row ?? add(key, body.value, { comment: body.comment })
      values.set(result.id, body.value); result.updatedAt = TIME + ++counter
      const response = method === "POST" ? { created: copy(result), failed: [] } : copy(result)
      return responseHook ? responseHook(response, { key, method, row: result }) : response
    },
  }
  return { io, user, project, envs, values, calls, input, add, find,
    run: (apply = true) => prepareIntegrationInputs(io, apply),
    writes: () => calls.filter(call => call.method !== "GET"),
    journal: () => copy(journal), history: () => copy(history), inputReads: () => inputReads,
    readHook: value => { readHook = value }, listHook: value => { listHook = value },
    mutationHook: value => { mutationHook = value }, responseHook: value => { responseHook = value },
  }
}

test("GET-only plan reports exact inactive Preview inputs without journal or mutations", async () => {
  const f = fixture(), result = await f.run(false)
  assert.deepEqual(PUBLIC, EXPECTED_PUBLIC)
  assert.equal(result.branch, "integration/autonomous-finish-20260927")
  assert.equal(result.runtimeEnabled, false); assert.equal(result.deployments, 0); assert.equal(result.mutation, false)
  assert.deepEqual(result.updated, Object.keys(PRIOR))
  assert.deepEqual(result.created, ["HK_INTEGRATION_SUI_TARGET", "HK_SUI_GRPC_URL", "HK_SUI_CHAIN_IDENTIFIER", "HK_SUI_EXPLORER", ...PRIVATE])
  assert.equal(f.writes().length, 0); assert.equal(f.journal(), null); assert.equal(f.history().length, 0)
})

for (const shape of ["object", "array"]) test(`exactly ten scoped writes accept official created ${shape} response`, async () => {
  const f = fixture()
  const untouched = [
    f.add("HK_MODE_OPENDID", "opendid"),
    f.add("HK_STORE_KEY", "fixture-integration-only-store"),
    f.add("HK_SUI_AGENT_SECRET_KEY", "other-preview-private", { gitBranch: "other-branch" }),
    f.add("HK_SUI_ISSUER_SECRET_KEY", "production-private", { target: ["production"], gitBranch: undefined }),
  ].map(copy)
  if (shape === "array") f.responseHook((response, { method }) => method === "POST" ? { ...response, created: [response.created] } : response)
  const result = await f.run()
  assert.equal(f.writes().length, 10)
  assert.equal(f.writes().filter(call => call.method === "POST").length, 7)
  assert.equal(f.writes().filter(call => call.method === "PATCH").length, 3)
  assert.equal(result.mutation, "inactive-preview-inputs-only"); assert.equal(result.runtimeEnabled, false); assert.equal(result.deployments, 0)
  assert.equal(f.values.get(f.find(MODE).id), "0"); assert.equal(f.values.get(f.find("HK_SUI_NETWORK").id), "testnet")
  assert.equal(f.journal().complete, true); assert.equal(f.journal().entries.length, 10)
  assert.ok(f.journal().entries.every(entry => entry.intentAt && entry.after))
  assert.ok(f.calls.every(call => !call.path.includes("deployments")))
  for (const original of untouched) assert.deepEqual(f.envs.find(row => row.id === original.id), original)
  const publicArtifacts = JSON.stringify({ result, journal: f.journal(), history: f.history(), calls: f.calls })
  for (const secret of [...SENTINELS, "production-private", "other-preview-private"]) assert.equal(publicArtifacts.includes(secret), false)
  assert.equal(/"value"\s*:/.test(JSON.stringify(f.history())), false)
})

for (const [name, change] of [
  ["account username", f => { f.user.user.username = "someone-else" }],
  ["project ID", f => { f.project.id = "wrong-project" }],
  ["project owner", f => { f.project.accountId = "wrong-team" }],
  ["project name", f => { f.project.name = "other" }],
  ["root directory", f => { f.project.rootDirectory = "." }],
  ["repository type", f => { f.project.link.type = "gitlab" }],
  ["repository owner", f => { f.project.link.org = "other" }],
  ["repository name", f => { f.project.link.repo = "other" }],
]) test(`wrong ${name} fails before private input reads and all writes`, async () => {
  const f = fixture(); change(f)
  await rejects(f.run(), "project")
  assert.equal(f.writes().length, 0); assert.equal(f.inputReads(), 0); assert.equal(f.journal(), null)
})

for (const [key, value, error] of [
  [MODE, "1", "runtime_not_off"], [MODE, "false", "runtime_not_off"],
  ["HK_SUI_NETWORK", "mainnet", "network"], ["HK_SUI_NETWORK", "testnet ", "network"],
  ...Object.keys(PRIOR).map(key => [key, "different-prior-tuple", "prior_tuple"]),
]) test(`unapproved ${key} value refuses before any journal or write`, async () => {
  const f = fixture(); f.values.set(f.find(key).id, value)
  await rejects(f.run(), error)
  assert.equal(f.writes().length, 0); assert.equal(f.inputReads(), 0); assert.equal(f.journal(), null)
})

for (const change of [
  row => { delete row.gitBranch }, row => { row.target = ["preview", "production"] },
  row => { row.customEnvironmentIds = ["custom"] }, row => { row.type = "sensitive" },
  row => { row.id = "../other" }, row => { row.createdAt = 0 }, row => { row.updatedAt = TIME - 1 },
]) test(`unsafe scoped flag metadata refuses all writes (${change.toString()})`, async () => {
  const f = fixture(); change(f.find(MODE))
  await rejects(f.run(), "scope")
  assert.equal(f.writes().length, 0); assert.equal(f.journal(), null)
})

for (const key of [MODE, "HK_SUI_NETWORK", "HK_SUI_PACKAGE_ID", "HK_SUI_AGENT_SECRET_KEY"]) {
  test(`global Preview shadow for ${key} cannot be adopted`, async () => {
    const f = fixture(); f.add(key, "shadow-value", { gitBranch: undefined })
    await assert.rejects(f.run(), /integration_inputs_(conflict|scope)/)
    assert.equal(f.writes().length, 0); assert.equal(f.journal(), null)
  })
}

test("late private-key conflict is checked before any earlier public input is written", async () => {
  const f = fixture(); f.add("HK_SUI_SPONSOR_SECRET_KEY", "preexisting-key")
  await rejects(f.run(), "existing_input")
  assert.equal(f.writes().length, 0); assert.equal(f.journal(), null)
})

for (const change of [
  f => { delete f.input.values.HK_SUI_AGENT_SECRET_KEY },
  f => { f.input.values.HK_UNAPPROVED_KEY = "not-allowed" },
  f => { f.input.values.HK_SUI_AGENT_SECRET_KEY = "" },
  f => { f.input.values.HK_SUI_PACKAGE_ID = "wrong-owned-package" },
  f => { f.input.values.HK_SUI_GRPC_URL = "https://unapproved.invalid" },
  f => { f.input.fingerprint = "not-a-fingerprint" },
]) test(`conflicting prepared inputs refuse all writes (${change.toString()})`, async () => {
  const f = fixture(); change(f)
  await rejects(f.run(), "inputs")
  assert.equal(f.writes().length, 0); assert.equal(f.journal(), null)
})

for (const writesBeforeDrift of [0, 1, 9, 10]) test(`runtime flag drift after ${writesBeforeDrift} writes prevents completion or any subsequent mutation`, async () => {
  const f = fixture(); let flagReads = 0
  f.readHook(row => { if (row.key === MODE && ++flagReads === writesBeforeDrift + 2) f.values.set(row.id, "1") })
  await rejects(f.run(), "runtime_not_off")
  assert.equal(f.writes().length, writesBeforeDrift)
  assert.equal(f.journal().complete, false)
  assert.equal(f.journal().entries.length, writesBeforeDrift)
})

for (const writesBeforeDrift of [0, 1]) {
  for (const [name, change, error] of [
    ["flag shadow", f => { f.add(MODE, "1", { gitBranch: undefined }) }, "conflict"],
    ["network shadow", f => { f.add("HK_SUI_NETWORK", "mainnet", { gitBranch: undefined }) }, "conflict"],
    ["remaining tuple shadow", f => { f.add("HK_SUI_PACKAGE_ID", "shadow", { gitBranch: undefined }) }, "conflict"],
    ["remaining tuple metadata", f => { f.find("HK_SUI_PACKAGE_ID").updatedAt++ }, "drift"],
    ["remaining tuple value", f => { f.values.set(f.find("HK_SUI_PACKAGE_ID").id, "unapproved-package") }, "drift"],
    ["flag metadata", f => { f.find(MODE).updatedAt++ }, "drift"],
    ["network metadata", f => { f.find("HK_SUI_NETWORK").updatedAt++ }, "drift"],
    ["network value", f => { f.values.set(f.find("HK_SUI_NETWORK").id, "mainnet") }, "network"],
    ["unplanned future private row", f => { f.add("HK_SUI_SPONSOR_SECRET_KEY", "conflicting-private") }, "drift"],
  ]) test(`fresh ${name} drift after ${writesBeforeDrift} writes stops before next mutation`, async () => {
    const f = fixture(); let changed = false
    f.listHook(() => {
      if (!changed && f.journal() && f.writes().length === writesBeforeDrift) { changed = true; change(f) }
    })
    await rejects(f.run(), error)
    assert.equal(changed, true); assert.equal(f.writes().length, writesBeforeDrift)
    assert.equal(f.journal().complete, false); assert.equal(f.journal().entries.length, writesBeforeDrift)
  })
}

for (const writesBeforeDrift of [1, 9, 10]) {
  for (const [field, value] of [["updatedAt", TIME + 999], ["id", "replaced_target_id"]]) {
    test(`completed row ${field} drift after ${writesBeforeDrift} writes cannot be silently adopted`, async () => {
      const f = fixture(); let changed = false
      f.listHook(() => {
        if (!changed && f.writes().length === writesBeforeDrift) {
          changed = true; f.find("HK_INTEGRATION_SUI_TARGET")[field] = value
        }
      })
      await rejects(f.run(), "drift")
      assert.equal(changed, true); assert.equal(f.writes().length, writesBeforeDrift)
      assert.equal(f.journal().complete, false)
      assert.equal(f.journal().entries[0].after.id, "fixture_6", "original completed receipt is retained")
    })
  }
}

test("final complete marker requires a fresh shadow-free runtime-OFF scope", async () => {
  const f = fixture(); let changed = false
  f.listHook(() => {
    if (!changed && f.writes().length === 10) { changed = true; f.add(MODE, "1", { gitBranch: undefined }) }
  })
  await rejects(f.run(), "conflict")
  assert.equal(f.writes().length, 10); assert.equal(f.journal().complete, false)
  assert.ok(f.journal().entries.every(entry => entry.after), "all actual write receipts remain recorded")
})

for (const unknown of ["before-response", "after-server-write"]) test(`unknown ${unknown} retains intent without success and can never retry`, async () => {
  const f = fixture()
  if (unknown === "before-response") f.mutationHook(() => { throw new Error("integration_inputs_request_outcome_unconfirmed") })
  else f.responseHook(() => { throw new Error("integration_inputs_request_outcome_unconfirmed") })
  await rejects(f.run(), "request_outcome_unconfirmed")
  assert.equal(f.writes().length, 1); assert.equal(f.journal().complete, false)
  assert.equal(f.journal().entries.length, 1)
  assert.ok(f.journal().entries[0].intentAt); assert.equal(f.journal().entries[0].after, undefined)
  await assert.rejects(f.run(), /integration_inputs_(journal|existing_input)/)
  assert.equal(f.writes().length, 1)
  for (const secret of SENTINELS) assert.equal(JSON.stringify(f.history()).includes(secret), false)
})

test("an exclusive existing journal blocks an otherwise unchanged reattempt", async () => {
  const f = fixture()
  f.io.begin({ complete: false, entries: [], previousAttempt: true })
  await rejects(f.run(), "journal")
  assert.equal(f.writes().length, 0); assert.equal(f.journal().previousAttempt, true)
})

for (const bad of [
  { created: [], failed: [] }, { created: [], failed: ["synthetic-sensitive-provider-response"] },
  { created: [{}, {}], failed: [] }, { created: {}, failed: {} },
]) test(`malformed create response stops after one journaled intent (${JSON.stringify(bad)})`, async () => {
  const f = fixture(); f.responseHook(() => bad)
  await assert.rejects(f.run(), /integration_inputs_(response|scope)/)
  assert.equal(f.writes().length, 1); assert.equal(f.journal().complete, false)
  assert.equal(f.journal().entries[0].after, undefined)
  assert.equal(JSON.stringify(f.history()).includes("synthetic-sensitive-provider-response"), false)
})

test("write response cannot broaden branch or target scope", async () => {
  for (const change of [row => { row.target = ["production"] }, row => { row.gitBranch = "deploy/sui-main-20260928" }]) {
    const f = fixture()
    f.responseHook((response, { method }) => { change(method === "POST" ? response.created : response); return response })
    await rejects(f.run(), "scope")
    assert.equal(f.writes().length, 1); assert.equal(f.journal().entries[0].after, undefined)
  }
})

test("malformed and unrelated private keys fail with one fixed safe error", () => {
  const samples = [
    null, {}, { credentialSeed: "PRIVATE_SEED_SENTINEL" },
    { credentialSeed: "b".repeat(64), issuer: "PRIVATE_KEY_SENTINEL", agent: "PRIVATE_KEY_SENTINEL" },
    { credentialSeed: "b".repeat(64), issuer: new Uint8Array(32).fill(1), agent: new Uint8Array(32).fill(2) },
  ]
  for (const secret of samples) {
    assert.throws(() => validatedOwnInputs(secret), error => {
      assert.equal(error.message, "integration_inputs_private_input")
      assert.doesNotMatch(String(error), /PRIVATE_(KEY|SEED)_SENTINEL|suiprivkey|0x[0-9a-f]{64}/)
      return true
    })
  }
})

test("private-file validation failure inside input loader prevents journal and all mutations", async () => {
  const f = fixture()
  f.io.inputs = () => validatedOwnInputs({ credentialSeed: "b".repeat(64), issuer: "PRIVATE_KEY_SENTINEL", agent: "PRIVATE_KEY_SENTINEL" })
  await rejects(f.run(), "private_input")
  assert.equal(f.writes().length, 0); assert.equal(f.journal(), null)
})
