import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { Transaction } from "@mysten/sui/transactions"
import { INTEGRATION_SUI_TARGETS } from "../../lib/hackathon/integration-sui-targets"
import { INTEGRATION_SUI_LIMITS as LIMIT, requiresIntegrationSuiLimits, integrationSuiPreflightIssues, assertIntegrationSuiLimits,
  assertIntegrationSuiRoles, assertIntegrationSuiActivation, integrationSuiBudgetTemplate, assertIntegrationSuiBudget,
  assertIntegrationSuiOperation, claimIntegrationSuiOperation, assertIntegrationSuiBudgetMonotonic } from "../../lib/hackathon/integration-sui-limits"
import { parseStoredJourney } from "../../lib/hackathon/store-integrity"
import { safeHkError } from "../../lib/hackathon/public-error"
import { HkError } from "../../lib/hackathon/util"
import type { OperationRecord } from "../../lib/hackathon/store"

const target = INTEGRATION_SUI_TARGETS["selfhosted-testnet"], NOW = Date.parse("2026-09-29T00:00:00Z")
const originalEnv = { ...process.env }, originalFetch = globalThis.fetch
let network = 0
before(() => { globalThis.fetch = async () => { network++; throw new Error("network_forbidden") } })
after(() => { globalThis.fetch = originalFetch; assert.equal(network, 0); for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, originalEnv) })
const fixture = (): Record<string, string | undefined> => ({
  HK_INTEGRATION_SUI_TARGET: target.id, NEXT_PUBLIC_HK_INTEGRATION_PREVIEW: "1", HK_INTEGRATION_PREVIEW_ENABLED: "1",
  NEXT_PUBLIC_HK_HOSTED_SUI: "0", HK_HOSTED_SUI_ENABLED: "0", NEXT_PUBLIC_HK_CX_PREVIEW: "0", NEXT_PUBLIC_HK_PREVIEW_READ_ONLY: "0",
  HK_ISOLATED_MOCK: "0", HK_MODE_CX: "cx", HK_MODE_OPENDID: "opendid", HK_INTEGRATION_PREVIEW_EXPIRES_AT: LIMIT.maxExpiresAt,
  HK_SUI_NETWORK: target.network, HK_SUI_GRPC_URL: target.rpcUrls[1], HK_SUI_CHAIN_IDENTIFIER: target.chainIdentifier,
  HK_SUI_PACKAGE_ID: target.packageId, HK_SUI_CAMPAIGN_ID: target.campaignId, HK_SUI_CAMPAIGN_INITIAL_VERSION: target.campaignInitialVersion,
  HK_SUI_ISSUER_SECRET_KEY: "sui_fixture_" + "a".repeat(64), HK_SUI_AGENT_SECRET_KEY: "sui_fixture_" + "b".repeat(64), HK_STORE_KEY: LIMIT.storeKey,
})
const migration = () => ({ priorHostedOperationIds: ["op_priorhosted0001", "op_priorhosted0002"], hostedLedgerSha256: "0x" + "c".repeat(64), hostedWritesDisabledAt: "2026-09-28T23:00:00Z" })
const budgetDb = () => ({ integrationSuiBudget: integrationSuiBudgetTemplate(migration()), operations: {} as Record<string, unknown> })
const isCode = (code: string) => (e: unknown) => e instanceof HkError && e.code === code
function configure(env: Record<string, string | undefined>) { for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, { NODE_ENV: "test", ...env }) }

test("integration guards cannot be removed through runtime flags, profile overlap or target inference", () => {
  assert.equal(requiresIntegrationSuiLimits({}), false)
  for (const env of [{ NEXT_PUBLIC_HK_INTEGRATION_PREVIEW: "1" }, { HK_INTEGRATION_PREVIEW_ENABLED: "1" }, { VERCEL_GIT_COMMIT_REF: LIMIT.branch, HK_INTEGRATION_PREVIEW_ENABLED: "0", NEXT_PUBLIC_HK_INTEGRATION_PREVIEW: "0" }]) assert.equal(requiresIntegrationSuiLimits(env), true)
  assert.deepEqual(integrationSuiPreflightIssues(fixture(), NOW), [])
  for (const value of [undefined, "", "harvey-original", "selfhosted-testnet ", "arbitrary"]) assert.ok(integrationSuiPreflightIssues({ ...fixture(), HK_INTEGRATION_SUI_TARGET: value }, NOW).includes("sui_target"))
  assert.throws(() => assertIntegrationSuiLimits({}, NOW), isCode("integration_sui_scope"))
})

