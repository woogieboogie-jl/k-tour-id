// Public-target and read-only authorization checks. Never imports a Wallet or key.
import { decodeOmnioneResult, evidenceFail, omnioneReadAbi, rpcQuantity, sameHex } from "./omnione-evidence"
import { keccak256 } from "ethers"
import { configuredOmnioneTarget, omnioneTarget } from "./omnione-targets"
import { approvedOmnioneRpc, type OmnioneRpcReader } from "./omnione-readonly"

export type OmnioneSigningTarget = { rpcUrl: string; chainId: number; registryAddress: string; recorderAddress?: string; targetId?: string }

/** Only reviewed deployment catalog entries, never arbitrary EVM addresses. */
export function checkedOmnioneSigningTarget(target: OmnioneSigningTarget) {
  if (target.rpcUrl !== target.rpcUrl.trim() || /[\x00-\x20\x7f]/.test(target.rpcUrl) || !approvedOmnioneRpc(target.rpcUrl)) evidenceFail("rpc_configuration_invalid")
  const approved = configuredOmnioneTarget(target)
  return { ...target, targetId: approved.targetId, recorderAddress: approved.recorder }
}

/** Three bounded reads before transaction population/signing; no cached permission. */
export async function verifyOmnioneSigningAuthority(target: OmnioneSigningTarget, signerAddress: string, rpc: OmnioneRpcReader) {
  const checked = checkedOmnioneSigningTarget(target)
  if (!sameHex(signerAddress, checked.recorderAddress)) evidenceFail("signer_address_mismatch")
  if (rpcQuantity(await rpc.call("eth_chainId", [])) !== BigInt(checked.chainId)) evidenceFail("chain_id_mismatch")
  const code = await rpc.call("eth_getCode", [checked.registryAddress, "latest"])
  if (typeof code !== "string" || !/^0x(?:[0-9a-f]{2})+$/i.test(code) || /^0x0+$/i.test(code)) evidenceFail("registry_code_empty_or_invalid")
  const codeHash = omnioneTarget(checked.targetId).runtimeCodeHash
  if (codeHash && !sameHex(keccak256(code as string), codeHash)) evidenceFail("registry_code_mismatch")
  const allowed = decodeOmnioneResult("recorders", await rpc.call("eth_call", [{
    to: checked.registryAddress, data: omnioneReadAbi.encodeFunctionData("recorders", [checked.recorderAddress]),
  }, "latest"]))
  if (allowed[0] !== true) evidenceFail("recorder_not_allowed")
}
