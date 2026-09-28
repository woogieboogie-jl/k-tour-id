# Sui-only 운영자 실행 경로 — 2026-09-27

## 완료 범위와 현재 상태

기존 Harvey Sui adapter를 호출하는 **로컬 운영자 전용 실행 경로**를 추가했다. 오프라인 명령 재현만 하는 이전 readiness script와 달리, 승인된 환경에서는 실제 `issue → delegate + attest_consent → consume + attest_execution`을 수행할 수 있다. 이번 개발·검수에서는 fixture만 사용했고 **실제 RPC·키 로딩·서명·전송·faucet은 실행하지 않았다.**

현재 ondo 배포에 issuer/agent/sponsor 키가 없다는 앞선 metadata 확인은 그대로다. 키를 찾아 읽거나 배포 환경을 바꾸지 않았다. 따라서 **실제 체인 실행은 아직 미검증/차단 상태**이며 fixture 성공을 온체인 성공으로 표시하지 않는다. 현재 공개 UI/API, CX-only/readonly profile, 서비스·스토어·Move/package/lock 기본 설정은 변경하지 않았다.

이 경로의 identity·VC는 명시적인 fixture이며 사용자 signer는 **기존 테스트 Ed25519 키**다. CX holder 승인, OpenDID, Google OAuth, prover, zkLogin은 수행하지 않는다. Sui 실행 기록이 생겨도 pass·benefit·결제·매장 제공 권한은 부여하지 않는다. `fulfill`, `redeem`, OmniOne, CX, AI 또는 외부 identity provider 호출 경로를 가져오지 않는다.

## 사용 모드

앱 디렉터리에서 기본 명령은 안전한 로컬 설정 확인이다.

```sh
node --import tsx scripts/hackathon-sui-only.ts
node --import tsx --test tests/hackathon/sui-only-runner.test.ts
```

기본 `preflight`는 공개 설정 일치와 키 **존재 여부(boolean)**만 반환한다. RPC/client/signer/store 생성, 키 decode, journal 기록을 하지 않는다. 성공적인 프로세스 종료도 실행 준비/체인 성공 증거가 아니다.

| mode | 실제 동작 |
| --- | --- |
| `preflight` (기본) | 네트워크·서명·저장 없음. 환경값/키 원문 출력 없음 |
| `inspect` | 보호 gate 통과 후 고정 Testnet RPC에서 chain ID, Campaign object/type/shared version을 검증하고 현재 쓰기 준비 상태(활성화·정책·issuer/agent, issuer의 spendable SUI coin balance)를 별도 boolean으로 보고. 서명·journal 쓰기 없음 |
| `execute` | 새 UUID operation만 최대 3거래. 기존 journal이면 결과만 반환하며 새 mint/재전송 없음 |
| `reconcile` | journal에 이미 기록된 첫 미확정 digest만 조회·검증. `unknown`/`submitted`/`preparing` 중 digest가 없으면 조회도 하지 않음. 다음 거래를 시작하지 않음 |
| `resume` | 기존 journal만 허용. 앞 단계가 확인됐고 다음 단계가 **한 번도 claim되지 않은 `new`**일 때만 이어서 실행. `unknown`/`submitted`/`preparing`은 결과만 반환하며 자동 retry하지 않음 |

`execute/resume/reconcile`의 미완료 결과는 exit code `2`, 거절/저장 실패는 `1`이다. 완료된 3단계 또는 읽기 모드 정상 종료는 `0`이다. `complete:true`는 이 fixture Sui workflow의 증거 검증 완료만 뜻한다. 모든 출력에서 `identityVerified`, `zkLoginVerified`, `benefitRedeemed`는 `false`다.

## 실행 전 필요한 승인·설정

로컬 별도 운영자 프로세스만 사용한다. `VERCEL` 설정 또는 `NODE_ENV=production`은 거절한다. 기존 Preview의 isolation을 끄거나 키를 넣어 이 CLI를 우회 실행하지 않는다. `NEXT_PUBLIC_HK_CX_PREVIEW=1`, `NEXT_PUBLIC_HK_PREVIEW_READ_ONLY=1`에서도 거절한다. 이 독립 프로세스의 `HK_ISOLATED_MOCK=0`을 명시해야 한다.

