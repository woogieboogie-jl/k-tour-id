# Main-app OpenDID bridge integration — 2026-09-29

## Exact status (do not describe this as end-to-end production verification)

The main app now has a real server-only `bridge-v1` transport and durable operation lifecycle. Local tests use synthetic HTTP/in-memory providers only; no native/provider/chain writes were made by this work. Claude's native workflow remains separate and unmodified.

Production activation is **blocked**, not complete: there is no approved authenticated CX-evidence → native holder/CAS mapping resolver, and the current native bridge authorizes `redeem_demo_entitlement`, policy version `1`, not the main guide-save action. An environment flag cannot make either contract exist. `providerIntegrationAvailable()` deliberately returns `false`; `HK_OPENDID_CX_MAPPING=verified-evidence-v1` alone does not enable anything. Missing mapping fails with `opendid_cx_mapping_unavailable`; guide/unknown journey scope fails with `opendid_policy_unsupported`.

Reviewed native contract snapshot: `.codex-worktrees/opendid-native-20260928`, HEAD `f906bf2854a2179eef7485228e33ed53481f4738`. It may be concurrently updated by Claude. Source references: `opendid-workflow/contracts/bridge-v1/README.md`, `docs/opendid/INTEGRATION_PROPOSAL.md`, `docs/opendid/RESULTS.md`, bridge `main.ts`, `lifecycle.ts`, and `provider/http-opendid.ts`. The isolated 16/16 report in `RESULTS.md` is prior native-lane evidence, **not** this application's integrated E2E result.

## Implemented modules and boundaries

| Module | Responsibility |
|---|---|
| `k-tour-id-app/lib/hackathon/adapters/opendid-provider.ts` | Exact trusted origin + server Bearer/HMAC-owner binding; strict DTO parsing; 5-second default/10-second maximum request limit covering headers and streamed body; byte limits; no redirects; no mock fallback. |
| `k-tour-id-app/lib/hackathon/opendid-provider-lifecycle.ts` | Durable create-if-absent/idempotency; revision CAS and bounded claims; issuance → presentation → allow/deny; expiry/cancel precedence; late-result rejection; fresh provider credential status before permission. |
| `k-tour-id-app/lib/hackathon/provider-operation.ts` | Main-session ownership, immutable consent/venue/campaign/policy/CX evidence binding; same `withStore` authority boundary; public summary aliases; main operation phase projection; fail-closed mapping/policy gates. |

All native state is stored in **`op.secrets.openDidProvider`**. It must never be spread into a public operation. `providerOperationAction` returns a server-only `record`; the route must use the existing `toResult(record)` projection.

Native VC ID and unkeyed holder binding can be correlated back to a native DID; they stay server-side. Public credential/holder/status/presentation/decision references are operation-scoped HMAC aliases. QR offers are transient action responses only: never written into operation state, audit logs, or evidence. Audit entries contain phase/revision/pending status only.

The public presentation `nonce` and `requestDigest` are **BFF correlation/receipt commitments**. They are not the native proof nonce or a cryptographic VP digest: the current bridge DTO does not expose those. Authority comes from the authenticated, owner-bound bridge decision, the immutable operation binding and fresh ledger status, not a browser-generated proof.

## Server API for root integration

```ts
providerOperationAction(sessionId, operationId, action)
// action: "issuance/start" | "issuance/refresh" |
//         "presentation/start" | "presentation/refresh" | "cancel"
// returns: { record: OperationRecord, provider: { phase, offer: { qrPayload } | null } }

refreshProviderPermission(sessionId, operationId)
// returns: { revision: currentOuterOperationRevision, binding: immutableOperationDigest }

assertProviderPermissionForOperation(record, expectedRevision?)
// Synchronous: use inside the consequential action's durable claim/check.

providerCredentialReason(record, now) // issuance binding, independent of a VP allow
providerPresentationReason(record, now) // VP decision binding/expiry/consumption
```

