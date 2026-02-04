# RFC-0021: Zcash Shielded Aid Integration

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Created** | 2026-01-24 |
| **Updated** | 2026-01-24 |
| **Author** | Gustavo Valverde |
| **Related** | [RFC-0001](0001-passkey-wrapped-fhe-keys.md), [RFC-0014](0014-frost-social-recovery.md), [RFC-0020](0020-privacy-preserving-wallet-binding.md) |

## Summary

This RFC proposes extending Zentity's privacy-preserving identity verification to support the Zcash network for humanitarian aid payments. Recipients verify eligibility off-chain through Zentity, receive an encrypted credential embedded in Zcash's 512-byte memo field, and can prove eligibility at merchants without revealing their identity.

**Use Case**: A person needing humanitarian aid verifies identity/eligibility through Zentity, receives Zcash payments with embedded eligibility credentials, and proves eligibility when spending—all without exposing personal data.

## Problem Statement

Humanitarian aid distribution faces a critical tension between:

1. **Accountability**: Aid organizations need to verify recipients are eligible and track that funds reach intended beneficiaries
2. **Privacy**: Recipients in conflict zones or oppressive regimes face physical danger if their aid recipient status is exposed
3. **Dignity**: Traditional KYC processes are often invasive and humiliating for vulnerable populations

Current solutions force a trade-off:

| Approach | Privacy | Accountability | Dignity |
|----------|---------|----------------|---------|
| Cash | High | Low | High |
| Bank transfers | Low | High | Medium |
| Blockchain (transparent) | Low | High | Medium |
| Zcash (shielded) | High | ? | High |

This RFC addresses the accountability gap for shielded Zcash payments while preserving privacy and dignity.

## Goals

- Enable privacy-preserving eligibility verification for Zcash-based aid distribution
- Allow recipients to prove eligibility at merchants without revealing identity
- Support selective disclosure for regulatory compliance (viewing keys)
- Integrate with Zentity's existing ZK proof infrastructure
- Provide revocation capability for compromised or expired credentials

## Non-Goals

