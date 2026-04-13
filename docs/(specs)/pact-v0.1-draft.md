---
title: PACT v0.1
description: Private Agent Consent and Trust is a security profile for agent authorization over OAuth 2.1 and CIBA
---

## Version 0.1-draft

**Status:** Draft\
**Date:** 2026-03-22

---

## Abstract

PACT (Private Agent Consent and Trust Profile) is an extension of the VEIL (Verified Ephemeral Identity Layer) security profile for privacy-preserving agent delegation. It defines how an agent acts on behalf of a human under structured constraints, with human consent proportional to risk, without creating globally trackable agent identifiers.

PACT inherits VEIL's privacy foundations (pairwise subjects, ephemeral PII delivery, two-track claims, consent integrity, step-up authentication) and extends them with agent-specific capabilities: host and session identity, CIBA-based consent routing, capability grants with typed constraints and usage limits, cryptographic binding chains, pairwise agent identifiers, and audience-bound authorization artifacts.

PACT composes VEIL with CIBA (OIDC CIBA Core 1.0), the Agent Auth Protocol (v1.0-draft), and the AAP OAuth Profile (draft-aap-oauth-profile) into a coherent agent authorization stack organized around five architectural concerns: secure transport, structured intent, the agent control plane, the consent channel, and token semantics.

---

## 1. Motivation

### 1.1 The Compositional Opportunity

AI agents that act on behalf of humans need three properties simultaneously: machine authentication (the caller proves it is a specific runtime, not merely the application that launched it), human consent (the human approves sensitive actions through a channel the agent cannot subvert), and privacy-preserving delegation (the relying party learns who acted without receiving a globally trackable identifier).

The standards ecosystem provides strong foundations for each of these properties individually. The Agent Auth Protocol (agent-auth-protocol.com) establishes agents as first-class principals with Ed25519 keypairs, capability grants, and lifecycle management. The AAP OAuth Profile (draft-aap-oauth-profile) defines JWT claim vocabulary for agent metadata, delegation depth, and oversight declarations. CIBA (OIDC CIBA Core 1.0) provides a backchannel consent mechanism originally designed for IoT and call centers. DPoP (RFC 9449) sender-constrains tokens. RAR (RFC 9396) carries structured authorization payloads. Token Exchange (RFC 8693) rebinds audience and scope.

Each of these specifications is well-designed for its concern. What is missing is the composition layer: the wiring that connects agent identity to human consent to privacy-preserving token issuance. That composition layer is what this profile defines.

PACT inherits the Agent Auth Protocol's host-and-session identity model, the AAP's token claim vocabulary, and CIBA's consent semantics. It adds six capabilities that emerge at the seams between those foundations: pairwise agent identifiers, risk-graduated consent routing, usage-limited capability grants, cryptographic binding chains, ephemeral identity disclosure, and audience-bound authorization artifacts.

### 1.2 Design Principles

Six principles govern the profile's design:

1. **Privacy-consistent.** Agent identifiers follow the same pairwise model as user identifiers. Pairwise by default; global by opt-in.
2. **Cryptographically verified.** Agents prove identity via Ed25519 signatures, not self-declared metadata.
3. **Capability-based.** Named actions with typed constraints replace flat scopes.
4. **Risk-graduated.** Consent strength matches operation sensitivity.
5. **Non-repudiable.** Task attestation creates cryptographic pre-commitment to agent intent.
6. **Composable.** Built from existing RFCs, not a monolithic replacement.

### 1.3 Compositional Stance

PACT composes rather than replaces. It defines how existing standards wire together, without inventing new message formats, discovery mechanisms, or transport protocols.

| Concern | Specifications |
|---------|---------------|
| Secure Transport | OAuth 2.1 (draft-ietf-oauth-v2-1), PKCE (RFC 7636), PAR (RFC 9126), DPoP (RFC 9449) |
| Structured Intent | Rich Authorization Requests (RFC 9396) |
| Agent Control Plane | Agent Auth Protocol (v1.0-draft), OAuth Client Attestation (draft-ietf-oauth-attestation-based-client-auth-08) |
| Consent Channel | CIBA (OIDC CIBA Core 1.0) |
| Token Semantics | Token Exchange (RFC 8693), Token Introspection (RFC 7662), OIDC Core Pairwise Identifiers, AAP OAuth Profile |

The six capabilities this profile adds emerge at the seams between those standards, in the composition layer that connects them:

1. Pairwise agent identifiers (Section 4.3)
2. Risk-graduated consent routing (Section 6.2)
3. Usage-limited capability grants (Section 5.5)
4. Cryptographic binding chains (Section 11)
5. Ephemeral identity disclosure (Section 11.5)
6. Audience-bound authorization artifacts (Section 8)

---

## 2. Conventions and Terminology

### 2.1 Notational Conventions

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in RFC 2119 and RFC 8174.

### 2.2 Versioning

PACT uses `MAJOR.MINOR[-draft]` versioning. Implementations MUST reject configurations or discovery documents with an unrecognized major version. Implementations SHOULD accept documents with a higher minor version than expected and ignore unrecognized fields, preserving forward compatibility.

### 2.3 Definitions

**Agent Session.** An ephemeral runtime identity for one live process. Each session holds its own Ed25519 keypair. The private key exists only in process memory.

**Agent-Assertion.** A short-lived EdDSA JWT (`typ: agent-assertion+jwt`) signed by the session private key, proving possession of the runtime identity at the time of a consent request.

**Approval Strength.** A capability-level declaration of the minimum consent mechanism required: `none` (auto-approve), `session` (active user interaction), or `biometric` (unforgeable user verification).

**Authorization Server (AS).** The server that implements this profile, managing identity registration, capability grants, consent routing, and token issuance.

**Binding Chain.** The sequence of cryptographic proofs connecting an OAuth user token through host registration, session registration, runtime assertion, human consent, and delegated token issuance.

**Capability.** A server-defined named action with optional JSON Schema for input and output, and a required approval strength. PACT's unit of authorization.

**Capability Grant.** An authorization record linking one agent session to one capability, with optional typed constraints, usage limits, and an expiration time.

**Client.** The process that holds the host identity, manages keys, signs JWTs, and presents tools to the agent runtime. In MCP deployments, the MCP server.

**Constraint.** A typed restriction on a grant's input parameters. Operators: `eq`, `min`, `max`, `in`, `not_in`.

**Durable Host.** The persistent installation identity for a client environment. Survives across process restarts. Holds an Ed25519 keypair persisted to disk.

**Host Policy.** A durable capability grant attached to a host rather than a session. Survives session expiry and seeds new sessions.

**Pairwise Agent Identifier.** A per-relying-party pseudonym derived from the session ID and the RP's sector identifier, preventing cross-RP agent correlation.

**Relying Party (RP).** A service that receives and validates delegated agent tokens.

**Session Grant.** An ephemeral capability grant attached to one agent session. Seeded from host policies at registration; may be elevated via consent.

**Usage Ledger.** An append-only record of capability executions, used to enforce daily limits and cooldowns atomically.

With the problem space and vocabulary in place, the question becomes structural: how do thirteen constituent standards compose into a coherent authorization model?

