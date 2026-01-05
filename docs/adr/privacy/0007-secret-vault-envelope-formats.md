---
status: "accepted"
date: "2026-01-05"
builds-on: "[ADR](0002-encrypted-secret-blob-storage.md)"
category: "technical"
domains: [privacy, storage]
---

# Secret vault with explicit envelope formats

## Context and Problem Statement

We store multiple encrypted secrets (FHE keys, profile data) and needed consistent, versioned serialization to avoid fragile ad-hoc parsing. Without explicit envelopes, secret evolution and migration become risky.

## Priorities & Constraints

* Consistent serialization for encrypted secrets
* Support future secret format migrations
* Keep client-side decryption simple

## Decision Outcome

Chosen option: introduce a secret vault with explicit envelope formats (e.g., msgpack) and a unified API for storing and loading secrets.

### Expected Consequences

* Reduced ambiguity in encrypted payload formats.
* Easier migration between secret versions.
* Slightly more overhead for envelope metadata.

## Alternatives Considered

* Ad-hoc JSON serialization per secret type (fragile and inconsistent).
* Versioning secrets without explicit envelopes (hard to validate at runtime).

## More Information

* Commit: `fbf26fe` (secret vault + envelope formats)
