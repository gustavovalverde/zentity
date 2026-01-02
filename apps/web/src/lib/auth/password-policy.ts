export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

/** Matches non-alphanumeric characters for normalization */
const NON_ALPHANUMERIC_PATTERN = /[^a-z0-9]/g;
/** Matches lowercase letters */
const LOWERCASE_LETTER_PATTERN = /[a-z]/;
/** Matches uppercase letters */
const UPPERCASE_LETTER_PATTERN = /[A-Z]/;
/** Matches digits */
const DIGIT_PATTERN = /[0-9]/;
/** Matches non-alphanumeric (symbol) characters */
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
  return;
}

export function getPasswordSimilarityError(
  password: string,
  opts: {
    email?: string | null;
    documentNumber?: string | null;
  }
): string | undefined {
  if (!password) {
    return;
  }

  const normalizedPassword = normalizeForComparison(password);

  const emailLocalPart = opts.email?.split("@")[0];
  const normalizedEmail = emailLocalPart
    ? normalizeForComparison(emailLocalPart)
    : "";
  if (
    normalizedEmail.length >= 3 &&
    normalizedPassword.includes(normalizedEmail)
  ) {
    return "Password can't contain your email";
  }

  const normalizedDocNumber = opts.documentNumber
    ? normalizeForComparison(opts.documentNumber)
    : "";
  if (
    normalizedDocNumber.length >= 4 &&
    normalizedPassword.includes(normalizedDocNumber)
  ) {
    return "Password can't contain your document number";
  }

  return;
}

export function getPasswordRequirementStatus(
  password: string,
  opts: {
    email?: string | null;
    documentNumber?: string | null;
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
