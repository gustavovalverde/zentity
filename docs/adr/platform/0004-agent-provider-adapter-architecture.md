---
status: "proposed"
date: "2026-03-21"
category: "platform"
domains: [security, privacy, platform, product, audit]
---

# Agent provider adapters on top of Zentity core auth

## Context and Problem Statement

Zentity needs a long-term architecture for third-party agent integrations such as Gmail, Microsoft Graph, or other SaaS APIs. A comparison against the `agent-auth-v2` examples showed strong ideas around capability packaging, approval UX, and provider ergonomics, but also showed a custom transport and governance model that is weaker than Zentity's current privacy and trust boundaries.

The decision is not whether Zentity can support Gmail- or Excel-style providers. It can. The decision is where that provider logic belongs, which protocol surfaces remain core Zentity responsibilities, and which parts of the compared design should be adopted, adapted, or rejected.

## Priorities & Constraints

* Privacy-first architecture: Zentity must not normalize broader data custody than necessary
* Stable principal boundaries: browser user, delegated machine, and machine-only callers stay distinct
* Standards-aligned transport: delegated machine calls should remain OAuth + DPoP based
* Durable governance: host policy is durable, session grants are ephemeral
* Auditability: governance-relevant actions need append-only history
* Connector ergonomics: third-party providers should be feasible to build without bespoke protocol work each time
* Breaking changes are acceptable when they reduce protocol debt

## Decision Outcome

Chosen option: build a provider-adapter layer on top of Zentity core auth and policy, and do not adopt `agent-auth-v2` as Zentity's core protocol.

Zentity should keep its current architectural center:

* CIBA for human consent
* OAuth + DPoP for delegated machine transport
* `Agent-Assertion` as request-bound runtime proof
* durable host policy in `agent_host_policy`
* ephemeral runtime state in `agent_session_grant`
* append-only audit events as the canonical history layer

On top of that, Zentity should add a connector or provider-adapter layer for SaaS integrations.

### Adopt

Adopt these ideas substantially as-is:

* First-class approval handoff UX for headless runtimes. The compared SDK's "approval required" abstraction validates the need for PRD-09 Phase 1.
* Capability-shaped execution APIs. External runtimes benefit from stable `{ capability, input }` contracts instead of app-specific routes.
* Capability metadata that carries input schema, output schema, approval strength, and constrainable fields.
* OpenAPI-assisted provider generation for low-friction connector development.
* Product-facing tooling patterns: discovery, capability search, provider metadata, and LLM-oriented tool guidance.

### Adapt

Adapt these ideas to Zentity's stricter architecture:

* Approval routing:
  Zentity should copy the immediate handoff UX, but the canonical approval flow remains CIBA. Device authorization should not become the core fallback model for PRD-09.

* Execution surface:
  Zentity should add a capability execute data plane, but authenticate it with `Authorization: DPoP <user access token>` plus `DPoP` plus request-bound `Agent-Assertion`, not a standalone agent bearer JWT.

* Capability locations:
  Zentity may later support capability-specific execution locations, but they must still sit behind Zentity transport and policy enforcement or be explicitly modeled as trusted connector boundaries.

* Constraint ergonomics:
  Zentity should expose `constrainable_fields` in SDKs and dashboards, but server enforcement must validate against declared field/operator metadata, not only generic constraint operators.

* Provider packaging:
  Zentity should support connector templates or generator flows, but connectors must plug into Zentity governance, audit, and consent rather than minting their own parallel control plane.

### Reject

Reject these patterns as Zentity defaults:

* Custom `host+jwt` and `agent+jwt` bearer transport as the primary delegated auth model
* Reusing the login token directly as the agent bootstrap credential
* Treating `Agent-Assertion` or agent self-signed tokens as bearer credentials independent of OAuth
* Making OAuth device authorization the main approval model for core agent consent
* Unlinked autonomous mode as a default architectural goal for Zentity
* Broad third-party token custody inside Zentity core as the default integration pattern
* Callback-only event logging as a substitute for append-only audit history
* Durable host governance expressed only as broad default capability lists

## Connector Architecture

Zentity should support two connector classes.

### 1. Provider adapters

A provider adapter exposes third-party functionality as Zentity capabilities.

Examples:

* Gmail proxy
* Microsoft Graph / Excel connector
* CRM or ticketing provider

Responsibilities:

* declare capability metadata
* declare `constrainable_fields`
* classify capabilities by `execution_mode`
* define the request and response contract for each capability
* normalize and validate connector-facing inputs before dispatch
* dispatch an already-authorized execution to an in-process handler or connector runtime
* return structured results

Provider adapters are the capability and policy contract layer. They do not replace Zentity's approval, transport, or audit model, and they should not own long-lived upstream credentials when a separate connector runtime exists.

### 2. Connector runtimes

A connector runtime is the operational boundary that may hold upstream provider credentials, refresh tokens, or service keys when the integration requires them.

Responsibilities:

* manage upstream OAuth or API credentials
* call upstream APIs
* implement the execution side of provider capabilities
* never widen or reinterpret Zentity authorization decisions
* emit execution correlation metadata for audit joins

Connector runtimes should be treated as explicit trust boundaries, not hidden implementation details.

## Responsibility Split

### Zentity core

Zentity core owns:

* host and session registration
* dedicated RFC 8693 bootstrap token exchange for agent control-plane bootstrap
* durable host policy
* ephemeral session grants
* CIBA approval flows
* request-bound `Agent-Assertion`
* OAuth + DPoP validation
* constraint validation policy
* usage enforcement
* append-only audit events

### Connector boundary

The connector owns:

* upstream provider OAuth linking or service auth
* provider-specific capability handlers
* upstream request execution
* provider-specific result shaping

