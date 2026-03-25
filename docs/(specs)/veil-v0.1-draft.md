---
title: VEIL v0.1
description: Verified Ephemeral Identity Layer is a privacy-preserving identity security profile for OAuth 2.1
---

## Version 0.1-draft

**Status:** Draft\
**Date:** 2026-03-22

---

## Abstract

VEIL (Verified Ephemeral Identity Layer) is a security profile of OAuth 2.1 for privacy-preserving identity verification. It defines how an authorization server delivers verified claims about a person without exposing the underlying identity data that produced those claims.

The profile introduces a two-track claim model: *proof claims* (boolean verification results, compliance flags, assurance levels) flow freely through tokens, while *identity claims* (name, date of birth, address, nationality) flow only through an ephemeral, single-consume delivery channel that keeps PII off long-lived tokens entirely. Subjects are pairwise by default. Consent is HMAC-verified. Step-up authentication enforces assurance tiers proportional to the sensitivity of the requested operation.

VEIL is the foundation for domain-specific extensions. PACT (Private Agent Consent and Trust Profile) extends VEIL for agent delegation. Future extensions may cover verifiable credential issuance and presentation, regulatory compliance surfaces, or other domains that share the same privacy model.

---

## 1. Motivation

### 1.1 Attestation Without Exposure

Identity verification produces two structurally different outputs. The first is *attestation*: boolean results, compliance scores, and assurance tiers that answer questions like "is this person old enough?", "is this person in a permitted jurisdiction?", and "does this person have a verified document?" The second is *identity data*: the name, date of birth, address, and document details that were examined to produce those attestations.

Relying parties almost always need the first kind. They rarely need the second, and when they do, they need it temporarily for a specific operation (shipping an order, filing a regulatory report) rather than permanently. Yet the standard OpenID Connect model delivers both kinds through the same channel, with the same lifetime, and the same correlation properties.

VEIL separates them. Attestation flows through standard OAuth token claims. Identity data flows through an ephemeral channel with single-consume semantics. The relying party receives proof that the authorization server verified the user's identity without accumulating a plaintext PII database.

### 1.2 Design Principles

Six principles govern the profile's design. They share a common orientation: the default posture is privacy-preserving, and any deviation from that posture requires explicit opt-in.

1. **Two-track by default.** Proof claims and identity claims are structurally separated at the scope level, the consent level, and the delivery level.
2. **Pairwise by default.** Subject identifiers are per-relying-party pseudonyms. Global identifiers require explicit opt-in.
3. **Ephemeral by default.** Identity data is staged in memory with a TTL and consumed once, never embedded in tokens. The system forgets what it does not need.
4. **Abstract assurance.** The profile defines the interface for assurance level derivation (inputs, outputs, tiered levels) without mandating a specific verification pipeline.
5. **Step-up proportional.** Consent strength and assurance requirements scale with the sensitivity of the requested operation.
6. **Composable.** Domain-specific extensions (agent delegation, verifiable credentials, regulatory compliance) build on this foundation without modifying it.

### 1.3 Compositional Stance

VEIL profiles and constrains the following specifications:

| Concern | Specifications |
|---------|---------------|
| Authorization Framework | OAuth 2.1 (draft-ietf-oauth-v2-1) |
| Proof Key | PKCE (RFC 7636), mandatory |
| Pushed Authorization | PAR (RFC 9126), mandatory |
| Sender Constraining | DPoP (RFC 9449) |
| Identity Layer | OpenID Connect Core 1.0 |
| Structured Intent | Rich Authorization Requests (RFC 9396) |
| Token Exchange | RFC 8693 |
| Token Introspection | RFC 7662 |
| Back-Channel Logout | OIDC Back-Channel Logout 1.0 |

VEIL adds six capabilities at the composition seams, in the spaces between those specifications where privacy-relevant decisions are made:

