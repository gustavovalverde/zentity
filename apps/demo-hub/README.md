# Zentity Demo Hub

An interactive demonstration of privacy-preserving identity verification using OIDC4VCI/VP (OpenID for Verifiable Credentials). This demo shows how users can prove their identity without exposing sensitive personal data.

## The Problem This Solves

Traditional KYC requires sharing sensitive documents that create liability:

- **Exchanges** store passport copies, becoming breach targets
- **Banks** hold PII databases, risking massive fines
- **Users** lose control over their data once shared

This demo shows a better way: **verify everything, reveal nothing**.

## Quick Start

```bash
# From the monorepo root
pnpm dev:stack

# Or run from this directory
pnpm exec tsx scripts/start-demo-stack.ts
```

Open <http://localhost:3100> and choose a scenario.

## Architecture

```text
┌────────────────────────────────────────────────────────────────────────┐
│                           DEMO ECOSYSTEM                               │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│   ┌──────────────┐     ┌──────────────┐     ┌──────────────┐           │
│   │  Zentity Web │     │   Demo Hub   │     │ Demo Wallet  │           │
│   │  (Issuer +   │     │ (Orchestrator│     │   (Holder)   │           │
│   │   Verifier)  │     │   + Verifier)│     │              │           │
│   │  port 3000   │     │  port 3100   │     │  port 3101   │           │
│   └──────┬───────┘     └──────┬───────┘     └──────┬───────┘           │
│          │                    │                    │                   │
│          │ 1. Issue           │ 2. Create         │ 3. Store           │
│          │    credential      │    offer          │    credential      │
│          │◄───────────────────┤                   │◄───────────────────┤
│          │                    │                   │                    │
│          │ 4. Verify          │ 5. Create         │ 6. Present         │
│          │    presentation    │    request        │    with SD         │
│          │◄───────────────────┤                   │◄───────────────────┤
│          │                    │                   │                    │
└────────────────────────────────────────────────────────────────────────┘
```

## The Three Roles

| Role | What They Do | In This Demo |
|------|--------------|--------------|
| **Issuer** | Verifies identity, issues credentials | Zentity Web (port 3000) |
| **Holder** | Stores credentials, controls disclosure | Demo Wallet (port 3101) |
| **Verifier** | Requests and validates presentations | Demo Hub (port 3100) |

### How They Interact

1. **Issuer** verifies a user's identity (document + liveness + FHE checks)
2. **Issuer** creates a verifiable credential with derived claims (no raw PII)
3. **Holder** receives the credential via OIDC4VCI pre-authorized flow
4. **Holder** stores the credential locally (browser localStorage in demo)
5. **Verifier** requests specific claims for a particular purpose
6. **Holder** selectively discloses only the requested claims
7. **Verifier** validates the presentation against issuer's authority

## Demo Scenarios

### Exchange KYC

**Business Context**: A crypto exchange must verify users for AML compliance before allowing trading.

**What's Required**:

| Claim | Why It's Needed |
|-------|-----------------|
| `verification_level` | Risk-based access control (basic vs full trading) |
| `verified` | Basic compliance gate |
| `document_verified` | Government ID was validated |
| `liveness_verified` | Real person present (anti-deepfake) |
| `age_proof_verified` | User is 18+ (ZK proof, no birthdate revealed) |
| `nationality_proof_verified` | Not from sanctioned country (ZK proof) |
| `face_match_verified` | Selfie matches document (ZK proof) |

**Value Delivered**:

- **Exchange**: Meets AML requirements without storing passport copies
- **User**: Doesn't share birthdate, just proves "over 18"
- **Regulators**: Cryptographic proof of compliance, audit-ready

### Bank Onboarding

**Business Context**: A bank must verify residency and identity for account opening.

**What's Required**:

| Claim | Why It's Needed |
|-------|-----------------|
| `verification_level` | High-assurance identity check |
| `verified` | Basic compliance gate |
| `document_verified` | Government ID was validated |
| `doc_validity_proof_verified` | Document not expired (ZK proof) |
| `age_proof_verified` | User is 18+ (ZK proof) |
| `nationality_proof_verified` | Residency jurisdiction check (ZK proof) |

**Value Delivered**:

- **Bank**: Meets regulatory requirements, no PII storage liability
- **User**: Doesn't share actual document expiry date or nationality
- **Regulators**: Verifiable proof of due diligence

## How Privacy is Preserved

### No PII in Credentials

The credential contains derived claims, not raw data:

```text
TRADITIONAL KYC                    ZENTITY CREDENTIAL
─────────────────                  ─────────────────────
Date of Birth: 1990-03-15    →     age_proof_verified: true
Passport: AB123456           →     document_verified: true
Nationality: USA             →     nationality_proof_verified: true
Face Photo: [blob]           →     face_match_verified: true
```

### Selective Disclosure (SD-JWT)

The wallet reveals only what the verifier needs:

```text
CREDENTIAL HAS               VERIFIER REQUESTS          WALLET REVEALS
────────────────             ─────────────────          ───────────────
verification_level     →     verification_level    →   verification_level
verified               →     verified              →   verified
document_verified      →     age_proof_verified    →   age_proof_verified
liveness_verified            nationality_proof
age_proof_verified
nationality_proof
face_match_verified
```

### Zero-Knowledge Proofs

