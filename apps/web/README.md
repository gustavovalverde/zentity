# Zentity Web Application

Privacy-preserving identity verification and compliance frontend built with
Next.js 16 and React 19.

## Overview

This is the main web application for Zentity, providing:

- **Sign-up** — 2-step wizard (email optional → account + FHE key enrollment)
  with three authentication methods: passkeys, OPAQUE passwords, or wallet
  signatures (EIP-712)
- **Dashboard verification** — Document upload + liveness + proof generation
- **Dashboard** — View verification status and privacy proofs
- **Partner integrations** — OAuth provider flow for third-party verification
  checks
- **Social recovery** — Guardian approvals (email + authenticator) and Recovery
  ID-based recovery initiation

## Technology Stack

| Technology | Version | Purpose |
| --- | --- | --- |
| Next.js | 16.x | React framework with App Router |
| React | 19.x | UI library |
| TypeScript | 5.x | Type safety |
| Tailwind CSS | 4.x | Styling |
| Radix UI | Latest | Accessible components |
| TanStack React Form | 1.x | Form handling |
| Zod | 4.x | Schema validation |
| better-auth | Latest | Authentication (passkey, OPAQUE, wallet) |

## Getting Started

### Prerequisites

- pnpm 10+

### Install Dependencies

```bash
pnpm install
```

### Environment Variables

Create a `.env.local` file:

```env
# Authentication
BETTER_AUTH_SECRET=your-secret-key
OPAQUE_SERVER_SETUP=your-opaque-server-setup
# Optional (recommended for production): pin the OPAQUE public key for MITM protection
NEXT_PUBLIC_OPAQUE_SERVER_PUBLIC_KEY=your-opaque-server-public-key

# Service URLs (defaults for local development)
FHE_SERVICE_URL=http://localhost:5001
OCR_SERVICE_URL=http://localhost:5004
SIGNER_COORDINATOR_URL=http://localhost:5002
SIGNER_ENDPOINTS=http://localhost:5101,http://localhost:5102,http://localhost:5103
INTERNAL_SERVICE_TOKEN=dev-internal-token

# Recovery keys (server-side)
RECOVERY_RSA_PRIVATE_KEY=...            # production
RECOVERY_RSA_PRIVATE_KEY_PATH=.data/recovery-key.pem
RECOVERY_KEY_ID=v1

# Email delivery
RESEND_API_KEY=...                      # production
MAIL_FROM_EMAIL=no-reply@zentity.local
MAIL_FROM_NAME=Zentity
MAILPIT_BASE_URL=http://localhost:8025
MAILPIT_SEND_API_URL=http://localhost:8025/api/v1/send
MAILPIT_SEND_API_USERNAME=
MAILPIT_SEND_API_PASSWORD=
```

Mail delivery uses Resend in production when `RESEND_API_KEY` is set. In local
development, Mailpit captures recovery emails (or the UI shows manual approval
links if email is not configured).

### Development

