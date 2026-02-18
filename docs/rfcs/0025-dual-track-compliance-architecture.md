# RFC-0025: Dual-Track Compliance Architecture

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Created** | 2026-02-03 |
| **Updated** | 2026-02-04 |
| **Author** | Gustavo Valverde |
| **Related** | [RFC-0023](0023-zk-api-gateway.md), [RFC-0016](0016-oidc-vc-issuance-and-presentation.md) |

---

## Executive Summary

This RFC documents a comprehensive analysis of Zentity's current data flow and storage architecture, identifies compliance gaps, and proposes a **dual-track storage model** that supports both privacy-first (non-regulated) and compliance-ready (regulated) use cases while avoiding becoming a data honeypot.

**Core Principle**: Design an architecture where Zentity holds encrypted data it **CANNOT decrypt**, while regulated RPs can access their customers' data for audit compliance.

**Key Findings**:

1. `dobDays` (date of birth) is currently stored in **plaintext** — a critical privacy leak
2. Documents are discarded after OCR — regulators require 5-year retention
3. Only cryptographic commitments are stored — regulators need reversible data
4. FHE ciphertexts are user-decryptable only — RPs cannot access for compliance audits
5. Current OIDC4VCI/VP implementation issues only derived claims — no mechanism for RP-encrypted compliance data

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Current Architecture Analysis](#2-current-architecture-analysis)
3. [Compliance Requirements](#3-compliance-requirements)
4. [Proposed Dual-Track Architecture](#4-proposed-dual-track-architecture)
5. [OAuth 2.1 & OIDC4VCI/VP Alignment](#5-oauth-21--oidc4vcivp-alignment)
   - 5.1-5.7: OAuth scopes, RP key management, consent model
   - [5.8 VC Format Strategy](#58-vc-format-strategy-privacy-vs-interoperability) — Single maximal credential, user journeys, eIDAS 2.0
   - [5.9 Login with Zentity](#59-login-with-zentity-oauth-based-identity-sharing) — OAuth-based identity sharing as alternative to VCs
6. [Security Analysis](#6-security-analysis)
7. [Schema Design](#7-schema-design)
8. [Implementation Considerations](#8-implementation-considerations)
9. [Design Decisions](#9-design-decisions)
10. [References](#10-references)
11. [Appendices](#appendix-a-current-vs-proposed-data-flow)
    - Appendix A: Current vs Proposed Data Flow
    - Appendix B: Compliance Scope Matrix
    - Appendix C: Key Files Reference (Current Implementation)
    - Appendix D: Current Verification Sub-Flows (Implementation Snapshot)
    - Appendix E: Current Storage Classification (Implementation Snapshot)
    - Appendix F: What Can Be ZK-Proven (No Storage Needed)

---

## 1. Problem Statement

Zentity's current architecture optimizes for privacy-first verification:

- ZK proofs generated client-side
- Only cryptographic commitments stored
- FHE ciphertexts decryptable only by users
- Documents processed transiently and discarded

However, **regulated financial institutions** (banks, fintechs, exchanges) require:

- **Document retention**: 5+ years of KYC document copies
- **Audit trail**: Reversible identity data for regulatory examination
- **Data access**: Ability to produce customer data upon regulatory request

**The challenge**: How do we support compliance requirements without Zentity becoming a "data honeypot" that stores plaintext PII?

---

## 2. Current Architecture Analysis

### 2.1 Data Flow Summary

```text
SIGN-UP FLOW (Credential Creation + Vault Initialization)
═══════════════════════════════════════════════════════════
User → Select credential type (Passkey/OPAQUE/Wallet)
    ↓
Generate FHE Keys (client-side TFHE WASM)
    ↓
Derive KEK from credential:
  • Passkey: HKDF(PRF output, userId, "zentity:kek:passkey")
  • OPAQUE: HKDF(export key, userId, "zentity:kek:opaque")
  • Wallet: HKDF(EIP-712 signature, userId, "zentity:kek:wallet")
    ↓
Wrap DEK with KEK → AES-256-GCM(DEK, KEK, AAD)
    ↓
Encrypt FHE keys with DEK → msgpack(AES-GCM envelope)
    ↓
Store: encryptedSecrets (blob) + secretWrappers (wrapped DEK per credential)
    ↓
Register FHE public/server keys with FHE service
    ↓
Create identity bundle → USER REACHES TIER 1
```

### 2.1.1 Vault Architecture (Credential → KEK/DEK → Encrypted Secrets)

The current “vault” model is envelope encryption:

- A **credential-derived KEK** (passkey PRF / OPAQUE export / wallet signature → HKDF) wraps a random **DEK**
- The DEK encrypts the user’s secret payload (e.g., FHE key material)
- The server stores only ciphertexts and wrappers; the KEK is never stored

```text
┌─────────────────────────────────────────────────────────────┐
│                     USER CREDENTIAL                          │
│  Passkey PRF (32B) / OPAQUE Export (64B) / Wallet Sig (65B)  │
└────────────────────────────┬────────────────────────────────┘
                             │ HKDF (salt: userId, info: purpose)
                             ▼
┌─────────────────────────────────────────────────────────────┐
│ KEK (Key Encryption Key) - AES-256-GCM CryptoKey (non-export)│
└────────────────────────────┬────────────────────────────────┘
                             │ AES-GCM wrap
                             ▼
┌─────────────────────────────────────────────────────────────┐
│ Wrapped DEK (iv + ciphertext)                                │
│ Stored server-side in `secretWrappers` (one per credential)  │
└────────────────────────────┬────────────────────────────────┘
                             │ AES-GCM encrypt
                             ▼
┌─────────────────────────────────────────────────────────────┐
│ Encrypted Secret Blob (DEK-encrypted payload)                │
│ Stored server-side in `encryptedSecrets` (one per secret)    │
└─────────────────────────────────────────────────────────────┘
```

Multi-credential support is achieved by storing multiple DEK wrappers for the same secret (e.g., primary passkey + backup passkey + wallet fallback), all unwrapping to the same DEK.

For the original passkey-specific vault design and implementation details, see RFC-0001 (Passkey-Wrapped FHE Key Storage).

```text
VERIFICATION FLOW (Document + Liveness + Face Match)
═══════════════════════════════════════════════════════════
Document Upload:
  User → Base64 image → OCR Service (Python :5004)
       ↓
  OCR extracts: fullName, DOB, documentNumber, nationality, expiry
       ↓
  ⚠️ CRITICAL: dobDays stored as INTEGER in identityVerificationDrafts
       ↓
  Commitments computed: nameCommitment, ageClaimHash, docValidityClaimHash
       ↓
  IMAGE DISCARDED (only commitments stored)

Liveness:
  User → WebSocket → Video frames (binary buffer)
       ↓
  Face detection metrics extracted: liveScore, antispoofScore
       ↓
  FRAMES DISCARDED (only metrics stored)

Face Match:
  User → Frame with face → Compare to document photo
       ↓
  faceMatchConfidence extracted
       ↓
  CROPPED IMAGE DISCARDED (only confidence stored)

ZK Proof Generation (CLIENT-SIDE):
  Client fetches signed claims → extracts claim hashes
       ↓
  Client provides private inputs (DOB, expiry, nationality)
       ↓
  Noir circuits generate proofs → PRIVATE INPUTS STAY IN BROWSER
       ↓
  Server stores: proofPayload + publicInputs (no private data)
```

### 2.2 Current Storage Schema Analysis

| Table | What's Stored | Encryption | Compliance Risk |
|-------|---------------|------------|-----------------|
| `identityBundles` | dobCommitment (hash), addressCommitment (hash), country code (plaintext int) | None | LOW - only hashes |
| `identityDocuments` | documentHash (hash), nameCommitment (hash) | None | LOW - only hashes |
| `identityVerificationDrafts` | **dobDays (PLAINTEXT INTEGER)**, claim hashes, scores | None | **CRITICAL - Full DOB exposed** |
| `encryptedAttributes` | FHE ciphertexts (DOB, country, compliance level) | TFHE FHE | LOW - only user can decrypt |
| `encryptedSecrets` | FHE keys (wrapped) | AES-GCM DEK | LOW - only user can decrypt |
| `secretWrappers` | Wrapped DEKs per credential | AES-GCM KEK | LOW - KEK never stored |
| `signedClaims` | OCR result, liveness score, face match (JSON + signature) | None | MEDIUM - structured metadata |
| `zkProofs` | Proof payloads + public inputs | None | LOW - ZK proofs, no private data |

### 2.3 Critical Issues Identified

| Issue | Severity | Description |
|-------|----------|-------------|
| **Plaintext DOB** | CRITICAL | `dobDays` stored in plaintext in `identityVerificationDrafts` |
| **No document retention** | HIGH | Documents discarded after OCR; regulators require 5-year copies |
| **No reversible data** | HIGH | Only SHA256 commitments stored; regulators need actual values |
| **No draft cleanup** | MEDIUM | `identityVerificationDrafts` accumulate indefinitely |
| **FHE not RP-accessible** | HIGH | FHE ciphertexts only user-decryptable; RPs cannot audit |
| **No RP key management** | HIGH | No concept of RP-specific encryption keys |

---

## 3. Compliance Requirements

### 3.1 Regulatory Framework

Financial regulators (FinCEN, FCA, MAS, etc.) require:

| Requirement | Retention Period | Data Type |
|-------------|------------------|-----------|
| CDD/KYC records | 5 years after relationship ends | Identity documents, verification results |
| Transaction records | 5-7 years | Linked to customer identity |
| AML screening records | 5 years | PEP/sanctions check results |
| Audit trail | 5 years | Who accessed what, when |

### 3.2 The Privacy-Compliance Tension

```text
PRIVACY-FIRST                          COMPLIANCE-READY
═══════════════                        ════════════════
• Zero PII retention                   • 5-year document copies
• Cryptographic commitments only       • Reversible identity data
• User-controlled decryption           • RP audit access
• ZK proofs for verification           • Raw verification results
```

**Resolution**: Dual-track architecture where Zentity stores encrypted data it CANNOT decrypt.

---

## 4. Proposed Dual-Track Architecture

### 4.1 Design Principles

```text
PRINCIPLE 1: ZENTITY IS NOT THE DATA CUSTODIAN
═══════════════════════════════════════════════
Zentity stores only:
  • Cryptographic commitments (hashes) - irreversible
  • FHE ciphertexts - only user can decrypt
  • RP-encrypted data - only RP can decrypt

Zentity CANNOT decrypt:
  • User vault contents (KEK derived from credential)
  • FHE attributes (client key required)
  • RP compliance data (RP key required)

This prevents Zentity from being a data honeypot.
```

```text
PRINCIPLE 2: DUAL-TRACK STORAGE
═══════════════════════════════════
Track A (Privacy-First): Non-regulated RPs
  • ZK proofs only
  • Verification flags (boolean results)
  • No PII retention

Track B (Compliance-Ready): Regulated RPs
  • ZK proofs + RP-encrypted PII
  • Document copies (encrypted to RP)
  • 5-year retention managed by RP access policy
```

```text
PRINCIPLE 3: POST-QUANTUM READY DOCUMENT STORAGE
════════════════════════════════════════════════
For 5-year document retention, use hybrid encryption:
  • Classical: X25519 ECDH + AES-256-GCM (current security)
  • Post-quantum: ML-KEM-768 (Kyber) + AES-256-GCM (future security)
  • Dual-encapsulation ensures security against both classical and quantum attacks
```

### 4.2 Track Comparison

| Aspect | Track A (Privacy-First) | Track B (Compliance-Ready) |
|--------|-------------------------|----------------------------|
| **Target RPs** | DeFi, gaming, non-regulated | Banks, exchanges, fintechs |
| **Data stored** | ZK proofs, commitments only | RP-encrypted documents + identity |
| **Encryption** | None (no PII to encrypt) | X25519 → AES-256-GCM to RP key |
| **Decryption** | N/A | Only RP can decrypt |
| **Retention** | Until user deletes account | 5 years from relationship end |
| **OIDC scopes** | `openid proof:identity` | `openid proof:identity compliance:documents` |

### 4.3 Encryption Flow

```text
COMPLIANCE DATA ENCRYPTION FLOW
═══════════════════════════════════
1. User uploads document (client-side)
2. Client fetches RP's public key from Zentity
3. Client encrypts document:

   Classical (X25519):
   ├─► Generate ephemeral X25519 keypair
   ├─► ECDH(ephemeral_private, rp_public) → shared_secret
   ├─► HKDF(shared_secret) → AES key
   └─► AES-256-GCM(document, AES key) → ciphertext

   Hybrid (X25519 + ML-KEM-768) [future]:
   ├─► X25519 encapsulation → ss1
   ├─► ML-KEM encapsulation → ss2
   ├─► HKDF(ss1 || ss2) → AES key
   └─► AES-256-GCM(document, AES key) → ciphertext

4. Client sends encrypted document to Zentity
5. Zentity stores ciphertext (CANNOT decrypt)
6. RP can later fetch and decrypt with their private key
```

### 4.4 Processing Architecture Options

**Option A: Client-Side OCR (Privacy Maximum)**

```text
User browser → Client-side OCR (WASM) → Extract fields
            → Encrypt fields to RP key → Send to Zentity
            → Generate ZK proofs client-side

Pros: Zentity never sees document or PII
Cons: Client-side OCR quality is lower; user can potentially manipulate
```

**Option B: TEE-Based OCR (Privacy + Quality)**

```text
User browser → Encrypt document to TEE public key
            → TEE decrypts, runs OCR, extracts fields
            → TEE encrypts results to RP key → Send to Zentity storage
            → TEE generates signed claims → Return to client
            → Client generates ZK proofs

Pros: High-quality OCR, server-signed claims prevent manipulation
Cons: Requires TEE infrastructure (AWS Nitro / Azure SGX)
```

**Option C: Current Architecture (Transition Period)**

```text
User browser → Document to OCR service (plaintext) → Extract fields
            → Store commitments + FHE ciphertexts
            → Client generates ZK proofs

Pros: Works today, no infrastructure changes
Cons: OCR service sees plaintext; no document retention
```

**Recommendation**: Start with Option C + compliance tables for regulated RPs, migrate to Option B (TEE) as the infrastructure matures.

---

### 4.5 ZK API Gateway Integration for Source of Funds

The ZK API Gateway (RFC-0023) is specifically designed to address Source of Funds verification:

### Gap #3: Source of Funds / Source of Wealth — DIRECT FIT

The ZK API Gateway is **specifically designed** to address SOF verification:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│          Source of Funds Verification with ZK API Gateway                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Current Gap: SOF/SOW not implemented at all                                │
│                                                                             │
│  Solution: ZK API Gateway + Layered Evidence Storage                        │
│                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                     SOF Verification Flow                               ││
│  │                                                                         ││
│  │  User links bank account (Plaid)                                       │ │
│  │       │                                                                 ││
│  │       ▼                                                                 ││
│  │  ┌─────────────────────────────────────────────────────────────────┐   │ │
│  │  │                 ZK API Gateway (TEE)                             │   ││
│  │  │                                                                  │   ││
│  │  │  1. Fetch account balances from Plaid                           │   │ │
│  │  │  2. Fetch transaction history (12 months)                       │   │ │
│  │  │  3. Fetch income data (if available)                            │   │ │
│  │  │  4. Generate ZK proofs:                                          │   ││
│  │  │     • balance >= threshold                                       │   ││
│  │  │     • income >= threshold                                        │   ││
│  │  │     • employment duration >= minimum                             │   ││
│  │  │  5. Raw data NEVER leaves TEE                                   │   │ │
│  │  └─────────────────────────────────────────────────────────────────┘   │ │
│  │       │                                                                 ││
│  │       ▼                                                                 ││
│  │  ┌─────────────────────────────────────────────────────────────────┐   │ │
│  │  │              Evidence Package (for compliance)                   │   ││
│  │  │                                                                  │   ││
│  │  │  Layer 1 (Always): ZK Proof                                     │   │ │
│  │  │  ├─► "Balance >= $10,000" (without revealing actual balance)    │   │ │
│  │  │  ├─► TEE attestation (proves correct execution)                 │   │ │
│  │  │  └─► Timestamp, data source hash, nonce                         │   │ │
│  │  │                                                                  │   ││
│  │  │  Layer 2 (Regulated Only): Encrypted Summary                    │   │ │
│  │  │  ├─► Encrypted account summary (RP key + Zentity escrow key)   │   │  │
│  │  │  ├─► Encrypted transaction categories (not individual txns)    │   │  │
│  │  │  └─► Decryptable by RP for regulatory audit                    │   │  │
│  │  │                                                                  │   ││
│  │  │  Layer 3 (High-Risk Only): Full Data Escrow                     │   │ │
│  │  │  ├─► Full transaction history (encrypted)                       │   │ │
│  │  │  ├─► Dual-custody: RP + regulator escrow                        │   │ │
│  │  │  └─► Only for PEPs, high-value, or EDD cases                   │   │  │
│  │  └─────────────────────────────────────────────────────────────────┘   │ │
│  │                                                                         ││
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  Key Insight: ZK proofs satisfy the VERIFICATION requirement.               │
│  Encrypted summaries satisfy the RETENTION requirement.                     │
│  The actual data stays in the TEE and is never exposed to Zentity.          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Implementation Strategy**:

| SOF Source | Gateway Provider | Proof Generated | Evidence Stored |
|------------|------------------|-----------------|-----------------|
| Employment income | Plaid Income API | `annual_income >= threshold` | Encrypted income summary |
| Bank balance | Plaid Balance API | `balance >= threshold` | Encrypted balance snapshot |
| Investment accounts | Plaid Investments | `portfolio_value >= threshold` | Encrypted holdings summary |
| Payroll | Plaid Payroll | `employed_months >= duration` | Encrypted employment record |
| Tax returns | IRS API (future) | `AGI >= threshold` | Encrypted tax summary |
| Crypto holdings | Exchange APIs | `holdings >= threshold` | Encrypted wallet summary |

**Implementation Strategy**:

| SOF Source | Gateway Provider | Proof Generated | Evidence Stored |
|------------|------------------|-----------------|-----------------|
| Employment income | Plaid Income API | `annual_income >= threshold` | Encrypted income summary |
| Bank balance | Plaid Balance API | `balance >= threshold` | Encrypted balance snapshot |
| Investment accounts | Plaid Investments | `portfolio_value >= threshold` | Encrypted holdings summary |
| Payroll | Plaid Payroll | `employed_months >= duration` | Encrypted employment record |
| Tax returns | IRS API (future) | `AGI >= threshold` | Encrypted tax summary |
| Crypto holdings | Exchange APIs | `holdings >= threshold` | Encrypted wallet summary |

## 5. OAuth 2.1 & OIDC4VCI/VP Alignment

### 5.1 Current Implementation Gap Analysis

The current OIDC4VCI implementation (RFC-0016) issues **derived claims only**:

```typescript
// Current proof disclosure keys (apps/web/src/lib/auth/oidc/claims.ts)
export const PROOF_DISCLOSURE_KEYS = [
  "verification_level",    // "none" | "basic" | "full"
  "verified",              // boolean
  "document_verified",     // boolean
  "liveness_verified",     // boolean
  "age_proof_verified",    // boolean
  // ... all boolean/derived values
];
```

**Problem**: Regulated RPs need **raw PII** for compliance, not just verification flags.

### 5.2 Conflict: SD-JWT Selective Disclosure vs RP-Encrypted Storage

| Approach | How It Works | Limitation |
|----------|--------------|------------|
| **SD-JWT (current)** | Issuer signs claims, holder selectively reveals | Verifier sees disclosed claims in plaintext |
| **RP-Encrypted Storage** | Data encrypted to RP key, stored by Zentity | Not portable — tied to specific RP relationship |

**Resolution**: These are **complementary**, not conflicting:

```text
SD-JWT VC                          RP-Encrypted Compliance Pack
═══════════                        ════════════════════════════
• Portable credential              • Non-portable, relationship-specific
• Selective disclosure to verifier • Full data for regulatory audit
• Proves attributes (age, status)  • Provides source documents
• User controls disclosure         • RP controls retention
```

### 5.3 Proposed OAuth Scope Extensions

Add new OAuth scopes for compliance data access:

| Scope | Description | Data Provided |
|-------|-------------|---------------|
| `openid` | Standard OIDC identity | Subject identifier |
| `proof:identity` | Identity credential issuance | SD-JWT VC with derived claims |
| `compliance:documents` | Document copies | RP-encrypted document images |
| `compliance:identity` | Identity fields | RP-encrypted name, DOB, address |
| `compliance:screening` | AML screening results | PEP/sanctions check records |

### 5.4 RP Key Registration Flow

```text
RP KEY REGISTRATION (OAuth 2.1 Dynamic Client Registration Extension)
═════════════════════════════════════════════════════════════════════
1. RP registers OAuth client (existing flow)
2. RP generates X25519 keypair (private key stays with RP)
3. RP registers public key via new endpoint:

   POST /api/auth/oauth2/clients/{client_id}/compliance-key
   Authorization: Bearer {client_credentials_token}
   Content-Type: application/json

   {
     "public_key": "base64-encoded-x25519-public-key",
     "key_algorithm": "x25519",
     "intended_use": "compliance_encryption"
   }

4. Zentity stores public key in rp_encryption_keys table
5. Client can now request compliance scopes
```

### 5.5 Compliance Data Retrieval Flow

```text
RP COMPLIANCE DATA RETRIEVAL
════════════════════════════
1. RP authenticates with client credentials grant
2. RP requests compliance data:

   GET /api/compliance/users/{pairwise_sub}/documents
   Authorization: Bearer {access_token}
   X-Zentity-Client-ID: {client_id}

3. Zentity returns encrypted blobs:

   {
     "documents": [
       {
         "type": "passport",
         "encrypted_content": "base64-ciphertext",
         "ephemeral_public_key": "base64-x25519-pubkey",
         "content_hash": "sha256-of-plaintext",
         "uploaded_at": "2026-02-03T..."
       }
     ]
   }

4. RP decrypts with their private key:

   shared_secret = X25519(rp_private, ephemeral_public)
   aes_key = HKDF(shared_secret, "zentity:compliance:document")
   plaintext = AES-GCM-Decrypt(encrypted_content, aes_key)
```

### 5.6 OIDC4VCI Integration

Compliance data is **separate from** VC issuance:

```text
┌─────────────────────────────────────────────────────────────────┐
│                      USER VERIFICATION                          │
│  Document OCR → Liveness → Face Match → ZK Proofs → FHE        │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
┌─────────────────────────┐     ┌─────────────────────────────────┐
│   OIDC4VCI ISSUANCE     │     │   COMPLIANCE STORAGE            │
│   (Privacy-First)       │     │   (Regulated RPs Only)          │
├─────────────────────────┤     ├─────────────────────────────────┤
│ • SD-JWT VC             │     │ • RP-encrypted documents        │
│ • Derived claims only   │     │ • RP-encrypted identity fields  │
│ • Holder controls       │     │ • 5-year retention              │
│ • Portable to any RP    │     │ • Specific to RP relationship   │
└─────────────────────────┘     └─────────────────────────────────┘
```

### 5.7 Consent Model

```text
CONSENT FLOW FOR COMPLIANCE DATA
════════════════════════════════
1. User initiates OAuth flow with compliance scopes:

   GET /api/auth/oauth2/authorize?
     client_id=regulated-bank
     &scope=openid proof:identity compliance:documents compliance:identity
     &redirect_uri=...

2. Consent screen shows:

   ┌──────────────────────────────────────────────┐
   │  Regulated Bank wants to:                    │
   │                                              │
   │  ✓ Verify your identity (standard)          │
   │  ✓ Store encrypted copies of your documents │
   │  ✓ Store encrypted identity information     │
   │                                              │
   │  This data will be retained for 5 years     │
   │  for regulatory compliance.                 │
   │                                              │
   │  Only Regulated Bank can decrypt this data. │
   │  Zentity cannot access it.                  │
   │                                              │
   │  [Deny]                    [Allow]          │
   └──────────────────────────────────────────────┘

3. Upon consent:
   - Client encrypts documents to RP public key
   - Zentity stores encrypted blobs
   - Consent record stored in oauth_consent table
```

### 5.8 VC Format Strategy: Privacy vs Interoperability

This section addresses how the data classification framework maps to Verifiable Credential formats, balancing privacy requirements with EUDI/eIDAS 2.0 interoperability.

#### 5.8.1 eIDAS 2.0 Privacy Requirements Analysis

Article 5a(16) of eIDAS 2.0 mandates specific privacy properties:

| Requirement | Description | SD-JWT | BBS+ |
|-------------|-------------|--------|------|
| **Selective Disclosure** | Reveal only consented claims | ✅ | ✅ |
| **Pairwise Identifiers** | Different `sub` per RP | ✅ | ✅ |
| **Issuer Unlinkability** | Issuer cannot track presentations | ❌ | ✅ |
| **RP Unlinkability** | RPs cannot collude to link users | ⚠️ Partial | ✅ |
| **Pseudonymity** | Locally-generated pseudonyms | ✅ | ✅ |

**Critical insight**: SD-JWT provides **selective disclosure** but NOT **full unlinkability**. The same credential signature appears in every presentation, enabling correlation by colluding verifiers.

**ETSI TR 119 476** defines three privacy levels for ZKP-based credentials:

1. **Selective disclosure**: Present subset of attributes (SD-JWT achieves this)
2. **RP unlinkability**: RPs cannot collude to link (requires BBS+ or similar)
3. **Full unlinkability**: No party can link, even issuer + RP collusion (requires advanced ZKP)

#### 5.8.2 EUDI Wallet Mandatory Formats

| Format | Use Case | Zentity Status | Priority |
|--------|----------|----------------|----------|
| **SD-JWT VC** | Online/API verification | ✅ Implemented | Required |
| **ISO/IEC 18013-5 mdoc** | Proximity (NFC/BLE/QR) | ❌ Not implemented | Future |

**Note**: For EUDI ecosystem compatibility, SD-JWT VC is mandatory for online flows. ISO mdoc is required for proximity verification but is out of scope for this RFC.

#### 5.8.3 Design Decision: Single Maximal Credential

**Decision**: Issue ONE credential containing ALL verified data, with PII as selectively-disclosable claims. Users control disclosure at presentation time via SD-JWT.

**Rationale**: This approach:

- Simplifies wallet management (one credential, not multiple types)
- Leverages SD-JWT's native selective disclosure
- Lets users satisfy any RP requirement with the same credential
- Keeps issuance simple (no "which credential type?" decision)
- Aligns with EUDI wallet expectations

**Alternative considered**: Multiple credential types (privacy-only vs compliance). Rejected because:

- Users would need to manage multiple credentials
- "Wrong credential" errors when RP needs claims user doesn't have
- Complexity in issuance flow
- SD-JWT already solves this via selective disclosure

#### 5.8.4 Credential Structure (Single Maximal Credential)

The credential contains ALL verified claims, organized by disclosure type:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                    ZENTITY IDENTITY CREDENTIAL (SD-JWT VC)                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ALWAYS VISIBLE (not selectively disclosable):                              │
│  ─────────────────────────────────────────────                              │
│  • iss: "https://zentity.xyz"           (issuer identifier)                 │
│  • iat: 1706918400                      (issuance timestamp)                │
│  • sub: "pairwise-id-for-rp"            (pairwise subject)                  │
│  • cnf: { jkt: "..." }                  (holder binding)                    │
│  • vct: "urn:zentity:credential:identity"                                   │
│  • verification_level: "full"           (overall status)                    │
│  • verified: true                       (boolean flag)                      │
│  • policy_version: "2026.1"             (verification policy)               │
│                                                                             │
│  SELECTIVELY DISCLOSABLE (user chooses at presentation):                    │
│  ───────────────────────────────────────────────────────                    │
│  Verification Flags:                                                        │
│  • document_verified: true                                                  │
│  • liveness_verified: true                                                  │
│  • face_match_verified: true                                                │
│  • age_proof_verified: true                                                 │
│  • nationality_proof_verified: true                                         │
│  • doc_validity_proof_verified: true                                        │
│                                                                             │
│  Cryptographic Bindings (for audit trail verification):                     │
│  • dobCommitment: "sha256:..."          (hash of DOB)                       │
│  • nameCommitment: "sha256:..."         (hash of name)                      │
│  • documentHash: "sha256:..."           (hash of document)                  │
│  • proofSetHash: "sha256:..."           (hash of all ZK proofs)             │
│  • evidencePackId: "uuid"               (reference to evidence)             │
│                                                                             │
│  Identity Data (PII - user must explicitly consent to disclose):            │
│  • full_name: "John Doe"                                                    │
│  • date_of_birth: "1990-05-15"                                              │
│  • address: { street, city, postal_code, country }                          │
│  • document_number: "AB123456"                                              │
│  • nationality: "US"                                                        │
│  • issuing_country: "US"                                                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**SD-JWT Encoding**: PII claims are hashed and hidden by default. The credential includes:

- Visible claims in the JWT payload
- `_sd` array with hashes of hidden claims
- Disclosures provided separately when user reveals claims

#### 5.8.5 User Journey: Credential Issuance

```text
USER JOURNEY: GETTING YOUR CREDENTIAL
═════════════════════════════════════

┌─────────────────────────────────────────────────────────────────────────────┐
│  STEP 1: COMPLETE VERIFICATION                                               │
│  User completes: Document OCR → Liveness → Face Match → ZK Proofs           │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  STEP 2: CREDENTIAL ISSUANCE CONSENT                                         │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Your verification is complete!                                      │   │
│  │                                                                      │   │
│  │  We'll issue you a digital identity credential that you can use      │   │
│  │  to prove your identity to services without re-verifying.            │   │
│  │                                                                      │   │
│  │  Your credential will contain:                                       │   │
│  │                                                                      │   │
│  │  ✓ Verification status (always visible to services you share with)  │   │
│  │                                                                      │   │
│  │  🔒 Your identity data (hidden until YOU choose to reveal):          │   │
│  │     • Full name                                                      │   │
│  │     • Date of birth                                                  │   │
│  │     • Address                                                        │   │
│  │     • Document details                                               │   │
│  │                                                                      │   │
│  │  ⚠️ Important: Your identity data is cryptographically hidden.       │   │
│  │     Services only see what you explicitly choose to share.           │   │
│  │                                                                      │   │
│  │  [Learn More]                              [Get My Credential]       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  STEP 3: WALLET RECEIVES CREDENTIAL                                          │
│                                                                             │
│  Credential issued via OIDC4VCI:                                            │
│  • Pre-authorized code flow (user already authenticated)                    │
│  • Holder binding established (cnf.jkt)                                     │
│  • Credential stored in wallet (internal or external)                       │
│                                                                             │
│  User now has ONE credential that works for ANY service.                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 5.8.6 User Journey: Credential Presentation

The RP specifies what they need via OIDC4VP presentation_definition. The user's wallet shows what the RP wants and lets the user decide what to share.

```text
USER JOURNEY: PRESENTING YOUR CREDENTIAL
════════════════════════════════════════

SCENARIO A: Non-Regulated RP (DeFi App)
───────────────────────────────────────

RP Request (presentation_definition):
{
  "input_descriptors": [{
    "id": "age_check",
    "constraints": {
      "fields": [
        { "path": ["$.verification_level"], "filter": { "const": "full" } },
        { "path": ["$.age_proof_verified"], "filter": { "const": true } }
      ]
    }
  }]
}

User's Wallet Shows:
┌─────────────────────────────────────────────────────────────────────────────┐
│  DeFi App wants to verify your identity                                      │
│                                                                             │
│  They're asking for:                                                         │
│  ☑ Verification level (you are "fully verified")                            │
│  ☑ Age proof status (you have a valid age proof)                            │
│                                                                             │
│  ✓ No personal information will be shared                                   │
│                                                                             │
│  [Deny]                                                    [Share]          │
└─────────────────────────────────────────────────────────────────────────────┘

Result: RP receives verification flags only. No PII disclosed.


SCENARIO B: Regulated RP (Bank) Needs Identity
──────────────────────────────────────────────

RP Request (presentation_definition):
{
  "input_descriptors": [{
    "id": "kyc_check",
    "constraints": {
      "fields": [
        { "path": ["$.verification_level"], "filter": { "const": "full" } },
        { "path": ["$.full_name"] },
        { "path": ["$.date_of_birth"] },
        { "path": ["$.address"] }
      ]
    }
  }]
}

User's Wallet Shows:
┌─────────────────────────────────────────────────────────────────────────────┐
│  Acme Bank wants to verify your identity                                     │
│                                                                             │
│  They're asking for:                                                         │
│  ☑ Verification level (you are "fully verified")                            │
│                                                                             │
│  ⚠️ They also want your personal information:                               │
│  ☑ Full name: John Doe                                                      │
│  ☑ Date of birth: May 15, 1990                                              │
│  ☑ Address: 123 Main St, Anytown, US 12345                                  │
│                                                                             │
│  This information will be visible to Acme Bank.                             │
│                                                                             │
│  [Deny]                                                    [Share]          │
└─────────────────────────────────────────────────────────────────────────────┘

Result: RP receives verification flags + disclosed PII.


SCENARIO C: RP Requests More Than User Wants to Share
─────────────────────────────────────────────────────

User's Wallet Shows:
┌─────────────────────────────────────────────────────────────────────────────┐
│  Sketchy Service wants to verify your identity                               │
│                                                                             │
│  They're asking for:                                                         │
│  ☑ Verification level                                                        │
│  ⚠️ Full name                                                               │
│  ⚠️ Date of birth                                                           │
│  ⚠️ Address                                                                 │
│  ⚠️ Document number                     ← Seems excessive for this service  │
│                                                                             │
│  [Deny]                                                    [Share]          │
└─────────────────────────────────────────────────────────────────────────────┘

User can DENY if they don't trust the RP with that much data.
```

#### 5.8.7 Who Controls What

| Actor | Controls | Mechanism |
|-------|----------|-----------|
| **Zentity (Issuer)** | What claims are IN the credential | Issuance policy based on verification |
| **RP (Verifier)** | What claims they REQUEST | presentation_definition in OIDC4VP |
| **User (Holder)** | What claims they REVEAL | Consent at presentation time |

**Key principle**: The RP cannot force disclosure. If user denies, the RP simply doesn't get the data. The RP can then decide whether to proceed without it or reject the user.

#### 5.8.8 Data Classification → VC Claim Mapping

| Data Element | In Credential | Disclosure | Notes |
|--------------|---------------|------------|-------|
| `verification_level` | ✅ Always | Visible | Core status |
| `verified` | ✅ Always | Visible | Boolean flag |
| `policy_version` | ✅ Always | Visible | Audit reference |
| `document_verified` | ✅ Always | SD | User chooses |
| `liveness_verified` | ✅ Always | SD | User chooses |
| `face_match_verified` | ✅ Always | SD | User chooses |
| `age_proof_verified` | ✅ Always | SD | User chooses |
| `nationality_proof_verified` | ✅ Always | SD | User chooses |
| `dobCommitment` | ✅ Always | SD | Audit binding |
| `nameCommitment` | ✅ Always | SD | Audit binding |
| `documentHash` | ✅ Always | SD | Audit binding |
| `proofSetHash` | ✅ Always | SD | Audit binding |
| `full_name` | ✅ Always | SD (PII) | User must consent |
| `date_of_birth` | ✅ Always | SD (PII) | User must consent |
| `address` | ✅ Always | SD (PII) | User must consent |
| `document_number` | ✅ Always | SD (PII) | User must consent |
| `nationality` | ✅ Always | SD (PII) | User must consent |

**Legend**: SD = Selectively Disclosable (hidden until user reveals)

#### 5.8.9 VC vs RP-Encrypted Compliance Data

**Critical distinction**: VCs and compliance data serve DIFFERENT purposes:

| Aspect | Verifiable Credential | RP-Encrypted Compliance Data |
|--------|----------------------|------------------------------|
| **Purpose** | Real-time verification | Regulatory audit (5-year retention) |
| **Contains** | Claims (disclosed by user) | Documents + raw identity |
| **When obtained** | At presentation | At onboarding (separate flow) |
| **Who controls** | User (holder) | RP (after user consent) |
| **Portability** | Yes — any verifier | No — specific RP only |
| **Format** | SD-JWT VC | RP-encrypted binary blob |

**Why separate?**

1. **VCs are for verification**: "Prove you're over 18" → VC presentation
2. **Compliance data is for audit**: "Regulator wants to see your KYC file" → Compliance API

A regulated RP needs BOTH:

- VC for real-time identity verification
- Compliance data for regulatory record-keeping

#### 5.8.10 Complete User Journey: Regulated RP Onboarding

```text
COMPLETE FLOW: USER ONBOARDS WITH REGULATED RP
══════════════════════════════════════════════

PHASE 1: COMPLIANCE DATA CONSENT (OAuth with compliance scopes)
───────────────────────────────────────────────────────────────

User clicks "Sign up with Zentity" on Bank website
                    │
                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Acme Bank wants to:                                                         │
│                                                                             │
│  ✓ Verify your identity (standard)                                          │
│                                                                             │
│  ⚠️ For regulatory compliance, they also request:                           │
│  ☑ Store encrypted copies of your ID documents                              │
│  ☑ Store encrypted identity information (name, DOB, address)                │
│                                                                             │
│  This data will be retained for 5 years per banking regulations.            │
│  Only Acme Bank can decrypt this data. Zentity cannot access it.            │
│                                                                             │
│  [Deny]                                                    [Allow]          │
└─────────────────────────────────────────────────────────────────────────────┘
                    │
                    ▼ (User consents)

Client-side encryption:
• User's browser encrypts documents to Bank's X25519 public key
• User's browser encrypts identity fields to Bank's key
• Encrypted blobs sent to Zentity for storage
• Zentity CANNOT decrypt (no key)

Result: Bank can retrieve encrypted compliance data via Compliance API


PHASE 2: CREDENTIAL PRESENTATION (OIDC4VP)
──────────────────────────────────────────

Bank requests identity verification via OIDC4VP
                    │
                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Acme Bank wants to verify your identity                                     │
│                                                                             │
│  They're asking for:                                                         │
│  ☑ Verification level: full                                                  │
│  ☑ Full name: John Doe                                                      │
│  ☑ Date of birth: May 15, 1990                                              │
│                                                                             │
│  [Deny]                                                    [Share]          │
└─────────────────────────────────────────────────────────────────────────────┘
                    │
                    ▼ (User consents)

User's wallet creates VP with disclosed claims
Bank validates VP signature and claims


RESULT: BANK HAS TWO THINGS
───────────────────────────

1. VC PRESENTATION (from OIDC4VP)
   • Cryptographically signed proof of identity
   • User-disclosed claims (name, DOB, verification status)
   • Used for: Real-time verification, session authentication

2. COMPLIANCE DATA (from Compliance API)
   • RP-encrypted documents (passport scan, etc.)
   • RP-encrypted identity fields
   • Used for: Regulatory audit, 5-year record keeping
   • Retrieved via: GET /api/compliance/users/{sub}/documents
```

#### 5.8.11 EUDI Interoperability Considerations

For EUDI ecosystem compatibility:

**Mandatory (Now)**:

- SD-JWT VC format (`dc+sd-jwt`) ✅
- OpenID4VCI for issuance ✅
- OpenID4VP for presentation ✅
- Holder binding via `cnf.jkt` ✅
- Pairwise subject identifiers ✅

**Recommended (Future)**:

- BBS+ for unlinkability (when EUDI adopts it) — see RFC-0018
- ISO mdoc for proximity verification
- did:web for issuer DID (RFC-0018 Phase 1)

**Gap**: eIDAS 2.0 Article 5a(16) requires issuer/RP unlinkability, but EUDI currently mandates SD-JWT which doesn't provide this. Monitor EUDI ARF evolution for BBS+ adoption.

#### 5.8.12 Credential JSON Example

```json
{
  "vct": "urn:zentity:credential:identity",
  "iss": "https://zentity.xyz",
  "iat": 1706918400,
  "exp": 1738454400,
  "sub": "urn:zentity:sub:hmac:abc123def456",
  "cnf": {
    "jkt": "holder-key-thumbprint-sha256"
  },

  "verification_level": "full",
  "verified": true,
  "policy_version": "2026.1",
  "verification_time": "2026-02-03T12:00:00Z",

  "_sd": [
    "WyJzYWx0MSIsICJkb2N1bWVudF92ZXJpZmllZCIsIHRydWVd",
    "WyJzYWx0MiIsICJsaXZlbmVzc192ZXJpZmllZCIsIHRydWVd",
    "WyJzYWx0MyIsICJmYWNlX21hdGNoX3ZlcmlmaWVkIiwgdHJ1ZV0",
    "WyJzYWx0NCIsICJhZ2VfcHJvb2ZfdmVyaWZpZWQiLCB0cnVlXQ",
    "WyJzYWx0NSIsICJuYXRpb25hbGl0eV9wcm9vZl92ZXJpZmllZCIsIHRydWVd",
    "WyJzYWx0NiIsICJkb2JDb21taXRtZW50IiwgInNoYTI1NjouLi4iXQ",
    "WyJzYWx0NyIsICJuYW1lQ29tbWl0bWVudCIsICJzaGEyNTY6Li4uIl0",
    "WyJzYWx0OCIsICJkb2N1bWVudEhhc2giLCAic2hhMjU2Oi4uLiJd",
    "WyJzYWx0OSIsICJwcm9vZlNldEhhc2giLCAic2hhMjU2Oi4uLiJd",
    "WyJzYWx0MTAiLCAiZnVsbF9uYW1lIiwgIkpvaG4gRG9lIl0",
    "WyJzYWx0MTEiLCAiZGF0ZV9vZl9iaXJ0aCIsICIxOTkwLTA1LTE1Il0",
    "WyJzYWx0MTIiLCAiYWRkcmVzcyIsIHsic3RyZWV0IjogIjEyMyBNYWluIFN0IiwgLi4ufV0",
    "WyJzYWx0MTMiLCAiZG9jdW1lbnRfbnVtYmVyIiwgIkFCMTIzNDU2Il0",
    "WyJzYWx0MTQiLCAibmF0aW9uYWxpdHkiLCAiVVMiXQ"
  ],
  "_sd_alg": "sha-256"
}
```

At presentation, the wallet includes only the disclosures for claims the user consented to reveal.

#### 5.8.13 Summary: VC + Compliance Data Architecture

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                    VC + COMPLIANCE DATA ARCHITECTURE                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  USER VERIFICATION (one-time)                                               │
│  ════════════════════════════                                               │
│  Document OCR → Liveness → Face Match → ZK Proofs → FHE                     │
│                              │                                              │
│                              ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  CREDENTIAL ISSUANCE (OIDC4VCI)                                      │   │
│  │  Single Maximal Credential with all verified claims                  │   │
│  │  • Verification flags (always visible)                               │   │
│  │  • Cryptographic bindings (selectively disclosable)                  │   │
│  │  • Identity PII (selectively disclosable)                            │   │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│                                                                             │
│  RP ONBOARDING (per-RP)                                                     │
│  ══════════════════════                                                     │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                                                                      │   │
│  │    ┌─────────────────────┐         ┌─────────────────────────┐      │    │
│  │    │  VC PRESENTATION    │         │  COMPLIANCE DATA        │      │    │
│  │    │  (OIDC4VP)          │         │  (Compliance API)       │      │    │
│  │    ├─────────────────────┤         ├─────────────────────────┤      │    │
│  │    │ • User controls     │         │ • RP-encrypted docs     │      │    │
│  │    │   disclosure        │         │ • RP-encrypted identity │      │    │
│  │    │ • Real-time proof   │         │ • 5-year retention      │      │    │
│  │    │ • Portable          │         │ • RP-specific           │      │    │
│  │    ├─────────────────────┤         ├─────────────────────────┤      │    │
│  │    │ Use: Verification   │         │ Use: Regulatory Audit   │      │    │
│  │    └─────────────────────┘         └─────────────────────────┘      │    │
│  │                                                                      │   │
│  │    Non-regulated RP:               Regulated RP:                     │   │
│  │    VC presentation only            VC presentation + Compliance data │   │
│  │                                                                      │   │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  KEY PRINCIPLES                                                             │
│  ══════════════                                                             │
│  • ONE credential serves ALL use cases (selective disclosure at present)    │
│  • User controls what claims to reveal to each RP                           │
│  • VCs are for VERIFICATION (real-time proof of attributes)                 │
│  • Compliance data is for AUDIT (regulatory record-keeping)                 │
│  • Don't conflate these — they serve different purposes                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.9 Login with Zentity: OAuth-Based Identity Sharing

In addition to VC-based flows, Zentity can serve as a **federated identity provider** using standard OAuth 2.1 / OIDC. This enables a familiar "Login with Zentity" experience where identity data flows through OAuth claims rather than verifiable credentials.

#### 5.9.1 Two Approaches to Identity Sharing

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                         IDENTITY SHARING OPTIONS                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  OPTION A: VC PRESENTATION (OIDC4VP)                                        │
│  ═══════════════════════════════════                                        │
│  • User holds credential in wallet                                          │
│  • User presents to RP via OIDC4VP presentation_definition                  │
│  • Cryptographically verifiable by any party                                │
│  • Zentity NOT involved at presentation time (issuer unlinkability)         │
│  • Best for: Decentralization, holder control, maximum privacy              │
│                                                                             │
│  OPTION B: OAUTH LOGIN (Standard OIDC)                                      │
│  ═════════════════════════════════════                                      │
│  • User clicks "Login with Zentity" (like Google, GitHub, etc.)             │
│  • Zentity returns claims via ID token / userinfo endpoint                  │
│  • RP trusts Zentity as identity provider                                   │
│  • Zentity mediates each login (can see which RPs user accesses)            │
│  • Best for: Simple integration, familiar UX, no wallet management          │
│                                                                             │
│  These are COMPLEMENTARY, not mutually exclusive.                           │
│  RPs can support both, users can choose their preferred method.             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 5.9.2 User Journey: Login with Zentity

```text
USER JOURNEY: LOGIN WITH ZENTITY (OAuth Flow)
═════════════════════════════════════════════

User visits RP website (e.g., Acme Bank)
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Create your Acme Bank account                                              │
│                                                                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐              │
│  │ Login with      │  │ Login with      │  │ Login with      │              │
│  │ Zentity    ✓    │  │ Google          │  │ Email           │              │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘              │
│                                                                             │
│  "Skip the forms — share your verified identity instantly"                  │
└─────────────────────────────────────────────────────────────────────────────┘
         │
         ▼ (User clicks "Login with Zentity")

Browser redirects to Zentity authorization endpoint:

  GET /api/auth/oauth2/authorize?
    client_id=acme-bank
    &response_type=code
    &scope=openid profile identity identity.name identity.dob identity.address
    &redirect_uri=https://acme.bank/callback
    &state=xyz123
    &code_challenge=...
    &code_challenge_method=S256
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Sign in to Acme Bank with Zentity                                          │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  [Zentity Logo]                                                      │   │
│  │                                                                      │   │
│  │  Acme Bank wants to access your Zentity account                      │   │
│  │                                                                      │   │
│  │  This will allow Acme Bank to:                                       │   │
│  │                                                                      │   │
│  │  ✓ Know who you are (required for login)                            │    │
│  │  ✓ See your verification status                                      │   │
│  │                                                                      │   │
│  │  ⚠️ They also request your identity information:                     │   │
│  │  ────────────────────────────────────────────────                    │   │
│  │  ☑ Full name: John Doe                                              │    │
│  │  ☑ Date of birth: May 15, 1990                                      │    │
│  │  ☑ Address: 123 Main St, Anytown, US 12345                          │    │
│  │                                                                      │   │
│  │  This information will be shared directly with Acme Bank.            │   │
│  │                                                                      │   │
│  │  [Deny]                                              [Allow]         │   │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
         │
         ▼ (User clicks "Allow")

Browser redirects back to RP with authorization code:

  https://acme.bank/callback?code=auth_code_xyz&state=xyz123
         │
         ▼

RP backend exchanges code for tokens:

  POST /api/auth/oauth2/token
  Content-Type: application/x-www-form-urlencoded

  grant_type=authorization_code
  &code=auth_code_xyz
  &redirect_uri=https://acme.bank/callback
  &client_id=acme-bank
  &client_secret=...
  &code_verifier=...

Response:
  {
    "access_token": "at_...",
    "token_type": "Bearer",
    "expires_in": 3600,
    "id_token": "eyJhbGciOiJSUzI1NiIs...",
    "scope": "openid profile identity identity.name identity.dob identity.address"
  }
         │
         ▼

RP calls userinfo endpoint for full claims:

  GET /api/auth/oauth2/userinfo
  Authorization: Bearer at_...

Response:
  {
    "sub": "urn:zentity:sub:pairwise:acme-bank:abc123",
    "name": "John Doe",
    "given_name": "John",
    "family_name": "Doe",
    "birthdate": "1990-05-15",
    "address": {
      "formatted": "123 Main St\nAnytown, US 12345",
      "street_address": "123 Main St",
      "locality": "Anytown",
      "postal_code": "12345",
      "country": "US"
    },
    "verification_level": "full",
    "verified": true,
    "document_verified": true,
    "liveness_verified": true,
    "face_match_verified": true,
    "verification_time": "2026-02-03T12:00:00Z"
  }
         │
         ▼

RP creates user account with verified data — NO FORMS NEEDED!
```

#### 5.9.3 OAuth Scopes for Identity Claims

| Scope | Standard | Claims Returned | Description |
|-------|----------|-----------------|-------------|
| `openid` | OIDC Core | `sub` | Required for OIDC; returns pairwise subject identifier |
| `profile` | OIDC Core | `name`, `picture`, `updated_at` | Basic display profile |
| `email` | OIDC Core | `email`, `email_verified` | Email address (if provided) |
| `identity` | Zentity | `verification_level`, `verified`, `*_verified` | Verification status flags |
| `identity.name` | Zentity | `given_name`, `family_name`, `name` | Full legal name |
| `identity.dob` | Zentity | `birthdate` | Date of birth (ISO 8601) |
| `identity.address` | Zentity | `address` (OIDC standard format) | Residential address |
| `identity.document` | Zentity | `document_number`, `document_type`, `issuing_country` | ID document details |
| `identity.nationality` | Zentity | `nationality`, `nationalities` | Citizenship |

**Scope hierarchy:**

```text
identity              → All identity.* scopes (convenience)
├── identity.name
├── identity.dob
├── identity.address
├── identity.document
└── identity.nationality
```

#### 5.9.4 Claim Definitions

**Standard OIDC Claims** (per OpenID Connect Core 1.0):

```json
{
  "sub": "urn:zentity:sub:pairwise:client123:user456",
  "name": "John Doe",
  "given_name": "John",
  "family_name": "Doe",
  "birthdate": "1990-05-15",
  "address": {
    "formatted": "123 Main St\nAnytown, US 12345",
    "street_address": "123 Main St",
    "locality": "Anytown",
    "region": "CA",
    "postal_code": "12345",
    "country": "US"
  },
  "updated_at": 1706918400
}
```

**Zentity-Specific Claims** (custom namespace):

```json
{
  "verification_level": "full",
  "verified": true,
  "document_verified": true,
  "liveness_verified": true,
  "face_match_verified": true,
  "age_proof_verified": true,
  "nationality_proof_verified": true,
  "doc_validity_proof_verified": true,
  "verification_time": "2026-02-03T12:00:00Z",
  "policy_version": "2026.1",
  "document_type": "passport",
  "document_number": "AB123456",
  "issuing_country": "US",
  "nationality": "US",
  "nationalities": ["US"]
}
```

#### 5.9.5 Comparison: OAuth Login vs VC Presentation

| Aspect | OAuth Login | VC Presentation (OIDC4VP) |
|--------|-------------|---------------------------|
| **Integration effort** | Low (standard OAuth libraries) | Medium (OIDC4VP, wallet support) |
| **User experience** | Familiar ("Login with X") | New paradigm (wallet-based) |
| **Wallet required** | No | Yes |
| **Zentity involvement** | Every login | Only at credential issuance |
| **Privacy (Zentity tracking)** | Zentity sees all logins | Zentity blind to presentations |
| **Cryptographic verification** | RP trusts Zentity | RP verifies signature directly |
| **Offline verification** | No (requires Zentity) | Yes (credential is self-contained) |
| **Correlation resistance** | Pairwise `sub` per RP | Pairwise + BBS+ unlinkability |
| **Regulatory preference** | Acceptable | May be preferred (verifiable) |

#### 5.9.6 When to Use Which

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│  DECISION GUIDE: OAUTH LOGIN vs VC PRESENTATION                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  USE OAUTH LOGIN ("Login with Zentity") WHEN:                               │
│  ─────────────────────────────────────────────                              │
│  ✓ RP wants simple, standard integration                                    │
│  ✓ RP trusts Zentity as identity provider                                   │
│  ✓ Users expect familiar "social login" experience                          │
│  ✓ No requirement for cryptographic proof of claims                         │
│  ✓ Users don't have/want to manage a wallet                                 │
│  ✓ RP only needs identity at login time (not offline)                       │
│                                                                             │
│  USE VC PRESENTATION (OIDC4VP) WHEN:                                        │
│  ───────────────────────────────────                                        │
│  ✓ RP wants cryptographic proof independent of Zentity                      │
│  ✓ User wants maximum privacy (Zentity can't track)                         │
│  ✓ Credential needs to be verified by multiple parties                      │
│  ✓ Offline/async verification required                                      │
│  ✓ Regulatory requirement for verifiable credentials                        │
│  ✓ User already has a credential wallet                                     │
│                                                                             │
│  SUPPORT BOTH WHEN:                                                         │
│  ──────────────────                                                         │
│  ✓ Different user segments have different preferences                       │
│  ✓ Migrating from OAuth to VC-based (gradual transition)                    │
│  ✓ Want to offer choice (simple vs privacy-maximizing)                      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 5.9.7 Combined Flow: OAuth Login + Compliance Data

For regulated RPs, OAuth login can be combined with compliance data storage:

```text
REGULATED RP: OAUTH LOGIN + COMPLIANCE DATA
═══════════════════════════════════════════

User clicks "Login with Zentity" on Bank website
         │
         ▼

OAuth authorization request with combined scopes:

  GET /api/auth/oauth2/authorize?
    client_id=regulated-bank
    &scope=openid profile identity.name identity.dob identity.address
           compliance:documents compliance:identity
    &redirect_uri=...
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Sign in to Regulated Bank with Zentity                                     │
│                                                                             │
│  Regulated Bank wants to access your account.                               │
│                                                                             │
│  Login information (shared via secure connection):                          │
│  ────────────────────────────────────────────────                           │
│  ☑ Full name                                                                │
│  ☑ Date of birth                                                            │
│  ☑ Address                                                                  │
│  ☑ Verification status                                                      │
│                                                                             │
│  ⚠️ Regulatory compliance (encrypted storage):                              │
│  ──────────────────────────────────────────────                             │
│  ☑ Store encrypted copies of your documents                                 │
│  ☑ Store encrypted identity information                                     │
│                                                                             │
│  Compliance data will be retained for 5 years per banking regulations.      │
│  Only Regulated Bank can decrypt this data. Zentity cannot access it.       │
│                                                                             │
│  [Deny]                                                    [Allow]          │
└─────────────────────────────────────────────────────────────────────────────┘
         │
         ▼ (User allows)

TWO THINGS HAPPEN:
         │
         ├──► 1. OAuth tokens issued with identity claims
         │       → RP calls userinfo to get name, DOB, address
         │       → Used for: Account creation, KYC display
         │
         └──► 2. Compliance data encrypted to RP key
                 → Client encrypts documents + identity to RP public key
                 → Zentity stores encrypted blobs
                 → RP retrieves via Compliance API
                 → Used for: Regulatory audit, 5-year retention

RESULT: Single consent flow covers both login AND compliance!
```

#### 5.9.8 RP Integration Example

For an RP integrating "Login with Zentity":

**1. Register OAuth Client**

```bash
# RP registers with Zentity (one-time setup)
POST /api/auth/oauth2/register
{
  "client_name": "Acme Bank",
  "redirect_uris": ["https://acme.bank/callback"],
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "scope": "openid profile identity compliance:documents compliance:identity",
  "token_endpoint_auth_method": "client_secret_basic"
}
```

**2. Authorization Request**

```javascript
// RP frontend initiates OAuth flow
const authUrl = new URL('https://zentity.xyz/api/auth/oauth2/authorize');
authUrl.searchParams.set('client_id', 'acme-bank');
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', 'openid profile identity.name identity.dob identity.address');
authUrl.searchParams.set('redirect_uri', 'https://acme.bank/callback');
authUrl.searchParams.set('state', generateState());
authUrl.searchParams.set('code_challenge', generateCodeChallenge());
authUrl.searchParams.set('code_challenge_method', 'S256');

window.location.href = authUrl.toString();
```

**3. Token Exchange**

```javascript
// RP backend exchanges code for tokens
const tokenResponse = await fetch('https://zentity.xyz/api/auth/oauth2/token', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Authorization': `Basic ${btoa(`${clientId}:${clientSecret}`)}`
  },
  body: new URLSearchParams({
    grant_type: 'authorization_code',
    code: authorizationCode,
    redirect_uri: 'https://acme.bank/callback',
    code_verifier: codeVerifier
  })
});

const { access_token, id_token } = await tokenResponse.json();
```

**4. Fetch User Info**

```javascript
// RP backend fetches user claims
const userInfo = await fetch('https://zentity.xyz/api/auth/oauth2/userinfo', {
  headers: {
    'Authorization': `Bearer ${access_token}`
  }
}).then(r => r.json());

// userInfo contains:
// - sub (pairwise identifier)
// - name, given_name, family_name
// - birthdate
// - address
// - verification_level, verified, etc.

// Create user account with verified data
await createUser({
  externalId: userInfo.sub,
  name: userInfo.name,
  dateOfBirth: userInfo.birthdate,
  address: userInfo.address,
  verificationLevel: userInfo.verification_level,
  verifiedAt: userInfo.verification_time
});
```

#### 5.9.9 Privacy Considerations

**Trade-offs of OAuth Login:**

| Concern | OAuth Login Impact | Mitigation |
|---------|-------------------|------------|
| **Zentity tracking** | Zentity sees every login | Pairwise `sub` prevents RP correlation |
| **Centralization** | Zentity is single point of trust | Offer VC alternative for decentralization |
| **Data exposure** | Claims sent via TLS | Standard OAuth security (PKCE, state) |
| **Consent fatigue** | Users may click "Allow" without reading | Clear consent UI, minimal scope requests |

**Recommendation**: Offer BOTH OAuth login (convenience) and VC presentation (privacy) to let users choose based on their preferences.

#### 5.9.10 Relationship to VC Flow

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                    IDENTITY SHARING: TWO PARALLEL PATHS                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  USER VERIFICATION (one-time, same for both paths)                          │
│  ═════════════════════════════════════════════════                          │
│  Document OCR → Liveness → Face Match → ZK Proofs → FHE                     │
│                              │                                              │
│              ┌───────────────┴───────────────┐                              │
│              ▼                               ▼                              │
│  ┌───────────────────────┐       ┌───────────────────────────┐              │
│  │  CREDENTIAL ISSUANCE  │       │  IDENTITY CLAIMS STORED   │              │
│  │  (OIDC4VCI)           │       │  (for OAuth userinfo)     │              │
│  │                       │       │                           │              │
│  │  User gets SD-JWT VC  │       │  Zentity holds claims     │              │
│  │  in wallet            │       │  for OAuth responses      │              │
│  └───────────┬───────────┘       └─────────────┬─────────────┘              │
│              │                                 │                            │
│              ▼                                 ▼                            │
│  ┌───────────────────────┐       ┌───────────────────────────┐              │
│  │  VC PRESENTATION      │       │  OAUTH LOGIN              │              │
│  │  (OIDC4VP)            │       │  ("Login with Zentity")   │              │
│  ├───────────────────────┤       ├───────────────────────────┤              │
│  │  • Wallet-based       │       │  • Browser redirect       │              │
│  │  • User controls      │       │  • Zentity mediates       │              │
│  │  • Zentity not needed │       │  • Standard OAuth         │              │
│  │  • Cryptographic proof│       │  • Trust-based            │              │
│  └───────────────────────┘       └───────────────────────────┘              │
│                                                                             │
│  SAME USER, SAME VERIFIED DATA, TWO ACCESS METHODS                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Security Analysis

### 6.1 Attack Surface Analysis

| Attack Vector | Current Risk | After Dual-Track | Mitigation |
|--------------|--------------|------------------|------------|
| Database breach | MEDIUM (dobDays exposed) | LOW (all encrypted) | Remove plaintext fields |
| Server compromise | MEDIUM (OCR sees docs) | LOW (TEE or client-side) | TEE processing |
| Insider threat | MEDIUM (ops can query) | LOW (no decrypt keys) | Zentity holds no keys |
| RP compromise | LOW (RPs get proofs) | MEDIUM (RPs hold keys) | RP responsibility |
| Quantum attack | HIGH (X25519 vulnerable) | LOW (hybrid ML-KEM) | Post-quantum encryption |

### 6.2 Post-Quantum Considerations

For 5-year document retention, current encryption (X25519, AES-256) may be vulnerable to "harvest now, decrypt later" attacks by quantum computers.

**Recommendation**: Use hybrid encryption combining:

- **ML-KEM-768** (NIST PQC standard, formerly Kyber)
- **X25519** (classical security)
- **AES-256-GCM** (symmetric, quantum-resistant with sufficient key size)

This ensures documents remain secure even if quantum computers break classical ECDH.

### 6.3 Trust Model Summary

```text
TRUST BOUNDARIES
════════════════

USER TRUSTS:
  • Zentity platform (for routing, storage orchestration)
  • Their credential (passkey/OPAQUE/wallet) for vault access
  • RP for compliance data handling

ZENTITY TRUSTS:
  • Users to provide accurate information during verification
  • RPs to properly handle decrypted compliance data
  • TEE hardware (future) for document processing

RP TRUSTS:
  • Zentity's verification process (signed claims)
  • ZK proof validity (cryptographic)
  • User consent (OAuth flow)

ZENTITY CANNOT:
  • Decrypt user vault (KEK from credential)
  • Decrypt FHE attributes (client key required)
  • Decrypt compliance data (RP key required)
  • Forge ZK proofs (cryptographically impossible)
```

---

## 7. Schema Design

### 7.1 Data Classification Framework

Before defining schema, we must classify each data element by its cryptographic treatment:

| Data Element | ZK Proof | FHE Ciphertext | RP-Encrypted | Commitment | Plaintext | Rationale |
|--------------|----------|----------------|--------------|------------|-----------|-----------|
| **Full Name** | ❌ | ❌ | ✅ (regulated) | ✅ (always) | ❌ | No computation needed; audit access required |
| **Date of Birth** | ✅ (age proof) | ✅ (computation) | ✅ (regulated) | ✅ (always) | ❌ | Age verification + allowlist checks + audit |
| **Address** | ✅ (jurisdiction) | ❌ | ✅ (regulated) | ✅ (always) | ❌ | Geographic checks + audit |
| **Country Code** | ✅ (nationality) | ✅ (allowlist) | ✅ (regulated) | ❌ | ❌ | Nationality membership + sanctions checks |
| **Document Number** | ❌ | ❌ | ✅ (regulated) | ✅ (always) | ❌ | No computation; audit only |
| **Document Expiry** | ✅ (validity) | ❌ | ❌ | ✅ (claim hash) | ❌ | Expiry check only |
| **Document Image** | ❌ | ❌ | ✅ (regulated) | ✅ (integrity) | ❌ | Audit only; hash for integrity |
| **Face Embedding** | ✅ (similarity) | ❌ | ✅ (IAL3) | ❌ | ❌ | Proof sufficient; IAL3 needs biometric |
| **Liveness Score** | ✅ (threshold) | ✅ (computation) | ❌ | ❌ | ✅ (signed claim) | Server-attested; no audit need |
| **Face Match Score** | ✅ (threshold) | ❌ | ❌ | ❌ | ✅ (signed claim) | Server-attested; no audit need |
| **Risk Score** | ❌ | ✅ (computation) | ❌ | ❌ | ✅ (derived) | Internal computation only |
| **Compliance Level** | ❌ | ✅ (attestation) | ❌ | ❌ | ❌ | On-chain attestation |
| **PEP/Sanctions Result** | ❌ | ❌ | ❌ | ❌ | ✅ (audit) | Non-PII; audit trail |

### 7.2 Storage Layer Architecture

```text
┌───────────────────────────────────────────────────────────────────────────┐
│                         ZENTITY DATA ARCHITECTURE                         │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  LAYER 1: COMMITMENTS (Always)                                            │
│  • documentHash, nameCommitment, dobCommitment, addressCommitment         │
│  Purpose: Deduplication, integrity, ZK circuit binding                    │
│                                                                           │
│  LAYER 2: ZK PROOFS (Always)                                              │
│  • age_verification, doc_validity, nationality_membership, face_match     │
│  Purpose: Verify attributes without revealing values                      │
│                                                                           │
│  LAYER 3: SIGNED CLAIMS (Always)                                          │
│  • ocr_result, liveness_score, face_match_score                           │
│  Purpose: Server-attested verification results                            │
│                                                                           │
│  LAYER 4: FHE CIPHERTEXTS (User-Decryptable)                              │
│  • dob_days, country_code, liveness_score, compliance_level               │
│  Purpose: Encrypted computation, re-proofing                              │
│                                                                           │
│  LAYER 5: RP-ENCRYPTED COMPLIANCE (Regulated RPs Only)                    │
│  • Documents, Identity fields, Screening details, Biometrics (IAL3)       │
│  Purpose: Regulatory audit access                                         │
│                                                                           │
│  LAYER 6: PLAINTEXT METADATA (Always)                                     │
│  • documentType, issuerCountry, verificationStatus, timestamps            │
│  Purpose: Indexing, status tracking                                       │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

### 7.3 Key Insight: Base + Extension Model

The "dual-track" is actually a **base layer** (used by all RPs) plus an **extension layer** (opt-in for regulated RPs):

```text
┌─────────────────────────────────────────────────────────────────┐
│                   ALL RPs (BASE LAYER)                          │
│  Commitments + ZK Proofs + Signed Claims + FHE + Vault          │
└─────────────────────────────────────────────────────────────────┘
                              +
┌─────────────────────────────────────────────────────────────────┐
│  REGULATED RP EXTENSION (opt-in with user consent)              │
│  RP-Encrypted Documents + Identity + Screening Audit            │
└─────────────────────────────────────────────────────────────────┘
```

This means:

- **No code duplication** - compliance is additive
- **Same verification flow** - only storage differs
- **User controls** - compliance data only with explicit consent

### 7.4 New Tables Summary

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `rp_encryption_keys` | RP public key registry | `client_id`, `public_key`, `key_algorithm`, `key_fingerprint` |
| `compliance_documents` | RP-encrypted document copies | `encrypted_content`, `ephemeral_public_key`, `nonce`, `retention_expires_at` |
| `compliance_identity_data` | RP-encrypted PII bundle | `encrypted_payload`, `includes_*` flags, `retention_expires_at` |
| `screening_audit_records` | Full screening audit trail | `screened_name`, `lists_checked`, `potential_matches`, `remediation_*` |

### 7.5 Detailed Schema Definitions

#### 7.5.1 RP Encryption Keys

```typescript
export const rpEncryptionKeys = sqliteTable("rp_encryption_keys", {
  id: text("id").primaryKey(),
  clientId: text("client_id").notNull()
    .references(() => oauthClients.clientId, { onDelete: "cascade" }),
  publicKey: text("public_key").notNull(), // Base64 X25519
  keyAlgorithm: text("key_algorithm", { enum: ["x25519", "x25519-ml-kem"] })
    .notNull().default("x25519"),
  keyFingerprint: text("key_fingerprint").notNull(), // SHA-256 of public key
  intendedUse: text("intended_use").notNull().default("compliance_encryption"),
  status: text("status", { enum: ["active", "rotated", "revoked"] })
    .notNull().default("active"),
  previousKeyId: text("previous_key_id"), // Key rotation chain
  rotatedAt: text("rotated_at"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});
```

#### 7.5.2 Compliance Documents

```typescript
export const documentTypeEnum = [
  "passport",
  "national_id",
  "drivers_license",
  "residence_permit",
  "utility_bill",
  "bank_statement",
  "employment_letter",
  "tax_return",
  "sof_declaration",    // Source of Funds
  "sow_declaration",    // Source of Wealth
  "other",
] as const;

export const complianceDocuments = sqliteTable("compliance_documents", {
  id: text("id").primaryKey(),
  relationshipId: text("relationship_id").notNull()
    .references(() => complianceRelationships.id, { onDelete: "cascade" }),
  encryptionKeyId: text("encryption_key_id").notNull()
    .references(() => rpEncryptionKeys.id),
  // Document classification
  documentType: text("document_type", { enum: documentTypeEnum }).notNull(),
  documentPurpose: text("document_purpose", {
    enum: ["identity", "address_proof", "sof", "sow", "other"]
  }).notNull().default("identity"),
  // Encrypted content (X25519-ECDH + AES-256-GCM)
  encryptedContent: blob("encrypted_content", { mode: "buffer" }).notNull(),
  ephemeralPublicKey: text("ephemeral_public_key").notNull(),
  nonce: text("nonce").notNull(),
  // Integrity
  contentHash: text("content_hash").notNull(), // SHA-256 of plaintext
  contentSize: integer("content_size").notNull(),
  mimeType: text("mime_type"),
  // Retention (inherited from relationship)
  retentionExpiresAt: text("retention_expires_at").notNull(),
  deletedAt: text("deleted_at"), // Soft delete
  uploadedAt: text("uploaded_at").notNull().default(sql`(datetime('now'))`),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index("idx_compliance_documents_relationship").on(table.relationshipId),
  index("idx_compliance_documents_type").on(table.documentType),
  index("idx_compliance_documents_retention").on(table.retentionExpiresAt),
]);
```

#### 7.5.3 Compliance Relationships (Retention Tracking)

This table tracks the user-RP relationship lifecycle for retention management:

```typescript
export const complianceRelationships = sqliteTable("compliance_relationships", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  clientId: text("client_id").notNull()
    .references(() => oauthClients.clientId, { onDelete: "cascade" }),
  // Relationship lifecycle
  status: text("status", {
    enum: ["active", "revoked", "expired", "deleted"]
  }).notNull().default("active"),
  // Consent tracking (which field groups were consented)
  consentedScopes: text("consented_scopes", { mode: "json" }).notNull(), // ["compliance:identity.name", ...]
  consentedAt: text("consented_at").notNull(),
  revokedAt: text("revoked_at"),
  // Retention (5 years from relationship creation)
  retentionExpiresAt: text("retention_expires_at").notNull(),
  // Audit
  consentReceipt: text("consent_receipt").notNull(), // Signed JWT of consent
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex("idx_compliance_relationships_user_client").on(table.userId, table.clientId),
  index("idx_compliance_relationships_retention").on(table.retentionExpiresAt),
  index("idx_compliance_relationships_status").on(table.status),
]);
```

#### 7.5.4 Compliance Identity Data

This table stores per-field-group encrypted identity data. Each row represents one field group's encrypted data for a specific user-RP relationship:

```typescript
export const fieldGroupEnum = [
  "name",           // Full name only
  "dob",            // Date of birth only
  "address",        // Residential address
  "document",       // ID number, document type, issuer
  "nationality",    // Citizenship, country of residence
] as const;

export const complianceIdentityData = sqliteTable("compliance_identity_data", {
  id: text("id").primaryKey(),
  relationshipId: text("relationship_id").notNull()
    .references(() => complianceRelationships.id, { onDelete: "cascade" }),
  encryptionKeyId: text("encryption_key_id").notNull()
    .references(() => rpEncryptionKeys.id),
  // Field group this record contains
  fieldGroup: text("field_group", { enum: fieldGroupEnum }).notNull(),
  // Encrypted content (one field group per record for granular consent)
  encryptedPayload: blob("encrypted_payload", { mode: "buffer" }).notNull(),
  ephemeralPublicKey: text("ephemeral_public_key").notNull(),
  nonce: text("nonce").notNull(),
  // Integrity
  payloadHash: text("payload_hash").notNull(), // SHA-256 of plaintext
  // Retention (inherited from relationship)
  retentionExpiresAt: text("retention_expires_at").notNull(),
  deletedAt: text("deleted_at"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index("idx_compliance_identity_relationship").on(table.relationshipId),
  index("idx_compliance_identity_field_group").on(table.fieldGroup),
  uniqueIndex("idx_compliance_identity_relationship_field").on(table.relationshipId, table.fieldGroup),
]);
```

**Design Note**: Using per-field-group rows (vs a single encrypted blob with `includes_*` flags) enables:

- True granular consent: user can share name but not DOB
- Incremental disclosure: user can add address later without re-encrypting everything
- Selective deletion: if regulations change, specific fields can be purged
- Query efficiency: RP can check what fields exist without decrypting

#### 7.5.4 Screening Audit Records

```typescript
export const screeningAuditRecords = sqliteTable("screening_audit_records", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  screeningType: text("screening_type", {
    enum: ["pep", "sanctions", "adverse_media", "criminal"]
  }).notNull(),
  // Screening input (needed for re-screening)
  screenedName: text("screened_name").notNull(),
  screenedDob: text("screened_dob"),
  screenedCountry: text("screened_country"),
  // Execution
  provider: text("provider").notNull(),
  listsChecked: text("lists_checked", { mode: "json" }).notNull(),
  screenedAt: text("screened_at").notNull(),
  // Results
  overallResult: text("overall_result", {
    enum: ["clear", "potential_match", "confirmed_match"]
  }).notNull(),
  matchScore: real("match_score"),
  potentialMatches: text("potential_matches", { mode: "json" }),
  // Remediation
  remediationStatus: text("remediation_status", {
    enum: ["pending", "cleared", "confirmed", "escalated"]
  }),
  remediationNotes: text("remediation_notes"),
  remediatedBy: text("remediated_by"),
  remediatedAt: text("remediated_at"),
  // Attestation
  signedClaim: text("signed_claim").notNull(),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});
```

---

## 8. Implementation Considerations

### 8.1 Immediate Security Fix: Null Plaintext DOB After FHE Encryption

**Decision**: Implement Option A — null out `dobDays` immediately after FHE encryption completes.

The `dobDays` column in `identityVerificationDrafts` stores full date of birth as a plaintext integer. This is a critical privacy leak that must be addressed as the **first implementation priority**.

Additional guardrails:

- Ensure `dobDays` is never written to logs, analytics, or error reporting.
- Ensure any signed claims only contain commitments/claim hashes, not plaintext DOB encodings.

**Implementation Steps**:

1. **Modify FHE encryption completion handler** to null out `dobDays`:

   ```typescript
   // After FHE ciphertext stored successfully
   await db.update(identityVerificationDrafts)
     .set({ dobDays: null })
     .where(eq(identityVerificationDrafts.id, draftId));
   ```

2. **Client-side caching**: Client caches `dobDays` from `prepareDocument` response in sessionStorage for ZK proof generation (30-minute TTL).

3. **Cleanup job**: Daily background job nulls `dobDays` on drafts older than 24 hours (abandoned verifications).

4. **Audit logging**: Log when `dobDays` is cleared (without the value) for compliance trail.

See **Section 9.5** for detailed analysis of this decision.

### 8.2 Migration Path

```text
PHASE 1: Security Fix
├─► Audit dobDays usage in codebase
├─► Modify FHE encryption to run immediately after OCR
├─► Remove dobDays column from schema
└─► Database migration

PHASE 2: RP Key Management
├─► Add rp_encryption_keys table
├─► Add OAuth client key registration endpoint
├─► Implement key rotation flow
└─► Add compliance scopes to OAuth

PHASE 3: Compliance Storage
├─► Add compliance_documents table
├─► Add compliance_identity_data table
├─► Implement client-side X25519 encryption
├─► Add consent UI for compliance scopes
└─► Add RP retrieval API

PHASE 4: Enhanced Screening
├─► Add screening_audit_records table
├─► Update PEP/sanctions flow for full audit
└─► Add remediation workflow

PHASE 5: TEE Migration (Future)
├─► AWS Nitro Enclave infrastructure
├─► Move OCR to TEE
└─► TEE attestation for compliance data
```

### 8.3 Key Files to Modify

| Category | File | Change |
|----------|------|--------|
| Schema | `apps/web/src/lib/db/schema/identity.ts` | Remove `dobDays` column |
| Schema | `apps/web/src/lib/db/schema/compliance.ts` | New file with compliance tables |
| Query | `apps/web/src/lib/db/queries/compliance.ts` | New file for compliance queries |
| Privacy | `apps/web/src/lib/privacy/fhe/encryption.ts` | Encrypt DOB immediately |
| Privacy | `apps/web/src/lib/privacy/compliance/rp-encryption.ts` | New X25519 encryption |
| OAuth | `apps/web/src/lib/auth/oauth/scopes.ts` | Add compliance scopes |
| Router | `apps/web/src/lib/trpc/routers/compliance.ts` | New compliance router |

---

## 9. Design Decisions

This section documents the key architectural decisions made for the dual-track compliance storage system.

### 9.1 Consent Granularity: Field Groups with Granular Control

**Decision**: Users consent to **field groups** rather than all-or-nothing, enabling granular control without overwhelming UX.

**Rationale**:

Regulatory requirements vary by jurisdiction and RP type. A European bank under AMLD6 needs different data than a US crypto exchange under FinCEN CIP. Forcing all-or-nothing consent would either:

- Over-collect data (privacy violation) when an RP only needs partial data
- Under-collect data (compliance failure) if users reject due to perceived overreach

**Field Group Definition**:

| Group | Fields Included | Use Case | OAuth Scope |
|-------|-----------------|----------|-------------|
| **Core Identity** | Full name | All regulated RPs | `compliance:identity.name` |
| **Date of Birth** | Full DOB (not just year) | Age-gated services, CIP requirement | `compliance:identity.dob` |
| **Address** | Full residential address | Geographic compliance, CIP | `compliance:identity.address` |
| **Government ID** | ID number, document type, issuer | Document verification audit | `compliance:identity.document` |
| **Nationality** | Citizenship, country of residence | Sanctions screening, tax residency | `compliance:identity.nationality` |
| **Documents** | ID document image copy | KYC audit trail | `compliance:documents` |
| **Biometrics** | Face template (IAL3 only) | High-assurance re-verification | `compliance:biometrics` |
| **Screening** | PEP/sanctions results | AML compliance | `compliance:screening` |

**Consent UI Flow**:

```text
┌────────────────────────────────────────────────────────────────┐
│  [RP Name] requests access to verify your identity             │
│                                                                │
│  Required for service:                                         │
│  ┌────────────────────────────────────────────────────────┐   │
│  │ ☑ Core Identity (Full name)                            │   │
│  │ ☑ Date of Birth                                        │   │
│  │ ☑ Government ID Number                                 │   │
│  └────────────────────────────────────────────────────────┘   │
│                                                                │
│  Optional (enhances your experience):                          │
│  ┌────────────────────────────────────────────────────────┐   │
│  │ ☐ Residential Address                                  │   │
│  │ ☐ Document Image Copy                                  │   │
│  └────────────────────────────────────────────────────────┘   │
│                                                                │
│  ⓘ This data will be encrypted so only [RP Name] can read it. │
│    Zentity cannot access your information.                     │
│    Data retained for 5 years per [regulation].                 │
│                                                                │
│  [Deny All]                              [Allow Selected]      │
└────────────────────────────────────────────────────────────────┘
```

**Schema Implications**:

The `complianceIdentityData` table uses `includes_*` boolean flags to track which fields were consented and encrypted. This enables:

- RPs to request only what they need
- Users to see exactly what was shared
- Audit trail of consent decisions

**OAuth Scope Hierarchy**:

```text
compliance:identity          → All identity fields (convenience scope)
├── compliance:identity.name
├── compliance:identity.dob
├── compliance:identity.address
├── compliance:identity.document
└── compliance:identity.nationality

compliance:documents         → Document images
compliance:biometrics        → Face templates (IAL3)
compliance:screening         → PEP/sanctions results
```

---

### 9.2 Retention Trigger: User-RP Relationship Creation

**Decision**: The 5-year retention clock starts when the **user-RP relationship is created** (i.e., when the user first grants compliance consent to that RP).

**Rationale**:

Three options were considered:

| Trigger | Pros | Cons |
|---------|------|------|
| **Document upload** | Simple, deterministic | Multiple RPs share same expiry; early expiry if user verifies but never uses RP |
| **First RP access** | Aligns with "relationship" concept | Complex tracking; what counts as "access"? |
| **Relationship creation** | Matches regulatory intent; per-RP expiry | Requires explicit relationship tracking |

Regulatory frameworks (AMLD6, BSA) specify retention "from the end of the business relationship." The relationship begins when the obliged entity (RP) obtains customer data for CDD purposes. This maps to the moment of **consent grant** in our OAuth flow.

**Implementation**:

```typescript
// On OAuth consent grant with compliance scopes
const retentionExpiresAt = new Date();
retentionExpiresAt.setFullYear(retentionExpiresAt.getFullYear() + 5);

// Store in compliance tables
await db.insert(complianceIdentityData).values({
  userId,
  clientId,
  retentionExpiresAt: retentionExpiresAt.toISOString(),
  // ... encrypted fields
});
```

**Relationship Lifecycle Events**:

| Event | Retention Impact |
|-------|------------------|
| User grants consent | Clock starts (5 years from now) |
| User revokes consent | Clock continues (regulatory requirement) |
| User deletes account | Data retained until expiry (audit trail) |
| RP requests deletion | Data retained until expiry (regulatory override) |
| 5-year expiry reached | Automatic purge (soft delete → hard delete after 30 days) |

**Edge Case: Re-verification**:

If a user re-verifies with the same RP (e.g., document expired), the retention clock does NOT reset. The original relationship date governs. New documents are added with the existing `retentionExpiresAt`.

---

### 9.3 Multi-RP Compliance: Per-RP Encrypted Copies

**Decision**: Each regulated RP receives their **own independently encrypted copy** of compliance data, encrypted to their unique X25519 public key.

**Rationale**:

Three approaches were considered:

| Approach | Description | Pros | Cons |
|----------|-------------|------|------|
| **Shared key** | All RPs share a common encryption key | Storage efficient | Key compromise affects all RPs; complex key management |
| **Re-encryption proxy** | Zentity re-encrypts on-demand | Single storage; flexible access | Zentity becomes trusted intermediary (violates core principle) |
| **Per-RP copies** | Each RP gets dedicated encrypted copy | True zero-knowledge for Zentity; RP key isolation | Storage overhead; client encryption work |

Per-RP copies are the only approach that maintains our **core security property**: Zentity cannot decrypt compliance data. If we used a shared key, Zentity would need to manage that key. If we used re-encryption, Zentity would see plaintext during re-encryption.

**Storage Analysis**:

For a typical user with 1 document (2MB) and identity fields (~1KB), storage per RP is ~2MB. For 100,000 users × 5 RPs = ~1TB total. This is manageable and the privacy/security benefits outweigh storage costs.

**Client-Side Encryption Flow**:

```text
User verifies identity (one-time)
        ↓
User authorizes RP-A (regulated bank)
        ↓
Client fetches RP-A's public key from Zentity
        ↓
Client encrypts identity + documents to RP-A's key
        ↓
Client uploads encrypted blobs to Zentity
        ↓
Zentity stores {userId, clientId: "RP-A", encryptedBlob}
        ↓
[Later] User authorizes RP-B (crypto exchange)
        ↓
Client fetches RP-B's public key from Zentity
        ↓
Client encrypts identity + documents to RP-B's key
        ↓
Client uploads encrypted blobs to Zentity
        ↓
Zentity stores {userId, clientId: "RP-B", encryptedBlob}
```

**Key Isolation Guarantee**:

- RP-A's compromise does not affect RP-B's data
- Zentity breach reveals only ciphertexts (no keys)
- User can revoke individual RP access by requesting deletion (after retention)

**Schema Support**:

The `(userId, clientId)` composite key in `complianceIdentityData` enables per-RP storage:

```sql
-- Each RP has independent encrypted copy
UNIQUE INDEX idx_compliance_identity_user_client ON compliance_identity_data(user_id, client_id)
```

---

### 9.4 Post-Quantum Strategy: X25519 Now, ML-KEM Migration Path

**Decision**: Implement **X25519 only** for initial release, with a clear **migration path to hybrid X25519 + ML-KEM-768**.

**Rationale**:

The threat model for post-quantum (PQ) attacks is "harvest now, decrypt later" (HNDL). An adversary captures encrypted traffic/data today and waits for quantum computers capable of breaking ECDH. For 5-year document retention, this is a real concern.

However, practical constraints favor a phased approach:

| Factor | X25519 Only | Hybrid X25519 + ML-KEM |
|--------|-------------|------------------------|
| **Library maturity** | Excellent (noble-curves, WebCrypto) | Emerging (liboqs, ml-kem npm) |
| **Browser support** | Native WebCrypto | Requires WASM/JS polyfill |
| **Ciphertext size** | 32 bytes (pubkey) + 16 bytes (tag) | 1088 bytes (ML-KEM-768 ciphertext) |
| **Key size** | 32 bytes | 1184 bytes (public key) |
| **Performance** | ~1ms keygen/encap | ~10ms keygen/encap (JS) |
| **Standardization** | RFC 7748 | NIST FIPS 203 (August 2024) |

**Timeline Assessment**:

- **2024-2026**: Cryptographically relevant quantum computers (CRQC) remain theoretical
- **2026-2029**: NIST PQC algorithms stabilize; browser native support likely
- **2029+**: CRQC emergence possible; hybrid encryption becomes essential

For documents uploaded in 2026 with 5-year retention (expiry 2031), the risk window is the last 2 years. A migration to hybrid encryption by 2028 would protect all data.

**Migration Path**:

```text
PHASE 1 (Now): X25519 Only
├─► keyAlgorithm = "x25519"
├─► 32-byte ephemeral public keys
└─► Standard ECIES construction

PHASE 2 (2027-2028): Hybrid Support
├─► Add keyAlgorithm = "x25519-ml-kem"
├─► RPs register hybrid public keys (X25519 || ML-KEM-768)
├─► Client encrypts with dual encapsulation
├─► Both encapsulated secrets fed to HKDF
└─► Existing X25519-only data remains valid

PHASE 3 (2028+): X25519 Deprecation
├─► New RP registrations require hybrid keys
├─► Existing RPs prompted to rotate to hybrid
└─► X25519-only data re-encrypted on user login (opportunistic)
```

**Schema Support**:

The `keyAlgorithm` field in `rpEncryptionKeys` already supports this:

```typescript
keyAlgorithm: text("key_algorithm", { enum: ["x25519", "x25519-ml-kem"] })
  .notNull().default("x25519"),
```

**Dual Encapsulation Construction** (for Phase 2):

```text
shared_secret = HKDF(
  ikm: X25519_shared_secret || ML-KEM_shared_secret,
  salt: ephemeral_x25519_pubkey || ml_kem_ciphertext,
  info: "zentity:compliance:hybrid"
) → AES-256-GCM key
```

---

### 9.5 Plaintext DOB Cleanup: Null After FHE Encryption

**Decision**: Implement **Option A** — null out `dobDays` in `identityVerificationDrafts` immediately after FHE encryption completes.

**Rationale**:

The `dobDays` field currently stores the user's full date of birth as a plaintext integer (days since 1900-01-01). This creates a critical privacy leak:

| Risk | Severity | Impact |
|------|----------|--------|
| Database breach | HIGH | Full DOB of all users exposed |
| Insider access | MEDIUM | Ops/admins can query plaintext DOB |
| Compliance violation | HIGH | GDPR/CCPA data minimization failure |
| Forensic recovery | MEDIUM | Deleted records may be recoverable |

**Why Option A (Null After FHE) is Preferred**:

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| **A: Null after FHE** | Clear `dobDays` once FHE ciphertext stored | Simple; no client changes; preserves existing flow | Brief window where plaintext exists |
| **B: Never store** | Client keeps DOB locally; never sends to server | Maximum privacy | Requires client-side OCR or TEE; major architecture change |

Option A is pragmatic because:

1. **FHE encryption is already scheduled** after OCR — we just need to add a cleanup step
2. **Client already has DOB** from OCR response — it can cache locally for ZK proofs
3. **The exposure window is minutes**, not days — acceptable for initial implementation

**Implementation Details**:

```typescript
// In scheduleFheEncryption() - after successful encryption
await db
  .update(identityVerificationDrafts)
  .set({
    dobDays: null,  // Clear plaintext DOB
    updatedAt: sql`datetime('now')`,
  })
  .where(eq(identityVerificationDrafts.id, draftId))
  .run();
```

**Client Caching for ZK Proofs**:

The client already receives `dobDays` in the `prepareDocument` response. It should cache this locally (sessionStorage or IndexedDB) for subsequent ZK proof generation:

```typescript
// Client-side cache during verification session
const draftCache = new Map<string, { dobDays: number; expiresAt: number }>();

// On prepareDocument response
draftCache.set(draftId, {
  dobDays: response.dobDays,
  expiresAt: Date.now() + 30 * 60 * 1000, // 30 minutes
});

// On ZK proof generation
const cached = draftCache.get(draftId);
if (!cached || cached.expiresAt < Date.now()) {
  throw new Error("Session expired - please re-scan document");
}
const { dobDays } = cached;
```

**Cleanup Job for Abandoned Verifications**:

Some users may abandon verification after OCR but before FHE encryption. A background job should clean these up:

```typescript
// Run daily: delete drafts older than 24 hours with non-null dobDays
await db
  .update(identityVerificationDrafts)
  .set({ dobDays: null })
  .where(
    and(
      isNotNull(identityVerificationDrafts.dobDays),
      lt(identityVerificationDrafts.updatedAt, dayAgo)
    )
  )
  .run();
```

**Audit Trail**:

For regulatory compliance, we log (without the value) when `dobDays` is cleared:

```typescript
await createAuditLog({
  userId,
  action: "dob_days_cleared",
  reason: "fhe_encryption_complete",
  draftId,
  timestamp: new Date().toISOString(),
});
```

---

### 9.6 Remaining Open Questions

The following questions remain for future consideration:

1. **RP Key Escrow**: Should there be a mechanism for RP key recovery (e.g., HSM escrow) to prevent compliance data loss if RP loses private key? This is an RP operational concern, not a Zentity architectural decision.

2. **TEE Migration Timeline**: When should TEE-based OCR be prioritized? This depends on regulated RP onboarding demand and infrastructure investment.

3. **Consent Revocation UX**: How should users visualize and manage their compliance data across multiple RPs? Dashboard design needed.

4. **Cross-Border Data Transfer**: How do we handle GDPR data localization requirements when user is in EU but RP is in US? May require regional storage.

---

## 10. References

### Internal RFCs

- [RFC-0016: OIDC4VCI/VP](./0016-oidc-vc-issuance-and-presentation.md) — Current VC issuance design
- [RFC-0018: Pure SSI - DIDs, BBS+, AnonCreds](./0018-pure-ssi-did-bbs-anoncreds.md) — Unlinkability roadmap
- [ZK Proof Gateway Research](../research/zk-proof-gateway-research.md) — TEE-based proving research

### OAuth & OpenID Specifications

- [OAuth 2.1 Specification](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-09)
- [OpenID for Verifiable Credential Issuance 1.0](https://openid.net/specs/openid-4-verifiable-credential-issuance-1_0.html)
- [OpenID for Verifiable Presentations 1.0](https://openid.net/specs/openid-4-verifiable-presentations-1_0.html)
- [OpenID4VC High Assurance Interoperability Profile (HAIP)](https://openid.net/specs/openid4vc-high-assurance-interoperability-profile-1_0-final.html)
- [SD-JWT VC Specification](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-sd-jwt-vc)

### eIDAS 2.0 & EUDI

- [Regulation (EU) 2024/1183 (eIDAS 2.0)](https://eur-lex.europa.eu/eli/reg/2024/1183/oj/eng) — European Digital Identity Framework
- [EUDI Wallet Architecture Reference Framework (ARF)](https://github.com/eu-digital-identity-wallet/eudi-doc-architecture-and-reference-framework)
- [ETSI TR 119 476](https://www.etsi.org/deliver/etsi_tr/119400_119499/119476/) — Privacy-preserving ZKP properties
- [CIR 2024/2982](https://eur-lex.europa.eu/eli/reg_impl/2024/2982/oj) — EUDI Protocols and Interfaces

### Credential Formats & Signatures

- [W3C VC Data Model 2.0](https://www.w3.org/TR/vc-data-model-2.0/)
- [W3C VC Data Integrity BBS](https://www.w3.org/TR/vc-di-bbs/) — BBS+ signatures for unlinkability
- [ISO/IEC 18013-5](https://www.iso.org/standard/69084.html) — Mobile driving licence (mdoc)

### Regulatory

- [5AMLD/6AMLD Document Retention Requirements](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32018L0843)
- [Regulation (EU) 2024/1624 (AMLR)](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R1624) — Anti-Money Laundering Regulation

### Cryptography

- [NIST Post-Quantum Cryptography Standards](https://csrc.nist.gov/Projects/post-quantum-cryptography)

---

## Appendix A: Current vs Proposed Data Flow

```text
CURRENT FLOW (Privacy-First Only)
═════════════════════════════════
User → Document → OCR → Extract fields → Store commitments
                                      → FHE encrypt (delayed)
                                      → Discard document
                      ↓
              Client generates ZK proofs
                      ↓
              RP receives verification flags only


PROPOSED FLOW (Dual-Track)
══════════════════════════
User → Document → OCR → Extract fields → Store commitments
                    │                 → FHE encrypt (immediate)
                    │
                    └─► [If regulated RP + consent]
                        Client encrypts document to RP key
                        Zentity stores encrypted blob
                        RP can retrieve and decrypt
```

## Appendix B: Compliance Scope Matrix

### B.1 Base Scopes (All RPs)

| Scope | Data Access | Encryption | Retention |
|-------|-------------|------------|-----------|
| `openid` | Subject identifier | None | Session |
| `profile` | Display name, avatar | None | User-controlled |
| `proof:identity` | SD-JWT VC (derived claims only) | Holder-controlled | User-controlled |

### B.2 Compliance Scopes (Regulated RPs Only)

#### Identity Field Groups

| Scope | Fields Included | Encryption | Retention |
|-------|-----------------|------------|-----------|
| `compliance:identity` | All identity fields (convenience) | RP X25519 | 5 years |
| `compliance:identity.name` | Full legal name | RP X25519 | 5 years |
| `compliance:identity.dob` | Full date of birth | RP X25519 | 5 years |
| `compliance:identity.address` | Residential address | RP X25519 | 5 years |
| `compliance:identity.document` | ID number, doc type, issuer | RP X25519 | 5 years |
| `compliance:identity.nationality` | Citizenship, country of residence | RP X25519 | 5 years |

#### Documents

| Scope | Document Types | Encryption | Retention |
|-------|----------------|------------|-----------|
| `compliance:documents` | All document types (convenience) | RP X25519 | 5 years |
| `compliance:documents.identity` | Passport, ID card, license | RP X25519 | 5 years |
| `compliance:documents.address` | Utility bills, bank statements | RP X25519 | 5 years |
| `compliance:documents.sof` | Source of Funds declarations | RP X25519 | 5 years |
| `compliance:documents.sow` | Source of Wealth declarations | RP X25519 | 5 years |

#### Other Compliance Data

| Scope | Data Access | Encryption | Retention |
|-------|-------------|------------|-----------|
| `compliance:screening` | PEP/sanctions results + audit | Server-signed | 5 years |
| `compliance:biometrics` | Face template (IAL3 only) | RP X25519 | 5 years |

### B.3 Scope Hierarchy

```text
compliance:identity          → Expands to all identity.* scopes
├── compliance:identity.name
├── compliance:identity.dob
├── compliance:identity.address
├── compliance:identity.document
└── compliance:identity.nationality

compliance:documents         → Expands to all documents.* scopes
├── compliance:documents.identity
├── compliance:documents.address
├── compliance:documents.sof
└── compliance:documents.sow

compliance:screening         → No sub-scopes (atomic)
compliance:biometrics        → No sub-scopes (atomic)
```

### B.4 Typical RP Scope Requests

| RP Type | Typical Scopes |
|---------|----------------|
| **EU Bank (AMLD6)** | `compliance:identity compliance:documents compliance:screening` |
| **US Exchange (FinCEN CIP)** | `compliance:identity.name compliance:identity.dob compliance:identity.address compliance:identity.document compliance:documents.identity` |
| **Crypto Wallet (Travel Rule)** | `compliance:identity.name compliance:identity.address` |
| **High-Value Service (IAL3)** | `compliance:identity compliance:documents compliance:biometrics` |

## Appendix C: Key Files Reference (Current Implementation)

Vault & credentials:

- `apps/web/src/lib/crypto/passkey-vault.ts`
- `apps/web/src/lib/crypto/fhe-key-store.ts`
- `apps/web/src/lib/db/schema/crypto.ts`

Identity verification:

- `apps/web/src/server/routers/identity.ts`
- `apps/web/src/server/routers/zk.ts`
- `apps/ocr/app/` (OCR service)

Database schema:

- `apps/web/src/lib/db/schema/` (Drizzle schema source of truth)

FHE service:

- `apps/fhe/src/`

## Appendix D: Current Verification Sub-Flows (Implementation Snapshot)

This appendix captures the current “what happens where” flow (as implemented today), focusing on what is **transient** vs what gets persisted.

### D.1 Document OCR + Derived Values

```text
User uploads image (base64)
        ↓
OCR service (apps/ocr) processes transiently
        ↓
Extracted fields (typical):
  - full name
  - date of birth
  - document number
  - nationality code
  - expiration date
        ↓
Derivations (server-side):
  - dobDays: days since 1900-01-01 (UTC)
  - expiryDateInt: YYYYMMDD integer
  - nationalityCodeNumeric: numeric code for circuits
  - documentHashField: field element derived from document hash
  - claim hashes (Poseidon2): age / doc validity / nationality
        ↓
Persist to draft + document tables:
  - commitments + claim hashes + metadata
  - (currently) dobDays is persisted and must be nulled post-FHE encryption
        ↓
Images are discarded (not stored)
```

Primary implementation references:

- `apps/web/src/lib/identity/document/process-document.ts` (date parsing and claim hash computation)
- `apps/web/src/lib/trpc/routers/identity/prepare-document.ts` (persisting into drafts)

### D.2 Liveness Verification

```text
Client streams frames (WebSocket)
        ↓
Server runs Human.js detection transiently
        ↓
Derive metrics (scores + pass/fail)
        ↓
Persist metrics to identity_verification_drafts
        ↓
Frames are discarded (not stored)
```

Primary implementation references:

- `apps/web/src/lib/identity/liveness/human-server.ts`
- `apps/web/src/app/api/trpc/[trpc]/route.ts` (Node runtime requirement for tfjs-node / Human.js)

### D.3 Face Match

```text
Client submits selfie + document reference
        ↓
Server derives embeddings transiently and computes similarity score
        ↓
Persist score + pass/fail to identity_verification_drafts
        ↓
Images and embeddings are discarded (not stored)
```

### D.4 ZK Proof Generation (Client-Side)

```text
Client retrieves draft-derived values needed for proving
        ↓
Noir prover runs in a worker
        ↓
Server receives only:
  - proof payload
  - public inputs
        ↓
Persist proof metadata + payload to zk_proofs
```

Primary implementation references:

- `apps/web/src/lib/privacy/zk/noir-prover.worker.ts`
- `apps/web/src/lib/db/schema/crypto.ts` (`zk_proofs`)

### D.5 FHE Encryption Finalization

```text
Finalize job reads draft-derived values
        ↓
Call FHE service (apps/fhe) to encrypt attributes to user keys
        ↓
Persist ciphertexts to encrypted_attributes
        ↓
Mark identity bundle FHE status complete
        ↓
Clear plaintext DOB (dobDays) from drafts
```

Primary implementation references:

- `apps/web/src/lib/db/schema/crypto.ts` (`encrypted_attributes`)
- `apps/web/src/lib/db/schema/identity.ts` (`identity_bundles`, `identity_verification_drafts`)

### D.6 Known Logging Footgun (Must Fix)

If claim hash computation fails, some current error logs include derived numeric values (e.g., `dobDays`, `expiryDateInt`, `nationalityCodeNumeric`). This RFC’s “no plaintext DOB in logs” guardrail requires removing those values from logs.

Primary implementation reference:

- `apps/web/src/lib/identity/document/process-document.ts`

## Appendix E: Current Storage Classification (Implementation Snapshot)

This table is a “privacy accounting” view of what exists today.

| Data Element | Where It Lives | Cryptographic Treatment | Who Can Read It | Notes |
|-------------|----------------|-------------------------|-----------------|-------|
| Full document image | Not stored | N/A | N/A | Discarded after OCR |
| Liveness frames | Not stored | N/A | N/A | Discarded after scoring |
| Face embeddings | Not stored | N/A | N/A | Derived transiently |
| Plaintext DOB (`dobDays`) | `identity_verification_drafts.dob_days` | None | Anyone with DB access | Must be nulled after FHE encryption |
| DOB commitment | `identity_bundles.dob_commitment` | SHA-256 commitment | Irreversible | Safe to persist |
| Document hash | `identity_documents.document_hash`, `identity_verification_drafts.document_hash` | SHA-256 commitment | Irreversible | Used for de-duplication |
| Name commitment | `identity_documents.name_commitment`, `identity_verification_drafts.name_commitment` | SHA-256 commitment | Irreversible | No full name stored |
| Claim hashes (age/doc validity/nationality) | `identity_verification_drafts.*_claim_hash` | Poseidon2 hash | Irreversible | Used as public “claim anchors” for proving |
| Liveness/face match scores | `identity_verification_drafts.*` | Plaintext numeric | Anyone with DB access | Consider minimization/rounding policy |
| Signed claims | `signed_claims` | Server signature | Anyone can verify; server can read | Should avoid embedding reversible PII |
| ZK proofs | `zk_proofs` | ZK payload + metadata | Anyone with DB access | No private inputs included |
| Encrypted attributes | `encrypted_attributes.ciphertext` | TFHE ciphertext | User (with FHE client key) | Server stores opaque ciphertext |
| Encrypted secrets (payload) | `encrypted_secrets.encrypted_blob` | AES-GCM (DEK) | User (via KEK unwrap) | Secret payload is DEK-encrypted |
| Secret wrappers (DEK) | `secret_wrappers.wrapped_dek` | AES-GCM (KEK) | User (via credential-derived KEK) | Multiple wrappers per user/secret |
| Secret blob files | `.data/secret-blobs/*.bin` (via `encrypted_secrets.blob_ref`) | Encrypted payload bytes | Depends on above | Implementation detail; treat as server-stored ciphertext |

Implementation references:

- `apps/web/src/lib/db/schema/identity.ts`
- `apps/web/src/lib/db/schema/crypto.ts`
- `apps/web/src/lib/privacy/secrets/storage.server.ts`

## Appendix F: What Can Be ZK-Proven (No Storage Needed)

These are examples of “Track A friendly” proofs where we can avoid retaining reversible identity data:

| Use Case | Proof Type | Notes |
|----------|-----------|------|
| Age gating | `age_verification` | Prove age ≥ threshold from DOB without disclosing DOB |
| Nationality membership | `nationality_membership` | Prove nationality is in an allowlist |
| Document validity | `doc_validity` | Prove document is not expired |
| Face match | `face_match` | Prove selfie matches document photo above threshold |
| Jurisdiction checks (planned) | `address_jurisdiction` (not active) | Historical/proposed circuit for country/region membership without full address |
