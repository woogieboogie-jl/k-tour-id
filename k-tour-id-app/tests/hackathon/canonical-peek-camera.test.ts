import assert from "node:assert/strict"
import test from "node:test"
import { canonicalPeekTarget } from "../../features/ondo/map/canonical-peek-camera-b"

const map = { left: 100, right: 1000, top: 20, bottom: 740 }
const peek = { left: 320, right: 780, top: 340, bottom: 720 }
const header = { left: 250, right: 850, top: 32, bottom: 136 }

test("an already visible selected point remains exact", () => {
  assert.deepEqual(canonicalPeekTarget({ x: 550, y: 220 }, map, peek, [header], 64), { x: 550, y: 220 })
})
test("covered point takes the smallest displacement above the peek", () => {
  assert.deepEqual(canonicalPeekTarget({ x: 550, y: 390 }, map, peek, [header], 64), { x: 550, y: 268 })
})
test("short map uses a free side lane instead of covering header or label", () => {
  const target = canonicalPeekTarget({ x: 600, y: 230 }, { ...map, right: 1300, bottom: 480 }, { left: 420, right: 880, top: 210, bottom: 464 }, [header], 64)
  assert.deepEqual(target, { x: 348, y: 230 })
})
test("no viable label region yields no invalid camera displacement", () => {
  assert.equal(canonicalPeekTarget({ x: 150, y: 100 }, { left: 0, right: 300, top: 0, bottom: 200 }, { left: 20, right: 280, top: 80, bottom: 200 }, [], 64), null)
})
test("DOMRect-style prototype getters survive region normalization", () => {
  const rect = Object.create(Object.fromEntries(Object.entries(map).map(([key, value]) => [key, value]))) as typeof map
  assert.equal(Object.keys(rect).length, 0)
  assert.deepEqual(canonicalPeekTarget({ x: 550, y: 390 }, rect, peek, [header], 64), { x: 550, y: 268 })
})
