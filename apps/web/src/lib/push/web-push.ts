import "server-only";

import { eq } from "drizzle-orm";
import webpush from "web-push";

import { env } from "@/env";
import { db } from "@/lib/db/connection";
import { pushSubscriptions } from "@/lib/db/schema/push";
import { logWarn } from "@/lib/logging/error-logger";

interface PushPayload {
  body: string;
  data?: Record<string, unknown>;
  title: string;
}

export interface PushTransport {
  isGoneError(error: unknown): boolean;
  sendNotification(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
    options: {
      vapidDetails: { subject: string; publicKey: string; privateKey: string };
      TTL: number;
    }
  ): Promise<unknown>;
}

const defaultTransport: PushTransport = {
  sendNotification: (sub, payload, options) =>
    webpush.sendNotification(sub, payload, options),
  isGoneError: (error) =>
    error instanceof webpush.WebPushError &&
    (error.statusCode === 410 || error.statusCode === 404),
};

/**
 * Send a Web Push notification to all devices registered by a user.
 *
 * Fire-and-forget: errors are logged but never thrown.
 * Stale subscriptions (410 Gone) are auto-deleted.
 * Short-circuits silently when VAPID keys are not configured.
 */
export async function sendWebPush(
  userId: string,
  payload: PushPayload,
  transport: PushTransport = defaultTransport
): Promise<void> {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = env;
  if (!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY)) {
    return;
  }

  const subscriptions = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));

  if (subscriptions.length === 0) {
    return;
  }

  const body = JSON.stringify(payload);

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await transport.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          body,
          {
            vapidDetails: {
              subject: env.VAPID_SUBJECT,
              publicKey: VAPID_PUBLIC_KEY,
              privateKey: VAPID_PRIVATE_KEY,
            },
            TTL: 300,
          }
        );
      } catch (error) {
        if (transport.isGoneError(error)) {
          await db
            .delete(pushSubscriptions)
            .where(eq(pushSubscriptions.endpoint, sub.endpoint));
          return;
        }

        logWarn("Push notification delivery failed", {
          endpoint: sub.endpoint.slice(0, 60),
        });
      }
    })
  );
}
