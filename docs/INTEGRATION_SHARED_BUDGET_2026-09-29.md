# 기존 체험을 중단하지 않는 Sui 공유 예산

2026-09-29 재검토. 구현·합성 검증과 실제 준비/활성화를 구분한다.
이 문서의 방식은 이전의 전체 구형 writer 차단/원장 이관 방식과 다르다.

## 결론과 고정 범위

기존 체험과 새 가이드는 **동일한 10회 / 총 최대 0.3 SUI / 2026-09-30 23:59:59 KST** 한도를 공유한다.
기존 배포 삭제, 기존 체험 일시중단, 새 예산 발급을 사용자에게 요청할 필요가 없다.
지도·무료 가이드 읽기와도 별개다. 이 준비가 제공자 인증이나 실행 성공을 뜻하지는 않는다.

| 대상 | 역할 |
|---|---|
| `ktour:sui-hosted:20260928:v1` | 기존 체험의 원장과 **유일한 합산 횟수 기준** |
| `ktour:integration-preview:autonomous-20260928:v1` | 새 가이드 operation·세션·결과만 저장 |
| `ktour:integration-cutover:hosted-20260928:v1` | `version: 2`, `shared-reservation` 제어 상태 |

읽기 전용 재조회 당시 기존 원장에는 5개 operation이 있었고, 취소된 3개도 환급하지 않아 남은 횟수는 5회였다.
이는 관측 시점의 수치이며 실행 직전 원장이 항상 최종 기준이다.
현재 승인 기간은 기존 3일 보존 기간 안에 끝난다. 보존 기간/최초 연결 시각/하드 만료 조건이 달라지면 새 쓰기를 거절한다.

## 한 요청이 두 흐름에서 중복 계산되지 않는 방법

1. 최초 준비는 빈 가이드 원장과 제어 상태만 함께 생성한다. **기존 원장은 변경하지 않고, 슬롯도 소비하지 않는다.**
2. 가이드 operation 생성은 가이드 잠금 다음 기존 원장 잠금을 잡는다. 기존 체험은 원래 잠금만 사용하므로 서로 역순으로 대기하지 않는다.
3. 잠금을 얻은 뒤 두 원장과 제어 상태를 다시 읽어 기존 체험의 최신 사용량을 반영한다.
4. 실제 가이드 operation은 별도 원장에 저장한다. 기존 원장에는 소유 세션·신원·실행 권한이 없는 `reserved` 항목 한 개만 추가한다.
5. 구형 코드의 `Object.keys(operations)` 횟수 계산에도 이 항목이 포함된다. 취소/실패/완료 후에도 슬롯을 되돌리지 않는다.
6. 두 잠금 소유자와 세 원본 값을 비교한 단일 Redis 작업으로 저장한다. 충돌·응답 유실은 성공으로 간주하거나 새 슬롯을 자동 발급하지 않는다.

구형 mock 경로에서 새 가이드의 인증 상태를 바꿀 수 없도록 실제 가이드 operation을 기존 원장에 복사하지 않는다.
서명/전송 직전의 소유권·현재 단계·만료·허용된 chain/package/campaign 검증은 그대로 유지한다.
제어 상태가 존재한다는 사실만으로 서명 권한이 생기지 않는다.

## 구현과 검증 범위

- `integration-shared-budget.ts`: 고정 범위, 합산 한도, 회수 불가 예약, 단일 초기화/저장 규칙.
- `store.ts`: 가이드 원장과 기존 원장의 잠금/CAS, 원장 재조회, 실제 operation 소유권에 묶인 서명 권한.
- 기존 one-way cutover v1도 별도로 검증한다. 두 프로토콜의 marker를 섞거나 부분 원장을 복구 명목으로 초기화하지 않는다.
- 현존 hosted 후보의 Git 소스에서 동일 원장 키·한도·3일 보존·발급/사용자 제출/대리 실행의 1회 claim을 확인했다. 배포 metadata만으로 과거 모든 바이너리를 검증했다고 주장하지 않는다.
- 합성 테스트는 동시 구형/신형 요청, 한도 경합, 다른 세션, 원장 누락/위조, lease 유실, 응답 유실, 만료를 검증한다. 실제 사람의 CX/Google/OpenDID 승인이나 체인 E2E를 대체하지 않는다.

