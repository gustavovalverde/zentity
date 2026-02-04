# RFC-0022: zkPass Integration for Web Data Verification

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Created** | 2026-02-02 |
| **Updated** | 2026-02-04 |
| **Author** | Gustavo Valverde |
| **Related** | [RFC-0023](0023-zk-api-gateway.md) |

---

## Summary

Integrate zkPass's zkTLS protocol to verify data from authenticated web portals that Zentity cannot access through document verification. This closes critical compliance gaps:

| Gap | Why It Matters |
|-----|----------------|
| **Source of Funds** | Required for AML compliance—cannot be proven from ID documents |
| **Source of Wealth** | Required for high-risk customer due diligence |
| **Employment Verification** | Required for creditworthiness, background checks |
| **Educational Credentials** | Required for professional licensing, hiring |
| **Government Data** | Required for residency verification, tax compliance |
| **Account Ownership** | Required for Sybil resistance, reputation systems |

The integration is **entirely off-chain**—no blockchain required. Users prove claims about web data, Zentity verifies validator signatures, and stores verification outcomes alongside existing ZK proofs.

## Problem Statement

Zentity currently verifies identity through:

- Document OCR (passports, IDs, licenses)
- Biometric verification (liveness, face matching)
- Client-side ZK proofs (age, nationality, document validity)

However, regulatory compliance (AMLD6, FinCEN CIP, eIDAS 2.0) requires verification of data that **cannot be extracted from identity documents**—data that exists only in authenticated web portals:

| Gap in Zentity | Compliance Requirement | Data Sources |
|----------------|------------------------|--------------|
| **Source of Funds** | AMLD6, FinCEN CIP (critical) | Bank portals, payroll systems |
| **Source of Wealth** | High-risk customer due diligence | Investment accounts, tax portals |
| **Employment Verification** | Background checks, creditworthiness | LinkedIn, employer HR portals |
| **Educational Credentials** | Professional licensing, hiring | University portals, credential registries |
| **Government Data** | Residency, tax status, benefits | Government portals (tax, immigration) |
| **Account Ownership** | Sybil resistance, reputation | Social media, email providers |

These data sources exist behind authenticated web portals. Traditional approaches are inadequate:

| Approach | Problem |
|----------|---------|
| User shares credentials | Security risk—verifier sees login |
| Direct API integrations | Expensive, limited coverage, maintenance burden |
| User uploads screenshots/PDFs | Easily forged, requires PII handling |

zkPass solves this via **zkTLS**: proving data came from a specific HTTPS website without revealing credentials or raw data. The verification is entirely **off-chain**—no blockchain required.

## Technical Analysis

### Proof System Comparison

**Zentity's ZK System (Noir/Barretenberg)**:

- **Proof System**: UltraHonk (PLONK-based universal SNARK)
- **Circuit Language**: Noir DSL
- **Proving Location**: Client-side (browser Web Worker)
- **Verification Location**: Server-side (bb.js UltraHonkVerifierBackend)
- **Proof Size**: ~5KB
- **Proving Time**: 5-12 seconds (device-dependent)
- **Trust Model**: Trustless—mathematical verification

**zkPass's ZK System (VOLEitH)**:

- **Proof System**: VOLE-in-the-Head (MPC-based IZK)
- **Protocol**: zkTLS (3-Party TLS with MPC)
- **Proving Location**: TransGate extension/app
- **Verification Location**: zkPass Decentralized Verification Network (DVN)
- **Proof Size**: Variable (VOLE correlations + commitments)
- **Proving Time**: ~1 second (optimized for TLS sessions)
- **Trust Model**: Validator network—signatures from DVN nodes

### Critical Compatibility Finding

**The proof systems are NOT interoperable.**

- UltraHonk proofs cannot be verified by VOLEitH verifiers
- VOLEitH proofs cannot be verified by Barretenberg
- zkPass does NOT expose raw ZK proofs to integrators

**What zkPass returns to integrators**:

```typescript
interface zkPassResult {
  taskId: string;                  // Unique verification task ID
  publicFields: any[];             // User-disclosed public data
  publicFieldsHash: string;        // Hash of public fields
  allocatorAddress: string;        // Address of task allocator node
  allocatorSignature: string;      // Allocator's signature on task
  validatorAddress: string;        // Address of validator node
  validatorSignature: string;      // Validator's signature on result
  uHash: string;                   // Nullifier hash (user pseudonym)
  recipient?: string;              // User's blockchain address (optional)
}
```

