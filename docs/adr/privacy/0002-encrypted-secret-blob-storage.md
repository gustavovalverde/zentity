---
status: "accepted"
date: "2026-01-03"
builds-on: "[ADR](0001-passkey-first-auth-prf-custody.md)"
category: "technical"
domains: [privacy, storage]
---

# Encrypted secret blob storage for large payloads

## Context and Problem Statement

FHE key bundles and profile secrets can grow large, stressing row size limits and increasing database load. We needed a privacy-preserving way to store large encrypted payloads without degrading DB performance.

## Priorities & Constraints

* Keep encrypted payloads server-side only (no plaintext)
* Avoid large DB rows and reduce query overhead
* Maintain atomicity between metadata and blob references

## Decision Outcome

Chosen option: store large encrypted payloads as blobs referenced from the primary secret record.

The DB keeps metadata and references, while the encrypted blob lives in a dedicated storage path.

### Expected Consequences

* Better performance for large encrypted payloads.
* Slightly more complexity in storage and retrieval paths.
* Requires careful lifecycle management of blob references.

## Alternatives Considered

* Store full encrypted blobs directly in the DB (scaling concerns).
* External secret manager (loss of control and integration complexity).

## More Information

* Commit: `ed60445` (secret blob storage)
