# RFC-0033: Agentic Authentication & Authorization Integration

**Status:** Phase 1 Complete
**Date:** 2026-03-06
**Author:** Research synthesis

---

## 1. Executive Summary

This document analyzes how Zentity's existing OAuth 2.1-style / OIDC authorization architecture maps to the emerging agent authentication and authorization landscape (March 2026), and identifies concrete integration points for two critical scenarios:

1. **Agent needs PII** — An AI agent requires sensitive personal information to complete an action on behalf of a user.
2. **Agent needs human authorization** — An AI agent must perform a restricted action that requires explicit human approval before execution.

Zentity already implements many of the building blocks cited by NIST, OpenID Foundation, and IETF drafts as foundational for agent auth: OAuth 2.1 security-direction features, DPoP, PAR, partial RAR (`authorization_details`) plumbing, HAIP compliance, OID4VP, pairwise subject identifiers, multi-algorithm JWT signing, and credential-sealed PII vaults. The primary gaps are CIBA (async backchannel authorization), durable approval and release state, token exchange for delegated execution, MCP protected-resource compatibility, A2A discovery surfaces, and eventually delegation-chain propagation.

---

## 2. Standards Landscape (March 2026)

### 2.1 Governing Bodies

| Body | Initiative | Status |
|------|-----------|--------|
| NIST CAISI | AI Agent Standards Initiative (Feb 2026) | RFI + listening sessions (Apr 2026). Four-level trust model (L0–L3). |
| OpenID Foundation | AI Identity Management Community Group | Whitepaper published (Oct 2025). AuthZEN 1.0 ratified (Jan 2026). |
| IETF OAuth WG | 5+ individual drafts on agent auth | Pre-consensus. No WG adoption yet. |
| IETF WIMSE WG | Workload Identity in Multi-System Environments | Active WG. Architecture + S2S protocol drafts. |
| Linux Foundation | A2A Protocol (Google) | v0.3 (Jul 2025), RC v1.0 in progress. 150+ orgs. |
| Anthropic | MCP Authorization | Nov 2025 revision (CIMD, Enterprise-Managed Authorization, RFC 8707). |

### 2.2 Protocol Stack

The emerging consensus architecture layers these protocols:

```text
Human User (approves via CIBA / consent / step-up)
    |
    | OAuth 2.1 + RAR + DPoP + PAR
    v
Authorization Server (issues scoped tokens with actor/principal claims)
    |
    |--- Token Exchange (RFC 8693) at trust boundaries
    |--- Transaction Tokens (actor/principal context propagation)
    |
    v
Agent Layer
    |--- A2A (agent-to-agent communication, Agent Cards, task lifecycle)
    |--- MCP (agent-to-tool connection, Resource Server model)
    |
    v
Resource Servers / APIs (validate Txn-Tokens + DPoP + audience binding)
```

### 2.3 IETF Drafts Summary

| Draft | Mechanism | Relevance to Zentity |
|-------|-----------|---------------------|
| `draft-oauth-ai-agents-on-behalf-of-user-02` | `requested_actor` + `actor_token` params. `act` claim in JWT. | **High.** Extends our existing OAuth AS with agent identity in delegated flows. |
| `draft-oauth-transaction-tokens-for-agents-04` | `actor` + `principal` context in Transaction Tokens. | **Medium.** Useful later for internal call-chain propagation, but still draft-stage. |
| `draft-rosenberg-oauth-aauth-00` | `agent_authorization` grant for non-web channels (voice/SMS). PII-based auth. | **Medium.** Relevant if agents interact via non-web channels. |
| `draft-song-oauth-ai-agent-authorization-00` | `target_id` / `tar` claim for sub-client module auth. | **Low.** More relevant for multi-model platforms. |
| `draft-yao-agent-auth-considerations-01` | Three operational modes: OBO-User, OBO-Itself, OBO-Other-Agents. AID concept. | **Informational.** Architectural framing. |

---

## 3. Zentity's Current Architecture (What We Already Have)

### 3.1 OAuth 2.1-Style Authorization Server

Zentity operates as an OAuth 2.1-style / OIDC authorization server via better-auth's `oauthProvider` plugin (`apps/web/src/lib/auth/auth.ts`). Key capabilities:

| Capability | Implementation | File |
|-----------|---------------|------|
| Grant types | `authorization_code`, `client_credentials`, `refresh_token`, `pre-authorized_code` | `auth.ts:854` |
| PKCE | Supported (S256) | better-auth core |
| DPoP | `createDpopTokenBinding()` with nonce rotation | `auth.ts:321-356`, `dpop-nonce-store.ts` |
| PAR | `createParResolver()`, `requirePar: true` | `auth.ts:972-978` |
| RAR | Discovery metadata plus vendored `authorization_details` plumbing | `well-known-utils.ts`, `vendor/@better-auth__oauth-provider@1.5.1-beta.3.patch` |
| DCR | Enabled, unauthenticated (for wallets) | `auth.ts:862-865` |
| Pairwise subjects | `PAIRWISE_SECRET` env, enforced in hooks | `auth.ts:597-601` |
| Multi-alg JWT | RS256, ES256, EdDSA, ML-DSA-65 | `jwt-signer.ts` |
| JWKS | `/api/auth/oauth2/jwks` (all keys from DB) | `oauth2/jwks/route.ts` |

### 3.2 Consent and PII Delivery

