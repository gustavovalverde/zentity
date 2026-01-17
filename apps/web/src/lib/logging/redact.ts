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
  output = redactEmails(output);
  output = output.replaceAll(LONG_HEX_PATTERN, "[redacted-hex]");
  output = output.replaceAll(LONG_DIGIT_PATTERN, "[redacted-number]");

  if (output.length > 500) {
    output = `${output.slice(0, 200)}…[truncated:${output.length}]`;
  }

  return output;
}

function redactEmails(message: string): string {
  let result = "";
  let index = 0;

  while (index < message.length) {
    const atIndex = message.indexOf("@", index);
    if (atIndex === -1) {
      result += message.slice(index);
      break;
    }

    let start = atIndex - 1;
    while (start >= 0 && isLocalEmailChar(message[start])) {
      start -= 1;
    }
    start += 1;

    let end = atIndex + 1;
    while (end < message.length && isDomainEmailChar(message[end])) {
      end += 1;
    }

    const candidate = message.slice(start, end);
    if (looksLikeEmail(candidate)) {
      result += message.slice(index, start);
      result += "[redacted-email]";
      index = end;
      continue;
    }

    result += message.slice(index, atIndex + 1);
    index = atIndex + 1;
  }

  return result;
}

function looksLikeEmail(candidate: string): boolean {
  const atIndex = candidate.indexOf("@");
  if (atIndex <= 0 || atIndex !== candidate.lastIndexOf("@")) {
    return false;
  }

  const local = candidate.slice(0, atIndex);
  const domain = candidate.slice(atIndex + 1);
  if (local.length === 0 || domain.length < 3) {
    return false;
  }
  if (domain.startsWith(".") || domain.endsWith(".")) {
    return false;
  }
  if (!domain.includes(".")) {
    return false;
  }
  if (domain.includes("..")) {
    return false;
  }

  return true;
}

function isLocalEmailChar(char: string): boolean {
  if (!char) {
    return false;
  }
  if (isAlphaNumeric(char)) {
    return true;
  }
  return (
    char === "." || char === "_" || char === "%" || char === "+" || char === "-"
  );
}

function isDomainEmailChar(char: string): boolean {
  if (!char) {
    return false;
  }
  if (isAlphaNumeric(char)) {
    return true;
  }
  return char === "." || char === "-";
}

function isAlphaNumeric(char: string): boolean {
  const code = char.codePointAt(0) ?? -1;
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122)
  );
}

/**
 * Deep sanitizes an object for logging, handling edge cases that
 * Pino's built-in redact might miss (dynamic keys, deep nesting).
 *
 * Use this for logging arbitrary input objects when needed.
 */
export function sanitizeForLog(
  value: unknown,
  depth = 0,
  seen?: WeakSet<object>
): unknown {
  if (depth > 4) {
    return "[max-depth]";
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeLogMessage(value.message),
    };
  }

  if (typeof value === "string") {
    if (value.startsWith("data:image/")) {
      return `[base64-image:${value.length}]`;
    }
    if (value.length > 500) {
      return `[string:${value.length}]`;
    }
    return sanitizeLogMessage(value);
  }

  if (Array.isArray(value)) {
    if (value.length > 20) {
      return `[array:${value.length}]`;
    }
    return value.map((v) => sanitizeForLog(v, depth + 1, seen));
  }

  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const set = seen ?? new WeakSet<object>();
    if (set.has(obj)) {
      return "[circular]";
    }
    set.add(obj);

    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      out[key] = REDACT_KEYS.has(key)
        ? "[REDACTED]"
        : sanitizeForLog(val, depth + 1, set);
    }
    return out;
  }

  return value;
}

function safeJsonSize(value: unknown): number | undefined {
  try {
    return JSON.stringify(value).length;
  } catch {
    return;
  }
}

/**
 * Extract safe metadata from input for logging.
 * Returns only keys that are safe to log + basic shape info.
 * Never logs actual values - only metadata about the input.
 */
export function extractInputMeta(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") {
    return { inputType: typeof input };
  }

  const keys = Object.keys(input as Record<string, unknown>);
  const safeKeys = keys.filter((k) => !REDACT_KEYS.has(k));
  const sanitized = sanitizeForLog(input);

  return {
    inputKeys: safeKeys.length > 0 ? safeKeys : undefined,
    inputSize: safeJsonSize(sanitized),
    hasImage: keys.some((k) => k.toLowerCase().includes("image")),
  };
}
