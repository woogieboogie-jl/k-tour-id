# 부산 이야기 출처와 데이터 범위

확인일: 2026-09-27. 앱의 부산 이야기를 서울과 같은 `Story` 구조로 추가했다. 배포 여부를 증명하는 문서는 아니다.

구현: `k-tour-id-app/features/ondo/discovery-preview/busan-stories.ts`.

## 이야기와 확인 근거

각 이야기는 한국어·영어·일본어 제목, 도입, 본문 2문단, 장소별 메모 2개를 갖는다. 문장은 출처를 바탕으로 새로 작성했으며 원문·사진을 복제하지 않았다.

| 이야기 ID | 장소 | 사용한 1차 출처와 확인 범위 |
|---|---|---|
| `busan-market` | 국제시장 · 젊음의거리 / 부평깡통시장 | [Visit Busan 국제시장](https://www.visitbusan.net/index.do?lang_cd=en&menuCd=DOM_000000301003001000&uc_seq=399), [Visit Busan 부평깡통시장](https://www.visitbusan.net/index.do?lang_cd=en&menuCd=DOM_000000301003001000&uc_seq=400): 두 시장의 인접 관계, 시장 골목과 먹거리 소개. 특정 가게나 현재 야시장 영업을 보장하지 않는다. |
| `busan-coffee` | 모모스 로스터리 & 커피바 영도 / 웨이브온커피 | [Visit Busan 모모스](https://www.visitbusan.net/index.do?menuCd=DOM_000000202002001000&uc_seq=2158): 선착장 개조 공간, 생두·로스팅·추출 과정과 영도 주소. [Visit Busan 웨이브온](https://www.visitbusan.net/index.do?lang_cd=en&menuCd=DOM_000000301002001000&uc_seq=174): 해안 전망, 드립커피·월내라떼와 기장 주소. 도보 연결 코스가 아닌 일정별 대안이다. |
| `busan-table` | 뫼밀집 / 송헌집 | [MICHELIN Guide 뫼밀집](https://guide.michelin.com/en/busan-region/busan_1025838/restaurant/moemiljip), [MICHELIN Guide 송헌집](https://guide.michelin.com/en/busan-region/busan_1025838/restaurant/songheonjip): 메밀국수 조리 방식, 숯불 떡갈비와 주택 공간, 각각의 주소. 현재 수상 등급·예약 가능 여부는 새 이야기에서 주장하지 않는다. |

## 위치

좌표는 `[위도, 경도]` 순서다. 시장 핀은 상점·입구·장애물 없는 동선의 정밀 안내가 아니다.

| Place ID | 좌표 | 위치 근거 |
|---|---|---|
| `editorial-busan-gukje-market` | `35.1015616857, 129.0283237293` | [한국관광공사 linked data 1013716](https://data.visitkorea.or.kr/linkedview/1013716)의 **국제시장 젊음의거리** 대표 위치. 국제시장 전체의 중심점으로 표현하지 않는다. 별도 조사자가 공개 위치 데이터를 확인했으며, 본문용 웹 추출 도구에서는 linkedview가 503을 반환했다. |
| `editorial-busan-bupyeong-market` | `35.1015921962, 129.0260517037` | 위 Visit Busan `uc_seq=400`의 시장 대표 위치. 주소는 부산 중구 부평1길 48. |
| `research-busan-momos-yeongdo` | `35.095932, 129.04263` | 기존 `data/ondo/research/busan-food-pulse.json`의 2026-09-09 조사 좌표 재사용. 이번 확인에서 Visit Busan의 봉래나루로 160 주소와 지점을 대조했다. |
| `research-busan-waveon-coffee` | `35.32225, 129.26979` | 같은 기존 자료의 좌표 재사용. Visit Busan의 기장군 장안읍 해맞이로 286 주소와 대조했다. |
| `research-busan-moemiljip` | `35.15664, 129.14696` | 같은 기존 자료의 좌표 재사용. MICHELIN의 마린시티3로 23 오렌지프라자 2층 주소와 대조했다. 해당 공식 지도 링크의 위치와 약 2m 이내 차이이며 새 정밀 측량으로 주장하지 않는다. |
| `research-busan-songheonjip` | `35.15654, 129.12146` | 같은 기존 자료의 좌표 재사용. MICHELIN의 민락로19번길 18 주소 및 공식 지도 링크 위치와 일치한다. |

기존 식당·카페 4곳의 ID·이름·종류·위치는 `RESEARCHED_FOOD_B`에서 가져오며 중복 장소를 만들지 않는다. 시장 2곳만 새로운 명시적 대표 위치로 추가한다.

## 이미지와 권리

새 외부 이미지를 다운로드하거나 관광청·매장 사진을 재사용하지 않았다. 아래 기존 로컬 편집 일러스트만 사용한다.

- 시장: `/editorial/food/ondo-category-casual-v1.jpg` — 분식 분위기 그림. 실제 시장·가게·메뉴 사진이 아니다.
- 커피: `/editorial/food/coffee-croissant-illustration-v1.jpg` — 커피와 빵 분위기 그림. 해당 매장에서 특정 빵을 판매한다는 근거가 아니다.
- 뫼밀집: `/editorial/food/perilla-noodles-illustration-v1.jpg` — 메밀국수 분위기 그림.
- 송헌집 및 식사 이야기: `/editorial/food/tteokgalbi-illustration-v1.jpg` — 떡갈비 분위기 그림.

6개 장소 모두 현재 `illustration: true`이며 장소별 alt와 credit으로 실사와 구별한다. 식당·카페의 이미지는 기존 `researchFoodMediaB`를 거친다. 향후 기존 데이터에 검수된 로컬 실사가 추가되면 해당 credit·source·license 정보도 함께 따른다. 이야기 대표 이미지는 그대로 일러스트다.

기존 편집 이미지의 사용 제한은 `k-tour-id-app/docs/ONDO_GENERATED_MEDIA_REGISTRY.md` 및 기존 미디어 매핑을 따른다. 공식 웹페이지 링크는 사실 확인 근거이지 이미지 사용 허가를 뜻하지 않는다.

## 의도적으로 포함하지 않은 주장

- 촬영지·연예인 방문·최신 수상 등급·실시간 인기·혼잡도·좌석·영업시간·가격을 새로 주장하지 않는다.
- 카페 두 곳이나 식사 두 곳을 공식 관광 코스 또는 검증된 도보 경로로 제시하지 않는다.
- 메뉴가 비건·할랄·글루텐 프리라는 보증, 예약·결제·혜택 자격은 부여하지 않는다.
- 지도 정확도는 출처의 대표 위치 수준이며 현장 진입 경로·층별 안내의 대체가 아니다.