The consent flow is the most architecturally relevant piece for agent integration:

```text
User visits consent page
    |
    v
Scope selection (proof:* = no vault needed, identity.* = vault required)
    |
    v
Vault unlock (passkey PRF / OPAQUE password / wallet EIP-712)
    |
    v
POST /api/oauth2/identity/intent (120s signed intent token)
    |
    v
POST /api/oauth2/identity/stage (PII pushed to ephemeral in-memory store, 5min TTL)
    |
    v
POST /api/auth/oauth2/consent (identity scopes stripped before persistence)
    |
    v
Token exchange: customIdTokenClaims consumes ephemeral entry -> PII in id_token
```

Key properties:

- PII is **never persisted** in the consent/token DB — only in a 5-minute ephemeral `Map`
- Vault unlock requires the user's credential (passkey authenticator, password, or wallet signature)
- Intent tokens have JTI replay prevention via `used_intent_jtis` DB table
- Identity scopes are stripped from consent records at both client and server sides

### 3.3 HAIP Compliance

| HAIP Feature | Status | Notes |
|-------------|--------|-------|
| DPoP | Implemented (permissive mode) | `requireDpop: false` — can flip to `true` when clients support it |
| PAR | Implemented + required | `requirePar: true` |
| Wallet attestation | Implemented | `TRUSTED_WALLET_ISSUERS` env for issuer allowlist |
| DCQL | Implemented | `createTrustedDcqlMatcher()` with AKI filtering |
| JARM | Implemented | ECDH-ES P-256 key, lazy-created + DB-persisted |
| x5c chain | Implemented | Loaded from env or `.data/certs/` |

### 3.4 OID4VP / OID4VCI

| Feature | Role | Implementation |
|---------|------|---------------|
| OID4VCI | Issuer | SD-JWT VC issuance via `oidc4vci()` plugin. DPoP enforced on credential endpoint. |
| OID4VP | Verifier | VeriPass in `apps/demo-rp` — DCQL queries, JAR with x5c, JARM `direct_post.jwt`, KB-JWT binding |
| Credential format | `dc+sd-jwt` | ML-DSA-65 signing for issuer, `cnf.jkt` holder binding |

### 3.5 Credential-Sealed Vault

The vault is the core primitive for PII protection:

- **Envelope encryption**: `encrypted_secrets` (one per type per user) + `secret_wrappers` (one per credential)
- **KEK sources**: passkey PRF output, OPAQUE export key, wallet EIP-712 deterministic signature, FROST ML-KEM recovery
- **Server-zero-knowledge**: The server stores the wrapped DEK but cannot derive the KEK

---

## 4. Scenario Analysis

### 4.1 Scenario 1: Agent Needs PII to Perform an Action

**Example:** An AI travel agent needs the user's full name, date of birth, and nationality to book a flight on their behalf.

#### Current State

Today, PII is delivered exclusively through the OAuth consent flow:

1. A relying party redirects the user to Zentity's consent page
2. The user sees which `identity.*` scopes are requested
3. The user unlocks their vault (passkey/password/wallet)
4. PII flows ephemerally into the id_token
5. The RP receives the id_token with PII claims

This flow is **human-interactive** — it requires the user to be present, unlock their vault, and approve consent. An AI agent cannot perform steps 2–3 on its own.

#### Integration Options

**Option A: CIBA + Vault Unlock Push Notification (Recommended)**

The agent initiates a CIBA backchannel auth request. The user receives a push notification on their authentication device (phone), reviews what PII the agent needs and why, unlocks their vault via passkey on the phone, and approves. The agent polls and receives a scoped access token / id_token with PII claims.

```text
Agent backend                    Zentity AS                     User's phone
    |                                |                               |
    |-- POST /bc-authorize --------->|                               |
    |   login_hint: user@email.com   |                               |
    |   scope: openid identity.name  |                               |
    |          identity.dob          |                               |
    |   binding_message: "Book       |                               |
    |     flight LAX->JFK Mar 15"    |                               |
    |                                |-- push notification --------->|
    |<-- 200 {auth_req_id, exp} -----|                               |
    |                                |   "Travel Agent wants:        |
    |                                |    - Full name                 |
    |                                |    - Date of birth             |
    |                                |    For: Book flight LAX->JFK"  |
    |                                |                               |
    |                                |          [User taps Approve]  |
    |                                |          [Passkey biometric]   |
    |                                |<-- vault unlock + consent ----|
    |                                |                               |
    |-- POST /token --------------->|                               |
    |   grant_type=ciba              |                               |
    |   auth_req_id=...              |                               |
    |                                |                               |
    |<-- 200 {delegated_token,      |                               |
    |         release_handle} ------|                               |
```

**What Zentity needs to implement:**

1. **CIBA backchannel authentication endpoint** (`/api/auth/oauth2/bc-authorize`)
2. **CIBA grant type handler** in the token endpoint (`urn:openid:params:grant-type:ciba`)
3. **Push notification infrastructure** — could leverage Web Push API to the user's registered browser, or integrate with a mobile authenticator SDK
4. **Remote vault unlock** — the critical piece: the user must be able to unlock their credential vault on their authentication device. This maps naturally to passkey PRF (the authenticator is on the phone) or OPAQUE (password prompt on push notification UI)
5. **Durable approval / release tables** in the DB (auth_req_id or approval_id, requested fields, recipient, purpose, status, expiry, replay state)
6. **Discovery metadata** extension for CIBA fields
7. **RAR support in CIBA** — allow `authorization_details` in backchannel requests for structured permission descriptions
8. **One-time release handles or target-encrypted release payloads** instead of relying on standing PII-bearing tokens