---

## 3. Compositional Architecture

### 3.1 Five Compositional Concerns

PACT's thirteen constituent standards cluster into five architectural concerns. Each concern maps to a set of existing standards and produces outputs consumed by the next concern in the chain. The shared pattern is *staged production*: each concern adds one layer of meaning to the flow, and the next concern consumes that layer as input.

```mermaid
flowchart TD
    ST["**Secure Transport**\nOAuth 2.1, PKCE,\nPAR, DPoP"]
    SI["**Structured Intent**\nRich Authorization\nRequests (RFC 9396)"]
    ACP["**Agent Control Plane**\nHost/Session identity,\nCapability grants,\nAgent-Assertion"]

    SI -->|"what to approve"| CC
    ACP -->|"who is asking"| CC
    ST -->|"protects channel"| CC

    CC["**Consent Channel**\nCIBA (OIDC CIBA Core)\nRisk-graduated routing"]

    CC -->|"approved token"| TS

    TS["**Token Semantics**\nToken Exchange (RFC 8693)\nIntrospection (RFC 7662)\nPairwise identifiers\nAAP claim profile"]
```

**Secure Transport** sits beneath the other four concerns because removing any transport spec changes security properties, not the agent model. DPoP is the one transport spec that crosses into agent territory: when token exchange repackages a CIBA token into a purchase artifact, DPoP re-binds the artifact to the agent's proof-of-possession key.

**Structured Intent** carries typed payloads through the entire flow without transformation. RAR (`authorization_details`) survives from CIBA request through consent evaluation into the issued token and forward through token exchange.

**Agent Control Plane** establishes who is asking. It produces two outputs: the `Agent-Assertion` JWT that enters the consent channel as runtime proof, and the capability grants that determine whether consent can short-circuit into automatic approval.

**Consent Channel** is where the control plane and structured intent converge. CIBA binds the runtime proof to a specific consent request, making the `auth_req_id` the trace identifier that correlates agent identity, consent, and token issuance across the entire flow.

**Token Semantics** encodes the authorized delegation that the four preceding concerns produce. Token exchange rebinds audience and recomputes pairwise identifiers. Introspection re-evaluates session lifecycle at query time. The AAP claim vocabulary structures the delegation metadata.

### 3.2 Runtime Participants

| Role | Function |
|------|----------|
| **Agent** | The AI actor scoped to a conversation, task, or session. Does not hold keys directly. |
| **Client** | Process holding the host identity; manages keys, signs JWTs, presents tools. |
| **Authorization Server** | Manages registrations, capability grants, consent routing, and token issuance. |
| **Relying Party** | Receives delegated tokens; validates agent identity via introspection or JWT verification. |
| **User** | The human principal who approves sensitive actions via CIBA. |

### 3.3 Three Caller Classes

PACT distinguishes three caller classes. They cluster by the relationship between the caller and the user: the browser *is* the user, the delegated machine *represents* the user, and the pure machine client *operates independently* of any user.

| Caller | Authentication | Scope |
|--------|---------------|-------|
| Browser user | Session cookie | Dashboard and browser-only surfaces |
| User-delegated machine | OAuth access token exchanged into a dedicated DPoP-bound bootstrap token | Agent host/session registration, revocation |
| Pure machine client | `client_credentials` access token | Introspection, resource-server APIs |

The agent protocol is machine-facing even when a human is in the loop. Registration, introspection, and token exchange are OAuth surfaces. The human consent step happens later, through CIBA. For bootstrap, the client never reuses the login token directly; it exchanges that token for a dedicated DPoP-bound bootstrap token with narrow agent scopes before calling the registration endpoints.

Sections 4 through 9 walk through these concerns in execution order: identity (who), capability (what), consent (whether), and tokens (how the result is delivered).

---

## 4. Principal Separation

Every use case in this section is an instance of the same structural problem: two different lifetimes need two different keys, and two different audiences need two different identifiers. The host needs continuity across process restarts. The session needs a fresh, auditable identity for each runtime. The relying party needs an identifier that cannot be correlated across services. These three requirements produce three layers of identity: durable, ephemeral, and pairwise.

### 4.1 Durable Host

A host is the persistent installation identity for a client environment. It represents a specific installation on a specific machine, not a user or an application.

**Bootstrap.** The client first exchanges its pairwise login token via RFC 8693 for a short-lived DPoP-bound bootstrap token carrying `agent:host.register`. `POST {host_registration_endpoint}` authenticates with that bootstrap token, not the login token.

**Request:**

```json
{
  "publicKey": "<Ed25519 JWK as JSON string>",
  "name": "Claude Code on laptop-A"
}
```

**Response:**

```json
{
  "hostId": "ah_...",
  "created": true,
  "attestation_tier": "unverified"
}
```

**Identity properties:**

| Property | Value |
|----------|-------|
| Key type | Ed25519 (RFC 8037) |
| Identity anchor | JWK Thumbprint (RFC 7638, SHA-256) |
| Persistence | Client-side file, server-side record |
| Uniqueness | One thumbprint per `(user, client)` pair. Same user and client MAY have multiple hosts (different machines). |
| Binding | A host key MUST NOT be rebound across users or OAuth clients. |

**Key storage.** The client MUST persist the host keypair in a namespace derived from the server URL, OAuth client ID, and the authenticated account subject (or another stable per-user identifier):

```text
~/.zentity/hosts/<SHA-256(zentityUrl + ":" + clientId + ":" + accountSub)>.json
```

The file MUST be stored with mode `0600`. The directory MUST be created with mode `0700`.

**Attestation.** Host registration MAY include vendor attestation headers per draft-ietf-oauth-attestation-based-client-auth-08:

- `OAuth-Client-Attestation`: a JWT signed by a trusted vendor (e.g., Anthropic), containing a `cnf.jwk` matching the host's public key.
- `OAuth-Client-Attestation-PoP`: a proof-of-possession JWT signed by the host's private key.

The server verifies attestation JWTs against JWKS URLs configured in `TRUSTED_AGENT_ATTESTERS`. Verification uses a hardened JWKS fetcher that rejects unsafe remote key sources (private/loopback IPs, non-HTTPS in production, responses exceeding 1 MB, timeouts beyond 5 seconds).

Attestation results in an elevated trust tier that widens default host policy (Section 5.4).

### 4.2 Ephemeral Session

The host provides continuity; the session provides accountability. An agent session is the runtime identity for one live process. Each session gets its own Ed25519 keypair. The private key MUST exist only in process memory, never persisted to disk.

**Registration.** `POST {registration_endpoint}` with the bootstrap token carrying `agent:session.register` and a host attestation JWT.

The host attestation JWT (`typ: host-attestation+jwt`) proves the client possesses the durable host key:

```json
{
  "typ": "host-attestation+jwt",
  "alg": "EdDSA"
}
.
{
  "iss": "<hostId>",
  "sub": "agent-registration",
  "iat": 1711000000,
  "exp": 1711000060
}
```

This JWT MUST be signed with the host's Ed25519 private key and MUST expire within 60 seconds.

**Request:**