| 환경변수 | 요구 조건 |
| --- | --- |
| `HK_SUI_NETWORK` | 정확히 `testnet` |
| `HK_SUI_GRPC_URL` | 정확히 `https://fullnode.testnet.sui.io:443`; 임의 endpoint 옵션 없음 |
| `HK_SUI_PACKAGE_ID` | `0xc5d26326ffd5267bb5b54625c1e2b9c03f7cca4753232d0b042c62ee74fd975d` |
| `HK_SUI_CAMPAIGN_ID` | `0xe3fce96c9c9e1086ff20dd7453e16ff2c52d3d3324e6e4e34446c7d0dc2ecf16` |
| `HK_SUI_CAMPAIGN_INITIAL_VERSION` | `349181955` |
| `HK_SUI_ISSUER_SECRET_KEY`, `HK_SUI_AGENT_SECRET_KEY` | 승인된 기존 signer. decode한 주소가 committed metadata의 issuer/agent와 일치해야 함 |
| `HK_SUI_SPONSOR_SECRET_KEY` | 생략 시 기존 adapter의 issuer fallback. 지정해도 **issuer와 동일한 주소**만 허용. 임의 sponsor 지출은 범위 밖 |
| `HK_SUI_ONLY_USER_SECRET_KEY`, `HK_SUI_ONLY_USER_ADDRESS` | 승인된 테스트 Ed25519 signer와 정확히 일치하는 canonical address. 자동 키 생성 없음; issuer/agent를 사용자로 재사용하지 않음 |
| `HK_SUI_ONLY_OPERATOR_TOKEN` | 32–256자 운영자 접근 토큰. 채팅·CLI argument·journal에 기록하지 않음 |
| `HK_SUI_ONLY_ACCESS_TOKEN` | 승인된 wrapper가 별도 주입하는 presented token. SHA-256 후 timing-safe 비교 |
| `HK_SUI_ONLY_JOURNAL_DIR` | **미리 준비한** 전용 영속 로컬 디렉터리의 canonical 절대 경로. 소유자 일치·0700, symlink 경로 거절. `/tmp`·`/private/tmp`는 실제 CLI에서 거절 |

키나 토큰을 command line/문서에 붙여 넣지 않는다. 승인된 secret manager/wrapper가 프로세스에 주입한다. CLI는 `.env`, 사용자 wallet config, keychain, cloud credential을 탐색하지 않는다.

운영자가 선택할 비밀이 아닌 옵션 예시는 다음 형태다. 실제 시각·UUID를 정하고, 먼저 `inspect`, 승인 후 `execute` 순으로 사용한다. 아래 placeholder는 그대로 실행할 수 없다.

```text
node --import tsx scripts/hackathon-sui-only.ts \
  --mode=inspect \
  --expires-at=<현재부터 30분 이내 UTC ISO 시각> \
  --gas-mist=10000000 \
  --ack-fixture-identity-demo-signer

node --import tsx scripts/hackathon-sui-only.ts \
  --mode=execute --operation=<새 UUID v4> \
  --expires-at=<현재부터 30분 이내 UTC ISO 시각> \
  --gas-mist=10000000 \
  --ack-fixture-identity-demo-signer
```

고정 허용 종료 시각은 **2026-09-30T14:59:59Z**다. 운영자 승인은 최대 30분, 실제 entitlement/grant는 최초 시작부터 최대 10분이며 승인 만료를 넘기지 않는다. 승인 window를 새로 주입해도 journal의 grant 만료·holder·commitments·gas는 연장/교체되지 않는다.

## 비용·전송·복구 경계

