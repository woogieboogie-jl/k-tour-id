# 여권 / OmniOne / AI 로컬 통합 검수

> 9월 28일 후속: 아래 수치는 최초 로컬 인계 기록이다. 후속 구현은
> `integration/autonomous-finish-20260927`에 게시하며, 실제 Redis 17/17 검수와
> 별도 Sumsub 서버 연결을 추가했다. 최신 범위와 사람만 할 수 있는 항목은
> [최종 진행 보고](./AUTONOMOUS_FINISH_2026-09-28.md)를 기준으로 본다.

작업 브랜치: `feat/hackathon-readiness-preview-20260925`

작업 폴더: `/Users/woogieboogie/github/k-tour-id/.codex-worktrees/harvey-sync-20260917/k-tour-id-app`

범위: 1·2(Sumsub Sandbox 복구와 서버 상태 저장), 6(OmniOne 거래 증거·복구), 7(AI 실제 모델 증빙). 공개 Production과 기존 CX Preview는 변경하지 않는다. CX 실제 승인, 신규 체인 거래, 실제 여권/얼굴 검증 완료 보고서가 아니다.

| 요청 | 완료한 로컬 구현 | 아직 실제 공급자로 확인하지 않은 것 |
| --- | --- | --- |
| 1. 여권/Sumsub | 기존 지갑·신원 확인 화면에 Sandbox WebSDK 진입·상태·오류·복귀 연결 | 유효한 계정 설정으로 SDK 실행 → 테스트 문서 제출 → 실제 Sandbox 결과 |
| 2. 저장·재개 | 독립 Redis namespace, 원자적 변경, 만료·취소·동일 신청자 재개, 전용 서명 webhook | 실제 Redis/공급자 webhook 배달과 재배포 후 상태 유지 |
| 6. OmniOne | receipt + event + registry + recorder + commitment 결합 검증, 기존 hash만 조회하는 복구 도구 | 인계된 인증 RPC·전용 ledger로 실제 거래 증거 대조 |
| 7. AI | 실제 성공한 요청 모델 ID 기록, fallback 구분, proposal digest에 결합 | 인계된 모델 설정으로 실제 API 응답·실행 증거 확인 |

여기서 **로컬 구현·검수 완료**와 **실연동 완료**는 별개다. Sandbox 승인만으로 패스/성인 자격/결제 권한을 만들지 않는다.

## 1. 앱에서 어디를 확인하나요?

최종 검수용 서버를 아래 주소에 켜 두었다. 다른 worktree나 megan 프로젝트에서 실행하지 않는다. 서버가 꺼졌다면 이 작업 폴더에서 다음 명령으로 다시 시작한다. 이미 켜져 있으면 중복 실행하지 않는다.

```sh
cd /Users/woogieboogie/github/k-tour-id/.codex-worktrees/harvey-sync-20260917/k-tour-id-app
pnpm build:sumsub:local
node scripts/kyc/local-sumsub.mjs start
```

주소: <http://127.0.0.1:3139/?review=0>

지도 → 아래 ID·지갑 → K-Tour ID 만들기 → 여권 → 자료 제공·동의 안내.

- 기존 지도·지갑 화면 안에서 열리며 별도 소비자 앱을 만들지 않았다.
- 이 로컬 명령은 공급자 비밀값을 상속하거나 .env를 읽지 않는다. 따라서 일반 브라우저로 열면 실제 연결 상태는 **미설정**이다.
- 실제 SDK·상태 API는 복구되어 있지만 실제 공급자 설정 없이 승인되었다고 표시하지 않는다.
- 일반 검토 모드(`review=1`)의 기존 샘플과 Sandbox 연결(`review=0`)은 별개다.
- 개발 중 자동 갱신이 필요할 때만 `pnpm dev:sumsub:local`을 사용한다. 최종 화면 검수는 위 고정 빌드를 사용했다.

## 2. 대기·승인·거절 화면을 직접 눌러보기

위 서버를 켠 상태에서 별도 터미널로 실행한다.

```sh
pnpm review:sumsub:local
```

새 Chromium 창이 기존 앱의 여권 화면까지 이동한다. 앱에는 패널이나 검수 배너가 없다. **별도 탭 `K-Tour ID · 검수 도구`**에서 접속 코드·검토 중·확인 완료·보완 요청·미승인·만료·연결 오류와 한국어/영어/일본어를 선택한다. 선택하면 앱 탭이 앞으로 열린다. 시작 화면은 검토 중이다.

이 도구는 Playwright가 해당 브라우저의 KYC 응답만 바꾼다. 앱 서버에 가짜 승인 API를 추가하지 않는다. 실제 SDK·문서 업로드·카메라·체인 요청은 하지 않는다. 접속 코드를 입력할 필요도 없다.

확인할 것:

