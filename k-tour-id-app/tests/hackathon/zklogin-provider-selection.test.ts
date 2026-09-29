import assert from "node:assert/strict"
import test from "node:test"
import { selectZkLoginProvider } from "../../lib/hackathon/zklogin-provider-selection"
import { enokiConfigured, proveZkLogin, zkLoginConfigured, zkLoginProverLabel } from "../../lib/hackathon/adapters/zklogin"
import { hkConfig, hkPublicConfig } from "../../lib/hackathon/config"
import { assessZkLoginReadiness } from "../../lib/hackathon/zklogin-readiness"
import { HkError } from "../../lib/hackathon/util"

const PROVER = "https://fixture-prover.invalid/v1"
const SECRET = "private-configuration-sentinel"
// No JWT is required to test a configuration refusal. No real login/proof.
const opts = { jwt: "private-jwt-sentinel", extendedEphemeralPublicKey: "fixture-key", maxEpoch: 9, jwtRandomness: "123" }

function setup(values: Record<string, string | undefined> = {}) {
  const env: Record<string, string | undefined> = {
    HK_ISOLATED_MOCK: "0", NEXT_PUBLIC_HK_PREVIEW_READ_ONLY: "0", NEXT_PUBLIC_HK_CX_PREVIEW: "0",
    NEXT_PUBLIC_HK_HOSTED_SUI: "0", HK_HOSTED_SUI_ENABLED: "0", VERCEL_GIT_COMMIT_REF: undefined,
    NEXT_PUBLIC_GOOGLE_CLIENT_ID: "fixture-client", HK_ZKLOGIN_SALT_SEED: SECRET,
    HK_SUI_NETWORK: "testnet", HK_ZKLOGIN_PROVER_URL: undefined, ENOKI_API_URL: undefined, ENOKI_API_KEY: undefined,
    ...values,
  }
  const prior = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]))
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  const fetch = globalThis.fetch
  let requests = 0
  globalThis.fetch = async () => { requests++; throw new Error("fixture_network_forbidden") }
  return {
    requests: () => requests,
    restore: () => {
      globalThis.fetch = fetch
      for (const [key, value] of Object.entries(prior)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    },
  }
}

