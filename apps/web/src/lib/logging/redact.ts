/**
 * PII Redaction Utilities
 *
 * Canonical list of sensitive field names that must be redacted from logs.
 * Used by both Pino's built-in redaction and manual sanitization.
 */
import "server-only";

/**
 * Keys that should always be redacted from logs.
 * This is the canonical list - referenced in logger.ts for Pino redaction paths.
 */
export const REDACT_KEYS = new Set([
  // Images and biometrics
  "image",
  "documentImage",
  "selfieImage",
  "baselineImage",
  "frameData",
  "idImage",
  "faceData",
  "faceDescriptor",
  "embedding",

  // PII fields
  "birthDate",
  "dateOfBirth",
  "dob",
  "nationality",
  "nationalityCode",
  "documentNumber",
  "firstName",
  "lastName",
  "fullName",

  // Credentials and keys
  "password",
  "secret",
  "token",
  "privateKey",
  "clientKey",
  "serverKey",
  "publicKey",
  "fhePublicKey",
  "ciphertext",
  "userSalt",
]);

// The lookbehind lets a match start only where a run of local-part characters
// begins, which keeps matching linear on long untrusted input with no "@".
const EMAIL_PATTERN =
  /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const LONG_HEX_PATTERN = /\b0x[a-fA-F0-9]{16,}\b/g;
const LONG_DIGIT_PATTERN = /\b\d{6,}\b/g;

/**
 * Sanitize free-form log messages to reduce accidental PII leakage.
 * Keeps messages readable while redacting common sensitive patterns.
 */
export function sanitizeLogMessage(message: string): string {
  if (!message) {
    return message;
  }

  if (message.includes("data:image/")) {
    return "[base64-image]";
  }

  let output = message;
  output = output.replaceAll(EMAIL_PATTERN, "[redacted-email]");
  output = output.replaceAll(LONG_HEX_PATTERN, "[redacted-hex]");
  output = output.replaceAll(LONG_DIGIT_PATTERN, "[redacted-number]");

  if (output.length > 500) {
    output = `${output.slice(0, 200)}…[truncated:${output.length}]`;
  }

  return output;
}
