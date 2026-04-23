---
title: OIDC Disclosure Profile
---

The Zentity disclosure profile defines how identity claims are requested, authorized, and delivered across all channels. It builds on standard OAuth 2.0, OpenID Connect, CIBA, and OIDC4IDA, adding privacy-preserving semantics for vault-gated PII.

**Code authority:** `apps/web/src/lib/auth/oidc/disclosure-registry.ts`
**Architectural rationale:** [ADR-0015 Disclosure surface assignment](../adr/privacy/0015-disclosure-surface-assignment.md)

## Standards baseline

| Standard | Role |
|----------|------|
| OAuth 2.0 (RFC 6749) | Authorization vocabulary (scopes) |
| OpenID Connect Core 1.0 §5.4–5.5 | Standard scopes, `claims` parameter for exact selection |
| OpenID CIBA Core | Decoupled authorization transport — does not redefine claim semantics |
| RFC 9396 `authorization_details` | Structured action metadata (e.g., purchases), not claim disclosure |
| OIDC for Identity Assurance 1.0 | `verified_claims` envelope for assurance context |

Zentity custom scopes extend this baseline. They do not replace it.

## Scope classes

### Standard session scopes

| Scope | Claims | Delivery | Notes |
|-------|--------|----------|-------|
| `openid` | `sub` | id_token, userinfo | Required for all flows |
| `email` | `email`, `email_verified` | id_token, userinfo | Account email from `users` table — **not** vault-gated PII |
| `offline_access` | — | — | Enables refresh tokens |

**Email classification:** `email` is a standard OIDC account claim. It comes from the user's account record, requires no vault unlock, and is delivered through standard OIDC mechanisms. It is categorically different from `identity.*` scopes which deliver verified document PII from the encrypted vault.

### Proof scopes — non-PII verification status

Proof claims are derived from the user's account identity snapshot. No PII is involved. The issuer reads the bundle snapshot (`identity_bundles`) for validity state plus `effectiveVerificationId`, then projects claims from the authoritative verification row referenced by that snapshot.

| Scope | Claims | Delivery |
|-------|--------|----------|
| `proof:identity` | All proof claims (umbrella) | id_token, userinfo |
| `proof:verification` | `verification_level`, `verified`, `identity_bound`, `sybil_resistant` | id_token, userinfo |
| `proof:age` | `age_verification` | id_token, userinfo |
| `proof:document` | `document_verified` | id_token, userinfo |
| `proof:liveness` | `liveness_verified`, `face_match_verified` | id_token, userinfo |
| `proof:nationality` | `nationality_verified`, `nationality_group` | id_token, userinfo |
| `proof:compliance` | `policy_version`, `verification_time`, `attestation_expires_at` | id_token, userinfo |
| `proof:chip` | `chip_verified`, `chip_verification_method` | id_token, userinfo |
| `proof:sybil` | `sybil_nullifier` | **access_token only** |

`proof:sybil` is special: its claim (`sybil_nullifier`) is a per-RP pseudonymous nullifier derived from `HMAC-SHA256(DEDUP_HMAC_SECRET, nullifierSeed + "|rp|" + clientId)`. `nullifierSeed` is bundle-owned state stored on `identity_bundles`, itself an HMAC-derived value computed at credential write time (`HMAC-SHA256(DEDUP_HMAC_SECRET, rawKey || source)`) so no raw chip identifier reaches the bundle. The seed is written from the first verified credential, preserved across later credential additions, and cleared only on full identity revocation. The claim appears only in access tokens, never in id_tokens or userinfo, because putting per-RP pseudonyms in shared claim surfaces would create correlation vectors.

When the snapshot is `stale` or `revoked`, disclosure surfaces stop treating the account as verified even though historical credential rows remain available for audit and operator reads.

### Identity scopes — vault-gated PII

Identity claims come from the user's encrypted profile vault. They require vault unlock and go through the exact disclosure binding pipeline.

| Scope | Claims | Delivery | Vault | Exact binding |
|-------|--------|----------|-------|---------------|
| `identity.name` | `given_name`, `family_name`, `name` | userinfo only | yes | yes |
| `identity.dob` | `birthdate` | userinfo only | yes | yes |
| `identity.address` | `address` | userinfo only | yes | yes |
| `identity.document` | `document_number`, `document_type`, `issuing_country` | userinfo only | yes | yes |
| `identity.nationality` | `nationality`, `nationalities` | userinfo only | yes | yes |

**Privacy contract for identity scopes:**