Empty-body action routes must retain session, origin/CSRF, body-size and access controls. Never accept a browser-provided holder DID, VC ID, provider URL, owner header, identity mapping, provider success flag or operation binding.

Provider requests happen outside the durable lock. Before and after them, CAS checks session ownership, inner revision, owner, enclosing operation cancellation/expiry and immutable operation binding. An outer cancellation/expiry or changed consent/evidence wins over a late successful provider response. The late handle gets best-effort cancel/deny; cleanup uncertainty stays explicit, and cannot reauthorize the operation.

Every consequential action needs a new `refreshProviderPermission` immediately before its phase claim, and a synchronous check in the same atomic authority boundary, including pre-broadcast/final fulfillment. Bind the returned revision with `expectedRevision` or the equivalent exact `assertSnapshot` check. A cached active credential summary is not permission. The snapshot has a maximum 60-second freshness window and still must not replace a new status request for the next action. Provider cancellation is not VC revocation and cannot undo a Sui broadcast; the provider cancel route rejects delegated/agent/fulfillment/done phases and any signed execution.

The root owns route/service/operation-evidence wiring. Those files are outside this module's ownership and should be covered by the full main-app regression suite.

## Environment contract (server only)

| Name | Required value / constraint |
|---|---|
| `HK_MODE_OPENDID` | `opendid` (never downgrade to sample on failure). |
| `HK_OPENDID_BRIDGE_URL` | Approved bridge origin; HTTPS, no path/query/fragment/userinfo. |
| `HK_OPENDID_TRUSTED_ORIGIN` | Exact same separately pinned origin. |
| `HK_OPENDID_BRIDGE_TOKEN` | Server service token, at least 32 printable non-space characters. |
| `HK_OPENDID_OWNER_BINDING_SECRET` | Server HMAC secret of at least 32 characters; rotation invalidates old request ownership. |
| `HK_OPENDID_ISSUER_DID` | Exact expected native issuer. |
| `HK_OPENDID_SCHEMA_ID` | Exact expected native schema identifier. |
| `HK_OPENDID_BRIDGE_ALLOW_LOOPBACK` | Optional `1` for a local-only HTTP loopback fixture; disabled on Vercel. |

Do not paste real values into this document, chat, screenshots, browser bundles, committed files or command output. Native bridge/vendor backends must be reachable over an approved hosted transport before Vercel can use them. Local simulator/loopback availability proves no hosted reachability.

## What Claude/vendor must supply; what remains app integration work

1. **Authenticated CX→holder/CAS mapping**: a approved route/contract that independently binds the current CX evidence reference to the intended native holder and its actual CAS `kycRef`. No deterministic hash of an arbitrary evidence ID is a substitute. Implement a bounded resolver and mismatch/expiry/cross-holder tests before wiring it into the production factory.
2. **Guide-save policy support**: native issuer/verifier must expose or pin `save-neighborhood-guide-to-pass`, correct policy/consent/campaign scope, and tests refusing V1 redemption authority for V2 guides. The main BFF must verify this response/contract before expanding `supportedPolicy`.
3. **Deployment and trust**: bridge HTTPS origin, service credential, HMAC owner secret, exact issuer/schema and durable native storage. Do not activate before the missing contracts are approved; passing environment presence checks is not sufficient.
4. **Holder handoff**: current bridge provides QR/paste only. A same-device URL scheme/universal link and secure return correlation are absent. Do not invent app links or claim that the browser opened a native app; if Claude adds them, define an allowlisted DTO and return/resume tests first.
5. **Real E2E acceptance**: real CX success → bound native issuance → actual native VP allow → fresh active status → user-owned Sui signature → agent action → durable main Pass result → OmniOne receipt readback. Also test cancellation, expiration, cross-holder rejection and revoke/suspend between approval and broadcast. User/device consent remains human-controlled.

## Claude에게 그대로 전달할 문구

