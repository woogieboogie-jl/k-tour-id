# Claude 인계: OpenDID 독립 구현과 후속 통합

## 시작 위치와 결론

**이 작업은 다른 Sui/CX 작업을 기다리지 않고 시작할 수 있다. 최종 연결 계약까지 없어진 것은 아니다.**
실제 OpenDID 구현은 아직 없고, 현재 앱의 provider branch는 의도적으로 fail-closed다.
OpenDID 자체 구현·native 검증을 독립 lane에서 완성한 뒤, 검수된 계약으로 현재 앱에 연결한다.

- 전용 worktree: `/Users/woogieboogie/github/k-tour-id/.codex-worktrees/opendid-native-20260928`
- 전용 branch: `implementation/opendid-native-20260928`
- 코드 기준점: `6af6aaf5` — 2026-09-28 Sui 자체 Testnet E2E/과거 조회 복구 검증본.
- 이 인계 문서와 전용 `CLAUDE.md`, `opendid-workflow/` 준비 커밋은 코드 기준점 위에 추가된다.
- **작업하지 않을 위치:** root checkout, `harvey-sync-20260917`, `sumsub-*`, `did-demo-20260908`.
  옛 `did-demo-20260908`은 clean이지만 `2a1bf907`의 오래된 샘플 데모다. 실제 provider 구현본이 아니다.
- worktree 간 Git object/refs는 공유하지만 index·working files·build output은 다르다.
  `git config`, remote, 다른 branch ref, 공용 hooks를 임의 수정하지 않는다.
- 새 branch는 Vercel Git 자동 배포 비활성화 대상이다. **push·merge·Vercel deploy·환경값 변경은 이번 독립 구현의 자동 단계가 아니다.**

먼저 해당 폴더에서 `CLAUDE.md`를 읽고 `node opendid-workflow/scripts/preflight.mjs`를 실행한다.
기존 OpenDID/native 작업이 다른 repo에 있다고 새로 전달받으면 내용을 먼저 비교하고 보존한다.

## 꼭 읽을 컨텍스트

1. [OpenDID 서버/holder 연결 계약·인수 조건](./OPENDID_WORKFLOW_BOUNDARY_2026-09-28.md) — BFF API/DTO, nonce·holder·정책 결합, native 복귀, 전체 부정 테스트.
2. [과거 SDK 실측](./ZKP_CAPABILITY_VERIFICATION_2026-08-17.md) §4 — 특히 §4.5의 P0 정책 결합 문제.
3. [고정 upstream commit 목록](./evidence/zkp/2026-08-17/opendid-source-manifest.txt),
   [비민감 오프라인 결과](./evidence/zkp/2026-08-17/opendid-local-run.json).
4. [Sui 검증 경계](./SUI_SELFHOSTED_E2E_2026-09-28.md) — 별도 실제 Testnet 발급/위임/실행은 통과했으나 identity/VC는 sample, 사용자 서명은 Ed25519다.

기존 소스의 핵심 읽기 위치:

- `k-tour-id-app/lib/hackathon/adapters/opendid.ts`
- `k-tour-id-app/lib/hackathon/{config,types,service,operation-evidence,store,store-integrity,submission-evidence,integration-preview-access}.ts`
- `k-tour-id-app/app/api/hackathon/v1/[...path]/route.ts`
- `k-tour-id-app/features/ondo/hackathon-b/hackathon-client.ts` 및 `hackathon-layer-b.tsx`.
- `k-tour-id-app/tests/hackathon/isolation.test.ts`, `tests/hackathon-verification/service-race-hardening.test.ts`.

## 이미 된 것 / 구현할 것

