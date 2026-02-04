# RFC-0024: Reclaim Protocol Integration

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Created** | 2026-02-03 |
| **Updated** | 2026-02-04 |
| **Author** | Gustavo Valverde |
| **Related** | [RFC-0023](0023-zk-api-gateway.md) |

---

## Summary

Integrate Reclaim Protocol to enable users to prove facts about their web data (bank balances, employment status, account ownership) without exposing credentials or raw data. This complements Zentity's existing document-based verification with live API attestations.

---

## Motivation

### Current Gap

Zentity's document verification (OCR + ZK proofs) proves identity from static documents. However, compliance often requires:

- **Source of Funds (SOF)**: Prove bank balance exceeds threshold
- **Source of Wealth (SOW)**: Prove income/assets over time
- **Employment Verification**: Prove current job status
- **Account Ownership**: Prove control of financial accounts

These require live data from web services, not documents.

### Why Reclaim Protocol

| Requirement | Reclaim Fit |
|-------------|-------------|
| No extension required | ✅ Works in any browser |
| Server-side SDK | ✅ Node.js compatible |
| Off-chain verification | ✅ No blockchain required |
| TLS 1.3 support | ✅ Uses Key Update mechanism |
| **Self-hostable** | ✅ **Open source (AGPL v3)** |
| Cost model | ✅ Free if self-hosted, or pay-per-use with hosted |

### What Reclaim Provides

1. **Cryptographic proof** that data came from a specific HTTPS endpoint
2. **Selective disclosure** — reveal only extracted parameters, not full response
3. **Credential hiding** — authentication tokens never exposed to attestor
4. **Off-chain verification** — standard signature verification, no blockchain

---

## Architecture

### How Reclaim Works (Self-Hosted)

```text
┌──────────┐     ┌───────────────────────┐     ┌──────────────┐
│   User   │────▶│  Zentity's Attestor   │────▶│ Target Site  │
│ Browser  │     │  (self-hosted)        │     │ (bank, etc)  │
└──────────┘     │  attestor.zentity.xyz │     └──────────────┘
                 └───────────────────────┘
                             │
                             │ TLS 1.3 Key Update
                             │ hides credentials
                             │
                             ▼
                     ┌───────────────┐
                     │  Attestation  │
                     │  (signed by   │
                     │  our attestor)│
                     └───────────────┘
                             │
                             ▼
                     ┌───────────────┐
                     │   Zentity     │
                     │   Backend     │
                     │  (verifies    │
                     │  our attestor)│
                     └───────────────┘
```

**Key benefits of self-hosting**:

- No per-verification costs
- Full control over attestor infrastructure
- No vendor dependency
- Trust only your own infrastructure

**Key mechanism**: TLS 1.3 Key Update allows the user to encrypt sensitive parts (auth tokens) with a key that's never revealed, while the attestor can still verify the non-secret parts of the request/response.

### Trust Model

**Option 1: Reclaim's hosted attestor** (`attestor.reclaimprotocol.org`)

- You trust their attestor not to collude with users to forge proofs
- Academic paper "Proxying is Enough" claims security probability of 10^-40
- Pay-per-verification pricing (contact Reclaim for rates)

**Option 2: Self-hosted attestor** (Recommended for Zentity)

