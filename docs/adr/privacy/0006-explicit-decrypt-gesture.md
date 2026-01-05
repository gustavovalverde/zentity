---
status: "proposed"
date: "2026-01-04"
builds-on: "[ADR](0003-passkey-sealed-profile.md)"
category: "business"
domains: [privacy, product]
---

# Require explicit user gesture for decryption

## Context and Problem Statement

Some flows auto-attempt profile decryption on load, which weakens user trust and blurs the boundary that plaintext should only appear with explicit user consent. We want decrypt operations to be auditable and clearly user-initiated.

## Priorities & Constraints

* Explicit user action for every decrypt
* Passkey user verification on each decrypt
* Allow a short-lived session unlock for UX

## Decision Outcome

Chosen option (proposed): require a user gesture token before any decrypt, and always prompt for a passkey with user verification.

Optional short-lived unlock is allowed in memory but not persisted across sessions.

### Expected Consequences

* Stronger user consent semantics and clearer privacy boundary.
* Slightly more friction for users who expect auto-unlock.
* Requires small client-side guard logic and UI updates.

## Alternatives Considered

* Keep auto-unlock behavior (weaker consent semantics).
* Always block session unlock (better security, worse UX).

## More Information

* RFC: [docs/rfcs/0010-explicit-decrypt-consent.md](../../rfcs/0010-explicit-decrypt-consent.md)
