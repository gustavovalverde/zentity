# RFC-0018: Pure SSI - DIDs, BBS+ Signatures, and AnonCreds

| Field | Value |
|-------|-------|
| **Status** | Proposed |
| **Created** | 2026-01-14 |
| **Updated** | 2026-01-14 |
| **Author** | Gustavo Valverde |

## Summary

This RFC documents the remaining features to achieve full interoperability with the broader SSI ecosystem: **Decentralized Identifiers (DIDs)**, **BBS+ signatures**, and **AnonCreds** support. These are optional enhancements that build on Zentity's existing SSI foundation.

## Current State

Zentity already implements the core SSI principles:

- **Non-custodial key custody** via passkey-derived encryption
- **Verifiable credentials** via OIDC4VCI (SD-JWT VC format)
- **Selective disclosure** via SD-JWT disclosure keys
- **Portable presentations** via OIDC4VP
- **Anti-correlation** via pairwise subject identifiers (`sub` per RP)
- **Threshold recovery** via FROST guardians

The system is fully functional for SSI use cases. The features in this RFC extend interoperability with DID-native ecosystems and provide advanced privacy features.

## Problem Statement

While Zentity implements SSI principles, some ecosystems and use cases require:

1. **DIDs**: Systems built on W3C DID standards expect resolvable DID documents
2. **BBS+ signatures**: Use cases requiring unlinkable multi-show presentations
3. **AnonCreds**: Hyperledger Indy/Aries ecosystem compatibility

These are **optional enhancements**, not requirements for SSI compliance.

## Goals

- Define a phased approach to DID support
- Evaluate BBS+ for advanced privacy scenarios
- Document AnonCreds considerations
- Maintain backward compatibility with existing OIDC4VCI/VP flow

## Non-Goals

- Replacing the existing credential infrastructure
- Requiring DIDs for basic credential operations
- Full Hyperledger stack integration
- Blockchain-based DID methods as primary identifiers

---

## Gap Analysis

### 1. Decentralized Identifiers (DIDs)

**What**: User-created, globally unique identifiers that are cryptographically verifiable without a central registry.

**Current state**:

- Zentity uses internal `user_id` (UUID) plus pairwise `sub` per RP
- Pairwise identifiers already provide anti-correlation benefits
- No DID document generation or resolution

**Why it matters**:

- Interoperability with DID-native verifiers
- Issuer verification via DID resolution
- Standards alignment (W3C DID Core)

**Impact**: Medium — affects interop with DID-based systems

**Effort**: Low — DID documents can be generated from existing data

### 2. BBS+ Signatures

**What**: A signature scheme that enables **unlinkable selective disclosure**. Unlike SD-JWT where disclosures are linked across presentations, BBS+ allows the same credential to be presented multiple times without correlation.

**Current state**:

- SD-JWT provides selective disclosure but presentations are linkable
- Pairwise `sub` reduces but doesn't eliminate correlation

**Why it matters**:

- Privacy-sensitive use cases (healthcare, voting, anonymous surveys)
- Multiple presentations to the same verifier without linking
- Advanced privacy beyond selective disclosure

**Impact**: High for advanced privacy use cases

**Effort**: Medium-High — requires new signature scheme and credential format

### 3. AnonCreds

**What**: Hyperledger Indy's credential format with built-in ZK proofs, predicates, and revocation.

**Current state**:

- Not supported
- Zentity uses OIDC4VCI with SD-JWT VC

**Why it matters**:

- Compatibility with Hyperledger Aries agents
- Established enterprise deployments
- Built-in predicate proofs (e.g., "age > 18" without revealing age)

**Impact**: Medium — specific ecosystem interop

**Effort**: High — different credential model, requires Indy SDK or alternatives

---

## Proposed Approach

### Phase 1: DIDs (Recommended)

Implement DID support using low-effort methods that leverage existing infrastructure.

#### did:web

**Format**: `did:web:zentity.xyz`

**DID Document hosted at**: `https://zentity.xyz/.well-known/did.json`

```json
{
  "@context": ["https://www.w3.org/ns/did/v1"],
  "id": "did:web:zentity.xyz",
  "verificationMethod": [{
    "id": "did:web:zentity.xyz#key-1",
    "type": "JsonWebKey2020",
    "controller": "did:web:zentity.xyz",
    "publicKeyJwk": { /* issuer signing key */ }
  }],
  "authentication": ["did:web:zentity.xyz#key-1"],
  "assertionMethod": ["did:web:zentity.xyz#key-1"]
}
```

**Benefits**:

- No blockchain required
- Leverages existing HTTPS infrastructure
- Easy to implement (static file or dynamic endpoint)

**Trade-offs**:

- Relies on DNS and TLS (not fully decentralized)
- Server availability affects resolution

#### did:key (for holders)

**Format**: `did:key:z6Mk...` (derived from Ed25519 public key)

**Use case**: Holder binding in credentials

```json
{
  "cnf": {
    "kid": "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK"
  }
}
```

**Benefits**:

- Self-certifying (no resolution needed)
- Compact representation
- Perfect for holder binding

