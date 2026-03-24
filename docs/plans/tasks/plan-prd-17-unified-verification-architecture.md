# Plan: Unified Verification Architecture

> Source PRD: `docs/plans/prd-17-unified-verification-architecture.md`

## Architectural decisions

Durable decisions that apply across all phases:

- **Schema**: `zk_proofs` renamed to `proof_artifacts` with `proofSystem` discriminator (`noir_ultrahonk` | `zkpassport`). Noir-specific columns (`noirVersion`, `circuitHash`, `circuitType`, `bbVersion`, `verificationKeyHash`, `verificationKeyPoseidonHash`) move to a JSON `metadata` column. `zk_proof_sessions` renamed to `proof_sessions`. New `verification_checks` table: one row per check per verification, 7 check types (`document`, `age`, `liveness`, `face_match`, `nationality`, `identity_binding`, `sybil_resistant`), unique on `(verificationId, checkType)`.
- **Source of truth**: `deriveComplianceStatus` remains the pure compliance engine. `verification_checks` is a materialized cache populated by calling the engine after each write. If compliance rules change, a batch re-materialization updates all users.
- **Read model**: `getUnifiedVerificationModel(userId)` is the single function all consumers call. Returns method, tier, 7 boolean checks with evidence sources, proof summaries, vault status, and FHE completeness.
- **Proof persistence**: NFC path stores full ZKPassport `ProofResult` bytes in `proof_artifacts`. Proof hashes computed as SHA-256 of payload. `proofSetHash` computed for `attestation_evidence`, enabling on-chain attestation for chip-verified users.
- **Consumer API**: Checks + proof summary (boolean checks plus evidence source per check, e.g., "age verified via passport chip"). No raw proof data exposed to consumers.
- **No backward compatibility shims**: No re-export aliases, no old table references. Clean break. No external consumers exist.

---

## Phase 1: Write Convergence

**User stories**: 4, 5, 6, 9, 10, 12, 13, 14

### What to build

All schema changes and both write path migrations in one phase. After this phase, both OCR and NFC verification produce rows in `proof_artifacts` and materialized `verification_checks`.

**Schema**: Create `proof_artifacts` table (replacing `zk_proofs`) with `proofSystem`, `proofType`, `proofPayload` (BLOB), `publicInputs` (JSON), `proofHash`, `verified`, `metadata` (JSON), `generationTimeMs`, `nonce`, `policyVersion`, `proofSessionId` (nullable, OCR only). Create `verification_checks` table with `userId`, `verificationId`, `checkType`, `passed`, `source`, `evidenceRef`, `metadata` (JSON). Rename `zk_proof_sessions` to `proof_sessions`.

**OCR write path**: `storeProofProcedure` writes to `proof_artifacts` with `proofSystem: 'noir_ultrahonk'`. Noir-specific fields (`noirVersion`, `circuitHash`, `circuitType`, `bbVersion`, `verificationKeyHash`, `verificationKeyPoseidonHash`) stored in `metadata` JSON. All existing ZK proof queries updated to read from `proof_artifacts`. After each proof storage, call `materializeVerificationChecks(userId, verificationId)`.

**NFC write path**: `submitResult` stores each ZKPassport `ProofResult` from the client's proofs array as a row in `proof_artifacts` with `proofSystem: 'zkpassport'`. `proofType` maps from ZKPassport circuit names. `proofHash` is SHA-256 of proof payload. `metadata` stores circuit manifest root, nullifier type, request ID. After writing proofs and the `chip_verification` signed claim, calls `materializeVerificationChecks(userId, verificationId)`. Computes `proofSetHash` from stored proof hashes and upserts `attestation_evidence`.

**Materialization engine**: `materializeVerificationChecks(userId, verificationId)` calls `getVerificationStatus(userId)` (which runs `deriveComplianceStatus`), maps the 7 boolean checks to `verification_checks` rows with appropriate `source` and `evidenceRef`, and upserts all 7 rows. For OCR: sources are `zk_proof` and `signed_claim` with IDs. For NFC: sources are `chip_claim`, `commitment`, and `nullifier`. Idempotent via unique constraint on `(verificationId, checkType)`.

### Acceptance criteria

