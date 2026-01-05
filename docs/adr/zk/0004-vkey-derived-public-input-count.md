---
status: "accepted"
date: "2026-01-05"
builds-on: "[ADR](0001-client-side-zk-proving.md)"
category: "technical"
domains: [zk, security]
---

# Enforce public-input count from verification key

## Context and Problem Statement

We previously validated only a minimum number of public inputs per circuit. This allowed malformed requests with extra or missing inputs to reach cryptographic verification, increasing failure ambiguity and risk of inconsistent assumptions.

## Priorities & Constraints

* Fail fast on malformed proofs with clear errors
* Use the verifier’s source of truth for input shape
* Avoid relying on optional metadata in circuit artifacts

## Decision Outcome

Chosen option: derive public-input count from the vkey and reject proofs when the input length does not match exactly.

This check is enforced inside the server-side verifier worker before cryptographic verification.

### Expected Consequences

* Strict validation prevents malformed proofs from reaching verification.
* More consistent error behavior across circuit versions.
* Requires vkey format stability; parser must be updated if upstream changes.

## Alternatives Considered

* Keep minimum-only validation (insufficient for correctness).
* Use ABI/artifact metadata for input length (not always present/reliable).
* Allow variable-length inputs (incompatible with verifier expectations).

## More Information

* The vkey parsing logic is colocated with verification key derivation.
