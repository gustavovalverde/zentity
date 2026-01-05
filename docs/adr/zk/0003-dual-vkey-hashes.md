---
status: "accepted"
date: "2026-01-05"
builds-on: "[ADR](0001-client-side-zk-proving.md)"
category: "technical"
domains: [zk, security]
---

# Dual vkey hashes for registry alignment and ops audit

## Context and Problem Statement

We need a stable identifier for circuit verification keys (vkeys) that works across registry/on-chain validation and internal operational monitoring. The registry flow expects a Poseidon2 field-based hash, while internal tooling already uses SHA-256 to derive circuit IDs and for quick byte-level comparisons.

## Priorities & Constraints

* Registry and on-chain compatibility
* Simple operational debugging and logging
* Low overhead for additional metadata

## Decision Outcome

Chosen option: compute and persist both Poseidon2 and SHA-256 vkey hashes.

We store `verificationKeyPoseidonHash` as the canonical registry-compatible identity and keep `verificationKeyHash` (SHA-256) for ops and auditability.

### Expected Consequences

* Slightly more compute at vkey derivation time and a small storage increase.
* Easier reconciliation with registry manifests and on-chain references.
* Maintains backwards compatibility with existing ops workflows and circuit IDs.

## Alternatives Considered

* Poseidon2 only (simpler storage but requires refactoring internal identifiers).
* SHA-256 only (breaks registry/on-chain alignment).
* Compute on demand (less storage, more runtime complexity).

## More Information

* Related changes: server verifier returns and persists both hashes.
