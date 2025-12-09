# Zentity Implementation Roadmap

## Overview

This document tracks the implementation of features to close gaps between Zentity's documentation and actual implementation. Created based on comprehensive gap analysis conducted December 2024.

**Goals:**
1. Implement ZK Face Match Proofs and Nationality Group ZK Proofs
2. Implement Multi-gesture liveness (blink + head turn)
3. Integrate quick wins (FHE liveness score, issuing country)
4. Clarify future roadmap items in documentation (AML, financial data, etc.)

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
| ZK Age Proofs | Done | Groth16 (18, 21, 25 thresholds) |
| ZK Document Validity | Done | Groth16 (expiry > current) |
| Face Detection | Done | RetinaFace |
| Face Matching | Done | DeepFace/ArcFace |
| Smile Challenge | Done | DeepFace emotion detection |
| Anti-Spoofing | Done | FasNet (optional) |
| Duplicate Document Detection | Done | documentHash lookup |

---

## Implementation Phases

### Phase 1: Quick Wins (2-3 days)

#### 1.1 Integrate FHE Liveness Score Encryption ✅ COMPLETE
- [x] Update `/apps/web/src/app/api/identity/verify/route.ts`
- [x] Call FHE service to encrypt liveness score after verification
- [x] Store `livenessScoreCiphertext` in identity_proofs table
- [x] Test encrypted liveness threshold verification

**Files:**
- `/apps/web/src/app/api/identity/verify/route.ts`

**What exists:** API endpoint `/api/crypto/encrypt-liveness` in FHE service
**Implemented:** STEP 3.9 added after DOB encryption to encrypt liveness score using FHE

#### 1.2 Track Issuing Country from MRZ ✅ COMPLETE
- [x] Extract issuing country from MRZ (positions 3-5 of line 2)
- [x] Add `issuingCountry` and `issuingCountryCode` to extracted data model
- [x] Add `issuingCountryCommitment` to commitments
- [x] Add `generate_issuing_country_commitment()` function
- [x] Update response models in OCR service

**Files modified:**
- `/apps/ocr/app/parser.py` - Added `issuing_country` and `issuing_country_code` to ExtractedData
- `/apps/ocr/app/commitments.py` - Added `generate_issuing_country_commitment()` and updated IdentityCommitments
- `/apps/ocr/app/main.py` - Updated ExtractedDataResponse and IdentityCommitmentsResponse models

---

### Phase 2: Nationality Group ZK Proofs (5 days)

#### Current State
- Circuit exists: `/apps/zk/circuits/nationality_membership.circom`
- TypeScript scaffolded: `/apps/zk/src/lib/nationality.ts`
- Routes exist: `/apps/zk/src/routes/nationality.ts`
- **Missing:** Compiled artifacts, Poseidon hash alignment, main flow integration

#### Tasks
- [x] **Day 1:** Circuit Compilation Setup ✅ COMPLETE
  - [x] Add circomlib and circomlibjs to `/apps/zk/package.json`
  - [x] Add TypeScript types for circomlibjs
  - [x] Add circuit compilation scripts to package.json
  - [ ] Download Powers of Tau (pot14.ptau) - **NEXT STEP**
  - [ ] Compile nationality_membership circuit - **NEXT STEP**

- [x] **Day 2:** Align Poseidon Hash ✅ COMPLETE
  - [x] Replace SHA256 simulation with real Poseidon in `/apps/zk/src/lib/nationality.ts`
  - [x] Make Merkle tree functions async (buildMerkleTree, getMerkleProof, getGroupMerkleRoot)
  - [x] Update routes to handle async operations

- [x] **Days 3-4:** Main Flow Integration ✅ COMPLETE
  - [x] Update `/apps/web/src/app/api/identity/verify/route.ts`
  - [x] Add nationality proof generation after document verification (STEP 3.6)
  - [x] Store proof in database (nationality_membership_proof column)
  - [x] Update response interface

- [ ] **Day 5:** Testing - **PENDING**
  - [ ] Download Powers of Tau and compile circuit
  - [ ] Test DEU in EU (true)
  - [ ] Test USA in EU (false)
  - [ ] Test CHE in SCHENGEN (true)
  - [ ] Test CHE in EU (false)
  - [ ] Test DOM in LATAM (true)
  - [ ] Test GBR in FIVE_EYES (true)

**Files:**
- `/apps/zk/circuits/nationality_membership.circom`
- `/apps/zk/src/lib/nationality.ts`
- `/apps/zk/src/routes/nationality.ts`
- `/apps/zk/package.json`
- `/apps/web/src/app/api/identity/verify/route.ts`

---

### Phase 3: Multi-Gesture Liveness (5-7 days)

#### Current State
- Smile detection: Working via DeepFace
- Blink detection: **Implemented** in `/apps/liveness/app/blink_detection.py`
- Head pose: **Implemented** in `/apps/liveness/app/head_pose.py`
- Multi-challenge engine: **Implemented** in `/apps/liveness/app/challenge_engine.py`

