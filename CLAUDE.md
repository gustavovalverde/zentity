# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Zentity is a privacy-preserving compliance/KYC platform using passkeys, OPAQUE passwords, or wallet signatures (EIP-712) for authentication and key custody, zero-knowledge proofs (ZKPs), fully homomorphic encryption (FHE), and cryptographic commitments. The platform enables identity verification without storing or exposing sensitive personal information.

## Key Documentation

**Understanding the privacy model (read these first):**

- [Attestation & Privacy Architecture](docs/attestation-privacy-architecture.md) — Attestation schema, data classification, privacy boundaries
- [Tamper Model](docs/tamper-model.md) — Integrity controls and threat model

**For Web3/blockchain integration:**

- [Web3 Architecture](docs/web3-architecture.md) — FHEVM hooks, encryption/decryption flows
- [Blockchain Setup](docs/blockchain-setup.md) — Network config, contract deployment

**For detailed system design:**

- [Architecture](docs/architecture.md) — Components, data flow, storage model
- [ZK Architecture](docs/zk-architecture.md) — Noir circuits and proving
- [FROST Threshold Recovery](docs/rfcs/0014-frost-social-recovery.md) — Guardian-based key recovery

## Architecture

Monorepo with services communicating via REST APIs:

| Service | Location | Stack | Port |
|---------|----------|-------|------|
| Web Frontend | `apps/web` | Next.js 16, React 19, TypeScript, Human.js, Noir.js | 3000 |
| FHE Service | `apps/fhe` | Rust, Axum, TFHE-rs, ReDB | 5001 |
| OCR | `apps/ocr` | Python, FastAPI, RapidOCR | 5004 |
| FROST Signer | `apps/signer` | Rust, Actix, FROST (coordinator + signers) | 5002, 5101+ |

Additional apps (not core services):

- `apps/landing` — Marketing landing page (deploys to Vercel)
- `apps/demo-hub` / `apps/demo-wallet` — Demo applications for integration testing

The frontend handles:

- Face detection and liveness verification using Human.js (server-side via tfjs-node)
- **ZK proofs generated CLIENT-SIDE** using Noir.js and Barretenberg (UltraHonk)
- **tRPC API layer** with type-safe routers for all backend operations
- RP (Relying Party) redirect flow for OAuth-style integrations
- **FROST threshold signatures** for guardian-based key recovery

## Build & Development Commands

### Web Frontend (apps/web)

```bash
pnpm dev             # Start dev server
pnpm build           # Production build
pnpm lint            # Biome linting (with write)
pnpm lint:check      # Check lint issues (no write)
pnpm lint:fix        # Fix lint issues (with unsafe fixes)
pnpm typecheck       # TypeScript type checking
pnpm check-all       # Run typecheck + lint + markdown + build + circuit version check

# Testing
pnpm test            # Run unit + integration tests
pnpm test:unit       # Run unit tests only (vitest.unit.config.mts)
pnpm test:integration # Run integration tests only (vitest.config.mts)
pnpm test:unit path/to/file.test.ts         # Run single test file
pnpm test:unit -t "test name pattern"       # Run tests matching pattern
pnpm test:e2e        # Run Playwright E2E tests
pnpm test:e2e:ui     # Run E2E with Playwright UI
```

### E2E Notes (Hardhat vs Sepolia)

**Hardhat (default):**

- `pnpm test:e2e` starts its own dev server + Hardhat node via `e2e/automation/start-web3-dev.js`.
- Contracts repo path defaults to `../zama/zentity-fhevm-contracts` (override with `E2E_CONTRACTS_PATH`).
- Uses the seeded E2E database: `apps/web/e2e/.data/e2e.db`.

**Existing dev server:**

- Set `E2E_EXTERNAL_WEB_SERVER=true` so Playwright doesn't spawn its own server.
- Ensure `TURSO_DATABASE_URL` (or `E2E_TURSO_DATABASE_URL`) matches `E2E_DATABASE_PATH` (seeded DB) or auth/attestation steps will fail.

**Sepolia (fhEVM):**

- Start server with `NEXT_PUBLIC_ENABLE_FHEVM=true` and `NEXT_PUBLIC_ENABLE_HARDHAT=false`.
- Required envs: `E2E_SEPOLIA=true`, `E2E_SEPOLIA_RPC_URL`, and `FHEVM_*` contract addresses + registrar key.
- Run: `E2E_EXTERNAL_WEB_SERVER=true E2E_SEPOLIA=true pnpm exec playwright test e2e/web3-sepolia.spec.ts`
- Sepolia E2E **skips** if envs are missing or the MetaMask account has no SepoliaETH (grant compliance access is disabled).

**Logs:**

- Next dev logs: `apps/web/.next/dev/logs/next-development.log`

### Noir Circuits (apps/web/noir-circuits)

```bash
# From apps/web directory:
pnpm circuits:compile        # Compile all circuits
pnpm circuits:test           # Run circuit tests
pnpm circuits:check-versions # Verify Noir/BB versions match artifacts
pnpm circuits:profile        # Profile circuit gate counts
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
pytest                    # Run tests
pytest tests/test_x.py    # Run single test file
ruff check src            # Lint (if dev deps installed)
ruff format src           # Format
```

