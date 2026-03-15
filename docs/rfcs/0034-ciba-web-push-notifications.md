# RFC-0034: CIBA Web Push Notifications & PWA

| Field | Value |
|-------|-------|
| **Status** | Implemented |
| **Created** | 2026-03-07 |
| **Author** | Gustavo Valverde |
| **Depends On** | RFC-0033 (Agentic Auth Integration) |
| **Spec** | [W3C Push API](https://www.w3.org/TR/push-api/), [CIBA Core 1.0](https://openid.net/specs/openid-client-initiated-backchannel-authentication-core-1_0.html) |

## Summary

The CIBA polling flow works end-to-end (bc-authorize, poll, approve, tokens) and the
Aether demo sends structured `authorization_details` (RAR). The missing piece is
**real-time user notification** — today the only delivery channel is email, which is
slow and invisible on locked devices.

This RFC defines a Web Push notification system that delivers CIBA authorization
requests as native OS notifications with inline Approve/Deny action buttons, plus a
PWA manifest that unlocks push on iOS. The goal is: user taps a single button on
their phone or Mac notification and the agent gets its tokens within seconds, with
zero browser interaction required.

---

## Problem

1. **Email latency** — Mailpit/Resend emails take seconds to minutes, require the
   user to open a mail client, find the message, and click a link.
2. **No push on mobile** — iOS Safari only supports Web Push for installed PWAs.
   Without a manifest, mobile users get nothing.
3. **No inline action** — Even when the user does get an email, they must open the
   approval page, read the request, and click Approve. Two extra page loads.
4. **Agent blocked** — The agent polls for up to 5 minutes. Every second of user
   friction is a second the agent (and the human waiting for it) is stalled.

## Design Principles

- **Zero vendor dependency** — VAPID + `web-push` npm package. No Firebase, no
  OneSignal, no third-party push service.
- **Progressive enhancement** — Web Push is the primary channel; email remains as
  fallback for users who decline push or use unsupported browsers.
- **Inline approval where possible** — On platforms that support notification action
  buttons (Chrome, Firefox, Edge on desktop and Android), the user approves directly
  from the notification. On platforms that don't (Safari, iOS), tapping the
  notification opens the approval page.
- **No native app** — PWA install (Add to Home Screen) is sufficient for iOS push.

---

## Architecture

```text
Agent (demo-rp)          Zentity AS                   Push Service          User's Device
    |                        |                            |                      |
    |-- POST /bc-authorize ->|                            |                      |
    |                        |-- store ciba_request ----->|                      |
    |                        |                            |                      |
    |                        |-- web-push.send() -------->|                      |
    |                        |   (VAPID-signed, encrypted)|                      |
    |                        |                            |-- OS notification -->|
    |<-- {auth_req_id} ------|                            |   [Approve] [Deny]   |
    |                        |                            |                      |
    |   (polling)            |                            |      [User taps      |
    |                        |                            |       Approve]       |
    |                        |                            |                      |
    |                        |<---- POST /ciba/authorize -|--- service worker ---|
    |                        |      {auth_req_id}         |   fetch() call       |
    |                        |                            |                      |
    |-- POST /token -------->|                            |                      |
    |<-- {access_token} -----|                            |                      |
```

### Component Overview

| Component | Location | Purpose |
|-----------|----------|---------|
| VAPID key pair | Env vars (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`) | Server identity for push messages |
| Push service worker | `apps/web/public/push-sw.js` | Receive push events, show notifications, handle action clicks |
| Subscription manager | `apps/web/src/lib/push/` | Subscribe/unsubscribe logic, server-side send |
| Subscription storage | `push_subscriptions` table | Per-user, per-device push endpoints |
| Subscription UI | Dashboard settings component | Enable/disable notifications toggle |
| PWA manifest | `apps/web/src/app/manifest.ts` | Makes app installable, unlocks iOS push |
| Push sender | `sendNotification` callback in `auth.ts` | Sends push alongside email |

---

## Implementation

### 1. VAPID Key Generation

Add to the existing `pnpm setup` script:

```typescript
import webpush from "web-push";

const vapidKeys = webpush.generateVAPIDKeys();
// Write VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY to .env
```

Env vars:

```env
VAPID_PUBLIC_KEY=<base64url-encoded P-256 public key>
VAPID_PRIVATE_KEY=<base64url-encoded P-256 private key>
VAPID_SUBJECT=mailto:notifications@zentity.xyz
```

Add to `src/env.ts`:

```typescript
VAPID_PUBLIC_KEY: z.string().optional(),
VAPID_PRIVATE_KEY: z.string().optional(),
VAPID_SUBJECT: z.string().optional().default("mailto:notifications@zentity.xyz"),

// Client-side (for PushManager.subscribe)
NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().optional(),
```

Web Push is opt-in — if VAPID keys are not configured, the system falls back to
email-only delivery (current behavior).

### 2. Push Subscriptions Table

```typescript
// apps/web/src/lib/db/schema/push.ts
export const pushSubscriptions = sqliteTable(
  "push_subscription",
  {
    id: text("id").primaryKey().default(defaultId),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    keyP256dh: text("key_p256dh").notNull(),
    keyAuth: text("key_auth").notNull(),
    userAgent: text("user_agent"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    index("push_sub_user_id_idx").on(table.userId),
    uniqueIndex("push_sub_endpoint_idx").on(table.endpoint),
  ]
);
```

The `endpoint` unique index prevents duplicate subscriptions for the same
browser/device. When a subscription is refreshed (browser regenerates keys), the
old row is replaced via upsert on `endpoint`.

### 3. Service Worker (`public/push-sw.js`)

```javascript
self.addEventListener("push", (event) => {
  const data = event.data?.json() ?? {};

  const options = {
    body: data.body ?? "An application is requesting access.",
    icon: "/icon-192.png",
    badge: "/badge-72.png",
    tag: data.authReqId ?? "ciba-request",
    data: {
      authReqId: data.authReqId,
      approvalUrl: data.approvalUrl,
    },
    actions: [
      { action: "approve", title: "Approve" },
      { action: "deny", title: "Deny" },
    ],
    requireInteraction: true,
  };

  event.waitUntil(self.registration.showNotification(data.title ?? "Authorization Request", options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const { authReqId, approvalUrl } = event.notification.data ?? {};

  if (event.action === "approve" && authReqId) {
    event.waitUntil(
      fetch("/api/auth/ciba/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ auth_req_id: authReqId }),
      })
    );
    return;
  }

  if (event.action === "deny" && authReqId) {
    event.waitUntil(
      fetch("/api/auth/ciba/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ auth_req_id: authReqId }),
      })
    );
    return;
  }

  // Default click (no action button, or platform doesn't support actions) —
  // open the approval page in a browser tab.
  if (approvalUrl) {
    event.waitUntil(clients.openWindow(approvalUrl));
  }
});
```

Key design decisions:

- **`requireInteraction: true`** — Notification stays visible until the user acts.
  Prevents the notification from auto-dismissing before the user sees it.
- **`tag`** — Uses `authReqId` so a new request for the same flow replaces the
  previous notification rather than stacking.
- **`credentials: "same-origin"`** on fetch — Sends the session cookie so the CIBA
  authorize/reject endpoints can authenticate the user.
- **Fallback to `openWindow`** — When no `event.action` is present (Safari, iOS),
  tapping the notification body opens the approval page.

### 4. Client-Side Subscription

```typescript
// apps/web/src/lib/push/subscribe.ts

export async function subscribeToPush(): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return null;
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return null;
  }

  const registration = await navigator.serviceWorker.register("/push-sw.js", {
    scope: "/",
    updateViaCache: "none",
  });

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
  });

  // Send subscription to server
  await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscription.toJSON()),
  });

  return subscription;
}

