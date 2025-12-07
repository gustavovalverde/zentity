# Zentity

**Privacy-preserving KYC platform** using zero-knowledge proofs, fully homomorphic encryption, and cryptographic commitments.

## What is Zentity?

Zentity is a privacy-preserving KYC platform that enables identity verification for banks, crypto exchanges, and fintechs—without storing or accessing sensitive personal information. It uses cutting-edge cryptographic techniques to:

- **Verify age** without revealing date of birth (ZK proofs + FHE)
- **Verify nationality group membership** without revealing country (ZK Merkle proofs)
- **Verify liveness** without revealing biometric scores (FHE threshold comparisons)
- **Prove accredited investor status** without revealing income (ZK proofs)
- **Screen against sanctions lists** without exposing identity (ZK proofs)
- **Match faces** to ID documents without storing biometrics
- **Enable regulatory compliance** (FATF, MiCA, BSA/AML) with zero PII storage

## Project Structure

```
zentity/
├── apps/
│   └── web/                  # Next.js 16 frontend
├── services/
│   ├── fhe/                  # Rust/Axum - Homomorphic Encryption
│   ├── zk/                   # TypeScript/Express - Zero-Knowledge Proofs
│   ├── liveness/             # Python/FastAPI - Face/Liveness Detection
│   └── ocr/                  # Python/FastAPI - Document OCR
├── packages/                 # Shared libraries (future)
├── tooling/
│   └── bruno-collection/     # API testing
├── infra/
│   └── docker-compose.yml    # Container orchestration
└── docs/                     # Documentation
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (Next.js 16)                       │
│                         http://localhost:3000                       │
│   ┌─────────────────────────────────────────────────────────────┐   │
│   │ /api/crypto/*    /api/liveness/*    /api/kyc/*    /api/identity/* │
│   └──────────┬────────────────┬──────────────┬───────────────┬──┘   │
└──────────────┼────────────────┼──────────────┼───────────────┼──────┘
               │                │              │               │
    ┌──────────▼──────────┐  ┌──▼──────────┐  │  ┌────────────▼───────┐
    │   FHE SERVICE       │  │ ZK SERVICE  │  │  │   OCR SERVICE      │
    │   Rust/Axum         │  │ TS/Express  │  │  │   Python/FastAPI   │
    │   Port 5001         │  │ Port 5002   │  │  │   Port 5004        │
    │                     │  │             │  │  │                    │
    │ • /encrypt          │  │ • /generate │  │  │ • /process         │
    │ • /verify-age       │  │ • /verify   │  │  │ • /extract         │
    │ • /keys/generate    │  │ • /facematch│  │  │ • /ocr             │
    │ • /encrypt-liveness │  │ • /docvalid │  │  │                    │
    │ • /verify-liveness  │  │ • /national │  │  │                    │
    │ TFHE-rs v1.4.2      │  │ snarkjs     │  │  │ RapidOCR (PPOCRv5) │
    └─────────────────────┘  └─────────────┘  │  └────────────────────┘
                                              │
                            ┌─────────────────▼────────────────────────┐
                            │        LIVENESS SERVICE                  │
                            │        Python/FastAPI                    │
                            │        Port 5003                         │
                            │                                          │
                            │ • /liveness      • /face-match           │
                            │ • /detect        • /face-match-proof     │
                            │ • /antispoof     • /verify               │
                            │ • /smile-check   • /blink-check          │
                            │ • /passive-monitor                       │
                            │                                          │
                            │ DeepFace, FasNet, UniFace               │
                            └──────────────────────────────────────────┘
```

## Technology Stack

| Service | Language | Framework | Crypto Library | Port |
|---------|----------|-----------|----------------|------|
| Frontend | TypeScript | Next.js 16 | - | 3000 |
| FHE Service | Rust | Axum | TFHE-rs v1.4.2 | 5001 |
| ZK Service | TypeScript | Express | snarkjs (Groth16) | 5002 |
| Liveness | Python 3.10+ | FastAPI | DeepFace | 5003 |
| OCR | Python 3.10+ | FastAPI | SHA256 | 5004 |

## Privacy-First Design

### What We Store

| Data | Storage Type | Purpose |
|------|--------------|---------|
| Birth Year | FHE ciphertext | Age verification at any threshold |
| Full DOB | FHE ciphertext (u32) | Precise age calculation (YYYYMMDD) |
| Liveness Score | FHE ciphertext (u16) | Privacy-preserving anti-spoof threshold |
| Gender | FHE ciphertext (u8) | ISO 5218 encoded, FHE comparisons |
| Name | SHA256 commitment | Verification without storage |
| Document # | SHA256 commitment | Duplicate detection |
| Nationality | SHA256 commitment | ISO 3166-1 alpha-3 code commitment |
| Age Proof | ZK proof (JSON) | Multiple thresholds: 18, 21, 25 |
| Face Match Proof | ZK proof | Shareable proof of identity |
| Doc Validity Proof | ZK proof | Proves document not expired |
| Nationality Group Proof | ZK Merkle proof | Proves EU/EEA/SCHENGEN membership |

### What We NEVER Store

| Data | Reason |
|------|--------|
| Document Image | Processed transiently, discarded |
| Selfie Image | Processed transiently, discarded |
| Face Embeddings | Discarded after comparison |
| Liveness Signals | Discarded after analysis |
| Actual Name/DOB | Only commitments stored |

## Quick Start

### Prerequisites

- Node.js 20+ (managed via mise)
- Rust 1.91+ (managed via mise)
- Python 3.12+ (managed via mise)
- pnpm

### 0. Setup Toolchain (Recommended)

