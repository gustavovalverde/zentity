import "server-only";

import { Resend } from "resend";

import { env } from "@/env";
import { logWarn } from "@/lib/logging/error-logger";

const defaultFromEmail = env.MAIL_FROM_EMAIL;
const defaultFromName = env.MAIL_FROM_NAME;

interface MailMessage {
  html?: string;
  subject: string;
  tags?: string[];
  text: string;
  to: string[];
}

// ---------------------------------------------------------------------------
// Mailpit (development)
// ---------------------------------------------------------------------------

const mailpitBaseUrl = env.MAILPIT_BASE_URL ?? "";
const mailpitSendUrl =
  env.MAILPIT_SEND_API_URL ||
  (mailpitBaseUrl ? `${mailpitBaseUrl.replace(/\/$/, "")}/api/v1/send` : "");
const mailpitUsername = env.MAILPIT_SEND_API_USERNAME ?? "";
const mailpitPassword = env.MAILPIT_SEND_API_PASSWORD ?? "";

function isMailpitConfigured(): boolean {
  return Boolean(mailpitSendUrl);
}

async function sendMailpitMessage(message: MailMessage): Promise<boolean> {
  const payload = {
    From: { Email: defaultFromEmail, Name: defaultFromName },
    To: message.to.map((email) => ({ Email: email })),
    Subject: message.subject,
    Text: message.text,
    HTML: message.html,
    Tags: message.tags,
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (mailpitUsername || mailpitPassword) {
    const token = Buffer.from(`${mailpitUsername}:${mailpitPassword}`).toString(
      "base64"
    );
    headers.Authorization = `Basic ${token}`;
  }

  try {
    const response = await fetch(mailpitSendUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      logWarn("Mailpit send failed", { status: response.status });
      return false;
    }

    return true;
  } catch (error) {
    logWarn("Mailpit send error", {
      message: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

// ---------------------------------------------------------------------------
// Resend (production)
// ---------------------------------------------------------------------------

const resendApiKey = env.RESEND_API_KEY ?? "";
let resendClient: Resend | null = null;

function getResendClient(): Resend {
  if (!resendApiKey) {
    throw new Error("RESEND_API_KEY is not configured.");
  }
  resendClient ??= new Resend(resendApiKey);
  return resendClient;
}

function isResendConfigured(): boolean {
  return Boolean(resendApiKey);
}

function formatFromAddress(): string {
  if (!defaultFromName) {
    return defaultFromEmail;
  }
  return `${defaultFromName} <${defaultFromEmail}>`;
}

async function sendResendMessage(message: MailMessage): Promise<boolean> {
  const tags = message.tags?.length
    ? message.tags.map((tag) => ({ name: tag, value: "true" }))
    : undefined;

  try {
    const resend = getResendClient();
    const { error } = await resend.emails.send({
      from: formatFromAddress(),
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html === undefined ? {} : { html: message.html }),
      ...(tags === undefined ? {} : { tags }),
    });

    if (error) {
      logWarn("Resend send failed", { message: error.message });
      return false;
    }

    return true;
  } catch (error) {
    logWarn("Resend send error", {
      message: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export type SendEmailResult = "sent" | "failed" | "unconfigured";

/**
 * Sends through Mailpit outside production when it is configured, otherwise
 * through Resend. Reports "unconfigured" instead of sending when neither
 * transport is available, so callers decide whether to fall back.
 */
export async function sendEmail(
  message: MailMessage
): Promise<SendEmailResult> {
  const to = message.to.map((email) => email.trim()).filter(Boolean);
  if (!to.length) {
    return "failed";
  }
  const normalized = { ...message, to };

  let sent: boolean;
  if (process.env.NODE_ENV !== "production" && isMailpitConfigured()) {
    sent = await sendMailpitMessage(normalized);
  } else if (isResendConfigured()) {
    sent = await sendResendMessage(normalized);
  } else {
    return "unconfigured";
  }
  return sent ? "sent" : "failed";
}
