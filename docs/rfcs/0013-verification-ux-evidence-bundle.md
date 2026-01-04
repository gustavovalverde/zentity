# RFC-0013: Verification Bundle + Revocation + Document Selection UX

| Field | Value |
|-------|-------|
| **Status** | Proposed |
| **Created** | 2026-01-04 |
| **Updated** | 2026-01-04 |
| **Author** | Gustavo Valverde |

## Summary

Consolidate all verification outputs into a **single Verification Bundle API**
for dashboard and RP disclosure, add explicit **revocation/expiration** states,
make **document selection** a first-class policy, surface **proof/policy hashes**
for auditability, and remove **legacy nameCommitment** from server storage to
align with RFC-0009. This RFC focuses on UX clarity and evidence integrity
without introducing new cryptography.

## Problem Statement

The current implementation is correct cryptographically but confusing for users
and integrators:

- Proof retrieval is **asymmetric** (age proof exposed, others not in general UI
  flows), even though all proofs are generated and stored.
- Document selection is **implicit** and not visible to users.
- There is **no explicit revocation/expiration flow**, so users cannot clearly
  understand the validity window of their verification.
- Proof/policy hashes are computed off-chain but **not surfaced in the UI**,
  reducing audit transparency.
- `nameCommitment` remains stored server-side, conflicting with RFC-0009’s
  “no server-decryptable PII” stance.

This causes UX ambiguity (pending states, mismatched indicators), makes it
hard to wire the dashboard cleanly, and weakens the audit story for banks and
exchanges.

## Goals

- Provide a **single source of truth** for verification status + artifacts.
- Make **document selection explicit** and user-visible.
- Add **revocation/expiration** states and UI actions.
- Surface **proofSetHash / policyHash / policyVersion / issuerId** in the UI and
  in disclosure responses for auditability.
- Remove `nameCommitment` from server storage to align with RFC-0009.
- Improve UX clarity without changing the cryptographic design.

## Non-goals

- Changing ZK circuits or cryptographic primitives.
- Building a full transparency log or witness network (RFC-0012 covers that).
- Backward compatibility with old DB contents (PoC allows breaking changes).
- Replacing FHE flows or Web3 attestation providers.

## Design Decisions

### 1) Verification Bundle API (single UI/data surface)

Introduce a **Verification Bundle** response used by both:

- dashboard (status + evidence)
- disclosure flow (evidence + proofs + claims)

**Bundle contents**:

- Selected document metadata (documentHash, type, issuerCountry, verifiedAt)
- Signed claims (ocr_result, liveness_score, face_match_score)
- ZK proofs (age, doc_validity, nationality_membership, face_match)
- Evidence metadata (policyVersion, policyHash, proofSetHash, issuerId)
- FHE encryption status (complete/pending/error)

This replaces piecemeal queries like age-only proof retrieval.

### 2) Document Selection Policy (explicit + configurable)

Add an explicit selection policy with the following precedence:

1) **User-selected document** (stored)
2) **Highest-trust verified document** (has all proofs + claims)
3) **Most recently verified document**
4) **Most recent document**

Selection decision must be returned in the bundle:

- `selectedDocumentId`
- `selectionReason` (user_selected | highest_trust | latest_verified | latest)

UI shows the selected document and allows user override.

### 3) Revocation + Expiration

Introduce explicit states and timestamps:

- identity bundle/document `status` includes `revoked` and `expired`
- `revokedAt`, `revocationReason`, `revokedBy`
- `attestation_expires_at` becomes active and enforced in status

Revocation behavior:

- Revoked/expired => verification status `false` and UI shows a banner
- Disclosure API returns evidence with `revokedAt`/`expiresAt`

### 4) Audit Hashes are First-Class in UI + Disclosure

The dashboard transparency section and disclosure package must show:

- `policyVersion`
- `policyHash`
- `proofSetHash`
- `issuerId`

This removes ambiguity about “what policy was proven.”

### 5) Remove nameCommitment from server storage

`nameCommitment` is removed from:

- `identity_documents`
- `identity_verification_drafts`

If needed for UX, it should live in the **passkey-sealed profile** and be
revealed locally only after a user decrypts.

### 6) Proof retrieval symmetry

Expose all proofs via the verification bundle or a `getUserProofs` endpoint
that supports:

- proof type filters
- document scope (selected vs explicit)

This fixes the “age-only” retrieval gap.

### 7) On-chain metadata attachment (best-effort)

If contracts allow, include proof/policy metadata on-chain:

- `proofSetHash`, `policyHash`, `issuerId`, `issuedAt`, `expiresAt`

If contracts do not allow it yet, these stay off-chain but are surfaced in
UI and disclosure.

## Architecture Overview

```text
UI -> getVerificationBundle
   -> selected document + signed claims + proofs + evidence
   -> status + revocation + expiry + FHE status

Disclosure -> uses same bundle -> adds consent receipt

Attestation -> uses selected doc -> (optionally) includes metadata on-chain
```

## Data Model Changes

### identity_bundles

- Add enum values: `revoked`, `expired`
- Add fields:
  - `revoked_at`, `revocation_reason`, `revoked_by`
  - `selected_document_id` (optional)

### identity_documents

- Add enum values: `revoked`, `expired`
- Add fields:
  - `revoked_at`, `revocation_reason`

### Remove fields

- `identity_documents.name_commitment`
- `identity_verification_drafts.name_commitment`

## API Changes

### New: `crypto.getVerificationBundle`

Returns:

- selected document metadata
- signed claims
- proofs
- evidence (policyVersion, policyHash, proofSetHash, issuerId)
- status (including revocation/expiry)
- FHE status

### Update: Disclosure

Disclosure endpoint should:

- reuse verification bundle
- include evidence hashes in response
- include revocation/expiry metadata

### Update: Verification Status

`getVerificationStatus` should consider:

- document status (revoked/expired)
- bundle status
- selected document policy

## UX Flows

### Dashboard

- “Verification Summary” powered by bundle
- “Active document” selector with reason badge
- “Revoke verification” action and state explanation
- Transparency panel shows policyHash/proofSetHash/issuerId

### Disclosure

- Package includes proofs + signed claims + audit hashes
- If revoked/expired, package marks invalid with reason

## Migration Strategy

PoC mode allows **breaking changes**:

- Drop DB and `drizzle-kit push`
- Remove legacy columns
- No backward compatibility required

## Risks

- Increased UI complexity (mitigated by bundle API)
- Revocation flows require careful UX wording
- On-chain metadata attachment may require contract changes

## Testing Plan

- Unit tests: verification bundle aggregation
- Integration tests: revocation => dashboard + disclosure change
- E2E: document selection and proof set rendering
- Regression: verify all 4 proof types appear in UI bundle

## Open Questions

- Do we require revocation to invalidate on-chain attestations, or only
  off-chain status?
- Should bundle include a signed server receipt for easier RP verification?
- Should document selection be forced before disclosure?
