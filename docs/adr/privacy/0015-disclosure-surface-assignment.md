---
status: "accepted"
date: "2026-03-25"
builds-on: "[Selective disclosure via granular OAuth scopes with opt-in consent](0011-selective-disclosure-scope-architecture.md)"
category: "technical"
domains: [privacy, security, platform, product]
---

# Assign disclosure claims to token and userinfo surfaces by claim class

## Context and Problem Statement

Zentity now has multiple channels that request and consume user data: browser OAuth RPs, CIBA flows, MCP tools, RPs, and future extensions built on VEIL and PACT. The project already distinguishes between standard account/session claims, non-PII proof claims, vault-gated identity claims, and operational/resource scopes, but the rationale for where each class is delivered was scattered across implementation details and protocol prose.

Without an explicit architectural decision, new integrations can drift in predictable ways: treating `email` like vault-gated identity, treating all `proof:*` scopes as interchangeable, embedding release-time identity data in token artifacts, or exposing anti-abuse handles in broad claim surfaces where they are likely to be persisted and correlated.

## Priorities & Constraints

* **Minimize persistent disclosure.** PII must not land in token surfaces that are routinely logged, cached, forwarded, or stored by clients.
* **Keep standards semantics recognizable.** Standard OIDC scopes should retain standard meaning unless Zentity has a strong privacy reason to extend them.
* **Preserve cross-channel consistency.** Browser OAuth, CIBA, MCP, and RPs must compile to the same disclosure contract even when their UX differs.
* **Protect double-anonymity and pairwise privacy.** RP-specific anti-abuse handles must not become cross-surface correlators.
* **Support future extensions without re-litigating basics.** New channels and tools should be able to answer "what goes in the access token, ID token, and userinfo?" from one decision record.

## Decision Outcome

Chosen option: assign delivery surfaces by **claim class**, not by channel or tool.

Zentity adopts one disclosure contract:

1. **Standard session scopes** (`openid`, `email`, `offline_access`) keep standard OAuth/OIDC meaning.
2. **Proof scopes** (`proof:*`) represent non-PII verification outcomes.
3. **Identity scopes** (`identity.*`) represent vault-gated PII.
4. **Operational scopes** authorize resource access and control-plane actions with no user-claim payload.

### Surface assignment rules

#### 1. ID token is for session/bootstrap identity and safe proof state

`id_token` may carry:

* standard session claims such as `sub`
* standard account claims such as `email` and `email_verified`, but only when the `email` scope was actually granted
* proof claims that do not create cross-surface correlation risk
* authentication context claims such as `acr`, `amr`, and related session metadata
* opaque disclosure-binding pointers when needed to bind later release flows

`id_token` must not carry plaintext identity PII from `identity.*` scopes.

Rationale:

* `id_token` is widely decoded, cached, and persisted by client SDKs, browser apps, logs, and session layers.
* It is the right place for safe bootstrap/session state because clients need that state immediately after login.
* It is the wrong place for vault-gated identity disclosure because token persistence would defeat the transient-disclosure model.

#### 2. Userinfo is the only delivery surface for identity PII

`userinfo` is the canonical delivery surface for `identity.*` claims.

Identity claims:

* require vault unlock
* are exact-bound to the authorization or approval context
* are staged ephemerally
* are consumed once
* are not embedded in long-lived token artifacts

Rationale:

* `userinfo` is a fetch-time disclosure surface rather than a login-time artifact.
* It lets Zentity bind PII release to the exact authorization context instead of copying PII into reusable tokens.
* It supports the volatile single-consume release pipeline captured in ADR-0014.

#### 3. Access token is for audience-bound operational artifacts

Access tokens ordinarily carry structural and audience-bound claims such as:

* `aud`
* `scope`
* `cnf`
* `act`
* other operational or binding metadata needed by the target resource server

They may also carry opaque release-binding handles when the resource server must resolve a later disclosure context, but they must not carry plaintext identity PII.

Rationale:

* Access tokens are the narrowest audience-bound artifact in the system.
* They are appropriate for values that only the target resource server should consume.
* They are not appropriate for copying profile or vault data.

#### 4. No client-readable artifact carries the real user id

Pairwise subjects stop relying parties from correlating one user across clients. Every artifact a client can read therefore carries that client's subject identifier: its pairwise subject for a pairwise client, the user id for a public client.

