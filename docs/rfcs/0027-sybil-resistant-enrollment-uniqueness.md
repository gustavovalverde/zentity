# RFC-0027: Sybil-Resistant Enrollment via Issuer-Scoped Uniqueness Anchors

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Created** | 2026-02-19 |
| **Updated** | 2026-02-19 |
| **Author** | Gustavo Valverde |
| **Related** | [RFC-0026](0026-identity-assurance-lifecycle.md), [RFC-0020](0020-privacy-preserving-wallet-binding.md), [RFC-0009](0009-credential-sealed-profile-pii.md), [ADR privacy/0013](../adr/privacy/0013-enrollment-uniqueness-anchor.md) |

---

## Summary

Identity binding (`binding_commitment`) prevents proof transfer, replay, and cross-context misuse, but it does not prevent a real multi-credential Sybil where one human repeatedly enrolls with distinct accounts/credentials.

This RFC introduces an enrollment-time uniqueness anchor:

1. Derive an issuer-scoped `person_root` in a dedicated dedup service.
2. Enforce one active enrollment per `person_root` via a hard uniqueness constraint.
3. Separate credential rotation/recovery from new enrollment.
4. Keep RP unlinkability with pairwise identifiers derived from `person_root`.

Backward compatibility is not a goal for this RFC.

---

## Problem Statement

Current controls already implemented in the repository are strong for proof integrity:

- Mandatory `identity_binding` proofs in the verification flow (`apps/web/src/lib/identity/verification/finalize-and-prove.ts`).
- Session-bound nonce and audience/msg_sender checks (`apps/web/src/lib/privacy/zk/challenge-store.ts`, `apps/web/src/lib/trpc/routers/crypto/proof.ts`).
- Server-side enforcement that non-binding proofs cannot be stored before identity binding (`apps/web/src/lib/trpc/routers/crypto/proof.ts`).

These controls stop:

- replay,
- proof swapping,
- cross-session proof mixing,
- cross-verifier context misuse.

They do not stop:

- one person creating multiple independent accounts with separate credentials and repeating enrollment.

---

## Goals

- Prevent true multi-credential Sybil enrollment at the issuer level.
- Preserve privacy-first data posture (no raw biometrics/documents at rest in main app DB).
- Keep RP unlinkability while allowing issuer-side uniqueness enforcement.
- Make enrollment replacement explicit (rotate/recover) rather than creating parallel active identities.

## Non-goals

- Global cross-issuer uniqueness.
- Passive retroactive dedup for already-issued credentials.
- Soft/heuristic-only anti-fraud without hard uniqueness constraints.

---

## Decision

Adopt issuer-scoped uniqueness anchors with hard enforcement:

1. Enrollment computes `person_root` from protected evidence representations in a dedicated dedup boundary.
2. Main identity pipeline accepts enrollment only if `person_root` is not already active.
3. New credential registration for an existing person must follow rotation/recovery, not fresh enrollment.

---

## Architecture

### 1) Dedicated Dedup Boundary

Introduce a dedicated service boundary (HSM/TEE-backed preferred) that:

- accepts protected enrollment features,
- derives `person_root`,
- performs duplicate detection,
- returns only `(person_root, decision, confidence/reason)` to the web app.

The main app never receives raw biometric templates or document images from this service.

### 2) Issuer-Scoped Root and Nullifier

Definitions:

```text
person_root = Poseidon2(issuer_scope, protected_doc_fingerprint, protected_biometric_fingerprint)
enrollment_nullifier = Poseidon2(person_root, "active_enrollment_v1")
```

Rules:

- `enrollment_nullifier` must be globally unique for active enrollments.
- Duplicate nullifier => reject as new enrollment and route to rotation/recovery flow.

### 3) One Active Enrollment per Person

Schema additions in `apps/web/src/lib/db/schema/identity.ts`:

- `identity_person_roots`
  - `personRoot` (primary key or unique)
  - `state` (`active`, `revoked`, `superseded`)
  - `activeUserId`
  - `createdAt`, `updatedAt`
- `identity_enrollment_events` (append-only)
  - `eventType` (`enrollment_created`, `duplicate_blocked`, `rotation`, `recovery`, `revocation`)
  - `personRoot`, `userId`, `actor`, `reason`, `createdAt`

Hard DB invariants:

- unique active `personRoot`
- no second active user bound to same root

### 4) Rotation and Recovery Semantics

Credential changes (passkey/OPAQUE/wallet) must not create a second identity:

- Existing identity: rotate wrappers/credentials only.
- Lost credentials: recovery reactivates same `person_root`.
- New `person_root` issuance for same person is forbidden unless admin override policy explicitly allows it.

### 5) RP Unlinkability

Use pairwise RP pseudonyms from `person_root`:

```text
rp_pid = Poseidon2(person_root, rp_origin, rp_salt)
```

- Issuer can enforce uniqueness.
- RPs cannot correlate users across origins by identifier reuse.

---

## Threat Mapping

| Attack | Control |
|-------|---------|
| Multi-account Sybil with same person | Unique active `person_root` / `enrollment_nullifier` |
| Re-enrollment after credential loss to bypass limits | Recovery path bound to same `person_root` |
| Duplicate identity via second account + fresh credentials | Enrollment denied when `person_root` already active |
| Cross-RP correlation from global stable identifiers | Pairwise `rp_pid` derivation per RP origin |

---

## Implementation Plan

### Phase 1: Data model + enforcement gate

- Add schema/tables and uniqueness constraints.
- Add `person_root` check into identity finalization pipeline before issuance/finalize success.
- Emit enrollment decision events.

Primary touchpoints:

- `apps/web/src/lib/db/schema/identity.ts`
- `apps/web/src/lib/trpc/routers/identity/finalize.ts`
- `apps/web/src/lib/trpc/routers/identity/helpers/job-processor.ts`

### Phase 2: Dedup service integration

- Add typed client + timeout/retry behavior.
- Enforce fail-closed on dedup service errors for new enrollments.

### Phase 3: Recovery/rotation hardening

- Ensure passkey/OPAQUE/wallet management cannot create a parallel active root.
- Add explicit recovery/rotation eventing.

---

## Security and Privacy Notes

- This RFC prevents issuer-local multi-credential Sybil but does not solve cross-issuer Sybil.
- No raw biometric artifacts are stored in primary application DB.
- Protected dedup features and root derivation keys must remain inside dedicated security boundary.
- All dedup decisions are auditable via enrollment event log.

---

## Rollout and Breaking Changes

- This RFC is a breaking architecture change by design.
- Existing enrollments can be forced through re-enrollment under uniqueness policy if needed.
- No backward-compatibility guarantees are provided.
