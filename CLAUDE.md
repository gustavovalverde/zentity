# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Zentity is a privacy-preserving compliance/KYC platform using zero-knowledge proofs (ZK), fully homomorphic encryption (FHE), and cryptographic commitments. The platform enables identity verification without storing or exposing sensitive personal information.

## Key Documentation

**Understanding the privacy model (read these first):**

- [Attestation & Privacy Architecture](docs/attestation-privacy-architecture.md) — Attestation schema, data classification, privacy boundaries
- [Tamper Model](docs/tamper-model.md) — Integrity controls and threat model

**For Web3/blockchain integration:**

- [Web3 Architecture](docs/web3-architecture.md) — FHEVM hooks, encryption/decryption flows
- [Web2 to Web3 Transition](docs/web2-to-web3-transition.md) — End-to-end attestation flow
- [Blockchain Setup](docs/blockchain-setup.md) — Network config, contract deployment

**For detailed system design:**

- [Architecture](docs/architecture.md) — Components, data flow, storage model
- [ZK Architecture](docs/zk-architecture.md) — Noir circuits and proving

## Architecture

Monorepo with 3 active services communicating via REST APIs:

| Service | Location | Stack | Port |
|---------|----------|-------|------|
| Web Frontend | `apps/web` | Next.js 16, React 19, TypeScript, Human.js, Noir.js | 3000 |
| FHE Service | `apps/fhe` | Rust, Axum, TFHE-rs, ReDB | 5001 |
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

### E2E Notes (Hardhat vs Sepolia)

**Hardhat (default):**

- `bun run test:e2e` starts its own dev server + Hardhat node via `e2e/automation/start-web3-dev.js`.
- Contracts repo path defaults to `../zama/zentity-fhevm-contracts` (override with `E2E_CONTRACTS_PATH`).
- Uses the seeded E2E database: `apps/web/e2e/.data/e2e.db`.

**Existing dev server:**

- Set `E2E_EXTERNAL_WEB_SERVER=true` so Playwright doesn’t spawn its own server.
- Ensure `TURSO_DATABASE_URL` (or `E2E_TURSO_DATABASE_URL`) matches `E2E_DATABASE_PATH` (seeded DB) or auth/attestation steps will fail.

**Sepolia (fhEVM):**

- Start server with `NEXT_PUBLIC_ENABLE_FHEVM=true` and `NEXT_PUBLIC_ENABLE_HARDHAT=false`.
- Required envs: `E2E_SEPOLIA=true`, `E2E_SEPOLIA_RPC_URL`, and `FHEVM_*` contract addresses + registrar key.
- Run: `E2E_EXTERNAL_WEB_SERVER=true E2E_SEPOLIA=true bunx playwright test e2e/web3-sepolia.spec.ts`
- Sepolia E2E **skips** if envs are missing or the MetaMask account has no SepoliaETH (grant compliance access is disabled).

**Logs:**

- Next dev logs: `apps/web/.next/dev/logs/next-development.log`

### Noir Circuits (apps/web/noir-circuits)

```bash
# From apps/web directory:
bun run circuits:compile  # Compile all circuits
bun run circuits:test     # Run circuit tests
```

### FHE Service (apps/fhe)

The FHE service uses **MessagePack + gzip** for all POST endpoints (not JSON). Keys are persisted in a **ReDB** embedded database.

```bash
cargo build --release    # Build
cargo run --release      # Run (keys persist to ReDB on first registration)
cargo test               # Run tests
```

### OCR Service (apps/ocr)

```bash
python -m venv venv && source venv/bin/activate
pip install -e '.[test]'
PYTHONPATH=src uvicorn ocr_service.main:app --port 5004 --reload
pytest
```

### Docker (all services)

```bash
docker-compose up        # Start all services
docker-compose up -d     # Detached mode
```

## Deployment

### Vercel (Landing Page)

The landing page (`apps/landing`) deploys to Vercel. Configuration is in `vercel.json` at repo root.

```bash
vercel --prod            # Deploy to production
```

### Railway (Backend Services)

Backend services deploy to Railway using Dockerfiles. Each service has a `railway.toml` for configuration.

**Important**: Use `--path-as-root` flag to deploy from service subdirectories in this monorepo.

```bash
# Deploy individual services
railway up apps/fhe --path-as-root --service fhe
railway up apps/ocr --path-as-root --service ocr
railway up apps/web --path-as-root --service web
```

