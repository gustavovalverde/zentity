# Task 34: Documentation — FROST Recovery & Custodial Guardian

> Source PRD: [prd-production-launch.md](../prd-production-launch.md) — Module 4
> Source plan: [documentation-sync-ciba-branch.md](../documentation-sync-ciba-branch.md) — Task 21
> Status: Complete
> Priority: P2
> User Stories: 17

## What to build

Document the FROST threshold recovery system including the custodial guardian type.

**Documents to update:**

- `CLAUDE.md` (root) — recovery section
- `docs/architecture.md` — signer service in data flow
- `docs/recovery-trust-model.md` — custodial guardian trust analysis
- `docs/fhe-key-lifecycle.md` — FROST DEK unwrap path
- `apps/web/README.md` — recovery flow
- `apps/signer/README.md` — HPKE crypto, coordinator/signer roles
- `docs/railway-signer-deployment.md` — custodial signer deployment
- `docs/tamper-model.md` — recovery as integrity boundary

**Key content:**

- `deriveFrostUnwrapKey()` — HKDF-SHA256 from FROST signature
- `wrapDekWithFrostKey()`/`unwrapDekWithFrostKey()` — crypto-gated DEK release
- ML-KEM TOFU key pinning (`recoveryKeyPins` table)
- Guardian JWT binding (`signGuardianAssertionJwt()`)
- Custodial guardian type — email-triggered, max-1, not-sole constraints
- `CUSTODIAL_SIGNER_URL`, `CUSTODIAL_SIGNER_ID` env vars

## Acceptance criteria

- [x] FROST DEK unwrap flow documented end-to-end
- [x] ML-KEM TOFU pinning documented
- [x] Custodial guardian trust model and constraints documented
- [x] Railway deployment config for custodial signer documented
