# 메인 UX·CX/Sui 통합 마무리 — 2026-09-29

## 이번 작업의 경계

사용자가 공개 운영 주소에서 CX 검수 및 기존 UX 복원을 승인했다.
OpenDID는 Claude의 별도 작업이며 이 작업에서 수정하거나 완료로 간주하지 않는다.
코드 병합·설정·모의 검증·실제 제공자 완료를 구분한다.

이전 공개 배포는 `a34f7be9`, 이번 배포 실행 코드는 `e304b8655770ec501e6b45388b30329b2f2d0e78`,
작업 브랜치는 `deploy/sui-main-20260928`이다.
`main`에 대한 강제 push, 다른 Vercel 계정/프로젝트 변경은 하지 않는다.

## 수정 및 검수 목록

- [x] 데스크톱의 작은 장소 미리보기는 비모달: 지도와 왼쪽 메뉴 사용 가능.
- [x] 상세 화면·모바일 시트는 기존 모달/포커스 보호 유지.
- [x] 데스크톱에서 모바일로 전환하면 새 모달 내부로 포커스 이동.
- [x] 지도 온도 재생과 `review=0` 인증 경로를 분리. 준비된 지도 표현이라는 출처는 유지.
- [x] 샘플 잔액·인증 권한은 지도 재생과 별개로 제한. 지도용 준비 지표는 Sample로 구분하며 실제 방문/인증 증거로 사용하지 않음.
- [x] CX 완료 응답 처리 수정본은 서버 결과의 거래 결합·새 토큰·안정적인 subject를 검증.
- [x] 운영 전환 도구는 공개 CX 설정 3개와 `HK_MODE_CX`만 변경. 키·Redis·접근 코드 교체 금지.
- [x] OmniOne은 승인 계약·체인·실제 signer·recorder 권한을 서명 전에 검사하도록 보강.
- [x] zkLogin 설정 존재만으로 실제 준비 완료를 오인하지 않도록 사전 검사 보강.
- [x] 다음 통합 Preview의 deprecated Vercel 설정 제거, 검증된 Vercel 빌드의 주입 옵션을 자식 프로세스에서 제거. 로컬 임의 loader와 다른 계정/프로젝트/브랜치는 계속 거부. 관련 11/11 통과.
- [x] 최종 동일 revision의 Preview 브라우저 회귀 결과 기록.
- [x] 보호 Preview의 실제 CX 요청·미승인 결과·취소 및 지도 검수.
- [x] 동일 revision/config의 운영 배포 및 실제 CX 요청·취소 검수.
- [ ] 신분증 소지자의 새 실제 승인 및 이후 같은 operation의 Sui 거래 확인.

## 배포 전 독립 검토

1. UX 검토: viewport 전환 시 배경에 남은 포커스 문제 발견 → 수정.
2. 배포 검토: CX 전환 전에 기존 source/secret fingerprint 변경 여부를 확인하지 않는 문제 발견 → 같은 snapshot의 전/후 fingerprint 검증 및 0-write 거부 테스트 추가.
3. CX smoke의 초기 요청 경로 검사가 action 이름만 검사하는 문제 발견 → bootstrap도 정확한 전체 경로 검사 및 거부 테스트 추가. 독립 재검토 GO, 관련 20/20 통과.
4. 최종 production build를 띄운 로컬 브라우저 회귀: mobile/desktop Chromium 14/14, 관련 UI contract 29/29 통과. 메뉴 실제 클릭, 반응형 포커스, 줌, 도시 진입 카메라, 일반/모션 줄이기 상태를 확인했다.
5. 해커톤 unit 462/462 통과. 위 smoke 경로 강화 후 관련 20개 테스트를 다시 통과했다. 광역 스토리/필터 회귀와 외부 배포 결과는 아래에 별도 기록한다.
6. CX로 전환한 뒤 과거 샘플 identity를 재사용해 credential/AI/Sui로 진행할 수 있는 정책 간 우회 발견 → 현재 CX mode/provider와 저장된 증거의 일치를 각 쓰기·broadcast 직전에 재확인. 조회·기존 거래 복구·취소는 유지한다. 독립 검수 GO 및 42/42 통과. 과거 immutable 배포를 소급 수정한 것은 아니다.
7. 최종 실행 코드의 단위 테스트 467/467(425 TypeScript + 42 build/operator), service/outbox verification 70/70, TypeScript 검사 통과. 외부 제공자 완료를 가정한 fixture는 실인증 증거로 계산하지 않는다.
8. Luna의 도시별 스토리·스펙트럼·헤더·제스처·데스크톱 동작 60/60, 재시도 0. 처음의 프로필 전제 오류는 명시적인 로컬 읽기 전용 검수 모드로 분리했고, 나머지 2건은 접힌 검색 버튼을 먼저 여는 실제 동선으로 고쳤다. 기존 CI/공개 프로필 보호와 동작 검증은 유지했다. 정상/모션 줄이기, 서울·부산·제주, 라이트/다크 화면을 검수했다.
9. 최종 Preview `e304b865`에서 메인 메뉴·장소 미리보기/상세·반응형 포커스·지도 카메라/온도 재생 14/14 통과. 로컬 화면만 보고 배포 성공으로 기록하지 않았다.

