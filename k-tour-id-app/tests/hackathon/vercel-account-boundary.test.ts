import assert from "node:assert/strict"
import { test } from "node:test"
import { assertCommand, assertLocalBoundary, assertRemoteBoundary, cliArgs, readRemoteBoundary, subprocessEnv, TARGET } from "../../scripts/vercel-ktour-account.mjs"

const linkedProject = { projectId: TARGET.projectId, orgId: TARGET.orgId, projectName: TARGET.projectName }
const local = { cwd: TARGET.appRoot, scriptRoot: TARGET.appRoot, gitRoot: TARGET.appRoot.replace(/\/k-tour-id-app$/, ""), branch: TARGET.branch, linkedProject }
const project = { id: TARGET.projectId, accountId: TARGET.orgId, name: TARGET.projectName, rootDirectory: "k-tour-id-app", link: { type: "github", org: TARGET.repoOwner, repo: TARGET.repoName, productionBranch: "main" } }

test("account entrypoint rejects all commands and options except exact status", () => {
  assert.doesNotThrow(() => assertCommand(["status"]))
  for (const args of [[], ["deploy"], ["login"], ["env", "pull"], ["status", "--prod"], ["status", "--token", "fixture"], ["status", "--global-config", "/other"], ["status", "--cwd", "/other"], ["status", "--scope", "ohayo-global"]]) {
    assert.throws(() => assertCommand(args), /only_status_is_supported/)
  }
})

test("wrong worktree, branch or linked project fails closed", () => {
  assert.doesNotThrow(() => assertLocalBoundary(local))
  for (const override of [{ cwd: "/other" }, { scriptRoot: "/other" }, { gitRoot: "/other" }, { branch: "main" }, { linkedProject: { ...linkedProject, projectId: "megan-project" } }, { linkedProject: { ...linkedProject, orgId: "other-team" } }, { linkedProject: null }]) {
    assert.throws(() => assertLocalBoundary({ ...local, ...override }))
  }
})

test("inherited credential and target overrides never reach the child process", () => {
  const env = subprocessEnv({ PATH: "/toolchain", HOME: "/original-home", TMPDIR: "/tmp", NODE_ENV: "test", VERCEL_TOKEN: "secret", VERCEL_ORG_ID: "other", VERCEL_PROJECT_ID: "other", VERCEL_TEAM_ID: "other", NODE_OPTIONS: "--import=evil.mjs", XDG_DATA_HOME: "/other", npm_config_userconfig: "/other", NPM_TOKEN: "secret", HK_CX_PREVIEW_ACCESS_SECRET: "secret" })
  assert.deepEqual(env, { PATH: "/toolchain", HOME: "/original-home", TMPDIR: "/tmp", NO_COLOR: "1" })
  assert.ok(cliArgs(["whoami"]).includes(TARGET.profile))
})

test("user identity and remote project authorization are separate mandatory checks", () => {
  assert.doesNotThrow(() => assertRemoteBoundary(TARGET.username, project))
  assert.throws(() => assertRemoteBoundary("megan-3020", project), /wrong_account/)
  for (const override of [{ id: "other" }, { accountId: "other" }, { name: "other" }, { rootDirectory: "other" }, { link: { ...project.link, org: "other" } }, { link: { ...project.link, repo: "other" } }]) {
    assert.throws(() => assertRemoteBoundary(TARGET.username, { ...project, ...override }), /wrong_remote_project/)
  }
})

test("same profile is used for both reads; a wrong user stops before project lookup", () => {
  const calls: string[][] = []
  assert.throws(() => readRemoteBoundary((args: string[]) => { calls.push(args); return "megan-3020" }), /wrong_account/)
  assert.equal(calls.length, 1)
  calls.length = 0
  const output = readRemoteBoundary((args: string[]) => {
    calls.push(args)
    return calls.length === 1 ? TARGET.username : JSON.stringify({ ...project, env: [{ value: "secret-sentinel" }], arbitrary: "secret-sentinel" })
  })
  assert.equal(calls.length, 2)
  assert.ok(calls.every(args => args.slice(-2).join(":") === `--global-config:${TARGET.profile}`))
  assert.equal(calls[1][3], `/v9/projects/${TARGET.projectId}?teamId=${TARGET.orgId}`)
  assert.equal(output.remoteMutation, false)
  assert.equal(JSON.stringify(output).includes("secret-sentinel"), false)
})

test("malformed or unauthorized remote results never leak upstream response text", () => {
  let count = 0
  assert.throws(() => readRemoteBoundary(() => ++count === 1 ? TARGET.username : "secret-sentinel"), /account_or_project_check_failed/)
  count = 0
  assert.throws(() => readRemoteBoundary(() => { if (++count === 1) return TARGET.username; throw new Error("secret-sentinel") }), /account_or_project_check_failed/)
})

test("unexpected nested or oversized production branch metadata is not echoed", () => {
  for (const productionBranch of [{ value: "secret-sentinel" }, "x".repeat(256), null]) {
    let count = 0
    const output = readRemoteBoundary(() => ++count === 1 ? TARGET.username : JSON.stringify({ ...project, link: { ...project.link, productionBranch } }))
    assert.equal(output.productionBranch, null)
    assert.equal(JSON.stringify(output).includes("secret-sentinel"), false)
  }
})
