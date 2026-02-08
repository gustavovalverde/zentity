# RFC-0009: Credential-Sealed Profile + Zero Server-Decryption PII

| Field | Value |
|-------|-------|
| **Status** | Accepted |
| **Created** | 2026-01-04 |
| **Updated** | 2026-02-08 |
| **Author** | Gustavo Valverde |

## Summary

Move all user profile PII (first name, OCR-derived attributes, document metadata) into a **credential-sealed secret** stored in `encrypted_secrets` with per-credential wrappers, and remove any server-decryptable PII from the database. Keep **email (when provided)** in the auth DB for login, recovery, and magic link flows, and allow Recovery ID-based recovery for email-less accounts. Signed claims should retain **hashes only**, not raw values.

This consolidates PII encryption to a single method (credential vault) and aligns storage with the trust model: **server is trusted for integrity but not for plaintext access**. The user's credential type (passkey PRF, OPAQUE export key, or wallet EIP-712 signature) determines the key derivation method, but the envelope format and storage model are identical across all three.

## Problem Statement

The current implementation stores and/or can decrypt PII in multiple places:

- `users.name`, `sign_up_sessions.encrypted_pii`, `identity_verification_drafts.birthYear`, `signed_claims.claimPayload`, and `identity_documents.firstNameEncrypted` + `userSalt`.
- These fields enable the server to recover user PII, which contradicts our privacy model and increases breach risk.
- Encryption methods are fragmented (JWE for wizard PII, credential vault for FHE keys), increasing cognitive load and maintenance risk.

We need a simple, privacy-preserving architecture that still supports UX (first name display), recovery, and proof generation — across all supported credential types.

## Goals

- **Eliminate server-decryptable PII at rest**.
- **Consolidate PII encryption** to the credential vault (`encrypted_secrets` + `secret_wrappers`).
- **Support all credential types**: passkey (PRF), password (OPAQUE), and wallet (EIP-712).
- Keep **email** in auth DB when provided (used for recovery + magic link), with Recovery ID as the email-less fallback.
- Preserve **proof generation** using client-only private inputs, bound to server-signed claim hashes.

## Non-goals

- Backward compatibility with existing PII-at-rest schema.
- Changes to Better Auth internals.

## Design Decisions

1. **Single PII storage method**
   - Use credential vault (`encrypted_secrets` + `secret_wrappers`) for all user profile PII.
   - Remove JWE-encrypted PII storage (`sign_up_sessions.encrypted_pii`).
   - The same envelope format and storage model applies regardless of credential type.

2. **Email remains in auth DB**
   - Keep `users.email` and `verification.identifier/value` for auth flows.
   - Remove dependence on `users.name` for UX.

3. **Signed claims contain hashes only**
   - `signed_claims.claimPayload` contains claim hashes + metadata only (no raw birth year, expiry date, nationality).
   - Proofs are bound to claim hashes.

4. **Server decrypts nothing**
   - `firstNameEncrypted` and `userSalt` are no longer stored server-side.
   - Any salt or name inputs required for proofs are provided by the client at proof time.

5. **Profile secret created during verification**
   - After liveness/face match and before ZK proof generation, extracted PII is encrypted with the user's cached credential material and stored as a `PROFILE` secret.
   - The credential material is cached from FHE enrollment (which precedes verification).
   - Storage is fire-and-forget — failure does not block proof generation.

## Architecture Overview

### Data Model

```text
encrypted_secrets
  - secret_type: PROFILE
  - encrypted_blob: credential-encrypted JSON
  - wrappers: per-credential envelope (passkey PRF / OPAQUE / wallet)

PROFILE payload
  {
    fullName?, firstName?, lastName?,
    dateOfBirth?, birthYear?,
    residentialAddress?, addressCountryCode?,
    expiryDateInt?, documentNumber?, documentType?, documentOrigin?,
    nationality?, nationalityCode?,
    documentHash?, userSalt?,
    updatedAt
  }
```

### PII Boundaries

| Data | Where Stored | Who Can Decrypt |
|------|--------------|-----------------|
| Email | auth DB | Server + Auth |
| Profile PII | credential vault | User only (via credential unlock) |
| Claim hashes | DB | Server (hashes only) |
| FHE ciphertext | DB | Server can compute, cannot decrypt |

## Flow Changes

### Verification (Profile Secret Creation)

1. OCR processes document → returns extracted fields + commitments.
2. Client stores extracted fields in local state.
3. During liveness verification, after face match and before ZK proof generation, the client encrypts the profile with the cached credential material and stores it as a `PROFILE` secret.
4. Server stores only commitments + verification flags.

### Credential Unlock

The profile secret requires an explicit credential unlock to access:

- **Passkey** — WebAuthn prompt (automatic browser dialog)
- **Password (OPAQUE)** — User re-enters their password
- **Wallet (EIP-712)** — Deterministic signature (signed twice, compared)

### Proof Generation

- Client uses raw values (from credential vault) + server-signed claim hashes.
- Server verifies proofs against claim hashes.

### Dashboard UX

- On load, prompt credential unlock to decrypt profile.
- If not unlocked, show fallback label and prompt.

### OAuth Consent (Identity Scopes)

When a relying party requests `identity.*` scopes, the consent page must unlock the profile secret to map PII fields to OIDC claims. The unlock UI adapts to the user's credential type (detected server-side from secret wrappers). See [OAuth Integrations](../oauth-integrations.md) for the full identity PII data flow.

## Schema Changes

- Remove `sign_up_sessions.encrypted_pii` and `sign_up_sessions.email`.
- Remove `identity_verification_drafts.birthYear`, `expiryDateInt`, `nationalityCode`, `nationalityCodeNumeric`, `countryCodeNumeric`, `firstNameEncrypted`, `userSalt`.
- Remove `identity_documents.firstNameEncrypted` and `identity_documents.userSalt`.
- Update `signed_claims.claimPayload` to only store hashes + metadata.
- Add `profile_v1` usage in `encrypted_secrets` (no schema change required).

## Migration Strategy (Breaking)

- Delete existing DB or run `drizzle-kit push` against a fresh DB.
- No backward compatibility.
- Update docs to remove references to encrypted sign-up PII storage.

## Risks

- Credential unlock required to show first name; UX needs a fallback prompt.
- Profile secret is created fire-and-forget during verification — if it fails, PII is lost and the user must re-verify.
- Some existing flows that rely on server-decrypted `userSalt` (disclosure) must be updated.

## Testing Plan

- Unit tests for profile secret encryption/decryption across all credential types.
- E2E verification flow verifies:
  - Profile secret created after liveness verification.
  - Claims stored without raw PII.
  - Dashboard shows first name after credential unlock.
- E2E OAuth consent flow verifies:
  - Vault unlock works for passkey, OPAQUE, and wallet users.
  - Identity scopes produce correct claims in userinfo.
