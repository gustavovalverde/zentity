---
status: "accepted"
date: "2026-01-10"
category: "technical"
domains: [platform, security, privacy, web3]
builds-on: "[Better Auth Passkey Integration + Anonymous Sign-Up](../privacy/0008-better-auth-passkey-integration.md)"
---

# Better Auth patches for passkey-first recovery and 2FA UX

## Context and Problem Statement

Zentity relies on Better Auth for passkey-first authentication, but current upstream packages do not fully support: (1) passkey-first PRF extraction during pre-auth registration, (2) passwordless two-factor enablement for passkey-only accounts, and (3) safe backup code UX that avoids rendering codes inline on shared screens. These gaps block our recovery requirements and introduce privacy/UX risks.

## Priorities & Constraints

* Passkey-first accounts must be able to enable and use authenticator-based recovery without adding a password.
* PRF output must be available during registration without a second prompt.
* Backup codes should be downloadable but not displayed inline by default.
* Changes must be reproducible in CI/Docker builds.

## Decision Outcome

Chosen option: **Patch published Better Auth packages using Bun patchedDependencies.**

We apply small, targeted patches to the published packages and commit the patch files into the repo. This allows us to ship the required behavior now while preserving a clear upgrade path when upstream adopts the changes.

### Patched Packages

1) **@better-auth/passkey**
   * Enables pre-auth registration and returns WebAuthn response extensions for PRF output.
   * Required for passkey-first sign-up and key custody.

2) **better-auth**
   * Adds `allowPasswordless` support for two-factor backup code generation so passkey-only users can enable TOTP + backup codes.
   * Aligns with recovery flows that treat 2FA devices as guardians.

3) **@daveyplate/better-auth-ui**
   * Changes backup codes UI to download-only (no inline list) to reduce shoulder-surfing risk.

### Patch Locations

* `apps/web/patches/@better-auth%2Fpasskey@1.5.0-beta.2.patch`
* `apps/web/patches/better-auth@1.5.0-beta.2.patch`
* `apps/web/patches/@daveyplate%2Fbetter-auth-ui@3.3.12.patch`
* `apps/web/package.json` -> `patchedDependencies`

### Expected Consequences

* Passkey-only accounts can enable TOTP and backup codes without a password.
* Recovery guardians can use authenticator codes as approvals (RFC-0014).
* Backup codes are still available but not displayed inline by default.
* Ongoing maintenance required to update/remove patches when upstream changes.

## Alternatives Considered

* **Fork and vendor Better Auth**: Higher maintenance burden and divergence risk.
* **Custom 2FA implementation**: Duplicates audited logic and adds security risk.
* **Wait for upstream**: Blocks recovery UX and passkey-first sign-up requirements.

## More Information

* RFC-0014: FROST Social Recovery
* `docs/adr/privacy/0008-better-auth-passkey-integration.md`
* Bun patch workflow: `bun patch` / `bun patch --commit`
