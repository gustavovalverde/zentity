---
title: System Architecture
description: Overview of how Zentity's services connect and how data flows through the system
---

Zentity's architecture separates proving (browser), verifying (server), and computing (FHE service) so that no single component handles both plaintext data and policy decisions. This document maps how services connect, how data flows between them, and what crosses each trust boundary, with the deployment context (Web2, Web3, agent) as the axis of variation.

## Architecture

### Components and Key Technologies

| Area | Technologies | Responsibility / Notes |
|---|---|---|
| Web UI + API | Next.js 16 (App Router), React 19, Node.js, pnpm, tRPC | Primary UI and orchestration layer with type-safe API routes. |
| ZK proofs | Noir, bb.js (Barretenberg), UltraHonk | Client-side proving in Web Workers; server-side verification. |
| Liveness + face match | Human.js + tfjs-node | Multi-gesture liveness and face match; real-time guidance on client, verification on server. |
| OCR | RapidOCR (PPOCRv5), python-stdnum | Document parsing, field extraction, and validation. |
| FHE | TFHE-rs (Rust), fhEVM | Encrypted computation off-chain and optional on-chain attestation. |
| Storage | SQLite (libSQL/Turso), Drizzle ORM | Privacy-first storage of commitments, proofs, and encrypted blobs. |
| Auth + key custody | Better Auth + WebAuthn + PRF + OPAQUE + EIP-712 Wallet | Passkey, OPAQUE password, or wallet signature authentication; all three derive client-held keys for sealing secrets. |
| Verifiable credentials | OIDC4VCI, OIDC4VP, SD-JWT VC, DCQL, JARM | Credential issuance and wallet presentation via OpenID standards. |
| HAIP compliance | @better-auth/haip (DPoP, PAR, JARM, wallet attestation, DCQL) | High Assurance Interoperability Profile for regulated wallet integrations. |
| CIBA | @better-auth/ciba (backchannel auth, poll + ping modes) | Agent-initiated async authorization via email/push notification and user approval. |
| Social recovery signing | FROST signer services (Rust/Actix) | Threshold signing for guardian-approved recovery (and future registrar). |
| MCP identity server | Node.js, Hono, @modelcontextprotocol/sdk | HTTP/stdio MCP server with OAuth-authenticated identity tools (whoami, my_profile, my_proofs, check_compliance, purchase). |
| Observability | OpenTelemetry | Cross-service tracing with privacy-safe attributes. |

### System Diagram

```mermaid
flowchart LR
  subgraph Browser["User Browser"]
    UI["Web UI\nReact 19 + Next.js"]
    W["Web Worker\nZK Prover (Noir/BB)"]
    UI <--> W
  end

  subgraph Server["Next.js Server :3000"]
    API[/"tRPC + Auth API"/]
    BB["ZK Verifier\n(bb-worker)"]
    DB[("SQLite / Turso")]
    API <--> BB
    API <--> DB
  end

  subgraph Services["Backend Services"]
    OCR["OCR :5004\nRapidOCR"]
    FHE["FHE :5001\nTFHE-rs"]
    SIGNER["FROST Coordinator :5002"]
    SIGNERS["Signer Nodes :5101+"]
    SIGNER --> SIGNERS
  end

  subgraph Mobile["Mobile Device"]
    ZKP["ZKPassport App\nNFC + ZK Proofs"]
  end

  subgraph Agent["AI Agent"]
    MCP["MCP Client\n(OAuth + DPoP)"]
  end

  UI -->|"doc + selfie"| API
  MCP -->|"FPA/CIBA + DPoP"| API
  Mobile -->|"NFC proofs"| API
  API -->|"zkpassport.verify()"| API
  API -->|"image"| OCR
  OCR -->|"extracted fields"| API

  UI -->|"private inputs"| W
  W -->|"proof"| UI
  UI -->|"submit proof"| API
  API -->|"verify"| BB

  API -->|"encrypt"| FHE
  FHE -->|"ciphertext"| API
  API -->|"recovery signing"| SIGNER
```

---

## Cryptographic Foundation

Four cryptographic pillars (auth + key custody, ZK proofs, FHE, and commitments) interlock to eliminate plaintext data handling. This document focuses on flow and system boundaries; see [Cryptographic Pillars](cryptographic-pillars.md) for how the primitives bind together, [Attestation & Privacy Architecture](attestation-privacy-architecture.md) for data classification, [ZK Architecture](zk-architecture.md) for proof system design, and [Web3 Architecture](web3-architecture.md) for on-chain attestation.

---

## Data Handling

We persist only the minimum required for verification and auditability:

- **Commitments and hashes** for integrity and deduplication
- **Encrypted attributes** (FHE ciphertexts)
- **Proof payloads** + public inputs
- **Passkey-sealed profile** (encrypted blob; client-decrypt only)
- **OPAQUE registration records** for password users (no plaintext or password hashes)
- **Verification status** + non-sensitive metadata

### Key Custody

A two-layer encryption scheme (DEK wrapped by a credential-derived KEK) ensures the server stores only encrypted blobs it cannot decrypt. Users decrypt locally after an explicit credential unlock. See [FHE Key Lifecycle](fhe-key-lifecycle.md) for the full key hierarchy and credential-specific derivation paths.

Raw document images, selfies, plaintext PII, and biometric templates are never stored. Full classification and storage boundaries live in [Attestation & Privacy Architecture](attestation-privacy-architecture.md).

---

## Social Recovery

Zentity supports guardian-approved recovery for passkey loss. Recovery is initiated with email or a Recovery ID, guardians approve via email links or authenticator codes, and the signer services perform FROST threshold signing once the approval threshold is met. Recovery wrappers are stored in `recovery_secret_wrappers`, and the signer coordinator is contacted from the Next.js server (not the browser).

The FROST aggregated signature is not just an authorization gate; it is cryptographically entangled with key custody. The signature is used as input key material for `HKDF-SHA256(ikm=signature, salt=challengeId, info="zentity:frost-unwrap")` to derive an AES-256-GCM key that unwraps the recovery DEKs. Without the real FROST signature, the DEKs cannot be recovered even with DB access.

Three guardian types are supported: `email` (approval link), `twoFactor` (authenticator code), and `custodialEmail` (Zentity-operated signer, limited to 1 per user, cannot be the sole guardian).

---

## Graduated Disclosure Depth

Zentity supports two usage modes that share the same core cryptography but differ in what is disclosed.

**Non-regulated (age-gated / consumer apps)**

- The relying party receives **proofs only** (e.g., "over 18", "document valid").
- No PII is shared. Verification is local to the relying party.

**Regulated (banks / exchanges)**

- The user authorizes disclosure with a passkey.
- The client decrypts the sealed profile and **re-encrypts to the relying party**.
- The relying party receives **PII + proofs + evidence pack** as required by regulation.
- Zentity retains **cryptographic artifacts only**, not plaintext PII.

**ARCOM double anonymity** (pairwise flows)

For DCR clients, Zentity defaults to pairwise subject identifiers (`subject_type: "pairwise"`), preventing cross-RP user correlation. In proof-only flows, additional ARCOM measures apply:

- Consent records deleted after authorization code issuance (transient linkage)
- Access token DB records deleted after JWT issuance
- Session IP/UA metadata scrubbed
- Opaque access tokens forced for pairwise clients (no JWT `sub` leakage)

---

## Data Flows

### Sign-Up and Verification

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant UI as Web UI
  participant AUTH as Auth API
  participant API as tRPC API
  participant DB as SQLite
  participant FHE as FHE Service
  participant OCR as OCR Service

  Note over User,AUTH: Phase 1: Sign-up (account creation)
  User->>UI: Choose credential (passkey / password / wallet)
  alt Passkey or Password
    UI->>AUTH: ensureAuthSession() (lazy)
    AUTH-->>UI: Anonymous session
    UI->>AUTH: Create credential on anonymous user
  else Wallet (SIWE)
    UI->>AUTH: signInWithSiwe() (creates user directly)
  end
  AUTH-->>UI: Session with credential
  UI->>API: completeAccountCreation
  API->>DB: Link email/wallet, clear isAnonymous, create identity bundle stub
  UI->>UI: Invalidate session cookie cache
  UI-->>UI: Redirect → /dashboard

  Note over User,FHE: Phase 1.5: FHE Enrollment Preflight
  User->>UI: Click "Start verification"
  UI->>UI: Confirm credential (PRF / wallet sig / password)
  UI->>UI: Generate FHE keys (TFHE WASM)
  UI->>API: Store encrypted secret + wrapper
  API->>FHE: Register public + server keys
  FHE-->>API: keyId
  API->>DB: Update identity bundle with fheKeyId
  API-->>UI: Enrollment complete

  Note over User,OCR: Phase 2: Identity verification (OCR path)
  User->>UI: Upload ID + selfie
  UI->>API: Submit document + liveness
  API->>OCR: OCR + parse (transient)
  OCR-->>API: Extracted fields
  API->>DB: Store commitments + signed claims
  UI->>UI: Generate ZK proofs (client-side)
  UI->>API: Store proofs
  API-->>UI: Verification complete (Tier progression)

  Note over User,FHE: Phase 2 (alt): NFC chip verification
  User->>UI: Select NFC chip method (ZKPassport)
  UI->>UI: Deep-link to ZKPassport mobile app
  Note right of UI: ZKPassport reads NFC chip, generates proofs on device
  UI->>API: passportChip.submitResult (proofs + nullifier)
  API->>API: zkpassport.verify() (server-side)
  API->>DB: Store identity_verifications (method: nfc_chip)
  API->>FHE: Schedule FHE encryption (synthetic liveness 1.0)
  API-->>UI: Verification complete