- Run your own attestor — full control, no vendor dependency
- Free (only infrastructure costs)
- You trust your own infrastructure
- Open source: [attestor-core](https://github.com/reclaimprotocol/attestor-core) (AGPL v3)

**Future state**: Decentralized via Eigen AVS (currently testnet)

- Multiple attestors sign claims
- Threshold signature verification
- Economic security via staking

---

## Deployment Options

### Option A: Use Reclaim's Hosted Attestor

**Pros**: No infrastructure to manage, faster setup
**Cons**: Per-verification cost, vendor dependency

```typescript
// Use Reclaim's attestor (default)
const proof = await createClaim({
  name: 'http',
  params: { ... },
  client: { url: 'wss://attestor.reclaimprotocol.org:444/ws' }
});
```

### Option B: Self-Hosted Attestor (Recommended)

**Pros**: Free, full control, no vendor lock-in
**Cons**: Infrastructure management required

#### Infrastructure Requirements

| Component | Requirement |
|-----------|-------------|
| Server | Any cloud VM (AWS, Railway, etc.) |
| Memory | 2GB+ RAM recommended |
| Storage | Minimal (stateless) |
| Network | WebSocket support, HTTPS |
| Domain | Required for TLS |

#### Local Development Setup

```bash
# 1. Clone attestor-core
git clone https://github.com/reclaimprotocol/attestor-core
cd attestor-core

# 2. Install dependencies
npm install

# 3. Download ZK files (required for Node.js)
npm run download:zk-files

# 4. Create environment file
cat > .env << 'EOF'
# Required: Your attestor's signing key (generates attestation signatures)
PRIVATE_KEY=0x$(openssl rand -hex 32)

# Optional: Enable authentication for private attestor
# AUTHENTICATION_PUBLIC_KEY=0x...

# Optional: TOPRF for consistent hashing (run: npm run generate:toprf-keys)
# TOPRF_PUBLIC_KEY=...
# TOPRF_SHARE_PUBLIC_KEY=...
# TOPRF_SHARE_PRIVATE_KEY=...
EOF

# 5. Start the attestor
npm run start:tsc
# Server starts on port 8001
```

#### Production Deployment (Docker)

```yaml
# docker-compose.yml
version: '3.8'

services:
  attestor:
    build:
      context: .
      dockerfile: Dockerfile
    environment:
      - PRIVATE_KEY=${ATTESTOR_PRIVATE_KEY}
      - NODE_ENV=production
    ports:
      - "8001:8001"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8001/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  # Reverse proxy for HTTPS + WebSocket
  caddy:
    image: caddy:2-alpine
    ports:
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
    depends_on:
      - attestor
```

```text
# Caddyfile
attestor.zentity.xyz {
    reverse_proxy attestor:8001
}
```

#### Railway Deployment

```toml
# railway.toml
[build]
builder = "dockerfile"

[deploy]
healthcheckPath = "/health"
healthcheckTimeout = 300
restartPolicyType = "on_failure"
```

```bash
# Deploy to Railway
railway up --service attestor
```

#### Environment Variables for Self-Hosted

```bash
# Required
ATTESTOR_PRIVATE_KEY=0x...  # 32-byte hex private key

# Optional: Enable TOPRF for consistent hashing
TOPRF_PUBLIC_KEY=...
TOPRF_SHARE_PUBLIC_KEY=...
TOPRF_SHARE_PRIVATE_KEY=...

# Optional: Restrict to authenticated clients only
AUTHENTICATION_PUBLIC_KEY=0x...
```

#### Using Your Self-Hosted Attestor

```typescript
// apps/web/src/lib/reclaim/client.ts
import { createClaim } from '@reclaimprotocol/attestor-core';

const ATTESTOR_URL = process.env.RECLAIM_ATTESTOR_URL
  || 'wss://attestor.zentity.xyz/ws';  // Your self-hosted attestor

export async function createAttestationWithSelfHosted(
  params: ClaimParams
) {
  const result = await createClaim({
    name: 'http',
    params: {
      url: params.url,
      method: params.method,
      responseMatches: params.responseMatches,
      responseRedactions: params.responseRedactions,
    },
    secretParams: {
      headers: params.secretHeaders,
    },
    // Point to YOUR attestor
    client: {
      url: ATTESTOR_URL,
      // Optional: If authentication is enabled
      // authRequest: await createAuthRequest({ userId }, ZENTITY_PRIVATE_KEY)
    },
  });

  return result;
}
```

#### Verifying Proofs from Self-Hosted Attestor

When self-hosting, you need to verify that proofs came from YOUR attestor:

```typescript
// apps/web/src/lib/reclaim/verify.ts
import {
  assertValidClaimSignatures,
  getWitnessesForClaim
} from '@reclaimprotocol/attestor-core';

const EXPECTED_ATTESTOR_ADDRESS = process.env.ATTESTOR_PUBLIC_ADDRESS!;

export async function verifyProofFromOurAttestor(proof: ReclaimProof) {
  // 1. Verify signature is valid
  await assertValidClaimSignatures(proof);

  // 2. Verify it came from OUR attestor (not someone else's)
  const witnesses = proof.witnesses || [];
  const isFromOurAttestor = witnesses.some(
    w => w.id.toLowerCase() === EXPECTED_ATTESTOR_ADDRESS.toLowerCase()
  );

  if (!isFromOurAttestor) {
    throw new Error('Proof not from authorized attestor');
  }

  return true;
}
```

### Cost Comparison

| Approach | Setup Cost | Per-Verification | Monthly (10k verifications) |
|----------|------------|------------------|----------------------------|
| **Reclaim Hosted** | Free | ~$0.01-0.10 (estimate) | $100-1000 |
| **Self-Hosted (Railway)** | ~$5/mo | Free | ~$5-20 |
| **Self-Hosted (AWS)** | ~$20/mo | Free | ~$20-50 |

*Reclaim pricing is not publicly listed; contact them for actual rates.*

### Proof Structure

```typescript
interface ReclaimProof {
  identifier: string;  // Hash of (provider, parameters, context)
  claimData: {
    provider: string;        // "http"
    parameters: string;      // JSON: URL, method, response matchers
    owner: string;           // User's address/identifier
    timestampS: number;      // Unix timestamp
    context: string;         // Includes extractedParameters
    epoch: number;
  };
  signatures: string[];      // Attestor ECDSA signatures
  witnesses: WitnessData[];  // Attestor addresses
  extractedParameterValues: Record<string, string>;
}
```

---

## Integration Design

### Phase 1: User-Initiated Verification

User proves their own data by authenticating to the source service.

#### Flow

```text
1. User clicks "Verify Bank Balance" on Zentity
2. Zentity frontend generates Reclaim verification request
3. User is redirected to Reclaim flow (or QR code on mobile)
4. User logs into their bank within Reclaim's secure context
5. Reclaim attestor observes TLS traffic, extracts parameters
6. Attestor signs proof, sends to Zentity callback URL
7. Zentity backend verifies signature, stores attestation
```

#### Frontend Integration

```typescript
// apps/web/src/lib/reclaim/client.ts
import { ReclaimProofRequest } from '@reclaimprotocol/js-sdk';

export async function startVerification(
  providerId: string,
  userId: string,
  verificationType: 'bank_balance' | 'employment' | 'account_ownership'
) {
  const proofRequest = await ReclaimProofRequest.init(
    env.RECLAIM_APP_ID,
    env.RECLAIM_APP_SECRET,
    providerId
  );

  // Bind proof to this user (prevents replay)
  proofRequest.setContext(userId, verificationType);

  // Callback to our backend
  proofRequest.setAppCallbackUrl(
    `${env.NEXT_PUBLIC_APP_URL}/api/reclaim/callback`,
    true // POST method
  );

  // Start the flow
  await proofRequest.triggerReclaimFlow();

  return new Promise((resolve, reject) => {
    proofRequest.startSession({
      onSuccess: (proofs) => resolve(proofs),
      onFailure: (error) => reject(error),
    });
  });
}
```

#### Backend Verification

```typescript
// apps/web/src/lib/trpc/routers/reclaim.ts
import { verifyProof } from '@reclaimprotocol/js-sdk';
import { z } from 'zod';

const ReclaimProofSchema = z.object({
  identifier: z.string(),
  claimData: z.object({
    provider: z.string(),
    parameters: z.string(),
    owner: z.string(),
    timestampS: z.number(),
    context: z.string(),
    epoch: z.number(),
  }),
  signatures: z.array(z.string()),
  witnesses: z.array(z.object({
    id: z.string(),
    url: z.string(),
  })),
  extractedParameterValues: z.record(z.string()),
});

export const reclaimRouter = router({
  callback: publicProcedure
    .input(z.object({ proof: ReclaimProofSchema }))
    .mutation(async ({ ctx, input }) => {
      const { proof } = input;

      // 1. Verify cryptographic validity
      const isValid = await verifyProof(proof);
      if (!isValid) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invalid proof signature',
        });
      }

      // 2. Extract context (userId binding)
      const context = JSON.parse(proof.claimData.context);
      const userId = context.contextAddress;

      // 3. Verify timestamp freshness (prevent replay)
      const proofAge = Date.now() / 1000 - proof.claimData.timestampS;
      if (proofAge > 300) { // 5 minutes
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Proof expired',
        });
      }

      // 4. Check for duplicate proof
      const existing = await ctx.db.query.reclaimAttestations.findFirst({
        where: eq(reclaimAttestations.proofIdentifier, proof.identifier),
      });
      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Proof already used',
        });
      }

      // 5. Store attestation
      await ctx.db.insert(reclaimAttestations).values({
        id: createId(),
        userId,
        proofIdentifier: proof.identifier,
        provider: proof.claimData.provider,
        extractedData: proof.extractedParameterValues,
        verifiedAt: new Date(proof.claimData.timestampS * 1000),
        rawProof: proof,
      });

      // 6. Update user's verification status
      await updateUserAssuranceLevel(ctx.db, userId, {
        webDataVerified: true,
        verificationDetails: proof.extractedParameterValues,
      });

      return { success: true };
    }),

  // Query user's attestations
  getAttestations: protectedProcedure
    .query(async ({ ctx }) => {
      return ctx.db.query.reclaimAttestations.findMany({
        where: eq(reclaimAttestations.userId, ctx.session.userId),
        orderBy: desc(reclaimAttestations.verifiedAt),
      });
    }),
});
```

### Phase 2: Provider Configuration

No pre-built provider catalog exists. We configure the generic HTTP provider for each data source.

#### Provider Configuration Schema

```typescript
// apps/web/src/lib/reclaim/providers.ts
interface ProviderConfig {
  id: string;
  name: string;
  description: string;
  httpConfig: {
    url: string;
    method: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: string;
    responseMatches: Array<{
      type: 'regex' | 'jsonPath' | 'xpath';
      value: string;
    }>;
    responseRedactions?: Array<{
      jsonPath?: string;
      regex?: string;
      hash?: 'oprf';  // TOPRF for de-duplication
    }>;
  };
  secretParams: string[];  // Which params are hidden from attestor
}

export const providers: Record<string, ProviderConfig> = {
  // Bank balance verification
  'chase-balance': {
    id: 'chase-balance',
    name: 'Chase Bank Balance',
    description: 'Verify your Chase checking account balance',
    httpConfig: {
      url: 'https://secure.chase.com/svc/rr/accounts/secure/v1/account/detail/{{accountId}}',
      method: 'GET',
      responseMatches: [
        {
          type: 'regex',
          value: '"currentBalance":\\s*(?<balance>[\\d.]+)',
        },
      ],
      responseRedactions: [
        { jsonPath: '$.accountNumber', hash: 'oprf' },
      ],
    },
    secretParams: ['cookie', 'accountId'],
  },

  // Employment verification via LinkedIn
  'linkedin-employment': {
    id: 'linkedin-employment',
    name: 'LinkedIn Employment',
    description: 'Verify your current employment from LinkedIn',
    httpConfig: {
      url: 'https://www.linkedin.com/voyager/api/identity/profiles/{{profileId}}/positions',
      method: 'GET',
      responseMatches: [
        {
          type: 'regex',
          value: '"companyName":\\s*"(?<company>[^"]+)"',
        },
        {
          type: 'regex',
          value: '"title":\\s*"(?<title>[^"]+)"',
        },
      ],
    },
    secretParams: ['cookie', 'csrf-token'],
  },

  // Plaid-connected bank (user has Plaid Link session)
  'plaid-balance': {
    id: 'plaid-balance',
    name: 'Bank Balance (via Plaid)',
    description: 'Verify bank balance through Plaid connection',
    httpConfig: {
      url: 'https://production.plaid.com/accounts/balance/get',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: '{{clientId}}',
        secret: '{{secret}}',
        access_token: '{{accessToken}}',
      }),
      responseMatches: [
        {
          type: 'jsonPath',
          value: '$.accounts[0].balances.current',
        },
      ],
      responseRedactions: [
        { jsonPath: '$.accounts[*].account_id', hash: 'oprf' },
        { jsonPath: '$.accounts[*].mask' },
      ],
    },
    secretParams: ['secret', 'accessToken'],
  },
};
```

#### Registering Providers

Providers are registered via Reclaim's Developer Portal or API:

```typescript
// scripts/register-reclaim-providers.ts
import { ReclaimClient } from '@reclaimprotocol/attestor-core';

async function registerProvider(config: ProviderConfig) {
  const client = new ReclaimClient(
    process.env.RECLAIM_APP_ID!,
    process.env.RECLAIM_APP_SECRET!
  );

  // Register with Reclaim
  const providerId = await client.registerProvider({
    name: config.id,
    httpProvider: {
      url: config.httpConfig.url,
      method: config.httpConfig.method,
      headers: config.httpConfig.headers,
      body: config.httpConfig.body,
      responseMatches: config.httpConfig.responseMatches,
      responseRedactions: config.httpConfig.responseRedactions,
    },
  });

  console.log(`Registered provider ${config.id}: ${providerId}`);
  return providerId;
}
```

### Phase 3: Server-Side zkFetch (Optional)

For cases where the user provides their session token to Zentity's backend:

```typescript
// apps/web/src/lib/reclaim/server.ts
import { ReclaimClient } from '@reclaimprotocol/zk-fetch';
import { verifyProof } from '@reclaimprotocol/js-sdk';

const reclaimClient = new ReclaimClient(
  env.RECLAIM_APP_ID,
  env.RECLAIM_APP_SECRET
);

export async function verifyBankBalanceServerSide(
  bankApiUrl: string,
  userSessionToken: string,
  balanceThreshold: number
): Promise<{ verified: boolean; proof: ReclaimProof }> {
  // Make request through Reclaim attestor
  const proof = await reclaimClient.zkFetch(
    bankApiUrl,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${userSessionToken}`,
      },
    },
    {
      responseMatches: [
        {
          type: 'regex',
          value: '"balance":\\s*(?<balance>[\\d.]+)',
        },
      ],
      responseRedactions: [
        { regex: 'Bearer [^"]+' },  // Redact the token
      ],
    }
  );

  // Verify the proof
  const isValid = await verifyProof(proof);
  if (!isValid) {
    throw new Error('Proof verification failed');
  }

  const balance = parseFloat(proof.extractedParameterValues.balance);

  return {
    verified: balance >= balanceThreshold,
    proof,
  };
}
```

**Note**: This requires the user to provide their session token, which is less privacy-preserving than the user-initiated flow where credentials never leave the user's device.

---

## Database Schema

```typescript
// apps/web/src/lib/db/schema/reclaim.ts
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { users } from './users';

