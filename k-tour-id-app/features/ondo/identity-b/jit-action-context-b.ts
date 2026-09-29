import { jitContext } from "./jit-identity-client-b"
import { hashBActionReturnTo, hasRequiredPrivateContextForBAction, privateContextForBAction, type BActionReturnTo } from "./action-gate-contract-b"

export async function jitContextForAction(action: BActionReturnTo) {
  const snapshot = hashBActionReturnTo(action)
  if (!snapshot || !hasRequiredPrivateContextForBAction(action)) return null
  const privateContext = privateContextForBAction(action)
  if (action.cta !== "SUBMIT_LOCAL_SIGNAL" && action.cta !== "JOIN_TABLE") return null
  return jitContext({ action: action.cta === "SUBMIT_LOCAL_SIGNAL" ? "local_moment" : "table_request", purpose: action.gatePlan.includes("age") ? "age19" : "person", venueId: action.venueId, tableId: action.cta === "JOIN_TABLE" ? action.tableId : null }, JSON.stringify({ tokenId: action.tokenId, snapshot, privateContext }))
}