**Architectural fit:**

- The current ephemeral PII staging mechanism (`identity-intent.ts` + `ephemeral-identity-claims.ts`) is the right conceptual primitive, but not the final implementation. For async agent approval it must become durable, approval-bound release state rather than an in-memory `Map`.
- The multi-credential vault unlock is already built for passkey/OPAQUE/wallet
- DPoP can be composed with CIBA tokens (sender-constrained CIBA tokens)
- PAR is not needed for CIBA (backchannel requests are already server-to-server)

**Option B: Pre-authorized Credential + Agent Token Exchange**

The user pre-authorizes the agent with an OID4VCI credential (SD-JWT VC) containing selected PII claims, holder-bound to the agent's key. The agent presents this VC via OID4VP when needed, without contacting the user again.

```sql
1. User opens Zentity dashboard, selects "Authorize Agent"
2. User unlocks vault, selects which claims to include
3. Zentity issues SD-JWT VC with holder binding to agent's public key
4. Agent stores the VC
5. When agent needs PII, it presents the VC via OID4VP (selective disclosure)
6. The receiving service verifies the VC signature + holder binding
```

**Pros:** No real-time user interaction needed. Agent has standing credential.
**Cons:** Standing credentials are a security risk. Revocation is complex. Doesn't support the "ask permission each time" model.

**Option C: Agent as OAuth Client with RAR**

The agent is registered as an OAuth client. It uses the standard authorization code flow with RAR to request fine-grained PII access. The user approves once (or per-session), and the agent receives tokens with PII.

This is essentially what we do today, but with the agent as the client instead of a web RP. Works for web-capable agents but fails for headless/voice/messaging agents.

#### Recommendation

**CIBA (Option A) is the primary path.** It solves both web and headless agent scenarios, provides per-action consent, and integrates cleanly with our existing vault unlock primitives. However, the release artifact should ideally be a one-time release handle or target-encrypted payload, not standing agent access to raw `identity.*` claims. Option B (pre-authorized VCs) is a complementary mechanism for lower-sensitivity, pre-approved agent actions.

---

### 4.2 Scenario 2: Agent Needs Human Authorization for a Restricted Action

**Example:** An AI financial agent wants to transfer $5,000 from the user's account. The transfer API requires human approval — the agent cannot execute it autonomously.

#### Current State

Zentity does not currently have a mechanism for an agent to request step-up authorization mid-task. The consent flow is only triggered during OAuth authorization, not during resource access.

#### Integration Options

**Option A: CIBA Step-Up Authorization (Recommended)**

Same CIBA mechanism as Scenario 1, but the agent already has a base access token. When it encounters a restricted action, it initiates a CIBA request for elevated permissions.

```text
Agent (has base token)           Resource Server              Zentity AS            User's phone
    |                                |                            |                      |
    |-- POST /transfer (base tok) -->|                            |                      |
    |                                |                            |                      |
    |<-- 403 Forbidden --------------|                            |                      |
    |   scope="transfer:execute"     |                            |                      |
    |   error="insufficient_scope"   |                            |                      |
    |                                                             |                      |
    |-- POST /bc-authorize ---------------------------------->    |                      |
    |   scope: transfer:execute                                   |                      |
    |   binding_message: "Transfer $5,000 to Bob"                 |                      |
    |   authorization_details: [{                                 |-- push ------------>|
    |     type: "payment",                                        |                      |
    |     amount: {currency:"USD", value:"5000"},                 |  "Approve transfer?" |
    |     destination: "Bob's account"                            |  "$5,000 to Bob"     |
    |   }]                                                        |                      |
    |                                                             |  [User approves +    |
    |<-- 200 {auth_req_id} ------------------------------------   |   passkey biometric] |
    |                                                             |<------ approval -----|
    |-- POST /token (poll) ------------------------------------->|                      |
    |<-- 200 {elevated_access_token} ----------------------------|                      |
    |                                                                                    |
    |-- POST /transfer (elevated tok) ->|                                                |
    |<-- 200 OK -------------------------|                                                |
```

**What this adds beyond Scenario 1:**

- **RAR is critical here** — `authorization_details` carries structured descriptions of the restricted action (amount, destination, type) so the user sees exactly what they're approving
- **Token audience binding** — the elevated token is scoped to the specific resource server
- **Short-lived tokens** — elevated tokens should have very short expiry (minutes, not hours)
- **Idempotency** — the `auth_req_id` or a nonce should be bound to the specific action to prevent replay

**Option B: AuthZEN PDP Integration**

Rather than (or in addition to) CIBA, Zentity acts as an AuthZEN PDP. The resource server (PEP) calls Zentity's AuthZEN evaluation endpoint before allowing the action.

```json
POST /access/v1/evaluation

{
  "subject": {
    "type": "agent",
    "id": "agent-finance-v1",
    "properties": {
      "acting_for": "user-456",
      "agent_provider": "acme-ai",
      "trust_level": 2
    }
  },
  "action": { "name": "transfer" },
  "resource": {
    "type": "bank_account",
    "id": "acct-789",
    "properties": { "owner": "user-456" }
  },
  "context": {
    "amount": 5000,
    "currency": "USD",
    "destination": "Bob"
  }
}
```

