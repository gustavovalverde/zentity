import "server-only";

import { env } from "@/env";

import { isMailpitConfigured, sendMailpitMessage } from "./mailpit";
import { isResendConfigured, sendResendMessage } from "./resend";

interface GuardianApprovalToken {
  email: string;
  token: string;
}

const TRAILING_SLASH_PATTERN = /\/$/;

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function getAppUrl(): string {
  return env.NEXT_PUBLIC_APP_URL.replace(TRAILING_SLASH_PATTERN, "");
}

function buildApprovalLink(token: string): string {
  return `${getAppUrl()}/recovery/guardian/approve?token=${token}`;
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

export async function sendCustodialRecoveryEmail(params: {
  email: string;
  token: string;
}): Promise<boolean> {
  const useMailpit = !isProduction() && isMailpitConfigured();
  const useResend = isResendConfigured() && !useMailpit;

  if (!(useResend || useMailpit)) {
    return false;
  }

  const link = buildApprovalLink(params.token);
  const subject = "Verify your identity to continue recovery";
  const text = `Someone is attempting to recover your Zentity account.\n\nIf this was you, verify your identity: ${link}\n\nThis link expires in 15 minutes. If you did not request recovery, you can safely ignore this email.`;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;">
<h2 style="margin-bottom:4px;">Account Recovery</h2>
<p style="color:#6b7280;margin-top:0;">Someone is attempting to recover your Zentity account.</p>
<p>If this was you, click below to verify your identity and continue the recovery process.</p>
<p style="margin:24px 0;">
<a href="${link}" style="display:inline-block;background:#18181b;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:500;">Verify Identity</a>
</p>
<p style="color:#9ca3af;font-size:13px;">This link expires in 15 minutes. If you did not request recovery, you can safely ignore this email.</p>
</div>`;

  const payload = {
    to: [params.email],
    subject,
    text,
    html,
    tags: ["recovery", "custodial-verification"],
  };

  if (useResend) {
    return await sendResendMessage(payload);
  }

  return await sendMailpitMessage(payload);
}
