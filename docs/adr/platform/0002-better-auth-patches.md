---
status: "accepted"
date: "2026-09-25"
category: "technical"
domains: [platform, security, privacy, web3]
builds-on: "[Better Auth Passkey Integration + Anonymous Sign-Up](../privacy/0008-better-auth-passkey-integration.md)"
---

# Unpatched Better Auth for passkey-first recovery and 2FA UX

## Context and Problem Statement

Zentity relies on Better Auth for passkey-first authentication. Recovery requires three behaviors that earlier Better Auth packages lacked: (1) PRF extraction during pre-auth passkey registration, (2) passwordless two-factor enablement for passkey-only accounts, and (3) a backup-code flow that makes users save the codes before they continue. Zentity first shipped these as patches to the published packages. Upstream now covers (1) and (2), and Zentity owns the UI for (3).

## Priorities & Constraints

* Passkey-first accounts must be able to enable and use authenticator-based recovery without adding a password.
* PRF output must be available during registration without a second prompt.
* Users must download their backup codes before they can leave the backup-code step.
* Changes must be reproducible in CI/Docker builds.

## Decision Outcome

Chosen option: **Use published Better Auth packages unpatched, with upstream options for server behavior and Zentity-owned UI for two-factor setup.**

Zentity does not patch any Better Auth package, and `pnpm-workspace.yaml` has no `patchedDependencies` entries. When upstream lacks a behavior, Zentity adds it in its own code or proposes it upstream instead of carrying a patch.

### Current State

* **@better-auth/passkey** and **better-auth** run unpatched. Passwordless two-factor enrollment uses the upstream `twoFactor({ allowPasswordless: true })` option.
* **@daveyplate/better-auth-ui** runs unpatched. Zentity renders its own two-factor settings card and backup-code page (`/two-factor/backup-codes`). That page shows the codes once, offers them as a `.txt` download, and keeps Continue disabled until the user downloads them. Zentity does not render the library's two-factor or security settings cards, so the library's backup-code dialog never appears.

### Interim code awaiting upstream changes

When a Better Auth package lacks a behavior Zentity needs, Zentity adds the behavior in its own code. Each row below names one such mechanism and the upstream change that would retire it. Comments beside the interim code cite the row's identifier, for example `U1 in docs/adr/platform/0002-better-auth-patches.md`. Identifiers stay fixed when rows are added or removed.

None of these changes has an upstream issue yet. When one is filed, link it from the row.

| Id | Package | Upstream change | Interim code in Zentity | When the change ships |
|---|---|---|---|---|
| U1 | `@better-auth/passkey` | A server API that verifies a passkey assertion without creating a session, binds caller context into the stored challenge, requires a passkey of the session user, and returns whether the user was verified. The plugin also exports its RP ID and expected-origin resolvers. | `apps/web/src/lib/auth/passkey/step-up.ts` verifies the CIBA approval step-up with `@simplewebauthn/server`, because the plugin's own verification always signs the user in. | Verify the step-up through the plugin, then delete `step-up.ts` and the direct `@simplewebauthn/server` dependency. |
| U15 | `@better-auth/oauth-provider` | Export `getSectorIdentifier` and `deriveSectorIdentifier`. | `clientSector` and `deriveSectorIdentifier` in `apps/web/src/lib/auth/oidc/pairwise.ts`, and a second copy of `deriveSectorIdentifier` in `apps/web/scripts/backfill-oauth-token-transition.ts`, restate the provider's sector rule. | Import the provider's functions and delete the copies. |
| U16 | `@better-auth/oauth-provider` | Skip the multi-host and custom-scheme-with-host pairwise refusals when the derived sector is `client/<client_id>`. | None. A pairwise registration that mixes loopback and https redirect hosts is refused, and `pairwise.integration.test.ts` pins the refusal. | Flip that test to expect the registration to succeed. |
| U17 | `@better-auth/ciba` | Export the reader of a client's `authorization_details_types` metadata (RFC 9396 section 10). | `registersPaymentAuthorization` in `apps/web/src/lib/auth/oidc/payment-mint.ts` reads the field the plugin stores in the client's metadata. | Call the plugin's reader. |
| U22 | `@better-auth/oauth-provider` | Keep a pairwise client's sector when its redirect URIs change, or revoke the client's tokens, refresh tokens, and consents when the sector changes. | `beforeUpdateClientKeepSector` in `apps/web/src/lib/auth/auth-config.ts` refuses a redirect URI update that would change a pairwise client's sector, with `invalid_client_metadata`. | Delete the hook and `keepsSector` in `pairwise.ts`. |

### Expected Consequences

* Passkey-only accounts can enable TOTP and backup codes without a password.
* Backup-code presentation is owned by Zentity's UI, not by a patched third-party component.
* Backup codes appear on screen once during setup, so users should complete that step on a private screen.
* Better Auth and Better Auth UI upgrades no longer require regenerating patches.

## Alternatives Considered

* **Patch published packages with `patchedDependencies`**: The original approach. It shipped the behavior before upstream did, but every upgrade required regenerating the patches, and the Better Auth UI patch alone was 1.2 MB of rebuilt `dist/` files.
* **Fork and vendor Better Auth**: Higher maintenance burden and divergence risk.
* **Custom 2FA implementation**: Duplicates audited logic and adds security risk.
* **Wait for upstream**: Blocked recovery UX and passkey-first sign-up requirements while the patches were needed.

## More Information

* `docs/adr/privacy/0008-better-auth-passkey-integration.md`

## Revision History

* 2026-09-25: Guardian recovery removed; two-factor devices no longer act as recovery guardians.
* 2026-11-10: Removed the last patch (`@daveyplate/better-auth-ui`) and upgraded the package to 3.4.0. The decision is now to use unpatched packages, and the backup-code constraint now requires a download before continuing instead of hiding the codes.
* 2026-11-16: Recorded the interim code that waits for upstream changes, with the change that retires each mechanism.
