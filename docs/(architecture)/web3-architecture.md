---
title: Web3 Architecture
description: FHEVM hooks, encryption/decryption flows, and on-chain compliance
---

Zentity's Web3 layer keeps identity verification off-chain and uses the blockchain solely for encrypted attestation, encrypted compliance checks, and minimal public compliance mirroring. On-chain contracts never see plaintext identity data. The Base mirror stores only attested/unattested state and the current compliance level for `isCompliant(address,uint8)` reads.

The decision record for the public-read mirror is [ADR-0005: Base compliance mirror for payment-time reads](../adr/fhe/0005-base-compliance-mirror-for-payment-reads.md). This page describes the runtime architecture and operational flow.

## System Context

The registrar encrypts identity attributes and submits attestations to fhEVM. Users authorize decryption and access via explicit grants. The following sections move from system context through the transition flow to Web3-specific mechanics.

### Key technologies

| Technology | Purpose |
|---|---|
| **FHEVM** | Encrypted smart contract operations |
| **Base Sepolia mirror** | Public, level-aware compliance reads for x402 and resource servers |
| **Reown AppKit** | Wallet connection UX |
| **Wagmi** | Wallet state + Ethereum hooks |
| **tRPC** | Type-safe API between frontend and backend |
| **ethers.js** | Transaction signing + EIP-712 support |

### Key ideas

- **Encrypted on-chain state**: ciphertext handles only, no plaintext in contracts.
- **Server-side attestation**: registrar encrypts identity attributes and submits attestations.
- **User-controlled access**: decryption and access are gated by user-authorized grants.
- **FHE-based compliance**: contracts evaluate policies on encrypted data.
- **Base mirror compliance**: contracts and resource servers can read `isCompliant(user,minLevel)` without learning underlying PII.

### Auth & session gating

- **Wallet connection ≠ session**: Reown AppKit connects a wallet, but it does not create a server session.
- **SIWE bridge**: the UI performs Sign‑In With Ethereum via Better Auth (`/api/auth/siwe/*`) to mint a session and link the wallet address.
- **Wallet-as-auth**: Wallet signatures (EIP-712) can also serve as the primary authentication method for account creation, distinct from wallet connection for on-chain operations.
- **Server gating**: Web3/FHE APIs require a Better Auth session and explicit credential unlock for encrypted payloads.

---

## Web2 to Web3 Transition

Zentity bridges traditional identity verification with privacy-preserving blockchain attestation.

### The two worlds

| Aspect | Web2 (Off-chain) | Web3 (On-chain) |
|---|---|---|
| **Purpose** | Collect and verify identity | Enforce compliance on encrypted data |
| **Data state** | Plaintext briefly; encrypted at rest | Encrypted throughout |
| **Trust model** | Trust Zentity backend | Trustless verification |
| **Storage** | Commitments and ciphertexts | Ciphertext handles |
| **Operations** | OCR, liveness, face match | Encrypted comparisons and policy checks |

### PoC limitations

| Limitation | Current state | Production requirement |
|---|---|---|
| Country codes | ~55 countries supported (EU, EEA, LATAM, Five Eyes, + 4 additional) | Full ISO 3166-1 coverage |
| Rate limiting | In-memory (resets on restart) | Redis or DB-backed |
| Liveness sessions | In-memory storage | Persistent storage (Redis/DB) |

Note: The attestation flow supports a demo mode that simulates successful submissions without on-chain transactions.