1. 심사 중: 다시 제출하라는 안내 대신 상태 확인/닫기.
2. 확인 완료: 여권 결과에 한정한 안내이며 패스 발급·성인 인증·잔액 변경 없음.
3. 거절/만료/통신 오류: 성공으로 바뀌지 않고 복귀 가능.
4. 닫기: 원래 ID·지갑 화면으로 복귀하고 기존 초안/권한 불변.
5. 언어 전환: 긴 일본어·한국어가 화면 밖으로 넘치지 않음.

검수 탭은 개발 도구가 만든 별도 페이지다. 앱에 DOM을 삽입하지 않고 배포에도 포함되지 않는다. 공급자 Sandbox와 화면 응답 fixture는 다른 개념이며, 이 도구는 후자다. 실제 SDK를 쓰는 검수는 별도 공급자 연결이 필요하다.

## 3. 화면으로 볼 수 없는 서버 기능 검증

```sh
pnpm test:sumsub:unit
pnpm test:sumsub:ui
pnpm test:harvey:unit
pnpm test:harvey:outbox
```

- Sumsub: 세션/동의/출처 검증, 공급자 결과 매칭, 서명 webhook, 중복·역순·동시 처리, 종료·재개, 저장 실패.
- AI: 첫 모델 실패 후 실제 응답한 모델을 proposal 및 digest에 기록. 규칙 기반 대체를 실제 모델 응답으로 기록하지 않음.
- OmniOne: 성공한 다른 거래, 다른 registry/recorder/event/commitment를 사용한 확정 거부. 저장된 거래 해시만 재조회하며 복구에서 서명/재전송 0.

테스트의 가짜 HTTP/RPC 응답은 실제 Sumsub 승인이나 온체인 거래 증거가 아니다. 단위/브라우저/실연동 결과는 합산하지 않는다.

6·7번만 빠르게 확인하려면 아래 두 명령을 각각 실행한다. 소비자 화면에 새 버튼을 추가한 작업이 아니라 서버 증거 처리 개선이다.

```sh
node --import tsx --test tests/hackathon/omnione-evidence.test.ts tests/hackathon/omnione-recovery.test.ts
node --import tsx --test tests/hackathon/ai-model-provenance.test.ts
```

OmniOne은 잘못된 거래·다른 commitment를 `confirmed`로 만들지 않으며, 기존 해시 복구에서 `signatures: 0`, `broadcasts: 0`을 유지해야 한다. AI는 404 fallback 시 설정상의 첫 모델이 아니라 실제 성공한 요청 모델을 기록하고, 규칙 기반 대체 결과와 구분해야 한다. 공급자가 자체적으로 선언한 세부 모델 버전까지 검증했다는 뜻은 아니다.

## 4. 실제 공급자 연결로 넘어갈 때

기존 Sandbox 자격증명을 서버에서만 사용하고 유효성을 확인한다. 새 토큰·여권 사진·RPC 비밀값을 문서나 Git에 붙이지 않는다.

- Sumsub: Sandbox app token/secret, session secret, 접근 코드, 정확한 verification level과 허용 origin, 독립 Redis namespace, 전용 webhook secret/설정.
- 설정 이름 예시는 [비밀값 없는 환경 템플릿](../k-tour-id-app/.env.sumsub.example)에 있다. `SUMSUB_STORE_NAMESPACE`는 `ktour:sumsub:sandbox:<이름>` 형식이며 CX 저장소 키와 다르다.
- 현재 브라우저 세션은 30분, 같은 브라우저의 암호화된 복구 쿠키와 최소 서버 기록은 최초 시작부터 최대 7일이다. 닫기 후 재개에는 접속 코드·동의를 다시 요구한다. 쿠키를 지운 다른 브라우저/기기로 복구하는 기능은 아니다.
- 웹훅은 승인 권한이 아니라 상태 재확인 신호다. Sandbox는 `sandboxMode`로 구분하며 수동 테스트 발송의 `testMode`와 혼동하지 않는다. 최종 화면 결과는 공급자 상태 API로 다시 확인한다.
- SDK 호출은 브라우저이지만 app token·secret은 서버에만 있다. 브라우저에는 짧은 SDK access token만 전달한다.
- 기존 level `id-and-liveness`는 과거 기록이며 현재 계정에서 유효한지는 연결 시 다시 확인한다.
- Sandbox 계정 설정 변경이 운영 계정에 영향을 줄 수 있으므로 계정 전체의 level/브랜딩/workflow를 임의로 수정하지 않는다.
- OmniOne 복구는 전용 integration Preview ledger를 대상으로 명시적으로 실행한다. 공개 앱/CX용 ledger에 자동 실행하지 않는다.
- 복구 도구의 `--read-only`는 **체인 읽기 전용**이라는 뜻이다. 검증 결과와 임시 claim은 지정된 Redis ledger에 기록할 수 있다. `HK_STORE_KEY=ktour:integration-preview:...`, 명시적 활성화·30분 이하 만료·정확한 stage RPC/registry/recorder가 모두 필요하며, 이번에는 원격 ledger에 실행하지 않았다.
- 강한 receipt 검증을 통과한 기록에만 `receiptEvidenceVersion: 1`이 붙는다. 기존 기록에 이 표시를 일괄 추가하지 않는다. 과거 confirmed 기록을 재검사해도 서비스 혜택을 다시 실행하거나 거래를 재전송하지 않는다.
- OpenDID native·실제 금융 결제는 이 변경의 완료 범위가 아니다.

