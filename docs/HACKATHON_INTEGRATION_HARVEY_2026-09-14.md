# 해커톤 연동 구현 기록 — CX · OpenDID · Sui · OmniOne Chain

작성: Harvey (2026-09-14) · 브랜치 `feat/hackathon-integration-harvey` (base `handoff/harvey-20260914`) · 상태: **구현 완료, 실기기·실계정 검수 전**

이 문서는 [연동 개발 요약](./HARVEY_HACKATHON_HANDOFF_2026-09-14.md)과 [Sui 추가 명세](./HACKATHON_SUI_REQUIRED_ADDENDUM_2026-09-14.md)를 코드로 옮긴 결과와 그 경계를 기록한다. 실연동/목업/미충족을 구분해서 적는다.

## 1. 한 줄 요약

지도 → 지정 장소(`mois-0021cd596bc5b2a922ad`, 캠페인 `hk-identity-perk-v1`) → **체험 혜택 보기** → 동의 → 신원 확인(CX 어댑터) → K-Pass 발급·보관·제시(OpenDID 어댑터, 실제 서명 검증) → AI 제안(Gemini 또는 규칙) → 사용자 승인 → **Sui Testnet 실제 Move 권한 위임(사용자 PTB 2명령, 가스 스폰서)** → **agent가 권한 1회 소비(PTB 2명령)** → 서버 최종 재판정·사용 1회 확정 → **OmniOne Chain(stage) 실제 기록·확정 조회** → 같은 장소로 복귀.

| 기술 | 상태 | 근거 |
|---|---|---|
| Sui (Move · zkLogin/데모 서명자 · PTB · 스폰서 · agent · provenance) | **실연동 (Testnet)** | 패키지 `0xc5d26326…975d`, 캠페인 `0xe3fce96c…cf16`, 스모크 tx 아래 §6 |
| OmniOne Chain (DemoEntitlementRegistry) | **실연동 (stage, chainId 201210)** | 레지스트리 `0x696bc4e29c8f8079b6d3cd49d310a09577550e4c` |
| OpenDID (K-Pass VC/VP) | **어댑터 2모드**: `mock`(이 서버가 Ed25519로 발급·검증, holder 키는 브라우저 WebCrypto) / `opendid`(did-issuer/verifier 서버 API) | 테스트 서버·실제 holder 앱 확보 전까지 `mock` |
| OmniOne CX (모바일 신분증) | **어댑터 2모드**: `mock`(SIMULATION 표기) / `cx`(VC-Verifier v1.0 REST 4단계, zkpType AdultVerify) | 해커톤 CX 테스트 계정 확보 후 `HK_MODE_CX=cx` |
| zkLogin(Google) | 코드 완료, Google OAuth 클라이언트 ID·salt seed 설정 시 활성. 미설정 시 **샘플 서명자**(라벨 표시) | §4 설정 |

## 2. 코드 위치

```
k-tour-id-app/
  lib/hackathon/config.ts            env → 설정, 공개 설정(hkPublicConfig), TTL
  lib/hackathon/store.ts             JSON 파일 저장소(원자적 쓰기, 직렬화 뮤텍스), unique 제약(subject+campaign)
  lib/hackathon/service.ts           상태 기계: consent→identity→issuance→presentation→proposal→delegation→agent→fulfillment→done, outbox
  lib/hackathon/session.ts           HttpOnly 쿠키 세션, same-origin(CSRF) 검사
  lib/hackathon/adapters/cx.ts       OmniOne CX (mock|cx)
  lib/hackathon/adapters/opendid.ts  OpenDID (mock|opendid) — VC 발급, holder ack, VP 검증
  lib/hackathon/adapters/ai.ts       Gemini 제안 + 스키마/allowlist/injection guard, 규칙 폴백
  lib/hackathon/adapters/sui.ts      SuiGrpcClient, issue / delegate PTB / consume PTB, effects·events 검증
  lib/hackathon/adapters/zklogin.ts  salt 파생(HMAC), 주소, prover 호출
  lib/hackathon/adapters/omnione.ts  ethers v6, recordRedemption / getRedemption / receipt
  app/api/hackathon/v1/[...path]/route.ts   BFF 엔드포인트 (§3)
  app/hackathon/zklogin/callback/page.tsx   Google OAuth 복귀
  features/ondo/hackathon-b/*        CTA(장소 상세), 여정 오버레이, 브라우저 클라이언트(holder 키·서명자)
  scripts/hackathon-smoke.mjs        E2E 스모크 (정상/부정)
move/ondo_entitlement/               Move 패키지 + 유닛 테스트 7건 + Testnet 배포 정보
chain/omnione/                       DemoEntitlementRegistry.sol / ABI / 배포 정보
```

