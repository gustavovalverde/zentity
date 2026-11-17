---
status: "accepted"
date: "2026-09-25"
category: "technical"
domains: [platform, security, privacy, web3]
builds-on: "[Better Auth Passkey Integration + Anonymous Sign-Up](../privacy/0008-better-auth-passkey-integration.md)"
---

# Unpatched Better Auth for passkey-first recovery

## Context and Problem Statement

Zentity relies on Better Auth for passkey-first authentication. Recovery required three behaviors that earlier Better Auth packages lacked: (1) PRF extraction during pre-auth passkey registration, (2) passwordless two-factor enablement for passkey-only accounts, and (3) a backup-code flow that makes users save the codes before they continue. Zentity first shipped these as patches to the published packages. Upstream now covers (1). Zentity no longer offers two-factor authentication, so (2) and (3) no longer apply.

## Priorities & Constraints

* PRF output must be available during registration without a second prompt.
* Changes must be reproducible in CI/Docker builds.

## Decision Outcome

Chosen option: **Use published Better Auth packages unpatched, with upstream options for server behavior.**

Zentity does not patch any Better Auth package, and `pnpm-workspace.yaml` has no `patchedDependencies` entries. When upstream lacks a behavior, Zentity adds it in its own code or proposes it upstream instead of carrying a patch.

### Current State

* **@better-auth/passkey** and **better-auth** run unpatched. Zentity does not install the `twoFactor` plugin.
* **@better-auth-ui/react** and **@better-auth-ui/core** run unpatched. Zentity uses their provider, hooks, and magic-link plugin, and renders its own screens with its design system instead of the library's copied components.

### Interim code awaiting upstream changes

When a Better Auth package lacks a behavior Zentity needs, Zentity adds the behavior in its own code. Each row below names one such mechanism and the upstream change that would retire it. Comments beside the interim code cite the row's identifier, for example `U1 in docs/adr/platform/0002-better-auth-patches.md`. Identifiers stay fixed when rows are added or removed.

None of these changes has an upstream issue yet. When one is filed, link it from the row.

| Id | Package | Upstream change | Interim code in Zentity | When the change ships |
|---|---|---|---|---|
| U1 | `@better-auth/passkey` | A server API that verifies a passkey assertion without creating a session, binds caller context into the stored challenge, requires a passkey of the session user, and returns whether the user was verified. The plugin also exports its RP ID and expected-origin resolvers. | `apps/web/src/lib/auth/passkey/step-up.ts` verifies the CIBA approval step-up with `@simplewebauthn/server`, because the plugin's own verification always signs the user in. | Verify the step-up through the plugin, then delete `step-up.ts` and the direct `@simplewebauthn/server` dependency. |
| U4 | `@better-auth/oauth-provider` | An access-token subject scoped to the token's audience, through a sector hook over the client and the requested resources, under `accessTokenSubject: "pairwise"`. | `signJwt` in `apps/web/src/lib/auth/oidc/jwt-signer.ts` calls `projectAudienceSubject` in `pairwise.ts`, which replaces the provider's pairwise `sub` of a JWT access token for an audience outside Zentity with one derived from the client's sector and that audience. | Configure the provider's sector hook and delete the `sub` override. |
| U15 | `@better-auth/oauth-provider` | Export `getSectorIdentifier` and `deriveSectorIdentifier`. | `clientSector` and `deriveSectorIdentifier` in `apps/web/src/lib/auth/oidc/pairwise.ts`, and a second copy of `deriveSectorIdentifier` in `apps/web/scripts/backfill-oauth-token-transition.ts`, restate the provider's sector rule. | Import the provider's functions and delete the copies. |
| U16 | `@better-auth/oauth-provider` | Skip the multi-host and custom-scheme-with-host pairwise refusals when the derived sector is `client/<client_id>`. | None. A pairwise registration that mixes loopback and https redirect hosts is refused, and `pairwise.integration.test.ts` pins the refusal. | Flip that test to expect the registration to succeed. |
| U17 | `@better-auth/ciba` | Export the reader of a client's `authorization_details_types` metadata (RFC 9396 section 10). | `registersPaymentAuthorization` in `apps/web/src/lib/auth/oidc/payment-mint.ts` reads the field the plugin stores in the client's metadata. | Call the plugin's reader. |
| U22 | `@better-auth/oauth-provider` | Keep a pairwise client's sector when its redirect URIs change, or revoke the client's tokens, refresh tokens, and consents when the sector changes. | `beforeUpdateClientKeepSector` in `apps/web/src/lib/auth/auth-config.ts` refuses a redirect URI update that would change a pairwise client's sector, with `invalid_client_metadata`. | Delete the hook and `keepsSector` in `pairwise.ts`. |
| U24 | `@better-auth/oauth-provider` | Accept `subject_type` on `/oauth2/create-client` and `adminCreateOAuthClient`, or a server-wide default subject type, so a client created there is pairwise from creation and the provider's pairwise redirect URI rules run on it. | `beforeCreateClientRequirePairwiseRedirects` and `afterCreateClientMakePairwise` in `apps/web/src/lib/auth/auth-config.ts`, with `pairwiseRedirectUriProblem` in `pairwise.ts`, check the redirect URIs and make the new client pairwise after creation. | Pass `subject_type: "pairwise"` and delete both hooks and `pairwiseRedirectUriProblem`. |
| U26 | `better-call` or Better Auth hooks | Give before-hooks every value of a repeated form field, such as the RFC 8707 `resource` parameter, not only the last one. | `readRepeatedFormResources` in `apps/web/src/lib/auth/auth-config.ts` reads the raw form body. | Read the values from the hook context and delete the helper. |
| U27 | `@better-auth/oauth-provider` | Let a server-only `adminCreateOAuthClient` call create a client with a fixed `client_id`, or offer a code-defined client source that persists its record, so a built-in client is created through the provider. | `ensureWalletClientExists` in `apps/web/src/lib/auth/oidc/wallet-dcr.ts` inserts and upgrades the built-in `zentity-wallet` row with Drizzle, including its pairwise subject type and `client/zentity-wallet` sector. | Create the wallet client through the provider and delete the direct insert. |
| U28 | `@better-auth/oauth-provider` | A provider test pinning that `verifyResourceRequest` returns the user id in `sub` for a pairwise JWT access token, as its documented contract states. | None. The vendored `@better-auth/oidc4vci` relies on that contract at its credential endpoints, and its own tests pin it. | Drop the plugin test once the provider pins the contract. |