**Service URLs (production)**:

- Web: `https://app.zentity.xyz`
- FHE: `http://fhe.railway.internal:5001` (internal only)
- OCR: `http://ocr.railway.internal:5004` (internal only)

**Required env vars** (set via Railway dashboard):

- `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL`
- `INTERNAL_SERVICE_TOKEN`
- `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`
- `FHE_SERVICE_URL`, `OCR_SERVICE_URL`

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
cd apps/ocr && python -m venv venv && source venv/bin/activate && pip install -e '.[test]'

# FHE Service (compiles on first run)
cd apps/fhe && cargo build --release
```

**Troubleshooting: tfjs-node on macOS**

If you see `libtensorflow.2.dylib` errors after `bun install`, the tfjs-node postinstall may have failed to download the TensorFlow library (~340MB). Run manually:

```bash
cd apps/web/node_modules/@tensorflow/tfjs-node && node scripts/install.js
```

**Start Services (3 terminals):**

```bash
# Terminal 1: Frontend
cd apps/web && bun run dev

# Terminal 2: FHE Service
cd apps/fhe && cargo run --release

# Terminal 3: OCR Service
cd apps/ocr && source venv/bin/activate && PYTHONPATH=src uvicorn ocr_service.main:app --reload --port 5004
```

## Key Data Flow

The main verification flow is orchestrated via `trpc.identity.verify`:

1. **OCR Service** → Extract document data, generate SHA256 commitments
2. **FHE Service** → Encrypt DOB, country code, compliance level, liveness score with TFHE-rs (binary transport)
3. **Client-side Noir** → Generate UltraHonk proofs (age, document validity, nationality, face match) in browser
4. **Human.js** (built-in) → Multi-gesture liveness challenges (smile, blink, head turns), face matching
5. **Blockchain (optional)** → After verification, users can attest on-chain via `trpc.attestation.*`

All API calls from the client use tRPC (`trpc.crypto.*`, `trpc.liveness.*`, `trpc.attestation.*`, etc.).

**Privacy principle**: Raw PII is never stored. ZK proofs are generated CLIENT-SIDE so private inputs remain in the browser during proving, while OCR runs server-side and is signed. Only cryptographic commitments, FHE ciphertexts, signed claims, and ZK proofs are persisted. Images are processed transiently.

**User-controlled encryption**: FHE keys are generated client-side and stored server-side as passkey-wrapped encrypted secrets. The server cannot decrypt these keys—only the user with their passkey can unwrap them. The server receives only public/evaluation keys for computation. See [Attestation & Privacy Architecture](docs/attestation-privacy-architecture.md) and [RFC-0001](docs/rfcs/0001-passkey-wrapped-fhe-keys.md).

## Code Conventions

- **Linting**: Biome (not ESLint). Run `bun run lint:fix` before commits.
- **API Layer**: tRPC with Zod validation in `src/lib/trpc/`
- **Forms**: TanStack Form with Zod validation
- **UI Components**: shadcn/ui (Radix primitives) in `src/components/ui/`
- **Database**: Drizzle ORM with SQLite local files or Turso in production; schema is applied with `bun run db:push` (no runtime migrations; containers do not run drizzle-kit)
- **Turso**: set `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` for production/CI. For local file DBs, use `TURSO_DATABASE_URL=file:./.data/dev.db` (no `DATABASE_PATH` fallback)
- **Railway**: configure `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` on the web service, then run `bun run db:push` from CI or local (no volume mounts or db-init container required)
- **SQLite driver**: `drizzle-kit push` needs a driver; this repo uses `@libsql/client` (Bun-compatible)
- **Auth**: better-auth

## tRPC API Structure

All API operations go through tRPC at `/api/trpc/*`. Routers are in `src/lib/trpc/routers/`:

| Router | Purpose |
|--------|---------|
| `crypto` | FHE encryption, ZK proof verification, challenge nonces |
| `identity` | Full identity verification (document + selfie + liveness) |
| `liveness` | Multi-gesture liveness detection sessions |
| `onboarding` | Wizard state management and step validation |
| `attestation` | On-chain identity attestation (submit, refresh, networks) |
| `account` | User account management |
| `passkeyAuth` | Passkey credential management (register, authenticate, list, remove) |
| `secrets` | Encrypted secrets CRUD for passkey-wrapped keys |
| `token` | Session/token operations |

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
