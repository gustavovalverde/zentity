# Task 06: Compliance Derivation Engine

> Source: `security-hardening-malicious-server.md` Phase 6
> Priority: **P1** — mutable boolean flags can be flipped to forge compliance status
> Estimate: ~2 days

## Architectural decisions

- **Proof-derived compliance**: Compliance status is a pure function of stored ZK proofs and signed claims — no mutable boolean state
- **Breaking schema change**: Remove `livenessPassed`, `faceMatchPassed`, `ageVerified`, `sanctionsCleared` columns from `identityVerifications`
- **Server-derived `birthYearOffset`**: Attestation submission derives this from age verification proof public inputs, not from client-supplied values
- **Draft finalization**: Outcome fields derived from signed claims (HMAC-JWT) issued at OCR/liveness time, not from mutable draft fields

---

## What to build

Replace mutable boolean flags with a pure derivation engine that computes compliance status directly from ZK proof existence and signed claims.

End-to-end: `deriveComplianceStatus(userId)` pure function → query `zk_proofs` and `signed_claims` → remove boolean columns from schema → update `getVerificationStatus` and all callers → server-derived `birthYearOffset` for attestation → draft finalization from signed claims → tests.

### Acceptance criteria

- [ ] `deriveComplianceStatus` returns correct level when all ZK proofs are present and verified
- [ ] `deriveComplianceStatus` returns lower level when proofs are missing
- [ ] `livenessPassed`, `faceMatchPassed`, `ageVerified`, `sanctionsCleared` boolean columns removed from `identityVerifications` schema
- [ ] All callers of `getVerificationStatus` updated to use derivation engine
- [ ] `attestation.submit` derives `birthYearOffset` from proof public inputs
- [ ] Client-supplied `birthYearOffset` is rejected or ignored
- [ ] Draft finalization derives outcomes from signed claims
- [ ] Integration test: compliance derivation from proofs
- [ ] Integration test: attestation `birthYearOffset` derived server-side
