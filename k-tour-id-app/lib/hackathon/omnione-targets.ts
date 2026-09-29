// Public, source-reviewed deployment catalog. Environment variables cannot add targets.
// Missing snapshots are historical v1 rows: ALWAYS legacy, never today's config.
import { evidenceFail, OMNIONE_STAGE, sameHex } from "./omnione-evidence"

export type OmnioneTargetSnapshot = Readonly<{ version: 1; targetId: string; chainId: number; registry: string; recorder: string }>
export type OmnioneTarget = OmnioneTargetSnapshot & Readonly<{ rpcOrigin: string; deployTx: string; deployBlock: string; runtimeCodeHash: string | null }>
export const OMNIONE_LEGACY_TARGET_ID = "stage-legacy-20260914"
export const OMNIONE_TARGETS: Readonly<Record<string, OmnioneTarget>> = Object.freeze({
  [OMNIONE_LEGACY_TARGET_ID]: Object.freeze({ version: 1, targetId: OMNIONE_LEGACY_TARGET_ID, ...OMNIONE_STAGE, runtimeCodeHash: null }),
  "stage-20260930": Object.freeze({
    version: 1, targetId: "stage-20260930", chainId: 201210, rpcOrigin: "https://stage-chainapi.omnione.net",
    registry: "0x07b35e14b1bf59be938fd72a6f9d9f9e04f0a687", recorder: "0x315694f531f7b25c4cec3660f9cd66eab9f2c39a",
    deployTx: "0x834982d407a7967328f88dd27d2ae03406e7994eb282aff429f7c011e12c8580", deployBlock: "0x1965f5a",
    runtimeCodeHash: "0x249fb5a53fc48841e3b03f9b82a30b9aeaf498239fbe554b77c5935ede1802bd",
  }),
})

export function omnioneTarget(targetId: string = OMNIONE_LEGACY_TARGET_ID): OmnioneTarget {
  if (!Object.hasOwn(OMNIONE_TARGETS, targetId)) evidenceFail("target_not_registered")
  return OMNIONE_TARGETS[targetId]
}
export function omnioneTargetSnapshot(targetId: string = OMNIONE_LEGACY_TARGET_ID): OmnioneTargetSnapshot {
  const t = omnioneTarget(targetId)
  return { version: 1, targetId: t.targetId, chainId: t.chainId, registry: t.registry, recorder: t.recorder }
}
export function storedOmnioneTarget(value: unknown): OmnioneTargetSnapshot {
  if (value === undefined) return omnioneTargetSnapshot()
  if (!value || typeof value !== "object" || Array.isArray(value)) evidenceFail("target_snapshot_invalid")
  const t = value as Record<string, unknown>
  if (Object.keys(t).length !== 5 || Object.keys(t).some(k => !["version", "targetId", "chainId", "registry", "recorder"].includes(k)) ||
    t.version !== 1 || typeof t.targetId !== "string") evidenceFail("target_snapshot_invalid")
  const approved = omnioneTarget(t.targetId as string)
  if (t.chainId !== approved.chainId || !sameHex(t.registry, approved.registry) || !sameHex(t.recorder, approved.recorder)) evidenceFail("target_snapshot_mismatch")
  return omnioneTargetSnapshot(approved.targetId)
}
export const sameOmnioneTarget = (a: unknown, b: unknown) => storedOmnioneTarget(a).targetId === storedOmnioneTarget(b).targetId

/** Creation may remain unconfigured; this chooses a binding, never enables I/O. */
export function configuredOmnioneTarget(c: { targetId?: string; chainId: number; registryAddress: string; recorderAddress?: string }, allowUnconfigured = false) {
  const target = omnioneTargetSnapshot(c.targetId || OMNIONE_LEGACY_TARGET_ID)
  if (c.chainId !== target.chainId) evidenceFail("chain_configuration_mismatch")
  if (!(allowUnconfigured && !c.registryAddress) && !sameHex(c.registryAddress, target.registry)) evidenceFail("registry_configuration_mismatch")
  if (c.recorderAddress && !sameHex(c.recorderAddress, target.recorder)) evidenceFail("recorder_configuration_mismatch")
  return target
}