**Integration model**: Zentity verifies **validator signatures**, not ZK proofs. This is an oracle trust model—we trust zkPass's DVN to have correctly verified the underlying VOLEitH proof.

### Trust Model Implications

| Aspect | Zentity Current Model | With zkPass Integration |
|--------|----------------------|------------------------|
| Document OCR | Server-signed claims (Zentity-issued) | No change |
| Liveness | Server-signed claims (Zentity-issued) | No change |
| Age/Nationality Proofs | Trustless ZK verification | No change |
| Web Data (SOF, employment) | N/A | Oracle trust (zkPass DVN) |

**Trade-off**: We gain web data verification capabilities but introduce trust in zkPass's validator network for those specific claims. This is acceptable because:

1. Core identity claims (document, liveness, face) remain trustless
2. zkPass validators are distributed and economically incentivized
3. Alternative would require direct API integrations (worse coverage, higher cost)
4. Validator signatures are cryptographically verifiable (ECDSA on EVM/Solana/TON)

## Design

### Architecture Overview

```text
┌─────────────────────────────────────────────────────────────────────┐
│                          User Browser                               │
│                                                                     │
│  ┌──────────────────────┐         ┌──────────────────────┐        │
│  │     Zentity UI       │         │  TransGate Extension │        │
│  │                      │         │     (zkPass)         │        │
│  │  • Document upload   │         │                      │        │
│  │  • Liveness          │  ───►   │  • Bank login        │        │
│  │  • Noir proofs       │ trigger │  • 3P-TLS session    │        │
│  │                      │         │  • VOLEitH proof     │        │
│  └──────────┬───────────┘         └──────────┬───────────┘        │
│             │                                 │                    │
│             │ Noir proofs                     │ Validator result   │
│             ▼                                 ▼                    │
└─────────────┼─────────────────────────────────┼────────────────────┘
              │                                 │
              ▼                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       Zentity Backend                               │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                    tRPC Router Layer                         │  │
│  │                                                               │  │
│  │  crypto/proof.ts          zkpass/router.ts (NEW)             │  │
│  │  ┌─────────────────┐      ┌─────────────────────────────┐   │  │
│  │  │ verifyNoirProof │      │ verifyZkPassResult          │   │  │
│  │  │ (UltraHonk)     │      │ (ECDSA signature check)     │   │  │
│  │  └─────────────────┘      └─────────────────────────────┘   │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                    Verification Layer                        │  │
│  │                                                               │  │
│  │  Document Claims    Liveness Claims    zkPass Claims (NEW)   │  │
│  │  (OCR-signed)       (Human.js-signed)  (DVN-signed)          │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                    Storage Layer                             │  │
│  │                                                               │  │
│  │  zk_proofs          signed_claims       zkpass_verifications │  │
│  │  (Noir proofs)      (server claims)     (NEW: DVN results)   │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                    Credential Issuance                       │  │
│  │                                                               │  │
│  │  OIDC4VCI credentials include both:                          │  │
│  │  • age_proof_verified (Noir)                                 │  │
│  │  • source_of_funds_verified (zkPass)                         │  │
│  └─────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### Data Flow

**Step 1: User Initiates zkPass Verification**

```typescript
// Client-side: User clicks "Verify Bank Account" in Zentity UI
const connector = new TransgateConnect(ZKPASS_APP_ID);

