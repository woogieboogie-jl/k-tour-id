# Jeju discovery story: source and media check

Checked: 2026-09-27. Scope: the added `jeju-table` story and its two existing researched-food records. This is an editorial pairing, not a tourism-board route, current opening check, crowd report or quality ranking.

## Story and places

`k-tour-id-app/features/ondo/discovery-preview/jeju-stories.ts` exports `JEJU_ADDITIONAL_PLACES` and `JEJU_ADDITIONAL_STORIES`. Shared `Place`, `Story`, `Words` and `words` come from `discovery-content-types.ts`; the module does not import the aggregating fixtures.

| Existing research ID | Source-backed facts used | Coordinates retained |
| --- | --- | --- |
| `research-jeju-woojin-haejangguk` | Woojin Haejangguk, 11 Seosa-ro, Jeju City; its regional soup combines bracken and pork and is described as thick and porridge-like. | 33.5114884, 126.5200864 |
| `research-jeju-gozip-dolwurock-jungmun` | Gozip Dolwurock **Jungmun branch**, 879 Iljuseo-ro, Seogwipo; braised rockfish and a nangpun-style meal. | 33.25799, 126.41676 |

The existing IDs, names, districts and coordinate values are taken from `RESEARCHED_FOOD_B`, not copied into independent synthetic pins. Both pairs and street addresses were rechecked against the current primary tourism pages. English/Japanese narrative and explanatory names are editorial translations, not claims of registered trade names.

## Primary sources

1. [VisitJeju — 우진해장국](https://www.visitjeju.net/kr/detail/view?contentsid=CNTS_000000000018375): venue identity, street address, published coordinates, bracken-and-pork ingredients and texture. The new story does not reuse the page’s hours, congestion widget or visitor reviews. The pork ingredient is explicit so the presence of a vegetable in the title cannot imply a vegetarian meal.
2. [VisitJeju — 고집돌우럭 중문점](https://www.visitjeju.net/kr/detail/view?contentsid=CNTS_000000000021950): branch identity, street address, coordinates, braised-rockfish and nangpun meal description. No supplier exclusivity, health claim or present-day ingredient-origin guarantee is repeated.
3. [Operator — 중문점 안내](https://www.gozipfish.com/map1): the branch-specific heading and address independently match VisitJeju. Shared page chrome also contains an airport-branch address; it is not the source of this pin.

The two paragraphs and concrete stop notes are available in Korean, English and Japanese. They pair two different meal styles, distinguish northern Jeju City from southern Jungmun, and explicitly avoid presenting them as a walk or an official route. Neither place overlaps the existing Donsadon/Oneunjeong `jeju-kpop` selection.

## Media and limits

- Both researched records currently have `photo: null`; no tourism/operator photo was downloaded or hotlinked, and no reuse permission is inferred from a public gallery.
- The story cover and fallback cards reuse the existing owned `/editorial/food/ondo-category-korean-v1.jpg` Korean-meal illustration. It is a category visual, **not** an image of either restaurant or its named dishes. Each fallback place has `illustration: true`, illustration credit, and three-language alt text that states that boundary.
- `researchFoodMediaB` remains the common media gate if a licensed, place-specific local photo is approved later; only then are photo credit/source/license fields attached.
- The existing Sinseoloreum momguk photograph belongs to another venue and is deliberately not reused for Woojin.
- No current hours, prices, queues, open status, reservations, trip duration, transit connection, popularity or official-route claim was added. Check shop information separately before a visit.

## Existing Jeju stories

The existing `screen` and `jeju-kpop` modules are not edited by this change. This check does not newly certify every claim in those stories or change their source/media metadata.

## Local verification

The added module is checked for exactly one `jeju-table` story, two existing Jeju food IDs, two nonempty paragraphs in each language, complete per-stop translations, finite source-matching coordinates, local media existence and explicit illustration attribution. Integration and browser checks are run against the shared city-story aggregation separately.

- Direct module assertions passed for that scope.
- Focused contracts passed **25/25** across `ktour-discovery-collection-model.spec.ts` and `ktour-regional-stories.spec.ts`: three stories per city, unique IDs, valid same-city references, source links, translations, local media and no invented temperature/payment/night eligibility. These are local data/selector tests, not live venue or browser verification.
- Two-paragraph character counts (Unicode code points, including spaces) are KO **269**, EN **534**, JA **251**. The longest existing Seoul body in each language is 193/359/162, so this story is approximately **1.39/1.49/1.55×** as long. The shared reader uses wrapping paragraphs and scrolling; this measurement flags the added reading length for mobile QA and does not itself prove visual fit.
