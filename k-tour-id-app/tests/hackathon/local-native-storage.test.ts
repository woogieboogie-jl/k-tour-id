import assert from "node:assert/strict"
import test from "node:test"
import { chmodSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { localNativeStorePath, persistLocalNativeStore } from "../../lib/hackathon/local-native-storage"
test("local journal is isolated 0700/0600, fsynced and survives a second read without reset", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "ktour-native-store-test-")))
  try {
    const path = localNativeStorePath(dir)
    assert.equal(lstatSync(dirname(path)).mode & 0o777, 0o700)
    persistLocalNativeStore(path, { fixture: "durably claimed before external work" }, dir)
    assert.equal(lstatSync(path).mode & 0o777, 0o600)
    assert.equal(localNativeStorePath(dir), path)
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { fixture: "durably claimed before external work" })
    assert.throws(() => persistLocalNativeStore(join(dir, "old-ledger.json"), {}, dir))
    chmodSync(path, 0o644); assert.throws(() => localNativeStorePath(dir)); chmodSync(path, 0o600)
    unlinkSync(path); symlinkSync(join(dir, "absent-old-ledger"), path)
    assert.throws(() => persistLocalNativeStore(path, {}, dir), "a broken ledger symlink must also be refused")
  } finally { rmSync(dir, { recursive: true }) }
})
