"use client";

import { env } from "@/env";

function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/**
 * Register the push service worker, request permission, subscribe via PushManager,
 * and send the subscription to the server.
 *
 * Returns the PushSubscription on success, or null if unavailable/denied.
 */
export async function subscribeToPush(): Promise<PushSubscription | null> {
  if (!isPushSupported()) {
    return null;
  }

  const vapidKey = env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidKey) {
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
  await navigator.serviceWorker.ready;

  const keyBytes = urlBase64ToUint8Array(vapidKey);
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: keyBytes.buffer as ArrayBuffer,
  });

  const res = await fetch("/api/ciba/push/subscribe", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscription.toJSON()),
  });

  if (!res.ok) {
    await subscription.unsubscribe();
    return null;
  }

  return subscription;
}

/**
 * Unsubscribe from push notifications and remove the server-side subscription.
 */
export async function unsubscribeFromPush(): Promise<void> {
  if (!isPushSupported()) {
    return;
  }

  const registration =
    await navigator.serviceWorker.getRegistration("/push-sw.js");
  if (!registration) {
    return;
  }

  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    return;
  }

  const { endpoint } = subscription;
  await subscription.unsubscribe();

  await fetch("/api/ciba/push/unsubscribe", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  });
}

/**
 * Get the current push subscription state without triggering any permissions.
 *
 * Checks both browser permission AND actual PushManager subscription,
 * because permission "granted" doesn't guarantee a subscription exists
 * (user may have cleared browser data).
 */
export async function getPushState(): Promise<
  "unsupported" | "prompt" | "subscribed" | "unsubscribed" | "denied"
> {
  if (!isPushSupported()) {
    return "unsupported";
  }
  if (!env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
    return "unsupported";
  }
  if (Notification.permission === "denied") {
    return "denied";
  }
  if (Notification.permission === "default") {
    return "prompt";
  }
  // Permission is "granted" — register the SW (idempotent) to trigger update
  // checks per Next.js PWA guide, then check if a subscription exists.
  const registration = await navigator.serviceWorker
    .register("/push-sw.js", { scope: "/", updateViaCache: "none" })
    .catch(() => undefined);
  if (!registration) {
    return "unsupported";
  }
  const subscription = await registration.pushManager
    .getSubscription()
    .catch(() => null);
  return subscription ? "subscribed" : "unsubscribed";
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