if (await connector.isTransgateAvailable()) {
  // Launch TransGate with bank verification schema
  const result = await connector.launch(BANK_BALANCE_SCHEMA_ID);

  // Submit result to Zentity backend
  await trpc.zkpass.submitVerification.mutate({
    schemaId: BANK_BALANCE_SCHEMA_ID,
    result,
    verificationType: 'source_of_funds'
  });
}
```

**Step 2: Zentity Verifies Validator Signature**

```typescript
// Server-side: Verify the DVN validator signature
async function verifyZkPassResult(
  schemaId: string,
  result: ZkPassResult
): Promise<VerificationOutcome> {
  // 1. Verify allocator signature (task was legitimately assigned)
  const allocatorValid = verifyEVMSignature(
    encodeTaskInfo(result.taskId, schemaId, result.validatorAddress),
    result.allocatorSignature,
    ZKPASS_ALLOCATOR_ADDRESS
  );

  if (!allocatorValid) {
    throw new Error('Invalid allocator signature');
  }

  // 2. Verify validator signature (result is authentic)
  const validatorValid = verifyEVMSignature(
    encodeResultInfo(result.taskId, schemaId, result.uHash, result.publicFieldsHash),
    result.validatorSignature,
    result.validatorAddress
  );

  if (!validatorValid) {
    throw new Error('Invalid validator signature');
  }

  // 3. Extract verification outcome from public fields
  return {
    verified: true,
    publicFields: result.publicFields,
    nullifierHash: result.uHash,  // Pseudonymous user identifier
    validatorAddress: result.validatorAddress,
    timestamp: new Date()
  };
}
```

**Step 3: Store Verification Result**

```typescript
// Store in zkpass_verifications table
await db.insert(zkpassVerifications).values({
  id: crypto.randomUUID(),
  userId,
  schemaId,
  taskId: result.taskId,
  verificationType: 'source_of_funds',
  publicFieldsHash: result.publicFieldsHash,
  nullifierHash: result.uHash,
  validatorAddress: result.validatorAddress,
  validatorSignature: result.validatorSignature,
  allocatorSignature: result.allocatorSignature,
  verified: true,
  verifiedAt: new Date(),
  expiresAt: addMonths(new Date(), 12)  // Re-verification policy
});
```

**Step 4: Include in Credential Issuance**

```typescript
// When issuing OIDC4VCI credentials, include zkPass-derived claims
const credential = {
  // Existing Zentity claims (trustless ZK)
  age_proof_verified: true,
  nationality_proof_verified: true,
  document_verified: true,
  liveness_verified: true,

  // New zkPass-derived claims (oracle trust)
  source_of_funds_verified: true,
  employment_verified: true,

  // Claim provenance (important for RPs)
  claim_sources: {
    age_proof: 'zentity:noir:ultrahonk',
    source_of_funds: 'zkpass:dvn:v1'
  }
};
```

### Database Schema

```sql
-- New table for zkPass verification results
CREATE TABLE zkpass_verifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),

  -- Schema identification
  schema_id TEXT NOT NULL,
  verification_type TEXT NOT NULL,  -- 'source_of_funds', 'employment', etc.

  -- zkPass task info
  task_id TEXT NOT NULL UNIQUE,

  -- Verification data (no raw PII)
  public_fields_hash TEXT NOT NULL,
  nullifier_hash TEXT NOT NULL,  -- User pseudonym within schema

  -- Validator signatures
  validator_address TEXT NOT NULL,
  validator_signature TEXT NOT NULL,
  allocator_signature TEXT NOT NULL,

  -- Status
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at TIMESTAMP,
  expires_at TIMESTAMP,

  -- Audit
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Index for user lookups
CREATE INDEX idx_zkpass_user_type ON zkpass_verifications(user_id, verification_type);