* `id_token`, `userinfo`, introspection, and proof-of-human responses project the client's subject.
* Access tokens for endpoints Zentity serves (the app origin, the auth issuer, and every resource under it, including `userinfo`) are opaque reference tokens that Zentity resolves server-side. Zentity drops Zentity-hosted `resource` indicators from user token requests so the OAuth provider issues opaque tokens. Token exchange mints opaque tokens for the app only, never a JWT and never for another audience, with no actor or delegation claims; the only claim such a token stores is the agent bootstrap marker (token use), which introspection returns. A subject token that carries an actor, a CIBA approval, or `authorization_details` is refused, so an approval reaches only the audience the user approved.
* JWT access tokens exist only for resource servers outside Zentity (the MCP server, an agent wallet) and for the OID4VCI credential endpoint. A JWT names at most one audience outside Zentity, and a request for two is refused with `invalid_target`. For a pairwise client its `sub` is pairwise for the client and that audience together, from the token sector `sector + " " + audience`, so one client's MCP token, wallet token, and ID token carry three different values. A JWT whose audiences are all Zentity-hosted keeps the client's subject. The OAuth provider makes the subject pairwise (`accessTokenSubject: "pairwise"`) and writes `ba_sub`, the user id encrypted under a provider key; Zentity's signer replaces the client-level value with the audience's. UserInfo, introspection, and every Zentity endpoint that validates one through the provider, such as token exchange and agent introspection, read the user from `ba_sub`.
* Every JWT Zentity signs is explicitly typed (`at+jwt` access tokens, `logout+jwt` logout tokens, `secevent+jwt` validity notices, `JWT` ID tokens), and Zentity endpoints that accept one require the expected type. JWT access tokens are also refused once their `jti` is revoked, or once the refresh token of their grant is revoked; opaque access tokens are refused once the stored token is marked revoked. A JWT access token of a grant that can be revoked carries `grant_id`, a hash the OAuth provider derives per grant. It links the tokens of one grant, which already share the client and the subject.
* A client names the user back to Zentity with the subject it received, for example as a CIBA `login_hint`. That is the only `login_hint` form CIBA accepts: an email address or a user id the client was not issued resolves to `unknown_user_id`, the same answer as an identifier that matches no account.

Rationale:

* A holder can decode a JWT, so a JWT that reached two clients with the real user id would let them correlate the user.
* `userinfo` and Zentity's resource servers look the user up by the token; an opaque token resolves to the user server-side without exposing the id.
* Resource servers outside Zentity verify JWTs locally and need an identifier for the user, not the user id itself.

#### 5. `proof:sybil` is access-token-only

`proof:sybil` is the only proof scope whose claim (`sybil_nullifier`) is delivered in the access token only.

Rationale:

* `sybil_nullifier` is not a user-facing profile claim. It is an RP-specific anti-abuse handle derived from `(nullifierSeed, clientId)`, where `nullifierSeed` is an HMAC-derived value stored on the account snapshot, seeded from the first verified credential, and preserved across later credential additions until full revocation. Raw ZKPassport chip identifiers never reach the bundle: the seed is `HMAC-SHA256(DEDUP_HMAC_SECRET, rawKey || source)` with domain separation between OCR dedup keys and NFC chip nullifiers.
* Putting it in `id_token` would spread a per-RP pseudonym into client/session surfaces that are often cached and logged.
* Putting it in `userinfo` would make developers treat it like ordinary profile data and persist it alongside claims.
* The access token is audience-bound and sender-constrained, so it is the correct place for an operational per-RP nullifier.

In other words, `proof:sybil` remains in the proof family because it is non-PII, but its delivery surface follows the logic of an operational anti-abuse artifact.

#### 6. `email` remains standard, but never default

`email` is standard account/session identity, not vault-gated `identity.*` disclosure.

It follows two rules:

* if `email` was granted, it may appear in standard OIDC surfaces
* if `email` was not granted, it must not be disclosed by convenience APIs, MCP tools, or profile reads

Rationale:

* Treating `email` as vault-gated identity would overload standard OIDC semantics and create needless special cases.
* Treating `email` as "always available because the session knows it" would violate data minimization and double-anonymity requirements.
* This keeps anonymous and double-anonymous relying parties possible: they simply do not request `email`.

#### 7. Channels adapt transport and UX, not disclosure semantics

Browser OAuth, CIBA, MCP, and demo RPs all use the same disclosure classes and surface rules.

