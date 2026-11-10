---
status: "accepted"
date: "2026-09-25"
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

### Current State

Zentity no longer patches any Better Auth package, and `pnpm-workspace.yaml` has no `patchedDependencies` entries.

* **@better-auth/passkey** and **better-auth** run unpatched. Passwordless two-factor enrollment uses the upstream `twoFactor({ allowPasswordless: true })` option.
* **@daveyplate/better-auth-ui** runs unpatched. Zentity renders its own two-factor settings card and backup-code page (`/two-factor/backup-codes`), which offers the codes as a `.txt` download. Zentity does not render the library's two-factor or security settings cards, so the library's backup-code dialog never appears.

### Expected Consequences

* Passkey-only accounts can enable TOTP and backup codes without a password.
* Backup-code presentation is owned by Zentity's UI, not by a patched third-party component.
* Better Auth and Better Auth UI upgrades no longer require regenerating patches.

## Alternatives Considered

* **Fork and vendor Better Auth**: Higher maintenance burden and divergence risk.
* **Custom 2FA implementation**: Duplicates audited logic and adds security risk.
* **Wait for upstream**: Blocks recovery UX and passkey-first sign-up requirements.

## More Information

* `docs/adr/privacy/0008-better-auth-passkey-integration.md`

## Revision History

* 2026-09-25: Guardian recovery removed; two-factor devices no longer act as recovery guardians.
* 2026-11-10: Removed the last patch (`@daveyplate/better-auth-ui`) and upgraded the package to 3.4.0; no Better Auth package is patched.
