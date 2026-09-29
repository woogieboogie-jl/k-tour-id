# 필요한 시점의 본인 확인 — 구현과 검증 경계

이 문서는 로컬 구현/회귀 검증을 설명한다. 배포 완료나 새 실제 모바일 신분증 승인 성공을 뜻하지 않는다. OpenDID native 설정, 제공자 키, 공유 예산, 만료 일시는 변경하지 않았다.

## 사용자 행동별 의미

| 행동 | 서버가 확인하는 것 | 이 확인이 하지 않는 것 |
| --- | --- | --- |
| 패스에서 본인 확인 | 같은 HttpOnly 세션에 연결된 현재 CX 본인 결과, 선택한 목적과 동의 | 공식 신분증/VC 발급, 여권 확인, 결제 KYC |
| 장소의 local moment | 해당 장소·작성 중인 행동의 해시와 `person` 목적에 묶인 일회 행동 확인 | 실제 방문 증명, 업장 승인, 공개 리뷰 발행 |
| Person 정책이 있는 Table 참여 요청 | 등록된 Table과 장소의 일치 + `person` 목적. 현재 등록된 비주류 Table은 계정 조건만 요구하므로 추가 CX를 강제하지 않음 | 예약 확정, 입장 보장, 결제 |
| 19+ Table | 정확한 19세 이상 정책 필요 | CX `AdultVerify`를 19+로 승격하지 않는다. 현재는 요청 차단 |
| 지정된 Roba 체험 경로 | 별도 체험 동의 이후 기존 본인 결과를 같은 장소의 operation에 한 번 연결 | 다른 업장 혜택 생성, Sui 실행 자동 승인, VC/VP/서명 단계 생략 |

야간 지도 설정은 탐색 취향이며 19+ 자격이 아니다. 일본 여권 등 해외 여권은 이 한국 모바일 신분증 경로에서 확인하지 않는다. OpenDID native와 운영 웹의 동일 이용건 전체 연결은 별도 작업이다.

## 현재 본인 증거의 기준

`jitEvidence()`는 같은 세션/주체, `mode=cx`, `source=cx_mobile_id`, 실제 제공자의 `personVerified=true`, 거래 참조, 증거 만료, 원본 operation의 취소/실패 상태를 확인한다. 제공자·엔드포인트·ZKP 정책·주체 가명화 키의 현재 구성 해시까지 일치해야 한다.

- 브라우저 boolean, localStorage, self-declaration, mock 결과는 권한이 아니다.
- 과거 데이터 중 새 구성 해시가 없는 증거는 안전하게 재사용하지 않는다. 필요하면 실제 본인 확인을 다시 한다.
- 성인 목적은 `adultVerified === true`일 때만 허용한다. 성인 결과가 없어도 본인 확인 결과는 별도 축으로 취급한다.
- `person`, `adult`, `age19`, 결제 KYC를 합치지 않는다. 현재 `age19`와 결제 KYC는 지원되지 않는다.

## 요청과 재개

1. `GET /api/hackathon/v1/identity/eligibility`: 상태 조회만. 세션 생성, Redis 쓰기, 제공자 요청을 하지 않는다.
2. `POST /identity/requests`: 정확한 `{action,purpose,venueId,tableId,contextDigest,consentVersion}`. 기존 현재 증거가 있으면 목적별 확인을 만든다. 없으면 승인 대기 요청만 만든다.
3. 필요할 때 `POST /identity/requests/{id}/start {mobile}`: 기존 공유 예산 예약이 durable하게 저장된 뒤 CX 요청을 한 번 생성한다.
4. 사용자가 신분증 앱에서 직접 승인한 뒤 `POST /identity/requests/{id}/complete {}`: 원래 요청의 token/txId/cxId와 현재 서버 상태를 비교한다. 클라이언트가 증거를 제출할 수 없다.
5. 원래 행동의 최종 경계에서 `POST /identity/authorizations/{id}/consume`: 동일 행동·장소·Table·intent 해시를 다시 검증한 영수증을 받은 뒤에만 앱 행동을 진행한다.

상태 복구는 `GET /identity/requests/{id}`, consume 응답 유실은 `GET /identity/requests/{id}/receipt`를 쓴다. consume은 같은 요청/문맥에 대해 같은 receipt를 반환하지만 자동 POST 재시도는 하지 않는다. UI는 receipt/pending intent도 중복 소비하지 않는다.

