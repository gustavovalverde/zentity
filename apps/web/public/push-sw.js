/// <reference lib="webworker" />

const CACHE_NAME = "zentity-shell-v1";

// ── App Shell Caching ───────────────────────────────────

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never cache API or tRPC requests
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/trpc/")) {
    return;
  }

  // CacheFirst for hashed static assets (immutable once built)
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(event.request).then(
          (cached) =>
            cached ||
            fetch(event.request).then((response) => {
              cache.put(event.request, response.clone());
              return response;
            })
        )
      )
    );
    return;
  }

  // StaleWhileRevalidate for /approve/* navigation requests
  if (
    event.request.mode === "navigate" &&
    url.pathname.startsWith("/approve/")
  ) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(event.request).then((cached) => {
          const networkFetch = fetch(event.request).then((response) => {
            cache.put(event.request, response.clone());
            return response;
          });
          return cached || networkFetch;
        })
      )
    );
    return;
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith("zentity-") && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
});

// ── Push Notifications ──────────────────────────────────

self.addEventListener("push", (event) => {
  if (!event.data) return;

  const payload = event.data.json();
  const { title, body, data } = payload;
  const authReqId = data?.authReqId;
  const approvalUrl = data?.approvalUrl ?? "/dashboard/ciba";
  const requiresVaultUnlock = data?.requiresVaultUnlock === true;

  const actions = requiresVaultUnlock
    ? [{ action: "deny", title: "Deny" }]
    : [
        { action: "approve", title: "Approve" },
        { action: "deny", title: "Deny" },
      ];

  const options = {
    body,
    icon: "/images/logo/icon-192.png",
    badge: "/images/logo/icon-192.png",
    tag: authReqId ? `ciba-${authReqId}` : "ciba",
    requireInteraction: true,
    vibrate: [100, 50, 100],
    data: { authReqId, approvalUrl, requiresVaultUnlock },
    actions,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const { authReqId, approvalUrl, requiresVaultUnlock } =
    event.notification.data ?? {};
  const action = event.action;

  // Identity-scoped requests always route to the approval page
  if (requiresVaultUnlock) {
    event.waitUntil(
      self.clients.openWindow(approvalUrl ?? "/dashboard/ciba")
    );
    return;
  }

  if (authReqId && (action === "approve" || action === "deny")) {
    const endpoint =
      action === "approve"
        ? "/api/auth/ciba/authorize"
        : "/api/auth/ciba/reject";

    event.waitUntil(
      fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auth_req_id: authReqId }),
      })
        .then((res) => {
          if (!res.ok) {
            return self.clients.openWindow(approvalUrl);
          }
        })
        .catch(() => self.clients.openWindow(approvalUrl))
    );
    return;
  }

  // Default click (no action button or unsupported platform) — open approval page
  event.waitUntil(self.clients.openWindow(approvalUrl ?? "/dashboard/ciba"));
});
