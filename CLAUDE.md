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
| MCP Server | `apps/mcp` | Node.js, Hono, @modelcontextprotocol/sdk | 3200 (HTTP) / stdio |

Additional apps (not core services):

- `apps/mcp` — MCP HTTP/stdio server with OAuth auth (FPA OPAQUE 3-round, PKCE, DPoP), CIBA integration, step-up re-auth. Tools: whoami, my_proofs, check_compliance, purchase, request_approval
- `apps/landing` — Marketing landing page (deploys to Vercel)
- `apps/demo-rp` — Demo relying party with OAuth scenarios (bank, exchange, wine, aid), OID4VP verifier (VeriPass), and CIBA agent authorization (Aether AI at `/aether`)

The frontend handles:

- Face detection and liveness verification using Human.js (server-side via tfjs-node)
- **ZK proofs generated CLIENT-SIDE** using Noir.js and Barretenberg (UltraHonk)
- **tRPC API layer** with type-safe routers for all backend operations
- OAuth 2.1 / OpenID Connect provider for third-party integrations (via better-auth)
- **FROST threshold signatures** for guardian-based key recovery

## Route Architecture

### Naming convention

Name routes by **domain noun** (what it manages), sub-routes by **action/state** (what the user does). Example: `recovery/password/sent/` not `forgot-password-sent/`.

### Page routes (`apps/web/src/app/`)

- **Route groups** `()` are visual/provider shells — they don't affect URLs
- **`_components/`** for co-located non-route components — no exceptions
- **AuthView wrappers** (`callback/`, `email-verification/`, `magic-link/`, `recovery/`) are an accepted Next.js App Router constraint, not a design flaw
- **Standalone routes** (`approve/`, `oauth/consent/`) live at the app root with their own layout when they need no sidebar chrome
- **`verify/` subtree** is the reference implementation: domain folders, `_components/`, server→client splits, meaningful server-side gates

### API routes (`apps/web/src/app/api/`)

Name by domain noun, not implementation mechanism:

| Domain | Prefix | Contains |
|--------|--------|----------|
| FHE | `api/fhe/` | enrollment, key registration, status, age verification, diagnostics |
| ZK | `api/zk/` | circuit artifacts, nationality proof verification |
| CIBA | `api/ciba/` | identity intent/stage, push subscribe/unsubscribe |
| OAuth2 | `api/oauth2/` | identity intent/stage/unstage |

### tRPC routers (`src/lib/trpc/routers/`)

Router names must match the domain they serve. Only rename `crypto` → `zk` was needed — all others were already correct.

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

### MCP Server (apps/mcp)

MCP identity server supporting HTTP and stdio transports.

```bash
pnpm dev              # Run with watch (stdio transport)
pnpm start:http       # Run HTTP transport (port 3200)
pnpm build            # Build to dist/
pnpm test             # Vitest unit tests
pnpm test:e2e         # Smoke test script
```

Env vars: `ZENTITY_URL` (Zentity server URL), `MCP_ALLOWED_ORIGINS` (CORS origins for HTTP transport).

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

- `BETTER_AUTH_SECRET`, `NEXT_PUBLIC_APP_URL`
- `INTERNAL_SERVICE_TOKEN`
- `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`
- `FHE_SERVICE_URL`, `OCR_SERVICE_URL`
- `PAIRWISE_SECRET` (min 32 chars, required for pairwise subject identifiers)
- `DPOP_NONCE_TTL_SECONDS` (default: 30)
- `TRUSTED_WALLET_ISSUERS` (comma-separated, optional)
- `X5C_LEAF_PEM`, `X5C_CA_PEM` (or place certs in `.data/certs/`)

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
# Frontend (install deps + generate secrets + init DB)
cd apps/web && pnpm install && pnpm setup

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

