# 해커톤 실연동 마무리 점검 — 2026-09-25

## 먼저 읽을 결론

**Harvey 코드 통합과 공개 UX 배포는 실연동 완주와 다르다.** 기존 구현을 다시 만드는 것이 아니라, 같은 통합 revision을 실제 환경에서 실행하고 남은 OpenDID 구현을 채워야 한다.

- **공식 필수의 가장 큰 미완료 항목:** 현재 제출용 배포에서 실제 모바일 신분증 인증 결과로 서비스 자격을 결정하고 복귀하는 CX 여정의 증거.
- **OpenDID:** 네이티브 앱 배포만 남은 것이 아니다. 이 저장소의 실제 issuer/holder/verifier 연결도 미구현이다. 공식 OpenDID SDK 자체가 없다는 뜻은 아니다. 앞서 합의한 native 단계로 미뤄져 있으나 가점 충족으로 계산할 수 없다.
- **OmniOne Chain:** 계약·adapter·outbox는 있다. 통합본의 동일 서비스 사용 건과 실제 receipt/registry를 연결한 재검증이 남았다.
- **Sui:** Move·zkLogin·PTB·agent 경로가 있다. 과거 3개 거래 기록은 보존하지만 현재 통합본에서 실제 사용자 승인부터 OmniOne까지 이어지는 새 E2E의 대체 증거는 아니다.
- **AI:** 별도 Harvey 공개 환경은 `ai: rule`. 공식 Sui 조건은 Agentic AI 사례와 provenance 검증이며 특정 LLM 호출을 명시하지 않는다. 우리 팀 명세의 실제 모델 제안→승인→실행과 비교하면 실모델 증거가 남았다. rule이라는 이유만으로 주관사의 탈락 판정을 대신하지 않는다.

오늘은 배포와 감사 범위다. 새로운 provider 설정, 신분증 제출, OAuth 로그인, 키 생성, 서명, 체인 broadcast, 제출·외부 연락은 하지 않았다. 다음 실연동 작업의 범위와 참여 지점을 아래에 정의했다.

## 1. 무엇을 만족해야 하는가

| 분류 | 공식 기준 | 우리 팀의 처리 |
| --- | --- | --- |
| 본 대회 필수 | 모바일 신분증 활용 제품·서비스; Track 2는 비즈니스 모델 기반 MVP 개발·시연 | CX를 채택한 실제 자격 확인 여정을 최우선으로 완료 |
| 가점 1 | OpenDID 활용 5% | 팀 수행 대상. native 단계로 연기됐지만 제외하지 않음 |
| 가점 2 | OmniOne Chain 활용 5% | 팀 수행 대상. 서비스 결과의 실제 기록·확정 증거 필요 |
| 완성도/발표 | 창의성·실현가능성·사업성·결과완성도·협업도 각 20점 | 기능 개수보다 하나의 명료하고 재현 가능한 사용자 여정 |
| 별도 Sui 프로그램 | Move 핵심 로직 Testnet/Mainnet 배포, 지정 기술 중 2개 이상, Agentic AI와 데이터 provenance 검증, 별도 제출 등 | 우리 선택은 zkLogin + PTB. 본 대회의 필수/가점과 혼동하지 않음 |

