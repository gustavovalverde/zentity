import "server-only";

import { eq } from "drizzle-orm";
import webpush from "web-push";

import { env } from "@/env";
import { isIdentityScope } from "@/lib/auth/oidc/disclosure/registry";
import { db } from "@/lib/db/connection";
import { pushSubscriptions } from "@/lib/db/schema/ciba";
import { logWarn } from "@/lib/logging/error-logger";

// ---------------------------------------------------------------------------
// Payload construction
// ---------------------------------------------------------------------------

const MAX_BINDING_MESSAGE_LENGTH = 128;

function sanitizeBindingMessage(
  message: string | undefined
): string | undefined {
  if (!message) {
    return undefined;
  }
  const trimmed = message.trim();
  if (trimmed.length <= MAX_BINDING_MESSAGE_LENGTH) {
    return trimmed;
  }
  return `${trimmed.slice(0, MAX_BINDING_MESSAGE_LENGTH - 1)}\u2026`;
}

interface CibaNotificationData {
  agentName?: string | undefined;
  authorizationDetails?: unknown;
  authReqId: string;
  bindingMessage?: string | undefined;
  clientName?: string | undefined;
  requiresBiometric?: boolean | undefined;
  scope: string;
}

interface CibaPushPayload {
  body: string;
  data: {
    approvalUrl: string;
    authReqId: string;
    requiresBiometric: boolean;
    requiresVaultUnlock: boolean;
  };
  title: string;
}

function buildNotificationBody(
  clientLabel: string,
  bindingMessage: string | undefined,
  authorizationDetails: unknown
): string {
  if (bindingMessage) {
    return `${clientLabel}: ${bindingMessage}`;
  }

  if (Array.isArray(authorizationDetails)) {
    for (const detail of authorizationDetails) {
      if (detail?.type === "purchase" && detail?.item) {
        const amount =
          detail.amount?.value && detail.amount?.currency
            ? ` for ${detail.amount.currency === "USD" ? "$" : ""}${detail.amount.value}${detail.amount.currency === "USD" ? "" : ` ${detail.amount.currency}`}`
            : "";
        return `${clientLabel}: ${detail.item}${amount}`;
      }
    }
  }

  return `${clientLabel} is requesting access`;
}

export function buildCibaPushPayload(
  data: CibaNotificationData,
  origin: string
): CibaPushPayload {
  const approvalUrl = `${origin}/approve/${encodeURIComponent(data.authReqId)}`;
  const clientLabel = data.clientName ?? "An application";
  const requiresVaultUnlock = data.scope.split(" ").some(isIdentityScope);
  const safeBindingMessage = requiresVaultUnlock
    ? undefined
    : sanitizeBindingMessage(data.bindingMessage);
  const body = buildNotificationBody(
    clientLabel,
    safeBindingMessage,
    data.authorizationDetails
  );

  const title = data.agentName
    ? `${data.agentName} requests approval`
    : `${clientLabel} is requesting access`;

  return {
    title,
    body,
    data: {
      authReqId: data.authReqId,
      approvalUrl,
      requiresBiometric: data.requiresBiometric ?? false,
      requiresVaultUnlock,
    },
  };
}

// ---------------------------------------------------------------------------
// Server dispatch
// ---------------------------------------------------------------------------

interface PushPayload {
  body: string;
  data?: Record<string, unknown>;
  title: string;
}

interface PushTransport {
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
  transport: PushTransport = defaultTransport,
  vapid?: { publicKey: string; privateKey: string; subject: string }
): Promise<void> {
  const VAPID_PUBLIC_KEY = vapid?.publicKey ?? env.VAPID_PUBLIC_KEY;
  const VAPID_PRIVATE_KEY = vapid?.privateKey ?? env.VAPID_PRIVATE_KEY;
  if (!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY)) {
    return;
  }

  const subscriptions = await db
    .select({
      id: pushSubscriptions.id,
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
    })
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
              subject: vapid?.subject ?? env.VAPID_SUBJECT,
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
            .where(eq(pushSubscriptions.id, sub.id));
          return;
        }

        logWarn("Push notification delivery failed", {
          endpoint: sub.endpoint.slice(0, 60),
        });
      }
    })
  );
}
