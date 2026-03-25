import { isIdentityScope } from "@/lib/auth/oidc/disclosure-registry";

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
    : "Authorization Request";

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