Response:

```json
{
  "decision": false,
  "context": {
    "reason_user": "Transfer exceeds agent's $1,000 auto-approve limit",
    "required_action": "ciba_step_up",
    "ciba_scope": "transfer:execute",
    "ciba_authorization_details": [{ "type": "payment", ... }]
  }
}
```

The PDP (Zentity) evaluates policy (amount > $1,000 requires human approval), returns a deny with instructions to initiate CIBA step-up. The PEP (resource server) orchestrates the CIBA flow.

**Option C: MCP Gateway with AuthZEN**

If the agent accesses tools via MCP, an MCP gateway (acting as PEP) intercepts tool calls and queries Zentity's AuthZEN PDP. High-risk actions trigger a CIBA flow before the tool is invoked.

```text
Agent -> MCP Client -> MCP Gateway (PEP) -> AuthZEN PDP (Zentity)
                           |                        |
                           |<-- deny + ciba hint ---|
                           |
                           |-- CIBA bc-authorize -->| Zentity AS
                           |                        |-- push --> User
                           |                        |<-- approval
                           |<-- elevated token -----|
                           |
                           |-> MCP Server (tool) with elevated token
```

#### Recommendation

**CIBA is the primary implementation path for the first shipping slice. AuthZEN is the strategic policy layer for the broader target architecture.** The first version can ship with policy embedded in Zentity, but as soon as authorization decisions must be shared across resource servers, MCP gateways, and agent-facing surfaces, AuthZEN becomes the clean standard interface for PDP/PEP decisions. The right long-term combination is CIBA + AuthZEN.

---

## 5. Integration Roadmap

### Phase 1: Approval Core + CIBA (Enables Both Scenarios)

**New components:**

| Component | Location | Purpose |
|-----------|----------|---------|
| Approval / release tables | `src/lib/db/schema/ciba.ts` | Durable state for approvals, decisions, and sensitive release handles |
| CIBA backchannel endpoint | `/api/auth/oauth2/bc-authorize` | Accept backchannel auth requests |
| CIBA grant handler | Token endpoint extension | Handle `grant_type=urn:openid:params:grant-type:ciba` |
| `ciba_requests` table | `src/lib/db/schema/ciba.ts` | Track auth_req_id lifecycle |
| Push notification service | `src/lib/auth/ciba/notify.ts` | Web Push / mobile SDK integration |
| Remote vault unlock | Passkey PRF on phone / OPAQUE prompt | Enable vault unlock from push notification |
| Discovery metadata | `well-known-utils.ts` | `backchannel_*` fields |
| Client registration | OAuth client schema | `backchannel_token_delivery_mode` field |

**Schema:**

```sql
CREATE TABLE ciba_requests (
  auth_req_id    TEXT PRIMARY KEY,
  client_id      TEXT NOT NULL REFERENCES oauth_clients(id),
  user_id        TEXT NOT NULL REFERENCES users(id),
  scope          TEXT NOT NULL,
  binding_message TEXT,
  authorization_details TEXT, -- JSON, for RAR
  status         TEXT NOT NULL DEFAULT 'pending', -- pending|approved|denied|expired
  expires_at     INTEGER NOT NULL,
  interval       INTEGER NOT NULL DEFAULT 5,
  client_notification_token TEXT, -- for ping/push modes
  delivery_mode  TEXT NOT NULL DEFAULT 'poll', -- poll|ping|push
  created_at     INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
```

**Reusable existing components:**

- JWT signing (`jwt-signer.ts`) — for id_tokens issued via CIBA
- DPoP nonce store — for sender-constrained CIBA tokens
- Vault unlock and intent flow — the model to generalize into durable approval-bound releases
- Pairwise subject identifiers — same computation, using `jwks_uri` for sector
- Client authentication — reuse existing OAuth client auth mechanisms
- RAR infrastructure — `authorization_details` already in discovery metadata

### Phase 2: Delegated Authorization + Token Exchange

**New components:**

| Component | Purpose |
|-----------|---------|
| Token Exchange (RFC 8693) | Narrow broad user or agent authority into target-specific delegated tokens |
| Delegated token claim profile | Include principal, actor, approval id, and authorization binding |
| One-time release redemption endpoint | Redeem approval-bound release handles for sensitive data delivery |
| Token validation updates | Distinguish machine-only tokens from delegated agent tokens |

**Why this matters:** This is the internal core of agent authorization. It should land before external interoperability layers like MCP or A2A, because those layers still need a secure delegated-token model underneath.

### Phase 3: MCP Authorization Server Compatibility

**New components:**

| Component | Purpose |
|-----------|---------|
| Protected Resource Metadata endpoint | `/.well-known/oauth-protected-resource` on any service using Zentity as AS |
| CIMD support | Accept URL-formatted `client_id`, fetch metadata document |
| Resource Indicators (RFC 8707) | Validate `resource` param, bind tokens to audience |
| `code_challenge_methods_supported` | Add to OIDC discovery for MCP client compatibility |

**Why this matters:** If Zentity wants agents using MCP to authenticate through us, we must speak the MCP auth dialect. This is additive to our existing OAuth AS — we add RFC 9728 Protected Resource Metadata discovery and RFC 8707 audience binding.

### Phase 4: A2A Agent Card

**New components:**

