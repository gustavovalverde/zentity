# ZK Proof Architecture

This document describes Zentity's zero-knowledge proof system using Noir and UltraHonk.

## Overview

Zentity uses client-side ZK proof generation to ensure sensitive data never leaves the user's browser. The architecture consists of:

1. **Noir Circuits** - ZK logic written in Noir language
2. **Client-Side Prover** - Browser-based proof generation using Noir.js + bb.js
3. **Server-Side Verifier** - Proof verification using bb.js

```
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
│  ┌──────────────────────────┐    ┌───────────────────────────────┐ │
│  │     bb.js Verifier       │───▶│   Store: proof + metadata     │ │
│  │  (UltraHonk backend)     │    │   (never raw PII)             │ │
│  └──────────────────────────┘    └───────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

## Circuits

Four ZK circuits are implemented:

| Circuit | Purpose | Private Input | Public Output |
|---------|---------|---------------|---------------|
| `age_verification` | Prove age >= threshold | Birth year | true/false |
| `doc_validity` | Prove document not expired | Expiry date | true/false |
| `nationality_membership` | Prove country in group | Nationality code | true/false |
| `face_match` | Prove face similarity >= threshold | Similarity score | true/false |

All circuits include a `nonce` public input for replay resistance.

### Directory Structure

```
apps/web/noir-circuits/
├── age_verification/
│   ├── Nargo.toml
│   ├── src/main.nr
│   └── target/age_verification.json
├── doc_validity/
│   ├── Nargo.toml
│   ├── src/main.nr
│   └── target/doc_validity.json
├── face_match/
│   ├── Nargo.toml
│   ├── src/main.nr
│   └── target/face_match.json
└── nationality_membership/
    ├── Nargo.toml
    ├── src/main.nr
    └── target/nationality_membership.json
```

---

## Circuit Details

### Age Verification

Proves age meets a minimum threshold without revealing birth year.

```noir
fn main(
    birth_year: Field,       // Private: actual birth year
    current_year: pub Field, // Public: current year
    min_age: pub Field,      // Public: minimum age (18, 21, 25)
    nonce: pub Field         // Public: replay resistance
) -> pub bool {
    let age = current_year as u32 - birth_year as u32;
    age >= min_age as u32
}
```

### Document Validity

Proves document hasn't expired without revealing the expiry date.

```noir
fn main(
    expiry_date: Field,      // Private: YYYYMMDD
    current_date: pub Field, // Public: YYYYMMDD
    nonce: pub Field         // Public: replay resistance
) -> pub bool {
    expiry_date as u32 >= current_date as u32
}
```

### Nationality Membership

Proves nationality is in a group (EU, SCHENGEN, etc.) using Merkle tree membership.

```noir
fn main(
    nationality_code: Field,            // Private: ISO numeric code
    merkle_root: pub Field,             // Public: group identifier
    path_elements: [Field; 8],          // Private: Merkle path
    path_indices: [u1; 8],              // Private: path directions
    nonce: pub Field                    // Public: replay resistance
) -> pub bool {
    // Verify Merkle path from leaf to root
}
```

### Face Match

Proves face similarity score meets threshold without revealing exact score.

```noir
fn main(
    similarity_score: Field, // Private: 0-10000 (0.00%-100.00%)
    threshold: pub Field,    // Public: minimum threshold
    nonce: pub Field         // Public: replay resistance
) -> pub bool {
    similarity_score as u32 >= threshold as u32
}
```

---

## Client-Side Implementation

### Proof Generation API

```typescript
// apps/web/src/lib/noir-prover.ts

// Age proof
const ageResult = await generateAgeProofNoir({
  birthYear: 1990,
  currentYear: 2025,
  minAge: 18,
  nonce: challengeNonce
});

// Document validity proof
const docResult = await generateDocValidityProofNoir({
  expiryDate: 20271231,
  currentDate: 20251212,
  nonce: challengeNonce
});

// Nationality proof
const natResult = await generateNationalityProofNoir({
  nationalityCode: "DEU",
  groupName: "EU",
  nonce: challengeNonce
});
```

### Web Worker Architecture

Proof generation runs in a Web Worker to keep the UI responsive:

```
Main Thread                    Web Worker
     │                              │
     │─── postMessage(inputs) ─────▶│
     │                              │ 1. Load Noir.js
     │                              │ 2. Load circuit JSON
     │                              │ 3. Execute witness
     │                              │ 4. Generate proof (bb.js)
     │◀── postMessage(proof) ───────│
     │                              │
