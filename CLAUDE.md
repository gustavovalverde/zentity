# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Zentity is a privacy-preserving compliance/KYC platform using passkeys, OPAQUE passwords, or wallet signatures (Sign-In with Ethereum to authenticate, EIP-712 to wrap keys) for authentication and key custody, zero-knowledge proofs (ZKPs), fully homomorphic encryption (FHE), and cryptographic commitments. The platform enables identity verification without storing or exposing sensitive personal information.

## Key Documentation

**Understanding the privacy model (read these first):**

- [Attestation & Privacy Architecture](docs/(architecture)/attestation-privacy-architecture.md) — Attestation schema, data classification, privacy boundaries
- [Tamper Model](docs/(architecture)/tamper-model.md) — Integrity controls and threat model

**For Web3/blockchain integration:**

- [Web3 Architecture](docs/(architecture)/web3-architecture.md) — Confidential chain hooks, encryption/decryption flows
- [Blockchain Setup](docs/internal/blockchain-setup.md) — Network config, contract deployment

**For detailed system design:**

- [Architecture](docs/(concepts)/architecture.md) — Components, data flow, storage model
- [Agent Architecture](docs/(architecture)/agent-architecture.md) — Durable hosts, ephemeral agent sessions, CIBA approval, and token exchange
- [ZK Architecture](docs/(protocols)/zk-architecture.md) — Noir circuits and proving

## Architecture

Monorepo with services communicating via REST APIs:

| Service | Location | Stack | Port |
|---------|----------|-------|------|
| Web Frontend | `apps/web` | Next.js 16, React 19, TypeScript, Human.js, Noir.js | 3000 |
| FHE Service | `apps/fhe` | Rust, Axum, TFHE-rs, ReDB | 5001 |
| OCR | `apps/ocr` | Python, FastAPI, RapidOCR | 5004 |
| MCP Server | `apps/mcp` | Node.js, Hono, @modelcontextprotocol/server | 3300 (HTTP) / stdio |

Additional apps (not core services):

- `apps/mcp` — MCP HTTP/stdio server with OAuth auth (FPA OPAQUE 3-round, PKCE, DPoP), CIBA integration, step-up re-auth. Public tools: whoami, my_profile, my_proofs, check_compliance, purchase
- `apps/landing` — Marketing landing page (deploys to Vercel)
- `apps/demo-rp` — Demo relying party with OAuth scenarios (bank, exchange, wine, aid), OID4VP verifier (VeriPass), and CIBA agent authorization (Aether AI at `/aether`)

The frontend handles:

- Face detection and liveness verification using Human.js (server-side via tfjs-node)
- **ZK proofs generated CLIENT-SIDE** using Noir.js and Barretenberg (UltraHonk)
- **tRPC API layer** with type-safe routers for all backend operations
- OAuth 2.1 / OpenID Connect provider for third-party integrations (via better-auth)

## Route Architecture

### Naming convention

Name routes by **domain noun** (what it manages), sub-routes by **action/state** (what the user does). Example: `recovery/password/sent/` not `forgot-password-sent/`.

### Page routes (`apps/web/src/app/`)

- **Route groups** `()` are visual/provider shells — they don't affect URLs
- **`_components/`** for co-located non-route components — no exceptions
- **AuthView wrappers** (`callback/`, `email-verification/`, `magic-link/`) are an accepted Next.js App Router constraint, not a design flaw
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
pnpm lint:check      # Check lint issues (no write)
pnpm lint:fix        # Fix lint issues (Biome, with write)
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

### E2E Notes (OIDC-only, Hardhat, Sepolia)

**OIDC-only (runs nightly in CI):**

- `E2E_OIDC_ONLY=true pnpm exec playwright test --config playwright.config.mts --project=oidc` starts `e2e/automation/start-oidc-dev.ts` (fresh SQLite database, no Hardhat, no confidential chain) and runs the `e2e/oidc/*.spec.ts` files. It needs no FHE service, OCR service, dev x5c certificates, or `MCP_PUBLIC_URL`, only the `.env` that `pnpm setup` generates, a built `@zentity/sdk`, and headless Chromium (`pnpm exec playwright install --only-shell chromium`) for `ciba-approval.spec.ts`.
- `.github/workflows/e2e-oidc.yml` runs it on a nightly schedule and on `workflow_dispatch`, never on pull requests. It generates secrets with `pnpm run setup` instead of storing repository secrets, and on failure uploads the Playwright report and the Next dev log as artifacts. Most specs use Playwright's `request` fixture, but `ciba-approval.spec.ts` drives the approval page with a virtual WebAuthn authenticator, so the job installs headless Chromium on each run (`--with-deps --only-shell`, no browser cache).

**Hardhat (default):**

- `pnpm test:e2e` starts its own dev server + Hardhat node via `e2e/automation/start-web3-dev.js`.
- Contracts repo path defaults to `../zama/zentity-fhevm-contracts` (override with `E2E_CONTRACTS_PATH`).
- Uses the seeded E2E database configured by the E2E runner.

**Existing dev server:**

- Set `E2E_EXTERNAL_WEB_SERVER=true` so Playwright doesn't spawn its own server.
- Ensure `TURSO_DATABASE_URL` (or `E2E_TURSO_DATABASE_URL`) matches `E2E_DATABASE_PATH` (seeded DB) or auth/attestation steps will fail.

**Sepolia (Zama Confidential):**

- Start server with `NEXT_PUBLIC_ENABLE_CONFIDENTIAL_CHAIN=true` and `NEXT_PUBLIC_ENABLE_HARDHAT=false`.
- Required envs: `E2E_SEPOLIA=true`, `E2E_SEPOLIA_RPC_URL`, and `CONFIDENTIAL_CHAIN_*` contract addresses + registrar key.
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

### MCP Server (apps/mcp)

MCP identity server supporting HTTP and stdio transports.