요청은 최대 10분, 새 행동 확인은 최대 2분이며 원본 증거와 전체 승인 기간보다 길어질 수 없다. 새로 시도할 때는 새 pending intent 해시가 필요하다. 요청 결과가 불명확한 동안 같은 CX 요청을 자동 재생성하지 않는다.

## 예산과 취소

새 CX 요청도 기존 lifetime 최대 **10 operation** 풀에서 한 자리를 차지한다. 별도 무제한 본인 확인 풀을 만들지 않았다. 취소·실패·응답 유실도 슬롯을 반환하지 않는다. Sui 가스 상한 **0.3 SUI**, 기존 고정 만료 **2026-09-30 23:59:59 KST**는 그대로다.

본인 확인 전용 operation은 `kind=identity_check`, 별도 목적 campaign, 일반 여정에 진입할 수 없는 `phase=consent`로 예약한다. 이전 immutable 배포의 일반 identity/issuance/Sui 경로에서도 이 row를 재사용할 수 없다. 현재 API는 이 row를 일반 operation과 perk picker에서 제외한다. CX token은 비공개 요청 저장소에만 있고 완료·취소·만료 시 제거된다.

Roba의 실제 Sui operation은 별도 실행 슬롯을 사용한다. 본인 결과를 재사용한다고 실행 비용 슬롯까지 공유하거나 반환하지 않는다.

## 기존 Roba operation 연결

consume된 `designated_perk/person` grant만 `/operations` 생성의 `identityAuthorizationRef` + `identityContextDigest` 쌍으로 전달할 수 있다. 같은 저장 트랜잭션에서 grant를 정확히 하나의 operation에 연결한다. 해당 operation은 증거를 가져와 `issuance`에서 이어가며 CX를 반복하지 않는다.

이후에도 원본 증거/주체/정책/취소/만료를 다시 확인한다. 본인 결과의 복사본만 보고 실행하지 않는다. 원본이 무효화되면 VC/VP와 Sui 권한 경계에서 중단하며, 이미 시작한 native 요청의 취소·terminal cleanup은 가능하다. 2분 내 가져온 operation은 그 뒤 자체 operation/원본 증거의 기한을 따르며, 2분 지난 grant로 새 operation을 만들 수는 없다.

## 배포 경계

- 현재 hosted CX/Sui 및 기존 integration/guide profile의 명시적 route allowlist만 확장했다.
- 기존 origin, 접근 코드, HttpOnly access cookie, session binding, 고정 deploy/profile/expiry 검증은 유지한다.
- 별도 standalone CX Preview는 새 JIT 경로를 허용하지 않는다. 별도 예산이나 우회 경로가 되지 않는다.
- OpenDID resolver/native 계약/activation, OmniOne signer, Google/Gemini 설정은 이 작업에서 열지 않았다.

## 로컬 검증

모든 아래 검증은 synthetic network 또는 순수 fixture이다. 실제 CX 사용자 승인, 실제 Sui/OmniOne 트랜잭션이나 native 전체 E2E 증거가 아니다.

- `tests/hackathon/jit-identity.test.ts`: 16개. 동시 시작, 주체/제공자/거래/목적 불일치, 취소 경쟁, 성인/19+/KYC 분리, 10건 lifetime cap, 응답 유실, 일회 operation 연결, 저장소 무결성.
- `tests/hackathon/fixtures/jit-authenticated-route.fixture.ts`: 6개. 실제 route → cookie session → CX parser → Redis CAS → reuse → Roba 생성, GET 무쓰기, 타 세션 차단, 취소 후 issuance 차단.
- `tests/hackathon/hosted-sui-routes.test.ts`: 새 경로도 access/body/origin 검증이 session/provider 접근보다 먼저 실행되는지 검증.
- `tests/hackathon/provider-operation.test.ts`: 무효 source는 권한을 차단하지만 native cancel cleanup을 막지 않는 회귀 포함.

```sh
cd k-tour-id-app
node --import tsx --test tests/hackathon/jit-identity.test.ts tests/hackathon/jit-authenticated-route.test.ts tests/hackathon/hosted-sui-routes.test.ts tests/hackathon/provider-operation.test.ts
npx tsc --noEmit --incremental false
```

전체 `tests/hackathon/*.test.ts` 실행 658/658, `tests/hackathon-verification/*.test.ts` 70/70 통과했다. 배포 SHA와 실제 운영 사용자 승인 결과는 별도로 기록해야 한다.