test("exact approved chain tuple, keys, namespace, expiry and unchanged provider modes are required", () => {
  const patches = [
    { HK_SUI_NETWORK: "mainnet" }, { HK_SUI_GRPC_URL: "https://arbitrary.invalid" }, { HK_SUI_CHAIN_IDENTIFIER: "wrong" },
    { HK_SUI_PACKAGE_ID: INTEGRATION_SUI_TARGETS["harvey-original"].packageId }, { HK_SUI_CAMPAIGN_ID: "0x2" }, { HK_SUI_CAMPAIGN_INITIAL_VERSION: "349181955" },
    { HK_SUI_GRAPHQL_URL: "https://private.invalid/?token=SECRET" }, { HK_SUI_EXPLORER: "https://suiscan.xyz/mainnet" },
    { HK_SUI_ISSUER_SECRET_KEY: "" }, { HK_SUI_AGENT_SECRET_KEY: "" }, { HK_SUI_SPONSOR_SECRET_KEY: "bad" },
    { HK_STORE_KEY: "ktour:integration-preview:new-budget" }, { HK_STORE_CANARY_UUID: "fixture" },
    { HK_MODE_OPENDID: "mock" }, { HK_MODE_CX: "mock" }, { HK_ISOLATED_MOCK: "1" }, { HK_CX_SAMPLE_FALLBACK: "1" },
    { NEXT_PUBLIC_HK_HOSTED_SUI: "1" }, { HK_HOSTED_SUI_ENABLED: "1" }, { NEXT_PUBLIC_HK_CX_PREVIEW: "1" },
    { HK_INTEGRATION_SUI_MAX_OPERATIONS: "11" }, { HK_INTEGRATION_SUI_GAS_BUDGET_MIST: "10000001" },
    { HK_INTEGRATION_PREVIEW_EXPIRES_AT: "2099-01-01T00:00:00Z" }, { HK_INTEGRATION_PREVIEW_EXPIRES_AT: "2026-09-29" },
  ]
  for (const patch of patches) {
    const issues = integrationSuiPreflightIssues({ ...fixture(), ...patch }, NOW)
    assert.ok(issues.length); assert.equal(JSON.stringify(issues).includes("SECRET"), false)
  }
  for (const now of [NaN, Infinity, LIMIT.maxEnd]) assert.ok(integrationSuiPreflightIssues(fixture(), now).includes("expiry"))
  assert.equal(assertIntegrationSuiLimits({ ...fixture(), HK_SUI_GRPC_URL: target.rpcUrls[0] }, NOW), target)
})

test("derived public role addresses must match owned issuer, agent and sponsor", () => {
  const roles = { issuer: target.issuerAddress, agent: target.agentAddress, sponsor: target.sponsorAddress }
  assert.doesNotThrow(() => assertIntegrationSuiRoles(roles))
  for (const key of ["issuer", "agent", "sponsor"]) assert.throws(() => assertIntegrationSuiRoles({ ...roles, [key]: "0x" + "0".repeat(64) }), isCode("integration_sui_scope"))
  assert.throws(() => assertIntegrationSuiRoles({ ...roles, agent: roles.issuer }), isCode("integration_sui_scope"))
})

test("prior hosted consumption reduces the SAME ten-operation ceiling; cancelled/pruned IDs remain charged", () => {
  const db = budgetDb()
  for (let i = 0; i < 8; i++) { const id = `op_newintegration${i}`; claimIntegrationSuiOperation(db, id); db.operations[id] = { status: "cancelled" } }
  assert.equal(db.integrationSuiBudget.operationIds.length + db.integrationSuiBudget.priorHostedOperationIds.length, LIMIT.maxOperations)
  assert.equal(LIMIT.maxTotalGasMIST, 10 * 3 * LIMIT.gasBudgetMIST)
  const before = JSON.stringify(db.integrationSuiBudget)
  db.operations = {} // Simulates pruning, not budget reset.
  assertIntegrationSuiBudget(db)
  assert.throws(() => claimIntegrationSuiOperation(db, "op_newintegration9"), isCode("integration_sui_limit"))
  assert.equal(JSON.stringify(db.integrationSuiBudget), before)
  assertIntegrationSuiOperation(db, "op_newintegration0")
  assert.throws(() => assertIntegrationSuiOperation(db, "op_unbudgeted0000"), isCode("integration_sui_budget"))
})

test("missing/corrupt budgets and zero/invented-history templates do not silently initialize", () => {
  for (const b of [undefined, null, {}, { ...budgetDb().integrationSuiBudget, priorHostedOperationIds: [] },
    { ...budgetDb().integrationSuiBudget, hostedLedgerSha256: "unknown" }, { ...budgetDb().integrationSuiBudget, maxOperations: 11 },
    { ...budgetDb().integrationSuiBudget, hostedWritesDisabledAt: "not-a-time" }, { ...budgetDb().integrationSuiBudget, targetId: "harvey-original" },
    { ...budgetDb().integrationSuiBudget, operationIds: ["op_priorhosted0001"] },
  ]) assert.throws(() => assertIntegrationSuiBudget({ integrationSuiBudget: b, operations: {} }), isCode("integration_sui_budget"))
  assert.throws(() => integrationSuiBudgetTemplate({ ...migration(), priorHostedOperationIds: [] }), isCode("integration_sui_budget"))
  assert.throws(() => assertIntegrationSuiBudget({ ...budgetDb(), operations: { op_unbudgeted0000: {} } }), isCode("integration_sui_budget"))
})

