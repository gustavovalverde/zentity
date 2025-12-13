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
| Next.js | 16.0.7 | React framework with App Router |
| React | 19.0.0 | UI library |
| TypeScript | 5.x | Type safety |
| Tailwind CSS | 4.x | Styling |
| Radix UI | Latest | Accessible components |
| React Hook Form | 7.x | Form handling |
| Zod | 3.x | Schema validation |
| better-auth | Latest | Authentication |

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm

### Install Dependencies

```bash
pnpm install
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
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

### Build

```bash
pnpm build
```

### Production

```bash
pnpm start
```

## Project Structure

```
src/
├── app/                    # Next.js App Router
│   ├── (auth)/             # Auth routes (sign-in, sign-up)
│   ├── api/                # API routes
│   │   ├── auth/           # Authentication endpoints
│   │   ├── crypto/         # FHE & ZK proxy endpoints
│   │   ├── identity/       # Identity verification
│   │   ├── kyc/            # KYC document processing
│   │   └── liveness/       # Liveness detection proxy
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
| `/api/identity/verify` | POST | Full identity verification |
| `/api/identity/status` | GET | Get verification status |
| `/api/identity/verify-name` | POST | Verify name claim |
| `/api/kyc/upload` | POST | Upload document |
| `/api/kyc/process-document` | POST | OCR processing |
| `/api/crypto/encrypt-dob` | POST | FHE encrypt DOB |
| `/api/crypto/challenge` | POST | Issue a proof nonce (replay resistance) |
| `/api/crypto/circuits` | GET | Circuit manifest (IDs, vkey hashes, public input spec) |
| `/api/crypto/circuits/[circuitType]/vkey` | GET | Circuit verification key (base64) + hash |
| `/api/crypto/verify-proof` | POST | Verify ZK proof (Noir/UltraHonk) |
| `/api/liveness/verify` | POST | Full liveness check |

## Privacy Features

The web application implements privacy-preserving patterns:

1. **Hash Commitments** — Names, document numbers, nationality stored as SHA256 hashes
2. **FHE Encryption** — DOB, gender, and liveness scores encrypted with TFHE-rs
3. **ZK Proofs** — Age, document validity, face match, and nationality proofs via Noir/UltraHonk (client-side)
4. **Transient Processing** — Images processed and discarded immediately

No raw PII is stored in the database.

## Database Schema

The `identity_proofs` table stores only cryptographic data:

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
| `age_proof` | TEXT | ZK age proof payload (JSON) |
| `age_proof_verified` | INTEGER | Whether `age_proof` is verified |
| `age_proofs_json` | TEXT | JSON map of age proofs by threshold (e.g. `{\"18\": {...}}`) |
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

### Schema Updates

On startup, the app ensures required tables and columns exist (see `src/lib/db.ts` and `src/app/api/user/proof/route.ts`).

## Docker

```bash
docker build -t zentity-web .
docker run -p 3000:3000 zentity-web
```

## License

MIT