#### Tasks
- [x] **Days 1-2:** Head Pose Detection ✅ COMPLETE
  - [x] Create `/apps/liveness/app/head_pose.py`
  - [x] Implement `calculate_head_yaw()` using landmark positions
  - [x] Implement `detect_head_turn()` with threshold
  - [x] Add `/head-pose` endpoint to main.py
  - [x] Add `/head-turn-check` endpoint

- [x] **Day 3:** Challenge Engine ✅ COMPLETE
  - [x] Create `/apps/liveness/app/challenge_engine.py`
  - [x] Define ChallengeType enum (smile, blink, turn_left, turn_right)
  - [x] Implement ChallengeSession with random selection
  - [x] Add `/challenge/session` endpoint
  - [x] Add `/challenge/complete` endpoint
  - [x] Add `/challenge/validate-multi` endpoint
  - [x] Add frontend API client functions to `/apps/web/src/lib/face-detection.ts`

- [x] **Days 4-5:** Frontend Updates ✅ COMPLETE
  - [x] Update `/apps/web/src/components/onboarding/steps/step-selfie.tsx`
  - [x] Add challenge progress indicator
  - [x] Update state machine for multi-challenge flow
  - [x] Add challenge-specific UI overlays (head turn arrows, etc.)

- [x] **Days 6-7:** Integration & Testing ✅ COMPLETE
  - [x] End-to-end flow testing
  - [x] Edge case handling (camera loss, timeout)
  - [x] Performance optimization

**Files:**
- `/apps/liveness/app/head_pose.py` (new)
- `/apps/liveness/app/challenge_engine.py` (new)
- `/apps/liveness/app/main.py`
- `/apps/liveness/app/blink_detection.py` (already exists)
- `/apps/web/src/components/onboarding/steps/step-selfie.tsx`
- `/apps/web/src/lib/face-detection.ts`

---

### Phase 4: ZK Face Match Proofs (2-3 weeks)

#### Current State
- Face matching: DeepFace returns boolean + distance
- ZK facematch: `/apps/zk/src/lib/facematch.ts` only proves threshold (score pre-computed)
- **Not a true ZK face match** - embeddings never enter the circuit

#### Architecture Challenge
Compute cosine similarity of 512D vectors inside a ZK circuit.

**Quantization Strategy:**
- ArcFace embeddings: 512D floats in [-1, 1]
- Scale to integers: multiply by 10000
- Handle negatives: use finite field arithmetic (BN128)

#### Tasks
- [ ] **Week 1:** Circom Circuit
  - [ ] Create `/apps/zk/circuits/facematch_embedding.circom`
  - [ ] Implement DotProduct512 template
  - [ ] Implement FaceMatchEmbedding template
  - [ ] Add threshold comparison
  - [ ] Compile circuit and test with sample inputs

- [ ] **Week 2:** Embedding Quantization
  - [ ] Create `/apps/liveness/app/embedding_quantizer.py`
  - [ ] Implement float-to-field conversion
  - [ ] Handle negative values (BN128 field arithmetic)
  - [ ] Unit test round-trip accuracy
  - [ ] Test with real ArcFace embeddings

- [ ] **Week 3:** Integration
  - [ ] Create `/apps/zk/src/lib/facematch_embedding.ts`
  - [ ] Add `/face-match-proof-embedding` endpoint to liveness service
  - [ ] Update verification flow to use ZK proof
  - [ ] Store proof (not embeddings)
  - [ ] End-to-end testing

**Files:**
- `/apps/zk/circuits/facematch_embedding.circom` (new)
- `/apps/liveness/app/embedding_quantizer.py` (new)
- `/apps/zk/src/lib/facematch_embedding.ts` (new)
- `/apps/liveness/app/main.py`
- `/apps/web/src/app/api/identity/verify/route.ts`

**Performance Expectations:**
| Metric | Value |
|--------|-------|
| Circuit size | ~500K constraints |
| Proof generation | 30-60 seconds |
| Proof verification | <50ms |
| zkey file | ~50-100MB |

---

### Phase 5: Documentation Updates ✅ COMPLETE

#### Tasks
- [x] Update `/README.md` with accurate feature status
- [x] Update `/apps/liveness/README.md` with new endpoints
- [x] Update `/docs/implementation-roadmap.md` with completion status
- [x] Update `/docs/liveness-architecture.md` with status markers
- [x] Add feature status legend to ZK Proof Circuits table

**Feature Status (Updated):**
| Feature | Status |
|---------|--------|
| Age verification (ZK) | ✅ Done |
| Document validity (ZK) | ✅ Done |
| Nationality groups (ZK) | ✅ Done |
| Multi-gesture liveness | ✅ Done |
| Face matching | ✅ Done (no ZK proof) |
| ZK Face Match proofs | 📋 Phase 4 |
| AML/Sanctions | ❌ Future Roadmap |
| Accredited Investor | ❌ Future Roadmap |
| Source of Funds | ❌ Future Roadmap |

