---
status: "proposed"
date: "2026-01-07"
category: "technical"
domains: [privacy, security, platform, web3]
builds-on: "[Passkey-first auth + PRF custody](0001-passkey-first-auth-prf-custody.md)"
---

# Better Auth Passkey Integration + Anonymous Sign-Up

## Context and Problem Statement

Zentity requires passkey-first authentication that also supports PRF-based key custody, Web3 wallet sessions, and optional email collection. Custom WebAuthn/session handling increases maintenance risk and can drift from security best practices. The system also needs a durable, multi-instance-safe mechanism for pre-auth enrollment context and secret staging.

## Priorities & Constraints

* Minimize stored PII and keep encrypted secrets client-decrypt only.
* Passkey PRF evaluation remains client-side; the server never handles derived keys.
* Support wallet-based Web3 flows with a server session boundary.
* Avoid in-memory or single-instance token storage.
* Keep OAuth-based partner integrations standards-compliant.

## Decision Outcome

Chosen option: **Better Auth for passkeys, sessions, anonymous sign-up, and SIWE wallet sessions**.

Zentity uses Better Auth’s passkey plugin for WebAuthn registration and authentication, stores enrollment context/registration tokens in the Better Auth verification table, and enables anonymous sign-up so email is optional. SIWE is used to bind a wallet address to a Better Auth session for Web3 actions. OAuth provider and generic OAuth plugins are enabled for partner integrations and external identity providers.

### Pre‑Auth Context Token Lifecycle

* The context token is created by `POST /api/fhe-enrollment/context` and stored in `verification` with a short TTL (15 minutes).
* The client must pass it to `GET /passkey/generate-register-options?context=<token>`; Better Auth stores it alongside the WebAuthn challenge.
* During `POST /passkey/verify-registration`, the stored context is forwarded to `resolveUser` / `afterVerification` to bind the new passkey.
* The context is **only** used during registration; passkey sign‑in does not depend on it.
* It can be lost if the client doesn’t send it, the challenge cookie is cleared, the token expires, or the flow continues in a different browser/device.
* If it’s missing, registration fails and the user must restart sign-up to obtain a fresh context.

### Observed User Verification

Registration and authentication accept authenticators without user verification (UV). The plugin's `authentication.afterVerification` and `registration.afterVerification` hooks store the UV flag the ceremony observed in request state, and the session's authentication context records the matching `amr`: `["pop", "user", "mfa"]` when the authenticator verified the user, and `["pop", "user"]` when it did not. Zentity never claims `hwk`, because registration uses `attestationType: "none"` and cannot tell a hardware-bound key from a synced one. `PASSKEY_RP_ID` (`apps/web/src/lib/auth/origin.ts`) is the app's host, the value the plugin derived from `baseURL` before, and is passed to `passkey({ rpID })`.

### Request-Bound Passkey Step-Up

A CIBA approval that needs user verification is confirmed with a passkey assertion bound to that request and session, which must not sign the user in again. The plugin's `/passkey/verify-authentication` always creates a session, so `apps/web/src/lib/auth/passkey/step-up.ts` verifies the assertion with `@simplewebauthn/server` 13.3.3, the version the plugin resolves:

* `issuePasskeyStepUp` offers the user's own passkeys with `userVerification: "required"` and stores the challenge as the verification row `ciba-step-up:<requestId>:<sessionId>` for 120 seconds. A new call replaces the row.
* `verifyPasskeyStepUp` consumes the row through `consumeVerificationValue`, which refuses an expired row, requires the passkey to belong to the session's user, verifies with `requireUserVerification: true`, `PASSKEY_RP_ID`, and the app origin (plus loopback origins outside production), and advances the signature counter.

### Expected Consequences

* Standardized session and WebAuthn handling, reducing security drift.
* Anonymous sign-up reduces required PII at entry (email is optional).
* Pre-auth enrollment context and registration tokens are durable and TTL-scoped.
* Web3 actions have a clear session boundary via SIWE.
* Additional stored metadata includes passkey public key metadata, wallet address + chain ID, session IP/user agent, and short-lived enrollment context (email if provided).

### Implementation Notes: Better Auth Packages

Zentity uses the published Better Auth packages without local patches. Passkey-only accounts enable TOTP and backup codes through the upstream `twoFactor({ allowPasswordless: true })` option, and Zentity's own backup-code page offers the codes as a download. See [Unpatched Better Auth](../platform/0002-better-auth-patches.md) for the decision and the history of the patches it replaced.

## Alternatives Considered

* Custom WebAuthn verification + bespoke session cookies and challenge storage.
* Wallet-only flows without server sessions (SIWE required per request).
* Mandatory email collection before sign-up.
* Custom RP redirect flow instead of OAuth provider.

## More Information

* `docs/architecture.md`
* `docs/attestation-privacy-architecture.md`
* `docs/web3-architecture.md`
* `docs/rp-redirect-flow.md`
* `docs/better-auth-passkey-fhe-plan.md`

## Revision History

* 2026-11-15: CIBA approvals that need user verification use a request- and session-bound passkey step-up (`passkey/step-up.ts`) that verifies without creating a session.
* 2026-11-15: Passkey sign-in and registration record the observed UV flag through the plugin's `afterVerification` hooks, and `amr` states it (`mfa` only with UV, never `hwk`). Authenticators without UV stay accepted.
