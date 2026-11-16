/// <reference lib="webworker" />

// Earlier versions cached /_next/static responses. Next serves those files as
// immutable, so the browser HTTP cache covers it; drop the leftover cache.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("zentity-"))
            .map((key) => caches.delete(key))
        )
      )
  );
});

// ── Push Notifications ──────────────────────────────────

function submitCibaDecision(requestId, decision) {
  return fetch("/api/auth/ciba/decision", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ request_id: requestId, decision, channel: "push" }),
  });
}

function notifyCibaClients(type, requestId, extra) {
  return self.clients.matchAll({ type: "window" }).then((clients) => {
    for (const client of clients) {
      const pathname = new URL(client.url).pathname;
      if (
        pathname.startsWith("/dashboard/agents") ||
        pathname.startsWith("/approve/")
      ) {
        client.postMessage({ type, requestId, ...extra });
      }
    }
  });
}

self.addEventListener("push", (event) => {
  if (!event.data) return;

  const payload = event.data.json();
  const { title, body, data } = payload;

  // A notice about the user's own account: nothing to approve.
  if (data?.kind === "account_notice") {
    event.waitUntil(
      self.registration.showNotification(title, {
        body,
        icon: "/images/logo/icon-192.png",
        badge: "/images/logo/icon-192.png",
        tag: "account-notice",
        data: { kind: "account_notice", url: data.url },
      })
    );
    return;
  }

  const requestId = data?.requestId;
  const approvalUrl = data?.approvalUrl ?? "/dashboard/agents";
  const requiresVaultUnlock = data?.requiresVaultUnlock === true;
  // The server decides which requests a notification may approve, and
  // refuses a notification approval of any other. A payload without the
  // flag gets no Approve action.
  const inlineApprove = data?.inlineApprove === true && !requiresVaultUnlock;
  const kind = data?.kind;
  const payment = data?.payment;

  let actions;
  if (inlineApprove) {
    actions = [
      { action: "approve", title: "Approve" },
      { action: "deny", title: "Deny" },
    ];
  } else if (requiresVaultUnlock) {
    actions = [{ action: "deny", title: "Deny" }];
  } else {
    actions = [
      { action: "review", title: "Review" },
      { action: "deny", title: "Deny" },
    ];
  }

  const options = {
    body,
    icon: "/images/logo/icon-192.png",
    badge: "/images/logo/icon-192.png",
    tag: requestId ? `ciba-${requestId}` : "ciba",
    requireInteraction: true,
    vibrate: [100, 50, 100],
    data: {
      requestId,
      approvalUrl,
      inlineApprove,
      requiresVaultUnlock,
      kind,
      payment,
    },
    actions,
  };

  event.waitUntil(
    self.registration
      .showNotification(title, options)
      .then(() => notifyCibaClients("ciba:new-request", requestId))
  );
});

function showPaymentConfirmation(requestId, approvalUrl, payment) {
  const summary = payment
    ? `${payment.amountDisplay} on ${payment.chain}`
    : "this payment";
  return self.registration.showNotification("Confirm payment", {
    body: `Approve ${summary}? Open the approval page to review the full card before signing.`,
    icon: "/images/logo/icon-192.png",
    tag: `ciba-${requestId}`,
    requireInteraction: true,
    data: {
      requestId,
      approvalUrl,
      requiresVaultUnlock: false,
      kind: "payment_authorization_confirm",
      payment,
    },
    actions: [
      { action: "open", title: "Review and sign" },
      { action: "deny", title: "Deny" },
    ],
  });
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const {
    requestId,
    approvalUrl,
    inlineApprove,
    requiresVaultUnlock,
    kind,
    payment,
    url,
  } = event.notification.data ?? {};
  const action = event.action;

  if (kind === "account_notice") {
    event.waitUntil(self.clients.openWindow(url ?? "/dashboard/settings"));
    return;
  }

  // Identity-scoped requests always route to the approval page.
  if (requiresVaultUnlock) {
    event.waitUntil(
      self.clients.openWindow(approvalUrl ?? "/dashboard/agents")
    );
    return;
  }

  // payment_authorization: the first notification has a "review" action.
  // Tapping it shows a confirmation notification instead of POSTing
  // approve. The user must open the approval page to actually sign.
  if (kind === "payment_authorization" && requestId) {
    if (action === "deny") {
      event.waitUntil(
        submitCibaDecision(requestId, "denied")
          .then(() =>
            notifyCibaClients("ciba:status-changed", requestId, { action })
          )
          .catch(() => self.clients.openWindow(approvalUrl))
      );
      return;
    }
    event.waitUntil(
      showPaymentConfirmation(requestId, approvalUrl, payment)
    );
    return;
  }

  // payment_authorization_confirm: second-step prompt. Only "open" routes
  // to the approval page; everything else is a no-op or a deny.
  if (kind === "payment_authorization_confirm" && requestId) {
    if (action === "deny") {
      event.waitUntil(
        submitCibaDecision(requestId, "denied")
          .then(() =>
            notifyCibaClients("ciba:status-changed", requestId, { action })
          )
          .catch(() => self.clients.openWindow(approvalUrl))
      );
      return;
    }
    event.waitUntil(
      self.clients.openWindow(approvalUrl ?? "/dashboard/agents")
    );
    return;
  }

  if (
    requestId &&
    (action === "deny" || (action === "approve" && inlineApprove === true))
  ) {
    event.waitUntil(
      submitCibaDecision(
        requestId,
        action === "approve" ? "approved" : "denied"
      )
        .then((res) => {
          if (!res.ok) {
            return self.clients.openWindow(approvalUrl);
          }
          // Show confirmation (replaces original via same tag)
          return self.registration
            .showNotification(
              action === "approve" ? "Request Approved" : "Request Denied",
              {
                body:
                  action === "approve"
                    ? "Authorization granted successfully."
                    : "Authorization denied.",
                icon: "/images/logo/icon-192.png",
                tag: `ciba-${requestId}`,
                requireInteraction: false,
              }
            )
            .then(() =>
              notifyCibaClients("ciba:status-changed", requestId, { action })
            );
        })
        .catch(() => self.clients.openWindow(approvalUrl))
    );
    return;
  }

  // Default click (no action button or unsupported platform) — open approval page
  event.waitUntil(self.clients.openWindow(approvalUrl ?? "/dashboard/agents"));
});
