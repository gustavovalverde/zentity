---
status: "accepted"
date: "2025-12-30"
builds-on: "[ADR](0002-split-encryption-and-computation.md)"
category: "technical"
domains: [fhe, privacy]
---

# Credential-wrapped FHE key custody (client-owned keys)

## Context and Problem Statement

We need a privacy-preserving way to store FHE keys without the server ever holding plaintext client keys. The system must support multi-device access, credential-based recovery, and rotation without re-encrypting all data.

## Priorities & Constraints

* Server must never see plaintext client FHE keys
* Multi-device access with passkeys, passwords, or wallets
* Key rotation without re-encrypting ciphertexts
* Low friction for sign-up

## Decision Outcome

Chosen option: generate FHE keys in the browser and store them server-side as a credential-wrapped encrypted secret.

A KEK (derived from passkey PRF, OPAQUE export key, or wallet signature via HKDF) wraps a random DEK, which encrypts the FHE key bundle. The server stores only the encrypted blob and per-credential wrappers (with `kek_source` indicating the method: `prf`, `opaque`, or `wallet`), and associates a `key_id` for FHE service registration.

### Expected Consequences

* Server cannot decrypt client keys; user retains decryption control.
* Multi-device access becomes credential-based (passkey, password, or wallet) instead of device-bound.
* Additional envelope/wrapper logic and metadata management on the client and server.
* Same encryption model works across all three auth methods.

## Alternatives Considered

* Store plaintext keys client-side only (breaks multi-device access).
* Store plaintext keys server-side (violates privacy boundary).
* Use a single passkey-derived key without DEK wrapping (harder rotation/migration).

## More Information

* RFC: [docs/rfcs/0001-passkey-wrapped-fhe-keys.md](../../rfcs/0001-passkey-wrapped-fhe-keys.md)
* Architecture: [docs/architecture.md](../../architecture.md) (Passkey‑Wrapped Client Key Ownership)