```json
{
  "hostJwt": "<host-attestation+jwt>",
  "agentPublicKey": "<Ed25519 JWK as JSON string>",
  "requestedCapabilities": ["purchase", "read_profile"],
  "display": {
    "name": "Claude Code",
    "model": "claude-sonnet-4-20250514",
    "runtime": "node",
    "version": "1.0.0"
  }
}
```

**Response:**

```json
{
  "sessionId": "as_...",
  "status": "active",
  "grants": [
    { "capability": "check_compliance", "status": "active" },
    { "capability": "request_approval", "status": "active" },
    { "capability": "purchase", "status": "pending" },
    { "capability": "read_profile", "status": "pending" }
  ]
}
```

**Registration sequence:**

```mermaid
sequenceDiagram
    participant C as Client
    participant AS as Authorization Server

    C->>AS: 1. Exchange login token for bootstrap token<br/>Scope: agent:host.register agent:session.register agent:session.revoke
    AS-->>C: 2. DPoP bootstrap token

    C->>AS: 3. POST /host/register<br/>Authorization: DPoP bootstrap token<br/>Body: { publicKey, name }
    Note right of AS: Compute JWK thumbprint<br/>Upsert agent_host
    AS-->>C: { hostId, attestation_tier }

    Note left of C: 4. Generate fresh session keypair<br/>5. Sign host-attestation+jwt

    C->>AS: 6. POST /register<br/>Authorization: DPoP bootstrap token<br/>Body: { hostJwt, agentPublicKey, … }
    Note right of AS: Verify host JWT sig<br/>Seed capabilities<br/>Seed host policies<br/>Create session<br/>Copy host→session grants<br/>Create pending grants
    AS-->>C: { sessionId, status, grants }
```

**Identity hierarchy:**

```mermaid
flowchart TD
    U["User\n(human principal)"]
    U --> H["Host\n(durable installation, Ed25519 keypair on disk)"]
    H --> SA["Agent Session A\n(runtime process 1, Ed25519 in memory)"]
    SA --> GA["Session Grants\n(seeded from host + pending elevations)"]
    H --> SB["Agent Session B\n(runtime process 2, Ed25519 in memory)"]
    SB --> GB["Session Grants"]
    H --> HP["Host Policies\n(durable defaults, survive sessions)"]
```

### 4.3 Cross-Party Unlinkability

The host provides continuity and the session provides accountability, but neither provides privacy. Without a third layer, the same session identifier travels to every relying party, creating a stable correlator across services.

Agent identifiers in delegated tokens MUST be pairwise per relying party by default.

**Derivation:**

```text
act.sub = HMAC-SHA-256(PAIRWISE_SECRET, sector + ":" + sessionId)
```

Where:

- `PAIRWISE_SECRET` is a server-side secret of at least 32 bytes.
- `sector` is the RP's registered sector identifier, following the same mechanism used for user pairwise `sub` in VEIL Section 4.2. Deployments that do not yet support `sector_identifier_uri` MUST still enforce a stable single-host registration rule so the derived sector remains deterministic.
- `sessionId` is the internal agent session identifier.

**Properties:**

- Two RPs receiving tokens from the same agent session see different `act.sub` values.
- The same derivation applies to `agent.id` in the AAP claim profile.
- Deployments that need global agent tracking MUST use an agent-specific client setting distinct from VEIL's user-facing `subject_type`. Reusing `subject_type` would disable pairwise user identifiers at the same time.
- Pairwise derivation uses the session ID (not host ID) because the acting principal is the runtime session, not the installation.

**Where pairwise identifiers appear:**

- `act.sub` in access tokens
- `agent.id` in the AAP claim profile
- `act.sub` in purchase authorization artifacts (re-derived for the target audience)
- The introspection response
- The CIBA request snapshot (server-side)

**The correlation risk.** Agent identity standards currently use globally consistent agent IDs in delegated tokens, which means `act.sub` is sent to every resource server as a stable correlator. Two colluding RPs can link agent activity across services, infer timing patterns, and potentially deanonymize the human behind the agent. Pairwise derivation for `act.sub` extends the privacy model that OIDC Core already provides for user `sub` to the agent principal as well.

### 4.4 Trust Gradation

The three identity layers answer *who* and *where*, but not *how much should be trusted*. Host attestation answers that question by widening default policy rather than creating a separate token class.

| Tier | How reached | Effect on default host policy |
|------|-------------|-------------------------------|
| `unverified` | Default registration | `check_compliance`, `request_approval` |
| `attested` | Valid `OAuth-Client-Attestation` + PoP | Same default capability floor; trust tier is surfaced in UI, tokens, and introspection |

The trust model is practical rather than ceremonial: verification changes how the runtime is presented and audited without silently widening identity-disclosure capabilities. A host's attestation tier is recorded at registration and surfaces in the approval UI (e.g., "Verified by Anthropic" vs. "Unverified agent"), token claims (`agent.runtime.attested: true/false`), and introspection responses.

Identity and trust answer *who* is calling. The orthogonal question is *what* they are allowed to do.

---

## 5. Named-Action Containment

Every element in this section answers one narrow question: "Can this exact session do this exact kind of action without interrupting the user again?" The shared mechanism is capability-based authorization with typed constraints. What varies is the granularity of containment: the registry defines what actions exist, grants determine which sessions hold them, constraints restrict the parameters, and the usage ledger enforces temporal and cumulative limits.

### 5.1 The Registry

Capabilities are server-defined named actions. Each capability declares:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Stable snake_case identifier |
| `description` | string | Yes | Human-readable description |
| `input_schema` | JSON Schema | No | Expected input parameters |
| `output_schema` | JSON Schema | No | Expected output shape |
| `approval_strength` | enum | Yes | `none`, `session`, or `biometric` |

**Discovery.** `GET {capabilities_endpoint}` returns the full registry. No authentication required.

```json
[
  {
    "name": "purchase",
    "description": "Authorize and execute purchases on behalf of the user",
    "input_schema": { "..." },
    "output_schema": { "..." },
    "approval_strength": "biometric"
  },
  {
    "name": "read_profile",
    "description": "Read identity profile and verification status",
    "approval_strength": "session"
  },
  {
    "name": "check_compliance",
    "description": "Check on-chain attestation and compliance status",
    "approval_strength": "none"
  },
  {
    "name": "request_approval",
    "description": "Request explicit user approval via push notification",
    "approval_strength": "session"
  }
]
```

### 5.2 Grants

A grant links one agent session (or host) to one capability with optional constraints, usage limits, and an expiration time.

| Field | Type | Description |
|-------|------|-------------|
| `capability_name` | string | The capability being granted |
| `status` | enum | `pending`, `active`, `denied`, `revoked` |
| `constraints` | object | Typed constraint operators (Section 5.3) |
| `daily_limit_count` | integer | Max executions per 24-hour window |
| `daily_limit_amount` | number | Max cumulative amount per 24-hour window |
| `cooldown_sec` | integer | Minimum seconds between executions |
| `source` | string | `host_policy`, `session_elevation`, or `user_grant` |
| `expires_at` | timestamp | Per-grant TTL, independent of session TTL |

### 5.3 Typed Constraints

Constraints restrict the input values a grant authorizes. They use the input schema field names as keys.

