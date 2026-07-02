---
status: "accepted"
date: "2026-07-02"
builds-on: "[ADR](0005-ultrahonkverifierbackend-server-verify.md)"
category: "technical"
domains: [zk]
---

# Verify ZKPassport NFC proofs server-side instead of through the SDK

## Context and Problem Statement

NFC chip verification (`passportChip.submitResult`) checks ZKPassport proofs on the server. The `@zkpassport/sdk` ships a `verify()` entry point, but it is built for a browser holder verifying its own single presentation, not for a server verifying every user's proofs under load. `verifyZkPassportProofs` in `zkpassport-verifier.ts` runs the pipeline instead.

## Priorities & Constraints

* Verify within the request budget without re-paying per-call setup.
* Retain server-only trust policy the SDK does not model.
* Keep a clear, auditable boundary against SDK cryptographic drift.

## Decision Outcome

Run a server-owned verification pipeline that reuses `@zkpassport/utils` public-input helpers and the shared Barretenberg backend, and call `verify()` nowhere on the server path.

The SDK's `verify()` is unusable here at `@zkpassport/sdk` 0.14.2:

* It re-creates the WASM backend, fetches the CDN circuit manifest, and issues registry RPC calls on every invocation; the server caches the backend, manifests, verification keys, and on-chain roots and pre-warms them from `instrumentation.ts`.
* It requires `originalQuery`, which the server does not retain after issuing the request.
* It cannot express the server's trust policy: facematch app-id and root-key allowlists, on-chain registry-root validity with a 5-minute TTL cache, and per-call timeouts.

### Expected Consequences

* One warmed pipeline serves all verifications; latency stays bounded under load.
* Server policy lives next to the proof checks that enforce it.
* The `validate*QueryResult` functions and `checkPublicInputs` mirror the SDK's unexported `check*PublicInputs` internals. They are a deliberate reimplementation and must be re-diffed against upstream on every `@zkpassport/sdk` bump.

## Alternatives Considered

* Delegate query-result validation to SDK or utils functions: rejected. At 0.14.2 the SDK exports only the `ZKPassport` class, and `@zkpassport/utils` 0.36.1 exports no query-result validators; the file already consumes every relevant `get*` helper it publishes.
* Call `verify()` per request: rejected on the per-call resource creation and the missing `originalQuery`.

## More Information

* Verification-key and backend caching: [ADR 0005](0005-ultrahonkverifierbackend-server-verify.md).
* The mirrored surface shrinks toward zero if ZKPassport exports its `check*PublicInputs` helpers upstream.
