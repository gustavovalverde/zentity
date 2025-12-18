# ZK Nationality Membership Proofs

> **Related docs:** [System Architecture](architecture.md) | [ZK Architecture](zk-architecture.md) | [README](../README.md)

## The Problem

In traditional KYC systems, when a service needs to verify that a user is from an EU country, they must:

1. See the user's actual passport
2. Extract the nationality field (e.g., "Germany")
3. Check if "Germany" is in the EU list

**The privacy problem:** The service now knows the user is German. This information can be:

- Leaked in data breaches
- Sold to third parties
- Used for profiling or discrimination

**What if we could prove "I'm from an EU country" without revealing which one?**

---

## The Solution: Zero-Knowledge Merkle Membership Proofs

A Zero-Knowledge (ZK) proof allows someone to prove a statement is true without revealing the underlying data.

### Our Approach

```text
Traditional:        "I'm German" → Service knows: German
ZK Proof:           "I'm in the EU" → Service knows: EU member (but not which country)
```

We use a **Merkle tree** structure where:

- Each EU country is a "leaf" in the tree
- The tree has a unique "root hash" that identifies the EU group
- A user can prove their country is a leaf in the tree without revealing which leaf

---

## How Merkle Trees Work

### Building the Tree

```text
                    Root Hash (public)
                   /              \
            Hash(A+B)          Hash(C+D)
           /        \         /        \
      Hash(DEU)  Hash(FRA) Hash(ITA) Hash(ESP)
         |          |         |         |
        276        250       380       724
     (Germany)  (France)  (Italy)   (Spain)
```

1. Each country code is converted to its ISO numeric code (DEU → 276)
2. Each code is hashed using **Poseidon2** (a ZK-friendly hash function)
3. Hashes are paired and hashed together, building up to a single root

### The Merkle Root

The root hash uniquely identifies the set of countries:

- EU has one root
- SCHENGEN has a different root
- LATAM has another different root

**Key insight:** You can publish the root without revealing what's in the tree.

### Proving Membership

To prove Germany (DEU) is in the EU tree, you provide:

1. Your country code (private): 276
2. The "sibling" hashes along the path to the root (private)
3. The path directions - left or right at each level (private)
4. The expected root (public)

The circuit:

1. Hashes your country code
2. Combines it with each sibling hash following the path
3. Checks if the result equals the expected root