```bash
pnpm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Build

```bash
pnpm run build
```

### Production

```bash
pnpm run start
```

## Debugging

Next.js supports server-side debugging with Node's inspector. We include a
VS Code launch configuration in `.vscode/launch.json` that runs
`pnpm run dev -- --inspect` from `apps/web` and opens the browser
automatically.

### Server-side debugging (VS Code)

1. Open the Debug panel.
2. Run **Next.js: debug server-side (apps/web)** or
   **Next.js: debug full stack (apps/web)**.

### Server-side debugging (CLI)

```bash
pnpm run dev -- --inspect
```

If you ever run the app inside Docker, use:

```bash
NODE_OPTIONS=--inspect=0.0.0.0 pnpm run dev
```

## Testing

### E2E: Social Recovery

Run the social recovery flow (no Synpress required):

```bash
pnpm run test:e2e -- e2e/social-recovery.spec.ts
```

### E2E (Playwright + Synpress + MetaMask)

This repo uses Synpress to drive a real MetaMask extension during Playwright
tests (no mock wallet). The wallet cache lives in `.cache-synpress/` and is
generated from `e2e/wallet-setup/hardhat.setup.ts`.

First-time setup (or after changing wallet setup):

```bash
pnpm run test:e2e:setup
```

Run the full E2E suite:

```bash
pnpm run test:e2e
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
pnpm exec synpress ./e2e/wallet-setup --force
```

## Project Structure

```text
src/
├── app/                    # Next.js App Router
│   ├── (auth)/             # Auth routes (sign-in, sign-up, recovery)
│   ├── (dashboard)/        # Dashboard routes (authenticated)
│   ├── api/                # API routes
│   │   ├── auth/           # Authentication endpoints (better-auth)
│   │   ├── trpc/           # Internal app API (tRPC)
│   │   ├── crypto/         # ZK artifacts + nationality helpers
│   │   ├── identity/       # Disclosure endpoints
│   │   └── password/       # Password pwned checks
├── components/
│   ├── dashboard/          # Dashboard components
│   ├── sign-up/            # Sign-up wizard components
│   ├── verification/       # Dashboard verification components
│   └── ui/                 # Shared UI components (shadcn)
├── features/
│   └── auth/               # Authentication logic
├── lib/                    # Utilities and helpers
└── hooks/                  # Custom React hooks
```

## API Routes

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/auth/*` | Various | Auth (Better Auth, passkey, OAuth) |
| `/api/trpc/*` | Various | Internal APIs (crypto, sign-up, verification) |
| `/api/fhe-enrollment/context` | POST | Create FHE enrollment context + token |
| `/api/identity/disclosure` | POST | Disclosure bundle (demo/integrations) |
| `/api/crypto/circuits` | GET | Circuit manifest (IDs, vkey hashes) |
| `/api/crypto/circuits/[circuitType]/vkey` | GET | Circuit vkey + hash |
| `/api/crypto/nationality-proof` | GET/POST | Nationality helpers |
| `/api/crypto/nationality-proof/verify` | POST | Verify nationality ZK proof |
| `/api/secrets/blob` | POST | Pre-auth encrypted blob upload |
| `/api/fhe/enrollment/complete` | POST | Finalize FHE enrollment |
| `/api/password/pwned` | POST | Password breach pre-check |

## Recovery Routes

| Route | Purpose |
| --- | --- |
| `/recover-social` | Start social recovery with email or Recovery ID |
| `/recover-guardian` | Guardian approval link handler |
| `/verify-2fa` | Two-factor verification UI |

## ZK Proof Development

ZK circuits are in `noir-circuits/` and compiled with `pnpm circuits:compile`.

### BN254 Field Constraints

All circuit inputs must fit within the BN254 scalar field (~254 bits).
Cryptographic outputs (passkey PRF, OPAQUE export keys, SHA-256 hashes) are 256
bits and **must be reduced** before use:

```typescript
// Values exceeding field modulus cause proof generation to fail
const reduced = rawValue % BN254_FR_MODULUS;
```

See `docs/zk-architecture.md#bn254-field-constraints` for details.

### Worker Debug Logs

Enable worker logs in development:

```env
NEXT_PUBLIC_NOIR_DEBUG=true
```

## Privacy Features

The web application implements privacy-preserving patterns:

1. **Salted Commitments** — Names, document numbers, nationality stored as
   salted SHA256 hashes
2. **FHE Encryption** — birth_year_offset, country_code, compliance_level,
   liveness score encrypted with TFHE-rs (client-owned keys)
3. **ZK Proofs** — Age, document validity, face match, and nationality proofs
   via Noir/UltraHonk (client-side)
4. **Signed Claims** — OCR, liveness, and face match scores signed by the
   backend
5. **Transient Processing** — Images processed and discarded immediately
6. **Password Security** — Server-side blocked breached passwords
   (Better Auth) + privacy-preserving UX pre-check

