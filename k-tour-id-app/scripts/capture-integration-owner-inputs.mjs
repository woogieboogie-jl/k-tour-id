#!/usr/bin/env node
/** Local owner input capture. No environment lookup, network, deployment, chain
 * action, secret argv, or plaintext echo. Importing this module performs no I/O. */
import { constants as F } from 'node:fs'
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises'
import { dirname, join, parse, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { Wallet } from 'ethers'

export const OWNER_INPUT_DIRECTORY = '/Users/woogieboogie/.local/share/ktour-integration-owner-inputs'
export const OMNIONE_RECORDER = '0x003403Cb95c2FFd66BC5748738d96C4A5B48b4ba'
const names = Object.freeze({ omnione: 'HK_OMNIONE_PRIVATE_KEY', 'omnione-rpc': 'HK_OMNIONE_RPC_URL', google: 'NEXT_PUBLIC_GOOGLE_CLIENT_ID', gemini: 'GEMINI_API_KEY' })
const fail = code => { const e = new Error(code); e.code = code; throw e }
const owned = stat => Number.isInteger(process.getuid?.()) && stat.uid === process.getuid()
const notFound = error => error?.code === 'ENOENT'
async function statOrNull(path) { try { return await lstat(path) } catch (e) { if (notFound(e)) return null; throw e } }

/** Pure local syntax/derived-address check, not an online credential check. */
export function validateOwnerInput(kind, raw) {
  if (!Object.hasOwn(names, kind) || typeof raw !== 'string' || !raw || raw !== raw.trim() || raw.length > (kind === 'omnione-rpc' ? 4608 : 512) || /[\x00-\x20\x7f-\uffff]/.test(raw)) fail('invalid_input')
  if (kind === 'omnione-rpc') {
    let url
    try { url = new URL(raw) } catch { fail('invalid_rpc_url') }
    const token = url.searchParams.get('token') ?? ''
    if (url.origin !== 'https://stage-chainapi.omnione.net' || url.pathname !== '/' || url.username || url.password || url.hash ||
      [...url.searchParams.keys()].join(',') !== 'token' || !/^[A-Za-z0-9_.-]{32,4096}$/.test(token) ||
      raw !== `https://stage-chainapi.omnione.net/?token=${token}`) fail('invalid_rpc_url')
    return raw
  }
  if (kind === 'omnione') {
    if (!/^(?:0x)?[a-fA-F0-9]{64}$/.test(raw)) fail('invalid_private_key')
    const value = raw.startsWith('0x') ? raw : `0x${raw}`
    let address
    try { address = new Wallet(value).address } catch { fail('invalid_private_key') }
    if (address.toLowerCase() !== OMNIONE_RECORDER.toLowerCase()) fail('recorder_mismatch')
    return value
  }
  if (kind === 'google' && !/^\d{6,30}-[a-zA-Z0-9_-]{8,160}\.apps\.googleusercontent\.com$/.test(raw)) fail('invalid_client_id')
  if (kind === 'gemini' && !/^AIza[a-zA-Z0-9_-]{30,100}$/.test(raw)) fail('invalid_api_key')
  return raw
}
function checkedDocument(raw) {
  let doc
  try { doc = JSON.parse(raw) } catch { fail('invalid_existing_file') }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) || Object.keys(doc).sort().join(',') !== 'inputs,version' || doc.version !== 1 ||
    !doc.inputs || typeof doc.inputs !== 'object' || Array.isArray(doc.inputs)) fail('invalid_existing_file')
  for (const [key, value] of Object.entries(doc.inputs)) {
    const kind = Object.keys(names).find(k => names[k] === key)
    if (!kind) fail('invalid_existing_file')
    try { validateOwnerInput(kind, value) } catch { fail('invalid_existing_file') }
  }
  return doc
}
async function safeDirectory(directory, create) {
  if (resolve(directory) !== directory || directory === parse(directory).root || !Number.isInteger(process.getuid?.())) fail('unsafe_path')
  // Walk every ancestor with lstat: no symlink is followed, including .local/share.
  const parts = directory.slice(parse(directory).root.length).split('/'); let current = parse(directory).root
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i]); let s = await statOrNull(current)
    if (!s) {
      if (!create) return false
      try { await mkdir(current, { mode: 0o700 }) } catch (e) { if (e?.code !== 'EEXIST') throw e }
      s = await lstat(current)
    }
    if (!s.isDirectory() || s.isSymbolicLink()) fail('unsafe_path')
    // Public/root-owned ancestors may be read/traversed, but writable-by-others
    // ancestors are not accepted (sticky OS temporary roots excepted in fixtures).
    if ((s.mode & 0o022) && !(s.mode & 0o1000)) fail('unsafe_path')
    if (i === parts.length - 1 && (!owned(s) || (s.mode & 0o777) !== 0o700)) fail('unsafe_directory_permissions')
  }
  return true
}
async function readDocument(path) {
  const before = await statOrNull(path)
  if (!before) return null
  if (!before.isFile() || before.isSymbolicLink() || !owned(before) || (before.mode & 0o777) !== 0o600 || before.nlink !== 1 || before.size > 8192) fail('unsafe_file_permissions')
  const handle = await open(path, F.O_RDONLY | F.O_NOFOLLOW)
  try {
    const s = await handle.stat()
    if (s.ino !== before.ino || s.dev !== before.dev || !owned(s) || (s.mode & 0o777) !== 0o600 || s.nlink !== 1 || s.size > 8192) fail('file_changed')
    const raw = await handle.readFile('utf8')
    if (Buffer.byteLength(raw) > 8192) fail('invalid_existing_file')
    return { raw, doc: checkedDocument(raw), ino: s.ino, dev: s.dev }
  } finally { await handle.close() }
}

