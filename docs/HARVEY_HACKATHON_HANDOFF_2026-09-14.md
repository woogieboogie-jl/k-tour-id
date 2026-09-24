# K-Tour ID · 해커톤 연동 개발 요약

**현재 코드:** 하비 최종본 `f4526af3` 보존 통합. [9/24 통합·검수·실환경 한계](./HARVEY_PRESERVATION_INTEGRATION_2026-09-24.md)를 우선합니다. OpenDID 실연동은 native holder 단계로 보류합니다. 아래 가이드 저장 v2 기획과 Harvey 혜택 사용 v1은 별개입니다.

**9/25 UX:** [헤더·검색·스펙트럼](./KTOUR_HEADER_INTEGRATION_2026-09-25.md) · [모바일 제목·여백](./KTOUR_MOBILE_TYPOGRAPHY_IMPLEMENTATION_2026-09-25.md) · [공개 배포 기록](./KTOUR_PUBLIC_UX_RELEASE_2026-09-25.md). API·SDK·체인 명세 변경 없음. 공개 standalone UI와 실제 연동 E2E는 별도입니다.

**변경 이력:** [지도·결제·장소](./KTOUR_UX_REFINEMENT_2026-09-24.md) · [이야기·온도](./KTOUR_STORY_TEMPERATURE_REVIEW_2026-09-24.md) · [모바일 UX 보존](./KTOUR_MOBILE_REFINEMENT_LOCAL_2026-09-16.md).

**실연동 인계:** [9/25 요건·가점·잔여 작업](./HACKATHON_LIVE_READINESS_2026-09-25.md) · [실환경 재현 조건](./HARVEY_RUNTIME_REPRODUCTION_2026-09-23.md) · [가이드 저장 계약](./EXPERIENCE_MOCK_HANDOFF_2026-09-15.md). 공개 가이드·결제·예약은 목업이며 실제 자격·금액 이동을 보장하지 않습니다.

## 1. 목표와 범위

기존 지도 기반 웹앱에 **OmniOne CX + OpenDID + OmniOne Chain + Sui**를 연결합니다. 장소 1곳의 공개 가이드를 읽고, 원하는 사용자가 신원 확인·패스 발급/제시·AI 제안·명시 승인을 거쳐 **내 패스 컬렉션에 저장**하는 여정이 목표입니다. 현재 공개 앱은 목업이며 실제 연결은 개발 대상입니다.

이번 구현은 **신원 확인 경로 1개 · 패스 1종 · 비금전 가이드 저장 1개 · Sui 실행 권한 1종 · OmniOne 감사 이벤트 1종**으로 한정합니다. 실제 원화/스테이블코인 충전·결제·환불, bridge, 상점 예약 API, 여권·외국인등록증 실연동은 목업으로 유지합니다.

네 기술 모두 팀 필수입니다. DID 해커톤 과제와 함께 Sui 지원 프로그램의 **Move 핵심 로직, zkLogin·PTB 실제 통합, Agentic AI의 제한된 실행·provenance**를 구현합니다. 프로그램 등록·최종 제출 자격과 적용 상금 조건은 별도 확인 사항이며, 기술 구현만으로 추가 상금을 보장하지 않습니다.

## 2. 대표 사용자 플로우

```text
지도에서 장소 선택 → 골목 가이드 무료 읽기 (인증·기록 생성 없음)
 → [선택] 내 패스에 담기 → 신원 확인 (CX) → 패스 발급·제시 (OpenDID VC/VP)
 → AI가 허용된 가이드 저장 제안 → 사용자가 대상·수신자·만료·1회 실행에 동의
 → zkLogin·PTB로 제한된 실행 권한 위임
 → Agent가 Sui Move에서 권한 1회 소비 → 실제 Sui 결과 검증
 → 서버가 현재 자격을 다시 확인 → 내 패스 컬렉션에 저장 → 같은 장소로 복귀
                                      └→ OmniOne Chain 감사 기록·확정 조회
```

