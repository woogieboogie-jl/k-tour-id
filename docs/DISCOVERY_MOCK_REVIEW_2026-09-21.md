# 콘텐츠 → 지도 · Hot/Cool 로컬 목업

## 확인할 화면

로컬: <http://127.0.0.1:3142/ondo-b/labs/discovery>

작업 브랜치: `preview/discovery-mock-20260921` (로컬, 원격 push 없음).

```sh
cd k-tour-id-app
node scripts/hackathon-local.mjs dev 3142
```

Harvey 통합본 `bd514c454dbcee7f641159ea674e3cbe08c0c3ee` 위에 추가했다. **기존 앱 탐색·온보딩·지갑·결제·해커톤 흐름에는 연결하지 않았다.** `/ondo-b`의 기존 provider 우회 경계 안에 별도 개발 전용 경로를 만들었다. production에서는 `notFound()`로 차단하며, 배포·push는 하지 않았다.

## 작은 완성본의 범위

1. **이야기 → 지도:** 첫 화면부터 지도. 사진/일러스트 카드 선택 즉시 해당 장소의 핀과 짧은 장소 카드가 함께 나타난다. 긴 소개 페이지나 취향 설문을 거치지 않는다.
   - **참기름 따라, 시장으로:** 중부시장 1곳. 일본 여행 콘텐츠에서 시장 방문으로 연결한다. 특정 기름집이나 입구 위치를 임의로 만들지 않았다.
   - **드라마 속 제주로:** 성산일출봉·광치기해변 2곳. 각 장소에 해당 작품을 따로 표시하여 서로 다른 드라마의 촬영지를 하나로 오인하지 않게 했다.
2. **Hot/Cool → 추천 지도:** 서울의 편집 추천을 각 3곳 구성했다. 검색창에 `hot`/`cool`을 입력하거나 아이콘 칩을 누르면 같은 지도에서 바뀐다. Hot은 대표적인 발견, Cool은 다른 취향의 발견이라는 편집 방향이다. **실시간 인기·혼잡·영업 상태가 아니다.** `hotdog` 같은 일반 검색을 강제로 Hot으로 바꾸지 않는다.
3. **핀 ↔ 카드 ↔ 장소:** 동일 장소 ID를 사용한다. 카드를 넘기면 선택 핀을 강조하며, 장소 시트를 닫으면 지도 선택을 유지한다. 로컬 저장과 저장 목록도 사용할 수 있다.

사진·핀·짧은 한 줄을 중심으로 구성하고, 출처/라이선스와 목업의 한계는 접힌 정보에 둔다. 지갑·계정·인증·결제·예약 CTA는 이 목업에 넣지 않았다. 실시간처럼 보이기 위한 가짜 방문자 카운트나 무한 움직임도 넣지 않았다.

## 데이터와 상태 원칙

