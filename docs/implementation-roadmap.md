# Zentity Implementation Roadmap

## Overview

This document tracks the implementation of features for Zentity's privacy-preserving KYC platform.

**Goals:**
1. Complete ZK Face Match Proofs with embedding verification
2. Expand liveness detection capabilities
3. Clarify future roadmap items (AML, financial data, etc.)

---

## Current Implementation Status

### What's Working

| Feature | Status | Notes |
|---------|--------|-------|
| OCR Text Extraction | Done | RapidOCR + PPOCRv5 |
| MRZ Parsing | Done | mrz library (ICAO 9303) |
| Document Type Detection | Done | Passport, National ID, Driver's License |
| Field Extraction | Done | Name, DOB, Doc#, Nationality, Expiry, Gender |
| Document Validation | Done | python-stdnum (30+ countries) |
| Name Commitment | Done | SHA256(name + salt) |
| Document Hash | Done | SHA256(doc# + salt) |
| Nationality Commitment | Done | SHA256(nationality + salt) |
| FHE Birth Year Encryption | Done | TFHE-rs |
| FHE Full DOB Encryption | Done | TFHE-rs (YYYYMMDD) |
| FHE Gender Encryption | Done | TFHE-rs (ISO 5218) |
| ZK Age Proofs | Done | Noir/UltraHonk (client-side) |
| ZK Document Validity | Done | Noir/UltraHonk (client-side) |
| ZK Nationality Groups | Done | Noir/UltraHonk (client-side, Merkle proof) |
| ZK Face Match | Done | Noir/UltraHonk (threshold proof, not embeddings) |
| Face Detection | Done | Human.js (RetinaFace via tfjs-node) |
| Face Matching | Done | Human.js (ArcFace) |
| Smile Challenge | Done | Human.js emotion detection |
| Blink Detection | Done | Human.js EAR algorithm |
| Head Turn Detection | Done | Human.js head pose |
| Anti-Spoofing | Done | Human.js (optional) |
| Duplicate Document Detection | Done | documentHash lookup |

---

## Implementation Phases

### Phase 1: ZK Face Match with Embeddings (Future)

**Current State:**
- Face matching returns boolean + distance
- ZK proof only proves threshold (score pre-computed)
- Embeddings never enter the circuit

**Goal:**
Compute cosine similarity of 512D vectors inside a ZK circuit.

**Quantization Strategy:**
- ArcFace embeddings: 512D floats in [-1, 1]
- Scale to integers: multiply by 10000
- Handle negatives: use finite field arithmetic

**Tasks:**
- [ ] Create `face_match_embedding` Noir circuit
  - Implement DotProduct512 for cosine similarity
  - Add threshold comparison
- [ ] Create embedding quantizer
  - Float-to-field conversion
  - Handle negative values
  - Test round-trip accuracy
- [ ] Integration
  - Update verification flow to use ZK proof
  - Store proof (not embeddings)
  - End-to-end testing

**Files:**
- `apps/web/noir-circuits/face_match_embedding/` (new)
- `apps/web/src/lib/embedding-quantizer.ts` (new)

**Performance Expectations:**
| Metric | Value |
|--------|-------|
| Circuit size | ~500K constraints |
| Proof generation | 30-60 seconds |
| Proof verification | <50ms |

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| ZK Face Match too slow (30-60s) | Consider async processing, show progress UI |
| Embedding quantization precision loss | Test with real ArcFace embeddings first |

---

## Future Roadmap (Not in Current Scope)

The following features are documented but intentionally deferred:

### Q2 2026
- [ ] AML/Sanctions Integration
- [ ] Address Encryption

### Q3 2026
- [ ] Accredited Investor Verification
- [ ] Source of Funds Verification
- [ ] Income Encryption

### Future
- [ ] Verifiable Credentials
- [ ] Encrypted PII Packages for Regulated Entities
- [ ] FATF Travel Rule Proofs

---

## Progress Tracking

**Last Updated:** December 2025

| Phase | Status | Progress |
|-------|--------|----------|
| Phase 1: ZK Face Match Embeddings | Not Started | 0% |

---

## Appendix: Feature Status Summary

| Category | Documented | Implemented | Gap |
|----------|------------|-------------|-----|
| Document OCR | Full | Full | None |
| Privacy Commitments | Name, Doc#, Nationality | Name, Doc#, Nationality | None |
| FHE Encryption | DOB, Gender, Liveness | DOB, Gender, Liveness | None |
| ZK Age Proofs | 18, 21, 25 | 18, 21, 25 | None |
| ZK Document Validity | Expiry check | Expiry check | None |
| ZK Nationality Group | Merkle membership | Full (EU, SCHENGEN, LATAM, FIVE_EYES) | None |
| ZK Face Match | Threshold proof | Threshold proof | None |
| ZK Face Match (Embeddings) | Full embedding proof | Not implemented | Phase 1 |
| Liveness - Smile | Smile challenge | Smile challenge | None |
| Liveness - Blink | Blink detection | Full (EAR algorithm) | None |
| Liveness - Head Turn | Head turn challenge | Full (left/right) | None |
| AML Screening | Full compliance | Not implemented | Future |
| Sanctions Checking | OFAC, UN, PEP | Not implemented | Future |
| Financial Data | Income, SOF, Credit | Not implemented | Future |

### Key Takeaways

1. **Core KYC features fully implemented** - Age verification, document validity, nationality groups, multi-gesture liveness
2. **ZK Face Match with embeddings is the main gap** - Requires new circuit with 512D embedding quantization
3. **AML/Sanctions deferred** - Not in current scope, marked as future roadmap
