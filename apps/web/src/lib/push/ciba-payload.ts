import { isIdentityScope } from "@/lib/auth/oidc/identity-scopes";

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

export function buildNotificationBody(
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
  const body = buildNotificationBody(
    clientLabel,
    data.bindingMessage,
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
