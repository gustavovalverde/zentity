# OpenAC (zkID/PSE) vs Zentity: Comparative Analysis

> **Paper**: "OpenAC: Open Design for Transparent and Lightweight Anonymous Credentials"
> **Authors**: The zkID Team @ PSE, Ethereum Foundation (November 24, 2025)
> **Source**: https://github.com/privacy-ethereum/zkID/blob/main/paper/zkID.pdf

## Executive Summary

OpenAC proposes a **generic anonymous credential framework** that wraps existing digital identity systems (W3C VCs, SD-JWT, mDL) with zero-knowledge proofs to enable **unlinkable selective disclosure** without modifying issuer workflows. Zentity is a **privacy-preserving compliance/KYC platform** that uses ZK proofs, FHE, and passkey-based key custody for identity verification without exposing PII.

The two systems target **different layers of the identity stack**: OpenAC operates at the **credential presentation layer** (how to prove things about existing credentials), while Zentity operates at the **identity verification and compliance layer** (how to verify identity and attest compliance). They are complementary rather than competing — OpenAC could serve as a presentation protocol *within* a system like Zentity.

---

## 1. Architecture Comparison

### 1.1 Core Design Philosophy

| Aspect | OpenAC | Zentity |
|--------|--------|---------|
| **Primary goal** | Unlinkable selective disclosure from existing credentials | Privacy-preserving identity verification + compliance |
| **Target domain** | Generic credential presentation (EUDI, mDL, W3C VC) | KYC/AML compliance (financial services, Web3) |
| **Trust model** | Issuer trusted, verifiers semi-honest | Server trusted for integrity, not for plaintext access |
| **Credential source** | Pre-existing signed credentials (SD-JWT, mDL) | Self-attested + server-verified (OCR, liveness, face match) |
| **Key innovation** | Prepare/Show split with proof re-randomization | Multi-layer crypto stack (ZK + FHE + credential-wrapped keys) |

### 1.2 Role Mapping

| OpenAC Role | Zentity Equivalent | Notes |
|-------------|-------------------|-------|
| **Issuer** (signs credentials) | **Server** (signs OCR claims, liveness claims) | OpenAC assumes a pre-existing issuer with PKI; Zentity's server acts as the issuer via signed claims |
| **Holder/Prover** (wallet) | **Browser** (Web Worker) | Both generate proofs client-side |
| **Verifier** (relying party) | **Server** (proof verification) + **Relying Parties** (OAuth) | Zentity has a dual role: first-party verifier and proxy for third-party RPs via OAuth |

---

## 2. Feature-by-Feature Comparison

### 2.1 Unlinkability

| Property | OpenAC | Zentity | Gap Assessment |
|----------|--------|---------|----------------|
| **Cross-presentation unlinkability** | **Core feature.** Pedersen commitment re-randomization ensures each presentation is unlinkable | **Not implemented.** Proofs are stored server-side with user association; presentations to different RPs via OAuth are linkable by the server | **Major gap.** Zentity's proofs are tied to user identity via identity_binding circuit. Colluding verifiers (or the server itself) can link presentations |
| **Re-randomizable proofs** | Yes — Hyrax commitments re-randomized per session via `prepareBatch` | No — each proof is generated fresh but with deterministic binding to user identity | **Significant gap.** No mechanism for proof re-randomization |
| **Verifier collusion resistance** | Explicitly modeled — per-presentation re-randomization prevents linkability | Not modeled — server sees all proofs and can link them | **Major gap** |

**Impact**: This is the single largest architectural difference. Zentity's identity_binding circuit is *designed* to prevent replay but simultaneously creates a stable identifier that enables linking. OpenAC treats unlinkability as a primary security goal.

### 2.2 Credential Model

