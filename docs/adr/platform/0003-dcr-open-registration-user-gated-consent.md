---
status: "accepted"
date: "2026-02-07"
builds-on: "[Selective Disclosure Scope Architecture](../privacy/0011-selective-disclosure-scope-architecture.md)"
category: "platform"
domains: [security, oauth, privacy]
---

# Open client registration with user-gated consent

## Context and Problem Statement

Zentity acts as an OAuth 2.1 authorization server. External applications (relying parties) need OAuth clients to integrate. The previous approach mixed two registration paths:

1. **Pre-seeded SQL or RP Admin provisioning** — admin manually creates clients with specific scopes
2. **RFC 7591 Dynamic Client Registration (DCR)** — clients self-register at `/api/auth/oauth2/register`

Only one demo scenario (wine) used DCR; the others required admin intervention. This created an artificial bottleneck: admins had to pre-approve which scopes a client could request, even though the user makes the final access decision at consent time.

The question: is admin scope-gating at registration time a meaningful security control, or redundant with the consent and data-access enforcement layers?

## Priorities & Constraints

* **User sovereignty** — the user, not the platform operator, decides what data to share (ADR 0011)
* **Self-service onboarding** — external apps should integrate without manual approval gates
* **Standards compliance** — use RFC 7591 DCR, the standard mechanism for OAuth client self-registration
* **Operational visibility** — platform operators still need to see registered clients and manage organizational ownership
* **Privacy by architecture** — PII is never accessible without active user authentication (vault unlock)

## Decision Outcome

All OAuth clients register via RFC 7591 DCR. No admin pre-approval is required for registration or scope access.

### Three-layer data access control

Removing admin scope-gating does not mean "anything goes." Data access is enforced through three independent layers, each of which must pass for an RP to receive claims:

#### Layer 1: Scope request (what the RP asks for)

`publicClientScopes` in auth.ts defines the full set of scopes any DCR client can request:

```text
openid, profile, email, proof:identity, proof:verification, proof:age,
proof:document, proof:liveness, proof:nationality, proof:compliance,
identity.name, identity.dob, identity.address, identity.document,
identity.nationality
```

The RP includes only the scopes it needs in the authorization request. A wine shop requests `proof:verification proof:age`; a bank requests `proof:verification identity.name identity.address`. The RP's request determines the ceiling — scopes not requested are never shown to the user.

#### Layer 2: User consent (what the user approves)

The consent page splits requested scopes into two categories based on the client's `metadata.optionalScopes` field:

| Category | Presentation | Behavior |
|----------|-------------|----------|
| **Required scopes** | Static list (no checkboxes) | Always included in consent. User can Accept All or Deny. |
| **Optional scopes** | Checkboxes, unchecked by default | User opts in per scope. Only checked scopes are consented. |

Scopes NOT listed in `metadata.optionalScopes` are treated as required. For DCR clients without this metadata, all visible scopes default to required — the user gets an all-or-nothing choice. This is the correct default for most RPs: a bank requesting `identity.name` needs it to function, so presenting it as optional would be misleading.

The `proof:identity` umbrella scope is expanded at the claim-resolution level — `customUserInfoClaims` maps it to all proof claim keys. On the consent page, individual `proof:*` scopes are shown if the RP requested them directly.

Hidden scopes (`openid`, `profile`) are always included silently — they don't appear in the consent UI.

#### Layer 3: Vault unlock and ephemeral identity delivery (PII protection)

Two scope families exist with fundamentally different security properties:

| Scope family | Data type | Security | Delivery |
|-------------|-----------|----------|----------|
| `proof:*` | Derived booleans (non-PII) | No vault unlock needed | Userinfo endpoint |
| `identity.*` | Actual PII | **Vault unlock required** | id_token only (ephemeral) |

When the user approves any `identity.*` scope, the consent page requires a **vault unlock** before the "Allow" button is enabled. The vault unlock uses the user's authentication credential:

* **Passkey** — WebAuthn PRF extension derives a decryption key
* **Password (OPAQUE)** — Export key from the OPAQUE protocol
* **Wallet** — HKDF-derived key from wallet signature

Until the vault is unlocked, the "Allow" button remains disabled. This prevents accidental PII disclosure — the user must actively authenticate to share personal data, even after clicking through the consent UI.

**Ephemeral identity flow:** After vault unlock, the consent client:

1. Decrypts the user's profile from their credential-wrapped secret
2. Obtains an **identity intent token** from `/api/oauth2/identity/intent` (120s TTL, binds user + client + scope hash, JTI replay prevention)
3. Calls `/api/oauth2/identity/stage` with the decrypted PII, approved scopes, and intent token
4. Server validates the intent token (signature, expiry, scope hash match) and stores the filtered claims in an in-memory ephemeral store (5min TTL, consumed on read)
5. Consent UI filters out `identity.*` scopes and calls `consent()` with only `proof:*` and standard OIDC scopes

