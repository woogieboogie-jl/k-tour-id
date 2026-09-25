import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { expect, test } from "@playwright/test"

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8")
const json = (path: string) => JSON.parse(read(path)) as Record<string, unknown>
const sha256 = (path: string) => createHash("sha256").update(readFileSync(resolve(process.cwd(), path))).digest("hex")

// SHA-256 snapshots from Harvey preservation baseline f4526af3; do not replace with
// runtime `git show`, which would make this contract depend on repository history.
const HARVEY_PRESERVED_SHA256: Record<string, string> = {
  "pnpm-lock.yaml": "ff9f48eace4b59cf3d34b1fc2472068f1415558b9f52252559e7ad6aa3dc8c39",
  "../move/ondo_entitlement/Move.toml": "6fad09eae6853a3a89d954d81be0814648a3a25f3a7d881e0885d97f4c6a9eb8",
  "../move/ondo_entitlement/sources/entitlement.move": "45abd2e7e67c74de2fbc19e53397d65100ac55acabd4c4d4c6f034c6a341e8f1",
  "../move/ondo_entitlement/tests/entitlement_tests.move": "6fdd0eb0bacf18461206a8cd2036bca4b731b4bee6f792d7b15ca4af46857146",
  "../chain/omnione/DemoEntitlementRegistry.sol": "dbabef9e3102510c510e8dca9d0a8744536e3dd2cbeac04fb1ff8f9922d847ec",
  "../chain/omnione/KTourAnchor.sol": "7bfaa9638cdfa0b7a0742033575da0e82fd39e7b374283e1dd5d15cf3c4c67c1",
}

test("DEPLOYMENT-PROFILE-001 keeps map-only and Harvey full-stack builds separate", () => {
  const mapOnly = json("vercel.public-ui.json")
  const harvey = json("vercel.hackathon.json")
  const scripts = json("package.json").scripts as Record<string, string>

  expect(mapOnly.buildCommand).toBe("pnpm build:vercel:ondo-b")
  expect(mapOnly.outputDirectory).toBe(".ondo-b-standalone/.next")
  expect(String(mapOnly.buildCommand)).not.toContain("hackathon")
  expect(harvey.buildCommand).toBe("pnpm build:vercel:hackathon")
  expect(harvey.outputDirectory).toBeUndefined()
  expect(harvey.installCommand).toBe("pnpm install --frozen-lockfile")
  expect(scripts["build:vercel:ondo-b"]).toContain("prepare:sites:ondo-b")
  expect(scripts["build:vercel:ondo-b"]).toContain("scan:vercel:ondo-b")
  expect(scripts["build:vercel:hackathon"]).toBe("next build")
})

test("DEPLOYMENT-PROFILE-002 requires explicit full-stack flags and isolated local defaults", () => {
  const env = read("hackathon.env.example")
  expect(env).toMatch(/^NEXT_PUBLIC_HK_ENABLED=1$/m)
  expect(env).toMatch(/^HK_API_ENABLED=1$/m)
  expect(env).toMatch(/^HK_ISOLATED_MOCK=1$/m)
  expect(env).toMatch(/^HK_MODE_CX=mock$/m)
  expect(env).toMatch(/^HK_MODE_OPENDID=mock$/m)
  expect(env).not.toMatch(/^HK_ISOLATED_MOCK=0$/m)
})

test("DEPLOYMENT-PROFILE-003 preserves one source revision and the original Sui/Move/OmniOne assets", () => {
  const lockfile = read("pnpm-lock.yaml")
  const packageJson = json("package.json")
  const dependencies = { ...(packageJson.dependencies as Record<string, string>), ...(packageJson.devDependencies as Record<string, string>) }

  expect(lockfile.length).toBeGreaterThan(0)
  expect(dependencies["@mysten/sui"]).toBe("2.31.0")
  expect(dependencies.ethers).toBe("6.17.0")
  expect(read("../move/ondo_entitlement/Move.toml")).toContain("name = \"ondo_entitlement\"")
  expect(read("../move/ondo_entitlement/sources/entitlement.move")).toContain("module ondo_entitlement::entitlement")
  expect(read("../chain/omnione/DemoEntitlementRegistry.sol")).toContain("contract DemoEntitlementRegistry")
  expect(read("../chain/omnione/KTourAnchor.sol")).toContain("contract KTourAnchor")
  for (const [path, expected] of Object.entries(HARVEY_PRESERVED_SHA256)) {
    expect(sha256(path), `${path} changed from Harvey baseline f4526af3`).toBe(expected)
  }
})

test("DEPLOYMENT-PROFILE-004 does not silently promote the public static profile to provider or chain runtime", () => {
  const mapOnly = read("vercel.public-ui.json")
  expect(mapOnly).not.toMatch(/HK_API_ENABLED|NEXT_PUBLIC_HK_ENABLED|HK_SUI_|HK_OMNIONE_|HK_CX_/)
  expect(mapOnly).not.toContain("vercel.hackathon.json")
})
