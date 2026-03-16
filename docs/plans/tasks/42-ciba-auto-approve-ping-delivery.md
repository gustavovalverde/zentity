# Task 42: CIBA Auto-Approve Ping Delivery

> Phase 4 of [Cross-App Auth Hardening](../cross-app-auth-hardening.md)
> Finding: #7 (ping not emitted on auto-approve)

## Status: Not started

## Problem

When a CIBA request is auto-approved by a boundary policy, the `sendNotification` callback returns immediately without triggering ping delivery. The flow:

1. `bc-authorize` inserts the pending CIBA request row and calls `sendNotification`
2. `sendNotification` calls `tryAutoApprove`, which updates the DB directly to `status = "approved"` and returns `true`
3. `sendNotification` short-circuits and returns — no ping, no email, no push
4. The CIBA plugin's `/ciba/authorize` endpoint (the only place `deliverPing` fires) is never called

A `deliveryMode="ping"` client is waiting for a notification at its `backchannel_client_notification_endpoint`. Without the notification, it sits in `authorization_pending` until the request expires.

Poll-mode clients are unaffected (they poll and find the approved status).

## Solution

### Extend tryAutoApprove return value

Currently `tryAutoApprove` returns `boolean`. Change it to return an object with the approval result and delivery metadata from the DB row:

```typescript
{ approved: true, deliveryMode: "ping", clientNotificationEndpoint: "...", clientNotificationToken: "..." }
// or
{ approved: false }
```

The `cibaRequests` row already has `deliveryMode`, `clientNotificationEndpoint`, and `clientNotificationToken` columns. The existing query in `tryAutoApprove` just needs to select these additional fields.

### Deliver ping in sendNotification

After `tryAutoApprove` returns a successful approval:

1. If `deliveryMode === "ping"` and `clientNotificationEndpoint` is present:
   - Call `deliverPing(endpoint, token, authReqId)` (import from the CIBA plugin's exports or reimplement the simple POST call)
2. If `deliveryMode === "poll"`:
   - Do nothing extra (client polls on its own)
3. Continue to skip email/push/web notifications for auto-approved requests (the user doesn't need to be notified about something their boundary policy already approved)

### deliverPing implementation

If the CIBA plugin doesn't export `deliverPing`, implement it inline — it's a simple HTTP POST:

```http
POST {clientNotificationEndpoint}
Authorization: Bearer {clientNotificationToken}
Content-Type: application/json
Body: { "auth_req_id": "{authReqId}" }
```

Fire-and-forget with `.catch(() => {})` to match the plugin's existing behavior.

## Acceptance criteria

- [ ] `tryAutoApprove` returns delivery metadata (mode, endpoint, token) when approval succeeds
- [ ] `sendNotification` calls `deliverPing` for ping-mode auto-approved requests
- [ ] `sendNotification` does NOT call `deliverPing` for poll-mode auto-approved requests
- [ ] `deliverPing` sends the correct HTTP POST with auth_req_id and bearer token
- [ ] Test: auto-approve of ping-mode request triggers `deliverPing` with correct endpoint and token
- [ ] Test: auto-approve of poll-mode request does not trigger `deliverPing`

## Notes

- Only the auto-approve path is affected. Manual approval goes through the plugin's `/ciba/authorize` endpoint which already calls `deliverPing`.
- The `sendNotification` callback's remaining code (email, web push) should only run for non-auto-approved requests — this is already the case since the early return is preserved for auto-approved requests.
- `deliverPing` failures should not break the flow — fire-and-forget semantics. The client can fall back to polling.
