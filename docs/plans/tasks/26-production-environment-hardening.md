# Task 26: Production Environment Hardening

> Source PRD: [prd-production-launch.md](../prd-production-launch.md) — Module 1
> Status: Complete
> Priority: P0
> User Stories: 1, 2, 3, 4, 5

## Architectural decisions

- **Email transport**: Reuse the existing Resend/Mailpit dual-transport pattern from `ciba-mailer.ts` and `recovery-mailer.ts`. No new transport abstraction — the shared `sendResendMessage()` / `sendMailpitMessage()` utilities are sufficient.
- **Dev fallback**: When no email transport is configured, log the URL to the console (not silent no-op). This matches how better-auth plugins typically behave in dev mode.
- **Env validation**: Use the same `.refine()` + `isProduction()` guard pattern already used for `KEY_ENCRYPTION_KEY` and `BETTER_AUTH_SECRET`.

---

## What to build

Wire transactional email delivery for password reset and magic link, make critical env vars required in production, and fix CORS headers for DPoP.

**Email delivery:**

- Replace the two no-op `sendResetPassword` and `sendMagicLink` callbacks in the auth config with real implementations that follow the ciba-mailer pattern: check Mailpit first (dev), then Resend (prod), then log-to-console fallback.
- `sendResetPassword` receives `{ user, url }` — send a password reset email with the URL.
- `sendMagicLink` receives `{ email, url }` — send a magic link email with the URL.
- Both should use simple, clean HTML templates (no complex templating — inline styles, single CTA button).

**Env validation:**

- `INTERNAL_SERVICE_TOKEN`: required in production, `min(32)`.
- `RESEND_API_KEY`: required in production.
- `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY`: required in production.

**CORS:**

- Add `DPoP` to `Access-Control-Allow-Headers` in both the OPTIONS preflight and passthrough response paths.

---

## Acceptance criteria

- [ ] `sendResetPassword` sends an email via Resend in production, Mailpit in dev, or logs URL to console if neither is configured
- [ ] `sendMagicLink` sends an email via Resend in production, Mailpit in dev, or logs URL to console if neither is configured
- [ ] Starting the app with `NODE_ENV=production` and missing `INTERNAL_SERVICE_TOKEN` fails with a clear error
- [ ] Starting the app with `NODE_ENV=production` and missing `RESEND_API_KEY` fails with a clear error
- [ ] Starting the app with `NODE_ENV=production` and missing `VAPID_PUBLIC_KEY` or `VAPID_PRIVATE_KEY` fails with a clear error
- [ ] Cross-origin requests with a `DPoP` header pass CORS preflight
- [ ] Existing email flows (CIBA notifications, recovery emails) are unaffected
- [ ] Integration test: `sendResetPassword` calls the email transport with correct `to`, `subject`, and URL in body
- [ ] Integration test: `sendMagicLink` calls the email transport with correct `to`, `subject`, and URL in body