1. **Credential choice** → User picks passkey, password (OPAQUE), or wallet (inline cards)
2. **Session creation** → Passkey/password paths call `ensureAuthSession()` on demand to create an anonymous user; wallet (SIWE) creates its own user directly
3. **Account completion** → `trpc.signUp.completeAccountCreation` links email/wallet, clears `isAnonymous`, creates identity bundle stub, then client invalidates the session cookie cache so the dashboard reads fresh data
4. User lands on dashboard with **Tier 1** (account created, no FHE keys yet)

FHE key enrollment is **not** part of sign-up — it happens as a verification preflight gate when the user starts identity verification. See [FHE Key Lifecycle](docs/fhe-key-lifecycle.md).

**Verification Flow** (from `/dashboard/verify/*`):

Users choose a verification method via `VerificationMethodCards` (OCR or NFC chip, gated by `NEXT_PUBLIC_ZKPASSPORT_ENABLED`). Both paths converge at the same `identity_verifications` table (unified schema with `method` discriminator: `"ocr"` | `"nfc_chip"`).

**OCR path:**

1. **Document OCR** → `trpc.identity.prepareDocument` extracts data, generates commitments
2. **Liveness + Face Match** → `trpc.liveness.*` runs multi-gesture challenges, server verifies
3. **Profile Secret** → Extracted PII is encrypted with the user's credential (passkey/password/wallet) and stored as a `PROFILE` secret. This is the only persistent copy of the user's PII and is only decryptable by the user.
4. **ZK Proofs** → Client-side Noir generates UltraHonk proofs (age, doc validity, nationality, face match)
5. **FHE Encryption** → Encrypt DOB, country code, compliance level via FHE service. Compliance level is derived at encryption time from ZK proof existence and signed claims, not stored as a settable boolean.
6. User reaches **Tier 2/3** depending on proof completeness

**NFC chip path (ZKPassport):**

1. **Country/document pre-check** → `buildCountryDocumentList` (uses `@zkpassport/registry`) confirms NFC support
2. **ZKPassport deep-link** → Opens ZKPassport mobile app for NFC chip reading + proof generation
3. **Server verification** → `trpc.passportChip.submitResult` verifies proofs server-side via `zkpassport.verify()`
4. **Nullifier check** → `uniqueIdentifier` prevents duplicate passport registrations across accounts
5. **FHE Encryption** → Same as OCR path; synthetic liveness score (1.0) from physical chip possession

**Blockchain (optional)** → After verification, users can attest on-chain via `trpc.attestation.*`

All API calls from the client use tRPC (`trpc.zk.*`, `trpc.liveness.*`, `trpc.attestation.*`, etc.).

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

## tRPC API Structure

All API operations go through tRPC at `/api/trpc/*`. Routers are in `src/lib/trpc/routers/`:

| Router | Purpose |
|--------|---------|
| `zk` | ZK proof verification, challenge nonces |
| `identity` | Identity verification (document OCR, liveness, face match, proofs, revocation) |
| `liveness` | Multi-gesture liveness detection sessions |
| `signUp` | Account creation completion (email linking, wallet association, identity bundle creation) |
| `assurance` | Tier profile, AAL computation, and feature gating |
| `attestation` | On-chain identity attestation (submit, refresh, networks) |
| `account` | User account management |
| `secrets` | Encrypted secrets CRUD for passkey-wrapped keys |
| `credentials` | WebAuthn credential management |
| `compliantToken` | CompliantERC20 DeFi token operations |
| `recovery` | FROST guardian-based key recovery flow |
| `passportChip` | ZKPassport NFC chip verification (submit proof results, poll FHE status) |
| `admin` | JWKS signing key rotation and cleanup (admin-only via `adminProcedure`) |
| `agentBoundaries` | CIBA pre-authorized boundary policies CRUD (purchase limits, scope allowlists, custom actions) |

**Client usage:**

```typescript
import { trpc } from "@/lib/trpc/client";

// Query
const health = await trpc.zk.health.query();

// Mutation
const result = await trpc.liveness.verify.mutate({ sessionId, ... });
```

## OAuth Provider (Third-Party Integrations)

Zentity acts as an OAuth 2.1 / OpenID Connect authorization server via better-auth's `oauthProvider` plugin. Endpoints are under `/api/auth/oauth2/*` with discovery at `/.well-known/*`.

