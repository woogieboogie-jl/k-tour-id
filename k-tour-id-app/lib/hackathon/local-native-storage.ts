/** Single-process, isolated local ledger. No production/backend migration.
 * fsync precedes provider dispatch; an uncertain rename invalidates the cache. */
import { constants, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, realpathSync, renameSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { randomBytes } from "node:crypto"
import { LOCAL_NATIVE_DATA_DIR } from "./local-native-policy"
import { HkError } from "./util"
const bad = () => new HkError("store_configuration", "Isolated native storage is unavailable; inspect the same ledger without resetting it", 503)
export function localNativeStorePath(cwd = process.cwd()): string {
  try {
    const uid = process.getuid?.(); if (uid === undefined) throw bad()
    const parent = resolve(cwd, ".data"), dir = resolve(cwd, LOCAL_NATIVE_DATA_DIR)
    if (!existsSync(parent)) mkdirSync(parent, { mode: 0o700 })
    const p = lstatSync(parent)
    if (!p.isDirectory() || p.uid !== uid || realpathSync(parent) !== parent) throw bad()
    if (!existsSync(dir)) mkdirSync(dir, { mode: 0o700 })
    const d = lstatSync(dir)
    if (!d.isDirectory() || d.uid !== uid || (d.mode & 0o777) !== 0o700 || realpathSync(dir) !== dir) throw bad()
    const path = resolve(dir, "journey.json")
    const f = lstatSync(path, { throwIfNoEntry: false })
    if (f && (!f.isFile() || f.uid !== uid || f.nlink !== 1 || (f.mode & 0o777) !== 0o600)) throw bad()
    return path
  } catch { throw bad() }
}
export function persistLocalNativeStore(path: string, db: unknown, cwd = process.cwd()): void {
  if (path !== localNativeStorePath(cwd)) throw bad()
  const tmp = `${path}.${randomBytes(12).toString("hex")}.tmp`
  let fd: number | undefined, directory: number | undefined
  try {
    fd = openSync(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    writeFileSync(fd, JSON.stringify(db), "utf8"); fsyncSync(fd); closeSync(fd); fd = undefined
    renameSync(tmp, path)
    directory = openSync(dirname(path), constants.O_RDONLY | constants.O_NOFOLLOW); fsyncSync(directory)
  } catch { throw bad() }
  finally { if (fd !== undefined) closeSync(fd); if (directory !== undefined) closeSync(directory) }
}