### FROST Signer Service (apps/signer)

FROST threshold signature service for guardian-based key recovery. Consists of a coordinator and multiple signer instances.

```bash
cargo build --release              # Build
cargo run --bin coordinator        # Run coordinator (port 5002)
cargo run --bin signer             # Run signer instance (port 5101+)
cargo test                         # Run tests
```

See [FROST Threshold Recovery](docs/rfcs/0014-frost-social-recovery.md) and [Railway Signer Deployment](docs/railway-signer-deployment.md).

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
- pnpm 10+ (package manager)
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
cd apps/web && pnpm install

# OCR service
cd apps/ocr && python -m venv venv && source venv/bin/activate && pip install -e '.[test]'

# FHE Service (compiles on first run)
cd apps/fhe && cargo build --release
```

**Start Services (3 terminals):**

```bash
# Terminal 1: Frontend
cd apps/web && pnpm dev

# Terminal 2: FHE Service
cd apps/fhe && cargo run --release

# Terminal 3: OCR Service
cd apps/ocr && source venv/bin/activate && PYTHONPATH=src uvicorn ocr_service.main:app --reload --port 5004
```

## Key Data Flow

The system has two distinct flows: **sign-up** (account creation) and **verification** (identity proofing).

**Sign-Up Flow** (`/sign-up` → `/dashboard`):

1. **Email step** (optional) → User provides email or continues without
2. **Account step** → Create passkey/OPAQUE/wallet credentials, generate FHE keys
3. **FHE enrollment** → Encrypt and store credential-wrapped FHE key bundle
4. User reaches **Tier 1** (account + keys secured) and lands on dashboard

**Verification Flow** (from `/dashboard/verify/*`):

1. **Document OCR** → `trpc.identity.prepareDocument` extracts data, generates commitments
2. **Liveness + Face Match** → `trpc.liveness.*` runs multi-gesture challenges, server verifies
3. **ZK Proofs** → Client-side Noir generates UltraHonk proofs (age, doc validity, nationality, face match)
4. **FHE Encryption** → Encrypt DOB, country code, compliance level via FHE service
5. User reaches **Tier 2/3** depending on proof completeness

**Blockchain (optional)** → After verification, users can attest on-chain via `trpc.attestation.*`

All API calls from the client use tRPC (`trpc.crypto.*`, `trpc.liveness.*`, `trpc.attestation.*`, etc.).

**Privacy principle**: Raw PII is never stored. ZK proofs are generated CLIENT-SIDE so private inputs remain in the browser during proving, while OCR runs server-side and is signed. Only cryptographic commitments, FHE ciphertexts, signed claims, and ZK proofs are persisted. Images are processed transiently.

**User-controlled encryption**: FHE keys are generated client-side and stored server-side as credential-wrapped encrypted secrets (passkey PRF, OPAQUE export key, or wallet signature via HKDF). The server cannot decrypt these keys—only the user with their passkey, password, or wallet can unwrap them. The server receives only public/evaluation keys for computation. See [Attestation & Privacy Architecture](docs/attestation-privacy-architecture.md) and [RFC-0001](docs/rfcs/0001-passkey-wrapped-fhe-keys.md).

## Code Conventions

- **Linting**: Biome via Ultracite preset (`pnpm exec ultracite fix`). Run `pnpm lint:fix` before commits.
- **Code Standards**: See `apps/web/.claude/CLAUDE.md` for detailed TypeScript/React style guidelines enforced by Ultracite
- **API Layer**: tRPC with Zod validation in `src/lib/trpc/`
- **Forms**: TanStack Form with Zod validation
- **UI Components**: shadcn/ui (Radix primitives) in `src/components/ui/`
- **Database**: Drizzle ORM with SQLite local files or Turso in production. Schema source of truth: `apps/web/src/lib/db/schema/`. Apply schema with `pnpm db:push` (no runtime migrations)
- **Turso**: set `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` for production/CI. For local file DBs, use `TURSO_DATABASE_URL=file:./.data/dev.db`
- **SQLite driver**: uses `@libsql/client`
- **Auth**: better-auth with passkey, OPAQUE, and wallet support

## tRPC API Structure

All API operations go through tRPC at `/api/trpc/*`. Routers are in `src/lib/trpc/routers/`:

| Router | Purpose |
|--------|---------|
| `crypto` | FHE encryption, ZK proof verification, challenge nonces |
| `identity` | Identity verification (document OCR, liveness, face match, proofs) |
| `liveness` | Multi-gesture liveness detection sessions |
| `signUp` | Progressive account creation wizard (email → account → keys secured) |
| `assurance` | Tier profile, AAL computation, and feature gating |
| `attestation` | On-chain identity attestation (submit, refresh, networks) |
| `account` | User account management |
| `secrets` | Encrypted secrets CRUD for passkey-wrapped keys |
| `credentials` | WebAuthn credential management |
| `token` | Session/token operations |
| `recovery` | FROST guardian-based key recovery flow |
| `app` | Application-level operations |

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
2. Compile circuits: `cd apps/web && pnpm circuits:compile`
3. Test circuits: `cd apps/web && pnpm circuits:test`

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