| Component | Purpose |
|-----------|---------|
| Agent Card endpoint | `/.well-known/agent-card.json` — advertise Zentity's agent capabilities |
| `act` claim in access tokens | Agent identity in delegated tokens (per `draft-oauth-ai-agents-on-behalf-of-user`) |
| Per-skill security | Different scopes for different agent operations |

**Agent Card example for Zentity:**

```json
{
  "name": "Zentity Identity Agent",
  "description": "Privacy-preserving identity verification and credential issuance",
  "version": "1.0.0",
  "provider": {
    "organization": "Zentity",
    "url": "https://zentity.xyz"
  },
  "supportedInterfaces": [{
    "url": "https://app.zentity.xyz/a2a",
    "protocolBinding": "JSONRPC",
    "protocolVersion": "0.3"
  }],
  "securitySchemes": {
    "oauth2": {
      "oauth2SecurityScheme": {
        "flows": {
          "authorizationCode": {
            "authorizationUrl": "https://app.zentity.xyz/api/auth/oauth2/authorize",
            "tokenUrl": "https://app.zentity.xyz/api/auth/oauth2/token",
            "scopes": {
              "openid": "OpenID Connect",
              "proof:age": "Age verification proof",
              "proof:nationality": "Nationality verification proof",
              "identity.name": "Full name (requires vault unlock)"
            },
            "pkceRequired": true
          }
        }
      }
    }
  },
  "securityRequirements": [
    { "schemes": { "oauth2": { "list": ["openid"] } } }
  ],
  "skills": [
    {
      "id": "verify-age",
      "name": "Age Verification",
      "description": "Verify user is above a specified age threshold",
      "tags": ["identity", "age", "compliance"],
      "securityRequirements": [
        { "schemes": { "oauth2": { "list": ["openid", "proof:age"] } } }
      ]
    },
    {
      "id": "issue-credential",
      "name": "Issue Identity Credential",
      "description": "Issue an SD-JWT VC with verified claims",
      "tags": ["credential", "vc", "sd-jwt"],
      "securityRequirements": [
        { "schemes": { "oauth2": { "list": ["openid", "identity_verification"] } } }
      ]
    }
  ],
  "capabilities": {
    "streaming": true,
    "pushNotifications": false
  },
  "defaultInputModes": ["application/json"],
  "defaultOutputModes": ["application/json"]
}
```

### Phase 5: AuthZEN PDP (Policy Decision Point)

**New components:**

| Component | Purpose |
|-----------|---------|
| AuthZEN evaluation endpoint | `POST /access/v1/evaluation` |
| AuthZEN batch endpoint | `POST /access/v1/evaluations` |
| AuthZEN discovery | `GET /.well-known/authzen-configuration` |
| Policy engine | Rules for auto-approve vs. CIBA step-up vs. deny |

This phase makes Zentity a real-time authorization decision engine for agent actions, not just a token issuer. Policy evaluation considers: user's verification tier, agent's trust level, action sensitivity, transaction amount, time-of-day, behavioral anomalies.

### Phase 6: Transaction Tokens (Optional Delegation Chain Propagation)

**New components:**

| Component | Purpose |
|-----------|---------|
| Transaction Token Service | Issue Txn-Tokens from access tokens |
| `actor` + `principal` context | Propagate agent identity + human principal through call chains |
| Txn-Token validation | Verify incoming Txn-Tokens from other services |

This is needed when Zentity participates in multi-service architectures where authorization context must propagate through microservice call chains.

---

## 6. Protocol Composition Matrix

How the protocols compose for each scenario:

### Scenario 1: Agent Needs PII

| Step | Protocol | Component |
|------|----------|-----------|
| Agent registers | OAuth 2.1 DCR or CIMD | Zentity AS |
| Agent discovers AS | RFC 8414 / OIDC Discovery | `/.well-known/openid-configuration` |
| Agent requests PII access | **CIBA** | `/api/auth/oauth2/bc-authorize` |
| User receives notification | Web Push / Mobile SDK | Push notification service |
| User reviews request | `binding_message` + `scope` display | Phone UI |
| User unlocks vault | Passkey PRF / OPAQUE | Authentication device |
| User approves | CIBA consent | Phone UI |
| Agent polls for token | CIBA token endpoint | `/api/auth/oauth2/token` |
| Agent redeems approved release | Delegated token + release handle | Approval-bound one-time release |
| Token is sender-constrained | DPoP | Proof-of-possession |
| Token audience is bound | RFC 8707 | `resource` parameter |

### Scenario 2: Agent Needs Human Authorization

| Step | Protocol | Component |
|------|----------|-----------|
| Agent has base token | OAuth 2.1 | Previously issued |
| Agent attempts restricted action | HTTP API call | Resource Server |
| RS denies (insufficient scope) | OAuth 2.1 `WWW-Authenticate` | 403 + `insufficient_scope` |
| RS queries policy (optional) | **AuthZEN** | `POST /access/v1/evaluation` |
| PDP returns: "require CIBA step-up" | AuthZEN decision context | `required_action: ciba_step_up` |
| Agent initiates step-up | **CIBA** + **RAR** | `/api/auth/oauth2/bc-authorize` |
| User receives detailed notification | `binding_message` + `authorization_details` | Push notification |
| User reviews action details | RAR structured display | "Transfer $5,000 to Bob" |
| User approves with biometric | Passkey / FIDO2 | Authentication device |
| Agent receives elevated token | CIBA + DPoP | Short-lived, action-scoped |
| Agent retries restricted action | HTTP API call | Resource Server |
| RS validates elevated token | OAuth 2.1 + RAR | Audience + scope + `authorization_details` |
| Action is logged with delegation chain | JWT `act` claim | `sub` (user) + `act.sub` (agent) |