No raw ID document images or extracted document fields are stored in plaintext
beyond minimal metadata. (Authentication still stores account email/name as
required for login.)

Details: `../../docs/attestation-privacy-architecture.md` |
`../../docs/password-security.md`

## Commitment & Proof Model

Zentity stores privacy-preserving artifacts across multiple tables:

- **identity_bundles** — user-level status + FHE key registration
- **identity_documents** — per-document commitments + metadata
- **zk_proofs** — proof payloads + public inputs + verification metadata
- **encrypted_attributes** — TFHE ciphertexts
  (birth_year_offset, country_code, compliance_level, liveness_score)
- **signed_claims** — server-signed OCR/liveness/face match claims
- **attestation_evidence** — policy_hash + proof_set_hash for audits
- **encrypted_secrets** — passkey-wrapped secrets (FHE keys, profile data)
- **secret_wrappers** — per-passkey DEK wrappers for multi-passkey access
- **passkey** — WebAuthn credential metadata (better-auth)

Important: proofs are bound to server-signed claims + document hash, but not yet
to cryptographic document signatures.

### Attribute Commitments vs. Single “Identity Commitment”

There are two common ways to structure a zk-identity scheme:

- **Commit individual attributes + prove claims directly**
  (what this repo does): store separate salted commitments (and separate proofs)
  per claim.
- **Commit to the full document once + prove all future claims about the
  commitment**: prove that a single commitment contains the fields from a
  valid, signed document, then all future statements (age, nationality group,
  etc.) are proven about that committed data.

Trade-offs:

- The current approach is simpler to implement and iterate on, but it does less
  to bind claims to document integrity and can require re-parsing/re-proving for
  new claim types.
- A single identity commitment enables stronger composability (one parse, many
  proofs) and can cryptographically bind all claims to signed data, but it
  typically requires larger circuits and more involved witness construction.

## Database Schema (high level)

The schema is defined in `apps/web/src/lib/db/schema/` and applied with
`pnpm run db:push` (no runtime migrations).
For a clean reset, delete the SQLite DB and rerun `pnpm run db:push`.

### Local + Docker Compose

Create the local DB file (bind-mounted into the container) before starting
Docker:

```bash
mkdir -p apps/web/.data
TURSO_DATABASE_URL=file:./apps/web/.data/dev.db pnpm run db:push
docker compose up --build
```

### Turso (production / CI)

Set the Turso env vars and run `pnpm run db:push` from CI or your local machine:

```bash
TURSO_DATABASE_URL=libsql://your-db.turso.io \
TURSO_AUTH_TOKEN=your-token \
pnpm run db:push
```

In Railway, configure `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` on the web
service.
For local SQLite files, use `TURSO_DATABASE_URL=file:./.data/dev.db`.

Note: `drizzle-kit push` needs a SQLite driver. This repo uses `@libsql/client`
in the environment that runs the command.

## Docker

```bash
docker build -t zentity-web .
docker run -p 3000:3000 zentity-web
```

## Dependency Patches

This project uses pnpm's native patching (via `pnpm-workspace.yaml`)
to modify three packages:

| Package | Purpose |
| --- | --- |
| `better-auth` | Add `allowPasswordless` option for 2FA backup codes |
| `@better-auth/passkey` | Add WebAuthn extensions support and new error codes |
| `@daveyplate/better-auth-ui` | Custom auth UI configuration |

### Updating Patches

When you need to modify a patched package:

1. Run `pnpm patch <package>` to get a temp directory
2. Make changes in the temp directory
3. Run `pnpm patch-commit <temp-path>` to update the patch file
4. Test with a clean install: `rm -rf node_modules pnpm-lock.yaml && pnpm install`

## License

This project is licensed under the [O'Saasy License](../../LICENSE)
([osaasy.dev](https://osaasy.dev/)) - a permissive open source license based on
MIT with a SaaS competition restriction.

See the [LICENSE](../../LICENSE) file for full terms.
