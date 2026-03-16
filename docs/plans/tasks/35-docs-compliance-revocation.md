# Task 35: Documentation — Compliance Derivation & Identity Revocation

> Source PRD: [prd-production-launch.md](../prd-production-launch.md) — Module 4
> Source plan: [documentation-sync-ciba-branch.md](../documentation-sync-ciba-branch.md) — Task 22
> Status: Complete
> Priority: P2
> User Stories: 17

## What to build

Document the compliance derivation model and identity revocation cascade.

**Documents to update:**

- `CLAUDE.md` (root) — verification flow, compliance section
- `docs/architecture.md` — compliance in data flow
- `docs/ssi-architecture.md` — compliance as SSI property
- `docs/attestation-privacy-architecture.md` — compliance levels, revocation columns
- `apps/web/README.md` — verification tiers

**Key content:**

- Compliance levels: `none` (0) → `basic` (1) → `full` (2) → `chip` (3) → (4 for NFC)
- Derivation from ZK proof existence + signed claim types (not mutable booleans)
- `deriveComplianceStatus()` pure function (after Task 27 implements it)
- `chip` level for NFC path with `uniqueIdentifier`
- Identity revocation cascade: `revokeIdentity()` → verification record → bundle → on-chain attestation
- `revokedAt`, `revokedBy`, `revokedReason` columns

## Acceptance criteria

- [x] Compliance level derivation logic documented (proof-based, not boolean-based)
- [x] All 4 levels with their check requirements documented
- [x] Revocation cascade documented end-to-end
- [x] Schema changes (revocation columns) documented in ER context
