# OpenDID 병렬 워크플로 연계 계약·인수 기준 — 2026-09-28

## 1. 목적과 현재 상태

OpenDID는 취소하거나 제거한 기능이 아니다. 별도 워크플로에서 진행 중인 issuer/holder/verifier
구현을 현재 앱에 안전하게 연결하기 위한 **소스 기준 인계·인수 명세**다. 이 문서를 작성한 것으로
제공자 구현, native 실행, 실제 VC 발급/VP 검증 또는 전체 E2E가 완료된 것은 아니다.

현재의 `credential`/VP 검사를 유지한다. CX 성공만으로 Sui를 허용하는 우회 경로를 만들거나
샘플 서명을 OpenDID 제공자 증거로 바꾸지 않는다. 기존 공개 지도, CX-only Preview,
Sumsub Sandbox와 별도 보호 통합 환경의 경계도 유지한다.

기준 소스는 이 worktree의 [서비스](../k-tour-id-app/lib/hackathon/service.ts),
[OpenDID adapter](../k-tour-id-app/lib/hackathon/adapters/opendid.ts),
[DTO](../k-tour-id-app/lib/hackathon/types.ts),
[자격 검증](../k-tour-id-app/lib/hackathon/operation-evidence.ts)이다.
아래 HTTP 경로는 **우리 앱 BFF**이며 OmniOne의 공식 API 경로가 아니다.
제공자 릴리스별 URL, SDK 호출, DID 해석 방식, 서명 suite, status 규격은 여기서 추정하지 않는다.
병렬 팀이 실제 구현에서 채택한 규격·릴리스와 비민감 계약 fixture를 기준으로 adapter를 연결한다.
사용자에게 비밀값이나 새 계정을 다시 요구하는 문서가 아니다.

현재 구현상 한계:

- `HK_MODE_OPENDID=opendid`의 `issueCredential`, `verifierRequestOffer`, `verifierConfirm`은
  `opendid_provider_unimplemented`로 실패한다. URL 설정만으로 작동하지 않는다.
- `presentationSubmit`의 실제 제공자 분기는 거절하며, `credentialEligibility`는 현재
  `mode: "mock"`만 검증한다. 이 실패 경계는 실제 검증기가 준비되기 전까지 유지한다.
- `verifierRequestOffer({ operationId }) -> { offer, verifierRef }`,
  `verifierConfirm(verifierRef) -> "pending" | "verified" | "failed"`는 미구현 내부 함수다.
  미래 구현은 단순 상태 문자열만 신뢰하지 않고 아래의 서버 보관 결합 증거를 확인해야 한다.
- mock은 서버 샘플 issuer 키와 브라우저 WebCrypto holder 키로 실제 암호학적 검사를 하지만,
  신뢰 루트는 샘플이다. native holder나 제공자 VC 검증을 대신하지 않는다.

## 2. 기존 앱 API와 데이터 계약

기본 경로는 `/api/hackathon/v1`. 변경 요청은 same-origin 검사와 서버 세션에 결합된다.
operation은 `sessionId`에 소속되며 다른 세션의 ID를 가져와 재개할 수 없다.
서버의 `OperationResult.revision`, `status`, `phase`, `allowedActions`, `safeNextAction`을
UI의 기준으로 삼는다. callback query나 브라우저 저장값은 권한 판정 결과가 아니다.