| Operator | Type | Semantics |
|----------|------|-----------|
| `max` | number | Value MUST be `<=` max |
| `min` | number | Value MUST be `>=` min |
| `eq` | any | Value MUST equal the constraint value |
| `in` | array | Value MUST be a member of the array |
| `not_in` | array | Value MUST NOT be a member of the array |

Within one grant, all constraints are AND (all must pass). Across multiple grants for the same capability, the first matching active grant wins (OR).

**Example:**

```json
{
  "capability": "purchase",
  "status": "active",
  "constraints": {
    "amount.value": { "max": 100 },
    "amount.currency": { "in": ["USD", "EUR"] },
    "merchant": { "not_in": ["blocked-merchant"] }
  },
  "daily_limit_count": 10,
  "daily_limit_amount": 500,
  "cooldown_sec": 60
}
```

**Constraint extraction.** For capability evaluation, the server extracts constraint-matchable values from `authorization_details` (RFC 9396). The `type` field maps to a capability name. Nested fields use dot notation (`amount.value`, `amount.currency`).

**Bidirectional negotiation.** The agent proposes constraints at registration, and the server or user can narrow them. The server MUST NOT widen constraints beyond what the agent proposed without a new approval.

**Unknown operators.** If a grant contains an unrecognized constraint operator, the server MUST reject the evaluation with a `constraint_violated` error.

### 5.4 Durable Defaults vs. Ephemeral Elevations

The policy model is split for the same reason identity is split: durable defaults and per-runtime elevations have different lifetimes and different trust properties.

**Host policies** are durable and host-scoped. They survive across sessions, are seeded by defaults or attestation tier, carry constraints and usage limits, and are modified only by the user or server admin.

**Session grants** are ephemeral and session-scoped. They belong to one live session, are copied from host policies at session registration (status: `active`), are created as pending elevations for requested capabilities beyond defaults (status: `pending`), and expire when the session expires or is revoked.

**Seeding sequence** at session registration:

1. Ensure the capability registry is populated.
2. Ensure default host policies exist for the host's trust tier.
3. Copy all active host policies into active session grants (`source: host_policy`).
4. Create pending session grants for requested capabilities not in the defaults (`source: session_elevation`).

### 5.5 Temporal and Cumulative Limits

Containment is not only about what an action looks like; it is also about how often it repeats. The usage ledger is an append-only table recording each approved execution.

**Scope determination.** Usage is scoped to the narrowest applicable boundary:

- If the grant is backed by a host policy: scope to the host policy (shared across sessions).
- If the grant is session-specific: scope to the session grant.
- Fallback: scope to the session.

This allows daily limits on host policies to be shared across sessions for the same installation.

**Enforcement sequence** (within a single database transaction):

1. **Cooldown check.** Query the ledger for any execution within `cooldown_sec` of `now`. If found, reject.
2. **Daily count check.** Count executions in the last 24 hours. If `count >= daily_limit_count`, reject.
3. **Daily amount check.** Sum `amount` in the last 24 hours. If `sum + request.amount > daily_limit_amount`, reject.
4. **Record.** Insert a new ledger entry. Return success.

The transaction ensures atomicity; two concurrent requests cannot both pass a limit that only has room for one.

Capability containment defines what an agent may do. It does not answer when the human must be involved in that decision.

---

## 6. Risk-Proportional Consent

Identity answers *who* is calling. Capability answers *what* they may do. Neither answers the question that matters most at runtime: does the human need to approve this specific action right now? The mechanism is CIBA (Client-Initiated Backchannel Authentication), but the profile's contribution is not CIBA itself; it is the routing logic that determines which CIBA outcome applies.

### 6.1 The Architectural Linchpin

CIBA is the consent channel, not merely an approval transport. It is where the agent control plane and structured intent converge.

The CIBA `auth_req_id` becomes the trace identifier that correlates agent identity (from the control plane), human consent (from the approval interaction), token issuance (from the token endpoint), and the audit trail (from the usage ledger).

The runtime proof is bound to a specific consent request rather than floating as a general authentication mechanism. This binding makes CIBA the architectural linchpin: removing it means inventing a custom push-and-poll mechanism with its own request lifecycle, polling semantics, and token binding.

### 6.2 Three Routing Outcomes

The consent router produces three outcomes based on the capability's `approval_strength` and the agent's session grants. They differ along one axis: how much human involvement is required.

| Outcome | When | Human interruption |
|---------|------|-------------------|
| **Silent approval** | Active grant exists, constraints pass, limits not exceeded, and capability strength is `none` | None |
| **Session approval** | No matching grant, or strength is `session` | Push notification with inline approve/deny |
| **Biometric approval** | Capability strength is `biometric` | Push notification with "Open to approve" link only; WebAuthn `userVerification: required` on the approval page |

**What silent approval can never do.** The evaluator MUST refuse automatic approval in these cases:

- Any request containing identity scopes (scopes that would release PII)
- Any request whose derived capability is missing from the registry
- Any capability whose approval strength is `biometric`
- Any request without an active matching grant
- Any request that exceeds cooldown or daily limits

That refusal is as important as the happy path. Containment works because the "no" cases are crisp.

### 6.3 Runtime Proof

Before requesting consent, the client signs an `Agent-Assertion` JWT with the session's Ed25519 private key:

```json
{
  "typ": "agent-assertion+jwt",
  "alg": "EdDSA"
}
.
{
  "iss": "<sessionId>",
  "jti": "<unique>",
  "iat": 1711000000,
  "exp": 1711000060,
  "host_id": "<hostId>",
  "task_id": "<unique task identifier>",
  "task_hash": "<SHA-256 hex of binding_message>"
}
```

The assertion is placed in the `Agent-Assertion` HTTP header on the CIBA backchannel authorize request.

PACT requires a `binding_message` whenever an `Agent-Assertion` is present. The `task_hash` claim is defined as `SHA-256(binding_message)`, so an assertion without a bound request message cannot be verified and MUST NOT produce agent-bound token semantics.

**Verification sequence:**

1. Decode payload without verification to extract `iss` (= sessionId).
2. Load session from the database.
3. Verify session status is `active`.
4. Import session's stored public key.
5. Verify JWT signature with `algorithms: ["EdDSA"]`.
6. Verify `typ` header is `agent-assertion+jwt`.
7. Compute session lifecycle state (Section 9). Reject if not `active`.
8. Compute `SHA-256(binding_message)` and compare to `task_hash`. MUST match.
9. Verify host ownership: the session's host MUST belong to the same user and OAuth client as the CIBA request.

**Binding to CIBA request.** On successful verification, the server snapshots server-owned metadata onto the CIBA request record:

| Field | Source |
|-------|--------|
| `agent_session_id` | Session record |
| `host_id` | Session's parent host |
| `display_name`, `runtime`, `model`, `version` | Session registration metadata |
| `task_id`, `task_hash` | Agent-Assertion claims |
| `assertion_verified` | `true` |
| `pairwise_act_sub` | Derived for the requesting OAuth client |
| `attestation_provider`, `attestation_tier` | Host attestation metadata |