| Property | OpenAC | Zentity | Gap Assessment |
|----------|--------|---------|----------------|
| **Credential format** | SD-JWT, mDL (ISO 18013-5), W3C VC | Custom server-signed claims (Poseidon2 claim hashes) | **Different approach.** Zentity doesn't use standard credential formats |
| **Issuer compatibility** | Zero changes to existing issuers — wraps existing signatures | N/A — Zentity *is* the issuer | **Not comparable** — different design points |
| **Signature scheme** | Verifies ECDSA/RSA in-circuit | No in-circuit signature verification | **Gap.** Zentity trusts server-signed claims; no in-circuit verification of issuer signatures |
| **Standard VC support** | Native (SD-JWT parsing, mDL parsing in-circuit) | None — custom attestation format | **Gap for interoperability** |

### 2.3 Proof System

| Property | OpenAC | Zentity | Gap Assessment |
|----------|--------|---------|----------------|
| **Proof system** | Spartan (sum-check IOP) + Hyrax Pedersen commitments | UltraHonk (Barretenberg) via Noir | **Different choices**, both valid |
| **Trusted setup** | **None** (transparent) | **None** (UltraHonk is also transparent, no trusted setup) | **Parity** |
| **Circuit frontend** | Circom → R1CS | Noir → UltraHonk | Both are viable DSLs |
| **Prepare/Show split** | Yes — heavy work (sig verification, parsing) amortized offline; Show is ~100ms | No — all proofs generated from scratch per verification | **Gap.** Zentity regenerates full proofs each time; no amortization |
| **Mobile proving** | Explicitly benchmarked: Show ~99ms (iPhone 17), ~340ms (Pixel 10 Pro) | Web Worker-based, no published mobile benchmarks | **Gap in evidence** — Zentity lacks mobile optimization data |
| **Proof size** | Show: ~40 kB; Prepare: ~109 kB (1920-byte credential) | Not documented per-circuit | **Information gap** |
| **Post-quantum path** | Explicit: modular design allows swapping Pedersen for lattice-based commitments | Not addressed | **Gap** — no PQ migration strategy documented |

### 2.4 Commitment Scheme

| Property | OpenAC | Zentity | Gap Assessment |
|----------|--------|---------|----------------|
| **Commitment type** | Pedersen vector commitments (perfectly hiding, computationally binding) | SHA-256 hash commitments + Poseidon2 for ZK | **Significant difference** |
| **Hiding property** | **Perfectly hiding** (information-theoretic) | **Computationally hiding** (SHA-256) | **Gap.** SHA-256 commitments are not information-theoretically hiding |
| **Re-randomization** | Native — Pedersen commitments can be re-randomized | Not possible — SHA-256 commitments are deterministic (with salt) | **Major gap** for unlinkability |
| **Selective disclosure** | Any subset of committed attributes can be disclosed/proven | Fixed per-circuit disclosures (age, nationality, doc validity, face match) | **Gap in flexibility** — Zentity circuits are purpose-built |

### 2.5 Device Binding

| Property | OpenAC | Zentity | Gap Assessment |
|----------|--------|---------|----------------|
| **Mechanism** | Secure element ECDSA signature on session challenge, verified in-circuit | Passkey PRF / OPAQUE export key / wallet signature → HKDF → binding secret, verified in identity_binding circuit | **Both strong**, different approaches |
| **Hardware requirement** | Secure element (e.g., iPhone SE, Android TEE) | WebAuthn authenticator (passkey) or wallet | **Zentity more flexible** — supports software credentials |
| **Auth mode agnosticism** | ECDSA only (device key pair) | Passkey, OPAQUE, wallet, wallet+BBS+ | **Zentity advantage** — multi-mode support |
| **In-circuit verification** | Yes — ECDSA.verify(σ_nonce, PKD) in show circuit | Indirect — Poseidon2 commitment verification, not signature verification | **Different** — OpenAC verifies a live signature; Zentity verifies a pre-registered commitment |

### 2.6 Privacy Properties

