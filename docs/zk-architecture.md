# ZK Proof Architecture

> **Related docs:** [System Architecture](architecture.md) | [Attestation & Privacy Architecture](attestation-privacy-architecture.md) | [Nationality Proofs](zk-nationality-proofs.md) | [README](../README.md)

This document describes Zentity's zero-knowledge proof system using Noir and UltraHonk.

## Overview

Zentity uses client-side ZK proof generation so the **private inputs to proofs stay in the browser during proving**. Private inputs are sourced from the **passkey-sealed profile** (client decrypt only), so the server never sees plaintext values. The architecture consists of:

1. **Noir Circuits** - ZK logic written in Noir language
2. **Client-Side Prover** - Browser-based proof generation using Noir.js + bb.js
3. **Server-Side Verifier** - Proof verification using bb.js

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
│  ┌──────────────────────────┐    ┌───────────────────────────────┐ │
│  │     bb.js Verifier       │───▶│   Store: proof + metadata     │ │
│  │  (UltraHonk backend)     │    │   (never raw PII)             │ │
│  └──────────────────────────┘    └───────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

## Circuits

Four ZK circuits are implemented:

| Circuit | Purpose | Private Inputs | Public Inputs → Output |
|---------|---------|----------------|------------------------|
| `age_verification` | Prove age >= threshold | birth_year, document_hash | current_year, min_age, nonce, claim_hash → is_old_enough |
| `doc_validity` | Prove document not expired | expiry_date, document_hash | current_date, nonce, claim_hash → is_valid |
| `nationality_membership` | Prove country in group | nationality_code, document_hash | merkle_root, nonce, claim_hash → is_member |
| `face_match` | Prove face similarity >= threshold | similarity_score, document_hash | threshold, nonce, claim_hash → is_match |

All circuits include a `nonce` public input for replay resistance and a `claim_hash` that binds the proof to server-signed OCR claims.

### Directory Structure

```text
apps/web/noir-circuits/
├── age_verification/
│   ├── Nargo.toml
│   ├── src/main.nr
│   └── artifacts/age_verification.json
├── doc_validity/
│   ├── Nargo.toml
│   ├── src/main.nr
│   └── artifacts/doc_validity.json
├── face_match/
│   ├── Nargo.toml
│   ├── src/main.nr
│   └── artifacts/face_match.json
└── nationality_membership/
    ├── Nargo.toml
    ├── src/main.nr
    └── artifacts/nationality_membership.json
```

---

## Circuit Details

### Age Verification

Proves age meets a minimum threshold without revealing birth year.

```noir
use nodash::poseidon2;

fn main(
    birth_year: Field,        // Private: actual birth year
    document_hash: Field,     // Private: document commitment
    current_year: pub Field,  // Public: current year
    min_age: pub Field,       // Public: minimum age (18, 21, 25)
    nonce: pub Field,         // Public: replay resistance
    claim_hash: pub Field     // Public: claim hash binding to OCR data
) -> pub bool {
    let _ = nonce;
    let computed_hash = poseidon2([birth_year, document_hash]);
    assert(computed_hash == claim_hash, "Claim hash mismatch");
    let age = current_year as u32 - birth_year as u32;
    age >= min_age as u32
}
```

### Document Validity

Proves document hasn't expired without revealing the expiry date.

```noir
use nodash::poseidon2;

fn main(
    expiry_date: Field,       // Private: YYYYMMDD
    document_hash: Field,     // Private: document commitment
    current_date: pub Field,  // Public: YYYYMMDD
    nonce: pub Field,         // Public: replay resistance
    claim_hash: pub Field     // Public: claim hash binding to OCR data
) -> pub bool {
    let _ = nonce;
    let computed_hash = poseidon2([expiry_date, document_hash]);
    assert(computed_hash == claim_hash, "Claim hash mismatch");
    expiry_date as u32 >= current_date as u32
}
```

### Nationality Membership

Proves nationality is in a group (EU, SCHENGEN, etc.) using Merkle tree membership.

```noir
use nodash::poseidon2;

fn main(
    nationality_code: Field,            // Private: ISO numeric code
    document_hash: Field,               // Private: document commitment
    path_elements: [Field; 8],          // Private: Merkle path
    path_indices: [u1; 8],              // Private: path directions
    merkle_root: pub Field,             // Public: group identifier
    nonce: pub Field,                   // Public: replay resistance
    claim_hash: pub Field               // Public: claim hash binding to OCR data
) -> pub bool {
    let _ = nonce;
    let computed_hash = poseidon2([nationality_code, document_hash]);
    assert(computed_hash == claim_hash, "Claim hash mismatch");
    // Verify Merkle path from leaf to root
}
```

### Face Match

Proves face similarity score meets threshold without revealing exact score.

