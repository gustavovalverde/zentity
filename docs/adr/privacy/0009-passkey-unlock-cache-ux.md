---
status: "accepted"
date: "2026-01-07"
category: "technical"
domains: [privacy, security, product, platform]
builds-on: "[Better Auth Passkey Integration](0008-better-auth-passkey-integration.md)"
---

# Short-lived passkey unlock cache for UX without persistent secrets

## Context and Problem Statement

Passkey PRF evaluation is required to unlock FHE and profile secrets, but it is
a user-gesture WebAuthn ceremony that cannot be reused across reloads. The
previous sign-up flow used a hard reload after passkey creation, which
cleared in-memory PRF output and caused repeated prompts on the dashboard.
We need a better UX without weakening privacy guarantees on shared devices.

## Priorities & Constraints

* Keep PRF outputs in-memory only (no persistence).
* Avoid background prompts that surprise users.
* Maintain clear session isolation on sign-out.
* Improve post-sign-up UX by reducing immediate re-prompts.

## Decision Outcome

Adopt a short-lived, in-memory passkey unlock cache and avoid hard reloads after
sign-up. Cache the PRF output for the current session (15 minutes) and reuse
it for related decryptions (profile/FHE) within the same SPA session. Do not
auto-unlock unless a cached passkey unlock already exists.

This preserves privacy by never persisting PRF outputs while improving UX by
avoiding immediate re-prompts after sign-up.

### Expected Consequences

* Users who just completed sign-up will not be prompted again immediately on
  the dashboard for FHE/profile operations.
* Prompts still occur after hard refresh, new tab, or cache TTL expiry.
* Shared-device risk remains the same as any authenticated session; sign-out
  clears caches and cookies to prevent cross-user reuse.
* Background auto-unlock is avoided unless a valid cached unlock exists.

## Alternatives Considered

* Always require a new passkey prompt per operation (max privacy, poor UX).
* Persist PRF output across sessions (rejected; increases exposure risk).
* Longer TTL or background auto-unlock (rejected; reduces user control).
* Keep hard reload after sign-up (rejected; forces immediate re-prompt).

## More Information

* Related changes: `apps/web/src/lib/privacy/crypto/secret-vault.ts`,
  `apps/web/src/components/sign-up/step-account.tsx`,
  `apps/web/src/components/dashboard/profile-greeting.tsx`,
  `apps/web/src/components/dashboard/user-data-section.tsx`.
