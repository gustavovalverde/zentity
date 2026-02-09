---
status: "accepted"
date: "2026-02-05"
builds-on: "[Consent-Based Disclosure](0004-consent-based-disclosure.md)"
category: "technical"
domains: [privacy, product]
---

# Selective disclosure via granular OAuth scopes with opt-in consent

## Context and Problem Statement

Zentity acts as an OAuth 2.1 / OpenID Connect authorization server. Relying parties (RPs) request user data through scopes. Two categories of data exist:

1. **Verification status** (derived booleans) — "is this person verified?", "is their age proven?"
2. **Identity PII** (personal data) — name, date of birth, address, nationality

Previously, a single `proof:identity` scope dumped all 13 verification status flags to any RP that requested it. A wine shop verifying age received the same data as a bank doing full KYC. This violated the principle of minimal disclosure and gave users no control over which verification details were shared.

The `identity.*` scopes (identity.name, identity.dob, etc.) already supported granular consent, but `proof:identity` had no sub-scope granularity.

## Priorities & Constraints

* **User-controlled selective disclosure** — the user, not the RP, decides what to share at consent time
* **Standards compatibility** — use standard OAuth scope mechanics, not custom protocol extensions
* **Two data categories** — verification status (non-PII) and identity data (PII) serve different use cases and should remain separate scope families
* **Privacy by default** — nothing shared unless the user explicitly opts in
* **DCR compatibility** — dynamically registered clients must be able to request verification data

## Decision Outcome

Chosen option: two-layer selective disclosure using granular `proof:*` sub-scopes with opt-in consent.

### Scope Architecture

**Proof scopes** (non-PII — derived booleans):

| Scope | Claims | Purpose |
|-------|--------|---------|
| `proof:identity` | All below (umbrella) | Full verification status |
| `proof:verification` | `verification_level`, `verified` | Basic "is verified" check |
| `proof:age` | `age_proof_verified` | Age-gated services |
| `proof:document` | `document_verified`, `doc_validity_proof_verified` | Document verification |
| `proof:liveness` | `liveness_verified`, `face_match_verified` | Biometric verification |
| `proof:nationality` | `nationality_proof_verified` | Nationality proof |
| `proof:compliance` | `policy_version`, `issuer_id`, `verification_time`, `attestation_expires_at` | Audit metadata |

**Identity PII scopes** (actual personal data):

| Scope | Claims | Purpose |
|-------|--------|---------|
| `identity.name` | `given_name`, `family_name`, `name` | Full name |
| `identity.dob` | `birthdate` | Date of birth |
| `identity.address` | `address` | Residential address |
| `identity.document` | `document_number`, `document_type`, `issuing_country` | Document details |
| `identity.nationality` | `nationality`, `nationalities` | Nationality |

### Consent Flow

1. RP requests `proof:identity` (umbrella scope)
2. Consent page **expands** `proof:identity` into individual `proof:*` sub-scope checkboxes
3. All checkboxes start **unchecked** (opt-in, not opt-out)
4. User selects only the claims they want to share
5. Approved scopes (e.g., `proof:verification proof:age`) go into the access token
6. Userinfo endpoint filters response to only return claims matching the token's scopes

The same pattern applies to `identity.*` scopes — they appear as unchecked checkboxes, and the user opts in to each one.

### Standards Compliance

This approach uses standard OAuth 2.0 mechanics:

* **Custom scopes**: Explicitly supported by OAuth 2.0 (RFC 6749). Custom scope values are the standard extension mechanism.
* **Scope narrowing at consent**: The AS MAY grant fewer scopes than requested (RFC 6749 Section 3.3). This is how the user's selective choices are implemented.
* **Scope-to-claim mapping**: Follows the same pattern as OIDC's built-in `profile` → `{name, given_name, ...}` mapping.

Zentity also supports two additional disclosure paths alongside scopes:

* **OIDC4IDA** (OpenID for Identity Assurance) — The `@better-auth/oidc4ida` plugin returns `verified_claims` in id_token and userinfo when an RP includes the `claims` parameter in the authorize request (per OIDC4IDA Section 7). The `verified_claims` structure wraps verification evidence and attested claims under the `zentity` trust framework. If the `claims` parameter is absent, the plugin does not inject `verified_claims` — scope-based disclosure (this ADR) handles those requests instead.
* **SD-JWT VC** (OIDC4VCI) — Holder-controlled selective disclosure at credential presentation time.

### Expected Consequences

* Users have fine-grained, opt-in control over verification and identity disclosure
* A wine shop requesting `proof:identity` only gets `verified` + `age_proof_verified` if that's all the user approves
* A bank gets full verification status + PII because the user opts in to everything
* DCR-registered clients request `proof:identity` (allowed in `publicClientScopes`) and the user controls the rest
* Three disclosure paths coexist: scope-based (this ADR), OIDC4IDA (`verified_claims` via `claims` parameter), and SD-JWT VC

## Alternatives Considered

* **OIDC `claims` parameter only (Section 5.5)**: Using `claims` as the sole disclosure mechanism via `{"userinfo": {"given_name": {"essential": true}}}`. Rejected as the primary path because most OAuth libraries don't implement it, while all support scopes. However, the `claims` parameter is used by the OIDC4IDA plugin as a complementary path for RPs that specifically need `verified_claims` with evidence metadata.
* **Server-side scope enforcement only**: RP pre-defines granular scopes (`proof:age`), no user choice at consent. Rejected because this is access control, not selective disclosure — the user has no agency.
* **Single `proof:identity` scope with all-or-nothing consent**: The previous approach. Rejected because it violates minimal disclosure.
* **Merge proof:* and identity.* into one family**: Would lose the clear separation between non-PII verification status and actual personal data, which serve fundamentally different use cases.

## More Information

* Proof scope implementation: `apps/web/src/lib/auth/oidc/proof-scopes.ts` (scope mapping and filtering)
* OIDC4IDA implementation: `oidc4ida({ getVerifiedClaims })` in `apps/web/src/lib/auth/auth.ts`
* Consent UI: `apps/web/src/app/oauth/consent/consent-client.tsx`
* Userinfo hook: `customUserInfoClaims` in `apps/web/src/lib/auth/auth.ts`
* Previous ADR: [Consent-Based Disclosure](0004-consent-based-disclosure.md)
* OAuth integrations: [docs/oauth-integrations.md](../../oauth-integrations.md)