| 앱 경로 / 메서드 | 현재 요청 | 현재 응답 / 의미 |
| --- | --- | --- |
| `POST /sessions` | `{}` | 세션 cookie 설정. 응답의 짧게 표시된 session ID는 인증 수단이 아님 |
| `GET /config` | 없음 | 모드·capability. 현재 `opendidProviderReady: false` |
| `POST /operations` | `{ venueId, consentVersion, locale }` | `OperationResult`; 서버 campaign/policy와 동의 digest 결합 |
| `GET /operations/{id}` | 없음 | 세션 소유 operation 재조회. 제공자 상태 확인 API를 대신하지 않음 |
| `POST /operations/{id}/identity/start` | `{ mobile: boolean }` | CX handoff. 신원 성공을 뜻하지 않음 |
| `POST /operations/{id}/identity/complete` | 실제 CX는 `{}` | 서버 CX 결과 검증 뒤 `issuance`; 실제 모드의 client sample은 거절 |
| `POST /operations/{id}/credential/issue` | `{ publicKeyPem, alg }`; `alg`는 `Ed25519` 또는 `ECDSA-P256` | `{ result, vc, offer }`. 현재 mock은 document 반환, provider는 미구현 실패 |
| `POST /operations/{id}/credential/holder-ack` | `{ signatureB64 }` | holder 서명 검증 후 `holderAckAt` 및 `presentation` 단계 |
| `POST /operations/{id}/presentation/request` | `{}` | `{ result, challenge }`; challenge는 아래 canonical JSON 문자열 |
| `POST /operations/{id}/presentation/submit` | `{ presentationId, disclosed, signatureB64 }` | 현재 mock VP 검사 후 `allow` 또는 거절. provider는 아직 거절 |
| `POST /operations/{id}/presentation/deny` | `{}` | 제시 동의 거절, nonce 소비, operation 취소 |
| `POST /operations/{id}/proposal` | `{ locale }` | 유효한 VP decision 이후에만 AI 제안 |
| `POST /operations/{id}/cancel` | `{}` | 취소 가능한 단계만 취소. 이미 전송/실행 중인 chain 거래를 되돌린다고 표시하지 않음 |
| `POST /operations/{id}/reconcile` | `{}` | 기존 Sui/OmniOne 거래 확인 경로. 현재 OpenDID polling은 구현하지 않음 |
| `GET /operations/{id}/evidence` | 없음 | 기술 요약. provider 원문/전체 VC/키의 전달 경로로 쓰지 않음 |

현재 파서는 `publicKeyPem` 1,200자, `signatureB64` 512자, `presentationId` 64자 상한을
사용한다. `alg`의 비-P256 입력을 Ed25519로 처리하는 현재 동작이나 느슨한 `disclosed` 파싱을
새 provider wire 계약으로 복제하지 않는다. 새 형식은 버전·허용 필드·크기를 명시적으로 검증한다.
위 기존 요청은 브라우저 샘플 holder용이며 native proof를 임의로 이 필드에 끼워 넣지 않는다.
새 provider 시작/조회/복귀 경로가 필요하면 별도 버전 DTO와 허용 route를 추가한다.
현재 native callback URL이나 callback 수신 API가 존재한다고 가정하지 않는다.

공유 DTO 중 유지할 의미:

- `CredentialSummary`: `credentialRef`, `vcId`, `schema`, `mode`, `issuerDid`, `holderBinding`,
  `serviceAccess`, `validFrom`, `validUntil`, `statusRef`, `status`, `holderAckAt`.
  현재 status는 `active | revoked | expired | unknown`; provider의 suspended 등 미매핑 상태를
  `active`로 축약하지 않는다. 거절/unknown으로 보존하거나 검수된 DTO 확장을 한다.
- `PresentationSummary`: `presentationId`, `nonce`, `requestDigest`, `requestedClaims`, `expiresAt`,
  `submittedAt`, `verifiedAt`, `decision`, `decisionRef`, `decisionExpiresAt`,
  `decisionConsumedAt`, `denyReason`.
- 서버 `OperationRecord.secrets.presentationBinding`은 `operationId`, `presentationId`, `nonce`,
  `credentialRef`, `vcDigest`, `holderBinding`, `requestDigest`, `decisionRef`, `subjectRef`를 결합한다.
  현재 mock용 `vcDocument`/PEM 키 필드와 provider evidence는 구분해 버전 관리한다.
- `IdentityEvidence`는 현재 CX 전용(`source: "cx_mobile_id"`, `mode: "mock" | "cx"`)이다.
  Sumsub Sandbox status를 이 타입의 실제 CX identity로 위장하지 않는다.

## 3. holder acknowledgement와 challenge의 정확한 기존 형식

현재 서버/브라우저의 `canonicalJson`은 객체 키를 재귀 정렬하고 배열 순서는 유지하며
공백 없이 JSON 직렬화한다. `digestOf(value)`는 그 UTF-8 문자열의 SHA-256을 `0x` hex로 표현한다.
이는 **우리 샘플 계약**이다. provider의 원본 proof canonicalization으로 사용할 수 있다는 뜻이 아니다.
제공자 서명 검증은 채택한 suite가 규정한 원본/정규화 규칙을 따른다.

현재 holder ack의 서명 원문:

```ts
canonicalJson({
  typ: "ondo-kpass-holder-ack/v1",
  credentialRef: credential.credentialRef,
  vcId: credential.vcId,
  holderBinding: credential.holderBinding,
})
```