1. Two-track claim model (Section 5)
2. Ephemeral identity delivery (Section 6)
3. Pairwise subject identifiers as default (Section 4)
4. Abstract assurance level derivation (Section 7)
5. Consent integrity verification (Section 9)
6. Extension profile architecture (Section 13)

---

## 2. Conventions and Terminology

### 2.1 Notational Conventions

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in RFC 2119 and RFC 8174.

### 2.2 Versioning

VEIL uses `MAJOR.MINOR[-draft]` versioning. Implementations MUST reject configurations or discovery documents with an unrecognized major version. Implementations SHOULD accept documents with a higher minor version than expected and ignore unrecognized fields, preserving forward compatibility.

### 2.3 Definitions

**Assurance Level.** A tiered classification of how thoroughly a user's identity has been verified. The profile defines the interface (inputs and outputs) but not the specific checks or tier definitions.

**Ephemeral Store.** An in-memory, TTL-bounded storage mechanism for identity claims with single-consume semantics. PII staged in the ephemeral store is consumed on first retrieval and automatically expires if unclaimed.

**Identity Claim.** A claim that contains personally identifiable information (name, date of birth, address, nationality, document details). Identity claims require explicit user action to release and flow only through the ephemeral store.

**Proof Claim.** A claim that conveys a boolean verification result, assurance level, or compliance flag without revealing the underlying PII. Proof claims flow through standard token claims and the userinfo endpoint.

**Proof Scope.** An OAuth scope that authorizes the release of proof claims. Proof scopes MUST NOT trigger identity claim delivery.

**Identity Scope.** An OAuth scope that authorizes the release of identity claims. Identity scopes require user action to unlock PII and flow through the ephemeral delivery channel.

**Sector Identifier.** A stable client-bound identifier used as input to pairwise subject derivation. In OIDC this is the registered sector identifier for the client; absent an explicit sector identifier, the chosen value SHOULD remain stable across redirect URI reordering.

**Step-Up Authentication.** A flow where the authorization server enforces a higher assurance requirement (`acr_values`) or session freshness (`max_age`) than the user's current session provides, triggering re-verification or re-authentication.

With the problem space and vocabulary in place, the remaining sections walk through VEIL's requirements in a sequence that mirrors how a request flows through the system: transport (Section 3), subject identity (Section 4), claim selection (Section 5), PII delivery (Section 6), assurance evaluation (Section 7), and the infrastructure that supports them all (Sections 8 through 11).

---

## 3. Transport Constraints

Every requirement in this section narrows the OAuth 2.1 optionality space to eliminate choices that weaken the privacy model. The shared pattern is *mandatory security*: where OAuth 2.1 says SHOULD or RECOMMENDED, VEIL says MUST.

### 3.1 Authorization Server Requirements

The authorization server MUST:

- Support OAuth 2.1 (draft-ietf-oauth-v2-1) authorization code flow with PKCE
- Require Pushed Authorization Requests (PAR, RFC 9126) for all authorization requests
- Support DPoP (RFC 9449) for sender-constrained tokens
- Issue access tokens signed with EdDSA (Ed25519) for compact signatures
- Support `id_token_signed_response_alg` client metadata for per-client signing algorithm selection

The authorization server SHOULD:

- Support multiple signing algorithms for id_tokens (RS256, ES256, EdDSA, ML-DSA-65)
- Support Rich Authorization Requests (RFC 9396) for structured intent
- Support Token Exchange (RFC 8693) for audience rebinding and scope attenuation
- Support Back-Channel Logout (OIDC BCL) for federated session termination

### 3.2 Client Requirements

Clients MUST:

- Use PKCE with `S256` challenge method
- Submit authorization parameters via PAR before initiating the authorization flow
- Include the `resource` parameter (RFC 8707) on PAR requests
- Support DPoP for sender-constrained token usage

Clients MUST NOT:

- Use the implicit grant
- Use the resource owner password credentials grant

Transport constraints secure the channel -- but who appears at each end?

---

## 4. Subject Unlinkability

