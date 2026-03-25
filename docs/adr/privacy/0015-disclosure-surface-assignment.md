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

#### 4. `proof:sybil` is access-token-only

`proof:sybil` is the only proof scope whose claim (`sybil_nullifier`) is delivered in the access token only.

Rationale:

* `sybil_nullifier` is not a user-facing profile claim. It is an RP-specific anti-abuse handle derived from `(dedupKey, clientId)`.
* Putting it in `id_token` would spread a per-RP pseudonym into client/session surfaces that are often cached and logged.
* Putting it in `userinfo` would make developers treat it like ordinary profile data and persist it alongside claims.
* The access token is audience-bound and sender-constrained, so it is the correct place for an operational per-RP nullifier.

In other words, `proof:sybil` remains in the proof family because it is non-PII, but its delivery surface follows the logic of an operational anti-abuse artifact.

#### 5. `email` remains standard, but never default

`email` is standard account/session identity, not vault-gated `identity.*` disclosure.

It follows two rules:

* if `email` was granted, it may appear in standard OIDC surfaces
* if `email` was not granted, it must not be disclosed by convenience APIs, MCP tools, or profile reads

Rationale:

* Treating `email` as vault-gated identity would overload standard OIDC semantics and create needless special cases.
* Treating `email` as "always available because the session knows it" would violate data minimization and double-anonymity requirements.
* This keeps anonymous and double-anonymous relying parties possible: they simply do not request `email`.

#### 6. Channels adapt transport and UX, not disclosure semantics

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
* Double-anonymity posture: [ADR-0001](../../0001-arcom-double-anonymity.md)
* Code authority: `apps/web/src/lib/auth/oidc/disclosure-registry.ts`
* Contract tests: `apps/web/src/lib/auth/oidc/__tests__/rp-contract.test.ts`
