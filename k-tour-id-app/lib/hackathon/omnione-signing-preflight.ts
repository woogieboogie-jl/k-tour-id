// Public-target and read-only authorization checks. Never imports a Wallet or key.
import { decodeOmnioneResult, evidenceFail, omnioneReadAbi, OMNIONE_STAGE, rpcQuantity, sameHex } from "./omnione-evidence"
import { approvedOmnioneRpc, type OmnioneRpcReader } from "./omnione-readonly"

export type OmnioneSigningTarget = { rpcUrl: string; chainId: number; registryAddress: string; recorderAddress?: string }

/** This lane is the existing approved stage registry, not an arbitrary EVM signer. */
export function checkedOmnioneSigningTarget(target: OmnioneSigningTarget) {
  if (target.rpcUrl !== target.rpcUrl.trim() || /[\x00-\x20\x7f]/.test(target.rpcUrl) || !approvedOmnioneRpc(target.rpcUrl)) evidenceFail("rpc_configuration_invalid")
  if (target.chainId !== OMNIONE_STAGE.chainId) evidenceFail("chain_configuration_mismatch")
  if (!sameHex(target.registryAddress, OMNIONE_STAGE.registry)) evidenceFail("registry_configuration_mismatch")
  const recorder = target.recorderAddress || OMNIONE_STAGE.recorder
  if (!sameHex(recorder, OMNIONE_STAGE.recorder)) evidenceFail("recorder_configuration_mismatch")
  return { ...target, recorderAddress: recorder }
}

/** Three bounded reads before transaction population/signing; no cached permission. */
export async function verifyOmnioneSigningAuthority(target: OmnioneSigningTarget, signerAddress: string, rpc: OmnioneRpcReader) {
  const checked = checkedOmnioneSigningTarget(target)
  if (!sameHex(signerAddress, checked.recorderAddress)) evidenceFail("signer_address_mismatch")
  if (rpcQuantity(await rpc.call("eth_chainId", [])) !== BigInt(checked.chainId)) evidenceFail("chain_id_mismatch")
  const code = await rpc.call("eth_getCode", [checked.registryAddress, "latest"])
  if (typeof code !== "string" || !/^0x(?:[0-9a-f]{2})+$/i.test(code) || /^0x0+$/i.test(code)) evidenceFail("registry_code_empty_or_invalid")
  const allowed = decodeOmnioneResult("recorders", await rpc.call("eth_call", [{
    to: checked.registryAddress, data: omnioneReadAbi.encodeFunctionData("recorders", [checked.recorderAddress]),
  }, "latest"]))
  if (allowed[0] !== true) evidenceFail("recorder_not_allowed")
}