## 사용자/설정 소유자가 필요한 것

준비 시점 114개 Vercel 환경변수의 이름과 적용 범위를 확인했고, 이후 실제 CX 전환 및
비활성 통합용 자체 Sui 설정을 분리 적용했다. 원문 비밀값을 보고서에 기록하지 않는다.
최종 2026-09-29 **02:25 KST** 재조회에서는 127개 항목 중 OmniOne private key,
Google client/salt, Gemini key, Enoki key, 명시적 prover URL이 모두 없었다. 다른 계정이나
팀원의 개인 보관소에 없다는 뜻은 아니며, 현재 승인 프로젝트에 인계가 필요하다는 근거다.

| 항목 | 필요한 입력 | 나머지는 우리 작업 |
| --- | --- | --- |
| OmniOne 신규 기록 | 승인 recorder `0x003403Cb95c2FFd66BC5748738d96C4A5B48b4ba`의 서명 수단. 현재 adapter는 `HK_OMNIONE_PRIVATE_KEY` 사용 | 같은 계약 권한 재검증, 보호된 실행 프로필 연결, 실제 신규 기록·receipt·event·commitment 대조 |
| Google zkLogin | Google Web OAuth client와 설정 관리자 협조. 기존 계정 주소를 보존해야 하면 기존 salt 설정도 인계 | callback 등록 안내, 공개 Testnet prover 검증 또는 Enoki 연결, salt 안전한 준비, 제한된 실행 프로필·실서명 검증 |
| Google 본인 승인 | 실제 로그인·동의·거래 승인 | 본인 승인을 대신하거나 JWT를 만들어 검증했다고 하지 않음 |
| 실제 AI 모델 | `GEMINI_API_KEY` 및 사용 가능한 모델 설정 | 모델 호출·실제 사용 모델 증거·실패 시 안전한 처리 검증 |
| 모바일 신분증 | 수정 배포에서 새 요청 후 앱에서 정보 제출 | 승인 이후 서버 결과·다음 단계 확인 |
| Sumsub 웹훅 — 별도 선택 경로 | 실제 webhook까지 확인하려면 Sumsub 관리자 권한 또는 승인된 callback 등록 | 이미 준비된 SDK 키는 다시 요청하지 않음. 이 항목은 CX→Sui의 선행 조건이 아님 |

키를 채팅·Git·이 문서에 붙이지 않는다. 현 hosted 프로필은 OmniOne/Google/Gemini 설정 혼입을
거부하므로 **현재 Production에 바로 추가하지 않는다**. 기존 별도
`integration/autonomous-finish-20260927` Preview 범위 또는 승인된 비밀 인계 경로를 사용하고,
연결 프로필 검토 후 우리가 적용한다. 이미 받은 RPC 토큰·공개 계약 주소·Redis·Vercel 로그인을
다시 받을 필요는 없다. 새로운 독립 zkLogin 설정이라면 salt 생성은 우리가 할 수 있다.
기존 salt를 임의 교체하면 계정 주소가 달라지므로 인계 여부를 먼저 구분한다.

설정 인계만으로 전체 통합이 자동 완료되지는 않는다. 마지막 열의 작업은 우리 책임이다.

