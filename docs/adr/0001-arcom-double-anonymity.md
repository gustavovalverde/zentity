# ADR-0001: ARCOM Double Anonymity via Transient OAuth Linkage

| Field | Value |
|-------|-------|
| **Status** | Implemented |
| **Date** | 2026-03-05 |

## Context

France's ARCOM referentiel requires "double anonymity" for age verification:

1. **RP anonymity** — The adult site cannot identify the user or correlate them across sessions.
2. **Provider anonymity** — Zentity cannot determine which sites a user visits.

OAuth is architecturally incompatible with full provider blindness — the authorization server always sees `(user, client_id)` during the authorize flow. However, the specs (OIDC Core, RFC 9068, RFC 6749) **do not require** persisting this relationship.

This ADR addresses the persistent linkage problem.

## Decision

**Transient knowledge, zero persistent linkage** for proof-only OAuth flows.

### Two RP relationship types

We recognize that not all RPs are equal. A bank needs an ongoing identity relationship; an adult site needs a one-time age proof.

| | Transient (proof-only) | Persistent (relational) |
|---|---|---|
| Example | Adult site age gate | Bank, exchange |
| Scopes | `proof:*` only | `identity.*` + `proof:*` |
| `subjectType` | `pairwise` | `public` |
| Consent record | Deleted after authorization code issuance | Persistent, shown in dashboard |
| Access token record | Deleted after JWT issuance | Kept for revocation |
| User model | "Prove and forget" | "Ongoing relationship I manage" |

**Classification rule:** `subjectType` on the OAuth client is the primary signal. Pairwise clients get transient treatment. Public clients get persistent treatment. **Safety guard:** if a pairwise client's authorization flow includes any `identity.*` scope, the consent record is preserved because real PII was shared and the user should be able to revoke.

### Specific decisions

1. **Pairwise `sub` as default for DCR clients.** Dynamically registered clients (wallets, adult sites) default to `subject_type: "pairwise"`. The `sub` claim becomes `HMAC-SHA256(pairwiseSecret, sectorId + userId)` — different per client, irreversible without the server secret. Only rp-admin-registered clients can be explicitly set to `public`.

2. **`PAIRWISE_SECRET` is required.** No longer optional. The setup script already generates it; making it required prevents accidental deployment without pairwise support.

3. **Consent records deleted for pairwise proof-only flows.** After the `oauth-provider` plugin writes the consent record and issues the authorization code, the `after` hook deletes the row if: the client is pairwise AND the original requested scopes contain no `identity.*` scopes.

4. **Access token records deleted for pairwise proof-only flows.** After token issuance, the `after` hook deletes the DB row if the same classification applies. JWT access tokens are self-contained (the RP validates the signature, not a DB lookup), so revocation becomes eventual (valid until expiry). For short-lived proof-only tokens this is acceptable.

5. **Session IP and user agent scrubbed.** `databaseHooks.session.create.before` nullifies `ipAddress` and `userAgent` for all sessions. This prevents Zentity from building behavioral profiles that could be correlated with RP access patterns.

6. **`email` and `profile` removed from DCR-allowed scopes.** DCR clients cannot request real-world identifiers. Public clients registered via rp-admin can still have these scopes set directly.

7. **Discovery advertises `subject_types_supported: ["public", "pairwise"]`.**

## Consequences

### Positive

- **ARCOM compliance.** Pairwise `sub` + transient records means Zentity cannot answer "which adult sites has user X visited?" — the data does not exist.
- **Privacy by default.** New clients get the strongest privacy posture without opt-in.
- **Dashboard clarity.** Connected Apps only shows persistent (relational) clients where revocation is meaningful. Empty state explains the design.
- **No protocol violations.** All changes are spec-compliant. OAuth/OIDC specs require transient session state during the flow but do not mandate persistence after code exchange.

### Negative

