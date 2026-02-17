# RFC-0026: Identity Assurance Lifecycle

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Created** | 2026-02-15 |
| **Updated** | 2026-02-15 |
| **Author** | Gustavo Valverde |
| **Related** | [RFC-0017](0017-progressive-onboarding-assurance-levels.md), [RFC-0013](0013-verification-ux-evidence-bundle.md), [RFC-0025](0025-dual-track-compliance-architecture.md), [RFC-0009](0009-credential-sealed-profile-pii.md), [RFC-0005](0005-background-jobs.md) |

---

## Summary

Zentity's assurance model (RFC-0017) computes identity tiers as a point-in-time snapshot: "what artifacts exist right now?" It has no concept of **freshness**, **degradation**, or **lifecycle events**. A user verified in January is indistinguishable from one verified today. Credential changes, policy upgrades, screening staleness, and attestation expiry are all ignored.

This RFC introduces **lifecycle-aware assurance** — the ability to detect when a previously valid verification has become stale, when credentials have changed, when policy has evolved, and when re-verification is required. All lifecycle evaluation happens at **request time** (no background jobs), consistent with Zentity's privacy-first design where the server cannot access PII without the user present.

---

## Problem Statement

### What works today

RFC-0017 established a clean two-axis model:

- **Account Tier (0–2)**: derived from artifact existence (session, FHE keys, identity proofs)
- **Auth Strength (basic/strong)**: derived from login method (passkey vs. others)

This is implemented in `apps/web/src/lib/assurance/` and works well for initial verification and feature gating.

### What's missing

The current model treats assurance as a **boolean that never expires**. Once a user reaches Tier 2, they stay there indefinitely regardless of:

1. **Time elapsed** — No freshness check. A 12-month-old verification is treated identically to a fresh one. The schema has `lastVerifiedAt`, `nextVerificationDue`, and `verificationCount` fields in `identity_bundles` — but nothing reads or writes them.

2. **Credential changes** — Deleting a passkey, changing a password, or revoking a wallet has zero impact on assurance level. No detection of authenticator downgrade (strong → basic) or credential loss.

3. **Policy evolution** — `policyVersion` is stored on ZK proofs and identity bundles, but existing proofs are never invalidated when the policy advances. Users with stale-policy proofs retain full tier.

4. **Screening staleness** — `pepScreenedAt` and `sanctionsScreenedAt` exist in the schema but are never evaluated against a freshness threshold.

5. **Attestation expiry** — `attestationExpiresAt` is stored but never checked.

6. **Federation assurance** — When relying parties query Zentity via OIDC, there's no `verification.time` or `assurance_level` metadata in the response. RPs cannot assess how fresh the identity assertion is.

### Why this matters

- **Regulatory**: AML directives (AMLD5/6) require periodic re-verification. eIDAS 2.0 defines assurance level maintenance requirements.
- **Security**: Stale verifications accumulate risk. A compromised document or changed biometric should trigger re-proofing.
- **Trust**: Relying parties need to know assertion freshness. An RP making a lending decision needs different assurance than one checking age.
- **Standards alignment**: NIST SP 800-63 treats identity assurance as a lifecycle (proofing → maintenance → re-proofing), not a one-time event.

---

## Goals

- Introduce **verification freshness** with configurable staleness thresholds and tier degradation.
- Detect **credential lifecycle events** (addition, removal, downgrade) and reflect them in assurance state.
- Enforce **policy version currency** — flag users whose proofs were generated under a superseded policy.
- Evaluate **screening freshness** against configurable thresholds.
- Check **attestation expiry** at query time.
- Extend the `AssuranceState` type to include lifecycle metadata for both internal gating and OIDC4IDA disclosure.
- Do all of this at **request time** — no background jobs, no server-side PII access.

## Non-goals