| Property | OpenAC | Zentity | Gap Assessment |
|----------|--------|---------|----------------|
| **Zero-knowledge** | Formal proof sketch (Section 3.3) | No formal security proof | **Gap** — Zentity should formalize privacy guarantees |
| **Soundness** | Proved via Spartan soundness | Relies on Noir/Barretenberg soundness (not formally analyzed in-house) | **Gap in documentation** |
| **Unlinkability** | Formal definition and construction | Not a design goal | **Fundamental difference** |
| **Issuer-verifier collusion** | Addressed via optional Merkle tree of issuer keys | Not addressed (server is both issuer and verifier) | **Structural difference** |
| **Auth mode hiding** | N/A (single device binding mode) | Yes — auth mode not revealed in proof | **Zentity advantage** |

### 2.7 Regulatory Compliance

| Property | OpenAC | Zentity | Gap Assessment |
|----------|--------|---------|----------------|
| **EUDI ARF compliance** | Comprehensive mapping (50+ requirements in Annex 2) | Not targeted | **Different market** |
| **KYC/AML** | Not addressed (out of scope) | Core feature — tiered assurance levels, compliance attestation | **Zentity advantage** for financial use cases |
| **On-chain attestation** | Not addressed | Yes — fhEVM encrypted attestation, ACL-controlled access | **Zentity advantage** |
| **FHE for encrypted compliance** | Not addressed | Yes — homomorphic age/threshold checks without decryption | **Zentity advantage** |

---

## 3. Where Zentity Lacks Compared to OpenAC

### 3.1 Critical Gaps

#### Gap 1: No Unlinkability Between Presentations
**OpenAC**: Proof re-randomization ensures that even colluding verifiers cannot determine if two presentations came from the same user.
**Zentity**: The `identity_binding` circuit explicitly ties proofs to `user_id_hash`, `msg_sender_hash`, and `audience_hash`. The server stores all proofs and can trivially link them. Even with the OAuth layer, the Zentity server acts as a central linkability point.

**Recommendation**: Consider adding a BBS+ or Pedersen-commitment-based presentation layer for disclosures to third-party relying parties. The existing BBS+ wallet binding (`src/lib/bbs/`) could be expanded to support unlinkable presentations.

#### Gap 2: No Prepare/Show Amortization
**OpenAC**: Heavy cryptographic work (issuer signature verification, credential parsing, commitment computation) is done **once per credential** in the Prepare phase. The online Show phase takes only ~100ms on mobile.
**Zentity**: Every verification generates all five proofs from scratch in a Web Worker. There is no amortization — if a user needs to prove age to multiple relying parties, the full proof generation cost is incurred each time.

**Recommendation**: Implement a two-phase proving architecture. Cache prepared proof artifacts (witness + commitment) and only regenerate the presentation-specific components (predicate evaluation, nonce binding) per session.

#### Gap 3: No Standard Credential Format Support
**OpenAC**: Natively wraps SD-JWT, mDL (ISO 18013-5), and W3C VCs. In-circuit verification of ECDSA/RSA issuer signatures.
**Zentity**: Uses custom claim hashes (`Poseidon2(value, documentHash)`) signed by the server. No support for standard verifiable credential formats.

**Recommendation**: Add a circuit that can verify externally-issued SD-JWT or mDL credentials. This would allow Zentity to accept government-issued digital IDs directly, rather than requiring re-verification via OCR.

#### Gap 4: No Formal Security Proof
**OpenAC**: Provides security analysis sketches for correctness, soundness, zero-knowledge, and unlinkability (Sections 3.2.2, 3.3).
**Zentity**: Relies on the underlying soundness of Noir/Barretenberg without in-house formal analysis. Privacy properties are stated but not proven.

**Recommendation**: Commission or produce a formal security analysis of the Zentity proof system, particularly the identity_binding circuit and the claim-hash binding mechanism.

### 3.2 Moderate Gaps

