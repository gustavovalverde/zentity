# Zentity

Privacy-preserving identity verification using zero-knowledge proofs, fully homomorphic encryption, and cryptographic commitments.

## What is Zentity?

Zentity is a self-sovereign identity verification platform that proves identity claims without exposing personal data. It uses cutting-edge cryptographic techniques to:

- **Verify age** without revealing your date of birth (ZK proofs + FHE)
- **Match your face** to ID documents without storing biometrics
- **Prove document validity** without exposing expiration dates
- **Enable regulatory compliance** with end-to-end encrypted disclosure

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
    │                     │  │ • /docvalid │  │  │                    │
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
| Name | SHA256 commitment | Verification without storage |
| Document # | SHA256 commitment | Duplicate detection |
| Age Proof | ZK proof | Shareable proof of age >= 18 |
| Face Match Proof | ZK proof | Shareable proof of identity |

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
| [MVP Specification](docs/MVP.md) | Feature scope and requirements |
| [Liveness Architecture](docs/liveness-architecture.md) | Anti-spoofing and face matching design |
| [OCR Solutions](docs/ocr-solutions-evaluation.md) | Document OCR evaluation for Dominican IDs |
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

## License

MIT

## Contributing

Contributions welcome! Please read the contributing guidelines before submitting PRs.