- Background batch re-verification (conflicts with privacy model — server can't decrypt without user).
- Automated re-screening (requires external API integration; this RFC defines the freshness check, not the screening itself).
- Changing ZK circuits or cryptographic primitives.
- Defining jurisdiction-specific re-verification schedules (this RFC provides the mechanism; policy configuration is separate).

---

## Design

### Core principle: request-time lifecycle evaluation

Zentity's privacy model means the server cannot access PII without the user present. This rules out background batch processing for re-verification. Instead, lifecycle assurance is evaluated **every time** assurance state is computed:

```text
Current:   artifacts → computeAssuranceState() → { tier, authStrength }

Proposed:  artifacts → computeAssuranceState() → rawState
           rawState + lifecycle checks → applyLifecyclePolicy() → effectiveState
```

When the effective tier is lower than the raw tier, the user sees a degradation reason and a call-to-action to re-verify.

### 1) Verification freshness

#### Schema changes

Populate the existing (unused) `identity_bundles` fields:

| Field | When written | Value |
|-------|-------------|-------|
| `lastVerifiedAt` | `finalizeProcedure` completes | Current timestamp |
| `nextVerificationDue` | `finalizeProcedure` completes | `lastVerifiedAt` + configured interval |
| `verificationCount` | `finalizeProcedure` completes | Increment by 1 |

#### Freshness policy

```typescript
interface FreshnessPolicy {
  /** Max age before verification is considered stale (days) */
  maxVerificationAge: number;
  /** Warning threshold before expiry (days) */
  warningThreshold: number;
}
```

Default: `maxVerificationAge: 365`, `warningThreshold: 30`.

These are configurable per deployment (environment variable or config). Regulated deployments (banks) might use 90 days; low-risk deployments might use 730.

#### Effect on tier

If `lastVerifiedAt` is older than `maxVerificationAge`:

- Raw Tier 2 degrades to **effective Tier 1** (account-only)
- `degradationReasons` includes `"verification_stale"`
- User sees "Your verification has expired — please re-verify" on dashboard

If within `warningThreshold` of expiry:

- No tier degradation
- `warnings` includes `"verification_expiring_soon"`
- User sees a non-blocking notice

### 2) Credential lifecycle events

#### What to track

Add a `credential_events` audit log (append-only):

| Column | Type | Description |
|--------|------|-------------|
| `id` | text | Primary key |
| `userId` | text | FK to users |
| `eventType` | text | `added`, `removed`, `changed` |
| `credentialType` | text | `passkey`, `opaque`, `wallet` |
| `occurredAt` | text | ISO timestamp |

#### Auth strength tracking

The system already knows auth strength at login time. Add tracking for **highest historical auth strength**:

- New field `highestAuthStrength` on `identity_bundles` (or derived from credential events)
- If a user once had `strong` (passkey) and now only has `basic` (password), flag `authStrengthDowngraded: true`

#### Effect on assurance

Auth strength downgrade does **not** degrade tier (the user still has valid proofs), but:

- `warnings` includes `"auth_strength_downgraded"`
- Features requiring `strongAuth` remain gated (already implemented)
- OIDC4IDA responses reflect the current (lower) AAL

### 3) Policy version enforcement

#### Current state

- `POLICY_VERSION` is set as a constant
- ZK proofs store `policyVersion` at creation time
- Proof verification rejects mismatched versions for *new* proofs
- **Existing stored proofs are never invalidated**

#### Proposed behavior

When computing assurance, compare each stored proof's `policyVersion` against the current `POLICY_VERSION`:

```typescript
const proofsUnderCurrentPolicy = storedProofs.every(
  p => p.policyVersion === CURRENT_POLICY_VERSION
);
```

If `proofsUnderCurrentPolicy` is false:

- Raw Tier 2 degrades to **effective Tier 1**
- `degradationReasons` includes `"policy_version_outdated"`
- User sees "Verification policy has been updated — please re-verify"

This is a deliberate design choice: when policy changes (e.g., minimum age threshold raised, new proof type required), users must re-prove under the new policy. Their old proofs are not deleted — they're simply not counted toward the current tier.

### 4) Screening freshness

#### Current state

`identity_bundles` has `pepScreenedAt` and `sanctionsScreenedAt` but they're never evaluated.

#### Proposed behavior

```typescript
interface ScreeningPolicy {
  /** Max age for PEP screening (hours) */
  maxPepScreeningAge: number;
  /** Max age for sanctions screening (hours) */
  maxSanctionsScreeningAge: number;
}
```

Default: `maxPepScreeningAge: 24`, `maxSanctionsScreeningAge: 24`.

If screening is stale:

- No tier degradation (screening is orthogonal to identity proofing)
- `warnings` includes `"pep_screening_stale"` or `"sanctions_screening_stale"`
- Compliance-sensitive features (e.g., on-chain attestation for regulated RPs) can gate on `screeningCurrent`

### 5) Attestation expiry

#### Current state

`attestationExpiresAt` is stored in `identity_bundles` but never checked.

#### Proposed behavior

If `attestationExpiresAt` is in the past:

- `details.onChainAttested` becomes `false` in the effective state
- `degradationReasons` includes `"attestation_expired"`
- User sees "Your on-chain attestation has expired — renew it"

### 6) OIDC4IDA lifecycle metadata

Extend the OIDC4IDA `verified_claims` response with lifecycle fields per [OpenID Connect for Identity Assurance 1.0](https://openid.net/specs/openid-connect-4-identity-assurance-1_0.html):

```json
{
  "verified_claims": {
    "verification": {
      "trust_framework": "zentity_kyc",
      "assurance_level": "verified",
      "time": "2026-01-15T10:30:00Z",
      "verification_process": "document_liveness_zk",
      "evidence": [...]
    },
    "claims": { ... }
  }
}
```

Key additions:

- `time` — When verification was last performed (`lastVerifiedAt`)
- `assurance_level` — Maps from effective tier: `"none"` / `"account"` / `"verified"`
- RPs can evaluate freshness themselves based on `time`

---

## Extended AssuranceState type

```typescript
interface AssuranceState {
  // Existing (unchanged)
  tier: AccountTier;
  tierName: TierName;
  authStrength: AuthStrength;
  loginMethod: LoginMethod | "none";
  details: VerificationDetails;

  // New: lifecycle
  lifecycle: AssuranceLifecycle;
}

interface AssuranceLifecycle {
  /** Effective tier after lifecycle policy applied (may be lower than tier) */
  effectiveTier: AccountTier;

  /** Days since last verification, null if never verified */
  verificationAgeDays: number | null;

  /** Whether verification exceeds the staleness threshold */
  isVerificationStale: boolean;

  /** When re-verification is due, null if never verified */
  nextVerificationDue: string | null;

  /** Whether all stored proofs match the current POLICY_VERSION */
  proofsUnderCurrentPolicy: boolean;

  /** Whether user's auth strength has degraded from a previous high */
  authStrengthDowngraded: boolean;

  /** Whether PEP/sanctions screening is within threshold */
  screeningCurrent: boolean;

  /** Whether on-chain attestation has expired */
  attestationExpired: boolean;

  /** Reasons the effective tier is lower than the raw tier */
  degradationReasons: DegradationReason[];

  /** Non-blocking warnings */
  warnings: LifecycleWarning[];
}

type DegradationReason =
  | "verification_stale"
  | "policy_version_outdated"
  | "attestation_expired";

type LifecycleWarning =
  | "verification_expiring_soon"
  | "auth_strength_downgraded"
  | "pep_screening_stale"
  | "sanctions_screening_stale";
```

---

## Implementation plan

### Phase 1: Verification freshness + policy enforcement

**Effort: Small. Highest impact.**

1. Write `lastVerifiedAt`, `nextVerificationDue`, `verificationCount` in `finalizeProcedure`
2. Read these in `data.ts` alongside existing queries
3. Add `applyLifecyclePolicy()` in a new `lifecycle.ts` module
4. Extend `computeAssuranceState()` to return lifecycle metadata
5. Compare proof `policyVersion` against current in the same pass
6. Update dashboard to show degradation banners
7. Update `features.ts` to gate on `effectiveTier` instead of `tier`

### Phase 2: Credential events + auth downgrade detection

**Effort: Medium.**

1. Add `credential_events` table
2. Write events from credential CRUD operations (passkey add/remove, OPAQUE change, wallet link/unlink)
3. Derive `authStrengthDowngraded` from event history
4. Surface warning in dashboard

### Phase 3: Screening freshness + attestation expiry

**Effort: Small.**

1. Add screening age check in `applyLifecyclePolicy()`
2. Add attestation expiry check
3. Surface warnings and gating

### Phase 4: OIDC4IDA lifecycle metadata

**Effort: Medium. Depends on Phase 1.**

1. Extend `customIdTokenClaims` and userinfo hooks to include `verification.time` and `assurance_level`
2. Map `effectiveTier` to OIDC4IDA assurance level string
3. Include `verification_process` evidence type

---

## Relationship to other RFCs

| RFC | Relationship |
|-----|-------------|
| **RFC-0017** (Assurance Levels) | This RFC extends 0017's point-in-time model with lifecycle awareness. The tier computation in `compute.ts` remains the "raw" tier; this RFC adds a lifecycle layer on top. |
| **RFC-0013** (Verification Bundle) | 0013 proposed revocation/expiration states for the verification bundle. This RFC implements the freshness and expiry logic that 0013 described but didn't specify. |
| **RFC-0025** (Dual-Track Compliance) | 0025 identified that regulated RPs need audit trails and re-verification. This RFC provides the lifecycle mechanism. The re-verification scheduling in 0025's compliance track depends on the freshness policy defined here. |
| **RFC-0009** (Credential-Sealed Profile) | 0009's privacy model (no server-decryptable PII) constrains this RFC to request-time evaluation only. Background re-verification is impossible because the server can't decrypt the profile without the user. |
| **RFC-0005** (Background Jobs) | 0005 proposed background jobs for cleanup tasks. This RFC explicitly avoids background jobs for lifecycle evaluation, but a future extension could use 0005's infrastructure for sending re-verification reminders (email/push) without accessing PII. |

---

## Risks and mitigations

| Risk | Mitigation |
|------|-----------|
| **User friction from tier degradation** | Clear messaging with specific re-verification CTAs. Warnings before expiry via `warningThreshold`. |
| **Breaking change for existing Tier 2 users** | Phase in with a generous initial `maxVerificationAge`. Backfill `lastVerifiedAt` from existing `identity_bundles.updatedAt` or `signed_claims` timestamps. |
| **Performance of lifecycle checks** | All checks are simple timestamp comparisons on data already fetched by `getAssuranceData()`. No additional queries needed. |
| **Policy version changes invalidating many users** | Policy changes should be rare and communicated in advance. Consider a grace period where old-policy proofs are accepted with a warning before degradation. |
| **Credential event table growth** | Append-only but bounded per user (few credential changes over a lifetime). Can be pruned to latest N events per type if needed. |

---

## Open questions

1. **Should verification freshness be tier-specific?** E.g., Tier 2 expires after 365 days, but on-chain attestation (a potential Tier 3 concern) might need 90-day freshness.

2. **Should RPs be able to specify freshness requirements?** An RP could request `max_age=86400` in the OIDC authorize request to demand verification within the last 24 hours, triggering re-verification if stale.

3. **Grace period for policy upgrades** — Should there be a configurable window where old-policy proofs are accepted with a warning before hard degradation?

4. **Notification mechanism** — This RFC avoids background jobs, but re-verification reminders (email) would improve UX. Should this be scoped here or deferred to RFC-0005?
