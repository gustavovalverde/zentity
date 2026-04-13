import { getFlowId } from "@/lib/observability/flow-id";

// ── Policy constants and validation ──────────────────────

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

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
  const bytes = new Uint8Array(digest);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

/**
 * Client-side breach check via /api/password/pwned.
 * UX-only pre-submit feedback; OPAQUE means server never sees raw password.
 */
export async function checkPasswordPwned(
  password: string,
  opts?: { signal?: AbortSignal }
): Promise<PasswordPwnedResult> {
  const sha1 = await sha1HexUpper(password);
  const flowId = getFlowId();
  const res = await fetch("/api/password/pwned", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(flowId ? { "X-Zentity-Flow-Id": flowId } : {}),
    },
    credentials: "include",
    ...(opts?.signal === undefined ? {} : { signal: opts.signal }),
    body: JSON.stringify({ sha1 }),
  });

  const data = (await res
    .json()
    .catch(() => null)) as PasswordPwnedResult | null;
  if (!(res.ok && data)) {
    return { compromised: false, skipped: true };
  }
  return data;
}
