---
status: "deprecated"
date: "2026-09-25"
category: "technical"
domains: [privacy, security]
---

# Post-quantum cryptographic migration (ML-KEM-768)

## Context and Problem Statement

Zentity's cryptographic stack relied on elliptic-curve primitives vulnerable to Shor's algorithm: RSA-OAEP-2048 for recovery key wrapping, X25519 ECDH for RP compliance encryption, and Ed25519/EdDSA for SD-JWT VC issuer signing. For a platform that stores encrypted compliance documents for up to 5 years and recovery wrappers for the lifetime of an account, the "harvest now, decrypt later" (HNDL) threat is concrete — an adversary captures ciphertext today and waits for a cryptographically relevant quantum computer (CRQC) to break it.

## Priorities & Constraints

* Compliance documents under RFC-0025 have 5-year retention — ciphertext must remain secure through at least 2031
* Hard cutover with no backward compatibility is acceptable
* `@noble/post-quantum` (v0.5.4) was already installed and audited by the noble-cryptography project
* NIST finalized FIPS 203 (ML-KEM) and FIPS 204 (ML-DSA) in August 2024

## Decision Outcome

Replace the quantum-vulnerable encryption primitives with ML-KEM-768. No hybrid mode, no migration code, no feature flags. Issuer signing stays on the JWT plugin's standard keys.

| Surface | Before | After |
|---------|--------|-------|
| RP compliance encryption | X25519 ECDH + AES-256-GCM | ML-KEM-768 + AES-256-GCM |
| Issuer signing (ID tokens, access tokens, SD-JWT VCs) | RS256 and EdDSA via the JWT plugin | Unchanged |

### Why ML-KEM-768 over X25519

ML-KEM-768 provides NIST Category 3 quantum security (~AES-192 equivalent) while X25519 provides ~128 bits of classical security and 0 bits of quantum security. For Zentity's retention timelines, the HNDL risk window is real — not theoretical.

The original plan (RFC-0025 section 9.4) proposed a phased approach: X25519 now, hybrid X25519+ML-KEM by 2028, then X25519 deprecation. Since the library was already available and we have no users requiring backward compatibility, we skipped directly to ML-KEM-768 only. This eliminates hybrid complexity (dual encapsulation, HKDF over two shared secrets, two key types per RP) and the eventual migration cost.

### Why issuer signing stays on RS256 and EdDSA

"Harvest now, decrypt later" does not apply to signatures: forging one needs a quantum computer at the time of forgery, so the signing keys can move to a post-quantum algorithm later without exposing anything signed today. The OAuth provider signs every ID token with the JWT plugin's RS256 key, because it computes `at_hash` for that key, and relying parties verify Zentity's tokens with JOSE libraries that rarely support ML-DSA.

### KEM vs PKE / DH — pattern change

ML-KEM is a Key Encapsulation Mechanism, not public-key encryption (RSA-OAEP) or Diffie-Hellman key exchange (X25519). The pattern changes from:

* **RSA-OAEP**: `encrypt(publicKey, plaintext) → ciphertext`
* **X25519 ECDH**: `ECDH(ephemeral_private, rp_public) → shared_secret`

To:

* **ML-KEM**: `encapsulate(publicKey) → {cipherText, sharedSecret}` then `AES-GCM(sharedSecret, plaintext)`

The receiver calls `decapsulate(cipherText, secretKey) → sharedSecret` and decrypts with AES-GCM. Compliance bundles use `{alg, kemCipherText, iv, ciphertext}` JSON envelopes, carry `{clientId, userId}`, and bind them via AES-GCM AAD to prevent cross-RP/cross-user ciphertext substitution.

### ML-KEM implicit reject

ML-KEM's most important security property for Zentity: decapsulating with the wrong secret key returns a pseudorandom shared secret instead of throwing an error. This prevents timing-based oracle attacks but means the actual security boundary is the downstream AES-GCM authentication tag failure. All test suites verify this "wrong key → AES-GCM auth tag failure" chain explicitly.

### Expected Consequences

* Compliance documents are quantum-resistant from day one
* No migration debt — single algorithm path means simpler code and fewer edge cases
* Larger ML-KEM key sizes: public keys are 1184 bytes (vs 32 for X25519)
* Issuer signatures remain quantum-vulnerable; moving them requires ML-DSA support in the OAuth provider and in relying parties' JOSE libraries

## Alternatives Considered

* **Keep X25519/Ed25519 (status quo)**: No HNDL protection. Unacceptable for 5-year retention.
* **Hybrid X25519 + ML-KEM-768**: Dual encapsulation provides classical + quantum security. More complex (two key types, HKDF over concatenated secrets, migration path for existing data). Justified when you have users on the old scheme — we don't.
* **ML-KEM-1024 (higher security level)**: NIST Category 5. Larger keys and ciphertexts for marginal security gain. Category 3 is the consensus recommendation for most applications.
* **ML-DSA-65 for issuer signing**: Post-quantum signatures at the cost of 3309-byte signatures and 1952-byte public keys. The OAuth provider cannot issue ID tokens with it (`at_hash` is computed for the JWT plugin's RS256 key), and few relying-party JOSE libraries verify it.
* **SPHINCS+ for signing**: Hash-based, extremely conservative security assumptions. Signatures are 7-49 KB depending on parameter set — impractical for JWTs.

## More Information

* Library: [`@noble/post-quantum`](https://github.com/nicecoder/noble-post-quantum) — `ml-kem.js`
* NIST FIPS 203 (ML-KEM): <https://csrc.nist.gov/pubs/fips/203/final>

## Revision history

* 2026-02-24: Recovery key wrapping and RP compliance encryption move to ML-KEM-768; SD-JWT VC issuer signing moves to ML-DSA-65.
* 2026-09-25: Issuer signing returns to the JWT plugin's RS256 and EdDSA keys, and ID tokens are always RS256, because the Better Auth 1.7 OAuth provider computes `at_hash` for its RS256 key. ML-KEM-768 decisions are unchanged.
* 2026-09-25: Recovery key wrapping is dropped. The server holds no ML-KEM recovery key and stores no recovery-wrapped data keys.
* 2026-09-25: RP compliance encryption keys are removed. Nothing encrypted to them, so no surface uses ML-KEM-768 and this decision is deprecated.
