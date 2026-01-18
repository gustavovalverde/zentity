---
status: "accepted"
date: "2025-12-30"
builds-on: "[ADR](0002-split-encryption-and-computation.md)"
category: "technical"
domains: [fhe, privacy]
---

# Passkey-wrapped FHE key custody (client-owned keys)

## Context and Problem Statement

We need a privacy-preserving way to store FHE keys without the server ever holding plaintext client keys. The system must support multi-device access, passkey-based recovery, and rotation without re-encrypting all data.

## Priorities & Constraints

* Server must never see plaintext client FHE keys
* Multi-device access with passkeys
* Key rotation without re-encrypting ciphertexts
* Low friction for sign-up

## Decision Outcome

Chosen option: generate FHE keys in the browser and store them server-side as a passkey-wrapped encrypted secret.

A PRF-derived KEK wraps a random DEK, which encrypts the FHE key bundle. The server stores only the encrypted blob and per-passkey wrappers, and associates a `key_id` for FHE service registration.

### Expected Consequences

* Server cannot decrypt client keys; user retains decryption control.
* Multi-device access becomes passkey-based instead of device-bound.
* Additional envelope/wrapper logic and metadata management on the client and server.

## Alternatives Considered

* Store plaintext keys client-side only (breaks multi-device access).
* Store plaintext keys server-side (violates privacy boundary).
* Use a single passkey-derived key without DEK wrapping (harder rotation/migration).

## More Information

* RFC: [docs/rfcs/0001-passkey-wrapped-fhe-keys.md](../../rfcs/0001-passkey-wrapped-fhe-keys.md)
* Architecture: [docs/architecture.md](../../architecture.md) (Passkey‑Wrapped Client Key Ownership)