export const reclaimAttestations = sqliteTable('reclaim_attestations', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),

  // Proof identification
  proofIdentifier: text('proof_identifier').notNull().unique(),
  provider: text('provider').notNull(),  // e.g., 'chase-balance'

  // Extracted verified data
  extractedData: text('extracted_data', { mode: 'json' }).notNull(),
  // e.g., { balance: "15000.00", accountHash: "abc123..." }

  // Metadata
  verifiedAt: integer('verified_at', { mode: 'timestamp' }).notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),

  // Audit trail
  rawProof: text('raw_proof', { mode: 'json' }).notNull(),

  // Standard timestamps
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const reclaimProviders = sqliteTable('reclaim_providers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  reclaimProviderId: text('reclaim_provider_id').notNull(),
  config: text('config', { mode: 'json' }).notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});
```

---

## Verification Types

### Bank Balance Threshold

```typescript
// Verify balance > $10,000 without revealing exact amount
const proof = await startVerification('chase-balance', userId, 'bank_balance');

// Backend extracts and validates
const balance = parseFloat(proof.extractedParameterValues.balance);
const meetsThreshold = balance >= 10000;

// Store only the threshold result, not exact balance
await db.insert(verificationResults).values({
  userId,
  verificationType: 'bank_balance_threshold',
  result: meetsThreshold,
  threshold: 10000,
  // Don't store exact balance
});
```

### Employment Verification

```typescript
// Verify current employment at specific company
const proof = await startVerification('linkedin-employment', userId, 'employment');