새 의존성은 `@mysten/sui@2.31.0`, `ethers@6.17.0` 두 개(정확한 버전 고정)뿐이다.

## 3. API (`/api/hackathon/v1`)

| Method · Path | 역할 |
|---|---|
| GET `/config` | 공개 설정·모드 |
| POST `/sessions`, GET `/me` | 세션 |
| GET `/places/{venueId}/demo-entitlements` | 캠페인·현재 operation·사용 여부 |
| POST `/operations` | 동의 → operation 생성(세션·캠페인당 진행 중 1개 재사용) |
| POST `/operations/{id}/identity/start` · `identity/complete` | CX handoff 시작 / 서버 결과 검증 (mock은 sample 결과) |
| POST `/operations/{id}/credential/issue` · `credential/holder-ack` | VC 발급 / holder 키 소유 증명 |
| POST `/operations/{id}/presentation/request` · `submit` · `deny` | nonce 발급 / VP 검증(서명·issuer·만료·status·claim 부분집합) / 거절 |
| POST `/operations/{id}/proposal` | AI 제안(digest 고정) |
| POST `/operations/{id}/delegation/prepare` · `submit` | 지갑 소유 증명 → Entitlement 발급 → 스폰서 PTB bytes / 사용자 서명 실행·검증 |
| POST `/operations/{id}/agent/run` | agent PTB(consume + attest_execution), manifest commitment |
| POST `/operations/{id}/redeem` | Sui 재검증 + 자격 재확인 + decisionRef 1회 소비 + redemption + outbox (idempotency key) |
| POST `/operations/{id}/cancel` · `reconcile` | 취소(실행 전) / outbox·unknown 상태 재조정 |
| GET `/operations/{id}` · `/evidence` | 상태 / 비식별 증거(두 체인 독립 상태, provenance 재계산) |
| GET `/zklogin/params`, POST `/zklogin/prove` | zkLogin 파라미터 / 증명 |

## 4. 실행

npm만 있으면 된다(pnpm 설치 불필요). 의존성은 pnpm 레이아웃으로 이미 설치돼 있고, macOS arm64·Linux arm64 네이티브 바이너리를 함께 담고 있다(`package.json` → `pnpm.supportedArchitectures`).

```bash
cd k-tour-id-app
npm run dev                           # http://localhost:3000 (개발)
npm start                             # 프로덕션: 빌드가 없으면 prestart가 next build 1회 실행 후 next start
npm run setup                         # 재설치가 필요할 때만 (npx pnpm@10.8.0 install --frozen-lockfile; `npm install`은 쓰지 말 것 — 레이아웃이 깨진다)
npm run typecheck
node scripts/hackathon-smoke.mjs      # 정상 E2E (Sui·OmniOne 실 트랜잭션 발생)
node scripts/hackathon-smoke.mjs http://localhost:3000 --negative   # 위조 claim → deny
```

`.env.local`은 채워져 있다(gitignored). 새 체크아웃이면 `cp hackathon.env.example .env.local` 후 값 채우기.

UI 진입(둘 다 `NEXT_PUBLIC_HK_DEMO_ENTRY=1`일 때): **http://localhost:3000/hackathon** 딥링크 → 지정 장소(로바) 상세가 열리고 **체험 혜택 보기** CTA에 포커스. 또는 지도 화면 우하단 **체험 혜택 여정 시작** 버튼. 이후 단계별 버튼: 동의 → 모바일 신분증 확인(샘플 승인/취소/실패) → 패스 자동 발급 → 패스 제시/제시하지 않기 → 혜택 제안 받기 → 서명자 선택(Google zkLogin / 샘플) → 위임 서명 → 실행 → 확인하고 사용하기 → 기록 확정·증거 보기 → 같은 장소로 돌아가기. 외부 앱/새로고침 후에는 `sessionStorage`의 pending operation으로 자동 재개한다. 여정 오버레이는 앱 모달 스택(`ONDO_MODAL_PRIORITY.critical`)에 올라가므로 열려 있는 동안 장소 시트·독은 inert가 되고 닫으면 복원된다. 시각 회귀 테스트를 돌릴 때는 `NEXT_PUBLIC_HK_DEMO_ENTRY=0`.

