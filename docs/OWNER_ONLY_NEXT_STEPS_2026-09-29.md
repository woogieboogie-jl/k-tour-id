# 지금 직접 필요한 일과 이미 끝난 준비

기준: 2026-09-30 재확인. 검증된 **앱 revision은 `64f2a4fc3ad50c73c1f1904c96a2f0e747caaf06`**이며, 이 문서만 갱신하는 Git revision과 구분합니다. 실제 운영 배포·설정·회귀 근거는 루트 `artifacts/integration-handoff-20260930/CONNECTED_RELEASE.md`에 있습니다. 비밀키·API 키·keystore·암호·QR·CI·JWT는 채팅, GitHub, 이 문서에 붙이지 않습니다.

**OmniOne 새 EOA 서명 수단, Google Client ID, Gemini 키는 모두 받아 안전하게 보관했습니다. 다시 발급하거나 전달할 필요 없습니다.** Vercel 재로그인, Sui 키·Testnet 가스 재발급, 기존 서비스 중단·원장 초기화도 요청하지 않습니다.

키를 받은 것과 전체 연동을 마친 것은 다릅니다. 독립적으로 연결할 수 있는 CX·Google/zkLogin·Gemini·새 OmniOne 감사 경로는 운영에 반영했습니다. 실제 신분증 동의·Google 로그인·실기기 승인은 본인이 해야 하며, 그 뒤 동일 이용건의 결과 검증과 native 계약 연결 개발은 제가 계속합니다. 아래 5개는 서로 다른 상태를 확인하는 항목이지, 아직 못 받은 입력 5개가 아닙니다.

## 현재 확인된 결과

| 영역 | 확인한 사실 | 아직 같은 의미가 아닌 것 |
| --- | --- | --- |
| 운영 웹 | 앱 `64f2a4fc` 배포 READY, `ktour-id.vercel.app`의 정확한 배포 연결 및 보호된 설정 조회 PASS. 운영 공통 장소 2/2·중앙 패널 16/16·지도 6/6 익명 읽기 전용 검사 PASS | 실제 제공자의 동일 이용건 전체 E2E 성공 아님. 설정·화면 검사에서 신원/거래를 생성하지 않음 |
| 목적별 CX | Pass·지원되는 사람 확인 행동·지정 Roba 혜택에 서버 세션·목적·정확한 행동 권한을 연결해 운영 반영 | 실제 모바일 신분증 소유자의 동의와 서버 동일인 결과는 별도 확인 필요 |
| OmniOne Chain | 새 Stage registry의 비개인 nonce 1 self-test를 receipt+조회로 확인. 현재 운영에는 검증된 Sui 실행 뒤 앱 소유 테스트 체험을 확정하고 같은 DB/outbox에서 새 Stage에 기록하는 경로 활성 | 실제 사용자의 동일 이용건 최종 결과·receipt는 아직 별도 검증. 실매장 혜택·결제·예약이 아니며 기존 기록 재전송 없음 |
| Gemini | 유효한 실제 `gemini-2.5-flash` 응답 단독 확인. 운영도 이 고정 모델을 요청하며 이용건당 영속 예약으로 중복 요청을 차단 | 원래 flash-lite만 요구한 probe는 exit 1로 보존. 유효하지 않은 출력은 rule fallback이며 운영의 모든 제안이 Gemini 성공이라는 뜻 아님 |
| Google / zkLogin | 운영의 소유 operation에 묶인 로그인·proof·서명 경로 활성. 승인된 새 전용 salt 설정 사용, 기존 seed 변경·기존 주소 migration 없음 | 로그인 페이지 HTTP 200·설정 활성·합성 회귀는 실제 사용자의 JWT·ZK proof·Sui 서명 성공이 아님 |
| OpenDID | 로컬 native bridge 비인증 GET 401 → 인증 GET 404 확인. native V1 handoff UI는 회귀 후 배포됨 | 운영 자격은 여전히 mock. 401→404는 발급/제시 성공이 아니며 실제 CX→holder 계약·공개 bridge·동일 이용건 검증이 남음 |

현재 운영은 기존 보호된 hosted Testnet 프로필에 명시적 connected opt-in을 적용한 **실제 CX / mock OpenDID / Gemini / Google·zkLogin / Sui Testnet / OmniOne Stage**입니다. 기존 접속 권한·원장·Sui 서명 역할·총량·기한은 보존했고 새 예산 풀로 초기화하지 않았습니다. native가 미완료라는 이유로 독립적인 Google·Gemini·Omni 경로를 대기시키지는 않습니다. 설정 활성과 실제 사람의 동일 이용건 성공은 별개입니다.