This snapshot ties the later token to the actual registered runtime, not a free-form claim supplied by the client.

**CIBA request integrity.** Three additional security properties apply to CIBA requests in PACT:

1. **Release handle binding.** The CIBA release handle (used to exchange an approved request for tokens) MUST be cryptographically bound to `(userId, authReqId, clientId)`. A handle obtained from one request MUST NOT redeem a different request.
2. **Atomic status transitions.** The transition from `approved` to `redeemed` MUST use compare-and-swap semantics. Concurrent polling attempts that race the transition MUST fail rather than duplicate-issue tokens.
3. **Entropy.** `auth_req_id` values MUST be generated with cryptographic entropy sufficient to prevent enumeration (e.g., UUID v4).

### 6.4 The Unforgeable Boundary

The three routing outcomes would collapse into two if the agent could approve its own requests. Agents with browser control (e.g., Playwright, MCP browser tools) can navigate to approval URLs and click buttons. The `biometric` approval strength requires WebAuthn `userVerification: required`, a biometric or PIN verification that the agent cannot produce.

For `biometric`-strength capabilities:

- Push notifications show "Open to approve" link only; inline approve/deny actions are disabled because they cannot trigger WebAuthn.
- The approval endpoint returns a WebAuthn challenge that MUST be satisfied before the approval is accepted.
- Password-based session re-authentication is insufficient because the agent may know the password.

The distinction between `session` and `biometric` is not about the UI; it is about whether the approval can be automated. `session` *can* be automated by an agent with browser access. `biometric` *cannot*. That is the structural boundary.

**Identity scope exception.** When a CIBA request includes identity scopes, push notifications MUST NOT include inline approve actions, even for `session`-strength capabilities. Vault unlock (required by VEIL Section 6 for identity claim delivery) cannot be triggered from a service worker or agent browser context, making identity-scoped requests functionally equivalent to `biometric` for inline approval purposes. The user MUST navigate to the approval page in a full browser context.

### 6.5 Capability Derivation

The consent router derives a capability name from the CIBA request's `authorization_details` and `scope`:

| Condition | Derived capability |
|-----------|--------------------|
| Any detail has `type === "purchase"` | `purchase` |
| Any scope is an identity scope | `read_profile` |
| Any scope is a proof scope (for example `proof:age` or `proof:compliance`) | `check_compliance` |
| Only `openid` scope, no typed details | `request_approval` |

The first matching row wins. The precedence is therefore `purchase` details first, then identity scopes, then proof scopes, then `openid`-only requests. This ensures that a mixed request (for example, purchase details plus `identity.*` scopes) is routed to the most sensitive derived capability rather than being left implementation-defined.

Once the human approves, the approval must be encoded into a token that a relying party can consume.

---

## 7. Delegation Evidence

Every claim in the AAP token profile exists to answer one of two questions a relying party needs to resolve: "who authorized this action?" and "what constraints govern it?" The `sub` and `act` claims answer the first; the `capabilities`, `oversight`, and `delegation` claims answer the second. The shared mechanism is JWT claim embedding. What varies is whether the claim identifies a principal, describes a constraint, or traces a chain.

### 7.1 The AAP Claim Set

Access tokens issued after agent-verified CIBA approval carry the AAP (Agent Authorization Profile) claim set:

```json
{
  "iss": "https://as.example.com",
  "sub": "<pairwise user id for RP>",
  "aud": "<RP client_id>",
  "exp": 1711003600,
  "iat": 1711000000,
  "jti": "<unique>",
  "scope": "openid purchase",

  "act": {
    "sub": "<pairwise agent id for RP>"
  },

  "agent": {
    "id": "<pairwise agent id for RP>",
    "type": "mcp-agent",
    "model": {
      "id": "claude-sonnet-4-20250514",
      "version": "1.0.0"
    },
    "runtime": {
      "environment": "node",
      "attested": true
    }
  },

  "task": {
    "id": "task-uuid",
    "purpose": "purchase"
  },

  "capabilities": [
    {
      "action": "purchase",
      "constraints": [
        { "field": "amount.value", "op": "max", "value": 100 }
      ]
    }
  ],

  "oversight": {
    "approval_reference": "<auth_req_id>",
    "requires_human_approval_for": ["identity.*"]
  },

  "audit": {
    "trace_id": "<auth_req_id>",
    "session_id": "<pairwise agent id for RP>"
  },

  "authorization_details": [
    {
      "type": "purchase",
      "merchant": "Acme",
      "item": "Widget",
      "amount": { "value": "29.99", "currency": "USD" }
    }
  ],

  "cnf": {
    "jkt": "<DPoP key thumbprint>"
  }
}
```

**Claim semantics:**

| Claim | Semantics |
|-------|-----------|
| `sub` | Pairwise user identifier for the target RP |
| `act.sub` | Pairwise agent session identifier for the target RP |
| `agent.id` | Same as `act.sub`, pairwise agent identifier |
| `agent.type` | Agent runtime type (e.g., `mcp-agent`) |
| `agent.model` | Model metadata (informational, not security-critical) |
| `agent.runtime.attested` | Whether the host passed vendor attestation |
| `task.id` | Task identifier from the Agent-Assertion |
| `task.purpose` | Category-level intent (not verbatim description) |
| `capabilities` | Approved capabilities with their constraint snapshot |
| `oversight.requires_human_approval_for` | Scopes that MUST route through human approval |
| `audit.trace_id` | CIBA `auth_req_id` for end-to-end correlation |
| `cnf.jkt` | DPoP proof-of-possession key thumbprint |

**Conditional emission.** If `assertion_verified` is `false` on the CIBA request, the AAP claims MUST NOT be emitted. The token reverts to a standard CIBA token without agent semantics. This is the first convergence point: the `assertion_verified` flag set in the control plane determines whether the token semantics layer emits agent claims at all.

### 7.2 Chain Tracking

When tokens are exchanged via RFC 8693 Token Exchange, the `delegation` claim tracks the chain:

```json
{
  "delegation": {
    "depth": 1,
    "max_depth": 3,
    "chain": ["<pairwise-agent-A>", "<pairwise-agent-B>"],
    "parent_jti": "<original-token-jti>"
  }
}
```

**Rules enforced on token exchange:**

- The server MUST maintain delegation lineage in canonical internal actor references (for example, raw session IDs), not only in the audience-projected identifiers emitted in tokens.
- `depth` incremented by 1 on each exchange.
- Current actor appended to the canonical lineage before projection.
- `delegation.chain` in the exchanged token MUST be projected for the current audience from the canonical lineage. Previous audience-specific pairwise values MUST NOT be copied verbatim into a new audience context.
- Implementations advertising `delegation_chains: true` MUST reject the exchange if `depth >= max_depth`.
- Implementations advertising `delegation_chains: true` MUST enforce **mandatory privilege reduction**: at least one of narrower capabilities, tighter constraints, shorter TTL, or lower `max_depth`.
- The first exchange from a CIBA access token to `purchase-authorization+jwt` satisfies privilege reduction by changing token type, narrowing output to approved purchase `authorization_details`, and rebinding audience. The artifact omits the AAP `agent`, `task`, `capabilities`, `oversight`, and `audit` sections. If `delegation_chains` is `false`, it MAY omit `delegation` as well; if `delegation_chains` is `true`, it MUST retain the projected `delegation` lineage needed for depth enforcement and family revocation. The issued artifact lifetime MUST NOT exceed the subject token's remaining lifetime.

