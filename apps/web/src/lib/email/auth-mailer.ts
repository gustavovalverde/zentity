import "server-only";

import { logger } from "@/lib/logging/logger";

import { isMailpitConfigured, sendMailpitMessage } from "./mailpit";
import { isResendConfigured, sendResendMessage } from "./resend";

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function resolveTransport(): "resend" | "mailpit" | "console" {
  const useMailpit = !isProduction() && isMailpitConfigured();
  if (useMailpit) {
    return "mailpit";
  }
  if (isResendConfigured()) {
    return "resend";
  }
  return "console";
}

async function send(payload: {
  to: string[];
  subject: string;
  text: string;
  html: string;
  tags: string[];
}): Promise<void> {
  const transport = resolveTransport();

  if (transport === "console") {
    logger.info(
      { to: payload.to, subject: payload.subject },
      "Email (console fallback)"
    );
    logger.info({ url: extractUrl(payload.text) }, "Action URL");
    return;
  }

  if (transport === "resend") {
    await sendResendMessage(payload);
  } else {
    await sendMailpitMessage(payload);
  }
}

const URL_PATTERN = /https?:\/\/\S+/;

function extractUrl(text: string): string | undefined {
  const match = URL_PATTERN.exec(text);
  return match?.[0];
}

export async function sendResetPasswordEmail(params: {
  user: { email: string; name?: string };
  url: string;
}): Promise<void> {
  const name = params.user.name || "there";

  await send({
    to: [params.user.email],
    subject: "Reset your Zentity password",
    text: `Hi ${name},\n\nWe received a request to reset your password.\n\nReset your password: ${params.url}\n\nIf you didn't request this, you can safely ignore this email.\n\nZentity`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;">
<h2 style="margin-bottom:4px;">Reset your password</h2>
<p>Hi ${name},</p>
<p>We received a request to reset your Zentity password.</p>
<p style="margin:24px 0;">
<a href="${params.url}" style="display:inline-block;background:#18181b;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:500;">Reset Password</a>
</p>
<p style="color:#9ca3af;font-size:13px;">If you didn't request this, you can safely ignore this email.</p>
</div>`,
    tags: ["auth", "reset-password"],
  });
}

export async function sendMagicLinkEmail(params: {
  email: string;
  url: string;
}): Promise<void> {
  await send({
    to: [params.email],
    subject: "Sign in to Zentity",
    text: `Sign in to your Zentity account using this link:\n\n${params.url}\n\nThis link expires in 5 minutes.\n\nIf you didn't request this, you can safely ignore this email.\n\nZentity`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;">
<h2 style="margin-bottom:4px;">Sign in to Zentity</h2>
<p>Click the button below to sign in to your account.</p>
<p style="margin:24px 0;">
<a href="${params.url}" style="display:inline-block;background:#18181b;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:500;">Sign In</a>
</p>
<p style="color:#9ca3af;font-size:13px;">This link expires in 5 minutes. If you didn't request this, you can safely ignore this email.</p>
</div>`,
    tags: ["auth", "magic-link"],
  });
}
