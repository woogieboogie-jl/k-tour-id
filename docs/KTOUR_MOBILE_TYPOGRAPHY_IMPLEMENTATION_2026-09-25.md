# 모바일 타이포·여백 반영 — 2026-09-25

대상: `integration/harvey-preservation-20260924`, 로컬 `http://127.0.0.1:3140/?city=seoul`.

[수정 전 3인 검수](./KTOUR_MOBILE_TYPOGRAPHY_AUDIT_2026-09-25.md)의 N1–N3에 한정한 후속 작업이다. 지도 헤더를 다시 디자인하거나 공급자·체인 연동을 바꾸는 작업은 아니다. 미커밋·미푸시·미배포.

## 반영 내용

| 합의 항목 | 구현 |
|---|---|
| N1 · 같은 등급의 루트 제목 | 설정·여행 패스·내 한국·테이블의 제목 프레임을 공통 CSS로 관리. 상단 최소 28px, 프레임 최소 48px, 제목 30–32px/1.08, 좌우 16px(360px 이하)/20px. 안전 영역이 더 크면 해당 inset을 우선한다. |
| N1 · 콘텐츠별 간격 | 패스 카드 앞 16px, 테이블 제목 뒤 14px. 내 한국의 미니 지도 앞 기존 14px, 설정의 목록 간격은 유지. 모든 콘텐츠에 같은 여백을 강제하지 않는다. |
| N1 · 긴 제목/확대 | 제목 줄바꿈 허용. 제목 옆 Demo 버튼은 필요하면 다음 행으로 이동하며 최소 44px 조작 영역을 유지한다. |
| N2 · 테이블 카드 | 모바일 카드 제목 20–22px/1.2로 제한. 상세 시트 제목에는 적용하지 않는다. |
| N3 · 지갑 | 기존 큰 제목 크기를 유지하고 줄높이 1.12 명시. 제목 아래 6px + 기존 스택 간격 10px로 잔액 카드 앞 16px 확보. 나머지 대시보드 행 간격은 바꾸지 않는다. |

적용 조건은 **699px 이하 세로 화면**이다. 데스크톱·가로 화면·지도 조작부·바텀시트는 기존 규칙을 유지한다. 일반 페이지 제목의 `data-page-typography`, `data-page-title-frame`, `data-page-title` 표식과 앱의 CSS scope로 범위를 제한했다. 업무 로직이나 탭 전환·결제·신원 확인 동작은 수정하지 않았다.

주요 구현 위치:

- `k-tour-id-app/features/ondo/shared/ui/page-typography-b.module.css`
- `k-tour-id-app/features/ondo/{settings,identity-b,my,connect}`의 루트 제목 표식
- `k-tour-id-app/features/ondo/connect/pulse-table-b.module.css`
- `k-tour-id-app/features/ondo/commerce-b/id-wallet-commerce-b.module.css`
- standalone 배포 소스 allowlist에 공통 CSS 추가

## 검수 상태

완료 항목:

- 격리 production 빌드, TypeScript, `git diff --check` 통과.
- standalone/commerce 계약 테스트 28개 통과.
- 모바일 타이포 브라우저 테스트 30개 통과(29개 + 확대 측정 보정 후 해당 1개 재실행).
  - 320/360/390/430px × KO/EN/JA × light/dark의 24개 독립 프로필. 프로필마다 내 한국·테이블·여행 패스·설정 확인: 총 96개 루트 화면 상태.
  - 실제 locale/theme 속성, 상단 프레임·가로 범위·제목 크기·줄높이 검증.
  - 영어 320px에서 원래 computed font size를 정확히 2배로 확대하고, 적용 완료 후 제목·버튼의 실제 범위 확인.
  - 테이블 카드 제목/다음 콘텐츠 겹침, 지갑 줄높이/간격, 설정 언어 시트, ID 시작 시트, 테이블 상세 진입·복귀 확인.
- 독립 시각 검수 32캡처 통과: JA 320/390px light/dark의 4개 루트+지갑(20), EN320 글자 2배의 4개 루트(4), PC1440×900/가로844×390의 4개 루트(8).
  - PC·가로 화면의 제목 및 프레임 사각형·글자 크기·줄높이는 수정 전 기준과 동일.
  - 별도 읽기 전용 회귀에서 설정 언어/표시 모드, 지갑 연결 안내 시트의 진입·닫기 확인. 실제 연결·인증은 제출하지 않았다.
- 3개 독립 역할의 리뷰 수행: 시각/반응형 비교, CSS 적용 범위·하위 흐름, 테스트 검증 방식. 테이블 헤더의 flex 전환 위험을 교차 확인했으며, 모바일에서 기존 eyebrow/intro가 숨겨져 실제로 h1만 보인다는 것을 소스와 렌더 양쪽에서 확인했다. 최종 차단 이슈 없음.

지도 헤더·19+ 회귀 10개도 최종 통과했다(초회 9개 + 단독 재확인 1개). 모바일의 5개 viewport 연속 검사는 병렬 브라우저 실행 중 기존 60초 한도를 넘었으나, 앱/테스트 코드를 바꾸지 않은 단독 재실행에서 53.8초에 통과했다. 이 실행 시간 여유가 작다는 점은 테스트 운영상 한계로 남긴다. 형상·조작 영역 assertion 실패는 없었다.

자동 검수 중 잘못된 기본 실행 주소, context 간 저장소 격리 및 글자 크기 변경 직후의 측정 타이밍 문제는 **테스트 코드에서 수정**했다. 이를 앱 결함으로 기록하거나 검증하지 않은 상태를 통과로 계산하지 않았다. 확대 스트레스는 실제 렌더 완료 후 `font-size=원래 값×2`를 명시적으로 확인한다.

증거:

- `k-tour-id-app/tests/e2e/ktour-mobile-page-typography.spec.ts`
- `k-tour-id-app/artifacts/qa/typography-final/`, `typography-stress-final/`
- 지도 회귀: `k-tour-id-app/artifacts/qa/typography-header-regression/`, `typography-header-recheck/`
- 독립 시각 캡처: `/tmp/ktour-spacing-after-*.png` (임시 로컬 파일)

별도 리뷰의 내 한국 프로필 클릭은 자동화 조작을 완료하지 못했다. 공급자·결제 이후 상태, 모든 상세 화면의 전수 검수로 확대 해석하지 않는다. 이번 수정은 합의한 루트 제목·카드 제목·지갑 제목의 타이포 범위다.

검수는 실서비스 자격 증명 없는 `HK_ISOLATED_MOCK` 로컬 빌드에서 수행한다. 브라우저의 외부 제출·인증·서명·체인 호출은 막고 공개 정적 리소스/허용된 읽기 요청만 사용한다. 실제 iPhone/Safari, OS 글자 확대, 외부 제공자 화면 및 실환경 체인 E2E를 검증했다는 뜻은 아니다.

## 인계 영향

Harvey API·SDK·체인·데이터 모델의 명세 변경은 없다. 제목 스타일의 공통 관리와 반응형 검수 항목만 추가된다. 이후 앱 수정에서도 일반 페이지 제목은 공통 프레임을 사용하되 지도·시트의 별도 위계를 유지한다.