---

## 7. Comparison: What We Have vs. What We Need

| Capability | Current Status | Gap | Priority |
|-----------|---------------|-----|----------|
| OAuth 2.1-style AS | Implemented | None | -- |
| PKCE | Implemented | None | -- |
| DPoP | Implemented (enforced on tRPC + token endpoints) | None | -- |
| PAR | Implemented + required | None | -- |
| RAR (`authorization_details`) | Implemented | CIBA + token exchange carry `authorization_details` end-to-end | -- |
| DCR | Implemented | Need CIMD support for MCP clients | Medium |
| Pairwise subjects | Implemented | None | -- |
| Multi-alg JWT | RS256/ES256/EdDSA/ML-DSA-65 | None | -- |
| OID4VCI | Implemented | Pre-authorized agent VCs (future, optional) | Medium |
| OID4VP | Implemented (demo-rp) | Agent as VP presenter | Medium |
| HAIP | Implemented | None | -- |
| CIBA | Implemented | Poll mode via `@better-auth/ciba` plugin, agent boundaries for auto-approval | -- |
| Durable approval / release state | Implemented | Approval records + ephemeral release handles + DB status transitions | -- |
| MCP Resource Server Metadata | Implemented | `/.well-known/oauth-protected-resource` endpoint (RFC 9728) | -- |
| **CIMD** | **Not implemented** | **URL-based client_id support** | **High** |
| Resource Indicators (RFC 8707) | Implemented | `resource` param validation + audience binding on PAR, CIBA, token exchange | -- |
| Token Exchange (RFC 8693) | Implemented | Three exchange modes, scope attenuation, DPoP passthrough, `act` nesting | -- |
| **A2A Agent Card** | **Not implemented** | **Agent discovery + per-skill security** | **Medium** |
| **AuthZEN PDP** | **Not implemented** | **Real-time policy evaluation across APIs, gateways, and agent surfaces** | **High** |
| **Transaction Tokens** | **Not implemented** | **Call-chain context propagation** | **Low** |
| `act` claim in JWTs | Implemented | CIBA grant handler + token exchange add `act: { sub: client_id }` with nesting | -- |
| Push notifications | Implemented | VAPID web push with inline approve/deny, email fallback | -- |

---

## 8. Security Considerations

### 8.1 Agent Token Hygiene

- Agent tokens MUST be short-lived (minutes for elevated, hours for base)
- DPoP MUST be required for agent clients (prevents stolen token replay)
- Tokens MUST be audience-bound via RFC 8707 `resource` parameter
- Agent tokens SHOULD include `act` claim identifying the agent identity

### 8.2 Delegation Chain Safety

- Token Exchange MUST attenuate scope (narrow, never broaden) at each hop
- `principal` context in Transaction Tokens MUST be immutable across replacements
- Each delegated token MUST have a distinct `aud` (target agent/service)
- Direct credential delivery to requesting agent (not through intermediaries)

### 8.3 CIBA-Specific Risks

- `binding_message` MUST accurately describe the action (agent MUST NOT fabricate)
- CIBA request rate limiting per user (prevent notification spam / approval fatigue)
- `auth_req_id` MUST be high-entropy, short-lived
- Push notification channel MUST be authenticated (prevent notification injection)
- Remote vault unlock MUST require equivalent security to local unlock (passkey biometric)

### 8.4 PII Delivery Safety

- Raw PII SHOULD preferably be released via one-time release handles or target-encrypted payloads, not broad reusable tokens
- PII in tokens MUST be encrypted in transit (TLS) and, if persisted or relayed, protected appropriately (for example JWE where needed)
- Approval-bound release state MUST be durable and replay-safe
- PII tokens MUST NOT be cacheable by intermediaries
- Agent MUST NOT store PII beyond the immediate action's lifetime

### 8.5 AuthZEN PDP Trust

- PEP-to-PDP channel MUST use mTLS or OAuth 2.0 bearer tokens
- PDP MUST default to deny on evaluation errors
- Batch requests MUST be rate-limited to prevent amplification attacks

---

## 9. Open Questions

1. **Push notification delivery for vault unlock** — Web Push API is limited (no guaranteed delivery, no rich UI for passkey prompts). Mobile authenticator SDK (like Auth0 Guardian) provides better UX but requires a mobile app. Should Zentity build a companion mobile authenticator app, or rely on Web Push + service worker?

2. **CIBA + passkey PRF on mobile** — WebAuthn PRF extension on mobile browsers is supported on iOS 18.4+ and Android 14+. Can we trigger a passkey PRF evaluation from a push notification context? Or must the user open the Zentity web app on their phone?

3. **Agent identity registration** — How do agents prove their identity to Zentity? Options: (a) DCR with pre-shared secrets, (b) CIMD with publicly verifiable metadata, (c) SPIFFE SVIDs from the agent's infrastructure, (d) wallet attestation. Need to decide which model(s) to support.

4. **Policy language for AuthZEN** — AuthZEN is policy-engine-agnostic. Options: OPA/Rego, Cedar (AWS), OpenFGA, or a custom DSL. Need to evaluate based on Zentity's policy complexity.

