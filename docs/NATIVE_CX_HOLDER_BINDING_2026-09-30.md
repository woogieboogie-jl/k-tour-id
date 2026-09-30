# Native CX holder binding: implemented boundary, not a live verification claim

The main app now implements an authenticated real-CX-to-fresh-native-holder protocol. The native submission overlay is based on committed `ac9c2d31a54ccec1de4baa399179a2cd6f0fec09`, not the older shell or uncommitted Claude work. The active native worktree and running infrastructure were not changed.

## Authority and sequence

1. A session-owned V1 provider operation must already hold current real CX person evidence and consent. The browser explicitly starts a ten-minute-or-shorter holder challenge.
2. A separate `bindingVersion: cx-holder-v1` native capability accepts that exact challenge after native user approval. A legacy/synthetic wallet is never upgraded or reset.
3. Native `begin` receives a server-random CAS handle and a rotated private continuation capability. Main uses HTTPS; the explicitly compiled DEBUG-only local profile uses exact `http://127.0.0.1:3183`. The one CAS allocation is durably claimed before I/O. A lost response is reconciled by readback, never a second write.
4. The native SDK generates its holder document and signs the exact challenge. The BFF verifies actual P-256 DIDAuth bytes, sorted JSON and SDK compact signature format. Document controller is the pinned `did:omn:tas`; the authentication key is holder-controlled.
5. After native TA registration, confirmation reads the trusted DID document and the exact activated TA user row, and compares the CAS opaque reference. Only then is the binding verified.
6. Provider issuance resolves the verified binding into the opaque CAS reference plus expected holder DID. The staged issuer patch checks that DID before issuing, and the bridge checks the resulting holder again. Binding cancellation/configuration drift wins over late provider results.
7. Native issue/present calls carry the BFF-confirmed binding ID. Native `submitted` is an untrusted transport acknowledgement, not VC, VP, or execution authorization. Users explicitly refresh the BFF result and separately approve later actions.

No name hash, client bool, self-declared adult flag, raw localStorage operation, or synthetic VC becomes real CX identity. Guide V2 remains unsupported. Japanese passports are not asserted to be CX-supported identification.

## Endpoint contract

`/api/hackathon/v1/operations/:operationId/native-binding/…`

| Action | Authentication | Exact body |
| --- | --- | --- |
| POST start | Main same-origin session | `{}` |
| GET status | Main session | none |
| POST cancel | Main same-origin session | `{}` |
| POST begin | One-time-purpose launch bearer | `{version,bindingId}` |
| POST prove | Rotated private native bearer | `{version,bindingId,didDocument,didAuth}` |
| POST confirm | Rotated private native bearer | `{version,bindingId}` |

The native three routes reject cookies, Origin and browser fetch headers as defense in depth. This is **not app attestation**: possession of the short-lived capability and cryptographic key proof are the actual boundary. All routes pin their explicit profile's origin and reject unbounded/extra JSON. Raw proof, DID, CAS handle and continuation stay native/server-only. Public status is `{version,bindingId,status,expiresAt}`.

## Activation and honest limits

The user-approved scope is now **local OpenDID plus public source submission**, not public OpenDID hosting. Production remains mock OpenDID. The earlier HTTPS-hosted opt-in code is inactive and is not a required next step. It cannot be enabled by the local markers. The separate local profile requires complete configuration:

- `HK_OPENDID_BRIDGE_URL`, `HK_OPENDID_BRIDGE_TOKEN`, `HK_OPENDID_OWNER_BINDING_SECRET`, `HK_OPENDID_TRUSTED_ORIGIN`, `HK_OPENDID_ISSUER_DID`, `HK_OPENDID_SCHEMA_ID`;
- `HK_OPENDID_ADMIN_TOKEN`, `HK_OPENDID_CAS_URL`, `HK_OPENDID_TA_URL`, `HK_OPENDID_DID_API_URL`.

No secret values belong in this document. Local destinations are fixed to the new submission stack below; existing Claude ports 3181/3182/193xx are not used. Hosted loopback remains refused. `/demo`, CAS `retrieve-pii` and admin routes remain loopback/private, not a public deployment. CAS `save-user-info` is protected by the staged gate. The new issuer patch must be built and installed before real holder verification.

## Isolated local execution

The public submission's separate Compose project is `ktour-opendid-submission-20260930`. Its fixed services are TA 19400, issuer 19401, verifier 19402, CAS 19403, wallet 19404, DID gateway 19405, demo 19406, PostgreSQL 19432, Besu 19445 and bridge 3193. No old database, wallet, salt or operational ledger is reset or copied. The native app uses an empty dedicated simulator; existing wallets are not overwritten.

The BFF launcher consumes only a private JSON file in a 0700 directory, mode 0600, owned by the current user, with no symlink or hardlink. The submission config exporter supplies its exact fields from the new local stack and creates new local owner/identity HMAC seeds. `HK_CX_API_KEY` is optional: the approved hackathon CX server configuration did not require a key. Do not invent one or copy arbitrary environment files.

