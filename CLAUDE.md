# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Zentity is a privacy-preserving KYC platform using zero-knowledge proofs (ZK), fully homomorphic encryption (FHE), and cryptographic commitments. The platform enables identity verification without storing or exposing sensitive personal information.

## Architecture

Monorepo with 4 services communicating via REST APIs:

| Service | Location | Stack | Port |
|---------|----------|-------|------|
| Web Frontend | `apps/web` | Next.js 16, React 19, TypeScript, Human.js | 3000 |
| FHE Service | `apps/fhe` | Rust, Axum, TFHE-rs | 5001 |
| ZK Service | `apps/zk` | TypeScript, Express, snarkjs | 5002 |
| OCR | `apps/ocr` | Python, FastAPI, RapidOCR | 5004 |

The frontend handles face detection and liveness verification using Human.js (server-side via tfjs-node), and proxies other API calls to backend services via Next.js API routes (`/api/crypto/*`, `/api/liveness/*`, `/api/kyc/*`, `/api/identity/*`).

## Build & Development Commands

### Web Frontend (apps/web)
```bash
pnpm dev          # Start dev server
pnpm build        # Production build
pnpm lint         # Biome linting
pnpm lint:fix     # Fix lint issues
pnpm test         # Run vitest
pnpm test:e2e     # Run Playwright tests
```

### ZK Service (apps/zk)
```bash
pnpm dev          # Start with tsx watch
pnpm build        # Compile TypeScript
pnpm test         # Run vitest
pnpm circuit:build:nationality  # Compile ZK circuits
```

### FHE Service (apps/fhe)
```bash
cargo build --release    # Build
cargo run --release      # Run (compiles TFHE keys on first start)
cargo test               # Run tests
```

### OCR Service (apps/ocr)
```bash
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --port 5004 --reload
pytest
```

### Docker (all services)
```bash
docker-compose up        # Start all services
docker-compose up -d     # Detached mode
```

## Key Data Flow

The main verification endpoint is `POST /api/identity/verify` which orchestrates:
1. OCR Service → Extract document data, generate SHA256 commitments
2. FHE Service → Encrypt DOB, gender, liveness score with TFHE-rs
3. ZK Service → Generate Groth16 proofs (age, document validity, nationality)
4. Human.js (built-in) → Multi-gesture liveness challenges (smile, blink, head turns), face matching

**Privacy principle**: Raw PII is never stored. Only cryptographic commitments, FHE ciphertexts, and ZK proofs are persisted. Images are processed transiently.

## Code Conventions

- **Linting**: Biome (not ESLint). Run `pnpm lint:fix` before commits.
- **Forms**: TanStack Form with Zod validation
- **UI Components**: shadcn/ui (Radix primitives) in `src/components/ui/`
- **Database**: better-sqlite3 with auto-migration in `src/lib/db.ts`
- **Auth**: better-auth

## ZK Circuit Development

ZK circuits are in `apps/zk/circuits/` using Circom. Build process:
1. Requires `circom` compiler (install via `cargo install --git https://github.com/iden3/circom.git`)
2. Requires Powers of Tau file in `apps/zk/ptau/pot14.ptau`
3. Run `pnpm circuit:build:nationality` to compile circuit → generate zkey → export verification key

## Service URLs (Environment Variables)

```
FHE_SERVICE_URL=http://localhost:5001
ZK_SERVICE_URL=http://localhost:5002
OCR_SERVICE_URL=http://localhost:5004
```
