import "server-only";

import {
  type PaymentAuthorization,
  parsePaymentAuthorization,
} from "@zentity/sdk/protocol";
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
  /** Approval-page URL the CIBA plugin built, with `auth_req_id` attached. */
  approvalUrl: string;
  authorizationDetails?: unknown;
  /** Raw `auth_req_id` bearer credential (the value the approval page consumes). */
  authReqId: string;
  bindingMessage?: string | undefined;
  clientName?: string | undefined;
  requiresBiometric?: boolean | undefined;
  scope: string;
}

interface PaymentAuthorizationProjection {
  amountDisplay: string;
  chain: string;
  paymentId: string;
  recipient: string;
}

type CibaPushData = {
  approvalUrl: string;
  authReqId: string;
  kind?: "payment_authorization";
  payment?: PaymentAuthorizationProjection;
  requiresBiometric: boolean;
  requiresVaultUnlock: boolean;
} & Record<string, unknown>;

interface CibaPushPayload {
  body: string;
  data: CibaPushData;
  title: string;
}

function findPaymentAuthorization(
  authorizationDetails: unknown
): PaymentAuthorization | null {
  if (!Array.isArray(authorizationDetails)) {
    return null;
  }
  const hasPaymentEntry = authorizationDetails.some(
    (entry: { type?: unknown } | null | undefined) =>
      entry?.type === "payment_authorization"
  );
  if (!hasPaymentEntry) {
    return null;
  }
  try {
    return parsePaymentAuthorization(authorizationDetails);
  } catch (error) {
    // The RAR is validated and canonicalized at bc-authorize (canonicalizePaymentRar
    // throws invalid_request there), so a parse failure here means corruption.
    // Log it but return null rather than throwing: this runs inside the
    // fire-and-forget notification path, where a throw would silently abort BOTH
    // the push and the email (the CIBA plugin swallows the rejection). Falling
    // back to a non-payment card keeps the user notified; the loud failure
    // belongs at bc-authorize, which already rejects a malformed RAR.
    logWarn("payment_authorization push projection skipped", {
      reason: error instanceof Error ? error.message : "unknown",
    });
    return null;
  }
}

function projectPaymentAuthorization(
  entry: PaymentAuthorization
): PaymentAuthorizationProjection {
  const amountDisplay =
    entry.amount.unit === "base"
      ? `${entry.amount.value} ${entry.amount.currency} (base unit)`
      : `${entry.amount.value} ${entry.amount.currency}`;
  return {
    amountDisplay,
    chain: `${entry.chain.namespace}:${entry.chain.reference}`,
    paymentId: entry.payment_id,
    recipient: entry.recipient,
  };
}

function truncateMiddle(value: string, head = 8, tail = 6): string {
  if (value.length <= head + tail + 1) {
    return value;
  }
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function buildPaymentNotificationBody(
  clientLabel: string,
  projection: PaymentAuthorizationProjection
): string {
  // Compact line shape: "{client}: {amount} on {chain} to {addr…}".
  // We pre-truncate the recipient so the whole line stays under
  // MAX_BINDING_MESSAGE_LENGTH on every push transport.
  const short = truncateMiddle(projection.recipient);
  const candidate = `${clientLabel}: ${projection.amountDisplay} on ${projection.chain} to ${short}`;
  return sanitizeBindingMessage(candidate) ?? candidate;
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
  data: CibaNotificationData
): CibaPushPayload {
  const approvalUrl = data.approvalUrl;
  const clientLabel = data.clientName ?? "An application";
  const requiresVaultUnlock = data.scope.split(" ").some(isIdentityScope);

  const paymentEntry = findPaymentAuthorization(data.authorizationDetails);
  const paymentProjection = paymentEntry
    ? projectPaymentAuthorization(paymentEntry)
    : null;

  const safeBindingMessage = requiresVaultUnlock
    ? undefined
    : sanitizeBindingMessage(data.bindingMessage);

  const body = paymentProjection
    ? buildPaymentNotificationBody(clientLabel, paymentProjection)
    : buildNotificationBody(
        clientLabel,
        safeBindingMessage,
        data.authorizationDetails
      );

  const title = data.agentName
    ? `${data.agentName} requests approval`
    : `${clientLabel} is requesting access`;

  const payload: CibaPushPayload = {
    title,
    body,
    data: {
      authReqId: data.authReqId,
      approvalUrl,
      requiresBiometric: data.requiresBiometric ?? false,
      requiresVaultUnlock,
    },
  };

  if (paymentProjection) {
    payload.data.kind = "payment_authorization";
    payload.data.payment = paymentProjection;
  }

  return payload;
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
