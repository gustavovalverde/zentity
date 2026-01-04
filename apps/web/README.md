# Zentity Web Application

Privacy-preserving identity verification and compliance frontend built with Next.js 16 and React 19.

## Overview

This is the main web application for Zentity, providing:

- **User onboarding flow** — 4-step wizard for identity verification
- **Document upload** — ID capture with OCR extraction
- **Liveness verification** — Selfie capture with anti-spoofing
- **Dashboard** — View verification status and privacy proofs
- **Relying Party demo** — API integration examples for third parties

## Technology Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| Next.js | 16.x | React framework with App Router |
| React | 19.x | UI library |
| TypeScript | 5.x | Type safety |
| Tailwind CSS | 4.x | Styling |
| Radix UI | Latest | Accessible components |
| TanStack React Form | 1.x | Form handling |
| Zod | 4.x | Schema validation |
| better-auth | Latest | Authentication |

## Getting Started

### Prerequisites

- Bun 1.3+

### Install Dependencies

```bash
bun install
```

### Environment Variables

Create a `.env.local` file:

```env
# Authentication
BETTER_AUTH_SECRET=your-secret-key

# Service URLs (defaults for local development)
FHE_SERVICE_URL=http://localhost:5001
OCR_SERVICE_URL=http://localhost:5004
```

### Development

```bash
bun run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Build

```bash
bun run build
```

### Production

```bash
bun run start
```

## Debugging

Next.js supports server-side debugging with Node's inspector. We include a
VS Code launch configuration in `.vscode/launch.json` that runs `bun run dev -- --inspect`
from `apps/web` and opens the browser automatically.

### Server-side debugging (VS Code)

1. Open the Debug panel.
2. Run **Next.js: debug server-side (apps/web)** or **Next.js: debug full stack (apps/web)**.

### Server-side debugging (CLI)

```bash
bun run dev -- --inspect
```

If you ever run the app inside Docker, use:

```bash
NODE_OPTIONS=--inspect=0.0.0.0 bun run dev
```

## Testing

### E2E (Playwright + Synpress + MetaMask)

This repo uses Synpress to drive a real MetaMask extension during Playwright
tests (no mock wallet). The wallet cache lives in `.cache-synpress/` and is
generated from `e2e/wallet-setup/hardhat.setup.ts`.

First-time setup (or after changing wallet setup):

```bash
bun run test:e2e:setup
```

Run the full E2E suite:

```bash
bun run test:e2e
```

Defaults (can be overridden via env):

- `SYNPRESS_SEED_PHRASE` defaults to Hardhat's public mnemonic.
- `SYNPRESS_WALLET_PASSWORD` defaults to `Password123!`.
- `SYNPRESS_NETWORK_RPC_URL` defaults to `http://127.0.0.1:8545`.
- `SYNPRESS_NETWORK_CHAIN_ID` defaults to `31337`.
- `SYNPRESS_NETWORK_NAME` defaults to `Hardhat Local`.
- `SYNPRESS_NETWORK_SYMBOL` defaults to `ETH`.

If you run E2E against an existing dev server, set
`NEXT_PUBLIC_COOP=same-origin-allow-popups` so popup-based wallet SDKs can
communicate without COOP blocking them.

The setup step spins up a local Hardhat node temporarily so MetaMask can add
the network during wallet cache creation.

To rebuild the wallet cache after edits to the setup file or env overrides:

```bash
bunx synpress ./e2e/wallet-setup --force
```

## Project Structure

```text
src/
├── app/                    # Next.js App Router
│   ├── (auth)/             # Auth routes (sign-in, sign-up)
│   ├── api/                # API routes
│   │   ├── auth/           # Authentication endpoints (better-auth)
│   │   ├── trpc/           # Internal app API (tRPC)
│   │   ├── rp/             # External RP integration endpoints (Hono)
│   │   ├── crypto/         # Public ZK artifacts + nationality helpers
│   │   ├── identity/       # Disclosure endpoints
│   │   └── password/       # Password pwned checks
│   ├── dashboard/          # User dashboard
│   └── onboarding/         # Verification wizard
├── components/
│   ├── dashboard/          # Dashboard components
│   ├── onboarding/         # Wizard step components
│   └── ui/                 # Shared UI components (shadcn)
├── features/
│   └── auth/               # Authentication logic
├── lib/                    # Utilities and helpers
└── hooks/                  # Custom React hooks
```