When better-auth issues the id_token, the `customIdTokenClaims` hook consumes the ephemeral claims (keyed by userId, independent of auth code scopes) and includes the claims matching the scopes recorded in the ephemeral store. The claims are then gone — no persistent PII exists on the server.

This means identity PII is:

* **Never written to the database** — only held in memory for the duration of the token exchange
* Consumed once — the ephemeral entry is deleted after the id_token is issued
* Only accessible during the brief window between consent and token exchange (~seconds)
* Delivered via id_token, not userinfo — the RP receives PII in the token response, not via a separate API call

**Never-persist consent:** Identity scopes are filtered out before the `consent()` API call. Only `proof:*` and standard OIDC scopes are persisted in the consent record. This ensures the consent page reappears whenever identity scopes are requested — vault unlock is per-session.

### Scope filtering at token and userinfo time

Even after consent, claims are filtered again when the RP calls userinfo or receives tokens:

* `customUserInfoClaims` checks the access token's scopes and returns only matching `proof:*` claims
* `proof:*` claims: built from server-side attestation data, filtered by `filterProofClaimsByScopes`
* `identity.*` claims: consumed from the ephemeral store by `customIdTokenClaims`, filtered by `filterIdentityByScopes`

A scope that was consented but has no backing data (e.g., `identity.dob` when the user hasn't completed DOB verification) returns nothing — the filtering is additive, not permissive.

### Client categories

| Category | Registration | Consent |
|----------|-------------|---------|
| External apps (all RPs) | DCR at `/api/auth/oauth2/register` | User-controlled consent page |
| First-party apps | Same DCR mechanism | May set `skipConsent: true` via admin API |

### Organization ownership

Organization assignment is retained as an **operational management tool**, not a security boundary:

* Track which organization owns a client (for support, audit, billing)
* Disable misbehaving clients via the `disabled` flag on `oauth_client`
* View client metadata and redirect URIs

Unowned DCR clients appear in the admin dashboard for optional organizational assignment.

### What this replaces

* **Deleted:** RP Admin "Provision Demo Clients" flow and `/api/rp-admin/clients/create` endpoint
* **Deleted:** Pre-seeded SQL scripts for client creation
* **Retained:** `/api/rp-admin/clients/approve` for assigning unowned clients to organizations
* **Retained:** `/api/rp-admin/clients/unowned` and `/api/rp-admin/clients/owned` for visibility

## Consequences

**Positive:**

* External apps self-register without waiting for admin approval
* Single registration path eliminates configuration drift between DCR and pre-seeded clients
* Three-layer enforcement (scope request → consent → vault unlock) provides defense in depth without requiring admin intervention
* PII disclosure requires active user authentication (vault unlock), not just a checkbox click

**Negative:**

* Any application can register a client — mitigated by user consent, vault unlock for PII, and the `disabled` flag for abuse
* Organization ownership becomes optional rather than enforced — acceptable since it was never a security boundary
* DCR clients without `metadata.optionalScopes` get all-or-nothing consent (no granular checkboxes). This is the intended default — RPs should only request scopes they need. Admins can set `optionalScopes` on specific clients if granular user choice is desired.

**Neutral:**

* Demo RP now uses DCR for all four scenarios (bank, exchange, wine, aid) instead of mixed approaches

## More Information

* Consent UI: `apps/web/src/app/oauth/consent/consent-client.tsx`
* Identity intent tokens: `apps/web/src/lib/auth/oidc/identity-intent.ts`
* OAuth query verification: `apps/web/src/lib/auth/oidc/oauth-query.ts`
* Ephemeral identity staging: `apps/web/src/lib/auth/oidc/ephemeral-identity-claims.ts`
* Intent endpoint: `apps/web/src/app/api/oauth2/identity/intent/route.ts`
* Stage endpoint: `apps/web/src/app/api/oauth2/identity/stage/route.ts`
* Scope display / grouping: `apps/web/src/lib/auth/oidc/scope-display.ts`
* Proof scope definitions: `apps/web/src/lib/auth/oidc/proof-scopes.ts`
* Identity scope definitions: `apps/web/src/lib/auth/oidc/identity-scopes.ts`
* Userinfo hook: `customUserInfoClaims` in `apps/web/src/lib/auth/auth.ts`
* Selective disclosure ADR: [ADR 0011](../privacy/0011-selective-disclosure-scope-architecture.md)
* OAuth integrations: [docs/oauth-integrations.md](../../oauth-integrations.md)
