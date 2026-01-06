# ZK Proof Architecture

This document describes Zentity’s zero‑knowledge proof system using **Noir** circuits with **UltraHonk** proofs. It focuses on **architecture and trust boundaries**, not implementation details.

## Overview

Zentity generates proofs **client‑side** so private inputs stay in the browser. Proofs are verified **server‑side** and stored with metadata for auditability. Private inputs are derived from passkey‑sealed profile data (e.g., birth year, nationality) and server‑signed claim payloads (e.g., face match score). The server never sees plaintext values.

```text
┌─────────────────────────────────────────────────────────────────────┐
│                           User's Browser                            │
│  ┌─────────────┐    ┌─────────────────┐    ┌──────────────────────┐ │
│  │ Sensitive   │───▶│   Web Worker    │───▶│    ZK Proof          │ │
│  │ Data        │    │ (Noir.js+bb.js) │    │  (public inputs +    │ │
│  │ (birthYear) │    │                 │    │   proof bytes)       │ │
│  └─────────────┘    └─────────────────┘    └──────────┬───────────┘ │
│                                                       │             │
└───────────────────────────────────────────────────────│─────────────┘
                                                        │
                                                        ▼
┌─────────────────────────────────────────────────────────────────────┐
│                              Server                                 │
│  ┌──────────────────────────┐    ┌───────────────────────────────┐  │
│  │     bb.js Verifier       │───▶│   Store: proof + metadata     │  │
│  │ (UltraHonk verifier)     │    │   (never raw PII)             │  │
│  └──────────────────────────┘    └───────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

## Circuits

| Circuit | Purpose | Private Inputs | Public Inputs |
|---------|---------|----------------|---------------|
| `age_verification` | Prove age >= threshold | Birth year + document commitment | Current year, min age, nonce, claim hash |
| `doc_validity` | Prove document not expired | Expiry date + document commitment | Current date, nonce, claim hash |
| `nationality_membership` | Prove nationality in group | Nationality code + Merkle path | Merkle root, nonce, claim hash |
| `face_match` | Prove similarity >= threshold | Similarity score + document commitment | Threshold, nonce, claim hash |

**Why this matters:** The verifier learns only the boolean outcome (e.g., “over 18”), never the underlying PII.

## Proof Binding & Integrity

- **Nonces** (server‑issued) prevent replay.
- **Claim hashes** bind proofs to server‑signed OCR/liveness claims.
- **Verifier metadata** stores circuit/version identifiers for audit.

See [Tamper Model](tamper-model.md) for integrity rules and [Attestation & Privacy Architecture](attestation-privacy-architecture.md) for data classification.

## Performance & UX Notes

- Proof generation runs in a **Web Worker** to avoid UI blocking.
- Circuits are optimized for **Poseidon2** hashing (cheaper in ZK than SHA‑256).
- Detailed profiling and timing guidance live in [Noir Profiling](noir-profiling.md).
- Proof times are device- and circuit-dependent; treat any numbers as guidance.

## Security Notes

- **Nonce binding** prevents proof replay.
- **Claim binding** ties proofs to server‑signed measurements (OCR, liveness, face match).
- **Range checks** avoid wrap‑around and invalid inputs (dates, scores, thresholds).

## Implementation Notes

### Proving flow (Web Worker)

```text
Main Thread                    Web Worker
  |                                |
  |--- postMessage(inputs) ------->|
  |                                | 1. Load Noir.js
  |                                | 2. Load circuit JSON
  |                                | 3. Execute witness
  |                                | 4. Generate proof (bb.js)
  |<-- postMessage(proof) ---------|
  |                                |
```

### Verification flow (bb-worker isolation)

```text
Next.js API Route              bb-worker.mjs (child process)
  |                                |
  |--- spawn Node.js process ----->| Initialize once
  |                                |
  |--- send request (JSON-RPC) --->| Load circuit, verify proof
  |                                |
  |<-- result (JSON-RPC) ----------|
```

This isolates bb.js work from the request thread and supports timeouts.

### Proof metadata (stored for auditability)

- `noirVersion`
- `bbVersion`
- `circuitHash`
- `verificationKeyHash`
- `verificationKeyPoseidonHash`
- `circuitId` (derived from the verification key hash)

## Implementation References

- **ADR:** [Client‑side ZK proving](adr/zk/0001-client-side-zk-proving.md)
- **Deep dive:** [Nationality proofs](zk-nationality-proofs.md)