### Data flow

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant UI as Zentity Web App
  participant BE as Zentity Backend
  participant Verifier as OCR/Liveness Services
  participant Registrar as Registrar (Relayer)
  participant IR as IdentityRegistry
  participant CR as ComplianceRules
  participant ERC as CompliantERC20
  participant Mirror as IdentityRegistryMirror

  Note over User,Verifier: Phase 1 - Web2 Verification
  User->>UI: Complete verification flow
  UI->>BE: Submit document + liveness
  BE->>Verifier: OCR + liveness + face match
  Verifier-->>BE: Verified attributes
  BE->>BE: Store commitments + signed claims + encrypted attrs
  BE-->>UI: Verification complete

  Note over UI,IR: Phase 2 - Web3 Attestation
  UI->>UI: Connect wallet (Reown)
  UI->>BE: SIWE sign-in (Better Auth session)
  Note over UI: User unlocks passkey to authorize attributes
  UI->>BE: Request on-chain attestation
  BE->>Registrar: Encrypt identity attributes
  Registrar->>IR: attestIdentity(user, handles, proof)
  BE->>BE: Record chain-confirmed validity event
  BE->>Mirror: recordCompliance(user, numericLevel)

  Note over User,ERC: Phase 3 - Compliance-Gated Actions
  User->>IR: grantAccessTo(ComplianceRules)
  User->>ERC: transfer(to, encAmount, proof)
  ERC->>CR: checkCompliance(user)
  CR->>IR: Read encrypted attributes (ACL-protected)
  CR-->>ERC: Encrypted compliance result

  Note over User,Mirror: Base/x402 public read path
  User->>Mirror: isCompliant(user, requiredLevel)
  Mirror-->>User: Public boolean
```

### What stays in Web2

- **Document OCR** and authenticity checks
- **Liveness and face match** scoring
- **ZK proof generation** (client-side)
- **Encryption** of sensitive attributes
- **Storage** of commitments, proofs, and evidence packs
- **Passkey-based key custody** for encrypted attributes

### What moves to Web3

- **Encrypted identity attributes** stored in smart contracts
- **ACL-gated access** to ciphertexts
- **Encrypted compliance checks** (no plaintext)
- **Optional encrypted asset transfers** (demo)
- **Public Base compliance mirror** for `isCompliant(user,minLevel)` reads
- **Typical encrypted fields**: date of birth (dobDays), country code, compliance tier, and sanctions status

### Encryption boundaries

- **Web2**: Attributes are encrypted off-chain and stored as ciphertexts; only the user can decrypt.
- **Web3**: Attestations are encrypted server-side and stored on-chain as ciphertext handles.
- **Access**: Users grant contracts explicit access via ACLs; decryption requires user authorization.

### Encryption points

1. **Client-side encryption** for user-initiated encrypted transfers.
2. **Server-side encryption** for on-chain attestations.
3. **Never encrypted**: wallet addresses, transaction hashes, event metadata, and Base mirror attested/level state.

### Computation under encryption

```mermaid
flowchart LR
  A[Encrypted data] --> B[Compute on ciphertext]
  B --> C[Encrypted result]
```

The fhEVM never sees plaintext. Compliance checks execute directly on encrypted attributes.

### Access control model

Each ciphertext handle has an ACL that controls who can read or decrypt encrypted state.

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant IR as IdentityRegistry
  participant ACL as ACL
  participant CR as ComplianceRules

  Note over User,ACL: Phase 1 - User grants access
  User->>IR: grantAccessTo(ComplianceRules)
  IR->>ACL: Allow CR to read user ciphertexts
  ACL-->>IR: Updated
  IR-->>User: AccessGranted event

  Note over CR,IR: Phase 2 - Compliance can query
  CR->>IR: Read encrypted attributes
  IR->>ACL: Check access
  ACL-->>IR: Allowed
  IR-->>CR: Ciphertext handles
```

| State | Can transfer | Can read own data | Compliance can check |
|---|---|---|---|
| Not attested | No | No | No |
| Attested, no grant | No | Yes | No |
| Attested + granted | Yes | Yes | Yes |

### Silent failure pattern

Compliance checks do not revert when failing. Instead, they return an encrypted "false" that results in a zero-value transfer. This avoids leaking compliance status on-chain.

UI implications:

- A transaction can succeed while transferring zero.
- The UI must verify balance changes to detect failures.
- Users should grant access and verify attestation status before transferring.

### Operational responsibilities

- **Users**: complete Web2 verification, attest on-chain, grant access before transfers.
- **Operators**: deploy contracts, set authorized callers, configure registrar keys.
- **UI integrators**: check attestation and access status before enabling transfers.

### Integration checklist

- Verify Web2 proofs and signed claims before enabling Web3 attestation.
- Ensure the wallet is connected to the target network with gas available.
- Ensure SIWE has established a Better Auth session for the wallet address.
- Require a passkey PRF unlock before generating or decrypting encrypted payloads.
- Confirm the registrar keys and contract addresses are configured.
- Confirm ACL grants are issued for required contracts.
- Validate disclosure flows against the evidence pack schema.