-- Index for nullifier deduplication
CREATE INDEX idx_zkpass_nullifier ON zkpass_verifications(nullifier_hash, schema_id);
```

### Schemas Required

We need to register schemas with zkPass Dev Center for each gap we're closing:

#### Source of Funds (Critical)

| Schema | Data Source | What User Proves | Privacy |
|--------|-------------|------------------|---------|
| Bank Balance | Chase, BofA, Wells Fargo, etc. | Balance ≥ threshold | Exact balance hidden |
| Bank Transactions | Bank portals | No flagged transactions in N months | Transaction details hidden |
| Payroll Income | ADP, Gusto, Workday | Monthly income ≥ threshold | Exact salary hidden |

#### Source of Wealth

| Schema | Data Source | What User Proves | Privacy |
|--------|-------------|------------------|---------|
| Investment Account | Fidelity, Schwab, Vanguard | Portfolio value ≥ threshold | Holdings hidden |
| Tax Returns | IRS portal, TurboTax | Reported income in range | Exact figures hidden |
| Property Ownership | County assessor portals | Owns property in jurisdiction | Address can be hidden |

#### Employment Verification

| Schema | Data Source | What User Proves | Privacy |
|--------|-------------|------------------|---------|
| LinkedIn Employment | linkedin.com | Currently employed at Company X | Other profile data hidden |
| Employer Portal | Workday, BambooHR, etc. | Active employee status | Salary, position hidden |
| Professional License | State licensing boards | License active and valid | License number can be hidden |

#### Educational Credentials

| Schema | Data Source | What User Proves | Privacy |
|--------|-------------|------------------|---------|
| University Enrollment | University portals | Enrolled or graduated | GPA, courses hidden |
| Degree Verification | National Student Clearinghouse | Degree obtained | Transcript hidden |
| Certifications | Coursera, LinkedIn Learning | Certification earned | Other courses hidden |

#### Government Data

| Schema | Data Source | What User Proves | Privacy |
|--------|-------------|------------------|---------|
| Tax Filing Status | IRS, state tax portals | Filed taxes in jurisdiction | Income hidden |
| Immigration Status | USCIS portal | Valid visa/status | Specific visa type optional |
| Benefits Eligibility | Government benefits portals | Eligible for program X | Income details hidden |

#### Account Ownership

| Schema | Data Source | What User Proves | Privacy |
|--------|-------------|------------------|---------|
| Email Ownership | Gmail, Outlook, etc. | Controls email address | Email content hidden |
| Social Media | Twitter, GitHub, Discord | Controls account | Posts/activity hidden |
| Domain Ownership | Registrars, DNS providers | Owns domain X | Other domains hidden |

---

**Example schema for bank balance verification:**

```json
{
  "name": "Bank Balance Verification",
  "description": "Prove bank balance exceeds threshold without revealing exact amount",
  "data_source": {
    "type": "web",
    "url_pattern": "https://*.bank.com/*",
    "auth": "user_session"
  },
  "extraction": {
    "balance": {
      "selector": ".account-balance",
      "type": "currency"
    }
  },
  "assertions": [
    {
      "field": "balance",
      "operator": ">=",
      "value": "{{threshold}}",
      "public": false  // Balance stays private
    }
  ],
  "public_outputs": [
    {
      "name": "balance_sufficient",
      "type": "boolean"
    }
  ]
}
```

## Implementation Plan

### Phase 1: Foundation (Week 1-2)

1. **Register zkPass Developer Account**
   - Create project in zkPass Dev Center
   - Define initial schemas (bank balance, employment)

2. **Install SDK & Basic Integration**
   - Add `@zkpass/transgate-js-sdk` to `apps/web`
   - Create `zkpass` tRPC router
   - Implement signature verification logic

3. **Database Schema**
   - Add `zkpass_verifications` table
   - Add `verification_type` enum

### Phase 2: Verification Flows (Week 3-4)

1. **Source of Funds Flow**
   - Bank balance schema
   - UI component for TransGate launch
   - Backend verification & storage

2. **Employment Verification Flow**
   - LinkedIn/employer portal schema
   - UI component
   - Backend verification

3. **Testing & Validation**
   - Unit tests for signature verification
   - Integration tests with zkPass testnet
   - E2E tests for full flow

### Phase 3: Credential Integration (Week 5-6)

1. **Update Assurance Tiers**
   - Include zkPass verifications in tier calculation
   - Define which zkPass claims affect which tiers

2. **Update OIDC4VCI Credentials**
   - Add zkPass-derived claims to SD-JWT
   - Include claim provenance metadata

3. **Documentation & Deployment**
   - Update user-facing docs
   - Deploy to production

## Security Considerations

### Trust Boundaries

| Component | Trust Level | Mitigation |
|-----------|-------------|------------|
| TransGate Extension | User-installed | Verify it's the official extension |
| zkPass Allocator | Semi-trusted | Verify allocator signature matches known address |
| zkPass Validators | Semi-trusted | Verify validator signatures; validators are bonded |
| zkPass DVN | Oracle trust | Monitor for anomalies; fallback to manual verification |

### Attack Vectors

| Attack | Risk | Mitigation |
|--------|------|------------|
| Fake TransGate | User installs malicious extension | Check extension ID before launch |
| Validator collusion | Validators sign false results | Economic penalties (slashing); multiple validators |
| Replay attack | Reuse old verification | Nullifier hash prevents same user re-using same proof |
| Schema manipulation | Extract wrong data | Schemas are registered and immutable |

### Audit Trail

All zkPass verifications are stored with full provenance:

- Task ID (unique, from allocator)
- Validator address and signature
- Allocator signature
- Public fields hash
- Timestamp

This enables:

- Dispute resolution
- Regulatory audit
- Anomaly detection

## Privacy Considerations

### What zkPass Reveals

- **To zkPass validators**: User's session data during TLS handshake (encrypted)
- **To Zentity**: Public fields hash, nullifier hash, verification outcome
- **To relying parties**: Boolean claim (e.g., `source_of_funds_verified: true`)

### What Stays Private

- Exact bank balance (only "balance >= threshold" is proven)
- Exact salary (only "income >= threshold" is proven)
- Specific employer name (if not included in public fields)
- Login credentials (never exposed)

### Nullifier Privacy

The `uHash` (nullifier hash) is a pseudonymous identifier derived from the user's identity within the data source. This:

- Prevents the same user from verifying multiple times for the same claim
- Does NOT link to Zentity user ID directly
- Does NOT reveal the user's identity on the data source

## Open Questions

1. **Schema Coverage**: Which banks/employers/portals should we prioritize for initial schemas?
2. **Re-verification Policy**: How often should SOF/employment be re-verified? (AMLD6 suggests annually for high-risk)
3. **Fallback**: What if TransGate isn't available? Manual document upload as fallback?
4. **Cost Model**: zkPass may have per-verification costs—pass to user or absorb?
5. **Geographic Coverage**: Which countries' banks/portals should we support first?
6. **Schema Maintenance**: Who maintains schemas when bank websites change?

## Alternatives Considered

### Alternative 1: Direct API Integrations

Build direct integrations with Plaid (banks), LinkedIn API, etc.

**Pros**: No oracle trust; direct data access
**Cons**: Expensive; limited coverage; requires user credential sharing; maintenance burden

**Decision**: Rejected. zkPass provides broader coverage with better privacy.

### Alternative 2: Document Upload

User uploads bank statements, pay stubs as PDFs.

**Pros**: Simple; no external dependencies
**Cons**: Easily forged; requires PII handling; manual review

**Decision**: Rejected for primary flow. May keep as fallback.

### Alternative 3: Build Own zkTLS

Implement our own 3P-TLS protocol.

**Pros**: Full control; no oracle trust
**Cons**: Massive engineering effort; need validator network; unproven

**Decision**: Rejected. Not practical for current stage.

## References

- [zkPass Documentation](https://docs.zkpass.org/)
- [zkPass Technical Overview](https://docs.zkpass.org/overview/technical-overview)
- [TransGate JS-SDK](https://github.com/zkPassOfficial/Transgate-JS-SDK)
- [VOLE-in-the-Head Paper](https://eprint.iacr.org/2023/996)
- [zkTLS Medium Article](https://medium.com/zkpass/zktls-the-cornerstone-of-verifiable-internet-da8609a32754)

## Appendix A: Proof System Deep Dive

### Zentity (Noir/Barretenberg)

```text
Circuit Definition (Noir DSL)
       ↓
