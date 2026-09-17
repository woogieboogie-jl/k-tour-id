// `npm start` helper: build once when no production build exists, so
// `npm start` works on a fresh checkout without a separate `npm run build`.
import { existsSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const buildId = fileURLToPath(new URL("../.next/BUILD_ID", import.meta.url))
if (!existsSync(buildId)) {
  console.log("[prestart] no production build found → running `next build` once")
  const result = spawnSync("next", ["build"], { stdio: "inherit", shell: true })
  process.exit(result.status ?? 1)
}