### Expected Consequences

* Better Auth and Better Auth UI upgrades no longer require regenerating patches.

## Alternatives Considered

* **Patch published packages with `patchedDependencies`**: The original approach. It shipped the behavior before upstream did, but every upgrade required regenerating the patches, and the Better Auth UI patch alone was 1.2 MB of rebuilt `dist/` files.
* **Fork and vendor Better Auth**: Higher maintenance burden and divergence risk.
* **Wait for upstream**: Blocked recovery UX and passkey-first sign-up requirements while the patches were needed.

## More Information

* `docs/adr/privacy/0008-better-auth-passkey-integration.md`

## Revision History

* 2026-09-25: Guardian recovery removed; two-factor devices no longer act as recovery guardians.
* 2026-11-10: Removed the last patch (`@daveyplate/better-auth-ui`) and upgraded the package to 3.4.0. The decision is now to use unpatched packages, and the backup-code constraint now requires a download before continuing instead of hiding the codes.
* 2026-11-16: Recorded the interim code that waits for upstream changes, with the change that retires each mechanism.
* 2026-11-16: Removed U25: the vendored `@better-auth/oidc4vci` resolves a pairwise wallet's user through the provider, so registered wallets receive credentials, and Zentity's two refusals are gone. Added U27 (the built-in wallet client's direct insert) and U28 (a provider test for the contract the plugin relies on).
* 2026-11-16: Removed two-factor authentication (TOTP and backup codes) with the `twoFactor` plugin, its settings card, and its `/two-factor` pages. The plugin challenged only Better Auth's email, username, and phone-number sign-ins, which Zentity does not use, so TOTP never protected a Zentity sign-in. It treated every Zentity user as passwordless, because OPAQUE accounts are not `credential` accounts, so a session alone could turn it off or mint new backup codes. The setup page also carried the TOTP secret in its URL.
* 2026-11-17: Replaced the unmaintained `@daveyplate/better-auth-ui` 3.4.0 with its successor, `@better-auth-ui/react` and `@better-auth-ui/core` 1.7.34. The old package's dependencies had pulled a `better-call` 2.x copy that `@better-auth/core` does not accept; the lockfile now resolves only the 1.4.x line that Better Auth requires, plus the 1.3.2 copy pinned by `@better-auth/agent-auth`, which `@better-auth-ui/core` requires as a peer.
