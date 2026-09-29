// Public, explicitly approved Testnet deployments only. No environment reads,
// provider imports, private keys or inferred target selection.
const common = {
  network: "testnet" as const,
  chainIdentifier: "69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD",
  rpcUrls: Object.freeze(["https://fullnode.testnet.sui.io", "https://fullnode.testnet.sui.io:443"]),
}

export const INTEGRATION_SUI_TARGETS = Object.freeze({
  // move/ondo_entitlement/deploy-info.testnet.json. No Harvey ownership change.
  "harvey-original": Object.freeze({ ...common, id: "harvey-original" as const,
    packageId: "0xc5d26326ffd5267bb5b54625c1e2b9c03f7cca4753232d0b042c62ee74fd975d",
    campaignId: "0xe3fce96c9c9e1086ff20dd7453e16ff2c52d3d3324e6e4e34446c7d0dc2ecf16",
    campaignInitialVersion: "349181955",
    issuerAddress: "0x8d88f750b8bb8f0e63e6617821e3d2a03fda22b9a7841215689da66c79664c45",
    agentAddress: "0xad9340861c08c87c388108f13bde6fd6e27d2604c39d0f6d201e00d6ee161a05",
    sponsorAddress: "0x8d88f750b8bb8f0e63e6617821e3d2a03fda22b9a7841215689da66c79664c45",
  }),
  // Own immutable package/Campaign: SUI_SELFHOSTED_E2E_2026-09-28.md;
  // roles also pinned by the independently verified hosted-Sui execution lane.
  "selfhosted-testnet": Object.freeze({ ...common, id: "selfhosted-testnet" as const,
    packageId: "0x7a28a5e59d87e385f2eb3047ca2bbe76301627343f8d88eeb0f03733d4f2389e",
    campaignId: "0xa273ccd96315ae187b16eb3192c822795bc2031e6f79405739daec4a52275afd",
    campaignInitialVersion: "349181963",
    issuerAddress: "0x900cd55f3d9de4541e306c6a3b1fe85cd4ddbf04319ee316ae21b6bb3ba95d76",
    agentAddress: "0x17ee59f56d182c010732daaf509a2b35b221bf7ec62e4a59c3b2ceca2c3bbce4",
    sponsorAddress: "0x900cd55f3d9de4541e306c6a3b1fe85cd4ddbf04319ee316ae21b6bb3ba95d76",
  }),
})
export type IntegrationSuiTargetId = keyof typeof INTEGRATION_SUI_TARGETS
export type IntegrationSuiTarget = typeof INTEGRATION_SUI_TARGETS[IntegrationSuiTargetId]

export function resolveIntegrationSuiTarget(id: unknown): IntegrationSuiTarget {
  if (id !== "harvey-original" && id !== "selfhosted-testnet") throw new Error("integration_sui_target_invalid")
  return INTEGRATION_SUI_TARGETS[id]
}

/** Canonical 32-byte Sui addresses only. Equality is not proof of key ownership. */
export function integrationSuiRolesMatch(target: IntegrationSuiTarget, roles: { issuer: string; agent: string; sponsor: string }): boolean {
  if (!Object.values(INTEGRATION_SUI_TARGETS).includes(target) || !roles || typeof roles !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(roles)) || Reflect.ownKeys(roles).length !== 3) return false
  return Object.entries({ issuer: target.issuerAddress, agent: target.agentAddress, sponsor: target.sponsorAddress })
    .every(([role, expected]) => {
      const descriptor = Object.getOwnPropertyDescriptor(roles, role)
      return !!descriptor && "value" in descriptor && typeof descriptor.value === "string" &&
        /^0x[0-9a-f]{64}$/i.test(descriptor.value) && descriptor.value.toLowerCase() === expected
    })
}