| 구간 | 현재 사실 | Claude 쪽 목표 |
| --- | --- | --- |
| Sample VC/VP | 서버 sample issuer 서명 + 브라우저 holder 키 + ack/nonce/policy 검증 | 참고/회귀 대상으로 보존. 실제 OpenDID 증거로 재분류하지 않기 |
| OpenDID provider | `issueCredential`, `verifierRequestOffer`, `verifierConfirm` 미구현; `opendid_provider_unimplemented` | 실제 릴리스의 issuer/TAS/holder/verifier lifecycle 구현 |
| Native holder | 두 기존 화면 모두 sample UI. 실제 앱/키 보관/발급 수신/VP 동의 아님 | native SDK로 실제 보관·제시·취소·복귀를 증명 |
| Provider authorization | provider VP, credential eligibility, 제출 evidence는 현재 차단 | 검증한 서버 증거에 의해서만 허용하는 후속 통합안 |
| 실제 status/revocation | config/TTL만 존재, provider freshness 구현 없음 | 같은 issuer/VC에 결합한 fresh status/revocation 검사; unsupported/unknown은 차단 |
| 기존 Sui/OmniOne/CX | 별도 작업자가 소유하는 통합 경로 | 구현 전제 조건으로 삼지 않고 계약 fixture로 격리. 실제 체인/신원 성공으로 주장하지 않기 |

`HK_OPENDID_*`의 localhost URL·plan/policy 기본 문자열은 동작하는 vendor API 명세가 아니다.
실제 OpenDID key와 `HK_ISSUER_SIGNING_SEED`도 별개다. 기존 seed는 sample signing/가명화에 쓰이므로
복사·재발급·교체하지 않는다. OpenDID DID와 Sui 주소를 같은 계정/키라고 가정하지 않는다.

## 파일·환경 소유권: 병렬 충돌 방지

| 구분 | 소유 범위 | 작업 규칙 |
| --- | --- | --- |
| Claude 독립 구현 | `opendid-workflow/**`, `docs/opendid/**`, 전용 `CLAUDE.md` | 자유롭게 구현·테스트·로컬 커밋. native app, provider services, fixtures, runbook을 여기 둔다. |
| 공동 통합 제안 | 위에 열거한 BFF/config/types/store/eligibility/evidence/UI/route allowlist | 먼저 `docs/opendid/INTEGRATION_PROPOSAL.md`에 변경 지점·DTO·tests를 제안. 계약 합의 전 기존 파일을 변경하지 않는다. 후속 승인되면 이 전용 branch에서 별도 통합 커밋으로 작성. |
| 다른 작업자 소유 | Sui/OmniOne/CX adapters, `move/`, Sumsub, 전역 지도/온보딩/디자인, 배포 설정 | 수정/재배포/키 사용 금지. 필요하면 변경 요청만 전달. |

- `node_modules`, `.next`, test output, native DerivedData, keystore, DB/volume은 모두 전용 경로다.
  다른 worktree의 build output이나 node_modules를 symlink하거나 같은 Next 서버를 사용하지 않는다.
- BFF/검수 UI의 **예약 포트는 3181**, provider host port 후보는 TA 19300 / issuer 19301 /
  verifier 19302 / DB 19332 / local chain RPC 19345다. 시작 전 실제 점유 여부를 확인한다.
  upstream 내부 포트/설정은 릴리스 문서에 따라 매핑하며 위 번호가 vendor의 공식 기본값이라고 주장하지 않는다.
- Compose project 이름은 `ktour-opendid-20260928`; 기존 컨테이너/volume/DB를 reset하거나
  전역 `docker ... prune`, `down -v`를 실행하지 않는다. 전용 resources에도 삭제 전 정확한 범위를 확인한다.
- 처음에는 전용 로컬 DB 사용. Redis가 필요하면 namespace도 별도로 정하고,
  기존 CX/Sumsub/integration Redis token·ledger·seed를 읽거나 재사용하지 않는다.
- Vercel/기존 `.env`/Google/Sui/OmniOne/CX/운영 계정 자격은 필요하지 않다. 가져오지 않는다.
  외부 배포·실기기용 공개 host·개발자 signing 권한이 필요해지는 단계에서만 사용자에게 정확한 항목을 요청한다.

## 실행 순서와 산출물

1. **릴리스·환경 고정:** 8월 실측 commit은 출발점이지 최신 호환성을 보증하지 않는다.
   공식 OmniOneID 릴리스의 서로 호환되는 server/SDK/native 버전을 확인하고 commit·artifact hash를
   `docs/opendid/PROVENANCE.md`에 고정한다. vendor source 수정 시 patch와 이유도 기록한다.