Claims are proven without revealing underlying data:

- `age_proof_verified` proves birthdate >= threshold without revealing birthdate
- `nationality_proof_verified` proves country is in approved list without revealing which country
- `face_match_verified` proves selfie matches document without sharing either image

### FHE (Fully Homomorphic Encryption)

Sensitive computations happen on encrypted data:

- Age calculations on encrypted birth year
- Liveness score thresholds on encrypted scores
- Country code comparisons on encrypted values

## Step-by-Step Demo Guide

### Prerequisites

- Demo stack running (`pnpm dev:stack`)
- Browser at <http://localhost:3100>

### 1. Seed Demo Identity

Click **"Seed demo identity"** to create a verified user with full attestation. This simulates a user who has completed the full Zentity verification flow (document upload, liveness check, FHE proofs).

### 2. Create Credential Offer

Click **"Create offer"** to generate an OIDC4VCI pre-authorized credential offer. This is what an issuer sends to a wallet to initiate credential issuance.

### 3. Issue Credential (Wallet)

Click **"Open wallet to issue"** to open the demo wallet. Click **"Issue credential"** to exchange the offer for an SD-JWT Verifiable Credential. The wallet:

- Exchanges the pre-authorized code for an access token
- Generates a holder binding key pair
- Receives the SD-JWT credential with selective disclosure capability

### 4. Create Presentation Request

Back in Demo Hub, click **"Create request"**. This creates an OIDC4VP presentation request with the scenario's required claims.

### 5. Present Credential (Wallet)

Click **"Open wallet to present"**. In the wallet:

- Review which claims are requested
- Optionally adjust which claims to disclose
- Click **"Submit presentation"** to send selective disclosure response

### 6. Verify Result

Click **"Refresh"** in Demo Hub to see the verification result. The verifier validates:

- Issuer signature
- Holder binding
- Required claims present
- Status list check (credential not revoked)

## Value Propositions

### For Exchanges (Verifier)

| Traditional | With Zentity |
|-------------|--------------|
| Store passport copies | No PII stored |
| Breach liability | Breach-proof |
| Manual review | Automated cryptographic verification |
| Slow onboarding | Instant verification |

### For Users (Holder)

| Traditional | With Zentity |
|-------------|--------------|
| Share full documents | Share only derived claims |
| Data in central honeypot | Data stays in your wallet |
| No control after sharing | Selective disclosure each time |
| Re-verify for each service | Portable, reusable credentials |

### For Banks (Verifier)

| Traditional | With Zentity |
|-------------|--------------|
| GDPR/data protection risk | No PII to protect |
| Expensive compliance audits | Cryptographic audit trail |
| Manual document review | Automated validation |
| High fraud risk | ZK + FHE fraud prevention |

### For Regulators

| Traditional | With Zentity |
|-------------|--------------|
| Opaque compliance claims | Cryptographic proofs |
| Trust-based audit | Verifiable evidence packs |
| Mass data collection | Privacy-preserving oversight |
| High fraud rate | Liveness + ZK reduces fraud |

## Real-World Applications

### Trading Platform Onboarding

A user verified once can trade on any platform that accepts Zentity credentials, without re-uploading documents.

### Age-Gated Services

Prove "over 21" for alcohol delivery without revealing actual age.

### Employment Verification

Prove right-to-work status without sharing immigration documents.

### Healthcare

Prove insurance coverage without sharing medical history.

### Travel

Prove vaccination status without revealing health records.

## Technical Details

### Credential Format: SD-JWT VC

SD-JWT (Selective Disclosure JWT) allows the holder to choose which claims to reveal:

```text
eyJ0eXAiOiJzZC1qd3Qr...           # JWT header + payload (mandatory claims)
~eyJfc2QiOiJWZXJpZmllZCI...       # SD claim: verified
~eyJfc2QiOiJEb2N1bWVudCI...       # SD claim: document_verified
~eyJfc2QiOiJMaXZlbmVzcyI...       # SD claim: liveness_verified
```

### Protocols Used

- **OIDC4VCI**: OpenID for Verifiable Credential Issuance (credential delivery)
- **OIDC4VP**: OpenID for Verifiable Presentations (credential presentation)
- **SD-JWT**: Selective Disclosure JWT (privacy-preserving format)
- **OIDC4IDA**: OpenID for Identity Assurance (verified claims framework)

### ZK Circuits (Noir)

Proofs generated client-side using Barretenberg:

- `age_verification`: Prove age >= threshold
- `doc_validity`: Prove document not expired
- `nationality_membership`: Prove country in Merkle set
- `face_match`: Prove face similarity >= threshold

## Troubleshooting

### "Offer not found"

The offer expired or was already claimed. Create a new offer.

### "Seed failed"

Ensure DEMO_SEED_SECRET is configured and Zentity Web is running.

### "Missing pre-authorized code"

The credential offer is malformed. Check the issuer's OIDC4VCI endpoint.

### "Presentation failed"

Verify the wallet has a valid credential and the required claims are available.

## Related Documentation

- [OIDC4VCI/VP RFC](../web/docs/rfcs/0016-oidc-vc-issuance-and-presentation.md)
- [Attestation Architecture](../web/docs/attestation-privacy-architecture.md)
- [ZK Architecture](../web/docs/zk-architecture.md)

## License

See repository root for license information.