The default posture of OIDC is globally stable subject identifiers: one `sub` per user, the same value sent to every RP. VEIL inverts this default. Unless a client explicitly requests global identifiers, every relying party sees a different pseudonym for the same user, making cross-RP correlation structurally impossible.

### 4.1 Default Posture

All client registrations MUST default to `subject_type: "pairwise"`. Clients that require globally stable subject identifiers explicitly opt in via `subject_type: "public"` at registration.

### 4.2 Derivation

Pairwise subject identifiers are derived as:

```text
sub = HMAC-SHA-256(PAIRWISE_SECRET, sector + "." + userId)
```

Where:

- `PAIRWISE_SECRET` is a server-side secret of at least 32 bytes.
- `sector` is the client's stable sector identifier. If the authorization server supports OIDC `sector_identifier_uri`, it MUST use that registered sector identifier. Otherwise it MUST derive a stable client-bound value that does not change when redirect URI order changes.
- `userId` is the internal user identifier.

Two clients with different sector identifiers receiving tokens for the same user see different `sub` values. Neither client can derive the other's `sub` or determine that both values refer to the same user.

### 4.3 Token Exchange

When performing RFC 8693 Token Exchange with an `audience` parameter, the authorization server MUST re-derive the pairwise `sub` for the target audience's sector identifier. The exchanged token's `sub` MUST differ from the subject token's `sub` unless both clients share the same sector.

### 4.4 Extension Point

Extension profiles MAY apply pairwise derivation to additional token claims. PACT extends pairwise derivation to the `act.sub` claim for agent session identifiers.

With cross-RP correlation blocked, the remaining question is what each RP learns about the user behind its pseudonym.

---

## 5. Claim Separation

Every identity system delivers claims. What distinguishes VEIL is that claims are divided into two structurally distinct tracks based on a single criterion: whether they contain personally identifiable information. The separation is not a policy recommendation; it is enforced at three levels simultaneously (scope definitions, consent decisions, and delivery mechanisms) so that no single point of failure can collapse the two tracks into one.

### 5.1 The Two Tracks

**Proof claims** convey verification results without PII. Examples: `age_verification: true`, `nationality_verified: true`, `verification_level: "full"`, `sybil_resistant: true`. Proof claims are derived from cryptographic artifacts (ZK proofs, signed claims, encrypted attributes) rather than raw identity data.

**Identity claims** contain PII. Examples: `name: "Jane Doe"`, `date_of_birth: "1990-05-15"`, `address: {...}`, `nationality: "FR"`. Identity claims require explicit user action to unlock and flow through the ephemeral delivery channel (Section 6).

The distinction between tracks is not what the claim *describes* but what it *reveals*. An age verification proof and a date of birth both describe the user's age, but the proof reveals only a boolean while the date reveals the value itself.

### 5.2 Scope Families

The authorization server MUST define two disjoint scope families:

**Proof scopes** (e.g., `proof:age`, `proof:nationality`, `proof:verification`, `proof:compliance`):

- Authorize the release of proof claims only
- MUST NOT trigger identity claim delivery
- Do not require vault unlock or any user action beyond initial consent
- May be auto-approved on subsequent requests if consent already exists

**Identity scopes** (e.g., `identity.name`, `identity.address`, `identity.nationality`, `identity.dob`):

- Authorize the release of identity claims
- MUST trigger the ephemeral delivery channel (Section 6)
- Require explicit user action to unlock PII for each authorization
- MUST NOT be persisted in durable consent records (ensuring the unlock prompt reappears on each request)

An umbrella proof scope (e.g., `proof:identity`) MAY expand to all proof sub-scopes at consent time, allowing the user to opt in per sub-scope.

### 5.3 Delivery Channels

The two tracks produce different delivery behavior at each OAuth endpoint:

**In id_tokens:** Proof claims MAY be embedded directly. Identity claims MUST NOT be embedded in id_tokens. Identity scopes unlock PII only through the ephemeral delivery channel and userinfo consumption path described in Section 6.