- [x] `proof_artifacts` table exists with `proofSystem` discriminator and JSON `metadata` column
- [x] `verification_checks` table exists with unique constraint on `(verificationId, checkType)`
- [x] `proof_sessions` table exists (renamed from `zk_proof_sessions`)
- [x] OCR verification produces 5 rows in `proof_artifacts` with `proofSystem: 'noir_ultrahonk'` and Noir metadata in JSON
- [x] NFC chip verification produces rows in `proof_artifacts` with `proofSystem: 'zkpassport'` and full proof bytes
- [x] NFC chip verification produces an `attestation_evidence` row with `proofSetHash`
- [x] Both OCR and NFC verification produce 7 rows in `verification_checks` after completion
- [x] `verification_checks` rows have correct `source` and `evidenceRef` for each method
- [x] `materializeVerificationChecks` is idempotent (calling twice produces the same 7 rows)
- [x] Partial OCR state (3 of 5 proofs) produces `verification_checks` reflecting partial verification
- [x] All existing ZK proof tests pass against `proof_artifacts`
- [x] `pnpm typecheck` passes
- [x] `pnpm test` passes

---

## Phase 2: Read Convergence + Cleanup

**User stories**: 1, 2, 3, 7, 8, 11

### What to build

The unified read model, consumer migration, data backfill, and dead code removal. After this phase, every consumer queries through `getUnifiedVerificationModel` and no code references old table names or bypasses the unified abstraction.

**Unified read model**: `getUnifiedVerificationModel(userId)` queries `verification_checks` (7 checks with evidence refs), `proof_artifacts` (proof summaries: system, type, hash, verified), `identity_verifications` (method, timestamps, tier), `encrypted_secrets` (vault existence), `encrypted_attributes` (FHE completeness). Returns the typed model defined in the PRD. All queries parallelized.

**MCP `my_proofs` tool**: Rewritten to call a tRPC endpoint backed by the unified model. Returns checks (boolean + source) and proof summaries. NFC chip users see non-empty results.

**tRPC endpoints**: Old `zk.getUserProof` and `zk.getAllProofs` replaced with method-agnostic `verification.getChecks` and `verification.getProofs` (or equivalent). Read from unified model, not `proof_artifacts` directly.

**Assurance path**: `gatherVerificationData` in `assurance/data.ts` replaced by a call to `getUnifiedVerificationModel`. `computeAssuranceState` takes the unified model as input. The parallel read path with independent boolean flag computation is eliminated.

**OAuth claims**: `buildProofClaims` in `claims.ts` reads checks from the unified model. Output shape (OIDC claim booleans) does not change.

**Attestation**: `attestation.submit` reads `birthYearOffset` and `numericLevel` from the unified model. Now works for NFC users because `proofSetHash` exists (from Phase 1).

**Cleanup**: Remove all dead `zk_proofs` query functions (`getUserAgeProof`, `getAllVerifiedProofsFull`). Remove `gatherVerificationData` and its helper functions. Remove old OCR-only tRPC endpoints. Remove any remaining references to old table names.

### Acceptance criteria

- [x] `getUnifiedVerificationModel` returns correct checks, proofs, tier, vault status for OCR-verified users
- [x] `getUnifiedVerificationModel` returns correct checks, proofs, tier, vault status for NFC chip-verified users
- [x] `getUnifiedVerificationModel` returns tier 1 with all checks failed for unverified users
- [x] MCP `my_proofs` tool returns non-empty checks and proof summary for NFC chip-verified users
- [x] MCP `my_proofs` tool returns checks with evidence source ("ZK proof" vs "passport chip")
- [x] MCP `whoami` tool continues to return correct tier for both methods
- [x] `assurance.profile` returns identical tier whether verification was OCR or NFC
- [x] `attestation.submit` succeeds for NFC chip-verified users (proofSetHash present)
- [x] OAuth `buildProofClaims` output is unchanged for existing OCR-verified users
- [x] ~~Backfill~~ N/A — no existing users; new verifications materialize on write
- [x] No references to `zk_proofs` table name remain in the codebase (grep returns zero)
- [x] No references to `getUserAgeProof` or `getAllVerifiedProofsFull` remain
- [x] `gatherVerificationData` function is removed
- [x] `pnpm typecheck` passes
- [x] `pnpm test` passes
- [x] `pnpm build` passes
