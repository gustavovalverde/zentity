---
status: "accepted"
date: "2026-11-15"
category: "technical"
domains: [security, privacy, platform, audit]
builds-on: "[Agent provider adapters on top of Zentity core auth](0004-agent-provider-adapter-architecture.md)"
---

# CIBA approval ceremony and durable approval record

## Context and Problem Statement

An agent asks for a user's approval through CIBA. The approval can release proofs, identity data, or a payment authorization that Zentity's agent wallet signs. Before this decision, a cookie click or a lock-screen tap approved almost every request. The server checked a ceremony only when an Agent-Assertion had verified, and one capability, picked by precedence, decided a request that asked for more. The approval facts lived on `ciba_request`, which the CIBA plugin deletes when it issues the token, so nothing durable said how a request was decided.

## Priorities & Constraints

* The server derives what an approval needs from the whole stored request. Agent input cannot lower it, other than by asking for less.
* An agent with browser control can click buttons and may know the user's password. A payment approval needs a gesture the agent cannot produce.
* A service worker cannot run a WebAuthn ceremony, and a notification can describe only some scopes with server text.
* Service workers installed before this change keep running until the browser updates them.
* What the approval record states must be what happened, and the record must outlive the plugin's deletion of the request.
* Reuse the Better Auth passkey plugin's library, and do not create a session to confirm an approval.

## Decision Outcome

### One policy table for the whole request

`APPROVAL_POLICY` (`apps/web/src/lib/agents/capability.ts`) has a row per scope and per RAR type: the capability that covers it, its ceremony (`session` or `user_verification`), whether a notification may approve it inline, whether a grant may approve it, and a label. Ceremony and grantability come from the capability catalog. `approvalPolicy({ scope, authorizationDetails })` returns:

* the strictest ceremony of the request's items;
* `pageOnly`, true when any item is not inline, any RAR entry is present, or the ceremony is `user_verification`;
* a grant capability only when every item other than `openid` maps to one and the same grantable capability.

An unknown scope is page only, not grantable, and needs a session. An unknown or unreadable RAR entry is page only, not grantable, and needs user verification.

| Item | Capability | Ceremony | Inline | Grantable |
| --- | --- | --- | --- | --- |
| `openid` | none | session | yes | neutral |
| `compliance:read` | `check_compliance` | session | yes | yes |
| `proof:*` predicates | `my_proofs` | session | yes | yes |
| `identity.*` | `my_profile` | user verification with a passkey, else session | no | no |
| `email`, `offline_access`, `proof:sybil`, `agent:*`, and other operational scopes | none | session | no | no |
| RAR `payment_authorization` | `payment_authorization:sign` | user verification | no | bounded grants only |
| scope `payment_authorization:sign` | `payment_authorization:sign` | user verification | no | only with a payment entry |

The catalog's `approval_strength` is the manual ceremony, and `grantable` is a separate column, because one enum cannot say "a bounded grant may approve this, and a person needs user verification."

### The decision endpoint

`POST /api/auth/ciba/decision` takes `{ request_id, decision, channel, webauthn? }`. For an approval it checks, in this order:

1. The request is the user's, pending, and unexpired.
2. A notification approval (`channel` `push`, or no `channel`) of a page-only request is refused with `review_required`. A missing `channel` counts as `push`, because that is what an old service worker sends. The channel is client-asserted, so it can only refuse more.
3. The user's tier satisfies `acr_values`.
4. For identity scopes, a release was staged for the request (`vault_unlock_required` otherwise).
5. The ceremony: `requiredCeremony(policy, { hasPasskey })` is `user_verification` for the policy's ceremony, and for identity scopes when the user has a passkey. Then the endpoint verifies the passkey assertion.
6. It inserts the `ciba_approval` row, whose unique `reference_id` lets only one decision win.
7. It calls the plugin's `completeCibaRequest`, and deletes the row if that fails.

The read-only checks run before the single-use challenge is spent, so a refusal on a cheaper check does not cost the user a second passkey prompt. A denial runs checks 1 and 6. A `webauthn` member on a request that needs only a session is still verified, and records `user_verification`.

### The passkey step-up

`POST /api/auth/ciba/decision/options` issues assertion options over the user's own passkeys with `userVerification: "required"`. The challenge is a verification row bound to the request and the session, single use, and valid for 120 seconds. A new call replaces it. `apps/web/src/lib/auth/passkey/step-up.ts` verifies the assertion with `@simplewebauthn/server`, the library the passkey plugin uses, because the plugin's own verification always creates a session. A verified assertion becomes an authentication context with `amr: ["pop", "user", "mfa"]` and the verification time, which the ID token states as `amr` and `auth_time`. A user without a passkey gets `passkey_required`, and the page offers to add one while keeping Deny.

The approval page runs one ceremony at the Approve click. When the vault is passkey-wrapped and locked, the same assertion carries the PRF extension and unlocks the vault. Otherwise the page runs a standalone assertion.

### The approval record

`ciba_approval` holds one row per decision: the decision, `approval_method` (`session`, `user_verification`, or `capability_grant`), `approval_channel` (`push`, `page`, `email`, or `grant`), copies of the scope, binding message, details, and `acr_values`, the grant facts, the agent session and attestation, the authentication context, and the request, decision, and expiry times. It is written before the plugin can consume the request and is deleted only with the user. It is the source of the CIBA token response member `oversight: { method, approved_at }`, of the agent claims' oversight, and of the Requests tab history.

### Error codes

Zentity defines four codes for the approval endpoints. Every other refusal uses a registered OAuth or OIDC code.

| Code | Status | Meaning |
| --- | --- | --- |
| `review_required` | 403 | A notification approval of a request that must be reviewed on the page |
| `vault_unlock_required` | 403 | An identity approval without a staged release |
| `passkey_required` | 409 | The approval needs user verification and the user has no passkey |
| `insufficient_user_authentication` | 403 | RFC 9470: unmet `acr_values`, a missing passkey confirmation (with `approval_requirement: "user_verification"`), or a failed one |

### Expected Consequences

* Manual payment approvals, and identity approvals by users who have a passkey, need a passkey assertion. Users without a passkey cannot approve a payment until they add one.
* Users without a passkey keep approving identity requests with the session, after unlocking the vault on the page. The server cannot verify a vault unlock, only that a release was staged, so this stays a recorded residual risk.
* The passkey prompt shows no transaction detail. The user relies on the approval page for what they approve.
* A capability-grant approval states the authentication under which the agent session was registered. It is the user's last authentication, not activity for the request.
* A resource server learns nothing about the ceremony from an access token, because the OAuth provider keeps `acr`, `amr`, and `auth_time` out of access tokens.

## Alternatives Considered

* Keep the ceremony requirement on the Agent-Assertion binding. Rejected: a request without an assertion skipped it, and the binding ran in the best-effort notification callback.
* Refuse authenticators without user verification at sign-in. Rejected: sign-in accepts them and records what it observed instead, and the approval asks for user verification when it needs it.
* Verify the step-up through the passkey plugin's `/passkey/verify-authentication`. Rejected: it always creates a session.
* Keep the approval columns on `ciba_request`. Rejected: the plugin deletes the row at token issuance, on a denied or expired poll, and when it sweeps expired rows.

## More Information

* [OAuth integrations: Headless (CIBA)](<../../(protocols)/oauth-integrations.md#headless-ciba>)
* [Agent architecture: Approval Routing](<../../(architecture)/agent-architecture.md#approval-routing>)
* [Better Auth passkey integration](../privacy/0008-better-auth-passkey-integration.md)
* PACT draft §6.2, §6.4, §6.5, and §7.1
