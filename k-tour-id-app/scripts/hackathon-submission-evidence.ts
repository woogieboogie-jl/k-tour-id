// Explicit local JSON -> newly created redacted JSON. No env loading/network.
import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync, unlinkSync, writeFileSync } from "node:fs"
import { basename, dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { buildSubmissionEvidence, SUBMISSION_MAX_BYTES } from "../lib/hackathon/submission-evidence"

const invalid = () => new Error("submission_evidence_arguments_invalid")
export function submissionEvidenceArguments(args: string[]) {
  if (args.length !== 4 || args[0] !== "--input" || args[2] !== "--output") throw invalid()
  const paths = [args[1], args[3]].map(value => {
    if (!value || value.startsWith("-") || /[\x00-\x1f\x7f]/.test(value) || value.includes("://") || !value.endsWith(".json")) throw invalid()
    const path = resolve(value)
    if (/^(?:\.env(?:\.|$)|auth\.|credentials\.|secrets\.)/i.test(basename(path))) throw invalid()
    return path
  })
  if (paths[0] === paths[1]) throw invalid()
  return { input: paths[0], output: paths[1] }
}

function canonicalParent(path: string) {
  // Resolve only the explicit parent, not any repository/env discovery paths.
  const parent = dirname(path)
  if (realpathSync(parent) !== parent || !lstatSync(parent).isDirectory()) throw new Error("submission_evidence_path_invalid")
}
function readBoundedJson(path: string) {
  canonicalParent(path)
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > SUBMISSION_MAX_BYTES) throw new Error("submission_evidence_input_invalid")
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const opened = fstatSync(descriptor)
    if (!opened.isFile() || opened.ino !== stat.ino || opened.dev !== stat.dev || opened.size !== stat.size) throw new Error("submission_evidence_input_invalid")
    const bytes = Buffer.alloc(SUBMISSION_MAX_BYTES + 1)
    let length = 0
    while (length < bytes.length) {
      const count = readSync(descriptor, bytes, length, bytes.length - length, null)
      if (count === 0) break
      length += count
    }
    const after = fstatSync(descriptor)
    if (length > SUBMISSION_MAX_BYTES || length !== opened.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) throw new Error("submission_evidence_input_invalid")
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length))) as unknown
  } finally { closeSync(descriptor) }
}

type CreatedOutput = { path: string; dev: number; ino: number }
/** Never delete a replacement file after a failed write. The parent must still
 * be operator-controlled: stat/unlink is not an adversarial-directory sandbox. */
export function cleanupSubmissionPartial(created: CreatedOutput) {
  try {
    const current = lstatSync(created.path)
    if (!current.isFile() || current.isSymbolicLink() || current.dev !== created.dev || current.ino !== created.ino) return false
    unlinkSync(created.path)
    return true
  } catch { return false }
}
export function runSubmissionEvidence(args: string[], now = Date.now()) {
  let created: CreatedOutput | null = null
  try {
    const paths = submissionEvidenceArguments(args)
    canonicalParent(paths.output)
    // Fail before reading a potentially sensitive capture if output exists.
    try { lstatSync(paths.output); throw new Error("submission_evidence_output_exists") }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error }
    const result = buildSubmissionEvidence(readBoundedJson(paths.input), now)
    const serialized = `${JSON.stringify(result, null, 2)}\n`
    if (Buffer.byteLength(serialized) > SUBMISSION_MAX_BYTES) throw new Error("submission_evidence_output_invalid")
    canonicalParent(paths.output)
    const descriptor = openSync(paths.output, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    try {
      const owned = fstatSync(descriptor)
      created = { path: paths.output, dev: owned.dev, ino: owned.ino }
      writeFileSync(descriptor, serialized, "utf8")
    } finally { closeSync(descriptor) }
    created = null
    return { ok: result.complete, exported: true, complete: result.complete, suppliedExecutionLevel: result.suppliedExecutionLevel,
      remoteVerificationPerformed: false, attestation: "none", bundleDigest: result.bundleDigest, failedChecks: result.failedChecks }
  } catch {
    // Only an exact file newly created by this invocation can be cleaned up.
    const partialOutputRemoved = created ? cleanupSubmissionPartial(created) : null
    return { ok: false, exported: false, complete: false, remoteVerificationPerformed: false, attestation: "none", partialOutputRemoved, failedChecks: ["submission_evidence_input_or_output_invalid"] }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length === 3 && process.argv[2] === "--help") {
    process.stdout.write("Offline, redacted snapshot consistency check; no live verification.\nUsage: node --import tsx scripts/hackathon-submission-evidence.ts --input /absolute/capture.json --output /absolute/new-evidence.json\nOutput must not exist. Exit 0: structurally complete; exit 1: incomplete or invalid. Neither certifies a live run.\n")
  } else {
    const report = runSubmissionEvidence(process.argv.slice(2))
    process.stdout.write(`${JSON.stringify(report)}\n`)
    process.exitCode = report.ok ? 0 : 1
  }
}
