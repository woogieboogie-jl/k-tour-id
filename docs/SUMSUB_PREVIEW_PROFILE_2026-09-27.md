# Protected Sumsub Preview Profile

`vercel.sumsub-preview.json` is a separate Vercel profile for the approved
`integration/sumsub-live-20260927` branch. It does not modify the existing
`vercel.json` CX/public deployment profile.

The build script accepts only approved GitHub Preview metadata when Vercel
metadata is present, rejects production, refuses local `.env*` files, and
passes no provider, AI, chain, OAuth, storage, or HK credentials into Next's
build process. Build flags keep HK routes and QA controls off while enabling
the Sumsub sandbox UI. Runtime Sumsub secrets and Redis settings remain Vercel
Preview environment values; the build never copies them into artifacts.

The runtime guard now requires a future `SUMSUB_PREVIEW_EXPIRES_AT` on
Vercel Preview, no later than `2026-09-30T14:59:59.000Z`. Sandbox, origin,
access-code, Redis, and non-production checks remain in force. Local fixtures
do not require a Vercel expiry. Secrets are scoped only to this new branch.

The integration branch disables automatic deployment for this branch while
its settings are registered. Only the dedicated deployment worktree replaces
its own `vercel.json` with this profile, then enables that branch. Existing
CX and public branch configuration is not replaced.

Actual protected deployment and provider/Redis smoke results, the applicant
response correction, and the remaining webhook-admin permission are recorded in
[the live Preview report](./SUMSUB_LIVE_PREVIEW_2026-09-28.md).