### Upstream provider

The upstream provider owns:

* data model of the external service
* upstream scopes and APIs
* upstream rate limits and refresh semantics

## Connector Boundary Requirements

When Zentity dispatches work to a connector runtime, that hop must be explicitly authenticated, correlated, and constrained.

### Service authentication

Zentity-to-connector calls must use a machine-to-machine auth contract distinct from end-user delegation.

Required properties:

* the connector authenticates Zentity as a confidential machine caller
* the credential is audience-bound to the connector service
* raw user-delegated access tokens are not forwarded to the connector as the primary auth mechanism

Preferred default:

* OAuth `client_credentials` access token issued for the connector audience

### Audit correlation

Each dispatched execution must carry correlation fields that let Zentity join connector activity back to its own audit stream.

Minimum fields:

* `execution_id`
* `audit_event_id`
* `session_id`
* `host_id`
* `capability`

The connector should return or log its own execution identifier plus any relevant upstream request identifiers so audit and incident response can trace the full path.

### Authorization boundary

Connectors execute decisions made by Zentity. They may enforce narrower local safeguards, but they must not widen capability scope, bypass approval requirements, or reinterpret a request as authorized when Zentity did not authorize it.

## Execution Model

The long-term execution flow should be:

1. Runtime authenticates to Zentity with OAuth + DPoP
2. Runtime presents `Agent-Assertion` bound to the exact request
3. Zentity resolves session, host policy, session grants, usage limits, and approval requirements
4. If consent is required, Zentity routes through CIBA
5. If direct execution is allowed, Zentity dispatches to the connector handler
6. Connector calls the upstream provider if needed
7. Zentity records append-only audit events and usage enforcement data

This means connectors consume Zentity authorization decisions. They do not make independent final authorization decisions for delegated user actions.

## Data Classification Rule

`execution_mode = "direct"` is reserved for non-PII, pre-approved operations.

Default rule:

* capabilities that read or write mailbox contents, document contents, spreadsheet contents, messages, files, or comparable user content are not `direct` by default

Implications:

* a capability is not automatically `direct` just because it is read-only
* content metadata, derived booleans, or other non-PII summaries may be `direct` if they are explicitly classified as such
* any exception to the default rule should be documented in capability metadata and justified through an explicit architecture decision

## SaaS Connector Guidance

### Gmail-style provider

A Gmail-style provider is a valid connector pattern for Zentity, but it should live in a connector boundary, not redefine Zentity core.

Recommended constraints:

* email send capabilities should constrain recipients, domains, and rate
* mailbox read capabilities should constrain folders, search envelope, and result count
* destructive mailbox actions should always require stronger approval than read-only actions
* mailbox content reads should default to non-`direct` execution modes unless explicitly classified as non-PII summaries

### Microsoft Graph / Excel-style provider

A Microsoft Graph or Excel connector is feasible under the same model.

Likely capability shapes:

* `microsoft.excel.workbook.list`
* `microsoft.excel.worksheet.read_range`
* `microsoft.excel.worksheet.write_range`
* `microsoft.excel.table.append_rows`

Likely constrainable fields:

* `drive_id`
* `workbook_id`
* `worksheet`
* `table`
* `range`
* `max_rows`

Write capabilities should default to stronger approval and tighter envelope constraints than read capabilities.
Spreadsheet and workbook content reads should default to non-`direct` execution modes unless the returned data is explicitly classified as non-PII.

## Consequences

### Positive

* Zentity gets the connector ergonomics validated by `agent-auth-v2` without regressing on privacy boundaries
* PRD-09 gains external confirmation that headless approval handoff and capability execute APIs are worth building
* Gmail- and Excel-style connectors become feasible without turning Zentity core into a general-purpose credential proxy
* Governance remains centered on host policy, session grants, and append-only audit

### Negative

* Connector developers have to integrate with a stricter auth model than the compared custom bearer design
* Some integrations will require an explicit connector service boundary and secret-management design
* OpenAPI-driven provider generation will still need Zentity-specific policy and audit glue

### Neutral

* Zentity may end up with a more layered system than the compared plugin-only architecture
* Some provider patterns may still choose to proxy upstream APIs, but that becomes an explicit connector decision rather than an architectural default

## Alternatives Considered

### Option 1: Adopt `agent-auth-v2` protocol wholesale

Pros:

* fastest path to polished provider tooling
* already has SDK, CLI, approval surfaces, and capability execution

Cons:

* weaker interoperability with OAuth-native delegated transport
* weaker fit for Zentity's privacy and principal-boundary model
* weaker durable governance model
* weaker audit guarantees

### Option 2: Keep Zentity core only, with no provider-adapter layer

Pros:

* simplest trust model
* minimal surface area

Cons:

* poor extensibility for Gmail- or Excel-style connectors
* repeated bespoke integration work
* lower product leverage from capability discovery and execution tooling

### Option 3: Hybrid model with Zentity core plus provider adapters

Pros:

* preserves Zentity's stronger security architecture
* captures the best product ideas from the compared examples
* gives a scalable path for third-party SaaS connectors

Cons:

* requires deliberate connector contracts and trust-boundary documentation
* needs a connector SDK or generator story later

## More Information

* Zentity architecture: [docs/agent-architecture.md](../../agent-architecture.md)
* PRD-09 workstream: internal plan surface `docs/plans/prd-09-agent-platform-hardening.md`
* Compared repository: `/Users/gustavovalverde/dev/personal/agent-auth-v2`
* Gmail example: `/Users/gustavovalverde/dev/personal/agent-auth-v2/examples/gmail-proxy`
* OpenAPI-driven provider example: `/Users/gustavovalverde/dev/personal/agent-auth-v2/examples/vercel-proxy`