> OpenDID native 작업은 기존 `.codex-worktrees/opendid-native-20260928`에서 계속해 주세요. 메인 앱 통합 코드는 별도 `.codex-worktrees/main-journey-20260929`에 있으며, 이 문서와 `k-tour-id-app/lib/hackathon/{adapters/opendid-provider.ts,opendid-provider-lifecycle.ts,provider-operation.ts}`를 읽어 인터페이스만 맞춰 주세요. 상대 워크트리/공유 서비스 파일을 직접 수정하지 말고 변경된 bridge-v1 계약과 검증 결과를 전달해 주세요.
>
> 현재 가장 큰 두 블로커는 (1) **실제 CX evidenceRef → 동일 사용자의 native holder/CAS kycRef를 검증하는 인증된 매핑 계약** 부재, (2) issuer/verifier가 아직 **redeem_demo_entitlement / policyVersion=1**로 고정되어 메인 **save-neighborhood-guide-to-pass**를 승인할 수 없다는 점입니다. evidenceRef를 임의 해싱하거나 synthetic subject를 쓰는 fallback은 금지합니다. 새 가이드 범위는 guideId=roba-neighborhood-guide-v2, campaignId=ktour-neighborhood-guide-save-v2, venueId=mois-0021cd596bc5b2a922ad, consentVersion=ktour-guide-save-consent-2026-09-29-v2, policyVersion=1입니다. 기존 V1 승인으로 V2 가이드를 허용하면 안 됩니다.
>
> 매핑의 요청/응답 DTO, 호출자 인증, 소유자/증거 만료·재사용 규칙, holder mismatch 거절을 명확히 정하고 실제 CAS에 연결해 주세요. 가이드용 issuer/verifier 정책도 서버가 신뢰할 수 있는 계약으로 노출/고정하고 wrong-action/wrong-campaign/old-consent/expired/revoked/suspended/cross-holder 테스트를 남겨 주세요. 확인된 VP만 허용하며 현재 안전하게 지원되지 않는 ZKP로 우회하지 않습니다.
>
> 현재 브라우저는 QR/paste만 지원하는 것으로 이해합니다. 실제 같은 기기 앱 열기/복귀 기능을 만들었다면 URL scheme/universal link, allowlist, operation/owner binding 및 cancel/late-return 동작을 문서화해 주세요. 없으면 QR-only라고 정확히 남겨 주세요. VC ID/holderBinding은 서버용 가명 식별자이므로 프론트 전달/로그 금지, QR도 저장하지 않습니다.
>
> 완료 후 변경 커밋, 실행 명령과 결과, 실제 네이티브·provider 호출 증거, 외부 HTTPS bridge 접근 방법, issuer/schema 식별자 및 비밀값 전달 경로를 알려 주세요. **비밀값 자체는 문서/채팅/커밋에 쓰지 마세요.** 메인 앱 담당이 계약을 검토한 뒤 resolver + V2 정책을 연결하고, 실제 CX → native VC/VP → fresh status → zkLogin 사용자 승인 → Sui → Pass 저장 → OmniOne 수신 확인을 검증할 예정입니다. 단독 native 16/16을 메인 통합 E2E 완료로 표시하지 말아 주세요.

## Reproducible local tests

Run from `k-tour-id-app`:

```sh
node --import tsx --test tests/hackathon/opendid-provider-integration.test.ts tests/hackathon/provider-operation.test.ts
```

Verified result: **37/37 passing** (22 transport/lifecycle, 15 main-operation tests). The suites cover exact DTO/owner/issuer/schema checks, transport timeout/body bounds, redaction, idempotent duplicates, response loss, in-flight cancellation and expiry, immutable operation drift, missing mapping, unsupported guide policy, QR non-persistence, native-correlator aliases, stale/revoked status, consumed decisions and no provider I/O inside the store lock. All fixtures are synthetic; they cannot establish real native/Production integration success.