- 거래당 기본 `10,000,000 MIST` (0.01 SUI), 최대 `20,000,000 MIST` (0.02 SUI). 최대 3거래의 gas budget 합계는 0.06 SUI다. 이는 **예산 상한**이지 실제 비용 측정이나 성공 보장이 아니다. 부족한 gas budget은 자동 상향하지 않는다.
- 기존 adapter에 선택적 `gasBudgetMIST`를 추가해 `Transaction.setGasBudget`으로 설정하고 **직렬화된 BCS의 budget이 승인값과 동일한지 서명·전송 전에 검사**한다. 값을 전달하지 않는 기존 앱 호출은 변경되지 않는다.
- chain/Campaign/역할/gas 조회는 쓰기 전에 실시한다. 실제 signer 주소도 별도로 검증한다. Entitlement은 동일 tx의 성공·단일 issuer event·creation effect·정확한 holder/campaign/intent/expiry·object owner/type까지 확인한다. 위임·실행은 기존 shared evidence 검증과 ExecutionRecord 조회를 재사용한다.
- 파일 journal은 앱의 Redis/기존 journey ledger와 완전히 분리된다. UUID당 O_EXCL lock, 0600 JSON, atomic rename 및 file/directory fsync를 쓴다. `preparing` claim을 먼저 저장하고, 실제 bytes에서 계산한 digest를 전송 직전 저장한다. 키·서명·transaction bytes는 journal에 쓰지 않는다.
- 단계 timeout은 최대 45초, 실행 loop deadline은 140초다(앞선 chain 검사 최대 15초/역할 확인 최대 5초 별도). timeout·취소·응답 유실·증거 불일치는 `unknown`으로 남긴다. 만료/취소 후 늦게 도착한 before-broadcast callback도 거절한다. 출력 후 남은 gRPC 요청이 프로세스를 붙잡으면 250ms 뒤 종료한다.
- `reconcile`은 고정 chain/Campaign의 불변 식별자 검증 뒤 저장된 digest만 읽으며 키가 없어도 가능하다. 이미 지출된 gas나 이후 Campaign 비활성화·역할 변경 때문에 과거 증거 복구를 막지 않도록 balance RPC 및 현재 쓰기 readiness 조건을 생략한다. historical evidence 자체는 원래 승인된 issuer/agent/holder/commitment에 계속 묶인다. 재검증된 단계 뒤 **새 단계** 실행은 다시 명시적인 `resume` 승인이 필요하며 현재 활성 역할·남은 단계 gas가 충분해야 한다. hash 없는 unknown은 성공으로 세지 않으며 새 mint/재위임/agent 재전송으로 해결하지 않는다.

### 비정상 종료와 남은 lock

프로세스 강제 종료 시 `.lock`이 남을 수 있다. 자동 lease 만료/lock 탈취/기록 초기화 기능은 없다. lock에는 operation UUID·PID·프로세스 시작 시각만 기록한다.

운영자가 해당 호스트의 프로세스 종료를 PID와 시작 시각으로 확인하고 다른 runner가 없음을 확인한 뒤에만, **그 UUID의 lock 하나**를 별도 보관하여 해제할 수 있다. journal은 삭제하거나 `new`로 되돌리지 않는다. 남은 journal digest로 `reconcile`부터 진행한다. hash 없는 claim이면 중단해 원인을 조사한다. 의심스러운 상태에서 새 UUID로 같은 작업을 반복하는 것은 복구가 아니며 추가 발급을 만들 수 있다. 공유 파일시스템/여러 호스트용 분산 실행 도구로 사용하지 않는다.

## 검수 증거

fixture 검수는 실제 signer/RPC 대신 server-side dependency seam을 사용한다. success·duplicate·잘못된 chain/campaign/role·만료·접근 거절·gas 부족·응답 유실·late callback·concurrent invocation·private file persistence·변조된 journal/receipt·BCS gas binding을 확인한다. 현재 gas=0/비활성화/역할 변경 이후에도 saved-digest recovery만 가능하며 새로운 전송은 거절되는 fixture를 포함한다. 기본 readiness/evidence/digest 회귀와 함께 **42/42 PASS**, TypeScript 검수 PASS. 실제 네트워크 tripwire 호출은 0회다.

별도 비밀값을 상속하지 않은 subprocess(`NODE_ENV=test`만 전달)에서 기본 CLI를 실행했다. exit `0`, `targetConfigured=false`, issuer/agent/sponsor/demoUser 존재 여부 모두 `false`, `rpcCalls=0`, `signatures=0`, `broadcasts=0`을 반환했다. 누락된 환경변수 **이름**만 반환하고 값은 출력하지 않았다. 개발자 쉘이나 Vercel의 실제 키를 읽어 확인한 결과가 아니다.

이 결과는 실제 키 접근, 체인 dry-run, 온체인 성공, live gas 견적 또는 zkLogin 증거가 아니다. 실행 전 독립 리뷰와 승인된 기존 signer 인계가 여전히 필요하다.

변경 파일: [runner](../k-tour-id-app/lib/hackathon/sui-only-runner.ts), [CLI](../k-tour-id-app/scripts/hackathon-sui-only.ts), [focused fixtures](../k-tour-id-app/tests/hackathon/sui-only-runner.test.ts), [기존 adapter의 선택적 budget/callback](../k-tour-id-app/lib/hackathon/adapters/sui.ts).
