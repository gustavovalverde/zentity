---
status: "accepted"
date: "2026-01-05"
builds-on: "[ADR](0001-client-side-zk-proving.md)"
category: "technical"
domains: [zk, security]
---

# Runtime integrity and version guards for Noir/BB assets

## Context and Problem Statement

Noir/bb.js depends on WASM assets and compiled circuit artifacts loaded at runtime. Missing or mismatched assets and version drift can cause opaque failures. We need early signals for misconfigurations without hard-failing every environment.

## Priorities & Constraints

* Early detection of asset and version issues
* Minimal runtime overhead
* Avoid overly strict startup failures in development and preview environments

## Decision Outcome

Chosen option: add runtime guardrails that check asset presence and detect version drift between artifacts and runtime packages.

### Expected Consequences

* Faster diagnosis of missing or misconfigured assets.
* Warnings surface version mismatches before they cause verification failures.
* Slight startup overhead for file presence checks.

## Alternatives Considered

* Rely on runtime errors only (poor diagnostics).
* Fail hard on startup (too strict for some environments).
* Only enforce in CI (misses production misconfigurations).

## More Information

* Runtime checks are surfaced via instrumentation with warnings.