/** Test seam permits an explicitly supplied private temporary directory. The CLI
 * below never accepts a path arg/env and always uses OWNER_INPUT_DIRECTORY. */
async function syncDirectory(directory) {
  const dir = await open(directory, F.O_RDONLY | F.O_NOFOLLOW)
  try { await dir.sync() } finally { await dir.close() }
}
export async function persistOwnerInput(kind, raw, directory = OWNER_INPUT_DIRECTORY, syncDirectoryImpl = syncDirectory) {
  const value = validateOwnerInput(kind, raw)
  await safeDirectory(directory, true)
  const path = join(directory, 'inputs.json'), lockPath = join(directory, '.inputs.lock')
  let lock, temp, renamed = false
  try {
    try { lock = await open(lockPath, F.O_WRONLY | F.O_CREAT | F.O_EXCL | F.O_NOFOLLOW, 0o600) } catch { fail('input_capture_busy') }
    const old = await readDocument(path), doc = old?.doc ?? { version: 1, inputs: {} }
    if (Object.hasOwn(doc.inputs, names[kind])) fail('input_already_exists')
    doc.inputs[names[kind]] = value
    temp = join(directory, `.inputs-${randomUUID()}.tmp`)
    const out = await open(temp, F.O_WRONLY | F.O_CREAT | F.O_EXCL | F.O_NOFOLLOW, 0o600)
    try { await out.writeFile(JSON.stringify(doc) + '\n', 'utf8'); await out.sync() } finally { await out.close() }
    await safeDirectory(directory, false)
    const beforeReplace = await readDocument(path)
    if (old ? !beforeReplace || old.ino !== beforeReplace.ino || old.dev !== beforeReplace.dev || old.raw !== beforeReplace.raw : beforeReplace !== null) fail('file_changed')
    await rename(temp, path); renamed = true
    await syncDirectoryImpl(directory)
    return { stored: names[kind], path }
  } catch (error) {
    // rename has already made the input visible. Never claim "not saved" or
    // encourage a retry when a later durability acknowledgement was lost.
    if (renamed) fail('input_saved_durability_unknown')
    throw error
  } finally {
    // Clean only this invocation's own randomly-created temp and held lock.
    if (temp && !renamed) await unlink(temp).catch(() => {})
    try {
      if (lock) {
        const identity = await lock.stat().catch(() => null)
        await lock.close()
        const current = await statOrNull(lockPath)
        if (identity && current?.ino === identity.ino && current.dev === identity.dev) await unlink(lockPath)
      }
    } catch { fail(renamed ? 'input_saved_durability_unknown' : 'local_cleanup_required') }
  }
}