If it matches → your country IS in the set (but verifier doesn't know which one!)

---

## Why Poseidon Hash Instead of SHA256?

### The Problem with SHA256 in ZK Circuits

ZK circuits work over a mathematical structure called a "finite field."

SHA256 uses:

- Bitwise operations (XOR, AND, OR)
- Bit rotations
- 32-bit integer arithmetic

These operations are **extremely expensive** in ZK circuits because:

- Each bit operation becomes many "constraints"
- A single SHA256 hash = ~25,000 constraints
- Our 8-level Merkle tree would need ~200,000 constraints just for hashing

### Poseidon: Designed for ZK

Poseidon hash was specifically designed for ZK circuits:

- Uses field arithmetic (addition, multiplication mod prime)
- These operations are "native" to ZK circuits
- A single Poseidon hash = ~200-300 constraints
- 8-level Merkle tree = ~2,500 constraints total

**Result:** 100x more efficient, faster proof generation, smaller proofs.

---

## The Noir Circuit

### File: `apps/web/noir-circuits/nationality_membership/src/main.nr`

```noir
use nodash::poseidon2;

global TREE_DEPTH: u32 = 8;

fn main(
    nationality_code: Field,                    // Private: actual nationality code
    merkle_root: pub Field,                     // Public: identifies the country group
    path_elements: [Field; TREE_DEPTH],         // Private: Merkle path siblings
    path_indices: [u1; TREE_DEPTH],             // Private: path directions
    nonce: pub Field                            // Public: challenge nonce (replay resistance)
) -> pub bool {
    // Nonce is included as public input for replay resistance
    let _ = nonce;

    // Hash the nationality code to get the leaf
    let leaf = poseidon2([nationality_code]);

    // Compute the root by traversing up the tree
    let mut current = leaf;

    for i in 0..TREE_DEPTH {
        let sibling = path_elements[i];

        // Order the pair based on path index (0=current is left, 1=current is right)
        let (left, right) = if path_indices[i] == 0 {
            (current, sibling)
        } else {
            (sibling, current)
        };

        // Hash the pair to get parent
        current = poseidon2([left, right]);
    }

    // Check if computed root matches expected root
    current == merkle_root
}
```

### Why 8 Levels?

```text
Levels | Max Countries | Use Case
-------|---------------|----------
4      | 16            | Small groups (FIVE_EYES)
8      | 256           | All country groups
12     | 4,096         | Overkill
```

8 levels supports up to 256 countries per group, which is more than enough for any country group (EU has 27, SCHENGEN has 26, etc.).

---

## TypeScript Integration

### Client-Side Proof Generation

Proofs are generated entirely in the browser using Web Workers:

```typescript
// apps/web/src/lib/noir-prover.ts

import {
  generateNationalityProofClientWorker,
} from "./noir-worker-manager";

export async function generateNationalityProofNoir(
  input: NationalityProofInput,
): Promise<NoirProofResult> {
  if (typeof window === "undefined") {
    throw new Error("ZK proofs can only be generated in the browser");
  }

  const startTime = performance.now();

  const result = await generateNationalityProofClientWorker({
    nationalityCode: input.nationalityCode,
    groupName: input.groupName,
    nonce: input.nonce,
  });

  return {
    proof: result.proof,
    publicInputs: result.publicInputs,
    generationTimeMs: performance.now() - startTime,
  };
}
```

### Server-Side Verification

```typescript
// apps/web/src/lib/noir-verifier.ts

import { UltraHonkBackend } from "@aztec/bb.js";
import nationalityCircuit from "@/noir-circuits/nationality_membership/target/nationality_membership.json";

export async function verifyNoirProof(
  input: NoirVerifyInput,
): Promise<NoirVerifyResult> {
  const backend = new UltraHonkBackend(
    circuit.bytecode,
    { crsPath: getBbCrsPath() },
  );

  const proofBytes = Buffer.from(input.proof, "base64");

  const isValid = await backend.verifyProof({
    proof: new Uint8Array(proofBytes),
    publicInputs: input.publicInputs,
  });

  return {
    isValid,
    verificationTimeMs: Date.now() - startTime,
    circuitType: input.circuitType,
    noirVersion: meta.noirVersion,
    circuitHash: meta.circuitHash,
    bbVersion,
  };
}
```

---

## Country Groups

### Supported Groups

| Group | Countries | Example Members |
|-------|-----------|-----------------|
| `EU` | 27 | DEU, FRA, ITA, ESP, POL... |
| `SCHENGEN` | 26 | EU minus IRL/CYP/BGR/ROU + CHE, NOR, ISL, LIE |
| `EEA` | 30 | EU + ISL, NOR, LIE |
| `LATAM` | 19 | DOM, MEX, BRA, ARG, CHL, COL, PER... |
| `FIVE_EYES` | 5 | USA, GBR, CAN, AUS, NZL |

### Each Group Has a Unique Root

```typescript
// apps/web/src/lib/nationality-data.ts

export const COUNTRY_GROUPS: Record<string, string[]> = {
  EU: ["AUT", "BEL", "BGR", "HRV", "CYP", ...],
  SCHENGEN: ["AUT", "BEL", "CZE", "DNK", ...],
  LATAM: ["ARG", "BOL", "BRA", "CHL", ...],
  FIVE_EYES: ["AUS", "CAN", "NZL", "GBR", "USA"],
};
```

The Merkle root is computed from each group's country codes and uniquely identifies the set.

---

## Performance

| Operation | Time | Notes |
|-----------|------|-------|
| Build Merkle Tree | ~50ms | One-time per group (cached) |
| Generate Proof | 100-300ms | Client-side, Web Worker |
| Verify Proof | <50ms | Server-side, bb.js |
| Proof Size | ~2KB | UltraHonk proof |

Proofs are generated in Web Workers to keep the UI responsive.

---

## Security Properties

### What the Proof Guarantees

1. **Soundness:** Cannot prove membership for a country NOT in the group
2. **Zero-Knowledge:** Verifier learns ONLY that the country is in the group
3. **Non-Interactive:** Proof can be verified without interaction with prover
4. **Replay Resistance:** Nonce binding prevents proof reuse

### What the Proof Does NOT Guarantee

1. **Liveness:** Doesn't prove you're actually from that country (need passport verification)
2. **Uniqueness:** Same person could generate multiple proofs
3. **Timeliness:** Nonce provides session binding, not timestamp

### Integration with KYC

In Zentity's flow:

1. OCR extracts nationality from passport (e.g., "DEU")
2. Passport authenticity verified via MRZ checksums
3. Face match verifies it's your passport
4. ZK nationality proof is generated **client-side** in the browser
5. Only the proof is sent to server and stored, never "DEU"

---

## Files Reference

```text
apps/web/
├── noir-circuits/
│   └── nationality_membership/
│       ├── Nargo.toml
│       ├── src/main.nr           # Noir circuit source
│       └── target/
│           └── nationality_membership.json  # Compiled ACIR
├── src/lib/
│   ├── nationality-data.ts       # Country codes and group definitions
│   ├── nationality-merkle.ts     # Merkle tree construction (Poseidon2)
│   ├── noir-prover.ts            # Client-side proof generation API
│   ├── noir-prover.worker.ts     # Web Worker for proof generation
│   └── noir-verifier.ts          # Server-side verification
```

---

## Further Reading

- [Poseidon Hash Paper](https://eprint.iacr.org/2019/458.pdf)
- [Noir Documentation](https://noir-lang.org/docs)
- [Barretenberg (bb.js)](https://github.com/AztecProtocol/aztec-packages/tree/master/barretenberg)
