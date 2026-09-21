# CX · OmniOne Chain 연동 검증 — 2026-09-21

## 결론과 범위

대상은 `integration/harvey-final-20260921`, HEAD `bd514c454dbcee7f641159ea674e3cbe08c0c3ee`의 `k-tour-id-app`이다. 이번 검증은 기존 소스를 수정하지 않은 **로컬·읽기 전용 외부 점검**이다. 새 전용 감사 테스트와 이 문서만 추가했다. OpenDID 실연동 및 Sui 상세 검증은 이 보고서 범위 밖이다.

- **CX 실인증 완료는 미검증**이다. 현재 공개 앱도 `cx: mock`을 선언한다. 서버 어댑터의 엄격한 검증·거부 경로는 통제된 응답 fixture로 검증했다.
- **OmniOne stage의 현재 registry/receipt는 재검증하지 못했다.** 무인증 `eth_chainId` 요청이 HTTP 401이었다. 저장소의 과거 배포 메타데이터와 현재 체인 상태를 동일시하지 않는다.
- 이번 로컬 실행: 기존 Node **41/41**, 실제 격리 BFF Chromium **4/4** 통과. 신규 Outbox 감사는 **5 통과 / 2 실패**로, 동시 dispatch와 receipt 없는 `confirmed` 승격을 재현했다.
- 실제 신분증 인증·개인정보 제출·CX provider POST·OAuth·키 생성/서명·신규 체인 트랜잭션·배포·push는 **모두 수행하지 않았다**. 외부 쓰기는 0건이다.

## 증거의 수준

| 대상 | 이번 관측 | 판정 한계 |
| --- | --- | --- |
| 로컬 `127.0.0.1:3137` config GET | HTTP 200, `isolatedMock: true`; CX/OpenDID mock, AI rule, Sui/OmniOne/zkLogin `disabled-isolated` | 격리 실행 경계 확인. 체인 성공 증거 아님 |
| 공개 `ktourid.vercel.app` config GET | HTTP 200; CX/OpenDID mock, AI rule, Sui testnet, OmniOne stage, zkLogin google | **현재 선언값**일 뿐 provider/체인 접속·서명·영수증 확인 아님. 응답에는 로컬과 달리 `isolatedMock`/`capabilities` 키가 없었으며 배포 소스 revision은 확인하지 않음 |
| OmniOne 공개 기본 stage RPC | 무인증 `eth_chainId` → HTTP 401 | 인증 전 차단. chainId·계약 코드·배포 receipt·업무 receipt 미조회 |
| CX 기본 URL 루트 GET | HTTP 404 | 해당 HTTP 종단까지 접근한 것만 확인. CX API/계정/신분증 인증 성공 아님 |
| 기존 배포 파일 | stage registry 주소·배포 tx·block 기재 | **저장소에 남은 과거 기록**. 이번 네트워크 조회로 재확인하지 않음 |
| Node/BFF/Outbox 테스트 | 아래 결과 | mock/fixture와 실제 로컬 오케스트레이션 검증. 실 CX/OmniOne E2E가 아님 |

CX 루트 404나 OmniOne 401에서 **한국망 전용·국가별 차단이라는 결론을 도출할 수 없다**. 현재 네트워크의 도달성과 API 인증/인가 요건은 별개의 문제다.

## 환경 준비 상태 — 값은 확인·출력하지 않음

현재 도구 프로세스의 다음 변수는 모두 `missing`이었다. 격리 작업트리의 app 폴더에서도 `.env*` 파일명은 발견되지 않았다. 이는 **현재 셸과 이 작업트리의 상태만** 뜻하며, 다른 환경이나 공개 배포의 자격 증명 부재를 뜻하지 않는다. 다른 worktree/home의 비밀 파일을 탐색하지 않았다.

