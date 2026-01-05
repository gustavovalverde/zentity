---
status: "accepted"
date: "2025-12-29"
builds-on: null
category: "technical"
domains: [fhe, architecture]
---

# Split encryption (client) and computation (server) for FHE privacy

## Context and Problem Statement

We need to compute on sensitive attributes while preserving privacy. The browser is best for privacy (key custody), while the server is best for integrity and policy enforcement. We must ensure the server can compute on ciphertext without learning plaintext values.

## Priorities & Constraints

* Preserve user privacy (no server-side decryption)
* Enable integrity checks and policy enforcement server-side
* Support both off-chain (TFHE) and on-chain (FHEVM) flows

## Decision Outcome

Chosen option: keep encryption and decryption in the client, and perform homomorphic computation on the server via the FHE service.

For Web2 (off-chain), the client generates keys and encrypts attributes; the server invokes the FHE service to compute on ciphertext. For Web3 (on-chain), the client encrypts via FHEVM SDK and controls decryption via wallet signatures. The server never sees plaintext.

### Expected Consequences

* Strong privacy boundary: plaintext values exist only on the client.
* Server can still compute and enforce compliance logic on encrypted data.
* Additional client responsibilities (key custody, encryption, user consent).

## Alternatives Considered

* Server-side encryption/decryption (breaks privacy boundary).
* Pure ZK-only approach for all attributes (not feasible for numeric thresholds used in contracts).
* Client-only computation (weak integrity guarantees for compliance enforcement).

## More Information

* Attestation & Privacy: [docs/attestation-privacy-architecture.md](../../attestation-privacy-architecture.md) (Trust & Privacy Boundaries)
* System Architecture: [docs/architecture.md](../../architecture.md) (FHE + privacy guarantees)