**In access tokens:** Access tokens ordinarily carry only structural claims (`sub`, `scope`, `aud`, `cnf`, and extension-defined claims like `act`). Proof claims are not embedded there except where a profile explicitly defines an access-token-only proof artifact. VEIL defines one such exception in Section 5.4: `proof:sybil` yields a per-RP `sybil_nullifier` in access tokens only. Identity claims MUST NOT be embedded in access tokens.

**Via userinfo:** Both proof claims and identity claims are delivered. Proof claims are resolved from the user's verification state. Identity claims are consumed from the ephemeral store (single-consume; the entry is deleted after retrieval).

### 5.4 Sybil Nullifiers

The profile defines an optional `proof:sybil` scope that produces a per-RP unlinkable nullifier:

```text
sybil_nullifier = HMAC-SHA-256(DEDUP_HMAC_SECRET, dedupKey + ":" + clientId)
```

The same person receives the same nullifier at one RP but different nullifiers at different RPs. This enables per-human rate limiting and duplicate detection without cross-RP identity linkage.

Proof claims now flow freely; identity claims are locked behind a gate. How do those locked claims actually reach an RP when they are genuinely needed?

---

## 6. Transient Disclosure

Every element in this section answers one question: how does PII reach the relying party without persisting beyond the moment it is needed? The mechanism is an in-memory store with single-consume semantics, bound to a user-initiated intent flow. The variation across implementations is the unlock mechanism (passkey PRF, password-derived key, wallet signature); the profile mandates the delivery semantics while leaving the unlock mechanism unspecified.

### 6.1 Single-Consume Properties

When identity scopes are approved, the authorization server stages PII in an in-memory store with the following properties:

| Property | Requirement |
|----------|-------------|
| Storage | In-memory only; MUST NOT be written to disk or database |
| Key | Implementation-defined. It MUST either include a request-specific handle or otherwise guarantee that only one live staged entry exists per `userId:clientId` |
| TTL | Configurable; SHOULD default to 5 minutes for interactive flows |
| Consumption | Single-consume; the entry MUST be deleted on first retrieval |
| Concurrency | If the key does not include a request-specific handle, concurrent staging for the same `userId:clientId` MUST be rejected until the earlier entry is consumed, cleared, or expires |
| Replay protection | Intent JTIs MUST be persisted in durable storage (not memory-only) and checked to prevent replay of unlock events. Persistence MUST use insert-or-ignore semantics to handle concurrent first-use races. |
| Rate limiting | Intent and stage endpoints MUST be rate-limited per user identity to prevent brute-force unlock attempts and ephemeral store flooding |
| Ambiguity safety | If multiple entries exist for the same `userId` when the consuming endpoint lacks `clientId` context, the server MUST return no claims rather than risk cross-client PII misdelivery |

### 6.2 Intent Flow

The staging process follows an intent-then-stage pattern to ensure that PII staging is bound to a specific user action and cannot be replayed or triggered by the relying party alone:

1. **User action.** The user performs a credential-specific unlock action (the mechanism is implementation-specific).
2. **Intent token.** The authorization server issues a signed intent token (HMAC-SHA-256, short TTL) carrying a scope hash and, for backchannel flows, the authorization request identifier that binds the unlock to a specific consent request.
3. **Stage.** The client presents the intent token. The server validates it, filters the user's identity data by the approved scopes, and stages the filtered claims in the ephemeral store.
4. **Consume.** The relying party calls the userinfo endpoint. The server retrieves and deletes the staged entry in a single atomic operation.

### 6.3 Exclusions

The ephemeral store MUST NOT contain:

- Raw biometric data (images, embeddings, liveness scores)
- Document images
- Cryptographic key material
- Internal identifiers that could be used to correlate across RPs

Only the identity claims authorized by the approved identity scopes are staged.

Ephemeral delivery solves the transport of PII. A prior question remains: how does the server determine what level of trust the user's identity warrants in the first place?