```

Key files:
- `noir-prover.ts` - Public API for proof generation
- `noir-worker-manager.ts` - Worker pool management
- `noir-prover.worker.ts` - Worker implementation

---

## Server-Side Verification

### Verifier API

```typescript
// apps/web/src/lib/noir-verifier.ts

const result = await verifyNoirProof({
  proof: proofBase64,
  publicInputs: ["1", "2025", "18", "12345"],
  circuitType: "age_verification"
});

// result: {
//   isValid: true,
//   verificationTimeMs: 45,
//   circuitType: "age_verification",
//   noirVersion: "1.0.0-beta.1",
//   circuitHash: "abc123...",
//   bbVersion: "0.82.2"
// }
```

### Proof Metadata

Each verification returns circuit metadata for audit trails:
- `noirVersion` - Noir compiler version
- `circuitHash` - Hash of compiled circuit
- `bbVersion` - Barretenberg verifier version

---

## Adding New Circuits

### 1. Create Circuit Directory

```bash
cd apps/web/noir-circuits
mkdir -p new_circuit/src
```

### 2. Write Nargo.toml

```toml
[package]
name = "new_circuit"
type = "bin"
authors = ["Zentity"]
compiler_version = ">=1.0.0"

[dependencies]
nodash = { git = "https://github.com/noir-lang/nodash", tag = "v1.0.0" }
```

### 3. Write Circuit (src/main.nr)

```noir
fn main(
    private_input: Field,
    public_input: pub Field,
    nonce: pub Field
) -> pub bool {
    let _ = nonce; // For replay resistance
    // Your circuit logic
    private_input == public_input
}

#[test]
fn test_circuit() {
    let result = main(42, 42, 12345);
    assert(result == true);
}
```

### 4. Compile

```bash
cd apps/web
pnpm circuits:compile
```

### 5. Add to TypeScript

Update these files:
- `src/lib/zk-circuit-spec.ts` - Add circuit type
- `src/lib/noir-verifier.ts` - Import compiled JSON
- `src/lib/noir-prover.worker.ts` - Add worker handler
- `src/lib/noir-prover.ts` - Add public API function

---

## Development Commands

```bash
# Compile all circuits
cd apps/web
pnpm circuits:compile

# Run circuit tests
pnpm circuits:test

# Test specific circuit
cd noir-circuits/age_verification
nargo test
```

---

## Performance

| Metric | Value |
|--------|-------|
| Age proof generation | 50-150ms |
| Nationality proof generation | 100-300ms |
| Proof verification | <50ms |
| Proof size | ~2KB |

Proof generation times depend on circuit complexity and device performance.

---

## Security Considerations

### Universal Setup

UltraHonk uses a universal trusted setup (SRS/CRS) that:
- Is circuit-agnostic (no per-circuit ceremony)
- Is downloaded and cached automatically by bb.js
- Can be verified against public ceremonies

### Replay Resistance

All circuits require a `nonce` public input:
- Server issues challenge nonces via `/api/crypto/challenge`
- Nonce is bound to session/user
- Same proof cannot be replayed with different nonce

### Input Validation

Circuits include range checks:
- Age: birth year cannot be in the future
- Face match: scores must be 0-10000
- Dates: validated as YYYYMMDD integers

---

## Files Reference

```
apps/web/
├── noir-circuits/           # Noir circuit sources
│   ├── age_verification/
│   ├── doc_validity/
│   ├── face_match/
│   └── nationality_membership/
├── src/lib/
│   ├── noir-prover.ts       # Client-side API
│   ├── noir-prover.worker.ts # Web Worker
│   ├── noir-worker-manager.ts # Worker pool
│   ├── noir-verifier.ts     # Server-side verification
│   ├── zk-circuit-spec.ts   # Circuit type definitions
│   ├── nationality-data.ts  # Country codes
│   └── nationality-merkle.ts # Merkle tree utils
└── src/app/api/crypto/
    ├── challenge/route.ts   # Nonce generation
    └── verify-proof/route.ts # Proof verification endpoint
```
