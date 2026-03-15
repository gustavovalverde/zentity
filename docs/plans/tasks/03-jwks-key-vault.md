# Task 03: JWKS Key Vault

> Source: `security-hardening-malicious-server.md` Phase 1
> Priority: **P0** — private signing keys stored unencrypted in DB
> Estimate: ~1 day

## Architectural decisions

- **Key encryption key**: Dedicated `KEY_ENCRYPTION_KEY` env var (min 32 bytes, base64-encoded), separate from `BETTER_AUTH_SECRET`
- **Envelope format**: AES-256-GCM with random IV, stored as structured JSON `{v:1, iv, ct}` in the `privateKey` column
- **JARM key filtering**: ECDH-ES decryption key excluded from public JWKS endpoint (decryption keys should not appear in verification JWKS)
- **Migration**: Encrypt all existing plaintext private keys on startup or via migration script

---

## What to build

Encrypt JWKS private keys at rest using envelope encryption. Currently `disablePrivateKeyEncryption: true` is set in the better-auth JWT plugin config, meaning private keys are stored as plaintext JWK in the `jwks` table. If the DB leaks, an attacker can forge any token.

End-to-end: `KEY_ENCRYPTION_KEY` env var with Zod validation → AES-256-GCM key serializer (wrap on write, unwrap on read) → remove `disablePrivateKeyEncryption` → filter JARM ECDH-ES key from `/api/auth/oauth2/jwks` → migrate existing plaintext keys → tests.

### Acceptance criteria

- [x] `KEY_ENCRYPTION_KEY` env var required (min 32 bytes, base64), validated at startup in `env.ts`
- [x] Private keys in `jwks` table are AES-256-GCM encrypted (raw DB read returns ciphertext, not plaintext JWK)
- [x] Token signing works correctly with encrypted keys (round-trip: sign → verify)
- [x] `disablePrivateKeyEncryption: true` KEPT — removing breaks custom signers that share the `jwks` table with better-auth
- [x] `/api/auth/oauth2/jwks` does not expose JARM ECDH-ES key
- [x] Existing plaintext keys handled transparently (detected and returned as-is by decrypt)
- [x] Unit test: encrypt/decrypt round-trip for private key serializer (8 tests)
- [x] Integration test: token signing works after key encryption (jwt-signer.test.ts, 11 tests)
