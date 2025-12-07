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
ZK_SERVICE_URL=http://localhost:5002
LIVENESS_SERVICE_URL=http://localhost:5003
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
| `/api/crypto/generate-proof` | POST | Generate ZK proof |
| `/api/crypto/verify-proof` | POST | Verify ZK proof |
| `/api/liveness/verify` | POST | Full liveness check |

## Privacy Features

The web application implements privacy-preserving patterns:

1. **Hash Commitments** — Names and document numbers stored as SHA256 hashes
2. **FHE Encryption** — Date of birth encrypted with TFHE-rs
3. **ZK Proofs** — Age and face match proofs via Groth16
4. **Transient Processing** — Images processed and discarded immediately

No raw PII is stored in the database. See [KYC Data Architecture](../../docs/kyc-data-architecture.md) for details.

## Docker

```bash
docker build -t zentity-web .
docker run -p 3000:3000 zentity-web
```

## License

MIT