Compile to ACIR (Abstract Circuit IR)
       ↓
Generate UltraHonk proving key
       ↓
Client executes circuit, generates witness
       ↓
Client generates UltraHonk proof (~5KB)
       ↓
Server verifies proof with verification key
       ↓
Mathematical certainty of statement truth
```

**Security**: Computational soundness based on discrete log hardness.

### zkPass (VOLEitH)

```text
3-Party TLS Session (User ↔ Website ↔ Validator)
       ↓
Garbled Circuits derive session keys
       ↓
User extracts data from encrypted TLS response
       ↓
User commits to VOLE correlations (GGM tree)
       ↓
Fiat-Shamir challenge
       ↓
User opens commitments, validator checks equation
       ↓
Validator signs result
       ↓
Signature provides authenticity (not ZK verification)
```

**Security**: MPC-based; requires honest validator for soundness.

### Key Difference

| Aspect | Noir/Barretenberg | zkPass/VOLEitH |
|--------|-------------------|----------------|
| Trust model | Trustless (math) | Oracle (validators) |
| What we verify | ZK proof directly | Validator signature |
| Proving location | User's browser | TransGate + validator |
| Verification | Cryptographic | Signature check |
| Interoperability | None with zkPass | None with Noir |

## Appendix B: Implementation Code Sketches

### tRPC Router

```typescript
// apps/web/src/lib/trpc/routers/zkpass/router.ts

