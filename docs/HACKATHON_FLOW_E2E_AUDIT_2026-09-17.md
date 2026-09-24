# 해커톤 필수 흐름 E2E 점검 · 2026-09-17

## 결론

**현재 통합본을 ‘해커톤 조건 충족 / 실제 전 여정 완료’로 표시하면 안 됩니다.** 화면 목업은 대부분 연결되지만 실제 OpenDID는 미구현이고, 최종 제품 계약과 Harvey의 구현 계약이 다르며, Sui 검증·복구에 보완점이 있습니다. 실제 로컬 서버에 연결한 브라우저에서도 거절·발급 재시도 오류를 재현했습니다.

- 대상: 로컬 `integration/harvey-sync-20260917`, 앱 코드 `60a3c8356aa629f0c8c70307e819ddb96cef5b48`.
- 포함된 Harvey upstream: `b151c745` + `84254d24`. 이번 감사에서 새로운 원격 변경을 가져오거나 운영 배포를 검사하지 않았습니다.
- 실행: `http://127.0.0.1:3137`, production build, `isolatedMock:true`. CX/OpenDID는 sample, AI는 rule, Sui/OmniOne/zkLogin 외부 실행은 차단.
- 실제 신분증 제출·OAuth 로그인·체인 거래·배포·push 없음. 앱 코드 수정 없음. 감사 문서·테스트·재현 도구만 추가/변경했습니다.
- 공식 조건 조사, backend 반대 검토, UI E2E를 독립적으로 수행하고 실제 BFF 결과와 대조했습니다.

## 1. 공식 조건과 팀 범위

| 구분 | 기준 | 현재 확인 |
|---|---|---|
| DID 공식 필수 | 모바일 신분증 활용 제품/서비스 | 실제 CX 기기 왕복·검증 증거가 이번 검사에는 없음 |
| DID 선택 가점 | OpenDID 5%, OmniOne Chain 5%, 합계 최대 10% | 팀에서는 둘 다 필수로 선택. 단순 자체 서명 VC는 OpenDID 실활용 증거가 아님 |
| Sui 기술 | 배포된 Move 핵심 로직, zkLogin/PTB/Walrus/DeepBook 중 2개 이상, Agentic AI, AI 데이터 기원·변조 검증 | 팀 선택은 zkLogin+PTB. 코드 존재와 실여정/서명/체인 증거를 구분해야 함 |
| 제출/지원 자격 | DID 제출물, Sui 별도 등록·최종 제출·공개 코드/README·기술 요약·수상/참여 자격 | 팀 접수 상태와 최종 제출 증거는 미검증. 테스트 통과가 참가·지급 보장은 아님 |

