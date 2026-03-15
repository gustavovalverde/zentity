# Task 11: Identity Revocation Engine

> Source: `prd-identity-hardening.md` Modules 3, 4, 5
> Priority: **P2** — no mechanism to revoke compromised/fraudulent identities; required for incident response
> Estimate: ~3 days

## Architectural decisions

- **Cascade flow**: verification → bundle → OID4VCI credentials → on-chain attestation (steps 1-3 in a single DB transaction; step 4 async with retry)
- **Schema**: `revokedAt` (text, ISO datetime), `revokedBy` (text), `revokedReason` (text) on `identity_verifications` and `identity_bundles`; status enum expands to `["pending", "verified", "failed", "revoked"]`
- **API surface**: Admin `identity.revokeVerification({ userId, reason })` + user self-service `identity.selfRevoke({ reason })`
- **Query filters**: All identity queries filter `status != "revoked"` by default; `includeRevoked` option for admin/audit
- **Re-verification**: Revoked dedup key (from Task 07) allows re-verification; active dedup key on different user blocks as Sybil

---

## What to build

Add cascading soft-revocation that flows through the full identity stack. Both admin (compliance) and user (GDPR self-service) can trigger revocation.

End-to-end: schema changes (`revoked` status, metadata columns) → cascade function → admin tRPC procedure → user self-revoke tRPC procedure → on-chain `isBlacklisted` sync with exponential backoff retry → OID4VCI status-list bit write → `revocation_pending` reconciliation → query filters on all identity reads → re-verification after revocation → tests.

### Acceptance criteria

- [x] Revoking a verification cascades to bundle, OID4VCI credentials, and on-chain attestations
- [x] Steps 1-3 (DB operations) execute in a single transaction
- [x] On-chain revocation (step 4) is async with retry and exponential backoff
- [ ] `revocation_pending` records reconciled on retry
- [x] Revoked records filtered from standard queries by default
- [ ] `includeRevoked` option enables admin/audit queries to see revoked records
- [ ] Admin can revoke with reason (role-checked)
- [ ] User can self-revoke (rate-limited, requires active session)
- [x] Re-verification allowed after revocation (dedup check distinguishes revoked from active)
- [x] OID4VCI status-list bit set on credential revocation
- [x] `revokedAt`, `revokedBy`, `revokedReason` metadata persisted for audit trail
- [x] Integration test: full revocation cascade
- [x] Integration test: revoked records filtered from queries
- [x] Integration test: re-verification after revocation