필수 env(.env.local): `HK_SUI_PACKAGE_ID`, `HK_SUI_CAMPAIGN_ID`, `HK_SUI_CAMPAIGN_INITIAL_VERSION`, `HK_SUI_ISSUER_SECRET_KEY`, `HK_SUI_AGENT_SECRET_KEY`, `HK_OMNIONE_RPC_URL`, `HK_OMNIONE_PRIVATE_KEY`, `HK_OMNIONE_REGISTRY_ADDRESS`. 선택: `GEMINI_API_KEY`(제안을 실제 모델로), `NEXT_PUBLIC_GOOGLE_CLIENT_ID` + `HK_ZKLOGIN_SALT_SEED`(zkLogin), `HK_MODE_CX=cx` + CX 접속값, `HK_MODE_OPENDID=opendid` + 서버 URL.

zkLogin 활성화: Google Cloud → OAuth 클라이언트(웹) 생성 → 승인된 리디렉션 URI에 `http://localhost:3000/hackathon/zklogin/callback`(및 배포 도메인) 추가 → `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `HK_ZKLOGIN_SALT_SEED`(무작위 32바이트) 설정. Prover는 Mysten dev prover(Devnet/Testnet 공용). 이 두 값이 없으면 UI는 "샘플 서명자"만 제공하고 evidence에 `signer: demo`로 남긴다.

## 5. 설계 결정 (명세 대응)

- **HK-06 Move**: `ondo_entitlement::entitlement` — `Campaign`(shared, issuer/agent/policy), `Entitlement`(issuer만 mint, key-only), `Grant`(shared; owner·agent·recipient·action_commitment·expiry·max_uses=1·revoked), `ExecutionRecord`(key-only, recipient에게). 계약이 issuer·소유자·agent·만료·철회·사용횟수를 강제한다. 유닛 테스트 7건(정상, public mint 거절, 2회 소비 거절, 타 agent 거절, 만료, 철회, 비소유자 delegate).
- **HK-07 zkLogin/PTB**: 사용자 PTB = `delegate` → `attest_consent`(cmd1 결과 ID를 cmd2 인자로) / agent PTB = `consume` → `attest_execution`. 둘 다 스폰서(issuer 키)가 가스를 낸다. 사용자는 SUI 0. 트랜잭션 bytes는 서버가 allowlist로 조립하고 클라이언트는 서명만 한다(`txBytesDigest` 일치 검사). 지갑 소유는 operation·decisionRef에 묶인 personal message 서명으로 증명한다.
- **HK-08 AI**: 모델에는 비식별 장소·캠페인·시간대만 전달. 출력은 `action=redeem_demo_entitlement`, 대상 일치, 길이 제한, injection 정규식으로 검증하고 실패 시 규칙 제안으로 대체하며 `guard`에 기록. `proposalDigest`가 이후 actionCommitment·consentCommitment·manifest에 연결된다. manifest commitment는 `attest_execution` 이벤트로 체인에 남고, evidence에서 재계산 일치를 보여준다(한 필드 바꾸면 불일치).
- **실패 경계(§4)**: Sui consume 성공 ≠ 혜택 사용. `redeem`이 Sui tx·grant.uses=1을 독립 조회한 뒤 credential/decision/campaign/uniqueness를 재확인해야 `redeemed`. 미충족은 `fulfillment_blocked`(사유 기록)이며 체인 rollback을 주장하지 않는다. 같은 idempotency key + 같은 body는 같은 결과, 다른 body는 409.
- **OmniOne(5.4)**: `DemoEntitlementRedeemed(eventKey, payloadCommitment)` 1종. eventKey는 무작위, payload는 `{kind, schemaVersion, campaignRef, policyVersion, salt, suiDigestCommitment, manifestCommitment}`의 sha256. outbox는 eventKey로 먼저 조회해 재전송을 막고, receipt status 1 + `getRedemption` 일치일 때만 `confirmed`.
- **subjectRef**: mock에서는 서버 키 HMAC(샘플 seed); cx 모드에서는 CI(제공 시) 또는 provider txid+cxid의 HMAC. 이름/생년월일 해시는 쓰지 않는다. 같은 subject+campaign 재시도는 신원 확인 직후 `already_redeemed`로 차단.

## 6. 증거 (2026-09-14, Testnet/stage 실 트랜잭션)

- Sui 패키지 publish: `HTRxhvdzwvTbTUkntPfthQ3xwkyqgoExxfUeA4tRmJLa` · 캠페인 생성: `BNUdHRKzUNA8WXjT5NnBx7SQPhaNvZUSGuWwAiZYj49g`
- 스모크(issue → user PTB → agent PTB): `E5syTJst5v9h25QmaYCnC9nfsri2bRpcn6DjNBxPqf1d` → `5mFAmHq2ri2tfQeXaWBxS2qu1PrgKBBS6AGsn5wDp3Z8`(Grant `0x73afb7…aa07`, 2 commands, sponsored) → `2aYgyPmM2VsEtj9FpcBocgFY8FNe5LTwb9yzHrfBnXFy`(ExecutionRecord `0xc505f5…6b51`, grant.uses=1)
- OmniOne DemoEntitlementRegistry 배포: `0x1a82867d7608d3f473d2c2c5b4ef2995021a616de7b8d647f22544ea29e333db` (block 0x1828553)
- 앱 E2E(VM, mock ID/PASS): identity → credential → presentation allow → proposal 까지 통과; 위조 claim → `deny(claim_mismatch)`; cross-site POST → 403; 타 장소 → 404. Sui/OmniOne 단계는 네트워크가 열린 로컬(Mac)에서 `scripts/hackathon-smoke.mjs`로 실행.

## 7. 남은 확인 (사람이 해야 함)

1. Mac에서 `pnpm dev` + `node scripts/hackathon-smoke.mjs` 1회 실행 → Sui tx 2건·OmniOne tx 1건 확인 (evidence JSON 캡처 → 제출 자료).
2. CX 테스트 계정 → `HK_MODE_CX=cx`, 실기기에서 표준창 왕복. `identity/complete`는 서버가 `authen/*/result` + `trans/token`으로 검증한다.
3. OpenDID 서버가 있으면 `HK_MODE_OPENDID=opendid`로 Issuer offer/Verifier confirm 필드명을 팀 릴리스에 맞춰 조정(`adapters/opendid.ts` 상단 주석).
4. zkLogin: Google OAuth 클라이언트 ID 발급 후 실제 Google 로그인 1회 시연.
5. DeepSurge 등록·제출, 공개 GitHub, "왜 Sui인가" 1페이지(§8 초안 사용).

## 8. "왜 AI 앱에 Sui인가" (1페이지 초안)

ONDO의 혜택 도우미는 "제안"만 하고, 실행은 **사용자가 서명한 범위** 안에서만 일어난다. 이 범위를 서버 DB가 아니라 Sui Move 객체(`Grant`)로 표현하면, 대상·수령 지갑·기한·1회라는 제약을 **계약이 강제**하고, 누가 무엇을 근거로 실행했는지(`ConsentAttested`, `ExecutionAttested` 이벤트의 commitment)가 **검증 가능한 기록**으로 남는다. zkLogin은 외국인 관광객이 지갑·시드 없이 Google 계정으로 이 권한 객체를 소유하게 하고, PTB는 위임과 동의, 실행과 기록을 각각 한 트랜잭션에 원자적으로 묶는다. 스폰서 트랜잭션 덕분에 사용자는 SUI를 한 개도 들지 않는다. 서비스 결과(혜택 사용)와 감사 기록(OmniOne)은 분리되어 있어, Sui는 "AI가 한 일의 한계와 출처"를 증명하는 층으로만 쓰인다.
