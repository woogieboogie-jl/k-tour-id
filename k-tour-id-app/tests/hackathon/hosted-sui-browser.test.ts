import assert from "node:assert/strict"
import { after, before, test } from "node:test"

// Native .mjs operator helpers; unit runner never opens auth files or browsers.
import { PIN, LIMITS, originOf, validateCode, verifyDeployment, metadataApi, createRequestGuard, readonlyClient, verifyReceipts, receiptCommitment, run } from "../../scripts/hackathon-hosted-sui-browser.mjs"
const originalFetch = globalThis.fetch
let network = 0
before(() => { globalThis.fetch = async () => { network++; throw new Error("unexpected_network") } })
after(() => { globalThis.fetch = originalFetch; assert.equal(network, 0) })
const sha = "a".repeat(40), host = "ondo-approved-immutable.vercel.app", origin = `https://${host}`, id = "dpl_approvedFixture"
const safe = (code: string) => (e: unknown) => e instanceof Error && e.message === code
function data(target: "preview" | "production" = "preview") {
  return {
    user: { user: { username: String(PIN.username) } },
    project: { id: String(PIN.project), accountId: String(PIN.team), name: "ondo", rootDirectory: "k-tour-id-app", link: { type: "github", org: String(PIN.owner), repo: String(PIN.repo) }, targets: { production: { id } } },
    deployment: { id, url: host, projectId: String(PIN.project), ownerId: String(PIN.team), readyState: "READY", regions: ["icn1"], target, meta: { githubCommitSha: sha, githubCommitRef: String(PIN.branch), githubCommitOrg: String(PIN.owner), githubCommitRepo: String(PIN.repo) } },
    alias: { alias: PIN.host, projectId: PIN.project, deployment: { id } },
  }
}
function apiFor(f: ReturnType<typeof data>, calls: string[]) {
  return async (path: string) => { calls.push(path); if (path === "/v2/user") return f.user; if (path.startsWith("/v9/projects/")) return f.project; if (path.startsWith("/v13/deployments/")) return f.deployment; if (path.startsWith("/v4/aliases/")) return f.alias; throw new Error("unexpected_path") }
}

test("input and failed run reject before auth/browser/network; reports never contain access values", async () => {
  for (const value of ["http://ktour-id.vercel.app", "https://other.invalid", "https://user:secret@ktour-id.vercel.app", "https://ktour-id.vercel.app/path", "https://ktour-id.vercel.app?secret=x", "https://ktour-id.vercel.app:444"]) assert.throws(() => originOf(value))
  for (const value of [undefined, "short", "a".repeat(129), "secret value", "a".repeat(32) + "\n"]) assert.throws(() => validateCode(value), safe("invalid_access_code"))
  assert.equal(originOf(origin), origin)
  const accessCode = "secret_fixture_access_code_never_output_12345"
  const report = await run({ origin, accessCode, expectedRevision: "not-a-sha" })
  assert.equal(report.ok, false); assert.equal(report.checkpoint, "input"); assert.equal(report.errorCode, "expected_revision_required")
  assert.equal(JSON.stringify(report).includes(accessCode), false); assert.equal(network, 0)
})

test("immutable preview is bound to account/project/owner/repo/exact SHA and URL in three reads", async () => {
  const calls: string[] = [], result = await verifyDeployment({ origin, expectedRevision: sha, deploymentId: id }, apiFor(data(), calls))
  assert.equal(result.id, id); assert.equal(result.sha, sha); assert.equal(result.origin, origin); assert.equal(result.target, "preview")
  assert.deepEqual(calls, ["/v2/user", `/v9/projects/${PIN.project}`, `/v13/deployments/${id}`])
})

test("public origin additionally requires exact production alias binding", async () => {
  const calls: string[] = [], f = data("production")
  assert.equal((await verifyDeployment({ origin: `https://${PIN.host}`, expectedRevision: sha }, apiFor(f, calls))).target, "production")
  assert.equal(calls.length, 4); assert.equal(calls[3], `/v4/aliases/${PIN.host}`)
  f.alias.deployment.id = "dpl_foreign"
  await assert.rejects(verifyDeployment({ origin: `https://${PIN.host}`, expectedRevision: sha }, apiFor(f, [])), safe("deployment_alias_mismatch"))
})

test("wrong metadata or revision is rejected without visiting a browser target", async () => {
  const changes: Array<(f: ReturnType<typeof data>) => void> = [
    f => { f.user.user.username = "foreign" }, f => { f.project.accountId = "foreign" }, f => { f.project.link.org = "foreign" },
    f => { f.deployment.ownerId = "foreign" }, f => { f.deployment.projectId = "foreign" }, f => { f.deployment.meta.githubCommitSha = "b".repeat(40) },
    f => { f.deployment.meta.githubCommitRef = "main" }, f => { f.deployment.url = "foreign.vercel.app" }, f => { f.deployment.readyState = "ERROR" },
    f => { f.deployment.regions = ["iad1"] }, f => { f.deployment.meta.githubCommitRepo = "foreign" },
  ]
  for (const change of changes) { const f = data(); change(f); await assert.rejects(verifyDeployment({ origin, expectedRevision: sha }, apiFor(f, []))) }
  let calls = 0
  await assert.rejects(verifyDeployment({ origin, expectedRevision: undefined }, async () => { calls++ }), safe("expected_revision_required")); assert.equal(calls, 0)
})