#### Implementation Tasks

1. Add `/.well-known/did.json` endpoint for issuer DID
2. Generate did:key from holder public keys
3. Include DID in credential `issuer` and `cnf.kid` fields
4. Update JWKS to include DID verification methods

### Phase 2: BBS+ Signatures (Optional)

Evaluate and potentially implement BBS+ for use cases requiring unlinkable presentations.

#### Evaluation Criteria

| Criterion | Requirement |
|-----------|-------------|
| Library maturity | Production-ready, audited |
| Browser support | WASM or native JS |
| Standards alignment | W3C BBS+ draft or IETF |
| Performance | Acceptable for mobile/web |

#### Candidate Libraries

- **@mattrglobal/bbs-signatures** — Mature, WASM-based
- **@digitalbazaar/bbs-signatures** — W3C aligned
- **anoncreds-rs** — Rust with WASM bindings

#### Implementation Approach

1. Add BBS+ as alternative credential format (alongside SD-JWT)
2. Expose format choice in credential offer
3. Update OIDC4VCI metadata to advertise BBS+ support
4. Implement holder-side BBS+ presentation

#### Credential Format

```json
{
  "type": ["VerifiableCredential", "ZentityIdentityCredential"],
  "issuer": "did:web:zentity.xyz",
  "credentialSubject": {
    "verified": true,
    "verification_level": "full"
  },
  "proof": {
    "type": "BbsBlsSignature2020",
    "proofPurpose": "assertionMethod",
    "verificationMethod": "did:web:zentity.xyz#bbs-key-1",
    "proofValue": "..."
  }
}
```

### Phase 3: AnonCreds (Optional, Future)

Evaluate demand before implementation.

#### Considerations

- Requires significant infrastructure (Indy ledger or alternatives)
- Different credential lifecycle than OIDC4VCI
- May conflict with existing privacy model (Indy ledger is public)

#### Alternative: Predicate Proofs via ZK

Zentity already supports ZK predicate proofs (age, nationality group, etc.) via Noir circuits. These provide similar functionality to AnonCreds predicates without the Indy dependency.

**Recommendation**: Document AnonCreds as "evaluate on demand" rather than planned work.

---

## Security Considerations

### DID Security

- **did:web**: Relies on TLS; compromised DNS/TLS allows impersonation
- **did:key**: Self-certifying; secure as long as private key is protected
- **Mitigation**: Use did:web for issuer (controlled infrastructure), did:key for holders

### BBS+ Security

- BBS+ is newer than EdDSA/ECDSA; fewer production deployments
- Requires careful implementation to avoid side-channel attacks
- **Mitigation**: Use audited libraries only; monitor for vulnerabilities

### Backward Compatibility

- Existing SD-JWT credentials remain valid
- DIDs are additive (don't break existing `sub` identifiers)
- BBS+ is opt-in credential format

---

## Migration Path

### For Existing Users

- No migration required
- Existing credentials continue to work
- DIDs are additive enhancement

### For New Credentials

- Issuer DID automatically included
- Holder DID derived from public key
- Format choice (SD-JWT vs BBS+) at issuance time

---

## Success Criteria

### Phase 1 (DIDs)

- [ ] Issuer DID resolvable at `did:web:zentity.xyz`
- [ ] Holder DIDs included in credentials (`cnf.kid`)
- [ ] DID verification methods match JWKS keys
- [ ] Existing OIDC4VCI flow unchanged

### Phase 2 (BBS+)

- [ ] BBS+ format advertised in issuer metadata
- [ ] Credential offer supports format selection
- [ ] Unlinkable presentations verified in tests
- [ ] Performance acceptable for web/mobile

### Phase 3 (AnonCreds)

- [ ] Demand assessment completed
- [ ] Decision documented (implement / defer / reject)

---

## Alternatives Considered

### did:ion / did:ethr / did:indy

**Rejected**: Blockchain-based DIDs add complexity and dependencies without clear benefit for Zentity's use case. did:web provides sufficient decentralization for credential verification.

### Full Hyperledger Stack

**Rejected**: Would require replacing the entire credential infrastructure. The existing OIDC4VCI approach is more interoperable with the broader ecosystem.

### Custom ZK Credentials

**Considered**: Zentity already has Noir circuits for ZK proofs. A custom ZK credential format could provide BBS+-like unlinkability. **Decision**: Evaluate alongside BBS+ in Phase 2.

---

## Open Questions

1. Should did:web include user-specific paths (e.g., `did:web:zentity.xyz:users:abc123`)?
2. Is there demand for BBS+ from current or prospective users?
3. Should we support multiple DID methods simultaneously?

---

## References

- [W3C DID Core](https://www.w3.org/TR/did-core/)
- [did:web Method Specification](https://w3c-ccg.github.io/did-method-web/)
- [did:key Method Specification](https://w3c-ccg.github.io/did-method-key/)
- [BBS+ Signatures](https://www.w3.org/TR/vc-di-bbs/)
- [AnonCreds Specification](https://hyperledger.github.io/anoncreds-spec/)
- [SSI Architecture](../ssi-architecture.md)