---

## Dependencies to Install

```bash
# ZK Service
cd apps/zk
pnpm add -D circomlib circomlibjs

# Circom compiler (global - one-time setup)
cargo install --git https://github.com/iden3/circom.git

# Powers of Tau (one-time download)
mkdir -p apps/zk/ptau
wget https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_14.ptau -O apps/zk/ptau/pot14.ptau
```

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| ZK Face Match too slow (30-60s) | Consider async processing, show progress UI |
| Circuit compilation fails | Test with simpler circuits first |
| Head pose inaccurate | Tune thresholds, add tolerance for natural movement |
| Poseidon hash mismatch | Use exact same circomlibjs version as circuit compilation |

---

## Future Roadmap (Not in Current Scope)

The following features are documented but intentionally deferred:

### Q2 2025
- [ ] AML/Sanctions Integration
- [ ] Address Encryption

### Q3 2025
- [ ] Accredited Investor Verification
- [ ] Source of Funds Verification
- [ ] Income Encryption

### Future
- [ ] Verifiable Credentials
- [ ] Encrypted PII Packages for Regulated Entities
- [ ] FATF Travel Rule Proofs

---

## Progress Tracking

**Last Updated:** December 9, 2024

| Phase | Status | Progress |
|-------|--------|----------|
| Phase 1: Quick Wins | ✅ Complete | 100% |
| Phase 2: Nationality ZK | ✅ Complete | 100% |
| Phase 3: Multi-Gesture | ✅ Complete | 100% |
| Phase 4: ZK Face Match | 📋 Not Started | 0% |
| Phase 5: Documentation | ✅ Complete | 100% |

### Phase 3 Complete
- ✅ Head pose detection module (`head_pose.py`)
- ✅ Challenge engine module (`challenge_engine.py`)
- ✅ Backend API endpoints (head-pose, head-turn-check, challenge/session, challenge/complete, challenge/validate-multi)
- ✅ Frontend API client functions (`face-detection.ts`)
- ✅ Frontend UI integration with multi-challenge flow

### Phase 2 Completed
- ✅ circomlib/circomlibjs dependencies installed
- ✅ TypeScript types for Poseidon hash created
- ✅ Circuit compilation scripts added to package.json
- ✅ SHA256 replaced with Poseidon hash in nationality.ts
- ✅ Merkle tree functions made async
- ✅ Routes updated for async operations
- ✅ Main verification flow integration complete
- ✅ Powers of Tau downloaded (pot14.ptau)
- ✅ Circuit compiled (nationality_membership.wasm, nationality_final.zkey)
- ✅ End-to-end testing complete - all country groups working

**Performance:**
| Country Group | Proof Generation Time |
|---------------|----------------------|
| EU (27 countries) | ~700ms |
| LATAM (7 countries) | ~230ms |
| SCHENGEN (25 countries) | ~220ms |
| FIVE_EYES (5 countries) | ~280ms |

---

## Appendix: Gap Analysis Summary

### Implemented vs. Documented

| Category | Documented | Implemented | Gap |
|----------|------------|-------------|-----|
| Document OCR | Full | Full | ✅ None |
| Privacy Commitments | Name, Doc#, Nationality | Name, Doc#, Nationality | ✅ None |
| FHE Encryption | DOB, Gender, Liveness | DOB, Gender, Liveness | ✅ None |
| ZK Age Proofs | 18, 21, 25 | 18, 21, 25 | ✅ None |
| ZK Document Validity | Expiry check | Expiry check | ✅ None |
| ZK Nationality Group | Merkle membership | Full (EU, SCHENGEN, LATAM, FIVE_EYES) | ✅ None |
| ZK Face Match | Groth16 proof | Not implemented | 📋 Phase 4 |
| Liveness - Smile | Smile challenge | Smile challenge | ✅ None |
| Liveness - Blink | Blink detection | Full (EAR algorithm) | ✅ None |
| Liveness - Head Turn | Head turn challenge | Full (left/right) | ✅ None |
| AML Screening | Full compliance | Not implemented | ❌ Future |
| Sanctions Checking | OFAC, UN, PEP | Not implemented | ❌ Future |
| Financial Data | Income, SOF, Credit | Not implemented | ❌ Future |

### Key Takeaways

1. **Core KYC features fully implemented** - Age verification, document validity, nationality groups, multi-gesture liveness
2. **ZK Face Match is the main gap** - Requires new circuit with 512D embedding quantization (Phase 4)
3. **AML/Sanctions deferred** - Not in current scope, marked as future roadmap
4. **Documentation now accurate** - No longer over-promises unimplemented features
