import { bytesToHex } from "@/lib/privacy/primitives/symmetric";

// ── Policy constants and validation ──────────────────────

export const PASSWORD_MIN_LENGTH = 10;
const PASSWORD_MAX_LENGTH = 128;

const NON_ALPHANUMERIC_PATTERN = /[^a-z0-9]/g;
const LOWERCASE_LETTER_PATTERN = /[a-z]/;
const UPPERCASE_LETTER_PATTERN = /[A-Z]/;
const DIGIT_PATTERN = /\d/;
const SYMBOL_PATTERN = /[^A-Za-z0-9]/;

function normalizeForComparison(value: string) {
  return value.toLowerCase().replaceAll(NON_ALPHANUMERIC_PATTERN, "");
}

export function getPasswordLengthError(password: string): string | undefined {
  if (!password) {
    return "Password is required";
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters`;
  }
  return undefined;
}

export function getPasswordRequirementStatus(
  password: string,
  opts: {
    email?: string | null | undefined;
    documentNumber?: string | null | undefined;
  }
) {
  const lengthOk =
    password.length >= PASSWORD_MIN_LENGTH &&
    password.length <= PASSWORD_MAX_LENGTH;

  const normalizedPassword = normalizeForComparison(password);

  const hasLower = LOWERCASE_LETTER_PATTERN.test(password);
  const hasUpper = UPPERCASE_LETTER_PATTERN.test(password);
  const hasNumber = DIGIT_PATTERN.test(password);
  const hasSymbol = SYMBOL_PATTERN.test(password);

  const emailLocalPart = opts.email?.split("@")[0];
  const normalizedEmail = emailLocalPart
    ? normalizeForComparison(emailLocalPart)
    : "";
  const noEmail =
    normalizedEmail.length < 3 || !normalizedPassword.includes(normalizedEmail);

  const normalizedDocNumber = opts.documentNumber
    ? normalizeForComparison(opts.documentNumber)
    : "";
  const noDocNumber =
    normalizedDocNumber.length < 4 ||
    !normalizedPassword.includes(normalizedDocNumber);

  return {
    lengthOk,
    noEmail,
    noDocNumber,
    hasLower,
    hasUpper,
    hasNumber,
    hasSymbol,
  };
}

// ── Breach check (HIBP k-anonymity) ─────────────────────

interface PasswordPwnedResult {
  compromised: boolean;
  skipped: boolean;
}

async function sha1HexUpper(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  // Not for password storage: OPAQUE handles that.
  // @see https://haveibeenpwned.com/API/v3#SearchingPwnedPasswordsByRange
  const digest = await crypto.subtle.digest("SHA-1", data);
  return bytesToHex(new Uint8Array(digest)).toUpperCase();
}

const HIBP_PREFIX_LENGTH = 5;

/**
 * Client-side breach check against the HIBP range API, relayed by
 * /api/password/pwned. Only the 5-character SHA-1 prefix leaves the browser;
 * the suffix is matched locally against the returned `SUFFIX:COUNT` lines.
 * UX-only pre-submit feedback; OPAQUE means the server never sees the password.
 */
export async function checkPasswordPwned(
  password: string,
  opts?: { signal?: AbortSignal }
): Promise<PasswordPwnedResult> {
  const sha1 = await sha1HexUpper(password);
  const prefix = sha1.slice(0, HIBP_PREFIX_LENGTH);
  const suffix = sha1.slice(HIBP_PREFIX_LENGTH);

  const res = await fetch(`/api/password/pwned?prefix=${prefix}`, {
    credentials: "omit",
    ...(opts?.signal === undefined ? {} : { signal: opts.signal }),
  });
  if (!res.ok) {
    return { compromised: false, skipped: true };
  }

  const body = await res.text().catch(() => null);
  if (body === null) {
    return { compromised: false, skipped: true };
  }

  // Padded entries carry a count of 0 and never represent a real breach.
  const compromised = body.split("\n").some((line) => {
    const [lineSuffix, count] = line.trim().split(":");
    return lineSuffix?.toUpperCase() === suffix && Number(count) > 0;
  });
  return { compromised, skipped: false };
}
