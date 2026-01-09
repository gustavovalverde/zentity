import "server-only";

import { Resend } from "resend";

import { logWarn } from "@/lib/logging/error-logger";

const resendApiKey = process.env.RESEND_API_KEY?.trim() || "";
const defaultFromEmail =
  process.env.MAIL_FROM_EMAIL || "no-reply@zentity.local";
const defaultFromName = process.env.MAIL_FROM_NAME || "Zentity";

let resendClient: Resend | null = null;

export interface ResendMessage {
  to: string[];
  subject: string;
  text: string;
  html?: string;
  tags?: string[];
}

function getResendClient(): Resend {
  if (!resendApiKey) {
    throw new Error("RESEND_API_KEY is not configured.");
  }
  if (!resendClient) {
    resendClient = new Resend(resendApiKey);
  }
  return resendClient;
}

export function isResendConfigured(): boolean {
  return Boolean(resendApiKey);
}

function formatFromAddress(): string {
  if (!defaultFromName) {
    return defaultFromEmail;
  }
  return `${defaultFromName} <${defaultFromEmail}>`;
}

export async function sendResendMessage(
  message: ResendMessage
): Promise<boolean> {
  if (!resendApiKey) {
    return false;
  }

  const recipients = message.to.map((email) => email.trim()).filter(Boolean);
  if (!recipients.length) {
    return false;
  }

  const tags = message.tags?.length
    ? message.tags.map((tag) => ({ name: tag, value: "true" }))
    : undefined;

  try {
    const resend = getResendClient();
    const { error } = await resend.emails.send({
      from: formatFromAddress(),
      to: recipients,
      subject: message.subject,
      text: message.text,
      html: message.html,
      tags,
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
