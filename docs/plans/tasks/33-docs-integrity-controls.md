# Task 33: Documentation — Integrity Controls

> Source PRD: [prd-production-launch.md](../prd-production-launch.md) — Module 4
> Source plan: [documentation-sync-ciba-branch.md](../documentation-sync-ciba-branch.md) — Task 20
> Status: Complete
> Priority: P2
> User Stories: 17

## What to build

Document four security integrity controls added on the CIBA branch.

**Documents to update:**

- `CLAUDE.md` (root) — security sections
- `docs/tamper-model.md` — all four controls as threat mitigations
- `docs/attestation-privacy-architecture.md` — FHE HMAC, JWKS encryption
- `docs/cryptographic-pillars.md` — new crypto primitives
- `docs/oauth-integrations.md` — consent HMAC, JARM

**Key content:**

1. **FHE ciphertext HMAC binding** — `computeCiphertextHash()` with `(userId, attributeType)` AAD, `ensureCiphertextIntegrity()` on read
2. **Consent scope HMAC** — `computeConsentHmac()` with `(userId, clientId, referenceId, sortedScopes)` AAD
3. **JWKS private key encryption at rest** — AES-256-GCM via `KEY_ENCRYPTION_KEY`, `encryptPrivateKey()`/`decryptPrivateKey()`
4. **JARM ECDH-ES P-256 key** — lazy-created, persisted in `jwks` table

## Acceptance criteria

- [x] All four integrity controls documented with threat → mitigation mapping
- [x] `KEY_ENCRYPTION_KEY` env var documented
- [x] AAD encoding pattern (`encodeAad()` with length-prefix) documented
- [x] Tamper model updated with all four controls