export async function unsubscribeFromPush(): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();

  if (subscription) {
    await fetch("/api/push/unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });
    await subscription.unsubscribe();
  }
}
```

### 5. Server-Side Push Sender

```typescript
// apps/web/src/lib/push/send.ts
import webpush from "web-push";

import { env } from "@/env";
import { db } from "@/lib/db/connection";
import { pushSubscriptions } from "@/lib/db/schema/push";

export function isWebPushConfigured(): boolean {
  return !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
}

export async function sendWebPush(params: {
  userId: string;
  title: string;
  body: string;
  authReqId: string;
  approvalUrl: string;
}): Promise<void> {
  if (!isWebPushConfigured()) return;

  webpush.setVapidDetails(
    env.VAPID_SUBJECT,
    env.VAPID_PUBLIC_KEY!,
    env.VAPID_PRIVATE_KEY!,
  );

  const subscriptions = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, params.userId));

  const payload = JSON.stringify({
    title: params.title,
    body: params.body,
    authReqId: params.authReqId,
    approvalUrl: params.approvalUrl,
  });

  const results = await Promise.allSettled(
    subscriptions.map((sub) =>
      webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.keyP256dh, auth: sub.keyAuth },
        },
        payload,
      )
    ),
  );

  // Clean up stale subscriptions (410 Gone = browser unsubscribed)
  for (const [i, result] of results.entries()) {
    if (result.status === "rejected" && result.reason?.statusCode === 410) {
      await db
        .delete(pushSubscriptions)
        .where(eq(pushSubscriptions.id, subscriptions[i].id));
    }
  }
}
```

### 6. Integration Point — `sendNotification` Callback

In `apps/web/src/lib/auth/auth.ts`, the existing `sendNotification` callback
currently calls `sendCibaNotification` (email). Add `sendWebPush` alongside it:

```typescript
ciba({
  requestLifetime: 300,
  pollingInterval: 5,
  sendNotification: async (data) => {
    const approvalUrl = `${getAppOrigin()}/dashboard/ciba/approve?auth_req_id=${encodeURIComponent(data.authReqId)}`;

    const clientLabel = data.clientName ?? "An application";
    const pushBody = data.bindingMessage
      ? `${clientLabel}: ${data.bindingMessage}`
      : `${clientLabel} is requesting access to your account.`;

    // Send both channels in parallel — push is primary, email is fallback.
    await Promise.allSettled([
      sendWebPush({
        userId: data.userId,
        title: "Authorization Request",
        body: pushBody,
        authReqId: data.authReqId,
        approvalUrl,
      }),
      sendCibaNotification({
        userId: data.userId,
        authReqId: data.authReqId,
        clientName: data.clientName,
        scope: data.scope,
        bindingMessage: data.bindingMessage,
        authorizationDetails: data.authorizationDetails,
        approvalUrl,
      }),
    ]);
  },
}),
```

Both channels fire in parallel. If the user has push enabled, they get an instant
OS notification. Email still arrives as a backup (and as an audit trail).

### 7. PWA Manifest

```typescript
// apps/web/src/app/manifest.ts
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Zentity",
    short_name: "Zentity",
    description: "Privacy-preserving identity verification",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#09090b",
    theme_color: "#09090b",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