`HK_MODE_CX`, `HK_CX_BASE_URL`, `HK_CX_PROVIDER`, `HK_CX_ZKP_TYPE`, `HK_CX_API_KEY`, `HK_ISSUER_SIGNING_SEED`, `HK_OMNIONE_RPC_URL`, `HK_OMNIONE_CHAIN_ID`, `HK_OMNIONE_REGISTRY_ADDRESS`, `HK_OMNIONE_PRIVATE_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.

격리 launcher는 `.env*`를 거부하고 제한된 환경만 전달하며 새 임시 file store를 사용한다. 따라서 해당 서버의 성공을 자격 증명 있는 실서비스 성공으로 해석하지 않는다. [격리 launcher](../k-tour-id-app/scripts/hackathon-local.mjs), [설정 경계](../k-tour-id-app/lib/hackathon/config.ts#L33).

## 실행 명령과 결과

작업 디렉터리: `k-tour-id-app`. 기존 3137 격리 서버를 사용했으며 smoke/start/deploy 스크립트는 실행하지 않았다.

```sh
node --import tsx --test tests/hackathon/cx-boundaries.test.ts tests/hackathon/isolation.test.ts tests/hackathon/store-integrity.test.ts
```

**41/41 통과, exit 0.** CX 24 + isolation 13 + store integrity 4.

- CX: `verified === true`만 수락, truthy 문자열/숫자/객체 거부, 완료 상태 및 claims transaction 결합, stable CI 누락 거부, malformed 응답과 잘못된 code 거부, 실제 provider 모드의 sample downgrade 금지, 오류의 provider PII 미노출. pending/cancel/expired/failed 코드도 fixture로 확인했다.
- 격리: sample 자격증명/제안까지 실행, 체인 진입 503; 동일 요청 재시도·세션·본문 결합, 최종 자격/중복/동일 operation 증거, 거절·발급 재시도 envelope, outbox pending 및 file rollback을 검증했다.
- Store: 손상 데이터 fail-closed, Redis lock token fencing은 **Redis 응답 fixture**로 검증했다. 실제 Redis 인프라 내구성 검증은 아니다.

```sh
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3137 pnpm exec playwright test tests/e2e/ktour-harvey-bff-local.spec.ts tests/e2e/ktour-harvey-bff-recovery.spec.ts --project=mobile-chromium --workers=1 --output=artifacts/qa/cx-chain-verification-20260921-bff --reporter=line
```

**4/4 통과, exit 0.** API 전체를 가짜 성공으로 대체하지 않고 실제 격리 BFF를 호출했다. 브라우저 외부 HTTP/provider POST는 차단했다.

1. 서버 서명 sample pass → proposal → delegation의 실제 503 거부 → 취소/장소 복귀. Agent/redeem/체인 성공 단계는 실행하지 않았다.
2. Challenge 이전 거절 → BFF 취소 확정.
3. Holder ack 응답 1회를 503으로 가로채는 명시적 실패 fixture → reload → 동일 credentialRef/VC 재발급 응답 → ack/취소. 실제 provider 발급 재시도는 아니다.
4. 호출자가 고른 session cookie 회전 및 정상 세션 재사용.

```sh
node --experimental-test-module-mocks --import tsx --test tests/hackathon-verification/omnione-outbox.audit.test.ts
```

**5 통과 / 2 실패, exit 1.** Node `v25.9.0`의 experimental module mock을 사용했다. [새 전용 감사 테스트](../k-tour-id-app/tests/hackathon-verification/omnione-outbox.audit.test.ts)는 실제 `service.processOutbox`와 file store를 실행하지만 **OmniOne 어댑터의 조회/제출 함수를 전부 fixture로 대체**한다. fetch 및 HTTP(S) 요청을 차단하고 외부 네트워크 시도 0회를 확인했다. ethers 서명·RPC 제출은 실행하지 않았다.

이 파일은 일반 `tests/hackathon/*.test.ts` glob 밖에 있으며, 두 수락 기준을 의도적으로 실패하게 두어 발견된 결함을 숨기지 않는다. 이 감사의 실패를 기존 Node suite가 통과했다는 사실로 덮지 않는다.

| Outbox 검사 | 결과 |
| --- | --- |
| 체인 미설정은 pending 유지, dispatch 없음 | 통과 |
| 제출 후 pending receipt 재조회는 재제출하지 않음; receipt 성공 + registry 일치 확인 후 반복 호출은 무동작 | 통과 |
| receipt 성공 + registry commitment 불일치는 failed | 통과 |
| receipt 실패/전송 timeout은 이미 DB에 확정한 서비스 혜택을 취소하지 않음 | 통과 |
| 기존 eventKey의 다른 commitment는 거부, 추가 dispatch 없음 | 통과 |
| txHash/receipt 없는 registry 발견을 receipt-confirmed와 구별 | **실패: 실제 status confirmed** |
| 같은 outbox의 동시 처리 2회는 제출 1회만 claim | **실패: submit fixture 호출 2회** |

외부 읽기 진단은 Node fetch로 다음 요청만 수행했다. 응답 body나 secret 값을 저장하지 않고 status/허용된 비밀 아닌 config 필드만 기록했다.

```text
GET  http://127.0.0.1:3137/api/hackathon/v1/config                     → 200
GET  https://ktourid.vercel.app/api/hackathon/v1/config                → 200
GET  https://cx.raonsecure.co.kr:18543/                               → 404
POST https://stage-chainapi.omnione.net/                              → 401
     {"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}
```

마지막 POST는 JSON-RPC **읽기 메서드**이며 `eth_send*`/서명/배포 요청이 아니다. 401 이후 registry/receipt 조회는 진행하지 않았다.

초기 비변경 진단 `pnpm exec tsc --noEmit --incremental false`는 exit 2였다. 보고된 오류는 병렬 작성 중인 `app/ondo-b/labs/discovery/page.tsx:3`의 `@/features/ondo/discovery-preview/discovery-preview` 모듈 미발견 1건이다. 이번 신규 감사 테스트 오류는 보고되지 않았지만 **이 초기 실행은 통과로 집계하지 않는다**. 기존 파일은 수정하지 않았으며 작성 담당자에게 전달했다. 기존 tracked diff의 `git diff --check`는 exit 0이다.

**후속 확인:** 지도 파일 작성 완료 후 통합 담당자가 `pnpm typecheck`를 실행해 **exit 0**을 확인했다. 초기 모듈 미발견 오류는 해소됐으며, 이는 아래 Outbox 두 실패의 수정이나 통과를 뜻하지 않는다.

## 구현된 경계와 남은 리스크

### CX — 구현 있음, 실제 신원 검증은 아직 미검증

실제 provider adapter의 trans → app/QR handoff → result → token claims 흐름과 검증 로직은 있다. 완료 boolean과 요청 transaction을 검증하고, CI 없는 결과를 새 txId 기반 사람으로 둔갑시키지 않는다. [CX 전송/오류 처리](../k-tour-id-app/lib/hackathon/adapters/cx.ts#L28), [sample downgrade 차단](../k-tour-id-app/lib/hackathon/adapters/cx.ts#L83), [완료·transaction·CI 검증](../k-tour-id-app/lib/hackathon/adapters/cx.ts#L100).

실인증 수락 전 필요한 조건:

- 공급자가 지원하는 provider/zkpType 및 응답 스키마를 고정하고 실제 계정·허용된 테스트 기기·holder의 명시적 참여로 handoff/result를 검증할 것. 설정 파일의 provider 활성/비활성 주석은 **과거 설명이지 이번 공급자 목록 조회 결과가 아니다**.
- 현재 1인 1회 정책에는 안정적인 CI가 필요하다. `AdultVerify` 응답에서 CI를 실제로 받을 수 있는지 확인해야 하며, 미제공이면 `cx_subject_unavailable`의 **명시적 실연동 blocker**다. 정책을 약화하거나 txId로 우회할 문제가 아니다.
- 실모드에는 sample 기본값이 아닌 관리된 `HK_ISSUER_SIGNING_SEED`와 적절한 보존/회전 정책이 필요하다. 이번 감사는 비밀 값의 적합성이나 공개 서버 설정을 확인하지 않았다. [기본 설정](../k-tour-id-app/lib/hackathon/config.ts#L73).

### OmniOne — 감사 기록 adapter/outbox 있음, 두 복구·동시성 결함 재현

서비스 판단·혜택 사용·outbox 생성은 같은 store transaction에 묶여 있고, 원문 VC/개인정보 대신 eventKey와 비식별 payload commitment를 기록한다. 서비스 DB 결과와 체인 감사 상태도 분리돼 있다. [최종 확정 및 outbox](../k-tour-id-app/lib/hackathon/service.ts#L497), [Solidity 계약 경계](../chain/omnione/DemoEntitlementRegistry.sol#L4).

**P1 — 실체인 감사 제출을 시연하기 전에 해결할 항목**

현재 두 항목은 **재현된 미수정 결함**이다. 이번 승인은 검증 범위였으므로 앱 코드 변경은 하지 않았고, 실패 테스트도 그대로 유지한다.

1. **Outbox 동시 제출 claim 없음.** `pending/unknown` 읽기 → 조회 → 제출 사이에 저장소 claim/lease가 없어 같은 행을 동시 처리하면 어댑터 제출을 두 번 호출한다. [service](../k-tour-id-app/lib/hackathon/service.ts#L526), [실패 재현](../k-tour-id-app/tests/hackathon-verification/omnione-outbox.audit.test.ts#L129). 실제 계약은 eventKey 중복 기록을 거부하므로 **체인에 두 건 저장됐다고 주장하지 않는다**. 그러나 중복 broadcast 시도·불필요한 revert·늦은 실패에 의한 상태 덮어쓰기 가능성은 남는다. Durable claim 및 결과 갱신 fencing, timeout 후 동일 제출의 증거 복구가 필요하다.
2. **Registry 복구를 receipt 확인과 같은 `confirmed`로 표시.** unknown 행에 일치하는 registry 데이터가 있으면 receipt 호출 0회, txHash/blockNumber null인데 confirmed가 된다. [service](../k-tour-id-app/lib/hackathon/service.ts#L531), [실패 재현](../k-tour-id-app/tests/hackathon-verification/omnione-outbox.audit.test.ts#L120). Registry 일치는 기록 존재에 대한 유효한 관측이므로 이를 가짜 기록이라고 부르지는 않는다. 다만 adapter가 명시한 **receipt status 1 AND registry 일치** 의미와 다르다. 원거래/로그/receipt를 복구하거나 `registry_observed` 등 별도 증거 등급으로 표시해야 한다. [확인 정의](../k-tour-id-app/lib/hackathon/adapters/omnione.ts#L5).

**P2 — 지속 운영의 미검증 항목**

- 현재 호출 경로는 redeem 직후 및 operation reconcile에 의존한다. 독립적인 상시/예약 outbox worker 구동은 검토 범위의 소스에서 찾지 못했다. 요청이 없을 때의 자동 회복 SLA는 주장할 수 없다. [호출 지점](../k-tour-id-app/lib/hackathon/service.ts#L513), [reconcile](../k-tour-id-app/lib/hackathon/service.ts#L575).
- `stage` 표시는 설정 존재 여부이며 RPC handshake가 아니다. `chainExecutionEnabled`도 격리 해제 여부이지 모든 키/계약 준비 완료가 아니다. [공개 config 생성](../k-tour-id-app/lib/hackathon/config.ts#L122).
- [과거 stage 배포 메타데이터](../chain/omnione/deploy-info.stage.json#L2)는 `DemoEntitlementRegistry` 주소/배포 거래를 제공한다. 현 RPC 인증이 준비되면 서명키 없이 `eth_chainId`, 계약 bytecode, 과거 배포 receipt, 허용 recorder, 기존 업무 eventKey의 registry/로그/receipt를 **읽기 전용으로 먼저** 대조해야 한다. 이번에는 인증이 없어 모두 미검증이다.
- Solidity의 recorder allowlist·eventKey 중복 방지는 **소스 검토**로만 확인했다. 이번 테스트는 EVM 실행/배포된 bytecode 일치나 Solidity 컨트랙트 테스트가 아니다. [계약](../chain/omnione/DemoEntitlementRegistry.sol#L21).

## 과거 결과와 이번 결과의 구분

[최종 통합 문서](HARVEY_FINAL_INTEGRATION_2026-09-21.md)의 build3/Node 69/UI·BFF 66 및 역사적 Sui 거래 조회 기록은 기존 실행 기록이다. 이번에 그 전체 묶음을 재실행하지 않았으며 CX/OmniOne 실연동의 증거로 전용하지 않는다. 이번 신규 Outbox 감사의 두 실패도 별도 결과로 남긴다.

따라서 사용자에게 안전한 현재 설명은 다음과 같다: **“CX 검증 adapter와 OmniOne 감사 outbox는 구현됐고 로컬 실패·재시도 경계 일부를 검증했다. 공개 CX는 현재 mock이며 실제 CX 인증은 미검증이다. OmniOne의 과거 배포 기록은 있으나 현재 stage receipt 조회는 인증 단계에서 막혔고, outbox의 동시 제출과 receipt 증거 표시를 보완해야 한다.”**