앱에는 “골목 가이드”, “내 패스에 담기”, “확인하고 저장하기”처럼 행동을 표시합니다. 저장은 컬렉션 항목이며 별도 서명 VC·방문 배지·결제·예약·매장 제공 의무가 아닙니다. 공개 읽기는 반복 가능하고 1회 제한은 저장 캠페인에만 적용합니다.

## 3. 구현할 작업

| 작업 | 구현 내용 |
|---|---|
| **모바일 신분증 확인 · OmniOne CX** | 실제 앱 호출·복귀와 결과 검증을 연결합니다. 서버가 확인 결과를 검증하고 이후 패스와 동일 사용자로 연결합니다. 취소·실패·만료도 처리합니다. |
| **패스 발급·제시 · OpenDID** | 기존 OpenDID 서버와 실제 holder(사용자 지갑)를 활용해 VC 1종을 발급·보관합니다. 장소·혜택 목적에 맞는 VP를 요청하고, 서명·발급자·소유자·만료·철회 상태를 서버에서 검증합니다. |
| **저장 제안·위임 실행 · Sui + AI** | 실제 AI는 허용된 가이드 저장만 제안합니다. 사용자의 zkLogin 서명·PTB로 Agent의 대상·수령자·만료·1회 범위를 제한하고, Move가 권한 소비를 강제합니다. AI 입력·정책/모델 버전·승인·실행 결과의 비식별 provenance와 실제 object/transaction 증거를 연결합니다. |
| **패스 컬렉션 저장 · 서비스 API/DB** | Sui 결과와 현재 DID 자격을 검증한 뒤 같은 사용자·캠페인에 항목 1개를 저장합니다. Sui 권한 소비 자체는 저장 완료가 아닙니다. 자격이 만료·철회됐다면 저장 차단으로 남기되 공개 읽기는 막지 않습니다. |
| **저장 결과 기록 · OmniOne Chain** | 저장 이벤트 1종을 계약에 기록하고 확정을 조회합니다. DB 저장과 체인 상태는 분리하며, 기록 실패는 같은 작업만 재처리합니다. 개인정보·신분증·VC 원문은 체인에 올리지 않습니다. |
| **기존 화면 연결·검수** | 무료 읽기와 선택적 저장을 분리하고 동의·대기·완료·실패를 연결합니다. 외부 앱 복귀/새로고침 때 같은 저장 작업을 조회하며, 이미 저장된 가이드는 컬렉션에서 다시 읽을 수 있게 합니다. |

필요 환경은 CX 테스트 계정·기기/callback, OpenDID 서버·실제 holder, OmniOne 네트워크·배포/서명 권한, **Sui Testnet·Move/SDK·zkLogin OAuth/salt/prover·가스·Agent 키·모델 API**입니다. 제공자별 최신 매뉴얼과 팀 계정을 사용하며, 비밀값은 Git에 올리지 않습니다.

저장 scope는 `save-neighborhood-guide-to-pass` / `ktour-neighborhood-guide-save-v2` / `demo-traveler-pass`입니다. 이전 v1 읽기 승인·기록은 삭제/변환하거나 새 저장 동의로 재사용하지 않습니다. 공개 읽기는 IDB·gate·intent를 만들지 않습니다.

## 4. 완료 기준과 일정

- 실제 기기에서 무료 읽기와 선택적 저장을 시연하고, 동일 저장 건의 CX 검증·VC/VP·zkLogin/PTB·Agent/Move 실행·DB 컬렉션·OmniOne 확정을 확인합니다.
- 취소·잘못된 증명·만료·철회·범위 밖 Agent 요청은 차단합니다. 중복·timeout·재접속은 동일 작업을 조회하고, DB·Sui·OmniOne 상태를 각각 확인합니다. 거래 ID만으로 성공을 표시하지 않습니다.
- 공개 소스·Move build/test·환경 설정·실제 receipt·시연 영상, DeepSurge 등록/제출 확인, Sui 활용 case study를 준비합니다. 실제 연동·목업·미충족 조건을 구분합니다.

