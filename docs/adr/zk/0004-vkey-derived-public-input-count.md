---
status: "accepted"
date: "2026-01-05"
builds-on: "[ADR](0001-client-side-zk-proving.md)"
category: "technical"
domains: [zk, security]
---

# Enforce public-input count from the circuit ABI

## Context and Problem Statement

We previously validated only a minimum number of public inputs per circuit. This allowed malformed requests with extra or missing inputs to reach cryptographic verification, increasing failure ambiguity and risk of inconsistent assumptions.

## Priorities & Constraints

* Fail fast on malformed proofs with clear errors
* Use a source of truth for input shape that ships with the verifier
* Avoid depending on the verification key byte layout

## Decision Outcome

Chosen option: derive the public-input count from the compiled circuit ABI (public parameters plus a public return value) and reject proofs when the input length does not match exactly.

This check is enforced inside the server-side verifier worker before cryptographic verification. The compiled artifacts are bundled with the verifier, so the ABI is always present. A unit test checks that the `PROOF_TYPE_SPECS` public-input order and indices match each artifact ABI.

### Expected Consequences

* Strict validation prevents malformed proofs from reaching verification.
* More consistent error behavior across circuit versions.
* No dependency on the verification key format. A circuit recompile that changes public parameters changes the count automatically, and the `PROOF_TYPE_SPECS` test fails until the spec table is updated.

## Alternatives Considered

* Keep minimum-only validation (insufficient for correctness).
* Parse the count from the verification key bytes (the original decision, which depends on vkey format stability).
* Allow variable-length inputs (incompatible with verifier expectations).

## More Information

* The ABI-based count lives next to verification key derivation in `noir/verifier.ts`.

## Revision history

* 2026-03-18: The count moved from vkey parsing to the compiled circuit ABI (commit a15bc432). The exact-length rejection is unchanged. The `PROOF_TYPE_SPECS` consistency test was added afterwards.