샘플 `holderBinding`은 `digestOf({ spki: publicKeyPem, alg })`다. Ed25519 또는
ECDSA-P256/SHA-256(P1363 형식) 서명을 base64url로 받는다. ack는 지정 credential에 대한
holder 키 소유/수신 확인이며 **서비스 실행 승인이나 Sui 서명은 아니다**.
native DID/키와 샘플 PEM의 동일성을 임의 가정하지 않는다. provider holder proof로 mapping할 때는
발급 transaction·credential·검증된 holder 키/DID·해당 operation/세션에 묶인 신선한 서버 challenge를
서버에서 검증하고 수신/보관 확인의 의미를 합의해야 한다. 단순 `stored: true` 응답은 불충분하다.

현재 presentation request의 challenge:

```ts
canonicalJson({
  presentationId, nonce,
  audience: "ondo-hackathon-verifier",
  purpose: "redeem_demo_entitlement",
  venueId, campaignId,
  requestedClaims: [
    "schemaVersion", "personVerified", "serviceAccess",
    "validUntil", "policyVersion", "statusRef",
  ],
  expiresAt,
})
```

현재 mock holder의 VP 서명 원문:

```ts
canonicalJson({
  typ: "ondo-kpass-vp/v1",
  presentationId, nonce,
  audience: "ondo-hackathon-verifier",
  purpose: "redeem_demo_entitlement",
  venueId, campaignId, vcDigest, disclosed,
})
```

`disclosed`는 요청한 claim의 부분집합이고 VC 원문 값과 같아야 한다는 것이 현재 mock 검사다.
provider 연결에서는 **업무가 요구하는 predicate가 실제 검증 결과에 모두 존재하는지**도 확인한다.
누락된 필수 claim, 빈 제출, client가 추가한 `__verifierConfirmed`/`verified`는 성공 근거가 아니다.
성인 여부가 업무 요건이면 별도로 검증된 adult 결과를 요구한다. `personVerified`만으로
성인·체류·결제 자격을 추론하거나 요청되지 않은 개인정보를 더 수집하지 않는다.

## 4. 제공자 구현이 충족해야 하는 서버 검증 계약

다음은 **구현해야 할 인수 조건**이지 현재 동작을 설명하는 것이 아니다. 병렬 native/제공자 팀과
앱 담당자가 실제 릴리스 규격으로 결합한다. 사용자에게 새 설정값을 요청하는 체크리스트가 아니다.

| 경계 | 성공으로 저장하기 전 필요한 증거 | 실패/불명 상태 |
| --- | --- | --- |
| Issuance 완료 | 사전에 저장한 발급 request/transaction과 결과 일치, 승인된 issuer 신뢰 루트/키·서명 suite, VC schema와 정책·identity subject·holder 결합, 유효기간·status 검증 | offer 생성/앱 열림/다운로드 시작만으로 active credential 생성 금지 |
| Holder 수신/소유 | 동일 credential와 operation에 결합된 holder 소유 증명, 실제 holder 저장 lifecycle의 검증 가능한 acknowledgement | 브라우저 boolean/native 성공 문자열만으로 `holderAckAt` 기록 금지 |
| VP 검증 | 서버가 만든 nonce/request, 지정 verifier audience·purpose·venue·campaign·policy, 검증된 issuer/holder, 동일 VC/ref/digest, 필수 predicate, proof 무결성, 상태와 유효기간 | 다른 request의 성공 receipt, 서명만 맞는 다른 credential, client-supplied verifierRef를 수용하지 않음 |
| Status | 채택 릴리스의 인증된 status/revocation source, 같은 VC/statusRef/issuer와 결합된 조회 결과 및 검사 시각 | revoked/suspended/expired/unknown, 응답 불명·과도한 캐시·오프라인은 권한 허용하지 않음 |
| Decision 저장 | 검증 request의 저장 snapshot/revision이 여전히 유효하고 같은 세션·operation·subject·holder인지 재검사; nonce 1회 소비·결과 저장 원자성 | 취소/만료/새 challenge 뒤의 늦은 결과는 옛 operation을 되살리지 않음 |

