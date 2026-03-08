/// <reference lib="webworker" />

self.addEventListener("push", (event) => {
  if (!event.data) return;

  const payload = event.data.json();
  const { title, body, data } = payload;
  const authReqId = data?.authReqId;
  const approvalUrl = data?.approvalUrl ?? "/dashboard/ciba";

  const options = {
    body,
    icon: "/images/logo/icon-192.png",
    badge: "/images/logo/icon-192.png",
    tag: authReqId ? `ciba-${authReqId}` : undefined,
    requireInteraction: true,
    data: { authReqId, approvalUrl },
    actions: [
      { action: "approve", title: "Approve" },
      { action: "deny", title: "Deny" },
    ],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const { authReqId, approvalUrl } = event.notification.data ?? {};
  const action = event.action;

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
        body: JSON.stringify({ authReqId }),
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