5. **CIBA consent persistence** — CIBA does NOT persist consent (each request is fresh). This is desirable for high-risk actions but creates approval fatigue for routine operations. Consider allowing "remember for X minutes" for specific scope combinations, with AuthZEN controlling when re-approval is needed.

6. **Multi-process release state** — The in-memory ephemeral PII store and DPoP nonce store don't survive horizontal scaling. CIBA state can be DB-backed, but sensitive release state should also become durable and approval-bound rather than relying on sticky sessions or a best-effort shared cache.

---

## 10. Build Location Analysis

### 10.1 CIBA → Must Be Built in `better-auth`

The better-auth `@better-auth/oauth-provider` token endpoint has a **closed dispatch chain** that cannot be extended from the outside:

1. **TypeScript union** (`packages/oauth-provider/src/types/oauth.ts:7-13`): `GrantType` is a closed union — `"authorization_code" | "client_credentials" | "refresh_token" | "urn:ietf:params:grant-type:pre-authorized_code"`.
2. **Zod validation** (`packages/oauth-provider/src/oauth.ts:584-590`): `z.enum([...])` rejects any grant type not in the list before the handler runs.
3. **Switch statement** (`packages/oauth-provider/src/token.ts:47-66`): Hardcoded `switch(grantType)` with `default: throw new APIError("BAD_REQUEST", { error: "unsupported_grant_type" })`.

No plugin hook, middleware, or configuration option can intercept the token endpoint to handle the CIBA grant type (`urn:openid:params:grant-type:ciba`). The `@better-auth/haip` plugin (our reference for plugin-based extensions) adds new endpoints (PAR, VP) and enriches discovery metadata via after-hooks, but it does **not** modify the token endpoint at all.

#### Minimum Change to `better-auth`

Add a `customGrantTypeHandlers` extension point to `OAuthOptions`:

```typescript
// packages/oauth-provider/src/types/index.ts
customGrantTypeHandlers?: Record<string, (ctx: TokenEndpointContext) => Promise<TokenResponse>>;
```

Then three targeted changes:

| File | Line(s) | Change |
|------|---------|--------|
| `types/oauth.ts:7-13` | `GrantType` union | Add `\| (string & {})` escape hatch, or add the CIBA URN explicitly |
| `oauth.ts:584-590` | `z.enum([...])` | Widen to `z.string()` (validate known grants + custom handler keys) |
| `token.ts:47-66` | `switch` default | Before throwing, check `options.customGrantTypeHandlers?.[grantType]` |

This is a minimal, backwards-compatible change — existing grant types work identically, but plugins can register new ones.

#### Alternative: Separate Endpoint (Device Authorization Pattern)

The `@better-auth/device-authorization` plugin uses a **separate** `/device/token` endpoint instead of extending the main token endpoint. CIBA could follow this pattern (`/ciba/token`), but this is non-standard — CIBA spec requires the CIBA grant type to be handled at the **same** token endpoint as other grants. Agents and client libraries expect a single token endpoint URL from discovery metadata.

#### CIBA Plugin Structure

Once `customGrantTypeHandlers` exists, build `@better-auth/ciba` as a peer plugin:

```text
packages/ciba/
├── src/
│   ├── index.ts              # Plugin entry (endpoints + grant handler + hooks)
│   ├── backchannel-authorize.ts  # POST /oauth2/bc-authorize
│   ├── ciba-grant.ts         # Grant handler for urn:openid:params:grant-type:ciba
│   ├── notify.ts             # Push notification abstraction
│   ├── schema.ts             # ciba_requests table
│   └── types.ts              # CibaOptions, delivery modes
```

### 10.2 AuthZEN → Build Entirely in Zentity

AuthZEN is a **standalone HTTP API** with no dependency on the OAuth token endpoint or better-auth internals:

- `POST /access/v1/evaluation` — single authorization decision
- `POST /access/v1/evaluations` — batch decisions
- `GET /.well-known/authzen-configuration` — PDP discovery

Implementation location: `apps/web/src/app/access/v1/` as Next.js API routes. The PDP reads from existing Drizzle DB tables (user tiers, attestation status, agent trust levels) and applies policy rules. No better-auth plugin machinery needed.

```text
apps/web/src/app/access/
├── v1/
│   ├── evaluation/route.ts       # POST — single decision
│   ├── evaluations/route.ts      # POST — batch decisions
│   └── .well-known/
│       └── authzen-configuration/route.ts  # GET — PDP discovery
```

### 10.3 Summary

| Component | Build Location | Reason |
|-----------|---------------|--------|
| CIBA grant handler | `better-auth` (core change + plugin) | Token endpoint dispatch is closed; must add extension point |
| CIBA backchannel endpoint | `better-auth` plugin (`@better-auth/ciba`) | Reuses oauth-provider client auth, token creation internals |
| CIBA push notifications | Zentity (`apps/web`) | Application-specific (Web Push, mobile SDK) |
| CIBA remote vault unlock | Zentity (`apps/web`) | Uses existing vault primitives (passkey PRF, OPAQUE) |
| Durable approval state | Zentity (`apps/web`) | Application-specific DB schema and business logic |
| AuthZEN PDP | Zentity (`apps/web`) | Independent HTTP API, reads from existing DB |
| Token Exchange (RFC 8693) | `better-auth` (core change + plugin) | Needs token endpoint grant type (`urn:ietf:params:oauth:grant-type:token-exchange`) |
| MCP Resource Metadata | Zentity (`apps/web`) | Next.js route at `/.well-known/oauth-protected-resource` |
| A2A Agent Card | Zentity (`apps/web`) | Next.js route at `/.well-known/agent-card.json` |