test("metadata transport is GET-only pinned bounded and cannot return body secrets on errors", async () => {
  const calls: string[] = [], api = metadataApi("synthetic_auth", new AbortController().signal, async (input, init) => {
    const url = String(input)
    assert.equal(new URL(url).origin, "https://api.vercel.com"); assert.equal(init?.method, "GET"); assert.equal(init?.redirect, "error")
    assert.equal(new URL(url).searchParams.get("teamId"), PIN.team); calls.push(url); return Response.json({ ok: true })
  })
  for (let i = 0; i < 4; i++) assert.deepEqual(await api("/v2/user"), { ok: true })
  await assert.rejects(api("/v2/user"), safe("metadata_read_scope")); assert.equal(calls.length, 4)
  const forbidden = metadataApi("synthetic_auth", new AbortController().signal, async () => { throw new Error("should_not_fetch") })
  await assert.rejects(forbidden("/v10/projects/foreign/env"), safe("metadata_read_scope"))
  const oversized = metadataApi("synthetic_auth", new AbortController().signal, async () => new Response("secret_fixture", { headers: { "content-length": String(LIMITS.metadataBytes + 1) } }))
  await assert.rejects(oversized("/v2/user"), safe("metadata_unavailable"))
})

test("ordered one-shot mutation guard counts before response and forbids replay/redeem/verbs", () => {
  const g = createRequestGuard(origin), op = "op_abcdefgh12345678", prefix = "/api/hackathon/v1/"
  for (const action of ["hosted/access", "sessions", "operations"]) assert.equal(g.check("POST", origin + prefix + action), true)
  g.bindOperation(op)
  for (const action of ["identity/start", "identity/complete", "credential/issue", "credential/holder-ack", "presentation/request", "presentation/submit", "proposal", "delegation/prepare", "delegation/submit", "agent/run"]) assert.equal(g.check("POST", `${origin}${prefix}operations/${op}/${action}`), true)
  assert.equal(g.summary().complete, true); assert.equal(Object.keys(g.summary().mutations).length, 13)
  assert.equal(g.check("POST", `${origin}${prefix}operations/${op}/agent/run`), false); assert.equal(g.summary().mutations["agent/run"], 1)
  for (const [method, path] of [["PUT", "hosted/access"], ["PATCH", "hosted/access"], ["DELETE", "hosted/access"], ["POST", "operations/op_abcdefgh12345678/redeem"], ["POST", "zklogin/prove"], ["POST", "hosted/access?x=1"]]) assert.equal(createRequestGuard(origin).check(method, origin + prefix + path), false)
})

test("out-of-order and foreign-operation mutation stop all later writes; external assets are blocked without counting writes", () => {
  const g = createRequestGuard(origin)
  assert.equal(g.check("GET", "https://tiles.invalid/public"), false); assert.equal(g.summary().blocked, false)
  assert.equal(g.check("POST", origin + "/api/hackathon/v1/sessions"), false)
  assert.equal(g.check("POST", origin + "/api/hackathon/v1/hosted/access"), false)
  const h = createRequestGuard(origin)
  for (const p of ["hosted/access", "sessions", "operations"]) assert.equal(h.check("POST", origin + "/api/hackathon/v1/" + p), true)
  h.bindOperation("op_abcdefgh12345678")
  assert.equal(h.check("POST", origin + "/api/hackathon/v1/operations/op_foreign12345678/identity/start"), false)
  assert.throws(() => h.bindOperation("op_foreign12345678"), safe("operation_mismatch"))
})

test("read-only Sui transport blocks transaction execution before its injected network", async () => {
  let calls = 0; const stats = { reads: 0, bytes: 0 }, client = readonlyClient(new AbortController().signal, stats, async () => { calls++; throw new Error("unexpected_network") })
  await assert.rejects(async () => client.transactionExecutionService.executeTransaction({ signatures: [] }).response)
  assert.equal(calls, 0); assert.equal(stats.reads, 0)
})

test("receipt audit rejects partial/mismatched public evidence before chain reads", async () => {
  let reads = 0
  const client = { ledgerService: { getServiceInfo() { reads++; throw new Error("unexpected_read") } } }
  const holder = "0x" + "3".repeat(64), digests = ["Ebkkj9PvNfmWG3yi3wJP7kEezzZbbwAUMizqNXeguYWn", "Ha24iPjTYdmkJdJ5KAFMMvUonAJuuBP61orQpQbisUMc", "3PfGw4ffKwb13VG5EGwNDSZqMY5vg6RPRx6T7oajttKq"]
  const op = { operationId: "op_abcdefgh12345678", delegation: { userAddress: holder, entitlement: { txDigest: digests[0] }, userTxDigest: digests[1] }, agent: { txDigest: digests[2] } }
  await assert.rejects(verifyReceipts(client, op, { operationId: "op_other1234567890" }))
  await assert.rejects(verifyReceipts(client, { ...op, agent: { txDigest: digests[1] } }, {}), safe("three_receipts_required"))
  assert.equal(reads, 0)
})

test("receipt commitments normalize actual gRPC base64, byte arrays and canonical hex without relaxing byte length", () => {
  const bytes = Buffer.from(Array.from({ length: 32 }, (_, i) => i * 7)), expected = "0x" + bytes.toString("hex")
  for (const input of [bytes.toString("base64"), [...bytes], expected, "0x" + bytes.toString("hex").toUpperCase()]) assert.equal(receiptCommitment(input), expected)
  for (const input of [bytes.toString("base64").replace(/=$/, ""), bytes.toString("base64url"), Buffer.alloc(31).toString("base64"), [...bytes, 1], Array(32).fill(256), "fixture-secret", null]) assert.throws(() => receiptCommitment(input), safe("receipt_commitment"))
})
