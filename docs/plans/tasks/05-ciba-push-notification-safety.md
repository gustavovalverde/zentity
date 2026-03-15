# Task 05: CIBA Push Notification Safety

> Source: `ciba-notifications-remediation.md` Phase 1
> Priority: **P1** — push subscriptions not re-bound on user switch; identity-scoped quick actions bypass vault unlock
> Estimate: ~1 day

## Architectural decisions

- **Push subscriptions are device-scoped, not account-scoped**: Re-subscribing the same endpoint transfers ownership to the current user
- **Quick approval is only safe for non-PII requests**: If a request includes any `identity.*` scope, notification actions route to the approval page
- **Deny is always safe from the notification surface**: No vault unlock needed to reject

---

## What to build

Harden push subscription ownership and quick-action behavior so notifications cannot be misdelivered or bypass required approval UI.

End-to-end: `POST /api/push/subscribe` upserts `userId` on existing endpoints → push payload includes `requiresVaultUnlock` boolean → `push-sw.js` conditionally renders quick actions → identity-scoped notification clicks open `/dashboard/ciba/approve?auth_req_id=...` → tests.

### Acceptance criteria

- [x] Re-subscribing an existing endpoint transfers ownership to the current user
- [x] Shared-browser scenario: user A subscribes, user B subscribes same endpoint, only user B receives future notifications
- [x] Push payload explicitly tells the service worker whether vault unlock is required
- [x] Identity-scoped CIBA notifications do not expose a quick-approve path that bypasses staging
- [x] Non-identity CIBA notifications still support fast approve/deny from the notification surface
- [x] Integration test: endpoint ownership transfer across users
- [x] Integration test: identity-scoped notification click opens the approval page instead of authorizing directly
