# ZK Nationality Membership Proofs

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

```
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

```
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
2. Each code is hashed using **Poseidon** (a ZK-friendly hash function)
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

ZK circuits work over a mathematical structure called a "finite field" (specifically BN128).

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

### Consistency Requirement

**Critical:** The hash function used in TypeScript MUST match the circuit exactly.

```
TypeScript (circomlibjs)     Circuit (circomlib)
        |                           |
        v                           v
   poseidonHash([276])  ===  Poseidon(1)([276])
```

If they don't match, the proof will always fail because the computed root won't match.

---

## The Circuit Explained

### File: `apps/zk/circuits/nationality_membership.circom`

```circom
pragma circom 2.0.0;

include "poseidon.circom";    // Poseidon hash function
include "comparators.circom"; // Equality checker
include "mux1.circom";        // 2-to-1 multiplexer for path selection
```

### Main Template

```circom
template NationalityMembership(levels) {
    // PUBLIC INPUTS (visible to verifier)
    signal input merkleRoot;    // Identifies which country group (EU, SCHENGEN, etc.)

    // PRIVATE INPUTS (hidden from verifier)
    signal input nationalityCode;     // e.g., 276 for Germany
    signal input pathElements[levels]; // Sibling hashes along the path
    signal input pathIndices[levels];  // 0 = go left, 1 = go right

    // OUTPUT
    signal output isMember;  // 1 if nationality is in the group, 0 otherwise
}
```

### The Merkle Tree Checker

```circom
template MerkleTreeChecker(levels) {
    // For each level of the tree:
    for (var i = 0; i < levels; i++) {
        // 1. Select left/right based on path index
        //    If pathIndices[i] = 0: current hash goes LEFT
        //    If pathIndices[i] = 1: current hash goes RIGHT

        // 2. Hash the pair using Poseidon
        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== left;
        hashers[i].inputs[1] <== right;

        // 3. Result becomes input to next level
        hashes[i + 1] <== hashers[i].out;
    }

    // 4. Check if computed root matches expected root
    isValid <== (computedRoot == expectedRoot);
}
```

### Why 8 Levels?

```
Levels | Max Countries | Use Case
-------|---------------|----------
4      | 16            | Small groups (FIVE_EYES)
8      | 256           | All country groups ✓
12     | 4,096         | Overkill
```

8 levels supports up to 256 countries per group, which is more than enough for any country group (EU has 27, SCHENGEN has 26, etc.).

---

## The Trusted Setup (Powers of Tau)

### What is it?

ZK-SNARKs (our proof system) require a one-time "trusted setup" ceremony. This produces:
- **Proving key** (`.zkey`): Used to generate proofs
- **Verification key** (`.json`): Used to verify proofs

### Why "Trusted"?

During the ceremony, random "toxic waste" is generated. If anyone kept this randomness, they could create fake proofs.

**Solution:** Multi-party ceremonies where many independent participants contribute randomness. As long as ONE participant destroys their randomness, the system is secure.

### Powers of Tau

The Hermez/Polygon team ran a large public ceremony with 54+ participants. The resulting `pot14.ptau` file is:
- **pot** = "Powers of Tau" (the ceremony name)
- **14** = supports circuits up to 2^14 = 16,384 constraints
- **ptau** = the file format

Our nationality circuit has ~2,178 constraints, so pot14 is sufficient.

### Our Trusted Setup Steps

```bash
# 1. Download the public ceremony result (18MB)
curl -o ptau/pot14.ptau "https://storage.googleapis.com/..."

# 2. Generate circuit-specific keys (phase 1)
snarkjs groth16 setup circuit.r1cs pot14.ptau nationality_0000.zkey

# 3. Add our contribution (phase 2)
snarkjs zkey contribute nationality_0000.zkey nationality_final.zkey

# 4. Export verification key
snarkjs zkey export verificationkey nationality_final.zkey verification_key.json
```

---

## TypeScript Integration

### File: `apps/zk/src/lib/nationality.ts`

### Building the Merkle Tree

```typescript
import { buildPoseidon } from "circomlibjs";

// 1. Initialize Poseidon (must match circuit's Poseidon)
const poseidon = await buildPoseidon();

// 2. Hash each country code
const leaf = poseidon.F.toObject(poseidon([poseidon.F.e(BigInt(276))])); // Germany

// 3. Build tree from leaves up to root
// ... pair and hash until single root remains
```

### Generating a Proof