const company = proof.extractedParameterValues.company;
const title = proof.extractedParameterValues.title;

// Verify against expected employer
const isVerified = company.toLowerCase().includes(expectedEmployer.toLowerCase());
```

### Account Ownership (De-duplication)

Using TOPRF hashing to detect duplicate accounts without storing actual account numbers:

```typescript
// Provider config uses OPRF hashing
responseRedactions: [
  { jsonPath: '$.accountNumber', hash: 'oprf' }
]

// The proof contains hashed account number
const accountHash = proof.extractedParameterValues.accountNumberHash;

// Check for duplicates
const existingWithSameAccount = await db.query.reclaimAttestations.findFirst({
  where: sql`json_extract(extracted_data, '$.accountHash') = ${accountHash}`,
});

if (existingWithSameAccount) {
  throw new Error('Account already verified by another user');
}
```

---

## Security Considerations

### Trust Model

| Trust Assumption | Mitigation |
|------------------|------------|
| Single attestor honesty | AVS decentralization (testnet), academic security proof |
| Proof freshness | Timestamp validation (5-minute window) |
| Proof replay | Unique identifier tracking in database |
| User binding | Context contains userId, verified on callback |

### Credential Security

- User credentials (session tokens, cookies) are encrypted with TLS 1.3 Key Update
- Attestor never sees decrypted credentials
- Only non-secret request/response portions are verified

### Data Minimization

- Extract only required parameters (balance, employment status)
- Redact sensitive fields (account numbers, full names)
- TOPRF hashing for fields needed for de-duplication

---

## Environment Variables

### For Hosted Reclaim (if using their attestor)

```bash
# Reclaim Protocol (from their developer portal)
RECLAIM_APP_ID=your-app-id
RECLAIM_APP_SECRET=your-app-secret
```

### For Self-Hosted Attestor (Recommended)

```bash
# Your self-hosted attestor URL
RECLAIM_ATTESTOR_URL=wss://attestor.zentity.xyz/ws

