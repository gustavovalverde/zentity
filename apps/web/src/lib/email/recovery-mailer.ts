import "server-only";

import { isMailpitConfigured, sendMailpitMessage } from "./mailpit";
import { isResendConfigured, sendResendMessage } from "./resend";

interface GuardianApprovalToken {
  email: string;
  token: string;
}

const TRAILING_SLASH_PATTERN = /\/$/;

function isProduction(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.APP_ENV === "production"
  );
}

function getAppUrl(): string {
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.BETTER_AUTH_URL ||
    "http://localhost:3000";
  return appUrl.replace(TRAILING_SLASH_PATTERN, "");
}

function buildApprovalLink(token: string): string {
  return `${getAppUrl()}/recover-guardian?token=${token}`;
}

export async function sendRecoveryGuardianEmails(params: {
  accountEmail: string | null;
  approvals: GuardianApprovalToken[];
}): Promise<{
  delivered: number;
  attempted: number;
  mode: "email" | "mixed" | "manual";
}> {
  if (!params.approvals.length) {
    return { delivered: 0, attempted: 0, mode: "manual" };
  }

  const useMailpit = !isProduction() && isMailpitConfigured();
  const useResend = isResendConfigured() && !useMailpit;

  if (!(useResend || useMailpit)) {
    return {
      delivered: 0,
      attempted: params.approvals.length,
      mode: "manual",
    };
  }

  const subject = "Approve account recovery";
  const accountLabel = params.accountEmail ?? "a Zentity account";

  const deliveries = await Promise.all(
    params.approvals.map(async (approval) => {
      const link = buildApprovalLink(approval.token);
      const text = `You have been listed as a recovery guardian for ${accountLabel}.\n\nApprove the recovery: ${link}\n\nThis approval does not grant account access.`;
      const html = `<p>You have been listed as a recovery guardian for <strong>${accountLabel}</strong>.</p><p><a href="${link}">Approve the recovery</a></p><p style="color:#6b7280;">This approval does not grant account access.</p>`;
      const payload = {
        to: [approval.email],
        subject,
        text,
        html,
        tags: ["recovery", "guardian-approval"],
      };

      if (useResend) {
        return await sendResendMessage(payload);
      }

      return await sendMailpitMessage(payload);
    })
  );

  const delivered = deliveries.filter(Boolean).length;
  const attempted = deliveries.length;
  let mode: "email" | "mixed" | "manual" = "mixed";
  if (delivered === 0) {
    mode = "manual";
  } else if (delivered === attempted) {
    mode = "email";
  }

  return { delivered, attempted, mode };
}