test("budget history/baseline are immutable and store parser rejects changed accounting", () => {
  const db = budgetDb(); claimIntegrationSuiOperation(db, "op_integration0001")
  const before = structuredClone(db.integrationSuiBudget)
  claimIntegrationSuiOperation(db, "op_integration0002"); assertIntegrationSuiBudgetMonotonic(before, db)
  for (const patch of [ { operationIds: [] }, { priorHostedOperationIds: ["op_priorhosted0001"] }, { hostedLedgerSha256: "0x" + "d".repeat(64) }, { hostedWritesDisabledAt: "2026-09-29T00:00:00Z" } ]) {
    assert.throws(() => assertIntegrationSuiBudgetMonotonic(before, { ...db, integrationSuiBudget: { ...db.integrationSuiBudget, ...patch } }), isCode("integration_sui_budget"))
  }
  const stored = { version: 1, sessions: {}, operations: {}, redemptions: {}, outbox: {}, idempotency: {}, nonces: {}, integrationSuiBudget: db.integrationSuiBudget }
  assert.deepEqual(parseStoredJourney(JSON.stringify(stored)), stored)
  assert.throws(() => parseStoredJourney(JSON.stringify({ ...stored, integrationSuiBudget: {} })), isCode("store_corrupt"))
})

test("BCS gas ceiling is enforced even if runtime enable flags are removed from protected branch", async () => {
  configure({ VERCEL_GIT_COMMIT_REF: LIMIT.branch, NEXT_PUBLIC_HK_INTEGRATION_PREVIEW: "0", HK_INTEGRATION_PREVIEW_ENABLED: "0" })
  const { assertSerializedGasBudget } = await import("../../lib/hackathon/adapters/sui")
  const tx = new Transaction(); tx.setSender("0x1"); tx.setGasOwner(target.sponsorAddress); tx.setGasBudget(LIMIT.gasBudgetMIST); tx.setGasPrice(1000)
  tx.setGasPayment([{ objectId: "0x3", version: "1", digest: "11111111111111111111111111111111" }])
  const bytes = await tx.build(); assert.doesNotThrow(() => assertSerializedGasBudget(bytes))
  for (const override of [1, LIMIT.gasBudgetMIST + 1, NaN, Infinity]) assert.throws(() => assertSerializedGasBudget(bytes, override), isCode("sui_gas_budget"))
  tx.setGasBudget(LIMIT.gasBudgetMIST + 1)
  const tooLarge = await tx.build()
  assert.throws(() => assertSerializedGasBudget(tooLarge), isCode("sui_gas_budget"))
})

test("preparation fence has no env override and Sui side effects stop before key, file or network work", async () => {
  configure({ ...fixture(), HK_INTEGRATION_SUI_MIGRATION_COMPLETE: "1", HK_INTEGRATION_SUI_BUDGET_INITIALIZED: "1", HK_DATA_DIR: "/must-not-create-integration-fixture" })
  const config = await import("../../lib/hackathon/config"), adapter = await import("../../lib/hackathon/adapters/sui"), service = await import("../../lib/hackathon/service")
  assert.throws(assertIntegrationSuiActivation, isCode("integration_sui_migration_required"))
  for (const name of ["Sui signing", "Sui delegation", "Sui agent execution"]) assert.throws(() => config.assertExternalServicesEnabled(name), isCode("integration_sui_migration_required"))
  for (const name of ["Sui", "Sui grant lookup", "OmniOne Chain", "zkLogin provider authentication", "OpenDID provider"]) assert.doesNotThrow(() => config.assertExternalServicesEnabled(name))
  assert.throws(adapter.suiKeys, isCode("integration_sui_migration_required"))
  assert.doesNotThrow(adapter.suiTargets)
  await assert.rejects(adapter.executeDelegation({ txBytesB64: "not-parsed", userSignature: "not-read", sponsorSignature: "not-read", expected: {} as never }), isCode("integration_sui_migration_required"))
  await assert.rejects(service.createOperation({ sessionId: "session", venueId: "venue", consentVersion: "version", locale: "en", venueName: "fixture" }), isCode("integration_sui_migration_required"))
  const publicConfig = config.hkPublicConfig()
  assert.equal(publicConfig.modes.opendid, "opendid"); assert.equal(publicConfig.modes.cx, "cx")
  assert.equal(publicConfig.capabilities.chainExecutionEnabled, false); assert.equal(publicConfig.capabilities.redemptionEnabled, false)
  const failed = service.toResult({ phase: "agent", status: "pending", agent: { status: "failed", error: null }, secrets: {}, audit: [], sessionId: "fixture" } as unknown as OperationRecord)
  assert.equal(failed.allowedActions.includes("run_agent"), false); assert.equal(failed.allowedActions.includes("return"), true); assert.equal(failed.safeNextAction, "return")
  const output = safeHkError(new HkError("integration_sui_migration_required", "PRIVATE_provider_text", 503))
  assert.equal(output.error.code, "integration_sui_migration_required"); assert.equal(JSON.stringify(output).includes("PRIVATE"), false)
})
