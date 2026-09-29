import "server-only";

import {
  type PaymentAuthorization,
  parsePaymentAuthorization,
} from "@zentity/sdk/protocol";
import { eq } from "drizzle-orm";

import {
  type AuthorizationDetail,
  normalizeAuthorizationDetails,
} from "@/lib/agents/capability";
import { formatPaymentAmount } from "@/lib/agents/labels";
import { db } from "@/lib/db/connection";
import { users } from "@/lib/db/schema/auth";

import {
  isMailpitConfigured,
  isResendConfigured,
  sendMailpitMessage,
  sendResendMessage,
} from "./transport";

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: unknown): string {
  return String(value).replace(
    /[&<>"']/g,
    (char) => HTML_ESCAPES[char] ?? char
  );
}

function escapeHtmlHref(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return escapeHtml(url);
    }
  } catch {
    // fall through to the safe fallback below
  }
  return "#";
}

function parsePaymentDetail(
  detail: AuthorizationDetail
): PaymentAuthorization | null {
  if (detail.type !== "payment_authorization") {
    return null;
  }
  try {
    return parsePaymentAuthorization([detail]);
  } catch {
    return null;
  }
}

function formatAuthorizationDetailsText(
  details: AuthorizationDetail[]
): string {
  return details
    .map((d) => {
      const payment = parsePaymentDetail(d);
      if (payment) {
        return `Payment: ${formatPaymentAmount(payment.amount)} to ${payment.recipient}`;
      }
      if (d.type === "purchase" && d.amount?.value) {
        const currency = d.amount.currency ?? "USD";
        return `${d.item ?? "Item"} — $${d.amount.value} ${currency}${d.merchant ? ` (${d.merchant})` : ""}`;
      }
      return `${d.type ?? "unknown"}: ${JSON.stringify(d)}`;
    })
    .join("\n");
}

function formatAuthorizationDetailsHtml(
  details: AuthorizationDetail[]
): string {
  return details
    .map((d) => {
      const payment = parsePaymentDetail(d);
      if (payment) {
        return `<div style="background:#f3f4f6;padding:12px 16px;border-radius:8px;margin:12px 0;">
<p style="margin:0 0 4px;font-weight:600;">Payment</p>
<p style="margin:0 0 4px;font-size:18px;font-weight:700;">${escapeHtml(formatPaymentAmount(payment.amount))}</p>
<p style="margin:0;color:#6b7280;font-size:13px;word-break:break-all;">To: ${escapeHtml(payment.recipient)}</p>
</div>`;
      }
      if (d.type === "purchase") {
        const amount = d.amount?.value
          ? `$${escapeHtml(d.amount.value)} ${escapeHtml(d.amount.currency ?? "USD")}`
          : "";
        return `<div style="background:#f3f4f6;padding:12px 16px;border-radius:8px;margin:12px 0;">
<p style="margin:0 0 4px;font-weight:600;text-transform:capitalize;">${escapeHtml(d.type)}</p>
${d.item ? `<p style="margin:0 0 4px;">${escapeHtml(d.item)}</p>` : ""}
${amount ? `<p style="margin:0 0 4px;font-size:18px;font-weight:700;">${amount}</p>` : ""}
${d.merchant ? `<p style="margin:0;color:#6b7280;font-size:13px;">Merchant: ${escapeHtml(d.merchant)}</p>` : ""}
</div>`;
      }
      return `<div style="background:#f3f4f6;padding:12px 16px;border-radius:8px;margin:12px 0;">
<p style="margin:0;font-weight:600;">${escapeHtml(d.type ?? "Details")}</p>
<pre style="margin:4px 0 0;font-size:12px;white-space:pre-wrap;">${escapeHtml(JSON.stringify(d, null, 2))}</pre>
</div>`;
    })
    .join("");
}

interface AgentIdentity {
  attestationProvider?: string | null;
  attestationTier?: string | null;
  model?: string | null | undefined;
  name: string;
  runtime?: string | null | undefined;
  version?: string | null | undefined;
}

function formatAgentText(agent: AgentIdentity): string {
  const parts = [agent.name];
  if (agent.model) {
    parts.push(`Model: ${agent.model}`);
  }
  if (agent.runtime) {
    parts.push(`Runtime: ${agent.runtime}`);
  }
  if (agent.version) {
    parts.push(`Version: ${agent.version}`);
  }
  const trustLabel =
    agent.attestationTier === "attested"
      ? `Attested${agent.attestationProvider ? ` by ${agent.attestationProvider}` : ""}`
      : "Registered runtime";
  return `Agent: ${parts.join(" | ")}\n(${trustLabel})`;
}