---

## 7. Tiered Verification

Every identity system needs a way to express "how verified is this person?" The systems differ in whether that expression is coupled to the verification pipeline or abstracted from it. VEIL abstracts: it defines the interface (what goes in, what comes out, what properties the function must have) while leaving the verification pipeline, check definitions, and tier labels to each implementation.

### 7.1 Abstract Interface

**Input:** A set of verification artifacts. The profile does not mandate the artifact types, but common examples include:

- **Zero-knowledge proof verification results**
- **Signed claims** from verification processes
- **Encrypted attribute presence flags**
- **Biometric match results**
- **Sybil resistance indicators**

**Output:** An assurance result containing:

| Field | Type | Description |
|-------|------|-------------|
| `verified` | boolean | Whether the user meets the minimum verification threshold |
| `level` | string | Tiered assurance level (implementation-defined labels) |
| `numericLevel` | integer | Numeric ordering of tiers for comparison |
| `checks` | object | Individual boolean check results (implementation-defined) |

### 7.2 Derivation Requirements

The derivation function MUST be:

- **Pure.** No database access, no side effects. All inputs are passed explicitly.
- **Deterministic.** The same inputs always produce the same output.
- **Monotonic in tier ordering.** A higher numeric level MUST satisfy any requirement for a lower level.

The authorization server MUST expose the assurance level through:

- The `acr` claim in id_tokens (mapping implementation tiers to URN identifiers)
- Proof claims filtered by granted proof scopes

### 7.3 Step-Up Enforcement

Step-up authentication is *spatial* (trust depends on which operation is attempted) rather than *temporal* (trust deepening over time). Two enforcement points apply:

When a client includes `acr_values` in an authorization request, the authorization server MUST verify that the user's current assurance level satisfies the requested tier. If it does not, the server MUST return an explicit step-up error rather than silently downgrading. In browser-based authorization flows, the error SHOULD be surfaced as `interaction_required`; extension profiles MAY define an equivalent continuation-oriented error if they also provide a resumable step-up path.

When a client includes `max_age`, the authorization server MUST verify that the user's session is not older than the specified value. If it is, the server MUST require re-authentication. In PAR-based flows, the PAR record SHOULD be preserved with an extended TTL to cover the re-authentication round-trip, so the authorization flow can resume after login. When `acr_values` cannot be satisfied in a browser-based PAR flow, the PAR record MUST be deleted and the server MUST redirect with the same step-up error contract used for other authorization flows (for example, `interaction_required`).

Extension profiles MAY define additional step-up enforcement points. PACT enforces `acr_values` at both CIBA approval time and token exchange time.

Because assurance claims travel inside signed JWTs, the signing layer itself needs constraints.

---

## 8. Signing Agility

### 8.1 Algorithm Selection

The authorization server MUST support at least RS256 for id_tokens (OIDC Discovery 1.0 Section 3 mandatory). The authorization server SHOULD support ES256, EdDSA, and ML-DSA-65.

Access tokens MUST be signed with EdDSA (compact 64-byte signatures for Bearer headers).

Clients MAY declare a preferred id_token signing algorithm via `id_token_signed_response_alg` in their registration metadata. The authorization server MUST honor the declared preference if it supports the algorithm.

### 8.2 Key Management

Signing keys MUST be encrypted at rest (SHOULD use AES-256-GCM with a dedicated key encryption key).

Key rotation MUST support an overlap window during which both the retiring and replacement keys are served by the JWKS endpoint. The retiring key carries an `expiresAt` timestamp; after the overlap window, it is removed.

Token signatures guard integrity in transit. The decisions that *produce* those tokens -- consent records -- need their own tamper-evidence guarantees.

---

## 9. Tamper-Evident Consent

Consent records are the authorization server's memory of what the user approved. If that memory can be altered, the two-track model and ephemeral delivery provide no protection, because an attacker who can escalate stored scopes can bypass both mechanisms. VEIL makes consent tamper-evident through HMAC verification and structurally prevents identity scope persistence.

