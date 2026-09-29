import assert from "node:assert/strict"
import { test } from "node:test"
import { readFileSync } from "node:fs"
import { OMNIONE_STAGE } from "../../lib/hackathon/omnione-evidence"
import { OMNIONE_TARGETS, configuredOmnioneTarget, omnioneTarget, omnioneTargetSnapshot, storedOmnioneTarget, sameOmnioneTarget } from "../../lib/hackathon/omnione-targets"
import { assertOmnioneTargetStore, omnioneTargetBindings, assertOmnioneTargetMonotonic } from "../../lib/hackathon/omnione-target-integrity"
import { parseStoredJourney } from "../../lib/hackathon/store-integrity"
import type { Db, OperationRecord, OutboxRecord } from "../../lib/hackathon/store"
import { omnioneConfigurationReady, type HkConfig } from "../../lib/hackathon/config"

const legacy = omnioneTargetSnapshot(), current = omnioneTargetSnapshot("stage-20260930")
function ledger(): Db {
  return { version: 1, sessions: {}, operations: { op: { operationId: "op", chain: { outboxId: "obx" } } as OperationRecord },
    outbox: { obx: { operationId: "op", outboxId: "obx" } as OutboxRecord }, redemptions: {}, idempotency: {}, nonces: {} }
}
test("legacy absent snapshot stays legacy regardless of selected new deployment", () => {
  assert.deepEqual(storedOmnioneTarget(undefined), legacy)
  assert.equal(legacy.registry, OMNIONE_STAGE.registry)
  assert.notEqual(current.registry, legacy.registry)
  assert.equal(configuredOmnioneTarget({ targetId: current.targetId, chainId: current.chainId, registryAddress: current.registry }).targetId, current.targetId)
  assert.deepEqual(parseStoredJourney(JSON.stringify(ledger())), ledger())
})
test("catalog rejects environment-only targets, null/deformed snapshots and tuple drift", () => {
  for (const bad of [null, {}, { ...current, targetId: "unreviewed" }, { ...current, version: 2 }, { ...current, chainId: 1 },
    { ...current, registry: legacy.registry }, { ...current, recorder: legacy.recorder }, { ...current, privateKey: "must-not-store" }]) {
    assert.throws(() => storedOmnioneTarget(bad))
  }
  assert.throws(() => omnioneTarget("__proto__")); assert.throws(() => omnioneTarget("stage-unapproved"))
  assert.throws(() => configuredOmnioneTarget({ targetId: current.targetId, chainId: current.chainId, registryAddress: legacy.registry }))
  assert.throws(() => configuredOmnioneTarget({ chainId: current.chainId, registryAddress: current.registry }))
  assert.throws(() => configuredOmnioneTarget({ targetId: current.targetId, chainId: current.chainId, registryAddress: current.registry, recorderAddress: legacy.recorder }))
  assert.equal(Object.isFrozen(OMNIONE_TARGETS), true); assert.equal(Object.isFrozen(omnioneTarget(current.targetId)), true)
})
test("operation, chain and outbox bindings agree and cannot migrate in an ordinary write", () => {
  const db = ledger(), before = omnioneTargetBindings(db)
  db.operations.op.omnioneTarget = current; db.operations.op.chain!.target = current; db.outbox.obx.target = current
  assert.doesNotThrow(() => assertOmnioneTargetStore(db))
  assert.throws(() => assertOmnioneTargetMonotonic(before, db), /store|history/i)
  db.operations.op.omnioneTarget = legacy
  assert.throws(() => parseStoredJourney(JSON.stringify(db)), /history/i)
  db.operations.op.chain!.target = legacy; db.outbox.obx.target = legacy
  assert.doesNotThrow(() => assertOmnioneTargetMonotonic(before, db))
  assert.equal(sameOmnioneTarget(undefined, legacy), true)
  assert.equal(sameOmnioneTarget(current, legacy), false)
})
test("operation binding is immutable before an outbox exists; normal prune is preserved", () => {
  const db = ledger(); db.operations.op.chain = null; db.outbox = {}
  const before = omnioneTargetBindings(db)
  db.operations.op.omnioneTarget = current
  assert.throws(() => assertOmnioneTargetMonotonic(before, db))
  delete db.operations.op
  assert.doesNotThrow(() => assertOmnioneTargetMonotonic(before, db))
})
test("new catalog agrees with public operator deployment evidence without replacing old metadata", () => {
  const meta = JSON.parse(readFileSync(new URL("../../../chain/omnione/deploy-info.stage-20260930.json", import.meta.url), "utf8"))
  const target = omnioneTarget("stage-20260930")
  assert.equal(target.registry, meta.DemoEntitlementRegistry.address)
  assert.equal(target.recorder, meta.recorder)
  assert.equal(target.runtimeCodeHash, meta.DemoEntitlementRegistry.runtimeCodeHash)
  assert.equal(target.deployTx, meta.DemoEntitlementRegistry.deployTx)
  assert.equal(meta.effectiveGasPrice, "0x0")
})
test("public configuration readiness refuses mismatched target, RPC and isolation", () => {
  const c = { isolatedMock: false, cxPreview: false, omnione: { targetId: current.targetId, chainId: current.chainId,
    registryAddress: current.registry, recorderAddress: current.recorder, rpcUrl: "https://stage-chainapi.omnione.net/?token=offline-fixture", privateKey: "presence-only-not-a-key" } } as HkConfig
  assert.equal(omnioneConfigurationReady(c), true)
  for (const patch of [{ targetId: "unregistered" }, { registryAddress: legacy.registry }, { recorderAddress: legacy.recorder },
    { chainId: 1 }, { rpcUrl: "https://attacker.invalid/?token=offline-fixture" }, { privateKey: "" }]) {
    assert.equal(omnioneConfigurationReady({ ...c, omnione: { ...c.omnione, ...patch } }), false)
  }
  assert.equal(omnioneConfigurationReady({ ...c, isolatedMock: true }), false)
  assert.equal(omnioneConfigurationReady({ ...c, cxPreview: true }), false)
})
