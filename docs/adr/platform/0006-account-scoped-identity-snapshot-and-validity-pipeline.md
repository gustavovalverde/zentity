---
status: "accepted"
date: "2026-04-21"
category: "technical"
domains: [platform, privacy, security, audit]
builds-on: "[Disclosure Surface Assignment](../privacy/0015-disclosure-surface-assignment.md)"
---

# Account-scoped identity snapshot and validity pipeline

## Context and Problem Statement

Zentity originally let too many important behaviors depend on raw verification rows: current identity selection, per-RP sybil nullifier derivation, and revocation fan-out all had row-centric logic in different places. That made the system brittle in exactly the places that become hardest to refactor later: privacy boundaries, anti-abuse signals, and lifecycle delivery.

The project also needs to support multiple credential rows per account, re-verification without history loss, and downstream consumers that care about current validity rather than raw storage details. The architecture therefore needs one durable account snapshot, one credential-history model, and one canonical lifecycle pipeline.

## Priorities & Constraints

* Keep the developer-facing model explicit enough that future credential sources can join without inventing a second identity architecture.
* Preserve stable RP anti-abuse semantics across credential additions while still allowing full revocation and clean re-verification.
* Separate immutable transition history from retryable downstream delivery state.
* Avoid backward-compatibility baggage and runtime backfills; the current product scope has no production users.

## Decision Outcome

Chosen option: use an account-scoped identity snapshot plus an explicit validity pipeline.

The shipped architecture is:

* `identity_bundles` is the account-scoped snapshot and aggregate root.
* `identity_verifications` is credential history. New verification outcomes append or update rows there; they do not redefine the account model by themselves.
* `identity_bundles.effectiveVerificationId` materializes the authoritative credential for current reads.
* `identity_bundles.rpNullifierSeed` stores the stable per-account seed used to derive RP-specific `sybil_nullifier` claims.
* `identity_bundles.validityStatus`, revocation metadata, and `verificationExpiresAt` describe the current lifecycle state of the account snapshot.
* `identity_validity_events` is the append-only transition ledger.
* `identity_validity_deliveries` is the retryable per-target delivery ledger for downstream effects.
* `reconcileIdentityBundle(userId, executor?)` is the only bundle reconciler.
* `recordValidityTransition({...})` is the canonical lifecycle writer and delivery scheduler.

### Snapshot authority

`identity_bundles` answers current-state questions. `identity_verifications` answers history questions. Code that needs the user's current identity, validity state, freshness deadline, or RP-nullifier basis reads the bundle snapshot and follows `effectiveVerificationId`. It does not re-run credential selection ad hoc from raw verification rows.

That boundary keeps "what is true now?" separate from "what happened before?". It also keeps new credential sources from inventing a second current-state model when they only need to append history.

### RP nullifier seed ownership

The RP nullifier seed lives on the bundle because its stability contract is account-scoped, not credential-scoped. The system writes `rpNullifierSeed` from the first authoritative verified credential, preserves it across later credential additions and supersession, clears it on full identity revocation, and reseeds it only when a later verified credential establishes a new account identity after that revocation.

Recomputing the RP nullifier from "the latest verification row" would make `proof:sybil` rotate whenever the user adds a new credential. That breaks the relying-party contract. Storing the seed on the bundle makes the invariant explicit, durable, and easy to audit.

### Lifecycle ownership

Low-level proof and claim inserts stay pure writes. Verification lifecycle checkpoints own bundle reconciliation and validity transitions. `reconcileIdentityBundle` is the only code path that can change `effectiveVerificationId`, freshness deadlines, or RP-nullifier seed policy, and `recordValidityTransition` is the only code path that appends lifecycle history and schedules downstream deliveries.

That split reduces entropy in two directions. Current-state updates stay in one place, and downstream fan-out stays in one place. Future credential methods can therefore join the system by calling the same lifecycle checkpoints instead of adding a parallel validity architecture.

### Expected Consequences

* Current reads become simpler because they consume one account snapshot and one selected credential instead of re-ranking verification rows ad hoc.
* `proof:sybil` stops rotating when a user adds a new credential because the RP nullifier seed is bundle-owned state, not "latest verification" state.
* Re-verification can supersede prior authoritative credentials without destroying history.
* Revocation, freshness, and RP validity notice all share one lifecycle vocabulary and one operator-visible ledger.
* Low-level proof and claim inserts stay pure writes; lifecycle finishers own state transitions.

## Alternatives Considered

* Continue deriving current identity from the latest verification row. Rejected because it makes selection, freshness, revocation, and anti-abuse behavior drift across call sites.
* Introduce a second grouping identifier such as `identityGroupId`. Rejected because the current scope is account-scoped grouping only, and `userId` already plays that role without adding a second source of truth.
* Recompute the RP nullifier directly from the current verification row on demand. Rejected because it rotates across credential additions and breaks the stability contract for relying parties.
* Execute downstream revocation side effects inline inside each revoke caller. Rejected because retries, idempotency, and operator visibility all become target-specific instead of pipeline-level.

## More Information

* Shared implementation plan: [Shared Identity Foundation](../../plans/tasks/shared-identity-foundation.md)
* Validity implementation plan: [Unified Identity Validity Pipeline](../../plans/tasks/prd-36/overview.md)
* Public architecture overview: [System Architecture](../../(concepts)/architecture.md)
