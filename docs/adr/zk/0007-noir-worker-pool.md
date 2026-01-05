---
status: "accepted"
date: "2026-01-05"
builds-on: "[ADR](0001-client-side-zk-proving.md)"
category: "technical"
domains: [zk, performance]
---

# Optional worker pool for Noir proving

## Context and Problem Statement

Some flows can require multiple proofs in a single session. A single worker can become a bottleneck, but always running multiple workers wastes resources and can overload smaller devices.

## Priorities & Constraints

* Support higher throughput when needed
* Keep defaults lightweight for typical users
* Allow tuning per environment

## Decision Outcome

Chosen option: introduce an optional worker pool for Noir proving, enabled via configuration.

### Expected Consequences

* Parallel proof generation when configured.
* Configurable CPU usage by environment.
* Additional coordination logic in the worker manager.

## Alternatives Considered

* Fixed-size pool for all environments (over-provisioning risk).
* Single worker only (limits throughput).

## More Information

* Pool size is controlled via `NEXT_PUBLIC_NOIR_WORKERS`.