무료 지도·콘텐츠·개인 저장에는 CX를 강제하지 않습니다. Local Moment는 본인 확인 후 같은 초안으로 돌아오고 저장 버튼에서 해당 행동 권한을 소비합니다. 야간 지도 설정은 로컬 선언일 뿐이며, 법적 19+와 결제 KYC는 현재 미지원입니다. 기기 내 개인 기록/계획을 서버 방문 증명·실예약으로 표현하지 않습니다. 세부 배치는 루트 `artifacts/integration-handoff-20260930/CX_FINAL_PLACEMENT_AUDIT.md`를 참고합니다.

## 1. 모바일 신분증 — 본인 승인이 필요할 때

1. PC에서 [메인 앱의 로바](https://ktour-id.vercel.app/?venueId=mois-0021cd596bc5b2a922ad&review=0)를 엽니다.
2. `장소 상세` → `체험 혜택 보기`로 들어갑니다. 새 `가이드 담기`와 구분하세요. 가이드는 인증 없이 읽을 수 있습니다.
3. 기존 접속 코드가 필요하면 전달받은 코드를 입력합니다. `Simulate`가 보이면 다른 경로이므로 진행하지 않습니다.
4. 모바일 신분증 확인을 시작해 **새 QR**을 만듭니다. 같은 세션의 유효한 확인 결과가 있으면 새 요청 대신 이번 혜택의 목적에 별도 동의하고 이어갈 수 있습니다.
5. 팀원이 이미 발급받은 모바일 운전면허증 앱에서 QR을 촬영하고, 본인 휴대폰에서 직접 정보 제공에 동의합니다.
6. 원래 K-Tour 화면으로 돌아와 `결과 확인`을 한 번 누릅니다.
7. 성공이면 같은 화면의 다음 단계를 확인하고 알려주세요. 오류면 **오류 코드·시각·휴대폰 OS만** 알려주세요. 신분증 화면이나 QR은 보내지 않습니다. 새 이용건을 반복 생성하지 않고 기존 결과부터 확인합니다.

앱의 “정보를 제공하였습니다”만으로 서버 인증 성공은 아닙니다. `cx_subject_unavailable`이면 현재 CX 상품의 동일인 정보 제공 조건을 제가 추가 확인합니다. 임의 요청 ID로 통과시키지 않습니다. Person 근거를 19+ 또는 결제 KYC로 승격하지 않습니다.

상세 안내: [모바일 신분증 현장 체크리스트](TUESDAY_MOBILE_ID_CHECK_2026-09-29.md).
새 CX 요청도 **같은 총 10개 operation 풀**에 포함됩니다. 별도 신원 확인과 실제 Roba 체험은 별도 슬롯을 사용할 수 있으므로 단일 지정 경로를 우선 사용하고 반복·여러 탭 동시 확인을 피합니다.

## 2. OmniOne Chain — 운영 감사 경로 활성, 같은 이용건 검증은 별도

**추가 키 입력이나 새 계정 생성은 필요 없습니다.** 제공된 개인키·keystore의 일치, 새 계정과 Stage 체인·계약 권한을 확인한 뒤 새 registry를 배포했습니다. 실제 어댑터로 비개인 self-test 한 건을 기록하고 receipt와 readback을 확인했습니다. 가스 가격은 0이었고 기존 registry의 권한·기록은 변경하거나 재전송하지 않았습니다.

Versioned target·outbox·receipt 연결과 기존 기록 보존 코드는 구현·회귀 검증·운영 배포를 마쳤습니다. 현재 경로는 실제 CX 근거와 검증된 Sui 실행 후 **별도 확인 버튼으로 앱 안의 비금전 테스트 체험을 확정**하고 동일 결과를 새 Stage에 기록합니다. mock 자격을 실제 native 자격으로 부르거나 실매장 제공 의무를 만들지 않습니다.

남은 일은 사람의 동의·승인 이후 실제 동일 operation의 서비스 결과와 해당 receipt를 대조하는 것입니다. 이는 제가 수행할 엔지니어링이며, 새 키를 다시 받는 단계가 아닙니다. 불명 전송은 같은 결과를 조회하며 자동 재송신하지 않습니다. 새 registry 배포가 기존 계약의 owner/recorder 권한을 이어받았다는 뜻도 아닙니다.

참고로 **RPC URL의 API 토큰과 거래 서명 수단은 다릅니다.** 공식 2026 가이드 p33–34는 EOA 계정·개인키와 API Key를 별도로 안내합니다. p41의 `eth_sendRawTransaction`은 이미 서명한 거래를 전송하는 API이지 관리형 서명 서비스의 증거가 아닙니다. 관리자 화면의 새 EOA는 keystore+암호 방식이며, 기존 키 재내보내기 지원을 확인한 것은 아닙니다.

근거: [2026 해커톤 공식 가이드 p33–34·41](https://opendid.org/download/hackathon/2026/2026%20%EB%B8%94%EB%A1%9D%EC%B2%B4%EC%9D%B8%20%26%20AI%20%ED%95%B4%EC%BB%A4%ED%86%A4%20%EA%B0%80%EC%9D%B4%EB%93%9C%EB%B6%81.pdf?v=20260430). 공개 self-test 결과는 루트 `artifacts/integration-handoff-20260930/omnione-selftest-result.json`에 있습니다. 토큰·키·keystore·암호는 포함하지 않습니다.

## 3. Google / zkLogin — 운영 경로 활성, 직접 로그인·승인은 본인

Client ID는 이미 보관했습니다. **새 프로젝트·Client ID·Client secret을 요청하지 않습니다.** 다음 주소를 사용하는 Google 로그인 페이지 HTTP 200을 확인했습니다.

- JavaScript origin: `https://ktour-id.vercel.app`
- Redirect URI: `https://ktour-id.vercel.app/hackathon/zklogin/callback` (끝에 `/` 없음)

사용자의 승인에 따라 **새 전용 namespace**의 salt seed를 Git 밖 0600 파일로 준비했고, 검토한 설정을 운영에 활성화했습니다. 기존 seed를 읽거나 바꾸지 않았고, 기존 사용자 주소를 migration하지 않습니다. 같은 승인을 다시 요청하지 않습니다. 초기 합성 salt 검사는 제공자 요청 없이 수행했으며, 실제 Google 로그인·proof 성공과는 다릅니다.

실제 Google 로그인·동의는 본인이 해야 합니다. **Safari 또는 Chrome에서 운영 주소를 직접 열고**, 위 Roba 체험의 본인 확인·자격 제시·제안 단계를 거쳐 Google 승인 경로를 선택합니다. 현재 native 앱 내부 WKWebView Google 로그인은 지원하지 않습니다. Google 로그인은 CX 신분증 확인이나 혜택 실행 승인을 대신하지 않으며, 화면의 실행 범위와 수신자·기한을 확인한 뒤 별도로 승인합니다.

서버는 같은 operation·세션·원천 신원·nonce/state·기한에 결속한 attempt를 만들고 Google 서명·대상·만료를 검증합니다. 이용건당 최대 3회이며, 전송 결과가 불명이면 기존 attempt를 조회하고 자동으로 proof를 재요청하지 않습니다. 실제 JWT·proof·Sui 효과 대조는 제가 맡고, 사용자에게 JWT나 개인키 전달을 요구하지 않습니다. native 계약을 기다리지 않고 이 웹 경로를 켰지만, 실제 로그인 페이지 접근 성공을 zkLogin 거래 성공으로 간주하지 않습니다.

근거: [Google OpenID Connect 설정](https://developers.google.com/identity/openid-connect/openid-connect).

## 4. Gemini — 고정 모델 운영 활성, 제안별 출처 확인

**키나 결제 정보를 다시 보내지 않아도 됩니다.** 인증 HTTP 200을 확인했고, 실제 `gemini-2.5-flash`의 제한된 구조화 제안이 검증을 통과했습니다. 과거 probe에서는 flash가 선호 모델 flash-lite의 허용된 대체 모델이었지만, **현재 connected 운영은 검증된 `gemini-2.5-flash`를 고정**해 사용합니다.

앞선 응답은 구조가 맞지 않아 rule fallback이었고, 이후 유효한 응답을 얻은 원래 probe도 정확히 flash-lite를 요구한 단언 때문에 **exit 1**로 끝났습니다. 그 명령을 PASS로 바꾸어 보고하지 않습니다. `artifacts/integration-handoff-20260930/ai-actual-verification.json`에 실패와 유효 응답의 범위를 함께 남겼습니다.

단독 응답 확인은 합성·비개인 입력의 실제 모델 검증이지 신원 확인이나 체인 실행이 아닙니다. 운영은 이용건당 요청 전에 영속 예약하며, 고정 모델에 한 번만 요청하고 다른 모델로 재요청하지 않습니다. 구조·행동·대상·언어 검증을 통과한 응답만 Gemini 출처로 표시합니다. 실패·거절된 출력은 **로컬 rule fallback**으로 구분하며, 불명 결과는 자동 재과금하지 않습니다. 사람의 실제 이용건에서 mode/model·출력·승인 범위를 대조하는 검증은 제가 수행합니다. 추가 유료 결제·한도 변경은 임의로 진행하지 않습니다.

## 5. OpenDID — 기존 Claude 작업을 그대로 인계

이미 진행 중인 native를 다시 만들 필요 없습니다. 로컬 bridge의 인증 경계는 확인했고, 메인 native V1 handoff UI는 구현·30+4 브라우저 검사 후 `cdd5afc8`에 배포하여 현재 앱에도 포함돼 있습니다. **실제 native provider는 미활성이고 운영 자격은 mock**입니다. 실제 CX→holder 결합·공개 bridge·같은 이용건 발급/제시 검증은 남았습니다. UI 검사는 합성 fixture 기반이므로 실제 기기 발급 성공과 구분합니다. 다음 문구를 기존 Claude 작업에 전달할 수 있습니다.

> `/Users/woogieboogie/github/k-tour-id/artifacts/integration-handoff-20260930/CLAUDE_NATIVE_MAIN_HANDOFF.md`를 읽고 기존 native 작업을 이어 주세요.
> 로컬 인증 GET의 401→404는 확인했지만 발급·동일인 성공으로 해석하지 않습니다.
> 실제 CX evidence와 CAS holder/kycRef를 세션·operation·동의·기한·nonce에 묶는 계약, 메인 서버가 접근 가능한 공개 bridge와 인증·issuer/schema pin을 인계해 주세요.
> 우선 실제 native V1 `redeem_demo_entitlement` 계약을 연결합니다. 새 guide V2 권한으로 자동 승격하지 않습니다.
> synthetic holder나 임의 해시로 실제 동일인 결합을 대체하지 말아 주세요.
> 기존 native worktree에서 계속 진행하고, 변경 파일·실제 검증 결과·비밀값 제외 설정명만 인계해 주세요. 메인 앱·Production·Sui 원장은 Codex가 담당합니다.

실기기 앱 설치·서명·신분증/자격 제시 승인처럼 본인만 가능한 요청이 오면 그 부분만 직접 진행합니다. 앱을 여는 데 성공한 것과 VC/VP를 서버에서 검증한 것은 다릅니다.

## 동의·native 인계 뒤에도 제가 해야 하는 일

- 실제 CX 완료 응답을 원래 transaction·세션·주체에 결속하고, 새 목적 동의와 원본 취소·만료가 후속 단계에 반영되는지 확인합니다.
- 같은 이용건에서 제안의 실제 provider 출처, Google proof와 명시적 승인, Sui 효과/이벤트, 최종 DB 결과, 해당 OmniOne outbox/receipt를 대조합니다. 개별 self-test나 과거 영수증을 새 이용건 결과로 합치지 않습니다.
- native가 실제 인증 계약·공개 endpoint·issuer/schema·상태/취소 규칙을 인계하면 main resolver를 구현·주입하고, 다른 holder/세션·만료·취소·replay·응답 유실 부정 테스트를 추가한 뒤 배포·실기기 왕복을 검증합니다. `providerIntegrationAvailable=false`를 flag로만 뒤집는 작업이 아닙니다.
- native V1 권한과 guide-save V2 정책은 다릅니다. 별도 실제 계약 없이 가이드 저장 권한으로 자동 승격하지 않습니다. 안내·본인 동의가 끝났다는 이유로 이 개발과 전체 검증이 완료됐다고 표현하지 않습니다.

## 필요할 때 알려줄 결과

```text
모바일 신분증: 성공 / 오류 코드 + 시각 + 휴대폰 OS / 아직
Google 직접 로그인·승인(같은 운영 이용건에서): 완료 / 오류 코드 / 아직
OpenDID Claude: 인계 진행 중 / 계약·공개 bridge 준비 / 실기기 승인 필요
```

**키 3종은 수령 완료이므로 이 양식에 다시 넣지 않습니다.** Vercel 환경 변수·Runtime flag·Redeploy·기존 원장도 직접 변경하지 않습니다. 독립적인 connected 연결·배포는 끝났고, 사람의 동의 및 native 계약 인계 뒤의 연결 개발·동일 operation 전체 검증은 제가 계속 진행합니다. 현재 상태를 “키 입력만 남음” 또는 “전체 완료”라고 표현하지 않습니다.

현재 승인된 Testnet 한도는 **총 10개 operation / 최대 0.3 SUI / 2026-09-30 23:59:59 KST까지**입니다. 새 CX도 기존과 같은 풀을 사용합니다. 활성화 전 읽기 전용 조회에서는 5/10 사용·5개 남음을 확인했지만, 이는 그 시점의 관측이지 현재 잔여량 보장은 아닙니다. 기간·가스·횟수는 임의로 늘리거나 초기화하지 않습니다. 한도/기한으로 중단되면 추가 실행 전에 확인합니다.

최신 운영 증빙: 루트 `artifacts/integration-handoff-20260930/CONNECTED_RELEASE.md` 및 `production-64f2a4fc-connected-config.json`. 앞선 `artifacts/main-flow-integration-20260929/RELEASE_2026-09-30.md`는 역사 기록으로 보존합니다. 문서만 수정한 main commit을 새로운 앱 배포 또는 새로운 provider 성공으로 세지 않습니다.