1. Claims are **never** stored in consent records — identity scopes are stripped before persistence
2. Claims are **never** in id_tokens — release lookup is server-side and bound to the token correlation id
3. Claims are **single-consume** — the userinfo endpoint destructively reads the ephemeral payload
4. Claims are **exact-bound** — an intent token binds (userId, clientId, scopeHash) with HMAC and a 120-second TTL
5. Claims require **vault unlock** — the user must provide their credential (passkey PRF, OPAQUE password, or wallet signature)

### Operational scopes

These control resource access with no claim payload.

| Scope | Purpose |
|-------|---------|
| `agent:host.register` | Register an agent host |
| `agent:session.register` | Register an agent session |
| `agent:session.revoke` | Revoke an agent session |
| `agent:introspect` | Introspect agent state |
| `compliance:key:read` | Read FHE compliance key |
| `compliance:key:write` | Manage FHE compliance key |
| `identity_verification` | OID4VCI credential issuance |

## Delivery rules

| Claim class | id_token | userinfo | access_token |
|-------------|----------|----------|--------------|
| Standard (`sub`, `email`) | yes | yes | — |
| Proof (verification status) | yes | yes | — |
| Sybil nullifier | — | — | yes |
| Identity PII | **no** | **yes (single-consume)** | — |
| Verified claims (OIDC4IDA) | — | yes | — |
| Assurance (`acr`, `amr`, `aal`) | yes | — | — |

## Interaction rules

These rules apply identically regardless of channel:

| Condition | Interaction required |
|-----------|---------------------|
| Standard or proof scopes only | Consent |
| Any `identity.*` scope present | Consent + vault unlock + exact binding |
| CIBA with `identity.*` scopes | Always requires explicit human approval (never auto-approved) |
| `authorization_details` with `type: "purchase"` | CIBA approval with business action metadata |

Channels adapt **transport and UX**, not disclosure semantics:

- Browser OAuth: consent page with inline vault unlock panel
- CIBA: approval page (push notification → browser) with vault unlock panel
- MCP: tool handler initiates CIBA with disclosure scopes, returns approval URL
- Demo RP: step-up authorization request for identity scopes

## Claims request narrowing

The OIDC `claims` parameter (§5.5) narrows exact claims within an authorized scope family. It does not replace the scope-based disclosure families.

```json
{
  "userinfo": {
    "given_name": { "essential": true },
    "family_name": null
  }
}
```

If `identity.name` is in scope but the `claims` parameter requests only `given_name`, only `given_name` is delivered. The `claims` parameter cannot request claims outside the granted scope set.

## Action metadata rules

`authorization_details` (RFC 9396) is for structured business actions:

```json
{
  "type": "purchase",
  "merchant": "wine-shop",
  "amount": "49.99",
  "currency": "USD"
}
```

It is **never** used for claim selection. Claims are selected via scopes and the `claims` parameter.

## Verified claims envelope

When a user is fully verified, the OIDC4IDA `verified_claims` envelope wraps verification context:

```json
{
  "verified_claims": {
    "verification": {
      "trust_framework": "eidas",
      "assurance_level": "full",
      "time": "2026-03-20T10:00:00Z"
    },
    "claims": { /* proof claims */ }
  }
}
```

This is requested via the `claims` parameter with a `verified_claims` entry, not via scopes.

## Channel mapping

### Browser OAuth RP

1. Requests standard scopes + Zentity disclosure scopes
2. May use `claims` parameter to narrow exact fields
3. Consent page groups scopes: Account, Verification proofs, Personal information
4. Identity scopes trigger vault unlock panel before consent submit
5. Staging pipeline: intent → stage → promote → consume

### CIBA RP

1. Same scope model as browser OAuth
2. Same exact-binding model and delivery rules
3. Transport changes: bc-authorize → poll/ping → token endpoint
4. Approval happens in browser (push notification or direct link)
5. Identity scopes are never auto-approved regardless of agent grants
6. Staging pipeline: intent → stage (direct to release context) → consume

### MCP

1. Tools are aliases over the disclosure contract, not independent scope authorities
2. `whoami` → standard session claims (`openid`, optional `email`)
3. `my_profile(fields)` → compiles fields to identity scopes via CIBA
4. `my_proofs` → proof claims via `proof:identity` scope
5. `check_compliance` → operational `compliance:key:read` scope
6. `purchase` → action metadata via `authorization_details` + identity scopes for fulfillment
7. The MCP transport layer requires only `openid` — identity scopes are negotiated per-tool via CIBA

### Demo RP

1. Teaches the canonical disclosure model via concrete scenarios
2. Sign-in scopes: standard + proof (no vault unlock needed)
3. Step-up scopes: identity (triggers vault unlock on consent page)
4. Each scenario explicitly distinguishes standard vs proof vs identity scopes