import { router, protectedProcedure } from "../../trpc";
import { z } from "zod";
import { verifyZkPassResult } from "./verification";
import { db } from "@/lib/db";
import { zkpassVerifications } from "@/lib/db/schema/zkpass";

export const zkpassRouter = router({
  submitVerification: protectedProcedure
    .input(z.object({
      schemaId: z.string(),
      verificationType: z.enum([
        'source_of_funds',
        'source_of_wealth',
        'employment',
        'education',
        'address'
      ]),
      result: z.object({
        taskId: z.string(),
        publicFields: z.array(z.any()),
        publicFieldsHash: z.string(),
        allocatorAddress: z.string(),
        allocatorSignature: z.string(),
        validatorAddress: z.string(),
        validatorSignature: z.string(),
        uHash: z.string(),
        recipient: z.string().optional()
      })
    }))
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx.session;

      // Verify signatures
      const verification = await verifyZkPassResult(
        input.schemaId,
        input.result
      );

      if (!verification.verified) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'zkPass verification failed'
        });
      }

      // Check for duplicate (nullifier)
      const existing = await db.query.zkpassVerifications.findFirst({
        where: and(
          eq(zkpassVerifications.nullifierHash, input.result.uHash),
          eq(zkpassVerifications.schemaId, input.schemaId)
        )
      });

      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Verification already exists for this user/schema'
        });
      }

      // Store verification
      const [record] = await db.insert(zkpassVerifications).values({
        id: crypto.randomUUID(),
        userId,
        schemaId: input.schemaId,
        verificationType: input.verificationType,
        taskId: input.result.taskId,
        publicFieldsHash: input.result.publicFieldsHash,
        nullifierHash: input.result.uHash,
        validatorAddress: input.result.validatorAddress,
        validatorSignature: input.result.validatorSignature,
        allocatorSignature: input.result.allocatorSignature,
        verified: true,
        verifiedAt: new Date(),
        expiresAt: addMonths(new Date(), 12)
      }).returning();

      return {
        success: true,
        verificationId: record.id,
        verificationType: input.verificationType
      };
    }),

  getVerifications: protectedProcedure
    .query(async ({ ctx }) => {
      const { userId } = ctx.session;

      return db.query.zkpassVerifications.findMany({
        where: eq(zkpassVerifications.userId, userId),
        orderBy: desc(zkpassVerifications.verifiedAt)
      });
    })
});
```

### Signature Verification (Off-Chain, No Blockchain)

The verification is pure cryptography—ECDSA signature recovery. We use `viem` (lighter than web3.js) or raw crypto libraries:

```typescript
// apps/web/src/lib/trpc/routers/zkpass/verification.ts

import { recoverMessageAddress, keccak256, encodeAbiParameters } from 'viem';

const ZKPASS_ALLOCATOR_ADDRESS = '0x19a567b3b212a5b35bA0E3B600FbEd5c2eE9083d';

export async function verifyZkPassResult(
  schemaId: string,
  result: ZkPassResult
): Promise<{ verified: boolean; error?: string }> {

  // 1. Verify allocator signature (proves task was legitimately assigned)
  const taskHash = keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'address' }],
      [stringToBytes32(result.taskId), stringToBytes32(schemaId), result.validatorAddress]
    )
  );

  const recoveredAllocator = await recoverMessageAddress({
    message: { raw: taskHash },
    signature: result.allocatorSignature as `0x${string}`
  });

  if (recoveredAllocator.toLowerCase() !== ZKPASS_ALLOCATOR_ADDRESS.toLowerCase()) {
    return { verified: false, error: 'Invalid allocator signature' };
  }

  // 2. Verify validator signature (proves result is authentic)
  const resultHash = keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }],
      [stringToBytes32(result.taskId), stringToBytes32(schemaId), result.uHash, result.publicFieldsHash]
    )
  );

  const recoveredValidator = await recoverMessageAddress({
    message: { raw: resultHash },
    signature: result.validatorSignature as `0x${string}`
  });

  if (recoveredValidator.toLowerCase() !== result.validatorAddress.toLowerCase()) {
    return { verified: false, error: 'Invalid validator signature' };
  }

  return { verified: true };
}