```bash
pnpm dev              # Run stdio transport once, for interactive use (no watch: tsx watch logs to stdout and corrupts JSON-RPC)
pnpm start:http       # Run HTTP transport (port 3300)
pnpm build            # Build to dist/
pnpm test             # Vitest unit tests
pnpm test:e2e         # Smoke test script
```

The repo-root `.mcp.json` launches the stdio server with Node (`pnpm --silent --dir apps/mcp exec tsx src/index.ts`). Build the SDK first (`pnpm --filter @zentity/sdk build`), because `@zentity/sdk` subpaths resolve from `dist`. MCP clients should use that command rather than `pnpm dev`, whose pnpm banner still prints on stdout.

Env vars: `ZENTITY_URL` (Zentity server URL), `MCP_ALLOWED_ORIGINS` (CORS origins for HTTP transport), `MCP_CLIENT_ID` and `MCP_CLIENT_SECRET` (required by the HTTP transport, which refuses to start without them; the confidential client it exchanges remote hosts' tokens and runs CIBA as), `MCP_DPOP_NONCE_SECRET` (optional, min 32 chars; the secret the HTTP transport derives DPoP nonces from). `pnpm --filter @zentity/web mcp:provision` creates or updates that client through the OAuth provider's administration APIs, links it to `MCP_PUBLIC_URL`, and prints the resource and database it targets and then both values (the secret only when created or with `--rotate-secret`); in production it refuses an `MCP_PUBLIC_URL` that is not HTTPS to a public host, such as the loopback default when the variable is unset; `--write-env ../mcp/.env` writes them, and `pnpm setup` does this on a fresh checkout. `pnpm start:http` reads `apps/mcp/.env`. Against production, run the same script once with the web service's environment (`railway run --service web pnpm --filter @zentity/web mcp:provision`) and set both values wherever MCP HTTP runs; the repository has no deployment manifest for it. The stdio transport signs in with the agent bootstrap scopes and exchanges its own login for the bootstrap token. Without `MCP_DPOP_NONCE_SECRET` each process generates its own secret, and the DPoP replay store is in memory, so the HTTP transport serves one instance; a multi-instance deployment must set the same secret on every instance and use a shared replay store.

### Docker (all services)

```bash
docker-compose up        # Start all services
docker-compose up -d     # Detached mode
```

## Deployment

### Vercel

Two apps deploy to Vercel from the repo root: `apps/landing` and `apps/demo-rp`. Both Vercel projects use a Root Directory pointing into the monorepo, with the upload coming from the repo root so workspace deps (`@zentity/sdk`, `apps/web/vendor/*` tarballs) are visible to the build.

**Landing page** (`apps/landing`): the repo-root `.vercel/project.json` link is bound to this project (`rootDirectory: apps/landing`). Deploy from the repo root:

```bash
vercel --prod
```

**demo-rp** (`apps/demo-rp`): Vercel project has `rootDirectory: apps/demo-rp`, install/build commands = `pnpm install` / `pnpm run build`. The app depends on `apps/web/vendor/*` (better-auth tarballs) and `packages/sdk` (workspace), which is why the upload spans the whole repo. Deploy via the helper script — it swaps the repo-root link from landing to demo-rp, runs `vercel deploy --prod`, then restores the landing link on exit:

```bash
./apps/demo-rp/scripts/deploy-to-vercel.sh --prod
```

`.vercelignore` at the repo root trims the parts of `apps/web` not needed by demo-rp (src, public, `.next`, etc.) while keeping `apps/web/vendor/` and `apps/web/patches/`. Vercel's serverless filesystem is read-only outside `/tmp`, so any code that persists generated keys must use `/tmp` when `process.env.VERCEL` is set (see `apps/demo-rp/src/lib/attestation.ts`).

demo-rp binds every Zentity sign-in token to one DPoP key derived from `OAUTH_DPOP_KEY_SEED` (min 32 chars, different from `ZPAY_DPOP_KEY_SEED`). Production requires it, so set it in the demo-rp Vercel project before deploying. Keep it stable: a new seed invalidates every stored sign-in token, and users must sign in again.

### Railway (Backend Services)

Backend services deploy to Railway using Dockerfiles. Each service has a `railway.toml` for configuration.

**Web service** depends on the `@zentity/sdk` workspace package, so its Dockerfile builds with the repo root as Docker context. Deploy via the staging script — it rsyncs only what the Dockerfile needs into a temp directory, places `railway.toml` at the upload root (so `[deploy]` settings persist), then runs `railway up`:

```bash
./apps/web/scripts/deploy-to-railway.sh
```

**Other services** are self-contained and deploy with `--path-as-root`:

```bash
railway up apps/fhe --path-as-root --service fhe
railway up apps/ocr --path-as-root --service ocr
```

Notes:

- Railway CLI honors `.gitignore` (not `.dockerignore`) when filtering uploads. The web staging script works around this by rsync-filtering before upload.
- The web service has `RAILWAY_DOCKERFILE_PATH=apps/web/Dockerfile` set so Railway finds the Dockerfile inside the repo-root upload.
- Deploy the OAuth token transition release in the order the header of `apps/web/scripts/backfill-oauth-token-transition.ts` gives. It covers the web, MCP, and demo-rp deploys and both database pushes.

**Service URLs (production)**:

- Web: `https://app.zentity.xyz`
- FHE: `http://fhe.railway.internal:5001` (internal only)
- OCR: `http://ocr.railway.internal:5004` (internal only)

**Required env vars** (set via Railway dashboard):

- `BETTER_AUTH_SECRET`, `OPAQUE_SERVER_SETUP`, `NEXT_PUBLIC_APP_URL`
- `INTERNAL_SERVICE_TOKEN` (min 32 chars; authenticates the web app to the FHE and OCR services and the wallet runtime to the revocation feed; never a user session)
- `DEDUP_HMAC_SECRET` (min 32 chars, sybil dedup & per-RP nullifiers)
- `PAIRWISE_SECRET` (min 32 chars, pairwise subject identifiers)
- `KEY_ENCRYPTION_KEY` (min 32 chars, AES-256-GCM for JWKS at rest)
- `CRON_SECRET` (min 32 chars, Bearer auth for `/api/cron/*` triggers)
- `CLAIM_SIGNING_SECRET` (min 32 chars, signed claim issuer secret)
- `CIPHERTEXT_HMAC_SECRET` (min 32 chars, FHE ciphertext integrity)
- `BBS_ISSUER_SECRET` (BBS+ issuer signing key)
- `SECRET_BLOB_DIR` (typically `/var/lib/zentity/web/secret-blobs`, persisted via volume)
- `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`
- `FHE_SERVICE_URL`, `OCR_SERVICE_URL`
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (web push)
- `RESEND_API_KEY` (transactional email)
- `MAIL_FROM_EMAIL=no-reply@zentity.xyz`
- `TRUSTED_WALLET_ISSUERS` (optional JSON array of trusted wallet-attestation issuers, for example `[{"issuer":"https://wallet.example","jwksUri":"https://wallet.example/jwks.json"}]`; each entry needs `jwks`, `jwksUri`, or `trustAnchors`)
- `TRUSTED_AGENT_ATTESTERS` (comma-separated JWKS URLs for agent attestation verification, optional)
- `X5C_LEAF_PEM`, `X5C_CA_PEM`

**Conditional env vars** (required only when the corresponding feature is enabled):

- World ID PoH (when `NEXT_PUBLIC_WORLD_ID_ENABLED=true`): `HUMANITY_HMAC_SECRET` (min 32 chars), `NEXT_PUBLIC_WORLD_ID_APP_ID`, `WORLD_ID_RP_ID`, `WORLD_ID_RP_SIGNING_KEY` (32-byte hex), `WORLD_ID_ENVIRONMENT` (`production` or `staging`)
- Base Sepolia mirror (when `NEXT_PUBLIC_ENABLE_BASE_SEPOLIA=true`): `NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL`, `BASE_SEPOLIA_RPC_URL`, `BASE_SEPOLIA_REGISTRAR_PRIVATE_KEY`, `BASE_SEPOLIA_IDENTITY_REGISTRY_MIRROR`

### Manual Setup (without Docker)

**Prerequisites:**

- Node.js 26+ (recommended: use `.nvmrc` or `mise`)
- pnpm 12+ (package manager)
- Rust 1.100+ (recommended: `mise`)
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
3. **Account completion** → `trpc.signUp.completeAccountCreation`, which accepts only a still-anonymous account, sets the email (unverified, with a verification link) or the wallet identity, clears `isAnonymous`, creates identity bundle stub, then client invalidates the session cookie cache so the dashboard reads fresh data. A wallet is accepted only when its Sign-In with Ethereum sign-up already linked it, after verifying the wallet signatures
4. User lands on dashboard with **Tier 0** (Anonymous: account created, no FHE keys yet). Tier 1 (Account) starts once FHE keys are enrolled at the verification preflight.

FHE key enrollment is **not** part of sign-up — it happens as a verification preflight gate when the user starts identity verification. See [FHE Key Lifecycle](docs/(protocols)/fhe-key-lifecycle.md).

**Recovery factor changes**: on an account that holds a passkey, adding another passkey and every change to what can recover the account (the email address, the OPAQUE password, a wallet, a linked social sign-in account, the vault root, and the recovery key) pass `checkRecoveryFactorChange` (`src/lib/auth/recovery-factors.ts`). A change is allowed from a session that holds one of these:

- a user-verified passkey sign-in (`amr` contains `mfa`) in the last 5 minutes, or 15 minutes for a recovery key change;
- an account recovery: in the last 10 minutes, one recovery code (a magic-link sign-in, or the recovery key proved through `POST /api/auth/recovery-key/verify`) plus one more proof (a password sign-in or in-session password verify, a wallet sign-in or in-session wallet confirmation through `POST /api/auth/wallet/siwe/verify/*`, or the other recovery code). A password that a mailbox alone set (a reset by email, or an email-only recovery) never counts, by `account.passwordSetMethod`; a password set before that record, and a wallet linked, count only once 7 days old;
- an email-only recovery: a magic-link sign-in in the last 10 minutes on an account with no password, wallet, or recovery key.

A magic-link sign-in counts only when it reached an address that was verified before that sign-in and has not changed since. Other sessions, and OAuth access tokens, get 403 `REVERIFICATION_REQUIRED` (tRPC: `FORBIDDEN` with `data.reason`). The page retries through `withPasskeyConfirmation` (`src/lib/auth/passkey/client.ts`): a dialog in the root layout (`passkey-confirmation-dialog.tsx`) offers the passkey first, then the email link, the password, the recovery key, and the wallet that the session still lacks (`account.recoveryOptions`). The retry stops when the passkey signed in to another account, and says so when the passkey did not verify the user. A lost passkey is replaced at `/recovery/passkey`, which asks for the same proofs; the recovery key entered there also opens the vault. A session whose recent user-verified passkey sign-in allows a new passkey goes to Settings instead, since its passkey is not lost, and after any passkey sign-in in the session the page removes only the passkeys the user picks. Adding a passkey is checked at `/passkey/generate-register-options` and again in the passkey plugin's `registration.afterVerification`, before the passkey is stored. Each new passkey records how it was allowed in `passkey.enrollment_method`, one account recovery adds one passkey, and a recovery that used the recovery key spends it (`secret_wrappers.verifier_hash` becomes null; the key still opens the vault). The last passkey can be removed only from an account recovery (otherwise 400 `LAST_PASSKEY`), and a session may take back a passkey it added in the last 10 minutes. The rule also covers `/change-email`, `/send-verification-email` (a session-less request for a passkey account sends nothing), an email-change link issued before the account's first passkey (`/verify-email`), `/password/opaque/registration/*`, a reset by email (`/password-reset/opaque/complete` replaces a passkey account's password but never adds one: 400 `PASSWORD_NOT_SET`), `secrets.resetVault`, `secrets.storeSecret` when it replaces the vault root, `secrets.addWrapper` for the recovery key, `secrets.removeCredential` for every credential that opens the vault, `/passkey/delete-passkey`, `/link-social`, `/unlink-account` for every account, and account deletion (`/delete-user` and `account.deleteAccount`). Account deletion erases the vault and identity data in Better Auth's `deleteUser.beforeDelete`, which runs only after the endpoint's own session checks pass. Accounts without a passkey keep the session rules (a first passkey needs only a fresh session), and an anonymous account is still in sign-up. A social sign-in to the account's verified address still links that provider's account without a session, which proves the same mailbox control as a magic-link sign-in. Every change to these factors, including an added passkey, a recovery key that confirmed a recovery, such a link, a passkey removal, and a password reset by email, sends a notice (`notifyRecoveryFactorChange`) by email to the account's address, verified or not but never a placeholder address, and by web push where the user subscribed (`kind: "account_notice"`, shown without actions). An email change notifies the previous address, and a notice of an added passkey links to `/recovery/passkey?intent=remove`, where the user removes passkeys they don't recognize and signs out other devices.

**Verification Flow** (from `/dashboard/verify/*`):

Users choose a verification method via `VerificationMethodCards` (OCR gated by `DOCUMENT_OCR_ENABLED`, NFC chip gated by `NEXT_PUBLIC_ZKPASSPORT_ENABLED`). Both paths converge at the same `identity_verifications` table (unified schema with `method` discriminator: `"ocr"` | `"nfc_chip"`).

**OCR path:**

1. **Document OCR** → `trpc.identity.prepareDocument` extracts data, generates commitments
2. **Liveness + Face Match** → `trpc.liveness.*` runs multi-gesture challenges, server verifies
3. **Profile Secret** → Extracted PII is encrypted with the user's credential (passkey/password/wallet) and stored as a `PROFILE` secret. This is the only persistent copy of the user's PII and is only decryptable by the user.
4. **ZK Proofs** → Client-side Noir generates UltraHonk proofs (age, doc validity, nationality, face match)
5. **FHE Encryption** → Encrypt DOB, country code, compliance level via FHE service
6. **Compliance derivation** → `deriveComplianceStatus()` pure function (`src/lib/identity/verification/compliance.ts`) computes level from proofs, claims, and flags — no DB access, no mutable booleans
7. User reaches **Tier 2/3** depending on proof completeness

**Compliance Derivation Engine:**

`deriveComplianceStatus(input) → { verified, level, numericLevel, birthYearOffset, checks }` is the sole source of truth for compliance status. It takes `verificationMethod`, `zkProofs`, `signedClaims`, `encryptedAttributes`, `hasUniqueIdentifier`, `hasNationalityCommitment`, and `birthYearOffset`.

Levels: `none`(1) → `basic`(2) → `full`(3) → `chip`(4). Level is `chip` when NFC + sybilResistant; `full` when all 7 checks pass; `basic` when >= half pass; `none` otherwise. `verified` is true only for `full` or `chip`.

7 boolean checks: `documentVerified` (doc_validity ZK proof), `livenessVerified` (liveness_score claim), `ageVerified` (age_verification ZK proof), `faceMatchVerified` (face_match ZK proof or face_match_score claim), `nationalityVerified` (nationality_membership ZK proof), `identityBound` (identity_binding ZK proof), `sybilResistant` (dedupKey/chipNullifier).

NFC chip path: `documentVerified` always true; `livenessVerified`/`ageVerified`/`faceMatchVerified` from `chip_verification` signed claim **type presence** (boolean payloads ignored); `nationalityVerified` from `hasNationalityCommitment`; `identityBound`/`sybilResistant` from `chipNullifier`.

**Identity Revocation:** `revokeIdentity()` (`src/lib/db/queries/identity.ts`) executes a cascade in a single DB transaction: (1) mark `identity_verifications` as revoked (`revokedAt`, `revokedBy`, `revokedReason`), (2) mark `identity_bundle` as revoked, (3) set OID4VCI credentials to `status=1` (revoked). Step 4 revokes on-chain attestations **outside** the transaction (best-effort). After revocation, assurance tier drops to Tier 1. Revoked dedup keys are auto-released for re-registration. Triggered via `identity.revokeVerification` (admin) or `identity.selfRevoke` (user GDPR).

**NFC chip path (ZKPassport):**

1. **Country/document pre-check** → `buildCountryDocumentList` (uses `@zkpassport/registry`) confirms NFC support
2. **ZKPassport deep-link** → Opens ZKPassport mobile app for NFC chip reading + proof generation
3. **Server verification** → `trpc.passportChip.submitResult` verifies proofs server-side via `zkpassport.verify()`
4. **Nullifier check** → `chipNullifier` (translated at the ZKPassport SDK boundary from the SDK-external `uniqueIdentifier`) prevents duplicate passport registrations across accounts
5. **FHE Encryption** → Same as OCR path; synthetic liveness score (1.0) from physical chip possession

**Blockchain (optional)** → After verification, users can attest on-chain via `trpc.attestation.*`

All API calls from the client use tRPC (`trpc.zk.*`, `trpc.liveness.*`, `trpc.attestation.*`, etc.).

**Privacy principle**: Raw PII is never stored. ZK proofs are generated CLIENT-SIDE so private inputs remain in the browser during proving, while OCR runs server-side and is signed. Only cryptographic commitments, FHE ciphertexts, signed claims, and ZK proofs are persisted. Images are processed transiently.

**User-controlled encryption**: FHE keys are generated client-side and stored server-side as credential-wrapped encrypted secrets (passkey PRF, OPAQUE export key, wallet signature, or a browser-generated recovery key, via HKDF). The server cannot decrypt these keys; only the user, with a passkey, password, wallet, or recovery key, can unwrap them. The server receives only public/evaluation keys for computation. See [Attestation & Privacy Architecture](docs/(architecture)/attestation-privacy-architecture.md) and [RFC-0001](docs/rfcs/0001-passkey-wrapped-fhe-keys.md).

## Code Conventions

- **Linting**: Biome via Ultracite preset (`pnpm exec ultracite fix`). Run `pnpm lint:fix` before commits.
- **Code Standards**: See `apps/web/.claude/CLAUDE.md` for detailed TypeScript/React style guidelines enforced by Ultracite
- **API Layer**: tRPC with Zod validation in `src/lib/trpc/`
- **Forms**: TanStack Form with Zod validation
- **UI Components**: shadcn/ui (Radix primitives) in `src/components/ui/`
- **Database**: Drizzle ORM with SQLite local files or Turso in production. Schema source of truth: `apps/web/src/lib/db/schema/`. Apply schema with `pnpm db:push` (no runtime migrations)
- **Turso**: set `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` for production/CI. For local file DBs, use a `file:` SQLite URL pointing at your local database path
- **SQLite driver**: uses `@libsql/client`

### Module Organization Principles

**Deep modules over shallow modules.** A module's interface cost (import path, directory entry, mental slot) must be justified by the complexity it hides. If combining two files produces a simpler interface for the same functionality, combine them. A 500-line cohesive module is preferable to five 100-line files that require understanding all five.

**`{domain}-{concern}.ts` naming, no stuttering inside bounded dirs.** The filename must predict its content. When the parent directory already owns the domain, drop the prefix: inside `email/`, it's `auth.ts` not `auth-mailer.ts`; inside `secrets/`, it's `vault.ts` not `secrets-vault.ts`. Banned: `utils.ts`, `helpers.ts`, `shared.ts`, `common.ts`, `data.ts`, standalone `types.ts`, `service.ts`, `store.ts` — name by what the file actually does.

**Sub-directory threshold: 4+ cohesive files.** Only create a sub-directory when a concern group has 4+ files after consolidation. Two-file directories are shallow modules at the directory level. Examples: `auth/oidc/haip/` (6 files, HAIP spec), `auth/oidc/disclosure/` (5 files, selective-disclosure registry).

**Component co-location.** Route-scoped components live in `_components/` next to their page, not in `src/components/`. Only genuinely cross-route components (`tier-badge.tsx`, `vault-unlock.tsx`, `agent-approval-view.tsx`) belong at the `src/components/` root.

**Schema by bounded context.** Schema files group by domain boundary: `auth.ts`, `oauth-provider.ts`, `identity.ts`, `privacy.ts`, `agent.ts`, `ciba.ts`, `organization.ts`, `oidc-credentials.ts`.

**No barrel files.** Avoid `index.ts` files that just re-export. If a module is 900 lines of business logic, name it after its domain (e.g., `vault.ts`), not `index.ts`.

**Avoid cross-domain collisions.** When a name would collide across domains, disambiguate by what each actually computes: on-chain attestation lives in `blockchain/attestation/`, agent-host attestation is `agents/host-attestation.ts`, ZK signed-claim attestation is `privacy/zk/attestation-claims.ts` — three domains, three distinct names.

See `apps/web/CLAUDE.md` for the current directory map.

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
| `passportChip` | ZKPassport NFC chip verification (submit proof results, poll FHE status) |
| `admin` | JWKS signing key rotation, cleanup, and on-chain revocation retry (admin-only via `adminProcedure`) |

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

OAuth clients are managed through the **Applications** page (`/dashboard/developer`) with organization-based ownership (via `referenceId` on the client table). `/api/rp-admin/clients/owned` lists the active organization's clients. Ownership is fixed at registration; clients cannot be transferred.

**HAIP compliance** (`@better-auth/haip`): DPoP enforced at token endpoint (`requireDpop: true`); tRPC resource endpoints accept Bearer only for tokens that are not DPoP-bound. Every DPoP proof is verified (ES256, `htm`/`htu`, `iat` window) with its `jti` reserved in the database against replay, and must carry a server-provided nonce (RFC 9449 §8, §9). The nonce requirement covers the token endpoint (every grant), UserInfo, Zentity's protected resources (`resource-access-token.ts`), the FPA challenge and its CIBA step-up, and the OID4VCI credential endpoints. Zentity's own DPoP endpoints verify proofs and issue nonces through the provider API (`verifyDpopProof`, `issueDpopNonce`), so the provider's `dpop.nonce` setting in `auth-config.ts` is the only nonce configuration. Nonces last 300 seconds and one nonce serves the whole origin; a refusal answers `use_dpop_nonce` with `DPoP-Nonce`, and accepted DPoP responses carry the next nonce. The `/oauth2/token` before-hook calls the provider's `challengeDpopNonce()` before Zentity's other token hooks stage the grant. PAR is served by the OAuth provider (`pushedAuthorizationRequests: { enabled: true }`, form-encoded only) and stays optional (`require_pushed_authorization_requests: false`) because remote MCP hosts authorize without it and credential issuance uses the pre-authorized code grant; Zentity's PAR hook requires a `resource` indicator and keeps a pushed request's `acr_values` in the verification store so step-up enforcement can read them at `/oauth2/authorize`. Other HAIP settings: wallet attestation (`TRUSTED_WALLET_ISSUERS`, a JSON array of trusted issuers) and JARM encrypted VP responses (ECDH-ES P-256). Pairwise subject identifiers (`PAIRWISE_SECRET`, required min 32 chars) are Zentity's own privacy rule, not a HAIP requirement: every client registered through dynamic registration or `/oauth2/create-client` is pairwise (dynamic registration refuses `subject_type: "public"`, and `/oauth2/create-client` clients are made pairwise), and so is the built-in OIDC4VCI wallet client `zentity-wallet` (sector `client/zentity-wallet`). A JWT access token names one audience outside Zentity, with its `sub` and `act.sub` pairwise for the client and that audience together; the provider's encrypted `ba_sub` names the user for UserInfo, introspection, and the OID4VCI credential endpoints. OID4VCI credentials carry no `sub` (holder binding is `cnf.jwk`) and get a random status list index. Discovery documents come from the provider: Zentity's fields (Proof-of-Human and validity endpoints, `payment_authorization`, resource indicators) are a provider `metadata` extension (`discoveryMetadataExtension` in `well-known.ts`), registered through `oauthProvider({ extensions })` ahead of every plugin's so it wins the first-wins merge, the first-party-apps plugin advertises `authorization_challenge_endpoint` through its own extension, and extra claim names go in `advertisedMetadata.claims_supported`. The root `/.well-known/*` routes serve the provider's documents unchanged. Zentity's registration field `rp_validity_notice_uri` is a provider `clientMetadata` field (`client-metadata.ts`), stored in the client's `metadata`.

**First-Party Apps** (`draft-ietf-oauth-first-party-apps-04`): Authorization Challenge Endpoint at `POST /api/auth/oauth2/authorize-challenge` for CLI and native clients, served by the fork's `@better-auth/first-party-apps` plugin (vendored tarball) and configured in `src/lib/auth/oidc/first-party-apps.ts`. Zentity supplies two credential methods: OPAQUE (3 rounds) and Sign-In with Ethereum wallet (2 rounds). The wallet round answers `challenge_type: "siwe"` with a server-built EIP-4361 `message` (app origin, first-party statement, a random Request ID kept in the plugin's encrypted method state, five-minute single-use nonce), which the client signs with EIP-191 and returns as `siwe_signature`. The initial request is form-encoded with `client_id`, `response_type=code`, `login_hint`, `scope`, PKCE, and a DPoP proof (`requireDpop: true`); later rounds may be JSON, and no request or token redemption carries `redirect_uri`. Credential resolution: OPAQUE > SIWE > `redirect_to_web`. A wallet address hint always gets SIWE (an unknown address gets the same challenge); an email hint gets OPAQUE, a dummy OPAQUE challenge when unknown, or `redirect_to_web` when the account has no OPAQUE password, so an email never reveals a wallet address. Only clients with both `first_party` and `skip_consent` can use the endpoint; others get `unauthorized_client`. The plugin authenticates the client on every request, binds every `auth_session` to the DPoP key, and stores only an HMAC of it. Responses follow draft-04: 403 `insufficient_authorization` with `auth_session` and `challenge_type` for a challenge, 400 `authentication_failed` for a wrong credential, 403 `redirect_to_web` when the browser must take over, 400 `invalid_session`, and 200 `{ authorization_code }`. Limits: 10 requests per minute per IP, three failures per `auth_session`, and ten failures per account and method in 15 minutes. Each challenge request deletes expired `auth_session` rows and failure budgets whose window has passed. Unmet `acr_values` keep the sign-in and answer 403 `insufficient_authorization` without `challenge_type`; the client presents the `auth_session` again once the user's tier rises. Each sign-in creates a 24-hour session (which bounds its tokens) with an `authentication_contexts` row (`authorize_challenge_opaque` or `authorize_challenge_eip712`), and the token response returns a new `auth_session`. Step-up at the token endpoint: when a CIBA token poll fails `acr_values` and the request has no `authorization_details`, `enforceCibaTokenAcr` calls the plugin's `challengeFirstPartyStepUp` for the CIBA request's client, so a confidential first-party client gets HTTP 403 + `auth_session` and every other client gets 400 `interaction_required`. Schema: `first_party_auth_session` and `first_party_failure_budget` in `src/lib/db/schema/oauth-provider.ts`.

**CIBA** (`@better-auth/ciba`): Backchannel auth for agent authorization. Poll and ping modes. Endpoints: `POST /oauth2/bc-authorize` (form-encoded only), plus Zentity's approval endpoints `GET /ciba/request?request_id=`, `POST /ciba/decision/options`, and `POST /ciba/decision` (`src/lib/auth/oidc/ciba.ts`). The decision refuses a notification approval (`channel` `push`, or none) of a page-only request with `review_required`, enforces `acr_values`, refuses an `x402_purchase` approval below the merchant's `min_identity_strength` with `insufficient_identity_strength` (the request stays pending), requires a staged release for identity scopes (`vault_unlock_required`), and requires a user-verified passkey assertion (`webauthn`) when the approval policy needs one: always for `payment_authorization`, `purchase`, and `x402_purchase`, and for identity scopes when the user has a passkey (`passkey_required` when the user has none). The assertion comes from `auth/passkey/step-up.ts`, a single-use challenge bound to the request and session, and its authentication context becomes the token's `amr` (`["pop", "user", "mfa"]`) and `auth_time`. The decision then records itself through the plugin's server-only `completeCibaRequest`. Grant type `urn:openid:params:grant-type:ciba` is handled at the token endpoint by the plugin. Clients must register `backchannel_token_delivery_mode` (`poll` or `ping`); ping goes only to a registered public `https` `backchannel_client_notification_endpoint`. The plugin stores `auth_req_id` as a SHA-256 hash, validates and stores the request's `acr_values` (a JSON array) and `authorization_details` on `ciba_request`, and issues the details in the access token and the token response. It accepts only the RAR types registered through `authorizationDetailsTypes`, which Zentity builds from the SDK's `AUTHORIZATION_DETAILS_TYPES` map, the same map discovery's `authorization_details_types_supported` lists: `payment_authorization`, `purchase`, and `x402_purchase`, each a strict schema. A payment also needs a client that registered `authorization_details_types` containing `payment_authorization` (RFC 9396 §10), and an `x402_purchase` needs an asset from the SDK asset registry (Base Sepolia USDC) and, in production, an `https` resource. Zentity's bc-authorize before-hook pins a payment request (`pinPaymentRequest`: exactly one canonical entry, else `invalid_authorization_details`, and `resource` set to `WALLET_AUDIENCE`), then a purchase request (`pinPurchaseRequest` in `src/lib/auth/oidc/purchase-request.ts`: exactly one strict entry, re-serialized, else `invalid_authorization_details`; `resource` set to the app origin, so the token is opaque; `x402_purchase` needs scope exactly `openid poh`, `purchase` refuses `poh`, and `poh` without an `x402_purchase` entry is refused with `invalid_scope`), and normalizes `resource`. Scopes are refused, never rewritten. No scope marks a payment: the wallet resource (`accessTokenTtl: 120`, seeded with `resourceSeedMode: "merge"`) sets the payment token's 120-second lifetime, and `WALLET_AUDIENCE` is refused with `invalid_target` everywhere except a payment request and its CIBA token poll. Supports `authorization_details` (RAR) for structured action metadata and `acr_values` for assurance tier enforcement. The plugin treats `acr_values` as voluntary, so Zentity enforces them strictly at approval time and token exchange. Request statuses: `pending`, `approved`, `denied`. Every decision writes one `ciba_approval` row before the plugin can consume the request, keyed by the stored `auth_req_id` hash that every token of the approval carries as `reference_id`; its unique index lets only one decision win, a failed completion deletes it, and it outlives the `ciba_request` row the plugin deletes. It records `decision`, `approval_method` (`session`, `user_verification`, or `capability_grant`), `approval_channel` (`push`, `page`, `email`, or `grant`), copies of what was requested, and the grant facts, and it backs the Requests tab history. The CIBA token response carries `oversight: { method, approved_at }` from it. Approval UI: standalone `/approve/[requestId]` (push and email target, no dashboard chrome), addressed by request id rather than `auth_req_id`. For a user-verified approval it runs one passkey assertion at Approve, which also opens a locked passkey-wrapped vault through PRF, and it offers "Add a passkey" with Deny to a user without one. It posts `channel: "page"`, or `"email"` when the URL carries the email link's `?via=email`. Listing at `/dashboard/agents` (Requests tab). Email notifications via `src/lib/email/ciba.ts`. Web push notifications: service worker (`public/push-sw.js`), which offers inline Approve only when the payload's `inlineApprove` is true (every scope has a server label the body lists as `Shares: ...`) and otherwise Review and Deny, posts `channel: "push"`, and gets a TTL equal to the request's remaining lifetime, push subscription API at `/api/ciba/push/subscribe` and `/api/ciba/push/unsubscribe`, `PushManager` client in `src/lib/agents/push-client.ts`. VAPID env vars: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`. Identity PII delivery: ephemeral in-memory store with single-consume semantics (5-min TTL for OAuth2, 10-min for CIBA); PII delivered exclusively via userinfo endpoint, never in id_tokens. `requiresVaultUnlock`: identity-scoped requests show only "Deny" inline (vault unlock requires browser context). Schema: `src/lib/db/schema/ciba.ts`. Demo: Aether AI shopping agent at `apps/demo-rp/src/app/aether/`.

**OID4VP verifier** (`apps/demo-rp`): VeriPass at `/veripass` with 4 scenarios (border, employer, venue, financial). Uses DCQL queries, JAR JWTs with x5c chain, `x509_hash:<leaf thumbprint>` client IDs (no `client_id_scheme`), JARM `direct_post.jwt` response mode. `apps/demo-rp/src/lib/verify.ts` verifies presentations with `@sd-jwt/sd-jwt-vc`: `iss` must equal `NEXT_PUBLIC_ZENTITY_URL` plus `/api/auth`, disclosures are bound to the issuer's `_sd` digests, and the KB-JWT is bound to `cnf.jwk`, `sd_hash`, the session nonce, and the `x509_hash` client ID as audience. The credential must reference a Token Status List that marks it valid. The list is fetched only from the issuer's origin, without redirects or caching. A revoked credential, an unreachable or invalid list, and a credential without a status reference are all rejected. Dev certs required: `pnpm exec tsx scripts/generate-dev-certs.ts`.

**Back-Channel Logout** (OIDC BCL): the OAuth provider serves RP-initiated logout at `GET /api/auth/oauth2/end-session` (`end_session_endpoint`) and sends back-channel logout tokens itself whenever a session ends. Clients that register `post_logout_redirect_uris` through dynamic client registration (`/oauth2/register`) get `enable_end_session` through the provider's `clientRegistrationEnableEndSession` policy, and each of those URIs must share an origin with one of the client's `redirect_uris`. Clients created from a Client ID Metadata Document or through `createOAuthClient` do not get it. The provider validates and stores `backchannel_logout_uri` at registration and adds `sid` to id_tokens for clients with `enable_end_session` or a `backchannel_logout_uri`. When a session is deleted, `denyPendingCibaRequestsForUser()` (`src/lib/db/queries/ciba.ts`) denies the user's pending CIBA requests, except for a session the Authorization Challenge Endpoint deletes for its own flow, which is not a logout. Discovery: `backchannel_logout_supported: true`, `backchannel_logout_session_supported: true`, `end_session_endpoint`.

**JWKS Key Rotation**: signing keys live in the Better Auth `jwt` plugin's `jwks` table and follow its policy (`signingKeyOptions` in `jwt-signer.ts`): an RS256 primary key and an EdDSA key for access tokens, each minted on first use and rotated every 90 days (`rotationInterval`). A retired key stays in the JWKS for a 365-day `gracePeriod`, which covers the one-year SD-JWT VCs it may have signed. `rotateSigningKey(alg)` mints a replacement and retires the old key immediately; `cleanupExpiredKeys()` deletes keys past the grace period. Both are exposed via the `admin` tRPC router (admin-only). The plugin adapter stores private keys in an AES-256-GCM envelope (`KEY_ENCRYPTION_KEY` env var) instead of the plugin's own `BETTER_AUTH_SECRET` encryption.

**Token Exchange** (RFC 8693, `src/lib/auth/oidc/token-exchange.ts`): a custom grant that mints only opaque, DPoP-bound access tokens for the app (`NEXT_PUBLIC_APP_URL`, the one accepted `resource` or `audience`), with no `act`, no refresh token, and a lifetime capped by the subject token. It has two uses: agent bootstrap (a client exchanges its own DPoP-bound login token, proving its key, for the bootstrap scopes it already holds) and the MCP HTTP server's exchange (a confidential client linked to the token's audience through `oauth_client_resource`, with `skip_consent`, binding its own key). It refuses ID tokens, `actor_token`, a subject carrying `authorization_details`, a subject with `act` or that a CIBA approval issued (`ciba_approval` by `reference_id`), and a subject without a resolvable authentication context. Scopes are a subset of the subject's and of the client's registered scopes, never `offline_access`. Without a requested `scope`, the exchange also leaves out the agent bootstrap scopes, and it refuses an exchange that would keep no scope. Clients cannot declare themselves a protected resource.

**Agent Registration**: Durable host plus ephemeral session identity model. `agent_host` stores the persistent MCP installation identity keyed by `public_key_thumbprint`; the MCP persists the host key outside the repository under a per-instance namespace. `agent_session` stores the live runtime identity for one process. Registration endpoints: `POST /api/auth/agent/host/register` and `POST /api/auth/agent/register`, both authenticated with a DPoP-bound bootstrap token (`zentity_token_use: agent_bootstrap`): the agent signs the user in with the bootstrap scopes (`agent:host.register`, `agent:session.register`, `agent:session.revoke`; consent shows them as one line) and exchanges its own login token for a token holding only those scopes. The routes refuse the login token itself. Session registration requires a host-signed `host-attestation+jwt`, creates a fresh session, seeds active grants from host policy, and records requested extra capabilities as pending session grants.

**Agent Capabilities**: Server-side capability model split into durable `agent_host_policy` and ephemeral `agent_session_grant`. Seeded capabilities, as manual ceremony and whether a grant may approve them: `purchase` (`user_verification`, not grantable), `my_profile` (`session`, not grantable), `my_proofs`, `check_compliance`, and `whoami` (`session`, grantable), and `payment_authorization:sign` (`user_verification`, grantable by bounded grants only). Discovery (`GET /api/auth/agent/capabilities`) publishes `approval_strength` and `grantable`. `approvalPolicy` in `src/lib/agents/capability.ts` derives a request's ceremony, page-only flag, and single grant capability from the whole request (every scope and RAR entry) through one table, `APPROVAL_POLICY`; a request that spans capabilities or includes an ungrantable scope always goes to the user. Grant evaluation in `src/lib/agents/approval-evaluate.ts` is the sole auto-approve path for CIBA. Constraint operators: `max`, `min`, `in`, `not_in`, `eq`. Usage limits are enforced through `capability_usage_ledger` using `daily_limit_count`, `daily_limit_amount`, and `cooldown_sec`. Successful automatic approvals are recorded in `ciba_approval` with `approval_method: "capability_grant"` and `approval_channel: "grant"`.

**Agent Trust and Runtime Proof**: Host registration supports optional `OAuth-Client-Attestation` plus PoP verification against `TRUSTED_AGENT_ATTESTERS`, producing operational host tiers of `unverified` and `attested`. Attested hosts receive a wider default host policy (`read_profile` in addition to `check_compliance` and `request_approval`). Runtime proof on CIBA requests uses `Agent-Assertion`, a short-lived Ed25519 JWT signed by the registered session key and carrying `host_id`, `task_id`, and `task_hash`, the hex SHA-256 of the RFC 8785 canonical JSON of the request's binding message, sorted scopes, `acr_values`, and `authorization_details` (`taskHash` in `@zentity/sdk/protocol`). The bc-authorize before-hook verifies a present assertion against the request without consuming it, refuses a mismatch with `invalid_request` "Agent-Assertion does not match this request", and refuses an assertion from a session that is unknown, revoked, idle past its TTL, or past its lifetime with `invalid_request` "Agent session is not active"; the MCP stdio server and demo-rp then register a new session, sign again, and retry once. On verification, the server snapshots `agent_session_id` and host/runtime metadata onto `ciba_request`, then issues tokens whose `act` is `{ sub, sub_profile: "service" }`, with `act.sub` pairwise for the agent session in the token's own sector (the client and its one outside audience). No token carries the session, host, host key, or DID.

- [OAuth Integrations](docs/(protocols)/oauth-integrations.md) — Authorization flow, client management, scopes, consent, OIDC4VCI/VP, HAIP, CIBA

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

**Critical: BN254 field constraints** — All circuit inputs must fit the BN254 scalar field (~254 bits). Cryptographic outputs (passkey PRF, OPAQUE export keys, SHA-256) must use HKDF-based hash-to-field (512-bit expansion, then modulo BN254) before use. See [ZK Architecture](docs/(protocols)/zk-architecture.md#bn254-field-constraints).

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
KEY_ENCRYPTION_KEY=<min-32-char-string> # Required (z.string().min(32)). AES-256-GCM envelope encryption for JWKS private keys at rest.
DEDUP_HMAC_SECRET=<min-32-char-string>  # Required (z.string().min(32)). HMAC key for sybil dedup and per-RP nullifiers.

# Web Push (auto-generated by pnpm setup)
VAPID_PUBLIC_KEY=<vapid-key>            # Required in production
VAPID_PRIVATE_KEY=<vapid-key>           # Required in production
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<vapid-key> # Same as VAPID_PUBLIC_KEY, baked into client bundle

# Email (required in production)
RESEND_API_KEY=<resend-key>
MAIL_FROM_EMAIL=no-reply@zentity.xyz

# Feature flags
NEXT_PUBLIC_ZKPASSPORT_ENABLED=false     # Enable NFC chip verification via ZKPassport
DOCUMENT_OCR_ENABLED=false               # Offer document scan (requires the OCR service)

# Optional overrides
OIDC4VP_JWKS_URL=                        # Fetch VP issuer keys from this URL instead of the in-process JWKS
```
