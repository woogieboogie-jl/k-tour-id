# Sumsub 실제 서버 연결 — 2026-09-28

## 환경

- 전용 branch: `integration/sumsub-live-20260927`.
- project: jaewook / `ondo`, 지역 `icn1`, **Preview 전용**.
- 공개 지도와 기존 CX Preview는 변경하지 않는다. HK 실행·QA 제어는 꺼져 있다.
- 만료: **2026-09-30 23:59:59 KST**. 이후 서버는 자동으로 unavailable 처리한다.
- 기존 제공된 Sandbox 키로 연결했고, 새로운 계정/결제수단을 만들지 않았다.
- 비밀값은 해당 branch에만 scoped encrypted 환경변수로 등록. Redis 인프라는
  승인된 기존 pair를 사용하되 Sumsub namespace는 CX와 분리한다.

확인 경로: **지갑/Travel pass → K-Tour ID 만들기 → 여권 → 동의 → 접속 코드 → 인증 화면**.
접속 코드는 기존 `SUMSUB_PREVIEW_ACCESS_CODE`이며 새로 준비할 값이 아니다.
검수 담당자가 확인한 링크와 코드를 안전한 경로로 전달하거나 검수 브라우저에 입력한다.
참여자가 직접 Vercel에서 찾도록 요구하지 않는다. 관리자가 확인할 위치는 jaewook /
ondo / Settings / Environment Variables / Preview / `integration/sumsub-live-20260927`이다.
`SUMSUB_SESSION_SECRET`·`SUMSUB_WEBHOOK_SECRET`을 접속 코드로 쓰지 않는다.

## 수행한 실제 통신

1. 현재 계정 verification level 조회 200, 지정 level 존재 확인.
2. 실제 Sandbox SDK 토큰 발급 200, synthetic 외부 사용자 ID 일치 확인.
3. 브라우저의 기존 지갑→K-Tour ID→여권→동의→WebSDK 진입.
4. 실제 SDK 생성 신청자의 status GET에서 응답 형식 버그 발견·수정.
   `sandboxMode`는 webhook에서는 필수지만 일반 applicant GET 응답에는 없었다.
   signed `sbx:` API 토큰 범위에서 GET하고 외부 ID·신청자 ID·level을 대조한다.
   응답에 sandbox marker가 명시돼 있다면 true만 허용하며 다른 값은 거절한다.
   webhook 자체의 HMAC, Sandbox marker, 시간/재전송/동일인 검사는 유지한다.
5. 실제 webhook 관리 API: 목록 조회 200, 등록 시도 **403**. 현재 키에는
   `manageClientSettings` 권한이 없어 임의로 설정을 바꾸지 않았다.
6. 실제 배포 receiver에 잘못된 서명→401, 올바른 서명의 명시적 `testMode:true`
   합성 이벤트→200 / `applied:false` 확인. 이는 **우리 쪽 transport 검사**이며
   Sumsub가 보낸 실제 webhook이나 실제 본인 인증 성공 증거가 아니다.

## 최종 배포 검수: PASS

- 주소: <https://ondo-conn98e6p-jaewook-9643s-projects.vercel.app/>
- deployment: `dpl_6wnRSsoxXLKCY5igyBtncXCUfK6s`, READY, Preview.
- Git source: `21f365314e932c16db867c3ad03da110f1760b0f`.
- 실제 SDK 검수 도구 source: `ce5b07c6c01daf0dec54a827bd6b398958458621`.
- 총 21개 체크포인트 통과(시작/재개 단계의 반복 검사 포함). 실제 SDK 토큰 발급,
  암호화 쿠키·origin 결합, 공급자 iframe의 상호작용 화면, 현재 제공자 상태
  `in_progress`, 취소 후 `access_required`, 같은 신청자로 재개, 실제 Redis의 활성
  세션, 최종 DELETE 후 비활성 레코드까지 확인.
