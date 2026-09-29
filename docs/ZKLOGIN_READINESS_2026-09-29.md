# zkLogin readiness — 2026-09-29 KST

Real Google zkLogin has **not** been verified. The public hosted-Sui deployment
at `a34f7be9` deliberately permits Ed25519 demo signing only; do not add Google
credentials to that profile or relax its guards to run this test. OpenDID stays
in Claude's separate active workflow.

## Actual read-only evidence

At `2026-09-28T16:12:25.282Z` (2026-09-29 01:12:25 KST, machine clock), three
bounded Vercel GETs verified the approved user, team, `ondo` project and GitHub
repository, then inspected environment-variable **names**, not decrypted values.
Among 114 entries, all five names below were absent, including Production,
hosted Preview and `integration/autonomous-finish-20260927` Preview:

- `NEXT_PUBLIC_GOOGLE_CLIENT_ID`
- `HK_ZKLOGIN_SALT_SEED`
- `ENOKI_API_KEY`
- `ENOKI_API_URL`
- `HK_ZKLOGIN_PROVER_URL`

This is project-scoped presence evidence, not evidence about another team's
deployment or an unavailable local handoff. No OAuth login, prover request,
signature, transaction or environment write occurred. Previously successful
[callback fixtures](./ZKLOGIN_RETURN_REVIEW_2026-09-27.md) test correlation,
scrubbing and return navigation; they do not establish real JWT/ZK verification.

## Owner inputs and service setup

Provide the existing Google **Web application** client ID, its configuration
owner, and the existing salt seed through the approved secure handoff. Never
paste the seed, API key, JWT, proof or ephemeral key into chat or Git. The seed
is presently required by this app's mode gate even on Enoki's managed-salt path;
it is not the managed per-user salt. Do not rotate it or switch salt providers:
either can derive a different address.

The browser callback is exactly `/hackathon/zklogin/callback`, on the origin
where login began. Google requires an exact registered redirect URI, including
scheme/path/trailing slash. If a future protected zkLogin profile is approved on
the public host, register
`https://ktour-id.vercel.app/hackathon/zklogin/callback`; the JavaScript origin is
`https://ktour-id.vercel.app`. For an approved immutable Preview, register that
exact Preview origin plus the same callback path—no wildcard and no redirect
from Preview to Production. This is a registration target, **not** a claim that
the current hosted-Sui profile supports login. The existing implicit-ID-token
flow does not use a Google client secret. [Google OIDC reference](https://developers.google.com/identity/openid-connect/reference)

Choose one proving path; two sets of credentials are not required:

- **Enoki:** provide `ENOKI_API_KEY`, enable zkLogin/Testnet for the app/key,
  and register the same Google client under its authentication providers.
  Default `ENOKI_API_URL` is `https://api.enoki.mystenlabs.com/v1`; an override
  needs explicit review. Server `GET /v1/zklogin` obtains managed salt/address;
  `POST /v1/zklogin/zkp` requests the proof with `network: "testnet"`.
  Our existing Sui sponsor remains separate; Enoki transaction sponsorship is
  not required by this adapter. [Enoki setup](https://docs.enoki.mystenlabs.com/ts-sdk/examples),
  [HTTP API](https://docs.enoki.mystenlabs.com/http-api/openapi)
- **Public/self-hosted prover:** use an explicitly reviewed
  `HK_ZKLOGIN_PROVER_URL` and retain the existing local salt derivation.
  Current Sui documentation says public proving is available for Devnet and
  Testnet without registration; Enoki is **not universally mandatory** for
  Testnet. It separately distinguishes Mainnet/Testnet and Devnet proving keys.
  The adapter's historical default `prover-dev.mystenlabs.com` therefore
  does not establish current endpoint/key compatibility. We must verify the
  selected endpoint and key for Testnet, not assume readiness from HTTPS or
  silently switch to another prover. [Sui integration guide](https://docs.sui.io/sui-stack/zklogin-integration/integration-guide#option-a-use-the-mysten-labs-proving-service)

The account holder must complete the real Google account selection/login,
consent and explicit wallet approval. We do not create or log in to a Google
account on the user's behalf. If the OAuth client is restricted to test users,
its administrator must make the intended account eligible.

## Our follow-up, without changing the live profile

The offline [provider assessment](../k-tour-id-app/lib/hackathon/zklogin-readiness.ts)
now feeds [integration preflight](../k-tour-id-app/lib/hackathon/integration-readiness.ts).
It reports unverified network-key/access/Enoki registration and active
hosted-profile conflicts using fixed codes; it never calls a provider or marks
live execution ready. That readiness-only step did not change runtime adapters.
The subsequent [explicit prover-selection preparation](./ZKLOGIN_PROVER_SELECTION_2026-09-29.md)
removes the implicit Devnet endpoint and requires a selected provider before
advertising configured Google mode or sending a JWT. The active hosted-Sui
restrictions remain unchanged; selection still does not prove live readiness.

Safe offline checks from `k-tour-id-app`:

```sh
node --import tsx --test tests/hackathon/zklogin-readiness.test.ts tests/hackathon/integration-readiness.test.ts
node --import tsx scripts/hackathon-integration-readiness.ts --offline
```

The empty inventory deliberately ignores ambient credentials and exits nonzero.
The existing `--offline --stdin` form accepts a bounded explicit inventory from
an approved secure process, never shell arguments, dotenv or printed values.

After inputs and login: validate callback/nonce/epoch, obtain a real proof,
verify the operation-bound wallet signature, then use a separately approved
protected Testnet profile with role/gas/one-use limits. Completion requires an
actual successful delegation receipt whose user signature is `ZkLogin`, plus
the expected sponsor and event/object links—not a configured flag, synthetic
JWT, demo Ed25519 receipt, or callback fixture. No deployment was performed by
this readiness change.

Local validation: **40/40** focused readiness/OAuth/provider fixture tests,
full TypeScript check and `git diff --check` passed. Provider success fixtures
inject responses; none is a live login/prover/chain success claim.
