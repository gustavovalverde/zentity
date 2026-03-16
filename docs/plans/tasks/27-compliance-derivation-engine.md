# Task 27: Compliance Derivation Engine

> Source PRD: [prd-production-launch.md](../prd-production-launch.md) — Module 2
> Status: Complete
> Priority: P0
> User Stories: 6, 7, 8, 9

## Architectural decisions

- **Pure function**: `deriveComplianceStatus()` is a pure function with no DB access. It receives structured data (proofs, claims, attributes, flags) and returns a complete compliance result. This is the sole source of truth for compliance.
- **`birthYearOffset` is an input, not derived**: The ZK age circuit only proves `is_old_enough` (boolean). `birthYearOffset` continues to come from OCR/NFC document processing and is passed into the derivation function as an input parameter for validation.
- **Boolean payloads ignored**: The chip verification signed claim stores `ageVerified`, `faceMatchPassed`, `sanctionsCleared` as boolean fields. The derivation engine never reads these — it derives compliance checks from ZK proof existence and signed claim type presence.
- **Breaking change**: `getChipVerificationClaim()` is deleted. Any caller that needs chip verification status uses `deriveComplianceStatus()` instead.
- **`getVerificationStatus()` becomes a thin wrapper**: It queries the DB for proofs, claims, and encrypted attributes, then delegates to `deriveComplianceStatus()`. The 140-line inline derivation logic is replaced.

---

## What to build

Extract a standalone compliance derivation engine that centralizes all compliance logic into a testable pure function, then wire it into the existing verification status and attestation paths.

**The derivation function accepts:**

- `verificationMethod`: `"ocr" | "nfc_chip"`
- `birthYearOffset`: `number | null` (from verification record)
- `zkProofs`: array of `{ proofType, verified }` (which ZK proofs exist and are verified)
- `signedClaims`: array of `{ claimType }` (which signed claims exist)
- `encryptedAttributes`: array of `{ attributeType }` (which FHE attributes exist)
- `hasUniqueIdentifier`: boolean (NFC nullifier present)
- `hasNationalityCommitment`: boolean

**It returns:**

- `level`: `"none" | "basic" | "full" | "chip"`
- `numericLevel`: 0–4
- `birthYearOffset`: validated pass-through (null if invalid/missing)
- `checks`: object with 7 boolean derivations (documentVerified, livenessVerified, faceMatchVerified, ageVerified, nationalityVerified, identityBound, sybilResistant)

**Integration points:**

- `getVerificationStatus()` in identity queries → delegates to `deriveComplianceStatus()`
- `attestation.ts` submit mutation → calls `deriveComplianceStatus()` for `complianceLevel` and `birthYearOffset` instead of reading `verification.birthYearOffset` directly
- Delete `getChipVerificationClaim()` — its callers use the derivation engine
- Delete `ChipVerificationClaim` and `ChipVerificationClaimData` interfaces if no longer needed after removing `getChipVerificationClaim()`
- The existing `getComplianceLevel()` and `countryCodeToNumeric()` utilities in `compliance.ts` are absorbed into or called by the derivation engine

---

## Acceptance criteria

- [ ] `deriveComplianceStatus()` is a pure function with no imports from DB, tRPC, or env modules
- [ ] OCR path: 0 verified proofs → `none`; 4+ checks pass → `basic`; all 7 → `full`
- [ ] NFC path: chip proofs + uniqueIdentifier → `chip` (level 4)
- [ ] `birthYearOffset` is validated (0–255, integer) and passed through; invalid → `null`
- [ ] `checks` object derives each boolean from proof/claim existence, not from stored boolean fields
- [ ] `getChipVerificationClaim()` is deleted
- [ ] `getVerificationStatus()` delegates to `deriveComplianceStatus()` — no inline compliance logic remains
- [ ] `attestation.ts` uses the derivation engine for both `complianceLevel` and `birthYearOffset`
- [ ] Unit tests: cover all level transitions (none → basic → full → chip) for both OCR and NFC paths
- [ ] Unit tests: edge cases — empty proofs array, mixed verification methods, null birthYearOffset, out-of-range birthYearOffset
- [ ] Integration test: `getVerificationStatus()` returns consistent results via the derivation engine
- [ ] All existing attestation tests pass (or are updated to reflect the new derivation path)
