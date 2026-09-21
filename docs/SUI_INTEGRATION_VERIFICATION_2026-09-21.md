# Sui Integration Verification — 2026-09-21

검증 대상은 `integration/harvey-final-20260921`의 로컬 통합본이다. 이번 검증은 읽기 전용/격리 실행만 수행했으며, 신규 Sui 거래·서명·OAuth 실사용자·배포·환경변수 값 출력은 하지 않았다.

## 실행 결과

### 실제 공개 체인 이력 (historical, read-only)

```sh
cd k-tour-id-app
node --import tsx scripts/hackathon-readonly-chain-audit.ts --read-only
```

결과: 성공, `newTransactions: 0`, Sui Testnet 공개 과거 거래 3건만 조회했다.

- `4pNNdcruJvmdWyYnSamrh7vxBRCCxWUAwG58uHBP1Wy3`: `EntitlementIssued`
- `EATbwBKz3PqhQRdqkar1VGxVS31eBL9ex3UYjEdudM5W`: `GrantCreated`, `ConsentAttested`
- `CisRR8SYFCxukw8WntxzkxGbrx9Xc19D2Vh96SZgfB4D`: `GrantConsumed`, `ExecutionAttested`
- `ExecutionRecord` 연결 및 shared grant/object ownership 일치 확인
- 연결 record: `0xce1095866585fd01f230517890b0d8bf1d4ddc15bb9f49e12b329b9bb7a2a186`

이 결과는 과거 issuer → grant/consent → consume/attest 이벤트와 객체 스키마 일관성만 증명한다. 현재 CX/OpenDID, 현재 사용자의 zkLogin, 원래 UI 동의, 실제 혜택 사용, OmniOne 확정은 증명하지 않는다.

### 순수 SDK/검증 경계

```sh
pnpm test:harvey:unit
```

결과: **69 passed, 0 failed**. CX/OpenDID fail-closed, issuer 중복 발급 방지, PTB digest 안정성, delegation/execution evidence의 sender/event/object/commitment 검증, redemption idempotency 및 ledger rollback을 포함한다. 모두 통제된 fixture/순수 로컬 테스트이며 실제 provider 또는 Sui 전송 성공은 아니다.

### 격리 로컬 BFF (실제 서버 코드, external disabled)

이미 실행 중인 `http://127.0.0.1:3137`에 대해:

```sh
pnpm test:harvey:bff
```

결과: **4 passed**.

- signed sample pass가 proposal까지 진행하고 `delegation/prepare`에서 HTTP 503 `isolated_mock_external_disabled`로 중단
- challenge 전 decline은 cancel로 종료
- reload 후 holder acknowledgement는 재전송하지 않고 동일 credential 진행
- caller-selected unknown cookie는 회전되고 known session은 재사용

이 BFF 테스트는 외부 host를 차단하고, Sui/CX/OpenDID/OmniOne 호출 및 `delegation/submit`, `agent/run`, `redeem`을 허용하지 않는다. 따라서 Sui 신규 거래 0건이다.

### 브라우저 fixture (synthetic API interception)

`tests/e2e/ktour-harvey-integration.spec.ts`를 올바른 프로젝트명 `harvey-fixture-mobile-chromium`으로 실행했다.

검증 완료:

- HK-FIXTURE-11/12/13: **3 passed** — audit retry 중복 실행 방지, reload/signing 중복 방지, synthetic proof denial 후 fresh request 요구
- dark responsive layout ja 320×568, ko 390×844: **2 passed**
- 선행 실행에서 HK-FIXTURE-01~10도 통과가 관찰되었으나 30초 실행 제한으로 전체 suite 최종 요약은 확보하지 못했으므로 전체 통과로 집계하지 않는다.

Fixture는 `helpers/harvey-fixture.ts`의 가로채기 응답으로 동작한다. UI의 완료/confirmed 상태는 실제 Sui 성공이 아니라 fixture 상태이며, 테스트도 evidence 화면에서 `BROWSER_FIXTURE_NOT_PROVIDER_EVIDENCE`와 `actualTransactions: 0`을 확인한다. 따라서 이 경로의 hardcoded/mock success는 provider 성공으로 표시되지 않도록 설계되어 있다.

