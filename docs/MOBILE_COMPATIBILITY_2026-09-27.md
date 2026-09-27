# 모바일 복귀·오류 검수 — 2026-09-27

## 실제로 확인한 범위

로컬 `3139`의 기존 앱을 대상으로 Chromium 모바일 에뮬레이션 **33/33** 통과했다. 실제 휴대폰이나 실제 공급자 인증 성공을 뜻하지 않는다.

- 지역 스토리 9개 검사: 서울·부산·제주, 영어·일본어, 지도 이동/동작 줄이기, 스토리→본문→장소→복귀.
- 공개 UI 8개 검사: KO/EN/JA, 320/390px, 루트 페이지 타이틀/여백, 어두운 테마, 스펙트럼→목록→검색→지갑 복귀.
- 여권 UI 13개 검사: 동의·접속 코드·심사 중·보완·거절·만료·통신 오류·닫기·재시도. KYC 응답은 브라우저에서 가로챈 fixture이며 실제 SDK/카메라/문서 제출을 하지 않는다.
- 추가 3개 검사: 검색 중 화면 높이 축소·복구, 위치 권한 거절 후 검색, 오프라인 본문 읽기와 재연결 시 같은 이야기 유지.

검색 화면 높이 축소는 키보드로 인한 **배치 변화의 모사**다. iOS 소프트웨어 키보드를 실제로 연 검사가 아니다. 위치 권한 거절도 브라우저 API fixture다. 외부 인증·서명·결제 쓰기는 차단한다.

## WebKit은 미통과로 남긴다

설치된 Playwright WebKit과 `/tmp/ktour-webkit-20260927`에 새로 내려받은 독립 설치본 모두 페이지를 열기 전 `Bus error: 10`, exit 138로 종료됐다. 사용 OS는 macOS 14.2이고 설치 도구는 이 플랫폼용 WebKit이 frozen build임을 안내했다. 캐시만으로 단정하거나, Chromium 결과를 Safari 통과로 바꾸지 않는다. 다른 작업의 공유 브라우저 캐시는 삭제·교체하지 않았다.

현재 환경에서 WebKit 실행이 막혔으므로 지원되는 별도 머신/CI 또는 실제 Safari에서 아래 명령/경로를 확인해야 한다. 실제 iPhone의 신분증 앱 왕복, 카메라 권한, OAuth 외부 앱 전환 역시 미검수다.

## 재실행

통합 작업 폴더 `k-tour-id-app`에서 비밀값을 상속하지 않는 로컬 서버를 실행한 뒤:

```sh
pnpm exec playwright test --config playwright.mobile-compat.config.ts --project mobile-chromium
pnpm exec playwright test --config playwright.mobile-compat.config.ts --project mobile-webkit
```

전용 설정은 loopback 주소만 허용한다. 공용 배포나 실제 KYC API로 fixture 시나리오를 보내지 않는다. 최초 통합 실행에서 지역 테스트의 3112/3139 origin 기본값 불일치를 발견해 `baseURL` fixture를 사용하도록 고쳤고, Chromium 33개 전체를 다시 통과시켰다. 최초 실패 기록을 성공 기록으로 덮어 설명하지 않는다.

검수 로그: `k-tour-id-app/artifacts/qa/mobile-chromium-compat.log`. 실패한 WebKit 시작 기록은 `mobile-compat-run.log`. 파일은 로컬 검수 산출물이며 제출용 실제 거래 증거가 아니다.

## 사람이 추가로 확인할 것

1. 실제 iPhone Safari에서 검색 키보드 열기/닫기, 화면 회전, 긴 일본어 문구와 하단 버튼 접근.
2. 실제 Sumsub Sandbox 설정을 연결한 후 SDK의 카메라 거절·재시도·문서 제출·webhook 왕복. 실제 신분증을 Sandbox에 무심코 넣지 않는다.
3. [화요일 모바일 신분증 안내](./TUESDAY_MOBILE_ID_CHECK_2026-09-29.md)에 따라 팀원이 직접 승인하고 원래 탭으로 돌아오기.
4. OAuth 설정 후 실제 Google 취소/완료·원래 장소 복귀. 로컬 callback fixture와 구별해서 기록한다.