```noir
use nodash::poseidon2;

fn main(
    similarity_score: Field, // Private: 0-10000 (0.00%-100.00%)
    document_hash: Field,    // Private: document commitment
    threshold: pub Field,    // Public: minimum threshold
    nonce: pub Field,        // Public: replay resistance
    claim_hash: pub Field    // Public: claim hash binding to OCR data
) -> pub bool {
    let _ = nonce;
    let computed_hash = poseidon2([similarity_score, document_hash]);
    assert(computed_hash == claim_hash, "Claim hash mismatch");
    similarity_score as u32 >= threshold as u32
}
```

---

## Client-Side Implementation

### Proof Generation API

```typescript
// apps/web/src/lib/zk/noir-prover.ts

// Age proof
const ageResult = await generateAgeProofNoir({
  birthYear: 1990,
  currentYear: 2025,
  minAge: 18,
  nonce: challengeNonce,
  documentHashField,
  claimHash
});

// Document validity proof
const docResult = await generateDocValidityProofNoir({
  expiryDate: 20271231,
  currentDate: 20251212,
  nonce: challengeNonce,
  documentHashField,
  claimHash
});

// Nationality proof
const natResult = await generateNationalityProofNoir({
  nationalityCode: "DEU",
  groupName: "EU",
  nonce: challengeNonce,
  documentHashField,
  claimHash
});
```

### Web Worker Architecture

Proof generation runs in a Web Worker to keep the UI responsive:

```text
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

Key files (apps/web/src/lib/zk):

- `noir-prover.ts` - Public API for proof generation
- `noir-worker-manager.ts` - Worker pool management
- `noir-prover.worker.ts` - Worker implementation

---

## Server-Side Verification

Server-side verification uses a **child process delegation pattern** to isolate bb.js operations:

```text
Next.js API Route              bb-worker.mjs (child process)
       │                              │
       │─── spawn Node.js process ───▶│ Initialize once
       │                              │
       │─── JSON-RPC over stdin  ────▶│
       │    (verify request)          │ Load circuit, verify proof
       │                              │
       │◀─── JSON-RPC over stdout ────│
       │     (result)                 │
```

**Why delegation?**

- **Isolation**: WASM/native operations run in separate process memory
- **Timeout handling**: Main thread can kill stale workers (configurable via `BB_WORKER_TIMEOUT_MS`)
- **Backend caching**: Worker caches `UltraHonkBackend` instances per circuit

**Key files (apps/web/src/lib/zk):**

- `noir-verifier.ts` - Spawns and communicates with worker
- `bb-worker.mjs` - Standalone Node.js script with JSON-RPC interface

### Verifier API

```typescript
// apps/web/src/lib/zk/noir-verifier.ts

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
//   verificationKeyHash: "def456...",
//   circuitId: "ultrahonk:def456...",
//   bbVersion: "0.82.2"
// }
```

### Proof Metadata

Each verification returns circuit metadata for audit trails:

- `noirVersion` - Noir compiler version
- `circuitHash` - Hash of compiled circuit
- `verificationKeyHash` - Verification key hash (audit + caching)
- `circuitId` - Stable circuit identifier derived from the verification key
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
bun run circuits:compile
```

### 5. Add to TypeScript

Update these files:

- `src/lib/zk/zk-circuit-spec.ts` - Add circuit type
- `src/lib/zk/noir-verifier.ts` - Import compiled JSON
- `src/lib/zk/noir-prover.worker.ts` - Add worker handler
- `src/lib/zk/noir-prover.ts` - Add public API function

---

## Development Commands

```bash
# Compile all circuits
cd apps/web
bun run circuits:compile

# Run circuit tests
bun run circuits:test

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

- Server issues challenge nonces via tRPC (`crypto.createChallenge` on `/api/trpc/*`)
- Nonce is bound to session/user
- Same proof cannot be replayed with different nonce

### Input Validation

Circuits include range checks:

- **Age**: birth year cannot be in the future (`birth_year <= current_year`)
- **Face match**: scores validated 0-10000 range, threshold validated 0-10000 range
- **Dates**: validated as YYYYMMDD integers

### Nonce Format

Challenge nonces are 128-bit hex strings issued by the server via `crypto.createChallenge`. They are:

- Bound to the user session
- One-time use (consumed on proof submission)
- Normalized to Field elements before circuit execution

---

## Files Reference

```text
apps/web/
├── noir-circuits/           # Noir circuit sources
│   ├── age_verification/
│   ├── doc_validity/
│   ├── face_match/
│   └── nationality_membership/
├── src/lib/zk/
│   ├── noir-prover.ts       # Client-side API
│   ├── noir-prover.worker.ts # Browser Web Worker
│   ├── noir-worker-manager.ts # Worker pool
│   ├── noir-verifier.ts     # Server-side verification (spawns bb-worker)
│   ├── bb-worker.mjs        # Child process for bb.js isolation
│   ├── zk-circuit-spec.ts   # Circuit type definitions
│   ├── nationality-data.ts  # Country codes
│   └── nationality-merkle.ts # Merkle tree utils
├── src/lib/trpc/
│   ├── routers/crypto.ts      # Nonce generation + proof verification procedures
│   └── server.ts              # Context + auth middleware
└── src/app/api/trpc/[trpc]/route.ts # tRPC HTTP handler
```