```

**Password (OPAQUE) flow**

OPAQUE authentication uses a password-derived export key:

- Client performs OPAQUE registration and derives an **export key**.
- Export key → HKDF → KEK wraps/unlocks the DEK during verification preflight and other step-up flows.
- Server stores the OPAQUE **registration record** (no plaintext password).
- Secret wrappers are stored with `kek_source = "opaque"`.

**Wallet (EIP-712) flow**

Wallet authentication uses EIP-712 typed data signing to derive the KEK:

- User signs an EIP-712 typed data message during wallet authentication and verification preflight.
- At sign-up, we run a best-effort stability check (sign twice, compare) to reject clearly unstable signers before key wrapping.
- This check does not guarantee future wallet behavior across firmware/app changes or device migration, so wallet users should add a backup passkey and/or guardian recovery wrapper.
- Signature bytes are processed through **HKDF-SHA256** to derive the KEK.
- The private key never leaves the wallet; the signature stays in the browser.
- Server stores the wallet address for account association.
- Secret wrappers are stored with `kek_source = "wallet"`.
- Sign-in also requires a **SIWE (EIP-191)** signature for session authentication (nonce-based replay protection).
- Supports hardware wallets (Ledger/Trezor) for enhanced security.

### Disclosure

Wallets can receive credentials and respond to presentation requests directly via OID4VP, bypassing the OAuth consent UI. The verifier creates a VP session with a DCQL query, signs a JAR JWT with x5c chain, encodes it as an `openid4vp://` QR code URI. The wallet presents an SD-JWT VP with KB-JWT binding, encrypted via JARM.

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant UI as Consent UI
  participant API as Zentity API
  participant DB as SQLite
  participant RP as Relying Party

  Note over RP,UI: OAuth authorize + consent
  RP->>UI: Redirect (scope: openid proof:identity identity.name)
  User->>UI: Approve selected scopes
  UI->>UI: Decrypt profile vault (passkey / password / wallet)
  UI->>API: Stage PII → ephemeral in-memory (5min TTL)
  API-->>RP: Auth code → tokens

  Note over RP,API: Token exchange
  RP->>API: POST /oauth2/token
  API-->>RP: id_token (proof + assurance only) + access_token
  RP->>API: GET /oauth2/userinfo
  API->>API: Consume ephemeral claims on first read
  API-->>RP: Identity PII + scope-filtered proof claims
```

All token requests require DPoP (sender-constrained tokens) and PAR (pushed authorization requests). See [OAuth Integrations](oauth-integrations.md) for protocol details.

### Agent Authorization (CIBA)

Agents and applications can request user authorization without a browser redirect via CIBA. The agent sends a backchannel request identifying the user; the user receives a push notification (with email fallback) and approves from the dashboard. If identity scopes are requested, the user unlocks their vault and PII is staged ephemerally for delivery via the userinfo endpoint. Poll and ping delivery modes are supported.

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant Agent as Agent
  participant AS as Zentity AS

  Agent->>AS: Backchannel authorize
  AS->>User: Push notification + email
  AS-->>Agent: { auth_req_id }
  Agent->>AS: Poll token endpoint
  AS-->>Agent: authorization_pending
  User->>AS: Approve (vault unlock if identity scopes)
  Agent->>AS: Poll token endpoint
  AS-->>Agent: { access_token, id_token }
  Agent->>AS: Userinfo (identity PII if scoped)
```

The access token includes an `act` claim identifying both the human and the agent. See [Agent Architecture](agent-architecture.md) for host registration, session lifecycle, protocol composition, and security properties. See [OAuth Integrations](oauth-integrations.md) for endpoints, scopes, and configuration.

---

## OCR + Liveness

**Document OCR**

- The OCR service extracts fields (name, DOB, document number, country) and validates formats.
- Images are processed transiently and never stored.
- Only derived claims and commitments return to the web app.

**Liveness + face match**

- The **client** runs Human.js for real-time detection and gesture guidance (smile, head turns).
- The **server** re-verifies frames with Human.js (tfjs-node) and issues signed liveness/face-match claims.
- This split keeps UX responsive while preserving server-side integrity.

For detailed liveness policy and integrity guarantees, see [Tamper Model](tamper-model.md) and [Attestation & Privacy Architecture](attestation-privacy-architecture.md).

---