**Family revocation.** Revoking a parent token (by `jti`) revokes all descendants reachable via `parent_jti` graph traversal.

---

## 8. Audience-Bound Artifacts

The previous section described how delegation evidence is encoded into tokens. This section addresses the adjacent problem: how that evidence reaches a *different* audience than the one that originally received it. The mechanism is RFC 8693 Token Exchange. PACT's contribution is the `purchase-authorization+jwt` artifact type and the mandatory privilege reduction rule.

### 8.1 Purchase Authorization

Token exchange (RFC 8693) produces audience-bound purchase authorization artifacts when the subject token contains approved purchase details.

**Request:**

```http
POST {token_endpoint}
  DPoP: <proof bound to the caller key>
  grant_type=urn:ietf:params:oauth:grant-type:token-exchange
  subject_token=<CIBA access token>
  subject_token_type=urn:ietf:params:oauth:token-type:access_token
  requested_token_type=urn:zentity:token-type:purchase-authorization
  audience=<target RP client_id>
```

**Issued artifact:**

```json
{
  "typ": "purchase-authorization+jwt",
  "alg": "EdDSA"
}
.
{
  "iss": "https://as.example.com",
  "aud": "<target RP client_id>",
  "sub": "<pairwise user id for target RP>",
  "act": {
    "sub": "<pairwise agent id for target RP>"
  },
  "authorization_details": [
    {
      "type": "purchase",
      "merchant": "Acme",
      "item": "Widget",
      "amount": { "value": "29.99", "currency": "USD" }
    }
  ],
  "cnf": {
    "jkt": "<DPoP key thumbprint>"
  },
  "jti": "<unique>",
  "iat": 1711000000,
  "exp": 1711003600
}
```

**Token response:**

```json
{
  "access_token": "<purchase-authorization+jwt>",
  "issued_token_type": "urn:zentity:token-type:purchase-authorization",
  "token_type": "N_A",
  "expires_in": 3600
}
```

The artifact copies approved purchase details from the subject token, rebinds both `sub` and `act.sub` for the target audience, and carries `cnf.jkt` from the validated DPoP proof on the token exchange request. The artifact omits the AAP `agent`, `task`, `capabilities`, `oversight`, and `audit` sections; that token-type narrowing is the privilege-reduction step for this exchange. Deployments that do not advertise `delegation_chains` may omit `delegation` as well, while deployments that do advertise `delegation_chains` MUST retain the projected `delegation` lineage on the artifact. The target RP validates the JWT signature against the AS's JWKS, verifies a matching DPoP proof against `cnf.jkt`, and enforces the `authorization_details` constraints. It does not need to understand the capability model; it only needs to trust the signature and proof-of-possession binding.

### 8.2 Mandatory Privilege Reduction

Token exchange MUST enforce scope attenuation:

- The exchanged token's scope MUST be a subset of the subject token's scope.
- The exchanged token's `authorization_details` MUST be a subset of the subject token's `authorization_details`.
- The exchanged token's lifetime MUST NOT exceed the subject token's remaining lifetime.

---

## 9. Temporal Boundaries

Trust that never expires is indistinguishable from a permanent grant. Agent sessions are short-lived by design, and the profile enforces that property through independent clocks, terminal states, and no reactivation path.

### 9.1 Two Independent Clocks

Each agent session has two independent lifetime clocks. They share a common purpose (bounding trust duration) but differ in what they measure: one tracks inactivity, the other tracks total elapsed time.

| Clock | Measured from | Default | Purpose |
|-------|--------------|---------|---------|
| Idle TTL | Last activity (`last_seen_at`) | 1800s (30 min) | Inactivity timeout |
| Max lifetime | Session creation (`created_at`) | 86400s (24 hours) | Total session cap |

**Lifecycle computation** (`resolveSessionLifecycle`):

1. If persisted status is `revoked` or `expired`: keep it (terminal).
2. Compute `idle_expires_at = last_seen_at + idle_ttl_sec * 1000`.
3. Compute `max_expires_at = created_at + max_lifetime_sec * 1000`.
4. If `now >= idle_expires_at` OR `now >= max_expires_at`: status is `expired`.
5. Otherwise: status is `active`.

Expiry is not only inferred at read time. It MUST be persisted to the database once observed.

### 9.2 No Reactivation

```mermaid
flowchart TD
    A([active]) --> E([expired])
    A --> R([revoked])
```

There is no reactivation path for sessions. If a session expires, the client creates a new session under the same host. This is simpler and more auditable than hidden reactivation logic, and it ensures that escalated session grants do not survive across activation boundaries.

### 9.3 Renewal Through Use

Session activity (`last_seen_at`) is updated after successful authenticated operations, specifically after successful Agent-Assertion binding during CIBA requests. The idle boundary is renewed by successful use, not by mere existence.

### 9.4 Revocation Cascade

An agent session can be revoked by the user (via dashboard or API), the client (via `POST {revocation_endpoint}` with the bootstrap token carrying `agent:session.revoke`), or the server (policy-based).

Revoking a session also revokes all its session grants (`status = "revoked"`, `revoked_at = now`). Revoking a host revokes all sessions under it, cascading to all session grants.

**Logout coordination.** The authorization server MUST revoke all pending CIBA requests for a user at the time of user logout (per VEIL Section 10.2). A CIBA token MUST NOT be issuable after the user's session has been terminated. Without this, an agent polling after user logout could obtain tokens for a session the user intended to end.

Runtime behavior is only useful if machines can discover and verify it programmatically.

---

## 10. Machine-Readable Surfaces

This section describes the profile's discovery and verification endpoints. They share a common design principle: every aspect of the agent authorization model must be programmatically discoverable. The axis of variation is who consumes each surface: clients discover capabilities and register identities, relying parties introspect tokens and verify lifecycle state, and other agents discover the profile via A2A cards.

### 10.1 Agent Configuration Document

`GET /.well-known/agent-configuration` is the profile discovery endpoint. No authentication required.

```json
{
  "issuer": "https://as.example.com",
  "registration_endpoint": "https://as.example.com/api/auth/agent/register",
  "host_registration_endpoint": "https://as.example.com/api/auth/agent/host/register",
  "capabilities_endpoint": "https://as.example.com/api/auth/agent/capabilities",
  "introspection_endpoint": "https://as.example.com/api/auth/agent/introspect",
  "revocation_endpoint": "https://as.example.com/api/auth/agent/revoke",
  "jwks_uri": "https://as.example.com/api/auth/agent/jwks",
  "supported_algorithms": ["EdDSA"],
  "approval_methods": ["ciba"],
  "approval_page_url_template": "https://as.example.com/approve/{auth_req_id}",
  "issued_token_types": [
    "urn:zentity:token-type:purchase-authorization"
  ],
  "supported_features": {
    "task_attestation": true,
    "pairwise_agents": true,
    "risk_graduated_approval": true,
    "capability_constraints": true,
    "delegation_chains": false
  }
}
```