function formatAgentHtml(agent: AgentIdentity): string {
  const fields = [`<strong>${escapeHtml(agent.name)}</strong>`];
  if (agent.model) {
    fields.push(`Model: ${escapeHtml(agent.model)}`);
  }
  if (agent.runtime) {
    fields.push(`Runtime: ${escapeHtml(agent.runtime)}`);
  }
  if (agent.version) {
    fields.push(`v${escapeHtml(agent.version)}`);
  }
  const trustLabel =
    agent.attestationTier === "attested"
      ? `Attested${agent.attestationProvider ? ` by ${escapeHtml(agent.attestationProvider)}` : ""}`
      : "Registered runtime";
  return `<div style="background:#eff6ff;border:1px solid #bfdbfe;padding:12px 16px;border-radius:8px;margin:12px 0;">
<p style="margin:0 0 4px;font-weight:600;">${fields.join(" &middot; ")}</p>
<p style="margin:0;color:#6b7280;font-size:12px;">${trustLabel}</p>
</div>`;
}

export async function sendCibaNotification(params: {
  userId: string;
  authReqId: string;
  clientName?: string | undefined;
  scope: string;
  bindingMessage?: string | undefined;
  authorizationDetails?: unknown;
  registeredAgent?: AgentIdentity | undefined;
  approvalUrl: string;
}): Promise<void> {
  const user = await db
    .select({ email: users.email, emailVerified: users.emailVerified })
    .from(users)
    .where(eq(users.id, params.userId))
    .limit(1)
    .get();

  if (!(user?.email && user.emailVerified)) {
    return;
  }

  const useMailpit = !isProduction() && isMailpitConfigured();
  const useResend = isResendConfigured() && !useMailpit;

  if (!(useResend || useMailpit)) {
    return;
  }

  const clientLabel = params.clientName ?? "An application";
  const scopeList = params.scope
    .split(" ")
    .filter((s) => s !== "openid")
    .join(", ");

  const subject = params.bindingMessage
    ? `${clientLabel} is requesting your approval`
    : `${clientLabel} is requesting access`;

  const parsedDetails = normalizeAuthorizationDetails(
    params.authorizationDetails
  );
  const agent = params.registeredAgent ?? null;

  const agentLine = agent ? `\n${formatAgentText(agent)}\n` : "";
  const bindingLine = params.bindingMessage
    ? `\nMessage: "${params.bindingMessage}"\n`
    : "";
  const detailsLine =
    parsedDetails.length > 0
      ? `\nAuthorization Details:\n${formatAuthorizationDetailsText(parsedDetails)}\n`
      : "";

  const text = `${clientLabel} is requesting access to your account.\n\nScopes: ${scopeList}${agentLine}${bindingLine}${detailsLine}\nApprove or deny: ${params.approvalUrl}\n\nIf you did not expect this request, you can safely ignore it.`;

  const agentHtml = agent ? formatAgentHtml(agent) : "";
  const bindingHtml = params.bindingMessage
    ? `<p style="background:#f3f4f6;padding:12px 16px;border-radius:8px;margin:16px 0;font-style:italic;">"${escapeHtml(params.bindingMessage)}"</p>`
    : "";
  const detailsHtml =
    parsedDetails.length > 0
      ? formatAuthorizationDetailsHtml(parsedDetails)
      : "";

  const html = `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;">
<h2 style="margin-bottom:4px;">${escapeHtml(clientLabel)}</h2>
<p style="color:#6b7280;margin-top:0;">is requesting access to your account</p>
${agentHtml}
<p><strong>Scopes:</strong> ${escapeHtml(scopeList)}</p>
${bindingHtml}
${detailsHtml}
<p style="margin:24px 0;">
<a href="${escapeHtmlHref(params.approvalUrl)}" style="display:inline-block;background:#18181b;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:500;">Review Request</a>
</p>
<p style="color:#9ca3af;font-size:13px;">If you did not expect this request, you can safely ignore it.</p>
</div>`;

  const payload = {
    to: [user.email],
    subject,
    text,
    html,
    tags: ["ciba", "auth-request"],
  };

  if (useResend) {
    await sendResendMessage(payload);
  } else {
    await sendMailpitMessage(payload);
  }
}
