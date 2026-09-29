import assert from "node:assert/strict"
import { test } from "node:test"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

for (const allocation of ["fenced-v1", "shared-v2"] as const) test(`authenticated V2 routes with ${allocation} use actual service/session/store and synthetic external boundaries`, { timeout: 120_000 }, t => {
  const child = spawnSync(process.execPath, ["--experimental-test-module-mocks", "--import", "tsx", "--test", "--test-reporter=tap", "tests/hackathon/fixtures/guide-authenticated-route.fixture.ts"], {
    cwd: fileURLToPath(new URL("../../", import.meta.url)), env: { PATH: process.env.PATH, NODE_ENV: "test", NODE_NO_WARNINGS: "1", KTOUR_FIXTURE_ALLOCATION: allocation }, encoding: "utf8", timeout: 110_000, maxBuffer: 2_000_000,
  })
  assert.ifError(child.error)
  assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}`)
  assert.match(child.stdout, /actual production policy still blocks/)
  assert.match(child.stdout, /authenticated actual routes complete synthetic V2/)
  assert.match(child.stdout, /# fail 0/)
  t.diagnostic(`${allocation}: ${child.stdout.match(/# pass (\d+)/)?.[1] ?? "unknown"} authenticated route regressions passed; native V2, signatures and provider network remain synthetic, not activation evidence.`)
})
