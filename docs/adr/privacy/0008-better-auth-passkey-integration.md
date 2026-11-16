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

Registration and authentication accept authenticators without user verification (UV). The plugin's `authentication.afterVerification` hook stores the UV flag the ceremony observed in request state, and the session's authentication context records the matching `amr`: `["pop", "user", "mfa"]` when the authenticator verified the user, and `["pop", "user"]` when it did not. Zentity never claims `hwk`, because registration uses `attestationType: "none"` and cannot tell a hardware-bound key from a synced one. `PASSKEY_RP_ID` (`apps/web/src/lib/auth/origin.ts`) is the app's host, the value the plugin derived from `baseURL` before, and is passed to `passkey({ rpID })`.

### Request-Bound Passkey Step-Up

A CIBA approval that needs user verification is confirmed with a passkey assertion bound to that request and session, which must not sign the user in again. The plugin's `/passkey/verify-authentication` always creates a session, so `apps/web/src/lib/auth/passkey/step-up.ts` verifies the assertion with `@simplewebauthn/server` 13.3.3, the version the plugin resolves:

* `issuePasskeyStepUp` offers the user's own passkeys with `userVerification: "required"` and stores the challenge as the verification row `ciba-step-up:<requestId>:<sessionId>` for 120 seconds. A new call replaces the row.
* `verifyPasskeyStepUp` consumes the row through `consumeVerificationValue`, which refuses an expired row, requires the passkey to belong to the session's user, verifies with `requireUserVerification: true`, `PASSKEY_RP_ID`, and the app origin (plus loopback origins outside production), and advances the signature counter.

### Passkey Enrollment and Account Recovery

Any passkey on the account can answer the CIBA step-up, so who may add a passkey decides how strong that step-up is. Zentity applies its recovery factor rule (`apps/web/src/lib/auth/recovery-factors.ts`) to registration through the plugin's own hooks:

* A global before-hook on `/passkey/generate-register-options` refuses early, before the authenticator prompts.
* `registration.afterVerification`, which runs before the plugin stores the passkey, checks again, so options issued before the session's window ended cannot add one later.
* A global after-hook on `/passkey/verify-registration` records the reason on `passkey.enrollment_method` and notifies the user.

An account without a passkey adds its first one with any fresh session, as the plugin's `freshSessionMiddleware` requires. NIST SP 800-63B-4 §4.1.2.1 allows that binding at the account's current assurance. An account that holds a passkey needs one of these in the same session:

* `passkey_reverified`: a passkey sign-in that observed user verification in the last 5 minutes. On a second device, the browser's cross-device flow can use the passkey on the phone.
* `account_recovery`: in the last 10 minutes, one recovery code and one more proof (§4.2.2.2). The recovery codes are a magic-link sign-in to an address verified before the sign-in, and the recovery key. The other proof is a password sign-in or in-session verify, a wallet sign-in or in-session confirmation (`POST /api/auth/wallet/siwe/verify/challenge` and `/complete`, which record an `eip712` sign-in on the current session), or the other recovery code. A password that a mailbox alone set, by a reset by email or an `email_only_recovery`, never counts; `account.passwordSetMethod` records how each password was set. A wallet, and a password set before that record existed, count only once they are 7 days old.
* `email_only_recovery`: a magic-link sign-in on an account with no password, wallet, or recovery key, which has no second proof to offer.

Otherwise the server answers 403 `REVERIFICATION_REQUIRED`. A reset by email may replace the password of an account that holds a passkey but cannot add one (400 `PASSWORD_NOT_SET`), so a mailbox cannot bind a new factor. One account recovery adds one passkey. A session may take back a passkey it added in the last 10 minutes, as the client does when the new passkey returns no PRF output. The last passkey can be removed only from an account recovery (otherwise 400 `LAST_PASSKEY`), which is how a user removes a passkey they don't recognize. `secrets.removeCredential` refuses to detach a passkey's vault wrapper under the same conditions, so a refused removal leaves the passkey able to open the vault.

The recovery key proves possession without the server learning it. The browser derives a 32-byte verifier from the key with HKDF-SHA256 (info `zentity:verifier:recovery-key`, salt the user ID) and sends its SHA-256 when it saves the key. `POST /api/auth/recovery-key/verify` (session required, 5 requests per minute) compares a presented verifier in constant time and records a `recovery_key` proof for the session for 10 minutes, bound to the verifier it matched, so replacing the key, or another session's recovery spending it, voids the proof. It answers 401 `INVALID_RECOVERY_KEY` for a wrong key and 400 `RECOVERY_KEY_NOT_SET` when the account has no key that can confirm a recovery. The key is spent when a passkey added through a recovery used it: its verifier becomes null, it still opens the vault, and the recovery page offers a replacement.

Better Auth's two-factor backup codes were rejected as the recovery factor: they exist only with TOTP, which Zentity removed, they are stored reversibly, and any session can mint them. Dedicated recovery codes at passkey sign-up were rejected because they add a screen to the most common journey beside the recovery key. Wallet-only accounts with a placeholder email cannot replace a lost passkey without a saved recovery key. An owner who lost the passkey, forgot the password, and has no recovery key or wallet cannot recover in the product either: counting a password reset by email, even after a waiting period, would let mailbox control alone take a passkey account.

### Expected Consequences

* Standardized session and WebAuthn handling, reducing security drift.
* Anonymous sign-up reduces required PII at entry (email is optional).
* Pre-auth enrollment context and registration tokens are durable and TTL-scoped.
* Web3 actions have a clear session boundary via SIWE.
* Additional stored metadata includes passkey public key metadata, wallet address + chain ID, session IP/user agent, and short-lived enrollment context (email if provided).

### Implementation Notes: Better Auth Packages

Zentity uses the published Better Auth packages without local patches, and it offers no two-factor authentication. See [Unpatched Better Auth](../platform/0002-better-auth-patches.md) for the decision and the history of the patches it replaced.

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
* 2026-11-16: Removed two-factor authentication. Passkey-only accounts no longer enable TOTP or backup codes.
* 2026-11-16: Adding a passkey to an account that holds one needs a recent user-verified passkey sign-in or an account recovery, checked at registration options and in `registration.afterVerification`, which no longer records an unread UV flag. Each passkey records how it was added. The recovery key can confirm one account recovery through a server-held verifier. The last passkey is removed only from an account recovery. A password a mailbox alone set never counts toward a recovery, and a reset by email cannot add a password to a passkey account. A wallet can confirm inside a session, so it pairs with an email link.