#### Gap 5: No Pedersen Vector Commitments
**OpenAC**: Uses Pedersen vector commitments which are perfectly hiding (information-theoretically secure) and support re-randomization.
**Zentity**: Uses SHA-256 hash commitments which are only computationally hiding and cannot be re-randomized. Poseidon2 is used within circuits for claim binding but not for verifier-facing commitments.

**Impact**: Pedersen commitments enable the full suite of anonymous credential features (re-randomization, selective disclosure, proof-of-same-attribute across credentials). SHA-256 commitments are simpler but less flexible.

#### Gap 6: No Post-Quantum Migration Strategy
**OpenAC**: Explicitly designed for modularity — the commitment layer can be swapped from Pedersen to lattice-based alternatives. The paper discusses this path in Section 2.2.
**Zentity**: No documented post-quantum migration strategy. BN254 curve is not post-quantum secure, and there is no modular abstraction to swap the proof backend.

#### Gap 7: No Cross-Credential Linking Proofs
**OpenAC**: The commitment scheme supports proving relationships *across* credentials (e.g., "the name on my driver's license matches the name on my passport") without revealing the name.
**Zentity**: Each proof operates on a single document. No mechanism to prove cross-document relationships.

#### Gap 8: No Revocation Mechanism
**OpenAC**: Discusses revocation as a core AC property — the issuer can revoke credentials, and subsequent presentations must reflect updated attributes.
**Zentity**: No credential revocation mechanism. Once verified, the attestation persists until manually removed. The evidence pack captures a point-in-time snapshot but doesn't support ongoing revocation checks.

### 3.3 Minor/Contextual Gaps

#### Gap 9: No Mobile-Specific Benchmarks
**OpenAC**: Benchmarked on iPhone 17 and Pixel 10 Pro with concrete latency numbers.
**Zentity**: Proof generation runs in Web Workers but no mobile benchmark data is published.

#### Gap 10: No Offline Verification Support
**OpenAC**: Discusses deferred/offline verification scenarios where the verifier can check proofs without live network access.
**Zentity**: All verification requires the server (nonce issuance, claim hash validation, proof storage). No offline verification path.

---

## 4. Where Zentity Exceeds OpenAC

### 4.1 FHE for Encrypted Computation
Zentity's FHE layer (TFHE-rs) enables **server-side computation on encrypted data** — a capability entirely absent from OpenAC. This allows:
- Homomorphic age threshold checks without decrypting DOB
- Encrypted compliance level evaluation
- On-chain encrypted attestation (fhEVM)

### 4.2 On-Chain Attestation
Zentity provides a complete **blockchain attestation pipeline** with:
- FHE-encrypted identity attributes on fhEVM
- ACL-controlled access to ciphertexts
- ComplianceRules contracts that evaluate on encrypted data
- Silent compliance failure (no information leakage on rejection)

OpenAC makes no mention of blockchain integration.

### 4.3 Multi-Auth Mode Support
Zentity supports three authentication modes (passkey, OPAQUE password, wallet) with auth-mode-agnostic ZK binding. The identity_binding circuit accepts any binding secret without revealing which auth mode was used. OpenAC only supports ECDSA device binding.

### 4.4 Complete KYC Pipeline
Zentity implements a full identity verification flow:
- Document OCR → Liveness detection → Face matching → ZK proofs → FHE encryption → Attestation

OpenAC provides only the credential presentation layer and assumes credentials already exist.

### 4.5 Key Recovery (FROST)
Zentity's FROST threshold recovery system with a four-tier guardian model provides a recovery mechanism for lost credentials. OpenAC does not address key recovery.

### 4.6 OAuth/OIDC Integration
Zentity acts as an OAuth 2.1 / OIDC provider, enabling third-party relying parties to verify identity through standard protocols. OpenAC's presentation protocol would need to be wrapped in such a standard for practical deployment.

---

## 5. Complementarity and Integration Opportunities

