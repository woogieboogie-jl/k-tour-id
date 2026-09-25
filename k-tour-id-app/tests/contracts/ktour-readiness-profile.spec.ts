import { readFileSync, readdirSync } from "node:fs"
import { expect, test } from "@playwright/test"
import { assertPreviewTarget, previewBuildEnv, PREVIEW_BRANCH } from "../../scripts/hackathon-preview-build.mjs"

const read = (path: string) => readFileSync(path, "utf8")
const target = {
  VERCEL: "1", VERCEL_ENV: "preview", VERCEL_GIT_PROVIDER: "github", VERCEL_GIT_COMMIT_REF: PREVIEW_BRANCH,
  VERCEL_GIT_REPO_OWNER: "woogieboogie-jl", VERCEL_GIT_REPO_SLUG: "k-tour-id",
  VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
}

test("readiness profile is full-stack in Seoul and cannot build for Production or another branch", () => {
  expect(JSON.parse(read("vercel.json"))).toMatchObject({
    buildCommand: "pnpm build:vercel:readiness", outputDirectory: ".next", regions: ["icn1"],
  })
  expect(() => assertPreviewTarget(target)).not.toThrow()
  for (const override of [
    { VERCEL_ENV: "production" }, { VERCEL_ENV: "" }, { VERCEL_GIT_COMMIT_REF: "main" },
    { VERCEL_GIT_REPO_OWNER: "someone-else" }, { VERCEL_GIT_REPO_SLUG: "other" },
    { VERCEL_GIT_COMMIT_SHA: "" }, { VERCEL: "" }, { VERCEL_GIT_PROVIDER: "gitlab" },
  ]) expect(() => assertPreviewTarget({ ...target, ...override })).toThrow()
  expect(() => assertPreviewTarget({ VERCEL_ENV: "production" })).toThrow()
  expect(() => assertPreviewTarget({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "main" })).toThrow()
  expect(() => assertPreviewTarget({})).not.toThrow()
})

test("preview build strips inherited credentials and freezes execution gates", () => {
  const env = previewBuildEnv({
    ...target, PATH: "/toolchain", GEMINI_API_KEY: "sentinel", HK_CX_API_KEY: "sentinel",
    HK_SUI_AGENT_SECRET_KEY: "sentinel", UPSTASH_REDIS_REST_TOKEN: "sentinel",
    NEXT_PUBLIC_GOOGLE_CLIENT_ID: "sentinel", VERCEL_OIDC_TOKEN: "sentinel",
    HK_ISOLATED_MOCK: "0", NEXT_PUBLIC_HK_PREVIEW_READ_ONLY: "0",
  })
  expect(Object.values(env)).not.toContain("sentinel")
  expect(env).toMatchObject({
    NEXT_PUBLIC_HK_PREVIEW_READ_ONLY: "1", NEXT_PUBLIC_HK_ENABLED: "1",
    HK_ISOLATED_MOCK: "1", NEXT_PUBLIC_HK_CX_BROWSER_QR: "0", NEXT_PUBLIC_ONDO_QA_CONTROLS: "0",
  })
})

test("all mutating endpoints guard before provider and session work; no new endpoint is silently exposed", () => {
  expect(readdirSync("app/api", { recursive: true }).map(String).filter(path => path.endsWith("/route.ts")).sort()).toEqual([
    "ask/route.ts", "chat/route.ts", "hackathon/v1/[...path]/route.ts", "ondo/venues/[venueId]/route.ts",
  ])
  for (const path of ["app/api/ask/route.ts", "app/api/chat/route.ts"]) {
    expect(read(path)).toMatch(/export async function POST\([^)]*\) \{\s*if \(isReadinessPreview\(\)\) return previewReadOnlyResponse\(\)/)
  }
  const route = read("app/api/hackathon/v1/[...path]/route.ts")
  const post = route.slice(route.indexOf("export async function POST"))
  expect(post).toMatch(/if \(isReadinessPreview\(\)\) \{\s*const \{ path \} = await ctx.params/)
  expect(post).toContain('if (path.length === 2 && path[0] === "readiness" && path[1] === "redis") return redisReadinessResponse(req)')
  expect(post.indexOf("return previewReadOnlyResponse()")).toBeLessThan(post.indexOf("await assertSameOrigin()"))
  expect(read("app/labs/header-preview/page.tsx")).toContain("if (isReadinessPreview()) notFound()")
  expect(read("app/hackathon/zklogin/callback/page.tsx")).toContain("if (isReadinessPreview()) { setFailed(true); return }")
  const layer = read("features/ondo/hackathon-b/hackathon-layer-b.tsx")
  expect(layer).toContain("isReadinessPreview() ? HackathonReadinessB : Journey")
  const notice = read("features/ondo/hackathon-b/hackathon-readiness-b.tsx")
  expect(notice).not.toMatch(/api\.session|ensureHolderKey|readSigner|readPendingHackathon/)
})
