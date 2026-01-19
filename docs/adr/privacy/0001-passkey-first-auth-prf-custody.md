---
status: "accepted"
date: "2026-01-01"
builds-on: null
category: "business"
domains: [privacy, security]
---

# Passkey-first authentication with PRF key custody

## Context and Problem Statement

We needed a default authentication model that reinforces user-controlled key custody for privacy-sensitive operations (FHE keys, profile decryption). Password-based fallbacks complicate threat models and can weaken privacy guarantees.

## Priorities & Constraints

* Make passkeys the primary auth method
* Ensure PRF-derived keys are available for secret encryption/decryption
* Keep recovery flows viable without exposing plaintext

## Decision Outcome

Chosen option: implement passkey-first authentication with PRF key custody as the default sign-in and sign-up path.

Passkey PRF output anchors encryption/decryption of user secrets and aligns authentication with privacy-preserving key ownership.

### Expected Consequences

* Stronger default privacy model and fewer password-based weak points.
* Higher dependency on passkey availability and platform support.
* Recovery UX must be explicit and passkey-centric.

## Alternatives Considered

* Password-first auth with optional passkeys (weaker privacy guarantees).
* Passkeys only without PRF custody (breaks secret unlocking model).
* Wallet-only auth via EIP-712 signatures (now implemented as an alternative for Web3-native users—see ADR: OPAQUE and [Cryptographic Pillars](../../cryptographic-pillars.md)).

## Related Decisions

* **[ADR-0010: OPAQUE password auth](0010-opaque-password-auth.md)** — password fallback for non-passkey users
* **Wallet auth (EIP-712)** — Web3-native alternative using HKDF-derived KEK from wallet signatures

## More Information

* Commit: `229a65b` (passkey-first auth + PRF custody)