공식 참고: [WebSDK 통합](https://docs.sumsub.com/docs/get-started-with-web-sdk), [Webhook 서명](https://docs.sumsub.com/docs/webhook-manager), [Sandbox 범위](https://docs.sumsub.com/docs/test-in-sandbox).

## 최종 검수 기록

2026-09-27, 이 작업 브랜치의 로컬 결과:

- Sumsub 서버·취소/복구·서명·동시성: **36/36 PASS**.
- Sumsub 모바일 브라우저: **13/13 PASS**. Chromium, 320/390px, 한국어·일본어·영어, light/dark 포함. 실제 공급자 요청을 차단한 UI fixture다.
- 사용자용 샘플 검수 도구 `review-sumsub.mts --smoke`: **PASS**. 기존 앱에서 대기·승인·재시도·거절·만료를 순회했다.
- 해커톤 회귀: **206/206 PASS**. OmniOne/AI focused tests가 이 수에 포함되므로 중복 합산하지 않는다.
- OmniOne outbox 별도 회귀: **28/28 PASS**.
- 기존 UI·배포 프로필 계약: **964/964 PASS**.
- `pnpm exec tsc --noEmit`: **PASS**.
- `pnpm build:sumsub:local`: **PASS**, 고정 Next 빌드로 UI 재검수.
- `pnpm build:vercel:ondo-b`: **PASS**, 공개 지도용 별도 빌드와 artifact scanner 통과. 이 빌드에는 인증 SDK·`/api/kyc` 서버 경로가 없으며 공통 화면의 비활성 상태명만 남는다. 배포는 실행하지 않았다.
- `git diff --check`: **PASS**.

작성자와 다른 담당자가 교차 리뷰했다. 실제로 발견해 고친 항목은 webhook의 Sandbox/manual-test 구분, 공급자·신청자 일치, 전체 webhook 응답 제한, Redis 전체 값 비교, 취소·복구 후 늦은 결과 차단, 늦은 응답의 쿠키 덮어쓰기, AI fallback 모델 기록이다. 수정 후 독립 리뷰는 **범위 내 차단 사항 없음(GO)**이다.

일본어 320px 대기 화면, 영어 다크 접속 화면, 영어 라이트 승인 화면 캡처를 직접 확인했다. 모서리·텍스트·복귀 버튼 잘림은 관찰되지 않았다. 캡처는 `k-tour-id-app/artifacts/qa/sumsub-ui/`에 있으며 검수용 로컬 생성물이다.

이 문서를 처음 작성한 시점에는 커밋/푸시 전이었다. 이후 구현은 커밋되어 `integration/autonomous-finish-20260927`에 게시됐고, 공개 지도는 별도 릴리스로 배포됐다. 기존 CX Preview·Harvey 별도 배포·다른 프로젝트는 유지했다. 이 최초 로컬 검수 기록만으로 해커톤 실연동 완료를 선언하지 않는다.

## 제품 문구·검수 도구 후속 정리

- 여권/CX의 한·영·일 주요 문구를 여권 확인·접근 확인·진행 상태·복귀 중심으로 바꿨다. 반복적인 Test/Sandbox 배너는 제거하고 공급자 환경·미발급 범위는 개인정보/기술 상세에 남겼다.
- 앱 위에 삽입하던 노란 검수 패널을 삭제하고 별도 검수 탭으로 이동했다. 기존 앱에 가짜 성공 API를 추가하거나 권한 발급 동작을 바꾼 것이 아니다.
- 수정 후 Sumsub 서버 **36/36**, 모바일 UI **13/13**, CX focused **21/21**, 계약 **964/964**, TypeScript 포함 고정 빌드, 새 검수 탭 smoke 및 diff 검사 **PASS**. 독립 소스 리뷰에서 차단 사항 없음.
- 주요 화면에서 테스트 용어·주입 패널 부재를 검사하면서 취소·만료·거절·승인 이후 권한 불변 검사도 유지했다. 별도의 Labs나 금전 목업의 사실관계 안내까지 전역 치환으로 삭제하지 않았다.

다음 독립 작업 및 사용자 액션: [실연동 다음 작업](./INTEGRATION_NEXT_ACTIONS_2026-09-27.md).
