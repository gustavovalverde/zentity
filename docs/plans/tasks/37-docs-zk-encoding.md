# Task 37: Documentation — ZK Encoding & Circuits

> Source PRD: [prd-production-launch.md](../prd-production-launch.md) — Module 4
> Source plan: [documentation-sync-ciba-branch.md](../documentation-sync-ciba-branch.md) — Task 24
> Status: Complete
> Priority: P2
> User Stories: 15

## What to build

Correct ZK encoding documentation and update circuit descriptions.

**Documents to update:**

- `docs/zk-nationality-proofs.md` — encoding correction
- `docs/zk-architecture.md` — circuit public inputs, encoding details

**Key content:**

- **Critical correction**: Nationality encoding is weighted-sum (e.g., `4474197` for "DEU"), NOT ISO numeric (e.g., `276`). The weighted-sum encoding uses positional byte values.
- Fix Merkle leaf values to match the weighted-sum encoding
- Document `base_commitment` vs `binding_commitment` as distinct public inputs in the identity binding circuit
- Update any examples or diagrams that show ISO numeric values

## Acceptance criteria

- [x] Nationality encoding corrected from ISO numeric to weighted-sum in all documents
- [x] Merkle leaf values updated
- [x] `base_commitment` vs `binding_commitment` distinction documented
- [x] No remaining references to ISO numeric encoding for nationality
