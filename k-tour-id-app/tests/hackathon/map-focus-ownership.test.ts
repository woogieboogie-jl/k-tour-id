import assert from "node:assert/strict"
import test from "node:test"
import { retryFocusForUnchangedOwner } from "../../features/ondo/map/map-focus-ownership-b"

function fixture() {
  let owner: object | null = {}
  let callback = () => {}
  let focused = 0
  const cancelled: number[] = []
  const stop = retryFocusForUnchangedOwner(() => { focused++ }, {
    active: () => owner,
    schedule: next => { callback = next; return 7 },
    cancel: frame => { cancelled.push(frame) },
  })
  return { stop, run: () => callback(), newOwner: (next: object | null) => { owner = next }, focused: () => focused, cancelled }
}

test("city one-frame retry preserves accessibility focus when its owner is unchanged", () => {
  const f = fixture(); f.run(); assert.equal(f.focused(), 1)
})
test("city one-frame retry never replaces a new search or navigation focus owner", () => {
  const f = fixture(); f.newOwner({}); f.run(); assert.equal(f.focused(), 0)
})
test("city cleanup cancels its frame and also rejects a late callback after cancellation", () => {
  const f = fixture(); f.stop(); f.run(); assert.deepEqual(f.cancelled, [7]); assert.equal(f.focused(), 0)
})
test("removed original focus does not authorize a stale city refocus", () => {
  const f = fixture(); f.newOwner(null); f.run(); assert.equal(f.focused(), 0)
})
