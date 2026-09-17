# 전체 페이지·흐름 소유권 대조

상태: **모바일 1차 검수 및 교차 검토 결과**. 아래 행은 전 상태 PASS가 아니다. **V**는 명시한 대표 화면을 실제 관찰, **I**는 진입/표시 확인, **U**는 코드 목록화만 했거나 실행하지 않은 나머지다. 기존 80개 의미 단위와 새 스탬프 3개 표면을 대조한다. URL/의미 노드/내부 step/실제 검수 화면 수를 합산하지 않는다. 기존 VISIT_STAMP는 장소와 영수증 양쪽의 선택형 진입으로 갱신됐다.

출처: 이전 sitemap-code.json, 현행 B 앱 mount 및 각 디자이너 source census. 각 행의 세부 step·상태와 실제 검수 캡처는 담당 보고서로 추적한다. 실제 provider 연결·차단 URL은 모바일 페이지가 아니라 경계 항목이다.

| 의미 단위 | 페이지/흐름 | 담당 | 초기 판정 |
|---|---|---|---|
| SHELL | Public app shell / 5 internal tabs | D1 | V · 전국/5탭·다국어 대표 화면, 모든 복귀 조합은 미검수 |
| LEGACY_REDIRECT | Legacy /ondo-b redirect | 별도 경계 | 소비자 목업 검수 외 경계 |
| BLOCKED_ROUTES | Archived A pages / removed public assets | 별도 경계 | 소비자 목업 검수 외 경계 |
| MODAL_SHELL | Shared sheet, top-layer focus and close contract | D1 | V · 공통 코너 픽셀 8건 + 대표 시트. 자체 제작 확인 창 결함 M01 |
| NATION | Nation / first entry | D1 | V · 첫 진입/도시 선택, 모든 애니메이션·저장 복구는 미검수 |
| CITY_MAP | City map, search, category and camera | D1 | V · 서울/부산/제주·검색·다크·좁은 화면 |
| CITY_LIST | List + research recommendations + balance-place filter | D1 | V · 필터/빈 결과/복구, 모든 더보기·미디어 실패는 미검수 |
| MAP_OPTIONS | Compact mobile map options | D1 | V · 옵션/카테고리/개인정보. 2D↔2.5D 전환 동작은 I |
| LOCATION | Requested geolocation / privacy explanation | D1 | V · 권한 거절/안내. 성공·지연·위치 갱신은 미검수 |
| HEAT_TIMELINE | Shared temperature/activity replay | D1 | I · 화면 진입/표시 확인. 재생·스크럽 동기화는 U |
| HEAT_INFO | Temperature composition / source / map credits | D1 | V · 다크 범례/설명. 저대비 M03; 모든 credits 상세는 U |
| JAPAN_GUIDE | Seoul / Jeju editorial guide and stories | D1 | V · 서울/제주 가이드 및 이야기→지도 |
| RESEARCH_PICK | Worth a stop / researched food detail | D1 | V · Zest 상세/출처. 전체 매장별 개별 검수 아님 |
| PLACE_DATA | Canonical detail data loading and validity | D1 | V · 준비/오류/재시도/unknown. 긍정 사실 모든 조합은 U |
| CANONICAL_PEEK | Canonical place peek | D1 | V · Roba review/normal 대표 peek |
| CANONICAL_DETAIL | Canonical place full detail | D1 | V · 상세/액션/같은 장소 복귀. Directions M02 |
| PLACE_FACT | Before you go / evidence detail | D1 | V · 카드 정보 unknown/오류/재시도. positive/stale 조합은 U |
| EDITORIAL_PEEK | Editorial place peek | D1 | V · 실제 편집 장소 peek(26a) |
| EDITORIAL_DETAIL | Editorial place detail | D1 | V · 편집 장소 상세(26b). 저장 실패/모든 업종은 U |
| PLACE_SERVICE_ENTRY | Explicit per-place services / map context capture | D1 | V/I · 등록 장소 서비스 진입, 내부 거래 D3 |
| ONBOARDING | Optional discovery preferences | D1 | V · 선택형 3단계/완료/취소·JA 짧은 화면 |
| SAMPLE_INFO | Review/sample explanation and operator/demo entry | D1 | V · 샘플 설명/펼침/운영자 진입 |
| ID_WALLET_TAB | ID · Wallet readiness home | D3 | V · normal/review·EN/KO/JA Pass/잔액/준비 상태 |
| ACCOUNT_GATE | Account / save task gate | D3 | V · 저장/결제/가이드 목적별 계정 진입. 모든 실패는 U |
| ACTION_GATE | Purpose-bound prerequisite coordinator | D3 | V · 계정/Person/Payment/자격 제시 대표. 만료/모든 거절은 U |
| LOCAL_CHECK | Direct Person / Age check walkthrough | D3 | V · 실제 탭 후 화면 밖 Person/19+ 재현 M01 |
| ID_SETUP | K-Tour ID method and consent coordinator | D3 | V · 3방식/동의/normal 미연결·대표 결과 |
| ID_MOBILE_HANDOFF | Mobile ID / residence preview handoff | D3 | V · Mobile/residence 대기·동의·거절·재시도. 실제 시간 만료는 U |
| ID_DOCUMENT | Passport document / NFC sample preparation | D3 | V · 여권 권한/문서/NFC/검토. 모든 실패 코드는 U |
| ID_FACE | Passport face/liveness preview | D3 | V · 권한/거절/재시도/대표 결과. mismatch·한도는 U |
| ID_PROCESSING | Identity provider processing / failure recovery | D3 | V · 대표 미연결·취소·수령 실패/재시도. 모든 callback 오류는 U |
| ID_MANUAL_REVIEW | Manual review / additional information loop | D3 | V · 수동 검토 pending/추가 정보 대표; 전체 만료 조합은 U |
| ID_HOLDER_DELIVERY | Holder delivery / explicit receipt acknowledgment | D3 | V · 수령 확인/ready. 만료·정지·폐기 조합은 U |
| ID_CREDENTIAL | Credential ready / expiry / suspension / revocation | D3 | V · Mobile/residence 완료·Person 한정 패스. 모든 유효성 상태는 U |
| ID_RECOVERY | Renewal / device restoration | D3 | V · 공개 갱신 소개→동의→수령/완료, 기기 복구 소개→동의/취소→기존 패스. 모든 실패/만료는 U |
| ID_PRESENTATION | Purpose-bound VP request / consent / result | D3 | V · 결제/가이드 목적별 제시. 독립 VP·replay/만료 전 조합은 U |
| PASS_SERVICES | Pass capability explanation / scenario selector | D3 | V/I · 기능/자격 안내·대표 선택. 모든 자격 시나리오 미검수 |
| PROFILE | Optional public profile / reputation | D2 | V · 프로필 편집/저장/활동·EN/JA. 모든 저장 실패는 U |
| AFTER19 | Global After 19 / exact-place age prompt | D1 | V · 장소 진입/취소/활성/수동 끄기·다크. 자동/만료/Q 전 상태는 U |
| LOCAL_SIGNAL | Place contribution draft / optional local photo | D2 | V · 입력/사진/동의 복귀/기록 대표. 모든 파일/저장 실패는 U |
| TABLES | Tables social-plan list / detail | D2 | V · 목록/부산 상세·JA320/다크430 대표 |
| TABLE_JOIN | Table join / availability / prerequisite recovery | D2 | V · 참여 판단/확인/저장. 모든 거절·마감 시나리오는 U |
| TABLE_CHAT | Table text/image chat | D2 | V · 텍스트/사진/실패 상태 대표. 실제 키보드는 미검수 |
| TABLE_ACTIVITY | Arrival / completion / feedback | D2 | V · 도착/완료/피드백. 모든 저장 오류는 U |
| TABLE_SAFETY | Leave / report / block | D2 | V · 신고/숨기기/나가기 결정. 긴 사유 깨짐 M05 |
| MY_KOREA | Saved / recent / planned / contribution / commerce overview | D2 | V · 빈/공식·편집 저장/최근/계획/선택 구매. 실제 계획 시간 불일치 M04 |
| MY_SAVE_REMOVE | Remove saved place confirmation | D2 | V · 삭제 확인 대표. 모든 실패·롤백은 U |
| MY_PRIVATE_NOTE | Per-place private note | D2 | V · 메모 편집 대표. 모든 저장 실패는 U |
| MY_MEMORY_MAP | Saved memory map summary | D2 | V · 빈/부산 계획·저장 지도 요약 |
| WALLET_HOME | Wallet balance, holds, funding and history | D3 | V · 미연결/준비/반영 잔액 대표. 다중 주문 선택 전체는 U |
| WALLET_CONNECT | Wallet connection preview | D3 | V · public 목업 준비. 모든 injected failure는 U |
| MAP_BALANCE | Map balance shortcut / supported-place filter | D1 | V/I · 지도 잔액 진입/지원 장소→Roba 결제. 전 필터 조합은 U |
| FUNDING | Funding source/amount/consent/operation/result | D3 | V · 방식/견적/동의/처리/반영. persistence·만료 전 조합은 U |
| FUNDING_FIAT | Bank/card/wallet authorization preview | D3 | V · 은행/카드/Apple Pay·실패/미확정·결과 |
| FUNDING_STABLECOIN | Stablecoin source-to-destination funding | D3 | V · USDC/USDT·서명 방식·출발/도착·미확정 대표 |
| CHECKOUT | Per-place offer / benefit / quote / payment consent | D3 | V · 장소/혜택/총액/동의·KO320·결정 본문 M08 |
| PAYMENT_OPERATION | Authorize/hold / capture / query / void | D3 | V · 승인 hold/capture 실패/재시도. 모든 unknown/void는 U |
| ORDER_RECEIPT | Order receipt / ledger / next action | D3 | V · 영수증·장소 복귀·별도 방문. 다중 주문 전 조합은 U |
| REFUND | Partial/full refund operation | D3 | V · 부분/미확정/조회 대표. 지갑 origin 및 전 오류는 U |
| VISIT_STAMP | Separate local visit check after receipt; payment does not stamp | D2 | V · review 기록/컬렉션과 normal 미연결. 상충 안내 M12 |
| RESERVATION | Per-place merchant reservation preview | D3 | V · draft/unknown/확정/취소/실패 대표. 전 매장/320은 U |
| PARTNER_DEMO | Integration review workspace | Coordinator | V · 운영자 도구 3탭 대표 |
| PARTNER_WORKSPACE | Partner workspace / device / counter request | Coordinator | V · 기기 준비/요청/QR/권한 거절·재시도 |
| PARTNER_VERIFY | Partner purpose / request / consent / result | Coordinator | V · 최소 증빙 공유/증빙 부족. accepted/replay/만료 전 조합은 U |
| PARTNER_SETTLEMENT | Settlement / reconcile preview | Coordinator | V · 빈 상태/장소 결제 목업 이후 pending→조회·결과. mismatch는 U |
| PARTNER_SUPPORT | Payment/refund/reconciliation support case | Coordinator | V · 지원 요청/unknown→조회/티켓/이력. 전 실패는 U |
| CHAIN_EVENTS | Audit event / voucher preview ledger | Coordinator | V · 이벤트 목록/단건 기록/320. 중복·실패 전 조합은 U |
| SETTINGS | Settings home / language / appearance / preferences | D2 | V · 언어/모양/환경설정/개인정보·EN/JA/다크 |
| LOCAL_DATA_DELETE | Delete local app data confirmation | D2 | V · 로컬 삭제 결정 대표. 실제 전체 삭제/롤백 전 조합은 U |
| ACCOUNT_SERVICES | Export / revoke / delete service previews | D2 | V · review export/unknown/결과. revoke/delete 전 조합은 U |
| LABS | Optional Labs acknowledgment / experiments | D3 | V · 선택형 경계/일반 도구. 기술 화면을 소비자 여정에 섞지 않음 |
| LABS_WALLET | Labs signer / zkLogin preview | D3 | V · signer 대표 준비/실패. 모든 OAuth/epoch 등은 U |
| LABS_BRIDGE | Ordered bridge quote / source / relay / destination | D3 | V · 견적/동의/출발·중계·도착. 모든 만료/실패는 U |
| LABS_TRAIT | Merchant trait / limited eligibility | D3 | V/I · 대표 자격 카드. 모든 stale/error/정책 조합은 U |
| LABS_BADGE | Opt-in milestone badge preview | D3 | I/D · 공개 9→10 준비, focused 결과 별도 V. 일반 실패/반복은 U |
| RELOAD_BOUNDARY | Device/session restore and failure semantics | Coordinator | U · 소스 계약/상태 수명 대조. 이번 전체 reload/back 조합 실행 없음 |
| REQUIRED_REAL_HACKATHON | Developer real-integration requirement (not public mock implementation) | 별도 경계 | 소비자 목업 검수 외 경계 |
| SUMSUB_EXCLUDED | Separate real Sandbox passport experiment | 별도 경계 | 소비자 목업 검수 외 경계 |
| PUBLIC_NEIGHBORHOOD_GUIDE | Free neighborhood guide; optional pass save | D1 | V · review 제공 무료 읽기·EN/JA·장소/저장된 Pass 카드 복귀. normal 서비스 없음 |
| EXPERIENCE_FLOW | Optional neighborhood-guide save to local pass collection | Coordinator | V · 최초 저장/제시/승인/완료·미확정 중단·기록 재시도·차단 복귀·저장 카드 읽기/포커스 복귀 |
| JOURNEY_STAMPS_HOME | 패스 아래 스탬프 카드 | D2 | V · normal/빈/10개·JA320/다크430 |
| JOURNEY_STAMPS_COLLECTION | 장소별 방문 기록 컬렉션·같은 장소 복귀 | D2 | V · 1/10개 목록·JA320/다크·행→같은 Roba 상세 복귀. normal 무기록 공개 opener 없음 |
| JOURNEY_KEEPSAKE | 10곳 기념품 집중 화면·선택 동의·기존 Person 확인·복귀 | D2 + D3 | V · 동의/Person 취소/완료/복귀·JA320/다크 |

