# Task 09: Recovery Key Authentication

> Source: `security-hardening-malicious-server.md` Phase 7
> Priority: **P1** — ML-KEM recovery key unauth'd (server can substitute its own key); FROST bypass via DB flag
> Estimate: ~3 days

## Architectural decisions

- **Dual defense**: Both client-side ML-KEM key pinning (TOFU) AND crypto-gated DEK release (FROST signature derives the unwrap key)
- **ML-KEM pinning**: SHA-256 fingerprint stored in `recovery_key_pins` table `(userId, keyFingerprint, pinnedAt)` at first enrollment; mismatch aborts with user-visible warning
- **Crypto-gated DEK release**: `unwrapKey = HKDF(ikm=aggregatedSignature, salt=challengeId, info="zentity:frost-unwrap")` — server cannot compute without valid FROST signature
- **HPKE key authentication**: Signers persist HPKE key pairs to disk; during DKG init, each signs its HPKE public key with its FROST participant identity key
- **Guardian JWTs**: Replace bare UUID tokens with JWTs binding `(challengeId, guardianId, expiresAt)`; `GUARDIAN_ASSERTION_JWKS_URL` required
- **Recovery DEK AAD**: `encodeAad(["zentity-recovery-dek", secretId, userId])` as `additionalData` in AES-GCM

---

## What to build

Authenticate the ML-KEM recovery public key, make FROST signatures cryptographically gate DEK release, authenticate HPKE keys in DKG, and bind guardian approval tokens. This eliminates the malicious server's ability to substitute recovery keys or bypass FROST verification.

End-to-end: `recovery_key_pins` table → TOFU pinning at enrollment → FROST signature derives unwrap key → re-encrypt recovery DEK under derived key → persisted HPKE keys with signatures → signed DKG round 2 verification → guardian JWT binding → recovery DEK AAD → integration tests.

### Acceptance criteria

- [x] ML-KEM key pin stored at enrollment; subsequent fetch with same key passes
- [x] ML-KEM key pin mismatch (different key) aborts with error
- [x] Valid FROST aggregated signature derives correct unwrap key and decrypts DEK
- [x] Invalid/missing FROST signature cannot derive unwrap key
- [x] HPKE keys persisted across signer restarts
- [ ] Signed HPKE key passes DKG round 2; unsigned/wrong-signed key rejected — N/A: FROST identity keys don't exist until after DKG completes (chicken-and-egg); requires separate identity key system. HPKE persistence (commit a943f0d5) addresses the core concern
- [x] Guardian approval tokens are JWTs bound to challengeId
- [x] Expired/wrong-challenge guardian JWT rejected
- [x] `GUARDIAN_ASSERTION_JWKS_URL` required (startup fails without it) — already validated in config.rs:412
- [x] Recovery DEK AAD includes secretId and userId
- [x] Recovery DEK with mismatched AAD fails GCM authentication
- [x] Integration test: full recovery flow with crypto-gated DEK release
- [x] Integration test: key substitution detected by pin mismatch
- [ ] Unit test: HPKE key signature verification — N/A: depends on signed HPKE key (see above)
