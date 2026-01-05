---
status: "accepted"
date: "2026-01-05"
builds-on: "[ADR](0002-split-encryption-and-computation.md)"
category: "technical"
domains: [fhe, platform]
---

# Dedicated FHE service with binary transport

## Context and Problem Statement

FHE operations are compute-heavy and produce large key and ciphertext payloads. Running these operations inside the web service increases latency and complicates scaling. We need a dedicated service with a transport optimized for large binary payloads.

## Priorities & Constraints

* Isolate heavy computation from the web service
* Optimize network payloads for large keys/ciphertexts
* Maintain clear service boundaries and observability

## Decision Outcome

Chosen option: run a dedicated Rust/Axum FHE service (TFHE-rs) and communicate over MessagePack + gzip for binary payloads.

The web app registers public/server keys with the FHE service, stores ciphertexts in the database, and never receives plaintext keys.

### Expected Consequences

* Improved performance and latency for key upload/encryption flows.
* Clearer scaling boundary for FHE workloads.
* Slightly more operational complexity due to an additional service.

## Alternatives Considered

* Keep FHE operations inside the web service (resource contention).
* Use JSON-only transport (inefficient for large payloads).
* Offload to a third-party FHE provider (less control over privacy boundary).

## More Information

* Architecture: [docs/architecture.md](../../architecture.md) (FHE transport + service split)
* Observability: [docs/rfcs/0006-observability.md](../../rfcs/0006-observability.md) (cross-service tracing)
