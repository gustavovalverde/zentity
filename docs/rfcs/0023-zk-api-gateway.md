# RFC-0023: ZK API Gateway

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Created** | 2026-02-03 |
| **Updated** | 2026-02-04 |
| **Author** | Gustavo Valverde |
| **Related** | [RFC-0022](0022-zkpass-integration.md), [RFC-0024](0024-reclaim-protocol-integration.md) |

---

## Table of Contents

**Part I: Design**

1. [Summary](#summary)
2. [Problem Statement](#problem-statement)
3. [Design Overview](#design)
4. [Integration with Zentity](#integration-with-zentity)
5. [Decision Matrix: TEE vs Reclaim](#decision-matrix-when-to-use-which-path)

**Part II: Implementation**
6. [Design Principles](#design-principles)
7. [Architecture Overview](#architecture-overview)
8. [Component Analysis](#component-analysis-what-to-reuse)
9. [Detailed Component Design](#detailed-component-design)
10. [API Specification](#api-specification)
11. [Deployment Architecture](#deployment-architecture)

**Part III: Operations**
12. [Security Considerations](#security-considerations)
13. [Implementation Roadmap](#implementation-roadmap)
14. [Cost Analysis](#cost-analysis)
15. [OIDC4VCI/VP Interoperability](#critical-analysis-proof-system--oidc4vcivp-interoperability)

**References**

---

## Part I: Design

## Summary

Build a **ZK API Gateway**—middleware that connects to existing data APIs (Plaid, LinkedIn, universities, government systems), fetches data server-side inside a **Trusted Execution Environment (TEE)**, generates zero-knowledge proofs about that data, and returns **only proofs** to callers. Raw data is never stored or transmitted beyond the enclave.

This RFC covers **server-initiated verification**—when Zentity has API access and the user provides their access token. It complements **RFC-0024 (Reclaim Protocol)** which handles **user-initiated verification**—when users authenticate to websites themselves and an attestor witnesses the TLS session.

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Two Complementary Verification Paths                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────┐  ┌─────────────────────────────────┐   │
│  │  SERVER-INITIATED (This RFC)    │  │  USER-INITIATED (RFC-0024)      │   │
│  │                                 │  │                                 │   │
│  │  User provides: API token       │  │  User provides: Login to site   │   │
│  │  Zentity: Calls API in TEE      │  │  Attestor: Witnesses TLS        │   │
│  │  Example: Plaid, gov tax APIs   │  │  Example: Bank portal, LinkedIn │   │
│  │                                 │  │                                 │   │
│  │  Flow:                          │  │  Flow:                          │   │
│  │  1. User links account (Plaid)  │  │  1. User clicks "Verify Income" │   │
│  │  2. Gateway gets token          │  │  2. Reclaim SDK opens session   │   │
│  │  3. TEE calls API               │  │  3. User logs into bank portal  │   │
│  │  4. TEE generates ZK proof      │  │  4. Attestor signs transcript   │   │
│  │  5. Proof → Frontend            │  │  5. Proof → Frontend            │   │
│  │  6. Frontend bundles w/ Noir    │  │  6. Frontend bundles w/ Noir    │   │
│  └─────────────────────────────────┘  └─────────────────────────────────┘   │
│                                                                             │
│                       Both paths produce the same output:                   │
│              Cryptographic proof of a claim without raw data                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Problem Statement

### The Data Liability Problem

Modern applications need to verify user attributes:

- **Fintechs**: Verify income, account balances, transaction history
- **Lenders**: Verify employment, creditworthiness
- **Employers**: Verify education, credentials
- **Compliance**: Verify source of funds, source of wealth

Current approach: Applications integrate APIs (Plaid, Experian, LinkedIn) and **receive raw data**:

```text
App → Plaid API → Returns: Account numbers, balances,
                          transaction history, routing numbers

Result: App now holds sensitive PII with breach liability
```

Every API integration creates a new data silo. Every data silo is a breach target.

### Two Complementary Solutions

| Approach | Data Source | Who Initiates | Trust Model | Best For |
|----------|-------------|---------------|-------------|----------|
| **Reclaim Protocol (RFC-0024)** | Any HTTPS website | User (browser) | User + Attestor | Bank portals, social logins, any website |
| **ZK API Gateway (This RFC)** | APIs (Plaid, gov, etc.) | Server (TEE) | TEE attestation | Plaid-linked banks, gov tax APIs, payroll |

**Reclaim** = User logs into their bank portal → Attestor witnesses TLS → ZK proof
**ZK Gateway** = User provides API token → TEE calls API → ZK proof → discards raw data

Both produce the same output: **cryptographic proof of a claim without raw data**.

**When to use which:**

- **User-Initiated (Reclaim)**: User authenticates to a website themselves. Use when no API exists, user has the credentials, or for social/bank logins.
- **Server-Initiated (TEE Gateway)**: Zentity calls an API with a user-provided token. Use for Plaid integrations, government tax APIs, or any data source with programmatic access.

## Design

### Architecture Overview

```text
┌───────────────────────────────────────────────────────────────────┐
│                       Consuming Applications                      │
│                                                                   │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐            │
│  │   Fintech   │    │   Lender    │    │  Employer   │            │
│  │    App      │    │    App      │    │    App      │            │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘            │
│         │                  │                  │                   │
│         │   "Is balance    │   "Is user       │   "Does user      │
│         │    ≥ $10K?"      │    employed?"    │    have degree?"  │
│         │                  │                  │                   │
│         └──────────────────┼──────────────────┘                   │
│                            ▼                                      │
└────────────────────────────┼──────────────────────────────────────┘
                             │
                             ▼
┌───────────────────────────────────────────────────────────────────┐
│                         ZK API Gateway                            │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                     Request Handler                         │  │
│  │                                                             │  │
│  │  POST /verify/balance                                       │  │
│  │  POST /verify/employment                                    │  │
│  │  POST /verify/education                                     │  │
│  │  POST /verify/income                                        │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                            │                                      │
│                            ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                   Data Fetcher Layer                        │  │
│  │                                                             │  │
│  │  PlaidAdapter    LinkedInAdapter    ClearinghouseAdapter    │  │
│  │  ExperianAdapter EquifaxAdapter     UniversityAdapters      │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                            │                                      │
│                            │ Raw data (in memory only)            │
│                            ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                   ZK Proof Generator                        │  │
│  │                                                             │  │
│  │  ┌───────────────────────────────────────────────────────┐  │  │
│  │  │              Noir Circuits (UltraHonk)                │  │  │
│  │  │                                                       │  │  │
│  │  │  • balance_threshold    • employment_status           │  │  │
│  │  │  • income_range         • credential_validity         │  │  │
│  │  │  • transaction_pattern  • account_ownership           │  │  │
│  │  └───────────────────────────────────────────────────────┘  │  │
│  │                                                             │  │
│  │  Input: Raw API data + predicate                            │  │
│  │  Output: ZK proof + public inputs                           │  │
│  │  Side effect: Raw data discarded from memory                │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                            │                                      │
│                            ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                       Response                              │  │
│  │                                                             │  │
│  │  {                                                          │  │
│  │    "proof": "0x...",                                        │  │
│  │    "publicInputs": {                                        │  │
│  │      "predicate": "balance >= 10000",                       │  │
│  │      "result": true,                                        │  │
│  │      "dataSource": "plaid",                                 │  │
│  │      "timestamp": "2026-02-03T..."                          │  │
│  │    },                                                       │  │
│  │    "verificationKey": "..."                                 │  │
│  │  }                                                          │  │
│  │                                                             │  │
│  │  NO raw data. NO account numbers. NO transaction details.   │  │
│  └─────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────┘
                             │
                             │ (Fetches data, then discards)
                             ▼
┌───────────────────────────────────────────────────────────────────┐
│                       External Data APIs                          │
│                                                                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────┐     │
│  │  Plaid   │  │ LinkedIn │  │ Experian │  │ Natl. Student  │     │
│  │   API    │  │   API    │  │   API    │  │ Clearinghouse  │     │
│  └──────────┘  └──────────┘  └──────────┘  └────────────────┘     │
│                                                                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────┐     │
│  │  Yodlee  │  │   ADP    │  │   IRS    │  │ State DMV APIs │     │
│  │   API    │  │   API    │  │   API    │  │                │     │
│  └──────────┘  └──────────┘  └──────────┘  └────────────────┘     │
└───────────────────────────────────────────────────────────────────┘
```

### Data Flow

```text
1. User links account (e.g., Plaid Link in app)
   └─► App receives access_token for user's bank

2. App calls ZK Gateway:
   POST /verify/balance
   {
     "plaidAccessToken": "access-xxx",
     "predicate": { "type": "gte", "threshold": 10000 },
     "nonce": "challenge-from-app"
   }

3. ZK Gateway:
   a. Fetches balances from Plaid API (raw data in memory)
   b. Computes: is any account balance >= 10000?
   c. Generates Noir/UltraHonk proof of the predicate
   d. Binds proof to Plaid's response metadata (timestamp, institution)
   e. Zeroes/discards raw balance data from memory
   f. Returns only: proof + public inputs

4. App receives:
   {
     "proof": "0x...",
     "publicInputs": {
       "predicateSatisfied": true,
       "dataSource": "plaid",
       "institutionId": "ins_123",
       "timestamp": "2026-02-03T10:30:00Z"
     }
   }

5. App (or any verifier) can verify the proof:
   └─► Mathematical certainty that balance >= 10000
   └─► No knowledge of actual balance (could be $10K or $10M)
```

### API Endpoints

```yaml
# Balance Verification
POST /v1/verify/balance
  Input:
    - plaidAccessToken: string
    - predicate: { type: "gte" | "lte" | "range", threshold: number }
    - nonce: string (replay protection)
  Output:
    - proof: string (base64)
    - publicInputs: { predicateSatisfied, dataSource, timestamp }
    - verificationKey: string

# Income Verification
POST /v1/verify/income
  Input:
    - plaidAccessToken: string (or adpToken, gustoToken)
    - predicate: { type: "annual_gte", threshold: number }
    - nonce: string
  Output:
    - proof, publicInputs, verificationKey

# Employment Verification
POST /v1/verify/employment
  Input:
    - linkedinAccessToken: string (or employerPortalToken)
    - predicate: { type: "currently_employed" | "tenure_gte", value?: number }
    - nonce: string
  Output:
    - proof, publicInputs, verificationKey

# Education Verification
POST /v1/verify/education
  Input:
    - clearinghouseToken: string (or universityPortalToken)
    - predicate: { type: "has_degree", degreeLevel?: "bachelors" | "masters" | "doctorate" }
    - nonce: string
  Output:
    - proof, publicInputs, verificationKey

# Credit Score Verification
POST /v1/verify/credit
  Input:
    - experianToken: string (or equifaxToken, transunionToken)
    - predicate: { type: "score_gte", threshold: number }
    - nonce: string
  Output:
    - proof, publicInputs, verificationKey

# Transaction Pattern Verification
POST /v1/verify/transactions
  Input:
    - plaidAccessToken: string
    - predicate: {
        type: "no_gambling" | "no_suspicious" | "regular_income",
        lookbackDays: number
      }
    - nonce: string
  Output:
    - proof, publicInputs, verificationKey
```

### Noir Circuits

We extend our existing circuit library with API-specific predicates:

```noir
// circuits/balance_threshold/src/main.nr

fn main(
    // Private inputs (from API, never leave gateway)
    account_balances: [Field; MAX_ACCOUNTS],  // Array of balances
    num_accounts: u8,

    // Public inputs (included in proof)
    threshold: pub Field,
    nonce: pub Field,
    data_source_hash: pub Field,  // Hash of "plaid" + institution_id
    timestamp: pub Field
) -> pub Field {
    // Check if ANY account meets threshold
    let mut meets_threshold = false;

    for i in 0..MAX_ACCOUNTS {
        if i < num_accounts as u32 {
            if account_balances[i] >= threshold {
                meets_threshold = true;
            }
        }
    }

    // Return 1 if meets threshold, 0 otherwise
    if meets_threshold { 1 } else { 0 }
}
```

```noir
// circuits/income_verification/src/main.nr

fn main(
    // Private: Monthly income amounts from payroll/bank
    monthly_incomes: [Field; 12],
    num_months: u8,

    // Public
    annual_threshold: pub Field,
    nonce: pub Field,
    data_source_hash: pub Field,
    timestamp: pub Field
) -> pub Field {
    // Sum income
    let mut total: Field = 0;
    for i in 0..12 {
        if i < num_months as u32 {
            total = total + monthly_incomes[i];
        }
    }

    // Annualize if partial year
    let annualized = if num_months < 12 {
        (total * 12) / (num_months as Field)
    } else {
        total
    };

    if annualized >= annual_threshold { 1 } else { 0 }
}
```

```noir
// circuits/employment_status/src/main.nr

fn main(
    // Private: Employment record
    start_date_days: Field,      // Days since epoch
    end_date_days: Field,        // 0 = still employed
    company_hash: Field,         // Hash of company name

    // Public
    current_date_days: pub Field,
    min_tenure_days: pub Field,  // 0 = just check if employed
    nonce: pub Field,
    data_source_hash: pub Field
) -> pub Field {
    // Check if currently employed
    let is_current = end_date_days == 0;

    // Check tenure if required
    let tenure = current_date_days - start_date_days;
    let meets_tenure = tenure >= min_tenure_days;

    if is_current & meets_tenure { 1 } else { 0 }
}
```

```noir
// circuits/transaction_pattern/src/main.nr

// Prove no transactions match suspicious categories
fn main(
    // Private: Transaction category codes
    transaction_categories: [Field; MAX_TRANSACTIONS],
    num_transactions: u32,

    // Private: Merkle tree of suspicious category codes
    suspicious_categories_root: Field,

    // Public
    lookback_start: pub Field,
    lookback_end: pub Field,
    nonce: pub Field,
    data_source_hash: pub Field
) -> pub Field {
    // Check that NO transaction category is in suspicious list
    let mut has_suspicious = false;

    for i in 0..MAX_TRANSACTIONS {
        if i < num_transactions {
            // Check if category is in suspicious Merkle tree
            // (simplified - would use actual Merkle proof)
            let is_suspicious = check_membership(
                transaction_categories[i],
                suspicious_categories_root
            );
            if is_suspicious {
                has_suspicious = true;
            }
        }
    }

    // Return 1 if clean, 0 if suspicious found
    if has_suspicious { 0 } else { 1 }
}
```

### Trust Model & Hardening

The gateway sees raw data temporarily. This is the key trust assumption. We can harden it:

#### Level 1: Process Isolation (Baseline)

```text
- Raw data only in memory, never written to disk
- Memory zeroed immediately after proof generation
- No logging of raw values
- Encrypted connections to all APIs
```

#### Level 2: TEE Execution (Recommended)

```text
- Run proof generation inside Intel SGX / AWS Nitro Enclave
- Data decrypted only inside enclave
- Attestation proves correct code execution
- Even gateway operator cannot see raw data
```

#### Level 3: MPC (Maximum Privacy)

```text
- Split gateway across multiple parties
- Each party sees only a share of the data
- Proof generated via MPC protocol
- No single party sees complete data
```

#### Level 4: Verifiable Computation (Future)

```text
- Generate proof-of-proof that gateway ran correctly
- Prove the proof was generated from authentic API data
- Fully trustless (but computationally expensive)
```

### API Response Binding

To prevent the gateway from fabricating data, we bind proofs to API response metadata:

```typescript
// When fetching from Plaid
const response = await plaid.getBalances(accessToken);

// Compute binding commitment
const apiBinding = poseidon2([
  hash(response.request_id),           // Plaid's unique request ID
  hash(response.item.institution_id),  // Bank identifier
  BigInt(new Date(response.timestamp).getTime())
]);

// Include in proof's public inputs
publicInputs.apiBinding = apiBinding;
publicInputs.dataSource = 'plaid';
publicInputs.institutionId = response.item.institution_id;
```

Verifiers can check that:

1. Proof was generated from data fetched at a specific time
2. Data came from a specific institution
3. Request ID is unique (prevents replay)

### Data Retention Policy

```text
╔═══════════════════════════════════════════════════════════════════╗
║                    NOTHING IS STORED                              ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                   ║
║  • Raw API responses: IN MEMORY ONLY → zeroed after proof gen    ║
║  • Account numbers: NEVER logged, NEVER stored                    ║
║  • Balances/income: NEVER logged, NEVER stored                   ║
║  • Transaction details: NEVER logged, NEVER stored               ║
║                                                                   ║
║  What IS stored (for audit):                                     ║
║  • Proof hash                                                     ║
║  • Public inputs (predicate, result, timestamp)                  ║
║  • API binding commitment                                         ║
║  • Request metadata (caller, timing)                             ║
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝
```

## Integration with Zentity

The ZK API Gateway complements Zentity's existing verification stack. **Both server-initiated (this RFC) and user-initiated (RFC-0024) proofs flow back to the frontend**, where they are packaged with identity binding using Noir circuits before final submission.

```text
┌─────────────────────────────────────────────────────────────────────┐
│                    Zentity Verification Stack                       │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │             Layer 1: Document & Biometric                    │   │
│  │             (Existing - RFC-0001+)                           │   │
│  │                                                               │  │
│  │  • Document OCR → server-signed claims                       │   │
│  │  • Liveness detection → server-signed claims                 │   │
│  │  • Face matching → server-signed claims                      │   │
│  │  • ZK proofs (age, nationality) → client-side Noir          │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │             Layer 2: External Data Verification              │   │
│  │                                                               │  │
│  │  ┌───────────────────────┐   ┌───────────────────────────┐  │    │
│  │  │ User-Initiated        │   │ Server-Initiated          │  │    │
│  │  │ (RFC-0024 - Reclaim)  │   │ (RFC-0022 - TEE Gateway)  │  │    │
│  │  │                       │   │                           │  │    │
│  │  │ • User logs into site │   │ • User provides API token │  │    │
│  │  │ • Attestor witnesses  │   │ • TEE calls API           │  │    │
│  │  │ • Signed transcript   │   │ • Enclave generates proof │  │    │
│  │  │                       │   │                           │  │    │
│  │  │ Use for: Bank portals │   │ Use for: Plaid, gov APIs, │  │    │
│  │  │ Social logins, any    │   │ payroll, credit bureaus   │  │    │
│  │  │ website w/o API       │   │                           │  │    │
│  │  └───────────────────────┘   └───────────────────────────┘  │    │
│  │                                                               │  │
│  │            Both paths return proofs to Frontend              │   │
│  └─────────────────────────────────────────────────────────────┘    │
│                            │                                        │
│                            ▼                                        │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │             Layer 3: Frontend Proof Packaging                │   │
│  │                                                               │  │
│  │  All external proofs are wrapped with identity binding:      │   │
│  │                                                               │  │
│  │  1. Receive proof from Reclaim OR TEE Gateway                │   │
│  │  2. Generate Noir identity_binding proof:                    │   │
│  │     - Links external proof to user's passkey/OPAQUE/wallet  │    │
│  │     - Prevents replay across accounts                        │   │
│  │     - Creates unified proof format                          │    │
│  │  3. Submit bundled proof to Zentity backend                  │   │
│  └─────────────────────────────────────────────────────────────┘    │
│                            │                                        │
│                            ▼                                        │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │             Layer 4: Unified Credentials                     │   │
│  │                                                               │  │
│  │  OIDC4VCI credential includes:                               │   │
│  │  • document_verified: true (OCR)                             │   │
│  │  • age_proof_verified: true (Noir)                          │    │
│  │  • source_of_funds_verified: true (Gateway OR Reclaim)      │    │
│  │  • employment_verified: true (Gateway OR Reclaim)           │    │
│  │                                                               │  │
│  │  claim_sources: {                                            │   │
│  │    document: "zentity:ocr:v1",                               │   │
│  │    age_proof: "zentity:noir:ultrahonk",                      │   │
│  │    source_of_funds: "zentity:tee-gateway:plaid",             │   │
│  │    employment: "zentity:reclaim:linkedin"                    │   │
│  │  }                                                           │   │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

### Verification Type Selection

```typescript
// Zentity automatically selects the best verification method

async function verifySourceOfFunds(userId: string): Promise<VerificationResult> {
  // Option 1: User has linked Plaid → use TEE Gateway (better UX)
  const plaidLink = await getPlaidLink(userId);
  if (plaidLink) {
    return await teeGateway.verifyBalance({
      plaidAccessToken: plaidLink.accessToken,
      predicate: { type: 'gte', threshold: SOF_THRESHOLD }
    });
  }

  // Option 2: No Plaid link → use Reclaim Protocol (user logs into bank)
  // User authenticates to their bank portal, attestor witnesses TLS
  return await reclaim.requestVerification({
    providerId: 'bank-balance-verification',
    context: { userId, minBalance: SOF_THRESHOLD }
  });
}
```

### Proof Flow: TEE Gateway → Frontend → Backend

When using the TEE Gateway, proofs flow back to the frontend for identity binding:

```typescript
// Frontend: Verify source of funds via TEE Gateway
async function verifySourceOfFundsFlow() {
  // 1. User has already linked Plaid (or we do it now)
  const plaidAccessToken = await ensurePlaidLinked();

  // 2. Call TEE Gateway to fetch data and generate proof
  const gatewayProof = await fetch('/api/zk-gateway/verify/balance', {
    method: 'POST',
    body: JSON.stringify({
      plaidAccessToken,
      predicate: { type: 'gte', threshold: 10000 },
      nonce: await generateChallenge()
    })
  }).then(r => r.json());

  // 3. Gateway returns proof + public inputs (no raw data!)
  // gatewayProof = { proof: "0x...", publicInputs: { satisfied: true, timestamp, dataSourceHash } }

  // 4. Generate identity binding proof (client-side Noir)
  // This links the external proof to the user's passkey/OPAQUE identity
  const bindingProof = await generateIdentityBindingProof({
    externalProofHash: poseidon(gatewayProof.proof),
    userIdentityHash: await getUserIdentityHash(),  // From passkey PRF
    timestamp: Date.now(),
    nonce: gatewayProof.publicInputs.nonce
  });

  // 5. Submit bundled proofs to Zentity backend
  await trpc.identity.submitExternalVerification.mutate({
    verificationType: 'source_of_funds',
    externalProof: gatewayProof,
    identityBindingProof: bindingProof
  });
}
```

### Proof Flow: Reclaim → Frontend → Backend

When using Reclaim Protocol (RFC-0024), the flow is similar:

```typescript
// Frontend: Verify employment via Reclaim (user logs into LinkedIn)
async function verifyEmploymentFlow() {
  // 1. Start Reclaim session
  const { requestUrl, sessionId } = await reclaim.createSession({
    providerId: 'linkedin-employment',
    context: { userId: currentUser.id }
  });

  // 2. User logs into LinkedIn via Reclaim's flow
  // Attestor witnesses the TLS session and signs the transcript
  const reclaimProof = await reclaim.waitForProof(sessionId);

  // 3. Reclaim returns signed attestation (no raw data!)
  // reclaimProof = { claimInfo, signatures, extractedData: { employed: true } }

  // 4. Generate identity binding proof (same as TEE Gateway path)
  const bindingProof = await generateIdentityBindingProof({
    externalProofHash: poseidon(reclaimProof.signatures[0]),
    userIdentityHash: await getUserIdentityHash(),
    timestamp: Date.now(),
    nonce: reclaimProof.claimInfo.nonce
  });

  // 5. Submit bundled proofs to Zentity backend
  await trpc.identity.submitExternalVerification.mutate({
    verificationType: 'employment',
    externalProof: reclaimProof,
    identityBindingProof: bindingProof
  });
}
```

**Key insight**: Both paths converge at the frontend identity binding step. This ensures:

1. External proofs are always linked to the user's identity
2. Replay attacks across accounts are prevented
3. Unified proof format for the backend regardless of data source

## Decision Matrix: When to Use Which Path

| Scenario | Use TEE Gateway | Use Reclaim Protocol |
|----------|-----------------|---------------------|
| User has Plaid-linked bank account | ✅ | |
| User's bank not on Plaid, but has online portal | | ✅ |
| Government tax API available (e.g., IRS, HMRC) | ✅ | |
| Verifying LinkedIn employment | | ✅ (user logs in) |
| Payroll system with API (ADP, Gusto) | ✅ | |
| Credit bureau API access | ✅ | |
| Verifying social media presence | | ✅ |
| University degree verification (API available) | ✅ | |
| University degree verification (portal only) | | ✅ |

**Rule of thumb**: If Zentity has API access via a user-provided token → TEE Gateway. If user must log in themselves → Reclaim Protocol.

## Complete Architecture: Both Paths

The following diagram shows how both verification paths (TEE Gateway and Reclaim) work together in Zentity's verification stack:

```text
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         End-to-End Verification Flow                             │
│                                                                                  │
│  ┌────────────────────────────────────────────────────────────────────────────┐ │
│  │                           1. USER INITIATES                                 │ │
│  │                                                                             │ │
│  │  User clicks "Verify Source of Funds" or "Verify Employment"               │ │
│  └────────────────────────────────────────────────────────────────────────────┘ │
│                                      │                                           │
│                    ┌─────────────────┴─────────────────┐                        │
│                    ▼                                   ▼                        │
│  ┌─────────────────────────────┐     ┌─────────────────────────────┐           │
│  │  PATH A: TEE Gateway        │     │  PATH B: Reclaim Protocol   │           │
│  │  (Server-Initiated)         │     │  (User-Initiated)           │           │
│  │                             │     │                             │           │
│  │  Condition: User has API    │     │  Condition: No API, user    │           │
│  │  token (e.g., Plaid linked) │     │  must log into website      │           │
│  └─────────────────────────────┘     └─────────────────────────────┘           │
│            │                                   │                                 │
│            ▼                                   ▼                                 │
│  ┌─────────────────────────────┐     ┌─────────────────────────────┐           │
│  │  2A. GATEWAY PROCESSING     │     │  2B. ATTESTOR WITNESSING    │           │
│  │                             │     │                             │           │
│  │  ┌───────────────────────┐  │     │  ┌───────────────────────┐  │           │
│  │  │   AWS Nitro Enclave   │  │     │  │  Reclaim Attestor     │  │           │
│  │  │                       │  │     │  │  (self-hosted)        │  │           │
│  │  │  1. Receive token     │  │     │  │                       │  │           │
│  │  │  2. Call Plaid API    │  │     │  │  1. User logs in      │  │           │
│  │  │  3. Parse response    │  │     │  │  2. TLS 1.3 Key Update│  │           │
│  │  │  4. Generate Noir     │  │     │  │  3. Witness response  │  │           │
│  │  │     proof             │  │     │  │  4. Sign transcript   │  │           │
│  │  │  5. Discard raw data  │  │     │  │  5. Return proof      │  │           │
│  │  └───────────────────────┘  │     │  └───────────────────────┘  │           │
│  │                             │     │                             │           │
│  │  Output: ZK proof +         │     │  Output: Signed attestation │           │
│  │  public inputs              │     │  + extracted claims         │           │
│  └─────────────────────────────┘     └─────────────────────────────┘           │
│            │                                   │                                 │
│            └─────────────────┬─────────────────┘                                │
│                              ▼                                                   │
│  ┌────────────────────────────────────────────────────────────────────────────┐ │
│  │                    3. FRONTEND IDENTITY BINDING                            │ │
│  │                                                                             │ │
│  │  ┌──────────────────────────────────────────────────────────────────────┐  │ │
│  │  │                  Noir identity_binding Circuit                        │  │ │
│  │  │                                                                       │  │ │
│  │  │  Inputs:                                                              │  │ │
│  │  │  • external_proof_hash: Hash of TEE or Reclaim proof                 │  │ │
│  │  │  • user_identity_hash: From passkey PRF / OPAQUE / wallet           │  │ │
│  │  │  • timestamp: Current time                                           │  │ │
│  │  │  • nonce: Challenge from server                                      │  │ │
│  │  │                                                                       │  │ │
│  │  │  Output: Bound proof that links external verification to user        │  │ │
│  │  └──────────────────────────────────────────────────────────────────────┘  │ │
│  │                                                                             │ │
│  │  Why binding matters:                                                      │ │
│  │  • Prevents replay: Proof can't be reused for another user                │ │
│  │  • Links to credential: Same identity as passkey/OPAQUE enrollment       │ │
│  │  • Unified format: Both paths produce same output structure               │ │
│  └────────────────────────────────────────────────────────────────────────────┘ │
│                              │                                                   │
│                              ▼                                                   │
│  ┌────────────────────────────────────────────────────────────────────────────┐ │
│  │                    4. BACKEND VERIFICATION                                 │ │
│  │                                                                             │ │
│  │  trpc.identity.submitExternalVerification({                                │ │
│  │    verificationType: 'source_of_funds' | 'employment' | ...,              │ │
│  │    externalProof: gatewayProof | reclaimProof,                            │ │
│  │    identityBindingProof: bindingProof                                      │ │
│  │  })                                                                        │ │
│  │                                                                             │ │
│  │  Backend verifies:                                                         │ │
│  │  1. External proof is valid (Noir verify OR signature check)              │ │
│  │  2. Identity binding links proof to current session                       │ │
│  │  3. Nonce hasn't been used before                                         │ │
│  │  4. Timestamp is recent                                                    │ │
│  └────────────────────────────────────────────────────────────────────────────┘ │
│                              │                                                   │
│                              ▼                                                   │
│  ┌────────────────────────────────────────────────────────────────────────────┐ │
│  │                    5. CREDENTIAL ISSUANCE                                  │ │
│  │                                                                             │ │
│  │  User now has verified claims added to their credential:                   │ │
│  │                                                                             │ │
│  │  {                                                                         │ │
│  │    "source_of_funds_verified": true,                                       │ │
│  │    "employment_verified": true,                                            │ │
│  │    "claim_sources": {                                                      │ │
│  │      "source_of_funds": "zentity:tee-gateway:plaid",                      │ │
│  │      "employment": "zentity:reclaim:linkedin"                              │ │
│  │    },                                                                      │ │
│  │    "verification_timestamps": {                                            │ │
│  │      "source_of_funds": "2026-02-03T10:30:00Z",                           │ │
│  │      "employment": "2026-02-03T10:35:00Z"                                  │ │
│  │    }                                                                       │ │
│  │  }                                                                         │ │
│  └────────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Part II: Implementation

## Design Principles

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Design Principles                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. SELF-HOSTABLE                                                           │
│     • Organizations can run their own gateway                               │
│     • No vendor lock-in, no per-verification fees                          │
│     • Open source core (MIT or Apache 2.0)                                 │
│                                                                              │
│  2. TEE-FIRST                                                               │
│     • All data processing happens inside AWS Nitro Enclave                 │
│     • Raw data never touches disk, never leaves enclave                    │
│     • Attestation proves correct execution                                  │
│                                                                              │
│  3. PROOF-AGNOSTIC                                                          │
│     • Support multiple proof systems: Noir/UltraHonk, RISC-0, SP1         │
│     • Pluggable proof backends                                              │
│     • Same API, different proof outputs                                     │
│                                                                              │
│  4. WEB2 + WEB3                                                             │
│     • Proofs verifiable off-chain (traditional apps)                       │
│     • Proofs verifiable on-chain (smart contracts)                         │
│     • Same proof format works for both                                      │
│                                                                              │
│  5. COMPOSABLE WITH ZENTITY                                                 │
│     • Proofs can be identity-bound using Zentity's Noir circuits           │
│     • Gateway proofs flow to frontend → identity binding → backend         │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Architecture Overview

```text
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           ZK API Gateway Service                                 │
│                                                                                  │
│  ┌────────────────────────────────────────────────────────────────────────────┐ │
│  │                         Public API Layer                                    │ │
│  │                                                                             │ │
│  │  POST /v1/verify/balance     POST /v1/verify/income                        │ │
│  │  POST /v1/verify/employment  POST /v1/verify/education                     │ │
│  │  POST /v1/verify/credit      POST /v1/verify/custom                        │ │
│  │                                                                             │ │
│  │  GET  /v1/attestation        GET  /v1/health                               │ │
│  └────────────────────────────────────────────────────────────────────────────┘ │
│                                       │                                          │
│                                       ▼                                          │
│  ┌────────────────────────────────────────────────────────────────────────────┐ │
│  │                     AWS Nitro Enclave Boundary                              │ │
│  │  ┌──────────────────────────────────────────────────────────────────────┐  │ │
│  │  │                                                                       │  │ │
│  │  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │  │ │
│  │  │  │  Request        │  │  Data Fetcher   │  │  TLS Recorder       │  │  │ │
│  │  │  │  Handler        │──│  (Adapters)     │──│  (the3cloud)        │  │  │ │
│  │  │  │                 │  │                 │  │                     │  │  │ │
│  │  │  │  • Validate     │  │  • PlaidAdapter │  │  • recordable-tls   │  │  │ │
│  │  │  │  • Decrypt      │  │  • TaxAPIAdapter│  │  • Captures session │  │  │ │
│  │  │  │  • Rate limit   │  │  • CustomAdapter│  │  • Builds witness   │  │  │ │
│  │  │  └─────────────────┘  └─────────────────┘  └─────────────────────┘  │  │ │
│  │  │           │                    │                    │               │  │ │
│  │  │           └────────────────────┼────────────────────┘               │  │ │
│  │  │                                ▼                                     │  │ │
│  │  │  ┌──────────────────────────────────────────────────────────────┐   │  │ │
│  │  │  │                   Proof Generator                             │   │  │ │
│  │  │  │                                                               │   │  │ │
│  │  │  │  ┌────────────┐  ┌────────────┐  ┌────────────────────────┐  │   │  │ │
│  │  │  │  │   Noir     │  │  RISC-0    │  │  SP1 (Succinct)        │  │   │  │ │
│  │  │  │  │  UltraHonk │  │  zkVM      │  │  zkVM                  │  │   │  │ │
│  │  │  │  │            │  │            │  │                        │  │   │  │ │
│  │  │  │  │ • balance  │  │ • TLS      │  │ • TLS proof            │  │   │  │ │
│  │  │  │  │ • income   │  │   proof    │  │ • Full session         │  │   │  │ │
│  │  │  │  │ • custom   │  │ • Full     │  │   verification         │  │   │  │ │
│  │  │  │  │   circuits │  │   session  │  │                        │  │   │  │ │
│  │  │  │  └────────────┘  └────────────┘  └────────────────────────┘  │   │  │ │
│  │  │  │                                                               │   │  │ │
│  │  │  │  Pluggable backends - same input, different proof formats    │   │  │ │
│  │  │  └──────────────────────────────────────────────────────────────┘   │  │ │
│  │  │                                │                                     │  │ │
│  │  │                                ▼                                     │  │ │
│  │  │  ┌──────────────────────────────────────────────────────────────┐   │  │ │
│  │  │  │                   Response Builder                            │   │  │ │
│  │  │  │                                                               │   │  │ │
│  │  │  │  • Attach TEE attestation (Nitro attestation document)       │   │  │ │
│  │  │  │  • Package proof + public inputs                             │   │  │ │
│  │  │  │  • Sign response with enclave key                            │   │  │ │
│  │  │  │  • Zero raw data from memory                                 │   │  │ │
│  │  │  └──────────────────────────────────────────────────────────────┘   │  │ │
│  │  │                                                                       │  │ │
│  │  └───────────────────────────────────────────────────────────────────────┘  │ │
│  │                         Enclave attestation available                       │ │
│  └─────────────────────────────────────────────────────────────────────────────┘ │
│                                       │                                          │
│                                       ▼                                          │
│  ┌────────────────────────────────────────────────────────────────────────────┐ │
│  │                         Response                                            │ │
│  │                                                                             │ │
│  │  {                                                                         │ │
│  │    "proof": "0x...",           // ZK proof (Noir, RISC-0, or SP1)         │ │
│  │    "publicInputs": {                                                       │ │
│  │      "predicateSatisfied": true,                                          │ │
│  │      "predicateType": "balance_gte",                                      │ │
│  │      "threshold": 10000,                                                  │ │
│  │      "dataSource": "plaid",                                               │ │
│  │      "timestamp": 1706961234                                              │ │
│  │    },                                                                      │ │
│  │    "teeAttestation": "...",    // AWS Nitro attestation document          │ │
│  │    "proofSystem": "noir-ultrahonk",                                       │ │
│  │    "verificationKey": "..."    // For off-chain verification              │ │
│  │  }                                                                         │ │
│  │                                                                             │ │
│  │  NO raw data. NO account numbers. NO transaction details.                  │ │
│  └────────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## Component Analysis: What to Reuse

### From the3cloud/zktls (MIT License)

**Repository**: <https://github.com/the3cloud/zktls>

| Component | Purpose | Reuse Strategy |
|-----------|---------|----------------|
| `recordable-tls` | Captures all TLS messages during session | **Direct integration** — use as TLS client inside enclave |
| `guest-prover-r0` | RISC-0 zkVM prover for TLS proofs | **Use as proof backend** — proves entire TLS session |
| `guest-prover-sp1` | SP1 prover for TLS proofs | **Alternative backend** — faster proving times |
| `input-builder` | Prepares ZK circuit inputs | **Adapt** — modify for our predicate circuits |
| Verifier contracts | Multi-chain on-chain verification | **Deploy** — supports EVM, Solana, Sui, Aptos, TON |

**Code structure to adopt**:

```rust
// From the3cloud/zktls - recordable-tls crate
// This is the key component: a TLS client that records all messages

use recordable_tls::{RecordableTlsClient, TlsTranscript};

async fn fetch_with_proof(url: &str, headers: Headers) -> (Response, TlsTranscript) {
    let client = RecordableTlsClient::new();
    let response = client.get(url).headers(headers).send().await?;
    let transcript = client.get_transcript();
    (response, transcript)
}
```

### From Reclaim attestor-core (AGPL v3)

**Repository**: <https://github.com/reclaimprotocol/attestor-core>

| Component | Purpose | Reuse Strategy |
|-----------|---------|----------------|
| Claim creation logic | Extracts specific data from responses | **Study patterns** — adapt claim extraction logic |
| Provider system | Defines what data to extract from which URLs | **Adopt pattern** — create similar adapter system |
| WebSocket server | Real-time communication with clients | **Optional** — for streaming verification status |
| ZK file management | Downloads and manages circuit files | **Adapt** — for our Noir circuit management |

**Note on AGPL**: We can study Reclaim's patterns and architecture but should implement our own code to avoid AGPL copyleft requirements if we want MIT/Apache licensing.

**Patterns to adopt from Reclaim**:

```typescript
// Pattern: Provider definition (adapted from Reclaim's approach)
interface DataProvider {
  id: string;
  name: string;

  // How to call the API
  request: {
    url: string;
    method: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: string;
  };

  // What to extract from response
  responseMatches: {
    type: 'jsonPath' | 'regex' | 'xpath';
    pattern: string;
    name: string;  // e.g., "balance", "income"
  }[];

  // Predicate to prove
  predicate: {
    type: 'gte' | 'lte' | 'eq' | 'range' | 'membership';
    field: string;
    value: number | string | number[];
  };
}
```

### From Primus otls (LGPL v3)

**Repository**: <https://github.com/primus-labs/otls>

| Component | Purpose | Reuse Strategy |
|-----------|---------|----------------|
| QuickSilver protocol | Fast ZK proofs for TLS | **Study** — potential optimization for our proofs |
| MPC primitives | Two-party computation | **Not needed** — we use TEE instead |

**Limited reuse**: Primus is LGPL and C++, while we're building in Rust. The QuickSilver protocol is interesting but adds complexity. TEE provides sufficient trust guarantees for our use case.

## Detailed Component Design

### 1. Request Handler

```rust
// src/handler.rs

use axum::{Json, Extension};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct VerifyBalanceRequest {
    /// Plaid access token (encrypted with enclave's public key)
    pub encrypted_access_token: String,

    /// Predicate to prove
    pub predicate: BalancePredicate,

    /// Nonce for replay protection (from client)
    pub nonce: String,

    /// Which proof system to use
    #[serde(default)]
    pub proof_system: ProofSystem,
}

#[derive(Deserialize)]
pub struct BalancePredicate {
    pub r#type: PredicateType,  // "gte", "lte", "range"
    pub threshold: Option<u64>,
    pub min: Option<u64>,
    pub max: Option<u64>,
}

#[derive(Deserialize, Default)]
pub enum ProofSystem {
    #[default]
    NoirUltraHonk,
    Risc0,
    Sp1,
}

#[derive(Serialize)]
pub struct VerifyResponse {
    pub proof: String,           // Base64-encoded proof
    pub public_inputs: PublicInputs,
    pub tee_attestation: String, // Nitro attestation document
    pub proof_system: String,
    pub verification_key: Option<String>,
}

pub async fn verify_balance(
    Extension(enclave_ctx): Extension<EnclaveContext>,
    Json(req): Json<VerifyBalanceRequest>,
) -> Result<Json<VerifyResponse>, ApiError> {
    // 1. Decrypt access token inside enclave
    let access_token = enclave_ctx.decrypt(&req.encrypted_access_token)?;

    // 2. Fetch data from Plaid with TLS recording
    let (balances, tls_transcript) = fetch_plaid_balances(&access_token).await?;

    // 3. Evaluate predicate
    let predicate_result = evaluate_predicate(&balances, &req.predicate);

    // 4. Generate proof based on requested system
    let proof = match req.proof_system {
        ProofSystem::NoirUltraHonk => {
            generate_noir_proof(&balances, &req.predicate, &req.nonce).await?
        }
        ProofSystem::Risc0 => {
            generate_risc0_proof(&tls_transcript, &req.predicate).await?
        }
        ProofSystem::Sp1 => {
            generate_sp1_proof(&tls_transcript, &req.predicate).await?
        }
    };

    // 5. Get TEE attestation
    let attestation = enclave_ctx.get_attestation_document()?;

    // 6. Zero sensitive data
    drop(access_token);
    drop(balances);

    Ok(Json(VerifyResponse {
        proof: proof.proof_bytes,
        public_inputs: proof.public_inputs,
        tee_attestation: attestation,
        proof_system: req.proof_system.to_string(),
        verification_key: proof.verification_key,
    }))
}
```

### 2. Data Fetcher with TLS Recording

```rust
// src/fetcher/mod.rs

use recordable_tls::{RecordableTlsClient, TlsTranscript};
use crate::adapters::{PlaidAdapter, TaxApiAdapter, DataAdapter};

pub struct DataFetcher {
    tls_client: RecordableTlsClient,
}

impl DataFetcher {
    pub fn new() -> Self {
        Self {
            tls_client: RecordableTlsClient::builder()
                .record_all_messages(true)
                .build(),
        }
    }

    /// Fetch data and return both the parsed response and TLS transcript
    pub async fn fetch<A: DataAdapter>(
        &self,
        adapter: &A,
        credentials: &A::Credentials,
    ) -> Result<(A::Response, TlsTranscript), FetchError> {
        // Build request using adapter
        let request = adapter.build_request(credentials)?;

        // Execute with TLS recording
        let response = self.tls_client
            .request(request.method, &request.url)
            .headers(request.headers)
            .body(request.body)
            .send()
            .await?;

        // Get transcript for ZK proof
        let transcript = self.tls_client.get_transcript();

        // Parse response using adapter
        let parsed = adapter.parse_response(response).await?;

        Ok((parsed, transcript))
    }
}

// src/adapters/plaid.rs

pub struct PlaidAdapter {
    base_url: String,
}

impl DataAdapter for PlaidAdapter {
    type Credentials = PlaidCredentials;
    type Response = PlaidBalanceResponse;

    fn build_request(&self, creds: &Self::Credentials) -> Request {
        Request {
            method: Method::POST,
            url: format!("{}/accounts/balance/get", self.base_url),
            headers: vec![
                ("Content-Type", "application/json"),
                ("PLAID-CLIENT-ID", &creds.client_id),
                ("PLAID-SECRET", &creds.secret),
            ],
            body: json!({
                "access_token": creds.access_token,
            }).to_string(),
        }
    }

    async fn parse_response(&self, resp: Response) -> Result<Self::Response, ParseError> {
        let body: PlaidBalanceResponse = resp.json().await?;
        Ok(body)
    }
}

#[derive(Debug)]
pub struct PlaidBalanceResponse {
    pub accounts: Vec<PlaidAccount>,
    pub request_id: String,
    pub item: PlaidItem,
}

#[derive(Debug)]
pub struct PlaidAccount {
    pub account_id: String,
    pub balances: PlaidBalances,
    pub name: String,
    pub r#type: String,
}

#[derive(Debug)]
pub struct PlaidBalances {
    pub available: Option<f64>,
    pub current: f64,
    pub limit: Option<f64>,
    pub currency: String,
}
```

### 3. Proof Generator — Noir Backend

```rust
// src/prover/noir.rs

use noir_rs::{ProofSystem, Circuit, Witness};
use barretenberg_rs::UltraHonk;

pub struct NoirProver {
    circuits: HashMap<String, CompiledCircuit>,
}

impl NoirProver {
    pub fn new() -> Result<Self, ProverError> {
        let circuits = load_compiled_circuits()?;
        Ok(Self { circuits })
    }

    pub async fn prove_balance_threshold(
        &self,
        balances: &[PlaidBalance],
        predicate: &BalancePredicate,
        nonce: &str,
    ) -> Result<ProofResult, ProverError> {
        let circuit = self.circuits.get("balance_threshold")
            .ok_or(ProverError::CircuitNotFound)?;

        // Prepare witness (private inputs)
        let mut witness = Witness::new();

        // Private: account balances (scaled to integers)
        let balance_values: Vec<i128> = balances
            .iter()
            .map(|b| (b.current * 100.0) as i128)  // Convert to cents
            .collect();
        witness.set_private("account_balances", &balance_values);
        witness.set_private("num_accounts", balances.len() as u32);

        // Public inputs
        let threshold_cents = (predicate.threshold.unwrap_or(0) * 100) as i128;
        witness.set_public("threshold", threshold_cents);
        witness.set_public("nonce", hash_to_field(nonce));
        witness.set_public("timestamp", current_timestamp());
        witness.set_public("data_source_hash", hash_to_field("plaid"));

        // Generate proof using UltraHonk
        let prover = UltraHonk::new(circuit)?;
        let proof = prover.prove(&witness)?;

        Ok(ProofResult {
            proof_bytes: base64::encode(&proof.to_bytes()),
            public_inputs: PublicInputs {
                predicate_satisfied: evaluate_threshold(&balance_values, threshold_cents),
                predicate_type: "balance_gte".into(),
                threshold: predicate.threshold,
                data_source: "plaid".into(),
                timestamp: current_timestamp(),
                nonce_hash: hash_to_field(nonce),
            },
            verification_key: Some(base64::encode(&prover.verification_key())),
        })
    }
}
```

**Noir Circuit** (balance_threshold.nr):

```noir
// noir-circuits/balance_threshold/src/main.nr

use dep::std;

// Maximum accounts to check
global MAX_ACCOUNTS: u32 = 10;

fn main(
    // Private inputs (from Plaid API, never leave enclave)
    account_balances: [Field; MAX_ACCOUNTS],
    num_accounts: u8,

    // Public inputs (included in proof)
    threshold: pub Field,
    nonce: pub Field,
    data_source_hash: pub Field,
    timestamp: pub Field
) -> pub Field {
    // Verify at least one account meets threshold
    let mut meets_threshold: bool = false;

    for i in 0..MAX_ACCOUNTS {
        if i as u8 < num_accounts {
            if account_balances[i] as u64 >= threshold as u64 {
                meets_threshold = true;
            }
        }
    }

    // Return 1 if threshold met, 0 otherwise
    if meets_threshold { 1 } else { 0 }
}

#[test]
fn test_balance_above_threshold() {
    let balances = [1500000, 0, 0, 0, 0, 0, 0, 0, 0, 0];  // $15,000 in cents
    let result = main(
        balances,
        1,
        1000000,  // $10,000 threshold
        12345,    // nonce
        0x1234,   // data source hash
        1706961234 // timestamp
    );
    assert(result == 1);
}
```

### 4. Proof Generator — RISC-0/SP1 Backend (Full TLS Proof)

```rust
// src/prover/risc0.rs

use risc0_zkvm::{Prover, ExecutorEnv, Receipt};
use crate::tls::TlsTranscript;

pub struct Risc0Prover {
    elf: &'static [u8],  // Compiled RISC-0 guest program
}

impl Risc0Prover {
    pub fn new() -> Self {
        Self {
            elf: include_bytes!("../../target/riscv-guest/release/tls-prover"),
        }
    }

    /// Generate a proof that a TLS session occurred and response matches predicate
    pub async fn prove_tls_session(
        &self,
        transcript: &TlsTranscript,
        predicate: &Predicate,
    ) -> Result<ProofResult, ProverError> {
        // Build execution environment with transcript as input
        let env = ExecutorEnv::builder()
            .write(&transcript.to_bytes())?
            .write(&predicate.to_bytes())?
            .build()?;

        // Execute and prove
        let prover = Prover::new(self.elf)?;
        let receipt = prover.prove(env)?;

        // Extract public outputs
        let public_outputs: TlsProofOutputs = receipt.journal.decode()?;

        Ok(ProofResult {
            proof_bytes: base64::encode(&receipt.to_bytes()),
            public_inputs: PublicInputs {
                predicate_satisfied: public_outputs.predicate_result,
                predicate_type: predicate.type_name(),
                server_cert_hash: public_outputs.server_cert_hash,
                response_hash: public_outputs.response_hash,
                timestamp: public_outputs.timestamp,
                ..Default::default()
            },
            verification_key: None,  // RISC-0 uses image ID instead
        })
    }
}
```

### 5. TEE Integration (AWS Nitro Enclave)

```rust
// src/enclave/mod.rs

use aws_nitro_enclaves_sdk::{
    AttestationDocument, EnclaveKey, NsmDriver,
};

pub struct EnclaveContext {
    nsm: NsmDriver,
    enclave_key: EnclaveKey,
}

impl EnclaveContext {
    pub fn new() -> Result<Self, EnclaveError> {
        let nsm = NsmDriver::new()?;

        // Generate enclave-specific key pair
        // This key is bound to the enclave's PCR values
        let enclave_key = EnclaveKey::generate(&nsm)?;

        Ok(Self { nsm, enclave_key })
    }

    /// Decrypt data that was encrypted with enclave's public key
    pub fn decrypt(&self, ciphertext: &str) -> Result<String, EnclaveError> {
        let bytes = base64::decode(ciphertext)?;
        let plaintext = self.enclave_key.decrypt(&bytes)?;
        Ok(String::from_utf8(plaintext)?)
    }

    /// Get attestation document proving this code is running in Nitro Enclave
    pub fn get_attestation_document(&self) -> Result<String, EnclaveError> {
        let doc = self.nsm.get_attestation_document(
            // Include user data in attestation (e.g., request hash)
            None,
            // Include nonce
            None,
            // Include public key for response encryption
            Some(&self.enclave_key.public_key()),
        )?;

        Ok(base64::encode(&doc.to_bytes()))
    }

    /// Get PCR values (Platform Configuration Registers)
    /// These uniquely identify the enclave code
    pub fn get_pcr_values(&self) -> Result<PcrValues, EnclaveError> {
        let pcrs = self.nsm.describe_pcrs()?;
        Ok(PcrValues {
            pcr0: hex::encode(&pcrs.pcr0),  // Enclave image hash
            pcr1: hex::encode(&pcrs.pcr1),  // Kernel hash
            pcr2: hex::encode(&pcrs.pcr2),  // Application hash
        })
    }
}

#[derive(Serialize)]
pub struct PcrValues {
    pub pcr0: String,
    pub pcr1: String,
    pub pcr2: String,
}
```

### 6. Generic Provider System

The gateway should support any API, not just Plaid. This is achieved through a **Provider Definition** system (inspired by Reclaim's approach but implemented cleanly):

```rust
// src/providers/mod.rs

use serde::{Deserialize, Serialize};

/// Provider definition - declarative configuration for any API
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderDefinition {
    /// Unique identifier (e.g., "plaid-balance", "irs-income", "custom-api")
    pub id: String,

    /// Human-readable name
    pub name: String,

    /// API request configuration
    pub request: RequestConfig,

    /// How to extract data from response
    pub extraction: ExtractionConfig,

    /// Available predicates for this provider
    pub predicates: Vec<PredicateDefinition>,

    /// Which Noir circuit to use (if using Noir proofs)
    pub noir_circuit: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequestConfig {
    /// Base URL (can include path)
    pub url: String,

    /// HTTP method
    pub method: HttpMethod,

    /// Headers (with placeholder support: {{access_token}})
    pub headers: Vec<(String, String)>,

    /// Body template (JSON with placeholders)
    pub body_template: Option<String>,

    /// Required credentials
    pub credentials: Vec<CredentialField>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CredentialField {
    pub name: String,
    pub description: String,
    pub encrypted: bool,  // Should be encrypted with enclave pubkey
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractionConfig {
    /// How to parse the response
    pub response_type: ResponseType,

    /// Fields to extract
    pub fields: Vec<FieldExtraction>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ResponseType {
    Json,
    Xml,
    Html,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FieldExtraction {
    /// Field name (used in predicates)
    pub name: String,

    /// Extraction method
    pub method: ExtractionMethod,

    /// Data type for circuit input
    pub data_type: DataType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ExtractionMethod {
    JsonPath(String),      // e.g., "$.accounts[0].balances.current"
    Regex(String),         // e.g., r"balance:\s*(\d+)"
    XPath(String),         // e.g., "//div[@class='balance']/text()"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DataType {
    Integer,
    Decimal { scale: u8 },  // e.g., scale=2 for cents
    String,
    Boolean,
    Date,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PredicateDefinition {
    pub name: String,
    pub predicate_type: PredicateType,
    pub fields: Vec<String>,  // Which extracted fields this predicate uses
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PredicateType {
    GreaterThanOrEqual,
    LessThanOrEqual,
    Equal,
    Range { min_field: String, max_field: String },
    Membership { set_field: String },
    Exists,
}
```

**Example Provider Definitions**:

```yaml
# providers/plaid-balance.yaml
id: plaid-balance
name: Plaid Account Balance
request:
  url: https://production.plaid.com/accounts/balance/get
  method: POST
  headers:
    - ["Content-Type", "application/json"]
    - ["PLAID-CLIENT-ID", "{{client_id}}"]
    - ["PLAID-SECRET", "{{secret}}"]
  body_template: |
    {"access_token": "{{access_token}}"}
  credentials:
    - name: access_token
      description: Plaid access token for user's linked account
      encrypted: true
    - name: client_id
      description: Plaid client ID
      encrypted: false
    - name: secret
      description: Plaid secret
      encrypted: true

extraction:
  response_type: Json
  fields:
    - name: balance
      method: !JsonPath "$.accounts[*].balances.current"
      data_type: !Decimal { scale: 2 }
    - name: institution_id
      method: !JsonPath "$.item.institution_id"
      data_type: String

predicates:
  - name: balance_gte
    predicate_type: GreaterThanOrEqual
    fields: [balance]
  - name: balance_range
    predicate_type: !Range { min_field: min, max_field: max }
    fields: [balance]

noir_circuit: balance_threshold
```

```yaml
# providers/irs-income.yaml (hypothetical government API)
id: irs-income
name: IRS Income Verification
request:
  url: https://api.irs.gov/v1/income/verify
  method: POST
  headers:
    - ["Authorization", "Bearer {{oauth_token}}"]
    - ["Content-Type", "application/json"]
  body_template: |
    {"ssn_hash": "{{ssn_hash}}", "tax_year": {{tax_year}}}
  credentials:
    - name: oauth_token
      description: IRS OAuth access token
      encrypted: true
    - name: ssn_hash
      description: SHA-256 hash of SSN
      encrypted: true
    - name: tax_year
      description: Tax year to verify
      encrypted: false

extraction:
  response_type: Json
  fields:
    - name: adjusted_gross_income
      method: !JsonPath "$.tax_return.agi"
      data_type: !Decimal { scale: 2 }
    - name: filing_status
      method: !JsonPath "$.tax_return.filing_status"
      data_type: String

predicates:
  - name: income_gte
    predicate_type: GreaterThanOrEqual
    fields: [adjusted_gross_income]
  - name: income_range
    predicate_type: !Range { min_field: min, max_field: max }
    fields: [adjusted_gross_income]

noir_circuit: income_verification
```

```yaml
# providers/generic-http.yaml (for custom APIs)
id: generic-http
name: Generic HTTP API
request:
  url: "{{url}}"
  method: "{{method}}"
  headers: "{{headers}}"
  body_template: "{{body}}"
  credentials:
    - name: url
      description: Full API URL
      encrypted: false
    - name: method
      description: HTTP method (GET, POST, etc.)
      encrypted: false
    - name: headers
      description: JSON object of headers
      encrypted: true  # May contain auth tokens
    - name: body
      description: Request body
      encrypted: true

extraction:
  response_type: Json
  fields:
    - name: value
      method: "{{extraction_path}}"
      data_type: "{{extraction_type}}"

predicates:
  - name: custom
    predicate_type: "{{predicate_type}}"
    fields: [value]

noir_circuit: generic_predicate
```

**Provider Registry**:

```rust
// src/providers/registry.rs

pub struct ProviderRegistry {
    providers: HashMap<String, ProviderDefinition>,
}

impl ProviderRegistry {
    pub fn new() -> Self {
        let mut registry = Self { providers: HashMap::new() };

        // Load built-in providers
        registry.register(include_str!("../../providers/plaid-balance.yaml"));
        registry.register(include_str!("../../providers/plaid-income.yaml"));
        registry.register(include_str!("../../providers/generic-http.yaml"));

        // Load custom providers from config directory
        if let Ok(entries) = std::fs::read_dir("/etc/zk-gateway/providers") {
            for entry in entries.flatten() {
                if let Ok(content) = std::fs::read_to_string(entry.path()) {
                    registry.register(&content);
                }
            }
        }

        registry
    }

    pub fn get(&self, id: &str) -> Option<&ProviderDefinition> {
        self.providers.get(id)
    }

    pub fn register(&mut self, yaml: &str) -> Result<(), RegistryError> {
        let def: ProviderDefinition = serde_yaml::from_str(yaml)?;
        self.providers.insert(def.id.clone(), def);
        Ok(())
    }
}
```

**Usage with Generic Provider**:

```json
// POST /v1/verify/custom
{
  "provider_id": "generic-http",
  "credentials": {
    "url": "encrypted:base64...",  // https://api.company.com/employee/status
    "method": "GET",
    "headers": "encrypted:base64...",  // {"Authorization": "Bearer xxx"}
    "body": null
  },
  "extraction": {
    "path": "$.employment.status",
    "type": "String"
  },
  "predicate": {
    "type": "eq",
    "expected": "active"
  },
  "nonce": "unique-nonce-123"
}
```

This design allows:

1. **Built-in providers** for common APIs (Plaid, etc.)
2. **Custom providers** via configuration files
3. **Generic HTTP** for any API without pre-configuration
4. **Same proof generation** regardless of data source

### 7. Verification Endpoints (Off-chain + On-chain)

```rust
// src/verifier/mod.rs

/// Off-chain verification for traditional apps
pub fn verify_proof_offchain(
    proof: &str,
    public_inputs: &PublicInputs,
    verification_key: &str,
    proof_system: ProofSystem,
) -> Result<bool, VerificationError> {
    match proof_system {
        ProofSystem::NoirUltraHonk => {
            let vk = VerificationKey::from_bytes(&base64::decode(verification_key)?)?;
            let proof = Proof::from_bytes(&base64::decode(proof)?)?;

            UltraHonk::verify(&vk, &proof, &public_inputs.to_fields())
        }
        ProofSystem::Risc0 => {
            let receipt = Receipt::from_bytes(&base64::decode(proof)?)?;
            receipt.verify(EXPECTED_IMAGE_ID)
        }
        ProofSystem::Sp1 => {
            let proof = SP1Proof::from_bytes(&base64::decode(proof)?)?;
            sp1_verifier::verify(&proof)
        }
    }
}

/// Verify TEE attestation
pub fn verify_tee_attestation(
    attestation: &str,
    expected_pcrs: &PcrValues,
) -> Result<bool, VerificationError> {
    let doc = AttestationDocument::from_bytes(&base64::decode(attestation)?)?;

    // Verify signature chain (AWS root → intermediate → enclave)
    doc.verify_signature_chain()?;

    // Verify PCR values match expected enclave
    if doc.pcr0 != expected_pcrs.pcr0
        || doc.pcr1 != expected_pcrs.pcr1
        || doc.pcr2 != expected_pcrs.pcr2
    {
        return Err(VerificationError::PcrMismatch);
    }

    Ok(true)
}
```

**Solidity Verifier** (for on-chain verification):

```solidity
// contracts/ZkGatewayVerifier.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {UltraVerifier} from "./noir/UltraVerifier.sol";

contract ZkGatewayVerifier {
    UltraVerifier public immutable noirVerifier;

    // Expected enclave PCR values (set during deployment)
    bytes32 public immutable expectedPcr0;
    bytes32 public immutable expectedPcr1;
    bytes32 public immutable expectedPcr2;

    // Nonces already used (replay protection)
    mapping(bytes32 => bool) public usedNonces;

    event ProofVerified(
        address indexed verifier,
        bytes32 indexed dataSourceHash,
        bool predicateSatisfied,
        uint256 timestamp
    );

    constructor(
        address _noirVerifier,
        bytes32 _pcr0,
        bytes32 _pcr1,
        bytes32 _pcr2
    ) {
        noirVerifier = UltraVerifier(_noirVerifier);
        expectedPcr0 = _pcr0;
        expectedPcr1 = _pcr1;
        expectedPcr2 = _pcr2;
    }

    function verifyBalanceProof(
        bytes calldata proof,
        bytes32[] calldata publicInputs,
        bytes calldata teeAttestation
    ) external returns (bool) {
        // 1. Verify TEE attestation (optional but recommended)
        // In production, use a TEE attestation verifier contract

        // 2. Extract nonce and check for replay
        bytes32 nonce = bytes32(publicInputs[1]);
        require(!usedNonces[nonce], "Nonce already used");
        usedNonces[nonce] = true;

        // 3. Verify ZK proof
        bool valid = noirVerifier.verify(proof, publicInputs);
        require(valid, "Invalid proof");

        // 4. Extract results
        bool predicateSatisfied = publicInputs[0] == bytes32(uint256(1));
        bytes32 dataSourceHash = bytes32(publicInputs[3]);
        uint256 timestamp = uint256(publicInputs[4]);

        emit ProofVerified(msg.sender, dataSourceHash, predicateSatisfied, timestamp);

        return predicateSatisfied;
    }
}
```

## API Specification

### POST /v1/verify/balance

**Request**:

```json
{
  "encrypted_access_token": "base64...",
  "predicate": {
    "type": "gte",
    "threshold": 10000
  },
  "nonce": "unique-client-nonce-123",
  "proof_system": "noir-ultrahonk"
}
```

**Response**:

```json
{
  "proof": "base64...",
  "public_inputs": {
    "predicate_satisfied": true,
    "predicate_type": "balance_gte",
    "threshold": 10000,
    "data_source": "plaid",
    "timestamp": 1706961234,
    "nonce_hash": "0x..."
  },
  "tee_attestation": "base64...",
  "proof_system": "noir-ultrahonk",
  "verification_key": "base64..."
}
```

### POST /v1/verify/income

**Request**:

```json
{
  "encrypted_access_token": "base64...",
  "predicate": {
    "type": "annual_gte",
    "threshold": 50000
  },
  "months": 12,
  "nonce": "unique-nonce",
  "proof_system": "noir-ultrahonk"
}
```

### POST /v1/verify/custom

For custom data sources and predicates:

```json
{
  "provider": {
    "url": "https://api.example.com/data",
    "method": "GET",
    "headers": {
      "Authorization": "encrypted:base64..."
    }
  },
  "response_extraction": {
    "type": "jsonPath",
    "pattern": "$.data.balance"
  },
  "predicate": {
    "type": "gte",
    "field": "balance",
    "threshold": 1000
  },
  "nonce": "unique-nonce",
  "proof_system": "risc0"
}
```

### GET /v1/attestation

Returns the enclave's public key and attestation document for encrypting tokens:

```json
{
  "enclave_public_key": "base64...",
  "attestation_document": "base64...",
  "pcr_values": {
    "pcr0": "0x...",
    "pcr1": "0x...",
    "pcr2": "0x..."
  }
}
```

## Deployment Architecture

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                       Deployment Architecture                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                      AWS EC2 (Nitro Instance)                          │ │
│  │                                                                         ││
│  │  ┌──────────────────────┐    ┌──────────────────────────────────────┐ │  │
│  │  │   Parent Instance    │    │        Nitro Enclave                  │ │ │
│  │  │                      │    │                                       │ │ │
│  │  │  • Load balancer     │◄──►│  • ZK API Gateway service            │ │  │
│  │  │  • TLS termination   │    │  • Proof generation                  │ │  │
│  │  │  • Request routing   │    │  • Data fetching                     │ │  │
│  │  │  • Logging (no PII)  │    │  • All sensitive operations          │ │  │
│  │  │                      │    │                                       │ │ │
│  │  │  Sees: Encrypted     │    │  Sees: Decrypted tokens, raw data   │ │   │
│  │  │        requests only │    │        (zeroed after use)            │ │  │
│  │  └──────────────────────┘    └──────────────────────────────────────┘ │  │
│  │                                                                         ││
│  │  Instance types: c6i.xlarge, c6i.2xlarge (Nitro-enabled)              │  │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  Alternative: Docker with AMD SEV-SNP (Azure Confidential Computing)        │
│                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                      Self-Hosted Option                                │ │
│  │                                                                         ││
│  │  For organizations that want to run their own gateway:                 │ │
│  │                                                                         ││
│  │  1. Deploy on any Nitro-enabled EC2 instance                          │  │
│  │  2. Build enclave image: nitro-cli build-enclave                      │  │
│  │  3. Run: nitro-cli run-enclave --eif-path gateway.eif                 │  │
│  │  4. PCR values published for verification                              │ │
│  │                                                                         ││
│  │  Estimated cost: ~$150-300/month (c6i.xlarge)                         │  │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Part III: Operations

## Security Considerations

### Trust Model

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Trust Model                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  What you TRUST:                                                            │
│  • AWS Nitro hardware (Annapurna Labs, an Amazon subsidiary)                │
│  • The enclave code (open source, auditable, PCR-verified)                  │
│  • Cryptographic assumptions (ECDSA, AES-GCM, ZK soundness)                 │
│                                                                             │
│  What you DON'T trust:                                                      │
│  • Gateway operator (can't see decrypted data)                              │
│  • Network (all sensitive data encrypted)                                   │
│  • Hosting infrastructure (enclave is isolated)                             │
│                                                                             │
│  Threat mitigations:                                                        │
│  • Side-channel attacks → AWS Nitro designed to resist                      │
│  • Compromised operator → Can't access enclave memory                       │
│  • Network MITM → Tokens encrypted to enclave pubkey                        │
│  • Replay attacks → Nonce binding in proofs                                 │
│  • Data exfiltration → No disk access, memory zeroed                        │
│                                                                             │
│  Residual risks:                                                            │
│  • Hardware backdoors (nation-state level)                                  │
│  • Zero-day enclave escape (rare, AWS patches quickly)                      │
│  • API credential theft before encryption (client-side)                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Audit Requirements

Before production deployment:

- [ ] TEE security audit (enclave boundary, memory handling)
- [ ] Cryptographic review (proof soundness, key management)
- [ ] Smart contract audit (verifier contracts)
- [ ] Penetration testing (API, network, enclave)
- [ ] Code audit (open source components, custom code)

## Implementation Roadmap

### Phase 1: Core Infrastructure (4-6 weeks)

1. **Enclave setup**
   - AWS Nitro Enclave configuration
   - Key management inside enclave
   - Attestation document generation

2. **TLS recording integration**
   - Integrate the3cloud/zktls `recordable-tls`
   - Adapt for enclave environment
   - Test with Plaid sandbox

3. **Noir proof generation**
   - Port existing Zentity circuits
   - Add balance_threshold circuit
   - Server-side proof generation

### Phase 2: API & Adapters (3-4 weeks)

1. **API implementation**
   - Request handler
   - Response builder
   - Error handling

2. **Data adapters**
   - Plaid adapter (balance, income)
   - Generic HTTP adapter
   - Response extraction (JSONPath, regex)

### Phase 3: Verification & Integration (3-4 weeks)

1. **Off-chain verification**
   - Rust verifier library
   - TypeScript/JS SDK
   - TEE attestation verification

2. **On-chain verification**
   - Deploy Noir verifiers (EVM)
   - Optional: RISC-0/SP1 verifiers
   - Multi-chain support

3. **Zentity integration**
   - Gateway client library
   - Identity binding flow
   - Backend verification

### Phase 4: Production Hardening (2-3 weeks)

1. **Security hardening**
   - Memory zeroing
   - Rate limiting
   - Audit logging (no PII)

2. **Deployment**
    - CI/CD pipeline
    - Monitoring
    - Documentation

## Cost Analysis

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Cost Analysis                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Infrastructure (self-hosted):                                              │
│  • EC2 c6i.xlarge (Nitro): ~$125/month                                      │
│  • Network transfer: ~$10-50/month                                          │
│  • Total: ~$150-200/month                                                   │
│                                                                             │
│  Per-verification costs:                                                    │
│  • Plaid Balance API: ~$0.10-0.30 per call                                  │
│  • Proof generation: ~$0.001-0.01 compute cost                              │
│  • Total: ~$0.10-0.35 per verification                                      │
│                                                                             │
│  Comparison to alternatives:                                                │
│  • Traditional Plaid integration: $0.10-0.30 + breach liability             │
│  • Opacity Network: Requires whitelist + EigenLayer staking                 │
│  • Clique: Proprietary, unclear pricing                                     │
│  • Our gateway: API cost + minimal compute, NO liability                    │
│                                                                             │
│  Value proposition:                                                         │
│  • Same API cost as traditional                                             │
│  • Eliminates breach liability (worth 10-100x API cost in risk)             │
│  • Self-hostable = no vendor lock-in                                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Critical Analysis: Proof System & OIDC4VCI/VP Interoperability

### The Core Question

Throughout the Zentity user journey, multiple proofs are generated:

- **Document proofs**: Age verification, nationality membership (Noir/UltraHonk)
- **Biometric proofs**: Face match, liveness (server-signed claims)
- **External data proofs**: Balance, income, employment (this RFC)

**Question**: Does it matter if the ZK API Gateway uses a different proof system than the existing Noir circuits?

### Understanding the Credential Flow

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Proof System vs. Credential Format                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  OIDC4VCI/VP protocols don't exchange ZK proofs directly.                   │
│  They exchange VERIFIABLE CREDENTIALS (VCs).                                │
│                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                   Zentity Verification Flow                            │ │
│  │                                                                         ││
│  │  Step 1: Generate Proofs (various systems)                             │ │
│  │  ├─► Noir proof: age >= 18                                             │ │
│  │  ├─► Noir proof: nationality in EU                                     │ │
│  │  ├─► Gateway proof: balance >= 10k (Noir OR RISC-0)                   │  │
│  │  └─► Reclaim proof: employment verified (signature)                   │  │
│  │                              │                                          ││
│  │                              ▼                                          ││
│  │  Step 2: Zentity Backend VERIFIES all proofs                          │  │
│  │  ├─► Noir verifier checks Noir proofs                                  │ │
│  │  ├─► RISC-0 verifier checks RISC-0 proofs (if used)                   │  │
│  │  ├─► Signature verifier checks Reclaim proofs                         │  │
│  │  └─► Result: All claims are validated                                 │  │
│  │                              │                                          ││
│  │                              ▼                                          ││
│  │  Step 3: Zentity ISSUES Verifiable Credential                         │  │
│  │  ┌──────────────────────────────────────────────────────────────────┐ │  │
│  │  │  {                                                                │ │ │
│  │  │    "@context": ["https://www.w3.org/2018/credentials/v1"],       │ │  │
│  │  │    "type": ["VerifiableCredential", "IdentityCredential"],       │ │  │
│  │  │    "issuer": "did:web:zentity.xyz",                              │ │  │
│  │  │    "credentialSubject": {                                        │ │  │
│  │  │      "age_verified": true,                                       │ │  │
│  │  │      "nationality_eu": true,                                     │ │  │
│  │  │      "balance_threshold_met": true,  // From Gateway            │ │   │
│  │  │      "employment_verified": true     // From Reclaim            │ │   │
│  │  │    },                                                            │ │  │
│  │  │    "proof": {                        // VC signature, NOT ZK    │ │   │
│  │  │      "type": "Ed25519Signature2020",                            │ │   │
│  │  │      "verificationMethod": "did:web:zentity.xyz#key-1"          │ │   │
│  │  │    }                                                             │ │  │
│  │  │  }                                                                │ │ │
│  │  └──────────────────────────────────────────────────────────────────┘ │  │
│  │                              │                                          ││
│  │                              ▼                                          ││
│  │  Step 4: OIDC4VCI/VP Exchange                                         │  │
│  │  ├─► Relying Party requests credential via OIDC4VP                    │  │
│  │  ├─► User presents VC (signed by Zentity)                             │  │
│  │  └─► RP verifies Zentity's signature, trusts the claims              │   │
│  │                                                                         ││
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  KEY INSIGHT: The underlying ZK proof system is INTERNAL to Zentity.        │
│  External parties (RPs) verify Zentity's VC signature, not ZK proofs.       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Implications for Proof System Choice

**For OIDC4VCI/VP interoperability**: The proof system choice is **irrelevant** because:

1. ZK proofs are verified by Zentity backend
2. Zentity issues VCs with standard signatures (Ed25519, ES256)
3. Relying Parties verify VC signatures, not ZK proofs
4. The credential format (JWT-VC, JSON-LD, SD-JWT) determines interoperability

**The proof system choice matters for**:

1. **Internal consistency**: Easier maintenance if all proofs use the same system
2. **Trust model**: What do we trust? TEE + simple proof vs. cryptographic TLS proof
3. **Performance**: Proof generation speed, verification cost
4. **On-chain verification**: If we want to verify on-chain without Zentity

### Proof System Comparison

| Aspect | Noir/UltraHonk | RISC-0/SP1 (zkVM) |
|--------|----------------|-------------------|
| **What it proves** | Predicate on data (balance >= 10k) | Entire TLS session was valid |
| **Trust model** | Trust TEE fetched correct data + ZK proof of predicate | Cryptographic proof of TLS + predicate |
| **TEE required?** | Yes (for data fetching) | No (but recommended for performance) |
| **Proof size** | ~1-5 KB | ~100-500 KB |
| **Proving time** | ~1-5 seconds | ~30-120 seconds |
| **Verification time** | ~10-50ms | ~100-500ms |
| **On-chain gas** | ~200-500K gas | ~1-3M gas |
| **Consistency with Zentity** | ✅ Same as document proofs | ❌ Different verifier needed |

### Recommendation: Layered Approach

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Recommended: Layered Trust Model                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  LAYER 1: TEE Attestation (Always)                                          │
│  ├─► Proves code running in Nitro Enclave                                   │
│  ├─► Proves data was fetched from correct API                               │
│  └─► Lightweight, fast, sufficient for most use cases                       │
│                                                                             │
│  LAYER 2: Noir/UltraHonk Predicate Proof (Default)                          │
│  ├─► Proves predicate on data (balance >= threshold)                        │
│  ├─► Consistent with Zentity's existing circuits                            │
│  ├─► Fast proving, small proofs, cheap on-chain verification                │
│  └─► Trust: TEE fetched correct data, ZK proves predicate                   │
│                                                                             │
│  LAYER 3: zkVM TLS Proof (Optional, for maximum trustlessness)              │
│  ├─► Proves entire TLS session cryptographically                            │
│  ├─► No TEE trust required for data authenticity                            │
│  ├─► Slower, larger proofs, more expensive on-chain                         │
│  └─► Use when: Regulatory requirement, high-value transactions              │
│                                                                             │
│  DEFAULT CONFIGURATION:                                                     │
│  • Layer 1 (TEE) + Layer 2 (Noir) = Fast, consistent, sufficient trust      │
│  • Layer 3 (zkVM) = Optional upgrade for specific use cases                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### When to Use Each Layer

| Use Case | Recommended Layers | Rationale |
|----------|-------------------|-----------|
| **Standard KYC** (Zentity user verification) | TEE + Noir | Fast, consistent with other Zentity proofs |
| **High-value transactions** (>$100K) | TEE + Noir + zkVM | Additional cryptographic guarantee |
| **Regulatory compliance** (auditors require proof) | TEE + zkVM | Verifiable without trusting TEE |
| **On-chain DeFi** (trustless verification) | zkVM only | Minimize trust assumptions |
| **Cross-border remittance** | TEE + Noir | Speed matters, TEE trust acceptable |

### Credential Metadata: Tracking Proof Sources

Even though the proof system doesn't affect OIDC4VCI/VP interoperability, we should track it in credential metadata for transparency:

```json
{
  "@context": ["https://www.w3.org/2018/credentials/v1"],
  "type": ["VerifiableCredential", "ZentityIdentityCredential"],
  "issuer": "did:web:zentity.xyz",
  "credentialSubject": {
    "balance_threshold_met": true,
    "employment_verified": true
  },
  "evidence": [
    {
      "type": "ZkGatewayVerification",
      "verifier": "zentity:zk-gateway:v1",
      "proofSystem": "noir-ultrahonk",
      "trustLayers": ["tee-attestation", "zk-predicate"],
      "dataSource": "plaid",
      "timestamp": "2026-02-03T10:30:00Z"
    },
    {
      "type": "ReclaimVerification",
      "verifier": "zentity:reclaim:v1",
      "proofSystem": "signature",
      "trustLayers": ["attestor-signature"],
      "dataSource": "linkedin",
      "timestamp": "2026-02-03T10:35:00Z"
    }
  ]
}
```

This allows:

- Auditors to understand how each claim was verified
- Different trust levels for different claims
- Future upgrades without breaking compatibility

---

## References

- [zkPass Documentation](https://zkpass.gitbook.io/)
- [Reclaim Protocol Documentation](https://docs.reclaimprotocol.org/)
- [AWS Nitro Enclaves](https://aws.amazon.com/ec2/nitro/nitro-enclaves/)
- [Noir Language](https://noir-lang.org/)
- [the3cloud/zktls](https://github.com/the3cloud/zktls)
- [Plaid API](https://plaid.com/docs/)
