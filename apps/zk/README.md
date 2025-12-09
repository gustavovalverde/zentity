# ZK Service

Zero-Knowledge Proof generation and verification service using snarkjs and Groth16.

## Overview

This service provides ZK proof endpoints for:
- **Age verification**: Prove age >= threshold without revealing DOB
- **Face matching**: Prove similarity >= threshold without revealing score
- **Document validity**: Prove document not expired without revealing expiry date
- **Nationality membership**: Prove nationality is in a country group (EU, SCHENGEN, etc.) without revealing specific country

## Documentation

For a deep dive into how ZK proofs work and the nationality membership implementation:
- **[ZK Nationality Proofs Technical Guide](../../docs/zk-nationality-proofs.md)** - Explains Merkle trees, Poseidon hash, trusted setup, and the circuit architecture

## Technology

- **Language**: TypeScript
- **Framework**: Express
- **Crypto Library**: snarkjs (Groth16)
- **Port**: 5002

## Circuits

### Age Proof Circuit
```circom
template AgeCheck() {
    signal input birthYear;     // PRIVATE - never revealed
    signal input currentYear;   // PUBLIC
    signal input minAge;        // PUBLIC (e.g., 18)
    signal output isValid;      // 1 if age >= minAge
}
```

### Face Match Circuit
```circom
template FaceMatchProof() {
    signal input similarityScore;  // PRIVATE (e.g., 73 = 0.73)
    signal input threshold;        // PUBLIC (e.g., 60 = 0.60)
    signal output isMatch;
}
```

### Document Validity Circuit
```circom
template DocumentValidity() {
    signal input expiryDate;    // PRIVATE (YYYYMMDD)
    signal input currentDate;   // PUBLIC
    signal output isValid;
}
```

### Nationality Membership Circuit
```circom
template NationalityMembership(depth) {
    signal input merkleRoot;           // PUBLIC - identifies the country group
    signal input nationalityCode;      // PRIVATE - ISO 3166-1 numeric code
    signal input pathElements[depth];  // PRIVATE - Merkle proof siblings
    signal input pathIndices[depth];   // PRIVATE - left/right path
    signal output isMember;            // 1 if nationality in group
}
```

Uses **Poseidon hash** (ZK-friendly) for Merkle tree construction. Country groups:
- `EU` - 27 European Union countries
- `SCHENGEN` - 26 Schengen Area countries
- `EEA` - 30 European Economic Area countries
- `LATAM` - Latin American countries
- `FIVE_EYES` - USA, GBR, CAN, AUS, NZL

## Endpoints

### `GET /health`
Service health check.

### Age Verification

#### `POST /generate-proof`
Generate age verification ZK proof.

**Request:**
```json
{
  "birthYear": 1990,
  "currentYear": 2024,
  "minAge": 18
}
```

**Response:**
```json
{
  "proof": { /* Groth16 proof */ },
  "publicSignals": ["2024", "18", "1"],
  "isOver18": true,
  "generationTimeMs": 150
}
```

#### `POST /verify-proof`
Verify an age proof.

**Request:**
```json
{
  "proof": { /* Groth16 proof */ },
  "publicSignals": ["2024", "18", "1"]
}
```

### Face Matching

#### `POST /facematch/generate`
Generate face match ZK proof.

**Request:**
```json
{
  "similarityScore": 0.73,
  "threshold": 0.6
}
```

**Response:**
```json
{
  "proof": { /* Groth16 proof */ },
  "publicSignals": ["60", "1"],
  "isMatch": true,
  "threshold": 0.6,
  "generationTimeMs": 120,
  "solidityCalldata": "0x..."
}
```

#### `POST /facematch/verify`
Verify a face match proof.

### Document Validity

#### `POST /docvalidity/generate`
Generate document validity ZK proof.

**Request:**
```json
{
  "expiryDate": "2025-12-31"
}
```

**Response:**
```json
{
  "proof": { /* Groth16 proof */ },
  "publicSignals": ["20241206", "1"],
  "isValid": true,
  "currentDate": 20241206,
  "generationTimeMs": 110,
  "solidityCalldata": "0x..."
}
```

#### `POST /docvalidity/verify`
Verify a document validity proof.

### Nationality Membership

#### `POST /nationality/generate`
Generate nationality membership ZK proof.

**Request:**
```json
{
  "nationalityCode": "DEU",
  "groupName": "EU"
}
```

**Response:**
```json
{
  "proof": { /* Groth16 proof */ },
  "publicSignals": ["1", "123456789..."],
  "isMember": true,
  "groupName": "EU",
  "merkleRoot": "123456789...",
  "generationTimeMs": 150,
  "solidityCalldata": "0x..."
}
```

#### `POST /nationality/verify`
Verify a nationality membership proof.

#### `GET /nationality/groups`
List all available country groups.

**Response:**
```json
{
  "groups": [
    { "name": "EU", "merkleRoot": "...", "countryCount": 27 },
    { "name": "SCHENGEN", "merkleRoot": "...", "countryCount": 26 }
  ]
}
```

#### `GET /nationality/groups/:name`
Get countries in a specific group.

#### `GET /nationality/check?code=DEU&group=EU`
Check if a country is in a group (without generating proof).

## Artifacts

Pre-compiled circuit artifacts in `/artifacts`:
- `circuit.wasm` - Age verification circuit
- `facematch/` - Face match circuit
- `docvalidity/` - Document validity circuit
- `nationality/` - Nationality membership circuit (requires compilation)

Each contains:
- `.wasm` - Compiled circuit
- `_final.zkey` - Proving key
- `verification_key.json` - Verification key

### Circuit Compilation

To compile circuits from source (requires circom):

```bash
# Install circom compiler
cargo install --git https://github.com/iden3/circom.git

# Download Powers of Tau (one-time)
mkdir -p ptau
wget https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_14.ptau -O ptau/pot14.ptau

# Compile nationality circuit
pnpm run circuit:build:nationality
```

### Key Dependencies

| Package | Purpose |
|---------|---------|
| `snarkjs` | Groth16 proof generation/verification |
| `circomlibjs` | Poseidon hash function (matches circuit) |
| `circomlib` | Circuit library (Poseidon, comparators) |

## Development

### Prerequisites
- Node.js 18+
- pnpm

### Install
```bash
pnpm install
```

### Build
```bash
pnpm build
```

### Run
```bash
pnpm start
```

### Development Mode
```bash
pnpm dev
```

## Docker

```bash
docker build -t zentity-zk-service .
docker run -p 5002:5002 zentity-zk-service
```

## On-Chain Verification

Each proof includes `solidityCalldata` for on-chain verification using a Groth16 verifier contract.
