# RFC-0020: Privacy-Preserving Wallet Binding

| Field | Value |
|-------|-------|
| **Status** | Implemented |
| **Created** | 2026-01-19 |
| **Updated** | 2026-01-20 |
| **Author** | Gustavo Valverde |
| **Related** | [RFC-0018](0018-pure-ssi-did-bbs-anoncreds.md) |

## Summary

This RFC proposes enhancements to wallet-based identity binding that improve privacy while maintaining network-agnostic compatibility. The current wallet binding implementation exposes the wallet address, making it linkable across services. This RFC evaluates privacy-preserving alternatives and recommends a phased approach using **BBS+ credentials** as the primary network-agnostic solution.

## Current State

Zentity supports three authentication modes for identity binding:

| Auth Mode | Binding Secret Source | Privacy Level |
|-----------|----------------------|---------------|
| **Passkey** | PRF output (32 bytes) | Highest – device-bound, non-extractable |
| **OPAQUE** | Export key (64 bytes) | Medium – password-derived, deterministic |
| **Wallet** | EIP-712 signature (65 bytes) | Lower – publicly verifiable by address |

The binding commitment formula is already privacy-preserving at the cryptographic level:

```text
binding_secret = HKDF(signature, "zentity-binding-wallet-v1")
binding_commitment = Poseidon2(binding_secret || user_id_hash || document_hash)
```

**However**, privacy is limited because:

1. The wallet address is stored in the `wallet_address` table for account association
2. On-chain attestations are linked to the wallet address
3. EIP-712 signatures are publicly verifiable by recovering the signer's address
4. The same wallet address is used across all services (no pairwise identifiers)

## Problem Statement

Wallet-based users face a privacy trade-off compared to passkey/OPAQUE users:

- **Linkability**: Anyone observing on-chain attestations can link them to other transactions from the same wallet
- **Cross-service correlation**: The same wallet address appears across all relying parties
- **Reduced anonymity set**: Wallet addresses are often linked to ENS names, exchange accounts, or social profiles

For users who value privacy, wallet binding should provide comparable unlinkability to passkey-based binding.

## Goals

- Improve wallet binding privacy to approach passkey-level unlinkability
- Support multiple blockchain networks (not just EVM/secp256k1)
- Maintain backward compatibility with existing wallet flows
- Align with RFC-0018's BBS+ integration for credential-based unlinkability

## Non-Goals

- Replacing wallet-based authentication entirely
- Requiring users to switch wallets or create new accounts
- Full anonymity (some linkability may remain for regulatory compliance)

---

## Network Compatibility Analysis

### Signature Curves by Network

| Curve | Networks |
|-------|----------|
| **secp256k1** (ECDSA) | Ethereum, Bitcoin, BSC, Polygon, Arbitrum, Optimism, Avalanche, most EVM |
| **ed25519** (EdDSA) | Solana, Sui, Aptos, Near, Polkadot, Cardano, Cosmos/Tendermint, Tezos |
| **secp256r1** (P-256) | WebAuthn/Passkeys, some smart wallets |
| **BLS12-381** | Ethereum consensus, Zcash, Filecoin |

### Approach Compatibility Matrix

| Approach | Ethereum/EVM | Solana/ed25519 | Cosmos | Network-Agnostic |
|----------|--------------|----------------|--------|------------------|
| **zk-ECDSA** | Yes | No | No | No (secp256k1 only) |
| **Semaphore** | Yes (7+ chains) | No | No | No (EVM only) |
| **Stealth Addresses (ERC-5564)** | Yes | No | No | No (EVM only) |
| **BBS+ Credentials** | Yes | Yes | Yes | **Yes** |

**Key insight**: Only BBS+ signatures provide true network-agnostic privacy.

---

## Proposed Approaches

### Approach 1: BBS+ Wallet Identity Credentials (Recommended)

**Alignment**: This approach directly builds on RFC-0018 Phase 2 (BBS+ Signatures).

#### How It Works

1. User authenticates with their native wallet (any network)
2. Zentity issues a **BBS+ signed credential** containing a wallet identity commitment
3. For identity binding, the user generates an **unlinkable derived proof**
4. The proof proves wallet ownership without revealing the address

#### Architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│                     Wallet Binding Flow                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  1. Wallet Authentication (any network)                   │   │
│  │     - Ethereum: EIP-712 signature                        │   │
│  │     - Solana: ed25519 signature                          │   │
│  │     - Cosmos: amino/direct signature                      │   │
│  └──────────────────────────────────────────────────────────┘   │
│                            │                                     │
│                            ▼                                     │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  2. BBS+ Credential Issuance                              │   │
│  │     {                                                     │   │
│  │       "wallet_commitment": hash(address || salt),         │   │
│  │       "network": "ethereum",                              │   │
│  │       "verified_at": "2026-01-19T...",                    │   │
│  │       proof: { type: "BbsBlsSignature2020", ... }         │   │
│  │     }                                                     │   │
│  └──────────────────────────────────────────────────────────┘   │
│                            │                                     │
│                            ▼                                     │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  3. Unlinkable Binding Proof                              │   │
│  │     - Derives BBS+ proof from credential                  │   │
│  │     - Selectively discloses only: verified_at, network    │   │
│  │     - wallet_commitment remains hidden                    │   │
│  │     - Proof is unlinkable to other presentations          │   │
│  └──────────────────────────────────────────────────────────┘   │
│                            │                                     │
│                            ▼                                     │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  4. Identity Binding Circuit                              │   │
│  │     binding_commitment = Poseidon2(                       │   │
│  │       bbs_proof_hash || user_id_hash || document_hash     │   │
│  │     )                                                     │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

#### BBS+ Credential Schema

```json
{
  "@context": [
    "https://www.w3.org/2018/credentials/v1",
    "https://w3id.org/security/bbs/v1"
  ],
  "type": ["VerifiableCredential", "WalletIdentityCredential"],
  "issuer": "did:web:zentity.xyz",
  "issuanceDate": "2026-01-19T12:00:00Z",
  "credentialSubject": {
    "id": "urn:uuid:holder-id",
    "walletCommitment": "0x...",
    "network": "ethereum",
    "chainId": 1,
    "verifiedAt": "2026-01-19T12:00:00Z"
  },
  "proof": {
    "type": "BbsBlsSignature2020",
    "created": "2026-01-19T12:00:00Z",
    "proofPurpose": "assertionMethod",
    "verificationMethod": "did:web:zentity.xyz#bbs-key-1",
    "proofValue": "..."
  }
}
```

#### Privacy Properties

| Property | Value |
|----------|-------|
| **Unlinkability** | Yes – each derived proof is unlinkable |
| **Selective disclosure** | Yes – hide wallet address, reveal network |
| **Multi-show** | Yes – present same credential multiple times without correlation |
| **Network-agnostic** | Yes – works with any wallet signature scheme |

---

### Approach 2: zk-ECDSA Binding (EVM-Only Enhancement)

For EVM chains, add an optional zk-ECDSA proof that proves signature validity without revealing the address.

#### How It Works

1. User signs EIP-712 message with wallet
2. Instead of revealing signature, generate ZK proof that:
   - A valid secp256k1 signature exists for the message
   - The signature commits to the binding data
3. Verifier confirms proof without learning wallet address

#### Implementation Options