서버 전용 증거에는 최소한 provider 릴리스/환경, 발급·verifier transaction의 opaque ref,
기대한 issuer와 holder 결합, credential ref/digest, operation/identity evidence 결합,
challenge/request digest, 검증 policy version, status 검사 시각/유효기한, 검증 결과의 근거를 보존한다.
이는 필요한 의미 목록이며 provider의 공식 필드명/응답 예제를 지어낸 것이 아니다.
외부 응답에서 반환된 URL/DID/key/status endpoint를 무제한 따라가지 않고, 선택한 환경의 신뢰 정책과
네트워크 허용 범위로 검증한다. 서버 인증된 결과 조회 또는 검증된 서명 증거가 필요하며,
callback이 도착했다는 사실 자체는 검증 성공이 아니다.

현재 `HK_TTL`은 identity/credential 24시간, VP request/decision 각각 5분,
grant 10분, operation 1시간, fulfillment 15분, `statusFreshnessMs` 60초다.
특히 status freshness 상수는 현재 provider 상태 조회를 구현했다는 증거가 아니다.
연결 시 실제 provider 만료·정책을 우선하고 서비스 TTL과의 **최솟값**으로 허용 창을 제한한다.
UTC 유효한 시각만 받고 `NaN`, 미래 `validFrom`, 경계 시각의 만료를 거절한다.
미래 provider status 검사는 오래된 요약의 `status: "active"`만 읽지 않도록 다음 지점에 연결한다:

1. credential 발급 완료/holder 결합 및 VP 허용 판정 전.
2. Sui entitlement 발급·위임 prepare, 사용자 서명 submit, agent 실행 직전.
3. 서버 fulfillment 최종 판정 전. 상태가 나빠지면 이미 발생한 체인 사실은 보존하되 혜택 확정을 막는다.

외부 조회 동안 전역 Redis lock을 계속 잡지 않는다. 먼저 중복 방지용 request/claim을 영속화하고,
제한된 외부 I/O 뒤 revision/phase/claim을 다시 확인해 원자적으로 commit한다.
불명 결과의 재개는 저장된 provider transaction을 조회한다. 응답 유실만으로 발급을 반복하지 않는다.

## 5. Native launch / resume / cancel

현재 [브라우저 holder](../k-tour-id-app/features/ondo/hackathon-b/hackathon-client.ts)는
샘플 키/VC를 탭 sessionStorage에서 관리한다. 별도
[identity holder 화면](../k-tour-id-app/features/ondo/identity-b/identity-holder-step-b.tsx)도
샘플 수신 UI다. 어느 쪽도 native 지갑 설치·실제 보관 완료의 증거가 아니다.

- **Launch:** 사용자의 명시적 탭으로 발급/제시를 시작한다. operation과 단계, 서버 request,
  한번 쓰는 state/nonce, 만료와 허용 복귀 대상을 서버에 결합한 뒤 실제 릴리스의 지원 handoff를 연다.
  앱 미설치/지원 불가에는 재시도·돌아가기 선택을 제공한다. 성공으로 처리하지 않는다.
- **Link 검증:** 사용할 OS link/scheme/domain/path는 병렬 native 구현과 확정하고 allowlist한다.
  이 문서는 임의 custom URI를 정하지 않는다. 임의 `returnUrl`, 다른 origin/frame 메시지,
  타 operation state를 받지 않는다. URL/history/log/analytics에 VC/VP/JWT/키/PII를 넣지 않는다.
- **Session 결합:** native 앱을 열어도 웹 operation의 소유 세션을 바꾸지 않는다. 별도 브라우저나
  OS process 복귀를 지원할 경우 검증된 짧은 수명의 단회 pairing을 설계한다. HttpOnly cookie를
  복사하거나 URL의 operation ID만으로 세션 권한을 이전하지 않는다.
- **Resume:** 복귀 신호는 화면 재개 신호뿐이다. GET으로 서버 operation을 복구하고,
  연결 시 추가할 서버 provider-status 확인 경로에서 동일 저장 request를 조회한다.
  현재 `reconcile`이 이를 수행한다고 가정하지 않는다. foreground/remount/중복 callback은
  자동 VC 재발급, 자동 VP 제출, 자동 AI 승인 또는 Sui 서명을 일으키지 않는다.
- **Cancel/deny:** 사용자가 제시를 거절하거나 발급을 중지하면 해당 request/state의 유효성을
  끝내고 늦은 provider 결과는 권한을 부여하지 못하게 한다. native 닫기만으로 서버 취소됐다고
  표시하지 않는다. 필요시 현재 cancel/deny API를 명시 호출하고 결과를 다시 읽는다.
