# 실제 연동 인계 · 본인 승인 안내 — 2026-09-26

## 현재 상태와 범위

- Harvey 구현 코드는 통합돼 있지만, 코드와 Vercel의 서버 비밀 설정은 별개다. 이번 확인에서 `ondo` 프로젝트의 환경변수 메타데이터에 아래 Sui/zkLogin/OmniOne/AI 설정 이름이 없었다. Harvey 별도 서비스의 실패를 뜻하는 것은 아니다.
- 현재 검수 배포는 **CX-only Preview**다. 실제 QR 생성·앱 연결 링크 반환·미인증 처리·복원·취소까지 검수했으며, 실제 소지자 승인 성공은 아직 확인하지 않았다.
- Preview에서 체인·Google 로그인·AI 실행을 막아 놓은 것은 의도한 경계다. 설정을 받더라도 이 검수 환경에 한꺼번에 기능을 켜지 않고 별도 보호된 통합 검수 환경을 준비한다.
- 공개 Production, Harvey 배포, megan 계정과 다른 프로젝트는 변경하지 않는다.

## 1. 사용자: 모바일 신분증에서 승인하는 정확한 경로

### PC에서 QR을 띄우는 방법

1. [정확한 CX Preview 링크](https://ondo-58rpahn56-jaewook-9643s-projects.vercel.app/?venueId=mois-0021cd596bc5b2a922ad&review=0)를 연다. 일반 공개 앱이나 Harvey 별도 데모 주소와 다르다.
2. 선택된 장소의 **장소 상세 / Place details → 체험 혜택 보기 / See experience perk**를 누른다.
3. **Preview 접근 / Preview access** 화면에 접근 코드를 입력한다.
4. 안내를 읽고 **내용을 확인했습니다. → 확인 단계로**를 누른다.
5. **QR로 확인 → 모바일 신분증 확인 시작**을 누른다.
6. 휴대폰의 **모바일 신분증 앱 → QR 촬영**에서 PC 화면의 QR을 촬영한다. `나의 QR`을 보여주는 메뉴나 별도의 `모바일 신분증 검증앱`이 아니다.
7. 앱이 보여주는 서비스·제출 정보를 확인하고, 동의/정보 보내기 및 앱이 요구하는 본인 인증을 완료한다. 이 단계는 본인 기기에서 직접 한다. K-Tour의 사전 동의 체크박스만으로 완료되지 않는다.
8. K-Tour로 돌아와 **결과 확인 / Check result**을 누른다. 승인 전에 반복 조회하지 않는다. 실패·만료됐다면 이전 QR을 재사용하지 말고 새 확인을 시작한다.

휴대폰 한 대라면 5번에서 **앱으로 확인 → 모바일 신분증 확인 시작 → Mobile ID 앱 열기(iOS/Android)**를 선택한다. 앱에서 정보 제출을 마친 뒤 원래 브라우저 탭으로 돌아와 결과를 확인한다. 링크 생성은 검수했지만 실제 OS 앱 전환/최종 승인은 아직 미검수다.

**앱/신분증 제한:** 현재 provider는 `comdl`, 요청은 `AdultVerify`다. 모바일 운전면허증에 해당하며, 주민등록증·PASS 카드 등 아무 신분증이나 호환된다고 가정하면 안 된다. 이 해커톤 CX 서비스의 **일반 모바일 신분증 앱 / 테스트베드 앱 허용 환경**은 코드·QR 생성만으로 확정할 수 없다. Harvey에게 확인할 항목이다. 별도 테스트 앱이 필요하다는 답을 받으면 공식 설치 경로와 테스트 자격증명 발급 방법도 함께 받는다. 임의 APK 설치나 실제 앱 재발급을 먼저 요구하지 않는다.

공식 경로 근거: [행정안전부 QR 촬영 사용 안내](https://www.korea.kr/multi/visualNewsView.do?newsId=148918499), [개발지원센터 QR 촬영 후 정보 보내기 흐름](https://dev.mobileid.go.kr/mip/dfs/useguide/unmannedguide.do). 네이티브 앱의 최신 화면 배치·본인 인증 수단은 기기/앱 버전에 따라 달라질 수 있으며 이번 작업에서 직접 조작한 것은 아니다.

### 접근 코드는 어디에 있나

Vercel에서 **jaewook 팀 → ondo 프로젝트 → Settings → Environment Variables → `HK_CX_PREVIEW_ACCESS_CODE`**를 찾는다. 환경은 `Preview`, 브랜치는 `feat/hackathon-readiness-preview-20260925`다. `HK_CX_PREVIEW_ACCESS_SECRET`(서버 서명키)과 혼동하지 않으며 기존 값을 새로 만들거나 바꾸지 않는다.

접근 코드·QR·CI·토큰·신분증 화면은 채팅/Git에 붙이지 않는다. 이 환경의 만료는 **2026-09-30 23:59:59 KST**이고 개별 인증 요청은 더 짧게 만료된다. 정확한 immutable 배포 URL만 허용된다.

승인 후 전달할 것은 **성공/실패 여부, 확인 시각, 비민감 오류 코드** 정도면 충분하다. 화면을 공유한다면 QR과 개인정보는 가린다. 승인 성공 뒤에도 서버의 거래 일치·CI 기반 동일인 결합·성인 결과를 확인해야 CX 검수를 완료로 판정한다. 안정적인 CI가 없는 응답을 거래 ID로 대신 동일인 처리하지 않는다.

## 2. Harvey에게 받을 설정

비밀값은 **승인된 Vercel 서버 환경변수 등록 또는 별도 보안 인계**로 받는다. 채팅·PR·Markdown·프런트엔드 코드에 넣지 않는다. 기존 정상 동작 형식을 그대로 유지하며 키/주소/솔트를 임의 재생성하지 않는다.

| 구분 | 필요한 인계 | 이유 / 주의 |
| --- | --- | --- |
| Sui 서버 서명 | `HK_SUI_ISSUER_SECRET_KEY`, `HK_SUI_AGENT_SECRET_KEY`; 별도 sponsor를 사용했다면 `HK_SUI_SPONSOR_SECRET_KEY` | 기존 Campaign 역할과 일치해야 한다. sponsor 미설정 시 코드는 issuer 키를 사용하므로 신규 sponsor 키를 무조건 요구할 필요는 없다. 반드시 데모용 Testnet 권한만 인계한다. |
| Google + zkLogin | `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, 기존 `HK_ZKLOGIN_SALT_SEED`; **기존 증명 경로에 따라** Enoki의 `ENOKI_API_KEY`(custom URL 사용 시 `ENOKI_API_URL`) **또는** 승인된 `HK_ZKLOGIN_PROVER_URL`과 접근 조건 | Google client ID는 공개 식별자이며 비밀 키/seed는 서버 전용이다. 두 증명 경로를 모두 요구하지 않는다. 키가 있으면 코드가 Enoki를 우선한다. Enoki 경로라면 해당 Google client 등록/사용 권한도 필요하다. seed는 현재 config/UI gate에 필요하지만 Enoki가 관리하는 사용자 salt 자체가 아니다. Testnet 호환성을 확인하고 기존 솔트/증명 경로를 임의로 바꾸지 않는다. |
| OAuth 관리 권한 | Google OAuth client의 redirect URI 추가 가능 담당자/접근, Enoki 프로젝트 설정 담당자/접근 | 새 검수 origin의 `/hackathon/zklogin/callback`을 정확히 허용해야 한다. API key만 복사해서 끝나는 작업이 아니다. Google 로그인·최종 사용자 서명은 사용자 승인 단계로 남는다. |
| OmniOne Chain | 인증된 전체 `HK_OMNIONE_RPC_URL`, `HK_OMNIONE_PRIVATE_KEY`(기존 승인된 recorder) | 저장소의 URL 규격은 `https://stage-chainapi.omnione.net/?token=<API_KEY>`. 토큰 포함 URL 전체가 비밀이다. 현재 adapter는 그 URL을 직접 지원하며 별도 `HK_OMNIONE_RPC_TOKEN` 변수는 없다. 키는 registry의 recorder 권한과 맞아야 한다. |
| AI 모델 | `GEMINI_API_KEY`, 실제 사용한 `GEMINI_MODEL`·`HK_AI_MODE` 설정 | 앞서 조회한 Harvey 공개 mode는 `rule`이었다. 명시적 `HK_AI_MODE=rule`이면 키만 추가해도 Gemini로 전환되지 않는다. 실제 모델 키가 없는 경우 기존 rule 동작을 실제 AI 제공자 호출 성공으로 간주하지 않는다. 키가 없다면 별도 승인된 데모용 키 준비가 필요하다. |
| CX 서비스 조건 | 일반 앱/테스트베드 앱 여부, `comdl`에 맞는 신분증 조건, `AdultVerify` 결과의 CI 제공 여부; 별도 서비스 키가 있었다면 설정명/안전한 인계 | 현재 서울 Preview에서 QR/app 요청 자체는 성공했다. 국내망 문제로 추정해 호스팅을 다시 바꾸기 전에 승인·자격증명/클레임 조건을 확인한다. |

추가 개발 요청이 아니라 **동작하던 배포의 실행 설정을 새 환경으로 이전하는 요청**이다. 전체 Vercel 계정 비밀번호나 다른 서비스의 키는 필요 없다. 기존 테스트용 signer의 인계가 불가하다면 신규 역할 위임은 별도 설계/승인 작업이며 자동으로 계약을 교체하지 않는다.

### 이미 확보했으므로 다시 요청하지 않아도 되는 공개값

| 변수 | 확보된 값 |
| --- | --- |
| `HK_SUI_NETWORK` | `testnet` |
| `HK_SUI_PACKAGE_ID` | `0xc5d26326ffd5267bb5b54625c1e2b9c03f7cca4753232d0b042c62ee74fd975d` |
| `HK_SUI_CAMPAIGN_ID` | `0xe3fce96c9c9e1086ff20dd7453e16ff2c52d3d3324e6e4e34446c7d0dc2ecf16` |
| `HK_SUI_CAMPAIGN_INITIAL_VERSION` | `349181955` |
| `HK_OMNIONE_CHAIN_ID` | `201210` (배포 기록값; 인증된 현재 RPC 재확인 필요) |
| `HK_OMNIONE_REGISTRY_ADDRESS` | `0x696bc4e29c8f8079b6d3cd49d310a09577550e4c` |

OmniOne 앱용 계약은 `DemoEntitlementRegistry`이며 옛 `KTourAnchor`가 아니다. 저장소 공개 recorder 주소는 `0x003403Cb95c2FFd66BC5748738d96C4A5B48b4ba`다. 주소를 안다고 그 서명 권한을 보유한 것은 아니다. 이 stage 기록은 gasPrice=0이므로 잔액이 반드시 양수여야 한다고 가정하지 않는다.

## 3. 설정을 기다리며 실행 가능한 작업과 다음 순서

9/28 후속: 승인된 계정/브랜치로 Vercel 연결·Sumsub 실제 SDK·독립 Redis 저장과 재개를
이미 검수했다. 이 설정들을 다시 준비할 필요는 없다. 다만 Sumsub webhook 등록은
SDK 키의 관리 권한 부족(403)으로 [별도 관리자 인계](./SUMSUB_LIVE_PREVIEW_2026-09-28.md)가 필요하다.
전체 최신 진행 상황과 사람만 할 수 있는 항목은 [최종 보고](./AUTONOMOUS_FINISH_2026-09-28.md)를 따른다.

진행한 병렬 작업: Sui 무서명 리허설/검증 도구, OmniOne 읽기 전용 사전 검사 도구, AI·zkLogin 공급자 오류 비밀값 유출 차단과 회귀 테스트, 작성자와 다른 담당자의 adversarial 리뷰. 구체 실행 결과는 각 검수 문서에 따로 기록한다. 단위/fixture 통과를 실제 OAuth·체인 E2E 완료로 세지 않는다.

1. 사용자 Mobile ID 승인 → 서버 CX 거래/동일인/성인 결과 확인. 승인 없이 성공으로 대체하지 않는다.
2. 안전한 설정 인계 → 공개 주소/계약/역할 대조 및 OAuth origin 고정. 기존 CX-only 환경은 유지한다.
3. Sui 현재 Campaign·역할·가스 읽기 확인, OmniOne 인증된 read-only chain ID·code·recorder·기존 receipt 확인.
4. 별도 보호된 통합 검수 환경에서 Testnet 발급 → 사용자 승인·위임 → 실행 → 서버 최종 판정 → OmniOne receipt와 payload commitment → 장소 복귀를 1회 시나리오로 검수한다.
5. demo signer 테스트와 **실제 Google zkLogin 사용자 서명** 테스트를 구분한다. 성공 증빙뿐 아니라 중복 사용·취소·만료·OmniOne 지연/재시도도 확인한다.
6. 실제 결과에 맞춰 제출 스펙/잔여 항목을 갱신한다. OpenDID native는 기존 합의대로 별도 후속이며 완료로 표시하지 않는다.

참조: [CX 실배포 검수](./CX_LIVE_PREVIEW_2026-09-26.md), [공개 체인 읽기 검수](./CHAIN_READONLY_2026-09-26.md).