### 9.1 Scope Verification

The authorization server MUST verify the integrity of stored consent records on every authorization request. Consent records MUST be protected by an HMAC computed over the consent context:

```text
scope_hmac = HMAC-SHA-256(SECRET, length_prefix(context) ||
  length_prefix(userId) || length_prefix(clientId) ||
  length_prefix(referenceId) || length_prefix(sorted_scopes))
```

Length-prefixed encoding prevents concatenation collisions. The HMAC key MUST be derived from the server's base secret via a KDF (e.g., HKDF) with a domain-separating `info` parameter, not used as a raw key. This separation ensures that the consent integrity key and the session authentication key are cryptographically independent even when derived from the same root secret.

### 9.2 Tamper Response

Before processing an authorization request against stored consent, the server MUST recompute the HMAC and compare it to the stored value. If they differ, the server MUST delete the consent record and require re-consent. This prevents three attack vectors: direct database scope escalation, consent replay across clients, and consent replay across users.

### 9.3 Identity Scope Stripping

Identity scopes MUST NOT be persisted in durable consent records. The full scope set (including identity scopes) is written for authorization code derivation, then identity scopes are stripped immediately so that the consent page reappears on subsequent requests. This ensures that PII delivery requires a fresh user decision each time.

---

## 10. Federated Session Termination

### 10.1 Back-Channel Logout

The authorization server MUST support OIDC Back-Channel Logout for federated session termination. On user sign-out:

1. Query all registered clients with a `backchannel_logout_uri`.
2. For each: build a logout token JWT with the client's pairwise `sub` and `sid` (if `backchannel_logout_session_required`).
3. POST the logout token to the client's endpoint.
4. Retry with exponential backoff on transient failures.

### 10.2 Extension Coordination

Extension profiles MAY define additional cleanup actions triggered by logout. PACT revokes pending CIBA requests on user logout.

---

## 11. Machine-Readable Surfaces

### 11.1 OIDC Discovery Extensions

The authorization server's OpenID Provider Configuration (`/.well-known/openid-configuration`) MUST include:

- `subject_types_supported: ["pairwise", "public"]` with pairwise listed first
- `acr_values_supported` listing all supported assurance tier URNs
- `scopes_supported` listing all proof and identity scopes
- `backchannel_logout_supported: true`
- `backchannel_logout_session_supported: true`
- `require_pushed_authorization_requests: true`
- `dpop_signing_alg_values_supported`
- `id_token_signing_alg_values_supported` (at minimum `["RS256"]`)

### 11.2 Extension Discovery

Extension profiles define their own discovery documents at dedicated well-known paths. PACT publishes `/.well-known/agent-configuration`. The OIDC Discovery document SHOULD NOT be overloaded with extension-specific metadata.

---

## 12. Security Boundaries

VEIL's protections (PII ephemeral delivery, subject unlinkability, consent integrity) are not a closed system. This section addresses the residual attack surface they leave open.

### 12.1 PII Exposure Window

Identity claims exist in cleartext only during the ephemeral delivery window (between staging and consumption). Outside that window, identity data is either encrypted (credential-wrapped secrets, FHE ciphertexts) or absent.

Authorization servers MUST NOT log identity claim values. Authorization servers MUST NOT cache identity claims beyond the ephemeral store TTL.

### 12.2 Correlation Resistance

Pairwise subject identifiers prevent cross-RP user correlation under the standard OIDC threat model. However, timing correlation (two RPs comparing token issuance timestamps) and metadata correlation (user agent, IP address) remain possible. The authorization server SHOULD minimize metadata leakage in token responses and SHOULD NOT include client-identifying information in error responses visible to other clients.

### 12.3 Sender Constraining

DPoP sender-constraining prevents token theft and replay. When combined with pairwise subjects, a stolen token is useless to a different RP (wrong `aud`) and useless to a different client (wrong `cnf.jkt`).

