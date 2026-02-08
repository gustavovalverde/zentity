---
status: "accepted"
date: "2026-01-04"
builds-on: "[ADR](0001-passkey-first-auth-prf-custody.md)"
category: "business"
domains: [privacy]
---

# Credential-sealed profile for PII (zero server decryption)

## Context and Problem Statement

We need a single, privacy-preserving way to store user PII without allowing the server to decrypt it. Prior approaches scattered PII across multiple tables and encryption mechanisms, which increased risk and contradicted the trust model that the server should not see plaintext.

## Priorities & Constraints

* No server-decryptable PII at rest
* Single, consistent encryption mechanism for profile data
* Keep email available for auth and recovery when provided; Recovery ID is the fallback for email-less accounts
* Support all credential types: passkey (PRF), password (OPAQUE), and wallet (EIP-712)

## Decision Outcome

Chosen option: move all profile PII into a credential-sealed secret (`PROFILE`) stored in `encrypted_secrets` with per-credential wrappers.

The server stores only encrypted blobs and metadata; plaintext profile values are decrypted only in the browser after explicit user action. The user's credential type (passkey, password, or wallet) determines the key derivation method, but the envelope format and storage model are identical across all three.

### Expected Consequences

* Strong privacy boundary: server cannot recover plaintext profile data.
* Unified secret storage and simpler data governance.
* Requires credential unlock (passkey prompt, password entry, or wallet signature) to access profile data.

## Alternatives Considered

* Store PII server-side with traditional encryption (breaks privacy boundary).
* Keep PII in multiple encrypted locations (higher operational risk).
* Only client storage (breaks multi-device support).

## More Information

* RFC: [docs/rfcs/0009-passkey-profile-pii.md](../../rfcs/0009-passkey-profile-pii.md)
* Architecture: [docs/architecture.md](../../architecture.md) and [docs/attestation-privacy-architecture.md](../../attestation-privacy-architecture.md)