OpenAC and Zentity solve different problems and could be **integrated** rather than chosen between:

### 5.1 Use OpenAC for RP-Facing Presentations
Zentity's current OAuth flow discloses boolean proof flags or PII to relying parties through server mediation. This creates a linkability point (the Zentity server sees all disclosures).

**Integration**: After Zentity verifies identity and generates its attestation, it could issue a **standard SD-JWT credential** to the user's wallet. The user could then use **OpenAC's Prepare/Show protocol** to present this credential to relying parties in an unlinkable manner, bypassing the Zentity server entirely for subsequent presentations.

### 5.2 Use Zentity's FHE for OpenAC's Compliance Gap
OpenAC acknowledges that compliance (KYC/AML) is out of scope. Zentity's FHE-based compliance layer could serve as the **policy engine** that sits behind OpenAC's verifier, evaluating compliance rules on encrypted attributes.

### 5.3 Use OpenAC's Credential Circuit for External VCs
Zentity currently performs its own OCR-based identity verification. If a user already has a government-issued mDL or EUDI credential, OpenAC's in-circuit signature verification could allow Zentity to **accept external credentials** without re-verification, reducing friction and increasing trust.

---

## 6. Summary Matrix

| Dimension | OpenAC | Zentity | Winner |
|-----------|--------|---------|--------|
| Unlinkability | Re-randomizable proofs | Deterministic binding | **OpenAC** |
| Selective disclosure flexibility | Any attribute/predicate | Fixed per-circuit | **OpenAC** |
| Credential interoperability | SD-JWT, mDL, W3C VC | Custom format | **OpenAC** |
| Trusted setup | None (transparent) | None (UltraHonk) | **Tie** |
| Formal security analysis | Proof sketches | None | **OpenAC** |
| Proof amortization | Prepare/Show split | Full reprove each time | **OpenAC** |
| Post-quantum readiness | Modular, documented path | Not addressed | **OpenAC** |
| FHE encrypted computation | Not addressed | Full TFHE-rs integration | **Zentity** |
| Blockchain attestation | Not addressed | fhEVM + ACL | **Zentity** |
| KYC/AML compliance | Not addressed | Full pipeline | **Zentity** |
| Multi-auth support | ECDSA device key only | Passkey + OPAQUE + wallet | **Zentity** |
| Key recovery | Not addressed | FROST guardians | **Zentity** |
| OAuth/OIDC integration | Not addressed | Full provider | **Zentity** |
| Mobile optimization | Benchmarked (99ms Show) | No published benchmarks | **OpenAC** |
| Revocation | Discussed as requirement | Not implemented | **OpenAC** |
| Cross-credential proofs | Supported via commitments | Not supported | **OpenAC** |

---

## 7. Prioritized Recommendations

Based on impact and feasibility:

1. **High priority**: Add unlinkable presentation layer for OAuth disclosures (address Gap 1). Consider issuing SD-JWT credentials that can be presented via an OpenAC-like protocol.

2. **High priority**: Implement Prepare/Show proof amortization (address Gap 2). Cache prepared artifacts per credential, regenerate only session-specific components.

3. **Medium priority**: Add formal security analysis documentation (address Gap 4). Even informal proof sketches would significantly strengthen the trust model.

4. **Medium priority**: Support external credential formats — SD-JWT at minimum (address Gap 3). This enables accepting government-issued digital IDs.

5. **Medium priority**: Add credential revocation mechanism (address Gap 8). Integrate with issuer revocation lists or on-chain revocation registries.

6. **Lower priority**: Migrate to Pedersen vector commitments for verifier-facing data (address Gap 5). This is a prerequisite for full unlinkability.

7. **Lower priority**: Document post-quantum migration strategy (address Gap 6). Identify which components need replacement and design modular abstractions.

8. **Lower priority**: Publish mobile benchmarks (address Gap 9). Essential for wallet-based deployment scenarios.
