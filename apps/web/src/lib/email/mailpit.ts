import "server-only";

import { logWarn } from "@/lib/logging/error-logger";

const baseUrl =
  process.env.MAILPIT_BASE_URL || process.env.MAILPIT_API_URL || "";

const sendUrl =
  process.env.MAILPIT_SEND_API_URL ||
  (baseUrl ? `${baseUrl.replace(/\/$/, "")}/api/v1/send` : "");

const sendUsername = process.env.MAILPIT_SEND_API_USERNAME || "";
const sendPassword = process.env.MAILPIT_SEND_API_PASSWORD || "";

const defaultFromEmail =
  process.env.MAIL_FROM_EMAIL || "no-reply@zentity.local";
const defaultFromName = process.env.MAIL_FROM_NAME || "Zentity";

export interface MailpitMessage {
  to: string[];
  subject: string;
  text: string;
  html?: string;
  tags?: string[];
}

export function isMailpitConfigured(): boolean {
  return Boolean(sendUrl);
}

export async function sendMailpitMessage(
  message: MailpitMessage
): Promise<boolean> {
  if (!sendUrl) {
    return false;
  }

  const recipients = message.to
    .map((email) => email.trim())
    .filter(Boolean)
    .map((email) => ({ Email: email }));

  if (!recipients.length) {
    return false;
  }

  const payload = {
    From: { Email: defaultFromEmail, Name: defaultFromName },
    To: recipients,
    Subject: message.subject,
    Text: message.text,
    HTML: message.html,
    Tags: message.tags,
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (sendUsername || sendPassword) {
    const token = Buffer.from(`${sendUsername}:${sendPassword}`).toString(
      "base64"
    );
    headers.Authorization = `Basic ${token}`;
  }

  try {
    const response = await fetch(sendUrl, {
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
