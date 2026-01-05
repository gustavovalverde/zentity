---
status: "accepted"
date: "2025-12-27"
builds-on: "[ADR](0001-client-side-zk-proving.md)"
category: "technical"
domains: [zk, performance]
---

# COEP/COOP + COI service worker for multithreaded proving

## Context and Problem Statement

Client-side proving and TFHE keygen benefit significantly from multithreading, but browsers require cross-origin isolation (COEP/COOP) to enable it. We needed a consistent way to ensure isolation in production and local dev.

## Priorities & Constraints

* Enable multithreaded WASM in the browser
* Avoid breaking third-party scripts by default
* Keep configuration consistent across environments

## Decision Outcome

Chosen option: enable COEP/COOP via a cross-origin isolation service worker and asset setup scripts, with explicit runtime diagnostics for non-isolated contexts.

### Expected Consequences

* Faster proof generation and keygen on supported browsers.
* Requires careful handling of third-party scripts and headers.
* Adds service worker setup and asset copying steps.

## Alternatives Considered

* Single-threaded proofs only (slower UX).
* Dedicated proof origin with COEP/COOP (higher deployment complexity).

## More Information

* Commit: `0362da2` (COI service worker + COEP/COOP support)
