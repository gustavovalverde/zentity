# Tamper Model and Integrity Controls

> **Purpose**: Define how we handle a hostile browser and ensure verification results are trustworthy while preserving privacy.

## Scope: Web2 vs Web3

This document covers integrity controls for both deployment modes:

| Aspect | Web2 (Off-chain) | Web3 (On-chain) |
|--------|------------------|-----------------|
| **Proof verification** | Backend verifies ZK proofs | Backend for ZK proofs; on-chain InputVerifier for FHE inputs |
| **FHE inputs** | Server-derived + server-side encryption | FHEVM InputVerifier on-chain (wallet/registrar inputs) |
| **Nonce issuance** | Server-issued nonces for ZK proofs | Same ZK challenge flow (not used for attestation/transfer) |
| **Attestation authority** | Server database records | IdentityRegistry contract |
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
6. **Sign verifiable credentials** with issuer keys; validate holder binding on presentation.
7. **DPoP nonce replay prevention**: Issue and validate server-managed DPoP nonces (RFC 9449 §4.1): each DPoP proof carries a server-issued nonce; the nonce store enforces single-use and configurable TTL, preventing DPoP proof replay.
8. **KB-JWT holder binding**: Cryptographically verify KB-JWT holder binding in SD-JWT VP tokens: resolve the holder key from `cnf.jwk` or KB-JWT header, verify JWK thumbprint against `cnf.jkt`, then signature-verify the KB-JWT before accepting disclosed claims.

## What the Browser Can Do

- Generate ZK proofs (private inputs remain in browser).
- Encrypt data for FHEVM and TFHE.
- Decrypt data that only the user should see.

## What the Browser Must NOT Be Trusted For

- Liveness score calculation.
- Face match score calculation.
- Document OCR extraction.
- Compliance decisions (age, nationality, sanctions).
- VP token authenticity — browser or wallet-initiated VP tokens must be cryptographically verified server-side (issuer signature, KB-JWT holder binding, nonce, audience).

These must be verified by the backend or by on-chain cryptographic checks.

## Required Integrity Controls

### ZK Proof Hardening

- Each proof includes a **server-issued nonce** (public input).
- Nonces are single-use and short-lived.
- Proof verification rejects stale or reused nonces.
- Verification validates **public input length against the VK** before cryptographic checks.
- Proof metadata stores **circuit + VK hashes** for audit/registry alignment (see [ZK Architecture](zk-architecture.md)).

### Claim Signing

- Backend signs **claim hashes** for high-risk values (liveness score, face match score, OCR-derived attributes).
- Client creates ZK proofs over **signed claim hashes** (e.g., Poseidon2(value, document_hash)).
- Server verifies signature before accepting any proof. No raw PII is stored in claim payloads.

### Liveness-to-Face-Match Binding

- When liveness completes, backend stores a SHA-256 hash of the verified selfie frame on the verification draft.
- `faceMatch` requires a `draftId`, verifies draft ownership, and checks the submitted selfie hash against the stored liveness hash before running face detection.
- This blocks selfie substitution attacks where a client reuses a valid liveness session with a different selfie.

### FHE Input Validation

- Web3: rely on FHEVM input proofs and on-chain InputVerifier.
- Web2: FHE inputs are derived server-side from verified data; the backend does **not** accept client-encrypted values as truth.

### Evidence Pack

- Compute proof and policy hashes for each verified proof set.
- Persist evidence to support audits and relying-party verification.
- See [Attestation & Privacy Architecture](attestation-privacy-architecture.md) and [RFC: verification UX evidence bundle](rfcs/0013-verification-ux-evidence-bundle.md) for canonical hashing.

### Service-to-Service Authentication

- Internal services (FHE, OCR) must require authenticated requests in production.
- Public endpoints must be explicitly audited and limited.

### OID4VP Response Integrity

- VP responses use `response_mode: direct_post.jwt` — the wallet encrypts the response JWE to an ephemeral ECDH-ES P-256 key, preventing interception in transit.
- `client_id_scheme: x509_hash` enforced: full x5c chain validation (`validateX509Chain` in `x509-validation.ts`) verifies the leaf certificate's SHA-256 thumbprint matches `client_id`, checks certificate validity periods, and confirms the leaf was signed by the CA.
- KB-JWT signature verification is two-phase: first the issuer signature is verified against Zentity JWKS, then the KB-JWT is verified against the holder public key resolved from `cnf.jkt`.

### ZKPassport NFC Trust Boundary

When using the NFC chip verification path:

- **Proof generation**: Proofs are generated by the ZKPassport SDK on the user's mobile device, verified server-side via `zkpassport.verify()`. The server does not generate or modify proofs.
- **Nullifier uniqueness**: The `uniqueIdentifier` (nullifier) is checked for uniqueness across all accounts before accepting a verification. This prevents cross-account replay where the same physical passport is registered under multiple identities.
- **Synthetic liveness**: `livenessScore: 1.0` is assigned server-side because NFC chip challenge-response proves physical possession of the document. No face match or gesture-based liveness is performed.
- **Dev mode**: The `devMode` flag relaxes proof verification in `development`/`test` environments (accepts proofs without full cryptographic checks). Production enforces strict verification — this flag must never be enabled in production.

### Authentication integrity (DPoP-bound tokens)

- DPoP access tokens are bound to an ephemeral ES256 keypair; `dpopAccessTokenValidator` requires a valid DPoP proof on all credential endpoint requests.
- Server-managed nonce store (`dpop-nonce-store.ts`): single-use nonces with configurable TTL via `DPOP_NONCE_TTL_SECONDS`, sweep interval every 60 s.
- Nonces are validated and deleted atomically — a replayed nonce is rejected even within the TTL window.

### Authentication integrity (OPAQUE passwords)

- The server never receives plaintext passwords; it stores OPAQUE registration records.
- Clients verify the server’s static public key (pinned in production) to prevent MITM.
- Login state is encrypted and time-limited to reduce replay risk.
- OPAQUE endpoints are rate-limited to slow online guessing.

## Tamper-Safe Verification Decision Flow

1. Backend performs OCR, liveness, and face match.
2. Backend binds face match input to the verified liveness selfie hash.
3. Backend signs derived attributes and thresholds.
4. Client generates ZK proofs using those values.
5. Backend verifies proofs and signatures.
6. Backend updates evidence pack (policy_hash + proof_set_hash).
7. Backend issues attestation.

## Rationale

- **Privacy**: Client retains sensitive inputs; proofs reveal only eligibility.
- **Integrity**: Server verifies all claims with proofs and signatures.
- **Auditability**: Signed claims + evidence pack hashes enable durable audits.