Google 설정 인계에는 Web client ID, 설정 담당자, 허용할 로그인 계정이면 충분하다.
향후 사용할 승인 origin의 `/hackathon/zklogin/callback`을 정확히 등록한다. 현재 hosted
프로필에 Google 설정을 추가해 우회하지 않는다. 새 salt 생성과 prover 경로 검토는 우리 작업이다.
Enoki는 Testnet에서 일률적으로 필수인 것은 아니다. 공개 서버 health 응답도 실제 ZK proof
성공을 의미하지 않는다.

## 입력을 기다리지 않고 준비한 다음 통합 후보

- 별도 `prep/integration-candidate-20260929`에서 현재 release, CX 정책 수정, own-vs-Harvey
  대상 구분, 서명 역할·가스·누적 예산 보호를 하나로 합쳤다. OpenDID branch는 merge하지 않았다.
- 기존 `integration/autonomous-finish-20260927` Preview에 자체 Sui 설정 10개만 준비했다
  (7개 생성, 3개 갱신). 키는 기존 보관 키를 사용하고 공개 역할과 대조했다. runtime OFF,
  배포 0, 새 키 0, 기존 Redis/seed/budget 변경 0이다. 사전/매 변경 전/완료 시 scope를 확인했다.
- 설정 준비 도구는 독립 검수 GO, 오프라인 75/75 통과. 중단된 설정 쓰기를 자동 재시도하지 않는다.
- 기존 hosted와 별도 integration이 각각 새 10회 예산을 갖지 않도록 합산 제한을 준비했다.
  **기존 immutable writer의 안전한 중지와 누적 예산 cutover 구현·검수는 아직 남은 우리 작업**이다.
  제공자와 OpenDID가 준비되기 전에 현재 작동하는 hosted를 중단하지 않는다. 준비 후보의 Sui 실행은
  이 전환 전까지 명시적으로 막혀 있으며, 설정만 넣으면 바로 전체 연동된다고 설명하지 않는다.
