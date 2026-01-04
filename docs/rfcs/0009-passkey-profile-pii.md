# RFC-0009: Passkey-Sealed Profile + Zero Server-Decryption PII

| Field | Value |
|-------|-------|
| **Status** | Proposed |
| **Created** | 2026-01-04 |
| **Updated** | 2026-01-04 |
| **Author** | Gustavo Valverde |

## Summary

Move all user profile PII (first name, OCR-derived attributes, document metadata) into a **passkey-sealed secret** stored in `encrypted_secrets`, and remove any server-decryptable PII from the database. Keep **email only** in the auth DB for login, recovery, and magic link flows. Signed claims should retain **hashes only**, not raw values.

This consolidates PII encryption to a single method (passkey vault) and aligns storage with the trust model: **server is trusted for integrity but not for plaintext access**.

## Problem Statement

The current implementation stores and/or can decrypt PII in multiple places:

- `users.name`, `onboarding_sessions.encrypted_pii`, `identity_verification_drafts.birthYear`, `signed_claims.claimPayload`, and `identity_documents.firstNameEncrypted` + `userSalt`.
- These fields enable the server to recover user PII, which contradicts our privacy model and increases breach risk.
- Encryption methods are fragmented (JWE for wizard PII, passkey vault for FHE keys), increasing cognitive load and maintenance risk.

We need a simple, privacy-preserving architecture that still supports UX (first name display), recovery, and proof generation.

## Goals

- **Eliminate server-decryptable PII at rest**.
- **Consolidate PII encryption** to the passkey vault.
- Keep **email** in auth DB (required for recovery + magic link).
- Preserve **resume after refresh** for onboarding.
- Preserve **proof generation** using client-only private inputs, bound to server-signed claim hashes.

## Non-goals

- Backward compatibility with existing PII-at-rest schema.
- Multi-device encrypted profile sharing beyond passkey mechanisms.
- Changes to Better Auth internals.

## Design Decisions

1. **Single PII storage method**
   - Use passkey vault (`encrypted_secrets` + `secret_wrappers`) for all user profile PII.
   - Remove JWE-encrypted PII storage (`onboarding_sessions.encrypted_pii`).

2. **Email remains in auth DB**
   - Keep `users.email` and `verification.identifier/value` for auth flows.
   - Remove dependence on `users.name` for UX.

3. **Signed claims contain hashes only**
   - `signed_claims.claimPayload` contains claim hashes + metadata only (no raw birth year, expiry date, nationality).
   - Proofs are bound to claim hashes.

4. **Server decrypts nothing**
   - `firstNameEncrypted` and `userSalt` are no longer stored server-side.
   - Any salt or name inputs required for proofs are provided by the client at proof time.

5. **Resume after refresh**
   - Store resume-critical profile data in passkey vault as `profile_v1`.
   - If passkey creation is later in the flow, cache OCR-derived data **client-side only** until passkey exists, then migrate to vault.

## Architecture Overview

### New Data Model

```text
encrypted_secrets
  - secret_type: profile_v1
  - encrypted_blob: passkey-encrypted JSON
  - wrappers: per-passkey PRF envelope

profile_v1 payload
  {
    firstName?: string
    lastName?: string
    birthYear?: number
    expiryDate?: number
    nationalityCode?: string
    documentNumber?: string
    documentHash?: string
  }
```

### PII Boundaries

| Data | Where Stored | Who Can Decrypt |
|------|--------------|-----------------|
| Email | auth DB | Server + Auth |
| First name | passkey vault | User only |
| OCR raw fields | passkey vault / client cache | User only |
| Claim hashes | DB | Server (hashes only) |
| FHE ciphertext | DB | Server can compute, cannot decrypt |

## Flow Changes

### Onboarding

1. OCR processes document → returns extracted fields + commitments.
2. Client stores extracted fields in local state.
3. After passkey registration, client encrypts profile and saves to passkey vault (`profile_v1`).
4. Server stores only commitments + verification flags.

### Proof Generation

- Client uses raw values (from passkey vault) + server-signed claim hashes.
- Server verifies proofs against claim hashes.

### Dashboard UX

- On load, prompt passkey unlock to decrypt profile.
- If not unlocked, show fallback label and prompt.

## Schema Changes

- Remove `onboarding_sessions.encrypted_pii` and `onboarding_sessions.email`.
- Remove `identity_verification_drafts.birthYear`, `expiryDateInt`, `nationalityCode`, `nationalityCodeNumeric`, `countryCodeNumeric`, `firstNameEncrypted`, `userSalt`.
- Remove `identity_documents.firstNameEncrypted` and `identity_documents.userSalt`.
- Update `signed_claims.claimPayload` to only store hashes + metadata.
- Add `profile_v1` usage in `encrypted_secrets` (no schema change required).

## Migration Strategy (Breaking)

- Delete existing DB or run `drizzle-kit push` against a fresh DB.
- No backward compatibility.
- Update docs to remove references to encrypted onboarding PII storage.

## Risks

- Passkey required to show first name; UX needs a fallback prompt.
- If passkey creation happens late, OCR data must be cached client-side to support resume.
- Some existing flows that rely on server-decrypted `userSalt` (disclosure) must be updated.

## Testing Plan

- Unit tests for profile secret encryption/decryption.
- E2E onboarding flow verifies:
  - Profile decrypted after passkey creation.
  - Claims stored without raw PII.
  - Dashboard shows first name after unlock.

## Open Questions

- Should passkey registration move earlier to avoid client-only cache? (Recommended)
- Do we allow profile data to be optional for minimal-privacy mode?
- Should we add a UX setting to “Remember passkey for this session”?