- **No revocation for pairwise proof-only tokens.** If a proof-only JWT is compromised, it remains valid until expiry. Mitigated by short token lifetimes.
- **Transient knowledge window.** During the authorize flow (~seconds), Zentity does see `(user, client_id)` in memory. Server logs could theoretically capture this. Mitigated by not logging OAuth query parameters (already the case) and IP scrubbing.
- **DB queries in after hooks.** Each consent and token flow adds 1-2 DB reads (client lookup) and potentially 1 delete. Acceptable overhead for the privacy guarantee.

### Neutral

- **Public clients unaffected.** Banks, exchanges, and other relational RPs continue to work exactly as before with persistent consent and stable `sub` values.
- **Upstream limitation remains.** The `@better-auth/oauth-provider` plugin's pairwise `sub` computation happens at the library level. If the upstream implementation changes, the schema column (`subject_type`) and secret are already in place.

## Implementation

### Data flow for a pairwise proof-only authorization

```text
User -> RP (adult site)
  -> Zentity /oauth2/authorize?client_id=X&scope=openid+proof:age
    [transient: Zentity sees (user, X) in memory]
  -> /oauth/consent (user approves proof:age)
    [plugin writes consent row]
    [after hook: client X is pairwise + no identity.* -> DELETE consent row]
  -> RP callback with auth code
  -> RP exchanges code at /oauth2/token
    [plugin writes access_token row, issues JWT]
    [after hook: client X is pairwise -> DELETE access_token row]
  -> RP receives JWT with pairwise sub, proof:age claims
    [zero persistent linkage remains in Zentity's DB]
```

## Why Pairwise Clients Get Opaque Access Tokens

JWT access tokens cannot use pairwise `sub` because the AS's own endpoints depend on `jwt.sub` for internal user lookup:

- `/oauth2/userinfo` calls `findUserById(jwt.sub)` — a pairwise HMAC would fail lookup.
- `/oauth2/introspect` re-resolves `sub` via `resolveIntrospectionSub` — applying pairwise to an already-pairwise value would double-hash.

The privacy boundary is the **token format**, not the `sub` claim value:

- **Opaque access tokens** (default for pairwise clients): RP can't decode the token. It uses it as a bearer for userinfo/introspection, which resolve pairwise `sub` at the presentation layer.
- **JWT access tokens** (only for public clients with `resource`): RP can decode `sub: user.id`. These are for resource-server API calls where `user.id` is needed for authorization.

Pairwise clients are **guarded from receiving JWT access tokens** — the `before` hook on `/oauth2/token` strips `resource` for pairwise clients, forcing opaque AT issuance. This ensures the RP only ever sees pairwise `sub` (via id_token, userinfo, or introspection).

### Spec alignment

This approach is compliant with all relevant OAuth/OIDC specifications:

- **RFC 6749 §1.4** — Access token format is explicitly implementation-defined: "access tokens can have different formats, structures, and methods of utilization." Opaque tokens are the baseline assumption; JWT is an optional profile.
- **RFC 8707 §2** — The `resource` parameter is OPTIONAL ("the client MAY specify"), and audience restriction is a SHOULD, not MUST. The AS is free to not audience-restrict tokens for specific client types.
- **RFC 9068** — The JWT Profile for Access Tokens is opt-in. No spec requires the AS to issue JWT access tokens; it is a format decision by the authorization server.
- **OIDC Core §8** — Pairwise subject identifiers are defined for id_tokens and the userinfo endpoint. The spec is silent on access token `sub`, leaving the AS free to handle it as an implementation detail.
- **RFC 7662 §2.2** — The `sub` field in introspection responses is OPTIONAL and its value is at the AS's discretion, enabling pairwise resolution at the presentation layer regardless of internal token storage.

## What This Does Not Cover

- **OID4VP presentation** — True issuer-unlinkability via credential-based presentation. Zentity already issues SD-JWT VCs; the missing piece is the RP-initiated presentation flow.
- **BBS+ anonymous credentials** — Long-term goal for multi-show unlinkability without any OAuth flow.
