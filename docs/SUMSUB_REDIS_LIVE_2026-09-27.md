# Sumsub isolated Redis store probe — 2026-09-27

## Scope and evidence boundary

`k-tour-id-app/scripts/kyc/probe-sumsub-redis.ts` exercises the existing
`lib/kyc/sumsub-store.ts` Redis backend in five independent child processes.
It does not call Sumsub, open the WebSDK, create a real applicant, use a passport,
verify a webhook, issue an identity/pass, or call a chain. A successful result is
storage evidence only; `providerIntegrationVerified` is always `false`.

Default execution is offline and performs no Redis requests. Unit tests use an
explicit parent-side Redis fixture and report `fixture: true` and
`liveRedisVerified: false`. They are not a live-store result. Only an explicit
live run with real Redis responses may report `liveRedisVerified: true`.
Actual operator execution on 2026-09-27: **17/17 PASS**, `mode: live`,
`fixture: false`, `liveRedisVerified: true`, `cleanup: true`, `failures: 0`.
Five child processes closed; 28 commands reported. The generated namespace was
`ktour:sumsub:sandbox:qa-8e76d8c5-3d03-4b94-b477-3df6edd416aa`.
The approved jaewook/ondo KV pair was retrieved into memory after checking the
account/project boundary. No values were written to files or printed.
All three owned keys were removed and their absence confirmed; the existing
CX store and other records were not modified. This remains storage evidence,
not identity approval or full provider integration evidence.

## Execution

From `k-tour-id-app`:

```sh
node --import tsx scripts/kyc/probe-sumsub-redis.ts --dry
node --import tsx --test tests/kyc/sumsub-live-probe.test.ts
```

The approved operator wrapper should import and await the following function,
using a Redis pair already retrieved into memory from the approved ondo / jaewook
project. The script does not retrieve credentials, read environment files or
change accounts. Do not put credentials in shell arguments, history, files,
logs, reports or this document.

```ts
import { runSumsubRedisLiveProbe } from "./scripts/kyc/probe-sumsub-redis.ts"

const report = await runSumsubRedisLiveProbe({
  mode: "live",
  connection: approvedRedisPairInMemory, // { url, token }
  approvedOrigin: exactPreviouslyApprovedRedisOrigin,
})
// Emit this allowlisted report only. Never print the pair or caught errors.
process.stdout.write(JSON.stringify(report) + "\n")
```

Alternatively spawn `node --import tsx scripts/kyc/probe-sumsub-redis.ts --live`
with a private stdin pipe containing one JSON object
`{ connection: { url, token }, approvedOrigin }`; close stdin after sending.
The private input is bounded to 16 KiB and 2.5 seconds. The exact origin must be
the approved HTTPS `*.upstash.io` origin, without credentials, query, path or
explicit port. This is an operator-supplied exact-origin constraint, not a
substitute for checking the project/account binding before supplying the pair.
Both complete Upstash and KV pairs can be normalized to `{ url, token }` by the
wrapper; do not combine values from different pairs.

Run only as a local operator process, not under Vercel or `NODE_ENV=production`.
Do not add a public API route or package/build hook for this probe.

## Checks

The successful run has 17 named checks, including the following:

- Atomic reservation of a fresh, internally generated namespace.
- Real `createSumsubRecord` SET NX, duplicate refusal and initial read.
- Two child writers forced to read the same full previous value, so one real
  `mutateSumsubRecord` CAS must retry; both revocation and event metadata survive.
- A third process sees both writes; stale session/event updater predicates
  return `null`, never reapprove or revive the revoked session.
- The CAS retains the short Redis TTL. A separate two-second record is absent
  from both real `readSumsubRecord` and raw Redis GET/PTTL after native expiry.
- Five different process IDs, explicit Redis configuration (no local Map),
  child close confirmation and exact owned-key cleanup.

Revocation/late-event checks exercise store persistence and synchronous updater
predicates, not the entire authenticated session or webhook HTTP routes.

## Isolation, bounds and cleanup

The parent generates `ktour:sumsub:sandbox:qa-<UUIDv4>` itself. There is no option
to supply an existing namespace. The only three keys are an owner lease and two
synthetic record HMAC keys. The fixture applicant/level are fixed non-PII strings;
the HMAC secret and ownership token are fresh random values, not app secrets.

Every key has a maximum 120-second owner lifetime. The short expiry record has a
two-second TTL. A narrowly scoped transport fence adds an atomic owner-token
check around the real store's SET NX and exact full-previous-value CAS. This is
an **additional probe safety guard**, not a claim that the production store has
the probe's owner protocol. The underlying store serialization, validation,
revision increment, retry and updater logic are executed unchanged. The fence
rejects changed/unrecognized store Lua rather than forwarding it.

The child receives credentials only through private stdin; it does not inherit
provider keys, auth profiles, default ledger variables or `NODE_OPTIONS`.
Remote IO uses the existing bounded Redis REST transport, no redirects, an
explicit origin and exact key allowlists. FLUSH, SCAN, KEYS, arbitrary DEL and
arbitrary Lua are never accepted. No filesystem writes are performed.

The run budget is 30 seconds plus bounded cleanup. Each child has at most eight
seconds, then SIGKILL and up to two seconds to confirm close. Cleanup is attempted
only after all launched children have confirmed close, and deletes only the
three exact keys if the parent owner token still matches. A delayed fenced
write cannot resurrect a record after owner cleanup or expiry.

`ok` requires every case and `cleanup: true`. Unknown reservation response,
lost ownership, timeout or unconfirmed cleanup never produces a success claim.
If `cleanup: false`, report that condition and the 120-second TTL fallback;
do not broaden cleanup to key discovery or unrelated namespaces. Redis's own
expiry is the fallback, not proof that every failed cleanup was observed.

The report contains only fixed case names/counts, booleans and the random
namespace; it does not include Redis URL/token, HMAC keys/secret, owner token,
record JSON, applicant IDs or underlying transport error bodies.