2. **자체 trust 환경:** 선택 릴리스에 필요한 TA/entity 등록, DB/local chain, issuer/verifier와
   membership/trust 설정을 전용 환경에 구성한다. 직접 등록 가능한 것은 구현자가 수행한다.
   조직 승인만 필요한 항목은 근거와 정확한 요청 내용으로 보고한다. 임의 hosted API나 API key를 만들지 않는다.
3. **Native holder 최소 완성본:** 기존 논의의 내부 native build를 목표로 한다. 스토어 출시는 범위 밖이다.
   가능한 내부/시뮬레이터 경로부터 시작하고, 장치 보안·SDK 제약으로 실기기가 필수면 그때 요청한다.
   실제 holder 키 생성/보호/credential 수신·보관/제시 동의·거절을 구현한다.
4. **실제 issuance/VP/status lifecycle:** 합성 identity fixture로도 개발은 가능하되 분류를 유지한다.
   issuer/credential/holder/request/policy/status 결과를 서버에서 검증한다. 요청한 최소 정보만 처리한다.
5. **BFF 연결 계약 고정:** sample PEM/boolean callback에 native proof를 끼워 넣지 않는다.
   실제 message schema, signing/canonicalization, 서버 확인 결과, 시작/조회/복귀/취소 DTO를
   버전 명시한 `docs/opendid/INTEGRATION_PROPOSAL.md`와 비민감 fixtures로 전달한다.
6. **native ↔ 독립 bridge E2E:** credential 수신·VP 동의·서버 판정·실패/복귀를 확인한다.
   native callback은 재조회 신호일 뿐 성공 증거가 아니다. 최종 앱 연결은 아래 공동 gate 후 진행한다.

완료 시 `docs/opendid/RESULTS.md`에 코드 commit, 재현 명령, 실제 앱 artifact 위치,
실행 환경, 성공/실패 vector와 개인정보 없는 request correlation을 기록한다.
“코드 있음 / fixture 통과 / 실제 native·server 통과 / K-Tour 전체 통합 통과”를 별도 열로 구분한다.
서버/앱 미구현 단계는 완료로 표시하지 않는다.

## 반드시 넘겨야 할 보안·구조 과제 (P0)

1. **proof 성공 ≠ 요청 정책 충족.** 고정 v2.0.0 SDK의 오프라인 실측에서 predicate 변경,
   `credDefId` restriction 변경, 필수 referent 누락을 `verifyProof()`가 받아들였다.
   HTTP verifier에도 같은 문제가 있다고 단정하지 말고, 선택한 릴리스/상위 서비스에서 재검증한다.
   nonce 외에도 referent, name/operator/value, schema/credDef restriction과 제출 식별자를 결합해
   해당 세 부정 벡터가 반드시 거절돼야 한다. `EQ` cross-platform 지원을 가정하지 않는다.
2. **발급 중복 방지:** 현재 `credentialIssue`는 adapter 호출 전에 durable issuance claim을 만들지 않는다.
   stub에 원격 호출만 넣지 않는다. request ownership/idempotency를 먼저 저장하고 timeout이면
   기존 provider transaction을 조회한다. 재시작·병렬 클릭으로 VC를 다시 발급하지 않는다.
3. **외부 I/O와 lock 분리:** 현재 `presentationSubmit`은 `mutate` 안의 sample 검증이다.
   provider/status I/O는 snapshot/claim → bounded I/O → revision/phase/nonce 재확인 후 atomic commit으로 분리한다.
4. **새 native route는 아직 없다:** BFF routing과 보호 통합 환경의 exact route allowlist를
   함께 좁게 확장해야 한다. `integration-preview-access.ts` 검사를 끄거나 wildcard를 열지 않는다.
5. **같은 세션/operation/holder만 허용:** 다른 탭·다른 wallet·다른 credential의 유효 proof도 거절.
   URL에 VC/VP/token/PII를 넣지 않고 HttpOnly cookie를 native로 복사하지 않는다.
6. **권한은 단계별 독립:** holder ack·VP 동의는 Sui 실행 승인이 아니다. native 복귀나 polling이
   자동 AI 승인/지갑 서명/chain 실행을 유발하지 않는다. 단순 callback boolean을 trust하지 않는다.