What changes by channel:

* transport
* approval UX
* browser handoff mechanics
* polling or callback behavior

What does not change by channel:

* whether a claim is standard, proof, identity, or operational
* whether vault unlock is required
* whether exact binding is required
* whether a claim belongs in `id_token`, `userinfo`, or `access_token`

### Expected Consequences

* Future channels have one answer for surface placement: classify the claim first, then choose the surface from the class.
* MCP tools no longer invent their own claim semantics; they compile fields and actions to the same disclosure profile.
* `whoami` stays a safe summary tool and `my_profile` stays a vault-gated identity tool.
* Anonymous or pairwise RPs can avoid receiving `email` simply by not requesting the `email` scope.
* `proof:sybil` remains available for anti-abuse and uniqueness controls without polluting broader claim surfaces.
* The implementation must preserve strong contract tests, because multiple workspaces still consume the contract indirectly.

## Alternatives Considered

* **Put identity PII into `id_token` for convenience.** Rejected because `id_token` is too broadly copied, logged, and persisted. This breaks the transient disclosure model.
* **Put all proof claims in all surfaces, including `proof:sybil`.** Rejected because `sybil_nullifier` is an RP-specific pseudonym and would become a correlation vector if exposed in shared surfaces.
* **Treat `email` as vault-gated identity.** Rejected because it conflicts with standard OIDC semantics and would make routine account identity unnecessarily exotic.
* **Treat `email` as always available regardless of scope.** Rejected because it violates data minimization and breaks double-anonymity for integrations that intentionally omit the `email` scope.
* **Define channel-specific disclosure semantics.** Rejected because it guarantees drift. Channels may differ in transport and UX, but not in what a granted scope means.
* **Move the contract immediately into a shared package.** Rejected for now. The amount of shared disclosure data is still small enough that a canonical web-side registry plus cross-workspace contract-validation tests is lower-overhead than a package split. This can be revisited if the contract surface grows substantially.

## More Information

* Written profile: `docs/(protocols)/disclosure-profile.md`
* Integration guide: `docs/(protocols)/oauth-integrations.md`
* Scope architecture: [ADR-0011](0011-selective-disclosure-scope-architecture.md)
* Volatile identity staging: [ADR-0014](0014-volatile-identity-release-store.md)
* Double-anonymity posture: [ADR-0001](../0001-arcom-double-anonymity.md)
* Code authority: `apps/web/src/lib/auth/oidc/disclosure/registry.ts`
* Contract tests: `apps/web/src/lib/auth/oidc/disclosure/__tests__/rp-contract.test.ts`

## Revision History

* 2026-09-27: Added rule 4. Access tokens audienced to Zentity-served endpoints carry the real user id; pairwise subjects apply to client-facing surfaces and to access tokens for resource servers outside Zentity.
* 2026-09-27: Rewrote rule 4. No client-readable artifact carries the real user id: access tokens for Zentity-served endpoints are opaque, and JWT access tokens (resource servers outside Zentity and the OID4VCI credential endpoint) carry the requesting client's subject identifier.
* 2026-09-27: CIBA `login_hint` accepts only the subject identifier the requesting client received; email addresses and unissued user ids are refused like unknown identifiers.
* 2026-09-27: Zentity-issued JWTs carry an explicit type that verifiers require, and revoked access tokens (JWT and opaque) are refused.
* 2026-11-15: The OAuth provider revokes JWT access tokens. Revoking a refresh token also revokes its grant's JWT access tokens, which carry a `grant_id` claim.
* 2026-11-15: Introspection of an opaque exchanged token returns the claims stored with it (token use, task, oversight, audit, capabilities, and delegation), as a JWT access token would carry them.
* 2026-11-16: Token exchange mints only opaque tokens for the app, without actor or delegation claims, and refuses agent-backed, CIBA, and `authorization_details` subjects.
* 2026-11-16: The OAuth provider writes the pairwise `sub` of JWT access tokens and the encrypted `ba_sub`, so UserInfo and introspection resolve a pairwise client's JWT. Zentity no longer rewrites the subject or maps it back through the pairwise subject index.
* 2026-11-16: Rule 4: a JWT access token names at most one audience outside Zentity, and its `sub` is pairwise per client and audience (token sector `sector + " " + audience`), so the client's resource servers and its ID tokens see different subjects for one user.
