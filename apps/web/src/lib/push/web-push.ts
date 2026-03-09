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

/**
 * Send a Web Push notification to all devices registered by a user.
 *
 * Fire-and-forget: errors are logged but never thrown.
 * Stale subscriptions (410 Gone) are auto-deleted.
 * Short-circuits silently when VAPID keys are not configured.
 */
export async function sendWebPush(
  userId: string,
  payload: PushPayload
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
        await webpush.sendNotification(
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
        const statusCode =
          error instanceof webpush.WebPushError ? error.statusCode : undefined;

        if (statusCode === 410 || statusCode === 404) {
          await db
            .delete(pushSubscriptions)
            .where(eq(pushSubscriptions.endpoint, sub.endpoint));
          return;
        }

        logWarn("Push notification delivery failed", {
          endpoint: sub.endpoint.slice(0, 60),
          statusCode,
        });
      }
    })
  );
}
