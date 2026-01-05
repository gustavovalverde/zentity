---
status: "accepted"
date: "2026-01-05"
builds-on: "[ADR](0001-client-side-zk-proving.md)"
category: "technical"
domains: [zk]
---

# Use UltraHonkVerifierBackend for server-side verification

## Context and Problem Statement

Server verification previously relied on `UltraHonkBackend`, which computes a verification key during each verification. We already cache verification keys, so repeating VK computation adds avoidable overhead and latency.

## Priorities & Constraints

* Reduce verification latency
* Reuse cached verification keys
* Maintain separation between proving and verification responsibilities

## Decision Outcome

Chosen option: use `UltraHonkVerifierBackend` for server verification and pass cached VK bytes explicitly.

### Expected Consequences

* Lower per-verification overhead and more predictable performance.
* Clearer responsibility split between proving and verification paths.
* Requires a stable VK cache and explicit VK management in the verifier worker.

## Alternatives Considered

* Keep `UltraHonkBackend` for verification (simpler but slower).
* Move verification to an external service (higher operational complexity).

## More Information

* VK caching already exists; this decision aligns verification with that cache.