The document SHOULD be served with `Cache-Control: public, max-age=3600`.

### 10.2 Capability Discovery

`GET {capabilities_endpoint}` returns the full capability registry (Section 5.1).

`GET {capabilities_endpoint}/{name}` returns a single capability with full input/output schemas.

No authentication required for either endpoint.

### 10.3 Introspection with Lifecycle

`POST {introspection_endpoint}` follows the RFC 7662 model for agent token validation.

**Authentication.** Requires a `client_credentials` access token with `agent:introspect` scope.

**Request:** `application/x-www-form-urlencoded` or `application/json` with a `token` field.

**Active response:**

```json
{
  "active": true,
  "client_id": "<RP client_id>",
  "scope": "openid purchase",
  "sub": "<pairwise user id projected for the introspecting client>",
  "aud": "<RP client_id>",

  "agent": { "id": "<pairwise agent id for introspecting client>", "..." },
  "task": { "..." },
  "capabilities": [ "..." ],
  "oversight": { "..." },
  "audit": { "..." },
  "delegation": { "..." },

  "zentity": {
    "attestation": {
      "tier": "attested",
      "provider": "Anthropic"
    },
    "lifecycle": {
      "status": "active",
      "created_at": 1711000000,
      "last_active_at": 1711002000,
      "idle_expires_at": 1711003800,
      "max_expires_at": 1711086400
    }
  }
}
```

**Key behaviors:**

- Session lifecycle is re-evaluated at query time. A session that expired between token issuance and introspection returns `active: false`.
- `sub` and `agent.id` MUST come from a consistent caller-relative pairwise view. If the server cannot safely re-project `sub` for the introspecting client, it MUST omit `sub` rather than leak another client's pairwise identifier.
- `client_id` and `aud` continue to identify the token that was issued, not the introspector's own client registration.
- If `assertion_verified` is `false` on the token snapshot, AAP claims are omitted.

### 10.4 A2A Agent Card

`GET /.well-known/agent-card.json` publishes an A2A Protocol (v0.3) agent card referencing the agent configuration document. This enables agent-to-agent capability discovery. The card declares security schemes including an `agent-auth` scheme whose `discoveryUrl` points to `/.well-known/agent-configuration`.

---

## 11. Cryptographic Continuity

Each phase of the profile produces evidence the next phase can reuse. These bindings are not separate features; they are the chain that lets a relying party infer a real delegation story from otherwise normal OAuth messages. The shared pattern is *evidence propagation*: each step narrows who can continue the flow by requiring proof that only the legitimate caller can produce.

### 11.1 The Full Chain

```mermaid
flowchart TD
    A["OAuth User Token"] --> B
    B["Durable Host Registration\nHost Ed25519 key bound to user + client"] --> C
    C["Agent Session Registration\nFresh Ed25519 key bound to host + runtime"] --> D
    D["Agent-Assertion on CIBA\nRuntime proof bound to specific consent request"] --> E
    E["Human Approval via CIBA\nConsent bound to scope + authorization_details"] --> F
    F["Access Token\nsub + act.sub + AAP claims"] --> G
    G["Token Exchange (optional)\nAudience rebinding + purchase-authorization+jwt"]
```

### 11.2 Session Binding

The client authenticates with a user-bound OAuth access token, typically sender-constrained through DPoP. This binds delegated setup work to the caller's proof-of-possession key.

### 11.3 Host Binding

Host registration binds a durable Ed25519 public key to one user, one OAuth client, and one installation thumbprint. The signed `host-attestation+jwt` used during session registration proves that the caller still possesses the durable host private key.

### 11.4 Runtime Binding

Session registration binds a fresh Ed25519 public key to one host, one runtime process, and one display metadata snapshot. The `Agent-Assertion` proves possession of that runtime key on each CIBA request.

### 11.5 Consent Binding

CIBA binds human approval to one `auth_req_id`, one binding message, one scope set, and one optional `authorization_details` payload.

If the runtime proof is present and valid, the server snapshots runtime metadata into the CIBA request before the approval result is finalized.

### 11.6 Disclosure Binding

Identity release is kept off the token path. If identity scopes are approved, PII is staged in an ephemeral in-memory store with single-consume semantics:

- 5-minute TTL for OAuth2 flows
- 10-minute TTL for CIBA flows

PII is delivered exclusively via the userinfo endpoint, never embedded in `id_token` claims. This keeps long-lived JWTs free of identity payloads while preserving the consent record that authorized disclosure.

### 11.7 Delegation Binding

The delegated access token carries `sub` for the human principal, `act.sub` for the acting agent session, and the full AAP claim set. The purchase authorization artifact carries pairwise `sub`, pairwise `act.sub`, `cnf.jkt`, and the approved `authorization_details`, all re-derived or rebound for the target audience.

---

## 12. Security Boundaries

### 12.1 JTI Replay Protection

All Agent-Assertion JWTs require a `jti` claim. The server MUST reject duplicates for the same session and retain seen values until the assertion's `exp` plus a clock-skew allowance (SHOULD default to 30 seconds). Cache entries are partitioned by session ID.

### 12.2 Algorithm Confusion Prevention

JWT verification MUST derive the algorithm from the public key's curve (`Ed25519 → EdDSA`, `P-256 → ES256`), never from the JWT `alg` header.

### 12.3 JWKS Fetch Hardening

Remote JWKS URL fetches (for attestation verification) MUST block private and loopback IP addresses, enforce HTTPS in production, limit redirects (max 3), cap response size (1 MB), enforce timeout (5 seconds), and cache responses (recommended 1 hour).

### 12.4 Host Key Security

Host private keys MUST be stored with filesystem permissions restricting access to the owning user only (mode `0600`). The directory MUST be mode `0700`.

### 12.5 Session Key Ephemerality

Session private keys MUST exist only in process memory. They MUST NOT be written to disk, environment variables, or any persistent store.

### 12.6 Task Description Sensitivity

Task descriptions may contain user-specific context. They appear as `task.purpose` in tokens (category-level, not verbatim). The verbatim description is available only via introspection by authorized machine clients, not in the JWT body.

### 12.7 DPoP Binding

Delegated access tokens issued by this profile SHOULD be DPoP-bound (RFC 9449). When token exchange repackages a CIBA token into a purchase artifact, the artifact MUST carry `cnf.jkt` from the validated DPoP proof and the target RP MUST require a matching DPoP proof at presentation time. A leaked artifact is useless without the agent's proof-of-possession key.

---

## 13. Unlinkability by Default

Security boundaries defend against attacks; this section concerns what the profile *refuses to create*. Every consideration here is an instance of the same principle: the profile's default posture is unlinkability, and any deviation from that posture requires explicit opt-in.

### 13.1 Cross-RP Agent Correlation

Without pairwise agent identifiers, `act.sub` in delegated tokens is a stable correlator across all RPs. Two colluding RPs can link agent activity across services, correlate the frequency and timing of operations, and infer usage patterns that may deanonymize the human.

PACT mitigates this by deriving `act.sub` per-RP using the same sector-identifier mechanism as OIDC Core pairwise subjects.