7. **unknown은 fail-closed:** 철회/만료/상태 불명/과거 캐시/미지원 suite/필수 predicate 누락을
   허용으로 바꾸지 않는다. 공급자 오류 원문·private key·VC/VP/JWT·QR payload는 로그/MD/Git에서 제외한다.

## 검증표와 인수 조건

먼저 offline/fixture로, 그 다음 전용 trust 환경에서 같은 벡터를 확인한다.

- 정상 발급 → 같은 holder의 실제 저장 확인 → 명시적 VP 동의 → 서버 판정.
- wrong issuer/holder/subject/session/operation/nonce/audience/purpose/venue/campaign/policy, 변조 proof 거절.
- 위 P0 세 request-policy mismatch, 필수 claim 누락/추가/다른 값, 미래 validFrom/정확한 만료 경계 거절.
- revoked/suspended/unknown, issuer/statusRef 교체, stale cache, VP 후 권한 철회를 확인.
- 동시 issue/ack/VP, 중복 callback, 응답 유실, process restart, 취소/만료 뒤 늦은 응답에서 중복 발급/허용 없음.
- native 미설치·미지원, OS Back, 다른 origin/state, 키 분실·다른 wallet 복귀에서 안전하게 실패/복귀.
- timeout·redirect·큰/잘못된 응답을 제한하고 로그/응답/캡처에 PII·key·token이 없는지 검사.
- mock input/real provider proof/real chain을 구분하고, sample을 LIVE/all-provider로 재표시하지 않기.

전체 상세 인수표는 [기존 boundary 문서 §7–8](./OPENDID_WORKFLOW_BOUNDARY_2026-09-28.md)을 함께 적용한다.
native 내부 build + 실제 self-hosted OpenDID 성공도 **조직 승인된 credential 또는 운영 신원 발급**과는 다르다.

공동 앱 통합을 적용할 때에는 최소 아래 회귀를 전용 worktree에서 다시 실행한다:

```sh
# k-tour-id-app에서, provider credentials를 상속하지 않는 전용 로컬 lane
pnpm install --frozen-lockfile
pnpm test:harvey:unit
pnpm test:harvey:verification
pnpm exec tsc --noEmit
pnpm build:harvey:local
node scripts/hackathon-local.mjs start 3181
# 다른 터미널: 같은 worktree, fixture UI 검증. 별도 직접 E2E와 혼동하지 않기.
HARVEY_PLAYWRIGHT_BASE_URL=http://127.0.0.1:3181 pnpm test:harvey:e2e
```

실제 provider smoke는 Claude가 구현한 전용 launcher/allowlisted environment에서 별도 실행한다.
위 `hackathon-local.mjs`는 외부 서비스를 차단하는 sample lane이므로 실제 OpenDID 검증에 사용하면 안 된다.
공용 3137의 BFF suite를 그대로 실행하지 말고, provider 통합 BFF 검사는 전용 port/config와 안전 경계를 갖춘 별도 테스트로 추가한다.

## 지금 사용자에게 요청할 것은?

**착수에는 추가 입력이 필요 없다.** 기존 계정/체인 키/신분증 앱 승인을 기다리며 독립 구현을 멈추지 않는다.
실제로 필요해진 경우에만 해당 단계와 이유를 밝혀 요청한다: 실기기 holder 동의, OS signing/배포 권한,
조직만 승인할 수 있는 entity 등록, 승인된 실서비스 trust environment, callback domain 소유권 등.
private key·신분증·JWT를 채팅으로 달라고 하지 않는다. 처음부터 불특정 “OpenDID API key”를 요구하지 않는다.

최종 앱 통합 gate는 **계약 합의 → 전용 branch 통합 패치 → 코드/보안/부정 테스트 리뷰 →
별도 보호 환경의 실제 holder 동의 → 기존 Sui/OmniOne과 같은 operation 연결**이다.
OpenDID 독립 구현을 넘겨도 현재 Sui/CX 작업은 계속할 수 있고, 그 반대도 마찬가지다.
