# 모바일 복귀·오류 검수 — 2026-09-27

2026-09-28 후속 갱신: 지원되는 Linux CI에서 WebKit 자동 검수를 완료했다. 공개 배포 source `a037f9f5309b4fead0766701cbe9824717227504`는 유지하며, 아래 CI 통합 소스와 구분한다.

## 실제로 확인한 범위

로컬 `3139`의 기존 앱을 대상으로 Chromium 모바일 에뮬레이션 **33/33** 통과했다. 실제 휴대폰이나 실제 공급자 인증 성공을 뜻하지 않는다.

후속 Ubuntu 24.04 CI는 동일한 33개 시나리오를 각 엔진에서 실행해 **Chromium 33/33 + WebKit 33/33 = 66/66** 통과했다. 최종 [실행 36328594158](https://github.com/woogieboogie-jl/k-tour-id/actions/runs/36328594158), source `ce5b07c6c01daf0dec54a827bd6b398958458621`, 재시도·skip·report error 0이다. 최초 `619047ea` 실행도 통과했으며 최종 수정본에서 다시 확인했다.

- 지역 스토리 9개 검사: 서울·부산·제주, 영어·일본어, 지도 이동/동작 줄이기, 스토리→본문→장소→복귀.
- 공개 UI 8개 검사: KO/EN/JA, 320/390px, 루트 페이지 타이틀/여백, 어두운 테마, 스펙트럼→목록→검색→지갑 복귀.
- 여권 UI 13개 검사: 동의·접속 코드·심사 중·보완·거절·만료·통신 오류·닫기·재시도. KYC 응답은 브라우저에서 가로챈 fixture이며 실제 SDK/카메라/문서 제출을 하지 않는다.
- 추가 3개 검사: 검색 중 화면 높이 축소·복구, 위치 권한 거절 후 검색, 오프라인 본문 읽기와 재연결 시 같은 이야기 유지.

검색 화면 높이 축소는 키보드로 인한 **배치 변화의 모사**다. iOS 소프트웨어 키보드를 실제로 연 검사가 아니다. 위치 권한 거절도 브라우저 API fixture다. 외부 인증·서명·결제 쓰기는 차단한다.

## WebKit 자동 검수 완료와 실제 기기 경계

설치된 Playwright WebKit과 `/tmp/ktour-webkit-20260927`에 새로 내려받은 독립 설치본 모두 페이지를 열기 전 `Bus error: 10`, exit 138로 종료됐다. 사용 OS는 macOS 14.2이고 설치 도구는 이 플랫폼용 WebKit이 frozen build임을 안내했다. 캐시만으로 단정하거나, Chromium 결과를 Safari 통과로 바꾸지 않는다. 다른 작업의 공유 브라우저 캐시는 삭제·교체하지 않았다.

이 로컬 실패를 우회하는 지원 환경으로 Ubuntu 24.04 GitHub Actions를 추가했고, 실제 Linux WebKit **33/33** 통과를 확인했다. 별도 머신/CI 실행은 더 이상 미완료 작업이 아니다. 다만 macOS SIGBUS 자체를 고친 결과는 아니며 Linux WebKit 엔진 검수를 실제 iPhone Safari 통과로 바꾸어 기록하지 않는다. 실제 iPhone의 신분증 앱 왕복, 카메라 권한, OAuth 외부 앱 전환은 여전히 미검수다.

CI는 `integration/autonomous-finish-20260927` 브랜치로 한정되고 공급자 비밀값이나 배포 권한을 사용하지 않는다. 자세한 실행 경계와 결과는 [WebKit CI 문서](./WEBKIT_CI_2026-09-27.md)에 있다.

## 재실행

통합 작업 폴더 `k-tour-id-app`에서 비밀값을 상속하지 않는 로컬 서버를 실행한 뒤:

```sh
pnpm exec playwright test --config playwright.mobile-compat.config.ts --project mobile-chromium
pnpm exec playwright test --config playwright.mobile-compat.config.ts --project mobile-webkit
```

전용 설정은 loopback 주소만 허용한다. 공용 배포나 실제 KYC API로 fixture 시나리오를 보내지 않는다. 최초 통합 실행에서 지역 테스트의 3112/3139 origin 기본값 불일치를 발견해 `baseURL` fixture를 사용하도록 고쳤고, Chromium 33개 전체를 다시 통과시켰다. 최초 실패 기록을 성공 기록으로 덮어 설명하지 않는다.

검수 로그: `k-tour-id-app/artifacts/qa/mobile-chromium-compat.log`. 실패한 WebKit 시작 기록은 `mobile-compat-run.log`. 파일은 로컬 검수 산출물이며 제출용 실제 거래 증거가 아니다.

## 별도 zkLogin 복귀 후속

개발 콜백 URL 정리 순서와 QA 출력에 의한 재빌드 루프를 수정해 Node 24/25 각각 **7개×3회 = 21/21** 통과했다. Node 24 실행은 trace를 켜고 저장소 안에 출력했다. 이동이 멈춘 경우의 URL 정리와 정리 실패 시 토큰을 저장하지 않는 경우도 포함한다. 인증·외부 요청 차단을 완화하지 않았으며 위 모바일 CI 66개와는 별도 검사다. 후속으로 새 Harvey 활성 로컬 production 빌드(`HK=1`)에서도 **21/21**, 재시도 없이 **14.1초**에 통과했다. 실제 Google 호출·서명 증거는 아니다. [로그인 복귀 검수](./ZKLOGIN_RETURN_REVIEW_2026-09-27.md)를 참고한다.

같은 활성 production 프로필의 Harvey 통합/보존 브라우저 회귀도 **34/34**(1.4분), 전체 계약 검사는 **970/970** 통과했다. 통합 API 응답은 fixture이며 실제 기기의 외부 앱 승인 검수와 구분한다.

## 사람이 추가로 확인할 것

1. 실제 iPhone Safari에서 검색 키보드 열기/닫기, 화면 회전, 긴 일본어 문구와 하단 버튼 접근.
2. 실제 Sumsub Sandbox 설정을 연결한 후 SDK의 카메라 거절·재시도·문서 제출·webhook 왕복. 실제 신분증을 Sandbox에 무심코 넣지 않는다.
3. [화요일 모바일 신분증 안내](./TUESDAY_MOBILE_ID_CHECK_2026-09-29.md)에 따라 팀원이 직접 승인하고 원래 탭으로 돌아오기.
4. OAuth 설정 후 실제 Google 취소/완료·원래 장소 복귀. 로컬 callback fixture와 구별해서 기록한다.
