# Zentity Web Application

Privacy-preserving KYC frontend built with Next.js 16 and React 19.

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

> **Note**: The default dev script uses `--webpack` because Turbopack
> currently fails to resolve `node-tfhe` WASM paths in development. If you
> want to try Turbopack anyway, run:
>
> ```bash
> bun run dev:turbo
> ```

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
│   │   ├── kyc/            # KYC metadata/upload endpoints (optional)
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
| `/api/trpc/*` | Various | Internal app APIs (crypto, onboarding, identity, liveness, kyc) |
| `/api/rp/*` | Various | External relying party (RP) integrations |
| `/api/identity/disclosure` | POST | Disclosure bundle (demo/integrations) |
| `/api/kyc` | GET | KYC status (metadata only) |
| `/api/kyc/upload` | POST | Upload document metadata (no bytes stored) |
| `/api/crypto/circuits` | GET | Circuit manifest (IDs, vkey hashes, public input spec) |
| `/api/crypto/circuits/[circuitType]/vkey` | GET | Circuit verification key (base64) + hash |
| `/api/crypto/nationality-proof` | GET/POST | Nationality membership helpers (Merkle inputs) |
| `/api/crypto/nationality-proof/verify` | POST | Verify nationality membership ZK proof |
| `/api/password/pwned` | POST | Password breach pre-check |

## Privacy Features

The web application implements privacy-preserving patterns:

1. **Salted Commitments** — Names, document numbers, nationality stored as salted SHA256 hashes
2. **FHE Encryption** — DOB, gender, and liveness scores encrypted with TFHE-rs
3. **ZK Proofs** — Age, document validity, face match, and nationality proofs via Noir/UltraHonk (client-side)
4. **Transient Processing** — Images processed and discarded immediately
5. **Password Security** — Server-side blocked breached passwords (Better Auth) + privacy-preserving UX pre-check

No raw ID document images or extracted document fields are stored in plaintext. (Authentication still stores account email/name as required for login.)

Details: `../../docs/password-security.md`

## Commitment & Proof Model

Zentity stores two kinds of privacy-preserving artifacts:

- **Commitments (hashes)** in `identity_proofs`: salted SHA256 commitments to specific attributes (e.g. document number, full name, nationality). The per-user salt is stored encrypted so deleting it makes these commitments unlinkable.
- **Proof material** in `age_proofs`: a server-verified Noir/UltraHonk proof + its public signals for `age ≥ 18`, plus optional FHE ciphertexts used for homomorphic computations.

Important: in this PoC, the ZK proof statements are about values extracted in the browser (e.g. `birthYear` from OCR). They are not cryptographically bound to a signed passport/ID document.

### Attribute Commitments vs. Single “Identity Commitment”

There are two common ways to structure a zk-identity scheme:

- **Commit individual attributes + prove claims directly** (what this repo does): store separate salted commitments (and separate proofs) per claim.
- **Commit to the full document once + prove all future claims about the commitment**: prove that a single commitment contains the fields from a valid, signed document, then all future statements (age, nationality group, etc.) are proven about that committed data.

Trade-offs:

- The current approach is simpler to implement and iterate on, but it does less to bind claims to document integrity and can require re-parsing/re-proving for new claim types.
- A single identity commitment enables stronger composability (one parse, many proofs) and can cryptographically bind all claims to signed data, but it typically requires larger circuits and more involved witness construction.

## Database Schema

The database stores only cryptographic artifacts and non-PII metadata:

### `identity_proofs` (commitments, flags, encrypted display data)

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT | Primary key |
| `user_id` | TEXT | Foreign key to users |
| `document_hash` | TEXT | SHA256(doc_number + user_salt) |
| `name_commitment` | TEXT | SHA256(full_name + user_salt) |
| `nationality_commitment` | TEXT | SHA256(nationality_code + user_salt) |
| `user_salt` | TEXT | Encrypted salt (enables erasure) |
| `dob_ciphertext` | TEXT | FHE encrypted birth year |
| `dob_full_ciphertext` | TEXT | FHE encrypted full DOB (YYYYMMDD) |
| `gender_ciphertext` | TEXT | FHE encrypted gender (ISO 5218) |
| `liveness_score_ciphertext` | TEXT | FHE encrypted anti-spoof score |
| `doc_validity_proof` | TEXT | ZK proof that document is not expired |
| `nationality_membership_proof` | TEXT | ZK proof of nationality group membership |
| `document_type` | TEXT | Document type label |
| `country_verified` | TEXT | ISO 3166-1 alpha-3 country code |
| `is_document_verified` | INTEGER | Document validation result |
| `is_liveness_passed` | INTEGER | Liveness result |
| `is_face_matched` | INTEGER | Face match result |
| `verification_method` | TEXT | Verification method label |
| `verified_at` | TEXT | ISO timestamp (when verified) |
| `confidence_score` | REAL | Overall confidence (0.0-1.0) |
| `first_name_encrypted` | TEXT | JWE encrypted first name for display |
| `created_at` | TEXT | Created timestamp |
| `updated_at` | TEXT | Updated timestamp |

### `age_proofs` (persisted proof payloads)

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT | Primary key |
| `user_id` | TEXT | Foreign key to users |
| `proof` | TEXT | Base64 UltraHonk proof (JSON string) |
| `public_signals` | TEXT | Public inputs (JSON array of strings) |
| `is_over_18` | INTEGER | Server-derived result from verified proof |
| `generation_time_ms` | INTEGER | Client-side proof generation time |
| `dob_ciphertext` | TEXT | Optional FHE ciphertext stored alongside proof |
| `fhe_client_key_id` | TEXT | Optional FHE key reference |
| `fhe_encryption_time_ms` | INTEGER | Optional FHE encryption time |
| `circuit_type` | TEXT | Circuit ID used for verification |
| `noir_version` | TEXT | Noir.js version |
| `circuit_hash` | TEXT | Circuit hash |
| `bb_version` | TEXT | Barretenberg version |
| `created_at` | TEXT | Created timestamp |

### `zk_challenges` (one-time nonces for replay resistance)

| Column | Type | Description |
|--------|------|-------------|
| `nonce` | TEXT | 128-bit nonce (hex, no `0x`) |
| `circuit_type` | TEXT | Circuit ID bound to this nonce |
| `user_id` | TEXT | Optional user binding |
| `created_at` | INTEGER | Epoch milliseconds |
| `expires_at` | INTEGER | Epoch milliseconds |

### Schema Updates

On startup, the app ensures required tables and columns exist (see `src/lib/db.ts`, `src/lib/challenge-store.ts`, and `src/lib/age-proofs.ts`).

## Docker

```bash
docker build -t zentity-web .
docker run -p 3000:3000 zentity-web
```

## License

This project is licensed under the [O'Saasy License](../../LICENSE) ([osaasy.dev](https://osaasy.dev/)) - a permissive open source license based on MIT with a SaaS competition restriction.

See the [LICENSE](../../LICENSE) file for full terms.
