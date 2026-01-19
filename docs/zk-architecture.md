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
| `age_verification` | Prove age >= threshold | DOB (days since 1900) + document hash | Current days, min age days, nonce, claim hash |
| `doc_validity` | Prove document not expired | Expiry date + document hash | Current date, nonce, claim hash |
| `nationality_membership` | Prove nationality in group | Nationality code + Merkle path | Merkle root, nonce, claim hash |
| `address_jurisdiction` | Prove address in jurisdiction | Address country code + Merkle path | Merkle root, nonce, claim hash |
| `face_match` | Prove similarity >= threshold | Similarity score + document hash | Threshold, nonce, claim hash |
| `identity_binding` | Bind proof to user identity | Binding secret, user ID hash, document hash | Nonce, binding commitment, auth mode |

**Importance:** The verifier learns only the boolean outcome (e.g., "over 18"), never the underlying PII.

### Identity Binding Circuit

The `identity_binding` circuit provides replay protection by cryptographically binding proofs to a specific user identity. It works across all three authentication modes:

| Auth Mode | Binding Secret Source | Privacy Level |
|-----------|----------------------|---------------|
| **Passkey** | PRF output (32 bytes) | Highest – device-bound, non-extractable |
| **OPAQUE** | Export key (64 bytes) | Medium – password-derived, deterministic |
| **Wallet** | EIP-712 signature (65 bytes) | Lower – publicly verifiable by address |

The circuit is **auth-mode agnostic**: it accepts a generic `binding_secret` as a private input. The TypeScript layer (`binding-secret.ts`) handles per-mode derivation using HKDF with domain separation strings to prevent cross-use attacks.

**Binding commitment formula:**

```typescript
commitment = Poseidon2(binding_secret || user_id_hash || document_hash)
```

This ensures that:

- Same user + same document + same auth secret = same commitment (deterministic)
- Different auth modes produce different commitments (domain separation)
- Proofs cannot be replayed across users or documents

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

## BN254 Field Constraints

All ZK circuits operate over the **BN254 scalar field** (~254 bits). Values exceeding the field modulus will cause proof generation to fail.

### Field Modulus

```text
BN254_FR_MODULUS = 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001
                ≈ 2^254 (actually slightly less)
```

### Common Pitfalls

| Source | Size | Risk |
|--------|------|------|
| Passkey PRF output | 32 bytes (256 bits) | ⚠️ Can exceed modulus |
| OPAQUE export key | 64 bytes (512 bits) | ⚠️ Must reduce |
| Wallet signature | 65 bytes (520 bits) | ⚠️ Must reduce |
| SHA-256 hash | 32 bytes (256 bits) | ⚠️ Can exceed modulus |
| Poseidon2 output | ~254 bits | ✓ Always valid |

### Required: Field Reduction

Any 256-bit value from cryptographic operations **must** be reduced before use in circuits:

```typescript
// WRONG: Fr constructor throws if value >= modulus
const fr = new Fr(rawValue); // Error!

// CORRECT: Reduce first, then construct
const reduced = rawValue % BN254_FR_MODULUS;
const fr = new Fr(reduced); // Safe
```

The worker uses `reduceToField()` to handle this:

```typescript
async function reduceToField(hexValue: string): Promise<string> {
  const { BN254_FR_MODULUS } = await getModules();
  const bigIntValue = BigInt(hexValue);
  const reduced = bigIntValue % BN254_FR_MODULUS;
  return `0x${reduced.toString(16).padStart(64, "0")}`;
}
```

### Where This Matters

- **Identity binding**: `bindingSecretField`, `userIdHashField` from passkey/OPAQUE/wallet
- **Document hashes**: SHA-256 outputs before circuit use
- **Any 32-byte cryptographic output**

See `src/lib/privacy/zk/noir-prover.worker.ts` for implementation and `src/lib/blockchain/attestation/claim-hash.ts` for server-side reduction.

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

### Verification flow

```text
Next.js API Route
  |
  | 1. Load circuit artifact (cached)
  | 2. Get/create UltraHonkVerifierBackend (singleton)
  | 3. Call verifier.verifyProof(proof, publicInputs)
  | 4. Return boolean result
  |
```

Verification uses Barretenberg's `UltraHonkVerifierBackend` directly in the API route with singleton instances for efficiency.

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