# Your attestor's public address (for verification)
ATTESTOR_PUBLIC_ADDRESS=0x...

# On the attestor server itself:
ATTESTOR_PRIVATE_KEY=0x...  # 32-byte hex

# Optional: TOPRF keys for consistent hashing
TOPRF_PUBLIC_KEY=...
TOPRF_SHARE_PUBLIC_KEY=...
TOPRF_SHARE_PRIVATE_KEY=...
```

---

## Migration Path

### Week 1-2: Infrastructure & Foundation

- [ ] **Deploy self-hosted attestor** (Railway or AWS)
  - Clone attestor-core, configure environment
  - Set up HTTPS with WebSocket support
  - Generate and securely store attestor private key
- [ ] Add database schema migration for attestations
- [ ] Implement basic tRPC router with callback handler
- [ ] Set up proof verification against our attestor

### Week 3-4: First Provider

- [ ] Configure HTTP provider for Plaid balance verification
- [ ] Implement frontend verification flow
- [ ] Test end-to-end flow (user → attestor → callback)
- [ ] Add verification status to user dashboard

### Week 5-6: Additional Providers

- [ ] Add LinkedIn employment provider configuration
- [ ] Add additional financial institution providers
- [ ] Implement provider selection UI
- [ ] Add TOPRF for de-duplication (optional)

### Week 7-8: Production Hardening

- [ ] Add monitoring for attestor health
- [ ] Implement rate limiting on callback endpoint
- [ ] Add proof expiration handling
- [ ] Security audit of integration
- [ ] Load testing attestor capacity

---

## Comparison with Current ZK Architecture

| Aspect | Zentity ZK (Current) | Reclaim Integration (Self-Hosted) |
|--------|---------------------|-----------------------------------|
| **Data source** | Documents (OCR) | Live web APIs |
| **Proof generation** | Client-side (Noir) | Attestor-side |
| **Trust model** | User controls all inputs | Trust our own attestor |
| **Privacy** | Maximum (client-side) | High (credential hiding) |
| **Use case** | Identity documents | Financial/employment data |
| **Cost** | Infrastructure only | Infrastructure only (self-hosted) |
| **Vendor dependency** | None | None (self-hosted) |

**Reclaim complements, not replaces**, the existing document verification flow.

### Self-Hosted vs TLSNotary Comparison

| Dimension | Reclaim (Self-Hosted) | TLSNotary |
|-----------|----------------------|-----------|
| **License** | AGPL v3 | MIT/Apache-2.0 |
| **TLS support** | 1.3 ✅ | 1.2 only ❌ |
| **Extension required** | No ✅ | Yes |
| **Trust model** | Single attestor (yours) | MPC (strongest) |
| **Maturity** | Production | Alpha |
| **Cost** | Free (self-host) | Free (self-host) |

**Recommendation**: Use Reclaim self-hosted for better UX (no extension) and TLS 1.3 support. Consider TLSNotary in the future if MPC trust model becomes a requirement and they add TLS 1.3 support.

---

## Open Questions

1. **Attestor Redundancy**: Should we run multiple attestor instances for high availability?
2. **Provider Discovery**: Which banks/services have reliable API endpoints for our target users?
3. **Compliance**: Do self-hosted attestations meet regulatory requirements for SOF/SOW?
4. **Key Management**: How do we securely manage and rotate the attestor private key?
5. **Monitoring**: What metrics should we track for attestor health and usage?

---

## References

- [Reclaim Protocol Documentation](https://docs.reclaimprotocol.org/)
- [Reclaim GitHub](https://github.com/reclaimprotocol)
- [Attestor-Core Repository](https://github.com/reclaimprotocol/attestor-core) — Self-hosted attestor implementation
- [Attestor-Core Run Server Guide](https://github.com/reclaimprotocol/attestor-core/blob/main/docs/run-server.md)
- ["Proxying is Enough" Security Paper](https://blog.reclaimprotocol.org/posts/zk-in-zktls)
- [ZK Proof Gateway Research](../research/zk-proof-gateway-research.md)
