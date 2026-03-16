# Task 30: Documentation — CIBA Push Notifications & Aether Demo

> Source PRD: [prd-production-launch.md](../prd-production-launch.md) — Module 4
> Source plan: [documentation-sync-ciba-branch.md](../documentation-sync-ciba-branch.md) — Task 17
> Status: Complete
> Priority: P2
> User Stories: 17

## What to build

Document the web push notification system for CIBA approvals and the Aether AI demo scenario.

**Documents to update:**

- `CLAUDE.md` (root) — CIBA section, push notification subsection
- `docs/oauth-integrations.md` — CIBA push delivery
- `docs/agentic-authorization.md` — push notifications, Aether demo
- Create or update RFC-0034 for CIBA web push notifications
- `apps/demo-rp/README.md` — Aether AI scenario at `/aether`

**Key content:**

- Service worker (`push-sw.js`): push events, notificationclick inline approve/deny, app shell caching
- Push subscription API: `/api/ciba/push/subscribe`, `/api/ciba/push/unsubscribe`
- `requiresVaultUnlock` behavior (identity-scoped → deny-only inline)
- VAPID env vars
- Approval deep-link at `/approve/[authReqId]`
- PWA install banner and push notification banner
- Aether AI: CIBA poll flow, `authorization_details` for purchases

## Acceptance criteria

- [ ] Push notification lifecycle documented (subscribe → receive → inline action → fallback to approval page)
- [ ] `requiresVaultUnlock` behavior documented
- [ ] Aether AI demo flow documented in demo-rp README
- [ ] VAPID env vars documented
