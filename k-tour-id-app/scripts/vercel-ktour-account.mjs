import { execFileSync } from "node:child_process"
import { readFileSync, realpathSync } from "node:fs"
import { resolve } from "node:path"

// Machine-local deployment boundary for this specific worktree. A different
// checkout must deliberately define its own boundary, not inherit this account.
export const TARGET = Object.freeze({
  appRoot: "/Users/woogieboogie/github/k-tour-id/.codex-worktrees/harvey-sync-20260917/k-tour-id-app",
  profile: "/Users/woogieboogie/.config/vercel-accounts/jaewook",
  username: "jaewook-9643",
  projectId: "prj_w5rckTz9B1DO55fvVRXjQRy9L5RM",
  orgId: "team_6kJAloQ9WlswvMtbbCmGI7Er",
  projectName: "ondo",
  branch: "feat/hackathon-readiness-preview-20260925",
  repoOwner: "woogieboogie-jl",
  repoName: "k-tour-id",
})
const SCRIPT_APP_ROOT = resolve(import.meta.dirname, "..")
const CLI_PREFIX = ["--yes", "vercel@60.0.1"]
const SAFE_ENV = new Set(["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "SystemRoot", "LANG", "LC_ALL"])
const fail = code => { throw new Error(code) }

// Excludes token, team/project, XDG, npm routing/debug and NODE_OPTIONS overrides.
// HOME is inherited unchanged; it is never repurposed to switch accounts.
export function subprocessEnv(env = process.env) {
  return { ...Object.fromEntries(Object.entries(env).filter(([key, value]) => SAFE_ENV.has(key) && typeof value === "string")), NO_COLOR: "1" }
}
export function assertCommand(args) {
  if (args.length !== 1 || args[0] !== "status") fail("only_status_is_supported")
}
export function assertLocalBoundary({ cwd, scriptRoot, gitRoot, branch, linkedProject }) {
  if (cwd !== TARGET.appRoot || scriptRoot !== TARGET.appRoot || gitRoot !== resolve(TARGET.appRoot, "..")) fail("wrong_worktree")
  if (branch !== TARGET.branch) fail("wrong_branch")
  if (linkedProject?.projectId !== TARGET.projectId || linkedProject?.orgId !== TARGET.orgId || linkedProject?.projectName !== TARGET.projectName) fail("wrong_linked_project")
}
export function assertRemoteBoundary(username, project) {
  if (username !== TARGET.username) fail("wrong_account")
  if (project?.id !== TARGET.projectId || project?.accountId !== TARGET.orgId || project?.name !== TARGET.projectName ||
    project?.rootDirectory !== "k-tour-id-app" || project?.link?.type !== "github" ||
    project?.link?.org !== TARGET.repoOwner || project?.link?.repo !== TARGET.repoName) fail("wrong_remote_project")
}
function processOutput(binary, args, env) {
  try {
    return execFileSync(binary, args, {
      cwd: TARGET.appRoot, env, encoding: "utf8", shell: false,
      timeout: 30_000, killSignal: "SIGKILL", maxBuffer: 512 * 1024, stdio: ["ignore", "pipe", "pipe"],
    }).trim()
  } catch {
    // Never echo CLI responses/errors: project metadata can include env values.
    fail("account_or_project_check_failed")
  }
}
export function cliArgs(command) {
  return [...CLI_PREFIX, ...command, "--global-config", TARGET.profile]
}
export function readRemoteBoundary(run) {
  const username = run(cliArgs(["whoami"]))
  if (username !== TARGET.username) fail("wrong_account")
  let project
  try {
    project = JSON.parse(run(cliArgs(["api", `/v9/projects/${TARGET.projectId}?teamId=${TARGET.orgId}`, "--raw"])))
  } catch { fail("account_or_project_check_failed") }
  assertRemoteBoundary(username, project)
  // Allowlisted output only; never return the complete project/API response.
  return {
    ok: true, mode: "read-only", username, project: project.name,
    projectId: project.id, orgId: project.accountId,
    branch: TARGET.branch, worktree: resolve(TARGET.appRoot, ".."),
    authenticationProfile: TARGET.profile,
    productionBranch: typeof project.link.productionBranch === "string" && project.link.productionBranch.length <= 255
      ? project.link.productionBranch : null,
    automaticDeploymentFilter: project.commandForIgnoringBuildStep ? "configured-not-evaluated" : "not-configured-at-project-level",
    remoteMutation: false,
  }
}
export function accountStatus(args, env = process.env) {
  assertCommand(args)
  let local
  const childEnv = subprocessEnv(env)
  try {
    local = {
      cwd: realpathSync(process.cwd()), scriptRoot: realpathSync(SCRIPT_APP_ROOT),
      gitRoot: realpathSync(processOutput("git", ["rev-parse", "--show-toplevel"], childEnv)),
      branch: processOutput("git", ["branch", "--show-current"], childEnv),
      linkedProject: JSON.parse(readFileSync(resolve(SCRIPT_APP_ROOT, ".vercel/project.json"), "utf8")),
    }
  } catch { fail("local_target_unavailable") }
  assertLocalBoundary(local)
  return readRemoteBoundary(args => processOutput("npx", args, childEnv))
}

if (process.argv[1] === import.meta.filename) {
  try {
    console.log(JSON.stringify(accountStatus(process.argv.slice(2)), null, 2))
  } catch (error) {
    const allowed = new Set(["only_status_is_supported", "wrong_worktree", "wrong_branch", "wrong_linked_project", "wrong_account", "wrong_remote_project", "account_or_project_check_failed", "local_target_unavailable"])
    console.error(JSON.stringify({ ok: false, code: allowed.has(error?.message) ? error.message : "account_check_failed" }))
    process.exitCode = 1
  }
}