**자료 제출 마감: 2026-09-21(월) 18:00 KST**(DID 팀 안내 기준). 기존 목표는 9/17 통합 시연 → 9/18 검수 → 9/20 자료 확정입니다. **Sui 담당·환경·가용 시간을 추가 확인해 실행 일정을 확정해야 하며, 같은 1주 일정이 보장된 것은 아닙니다.** Sui 프로그램의 등록·별도 제출 마감도 확인합니다.

## 5. 참고 리소스

- **앱·소스:** [K-Tour ID](https://ktour-id.vercel.app) · [Harvey 인계 브랜치](https://github.com/woogieboogie-jl/k-tour-id/tree/handoff/harvey-20260914) · [main](https://github.com/woogieboogie-jl/k-tour-id/tree/main). `handoff/harvey-20260914`의 `k-tour-id-app/`에서 시작합니다. 기록상 최신 배포 앱은 `5ba76a2`, 가이드 v2 기준은 `9980472`입니다. 이번 로컬 후속본이나 이후 문서 커밋과 구분하며 원격 최신 상태를 재확인한 것은 아닙니다. [현재 배포·인계 기록](./KTOUR_PRODUCTION_HANDOFF_2026-09-15.md)과 [README 실행 안내](../README.md#run-the-handoff)를 참고합니다.
- **별도 실험:** Sumsub Sandbox는 별도 feature 브랜치·Preview이며 이 릴리스에 포함하지 않습니다. 네 기술의 필수 개발을 대체하지 않습니다. 경로와 검증 한계는 [현재 배포·인계 기록](./KTOUR_PRODUCTION_HANDOFF_2026-09-15.md)에 정리합니다.
- **구현 상세:** [Sui 필수 통합 추가 명세](./HACKATHON_SUI_REQUIRED_ADDENDUM_2026-09-14.md) → [기존 1주 개발 명세](./HACKATHON_ONE_WEEK_SPEC_2026-09-14.md). 기술·보안·제출 요건과 Sui→최종 DB→OmniOne 순서는 추가 명세, 무료 읽기/선택 저장과 v2 scope는 아래 가이드 인계를 우선합니다. 기존 혜택 사용/redeem은 컬렉션 저장이며 읽기 권한이 아닙니다. API는 신규 구현 제안이며 공급자 공식 규격이 아닙니다.
- **가이드 UI 연결:** [비금전 체험 목업 인계](./EXPERIENCE_MOCK_HANDOFF_2026-09-15.md) — 공개 읽기/선택적 저장 v2와 실제 adapter의 대응, 이전 v1 이력의 경계입니다. 금융 목업과 독립이며 실제 인증·AI·두 체인 호출은 없습니다. 버전별 구현·검수 상태는 해당 기록을 따릅니다.
- **OpenDID:** [공식 아키텍처](https://github.com/OmniOneID/did-doc-architecture) · [공식 릴리스](https://github.com/OmniOneID/did-release) — 서버·지갑 구성과 설치 자료.
- **해커톤·CX·Chain:** [공식 해커톤 안내](https://opendid.org/hackathon/2026/) — 가이드북·기술 설명회·제출 자료. 가이드북의 과제 안내 p5·8, 모바일 신분증/CX p19–26, Chain p33–40을 참고합니다.
- **Sui:** [지원 프로그램 안내](https://mystenlabs.notion.site/2026-AI-1-1-Sui-2c76d9dcb4e980c4ba47c9c81dd1564a) · [TypeScript SDK](https://sdk.mystenlabs.com/sui) · [zkLogin](https://docs.sui.io/sui-stack/zklogin-integration/zklogin) · [PTB](https://docs.sui.io/develop/transactions/ptbs/prog-txn-blocks). 상세 요건과 제출 증거는 추가 명세에 정리합니다.
- **전체 제품 참고:** [Deployment Spec](./DEPLOYMENT_SPEC.md) — 이번 최소 연동 이후의 전체 기능·백엔드 요구사항. [9/15 UX 릴리스](./ux-refinement/2026-09-15/RELEASE.md)에는 매장/충전 복귀·환불 내역·사진 변경과 검수/배포 상태를 정리했습니다. 금융 목업은 위 비금전 Sui 실행 흐름을 대신하지 않습니다.
