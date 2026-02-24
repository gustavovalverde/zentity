---
status: "accepted"
date: "2026-02-24"
category: "technical"
domains: [privacy, security]
---

# Post-quantum cryptographic migration (ML-KEM-768, ML-DSA-65)

## Context and Problem Statement

Zentity's cryptographic stack relied on elliptic-curve primitives vulnerable to Shor's algorithm: RSA-OAEP-2048 for recovery key wrapping, X25519 ECDH for RP compliance encryption, and Ed25519/EdDSA for SD-JWT VC issuer signing. For a platform that stores encrypted compliance documents for up to 5 years and recovery wrappers for the lifetime of an account, the "harvest now, decrypt later" (HNDL) threat is concrete — an adversary captures ciphertext today and waits for a cryptographically relevant quantum computer (CRQC) to break it.

## Priorities & Constraints

* Compliance documents under RFC-0025 have 5-year retention — ciphertext must remain secure through at least 2031
* Recovery wrappers persist indefinitely — the longest-lived ciphertext in the system
* Hard cutover with no backward compatibility is acceptable
* `@noble/post-quantum` (v0.5.4) was already installed and audited by the noble-cryptography project
* NIST finalized FIPS 203 (ML-KEM) and FIPS 204 (ML-DSA) in August 2024

## Decision Outcome

Replace all quantum-vulnerable primitives with NIST post-quantum standards. No hybrid mode, no migration code, no feature flags.

| Surface | Before | After |
|---------|--------|-------|
| Recovery key wrapping | RSA-OAEP-2048 (PKE) | ML-KEM-768 (KEM + AES-256-GCM) |
| RP compliance encryption | X25519 ECDH + AES-256-GCM | ML-KEM-768 + AES-256-GCM |
| SD-JWT VC issuer signing | Ed25519/EdDSA via `jose` | ML-DSA-65 via custom signer |

### Why ML-KEM-768 over X25519

ML-KEM-768 provides NIST Category 3 quantum security (~AES-192 equivalent) while X25519 provides ~128 bits of classical security and 0 bits of quantum security. For Zentity's retention timelines, the HNDL risk window is real — not theoretical.

The original plan (RFC-0025 section 9.4) proposed a phased approach: X25519 now, hybrid X25519+ML-KEM by 2028, then X25519 deprecation. Since the library was already available and we have no users requiring backward compatibility, we skipped directly to ML-KEM-768 only. This eliminates hybrid complexity (dual encapsulation, HKDF over two shared secrets, two key types per RP) and the eventual migration cost.

### Why ML-DSA-65 over Ed25519

Ed25519 signatures are 64 bytes with 32-byte keys — compact, fast, and well-supported by `jose` and WebCrypto. However, `jose` doesn't support ML-DSA, and Ed25519 is broken by Shor's algorithm. ML-DSA-65 (FIPS 204) provides post-quantum signature security at the cost of larger artifacts: 3309-byte signatures and 1952-byte public keys. Since Zentity's issuer signatures are verified server-side (RPs verify VCs via Zentity's JWKS endpoint, not locally), the size increase has minimal impact on the verification flow.

### KEM vs PKE / DH — pattern change

ML-KEM is a Key Encapsulation Mechanism, not public-key encryption (RSA-OAEP) or Diffie-Hellman key exchange (X25519). The pattern changes from:

* **RSA-OAEP**: `encrypt(publicKey, plaintext) → ciphertext`
* **X25519 ECDH**: `ECDH(ephemeral_private, rp_public) → shared_secret`

To:

* **ML-KEM**: `encapsulate(publicKey) → {cipherText, sharedSecret}` then `AES-GCM(sharedSecret, plaintext)`

The receiver calls `decapsulate(cipherText, secretKey) → sharedSecret` and decrypts with AES-GCM. Both recovery and compliance surfaces use identical `{alg, kemCipherText, iv, ciphertext}` JSON envelopes.

### ML-KEM implicit reject

ML-KEM's most important security property for Zentity: decapsulating with the wrong secret key returns a pseudorandom shared secret instead of throwing an error. This prevents timing-based oracle attacks but means the actual security boundary is the downstream AES-GCM authentication tag failure. All test suites verify this "wrong key → AES-GCM auth tag failure" chain explicitly.

### Expected Consequences

* Recovery wrappers and compliance documents are quantum-resistant from day one
* No migration debt — single algorithm path means simpler code and fewer edge cases
* `jose` library bypassed for signing — custom JWT construction in `ml-dsa-signer.ts`
* Larger key/signature sizes: ML-KEM public keys are 1184 bytes (vs 32 for X25519), ML-DSA signatures are 3309 bytes (vs 64 for Ed25519)
* RFC-0021 (Zcash credential format) needs redesign — ML-DSA-65 signatures no longer fit in the 512-byte ZIP 302 memo field

## Alternatives Considered

* **Keep X25519/Ed25519 (status quo)**: No HNDL protection. Unacceptable for 5-year retention.
* **Hybrid X25519 + ML-KEM-768**: Dual encapsulation provides classical + quantum security. More complex (two key types, HKDF over concatenated secrets, migration path for existing data). Justified when you have users on the old scheme — we don't.
* **ML-KEM-1024 / ML-DSA-87 (higher security levels)**: NIST Category 5. Larger keys and ciphertexts for marginal security gain. Category 3 is the consensus recommendation for most applications.
* **SPHINCS+ for signing**: Hash-based, extremely conservative security assumptions. Signatures are 7-49 KB depending on parameter set — impractical for JWTs.

## More Information

* Library: [`@noble/post-quantum`](https://github.com/nicecoder/noble-post-quantum) — `ml-kem.js` and `ml-dsa.js`
* NIST FIPS 203 (ML-KEM): <https://csrc.nist.gov/pubs/fips/203/final>
* NIST FIPS 204 (ML-DSA): <https://csrc.nist.gov/pubs/fips/204/final>