## Web3 Layer

Zentity can **attest verified identity on-chain** using fhEVM while keeping attributes encrypted. The server (registrar) encrypts identity attributes and submits attestation; users authorize access with explicit grants.

See [Web3 Architecture](web3-architecture.md).

---

## Verifiable Credentials (SSI)

Zentity issues portable verifiable credentials following OpenID standards:

- **OIDC4VCI**: Pre-authorized code flow with DPoP-bound tokens, immediate and deferred issuance, status list revocation.
- **OIDC4VP**: DCQL presentation queries with `x509_hash` client_id, JARM encrypted responses, AKI-based trust filtering.
- **SD-JWT VC**: Selective disclosure with KB-JWT holder binding (`cnf.jkt` thumbprint, signature, freshness).

External wallets can receive and hold credentials; third-party verifiers can request presentations without Zentity involvement.

Credentials contain only derived claims, never raw PII. Claims like `verified`, `age_verified`, and `verification_level` indicate verification status without exposing underlying data.

See [SSI Architecture](ssi-architecture.md) for the complete Self-Sovereign Identity model.

---

## State Durability & Shared Devices

- **Sign-up state** is local React state only (no DB, no cookies). Refreshing the page restarts the sign-up form. An anonymous session is created on load for the credential flow.
- **FHE enrollment state** is tracked server-side via `identity_bundles.fheKeyId`. Enrollment is resumable; if partial, the preflight re-checks completion criteria.
- **Verification progress** is stored in first-party DB tables keyed by user ID (drafts, signed claims, ZK proofs).
- **Profile data** lives in a credential-encrypted vault (`encrypted_secrets` + `secret_wrappers`), only decryptable client-side after a credential unlock.
- **Identity PII** is never stored server-side. At consent time, PII is staged ephemerally in memory (5min TTL) and consumed once through the userinfo delivery path. The user's profile vault is the only persistent PII source.

---

## Observability

- **Distributed tracing** via OpenTelemetry across Web, FHE, and OCR
- **Sign-up and verification spans** for step timing + duplicate-work signals
- **Privacy-safe telemetry** (hashed IDs only; no PII)

---

## Compliance Derivation Engine

Compliance level is computed by a pure function that takes ZK proofs, signed claims, encrypted attribute presence, and flags as input, with no DB access, no mutable booleans, and no side effects.

### Levels

| Level | Numeric | Criteria |
|---|---|---|
| `none` | 1 | Default; fewer than half of the 7 checks pass |
| `basic` | 2 | At least half of the 7 checks pass |
| `full` | 3 | All 7 checks pass |
| `chip` | 4 | NFC chip verification + sybil resistance |

`verified` is `true` only for `full` or `chip`.

### The 7 Boolean Checks

Each check is derived from proof/claim existence, not stored boolean columns.

| Check | OCR path source | NFC chip path source |
|---|---|---|
| `documentVerified` | `doc_validity` ZK proof exists | Always `true` (chip is the document) |
| `livenessVerified` | `liveness_score` signed claim exists | `chip_verification` claim **type** present |
| `ageVerified` | `age_verification` ZK proof exists | `chip_verification` claim **type** present |
| `faceMatchVerified` | `face_match` ZK proof or `face_match_score` claim | `chip_verification` claim **type** present |
| `nationalityVerified` | `nationality_membership` ZK proof exists | `hasNationalityCommitment` flag |
| `identityBound` | `identity_binding` ZK proof exists | `uniqueIdentifier` present |
| `sybilResistant` | `dedupKey` / `uniqueIdentifier` present | `uniqueIdentifier` present |

For NFC chip checks, only claim type presence matters; boolean payloads inside the claim are ignored. This prevents a malicious server from downgrading compliance by flipping a stored boolean.

### `birthYearOffset`

A privacy-preserving age representation: `currentYear - birthYear`. Validated to the range 0–255 (uint8). Stored in `identity_verifications` as a proof output, never client-supplied.

See [Attestation & Privacy Architecture](attestation-privacy-architecture.md) for the full data classification table and [SSI Architecture](ssi-architecture.md) for how compliance level feeds into verifiable credential claims.

---

## Identity Revocation

Identity verifications can be revoked by an admin (fraud detection) or by the user themselves (GDPR self-service). Revocation cascades through a single DB transaction: verification records, identity bundles, and issued credentials are all marked revoked atomically. On-chain attestation revocation follows outside the transaction on a best-effort basis.

After revocation, the user's assurance tier drops to Tier 1 and their dedup key is released for re-registration.

---

## Storage Model

Database schema and table relationships are documented in [Attestation & Privacy Architecture](attestation-privacy-architecture.md). The Drizzle schema is the authoritative source for column-level detail.
