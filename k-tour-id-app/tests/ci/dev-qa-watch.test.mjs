import assert from "node:assert/strict"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import nextConfig from "../../next.config.mjs"
import { withQaOutputIgnored } from "../../lib/dev-qa-watch.mjs"

const require = createRequire(import.meta.url)
const Watchpack = require("next/dist/compiled/watchpack")

const qa = fileURLToPath(new URL("../../artifacts/qa", import.meta.url)).replaceAll("\\", "/")
const apply = (config, dev = true) => nextConfig.webpack(config, { dev })

test("production webpack settings remain byte-for-byte and reference unchanged", () => {
  const ignored = /node_modules/
  const config = Object.freeze({ watchOptions: Object.freeze({ ignored, poll: 100 }) })
  assert.equal(apply(config, false), config)
  assert.equal(config.watchOptions.ignored, ignored)
})

test("dev preserves Next RegExp exclusions and flags, adding only this app's QA subtree", () => {
  const inherited = /(?:^|[\\/])(?:node_modules|\.git|\.next)(?:[\\/]|$)/i
  const settings = Object.freeze({ ignored: inherited, aggregateTimeout: 11 })
  const config = apply({ watchOptions: settings })
  const ignored = config.watchOptions.ignored
  assert.ok(ignored instanceof RegExp)
  assert.equal(ignored.flags, inherited.flags)
  assert.equal(config.watchOptions.aggregateTimeout, 11)
  assert.equal(settings.ignored, inherited)
  for (const path of [qa, `${qa}/video.webm`, `${qa}/nested/trace.zip`, "/project/.next/dev/build-manifest.json", "/project/node_modules/code.js"])
    assert.equal(ignored.test(path), true, path)
  for (const path of [`${qa}-source/example.ts`, `${qa.slice(0, -3)}/other/example.ts`, "/unrelated/artifacts/qa/report.json", "/project/app/page.tsx"])
    assert.equal(ignored.test(path), false, path)
})

test("dev preserves valid string and string-array glob types without mutation", () => {
  const patterns = Object.freeze(["**/node_modules/**", "**/.next/**"])
  assert.deepEqual(apply({ watchOptions: { ignored: patterns } }).watchOptions.ignored, [...patterns, qa, `${qa}/**`])
  assert.deepEqual(apply({ watchOptions: { ignored: "**/node_modules/**" } }).watchOptions.ignored, ["**/node_modules/**", qa, `${qa}/**`])
  assert.deepEqual(apply({}).watchOptions.ignored, [qa, `${qa}/**`])
  assert.deepEqual(patterns, ["**/node_modules/**", "**/.next/**"])
})

test("unsupported dev ignore types fail instead of dropping existing protections", () => {
  assert.throws(() => apply({ watchOptions: { ignored: [/node_modules/] } }), /Unsupported development watcher/)
  assert.throws(() => apply({ watchOptions: { ignored: () => false } }), /Unsupported development watcher/)
})

test("literal checkout glob characters do not widen or defeat Watchpack string exclusions", () => {
  for (const directory of ["/tmp/project[1]/artifacts/qa", "/tmp/project?*{a,b}/artifacts/qa"]) {
    for (const inherited of [undefined, "**/node_modules/**", ["**/node_modules/**"]]) {
      const watcher = new Watchpack({ ignored: withQaOutputIgnored(inherited, directory) })
      try {
        assert.equal(watcher.watcherOptions.ignored(directory), true)
        assert.equal(watcher.watcherOptions.ignored(`${directory}/trace.zip`), true)
        assert.equal(watcher.watcherOptions.ignored(`${directory}-source/code.ts`), false)
        assert.equal(watcher.watcherOptions.ignored("/tmp/project1/artifacts/qa/source.ts"), false)
      } finally { watcher.close() }
    }
  }
})

test("RegExp path rules support literal metacharacters and both platform separators", () => {
  for (const directory of ["C:\\project[1]\\artifacts\\qa", "\\\\server\\share\\project[1]\\artifacts\\qa"]) {
    const ignored = withQaOutputIgnored(/node_modules/, directory)
    assert.equal(ignored.test(`${directory}\\trace.zip`), true)
    assert.equal(ignored.test(`${directory.replaceAll("\\", "/")}/trace.zip`), true)
    assert.equal(ignored.test(`${directory}-source\\code.ts`), false)
  }
})
