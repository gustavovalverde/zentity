import "server-only";

import {
  type PaymentAuthorization,
  parsePaymentAuthorization,
} from "@zentity/sdk/protocol";
import { eq } from "drizzle-orm";
import { sendNotification, WebPushError } from "web-push";

import { env } from "@/env";
import { approvalPolicy, type ScopeLabel } from "@/lib/agents/capability";
import { describePurchase, formatPaymentAmount } from "@/lib/agents/labels";
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
  /** Zentity approval page for this request. */
  approvalUrl: string;
  authorizationDetails?: unknown;
  bindingMessage?: string | undefined;
  clientName?: string | undefined;
  /** The CIBA request id the approval page and decision route take. */
  requestId: string;
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
  /** Whether the notification may offer Approve; the server enforces it. */
  inlineApprove: boolean;
  requestId: string;
  kind?: "payment_authorization";
  payment?: PaymentAuthorizationProjection;
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
    // The CIBA plugin validates the RAR at bc-authorize, after pinPaymentRequest
    // canonicalizes it (and throws invalid_request on a malformed one), so a
    // parse failure here means corruption.
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
  return {
    amountDisplay: formatPaymentAmount(entry.amount),
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
  bindingMessage: string | undefined
): string {
  return bindingMessage
    ? `${clientLabel}: ${bindingMessage}`
    : `${clientLabel} is requesting access`;
}

/** Names, in server text, what an inline approval shares. */
function withSharedLabels(body: string, labels: ScopeLabel[]): string {
  return labels.length > 0
    ? `${body}\nShares: ${labels.map((entry) => entry.label).join(", ")}`
    : body;
}

export function buildCibaPushPayload(
  data: CibaNotificationData
): CibaPushPayload {
  const approvalUrl = data.approvalUrl;
  const clientLabel = data.clientName ?? "An application";
  const requiresVaultUnlock = data.scope.split(" ").some(isIdentityScope);
  const policy = approvalPolicy({
    scope: data.scope,
    authorizationDetails: data.authorizationDetails,
  });

  const paymentEntry = findPaymentAuthorization(data.authorizationDetails);
  const paymentProjection = paymentEntry
    ? projectPaymentAuthorization(paymentEntry)
    : null;

  const safeBindingMessage = requiresVaultUnlock
    ? undefined
    : sanitizeBindingMessage(data.bindingMessage);

  // A purchase is described in server text, never by the agent's message.
  const purchase = Array.isArray(data.authorizationDetails)
    ? describePurchase(data.authorizationDetails[0])
    : null;
  let summary: string;
  if (paymentProjection) {
    summary = buildPaymentNotificationBody(clientLabel, paymentProjection);
  } else if (purchase) {
    summary = `${clientLabel}: ${purchase.pushText}`;
  } else {
    summary = buildNotificationBody(clientLabel, safeBindingMessage);
  }
  const body = policy.inlineApprove
    ? withSharedLabels(summary, policy.labels)
    : summary;

  const title = data.agentName
    ? `${data.agentName} requests approval`
    : `${clientLabel} is requesting access`;

  const payload: CibaPushPayload = {
    title,
    body,
    data: {
      requestId: data.requestId,
      approvalUrl,
      inlineApprove: policy.inlineApprove,
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

/**
 * Send a Web Push notification to all devices registered by a user. The push
 * service keeps it only until the request it announces expires.
 *
 * Fire-and-forget: errors are logged but never thrown.
 * Stale subscriptions (410 Gone) are auto-deleted.
 * Short-circuits silently when VAPID keys are not configured.
 */
export async function sendWebPush(
  userId: string,
  payload: PushPayload,
  options: { expiresAt: Date }
): Promise<void> {
  const VAPID_PUBLIC_KEY = env.VAPID_PUBLIC_KEY;
  const VAPID_PRIVATE_KEY = env.VAPID_PRIVATE_KEY;
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
  const ttl = Math.max(
    0,
    Math.ceil((options.expiresAt.getTime() - Date.now()) / 1000)
  );

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await sendNotification(
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
            TTL: ttl,
          }
        );
      } catch (error) {
        if (
          error instanceof WebPushError &&
          (error.statusCode === 410 || error.statusCode === 404)
        ) {
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