- 상세 소스·빌드 검증·남은 실행 작업은 [별도 준비 후보 인계 문서](https://github.com/woogieboogie-jl/k-tour-id/blob/prep/integration-candidate-20260929/docs/INTEGRATION_CANDIDATE_2026-09-29.md)에 기록한다.
- zkLogin은 별도 준비 revision `9d982c97`에서 암묵적인 개발용 prover 선택을 제거했다.
  명시적 제공자 설정 없이는 JWT를 전송하지 않고, 알려진 Devnet host는 Testnet에서 거부한다.
  이 보완은 후속 후보용이며 현재 운영의 Ed25519 경로를 Google 로그인으로 바꾼 것이 아니다.
  공개 서버의 health/OPTIONS 4회는 도달 가능성만 확인했다. 실제 JWT·proof·ZkLogin 거래는 0이다.
- 최종 후보 `f8181b4b`는 위 준비 branch에 보관했으며 **미배포 / runtime OFF**다. 독립 검토
  GO, 단위 482/482, verification 70/70, build/profile/input fixture 94/94, static contract 4/4,
  TypeScript 및 실제 격리 integration build까지 통과했다. 원격 실행용 기존 integration branch를
  덮어쓰지 않았다. 배포 branch에 뒤따른 테스트·문서 커밋은 운영 실행 코드 `e304b865`를 바꾸지 않는다.

## 실행 제한과 검수 안내

- 원래의 10개 operation/총 가스 상한/2026-09-30 23:59:59 KST 만료를 유지한다.
- 02:25 KST에 원장의 해당 key 하나를 GET으로만 확인했다: 5개 사용, 5개 남음(기존 Sui
  2개 pending, CX smoke 3개 cancelled). 새 요청이 생기면 남은 수는 줄어든다. 원장 초기화나
  예산 증가는 하지 않았다. 이번 운영 CX smoke에서도 새 체인 거래는 0개다.
- CX smoke는 실제 요청 1개를 생성하고 취소하며, 실패·취소도 operation 예산에 포함된다.
- 무승인 smoke는 실제 신원 확인·자격 발급·체인 완주 증거가 아니다.
- 기존 실제 Sui 3거래 증거: [이전 배포 기록](SUI_CX_RELEASE_2026-09-29.md).
- 2026-09-29 01:34 KST에 공식 Testnet gRPC로 위 3거래를 다시 읽었다. 모두 성공 상태이며 BCS digest·effects digest, package/campaign, ED25519 서명 5개가 일치했다. 체크포인트는 `388777446 / 388777456 / 388777474`. 4회 조회, 신규 거래 0개. 이것은 zkLogin 증거가 아니다.
- CX 모드에서는 샘플 승인 요청을 거부한다. 공급자 오류 때 mock으로 전환하지 않는다.
- OpenDID가 연결되기 전의 패스는 앱 내 체험 패스이며 실제 OpenDID VC로 표시하지 않는다.

## 최종 결과

Preview와 Production 배포 및 실제 CX 요청 smoke, 운영 화면 최종 회귀까지 완료했다.
두 배포 모두 실행 코드는 `e304b865`이고 함수 region은 `icn1`이다.
공개 alias가 해당 Production을 가리키는 것을 metadata로 확인한 뒤 smoke를 실행했다.

| 환경 | 동일 실행 코드의 배포 | 검수 |
| --- | --- | --- |
| Preview | `dpl_CDM3jRJ67fCmEK96uZcbWyeQzcHi` / `ondo-ojjbm2tic-jaewook-9643s-projects.vercel.app` | READY, UI 14/14, 실제 QR 요청→미승인 결과→취소→장소 복귀 성공 |
| Production | `dpl_GV2dPDDsfDjcnrpyTvNSQsHAjyVx` / `ondo-x5w3czr2m-jaewook-9643s-projects.vercel.app` | READY, 실제 모바일 앱 링크 생성→미승인 결과→취소→장소 복귀 성공, UI 14/14 통과 |

Preview smoke 보고서 SHA-256:
`6d1699799203ea09ecbc8058e6b9d2ee4e5fdf27f4f18c640253b4f708ba1861`.
Production smoke 보고서 SHA-256:
`bbb0d0816c61fc837a1cd098fc5011b66df5609d9fac0aac9382eee42cbe7f64`.
각 smoke는 operation 1개를 만들고 취소하며, 후속 credential/Sui/OmniOne 요청은 0이다.
신원 확인 완료/본인 승인 완료를 주장하지 않는다.
두 smoke 모두 예상한 POST 6개가 각각 1회였고, page/API/request 오류 0이었다. 외부 읽기 자산
2개는 검수기가 의도적으로 차단했다. 네이티브 앱 링크는 따라가지 않고 생성·표시만 확인했다.
운영의 비로그인 `review=0` 라이트/다크·모바일/데스크톱 4개 화면도 지도 ready, 가로 넘침 0,
페이지 오류 0, 변경 요청 0으로 확인했다. 공개 메인 전체 UI를 사용했으며 별도 복제한 Labs
화면으로 대체하지 않았다.

**바로 확인:** [메인 지도](https://ktour-id.vercel.app/?city=seoul&review=0) /
[실제 CX 시작 장소](https://ktour-id.vercel.app/?venueId=mois-0021cd596bc5b2a922ad&review=0).
장소 상세 → 체험 혜택 → 기존 접속 코드 → 동의 → 모바일 신분증 확인 → 본인 정보 제출 →
원래 브라우저의 결과 확인 순서다. [현장 확인 안내](TUESDAY_MOBILE_ID_CHECK_2026-09-29.md)에
실패 시 멈출 지점과 안전하게 공유할 항목을 적었다.

CX와 Sui가 같은 메인 동선에 연결된 것과 **새 CX 승인부터 Sui까지 실제 완주한 것**은 구별한다.
후자는 본인 승인이 필요해 아직 확인하지 못했다. 기존 Sui 3거래는 Ed25519 서명이며 zkLogin
성공 증거가 아니다. OmniOne 신규 기록, 실제 AI 모델 호출, 실제 OpenDID 발급도 이 배포의
완료 항목이 아니다.

추가 근거: [OmniOne 서명 준비](OMNIONE_SIGNING_READINESS_2026-09-29.md),
[zkLogin 입력·검증 안내](ZKLOGIN_READINESS_2026-09-29.md).