- Hot/Cool은 현재 도시·카테고리를 유지한다. 결과가 0~2곳이면 그대로 보여 주며 다른 도시의 장소로 숫자를 채우지 않는다.
- 이야기 카드는 도시와 장소 수를 먼저 보여 준다. 명시적인 컬렉션 선택이므로 카테고리를 전체로 전환한다. 뒤로 가면 직전 카테고리와 선택을 복원한다.
- 브라우저 Back/Forward는 선택·카테고리·지도 중심/배율/회전/기울기/**실제 padding**을 복원한다. 화면 회전 때는 선택 핀이 패널에 가리지 않도록 위치를 보정한다.
- 저장은 페이지 메모리에만 있다. 새로고침하면 초기화하며 localStorage/서버에 쓰지 않는다.
- 외부 자산 요청은 OpenFreeMap 지도와 기존 폰트뿐이다. 출처 링크는 사용자가 직접 누를 때만 열린다. 서비스 API·인증 SDK·체인 호출은 없다.
- 지도/이미지 로딩 실패에도 장소 카드·저장·닫기가 가능하다. 모션 감소 설정을 존중한다.

## 출처·이미지

- 중부시장: [한국관광공사](https://english.visitkorea.or.kr/svc/contents/contentsView.do?vcontsId=86289)의 좌표 `37.565086413185, 127.001921980041`를 시장 중심 좌표로 사용. [일본 콘텐츠 원문](https://rurubu.jp/andmore/article/25110)을 이야기에서 제공한다.
- 제주: [한국관광공사 일본어 원문](https://japanese.visitkorea.or.kr/svc/contents/contentsView.do?vcontsId=222180)과 기존 장소 좌표를 재사용한다. 성산일출봉은 《폭싹 속았수다》, 광치기해변은 《웰컴투 삼달리》로 각각 표시한다.
- 서울 추천 6곳은 기존 리서치 데이터의 이름·좌표·출처를 재사용했다. 현재 영업 여부나 인기 순위를 이번 작업에서 새로 보증하지 않는다.
- 어니언 음식 사진·학림 외관 사진은 기존 출처 자산을 재사용한다. 학림은 CC BY-SA 4.0 원문/라이선스 링크를 장소 정보에 제공한다. 나머지 기존 음식/콘텐츠 일러스트는 실제 매장 사진이라고 표시하지 않는다.

## 검수 결과

- 신규 목업 Chromium 브라우저 **13/13 통과**: 콘텐츠 2개, Hot/Cool/일반검색, 도시/카테고리, 핀·카드·저장, native Back/Forward/지도 pan, 회전, 장애 경로, 일본어·다크·모션 감소, 네트워크 격리.
- 화면 크기: 320×568, 320×720, 390×844, 430×932, 844×390, 1440×1000. 지정된 장소 시트의 axe serious/critical 위반 0건. 전체 앱이나 모든 접근성 문제가 0건이라는 의미는 아니다.
- 기존 앱/UI 계약 테스트 **919/919 통과**. 블록체인 계약이나 실서비스 E2E 수치가 아니다.
- `pnpm typecheck` 및 격리 production build 통과. 빌드된 서버에서 `/ondo-b/labs/discovery` **404**, 기존 `/ondo-b` **200**, config `isolatedMock: true`를 실제 HTTP 응답으로 확인했다.
- 독립 반대 검토에서 짧은 화면 잘림, 회전 후 핀 가림, 일본어 필터, 출처 링크, 이야기 필터 충돌, native Back/Forward의 **60px 카메라 이동**을 찾아 수정했다. 개발 배지가 로컬 안내를 가리는 현상도 버튼 위치를 조정했다.
- 마지막 독립 재검수 2/2 통과: 일반 pointer 클릭으로 안내 열기, pan 이후 native Back/Forward의 픽셀 위치·전체 카메라 동일성. 해당 두 결함은 해결됐으며 별도 검토 범위의 미해결 P0/P1은 없다. [로컬 재검수 이미지](/tmp/ktour-discovery-final-NsVzMw).
- 실제 지리 자산이 그려진 다음 PNG를 확인했다. 새 도시/스타일을 열 때 이전 지도 로딩 상태를 재사용하지 않는다.
- Safari/WebKit·실제 휴대폰·실제 provider 로그인/결제/체인 실행은 이번 목업 검수 범위 밖이다.

최종 Chromium 증거: `/var/folders/j1/hjz9937d39qdt7xx5sm17whr0000gn/T/ktour-discovery-qa-kbj0fq` (`results.json`, `hot.png`, `place.png`). 임시 디렉터리이므로 영구 배포 자료가 아니다.

테스트 실행:

```sh
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3142 pnpm exec playwright test --config=playwright.discovery-preview.config.ts
pnpm typecheck
```

전용 Playwright 설정은 모든 trace/PNG/report를 앱 밖 OS 임시 디렉터리에 저장한다. 초기 검수에서 앱 내부 artifacts 쓰기가 Next CSS 감시/HMR을 연속 유발해 상태 초기화와 임시 manifest 오류를 만들었다. 서버를 재시작하고 출력 경로를 분리한 뒤 재검증했으며, 초기 실패를 통과로 집계하지 않았다.

## 기존 해커톤 연동과의 관계

이번 UI 목업은 Harvey API 명세를 바꾸지 않는다. 기존 통합 문서에는 **새 검증에서 확인한 미수정 결함**만 반영했다.

- [CX·OmniOne 감사](CX_CHAIN_INTEGRATION_VERIFICATION_2026-09-21.md): CX 실인증 미검증, 현재 OmniOne RPC 읽기 401. Outbox 전용 감사 **5 통과 / 2 실패** — 동시 제출 claim 부재와 receipt 없는 `confirmed` 승격. 코드 수정은 하지 않았다.
- [Sui 감사](SUI_INTEGRATION_VERIFICATION_2026-09-21.md): 과거 Testnet 거래 3건을 읽기 전용으로 재확인했다. 새 사용자 OAuth/zkLogin/서명/PTB부터 OmniOne 확정까지의 실 E2E 완료를 뜻하지 않는다. OpenDID 실구현은 별도 후속 범위다.
