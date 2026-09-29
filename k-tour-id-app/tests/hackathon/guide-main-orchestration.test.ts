import assert from "node:assert/strict"
import { test } from "node:test"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

// Module replacements live ONLY in a separate test process. Neither normal app
// imports nor production policy are given an injectable approval bypass.
test("guide orchestration: isolated synthetic boundaries, not real provider E2E", { timeout: 120_000 }, t => {
  const child = spawnSync(process.execPath, ["--experimental-test-module-mocks", "--import", "tsx", "--test", "--test-reporter=tap", "tests/hackathon/fixtures/guide-main-orchestration.fixture.ts"], {
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    env: { PATH: process.env.PATH, NODE_ENV: "test", NODE_NO_WARNINGS: "1" },
    encoding: "utf8", timeout: 110_000, maxBuffer: 2_000_000,
  })
  assert.ifError(child.error)
  assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}`)
  assert.match(child.stdout, /production V2 remains unavailable/)
  assert.match(child.stdout, /synthetic full flow/)
  assert.match(child.stdout, /# fail 0/)
  t.diagnostic(`${child.stdout.match(/# pass (\d+)/)?.[1] ?? "unknown"} synthetic orchestration cases passed; V2 provider projection and signatures are fixture-only, production activation remains blocked.`)
})
