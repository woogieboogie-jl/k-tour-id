import assert from "node:assert/strict"
import { test } from "node:test"
import { readOAuthReturn } from "../../features/ondo/hackathon-b/hackathon-oauth-return"

test("OAuth return requires the pending login's unpredictable state", () => {
  assert.deepEqual(readOAuthReturn("#state=wrong&id_token=a.b.c", "", "expected"), { status: "invalid" })
  assert.deepEqual(readOAuthReturn("#state=op_known&id_token=a.b.c", "", undefined), { status: "invalid" })
  assert.deepEqual(readOAuthReturn("#state=expected&id_token=a.b.c", "", "expected"), { status: "accepted", token: "a.b.c" })
})
test("OAuth rejection and missing/malformed token never become an accepted login", () => {
  assert.deepEqual(readOAuthReturn("#error=access_denied", "", "expected"), { status: "cancelled" })
  assert.deepEqual(readOAuthReturn("", "?error=access_denied", "expected"), { status: "cancelled" })
  assert.deepEqual(readOAuthReturn("#state=expected", "", "expected"), { status: "invalid" })
  assert.deepEqual(readOAuthReturn("#state=expected&id_token=not-a-token", "", "expected"), { status: "invalid" })
})
