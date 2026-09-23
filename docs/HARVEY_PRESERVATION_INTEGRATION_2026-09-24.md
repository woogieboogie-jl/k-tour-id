# Harvey 최종본 보존 통합 · 2026-09-24

브랜치: `integration/harvey-preservation-20260924` · 로컬 작업, 원격 push/배포 없음.

검수한 앱 코드: `c386fddc` (이후 문서/테스트 실행 설정 커밋과 구분).

## 범위와 기준

- 사용자 결정: **통합/회귀 검증 먼저**, 추가 UX 고도화는 이후. OpenDID 실연동은 native holder 작업 때 진행한다. 이를 OpenDID 구현 완료나 가점 충족으로 표시하지 않는다.
- 9/24 원격 `JSHan94/k-tour-id:feat/hackathon-integration-harvey` 최종 커밋은 `f4526af3ecd35b73459776bd3b8e8c18dd245a0d`. 현재 브랜치의 조상임을 확인했다. 이미 병합되어 있어 중복 병합하지 않았다.
- 기존 모바일 UX와 9/23 콘텐츠→지도/Hot·Cool 목업은 보존한다. 이번에 새 상품/체인 기능을 추가하거나 기존 v1 혜택 사용을 v2 가이드 저장으로 바꾸지 않았다.
- Move 소스·테스트, OmniOne Solidity 계약, pnpm lockfile은 하비 기준 SHA-256과 동일하다. Sui SDK `2.31.0`, ethers `6.17.0`을 유지한다.

## 이번에 재현하고 수정한 문제

| 문제 | 수정 및 보존 경계 |
|---|---|
| 브라우저 Back 뒤 승인 창이 남고, 늦은 prepare 응답으로 submit을 시도 | Back/Forward에서 즉시 창을 닫고 지연 서명·제출을 차단. 이동을 서버 취소나 체인 rollback으로 취급하지 않는다. |
| Google 로그인 문서 왕복 후 원래 장소 상세·검색/카테고리/list 맥락 유실 | 제한된 UI 상태만 sessionStorage에 보관하고 동일 장소/도시·유효 TTL일 때 복원. 승인·JWT·서명·개인키를 이 복귀 정보에 넣지 않는다. |
| OmniOne 동시 재확인에서 중복 제출 시도 | durable worker claim과 소유권 검증으로 같은 outbox의 제출을 한 작업자로 제한. 공유 Redis일 때 인스턴스 간 보장. |
| registry 일치만으로 receipt 없는 확정 표시 | transaction receipt·block·payload 대응이 있어야 확정. 기존 무증거 confirmed도 해당 건 재조회 시 정정하며 서비스 혜택 사용 결과는 유지. |
| 방송 타임아웃 뒤 해시 유실 또는 불확실한 재전송 | 기존 calldata/type 0/gas 설정으로 서명한 거래의 해시를 방송 전에 저장. 방송 전 실패만 준비 재시도, 방송 후에는 같은 해시 조회. |
| OmniOne 오류가 인증된 RPC URL 등을 담을 가능성 | OmniOne SDK 오류를 공개 상태에서 일반 오류로 축약. 격리 모드의 차단 오류는 기존 계약대로 보존. Sui 등 모든 provider 오류의 전수 redaction 완료를 뜻하지 않는다. |

## 검수 결과

최종 고정 production build2 기준. 개발 서버 HMR이나 과거 빌드 결과를 최종 결과로 합산하지 않는다.

| 검사 | 결과 | 무엇을 검증했는가 |
|---|---|---|
| Production build / TypeScript | 통과 | full-stack API·callback 포함 빌드 |
| 앱 contract | 947/947 통과 | 기존 앱 계약 + 배포 프로필/하비 원본 해시 보존 |
| 해커톤 unit | 69/69 통과 | CX 검증 경계·Sui 증거·격리·저장소·서명 샘플 |
| OmniOne 독립 회귀 | 27/27 통과 | 실제 service/adapter 제어 흐름 + 무해한 provider/ethers fixtures. 경합·서명 전 실패·방송 timeout·해시 일치·지연 응답 |
| 브라우저 최종 선택 회귀 | 76/76 통과, 실패/skip 0 | 아래 선택 파일을 고정 build2에서 재실행 |

브라우저 선택 범위: 기존 Harvey 28, 신규 Back/OAuth/오염·만료 복귀 6, 기존 discovery 16, 실제 격리 BFF 4, 모바일 UX 12, 충전/환불 목업 2, sheet corner paint 모바일/데스크톱 8.

신규 6개는 기본 `test:harvey:e2e`에도 포함했고 해당 명령으로 34/34 재통과했다. 이는 위 76개에 포함된 검사이며 중복 합산하지 않는다.

