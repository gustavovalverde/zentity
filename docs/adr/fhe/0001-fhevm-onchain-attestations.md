---
status: "accepted"
date: "2025-12-23"
builds-on: null
category: "business"
domains: [fhe, web3]
---

# FHEVM on-chain attestations with client-side encryption

## Context and Problem Statement

We needed on-chain attestations that preserve privacy while allowing compliance checks on encrypted data. The solution had to ensure the server never sees plaintext and that user-controlled decryption remains wallet-gated.

## Priorities & Constraints

* Client-side encryption for on-chain submissions
* Wallet-gated decryption and user control
* Preserve auditability with public metadata

## Decision Outcome

Chosen option: integrate FHEVM to allow client-side encryption and on-chain encrypted attestations, with decryption controlled by wallet signatures.

### Expected Consequences

* Privacy-preserving on-chain compliance checks.
* Additional dependencies and network configuration (gateway, relayer).
* Requires careful UX for encrypted proof submission and access.

## Alternatives Considered

* On-chain plaintext attestations (privacy loss).
* Off-chain only attestations (limits Web3 use cases).

## More Information

* Commit: `ee8675a` (FHEVM integration)
