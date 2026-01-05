---
status: "accepted"
date: "2026-01-04"
builds-on: "[ADR](0003-passkey-sealed-profile.md)"
category: "business"
domains: [privacy, audit]
---

# Hash-only signed claims and audit hashes (no raw PII in claims)

## Context and Problem Statement

The server needs tamper-resistant measurements (OCR, liveness, face match) without storing raw PII in signed claims. We also need durable audit artifacts that prove which policy and proofs were used without disclosing private inputs.

## Priorities & Constraints

* Signed claims must not contain raw PII
* Auditors and RPs need verifiable evidence
* Proofs must bind to immutable claim hashes

## Decision Outcome

Chosen option: store only hashes and metadata in signed claims, and include audit hashes in evidence packs.

Signed claims contain claim hashes (not raw values). Proofs bind to those hashes, and disclosure bundles include `policy_hash` and `proof_set_hash` for auditability.

### Expected Consequences

* Reduces PII exposure in persistent storage.
* Enables independent verification and audit without revealing private inputs.
* Requires deterministic claim hashing and consistent proof binding.

## Alternatives Considered

* Store raw PII in signed claims (higher breach risk).
* Skip evidence hashes (weaker audit trail).

## More Information

* RFC: [docs/rfcs/0009-passkey-profile-pii.md](../../rfcs/0009-passkey-profile-pii.md)
* Privacy architecture: [docs/attestation-privacy-architecture.md](../../attestation-privacy-architecture.md)
