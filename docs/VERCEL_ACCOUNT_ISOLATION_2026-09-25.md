# Vercel 계정 / 작업 폴더 경계 — 2026-09-25

## 확인 결과

- jaewook 전용 CLI 프로필의 사용자: `jaewook-9643`. 인증된 프로젝트 조회로 `ondo` 접근을 확인했다.
- 기본 CLI 사용자는 중립 디렉터리에서 `megan-3020`으로 유지된다. 기존 기본 로그인은 변경하지 않았다.
- 저장소 루트 앱에서 기본 `whoami`는 403이지만 `--scope ohayo-global`을 지정하면 megan으로 확인된다. 이 결과를 로그아웃이나 인증 정보 소실로 해석하지 않는다.
- 인증 파일이나 토큰을 열어 읽거나 복사하지 않았다. 이번 작업에서 원격 환경변수, 배포, GitHub 연결, 전역 Git 설정은 변경하지 않았다.

## 이번 작업의 고정 대상

| 항목 | 값 |
| --- | --- |
| 작업 폴더 | `/Users/woogieboogie/github/k-tour-id/.codex-worktrees/harvey-sync-20260917` |
| 앱 폴더 | 위 폴더의 `k-tour-id-app` |
| 브랜치 | `feat/hackathon-readiness-preview-20260925` |
| CLI 프로필 | `/Users/woogieboogie/.config/vercel-accounts/jaewook` |
| 프로젝트 / ID | `ondo` / `prj_w5rckTz9B1DO55fvVRXjQRy9L5RM` |
| 소유 범위 | `team_6kJAloQ9WlswvMtbbCmGI7Er` |
| 연결 저장소 | `woogieboogie-jl/k-tour-id` |
| 원격 Root Directory / Production Branch | `k-tour-id-app` / `main` |

이 앱 폴더의 `.vercel/project.json`만 위 조회 결과에 맞게 생성했다. Git ignore 대상이며 비밀값은 없다. 기존 루트 작업 폴더의 연결은 건드리지 않았다.

## 읽기 전용 확인 명령

```sh
cd /Users/woogieboogie/github/k-tour-id/.codex-worktrees/harvey-sync-20260917/k-tour-id-app
pnpm vercel:ktour status
```

이 명령은 현재 폴더·스크립트 위치·Git 루트·브랜치·로컬 프로젝트 링크를 확인한 뒤, 고정 프로필로 사용자와 원격 프로젝트를 각각 조회한다. 원격 프로젝트의 ID·소유 범위·이름·저장소·앱 루트까지 일치해야 성공한다.

- `status` 외 명령과 추가 옵션은 거절한다. 배포용 범용 CLI 래퍼가 아니다.
- 상속된 Vercel 토큰·프로젝트·팀 및 Node 옵션 등은 하위 명령에서 제외한다. HOME을 바꿔 로그인 계정을 전환하지 않는다.
- CLI는 `vercel@60.0.1`을 사용한다. 전체 프로젝트 응답이나 오류 원문을 출력하지 않는다.
- 경로는 이 기기의 이 작업 폴더에 의도적으로 고정했다. 다른 checkout에서 쓰려면 대상부터 별도로 확인해야 한다.
- 원시 `vercel` 명령을 사용자가 직접 실행하는 것까지 시스템 차원에서 막는 것은 아니다.

## 사용자가 지정한 megan 작업 폴더 — 추가 확인