| Library | Proving Time | Proof Size | On-chain Verification |
|---------|--------------|------------|----------------------|
| [spartan-ecdsa](https://github.com/personaelabs/spartan-ecdsa) | ~4s browser | Large | No (needs compression) |
| [efficient-zk-ecdsa](https://github.com/personaelabs/efficient-zk-ecdsa) | ~10s browser | Small | Yes |
| [Noir ecrecover](https://github.com/ayushn2/zk_ecdsa) | TBD | Medium | Yes (via UltraHonk) |

#### Noir Circuit (Conceptual)

```noir
use std::ecdsa_secp256k1;

fn main(
    // Private inputs
    signature: [u8; 65],
    message_hash: [u8; 32],

    // Public inputs
    nonce: pub Field,
    binding_commitment: pub Field,
) -> pub bool {
    // Verify signature is valid (ecrecover internally)
    let recovered_address = ecdsa_secp256k1::verify_signature(
        public_key_x,
        public_key_y,
        signature,
        message_hash
    );

    // Compute binding commitment without revealing address
    let address_hash = std::hash::poseidon2([
        recovered_address[0..16],
        recovered_address[16..20]
    ]);

    let expected = std::hash::poseidon2([
        address_hash,
        nonce
    ]);

    assert(expected == binding_commitment);
    true
}
```

#### Limitations

- **secp256k1 only**: Does not work for Solana, Cosmos, etc.
- **Performance**: 4-10s proving time in browser
- **Complexity**: Requires new circuit development and auditing

---

### Approach 3: Semaphore Group Membership (EVM Enhancement)

Use Semaphore protocol for anonymous group membership proofs.

#### How It Works

1. User registers wallet's identity commitment in a Semaphore group
2. For binding, generate ZK proof of group membership + nullifier
3. Nullifier prevents replay; group membership proves wallet ownership
4. No one can link back to specific wallet

#### Semaphore V4 Deployed Networks

**Mainnets**: Ethereum, Arbitrum, Polygon, Optimism, Base, Linea, Gnosis

**Testnets**: Sepolia, Arbitrum Sepolia, Optimism Sepolia, Polygon Amoy, Base Sepolia

#### Limitations

- **EVM-only**: Semaphore contracts only deployed on EVM chains
- **Group management**: Requires on-chain or off-chain group infrastructure
- **UX complexity**: Users must register in groups before binding

---

### Approach 4: Stealth Addresses for Attestations (EVM Enhancement)

Use ERC-5564 stealth addresses for on-chain attestations.

#### How It Works

1. User generates stealth meta-address from wallet
2. For each attestation, derive a one-time stealth address
3. On-chain attestations go to stealth addresses
4. Only the user can link stealth addresses to main wallet

#### Implementations

- [Umbra Cash](https://www.umbra.cash/) – Production, multi-chain
- [Fluidkey](https://fluidkey.com/) – Production, multi-chain

#### Limitations

- **EVM-only**: ERC-5564 is Ethereum-specific
- **Viewing key risk**: Leaked viewing key breaks privacy
- **Funding problem**: Stealth addresses need funding without linking

---

## Recommendation

### Phased Implementation

| Phase | Approach | Networks | Privacy Level | Effort |
|-------|----------|----------|---------------|--------|
| **Phase 1** | Current binding (already unlinkable at commitment level) | All | Medium | Done |
| **Phase 2** | BBS+ Wallet Identity Credentials | All | High | Medium |
| **Phase 3** | zk-ECDSA option (opt-in for EVM users) | EVM only | High | High |
| **Phase 4** | Stealth addresses for on-chain attestations | EVM only | High | Medium |

### Phase 2 Implementation Plan (BBS+)

This phase aligns with RFC-0018 Phase 2 and should be implemented together.

#### Tasks

1. **Integrate BBS+ library**
   - Evaluate: `@mattrglobal/bbs-signatures` (WASM), `@digitalbazaar/bbs-signatures`
   - Add to `package.json` dependencies
   - Create `src/lib/privacy/crypto/bbs-signatures.ts`

2. **Wallet identity credential schema**
   - Define JSON-LD context for `WalletIdentityCredential`
   - Add to OIDC4VCI credential types
   - Implement issuance in `src/lib/trpc/routers/credentials.ts`

3. **Derived proof generation**
   - Implement client-side BBS+ proof derivation
   - Add to wallet binding flow in `src/lib/privacy/crypto/binding-secret.ts`
   - Support selective disclosure of network/chainId only

4. **Update identity binding circuit**
   - Accept BBS+ proof hash as alternative to raw signature
   - Add `binding_type` field: `0=passkey, 1=opaque, 2=wallet_direct, 3=wallet_bbs`

5. **Backward compatibility**
   - Keep current wallet binding as default
   - Add BBS+ as opt-in "enhanced privacy" mode
   - Store credential format preference in user settings

### Phase 2 Implementation Notes

**Implementation completed in:** `apps/web/src/lib/bbs/`

**Key files:**

| File | Purpose |
|------|---------|
| `types.ts` | `WalletIdentitySubject`, `BbsCredential`, `BbsPresentation` types |
| `signer.ts` | `createWalletCredential()` for issuer-side credential creation |
| `holder.ts` | `createPresentation()` for client-side selective disclosure |
| `verifier.ts` | `verifyPresentation()` for server-side validation |
| `client-storage.ts` | IndexedDB storage with `useBbsCredentials` React hook |
| `keygen.ts` | BLS12-381 keypair generation for issuer |
| `serialization.ts` | JSON/base64 encoding for network transport |

**tRPC API:** `crypto.bbs.*` router with 4 procedures:

- `issueCredential` — Issue BBS+ credential for authenticated wallet
- `createPresentation` — Derive selective disclosure presentation
- `verifyPresentation` — Verify presentation proof
- `getIssuerPublicKey` — Retrieve issuer's BLS12-381 public key

**Library:** `@mattrglobal/pairing-crypto` (BLS12-381 SHAKE256 ciphersuite)

**Design deviation from RFC:** The RFC proposed adding `binding_type` as a circuit public input (`0=passkey, 1=opaque, 2=wallet_direct, 3=wallet_bbs`). The actual implementation keeps the identity binding circuit **auth-mode agnostic**:

- Circuit accepts a generic `binding_secret` input
- Domain separation via HKDF info strings (e.g., `zentity-binding-wallet-bbs-v1`)
- Auth mode is NOT revealed as a public output (privacy improvement)
- `AuthMode.WALLET_BBS` enum in `proof-types.ts` for TypeScript layer

This design is architecturally superior:

1. **Privacy**: Auth mode is never exposed in proofs
2. **Simplicity**: Circuit remains unchanged across auth modes
3. **Extensibility**: New auth modes require only TypeScript changes, not circuit recompilation

See `src/lib/bbs/README.md` for comprehensive module documentation.

#### Success Criteria

- [x] BBS+ credentials issued for wallet users
- [x] Unlinkable derived proofs verified in tests
- [x] Multiple presentations to same verifier are unlinkable
- [x] Performance: < 2s for credential issuance, < 500ms for proof derivation
- [x] Backward compatible with existing wallet binding

---

## Security Considerations

### BBS+ Signature Security

- BBS+ is newer than ECDSA; fewer production deployments
- Not post-quantum secure (but privacy properties are quantum-resistant)
- **Mitigation**: Use only audited libraries; monitor for vulnerabilities

### Credential Revocation

- BBS+ credentials need revocation mechanism
- Options: accumulator-based revocation, validity period, status list
- **Recommendation**: Use short validity periods (24-48h) with automatic refresh

### Wallet Commitment Collision

- `walletCommitment = hash(address || salt)` must use unique salt per user
- Salt stored in encrypted secrets alongside wallet association
- **Mitigation**: Generate salt during initial wallet linking

### Linkability via Timing

- Credential issuance timing could leak information
- **Mitigation**: Batch credential refreshes; add random delays

---

## Alternatives Considered

### Alternative 1: Ring Signatures

**Description**: Prove membership in a ring of wallet addresses without revealing which one.

**Rejected**:

- Requires knowing all addresses in the ring
- Proof size grows with ring size
- Limited library support for web

### Alternative 2: Mixnets / Tumblers

**Description**: Route transactions through mixing services.

**Rejected**:

- Regulatory concerns (associated with money laundering)
- Does not address identity binding (only transaction privacy)
- External dependency

### Alternative 3: Account Abstraction (ERC-4337)

**Description**: Use smart contract wallets with privacy features.

**Rejected**:

- EVM-only
- Requires users to migrate to new wallet type
- Does not directly solve binding privacy

---

## Resolved Questions

1. **Should BBS+ be the default for new wallet users, or opt-in only?**
   → **Opt-in** via `BBS_ISSUER_SECRET` environment variable. If the secret is not set, wallet binding uses the existing EIP-712 signature flow.

2. **How should credential refresh work for long-lived wallet associations?**
   → **Short validity periods** (per Security Considerations) with automatic refresh. Credentials are re-issued during each wallet authentication session.

3. **Should we support multiple wallet credentials per user (for multi-chain users)?**
   → **Yes**, supported via IndexedDB storage keyed by `${userId}:${credentialId}`. Each wallet/chain combination can have its own credential.

4. **Integration with RFC-0018: Should `WalletIdentityCredential` be part of the standard credential set?**
   → **Internal-only for now**. Not exposed via OIDC4VCI; used exclusively for identity binding circuit integration. External interoperability deferred to potential future W3C VC-DI-BBS compliant module.

---

## References

- [RFC-0018: Pure SSI - DIDs, BBS+ Signatures, and AnonCreds](0018-pure-ssi-did-bbs-anoncreds.md)
- [BBS Signature Scheme (DIF/IETF)](https://identity.foundation/bbs-signature/draft-irtf-cfrg-bbs-signatures.html)
- [W3C Data Integrity BBS Cryptosuites](https://www.w3.org/TR/vc-di-bbs/)
- [Semaphore Protocol](https://semaphore.pse.dev/)
- [ERC-5564: Stealth Addresses](https://eips.ethereum.org/EIPS/eip-5564)
- [Spartan-ecdsa](https://personaelabs.org/posts/spartan-ecdsa/)
- [zkLogin (Sui)](https://docs.sui.io/concepts/cryptography/zklogin)