Configuration details (network endpoints, contract addresses, registrar keys) are environment-specific and managed through deployment configuration.

### Common failure modes

- **Transfers** succeed but move zero because access was not granted.
- **Attestations** fail because registrar configuration is missing.
- **Compliance checks** fail due to incorrect attribute encoding.

### Security model (public vs encrypted)

Encrypted:

- Date of birth (dobDays) and nationality
- Compliance level and sanctions status
- Compliance results and encrypted balances

Public:

- Wallet addresses and transaction existence
- Contract interactions and event metadata
- Gas usage
- Base mirror attested/unattested status and numeric compliance level

---

## High-Level Architecture

```mermaid
graph TB
  subgraph Client["Client (Browser)"]
    UI[React UI]
    SDK[FHEVM SDK]
  end

  subgraph Backend["Backend (Next.js)"]
    API[API Routes]
    REG[Registrar / Relayer]
    DB[(SQLite)]
  end

  subgraph Chain["On-chain fhEVM"]
    IR[IdentityRegistry]
    ACL[ACL]
    CR[ComplianceRules]
    ERC[CompliantERC20]
  end

  subgraph OffChain["Off-chain FHE"]
    GW[FHEVM Gateway]
    KMS[Key Management Service]
    FHE[FHE Coprocessor]
  end

  UI --> SDK
  UI --> API
  API --> REG
  API --> DB
  REG --> IR
  IR --> ACL
  CR --> IR
  ERC --> CR
  SDK --> GW
  GW --> KMS
  FHE <--> Chain
```

---

## On-Chain Data Flow

```mermaid
flowchart TD
  User["User Wallet + FHEVM SDK"]
  Registrar["Backend Registrar"]
  AttIn["Encrypted attestation inputs"]
  EncIn["Encrypted transfer inputs"]

  User -- "Encrypt transfer" --> EncIn
  Registrar -- "Encrypt attestation" --> AttIn

  AttIn --> IR["IdentityRegistry"]
  EncIn --> ERC["CompliantERC20"]

  IR -- "Stores encrypted attrs" --> IRState["dobDays, country, compliance"]
  IR -- "ACL grants" --> ACL
  ERC --> CR["ComplianceRules"]
  CR --> IR
  CR -- "Encrypted result" --> ERC

  User -- "grantAccessTo" --> IR
```

**Key points**:

- **Attestation encryption** happens server-side (registrar + relayer SDK).
- **Wallet-initiated operations** use client-side FHEVM SDK.
- **Contracts operate on ciphertexts only**; no plaintext is revealed.
- **Access is explicit**: users grant contract-level access to their ciphertexts.

---

## Provider Hierarchy

```mermaid
graph TD
  A["Web3Provider"] --> B["trpcReact.Provider\n(tRPC client)"]
  B --> C["WagmiProvider\n(wallet state)"]
  C --> D["QueryClientProvider\n(React Query)"]
  D --> E["InMemoryStorageProvider\n(signature cache)"]
  E --> F["FhevmProvider\n(FHE SDK)"]
  F --> G["Application Components"]
```

### Provider responsibilities

| Provider | Purpose |
|---|---|
| `Web3Provider` | Root wrapper; initializes AppKit and shared clients |
| `trpcReact.Provider` | Type-safe API client |
| `WagmiProvider` | Wallet connection state + hooks |
| `QueryClientProvider` | Shared cache for tRPC + Wagmi |
| `InMemoryStorageProvider` | Signature cache for decryption |
| `FhevmProvider` | Manages FHEVM SDK lifecycle |

## SDK Lifecycle States

| State | Meaning |
|---|---|
| `idle` | No wallet connected or SDK not initialized |
| `loading` | WASM modules and SDK are initializing |
| `ready` | SDK is usable for encryption/decryption |
| `error` | Initialization failed |

## Client-Side Encryption Flow

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant C as React Component
  participant H as useFHEEncryption
  participant SDK as FHEVM SDK (WASM)
  participant S as Smart Contract

  User->>C: Enter value
  C->>H: encryptWith(builder)
  H->>SDK: createEncryptedInput(contractAddress, userAddress)
  H->>SDK: builder.addX(value)
  H->>SDK: encrypt()
  SDK-->>H: handles + inputProof
  H-->>C: encrypted inputs
  C->>S: submit(handles, inputProof)
