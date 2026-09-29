# 필요한 시점의 본인 확인 — 웹 UI 검증

이 문서는 공유 `main-journey-20260929` 작업 브랜치의 구현과 로컬 회귀 검증을 기록한다. 새 운영 배포, 사용자의 실제 모바일 신분증 승인 또는 Sui/OmniOne 실제 실행 성공을 뜻하지 않는다. 서버 권한·예산·프로필 계약은 [서버 통합 문서](JIT_IDENTITY_INTEGRATION_2026-09-29.md)를 함께 읽는다.

## 행동별 연결 상태

| 진입/행동 | 웹 동작 | 보장하지 않는 것 |
| --- | --- | --- |
| Pass → 본인 확인 | 기본 진입과 `review=0`은 현재 서버 CX 상태 조회, 별도 목적 동의, 필요한 경우 실제 제공자 handoff. 확인 영수증을 받은 뒤 상태 갱신 | 공식 신분증·VC 발급, 해외 여권 확인, 결제 KYC |
| 장소 → local moment | 정확한 장소·비공개 작성 내용·pending intent에 결속된 본인 확인. 원래 작성 내용으로 복귀하고 사용자가 저장할 때 서버 영수증을 소비 | 실제 방문 증명, 공개 게시, 업장 승인. 기록은 이 기기의 개인 기록 |
| Table 참여 요청 | 등록된 Table 정책 유지. 현재 비음주 Table의 계정 전용 정책에는 불필요한 CX를 강제하지 않음 | 실제 예약·참여·입장 확정 |
| 19+ Table | 정확한 19세 이상 제공자 계약이 없어 handoff 전에 명시적으로 차단 | CX `adultVerified`나 야간 지도 자기 선언을 19+ 권한으로 해석하지 않음 |
| 지정된 Roba 체험 | 최초 본인 확인은 기존 단일 operation 경로. 현재 CX 증거가 있으면 별도 목적 동의·영수증 후 해당 operation에 연결 | 동의만으로 VC/VP·제안·지갑 서명·AI 실행을 자동 진행하지 않음 |
| 결제 KYC | 별도 미지원 상태 | 본인 확인으로 결제 권한을 얻었다고 표시하지 않음 |
| 기존 로컬 experience / Labs badge | 기존 review·샘플 또는 미지원 경계 유지 | 공통 CX grant를 실제 혜택·민팅 권한으로 사용하지 않음 |
| 지도 탐색·공개 가이드 읽기·개인 저장 | 본인 확인 없이 이용 | 차단된 V2 제공자 여정이 성공했다고 표시하지 않음 |

한국 모바일 신분증 경로와 해외 여권 경로는 분리한다. 일본어 UI에서도 해외 여권을 OmniOne CX 지원 대상으로 소개하지 않는다. 별도 설정된 여권 확인 서비스만 별도 경로를 사용한다.

## 권한과 복귀 경계

- 신원 fixture는 `review=1`을 명시했을 때만 선택한다. 다른 제품 영역의 샘플 설정을 전역 변경하지 않았다.
- `identity/eligibility`는 표시용 상태이다. 실제 보호 행동은 정확한 문맥의 요청·동의·서버 영수증을 요구한다.
- JIT grant와 receipt는 메모리에만 존재한다. `localStorage`의 사용자/자기 선언/과거 샘플 자격은 실제 권한으로 사용하지 않는다.
- 작성 내용 자체는 서버에 보내지 않고 장소·행동·Table·개인 intent의 해시만 보낸다.
- 요청, 승인, 증거의 유효기한 중 가장 이른 기한을 사용한다. 작성 내용이나 pending token이 바뀌면 기존 승인을 사용하지 않는다.
- consume 응답 유실 시 같은 요청의 receipt를 GET으로 확인한다. 자동 POST 재시도는 하지 않는다.
- 모달 닫기·취소·교체·unmount 이후 늦은 결과는 행동을 재개시키지 않는다. 알려진 미완료 신원 요청은 취소한다.
- 모달에서 돌아왔다고 업무가 실행되는 것은 아니다. local moment의 실제 저장 등 최종 소비 지점에서 영수증과 현재 원래 intent를 재확인한다.
- 새 요청 생성·앱 호출·승인 결과 확인은 각각 명시적인 사용자 조작이다. 인증 앱을 자동으로 열지 않는다.
- 접근 오류는 서버가 반환한 정확한 프로필 코드에 대응하는 경로만 사용한다. 다른 프로필에 무작위로 재시도하지 않는다.