독립 검수: 구현과 별개로 백엔드 리뷰어가 adapter 내부 preflight/늦은 해시 유실을 반박했고, 방송 전 해시 저장과 오류 단계 분리로 보완했다. 프런트 리뷰어는 기존 빌드에서 Back/OAuth 3개 실패를 재현한 뒤 수정본에서 재검증했다. 별도 검토로 복귀 정보의 비밀값/권한 혼입 여부와 하비 계약 원본 해시도 확인했다. 초기 실패를 삭제하거나 skip으로 바꾸지 않았다.

로컬 증거: `k-tour-id-app/artifacts/qa/harvey-preservation-build2-final`, `harvey-existing-build2-final`, `harvey-preservation-mobile-final`, `harvey-preservation-desktop-final`. discovery 최종 결과는 `/tmp/ktour-discovery-preservation-build2-final-20260924`에 있다. PNG/trace는 로컬 산출물이며 Git 업로드하지 않는다. OAuth 복귀/Back 및 320px 장소 상세 PNG도 직접 검토했다. 외부 타일을 차단한 fixture 스크린샷은 실제 지도 타일 품질의 증거가 아니다.

각 검증의 한계:

- browser provider fixture 완주와 실제 로컬 BFF는 다르다. BFF는 자체 서명 샘플로 제안까지 진행하고 실제 Sui 실행 경계에서 차단된다.
- 신규 실제 CX 인증, Google OAuth/prover, Sui/OmniOne 거래를 발생시키지 않았다. 과거 하비 거래 링크를 이번 통합본의 실환경 완료 증거로 대체하지 않는다.
- Chromium 검수이며 Safari/실기기 전체 검수는 아니다. Sui Move CLI는 이 환경에 없어 Move test를 새로 실행하지 않았다. 소스 보존 검증을 Move 실행 테스트라고 부르지 않는다.
- HTTP 확인: `/` 200, `/hackathon` 307, callback/API config 200, production `/ondo-b/labs/discovery` 404. 로컬 config는 `isolatedMock=true`, 체인 실행 비활성이다.

## 실행·배포 시 지킬 계약

```sh
cd k-tour-id-app
pnpm build:harvey:local
pnpm start:harvey:local
# 다른 터미널
pnpm test:harvey:unit
pnpm test:harvey:outbox
pnpm test:contracts --workers=4
pnpm test:harvey:e2e
pnpm test:harvey:bff
```

- 로컬 실행기는 실제 환경변수/비밀값을 상속하지 않는다. 별도 `.env`를 넣어 실환경 실행기로 사용하지 않는다.
- 실제 연동 배포는 `vercel.hackathon.json` full-stack 프로필이다. 기본 `vercel.json`의 map-only standalone 빌드를 쓰면 해커톤 API/callback이 없다.
- 프런트와 API는 **같은 revision**으로 배포한다. 하비의 구형 공개 API에 신형 UI만 붙이지 않는다.
- full-stack에는 `NEXT_PUBLIC_HK_ENABLED=1` + `HK_API_ENABLED=1`이 필요하다. 실환경에서는 `HK_ISOLATED_MOCK=0`과 실제 provider 설정을 별도 적용한다. 현재 예제의 `HK_ISOLATED_MOCK=1`은 안전한 로컬 기본값이다.
- multi-instance 운영은 공유 Redis를 사용한다. 파일 저장소는 단일 프로세스 로컬용이며 Vercel 임시 파일을 durable store로 간주하지 않는다.
- OpenDID는 이번 단계에서 `mock`을 유지한다. CX/두 체인을 연결해도 전체 DID 실연동 완료로 표시하지 않는다.

## 아직 완료라고 말하지 않는 것

1. 같은 통합본으로 실제 CX 휴대폰 인증→결과 payload/CI 검증→복귀. 서울 region 지정만으로 성공을 가정하지 않는다.
2. 실제 사용자 zkLogin→위임 PTB→agent 실행→서비스 결과→동일 건의 OmniOne receipt를 한 환경에서 대조하는 live E2E.
3. 거래 해시 저장 직후 방송 전에 프로세스가 종료된 경우의 자동 재방송. 중복 전송을 피하기 위해 상태를 조회 대기로 유지한다. 이전 unknown/no-hash 건도 임의로 재전송하지 않는다.
4. OpenDID native holder/issuer/verifier 실구현, 실 금융·예약, 추가 UX 전역 개편, 원격 push/공개 배포.

**현재 완료 판단의 범위는 코드 통합 및 선택한 로컬 회귀 검증이다. 실환경까지 완벽하게 통합됐다는 판정은 별도 live E2E 이후에만 한다.**
