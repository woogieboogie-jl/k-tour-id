# CX-derived full-age 19 check

## Official contract, without inventing AdultVerify semantics

The supplied RaonSecure **OmniOne CX VC-Verifier v1.0 API manual, 2025-07-09** documents:

- Sections 2.3.1/2.3.2: optional `extraParams.zkpType`; `AdultVerify` means an adult-status request. It does not specify the precise threshold, birthday/year convention or timezone, and it does not document a `minAge` request parameter.
- Section 2.4: parse the completed result token through `/oacx/api/v1.0/trans/token`.
- Section 4.2 (driving licence), 4.4 (resident identity document), and token-parsing example: canonical `birth` string in YYYYMMDD form, separately from `ci`. Fields may depend on the service's approved disclosure configuration.
- CI is a stable subject handle, **not** a DOB encoding. No CI/DOB derivation is attempted. No foreign passport/JPKI support is inferred.

The local DOCX was read without modification. The organizer-hosted [official PDF manual](https://opendid.org/hackathon/2025/2025_%EB%B8%94%EB%A1%9D%EC%B2%B4%EC%9D%B8_AI_%ED%95%B4%EC%BB%A4%ED%86%A4_OmniOne_CX-VC-Verifier_v1.0_API_%EB%A7%A4%EB%89%B4%EC%96%BC.pdf) is also indexed with the same optional AdultVerify/GenderVerify request table. Official public marketing does not establish a versioned exact 19 predicate contract. No such unsupported guarantee is used.

## Implemented policy

`cx-birth-full19-kst-mar1/v1` is an explicit **product policy**, not a legal-age or ZKP claim:

1. The JIT action declares exact purpose `age19`; KO/EN/JA consent explains transient server processing of the provider-verified birth date.
2. Only this purpose uses ordinary CX submission, omitting the optional ZKP selector; it does not presume that AdultVerify discloses a DOB.
3. Completion requires the real verified result envelope, exact request transaction/correlation, a new completion token parsed by CX, and a stable same-session subject. The server calculates full age from canonical `birth` using the Korea date. Leap-day births advance on March 1 in non-leap years. Calendar overflow, future/invalid dates, missing fields and conflicting aliases fail closed.
4. The server retains only `age19Verified`, the exact policy version and existing evidence provenance/time. Raw birth is never returned, stored, hashed into a public identifier or logged. Person-only requests do not additionally calculate age.
5. Current same-session positive age evidence can be reused only after new purpose/context consent. Expired/cancelled/rebound/mode-changed evidence cannot authorize an action. Generic person/adult booleans and legacy age flags cannot become age19. Payment KYC is still separate and unsupported here.
6. After19 and the age-limited Table consume an exact server action authorization at their final boundary. Table completion is still an app-owned local participation request, not a merchant booking or alcohol-service authorization.
7. The newly opted-in public identity lane has a separate **identity-only, bounded** pool: at most 512 retained public identity operations, 20 per session; request-history caps are 512 total and 32 per session. Atomic rate counters additionally limit new starts to 5 per client/hour and 100 globally/hour, and request/session creation to 20 per client/hour and 300 globally/hour. These rows cannot contain credentials, proposals, delegations, execution or chain state. Legacy identity rows retain their original allocation. Real execution still uses the unchanged lifetime ceiling of 10 operations, 0.3 SUI and the approved 2026-09-30 23:59:59 KST deadline. Public identity availability does not extend that chain deadline or create signing authority. This is not a claim that all new public identity requests still share the old 10-slot pool. Reusing valid evidence creates no new provider request.

## Browser authority boundary

After19 no longer opens from a production self-declaration. Browser JSON/localStorage/sessionStorage cannot restore provider authority. A consumed server receipt creates a document-memory-only branded display state, including when a local account is active. The original grant must still be consumed within two minutes. Only the consumed `after19_access` display receipt remains readable until the earlier of current provider-evidence and policy expiry; this does not extend any unconsumed grant or Table authorization. Receipt reads recheck the same session, subject, policy and current source evidence. The UI rechecks its server receipt on initial use, tab visibility and every 30 seconds; failed/expired/cancelled evidence closes the display. Real protected Table writes independently consume their own exact action receipt; night-mode state cannot substitute for it.

## Verification scope

- Focused policy/adapter/JIT/client/memory tests: 67/67 passed; no external requests. These include consumed After19 receipt reads beyond two minutes, expired unconsumed grants, wrong sessions, changed subjects/policies, cancelled sources and expired evidence.
- Japanese After19 Playwright browser fixtures: 8/8 passed across mobile and desktop (successful consent, lost consume response reconciled by GET only, missing DOB/age proof rejected, cancellation wins over late completion, persisted declaration ignored, revoked server receipt closes display, search stays usable). Both viewport screenshots inspected.
- Additional Pass / Local moment / rejected age-limited Table / exact age-receipt Table browser fixtures: 8/8 passed across the same two viewports; total focused browser checks 16/16. Table completion remains a local participation request, not a merchant confirmation.
- Full TypeScript check passed after the initial client union typing fix.
- These browser responses are synthetic fixtures, **not a real mobile-ID holder verification**. A supported holder still must explicitly complete the real provider handoff; absence of `birth` under the approved disclosure contract remains a visible denial, never a guessed success.