export async function captureHiddenInput(input = process.stdin, output = process.stderr, maxLength = 512) {
  if (!Number.isSafeInteger(maxLength) || maxLength < 1 || maxLength > 4608) fail('invalid_input')
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== 'function') fail('tty_required')
  return new Promise((resolveValue, reject) => {
    let value = '', done = false
    const wasRaw = !!input.isRaw
    const finish = (error, result) => {
      if (done) return; done = true
      input.off('data', onData); input.off('end', cancel); input.off('error', cancel)
      process.off('SIGINT', cancel); process.off('SIGTERM', cancel)
      input.setRawMode(wasRaw); input.pause(); output.write('\n')
      if (error) reject(Object.assign(new Error(error), { code: error })); else resolveValue(result)
    }
    const cancel = () => finish('cancelled')
    const onData = chunk => {
      // Do not print pasted characters, length, masked characters, or secret fragments.
      for (const char of String(chunk)) {
        if (char === '\u0003' || char === '\u0004' || char === '\u001b') return cancel()
        if (char === '\r' || char === '\n') return value ? finish(null, value) : cancel()
        if (char === '\u007f' || char === '\b') { value = value.slice(0, -1); continue }
        if (char.charCodeAt(0) < 0x21 || char.charCodeAt(0) > 0x7e || value.length >= maxLength) return finish('invalid_input')
        value += char
      }
    }
    input.setRawMode(true); input.setEncoding('utf8')
    input.on('data', onData); input.once('end', cancel); input.once('error', cancel)
    process.once('SIGINT', cancel); process.once('SIGTERM', cancel); input.resume()
    output.write('Paste the value (hidden), then press Enter. Ctrl-C cancels: ')
  })
}
async function main() {
  if (process.argv.length !== 3 || !Object.hasOwn(names, process.argv[2])) {
    process.stderr.write('Usage: node scripts/capture-integration-owner-inputs.mjs omnione|google|gemini|omnione-rpc\nDo not place credentials in arguments or environment variables.\n')
    process.exitCode = 2; return
  }
  try {
    const kind = process.argv[2]
    // Read-only preflight before prompting. Cancelling never creates a file/dir.
    if (await safeDirectory(OWNER_INPUT_DIRECTORY, false)) {
      const old = await readDocument(join(OWNER_INPUT_DIRECTORY, 'inputs.json'))
      if (old && Object.hasOwn(old.doc.inputs, names[kind])) fail('input_already_exists')
    }
    const raw = await captureHiddenInput(undefined, undefined, kind === 'omnione-rpc' ? 4608 : 512)
    const result = await persistOwnerInput(kind, raw)
    process.stdout.write(`Saved ${result.stored} securely. No deployment or external call was made.\n`)
  } catch (e) {
    if (e?.code === 'input_saved_durability_unknown') {
      process.stderr.write('Saved locally, but durable completion could not be confirmed. Do not re-enter; request a read-only check. No values were printed.\n')
      process.exitCode = 1; return
    }
    const allowed = ['cancelled', 'tty_required', 'invalid_input', 'invalid_rpc_url', 'invalid_private_key', 'recorder_mismatch', 'invalid_client_id', 'invalid_api_key', 'unsafe_path', 'unsafe_directory_permissions', 'unsafe_file_permissions', 'invalid_existing_file', 'file_changed', 'input_capture_busy', 'input_already_exists']
    process.stderr.write(`Not saved: ${allowed.includes(e?.code) ? e.code : 'local_storage_error'}. No values were printed.\n`)
    process.exitCode = 1
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