- Replacing Zentity's existing FHEVM attestation system
- Building a full Zcash wallet (users bring their own)
- On-chain smart contracts (Zcash doesn't support them)
- Real-time transaction monitoring

---

## Background

### Zcash Architecture

Zcash is a privacy-focused cryptocurrency using zero-knowledge proofs to shield transaction details. We target **Orchard only** (the modern pool using Halo2).

| Component | Description |
|-----------|-------------|
| **Shielded Pool** | Orchard (Halo2, no trusted setup) |
| **Memo Field** | 512 bytes encrypted, only recipient can decrypt |
| **Viewing Keys** | Allow selective disclosure without spending authority |
| **Proof System** | Halo2 |

**Key insight**: The 512-byte encrypted memo field is perfect for embedding eligibility credentials.

### Zcash Foundation Shielded Aid Initiative (SAI)

The Zcash Foundation launched the [Shielded Aid Initiative](https://zfnd.org/zcash-foundation-launches-new-initiative-to-champion-privacy-preserving-humanitarian-aid/) to promote privacy-preserving humanitarian aid. This RFC aligns with SAI's vision while adding verifiable eligibility credentials.

### Zentity Current Architecture

| Component | Technology |
|-----------|------------|
| **Provider Pattern** | `IAttestationProvider` interface with factory |
| **Identity Binding** | Poseidon2 commitment binding proofs to user |
| **ZK Proofs** | Noir circuits (UltraHonk/Barretenberg) |
| **Attestation Flow** | Off-chain verification → FHE encryption → On-chain attestation |

---

## High-Level Architecture

```text
┌─────────────────────────────────────────────────────────────────────────┐
│  PHASE 1: Off-Chain Verification (Existing Zentity)                     │
│  Document OCR → Liveness → Face Match → ZK Proofs → Eligibility         │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  PHASE 2: Credential Issuance                                           │
│  Zentity issues signed eligibility credential with binding commitment   │
│  Credential fits in 512-byte Zcash memo field                           │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  PHASE 3: Aid Distribution                                              │
│  Aid Org → Zcash shielded tx → Recipient (memo contains credential)     │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  PHASE 4: Merchant Verification                                         │
│  Recipient shares viewing key → Merchant decrypts memo → Validates      │
│  Merchant learns eligibility, NOT identity                              │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Proof System Compatibility

### Current Zentity Stack

| Component | Technology |
|-----------|------------|
| **Circuit Language** | Noir |
| **Proof System** | UltraHonk (via Barretenberg) |
| **Curve** | BN254 |
| **Hash** | Poseidon2 |

### Zcash Orchard Proof System

| Component | Technology |
|-----------|------------|
| **Proof System** | Halo2 |
| **Curve** | Pallas/Vesta cycle |
| **Trusted Setup** | None required |
| **Hash** | Poseidon |

**Key Libraries:**

- `halo2_proofs` - Halo2 implementation
- `orchard` crate - High-level Orchard protocol

### Path to Native Integration

Noir's ACIR (Abstract Circuit Intermediate Representation) is backend-agnostic—Noir compiles constraints, backends generate proofs. This separation enables building a Zcash-compatible backend:

- ACIR contains no proving system specifics
- Field support is compile-time configurable (BN254, BLS12-381, Pallas)
- `BlackBoxFunctionSolver` trait isolates backend-specific cryptographic operations
- Multiple backends can consume the same ACIR bytecode

Native Zcash verification requires building a backend targeting `zcash/halo2` (IPA commitment scheme):

| Phase | Effort | Deliverable |
|-------|--------|-------------|
| Pallas field support | 1-2 weeks | Noir compiles with `--features pallas` |
| Pallas black box solver | 3-4 weeks | Pallas/Vesta curve operations |
| Halo2 proof backend | 6-8 weeks | `noir-zcash-halo2-backend` crate |

**Total: 10-14 weeks**

All existing Noir circuits (age, nationality, face match, identity binding) work unchanged. Merchants can verify Halo2 proofs locally using standard Zcash tooling.

### Poseidon Hash Alignment

Both Zentity and Zcash Orchard use Poseidon hash:

| System | Hash Function | Field |
|--------|---------------|-------|
| Zentity (Noir) | Poseidon2 | BN254 scalar field |
| Zcash Orchard | Poseidon | Pallas scalar field |

**Challenge:** Different base fields require modular reduction when migrating proofs.

**Solution:** When compiling to Halo2 backend, use Pallas-native Poseidon. The binding commitment logic remains identical.

---

## Design Decisions

### 1. Zcash Node: Zebra Only

Support Zebra exclusively (Zcash Foundation's Rust implementation). Modern async architecture, actively developed, and well aligned with Zentity's Rust services.

### 2. Issuer Key: Environment Variable (MVP)

Signing key stored in `ZCASH_ISSUER_PRIVATE_KEY` env var, similar to existing `FHEVM_REGISTRAR_PRIVATE_KEY`. Simple for development; can upgrade to HSM later.

**Future**: HSM integration for production deployments

### 3. Credential Revocation: Expiry + Revocation List

- Short expiry periods (30-90 days) as primary mechanism
- Revocation list for immediate invalidation
- Verifiers check both expiry AND revocation status

### 4. Merchant Model: Registered Only

Merchants must register with Zentity to verify credentials:

- API key authentication and rate limiting
- Audit trails for compliance
- Analytics and fraud detection

### 5. Credential in Memo Field (Not On-Chain State)

Unlike FHEVM where attestations are stored in contract state, Zcash credentials are embedded in transaction memos:

- No on-chain identity registry (enhanced privacy)
- Credential travels with payment
- Selective disclosure via viewing keys

### 6. Off-Chain Proof Verification (Phase 1)

For MVP, Noir proofs remain off-chain with API-based verification:

- Generate proofs off-chain using existing UltraHonk infrastructure
- Include proof set hash in credential (SHA-256 of all proofs)
- Credential signed by Zentity issuer key (Ed25519)
- Registered merchants verify via Zentity API

**Future (Phase 2):** With Noir's Halo2 backend, proofs can be embedded directly in ZIP 231 memo bundles for fully decentralized verification. See "Proof Strategy: Phased Approach" below.

### 7. Identity Binding via Poseidon2

Reuse existing `identity_binding` circuit:

```text
binding_commitment = Poseidon2(binding_secret || user_id_hash || document_hash)
```

This prevents credential theft/replay.

### 8. Proof Strategy: Phased Approach

**Phase 1 (MVP):** Off-chain proofs + Ed25519 signed credentials

- Use existing Noir/UltraHonk infrastructure
- Merchants verify via Zentity API
- Credential fits in 512-byte memo (ZIP 302)

**Phase 2 (Build Noir → Zcash Halo2 Backend):** Native Halo2 proofs

- Build `noir-zcash-halo2-backend` crate targeting `zcash/halo2` (IPA)
- Add Pallas field support to Noir's `acir_field` crate
- Create `halo2_blackbox_solver` for Pallas-specific operations
- Embed full proofs in memo via ZIP 231 (up to 16 KiB)
- Fully decentralized verification—no API required
- Estimated effort: 10-14 weeks

**Phase 3 (Future):** Recursive proof aggregation

- Aggregate multiple eligibility proofs into single Halo2 proof
- Maximum privacy + minimum proof size
- Requires custom accumulator logic

### 9. Orchard-Only Integration

We target Orchard exclusively—no Sapling support:

- Orchard uses Halo2 (no trusted setup) - enables future Noir→Halo2 path
- Poseidon hash compatible with Zentity's identity binding
- Single pool eliminates cross-pool privacy leakage
- Simpler implementation with cleaner architecture

**Transaction Version:** V5 (current production standard since NU5, May 2022)

### 10. Privacy Policy: FullPrivacy Mode

Aid organizations must configure wallets to enforce `FullPrivacy` policy:

- Orchard-only outputs (no Sapling, no transparent)
- No cross-pool mixing allowed
- Maximum recipient protection

---

## Eligibility Credential Format

### Memo Field Capabilities

| Standard | Size | Status | Use Case |
|----------|------|--------|----------|
| **ZIP 302** | 512 bytes | Active | Single credential per output |
| **ZIP 231** | 16 KiB (64 × 256 bytes) | NU7 (not yet implemented) | Large proofs or credential bundles |

### Phase 1 Format (288 bytes)

The credential must fit within Zcash's 512-byte memo field (ZIP 302). Format:

| Offset | Field | Size | Description |
|--------|-------|------|-------------|
| 0-1 | Version | 2 | Protocol version (1) |
| 2-3 | Type | 2 | Credential type (0x0001 = aid eligibility) |
| 4-19 | Program ID | 16 | Aid program UUID |
| 20-51 | Binding Commitment | 32 | Poseidon2 output |
| 52-83 | Proof Set Hash | 32 | SHA-256 of all ZK proofs |
| 84-115 | Policy Hash | 32 | Eligibility policy hash |
| 116-119 | Eligibility Level | 4 | 0-3 (maps to Zentity tiers) |
| 120-127 | Valid From | 8 | Unix timestamp (ms) |
| 128-135 | Valid Until | 8 | Unix timestamp (ms) |
| 136-199 | Issuer Signature | 64 | Ed25519 signature |
| 200-231 | Issuer Public Key | 32 | Ed25519 public key |
| 232-287 | Reserved | 56 | Future: Halo2 proof reference |
| 288-511 | Padding | 224 | Zero-padded (or additional claims) |

### Phase 2 Format (ZIP 231 Memo Bundles)

**Implementation Status:** ZIP 231 is specified but not yet implemented in Zebra.
Phase 2 depends on NU7 deployment timeline—no confirmed date as of early 2026.

When ZIP 231 becomes available, credentials can include:

- Full Halo2 proof (~3.5 KiB) for decentralized verification
- Multiple claim proofs aggregated
- Revocation accumulator witness
- Program-specific attributes

Halo2 proofs are ~3.5 KiB—too large for ZIP 302 (512 bytes) but fit ZIP 231 (16 KiB).

### Credential Type Codes

| Code | Type | Description |
|------|------|-------------|
| 0x0001 | Aid Eligibility | Humanitarian aid eligibility |
| 0x0002 | Refugee Status | UN refugee status credential |
| 0x0003 | Medical Need | Healthcare eligibility |
| 0x0004-0xFFFF | Reserved | Future credential types |

### Eligibility Levels

| Level | Description | Requirements |
|-------|-------------|--------------|
| 0 | None | No verification |
| 1 | Basic | Account created |
| 2 | Verified | Document + liveness |
| 3 | Full | Document + liveness + face match |

---

## Implementation Plan

### Phase 1: Zcash Provider Foundation

**Files to create:**

```text
apps/web/src/lib/blockchain/providers/zcash-types.ts
apps/web/src/lib/zcash/zebra-client.ts
```

**Files to modify:**

```text
apps/web/src/lib/blockchain/networks.ts  - Add Zcash network config
```

**Key Components:**

1. **Zcash Types** (`zcash-types.ts`)
   - Network types (mainnet, testnet, regtest)
   - Orchard address validation
   - Memo field constants (512 bytes)

2. **Zebra Client** (`zebra-client.ts`)
   - JSON-RPC client for Zebra node
   - Transaction queries
   - Viewing key operations
   - Memo decryption helpers

### Phase 2: Credential System

**Files to create:**

```text
apps/web/src/lib/aid/types.ts
apps/web/src/lib/aid/credential.ts
apps/web/src/lib/aid/serialization.ts
apps/web/src/lib/aid/signing.ts
```

**Key Components:**

1. **Credential Types** (`types.ts`)
   - `EligibilityCredential` interface
   - `AidProgram` interface
   - `CredentialVerificationResult` type

2. **Credential Logic** (`credential.ts`)
   - `createCredential()` - Issue new credential
   - `validateCredential()` - Check signature and expiry
   - `isRevoked()` - Check revocation list

3. **Serialization** (`serialization.ts`)
   - `serializeCredential()` - To 288-byte format
   - `deserializeCredential()` - From memo bytes
   - `padToMemoSize()` - Pad to 512 bytes

4. **Signing** (`signing.ts`)
   - Ed25519 key management
   - `signCredential()` - Issuer signature
   - `verifySignature()` - Signature validation

### Phase 3: Database Schema

**File to create:**

```text
apps/web/src/lib/db/schema/aid.ts
apps/web/src/lib/db/queries/aid.ts
```

**Tables:**

```sql
-- Aid program definitions
CREATE TABLE aid_programs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  organization_id TEXT NOT NULL,
  policy_hash TEXT NOT NULL,
  min_eligibility_level INTEGER NOT NULL DEFAULT 2,
  credential_validity_days INTEGER NOT NULL DEFAULT 90,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Issued credentials (metadata only, not the credential itself)
CREATE TABLE eligibility_credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  program_id TEXT NOT NULL REFERENCES aid_programs(id),
  binding_commitment TEXT NOT NULL,
  proof_set_hash TEXT NOT NULL,
  eligibility_level INTEGER NOT NULL,
  valid_from TEXT NOT NULL,
  valid_until TEXT NOT NULL,
  revoked_at TEXT,
  revocation_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Revocation list (for quick lookup)
CREATE TABLE credential_revocations (
  id TEXT PRIMARY KEY,
  credential_id TEXT NOT NULL REFERENCES eligibility_credentials(id),
  reason TEXT NOT NULL,
  revoked_by TEXT NOT NULL,
  revoked_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Registered merchant accounts
CREATE TABLE aid_merchants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  organization_id TEXT,
  api_key_hash TEXT NOT NULL,
  rate_limit_per_hour INTEGER NOT NULL DEFAULT 1000,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Verification audit log
CREATE TABLE merchant_verifications (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES aid_merchants(id),
  credential_id TEXT NOT NULL,
  program_id TEXT NOT NULL,
  verification_result TEXT NOT NULL,
  verified_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Phase 4: tRPC Router

**File to create:**

```text
apps/web/src/lib/trpc/routers/aid.ts
```

**Endpoints:**

| Procedure | Auth | Description |
|-----------|------|-------------|
| `programs.list` | Public | List active aid programs |
| `programs.get` | Public | Get program details |
| `credentials.issue` | User | Issue credential for authenticated user |
| `credentials.list` | User | List user's credentials |
| `credentials.revoke` | Admin | Revoke a credential |
| `verify` | Merchant | Verify credential (API key auth) |
| `revocations.list` | Merchant | Get revocation list for a program |
| `merchants.register` | Admin | Register new merchant |
| `merchants.rotateKey` | Merchant | Rotate API key |

**Example: Credential Issuance**

```typescript
credentials: {
  issue: protectedProcedure
    .use(requireFeature("aidCredentials"))
    .input(z.object({
      programId: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      // 1. Verify user meets program requirements
      const program = await getAidProgram(input.programId);
      const verificationStatus = await getVerificationStatus(ctx.userId);

      if (verificationStatus.tier < program.minEligibilityLevel) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      // 2. Get proof set hash from attestation evidence
      const evidence = await getAttestationEvidence(ctx.userId);

      // 3. Create credential
      const credential = await createCredential({
        userId: ctx.userId,
        programId: input.programId,
        bindingCommitment: evidence.bindingCommitment,
        proofSetHash: evidence.proofSetHash,
        eligibilityLevel: verificationStatus.tier,
        validityDays: program.credentialValidityDays,
      });

      // 4. Serialize for memo field
      const memoBytes = serializeCredential(credential);

      return {
        credentialId: credential.id,
        memoHex: Buffer.from(memoBytes).toString('hex'),
        validUntil: credential.validUntil,
      };
    }),
}
```

---

## Security Model

### Data Visibility Matrix

| Data | User | Aid Org | Merchant | Zcash Chain |
|------|------|---------|----------|-------------|
| User identity | Yes | No | No | No |
| Eligibility level | Yes | Yes* | Yes* | No |
| Payment amount | Yes | Yes | No** | No |
| Credential validity | Yes | Yes* | Yes* | No |
| Wallet address | Yes | No*** | No*** | No*** |

\* Via viewing key sharing
\** Unless merchant is also viewing key holder
\*** Shielded transactions hide addresses

### Threat Model

| Threat | Mitigation |
|--------|------------|
| Credential theft | Binding commitment ties credential to user's identity proofs |
| Credential forgery | Ed25519 signature from Zentity issuer key |
| Replay attacks | Validity period + unique binding commitment |
| Cross-merchant correlation | Viewing keys are address-specific; merchants can't correlate |
| Merchant collusion | Credential contains no PII; only eligibility level |
| Issuer key compromise | Key rotation + revocation list + short validity periods |

### Binding Commitment Security

The binding commitment prevents credential transfer:

```text
binding_commitment = Poseidon2(
  binding_secret ||    // Derived from user's auth material
  user_id_hash ||      // SHA-256 of user ID
  document_hash        // SHA-256 of verified document
)
```

To use a stolen credential, an attacker would need:

1. The credential itself (from intercepted transaction)
2. The user's passkey/OPAQUE password/wallet (for binding secret)
3. The user's identity document (for document hash)

---

## Verification Flow

### Merchant Verification Steps

```text
1. Recipient shares viewing key for specific address
   └─> Merchant imports viewing key to their Zebra node

2. Merchant decrypts memo from payment transaction
   └─> Extracts 288-byte credential

3. Merchant calls Zentity verification API
   POST /api/aid/verify
   {
     "credentialHex": "...",
     "merchantApiKey": "...",
     "programId": "..."
   }

4. Zentity validates:
   ├─> Signature (Ed25519 from issuer key)
   ├─> Expiry (validFrom <= now <= validUntil)
   ├─> Revocation (not in revocation list)
   └─> Program (credential type matches program)

5. Return verification result
   {
     "valid": true,
     "eligibilityLevel": 3,
     "programName": "UN Food Aid - Syria",
     "expiresAt": "2026-04-24T00:00:00Z"
   }
```

### Selective Disclosure

Recipients can choose what to reveal:

| Disclosure Level | What Merchant Learns |
|------------------|---------------------|
| Full viewing key | All transactions, amounts, memos |
| Incoming viewing key | Only incoming transactions |
| Single-tx viewing key | Only one specific transaction |
| No disclosure | Nothing (can't verify eligibility) |

**Orchard Viewing Keys:**

- **Full Viewing Key (FVK)**: Contains `ak`, `nk`, `ovk` - full transaction visibility
- **Incoming Viewing Key (IVK)**: Decrypt incoming notes only
- **Outgoing Viewing Key (OVK)**: For outgoing note encryption

For selective disclosure, share the Orchard IVK with merchants.

---

## Environment Variables

```bash
# Zebra RPC connection
ZCASH_ZEBRA_RPC_URL=http://localhost:8232

# Issuer signing key (Ed25519 private key, 64 hex chars)
ZCASH_ISSUER_PRIVATE_KEY=<64-char-hex>

# Network (mainnet, testnet, regtest)
ZCASH_NETWORK=testnet

# Optional: RPC authentication
ZCASH_RPC_USERNAME=
ZCASH_RPC_PASSWORD=
```

---

## Testing Strategy

### Unit Tests

- Credential serialization/deserialization roundtrip
- Ed25519 signature creation and verification
- Expiry and revocation validation
- Binding commitment generation

### Integration Tests

- Zebra RPC client connectivity
- Full credential issuance flow
- Merchant verification API

### E2E Tests (Regtest)

1. Start Zebra in regtest mode
2. Issue credential to test user
3. Create shielded transaction with credential in memo
4. Verify credential as merchant
5. Test revocation flow

---

## Migration Path

### For Existing Users

No migration required. Aid credentials are:

- Opt-in per program
- Independent of existing attestations
- Use existing identity proofs

### For Aid Organizations

1. Register as organization in Zentity admin
2. Create aid program with eligibility policy
3. Receive issuer API credentials
4. Integrate credential issuance into payment flow

### For Merchants

1. Register via Zentity merchant portal
2. Receive API key for verification
3. Set up Zebra node (or use hosted service)
4. Integrate verification into point-of-sale

---

## Future Extensions

### Near-Term: Native Halo2 Proofs

Build `noir-zcash-halo2-backend` crate (10-14 weeks). See "Path to Native Integration" for roadmap.

When ZIP 231 (NU7) deploys:

- Embed full Halo2 proofs in memo bundles
- Enable fully decentralized verification
- Merchants verify using standard Zcash tooling

### Medium-Term: Multi-Program Credentials

Single credential proving eligibility for multiple programs (e.g., food + medical + shelter). Aggregate proofs into one Halo2 proof.

### Medium-Term: Threshold Issuance

FROST-based multi-party credential issuance (no single issuer can forge). Leverages existing FROST infrastructure from RFC-0014.

### Long-Term: Recursive Proof Aggregation

Aggregate multiple Noir proofs into single Halo2 proof using accumulation schemes:

- Batch verification of all eligibility claims
- Maximum privacy + minimum on-chain footprint
- Requires custom accumulator logic

### Long-Term: Cross-Chain Portability

Support other privacy chains with similar credential patterns:

| Chain | Memo/Data Field | Proof System |
|-------|-----------------|--------------|
| Zcash | 512B / 16KiB (ZIP 231) | Halo2 |
| Monero | Extra field (variable) | Bulletproofs+ |
| Secret Network | Smart contract state | Custom SNARK |

### Long-Term: Offline Verification

QR-code based verification for areas with limited connectivity:

- Credential + truncated proof in QR
- Cached revocation lists on merchant devices
- Sync when connectivity available

### Research: Ztarknet L2 Programmability

The [Ztarknet proposal](https://forum.zcashcommunity.com/t/proposal-ztarknet-a-starknet-l2-for-zcash/) would add programmability to Zcash. If deployed, could enable:

- Smart contract-based credential verification
- On-chain revocation registries
- Program-specific logic without centralized API

---

## Open Questions

1. **Should credentials be renewable without re-verification?**
   - Option A: Always require fresh verification
   - Option B: Allow renewal within grace period if no revocation

2. **How should we handle program-specific eligibility criteria?**
   - Option A: Generic eligibility level (current design)
   - Option B: Program-specific claim attributes in reserved bytes

3. **Should we support credential aggregation (multiple credentials in one memo)?**
   - 512 bytes allows ~1.7 credentials at 288 bytes each
   - Trade-off: complexity vs. flexibility

4. **Viewing key management for merchants?**
   - Option A: Merchants run their own Zebra nodes
   - Option B: Zentity provides viewing key import service
   - Option C: Hybrid with encrypted viewing key escrow

---

## References

### Zcash Protocol

- [ZIP 302: Standardized Memo Field Format](https://zips.z.cash/zip-0302)
- [ZIP 231: Memo Bundles](https://zips.z.cash/zip-0231)
- [ZIP 224: Orchard Shielded Protocol](https://zips.z.cash/zip-0224)
- [Zcash Protocol Specification v2025.6.1](https://zips.z.cash/protocol/protocol.pdf)

### Proof Systems

- [Halo2 Book](https://zcash.github.io/halo2/)
- [Orchard Book](https://zcash.github.io/orchard/)
- [The Pasta Curves for Halo 2](https://electriccoin.co/blog/the-pasta-curves-for-halo-2-and-beyond/)

### Noir/Aztec

- [Noir Documentation](https://noir-lang.org/docs/)
- [ACVM Architecture](https://github.com/noir-lang/noir/tree/master/acvm-repo) — Backend extension points
- [Noir 1.0 Announcement](https://aztec.network/blog/the-future-of-zk-development-is-here-announcing-the-noir-1-0-pre-release)

### Halo2 Libraries

- [zcash/halo2](https://github.com/zcash/halo2) — Zcash Halo2 (IPA commitment)
- [halo2-lib](https://github.com/axiom-crypto/halo2-lib) — Circuit library from Axiom
- [pasta_curves](https://github.com/zcash/pasta_curves) — Pallas/Vesta curves

### Zcash Ecosystem

- [Zcash Foundation Shielded Aid Initiative](https://zfnd.org/sai/)
- [Zebra Documentation](https://zebra.zfnd.org/)
- [TRISA Travel Rule Compliance](https://trisa.io/)
- [Ztarknet L2 Proposal](https://forum.zcashcommunity.com/t/proposal-ztarknet-a-starknet-l2-for-zcash/52926)

### GitHub Repositories

- [zcash/halo2](https://github.com/zcash/halo2) - Halo2 proof system
- [zcash/librustzcash](https://github.com/zcash/librustzcash) - Zcash Rust libraries
- [ZcashFoundation/zebra](https://github.com/ZcashFoundation/zebra) - Full node
- [ZcashFoundation/wallet](https://github.com/ZcashFoundation/wallet) - Zallet wallet (reference implementation)
- [noir-lang/noir](https://github.com/noir-lang/noir) - Noir language

### Zentity Internal

- [RFC-0001: Passkey-Wrapped FHE Keys](0001-passkey-wrapped-fhe-keys.md)
- [RFC-0020: Privacy-Preserving Wallet Binding](0020-privacy-preserving-wallet-binding.md)
- [Zentity Web3 Architecture](../web3-architecture.md)
- [Zentity Attestation & Privacy Architecture](../attestation-privacy-architecture.md)

### Source Code References (Validated January 2026)

**Zebra (ZcashFoundation/zebra):**

- `zebra-chain/src/transaction.rs:79-175` — Transaction version enum (V1-V6)
- `zebra-chain/src/transaction/memo.rs` — Memo field (`Box<[u8; 512]>`)
- `zebra-chain/src/orchard/keys.rs` — Orchard key types (FVK, IVK, OVK)
- `zebra-consensus/src/primitives/halo2.rs` — Halo2 batch verification
- `zebra-rpc/src/methods/types/transaction.rs` — RPC transaction handling

**Zallet (ZcashFoundation/wallet):**

- `zallet/src/components/json_rpc/methods/z_send_many.rs:262` — Orchard as preferred pool
- `zallet/src/components/json_rpc/payments.rs:415-425` — Memo parsing
- `zallet/src/components/json_rpc/payments.rs:198-283` — Privacy policies
- `zallet/src/components/keystore.rs` — Key management patterns
- `zallet/src/components/database.rs` — Database integration
