# RFC-0017: Progressive Onboarding + Assurance Levels (Auth/Identity/Proof)

| Field | Value |
|---|---|
| **Status** | Proposed |
| **Created** | 2026-01-12 |
| **Updated** | 2026-01-12 |
| **Owner** | Zentity product + platform |

## Summary

Today, Zentity’s primary onboarding path strongly encourages (and in practice, requires) **document upload** and **liveness** early. Many users are uncomfortable providing sensitive identity inputs upfront, especially before they understand the product.

This RFC proposes:

1) A **progressive onboarding model** where users can create an account and access a limited dashboard first, then complete verification incrementally.
2) A standardized, explainable “level” system based on widely used assurance concepts:
   - **Authentication strength** (AAL-like)
   - **Identity proofing strength** (IAL-like)
   - **Cryptographic proof/evidence completeness** (ZK/FHE/on-chain attestation)
3) A cryptography impact analysis showing what must change (and what **does not** need to change) to support incremental verification.

## Why this matters

- **Conversion + trust**: asking for ID + liveness at the first interaction is high-friction and causes drop-off.
- **Clear authorization**: we need an understandable way to say “you can log in, but you can’t perform X until you reach Level Y”.
- **Crypto correctness**: ZK proofs, signed claims, and FHE ciphertexts must remain correct and auditable when verification happens later and in stages.

## Goals

- Allow users to:
  - start with **anonymous or email-optional** onboarding,
  - create an account (passkey/OPAQUE),
  - reach a “dashboard-access” state **without** document upload or liveness,
  - later complete verification inside the dashboard to unlock regulated/audit features.
- Introduce a level taxonomy that cleanly separates:
  - authentication assurance (how strongly we know it’s the same user),
  - identity assurance (how strongly we know who the user is),
  - proof/evidence assurance (what cryptographic artifacts exist and are policy-bound).
- Preserve current privacy guarantees: no server-decryptable PII; proof replay protection; policy binding.

## Non-goals

- Claiming formal compliance with NIST/eIDAS/ISO frameworks (we can be “inspired by” them, but we are not a certified identity provider).
- Changing primitives (Noir/UltraHonk/TFHE) unless strictly required.
- Defining legal KYC requirements per jurisdiction (this RFC is engineering/product architecture).

---

## Current system (code-grounded analysis)

### 1) Onboarding flow and where it is “hard-gated”

**UI stepper**

- Steps are currently: `email` → `id-upload` → `liveness` → `account`
  - `apps/web/src/components/onboarding/stepper-context.tsx`
  - `apps/web/src/components/onboarding/onboarding-wizard.tsx`

**Email can already be skipped**

- The email step supports “Continue without email”.
  - `apps/web/src/components/onboarding/step-email.tsx`

**Liveness can be skipped (design intent), document cannot**

- Server-side onboarding gating is defined in:
  - `apps/web/src/lib/db/onboarding-session.ts` (`STEP_REQUIREMENTS`)
  - `apps/web/src/lib/trpc/routers/onboarding.ts` (`validateStep`)
- Current invariants:
  - `documentProcessed` is required before accessing liveness endpoints and before reaching `account`.
  - `liveness` is not required before reaching `account` (liveness can be “skipped”).

**Important nuance: account creation already supports “no identity docs”**

`StepAccount` is written to operate even when no identity draft exists:

- It always performs key custody + account creation.
- It only runs “finalize identity + generate proofs” when `hasIdentityDocs` is true.
  - `apps/web/src/components/onboarding/step-account.tsx` (`if (hasIdentityDocs) { ... }`)

So the *main UX barrier* is **step access policy**, not the underlying account/crypto client logic.

### 2) How verification artifacts are modeled today

Zentity already treats “verification” as a **set of independent artifacts** (claims, proofs, ciphertexts) rather than one monolithic “verified/unverified” bit:

- **Draft (pre-account)**
  - `identity_verification_drafts`
  - `apps/web/src/lib/db/schema/identity.ts`
  - Created by `identity.prepareDocument` and enriched by `identity.prepareLiveness`.
- **Signed claims (server integrity)**
  - `signed_claims` with types: `ocr_result`, `liveness_score`, `face_match_score`
  - `apps/web/src/lib/crypto/signed-claims.ts`
  - Inserted during finalize/verify flows in `apps/web/src/lib/trpc/routers/identity.ts`
