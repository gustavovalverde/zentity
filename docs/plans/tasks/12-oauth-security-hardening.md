# Task 12: OAuth Security Hardening

> Source: `security-hardening-malicious-server.md` Phases 3, 4, 5
> Priority: **P2** — medium-severity defense-in-depth fixes across OAuth/OIDC stack
> Estimate: ~3 days

## Architectural decisions

- **X509 chain validation**: Full chain verification (signature, expiry, trust anchor) using Node.js `crypto.X509Certificate` or `@peculiar/x509`, replacing thumbprint-only check
- **Token exchange scope default**: ID token subject with no requested scope defaults to `["openid"]` only
- **DPoP enforcement**: `requireDpop: true` at the token endpoint (breaking change)
- **Consent integrity**: HMAC over `(userId, clientId, scopes)` in consent records, verified before auto-skip
- **Release handle binding**: Key by `(userId, authReqId, clientId)` not just `userId`
- **Cross-org adoption**: Requires current owner's org admin approval
- **JARM key rotation**: `expiresAt` (90 days) with grace period for old key

---

## What to build

Seven independent-but-related hardening fixes across the OAuth/OIDC stack. Each addresses a medium-severity vulnerability from the malicious server threat model.

End-to-end for each sub-fix: implementation → migration (if schema change) → tests.

### Sub-tasks

**A. X509 Chain Validator** — Replace `validateX509Hash` with full chain validation: verify leaf signature against CA public key, check `notBefore`/`notAfter`, validate trust anchor set from `X5C_CA_PEM`.

**B. Token Exchange Scope Fix** — When `subject_token_type` is `id_token` and no scope requested, default to `["openid"]` only instead of pass-through.

**C. DPoP Enforcement** — Change `requireDpop: false` to `requireDpop: true` in HAIP plugin config.

**D. Consent Scope Integrity** — Add HMAC over `(userId, clientId, scopes)` in consent records. Verify on read before auto-skipping consent.

**E. Release Handle Binding** — Key ephemeral release handle store by `(userId, authReqId, clientId)` instead of just `userId`. (Coordinates with Task 04.)

**F. Cross-Org Client Adoption** — Add authorization check requiring current owner's org admin approval. Gate the `force` flag.

**G. JARM Key Rotation** — Add `expiresAt` to JARM key row (90 days). On expiry, generate new key, keep old for grace period.

### Acceptance criteria

- [ ] Leaf certificate signature verified against CA public key
- [ ] Expired certificates rejected; self-signed leaf with matching thumbprint but no valid CA chain rejected
- [ ] ID token subject with no requested scope defaults to `openid` only
- [ ] Request without DPoP proof rejected at token endpoint
- [ ] Consent scope HMAC detects tampering (modified scopes fail verification)
- [ ] Concurrent CIBA flows don't consume each other's release handles
- [ ] Cross-org client adoption requires current owner's approval
- [ ] Software statement validated as JWT when present in DCR
- [ ] JARM key has expiry and rotation mechanism
- [ ] Unit test: X509 valid chain / self-signed / expired / wrong CA
- [ ] Integration test: ID token → access token defaults to openid scope only
- [ ] Integration test: consent scope tampering detected
- [ ] Integration test: concurrent CIBA flows with correct release handle scoping