### 13.2 PII in Tokens

Identity PII MUST NOT be embedded in access tokens or purchase authorization artifacts. PII delivery uses the ephemeral in-memory store with single-consume semantics (Section 11.6). This ensures that long-lived tokens contain only cryptographic identifiers, not personal data.

### 13.3 Metadata Minimization

Agent display metadata (`model`, `runtime`, `version`) is informational and self-declared. It SHOULD NOT be relied upon for security decisions. Trust decisions MUST be based on cryptographic verification (key signatures, attestation) rather than declared metadata.

### 13.4 Pairwise Opt-Out

RPs that require stable agent identifiers (e.g., for regulatory audit trails) need an agent-specific opt-in that is distinct from VEIL's user-facing `subject_type`. This is an explicit choice; the profile default is privacy-preserving.

---

## 14. Conformance

### 14.1 Server Requirements

A conforming authorization server MUST:

- Implement the identity model (Sections 4.1, 4.2)
- Compute pairwise agent identifiers by default (Section 4.3)
- Implement the capability registry and grant model (Section 5)
- Route consent based on approval strength (Section 6.2)
- Verify Agent-Assertions and bind them to CIBA requests (Section 6.3)
- Issue AAP-profiled tokens only when assertions are verified (Section 7.1)
- Publish the agent configuration document (Section 10.1)
- Enforce JTI replay protection (Section 12.1)
- Derive JWT algorithms from public keys, not headers (Section 12.2)

A conforming authorization server SHOULD:

- Support vendor attestation (Section 4.4)
- Enforce usage limits atomically (Section 5.5)
- Support token exchange with delegation chains (Section 7.2)
- Support purchase authorization artifacts (Section 8.1)
- Provide introspection with lifecycle evaluation (Section 10.3)
- Bind tokens with DPoP (Section 12.7)

### 14.2 Client Requirements

A conforming client MUST:

- Generate and persist Ed25519 host keys (Section 4.1)
- Generate ephemeral Ed25519 session keys in memory only (Section 4.2)
- Sign host-attestation+jwt for session registration (Section 4.2)
- Sign Agent-Assertion JWTs before CIBA requests (Section 6.3)
- Include `jti` in all signed JWTs

A conforming client SHOULD:

- Present vendor attestation headers when available (Section 4.1)
- Request only the capabilities it needs (Section 5.2)
- Propose constraints that reflect its actual intended usage (Section 5.3)

---

## 15. Standards Composition

| Surface | Concern | Specification | Role in this profile |
|---------|---------|---------------|----------------------|
| Authorization, PKCE | Transport | draft-ietf-oauth-v2-1, RFC 7636 | Base OAuth machinery |
| Pushed Authorization Requests | Transport | RFC 9126 | Back-channel parameter delivery |
| DPoP sender constraining | Transport | RFC 9449 | Binds tokens to holder keys |
| Rich authorization details | Intent | RFC 9396 | Typed approval payloads through full flow |
| Backchannel authentication | Consent | OIDC CIBA Core 1.0 | Human consent channel for agent actions |
| Discovery, registration, lifecycle | Control plane | Agent Auth Protocol v1.0-draft | Host/session identity, capability grants |
| Host and session JWTs | Control plane | PACT | Signed proofs for registration and runtime binding |
| Vendor attestation | Control plane | draft-ietf-oauth-attestation-based-client-auth-08 | Host attestation against trusted JWKS |
| A2A agent card | Control plane | A2A Protocol v0.3 | Inter-agent capability discovery |
| Token exchange | Token semantics | RFC 8693 | Audience rebinding, purchase artifact issuance |
| Token introspection | Token semantics | RFC 7662 | Runtime lifecycle validation for downstream RPs |
| Pairwise subject identifiers | Token semantics | OIDC Core 1.0 | Privacy for both `sub` and `act.sub` |
| Agent authorization claims | Token semantics | AAP draft (draft-aap-oauth-profile) | JWT claim vocabulary |
| Agent-Assertion on CIBA | PACT | | Runtime proof binding to consent request |
| Host policy / session grant split | PACT | | Durable defaults + ephemeral elevations |
| Pairwise agent identifiers | PACT | | Cross-RP agent unlinkability |
| Risk-graduated consent routing | PACT | | Approval strength matched to operation risk |
| Usage-limited capability grants | PACT | | Temporal and cumulative containment |
| Ephemeral identity disclosure | PACT | | PII off the token path |
| Purchase authorization artifacts | PACT | | Audience-bound typed JWTs via token exchange |

---

## 16. References

### Normative References

- [VEIL v0.1-draft](/docs/veil-v0.1-draft) Verified Ephemeral Identity Layer, Privacy-Preserving Identity Security Profile for OAuth 2.1
- [draft-ietf-oauth-v2-1](https://datatracker.ietf.org/doc/draft-ietf-oauth-v2-1/) The OAuth 2.1 Authorization Framework
- [RFC 7636](https://datatracker.ietf.org/doc/html/rfc7636) Proof Key for Code Exchange (PKCE)
- [RFC 7638](https://datatracker.ietf.org/doc/html/rfc7638) JSON Web Key (JWK) Thumbprint
- [RFC 7662](https://datatracker.ietf.org/doc/html/rfc7662) OAuth 2.0 Token Introspection
- [RFC 8037](https://datatracker.ietf.org/doc/html/rfc8037) CFRG Elliptic Curve Diffie-Hellman (ECDH) and Signatures in JOSE (Ed25519)
- [RFC 8693](https://datatracker.ietf.org/doc/html/rfc8693) OAuth 2.0 Token Exchange
- [RFC 9126](https://datatracker.ietf.org/doc/html/rfc9126) OAuth 2.0 Pushed Authorization Requests (PAR)
- [RFC 9396](https://datatracker.ietf.org/doc/html/rfc9396) OAuth 2.0 Rich Authorization Requests (RAR)
- [RFC 9449](https://datatracker.ietf.org/doc/html/rfc9449) OAuth 2.0 Demonstrating Proof of Possession (DPoP)
- [OIDC Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html) OpenID Connect Core 1.0, Section 8.1 (Pairwise Subject Identifiers)
- [OIDC CIBA Core 1.0](https://openid.net/specs/openid-connect-client-initiated-backchannel-authentication-core-1_0.html) OpenID Connect Client-Initiated Backchannel Authentication Core 1.0

### Informative References

- [Agent Auth Protocol v1.0-draft](https://agent-auth-protocol.com/specification/v1.0-draft) Agent Auth Protocol Specification
- [AAP](https://datatracker.ietf.org/doc/draft-aap-oauth-profile/) Agent Authorization Profile for OAuth
- [draft-ietf-oauth-attestation-based-client-auth](https://datatracker.ietf.org/doc/draft-ietf-oauth-attestation-based-client-auth/) Attestation-Based Client Authentication
- [A2A Protocol](https://a2a-protocol.org) Agent-to-Agent Protocol
- [draft-oauth-ai-agents-on-behalf-of-user](https://datatracker.ietf.org/doc/draft-oauth-ai-agents-on-behalf-of-user/) AI Agents Acting on Behalf of Users