- **ZK proofs (client privacy)**
  - Stored in `zk_proofs`
  - Verified server-side with claim binding + nonce anti-replay:
    - `apps/web/src/lib/trpc/routers/crypto.ts`
    - Circuits: `apps/web/noir-circuits/*/src/main.nr`
- **FHE ciphertexts**
  - Stored in `encrypted_attributes` (types include `dob_days`, `country_code`, `liveness_score`, `compliance_level`)
  - Produced asynchronously by `scheduleFheEncryption`:
    - `apps/web/src/lib/crypto/fhe-encryption.ts`

### 3) “Levels” already exist (but are overloaded)

The system already has a `getVerificationStatus()` that returns:

- `verified: boolean`
- `level: "none" | "basic" | "full"`
- `checks: { document, liveness, ageProof, docValidityProof, nationalityProof, faceMatchProof }`

Source:

- `apps/web/src/lib/db/queries/identity.ts`
- It is exposed to OAuth relying parties via `/oauth2/userinfo` as OIDC4IDA `verified_claims`:
  - `docs/oauth-integrations.md`
  - `apps/web/src/lib/auth/auth.ts` (`oidc4ida`)

**Current limitation:** `level` mixes together identity proofing and cryptographic proof completeness. It also does not describe authentication strength (passkey vs password vs anonymous).

---

## Standards research (how “levels” are commonly named)

Zentity should borrow the *shape* of industry frameworks, even if our internal implementation remains product-specific.

### NIST SP 800-63 (US federal digital identity guidance)

NIST separates assurance into multiple axes:

- **AAL (Authenticator Assurance Level)**: strength of the authenticator (how confidently the claimant controls the account).
- **IAL (Identity Assurance Level)**: strength of identity proofing (how confidently the claimed identity is real and bound to the claimant).
- **FAL (Federation Assurance Level)**: assurances for federated identity assertions.

References:

- NIST SP 800-63-3 overview: <https://pages.nist.gov/800-63-3/>
- NIST SP 800-63B (AAL): <https://pages.nist.gov/800-63-3/sp800-63b.html>
- NIST SP 800-63A (IAL): <https://pages.nist.gov/800-63-3/sp800-63a.html>

### OpenID Connect Identity Assurance (OIDC)

OIDC standardizes how a provider can return **verified claims** and **evidence** about identity proofing/verification.

Reference:

- OpenID Connect for Identity Assurance 1.0: <https://openid.net/specs/openid-connect-4-identity-assurance-1_0.html>

### eIDAS (EU)

eIDAS describes assurance levels for electronic identification means:

- **low**
- **substantial**
- **high**

References:

- eIDAS overview (European Commission): <https://digital-strategy.ec.europa.eu/en/policies/eidas-regulation>
- Implementing Regulation defining assurance levels: <https://eur-lex.europa.eu/eli/reg_impl/2015/1502/oj>

### ISO/IEC 29115

ISO/IEC 29115 defines an assurance framework for entity authentication (often referenced in IAM programs).

Reference:

- ISO/IEC 29115 (overview): <https://www.iso.org/standard/45138.html>

---

## Proposed model: separate “account access tiers” from assurance axes

### Key design principle

**A single integer “Level 0/1/2/3” is not expressive enough** to represent:

- authentication strength (passkey vs password vs session-only anonymous),
- identity proofing depth (none vs document vs document+liveness),
- cryptographic evidence completeness (signed claims vs ZK proofs vs on-chain attestation).

However, product UX and authorization rules *do* benefit from a single **derived tier**.

So we propose:

1) Track **assurance axes** (authn, identity, proof/evidence) explicitly.
2) Derive a single **Access Tier** for UX + authorization (“what can I do right now?”).

### 1) Assurance axes (recommended internal representation)

#### Auth assurance (AAL-like)

We can derive this from Better Auth session characteristics:

- `session.user.isAnonymous`
- last login method (passkey vs OPAQUE vs magic link vs SIWE)
- optional 2FA state (`twoFactorEnabled`)

Proposed (illustrative) mapping:

- `authAAL0`: no session
- `authAAL1`: password (OPAQUE) or magic link
- `authAAL2`: passkey (WebAuthn) or SIWE + additional app constraints
- `authAAL3`: reserved (phishing-resistant + hardware-backed + strict verifier impersonation resistance)

