# Tamper Model and Integrity Controls

> **Related docs:** [Attestation & Privacy Architecture](attestation-privacy-architecture.md) | [Architecture](architecture.md) | [Web3 Architecture](web3-architecture.md)
> **Purpose**: Define how we handle a hostile browser and ensure verification results are trustworthy while preserving privacy.

## Scope: Web2 vs Web3

This document covers integrity controls for both deployment modes:

| Aspect | Web2 (Off-chain) | Web3 (On-chain) |
|--------|------------------|-----------------|
| **Proof verification** | Backend (`apps/web/src/lib/zk/noir-verifier.ts`) | Backend for ZK proofs; on-chain InputVerifier for FHE inputs |
| **FHE inputs** | Server-derived + server-side encryption | FHEVM InputVerifier on-chain (wallet/registrar inputs) |
| **Nonce issuance** | `trpc.crypto.createChallenge` (ZK only) | Same ZK challenge flow (not used for attestation/transfer) |
| **Attestation authority** | SQLite records | IdentityRegistry contract |
| **Replay resistance** | Single-use nonces in DB (ZK proofs) | On-chain state + InputVerifier proofs |

**Key difference:** In Web3 mode, the blockchain enforces immutability and ACL permissions. In Web2 mode, the server is the sole authority.

## Threat Model

- The **browser is hostile**:
  - Users can modify UI code, API calls, and client-side logic.
  - Any value computed in the browser can be forged.
- The **server is trusted for integrity** but should minimize access to plaintext.
- The **blockchain** provides integrity, but inputs must be verifiable (proofs / signatures).

## Core Integrity Principles

1. **Never trust client claims** without cryptographic verification.
2. **All client-generated proofs must be verified server-side or on-chain.**
3. **Bind proofs to server nonces** to prevent replay attacks.
4. **Use server-signed claims** when a trusted measurement is required (e.g., liveness score).
5. **Persist an evidence pack** (`policy_hash` + `proof_set_hash`) for auditability.

## What the Browser Can Do (safely)

- Generate ZK proofs (private inputs remain in browser).
- Encrypt data for FHEVM and TFHE.
- Decrypt data that only the user should see.

## What the Browser Must NOT Be Trusted For

- Liveness score calculation.
- Face match score calculation.
- Document OCR extraction.
- Compliance decisions (age, nationality, sanctions).

These must be verified by the backend or by on-chain cryptographic checks.

## Required Integrity Controls

### ZK Proof Hardening

- Each proof includes a **server-issued nonce** (public input).
- Nonces are single-use and short-lived.
- Proof verification rejects stale or reused nonces.
- Verification validates **public input length against the VK** before cryptographic checks.
- Proof metadata stores **circuit + VK hashes** (SHA-256 + Poseidon2) for audit/registry alignment.

### Claim Signing

- Backend signs **claim hashes** for high-risk values (liveness score, face match score, OCR-derived attributes).
- Client creates ZK proofs over **signed claim hashes** (e.g., Poseidon2(value, document_hash)).
- Server verifies signature before accepting any proof. No raw PII is stored in claim payloads.

### FHE Input Validation

- Web3: rely on FHEVM input proofs and on-chain InputVerifier.
- Web2: FHE inputs are derived server-side from verified data; the backend does **not** accept client-encrypted values as truth.

### Evidence Pack

- Compute `proof_hash` for each verified proof.
- Compute `proof_set_hash = SHA256(JSON.stringify(sorted(proof_hashes)) || policy_hash)`.
- Persist evidence to support audits and relying-party verification.

### Service-to-Service Authentication

- Internal services (FHE, OCR) must require `INTERNAL_SERVICE_TOKEN` in production.
- Public endpoints must be explicitly audited and limited.

## Tamper-Safe Verification Decision Flow

1. Backend performs OCR, liveness, and face match.
2. Backend signs derived attributes and thresholds.
3. Client generates ZK proofs using those values.
4. Backend verifies proofs and signatures.
5. Backend updates evidence pack (policy_hash + proof_set_hash).
6. Backend issues attestation.

## Rationale

- **Privacy**: Client retains sensitive inputs; proofs reveal only eligibility.
- **Integrity**: Server verifies all claims with proofs and signatures.
- **Auditability**: Signed claims + evidence pack hashes enable durable audits.
