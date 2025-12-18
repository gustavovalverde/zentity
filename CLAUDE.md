# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Zentity is a privacy-preserving KYC platform using zero-knowledge proofs (ZK), fully homomorphic encryption (FHE), and cryptographic commitments. The platform enables identity verification without storing or exposing sensitive personal information.

## Architecture

Monorepo with 3 active services communicating via REST APIs:

| Service | Location | Stack | Port |
|---------|----------|-------|------|
| Web Frontend | `apps/web` | Next.js 16, React 19, TypeScript, Human.js, Noir.js | 3000 |
| FHE Service | `apps/fhe` | Rust, Axum, TFHE-rs | 5001 |
| OCR | `apps/ocr` | Python, FastAPI, RapidOCR | 5004 |

The frontend handles:

- Face detection and liveness verification using Human.js (server-side via tfjs-node)
- **ZK proofs generated CLIENT-SIDE** using Noir.js and Barretenberg (UltraHonk)
- **tRPC API layer** with type-safe routers for all backend operations
- RP (Relying Party) redirect flow for OAuth-style integrations

## Build & Development Commands

### Web Frontend (apps/web)

```bash
bun run dev          # Start dev server
bun run build        # Production build
bun run lint         # Biome linting
bun run lint:fix     # Fix lint issues
bun run test         # Run unit tests (Vitest via Bun)
bun run test:e2e     # Run Playwright tests
```

### Noir Circuits (apps/web/noir-circuits)

```bash
# From apps/web directory:
bun run circuits:compile  # Compile all circuits
bun run circuits:test     # Run circuit tests
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

### Manual Setup (without Docker)

**Prerequisites:**

- Node.js 24+ (recommended: use `.nvmrc` or `mise`)
- Bun 1.3+ (runtime + package manager for `apps/web`)
- Rust 1.91+ (recommended: `mise`)
- Python 3.12+ (recommended: `mise`)

**Setup Toolchain:**

```bash
# Install mise (https://mise.jdx.dev)
curl https://mise.run | sh

# Install project toolchain versions
mise install
```

**Install Dependencies:**

```bash
# Frontend
cd apps/web && bun install

# OCR service
cd apps/ocr && python -m venv venv && source venv/bin/activate && pip install -r requirements.txt

# FHE Service (compiles on first run)
cd apps/fhe && cargo build --release
```

**Start Services (3 terminals):**

```bash
# Terminal 1: Frontend
cd apps/web && bun run dev

# Terminal 2: FHE Service
cd apps/fhe && cargo run --release

# Terminal 3: OCR Service
cd apps/ocr && source venv/bin/activate && uvicorn app.main:app --reload --port 5004
```

## Key Data Flow

The main verification flow is orchestrated via `trpc.identity.verify`:

1. **OCR Service** → Extract document data, generate SHA256 commitments
2. **FHE Service** → Encrypt DOB, gender, liveness score with TFHE-rs
3. **Client-side Noir** → Generate UltraHonk proofs (age, document validity, nationality, face match) in browser
4. **Human.js** (built-in) → Multi-gesture liveness challenges (smile, blink, head turns), face matching

All API calls from the client use tRPC (`trpc.crypto.*`, `trpc.liveness.*`, etc.).

**Privacy principle**: Raw PII is never stored. ZK proofs are generated CLIENT-SIDE, so sensitive data (birth year, nationality) never leaves the user's device. Only cryptographic commitments, FHE ciphertexts, and ZK proofs are persisted. Images are processed transiently.

## Code Conventions

- **Linting**: Biome (not ESLint). Run `bun run lint:fix` before commits.
- **API Layer**: tRPC with Zod validation in `src/lib/trpc/`
- **Forms**: TanStack Form with Zod validation
- **UI Components**: shadcn/ui (Radix primitives) in `src/components/ui/`
- **Database**: SQLite via `bun:sqlite` with automatic schema updates in `src/lib/db.ts`
- **Auth**: better-auth

## tRPC API Structure

All API operations go through tRPC at `/api/trpc/*`. Routers are in `src/lib/trpc/routers/`:

| Router | Purpose |
|--------|---------|
| `crypto` | FHE encryption, ZK proof verification, challenge nonces |
| `identity` | Full identity verification (document + selfie + liveness) |
| `kyc` | Document OCR processing |
| `liveness` | Multi-gesture liveness detection sessions |
| `onboarding` | Wizard state management and step validation |

**Client usage:**

```typescript
import { trpc } from "@/lib/trpc/client";

// Query
const health = await trpc.crypto.health.query();

// Mutation
const result = await trpc.liveness.verify.mutate({ sessionId, ... });
```

## RP (Relying Party) Flow

OAuth-style redirect flow for third-party integrations in `src/lib/rp-flow.ts`:

1. `/api/rp/authorize` — Validates `client_id` + `redirect_uri`, creates signed flow cookie
2. User redirected to `/rp/verify?flow=...` (clean URL, no sensitive params)
3. After verification, `/api/rp/complete` issues one-time code and redirects back
4. RP exchanges code at `/api/rp/exchange` for verification flags (no PII)

Configure allowed redirect URIs via `RP_ALLOWED_REDIRECT_URIS` env var.

## ZK Circuit Development

ZK circuits are in `apps/web/noir-circuits/` using Noir. Build process:

1. Install Noir toolchain: `curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash && noirup`
2. Compile circuits: `cd apps/web && bun run circuits:compile`
3. Test circuits: `cd apps/web && bun run circuits:test`

Circuits available:

- `age_verification` — Prove age >= threshold without revealing birth year
- `doc_validity` — Prove document not expired without revealing expiry date
- `nationality_membership` — Prove nationality in country group via Merkle proof
- `face_match` — Prove face similarity above threshold

## Environment Variables

```bash
# Backend service URLs
FHE_SERVICE_URL=http://localhost:5001
OCR_SERVICE_URL=http://localhost:5004

# Auth (required)
BETTER_AUTH_SECRET=<random-32-char-string>

# RP Flow (optional, for third-party integrations)
RP_ALLOWED_REDIRECT_URIS=https://example.com/callback,https://other.com/auth
```