- **이미 실행 중인 거래:** 현재 `cancel`은 agent/fulfillment 단계 및 미확정 userTxDigest가 있으면
  거절한다. 이 경우 같은 거래를 확인하며, 취소 UI가 체인 거래를 rollback한다고 약속하지 않는다.
- **만료/분실/교체:** credential/offer/challenge 만료, holder 키 분실 또는 다른 지갑 복귀는
  성공 복원하지 않는다. 재발급/재결합은 새 명시적 절차와 policy로 처리한다.
  현재 VP 만료 뒤 단계 되감기/새 presentation 재시도 UX도 자동으로 완성돼 있지 않다.

## 6. 팀별 구현·연계 소유권

| 담당 | 병렬로 준비/구현할 일 | 인수 시 전달할 비민감 결과 |
| --- | --- | --- |
| OpenDID/native 워크플로 | 채택 릴리스의 issuer/TAS/holder/verifier lifecycle, holder 키 보호·보관·제시 UI, DID/key trust와 VC/VP/status 검증, 지원 플랫폼 handoff | 릴리스/환경 식별, 실제 message schema 및 서명 검증 규칙, 비민감 정상/실패 fixture, launch/resume/cancel 관찰 결과 |
| 앱 adapter/BFF | 발급 시작·완료·holder ack·verifier request/status를 operation에 결합, 인증된 서버 검증과 bounded I/O, durable pending/unknown/resume, DTO/error projection | 버전 명시한 내부 계약, fixture 계약 테스트, 개인정보 없는 audit 결과 |
| 앱 자격/chain 통합 | `credentialEligibility`/`presentationEligibility`에 검증된 provider 증거 branch 추가, 단계별 fresh status 조회·expiry/replay/consent checks 유지 | 기존 mock 격리 회귀와 provider 부정 테스트, 같은 operation의 Sui/OmniOne 결합 증거 |
| 공동 통합 | native 복귀/세션 pairing, holder identity mapping, schema/status policy, evidence 분류 및 보호된 한 번의 실제 여정 검수 | 동일 revision·operation에 결합된 실제 발급/제시·동의·거래 결과. 기능별 fixture/provider 구분 |

공동 변경 대상에서 빠뜨리기 쉬운 항목:

- [config](../k-tour-id-app/lib/hackathon/config.ts)의 `opendidProviderReady: false`는
  env 존재 여부만으로 true로 바꾸지 않는다. 완성·검수된 implementation capability와 설정을 함께 판정한다.
- [service](../k-tour-id-app/lib/hackathon/service.ts)의 `execution`은 현재 CX/OpenDID 모드 조합만으로
  정해지는 요약이다. 실제 증거가 아니다. provider branch에서는 서버 검증 provenance를 보존한다.
- [store](../k-tour-id-app/lib/hackathon/store.ts)의 provider request/proof/status 저장 타입,
  [store-integrity](../k-tour-id-app/lib/hackathon/store-integrity.ts)의 새 구조 검증/호환 처리,
  API 공개 projection, 브라우저 native handoff 상태, 안전한 삭제/보존 정책을 함께 변경한다.
  현재 store parser는 컨테이너 shape 검사이며 provider proof의 무결성 검증기가 아니다.
- [submission-evidence](../k-tour-id-app/lib/hackathon/submission-evidence.ts)의
  `credential_supported_verifier`는 현재 mock만 인정한다. 미래 provider 지원 시 이 검사를 삭제하지 않고
  실제 verifier evidence의 검증 경로로 확장한다. `allProvider`의 identity/credential/AI/Sui/OmniOne
  출처 분류 및 `boundaries.mock`도 실제 결과와 함께 대조한다.
- export는 지금도 `offline_snapshot_consistency`, `remoteVerificationPerformed: false`,
  `liveExecutionCertified: false`다. local JSON을 live로 표기해도 원격 진위 인증이 생기지 않는다.
  raw provider proof·전체 VC/VP·DID subject·키·token을 제출 묶음에 내보내지 않는다.

## 7. 인수 테스트 벡터

전부 합성 데이터/격리 fixture로 먼저 검수한다. 아래는 필요한 테스트이며 이 문서 작성으로 통과한 것이 아니다.

