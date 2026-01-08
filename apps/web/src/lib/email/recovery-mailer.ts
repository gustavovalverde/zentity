import "server-only";

import { isMailpitConfigured, sendMailpitMessage } from "./mailpit";

interface GuardianApprovalToken {
  email: string;
  token: string;
}

const TRAILING_SLASH_PATTERN = /\/$/;

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

  if (!isMailpitConfigured()) {
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

      return await sendMailpitMessage({
        to: [approval.email],
        subject,
        text,
        html,
        tags: ["recovery", "guardian-approval"],
      });
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
