---
status: "accepted"
date: "2025-12-13"
builds-on: null
category: "technical"
domains: [zk, privacy]
---

# Client-side ZK proving (private inputs stay in browser)

## Context and Problem Statement

ZK proofs require private inputs (PII-derived values) that should never be exposed to the server. We needed an architecture where proofs are generated client-side and only the proof and public inputs are transmitted for verification.

## Priorities & Constraints

* Keep private inputs on device
* Allow server-side verification and policy enforcement
* Support multiple circuit types

## Decision Outcome

Chosen option: generate ZK proofs in the browser using Noir/UltraHonk and send only proof + public inputs to the server for verification.

### Expected Consequences

* Strong privacy boundary for private inputs.
* Requires browser-side WASM assets and worker management.
* Increased client compute costs; needs COEP/COOP for multithreading.

## Alternatives Considered

* Server-side proving (breaks privacy boundary).
* Trusted enclave proving (higher infra complexity).

## More Information

* Commit: `97475d7` (migrate proofs to Noir/UltraHonk client-side)
