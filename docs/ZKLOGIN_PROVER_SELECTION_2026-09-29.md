# zkLogin prover selection — preparation only

This change removes the inherited Devnet prover fallback. It does not activate
Google, register an OAuth client, generate a proof, sign, broadcast or deploy.
The public hosted-Sui profile continues to refuse zkLogin.

## Official-source review

The current [Sui integration guide](https://docs.sui.io/sui-stack/zklogin-integration/integration-guide#option-a-use-the-mysten-labs-proving-service)
says public proving is available for Devnet and Testnet without registration;
it describes Mainnet allowlisting separately. Enoki is therefore **not
universally required for Testnet**. The current guide leaves the hosted URL as
`$PROVER_URL`; it does not establish a particular Testnet hostname.

Its [self-hosting section](https://docs.sui.io/sui-stack/zklogin-integration/integration-guide#option-b-self-hosted-proving-service)
distinguishes `zkLogin-main.zkey` for Mainnet/Testnet from `zkLogin-test.zkey`
for Devnet. The names are easy to confuse: the latter is not the Testnet key.
The guide publishes separate hashes; verify the selected artifact rather than
inferring its network from a server's hostname.

Current [Sui CLI source](https://github.com/MystenLabs/sui/blob/main/crates/sui/src/zklogin_commands_util.rs)
uses `https://prover-dev.mystenlabs.com/v1` in a helper whose network options
are Devnet and localnet. This supports conservatively refusing that known
host for this application's Testnet/Mainnet configuration. It does not prove
the current remote service's key through a health response.

`https://prover.mystenlabs.com/v1` remains a reviewed **candidate**, not a
verified Testnet endpoint for our OAuth audience. The app does not automatically
switch to it. A separately operated prover using the Mainnet/Testnet zkey is
another option. Our follow-up is to validate the chosen service; this research
is not an additional endpoint-selection burden placed on the user.

Enoki remains optional. Its [HTTP specification](https://docs.enoki.mystenlabs.com/http-api/openapi)
provides `/v1/zklogin/zkp` with an explicit `network`; the default is Mainnet,
so our adapter continues to send Testnet explicitly. Its [setup guide](https://docs.enoki.mystenlabs.com/ts-sdk/examples)
requires a key enabled for zkLogin and the selected network, plus the OAuth
client in the app's authentication-provider configuration.

## Actual bounded health observation

At `2026-09-28T17:18:22.467Z` (2026-09-29 02:18:22 KST, execution-host clock),
exactly four read-only requests were made, each with an 8-second deadline,
4-KiB response limit, redirects refused, no authentication and no request body:

| Host | GET `/ping` | OPTIONS `/v1` |
| --- | --- | --- |
| `prover.mystenlabs.com` | 200, `pong` | 204, POST allowed |
| `prover-dev.mystenlabs.com` | 200, `pong` | 204, POST allowed |

These establish reachability only. No proof POST, JWT, salt, ephemeral key,
OAuth login or chain request was used. They cannot establish OAuth-audience
acceptance, a Mainnet/Testnet-compatible proof, nonce binding, signature
verification or transaction success.

## Runtime change and remaining work

- Client ID and salt alone no longer advertise configured Google signing.
- Configure either an Enoki key (with a validated HTTPS base URL) or an explicit
  HTTPS self-managed prover. Unsafe/missing selection returns a fixed
  `zklogin_unconfigured` error before processing a JWT or sending a request.
- Invalid Enoki selection never falls back to self-managed proving. Changing
  salt providers changes addresses; retain the established salt convention.
- The known Devnet prover requires explicit Devnet selection. Other HTTPS
  URLs pass syntax checks only; they are not proof of service trust or network
  compatibility. The readiness report remains `liveExecutionReady: false` and
  `providerVerified: false` until separate real evidence exists.
- Existing issuer, audience, expiry, nonce and wallet-signature checks are not
  weakened. The browser keeps its ephemeral private key.

Before real verification, the OAuth administrator must supply/register the
Google client and exact callback origin/path; the account holder must perform
the real login and approval. The callback is `/hackathon/zklogin/callback` on
the separately approved origin (not a promise that the current hosted-Sui
deployment enables it). See the [readiness setup](./ZKLOGIN_READINESS_2026-09-29.md).
Our work then validates the selected prover using that legitimate, nonce-bound
JWT and retains only sanitized evidence. No account or synthetic claim is used
as a substitute.

## Offline regression commands

```sh
cd k-tour-id-app
node --import tsx --test tests/hackathon/zklogin-provider-selection.test.ts tests/hackathon/zklogin-provider-errors.test.ts tests/hackathon/zklogin-readiness.test.ts tests/hackathon/isolation.test.ts
pnpm test:harvey:unit
pnpm typecheck
```

All provider test responses are injected synthetic fixtures. Passing these
tests is not evidence of a real Google login, proof or transaction.
