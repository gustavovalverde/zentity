---
status: "accepted"
date: "2026-01-04"
builds-on: "[ADR](0003-passkey-sealed-profile.md)"
category: "business"
domains: [privacy, product]
---

# Consent-based disclosure with client-side re-encryption

## Context and Problem Statement

Relying parties (banks, exchanges) require verifiable identity disclosures, but Zentity must not handle plaintext PII. Disclosure must be explicit and user-authorized while still enabling audits and compliance checks.

## Priorities & Constraints

* Explicit user consent for any PII disclosure
* Zentity servers never handle plaintext profile data
* Provide auditable disclosure artifacts

## Decision Outcome

Chosen option: disclosure is consented by the user, and the client decrypts the passkey-sealed profile locally and re-encrypts it to the relying party.

The server returns an evidence bundle (proofs, hashes, signed claims), while plaintext PII is only revealed client-to-RP.

### Expected Consequences

* Clear privacy boundary: Zentity never sees plaintext PII.
* User intent is explicit and auditable.
* RP integrations require support for encrypted disclosure bundles.

## Alternatives Considered

* Server-side decryption and disclosure (violates privacy model).
* No disclosure support (limits product utility for regulated RPs).

## More Information

* Architecture: [docs/architecture.md](../../architecture.md) (Consent-Based Disclosure)
* Privacy architecture: [docs/attestation-privacy-architecture.md](../../attestation-privacy-architecture.md)
