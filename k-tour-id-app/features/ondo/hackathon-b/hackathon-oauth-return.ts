/** Local callback binding only. It is NOT JWT/proof verification; the server
 * and Sui validators still verify identity, nonce, proof and user signature. */
export function readOAuthReturn(fragment: string, search: string, expectedState: string | undefined):
  { status: "accepted"; token: string } | { status: "cancelled" | "invalid" } {
  const params = new URLSearchParams(fragment.replace(/^#/, ""))
  const query = new URLSearchParams(search)
  if (params.getAll("state").length > 1 || params.getAll("id_token").length > 1 || params.getAll("error").length > 1 || query.getAll("state").length > 1 || query.getAll("error").length > 1 || query.has("id_token") || (query.has("state") && query.get("state") !== params.get("state"))) return { status: "invalid" }
  if (params.get("error") || query.get("error")) return { status: "cancelled" }
  const state = params.get("state"), token = params.get("id_token")
  if (!expectedState || state !== expectedState || !token || token.length > 8192 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return { status: "invalid" }
  return { status: "accepted", token }
}