function stringToBytes32(str: string): `0x${string}` {
  const hex = Buffer.from(str).toString('hex').padEnd(64, '0');
  return `0x${hex}`;
}
```

**Note**: This is entirely off-chain. We're just doing:

1. Keccak256 hashing (standard crypto)
2. ECDSA signature recovery (secp256k1)
3. Address comparison

No blockchain calls, no RPC nodes, no gas fees.

### React Component

```typescript
// apps/web/src/components/verification/zkpass-verification.tsx

'use client';

import { useState } from 'react';
import TransgateConnect from '@zkpass/transgate-js-sdk';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { CheckCircle, AlertCircle, Loader2 } from 'lucide-react';

const ZKPASS_APP_ID = process.env.NEXT_PUBLIC_ZKPASS_APP_ID!;

// Map verification types to zkPass schema IDs (registered in Dev Center)
const SCHEMAS: Record<VerificationType, string> = {
  source_of_funds: 'uuid-for-bank-balance-schema',
  source_of_wealth: 'uuid-for-investment-schema',
  employment: 'uuid-for-linkedin-employment-schema',
  education: 'uuid-for-university-schema',
  government_data: 'uuid-for-tax-portal-schema',
  account_ownership: 'uuid-for-email-ownership-schema'
};

type VerificationType =
  | 'source_of_funds'
  | 'source_of_wealth'
  | 'employment'
  | 'education'
  | 'government_data'
  | 'account_ownership';

const LABELS: Record<VerificationType, string> = {
  source_of_funds: 'Bank Account',
  source_of_wealth: 'Investment Account',
  employment: 'Employment Status',
  education: 'Educational Credentials',
  government_data: 'Government Records',
  account_ownership: 'Account Ownership'
};

export function ZkPassVerification({
  verificationType,
  onSuccess
}: {
  verificationType: VerificationType;
  onSuccess?: () => void;
}) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const submitVerification = trpc.zkpass.submitVerification.useMutation({
    onSuccess: () => {
      setStatus('success');
      onSuccess?.();
    },
    onError: (err) => {
      setError(err.message);
      setStatus('error');
    }
  });

  const handleVerify = async () => {
    setStatus('loading');
    setError(null);

    try {
      const connector = new TransgateConnect(ZKPASS_APP_ID);
      const isAvailable = await connector.isTransgateAvailable();

      if (!isAvailable) {
        // Could show QR code for mobile app as fallback
        setError('Please install the zkPass TransGate browser extension');
        setStatus('error');
        return;
      }

      const schemaId = SCHEMAS[verificationType];

      // Launch TransGate - user logs into their bank/portal
      // zkPass generates proof, validator signs result
      const result = await connector.launch(schemaId);

      // Submit to Zentity backend for signature verification & storage
      await submitVerification.mutateAsync({
        schemaId,
        verificationType,
        result
      });

    } catch (err) {
      if (err instanceof Error && err.message.includes('VERIFICATION_CANCELED')) {
        setError('Verification cancelled');
      } else if (err instanceof Error && err.message.includes('NOT_MATCH_REQUIREMENTS')) {
        setError('Requirements not met (e.g., balance below threshold)');
      } else {
        setError(err instanceof Error ? err.message : 'Verification failed');
      }
      setStatus('error');
    }
  };

  return (
    <div className="space-y-3">
      <Button
        onClick={handleVerify}
        disabled={status === 'loading' || status === 'success'}
        variant={status === 'success' ? 'outline' : 'default'}
        className="w-full"
      >
        {status === 'loading' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {status === 'success' && <CheckCircle className="mr-2 h-4 w-4 text-green-600" />}
        {status === 'loading'
          ? 'Verifying...'
          : status === 'success'
            ? `${LABELS[verificationType]} Verified`
            : `Verify ${LABELS[verificationType]}`
        }
      </Button>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}
    </div>
  );
}
```
