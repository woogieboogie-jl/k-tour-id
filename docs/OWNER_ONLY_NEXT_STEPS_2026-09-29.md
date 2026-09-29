# 지금 직접 필요한 일과 이미 끝난 준비

기준: 2026-09-30 재확인. 비밀키·API 키·keystore·암호·QR·CI·JWT는 채팅, GitHub, 이 문서에 붙이지 않습니다.

**OmniOne 새 EOA 서명 수단, Google Client ID, Gemini 키는 모두 받아 안전하게 보관했습니다. 다시 발급하거나 전달할 필요 없습니다.** Vercel 재로그인, Sui 키·Testnet 가스 재발급, 기존 서비스 중단·원장 초기화도 요청하지 않습니다.

키를 받은 것과 전체 연동을 마친 것은 다릅니다. 남은 연결·설정·배포·통합 검증은 제가 진행하며, 실제 신분증 동의·Google 로그인·실기기 승인은 본인이 해야 합니다. 아래 5개는 서로 다른 상태를 확인하는 항목이지, 아직 못 받은 입력 5개가 아닙니다.

## 현재 확인된 결과

| 영역 | 확인한 사실 | 아직 같은 의미가 아닌 것 |
| --- | --- | --- |
| 운영 웹 | `9789de1a` 배포 READY. 운영 공통 장소 흐름 2/2, 중앙 장소 패널 16/16 읽기 전용 검사 PASS | 실제 제공자의 동일 이용건 전체 E2E 성공 아님 |
| 목적별 CX | Pass·지원되는 사람 확인 행동·지정 Roba 혜택에 서버 세션·목적·정확한 행동 권한을 연결해 운영 반영 | 실제 모바일 신분증 소유자의 동의와 서버 동일인 결과는 별도 확인 필요 |
| OmniOne Chain | 새 Stage registry 배포와 실제 어댑터의 nonce 1 기록을 receipt+조회로 확인. 기존 기록 재전송 0건 | 비개인 self-test이며 실제 사용자의 혜택 완료·전체 신원 연동 증거 아님 |
| Gemini | 키 인증 HTTP 200. 구조 검증을 통과한 실제 `gemini-2.5-flash` 응답 확인 | 선호한 flash-lite만 허용한 원래 probe는 exit 1. 운영은 아직 rule 모드 |
| Google / zkLogin | Client ID 확보. 운영 callback을 사용하는 로그인 페이지 HTTP 200. 승인된 별도 namespace의 새 salt seed를 Git 밖 0600 파일로 준비 | JWT·ZK proof·Sui 서명 검증 아님. 기존 seed 열람·변경·사용자 migration 없음. 새 설정 미활성 |
| OpenDID | 로컬 native bridge의 비인증 GET 401 → 인증 GET 404 확인 | 통신·인증 경계 검사일 뿐 발급·제시 성공 아님. 실제 CX→holder 결합과 공개 bridge 연결 미완료 |

현재 운영 프로필은 `cx-sui`: 실제 CX 어댑터 / **mock OpenDID / rule AI / demo Ed25519**입니다. 후속 안전성 보강은 별도 준비 중이며, 배포·활성화가 확인되기 전에는 운영 성공으로 합치지 않습니다.

## 1. 모바일 신분증 — 본인 승인이 필요할 때