## 현재 SDK → service → frontend 경계

- `lib/hackathon/adapters/sui.ts`: issuer 발급, 사용자 delegation PTB 준비/제출, agent consume/attest, RPC effects/events/object 재검증을 구현한다. 실제 호출은 `assertExternalServicesEnabled`를 통과하고 비어 있지 않은 live key/config가 있어야 한다.
- `lib/hackathon/service.ts`: 승인 proposal digest, wallet proof scheme/address, current credential/VP, dispatch claim, unknown/queued recovery, exact grant/record evidence, DB redemption idempotency를 검사한다.
- frontend fixture: 수동 동의·서명 경계, auto marker 무시, reload/decline/retry 및 같은 장소 복귀를 검증한다. fixture API가 실 SDK를 우회한다.
- config: `HK_ISOLATED_MOCK=1`이면 Sui/zkLogin/CX/OpenDID/OmniOne이 비활성화된다. 값은 이번 검증에서 출력하지 않았다.

## 실패/중복/복구에서 확인된 점

- 사용자 승인 전에는 delegation prepare/submit, agent, redeem가 호출되지 않는다.
- 서명 대기 중 동일 operation 재진입은 기존 PTB를 재사용하며, 다른 holder/address로 교체할 수 없다.
- 이미 dispatch claim이 기록되었거나 결과가 unknown이면 자동 재방송하지 않고 reconcile/check-status 경로로 남긴다.
- grant가 이미 consume된 뒤 재시도하면 evidence 없는 새 실행 대신 unknown/reconcile 상태가 된다.
- redemption은 operation/session/subject/campaign에 묶이고 idempotency key와 단일 redemption ledger를 사용한다.
- OpenDID provider 모드와 실제 verifier lifecycle은 `opendid_provider_unimplemented`로 fail-closed이다. client confirmation marker만으로 승격되지 않는다.

## 미검증 및 선행조건

**Sui 단독 실검증과 전체 신원 흐름의 완성을 구분한다.** CX/OpenDID를 명시적인 mock identity/credential로 유지한 채 Sui만 별도 테스트넷에서 실검증하는 것은 가능하다. 실제 OpenDID 구현은 이 독립 검증의 필수 선행조건이 아니다. 다만 격리 모드(`HK_ISOLATED_MOCK=1`)에서는 체인 실행이 차단되므로, 별도로 승인·구성된 환경에서 사용자 승인·서명 범위를 지켜야 한다. 이번에는 그 신규 거래 검증을 수행하지 않았다. 향후 Sui 단독 검증이 통과해도 **실제 CX 인증·전체 DID 기능 완료의 증거는 아니다**.

Sui 단독 실검증에서 별도로 필요한 조건은 다음과 같다.

1. issuer/agent/sponsor 키와 campaign/package/shared-version/gas가 구성된 뒤에만 신규 PTB 서명·방송을 검증할 수 있다.
2. **zkLogin까지 검증하려면** OAuth 사용자, 등록된 Google client ID, zkLogin salt/prover(테스트넷 호환), ephemeral key와 유효한 wallet proof가 필요하다. 다른 서명 방식의 Sui 거래 성공을 zkLogin 성공으로 세지 않는다.
3. 동일 operation의 실제 consume evidence와 DB redemption을 대조해야 한다. OmniOne 감사까지 확장할 때는 해당 registry/receipt를 별도로 확인해야 한다.
4. unknown broadcast/timeout은 digest journal과 RPC/indexer 조회로 재조정해야 하며 자동 재발급·재방송하면 안 된다.

전체 신원·패스 기능의 완료를 주장하려면 별도로 다음을 충족해야 한다.

1. 실제 CX 계정/callback에서 stable subject와 완료 상태를 서버가 검증해야 한다.
2. 실제 OpenDID Issuer/TAS/Verifier 및 holder SDK의 발급·보관·VP·status lifecycle을 구현/설정해야 한다.

Sui CLI는 설치되어 있지 않고 Move `Move.lock`도 없었다. `move/ondo_entitlement/Move.toml`과 소스/테스트는 존재하지만 설치·컴파일은 하지 않았다. 이 문서 작성 외 앱/공유 테스트/설정 코드는 수정하지 않았다.