## 교차 경계

후속 구현: 위 표는 최초 진단의 V/I/D/U 범위를 보존한다. 승인된22개 항목의 구현·검수는 [구현 로그](./IMPLEMENTATION_LOG.md), 최종 고정 빌드 결과는 [로컬 인계](../../KTOUR_MOBILE_REFINEMENT_LOCAL_2026-09-16.md)를 따른다. 이후 대표 경로의 회귀 통과를83개 의미 단위의 모든 상태 PASS로 바꾸지 않는다.

- 공개 동네 가이드 읽기는 D1, 패스에 저장 승인·실행은 Coordinator, 저장 후 패스 카드는 D2. 일반 읽기에 신원 확인을 다시 요구하는 개선은 금지한다.
- 장소 액션은 D1, 참여/방문/메모는 D2, 실제 목적별 gate·거래는 D3. 완료/취소 후 원래 장소·금액·draft·focus를 함께 확인한다.
- 패스 스탬프와 배지 설명은 D2, 선택 consent/Person gate는 D3. 결제로 방문을 대체하지 않는다.
- 예약 실행은 D3, Tables 진입/내 기록 예약 카드는 D2. Table 참여와 식당 예약의 이름·보증을 합치지 않는다.
- Account 서비스는 D2의 설정 맥락에서 공개 review 경로만 제공된다. 실제 계정 삭제/해지로 표현하지 않는다.