```typescript
import * as snarkjs from "snarkjs";

// 1. Get Merkle proof (path from leaf to root)
const merkleProof = await getMerkleProof("DEU", euTree);

// 2. Build circuit inputs
const circuitInput = {
    merkleRoot: euMerkleRoot,
    nationalityCode: "276",
    pathElements: merkleProof.pathElements,
    pathIndices: merkleProof.pathIndices,
};

// 3. Generate the ZK proof
const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    circuitInput,
    "nationality_membership.wasm",  // Compiled circuit
    "nationality_final.zkey"         // Proving key
);
```

### Verifying a Proof

```typescript
// The verifier only sees:
// - publicSignals[0]: "1" (isMember = true)
// - publicSignals[1]: merkleRoot (identifies EU group)

// They do NOT see:
// - Which country code (276 for Germany)
// - The path through the tree

const isValid = await snarkjs.groth16.verify(
    verificationKey,
    publicSignals,
    proof
);
```

---

## Country Groups

### Supported Groups

| Group | Countries | Example Members |
|-------|-----------|-----------------|
| `EU` | 27 | DEU, FRA, ITA, ESP, POL... |
| `SCHENGEN` | 26 | EU minus IRL + CHE, NOR, ISL |
| `EEA` | 30 | EU + ISL, NOR, LIE |
| `LATAM` | 7 | DOM, MEX, BRA, ARG, CHL, COL, PER |
| `FIVE_EYES` | 5 | USA, GBR, CAN, AUS, NZL |

### Each Group Has a Unique Root

```typescript
const EU_ROOT = "17892341...";        // Identifies EU membership tree
const SCHENGEN_ROOT = "98234123...";  // Different tree, different root
```

A verifier can check which group a proof is for by comparing the `merkleRoot` in the public signals.

---

## Performance

| Operation | Time | Notes |
|-----------|------|-------|
| Build Merkle Tree | ~50ms | One-time per group |
| Generate Proof | 200-700ms | Depends on group size |
| Verify Proof | <50ms | Fast for on-chain |
| Proof Size | ~800 bytes | Compact |

### Why Variable Generation Time?

First proof for a group takes longer because:
1. Tree must be built (cached afterward)
2. Poseidon hasher must initialize (cached afterward)

Subsequent proofs for the same group are faster (~200ms).

---

## Security Properties

### What the Proof Guarantees

1. **Soundness:** Cannot prove membership for a country NOT in the group
2. **Zero-Knowledge:** Verifier learns ONLY that the country is in the group
3. **Non-Interactive:** Proof can be verified without interaction with prover

### What the Proof Does NOT Guarantee

1. **Liveness:** Doesn't prove you're actually from that country (need passport verification)
2. **Uniqueness:** Same person could generate multiple proofs
3. **Timeliness:** Proof doesn't expire (could add timestamp)

### Integration with KYC

In Zentity's flow:
1. OCR extracts nationality from passport (e.g., "DEU")
2. Passport authenticity verified via MRZ checksums
3. Face match verifies it's your passport
4. THEN we generate the ZK nationality proof
5. Only the proof is stored, not "DEU"

---

## API Usage

### Generate Proof

```bash
curl -X POST http://localhost:5002/nationality/generate \
  -H "Content-Type: application/json" \
  -d '{"nationalityCode": "DEU", "groupName": "EU"}'
```

Response:
```json
{
  "proof": { /* Groth16 proof */ },
  "publicSignals": ["1", "17892341..."],
  "isMember": true,
  "groupName": "EU",
  "merkleRoot": "17892341...",
  "generationTimeMs": 234
}
```

### Verify Proof

```bash
curl -X POST http://localhost:5002/nationality/verify \
  -H "Content-Type: application/json" \
  -d '{"proof": {...}, "publicSignals": ["1", "17892341..."]}'
```

### Check Group Membership (No Proof)

```bash
curl "http://localhost:5002/nationality/check?code=DEU&group=EU"
```

Response: `{"isMember": true}`

---

## Files Reference

```
apps/zk/
├── circuits/
│   └── nationality_membership.circom  # The ZK circuit
├── artifacts/
│   └── nationality/
│       ├── nationality_membership_js/
│       │   └── nationality_membership.wasm  # Compiled circuit
│       ├── nationality_final.zkey           # Proving key
│       └── verification_key.json            # Verification key
├── ptau/
│   └── pot14.ptau                           # Powers of Tau
└── src/
    └── lib/
        └── nationality.ts                   # TypeScript implementation
```

---

## Further Reading

- [Poseidon Hash Paper](https://eprint.iacr.org/2019/458.pdf)
- [Groth16 Paper](https://eprint.iacr.org/2016/260.pdf)
- [circom Documentation](https://docs.circom.io/)
- [snarkjs Documentation](https://github.com/iden3/snarkjs)