## 검증 결과

모든 아래 테스트는 제공자/체인 호출을 대체한 synthetic same-origin fixture 또는 순수 함수 테스트이다. 테스트 서버는 실제 API를 비활성화한 credential-free `localhost:3173`이다.

- `tests/hackathon/jit-identity-client.test.ts`: **10/10 통과**. 엄격한 DTO, mock·잘못된 문맥·만료 거부, 19+/KYC 미승격, QR/app 링크 제한, 응답 크기 제한, consume 유실 후 GET 복구, 취소 후 늦은 결과, 정확한 intent 중복 소비 방지.
- `tests/e2e/ktour-jit-identity-ui.spec.ts`: 기존 **24/24 통과**(모바일·PC 각각 12개). 기본 Pass, 목적별 재동의, 접근 복구, 거절/만료/문맥 불일치, 응답 유실, 늦은 완료 취소, local moment 원본 복귀·최종 저장, 19+ 사전 차단, Roba 첫 인증/기존 증거 재사용.
- Local moment의 실제 브라우저 검증 중 발견한 만료 계산 오류를 수정했다. 과거 review 자격의 기한이 아니라 정확한 현재 JIT grant의 기한을 읽는다. 회귀 기준을 완화하지 않고 재실행했다.
- 최종 24개 보고서: `k-tour-id-app/artifacts/qa/jit-identity-ui/final/results.json`, `junit.xml`. 같은 디렉터리의 모바일·PC Pass 동의 및 결과 스크린샷, 원래 local moment 복귀 스크린샷 확인.
- 현재 `pnpm exec tsc --noEmit --pretty false`, `git diff --check` 통과.
- 독립 피어 리뷰: 클라이언트 권한·응답 유실·취소 경계와 Local moment 최종 소비/기한 수정에 P0/P1 없음.

### Roba 추가 회귀

추가 **4/4 통과**(모바일·PC 각각 2개), 기존 24개와 합해 28개 시나리오 실행 완료:

- operation 생성이 서버에서 완료된 뒤 응답만 유실된 상황: 목적 동의/consume은 한 번, create POST도 한 번만 수행하고 같은 campaign의 entitlement를 GET 한 번 추가 조회하여 기존 operation을 복구했다. 다음 단계는 사용자 선택을 기다린다.
- `identity.sourceCurrent=false`: 기존 operation의 단계가 issuance여도 발급·제시·제안·위임·실행·사용 CTA를 노출하지 않는다. 상태 재확인·중단·원래 장소 복귀를 유지하고 이미 전송한 실행이 취소된다는 뜻이 아님을 표시한다.
- 보고서: `k-tour-id-app/artifacts/qa/jit-identity-ui/roba-recovery-final/results.json`, `junit.xml`. 같은 디렉터리의 모바일·PC `roba-source-invalid.png`를 직접 확인했다. 본문/버튼 가림이나 가로 넘침 없음.
- 첫 추가 실행은 기능 복구 성공 뒤 테스트의 총 GET 개수 기대만 실패했다. 장소 상세의 사전 조회를 제외하기 위해 POST 직전 개수를 기준으로 정확히 1회 추가 GET을 검사하도록 수정했으며, POST 중복 금지 기준은 유지했다.

최신 운영 검증은 배포 SHA를 지정한 후 별도로 해야 한다.
