# Task 32: Documentation — Sybil Deduplication

> Source PRD: [prd-production-launch.md](../prd-production-launch.md) — Module 4
> Source plan: [documentation-sync-ciba-branch.md](../documentation-sync-ciba-branch.md) — Task 19
> Status: Complete
> Priority: P2
> User Stories: 15, 17

## What to build

Document the HMAC-based sybil deduplication system and per-RP nullifiers.

**Documents to update:**

- `CLAUDE.md` (root) — Key Data Flow section
- `docs/zk-architecture.md` — dedup key interaction with ZK proofs
- `docs/zk-nationality-proofs.md` — if dedup touches nationality
- `docs/ssi-architecture.md` — sybil resistance as SSI property
- `docs/oauth-integrations.md` — `sybil_nullifier` claim, `proof:sybil` scope
- `docs/tamper-model.md` — dedup as integrity control
- `docs/attestation-privacy-architecture.md` — `dedup_key` column, privacy implications

**Key content:**

- `computeDedupKey()` — HMAC-SHA256 with `DEDUP_HMAC_SECRET`, OCR vs NFC paths
- `computeRpNullifier()` — per-RP pairwise nullifier for `sybil_nullifier` claim
- `DEDUP_HMAC_SECRET` env var (required, min 32 chars)
- OCR path: HMAC of document fields; NFC path: `uniqueIdentifier` from ZKPassport
- Cross-method blocking (OCR ↔ NFC)

## Acceptance criteria

- [x] Both dedup paths (OCR HMAC, NFC uniqueIdentifier) documented
- [x] `sybil_nullifier` OAuth claim and `proof:sybil` scope documented
- [x] `DEDUP_HMAC_SECRET` env var documented
- [x] Tamper model updated with dedup as integrity control