---

## 11. References

### 11.1 Standards and Specifications

- [OAuth 2.1](https://datatracker.ietf.org/doc/draft-ietf-oauth-v2-1/) — Core authorization framework
- [RFC 8693 — Token Exchange](https://datatracker.ietf.org/doc/html/rfc8693) — Delegation chain token narrowing
- [RFC 9396 — Rich Authorization Requests](https://datatracker.ietf.org/doc/html/rfc9396) — Fine-grained `authorization_details`
- [RFC 9449 — DPoP](https://datatracker.ietf.org/doc/html/rfc9449) — Proof-of-possession tokens
- [RFC 8707 — Resource Indicators](https://datatracker.ietf.org/doc/html/rfc8707) — Token audience binding
- [RFC 9728 — Protected Resource Metadata](https://datatracker.ietf.org/doc/html/rfc9728) — RS→AS discovery
- [RFC 7591 — Dynamic Client Registration](https://datatracker.ietf.org/doc/html/rfc7591) — DCR
- [CIBA Core 1.0 Final](https://openid.net/specs/openid-client-initiated-backchannel-authentication-core-1_0-final.html) — Async backchannel authorization
- [AuthZEN Authorization API 1.0](https://openid.net/specs/authorization-api-1_0.html) — PEP-PDP authorization decision API
- [A2A Protocol](https://github.com/a2aproject/A2A) — Agent-to-agent communication
- [MCP Authorization (Nov 2025)](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) — MCP auth spec

### 11.2 IETF Agent Auth Drafts

- [draft-oauth-ai-agents-on-behalf-of-user-02](https://datatracker.ietf.org/doc/draft-oauth-ai-agents-on-behalf-of-user/) — `requested_actor` + `actor_token` + `act` claim
- [draft-oauth-transaction-tokens-for-agents-04](https://datatracker.ietf.org/doc/draft-oauth-transaction-tokens-for-agents/) — `actor` + `principal` in Txn-Tokens
- [draft-rosenberg-oauth-aauth-00](https://datatracker.ietf.org/doc/html/draft-rosenberg-oauth-aauth-00) — Agentic Authorization for non-web channels
- [draft-song-oauth-ai-agent-authorization-00](https://datatracker.ietf.org/doc/draft-song-oauth-ai-agent-authorization/) — `target_id` / `tar` for sub-client modules
- [draft-yao-agent-auth-considerations-01](https://www.ietf.org/archive/id/draft-yao-agent-auth-considerations-01.html) — Multi-mode agent auth framework

### 11.3 Research and Analysis

- [NIST AI Agent Standards Initiative](https://www.nist.gov/caisi/ai-agent-standards-initiative)
- [NCCoE Concept Paper: Software and AI Agent Identity](https://csrc.nist.gov/pubs/other/2026/02/05/accelerating-the-adoption-of-software-and-ai-agent/ipd)
- [OpenID Foundation: Identity Management for Agentic AI (Oct 2025)](https://openid.net/new-whitepaper-tackles-ai-agent-identity-challenges/)
- [Auth0: Secure HITL for AI Agents](https://auth0.com/blog/secure-human-in-the-loop-interactions-for-ai-agents/)
- [Auth0: Async CIBA with LangGraph](https://auth0.com/blog/async-ciba-python-langgraph-auth0/)
- [MCP Auth Spec Update (June 2025)](https://auth0.com/blog/mcp-specs-update-all-about-auth/)
- [MCP Client Registration Update (Nov 2025)](https://aaronparecki.com/2025/11/25/1/mcp-authorization-spec-update)
- [SPIFFE for Agentic AI (HashiCorp)](https://www.hashicorp.com/en/blog/spiffe-securing-the-identity-of-agentic-ai-and-non-human-actors)

---

## Implementation Notes (Phase 1 Addendum)

Phase 1 implementation is complete. The following items from the Section 7 gap analysis have been resolved:

| Item | Implementation |
| --- | --- |
| CIBA | `@better-auth/ciba` vendor plugin, poll mode, `customGrantTypeHandlers` extension via oauth-provider patch (predicted by Section 10.1). Agent identity: `agent_claims` parameter on `bc-authorize` stores self-declared agent metadata in `cibaRequests.agentClaims`, displayed via `AgentIdentityCard` on approval UI. `requiresVaultUnlock` flag: identity-scoped requests show only "Deny" inline in push notifications (vault unlock requires browser context). |
| Durable approval / release state | Approval records with CAS-based status transitions (`approved → claiming → redeemed`), ephemeral release handles with AES-GCM sealing |
| Token Exchange (RFC 8693) | Three exchange modes at standard token endpoint, scope attenuation, DPoP passthrough, `act` claim nesting |
| `act` claim in JWTs | CIBA grant handler adds `act: { sub: client_id }` per draft-oauth-ai-agents-on-behalf-of-user-02 |
| Push notifications | VAPID web push (RFC 8292) with service worker inline approve/deny actions, email fallback |

The `customGrantTypeHandlers` extension point was added via the `@better-auth/oauth-provider` patch, as predicted by Section 10.1's analysis of the token endpoint's closed `switch` statement.