- `ok:true`, `revoked:true`, 페이지 오류 0, 예기치 않은 요청 0.
  선택적 `/stry` telemetry는 의도적으로 8회 차단. 인증/지도 요청 우회는 없음.
- `humanIdentityVerified:false`, 문서 업로드 0, 화면/trace 저장 0.

처음 배포의 실제 GET 상태 503은 fixture에서는 놓쳤던 응답 형식 오류였다.
이를 수정한 위 새 배포에서 처음부터 재실행해 통과했다. 이전 immutable 주소
`ondo-h1r19wz66-…` 대신 위 주소를 사용한다. manual webhook transport 검사도
위 새 배포에서 다시 실행해 잘못된 HMAC 401 / 올바른 수동 이벤트 200,
`applied:false`를 확인했다. 실제 제공자 webhook 배달은 관리 권한 403 때문에
아직 미확인이다.

## 관리자가 해줄 것 — 둘 중 하나

이미 받은 SDK 키를 다시 보내거나 설정 전체를 갈아엎을 필요는 없다.

**A. 권한 인계:** 기존 Sandbox tenant에서 webhook 관리가 가능한
`manageClientSettings` 권한의 토큰을 승인된 secret 경로로 인계하면 내가 등록한다.
Production 권한이나 전체 계정 로그인 정보는 필요 없다.

**B. 관리자가 직접 등록:** Sumsub Dashboard의 Sandbox 모드에서 webhook을 추가한다.
아래 target의 최신 immutable 주소를 사용하고, 다른 환경의 webhook은 변경하지 않는다.

| 항목 | 값 |
| --- | --- |
| 이름 | K-Tour ID protected Sandbox preview |
| Target type | HTTP |
| Applicant type | individual |
| Events | applicantCreated, applicantPending, applicantReviewed, applicantOnHold, applicantReset, applicantDeleted |
| Signature algorithm | HMAC_SHA256_HEX |
| Secret | Vercel jaewook / ondo / Preview / `integration/sumsub-live-20260927`의 **`SUMSUB_WEBHOOK_SECRET`** 기존 값 |
| Target URL | `https://ondo-conn98e6p-jaewook-9643s-projects.vercel.app/api/kyc/sumsub/webhook` |

비밀값·QR·JWT·여권사진은 채팅/Markdown/Git으로 전달하지 않는다. 생성한 webhook
ID와 등록 완료 여부만 공유하면 된다. 대시보드의 수동 test send는 처리 경로만 확인하며
사용자를 승인하지 않는다. 실제 이벤트로 `lastEventAt`/refresh가 바뀌는지는 등록 후
같은 신청자의 실제 제공자 상태를 다시 조회해 검수한다.

## 검수 안전 범위

검수 도구는 새 synthetic 신청자의 SDK 시작까지만 수행한다. iframe 내부 버튼,
카메라, 문서 업로드, 심사 제출, 강제 승인 API는 사용하지 않는다. 종료 시 본 검수
세션만 해지한다. 해당 제공자의 개인정보 없는 초기 신청자/복구 기록은 일반 TTL로
남을 수 있으므로 전체 계정 데이터 삭제나 광범위 Redis 정리는 하지 않는다.

독립 검수로 발견한 redirect 우회도 차단했다. 브라우저 허용 요청을 한 응답만
받아 처리하고 3xx를 따라가지 않는다. SDK의 선택적 binary telemetry는 차단하고
별도 집계하며, 문서/승인 endpoint는 허용하지 않는다. 실제 문서·얼굴 심사는
소지자의 명시적 동의 후 별도로 수행해야 한다.

공식 API 근거: [신청자 조회](https://docs.sumsub.com/reference/get-applicant-data-via-externaluserid),
[심사 상태 조회](https://docs.sumsub.com/reference/get-applicant-review-status),
[webhook payload](https://docs.sumsub.com/docs/user-verification-webhooks).