| 벡터 | 기대 결과 |
| --- | --- |
| 정상 issuer 완료 → 같은 holder ack → 지정 VP → 별도 사용자 Sui 승인 | 단계별 독립 증거를 저장. ack/VP가 Sui 승인으로 대체되지 않음 |
| offer만 생성 / 앱만 실행 / client `verified: true` | pending 또는 실패 유지, credential/decision 없음 |
| 다른 issuer/key/suite, 변경된 VC/VP, unsupported schema | 검증 거절; mock fallback 금지 |
| 다른 holder/subject/operation/세션의 유효 proof | 결합 불일치로 거절 |
| nonce/audience/purpose/venue/campaign/policy 또는 requestDigest 변경 | 거절, 외부 사용·체인 작업 없음 |
| 같은 정상 제출 재전송 | 같은 request의 기존 판정만 반환, nonce·발급·위임 중복 없음 |
| 다른 submission을 기존 request의 재전송으로 위장 | 새 검증 성공을 부여하지 않음; 기존 판정 replay의 범위/응답을 명시 검수 |
| 필수 predicate 누락/추가 claim/변조된 disclosed 값 | 거절; personVerified에서 adult를 추론하지 않음 |
| revoked/suspended/unknown, statusRef 교체, 과거 active 캐시 | 다음 권한 단계 차단, 보수적인 상태/재시도 표시 |
| validFrom 미래, 만료와 정확히 같은 시각, 잘못된 날짜, decision보다 긴 grant | 거절 또는 유효 창 축소; NaN 비교로 허용하지 않음 |
| 발급/검증 응답이 취소·만료·새 challenge 이후 도착 | 현재 revision/claim 유지; 옛 결과로 phase 복구 금지 |
| 병렬 issue/ack/VP 요청, 프로세스 재시작, 응답 유실 | 단일 request 소유권·동일 결과 재조회, 임의 재발급 금지 |
| native 앱 미설치, OS Back, 이중 callback, 타 origin/state, 다른 지갑 복귀 | 안전한 복귀/실패, 자동 제시·서명·실행 없음 |
| verifier/status 서비스 timeout/redirect/초대형·잘못된 응답 | 제한된 시간/크기에서 실패, token/PII/원문 오류 비노출 |
| VP 이후 권한 철회, Sui 실행 이후 최종 판정 실패 | 기존 거래 사실 보존; 혜택 확정/OmniOne 성공을 꾸미지 않음 |
| mock identity/credential 또는 AI rule가 섞인 실제 chain 실행 | mixed/sample 출처 유지, all-provider 완료 주장 금지 |
| 공개/CX-only/Sumsub Preview에서 credential/chain 시도 | 기존 profile 차단 유지 |

기존 [isolation 테스트](../k-tour-id-app/tests/hackathon/isolation.test.ts)는
provider 미구현 fail-closed와 mock proof 결합의 출발점이다. native 화면 screenshot이나
fixture 통과를 provider 암호 검증/사용자 승인/실체인 E2E 성공으로 합산하지 않는다.

## 8. 완료 게이트와 지금 할 수 있는 준비

이 문서는 API/증거/팀 경계를 고정하는 준비 산출물이다. 현재 provider 분기를 해제하지 않았다.
실제 완료는 다음 게이트를 각각 통과했을 때만 기록한다:

1. 병렬 워크플로의 채택 릴리스·실제 request/result·proof/status 규칙을 비민감 fixture로 재현.
2. 앱 adapter·서버 저장·fresh verifier/status·native 복귀 계약 테스트와 부정/경합 테스트 통과.
3. 기존 credential/VP gates, mock 분리, CX-only/Sumsub 격리 회귀 통과.
4. 보호 통합 환경에서 실제 holder 발급/보관/제시와 서버 판정 확인.
5. 당사자의 별도 명시적 로그인·위임 승인 이후 같은 operation의 Sui→서버 사용 판정→OmniOne
   receipt/event/commitment→장소 복귀를 확인하고 출처별 증거 기록.

provider 입력을 기다리지 않고 할 수 있는 일은 계약 fixture·회귀 테스트 준비,
오류/비밀값 redaction, 잘못된 날짜의 fail-closed 처리, 늦은 비동기 결과의 revision/phase 검사,
서버 설정 이름/역할 읽기 점검, 증거 분류와 UI 복귀 계약 검수다.
이러한 hardening은 기존 검증을 강화하는 작업이며 OpenDID 우회를 뜻하지 않는다.
신규 provider API·서명 suite·native URI를 추정 구현하거나 신원 승인·서명을 대신하는 일은 하지 않는다.