---

## 13. Compositional Extension

VEIL covers the privacy properties that every identity scenario shares. Domain-specific use cases (agent delegation, verifiable credentials, regulatory compliance) each require additional capabilities that do not belong in the core. This section defines how extensions relate to VEIL without modifying it.

### 13.1 Architecture

Each extension profile:

- References VEIL as its base and inherits all VEIL requirements
- Adds domain-specific capabilities without modifying VEIL's core requirements
- Defines its own discovery document at a dedicated well-known path
- Specifies additional conformance requirements for its domain

### 13.2 Registered Extensions

| Extension | Domain | Discovery Path | Status |
|-----------|--------|---------------|--------|
| PACT | Agent delegation | `/.well-known/agent-configuration` | v0.1-draft |

### 13.3 Extension Boundaries

Extension profiles MUST NOT:

- Weaken pairwise subject requirements (e.g., defaulting to public subjects)
- Bypass the ephemeral delivery channel for identity claims
- Embed identity claims in access tokens or extension-specific token types
- Modify the consent integrity mechanism

Extension profiles MAY:

- Define additional pairwise derivations (e.g., PACT's pairwise `act.sub`)
- Define additional step-up enforcement points
- Define additional token types via Token Exchange
- Define additional consent routing logic
- Extend the ephemeral store TTL for their specific flow patterns (e.g., PACT uses 10-minute TTL for CIBA flows)

---

## 14. Unlinkability by Default

Extension boundaries define what third-party profiles may and may not do. This section turns inward to what VEIL itself *refuses to create*: correlators. Every consideration here is an instance of the same principle, that the default posture is unlinkability and any deviation requires explicit opt-in.

### 14.1 Double Anonymity

The profile supports a double-anonymity mode where both sides of the identity verification relationship are protected. The relying party cannot identify the user or recognize returning users (pairwise subjects, no email scope), and the authorization server cannot reconstruct which services the user visits (consent records do not accumulate when identity scopes are stripped). This mode satisfies frameworks like France's ARCOM/CNIL age verification referentiel.

### 14.2 Sybil Nullifier Privacy

The `sybil_nullifier` (Section 5.4) is derived per-RP. Two RPs receiving nullifiers for the same user cannot determine that fact. The nullifier enables per-human uniqueness enforcement without cross-RP identity linkage.

### 14.3 Session Metadata Nullification

The authorization server MUST NOT persist the user's IP address or user agent in session records. If the session layer collects these values (as most frameworks do by default), they MUST be nullified before storage. Without this, two RPs that obtain session metadata (via breach, legal compulsion, or insider access) can correlate users by matching IP + user agent + timestamp patterns.

### 14.4 Provider Fingerprint Removal

Four concrete signals can fingerprint the authorization server and enable cross-RP provider correlation:

1. **Provider identifiers in proof claims.** Proof claim payloads MUST NOT include provider-identifying fields (e.g., `issuer_id`). Provider identity is an internal audit concern.
2. **Trust framework naming.** The trust framework identifier in identity assurance claims SHOULD identify the regulatory framework (e.g., `eidas`), not the provider name.
3. **Credential type identifiers.** Verifiable credential type identifiers (VCT) MUST use provider-neutral URNs (e.g., `urn:credential:identity-verification:v1`) rather than provider-domain URLs.
4. **Structural fingerprinting.** SD-JWT credentials SHOULD include decoy disclosures to prevent fingerprinting via disclosed claim set analysis.

### 14.5 Claim Specificity

Proof claims are derived from cryptographic artifacts, not from raw PII. The authorization server SHOULD minimize the specificity of proof claims. For example, `nationality_group: "EU"` is preferable to `nationality: "FR"` when the relying party's requirement is jurisdiction membership rather than specific nationality.

---

## 15. Conformance

### 15.1 Authorization Server Requirements

A conforming authorization server MUST:

- Implement the OAuth 2.1 baseline (Section 3)
- Default to pairwise subject identifiers (Section 4)
- Implement the two-track claim model (Section 5)
- Implement ephemeral identity delivery with single-consume semantics (Section 6)
- Implement an assurance level derivation function that satisfies the abstract interface (Section 7)
- Enforce step-up authentication for `acr_values` and `max_age` (Section 7.3)
- Protect consent records with HMAC integrity verification (Section 9)
- Strip identity scopes from persisted consent (Section 9.3)
- Support back-channel logout (Section 10)
- Publish OIDC Discovery metadata per Section 11

### 15.2 Client Requirements

A conforming client MUST:

- Use PKCE with `S256` and PAR for all authorization requests (Section 3.2)
- Include the `resource` parameter on PAR requests
- Support DPoP for token binding
- Consume identity claims from the userinfo endpoint, not from id_token claims alone
- Treat userinfo identity claim delivery as single-consume (do not retry expecting the same data)

---

## 16. Standards Composition

| Surface | Specification | Role in VEIL |
|---------|---------------|-------------|
| Authorization framework | OAuth 2.1 (draft-ietf-oauth-v2-1) | Base framework with PKCE, PAR mandatory |
| Identity layer | OpenID Connect Core 1.0 | Claims, userinfo, pairwise subjects |
| Sender constraining | DPoP (RFC 9449) | Token binding to holder key |
| Pushed authorization | PAR (RFC 9126) | Back-channel parameter delivery |
| Structured intent | RAR (RFC 9396) | Typed authorization payloads |
| Token exchange | RFC 8693 | Audience rebinding with pairwise re-derivation |
| Token introspection | RFC 7662 | Runtime token validation |
| Session termination | OIDC Back-Channel Logout 1.0 | Federated logout |
| Two-track claim model | VEIL | Proof/identity scope separation |
| Ephemeral PII delivery | VEIL | Single-consume, TTL-bounded identity claims |
| Pairwise default | VEIL | Subject unlinkability as default posture |
| Abstract assurance | VEIL | Interface for tiered verification derivation |
| Consent integrity | VEIL | HMAC-verified scope records |
| Extension architecture | VEIL | Foundation for domain-specific profiles |

---

## 17. References

### Normative References

- [draft-ietf-oauth-v2-1](https://datatracker.ietf.org/doc/draft-ietf-oauth-v2-1/) The OAuth 2.1 Authorization Framework
- [RFC 7636](https://datatracker.ietf.org/doc/html/rfc7636) Proof Key for Code Exchange (PKCE)
- [RFC 7662](https://datatracker.ietf.org/doc/html/rfc7662) OAuth 2.0 Token Introspection
- [RFC 8693](https://datatracker.ietf.org/doc/html/rfc8693) OAuth 2.0 Token Exchange
- [RFC 9126](https://datatracker.ietf.org/doc/html/rfc9126) OAuth 2.0 Pushed Authorization Requests (PAR)
- [RFC 9396](https://datatracker.ietf.org/doc/html/rfc9396) OAuth 2.0 Rich Authorization Requests (RAR)
- [RFC 9449](https://datatracker.ietf.org/doc/html/rfc9449) OAuth 2.0 Demonstrating Proof of Possession (DPoP)
- [OIDC Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html) OpenID Connect Core 1.0
- [OIDC BCL 1.0](https://openid.net/specs/openid-connect-backchannel-1_0.html) OpenID Connect Back-Channel Logout 1.0

### Informative References

- [PACT v0.1-draft](/docs/pact-v0.1-draft) Private Agent Consent and Trust Profile
- [FAPI 2.0](https://openid.net/specs/fapi-2_0-security-profile.html) Financial-grade API Security Profile 2.0
- [HAIP 1.0](https://openid.net/specs/openid4vc-high-assurance-interoperability-profile-1_0.html) OpenID4VC High Assurance Interoperability Profile 1.0
