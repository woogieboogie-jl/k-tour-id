# 내가 직접 할 것 — 순서대로 체크하기

기준: 2026-09-29. 비밀키·API 키·QR·CI·JWT는 채팅, GitHub, 이 문서에 붙이지 않습니다.
배포 계정은 자동 갱신해 복구했습니다. **Vercel 재로그인, Sui 키 발급, Testnet 가스 재발급은 지금 할 일이 아닙니다.**

전체 연동이 이미 완료됐다는 뜻은 아닙니다. 실제 본인 확인, 제공자 권한, 별도 OpenDID 작업의 인계가 필요합니다.
그 이후의 서버 설정·호환성 수정·공유 예산 연결·배포·통합 검증은 제가 맡습니다.

**이번 재검토에서 줄인 요청:** 기존 체험 혜택을 중단할지 결정할 필요가 없습니다. 기존 흐름과 새 가이드가 같은 10회 한도를 공유하는 방식을 구현·검증했습니다. 운영 배포 삭제·키 폐기·기존 원장 초기화는 하지 않습니다. OmniOne API URL도 이미 받은 것으로 다시 확인해 안전하게 보관했으므로 재전달하지 않아도 됩니다.

## 1. 팀원과 모바일 신분증 확인하기

1. PC에서 [메인 앱의 로바](https://ktour-id.vercel.app/?venueId=mois-0021cd596bc5b2a922ad&review=0)를 엽니다.
2. `장소 상세` → `체험 혜택 보기`로 들어갑니다. 새 `가이드 담기`와 구분하세요. 가이드는 인증 없이 읽을 수 있습니다.
3. 기존 접속 코드가 필요하면 전달받은 코드를 입력합니다. `Simulate`가 보이면 다른 경로이므로 진행하지 않습니다.
4. 모바일 신분증 확인을 시작해 **새 QR**을 만듭니다.
5. 팀원이 이미 발급받은 모바일 운전면허증 앱에서 QR을 촬영합니다. 본인 휴대폰에서 직접 정보 제공에 동의합니다.
6. 원래 K-Tour 화면으로 돌아와 `결과 확인`을 한 번 누릅니다.
7. 성공이면 알려주세요. 오류면 **오류 코드·시각·휴대폰 OS만** 알려주세요. 신분증 화면이나 QR은 보내지 않습니다.

앱의 “정보를 제공하였습니다”만으로 서버 인증 성공은 아닙니다. `cx_subject_unavailable`이면 현재 CX 상품의 동일인 정보 제공 조건을 추가 확인해야 합니다. 임의 요청 ID로 통과시키지 않습니다.

상세 안내: [모바일 신분증 현장 체크리스트](TUESDAY_MOBILE_ID_CHECK_2026-09-29.md).
새 요청은 한정된 실행 횟수에 포함되므로 여러 번 반복하지 마세요.

## 2. OmniOne Chain 담당자에게 이 문장 전달하기

아래를 그대로 전달하면 됩니다. 기존 API URL이나 KTourAnchor 소스는 다시 받을 필요 없습니다.

> K-Tour의 OmniOne Stage(Chain ID 201210) 기록을 앱에서 직접 쓰려 합니다.
> 현재 사용 계약은 DemoEntitlementRegistry `0x696bc4e29c8f8079b6d3cd49d310a09577550e4c`이고,
> 승인 recorder는 `0x003403Cb95c2FFd66BC5748738d96C4A5B48b4ba`입니다.
> 이 recorder로 서명할 수 있는 수단을 안전하게 인계해 주세요.
> 내보낼 수 있는 전용 키가 있으면 아래 전용 숨김 입력 도구에 소유자가 직접 넣어 주세요.
> 키를 내보낼 수 없다면 사용 가능한 서버 서명 API와 권한 설정 방법을 알려 주세요.
> KTourAnchor는 다른 ABI이므로 승인된 리소스 화면이나 그 계약 주소만으로 대체할 수 없습니다.

전용 키를 받을 수 있을 때만 아래 공통 절차의 `omnione` 명령으로 보관합니다.
받은 키가 올바른 recorder인지, 계약 권한·chain/code·실제 receipt가 맞는지는 제가 검증합니다.
개인 자산용 지갑의 시드 구문을 공유하지 마세요.

2026-09-29 15:14 KST에 기존 API로 Chain ID 201210, 배포된 registry 코드, 위 recorder의 허용 상태를 다시 조회했습니다. **조회 권한은 이미 있습니다. 부족한 것은 이 recorder로 실제 서명할 수단뿐입니다.** 조회 성공을 새 기록 쓰기 성공으로 간주하지 않습니다.

## 3. Google 로그인 관리자 설정하기

이미 프로젝트가 있으면 **새 프로젝트나 새 salt를 만들지 말고 기존 것**을 사용합니다.

1. [Google Cloud의 OAuth 클라이언트](https://console.cloud.google.com/auth/clients)를 엽니다.
2. K-Tour용 프로젝트를 선택하고 Web application 클라이언트를 열거나 생성합니다.
3. JavaScript origin에 `https://ktour-id.vercel.app`를 넣습니다.
4. Redirect URI에 정확히 `https://ktour-id.vercel.app/hackathon/zklogin/callback`를 넣습니다. 끝에 `/`를 추가하지 않습니다.
5. 앱이 제한된 사용자만 허용하는 상태라면 실제 확인할 Google 계정을 허용 사용자로 등록합니다.
6. Client ID를 아래 절차의 `google` 명령으로 보관합니다. **Client secret은 이 로그인 방식에서 요청하지 않습니다.**
7. 기존 zkLogin 사용자가 있었다면 그 사실과 기존 salt 보관 위치만 알려주세요. salt를 새로 생성하거나 변경하지 않습니다.

실제 Google 로그인·동의는 통합 경로가 활성화된 뒤 본인이 한 번 수행해야 합니다. Prover 선택·서버 salt 준비·Sui 서명 검증은 제가 합니다. Enoki 가입을 먼저 할 필요는 없습니다.
근거: [Google OpenID Connect 설정](https://developers.google.com/identity/openid-connect/openid-connect).

## 4. Gemini 키 준비하기

1. [Google AI Studio API 키 관리](https://aistudio.google.com/api-keys)를 엽니다.
2. 사용 권한이 있는 K-Tour 프로젝트의 기존 키를 사용하거나 전용 키를 만듭니다.
3. 해당 프로젝트에서 Gemini API를 사용할 수 있는지 확인합니다. 새 유료 결제가 필요하면 바로 결제하지 말고 먼저 알려주세요.
4. 아래 절차의 `gemini` 명령으로 보관합니다.

실제 모델 응답과 출처, 잘못된 행동 제안 차단은 제가 확인합니다. 정해진 규칙으로 만든 제안을 Gemini 성공이라고 처리하지 않습니다.
근거: [Gemini API 키 안내](https://ai.google.dev/gemini-api/docs/api-key).

## 안전한 입력 보관 — 위 2·3·4번 공통

이건 **이 Mac에만 안전하게 입력을 보관하는 단계**입니다. Preview에서 본인 인증을 해 달라는 뜻이 아닙니다. 실제 사용 검수는 메인 주소에서 합니다.

1. Mac의 터미널을 엽니다.
2. 아래 첫 줄을 한 번 실행합니다.
3. 받은 항목에 해당하는 명령을 실행합니다.
4. 안내가 나오면 **그때 값을 붙여 넣고 Enter**를 누릅니다. 화면에 값이 안 보이는 게 정상입니다. 명령 뒤에 값을 붙이지 않습니다.
5. 저장 완료 메시지를 확인합니다. 취소하려면 Ctrl+C를 누릅니다.
6. 채팅에는 `OmniOne 키 보관 완료 / Google 설정 완료 / Gemini 키 보관 완료` 중 완료된 항목만 알려주세요. 값은 보내지 않습니다.

```sh
cd /Users/woogieboogie/github/k-tour-id/.codex-worktrees/main-journey-20260929/k-tour-id-app
```

```sh
node scripts/capture-integration-owner-inputs.mjs omnione
```

```sh
node scripts/capture-integration-owner-inputs.mjs google
```

```sh
node scripts/capture-integration-owner-inputs.mjs gemini
```

필요한 명령만 실행하면 됩니다. 입력값은 Git 밖의 소유자 전용 파일에 보관하고, 기존 값을 덮어쓰지 않습니다. OmniOne은 현재 승인 recorder와 키가 맞는지도 확인합니다. 주소가 다르거나 이미 저장돼 있다는 안내가 나오면 삭제·변경하지 말고 알려주세요.

**Vercel 환경 변수, Runtime flag, Redeploy, 원장은 직접 변경하지 않습니다.** 제가 정확한 `ondo` 계정·환경에 연결하고 검수합니다. 현재 운영 배포를 키 입력만으로 바꾸지 않습니다. 환경 설정은 새 배포부터 적용되므로 기존 배포와 새 설정을 구분합니다. [Vercel 환경 설정 안내](https://vercel.com/docs/environment-variables).

## 5. Claude에게 OpenDID 인계사항 전달하기

이미 진행 중인 OpenDID를 다시 만들 필요 없습니다. 다음 문장을 그대로 복사해 주세요.

> K-Tour 메인 연결 어댑터와 native QR/refresh/cancel UI를 별도 통합 worktree에 준비했습니다.
> `/Users/woogieboogie/github/k-tour-id/.codex-worktrees/main-journey-20260929/docs/OPENDID_PROVIDER_INTEGRATION_2026-09-29.md`를 읽고 인계해 주세요.
> 남은 핵심은 (1) 실제 CX evidence를 CAS의 올바른 holder/kycRef에 안전하게 결합하는 계약,
> (2) 기존 redeem_demo_entitlement 권한과 새 save-neighborhood-guide-to-pass 권한의 명시적 분리,
> (3) 메인 서버에서 접근 가능한 bridge 배포·인증·issuer/schema pin,
> (4) 실제 기기의 발급→제시→상태 확인 왕복입니다.
> synthetic holder나 임의 해시로 실제 동일인 결합을 대체하지 말아 주세요.
> 원래 OpenDID worktree에서 계속 진행하고, 변경 파일·실제 검증 결과·비밀값 제외 설정명만 인계해 주세요.
> 메인 앱, Production 설정, Sui 원장은 직접 변경하지 않아도 됩니다. 메인 통합은 Codex 쪽에서 담당합니다.

실기기 앱 설치/서명/앱 승인 요청이 오면 그 부분만 직접 진행합니다. 현재 QR 방식과 실제 같은 기기 딥링크 지원을 혼동하지 않습니다.

## 끝나면 이렇게만 알려주세요

```text
모바일 신분증: 성공 / 오류 코드 + 시각 / 아직
OmniOne recorder 서명 수단: 안전하게 보관 완료 / 담당자 답변 대기
Google OAuth: 설정 완료 / 아직
Gemini: 키 보관 완료 / 아직
OpenDID Claude: 전달 완료 / 인계 완료
기존 zkLogin 사용자 또는 salt: 있음(보관 위치만) / 없음 / 모름
```

입력 이후에도 자동으로 “모두 성공”으로 바뀌는 것은 아닙니다. 제가 실제 제공자 연결·공유 예산 연결·배포·동일 operation의 전체 흐름을 검증하고, 본인 승인/로그인만 요청하겠습니다.
현재 승인된 Testnet 실행 기간은 **2026-09-30 23:59:59 KST**까지입니다. 기간·가스·횟수는 임의로 늘리지 않습니다.