OAuth clients are managed through the **RP Admin UI** (`/dashboard/dev/rp-admin`) with organization-based ownership (via `referenceId` on the client table). REST endpoints at `/api/rp-admin/clients/*` handle CRUD. DCR-registered clients can be adopted by organizations.

**HAIP compliance** (`@better-auth/haip`): DPoP with server-managed nonce store (`DPOP_NONCE_TTL_SECONDS`, default 30s), PAR required (`requirePar: true`), wallet attestation (`TRUSTED_WALLET_ISSUERS`), JARM encrypted VP responses (ECDH-ES P-256), pairwise subject identifiers (`PAIRWISE_SECRET`, required min 32 chars). Discovery metadata enriched via `enrichDiscoveryMetadata()` in `well-known-utils.ts` (NOT via plugin after-hook — Next.js routes call `auth.api.*` directly).

**First-Party Apps** (`draft-ietf-oauth-first-party-apps`): Authorization Challenge Endpoint at `POST /api/oauth2/authorize-challenge` for CLI/headless clients. Supports OPAQUE (3-round) and EIP-712 wallet (2-round) challenge flows with DPoP-bound `auth_session`. Credential resolution: OPAQUE > EIP-712 > `redirect_to_web` (passkey-only). Only clients with `firstParty: true` can use the endpoint. Rate limited to 10 req/min per IP. Step-up re-authentication: when CIBA token exchange fails `acr_values`, FPA clients receive HTTP 403 + `auth_session` to re-authenticate via the challenge endpoint. Schema: `src/lib/db/schema/auth-challenge.ts`. Route: `src/app/api/oauth2/authorize-challenge/route.ts`.