async function unavailable() {
  assert.equal(zkLoginConfigured(), false)
  assert.equal(zkLoginProverLabel(), "unconfigured")
  assert.equal(hkPublicConfig().modes.zklogin, "demo-signer")
  await assert.rejects(proveZkLogin(opts), (error: unknown) => {
    assert.ok(error instanceof HkError)
    assert.equal(error.code, "zklogin_unconfigured"); assert.equal(error.status, 503)
    assert.equal(error.message, "zkLogin provider configuration is unavailable")
    assert.doesNotMatch(String(error) + JSON.stringify(error) + error.stack, /private-configuration-sentinel|private-jwt-sentinel|fixture-prover|https:\/\//)
    return true
  })
}

test("client and salt alone cannot advertise Google mode or call an implicit Devnet prover", async () => {
  const f = setup()
  try {
    assert.equal(hkConfig().sui.zkProverUrl, "")
    await unavailable()
    assert.equal(f.requests(), 0)
  } finally { f.restore() }
})

for (const key of ["NEXT_PUBLIC_GOOGLE_CLIENT_ID", "HK_ZKLOGIN_SALT_SEED"]) {
  test(`missing ${key} rejects before JWT processing or provider requests`, async () => {
    const f = setup({ HK_ZKLOGIN_PROVER_URL: PROVER, [key]: undefined })
    try { await unavailable(); assert.equal(f.requests(), 0) } finally { f.restore() }
  })
}

const unsafe = [
  "", "http://fixture-prover.invalid/v1", "https://", "not-a-url",
  "https://private-configuration-sentinel@fixture-prover.invalid/v1",
  "https://user:private-configuration-sentinel@fixture-prover.invalid/v1",
  "https://fixture-prover.invalid/v1?token=private-configuration-sentinel",
  "https://fixture-prover.invalid/v1#private-configuration-sentinel",
  "https://fixture-prover.invalid:8443/v1", " https://fixture-prover.invalid/v1",
  "https://fixture-prover.invalid/v1\n", "https://fixture-prover.invalid\\evil",
  "https://localhost/v1", "https://localhost.local/v1", "https://internal.localhost/v1",
  "https://service.internal/v1", "https://127.0.0.1/v1", "https://0x7f000001/v1",
  "https://[::1]/v1", "https://169.254.169.254/v1", "https://fixture-prover.invalid./v1",
]
for (const [index, url] of unsafe.entries()) {
  test(`unsafe self-managed endpoint fixture ${index} is rejected with zero network calls`, async () => {
    const f = setup({ HK_ZKLOGIN_PROVER_URL: url })
    try { await unavailable(); assert.equal(f.requests(), 0) } finally { f.restore() }
  })
}

test("unsafe Enoki override cannot fall back to an explicit self-managed prover", async () => {
  for (const url of unsafe.filter(Boolean)) {
    const f = setup({ ENOKI_API_KEY: SECRET, ENOKI_API_URL: url, HK_ZKLOGIN_PROVER_URL: PROVER })
    try {
      assert.equal(enokiConfigured(), false)
      await unavailable(); assert.equal(f.requests(), 0)
    } finally { f.restore() }
  }
})

test("invalid Enoki credential cannot silently select a different salt path", async () => {
  for (const key of [" ", "bad\nkey", "bad key", "x".repeat(8193)]) {
    const f = setup({ ENOKI_API_KEY: key, HK_ZKLOGIN_PROVER_URL: PROVER })
    try { await unavailable(); assert.equal(f.requests(), 0) } finally { f.restore() }
  }
})

test("known Devnet endpoint is explicit-only and refused on Testnet and Mainnet", async () => {
  for (const network of ["testnet", "mainnet"]) {
    const f = setup({ HK_SUI_NETWORK: network, HK_ZKLOGIN_PROVER_URL: "https://prover-dev.mystenlabs.com/v1" })
    try { await unavailable(); assert.equal(f.requests(), 0) } finally { f.restore() }
  }
  assert.equal(selectZkLoginProvider({ HK_SUI_NETWORK: "devnet" }), null)
  assert.deepEqual(selectZkLoginProvider({ HK_SUI_NETWORK: "devnet", HK_ZKLOGIN_PROVER_URL: "https://prover-dev.mystenlabs.com/v1" }), {
    kind: "self-managed-prover", url: "https://prover-dev.mystenlabs.com/v1",
  })
})

test("explicit HTTPS selection enables configuration only, never verified Testnet readiness", () => {
  const f = setup({ HK_ZKLOGIN_PROVER_URL: PROVER })
  try {
    assert.equal(zkLoginConfigured(), true); assert.equal(zkLoginProverLabel(), "self-managed-prover")
    assert.equal(hkPublicConfig().modes.zklogin, "google"); assert.equal(enokiConfigured(), false)
    const report = assessZkLoginReadiness({ HK_SUI_NETWORK: "testnet", NEXT_PUBLIC_GOOGLE_CLIENT_ID: "fixture-client", HK_ZKLOGIN_SALT_SEED: SECRET, HK_ZKLOGIN_PROVER_URL: PROVER })
    assert.equal(report.liveExecutionReady, false); assert.equal(report.providerVerified, false)
    assert.ok(report.issues.some(issue => issue.code === "zklogin_prover_network_unverified"))
    assert.ok(report.issues.some(issue => issue.code === "zklogin_prover_access_unverified"))
    assert.equal(f.requests(), 0)
  } finally { f.restore() }
})

test("explicit Enoki uses its approved default and does not expose its key in selection", () => {
  const f = setup({ ENOKI_API_KEY: SECRET })
  try {
    assert.deepEqual(selectZkLoginProvider(process.env), { kind: "enoki", url: "https://api.enoki.mystenlabs.com/v1" })
    assert.equal(zkLoginConfigured(), true); assert.equal(enokiConfigured(), true); assert.equal(zkLoginProverLabel(), "enoki")
    assert.equal(hkPublicConfig().modes.zklogin, "google")
    assert.equal(JSON.stringify(selectZkLoginProvider(process.env)).includes(SECRET), false)
    assert.equal(f.requests(), 0)
  } finally { f.restore() }
})

test("changing explicit provider configuration is revalidated, not cached at import", async () => {
  const f = setup({ ENOKI_API_KEY: SECRET })
  try {
    assert.equal(zkLoginConfigured(), true)
    process.env.ENOKI_API_URL = "http://unsafe.invalid/v1"
    await unavailable(); assert.equal(f.requests(), 0)
  } finally { f.restore() }
})

test("unknown network cannot silently select Testnet for an Enoki proof", async () => {
  const f = setup({ HK_SUI_NETWORK: "unknown", ENOKI_API_KEY: SECRET })
  try { await unavailable(); assert.equal(f.requests(), 0) } finally { f.restore() }
})

test("hosted, isolated and CX-only boundaries still refuse providers with complete configuration", async () => {
  for (const [flag, expected] of [
    ["NEXT_PUBLIC_HK_HOSTED_SUI", "hosted_sui_scope"],
    ["HK_ISOLATED_MOCK", "isolated_mock_external_disabled"],
    ["NEXT_PUBLIC_HK_CX_PREVIEW", "cx_preview_scope"],
  ]) {
    const f = setup({ [flag]: "1", ENOKI_API_KEY: SECRET, HK_ZKLOGIN_PROVER_URL: PROVER })
    try {
      assert.equal(zkLoginConfigured(), false); assert.equal(enokiConfigured(), false)
      assert.equal(zkLoginProverLabel(), "unconfigured")
      await assert.rejects(proveZkLogin(opts), (error: unknown) => error instanceof HkError && error.code === expected)
      assert.equal(f.requests(), 0)
    } finally { f.restore() }
  }
})