```

This is the minimum required for iOS to recognize the app as a PWA and enable Web
Push when installed to the Home Screen.

### 8. API Routes

Two new tRPC procedures or API routes:

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/push/subscribe` | POST | Store a push subscription for the authenticated user |
| `/api/push/unsubscribe` | POST | Remove a push subscription by endpoint |

Both require an authenticated session. The subscribe endpoint upserts on `endpoint`
(a browser that re-subscribes gets its keys updated, not a duplicate row).

### 9. Dashboard UI

Add a notification toggle to dashboard settings (or as a prompt on the CIBA listing
page):

- Check `Notification.permission` on mount
- If `"default"` — show "Enable push notifications" button
- If `"granted"` — show toggle (on), allow unsubscribe
- If `"denied"` — show explanation that notifications are blocked in browser settings
- On the CIBA listing page, show a banner if push is not enabled:
  "Enable notifications to approve agent requests instantly."

---

## Platform Support

| Platform | Push | Action Buttons | Inline Approve | Fallback |
|----------|------|---------------|----------------|----------|
| Chrome (desktop) | Yes | Yes | Yes (SW fetch) | -- |
| Firefox (desktop) | Yes | Yes | Yes (SW fetch) | -- |
| Edge (desktop) | Yes | Yes | Yes (SW fetch) | -- |
| macOS Safari 18.5+ | Yes (Declarative) | Limited | Opens approval page | Email |
| Chrome (Android) | Yes | Yes | Yes (SW fetch) | -- |
| iOS Safari (PWA) | Yes (16.4+) | No | Opens approval page | Email |
| iOS Safari (browser) | No | No | No | Email only |

### iOS Constraints

iOS Web Push has three hard limitations that cannot be worked around:

1. **PWA install required** — Push only works for sites added to the Home Screen.
   The dashboard should prompt users to install the PWA with clear instructions.
2. **No action buttons** — iOS ignores the `actions` array in `showNotification()`.
   The service worker's `notificationclick` handler fires with no `event.action`,
   which triggers the fallback `openWindow(approvalUrl)` path.
3. **No notification sound** — iOS provides no API for custom notification sounds
   on web push. The notification appears silently unless the user has enabled
   sounds for the PWA in iOS Settings.

### Safari (macOS) Constraints

Safari 18.5+ supports Declarative Web Push, which works without a service worker
for basic notifications. However, action buttons are limited/inconsistent. The
`notificationclick` event may not reliably route to the correct URL. The fallback
path (open approval page) is the reliable behavior.

---

## Service Worker Isolation

Zentity already has `coi-serviceworker.js` for Cross-Origin Isolation
(SharedArrayBuffer). The push service worker (`push-sw.js`) is a **separate**
worker registered at scope `/`. These do not conflict:

- `coi-serviceworker.js` intercepts `fetch` events to add COEP/COOP headers
- `push-sw.js` only handles `push` and `notificationclick` events
- A page can only have one active service worker per scope, but `coi-serviceworker`
  is registered with a narrower scope or as a navigation preload — verify during
  implementation that both can coexist, or merge push handling into the existing
  COI worker

If merging is required, add the `push` and `notificationclick` listeners to
`coi-serviceworker.js` (it's already in `public/`).

---

## Security Considerations

### Authentication on Inline Approve

The service worker's `fetch("/api/auth/ciba/authorize")` call includes
`credentials: "same-origin"`, which sends the session cookie. This works because:

- The CIBA approve/reject endpoints already require an authenticated session
- The service worker runs in the same origin as the app
- The session cookie is `SameSite=Lax` and `HttpOnly`, but service worker fetch
  with `same-origin` credentials includes it

**Risk:** If the session has expired, the inline approve will silently fail (401).
The service worker should check the response status — if not 200, fall back to
opening the approval page so the user can re-authenticate.

```javascript
// In notificationclick handler, after fetch:
const res = await fetch("/api/auth/ciba/authorize", { ... });
if (!res.ok) {
  await clients.openWindow(approvalUrl);
}
```

### Push Payload Encryption

The `web-push` library encrypts payloads using the subscription's `p256dh` and
`auth` keys per RFC 8291 (Message Encryption for Web Push). The push service
(Google, Apple, Mozilla) cannot read the payload. Only the `authReqId` and display
text are in the payload — no PII, no tokens.

### Subscription Cleanup

Stale subscriptions (user uninstalls browser, clears data) return `410 Gone` from
the push service. The sender must delete these rows to avoid wasting bandwidth and
leaking endpoint URLs. This is handled in `sendWebPush` (see Section 5).

### Notification Spoofing

An attacker who obtains a user's push subscription endpoint and keys could send
fake notifications. Mitigations:

- VAPID signing ensures only our server can send to our subscriptions
- The `auth` key in the subscription is a shared secret between browser and server
- Subscriptions are stored server-side only (never exposed to the client after
  initial registration)

### Rate Limiting

CIBA requests are already rate-limited per user by the plugin's `requestLifetime`
(one pending request per client per user). Web Push inherits this limit — at most
one notification per CIBA request. No additional rate limiting is needed.

---

## Payload Budget

Web Push payloads are limited to 4KB (Chrome/Firefox) or 2KB (Safari). The CIBA
notification payload is well within budget:

```json
{
  "title": "Authorization Request",
  "body": "Aether AI: Purchase: Sony WH-1000XM5",
  "authReqId": "ciba_abc123...",
  "approvalUrl": "https://app.zentity.xyz/dashboard/ciba/approve?auth_req_id=ciba_abc123..."
}
```

This is ~250 bytes. Even with longer binding messages and authorization details
summaries, it stays under 1KB. Full `authorization_details` rendering is left to
the approval page — the notification only carries a human-readable summary.

---

## Files to Create / Modify

| File | App | Action |
|------|-----|--------|
| `src/lib/db/schema/push.ts` | web | Create — push subscriptions table |
| `src/lib/push/send.ts` | web | Create — server-side push sender |
| `src/lib/push/subscribe.ts` | web | Create — client-side subscribe/unsubscribe |
| `public/push-sw.js` | web | Create — service worker |
| `src/app/manifest.ts` | web | Create — PWA manifest |
| `public/icon-192.png` | web | Create — PWA icon (192x192) |
| `public/icon-512.png` | web | Create — PWA icon (512x512) |
| `public/badge-72.png` | web | Create — notification badge (72x72, monochrome) |
| `src/app/api/push/subscribe/route.ts` | web | Create — subscription endpoint |
| `src/app/api/push/unsubscribe/route.ts` | web | Create — unsubscription endpoint |
| `src/env.ts` | web | Modify — add VAPID env vars |
| `src/lib/auth/auth.ts` | web | Modify — add `sendWebPush` to `sendNotification` callback |
| `scripts/setup.ts` | web | Modify — generate VAPID keys |
| `src/app/(dashboard)/dashboard/ciba/page.tsx` | web | Modify — add "enable notifications" banner |
| `package.json` | web | Modify — add `web-push` dependency |

---

## Testing

### Manual Verification

1. Run `pnpm setup` — verify VAPID keys are generated in `.env`
2. Open `localhost:3000/dashboard`, click "Enable notifications"
3. Verify browser permission prompt appears, accept it
4. Check `push_subscription` table has a row for the user
5. Start demo-rp, trigger Aether CIBA flow
6. **Desktop Chrome/Firefox:** Verify OS notification with Approve/Deny buttons
7. Tap Approve — verify agent gets tokens on next poll
8. Tap Deny — verify agent gets `access_denied`
9. **Default click (no action):** Verify approval page opens
10. **Expired session:** Verify fallback to `openWindow` when inline fetch returns 401
11. **Email fallback:** Disable push (deny permission), verify email still arrives
12. **Stale subscription:** Manually delete the service worker registration, trigger
    push, verify 410 response cleans up the DB row

### iOS Testing

1. Open `localhost:3000` in Safari on iOS
2. Add to Home Screen
3. Open from Home Screen — verify standalone mode
4. Enable notifications — verify iOS permission prompt
5. Trigger CIBA flow — verify notification appears (no action buttons)
6. Tap notification — verify approval page opens in the PWA

---

## Future Considerations

### CIBA Ping Mode

Web Push solves the **user notification** problem. CIBA **ping mode** (Section 10.2
of CIBA Core 1.0) solves the **agent notification** problem — instead of polling,
the OP calls the agent's registered `backchannel_client_notification_endpoint` when
the user approves. This eliminates polling latency on the agent side.

Ping mode is orthogonal to Web Push and can be added later as a plugin enhancement.
It requires:

- `backchannel_client_notification_endpoint` in client registration
- `backchannel_token_delivery_mode: "ping"` in client metadata
- OP-to-client callback after approval (lightweight HTTP POST with `auth_req_id`)
- Client then fetches tokens from the token endpoint (same as poll)

FAPI permits both poll and ping modes. Push mode (OP delivers tokens directly) is
**not permitted** by FAPI due to unreviewed security concerns.

### Declarative Web Push

Apple's Declarative Web Push (Safari 18.4+ iOS, Safari 18.5+ macOS) allows
notifications without a service worker, using a JSON payload format. This is more
energy-efficient and private. Once the spec stabilizes and browser support widens,
Zentity could adopt it as the primary push mechanism for Safari, keeping the
traditional service worker approach for Chrome/Firefox.

### Rich Notifications

Future iterations could include:

- **Images** — Product thumbnail in purchase notifications
- **Progress** — Multi-step approval (approve scope, then unlock vault)
- **Notification grouping** — Batch multiple pending requests

These depend on broader platform support for the Notifications API options and are
not needed for the initial implementation.

---

## References

- [W3C Push API](https://www.w3.org/TR/push-api/)
- [W3C Notifications API](https://notifications.spec.whatwg.org/)
- [RFC 8291 — Message Encryption for Web Push](https://datatracker.ietf.org/doc/html/rfc8291)
- [RFC 8292 — VAPID for Web Push](https://datatracker.ietf.org/doc/html/rfc8292)
- [CIBA Core 1.0](https://openid.net/specs/openid-client-initiated-backchannel-authentication-core-1_0.html)
- [Next.js PWA Guide](https://nextjs.org/docs/app/guides/progressive-web-apps)
- [web-push npm](https://www.npmjs.com/package/web-push)
- [Apple: Sending Web Push Notifications](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers)
- [WebKit: Meet Declarative Web Push](https://webkit.org/blog/16535/meet-declarative-web-push/)
- [Notification Behavior — web.dev](https://web.dev/push-notifications-notification-behaviour/)
- [FAPI CIBA Profile](https://openid.net/specs/openid-financial-api-ciba.html) — Push mode prohibition

---

## Implementation Notes (Addendum)

The following divergences from the RFC design occurred during implementation:

| RFC design | Implementation |
| --- | --- |
| Column names `keyP256dh`, `keyAuth` | `p256dh`, `auth` (shorter, standard Web Push naming) |
| Routes `/api/push/*` | `/api/ciba/push/*` (domain-scoped under CIBA) |
| Standalone push service worker | Unified `push-sw.js` includes app shell caching + push handling |
| Two action buttons always | `requiresVaultUnlock` field: identity-scoped requests show only "Deny" inline (vault unlock needs browser context) |
| Flat payload | Data wrapped in `data` field (`payload.data.authReqId`) |
| `sendWebPush(userId, payload)` | `sendWebPush(userId, payload, transport?)` with `buildCibaPushPayload()` separation |
| No client state API | `getPushState()` returns discriminated union (`{ state: "unsupported" \| "denied" \| "prompt" \| "subscribed" \| "unsubscribed" }`) |
| TTL not specified | 300s TTL matching CIBA `requestLifetime` |
