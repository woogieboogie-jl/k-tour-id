import assert from "node:assert/strict"
import { test } from "node:test"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

test("actual hosted JIT endpoints exercise cookie, origin, CX parser, durable budget and perk reuse using synthetic network only", { timeout: 120000 }, t => {
  const child = spawnSync(process.execPath, ["--experimental-test-module-mocks", "--import", "tsx", "--test", "--test-reporter=tap", "tests/hackathon/fixtures/jit-authenticated-route.fixture.ts"], {
    cwd: fileURLToPath(new URL("../../", import.meta.url)), env: { PATH: process.env.PATH, NODE_ENV: "test", NODE_NO_WARNINGS: "1" }, encoding: "utf8", timeout: 110000, maxBuffer: 2000000,
  })
  assert.ifError(child.error); assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}`); assert.match(child.stdout, /# fail 0/)
  t.diagnostic(`${child.stdout.match(/# pass (\d+)/)?.[1]} actual-route regressions passed; CX transport is synthetic, not real-provider verification.`)
})