```bash
# Install mise (https://mise.jdx.dev)
curl https://mise.run | sh

# Install project toolchain versions
mise install
```

### 1. Install Dependencies

```bash
# Frontend
cd apps/web && pnpm install

# ZK Service
cd services/zk && pnpm install

# Python services
cd services/ocr && python -m venv venv && source venv/bin/activate && pip install -r requirements.txt
cd services/liveness && python -m venv venv && source venv/bin/activate && pip install -r requirements.txt

# FHE Service (Rust - compiles on first run)
cd services/fhe && cargo build --release
```

### 2. Start Services

```bash
# Terminal 1: Frontend
cd apps/web && pnpm dev

# Terminal 2: FHE Service
cd services/fhe && cargo run --release

# Terminal 3: ZK Service
cd services/zk && pnpm start

# Terminal 4: OCR Service
cd services/ocr && source venv/bin/activate && uvicorn app.main:app --port 5004

# Terminal 5: Liveness Service
cd services/liveness && source venv/bin/activate && uvicorn app.main:app --port 5003
```

Or use Docker Compose:

```bash
cd infra && docker-compose up
```

### 3. Access the App

Open http://localhost:3000

## Documentation

| Document | Description |
|----------|-------------|
| [Executive Summary](docs/executive-summary.md) | Business overview and value proposition |
| [KYC Data Architecture](docs/kyc-data-architecture.md) | FHE vs ZK vs Hash decision framework |
| [MVP Specification](docs/MVP.md) | Feature scope and requirements |
| [Liveness Architecture](docs/liveness-architecture.md) | Anti-spoofing and face matching design |
| [Frontend UX](docs/frontend-ui-ux.md) | Onboarding flow UX best practices |
| [API Collection](tooling/bruno-collection/README.md) | Bruno API testing collection |

## Two-Tier Architecture

### Tier 1: Non-Regulated (Age-Gated Services)

```
User → Zentity: "Verify me"
Zentity → User: age_proof (ZK), face_match_proof (ZK)
User → Retailer: "Here's my age proof"
Retailer → Verify: verify(proof) → true/false

NO PII EVER SHARED - Retailer only knows: user is over 21, is a real person
```

### Tier 2: Regulated Entities (Banks, Exchanges)

```
User → Zentity: Complete verification
User → Exchange: "I want to onboard"
Exchange → User (via Zentity): Request PII disclosure
Zentity → Exchange: Encrypted package (RSA-OAEP + AES-GCM)
  - Name, DOB, Nationality (E2E encrypted)
  - Face match ZK proof
  - Liveness attestation

Exchange stores: PII (regulatory requirement)
Zentity stores: Only commitments (minimal liability)
Biometrics: NEVER stored by either party
```

## ZK Proof Circuits

| Circuit | Purpose | Public Signals |
|---------|---------|----------------|
| Age Proof | Prove age >= threshold | `currentYear`, `minAge`, `isValid` |
| Face Match | Prove similarity >= threshold | `threshold`, `isMatch` |
| Document Validity | Prove not expired | `currentDate`, `isValid` |
| Nationality Membership | Prove nationality in group | `merkleRoot`, `isMember` |

### Supported Country Groups

The Nationality Membership circuit uses Merkle tree proofs to verify membership in predefined country groups without revealing the specific country:

| Group | Countries | Use Case |
|-------|-----------|----------|
| EU | 27 countries | EU citizen verification |
| EEA | 30 countries | European work authorization |
| SCHENGEN | 25 countries | Travel zone verification |
| LATAM | 7 countries | Regional compliance |
| FIVE_EYES | 5 countries | Intelligence alliance nations |

## Business Use Cases

### Privacy-Preserving Liveness Verification

Traditional liveness detection exposes exact anti-spoof confidence scores. Zentity encrypts liveness scores using FHE, enabling threshold comparisons without revealing the actual score:

```
User → Liveness Service: Submit face capture
Liveness Service → FHE: encrypt(score=0.85)
FHE → Storage: ciphertext (score hidden)
Verifier → FHE: verify(ciphertext >= 0.3)
FHE → Verifier: true/false (score never revealed)
```

**Benefits:**
- Prevents gaming the system by knowing exact thresholds
- Protects biometric scoring algorithms from reverse engineering
- Enables different threshold policies per use case

### Nationality Group Membership

Proving citizenship often requires revealing exact nationality, which can lead to discrimination. Zentity's ZK Merkle proofs enable group membership verification:

```
User → Zentity: "Prove I'm EU citizen"
Zentity → ZK Service: Generate Merkle proof (nationality in EU tree)
ZK Service → Verifier: proof + merkleRoot (EU identifier)
Verifier: Knows user is EU citizen, but NOT which of 27 countries
```

**Use Cases:**
- **EU Right to Work**: Verify employment authorization without revealing specific nationality
- **Schengen Travel**: Prove travel zone eligibility without passport country disclosure
- **Regional Compliance**: Meet LATAM or EEA requirements without over-sharing
- **Anti-Discrimination**: Prevent nationality-based bias in hiring/services

### Multi-Threshold Age Verification

Different jurisdictions require different age thresholds. Zentity generates multiple age proofs efficiently:

| Threshold | Use Case |
|-----------|----------|
| 18+ | General adult verification (EU, most jurisdictions) |
| 21+ | US alcohol/cannabis, car rental |
| 25+ | Premium car rental, certain financial products |

All proofs use the same FHE-encrypted DOB, generating new proofs without re-verification.

## License

MIT

## Contributing

Contributions welcome! Please read the contributing guidelines before submitting PRs.
