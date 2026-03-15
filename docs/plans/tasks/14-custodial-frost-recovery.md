# Task 14: Custodial FROST Recovery

> Source: `prd-identity-hardening.md` Module 6
> Priority: **P2** — no self-service recovery fallback if guardians are unreachable
> Estimate: ~2 days
> Dependencies: Task 09 (recovery key authentication should land first)

## Architectural decisions

- **Guardian type**: `custodialEmail` — participates in DKG and signing like any other FROST signer, approval mechanism is email verification
- **Architecture**: Dedicated signer instance (same `apps/signer` binary), web app orchestrates identically to human guardians
- **Constraints**: Max one custodial slot per user, cannot be the only guardian (Zentity alone must never unilaterally recover), 15-minute approval TTL, max 3 attempts per 24 hours
- **Env vars**: `CUSTODIAL_SIGNER_URL`, `CUSTODIAL_SIGNER_ID` (optional, recovery feature)

---

## What to build

Add a Zentity-operated FROST signer instance that releases its share upon email verification. This acts as a self-service recovery guardian — always available, requires no coordination with other humans, uses a familiar flow (click a link in your email).

End-to-end: `custodialEmail` guardian type in schema → `addGuardianEmail` gets `custodial: true` flag → DKG includes custodial signer → recovery challenge sends email to user's own email → email verification triggers signer's `sign_commit`/`sign_partial` → threshold enforcement (custodial + human meets threshold) → constraints (max 1, not sole guardian) → rate limiting → tests.

### Acceptance criteria

- [x] `custodialEmail` guardian type added to `recovery_guardians.guardianType` enum
- [x] DKG includes custodial signer as a standard participant (uses same participantIndex pattern)
- [ ] Recovery challenge with custodial guardian sends approval email to user's registered email
- [ ] Email verification triggers custodial signer's commit/partial endpoints
- [x] Threshold enforcement: custodial + human guardian meets threshold (same DKG/signing flow)
- [x] Cannot add more than one custodial guardian per user
- [x] Custodial guardian cannot be the only guardian in the policy
- [ ] Email verification link has 15-minute TTL
- [ ] Max 3 custodial recovery attempts per 24 hours per user
- [x] User can remove custodial signer and replace with human guardian (existing removeGuardian works)
- [ ] Integration test: full recovery flow with custodial signer
- [ ] Integration test: constraint enforcement (max 1, not sole)