```

## Decryption Flow

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant C as UI Component
  participant H as useFHEDecrypt
  participant W as Wallet
  participant G as Gateway
  participant K as KMS

  User->>C: Click "Decrypt"
  C->>H: decrypt()
  H->>W: Request signature (EIP-712)
  W-->>H: Signature
  H->>G: userDecrypt(requests, signature)
  G->>K: Verify + re-encrypt to user
  K-->>G: Re-encrypted ciphertext
  G-->>H: Encrypted response
  H-->>C: Plaintext values
```

## Attestation Flow

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant UI as Dashboard
  participant API as Backend
  participant DB as SQLite
  participant REG as Registrar
  participant BC as IdentityRegistry

  User->>UI: Request on-chain attestation
  UI->>API: Submit attestation request
  API->>DB: Validate verified identity
  API->>REG: Encrypt attributes
  REG->>BC: attestIdentity(user, handles, proof)
  BC-->>REG: txHash
  REG-->>API: submitted
  API-->>UI: Pending status
```

### Revocation Flow

On-chain attestation revocation is one delivery target of the canonical validity pipeline, not a separate business flow:

1. A revoke transition updates the current account snapshot and appends one `identity_validity_events` row.
2. The same transition schedules `blockchain_attestation_revocation` in `identity_validity_deliveries` alongside other downstream targets such as credential-status updates, CIBA cancellation, back-channel logout, and RP validity notice.
3. The delivery worker attempts the on-chain revoke outside the snapshot transaction.
4. If the chain call fails, the delivery stays retryable and the attestation moves to `revocation_pending`.
5. The same delivery framework handles retries and operator visibility; `admin.retryOnChainRevocation` is an operational convenience, not a second revocation architecture.

Chain-originated revocations and confirmations also feed back through the same validity pipeline, so "confirmed on chain," "revoked on chain," and "valid in product" converge on one lifecycle model.

### Base Mirror Flow

The Base mirror is a delivery target of the same validity pipeline:

1. A Sepolia `IdentityAttested` event is observed or an attestation refresh confirms a transaction.
2. Zentity records a chain-sourced `verified` validity event.
3. The delivery worker schedules `mirror_compliance_write`.
4. The mirror writer reads the current compliance level from the identity read model at execution time.
5. The writer calls Base `IdentityRegistryMirror.recordCompliance(user, level)`.
6. A revoke transition schedules `mirror_revocation_write`, which calls `revokeAttestation(user)`.

This keeps the mirror eventually consistent with the canonical read model while avoiding a parallel queue or mirror-specific table.

The mirror is not a second source of identity truth. It is a public delivery surface for payment-time reads, and any new public predicate must go through a separate privacy review before it is added.

---

## Data Privacy Model

1. **Identity verification** happens off-chain (OCR, liveness, face match).
2. **Identity attributes** are encrypted server-side by the registrar.
3. **Ciphertext handles** are stored on-chain (no plaintext).
4. **Compliance checks** operate on ciphertexts (no decryption in contracts).
5. **Attestation metadata** includes proof and policy hashes for auditability.
6. **User decryption** requires explicit authorization (signature-based).

---

## Privacy & Access Control Patterns

- **Encryption boundaries**: data is encrypted before it touches the chain and remains encrypted throughout contract execution.
- **ACL-gated access**: ciphertext handles are readable only by approved contracts.
- **User-authorized decryption**: decryption requires explicit user authorization.
- **Silent failure**: compliance checks avoid leaking policy details when access is missing.

See [Tamper Model](tamper-model.md) for integrity controls and [Attestation & Privacy Architecture](attestation-privacy-architecture.md) for data classification.

---

## How This Fits the Web2 Flow

Web2 performs **collection + verification**; Web3 performs **encrypted attestation + compliance checks**.

- Web2 stores **commitments, proofs, and encrypted attributes**.
- Web3 stores **encrypted attestation handles + public metadata**.

The end-to-end transition is captured in the Web2 to Web3 Transition section above.