- 폴더: `/Users/woogieboogie/github/ohayo-api-external`.
- 현재 브랜치: `codex/affiliate-platform-foundation`; origin은 `ohayoglobal/ohayo-data`다. K-Tour와 서로 다른 저장소이므로 이 두 작업을 나누려고 새 worktree를 만들 필요는 없다.
- 해당 폴더에서 기본 CLI + `--scope ohayo-global`로 `megan-3020`을 확인했다. 코드·설정·인증 정보는 변경하지 않았다. 기존 수정 중 파일도 그대로 보존했다.
- `ohayo-global`의 전체 프로젝트 목록 18개(후속 페이지 없음)를 읽기 조회했다. 이 중 `woogieboogie-jl/k-tour-id`에 연결된 프로젝트는 없었다.
- `ohayo-affiliate-portal`과 `dev-affiliate-portal`은 Git 연결이 없고, `ohayo-api`와 `ohayo-api-staging`은 별도 `ohayoglobal/ohayo-api` 저장소에 연결되어 있었다.
- K-Tour 전용 확인 명령을 이 megan 폴더에서 실행하면 `wrong_worktree`로 원격 호출 전에 차단된다.
- 별도 검토자가 해당 API 저장소의 배포 스크립트·문서를 읽기 검수했다. 이 폴더 자체는 **Railway API** 배포 소스이며, Vercel 포털 소스는 별도 `ohayoglobal/ohayo-affiliate-toolkit` 저장소로 기록되어 있다. 운영 포털은 검수된 artifact를 `ohayo-affiliate-portal`에 배포하는 방식이다. API 폴더를 Vercel에 새로 연결하지 않는다.
- 위 배포 방식은 `ohayo-api-external/PRODUCTION_ROLLOUT_PLAN_2026-09-19_KO.md`, `PRODUCTION_PORTAL_ROLLOUT_2026-09-19.md`, `scripts/prepare-production-api-deployment.mjs` 및 `railway.json`에서 확인했다. Railway 실행 상태나 포털 artifact의 최신 배포 성공을 이번 확인에서 재검증한 것은 아니다.

## 검수 결과

- 실제 전용 프로필의 `pnpm vercel:ktour status`: `ok: true`, `remoteMutation: false`.
- megan 작업 폴더에서 동일 실행기 호출: `wrong_worktree`, 종료 코드 1.
- 계정 경계 단위 테스트 **7/7 PASS**, 전체 hackathon 단위 테스트 **149/149 PASS**.
- 앱 TypeScript 검사 및 `git diff --check` 통과.
- 독립 검토자: 읽기 전용 실행기에 차단할 문제 없음. 추가 권고인 강제 종료 신호 및 응답 필드 크기/타입 제한을 반영했다.
- 이 검수는 로컬/계정 경계 검증이다. CX 공급자·체인 실연동 E2E 결과를 뜻하지 않는다.

## 확인의 한계 / 운용 규칙

1. **기존 링크 보존:** K-Tour 루트 앱에 남아 있는 오래된 `k-tour-id-app` 프로젝트 링크는 현재 megan 계정으로 조회되지 않았다. 사용자가 지정한 실제 megan 작업 폴더와는 다르므로 추정해서 다시 연결하거나 제거하지 않는다.
2. **GitHub 자동 배포:** 로컬 CLI 프로필과 독립적이다. jaewook 프로젝트는 K-Tour 저장소와 `main`에 연결되어 있고 프로젝트 수준 Ignore Build 명령은 없었다. 조회된 megan/ohayo-global 프로젝트와 같은 Git 연결을 공유하는 충돌은 발견되지 않았다. 별도 CI·수동 배포·추후 연결 변경까지 검증한 것은 아니다.
3. **원격 환경 / 배포 준비:** 같은 프로젝트의 환경변수와 빌드 설정은 여전히 해당 프로젝트에서 공유된다. 이번 `status` 성공은 배포나 실인증 성공이 아니다. 다음 쓰기 작업은 정확한 Preview 브랜치·검수한 revision·허용된 설정 범위를 별도로 검증해야 한다.

앞으로 K-Tour 작업은 위 전용 작업 폴더와 `--global-config /Users/woogieboogie/.config/vercel-accounts/jaewook`을 사용한다. 두 작업을 오갈 때 기본 `vercel login/logout`으로 계정을 전환하지 않는다. megan의 기존 기본 로그인은 그대로 사용하며, 이 작업에서 megan 배포 스크립트를 수정하지 않는다.

실연동 후속 항목은 [CX 실행 체크리스트](./CX_EXECUTION_TASKS_2026-09-25.md)에 유지한다.
