/**
 * Email utilities for Zentity
 *
 * Handles sending emails for authentication (magic link, password reset).
 * In development, emails are logged to console.
 * In production, configure SMTP settings in environment variables.
 */

interface SendMagicLinkOptions {
  email: string;
  url: string;
  token: string;
}

interface SendPasswordResetOptions {
  email: string;
  url: string;
}

/**
 * Send magic link authentication email
 *
 * Development/No SMTP: Logs to console with clickable link
 * Production with SMTP: Sends via configured SMTP server
 */
export async function sendMagicLinkEmail({
  email,
  url,
}: SendMagicLinkOptions): Promise<void> {
  // Production: Send via email service if SMTP is configured
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = process.env.SMTP_PORT;
  const smtpUser = process.env.SMTP_USER;
  const smtpPassword = process.env.SMTP_PASSWORD;
  const emailFrom = process.env.EMAIL_FROM || "noreply@zentity.com";

  const smtpConfigured = smtpHost && smtpPort && smtpUser && smtpPassword;

  if (!smtpConfigured) {
    // No SMTP configured - log to console (works in dev and Docker without SMTP)
    console.log("\n" + "=".repeat(60));
    console.log("📧 MAGIC LINK EMAIL");
    console.log("=".repeat(60));
    console.log(`To: ${email}`);
    console.log(`Subject: Sign in to Zentity`);
    console.log("");
    console.log(`🔗 Click to sign in:`);
    console.log(url);
    console.log("=".repeat(60) + "\n");
    return;
  }

  // TODO: Implement actual email sending with nodemailer or similar
  // For now, log a warning that email would be sent
  console.log(`[EMAIL] Would send magic link to ${email} from ${emailFrom}`);
  console.log(`[EMAIL] SMTP: ${smtpHost}:${smtpPort}`);
  console.log(`[EMAIL] URL: ${url}`);
}

/**
 * Generate HTML email template for magic link
 */
export function getMagicLinkEmailHtml(url: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sign in to Zentity</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="text-align: center; margin-bottom: 30px;">
    <h1 style="color: #0f172a; font-size: 24px; margin: 0;">Zentity</h1>
    <p style="color: #64748b; font-size: 14px; margin-top: 5px;">Privacy-Preserving Identity Verification</p>
  </div>

  <div style="background: #f8fafc; border-radius: 12px; padding: 30px; text-align: center;">
    <h2 style="color: #0f172a; font-size: 20px; margin: 0 0 15px;">Sign in to your account</h2>
    <p style="color: #64748b; margin: 0 0 25px;">Click the button below to sign in. This link expires in 5 minutes.</p>

    <a href="${url}" style="display: inline-block; background: #0f172a; color: white; text-decoration: none; padding: 12px 30px; border-radius: 8px; font-weight: 500;">
      Sign In
    </a>

    <p style="color: #94a3b8; font-size: 12px; margin-top: 25px;">
      If you didn't request this email, you can safely ignore it.
    </p>
  </div>

  <div style="text-align: center; margin-top: 30px; color: #94a3b8; font-size: 12px;">
    <p>This is an automated message from Zentity.</p>
  </div>
</body>
</html>
  `.trim();
}

/**
 * Send password reset email
 *
 * Development/No SMTP: Logs to console with clickable link
 * Production with SMTP: Sends via configured SMTP server
 */
export async function sendPasswordResetEmail({
  email,
  url,
}: SendPasswordResetOptions): Promise<void> {
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = process.env.SMTP_PORT;
  const smtpUser = process.env.SMTP_USER;
  const smtpPassword = process.env.SMTP_PASSWORD;
  const emailFrom = process.env.EMAIL_FROM || "noreply@zentity.com";

  const smtpConfigured = smtpHost && smtpPort && smtpUser && smtpPassword;

  if (!smtpConfigured) {
    // No SMTP configured - log to console (works in dev and Docker without SMTP)
    console.log("\n" + "=".repeat(60));
    console.log("🔑 PASSWORD RESET EMAIL");
    console.log("=".repeat(60));
    console.log(`To: ${email}`);
    console.log(`Subject: Reset your Zentity password`);
    console.log("");
    console.log(`🔗 Click to reset password:`);
    console.log(url);
    console.log("=".repeat(60) + "\n");
    return;
  }

  // TODO: Implement actual email sending with nodemailer or similar
  console.log(`[EMAIL] Would send password reset to ${email} from ${emailFrom}`);
  console.log(`[EMAIL] URL: ${url}`);
}

/**
 * Generate HTML email template for password reset
 */
export function getPasswordResetEmailHtml(url: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset your Zentity password</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="text-align: center; margin-bottom: 30px;">
    <h1 style="color: #0f172a; font-size: 24px; margin: 0;">Zentity</h1>
    <p style="color: #64748b; font-size: 14px; margin-top: 5px;">Privacy-Preserving Identity Verification</p>
  </div>

  <div style="background: #f8fafc; border-radius: 12px; padding: 30px; text-align: center;">
    <h2 style="color: #0f172a; font-size: 20px; margin: 0 0 15px;">Reset your password</h2>
    <p style="color: #64748b; margin: 0 0 25px;">Click the button below to reset your password. This link expires in 1 hour.</p>

    <a href="${url}" style="display: inline-block; background: #0f172a; color: white; text-decoration: none; padding: 12px 30px; border-radius: 8px; font-weight: 500;">
      Reset Password
    </a>

    <p style="color: #94a3b8; font-size: 12px; margin-top: 25px;">
      If you didn't request this password reset, you can safely ignore this email.
    </p>
  </div>

  <div style="text-align: center; margin-top: 30px; color: #94a3b8; font-size: 12px;">
    <p>This is an automated message from Zentity.</p>
  </div>
</body>
</html>
  `.trim();
}