1. PC에서 [메인 앱의 로바](https://ktour-id.vercel.app/?venueId=mois-0021cd596bc5b2a922ad&review=0)를 엽니다.
2. `장소 상세` → `체험 혜택 보기`로 들어갑니다. 새 `가이드 담기`와 구분하세요. 가이드는 인증 없이 읽을 수 있습니다.
3. 기존 접속 코드가 필요하면 전달받은 코드를 입력합니다. `Simulate`가 보이면 다른 경로이므로 진행하지 않습니다.
4. 모바일 신분증 확인을 시작해 **새 QR**을 만듭니다. 같은 세션의 유효한 확인 결과가 있으면 새 요청 대신 이번 혜택의 목적에 별도 동의하고 이어갈 수 있습니다.
5. 팀원이 이미 발급받은 모바일 운전면허증 앱에서 QR을 촬영하고, 본인 휴대폰에서 직접 정보 제공에 동의합니다.
6. 원래 K-Tour 화면으로 돌아와 `결과 확인`을 한 번 누릅니다.
7. 성공이면 알려주세요. 오류면 **오류 코드·시각·휴대폰 OS만** 알려주세요. 신분증 화면이나 QR은 보내지 않습니다.

앱의 “정보를 제공하였습니다”만으로 서버 인증 성공은 아닙니다. `cx_subject_unavailable`이면 현재 CX 상품의 동일인 정보 제공 조건을 제가 추가 확인합니다. 임의 요청 ID로 통과시키지 않습니다. Person 근거를 19+ 또는 결제 KYC로 승격하지 않습니다.

상세 안내: [모바일 신분증 현장 체크리스트](TUESDAY_MOBILE_ID_CHECK_2026-09-29.md).
새 CX 요청도 **같은 총 10개 operation 풀**에 포함됩니다. 별도 신원 확인과 실제 Roba 체험은 별도 슬롯을 사용할 수 있으므로 단일 지정 경로를 우선 사용하고 반복·여러 탭 동시 확인을 피합니다.

## 2. OmniOne Chain — 서명 수단 수령·새 기록 검증 완료

**추가 키 입력이나 새 계정 생성은 필요 없습니다.** 제공된 개인키·keystore의 일치, 새 계정과 Stage 체인·계약 권한을 확인한 뒤 새 registry를 배포했습니다. 실제 어댑터로 비개인 self-test 한 건을 기록하고 receipt와 readback을 확인했습니다. 가스 가격은 0이었고 기존 registry의 권한·기록은 변경하거나 재전송하지 않았습니다.

Versioned target·outbox·receipt 연결과 기존 기록 보존 코드는 구현·회귀 검증을 마쳤습니다. 남은 일은 검토한 코드를 배포하고, 실제 동일 operation의 최종 서비스 결과와 체인 기록을 검증하는 것입니다. 이는 제가 수행할 엔지니어링이며, 새 키를 다시 받는 단계가 아닙니다. 새 registry 배포가 기존 계약의 owner/recorder 권한을 이어받았다는 뜻은 아닙니다.

참고로 **RPC URL의 API 토큰과 거래 서명 수단은 다릅니다.** 공식 2026 가이드 p33–34는 EOA 계정·개인키와 API Key를 별도로 안내합니다. p41의 `eth_sendRawTransaction`은 이미 서명한 거래를 전송하는 API이지 관리형 서명 서비스의 증거가 아닙니다. 관리자 화면의 새 EOA는 keystore+암호 방식이며, 기존 키 재내보내기 지원을 확인한 것은 아닙니다.

근거: [2026 해커톤 공식 가이드 p33–34·41](https://opendid.org/download/hackathon/2026/2026%20%EB%B8%94%EB%A1%9D%EC%B2%B4%EC%9D%B8%20%26%20AI%20%ED%95%B4%EC%BB%A4%ED%86%A4%20%EA%B0%80%EC%9D%B4%EB%93%9C%EB%B6%81.pdf?v=20260430). 공개 self-test 결과는 루트 `artifacts/integration-handoff-20260930/omnione-selftest-result.json`에 있습니다. 토큰·키·keystore·암호는 포함하지 않습니다.

## 3. Google / zkLogin — Client ID 수령, 본인 로그인은 별도

Client ID는 이미 보관했습니다. **새 프로젝트·Client ID·Client secret을 요청하지 않습니다.** 다음 주소를 사용하는 Google 로그인 페이지 HTTP 200을 확인했습니다.

- JavaScript origin: `https://ktour-id.vercel.app`
- Redirect URI: `https://ktour-id.vercel.app/hackathon/zklogin/callback` (끝에 `/` 없음)

사용자의 승인에 따라 **새 전용 namespace**의 salt seed를 Git 밖 0600 candidate 파일로 준비했습니다. 기존 seed를 읽거나 바꾸지 않았고, 기존 사용자 주소를 migration하지 않습니다. 합성 입력으로 안정성·서로 다른 subject 분리·128-bit 범위를 확인했으며 제공자 요청은 0건입니다. **아직 production에는 활성화하지 않았습니다.** 같은 승인을 다시 요청하지 않습니다.

실제 Google 로그인·동의는 안전한 통합 경로를 준비한 뒤 본인이 한 번 해야 합니다. 제가 정확한 경로를 안내하겠습니다. Prover 연결·실제 JWT·proof·Sui 서명 검증과 배포는 제가 맡습니다. 현재 로그인 페이지 접근 성공을 zkLogin 거래 성공으로 간주하지 않습니다. native 계약·공개 호스트 검증이 남은 상태에서 새 전체 프로필을 열지 않습니다.

근거: [Google OpenID Connect 설정](https://developers.google.com/identity/openid-connect/openid-connect).

## 4. Gemini — 키 수령·실제 응답 확인, 운영 활성화는 별도

**키나 결제 정보를 다시 보내지 않아도 됩니다.** 인증 HTTP 200을 확인했고, 실제 `gemini-2.5-flash`의 제한된 구조화 제안이 검증을 통과했습니다. 이는 허용된 fallback 모델이며 선호 모델은 `gemini-2.5-flash-lite`입니다.

앞선 응답은 구조가 맞지 않아 rule fallback이었고, 이후 유효한 응답을 얻은 원래 probe도 정확히 flash-lite를 요구한 단언 때문에 **exit 1**로 끝났습니다. 그 명령을 PASS로 바꾸어 보고하지 않습니다. `artifacts/integration-handoff-20260930/ai-actual-verification.json`에 실패와 유효 응답의 범위를 함께 남겼습니다.

합성·비개인 입력의 실제 모델 검증이지 신원 확인이나 체인 실행이 아닙니다. **현재 운영은 아직 rule 모드**입니다. 출력 제한·모델 출처·실패 fallback과 배포 후 적용은 제가 확인합니다. 추가 유료 결제·한도 변경은 임의로 진행하지 않습니다.

## 5. OpenDID — 기존 Claude 작업을 그대로 인계

이미 진행 중인 native를 다시 만들 필요 없습니다. 로컬 bridge의 인증 경계는 확인했고, 메인 native V1 handoff UI는 구현·30+4 브라우저 검사 후 동결했습니다. 아직 후속 배포 전이며, 실제 CX→holder 결합·공개 bridge·같은 이용건 발급/제시 검증은 남았습니다. UI 검사는 합성 fixture 기반이므로 실제 기기 발급 성공과 구분합니다. 다음 문구를 기존 Claude 작업에 전달할 수 있습니다.

> `/Users/woogieboogie/github/k-tour-id/artifacts/integration-handoff-20260930/CLAUDE_NATIVE_MAIN_HANDOFF.md`를 읽고 기존 native 작업을 이어 주세요.
> 로컬 인증 GET의 401→404는 확인했지만 발급·동일인 성공으로 해석하지 않습니다.
> 실제 CX evidence와 CAS holder/kycRef를 세션·operation·동의·기한·nonce에 묶는 계약, 메인 서버가 접근 가능한 공개 bridge와 인증·issuer/schema pin을 인계해 주세요.
> 우선 실제 native V1 `redeem_demo_entitlement` 계약을 연결합니다. 새 guide V2 권한으로 자동 승격하지 않습니다.
> synthetic holder나 임의 해시로 실제 동일인 결합을 대체하지 말아 주세요.
> 기존 native worktree에서 계속 진행하고, 변경 파일·실제 검증 결과·비밀값 제외 설정명만 인계해 주세요. 메인 앱·Production·Sui 원장은 Codex가 담당합니다.

실기기 앱 설치·서명·신분증/자격 제시 승인처럼 본인만 가능한 요청이 오면 그 부분만 직접 진행합니다. 앱을 여는 데 성공한 것과 VC/VP를 서버에서 검증한 것은 다릅니다.

## 필요할 때 알려줄 결과

```text
모바일 신분증: 성공 / 오류 코드 + 시각 + 휴대폰 OS / 아직
Google 직접 로그인(진행 요청을 받은 경우): 완료 / 오류 코드 / 아직
OpenDID Claude: 인계 진행 중 / 계약·공개 bridge 준비 / 실기기 승인 필요
```

**키 3종은 수령 완료이므로 이 양식에 다시 넣지 않습니다.** Vercel 환경 변수·Runtime flag·Redeploy·기존 원장도 직접 변경하지 않습니다. 실제 제공자 연결·배포·동일 operation의 전체 검증은 제가 계속 진행하며, 현재 상태를 “사용자 입력만 남음” 또는 “전체 완료”라고 표현하지 않습니다.

현재 승인된 Testnet 한도는 **총 10개 operation / 최대 0.3 SUI / 2026-09-30 23:59:59 KST까지**입니다. 새 CX도 같은 풀을 사용하며, 기간·가스·횟수는 임의로 늘리지 않습니다. 운영 근거는 루트 `artifacts/main-flow-integration-20260929/RELEASE_2026-09-30.md`를 확인합니다.
