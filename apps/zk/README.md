# ZK Service

Zero-Knowledge Proof generation and verification service using snarkjs and Groth16.

## Overview

This service provides ZK proof endpoints for:
- **Age verification**: Prove age >= threshold without revealing DOB
- **Face matching**: Prove similarity >= threshold without revealing score
- **Document validity**: Prove document not expired without revealing expiry date

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

## Artifacts

Pre-compiled circuit artifacts in `/artifacts`:
- `circuit.wasm` - Age verification circuit
- `facematch/` - Face match circuit
- `docvalidity/` - Document validity circuit

Each contains:
- `.wasm` - Compiled circuit
- `_final.zkey` - Proving key
- `verification_key.json` - Verification key

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