공식 근거: [DID 안내](https://opendid.org/hackathon/2026/) · [Sui 지원 프로그램](https://mystenlabs.notion.site/2026-AI-1-1-Sui-2c76d9dcb4e980c4ba47c9c81dd1564a) · [DeepSurge 등록처](https://www.deepsurge.xyz/hackathons/d3da2166-edab-4af2-b750-4c8d29f4b12a). Sui 원문은 공개 read-only Notion 응답으로 별도 확인했습니다. ‘상금 두 배’ 또는 지급 확정으로 표현하지 않습니다.

실제 충전·결제·환불·예약·브리지는 이번 최소 연동 대상이 아닙니다. 금융 목업이 동작해도 DID/Sui 필수 여정의 증거를 대신하지 않습니다.

## 2. 흐름별 E2E 판정

| 흐름 | 이번에 직접 확인한 범위 | 충족 판정 / 남은 일 |
|---|---|---|
| 지도 → 장소 → 공개 가이드 | JA 320px에서 무료 읽기·비인증 상태·선택 저장 진입·취소 복귀 | 공개 읽기/선택 저장 목업 통과. 실제 backend 연결과는 별개 |
| 선택 저장 → 신원 확인 | 명시적 동의, 시작/취소, 실패·만료 DTO 후 재시도; 실제 로컬 sample API | **부분 확인.** 실제 모바일 신분증 앱 호출·복귀·검증된 동일인 매핑 필요 |
| OpenDID 패스 발급·보관 | 실제 로컬 암호 서명 sample 발급/holder ack; 정상 화면 진행 | **실연동 미구현.** provider 경로는 `opendid_provider_unimplemented` 503. 중간 통신 실패 후 재시도도 실패 |
| VP 제시·거절 | sample 정상 서명, 위조 claim/holder 거절, fixture 거절/재요청 | **오류 재현.** 최초 ‘제시 안 함’은 실제 서버 409. 실제 OpenDID verifier·철회 조회도 필요 |
| AI 제안 → 명시 승인 | rule 제안, 제안 실패 재시도, 승인 체크, 새로고침으로 승인 자동 복원 안 함 | **부분 확인.** 실제 모델 제안·범위 밖 출력 거절·체인 provenance 대조 증거 필요 |
| zkLogin → 사용자 PTB → Agent Move | fixture에서 수동 서명/실행 구분; 실제 BFF는 체인 경계에서 503으로 안전 중단 | **실행 미검증 + 검증 로직 보완 필요.** 실제 zkLogin 서명, pinned package/network PTB, 정확한 event/intent/commitment 확인 필요 |
| Sui 결과 → 최종 자격 → 내 패스 저장 | fixture 혜택 사용 1회, 완료된 서버 레코드의 idempotency 재조회 | **제품 계약 불일치.** backend는 혜택 사용 v1이며 가이드 v2 컬렉션 저장이 아님. 최초 실제 commit은 이번 검사에서 미실행 |
| OmniOne 기록 → 확정 → 같은 장소 | fixture pending/confirmed 분리·기록 재시도 시 사용 재실행 없음·원 장소/포커스 복귀 | **실체인 미검증.** 같은 업무의 실제 event/receipt/commitment 및 장애 복구 증거 필요 |

### 서로 다른 두 흐름

- 승인된 제품: `save-neighborhood-guide-to-pass` / `ktour-neighborhood-guide-save-v2` → 패스 컬렉션 저장.
- 현재 Harvey BFF: `redeem_demo_entitlement` / `hk-identity-perk-v1` → `redemptions` 레코드.
- 이는 이름만 바꾸면 되는 차이가 아닙니다. VP purpose, 제안·동의 digest, Move commitment, 검증된 수신자, DB 결과, 패스 재열람까지 맞춰야 합니다. 기존 v1 승인을 v2 저장 동의로 재사용하면 안 됩니다.

## 3. 실제 브라우저에서 재현한 결함

### BFF-DECLINE · 패스 제시 거절 실패

재현: 장소 → 동의 → sample 신원 확인 → 패스 받기 → **Don't present**.

- 기대: 거절 기록 후 다음 단계 차단, 사용자가 안전하게 복귀.
- 실제: HTTP **409**, `phase / presentation not requested`. 화면도 해당 기술 오류를 그대로 표시.
- 원인: UI는 제시를 누를 때만 request를 생성하지만, `presentationDeny`는 request가 이미 있어야 동작합니다.
- 근거: `k-tour-id-app/features/ondo/hackathon-b/hackathon-layer-b.tsx:177`, `:188`; `k-tour-id-app/lib/hackathon/service.ts:235`.
- fixture의 거절 성공은 이 서버 계약 결함을 잡지 못했습니다. fixture 통과를 실제 거절 성공으로 집계하지 않습니다.

### BFF-ISSUE-RETRY · 발급 후 통신 중단에서 복구 실패

재현: 실제 sample 발급은 완료시키고 holder acknowledgement 네트워크 요청만 1회 차단 → **Get pass** 재시도.

- 기대: 동일 VC 응답 envelope 반환 → holder ack 재시도 → presentation 단계.
- 실제: 첫 요청과 재시도 모두 HTTP 200이지만 재시도는 `{result, vc}`가 없고 bare operation을 반환. UI에 `Cannot read properties of undefined (reading 'credential')`, issuance 단계에 잔류.
- 근거: `k-tour-id-app/lib/hackathon/service.ts:155`, `:161`; `k-tour-id-app/features/ondo/hackathon-b/hackathon-layer-b.tsx:171`.
- 두 결함은 브라우저+실제 로컬 BFF로 재현했으며 chain/provider 호출은 없었습니다. 자동 재현 도구는 결함이 남아 있으면 exit 1을 반환합니다.

## 4. 실연동 활성화 전 보완할 사항

아래는 **코드 검토 결과**이며, 실제 체인 공격/장애를 발생시켜 재현한 결과는 아닙니다.

| 우선순위 | 문제 | 완료 조건 / 소스 |
|---|---|---|
| P1 | 실제 OpenDID 발급·holder·verifier 미구현 | provider 발급/보관/VP/상태 검증 왕복 구현. `adapters/opendid.ts:54`, `:94` |
| P1 | v1 혜택과 v2 가이드 저장 계약 불일치 | 승인된 v2 action/campaign, 검증된 사용자/pass, 실제 컬렉션·재열람 연결. `config.ts:13`, `service.ts:435` |
| P1 | Sui 증거의 업무 바인딩 부족 | grant/intent/campaign/recipient/action/consent/manifest 모두 일치해야 완료. `adapters/sui.ts:147`, `:175`; `service.ts:411` |
| P1 | unknown 복구가 불완전한 증거로 executed 표시 | `uses=1`만으로 승격 금지. matching digest/effects/events/record 확보 후 진행. `service.ts:511`, `:515` |
| P1 | durable intent 저장보다 mint가 먼저 발생 | 두 탭/서버 중단/timeout에서도 하나의 intent·발급으로 수렴. `service.ts:309`, `:313`, `:315` |
| P1 | zkLogin 표시값을 client 입력에서 가져옴 | 실제 signature scheme/proof 확인. Ed25519 서명에 `signer:zklogin`을 붙여도 거절해야 함. `service.ts:275`, `:316` |
| P1 | live 환경에서 mock 신원/VC의 체인 진입 방지 부족 | provider evidence policy로 sample 유입 차단. 로컬 isolation 보호와 별도. `adapters/cx.ts:87`; `service.ts:268` |
| P1 | 최종 자격 재확인이 cached status에 의존 | consume 뒤 revoke/expiry/status 장애에 실제 사용 차단. freshness/fulfillment deadline 적용. `service.ts:418`; `config.ts:21` |
| P1 | Move revoke가 실제 서비스 경로에 연결되지 않음 | service/API/PTB revoke 및 revoke/consume 경합 처리 추가. 실행 취소·자격 철회·이미 소비된 권한의 상태를 구분. `service.ts:498`; `move/ondo_entitlement/sources/entitlement.move:192`(저장소 루트) |
| P1 | CX CI 없을 때 동일인이 새 subject가 될 수 있음 | 같은 사람의 재인증·다른 세션/지갑에서도 campaign 1회 정책 유지. `adapters/cx.ts:125` |
| P2 | 제시 거절·발급 중단 복구 오류 | 위 두 실제 BFF 재현 검사 통과 |
| P2 | file/Redis 손상·lock 및 체인 receipt 복구 검수 부족 | 손상 시 ledger 초기화 금지, 다중 instance/장시간 lock/재시작 검사; 복구된 OmniOne 결과의 tx/block 증거 확보. `store.ts:86`, `:107`, `:117`; `service.ts:463` |
| P2 | 신원 실패의 사용자 설명 부족 | `op.error` 원인을 사용자 언어로 노출. fixture는 재시도 버튼만 확인 |

위 표의 backend 파일 경로는 `k-tour-id-app/lib/hackathon/` 기준입니다.

## 5. 수락 검사 A01–A20 대응

**부분 확인은 해당 수락 검사 전체 통과를 뜻하지 않습니다.** 외부 실연동을 포함하는 A02/A13은 이번 환경에서 완주하지 못했습니다.

| 검사 | 판정 | 근거 / 미검증 경계 |
|---|---|---|
| A01 미확인 진입 | 목업 확인 | 공개 읽기와 선택 저장/동의 분리; 실제 live 권한 정책 별도 |
| A02 전체 실연동 | 미완료 | OpenDID 미구현, Sui/OmniOne 비실행, v2 미연결 |
| A03 CX/VP 취소 | 부분 실패 | fixture 취소 통과, 실제 BFF의 제시 거절 409 |
| A04 만료/철회/status 장애 | 부분 | 만료 DTO 화면만 확인; 실제 provider status/철회 필요 |
| A05 증명 위조 | 부분 | sample claims/holder 및 client verifier 위조 차단; 실제 DID issuer/audience/nonce 전체 검사 필요 |
| A06 목적/범위 재사용 | 부분 | proposal digest·동의 UX 확인; 다른 intent/campaign 증거 바인딩 보완 필요 |
| A07 중복/두 탭 | 부분 | 이미 commit된 seeded 레코드 재조회만 확인; 최초 사용·동시 mint·동일인 재검증 미완료 |
| A08 timeout/restart/reload | 부분 실패 | 완료 이후 UI reload 통과; 발급/ack 중단 재시도 실패, 체인 unknown 복구 결함 |
| A09 실제 앱 cold return | 미검증 | 로컬 화면 복귀/포커스는 통과. 실제 기기 외부 앱 복귀 아님 |
| A10 권한/CSRF/return | 부분 | service 다른 세션 조회 거절 확인. HTTP CSRF/임의 return/session fixation 전체 점검은 아님 |
| A11 OmniOne 장애/중복 | 부분 | fixture 기록 재시도와 isolated pending만 확인. 실제 RPC/receipt 복구 필요 |
| A12 공개자료/mock 주입 | 부분 | 이번 검사 외부 mutation 없음. live evidence policy와 제출 bundle/log/영상 감사 필요 |
| A13 zkLogin+PTB+Agent | 미검증 | 실제 validator-accepted zkLogin·거래 증거 필요. client signer label은 증거 아님 |
| A14 범위 밖 agent/PTB | 미검증 | Move 검사는 존재하지만 CLI 미설치로 이번에 실행 못 함. malicious tx/model 입력 검사 필요 |
| A15 subject/campaign 1회 | 보완 필요 | 세션 기준 operation, mint 전 durable reservation 부족, CI fallback 점검 필요 |
| A16 취소/prover/epoch/gas/network | 부분 | UI 승인 취소·Google/demo 구분만 확인; 실제 장애별 검사 필요 |
| A17 chain unknown/재시작 | 보완 필요 | 불완전한 evidence로 executed 승격 및 재발급 위험 |
| A18 consume 후 자격 무효 | 보완 필요 | cached credential 상태·revoke 경로·최종 deadline 보완 필요 |
| A19 다른 receipt/두 체인 | 보완 필요 | event type만으로 부족; 업무 필드 일치와 chain별 증거 필요 |
| A20 provenance 변조/제출물 | 미완료 | 실제 manifest↔attestation 검증, 1필드 변조 재현, 공개 제출물/등록 확인 필요 |

## 6. 이번 실행 결과와 재현

| 검사 | 결과 | 정확히 증명한 범위 |
|---|---|---|
| Harvey 브라우저 fixture | 16/16 통과 | EN390·JA320 dark·KO390 dark, 수동 동의·취소·실패 DTO·완료 후 reload·audit retry·장소 복귀. API 응답 합성 |
| 실제 로컬 BFF 정상 경로 | 1/1 통과 | sample crypto → proposal → Sui 경계 503 → 취소/복귀. 전체 체인 성공이 아님 |
| 실제 로컬 BFF 결함 재현 | **2/2 실패** | 제시 거절·발급 중단 재시도 수락 조건 실패; exit 1 |
| 공개 가이드 v2 UI | 2/2 통과 | JA320 무료 읽기/선택 저장/Pass 재열람/포커스. 브라우저 로컬 목업 |
| backend isolation | 9/9 통과 | 로컬 암호 검증·위조 차단·외부 실행 차단·seeded 완료 재조회·file rollback·pending outbox |
| Move build/test | 미실행 | 현재 PATH에 `sui` CLI 없음. 존재하는 Move test 파일을 실행 통과로 집계하지 않음 |
| 실제 CX/OpenDID/zkLogin/체인 전 여정 | 미실행 | 실제 사용자/기기/공급자 설정·구현과 testnet 실행이 필요 |

앱 폴더에서 이미 실행 중인 **isolated** `:3137`을 대상으로 실행합니다:

```sh
pnpm test:harvey:unit
pnpm test:harvey:e2e
pnpm test:harvey:bff
node scripts/hackathon-bff-audit-local.mjs
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3137 pnpm exec playwright test tests/e2e/ktour-public-guide-visual.spec.ts --project=mobile-chromium --workers=1
```

증거는 `k-tour-id-app/artifacts/qa/` 아래에 있으며 Git ignored 로컬 결과입니다:

- `harvey-integration-fixtures/results.json` 및 fixture 스크린샷.
- `hackathon-flow-audit-20260917/bff-audit.json` — 실제 실패 2건. 외부 실행 없음은 isolated 서버 설정·요청 차단에 근거하며, provider의 transaction 계측값은 아닙니다.
- `hackathon-flow-audit-20260917/bff-presentation-decline.png`.
- `hackathon-flow-audit-20260917/bff-issuance-retry.png`.
- `hackathon-flow-audit-20260917/public-guide/` — 공개 가이드 UI 스크린샷.

기존 실체인 smoke script는 이번 검수에 사용하지 않았습니다. mock 설정이 포함되어 있어도 체인 transaction을 발생시키므로 로컬 격리 E2E와 혼용하지 않습니다.

## 7. 다음 완료 순서

1. 두 BFF 결함 수정, v2 action/campaign/컬렉션 결과 계약 일치.
2. OpenDID 실제 발급·holder·VP 경로 구현, CX 실기기 확인 및 안정적인 subject 바인딩.
3. Sui signer 검증·정확한 증거 바인딩·durable intent·unknown 복구·revoke 서비스 경로/경합·최종 자격 검증 보완.
4. 동일 operation으로 실제 CX → OpenDID → 모델 제안 → zkLogin/PTB → Agent Move → 컬렉션 저장 → OmniOne 확정 → 패스 재열람/장소 복귀를 기록.
5. A01–A20의 미검증·실패 항목을 재실행하고 제출용 receipt·영상·공개 소스·등록/제출 상태를 최종 확인.

기존 인계 명세는 이번 감사 때문에 임의로 축소하거나 완료 처리하지 않았습니다. 본 문서는 구현 변경 요청이 아닌 현재 상태 점검 결과입니다.
