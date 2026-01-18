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

### Expected Consequences

* Standardized session and WebAuthn handling, reducing security drift.
* Anonymous sign-up reduces required PII at entry (email is optional).
* Pre-auth enrollment context and registration tokens are durable and TTL-scoped.
* Web3 actions have a clear session boundary via SIWE.
* Additional stored metadata includes passkey public key metadata, wallet address + chain ID, session IP/user agent, and short-lived enrollment context (email if provided).

### Implementation Notes: Patched Better Auth Packages

Zentity depends on upstream Better Auth, but the current UX relies on features not yet available in published builds. We use Bun’s patch mechanism to apply small diffs to published packages. This keeps Docker/CI builds reproducible while preserving the passkey-first flow and recovery UX.

#### `@better-auth/passkey` (pre-auth registration + PRF output)

* `apps/web/patches/@better-auth%2Fpasskey@1.5.0-beta.2.patch`
* `apps/web/package.json` → `patchedDependencies`

**Why this exists**

* `registration.requireSession=false` + `resolveUser(context)` for passkey-first sign-up.
* `returnWebAuthnResponse` + `extensions` in the passkey client to capture PRF output without a second prompt.

#### `better-auth` (passwordless 2FA + backup codes)

* `apps/web/patches/better-auth@1.5.0-beta.2.patch`
* Adds `allowPasswordless` support for two-factor backup codes so passkey-only accounts can enable TOTP and generate backup codes without a password.

#### `@daveyplate/better-auth-ui` (download-only backup codes)

* `apps/web/patches/@daveyplate%2Fbetter-auth-ui@3.3.12.patch`
* Updates the 2FA UI to avoid rendering backup codes inline and instead provide a download-only flow.

**Maintenance**

When the upstream release includes these features, remove the patch and the `patchedDependencies` entry. If the local canary changes are updated, regenerate the patch (repeat per package):

1) Update/rebuild `@better-auth/passkey` dist in the local Better Auth repo.
2) Run `bun patch @better-auth/passkey@1.5.0-beta.2` in `apps/web`.
3) Replace `node_modules/@better-auth/passkey/dist` with the updated dist.
4) Run `bun patch --commit node_modules/@better-auth/passkey`.

Repeat the same workflow for `better-auth` and `@daveyplate/better-auth-ui` when their patches need updates.

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