## API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/auth/*` | Various | Authentication (better-auth) |
| `/api/trpc/*` | Various | Internal app APIs (crypto, onboarding, identity, liveness) |
| `/api/rp/*` | Various | External relying party (RP) integrations |
| `/api/identity/disclosure` | POST | Disclosure bundle (demo/integrations) |
| `/api/crypto/circuits` | GET | Circuit manifest (IDs, vkey hashes, public input spec) |
| `/api/crypto/circuits/[circuitType]/vkey` | GET | Circuit verification key (base64) + hash |
| `/api/crypto/nationality-proof` | GET/POST | Nationality membership helpers (Merkle inputs) |
| `/api/crypto/nationality-proof/verify` | POST | Verify nationality membership ZK proof |
| `/api/password/pwned` | POST | Password breach pre-check |

## Privacy Features

The web application implements privacy-preserving patterns:

1. **Salted Commitments** — Names, document numbers, nationality stored as salted SHA256 hashes
2. **FHE Encryption** — birth_year_offset, country_code, compliance_level, liveness score encrypted with TFHE-rs (client-owned keys)
3. **ZK Proofs** — Age, document validity, face match, and nationality proofs via Noir/UltraHonk (client-side)
4. **Signed Claims** — OCR, liveness, and face match scores signed by the backend
5. **Transient Processing** — Images processed and discarded immediately
6. **Password Security** — Server-side blocked breached passwords (Better Auth) + privacy-preserving UX pre-check

No raw ID document images or extracted document fields are stored in plaintext beyond minimal metadata. (Authentication still stores account email/name as required for login.)

Details: `../../docs/attestation-privacy-architecture.md` | `../../docs/password-security.md`

## Commitment & Proof Model

Zentity stores privacy-preserving artifacts across multiple tables:

- **identity_bundles** — user-level status + FHE key registration
- **identity_documents** — per-document commitments + metadata
- **zk_proofs** — proof payloads + public inputs + verification metadata
- **encrypted_attributes** — TFHE ciphertexts (birth_year_offset, country_code, compliance_level, liveness_score)
- **signed_claims** — server-signed OCR/liveness/face match claims
- **attestation_evidence** — policy_hash + proof_set_hash for audits
- **encrypted_secrets** — passkey-wrapped secrets (FHE keys, profile data)
- **secret_wrappers** — per-passkey DEK wrappers for multi-passkey access
- **passkey_credentials** — WebAuthn credential metadata (better-auth)

Important: proofs are bound to server-signed claims + document hash, but not yet to cryptographic document signatures.

### Attribute Commitments vs. Single “Identity Commitment”

There are two common ways to structure a zk-identity scheme:

- **Commit individual attributes + prove claims directly** (what this repo does): store separate salted commitments (and separate proofs) per claim.
- **Commit to the full document once + prove all future claims about the commitment**: prove that a single commitment contains the fields from a valid, signed document, then all future statements (age, nationality group, etc.) are proven about that committed data.

Trade-offs:

- The current approach is simpler to implement and iterate on, but it does less to bind claims to document integrity and can require re-parsing/re-proving for new claim types.
- A single identity commitment enables stronger composability (one parse, many proofs) and can cryptographically bind all claims to signed data, but it typically requires larger circuits and more involved witness construction.

## Database Schema (high level)

The schema is defined in `apps/web/src/lib/db/schema/` and applied with `bun run db:push` (no runtime migrations).
For a clean reset, delete the SQLite DB and rerun `bun run db:push`.

### Local + Docker Compose

Create the local DB file (bind-mounted into the container) before starting Docker:

```bash
mkdir -p apps/web/.data
TURSO_DATABASE_URL=file:./apps/web/.data/dev.db bun run db:push
docker compose up --build
```

### Turso (production / CI)

Set the Turso env vars and run `bun run db:push` from CI or your local machine:

```bash
TURSO_DATABASE_URL=libsql://your-db.turso.io \
TURSO_AUTH_TOKEN=your-token \
bun run db:push
```

In Railway, configure `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` on the web service.
For local SQLite files, use `TURSO_DATABASE_URL=file:./.data/dev.db`.

Note: `drizzle-kit push` needs a SQLite driver. This repo uses `@libsql/client`
in the environment that runs the command.

## Docker

```bash
docker build -t zentity-web .
docker run -p 3000:3000 zentity-web
```

## License

This project is licensed under the [O'Saasy License](../../LICENSE) ([osaasy.dev](https://osaasy.dev/)) - a permissive open source license based on MIT with a SaaS competition restriction.

See the [LICENSE](../../LICENSE) file for full terms.