근거: [주관사 공식 안내](https://opendid.org/hackathon/2026/), [공식 가이드북 p5·8·14](https://opendid.org/download/hackathon/2026/2026%20블록체인%20%26%20AI%20해커톤%20가이드북.pdf?v=20260430), [Sui 별도 프로그램](https://mystenlabs.notion.site/2026-AI-1-1-Sui-2c76d9dcb4e980c4ba47c9c81dd1564a).

두 가점은 합계 최대 10%이며, 링크·설정·mock 성공만으로 자동 인정된다는 규정은 확인하지 못했다. CX는 우리가 채택한 경로이고, 가이드 p21은 정부 SDK 직접 검증 경로도 안내한다. 아래 성공 기준은 공식 주관사의 사전 인정이 아니라 **우리 팀의 구현 수락 기준**이다.

## 2. 현재 두 배포를 구분한다

| 주소 | 9/25 읽기 전용 관측 | 의미 |
| --- | --- | --- |
| `https://ktour-id.vercel.app` | `/api/hackathon/v1/config` → 404 | 기본 `vercel.json`은 공개 지도/UI standalone. 해커톤 API·OAuth callback을 패키징하지 않음 |
| `https://ktourid.vercel.app` | 같은 GET → 200; CX mock, OpenDID mock, AI rule, Sui testnet, OmniOne stage, zkLogin google | 별도 Harvey 환경의 **설정 선언**. 연결 성공이나 현재 통합 소스 revision의 증거 아님 |

공개 UX 배포 결과는 [별도 배포 기록](./KTOUR_PUBLIC_UX_RELEASE_2026-09-25.md)을 본다. 두 도메인은 하이픈 유무만 다른 별도 환경이다. 이번 작업은 Harvey 환경의 키·설정·배포를 덮어쓰지 않는다.

**다음 P0는 같은 revision의 UI+API를 full-stack으로 배포하는 것**이다. 구형 Harvey API에 신형 UI만 연결하지 않는다. 새 공개 UI가 보인다는 이유만으로 실연동 기능이 켜졌다고 설명하지 않는다.

저장소의 `vercel.hackathon.json`에는 region 고정 설정이 없다. 실제 프로젝트의 서버 실행 지역·egress 설정은 별도로 확인해야 하며, 이를 이미 서울로 고정된 환경이라고 가정하지 않는다.

## 3. 항목별 구현·증거·부족한 점

| 항목 | 있는 것 | 아직 완료로 볼 수 없는 부분 | 완료 판정 |
| --- | --- | --- | --- |
| Harvey 통합 | 최종 Harvey `f4526af3` 조상 보존, 계약/Move/lockfile 보존; 복귀·승인·outbox 보강 | merge 성공은 실제 provider 성공이 아님 | 동일 revision의 배포와 live 여정 증거 |
| CX / 모바일 신분증 | trans → app/QR → result → token claims adapter; transaction·완료·stable CI 검증 | 공개 환경 mock. 실제 holder 응답, 서버 통신, CI 제공 여부 미확인 | 실제 인증→서버 evidence→허용/거절→원래 장소 복귀. 다른 사람/다른 요청 결과 혼입 거절 |
| OpenDID | 자체 서명 mock VC·holder proof·VP 흐름 | 실제 provider entrypoint가 `opendid_provider_unimplemented` 503. holder만 붙여도 끝나지 않음 | issuer 발급→실제 holder 보관·동의→VP 제시→서버 verifier/status 확인; 만료/철회 거절 |
| Sui / Move | 발급, 위임 PTB, consume+attest PTB, effects/events/objects 검증 | 현재 package/campaign 및 과거 hash 조회 가능성, gas·키·현재 배포 설정, 실제 zkLogin 서명 재검증 필요 | 같은 operation의 사용자 위임 및 agent 실행 digest·객체·정책 일치 |
| OmniOne Chain | Solidity registry, signed tx hash 사전 저장, claim/fencing, receipt+commitment 검증 | 현재 stage RPC 인증·receipt 조회, 실제 Redis 다중 인스턴스·장애 복구 미검증 | 서비스 사용 1건 ↔ outbox 1건 ↔ status 1 receipt + registry commitment 일치 |
| AI / provenance | rule/Gemini mode와 proposal·manifest·consent·execution 검증 경로 | 공개 설정 rule. 실제 모델 호출·출처/변조 검증의 현재 증거 없음 | 비식별 입력→모델 제안→사용자 승인→제한된 agent 실행 연결; 한 필드 변조 검출 |
| 제품 여정 | 콘텐츠→지도, 스펙트럼·목록·장소 상세, 패스·지갑 UX | 탐색 UI의 local 저장과 해커톤 v1 혜택 사용을 같은 완료 결과로 혼동할 위험 | 공개 탐색은 인증 없이; 지정 CTA부터 인증, 성공 후 같은 장소로 복귀하고 패스 결과 일치 |
| 제출 증거 | 기존 기술 명세·거래 링크·영상 대화 기록 | 최신 제출물/배포 revision 일치, 접수증·수정 가능 기간은 확인되지 않음 | 제출 담당자의 접수 확인 + 검증한 버전의 URL/영상/기술 요약 |

### 코드 근거

- [배포 프로필](../k-tour-id-app/vercel.json), [full-stack 프로필](../k-tour-id-app/vercel.hackathon.json), [서버/공개 config](../k-tour-id-app/lib/hackathon/config.ts).
- [CX adapter](../k-tour-id-app/lib/hackathon/adapters/cx.ts), [OpenDID mock 및 미구현 entrypoint](../k-tour-id-app/lib/hackathon/adapters/opendid.ts).
- [Sui adapter](../k-tour-id-app/lib/hackathon/adapters/sui.ts), [사용자 서명 클라이언트](../k-tour-id-app/features/ondo/hackathon-b/hackathon-client.ts), [operation evidence](../k-tour-id-app/lib/hackathon/operation-evidence.ts).
- [서버 자격·승인·사용·outbox](../k-tour-id-app/lib/hackathon/service.ts), [OmniOne adapter](../k-tour-id-app/lib/hackathon/adapters/omnione.ts), [저장소](../k-tour-id-app/lib/hackathon/store.ts).

### 과거 증거를 현재 완료로 바꾸지 않는다

- 9/21 기록의 Sui 3건은 `EntitlementIssued → GrantCreated/ConsentAttested → GrantConsumed/ExecutionAttested`의 과거 연결이다. 9/25 읽기 전용 재조회는 첫 digest에서 `Transaction not found`로 중단됐다. 9/23 기록도 세 digest 개별 조회 불가다. **현재 조회 불가이지 거래 위조·삭제·testnet reset을 확정한 것이 아니다.** 지원 endpoint/인덱서와 현재 배포 객체부터 확인한다. [상세 이력](./SUI_INTEGRATION_VERIFICATION_2026-09-21.md)
- 9/21 OmniOne 감사에서 찾은 동시 dispatch와 receipt 없는 확정 문제는 9/24에 수정됐고 독립 fixture 회귀 27/27이 통과했다. 이를 미수정 결함으로 반복 보고하지 않는다. 다만 실제 Redis/worker/체인 검증은 별도다. [보존 통합 및 수정 기록](./HARVEY_PRESERVATION_INTEGRATION_2026-09-24.md)
- 거래 해시 저장 직후, 방송 직전 프로세스 종료 시 자동 재방송은 아직 없다. unknown 상태를 임의 성공·임의 재전송으로 바꾸지 않는다. 무인 자동 복구를 주장하려면 별도 worker/recovery 설계가 필요하다.
- 계약 960개, 과거 unit 69개·outbox 27개·선택 browser 76개 통과는 코드/격리/fixture 증거다. 실제 CX·OpenDID·Sui·OmniOne 신규 완주 횟수로 세지 않는다.

## 4. 다음 작업 순서와 병렬화

1. **P0 — 제출용 full-stack 환경 고정.** 같은 소스 revision, 도메인/콜백, feature flags, 서버용 secret 주입 경로, 공유 Redis를 확정한다. 현재 코드의 Redis 미설정 시 Vercel `/tmp` fallback은 durable 운영 대체가 아니다. `NEXT_PUBLIC_HK_ENABLED=1`, `HK_API_ENABLED=1`, 실환경 `HK_ISOLATED_MOCK=0`을 확인하되 config의 mode 문자열만으로 통과시키지 않는다. OpenDID는 준비 전까지 mock임을 명시한다. 9/30 캠페인 종료 이후의 차단·kill switch도 점검한다.
2. **병렬 A — CX 실증.** 한국 사용자/허용된 신분증 테스트 기기로 QR 또는 app 왕복, 실제 서버 result/claims 확인. `icn1` 지정만으로 통신 성공을 가정하지 않는다. API reachability, 인증키, provider 허용, egress/allowlist를 각각 진단한다. 국가 제한은 공급자 확인 없이 단정하지 않는다.
3. **병렬 B — Sui·OmniOne 인프라 읽기 검사.** 현재 chain ID, package/registry bytecode·객체, campaign/shared version, 허용 recorder, gas, 기존 receipt를 먼저 조회한다. 이어 승인된 테스트 lane에서 실제 zkLogin 위임→agent 실행→서버 최종 사용→OmniOne receipt를 연결한다. **OpenDID 미완료가 Sui 단독 실검증을 막는 것은 아니다.** 이 경우 mock 신원이라는 증거 경계를 분명히 한다.
4. **병렬 C — OpenDID native 준비.** 공식 release·issuer/TAS/verifier 환경·holder SDK/기기·schema/policy를 고정하고 위 provider 미구현을 채운다. 앞서 정한 native 단계에 착수할 때 진행하며, 이번 감사 중 몰래 구현하거나 가점 완료로 처리하지 않는다. 앱스토어 공개 출시 필요 여부와 내부/공식 holder를 통한 시연 인정은 별도 확인한다. 단순 웹뷰 포장이나 SDK 링크만으로 실제 VC 발급·보관·VP 검증을 완료 처리하지 않는다.
5. **통합 — 한 여정으로 합쳐 실패 사례까지 검수.** 최초 smoke는 Harvey의 v1 체험 혜택을 보존한다. 기존 승인된 v2 ‘가이드 패스 저장’ 목표와 현 구현의 차이는 그대로 남아 있다. 이 목표를 자동 폐기하지 않으며, 전환·범위 변경은 별도 결정하고 실연동 검증 중 의미를 바꾸지 않는다.
6. **마감 — 증거·문서·영상 고정.** 공개 개인정보/키 없는 evidence bundle, source SHA, build/deploy ID, 각 체인 digest, 제한사항, 발표용 설명 및 접수 상태를 맞춘다. Sui는 공개 GitHub/README·Sui 적합성 기술 요약 1쪽·DeepSurge 최종 제출을 별도로 확인한다. 공식 1–3위 수상 및 별도 검증은 지급 전제이지 코드 완료로 보장되는 결과가 아니다.

세 작업자를 동시에 쓰되 같은 배포 설정·service/store·공유 문서를 함께 수정하지 않는다. CX/체인/native별 파일 소유를 나누고, 각 변경 후 작성자와 다른 리뷰어가 반례를 검사한다. 공통 계약·build는 고정 revision에서 직렬로 실행한다. UI 가벼운 회귀와 자료 검사는 병렬 가능하지만 브라우저 worker 수는 머신 부하에 맞춰 제한한다.

## 5. 끝까지 통과해야 하는 사용자 시나리오

```text
콘텐츠/분위기로 장소 발견 → 공개 정보 읽기
  → [선택] 지정 체험 혜택 사용
  → CX 모바일 신분증 인증 → 서버 자격 판단
  → OpenDID 패스 발급·holder 보관 → VP 제시·서버 검증
  → AI 제안 → 대상·범위·기한을 보고 사용자 승인
  → zkLogin 서명/위임 PTB → agent 1회 실행
  → 서버가 Sui 증거 + 최신 자격을 다시 검증
  → 서비스 사용 확정 + durable outbox
  → OmniOne 기록·receipt 확인 → 원래 장소 복귀
```

수락 체크:

- [ ] 인증/서명 전 이탈·거절하면 실행/혜택 사용 0건; pending을 success로 표시하지 않음.
- [ ] 재진입·새로고침·중복 클릭에도 동일 operation으로 이어지고 중복 사용/방송을 방지.
- [ ] 만료·철회·다른 지갑·다른 장소/캠페인·변조 proof/commitment를 서버와 계약 경계에서 거절.
- [ ] Sui 성공 뒤 서버 자격 실패 시 서비스 사용 성공으로 표시하지 않음.
- [ ] 서비스 사용 성공 뒤 OmniOne 지연 시 ‘서비스 완료/감사 기록 대기’를 구분하고 복구.
- [ ] 모바일 OAuth/app 왕복 후 원래 장소·탐색 맥락 복원; 키/JWT/VC 원문을 복귀 URL에 저장하지 않음.
- [ ] 실제 provider로 만든 성공 증거와 fixture로 만든 장애 증거를 명시적으로 구분.
- [ ] 실기기 1대 이상에서 재현; Chromium 자동화만으로 iOS/Safari 지원을 완료 처리하지 않음.

## 6. 일어난 뒤 필요한 인풋 — 지금은 답하지 않아도 됨

1. **제출용 연동 환경:** 기존 `ktourid.vercel.app`을 같은 revision으로 갱신할지, 현재 대표 주소에 full-stack을 붙일지. 소유자 권한·환경변수 이전은 승인된 secret 경로로만 진행하고 채팅에 키를 붙일 필요는 없다.
2. **실인증·서명 참여:** 모바일 신분증 가능한 기기/테스트 사용자, OAuth 허용 계정, 테스트넷 서명/가스 범위. 사용자 승인 화면을 자동으로 건너뛰지 않는다.
3. **접수 정보:** 9/21 제출 접수 여부, 9/30 전 URL·영상·장표 수정 허용 범위, Sui DeepSurge 등록/최종 접수 상태. 팀 대화는 접수증의 대체가 아니다.

공개 가이드상 결선 제출은 제안서+MVP 영상이며 9/21, 발표는 9/30이다. 현재 9/25이므로 제출물 수정 가능 여부는 담당자 확인이 필요하다. 발표 8분을 영상 길이 제한으로 해석하지 않는다. [가이드 p12·13](https://opendid.org/download/hackathon/2026/2026%20블록체인%20%26%20AI%20해커톤%20가이드북.pdf?v=20260430#page=12)

결선 장표는 요약서 최대 2쪽(표 변경 금지), 본문은 표지·요약 제외 15쪽 이내인지 확인한다. 이번 감사에서는 기존 제출 장표 파일을 변경하거나 접수를 수행하지 않았다. [공식 결선 양식](https://opendid.org/download/hackathon/2026/final/TrackNo_팀명_프로젝트명_yymmdd.pptx)

실제 결제·원화 스테이블코인·실매장 예약은 이번 비금전 체험 여정의 완료 조건이 아니다. 사업 로드맵과 해커톤 실증을 구분하며, 데모 잔액을 실제 정산된 돈으로 설명하지 않는다.

모바일 신분증으로 시연할 수 있는 사용자 범위도 발표에 명시한다. 내국인 모바일 운전면허증 인증 성공을 외국인 여권 KYC·체류 자격·금융 한도 검증까지 완료한 것으로 확장하지 않는다.

## 7. 검토 방식

공식 요건 조사, CX/OpenDID/OmniOne 코드 감사, Sui 증거 감사를 독립 담당자가 병렬 수행했다. 주 검토자가 현재 config·OpenDID fail-closed·과거 outbox 수정 이력을 교차 확인했다. 상태를 **코드 있음 / 과거 실증 / 현재 배포 선언 / 현재 live 검증**으로 나누었으며, 서로 다른 시점의 테스트를 합산해 실연동 완료를 주장하지 않는다.