Note: this is *inspired by* NIST AAL; it is not a certification claim.

#### Identity assurance (IAL-like)

Proposed internal identity proofing stages:

- `identityIAL0`: no identity evidence
- `identityIAL1`: self-asserted (user-entered profile fields, if we ever support this)
- `identityIAL2`: document verified (OCR claims) + liveness + face match passed
- `identityIAL3`: reserved (in-person / issuer-backed credentials / higher bar)

#### Evidence/proof assurance (PAL-like, Zentity-specific)

This captures “how cryptographically portable/auditable is the verification result?”

- `proofPAL0`: no signed claims, no proofs
- `proofPAL1`: server-signed claims exist (OCR/liveness/face-match claims)
- `proofPAL2`: ZK proofs verified and stored (age/doc-validity/nationality/face-match)
- `proofPAL3`: on-chain attestation confirmed (optional Web3 layer)

### 2) Derived Access Tiers (single number for UX + authorization)

We can derive a product-facing tier `accountTier: 0..3`:

- **Tier 0 (Explore)**: no account; public browsing
- **Tier 1 (Account)**: authenticated + keys secured, but no identity proofing yet
  - dashboard access
  - can store sealed profile + FHE keys
  - cannot attest on-chain, cannot mint, cannot present “verification scope” as verified
- **Tier 2 (Verified Identity)**: identity proofing done (doc + liveness + face match), but proofs may be incomplete
  - can see verification in dashboard
  - can generate/store ZK proofs to reach Tier 3
- **Tier 3 (Auditable)**: identity proofing + ZK proof set complete and policy-bound
  - eligible for on-chain attestation (`attestation.submit`)
  - eligible for token minting (`token.mint`)

This keeps the UX simple without losing the safety benefits of explicit axes.

---

## Progressive onboarding UX (what changes)

### Proposed user journey

**Phase A: account-first**

1) Start session (anonymous or email optional).
2) Create account (passkey/OPAQUE).
3) Generate and secure FHE keys + sealed profile (can be mostly empty initially).
4) Land on dashboard at **Tier 1**.

**Phase B: verification later**

From dashboard, user enters a “Complete verification” flow:

1) Upload document → OCR signed claim(s) + draft
2) Liveness + face match → signed claim(s)
3) Generate ZK proofs client-side (Noir) + store server-side
4) Trigger FHE encryption job (DOB days, country code, liveness score, compliance level)
5) Reach **Tier 3**

**Phase C: audit / Web3 optional**

- On-chain attestation + compliance-gated actions only after Tier 3.

### Where authorization gates already exist (good news)

The most sensitive actions already require full verification:

- `attestation.submit` rejects if `getVerificationStatus().verified` is false:
  - `apps/web/src/lib/trpc/routers/attestation.ts`
- `token.mint` rejects if `getVerificationStatus().verified` is false:
  - `apps/web/src/lib/trpc/routers/token.ts`

So progressive onboarding can be introduced mostly by:

- relaxing “must do doc early” gating for basic dashboard access,
- ensuring dashboard communicates clearly *why* a feature is locked.

---

## Cryptography impact analysis (can we “add info later”?)

### TL;DR

**Yes — the current cryptographic design already supports incremental verification** because artifacts are modular and policy-bound:

- The system stores **signed claims** and **ZK proofs** independently.
- Proofs are bound to:
  - a **server-issued nonce** (anti-replay),
  - a **server-signed claim hash** (integrity binding),
  - a **document hash field** (document binding),
  - a **policy version** (upgrade safety).

This means a user can generate/store additional proofs later without invalidating prior work (subject to policy versioning and document selection rules).

### ZK proofs: why “later” works

Each ZK circuit uses:

- a private value (e.g., birth year),
- a private `document_hash` field element,
- public inputs including a **nonce** and **claim_hash**.

Example circuits:

- `apps/web/noir-circuits/age_verification/src/main.nr`
- `apps/web/noir-circuits/doc_validity/src/main.nr`
- `apps/web/noir-circuits/nationality_membership/src/main.nr`
- `apps/web/noir-circuits/face_match/src/main.nr`

Server verification enforces:

- nonce validity and one-time use (`zk_challenges`)
- claim hash matches the appropriate signed claim (OCR or face match)
- policy minimums (e.g., min age, min face threshold)

Source:

- `apps/web/src/lib/trpc/routers/crypto.ts` (`verifyProofInternal`, `storeProof`)

**Result:** proofs are safe to generate “on demand” after account creation, as long as:

- the user can access the underlying private input (from fresh OCR extraction or from the sealed profile),
- the corresponding signed claim exists for the selected document,
- the user requests a new nonce and stores the proof within its validity window.

### FHE ciphertexts: why “later” works

Ciphertexts are generated server-side via an async job:

- `apps/web/src/lib/crypto/fhe-encryption.ts`

The job can run later because:

- ciphertexts are not baked into ZK proofs (they are separate artifacts),
- the job re-encrypts when needed (e.g., key changes or missing ciphertext),
- it already reacts to new proof storage via `scheduleFheEncryption(...)`:
  - `apps/web/src/lib/trpc/routers/crypto.ts` (after storing proofs)
  - `apps/web/src/lib/trpc/routers/identity.ts` (after identity verification/finalization)

Important detail:

- Some inputs (DOB days, country code) are not stored in plaintext by design; they must be computed at verification time from OCR output and/or sealed profile.
- Therefore, post-onboarding verification must ensure those values are available to the server-side encryption scheduler (as they are today in `identity.verify` and `identity.finalizeAsync` flows).

### Evidence bundle hashes: why “later” works

When a proof is stored, the server computes/updates an evidence hash:

- `proofSetHash = SHA256(sorted(proofHashes) + policyHash)`
  - `apps/web/src/lib/trpc/routers/crypto.ts`

Adding proofs later naturally updates the proof set and therefore the evidence hash.

This is compatible with progressive onboarding and is aligned with RFC-0013 (verification bundle UX).

---

## Implementation options (recommended path first)

### Option 1 (recommended): Split “Account” from “Verification”

- `/sign-up` creates account + key custody only (Tier 1).
- `/dashboard/verification` runs the existing verification flow, but as an in-dashboard experience.
- Verification uses its own “verification session” concept (can reuse current wizard session model; no need to unify with Better Auth yet).

Pros:

- Lowest user friction.
- Minimal cryptographic changes.
- Preserves current privacy boundary: verification images are still transient.

Cons:

- Requires UX work + permission gating polish.
- Requires clear dashboard state messaging to avoid confusion.

### Option 2: Keep single wizard, but allow skipping doc/liveness up front

- Keep current stepper but allow: `email` → `account` (skip), with “complete verification later” entry point.
- `id-upload` and `liveness` become optional steps that can be done later.

Pros:

- Fewer new routes/pages.
- Reuses existing wizard code heavily.

Cons:

- More complex stepper states (“done later” vs “failed” vs “skipped”).
- Current step-access validation (`STEP_REQUIREMENTS`) will need careful refactor to avoid security regressions.

### Option 3: Full session unification with Better Auth

See internal ADR:

- `docs/internal/adr-onboarding-session-unification.md`

Not required for progressive onboarding; defer unless we need cross-device resume.

---

## Risks and edge cases

- **Sybil/abuse**: letting users create accounts without verification increases spam risk.
  - Mitigation: rate limits, feature throttles for Tier 1, per-IP and per-device caps, delayed expensive operations.
- **User confusion**: “I’m logged in but can’t do X” must be explained by tier/requirements UI.
- **Policy version upgrades**: proofs are policy-version bound; if `POLICY_VERSION` changes, users may need re-verification or proof regeneration.
- **Document selection**: progressive flows increase likelihood of multiple document attempts; selection policy must be explicit (RFC-0013).
- **Revocation/expiry**: levels must consider revoked/expired documents and evidence (RFC-0013).

---

## Concrete next steps (engineering)

1) Define `AssuranceProfile` (auth/identity/proof axes) and `accountTier` derivation in one place.
   - This can initially be computed at request time from existing DB + session fields.
2) Update dashboard to show:
   - current tier,
   - missing requirements as actionable steps (“Upload ID”, “Complete liveness”, “Generate ZK proofs”).
3) Decide between Option 1 vs Option 2 for the UI flow split.
4) Ensure verification flows can run post-signup:
   - either by allowing the existing wizard session to be started from dashboard,
   - or by introducing a new verification session mechanism.
5) Keep `getVerificationStatus()` for backwards compatibility (OAuth claims), but consider augmenting it with assurance axes over time.