```sh
cd k-tour-id-app
node scripts/hackathon-native-local.mjs --check /absolute/private/config.json
node scripts/hackathon-native-local.mjs --dev /absolute/private/config.json
```

`--check` performs zero provider calls. `--dev` binds only 127.0.0.1:3183 and rejects dotenv files. It strips inherited credentials and injects both `HK_LOCAL_NATIVE` and `NEXT_PUBLIC_HK_LOCAL_NATIVE` as `local-native-20260930-v1`. Only development mode is admitted; every Vercel key and mixed hosted/Redis/AI/chain credential is refused by the runtime guard. Next's internal `localhost:3183` representation is admitted only with exact agreeing Host/forwarded-host/protocol headers; browsing a localhost alias is not allowed.

The build output is `.next-native3183`, with its own TypeScript config. State is `.data/native-binding-3183/journey.json`, namespace `ktour:local-native:3183:v1`, 0700 directory/0600 fsynced atomic file and distinct `ondo_hk_native3183` cookie. Origin/profile are included in the holder-binding digest. Losing or changing this namespace is not an invitation to recreate a wallet. Preserve it and inspect the existing request.

### Human steps; no automatic provider execution

1. Open the DEBUG native app built from the submission's explicit local manifest. It must show `http://127.0.0.1:3183/hackathon`; a Release build does not advertise local binding.
2. Open the designated experience and read/accept its purpose consent. Begin CX only by explicit click, then complete the supported Mobile ID app's human consent. A QR being displayed is not identity verification. A passport alone is not a supported CX identity method.
3. Return to the same operation and explicitly fetch the CX result. Only the actual server-validated person evidence enables the fresh-wallet connection.
4. Choose the native holder connection, read the native consent, create a PIN in the new empty wallet and approve the challenge. Never reset or convert an existing synthetic wallet to bypass a refusal.
5. Return and fetch the server binding status. Native `submitted` is not approval. After the server confirms the exact DID/CAS/TA binding, separately request issuance and explicitly open the native offer. Fetch the BFF result afterward. Repeat explicit consent/result checking for VP.
6. The local flow stops at server-confirmed VC/VP. AI, Google/Sui signing, OmniOne writes and merchant benefits are unavailable here. Production's separate CX/AI/chain journey is unchanged.

If registration is uncertain, stop and check the same request. No automatic replay, key deletion, wallet reset, ledger reset or synthetic fallback is provided. A human Mobile ID confirmation and actual native issuance/presentation remain unperformed until that person completes these steps.

The first implementation is fresh-wallet, single-operation binding. An uncertain native registration never silently deletes keys or repeats registration. Existing-wallet reuse, post-crash native reconciliation and binding renewal require a separately verified recovery flow; current UI stops and offers server status, not a synthetic fallback. No human CX approval, physical-device registration, real VC issuance/VP, or live service grant was performed in these tests.

## Verification at implementation time

- Main focused tests: actual offline P-256 verification; strict transport; provider bounded I/O; scoped route admission; durable claims, expiry, cancellation and late results; legacy native/provider regression.
- Staged bridge: 104/104 offline tests passed, including required expected-holder forwarding.
- Staged issuer patch: applied and compiled against pinned runtime classes offline.
- Staged CAS/admin gate: 476/476 Java rule checks passed. Nothing installed or restarted.
- Native peer: Foundation DTO/HTTP intercepted checks and actual Xcode simulator compilation reported separately in the submission evidence. This is not live native E2E.

The final browser/full-suite counts are recorded in the coordinating release handoff, not inferred from these source checks.

Local follow-up verification: 60/60 focused transport/crypto/provider/local-policy/storage/launcher checks, 2/2 actual route + service + isolated file-store scenarios (only network/cookie ports synthesized), and TypeScript passed. The real 3183 server returned config 200 with `nativeBindingConfigured=true`, `opendidProviderReady=false`, chain/redemption false; disallowed Google params returned 403. These were GET-only checks, not provider authentication. Four mobile/desktop native-binding fixture browser cases passed; the long modal is now bounded to the app canvas, preserving its close button while its body scrolls.

The subsequent first-action audit found and fixed a local-only navigation issue: first consent tried the production JIT reuse endpoint, which is intentionally unavailable in this isolated profile. The local profile now uses its own single operation's real CX step; production JIT reuse is unchanged. Four additional mobile/desktop fixture checks cover first consent without automatic provider start and the stop before AI/chain execution. Finally, two **actual local UI** rehearsals navigated place → experience → purpose consent → identity-start screen, then cancelled their empty identity-phase operations. Four new local sessions (development effect replay) and two cancelled operation rows were created; there was no provider identity evidence, holder binding, VC or VP. Both real screenshots were inspected. Human authentication is still unperformed.