**CIBA** (`@better-auth/ciba`): Backchannel auth for agent authorization. Poll mode only. Endpoints: `POST /oauth2/bc-authorize`, `GET /ciba/verify`, `POST /ciba/authorize`, `POST /ciba/reject`. Grant type `urn:openid:params:grant-type:ciba` handled at the token endpoint via `customGrantTypeHandlers` (requires oauth-provider patch). Supports `authorization_details` (RAR) for structured action metadata and `acr_values` for assurance tier enforcement (checked at approval time and token exchange). Approval UI: standalone `/approve/[authReqId]` (push notification target, no dashboard chrome) and dashboard `/dashboard/ciba/approve` (secondary). Listing at `/dashboard/ciba`. Email notifications via `src/lib/email/ciba-mailer.ts`. Web push notifications: service worker (`public/push-sw.js`) with inline approve/deny actions, push subscription API at `/api/ciba/push/subscribe` and `/api/ciba/push/unsubscribe`, `PushManager` client in `src/lib/push/`. VAPID env vars: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`. Release handle triple binding: `(userId, authReqId, clientId)` with 5-min ephemeral TTL. `requiresVaultUnlock`: identity-scoped requests show only "Deny" inline (vault unlock requires browser context). Schema: `src/lib/db/schema/ciba.ts`. Demo: Aether AI shopping agent at `apps/demo-rp/src/app/aether/`.

**OID4VP verifier** (`apps/demo-rp`): VeriPass at `/veripass` with 4 scenarios (border, employer, venue, financial). Uses DCQL queries, JAR JWTs with x5c chain, `client_id_scheme: x509_hash`, JARM `direct_post.jwt` response mode. KB-JWT holder binding verified cryptographically in `apps/demo-rp/src/lib/verify.ts`. Dev certs required: `pnpm exec tsx scripts/generate-dev-certs.ts`.

**Back-Channel Logout** (OIDC BCL): `end_session_endpoint` at `GET /api/auth/oauth2/end-session` validates `id_token_hint` and terminates sessions. `sendBackchannelLogout()` delivers logout tokens to all RPs with registered `backchannel_logout_uri`. `sid` claim injected into id_tokens for BCL-registered clients. `revokePendingCibaOnLogout()` cancels pending CIBA requests on user logout. Discovery: `backchannel_logout_supported: true`, `backchannel_logout_session_supported: true`.

**JWKS Key Rotation**: `rotateSigningKey(alg, overlapHours)` in `jwt-signer.ts` retires the active key with an `expiresAt` timestamp and creates a new one. During the overlap window, both keys are served by the JWKS endpoint. `cleanupExpiredKeys()` removes keys past the overlap window. Both operations are exposed via the `admin` tRPC router (admin-only). JWKS private keys are encrypted at rest with AES-256-GCM (`KEY_ENCRYPTION_KEY` env var).

**Agent Boundaries**: Pre-authorized policies in `agent_boundaries` table allow auto-approval of CIBA requests within user-defined limits. Boundary types: `purchase` (amount/daily cap/cooldown), `scope` (allowlist), `custom` (action count). Identity-scoped requests (`identity.*`) always require manual approval regardless of boundaries. Auto-approved requests are logged with `approvalMethod: "boundary"`. Dashboard at `/dashboard/agent-policies`. "Always allow this" button on CIBA approval page creates policies from real request patterns.

- [OAuth Integrations](docs/oauth-integrations.md) — Authorization flow, client management, scopes, consent, OIDC4VCI/VP, HAIP, CIBA

## ZK Circuit Development

ZK circuits are in `apps/web/noir-circuits/` using Noir. Build process:

1. Install Noir toolchain: `curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash && noirup`
2. Compile circuits: `cd apps/web && pnpm circuits:compile`
3. Test circuits: `cd apps/web && pnpm circuits:test`

Circuits available:

- `age_verification` — Prove age >= threshold without revealing DOB
- `doc_validity` — Prove document not expired without revealing expiry date
- `nationality_membership` — Prove nationality in country group via Merkle proof
- `address_jurisdiction` — Prove residential address in jurisdiction via Merkle proof
- `face_match` — Prove face similarity above threshold
- `identity_binding` — Bind proofs to user identity for replay protection (works with passkey, OPAQUE, and wallet auth)

**Critical: BN254 field constraints** — All circuit inputs must fit the BN254 scalar field (~254 bits). Cryptographic outputs (passkey PRF, OPAQUE export keys, SHA-256) must use HKDF-based hash-to-field (512-bit expansion, then modulo BN254) before use. See [ZK Architecture](docs/zk-architecture.md#bn254-field-constraints).

## Environment Variables

Env config is centralized in `apps/web/src/env.ts` using [T3 Env](https://env.t3.gg/) with Zod validation. Run `cd apps/web && pnpm setup` to auto-generate secrets and initialize the database.

All env vars are typed and validated at startup. See `src/env.ts` for the full schema with defaults. Key vars:

```bash
# Required (auto-generated by pnpm setup)
BETTER_AUTH_SECRET=<random-32-char-string>
OPAQUE_SERVER_SETUP=<generated-by-setup>

# Services (defaults work for local dev)
FHE_SERVICE_URL=http://localhost:5001
OCR_SERVICE_URL=http://localhost:5004

# Privacy & compliance (required in production)
PAIRWISE_SECRET=<min-32-char-string>    # Required (z.string().min(32)), pairwise subject identifiers
KEY_ENCRYPTION_KEY=<min-32-char-string> # Optional in dev, required in production (min 32 chars). AES-256-GCM envelope encryption for JWKS private keys at rest.
DEDUP_HMAC_SECRET=<min-32-char-string>  # Required (z.string().min(32)). HMAC key for sybil dedup and per-RP nullifiers.
CUSTODIAL_SIGNER_URL=                   # Optional. URL of the custodial signer instance for zero-friction recovery.
CUSTODIAL_SIGNER_ID=                    # Optional. Signer ID of the custodial signer instance.

# Feature flags
NEXT_PUBLIC_ZKPASSPORT_ENABLED=false     # Enable NFC chip verification via ZKPassport

# Optional overrides
OIDC4VP_JWKS_URL=                        # Override JWKS endpoint for VP token verification
```
