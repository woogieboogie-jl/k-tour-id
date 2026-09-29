# Google zkLogin connected web journey — engineering evidence

Snapshot: connected-providers-20260930 worktree, base cdd5afc82c03e3eea016be2b566e2c9d63bf65ec plus reviewed changes. This document records code/fixture evidence, not a completed human Google login, real proof, or newly executed transaction.

## Shipped-code contract

- Exact dual `connected-20260930-v1` markers, explicit Google flag, pinned provider tuple and existing hosted profile/access checks are required. The existing store key, operation cap and Sui budget are unchanged. A configured client ID alone never enables the path.
- Google OAuth return is registered only at `https://ktour-id.vercel.app/hackathon/zklogin/callback`. Immutable Preview cannot start/prove/cancel a login intended for another origin. Hosted main-origin checks use the already-validated Vercel forwarded-host tuple, not an internal Next URL.
- Existing owned, current operation at delegation is required. The server binds operation/session, CX evidence, credential/presentation, explicit consent, proposal digest, ephemeral public key, nonce, epoch and private configuration digest. No new operation is allocated by login. A maximum of three distinct attempts per operation includes cancelled attempts.
- Exact routes: `POST zklogin/start`, `POST zklogin/prove`, `POST zklogin/cancel`; `GET zklogin/status/{operationId}/{attemptId}`. Legacy unbound proof bodies are rejected. Access/strict body/owned-session checks precede provider work.
- The browser generates the ephemeral private key and randomness. Only the public key goes to the server. The start attempt ID is persisted before sending so a lost response has a known read/cancel handle. Server state and SDK nonce must match before navigating to Google.
- Callback scrubs URL before reading the server attempt or persisting a token. It verifies the exact pending operation, attempt, state, epoch and expiry again, then returns to the same place. Callback performs no proof POST, signing or execution.
- Google ID token is used transiently in sessionStorage, never localStorage, then removed before the one explicit proof POST. An uncertain response/reload can only GET the existing attempt. No automatic replay. Tokens, salts, Google subject claims and ephemeral private keys are absent from the durable attempt record.
- The server checks Google RS256 signature with Node crypto against a fixed, bounded Google JWKS GET; validates issuer, audience, authorized party, nonce, subject and timestamps. The prover response is strictly bounded/parsed. Installed Sui SDK address derivation and `ZkLoginPublicIdentifier.fromProof` bind encoded issuer/addressSeed to the JWT-derived address; this is **not** a substitute for cryptographic ZK signature verification by Sui.
- BN254 proof coordinates use the base field; addressSeed uses the stricter Poseidon scalar field. Expired/cancelled/config-drifted/import-invalid attempts cannot authorize preparation or delegation. Actual service checks repeat after remote signature verification and at issuer/build/submit/broadcast boundaries.
- User-facing Korean/English/Japanese disclosure explains that the ID token is sent to K-Tour ID and the configured connected profile's Mysten public Testnet prover; temporary private key remains on the device. Google wallet authentication is not CX identity, OpenDID verification, or execution consent.
- Current iOS `KTourShell.swift` has only `ktourNative.openOffer/showWallet`, no approved OAuth authentication-session/correlated return. Google is blocked inside that bridge/WK user agent with external Safari/Chrome guidance. This does not claim native Google sign-in or seamless transfer of the native session.
- AI unknown outcomes now show a read-only result check instead of a repeated proposal POST. Existing non-Google sample signer flows remain separately labelled.

## Verification completed

| Evidence | Result | Boundary |
|---|---|---|
| Google public JWKS fixed-endpoint GET, 2026-09-29T16:58:56.313Z | HTTP 200, 2 keys, RS256/RSA, 2048-bit, exponent AQAB | Read-only; no JWT, login or raw keys output |
| Focused attempt/JWKS/provider/client/signing/route/return tests | 51/51 PASS | Synthetic JWTs, proof DTOs, local RSA keys and injected transport; no actual provider/proof/chain writes |
| Actual service signing-boundary suite (wallet owner) | 6/6 PASS | Real service/store transitions; narrow policy/provider fixtures |
| Exact-main-origin callback browser suite | 7/7 PASS | Completely intercepted local HTTP/API/WebSocket; no Production request |
| Connected Google UI browser suite | 6/6 PASS | KO320, JA390, EN1440; explicit initiation, privacy, WK blocked, unknown/reload/cancel, AI read-only recovery |
| Hosted Omni confirmation browser suite (wallet owner) | 5/5 PASS | Separate presentation fixtures; not chain evidence |
| TypeScript | PASS | Current shared tree at source freeze |

Browser screenshots inspected directly:

- `k-tour-id-app/artifacts/qa/google-connected-final/tests-e2e-ktour-google-con-69b97-tion-privacy-context-ko-320-mobile-chromium/google-consent-ko.png`
- `k-tour-id-app/artifacts/qa/google-connected-final/tests-e2e-ktour-google-con-36e69-tion-privacy-context-ja-390-mobile-chromium/google-consent-ja.png`
- `k-tour-id-app/artifacts/qa/google-connected-final/tests-e2e-ktour-google-con-7212f-ion-privacy-context-en-1440-mobile-chromium/google-consent-en.png`

The blank background map in these offline UI captures is deliberate external tile blocking, not a hosted map verdict. Initial connected UI run correctly failed at the private hosted gate because its fixture omitted `modes.sui=testnet`; the fixture was corrected, no product guard weakened. Final six cases passed. Local credential-free server 3174 and browser processes were stopped before the parent release build.

## Still distinct from completed live verification

Parent owns reviewed profile activation/deployment. A human must explicitly log in with their Google account from the supported main web origin. Only that run can establish actual OAuth audience consent, successful proving, final Sui zkLogin signature acceptance and the intended approved transaction. No human login, JWT injection, provider proof, OAuth client-secret use or salt reset was performed in this stream. OpenDID mock/provider status is unchanged; native Google remains unsupported without a separately approved native auth-session transport.

Primary references: [Google OIDC ID-token validation](https://developers.google.com/identity/openid-connect/openid-connect#validatinganidtoken), [Google secure OAuth browser policy](https://developers.google.com/identity/protocols/oauth2/policies#secure-browsers), [Sui zkLogin integration](https://docs.sui.io/sui-stack/zklogin-integration). Installed SDK implementation was checked in `@mysten/sui/src/zklogin/{nonce,utils,poseidon,publickey,bcs}.ts` for nonce/key encoding, field bounds, proof DTO and issuer/address binding.
