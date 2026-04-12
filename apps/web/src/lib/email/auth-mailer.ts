import "server-only";

import { logger } from "@/lib/logging/logger";

import {
  isMailpitConfigured,
  isResendConfigured,
  sendMailpitMessage,
  sendResendMessage,
} from "./transport";

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

export async function sendEmailVerification(params: {
  user: { email: string; name?: string };
  url: string;
}): Promise<void> {
  const name = params.user.name || "there";

  await send({
    to: [params.user.email],
    subject: "Verify your email — Zentity",
    text: `Hi ${name},\n\nPlease verify your email address to complete your Zentity account setup.\n\nVerify your email: ${params.url}\n\nThis link expires in 1 hour. If you didn't create an account, you can safely ignore this email.\n\nZentity`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;">
<h2 style="margin-bottom:4px;">Verify your email</h2>
<p>Hi ${name},</p>
<p>Please verify your email address to complete your Zentity account setup.</p>
<p style="margin:24px 0;">
<a href="${params.url}" style="display:inline-block;background:#18181b;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:500;">Verify Email</a>
</p>
<p style="color:#9ca3af;font-size:13px;">This link expires in 1 hour. If you didn't create an account, you can safely ignore this email.</p>
</div>`,
    tags: ["auth", "email-verification"],
  });
}

export async function sendChangeEmailConfirmation(params: {
  user: { email: string; name?: string };
  newEmail: string;
  url: string;
}): Promise<void> {
  const name = params.user.name || "there";

  await send({
    to: [params.user.email],
    subject: "Confirm your email change — Zentity",
    text: `Hi ${name},\n\nWe received a request to change your email to ${params.newEmail}.\n\nConfirm this change: ${params.url}\n\nIf you didn't request this, you can safely ignore this email. Your current email will remain unchanged.\n\nZentity`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;">
<h2 style="margin-bottom:4px;">Confirm email change</h2>
<p>Hi ${name},</p>
<p>We received a request to change your Zentity email to <strong>${params.newEmail}</strong>.</p>
<p style="margin:24px 0;">
<a href="${params.url}" style="display:inline-block;background:#18181b;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:500;">Confirm Change</a>
</p>
<p style="color:#9ca3af;font-size:13px;">If you didn't request this, you can safely ignore this email. Your current email will remain unchanged.</p>
</div>`,
    tags: ["auth", "change-email-confirmation"],
  });
}
