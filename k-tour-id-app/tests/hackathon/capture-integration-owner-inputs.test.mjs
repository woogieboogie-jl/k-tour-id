import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { mkdtemp, chmod, mkdir, readFile, lstat, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { captureHiddenInput, persistOwnerInput, validateOwnerInput, OWNER_INPUT_DIRECTORY, OMNIONE_RECORDER } from '../../scripts/capture-integration-owner-inputs.mjs'

const GOOGLE = '123456789012-syntheticclientonly0001.apps.googleusercontent.com'
const GEMINI = 'AIza' + 'syntheticfixtureonly00000000000000000'
async function temporary(t) {
  const base = await mkdtemp(join(await realpath(tmpdir()), 'ktour-owner-fixture-'))
  await chmod(base, 0o700)
  t.after(() => rm(base, { recursive: true }))
  return base
}
function tty() {
  const input = new EventEmitter(); input.isTTY = true; input.isRaw = false
  input.setRawMode = value => { input.isRaw = value }; input.setEncoding = () => {}; input.resume = () => {}; input.pause = () => {}
  let text = ''; const output = { isTTY: true, write: value => { text += value } }
  return { input, output, text: () => text }
}
test('pure validation never accepts arbitrary recorder keys or credential URLs', () => {
  assert.equal(OWNER_INPUT_DIRECTORY, '/Users/woogieboogie/.local/share/ktour-integration-owner-inputs')
  assert.equal(OMNIONE_RECORDER, '0x003403Cb95c2FFd66BC5748738d96C4A5B48b4ba')
  assert.equal(validateOwnerInput('google', GOOGLE), GOOGLE)
  assert.equal(validateOwnerInput('gemini', GEMINI), GEMINI)
  assert.throws(() => validateOwnerInput('omnione', '0x' + '0'.repeat(63) + '1'), { code: 'recorder_mismatch' })
  assert.throws(() => validateOwnerInput('omnione', '0x' + '0'.repeat(64)), { code: 'invalid_private_key' })
  for (const [kind, raw] of [['google', 'client-secret'], ['google', ` ${GOOGLE}`], ['gemini', 'https://key.example'], ['gemini', GEMINI + '\n'], ['__proto__', GEMINI]]) assert.throws(() => validateOwnerInput(kind, raw))
})
test('private durable file preserves existing inputs and refuses key replacement', async t => {
  const base = await temporary(t), dir = join(base, 'owner')
  await persistOwnerInput('google', GOOGLE, dir)
  const path = join(dir, 'inputs.json')
  assert.equal((await lstat(dir)).mode & 0o777, 0o700)
  assert.equal((await lstat(path)).mode & 0o777, 0o600)
  await persistOwnerInput('gemini', GEMINI, dir)
  const bytes = await readFile(path, 'utf8')
  assert.deepEqual(JSON.parse(bytes), { version: 1, inputs: { NEXT_PUBLIC_GOOGLE_CLIENT_ID: GOOGLE, GEMINI_API_KEY: GEMINI } })
  await assert.rejects(persistOwnerInput('google', GOOGLE, dir), { code: 'input_already_exists' })
  assert.equal(await readFile(path, 'utf8'), bytes)
  assert.deepEqual(await readdir(dir), ['inputs.json'])
})
test('concurrent input capture cannot overwrite or split existing state', async t => {
  const dir = await temporary(t)
  const results = await Promise.allSettled([persistOwnerInput('google', GOOGLE, dir), persistOwnerInput('google', GOOGLE, dir)])
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
  assert.equal(JSON.parse(await readFile(join(dir, 'inputs.json'), 'utf8')).inputs.NEXT_PUBLIC_GOOGLE_CLIENT_ID, GOOGLE)
  assert.deepEqual(await readdir(dir), ['inputs.json'])
})
test('post-rename durability failure reports saved-but-unknown, never invites overwrite', async t => {
  const dir = await temporary(t)
  await assert.rejects(persistOwnerInput('google', GOOGLE, dir, async () => { throw new Error('synthetic sync failure') }), { code: 'input_saved_durability_unknown' })
  assert.equal(JSON.parse(await readFile(join(dir, 'inputs.json'), 'utf8')).inputs.NEXT_PUBLIC_GOOGLE_CLIENT_ID, GOOGLE)
  await assert.rejects(persistOwnerInput('google', GOOGLE, dir), { code: 'input_already_exists' })
  assert.deepEqual(await readdir(dir), ['inputs.json'])
})
test('symlinked parent, directory and file are rejected without changing linked data', async t => {
  const base = await temporary(t), privateDir = join(base, 'private'); await mkdir(privateDir, { mode: 0o700 })
  const link = join(base, 'link'); await symlink(privateDir, link)
  await assert.rejects(persistOwnerInput('google', GOOGLE, join(link, 'nested')), { code: 'unsafe_path' })
  await assert.rejects(persistOwnerInput('google', GOOGLE, link), { code: 'unsafe_path' })
  const existing = join(base, 'unrelated'); await writeFile(existing, 'preserve', { mode: 0o600 })
  await symlink(existing, join(privateDir, 'inputs.json'))
  await assert.rejects(persistOwnerInput('google', GOOGLE, privateDir), { code: 'unsafe_file_permissions' })
  assert.equal(await readFile(existing, 'utf8'), 'preserve')
})
test('unsafe modes, corrupt document and held lock fail without resets', async t => {
  const dir = await temporary(t), path = join(dir, 'inputs.json')
  await chmod(dir, 0o755)
  await assert.rejects(persistOwnerInput('google', GOOGLE, dir), { code: 'unsafe_directory_permissions' })
  await chmod(dir, 0o700); await writeFile(path, '{}', { mode: 0o600 })
  await assert.rejects(persistOwnerInput('google', GOOGLE, dir), { code: 'invalid_existing_file' })
  assert.equal(await readFile(path, 'utf8'), '{}')
  await chmod(path, 0o644)
  await assert.rejects(persistOwnerInput('google', GOOGLE, dir), { code: 'unsafe_file_permissions' })
  await writeFile(join(dir, '.inputs.lock'), 'existing-owner', { mode: 0o600 })
  await assert.rejects(persistOwnerInput('google', GOOGLE, dir), { code: 'input_capture_busy' })
  assert.equal(await readFile(join(dir, '.inputs.lock'), 'utf8'), 'existing-owner')
})
test('invalid credentials create no directory; cancelling hidden prompt creates no writes', async t => {
  const base = await temporary(t), dir = join(base, 'not-created')
  await assert.rejects(persistOwnerInput('gemini', 'bad', dir))
  assert.deepEqual(await readdir(base), [])
  const f = tty(), pending = captureHiddenInput(f.input, f.output)
  f.input.emit('data', 'secret-fragment\u0003')
  await assert.rejects(pending, { code: 'cancelled' })
  assert.equal(f.input.isRaw, false); assert.equal(f.input.listenerCount('data'), 0)
  assert.doesNotMatch(f.text(), /secret-fragment/)
  assert.deepEqual(await readdir(base), [])
})
test('hidden prompt emits no characters or mask lengths and restores raw mode', async () => {
  const f = tty(), pending = captureHiddenInput(f.input, f.output)
  f.input.emit('data', GOOGLE + '\r')
  assert.equal(await pending, GOOGLE); assert.equal(f.input.isRaw, false)
  assert.doesNotMatch(f.text(), /123456789012|syntheticclient|\*{3}/)
  const noTty = tty(); noTty.input.isTTY = false
  await assert.rejects(captureHiddenInput(noTty.input, noTty.output), { code: 'tty_required' })
})
test('CLI rejects any credential argument and never echoes it', () => {
  const result = spawnSync(process.execPath, ['scripts/capture-integration-owner-inputs.mjs', 'gemini', GEMINI], { encoding: 'utf8' })
  assert.equal(result.status, 2); assert.doesNotMatch(result.stdout + result.stderr, new RegExp(GEMINI))
  assert.match(result.stderr, /Do not place credentials/)
})