실제 준비/배포 ID와 최종 검수 결과는 같은 날짜의 release receipt에 기록한다. 제공자 입력 전에는 새 통합 runtime을 켜지 않는다.

## 읽기 전용 재검토 근거

- `2026-09-29T05:55:43.198Z` 실제 원장 재조회: 기존 5건, 미해결 dispatch claim 0건, outbox 0건, 새 target/control 없음. 원문·session·키·서명은 산출물에 남기지 않았다.
- 같은 프로젝트의 기존 store-key 연결 시각은 Preview `2026-09-28T14:46:41.384Z`, Production `2026-09-28T15:21:33.947Z`였다. 원장 관측값과 3일 보존 규칙은 고정 만료까지 모든 현존 슬롯이 남는다는 조건을 만족했다.
- `2026-09-29T06:04:35.950Z`의 완결된 배포 목록은 156개였다. 이전 157개 snapshot과 다른 시점의 관측이며 우리 작업에서 배포를 삭제하지 않았다. hosted 후보 13개(READY 11, ERROR 2)의 **정확한 Git SHA**별로 키/만료/전체 행 카운트/3일 보존/발급·위임·대리 실행 1회 claim/가스 상한을 대조했다.
- 해당 결과는 저장소의 Git 소스와 Vercel metadata 대조다. 제공자 독립 바이너리 attestation, 관리자에 의한 원장 변조 방지, 실제 통합 성공 증거라고 확대하지 않는다.
- 안전한 상세 snapshot은 `artifacts/main-flow-integration-20260929/SHARED_BUDGET_READONLY_LEDGER_20260929.json`, `SHARED_BUDGET_IMMUTABLE_SOURCE_AUDIT_20260929.json`에 있다.

## 제공자 입력 없이 가능한 빈 원장 준비

담당 엔지니어가 독립 검토 후 실행하는 명령(앱 디렉터리 기준):

```sh
node --import tsx scripts/hackathon-shared-budget-prepare.ts --initialize-empty-target
```

URL·키·원장 경로·임의 scope 인수를 받지 않는다. 고정된 로컬 비공개 Vercel 인증과 기존 release journal을 사용하여 계정·프로젝트·팀·GitHub 연결·기존 Preview/Production store-key binding·동일 Upstash 연결을 먼저 검증한다. 그 다음 target/source 잠금을 잡고 **빈 target/control만 한 번에 생성**한다. source 내용과 10회 한도, 만료, 환경 설정은 바꾸지 않는다.

기존 target/control이 모두 유효하면 재실행은 관측만 한다. 하나만 있거나 서로 안 맞거나 source가 바뀌었으면 자동 복구/초기화하지 않는다. 저장 응답이 유실되면 `outcome_unknown`을 반환하며, 다음 호출에서 현존 상태를 검증하여 중복 생성 없이 확인할 수 있다. 이 명령의 성공은 `prepared: true`, `allocatedNewSlots: 0`, `runtimeConfigurationChanged: false`만 뜻한다. **가이드 runtime 활성화나 제공자 검증 성공이 아니다.**

로컬 검증은 순수 규칙 9건, 실제 store 경로의 합성 Redis transport 7건, 위 operator 경로 10건, 읽기 전용 audit 경로 10건이다. 독립 검토에서 지적된 저장 후 확인 응답 유실도 `confirmation_unknown`으로 구분해 이미 저장된 상태를 실패/미저장으로 오인하지 않게 했다. 외부 Redis 초기화 실행 여부는 별도 receipt로 기록하며, 문서의 명령만으로 실행 완료를 주장하지 않는다.

## 입력 후 엔지니어가 할 일

제공자 설정과 승인된 native 계약 연결 → 현재 원장 검증 → 같은 소스의 내부 검수 → 운영 적용 → 본인 승인/Google 로그인 → 동일 operation의 Sui 실행·Pass 저장·OmniOne receipt 확인.
기존 원장을 초기화하거나 사용자에게 배포 삭제/Redis 편집/환경 flag 변경을 맡기지 않는다.
