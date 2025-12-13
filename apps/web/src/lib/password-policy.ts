export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

function normalizeForComparison(value: string) {
  return value.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

export function getPasswordLengthError(password: string): string | undefined {
  if (!password) return "Password is required";
  if (password.length < PASSWORD_MIN_LENGTH)
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  if (password.length > PASSWORD_MAX_LENGTH)
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters`;
  return undefined;
}

export function getPasswordSimilarityError(
  password: string,
  opts: {
    email?: string | null;
    documentNumber?: string | null;
  },
): string | undefined {
  if (!password) return undefined;

  const normalizedPassword = normalizeForComparison(password);

  const emailLocalPart = opts.email?.split("@")[0];
  const normalizedEmail = emailLocalPart
    ? normalizeForComparison(emailLocalPart)
    : "";
  if (
    normalizedEmail.length >= 3 &&
    normalizedPassword.includes(normalizedEmail)
  )
    return "Password can't contain your email";

  const normalizedDocNumber = opts.documentNumber
    ? normalizeForComparison(opts.documentNumber)
    : "";
  if (
    normalizedDocNumber.length >= 4 &&
    normalizedPassword.includes(normalizedDocNumber)
  )
    return "Password can't contain your document number";

  return undefined;
}

export function getPasswordRequirementStatus(
  password: string,
  opts: {
    email?: string | null;
    documentNumber?: string | null;
  },
) {
  const lengthOk =
    password.length >= PASSWORD_MIN_LENGTH &&
    password.length <= PASSWORD_MAX_LENGTH;

  const normalizedPassword = normalizeForComparison(password);

  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSymbol = /[^A-Za-z0-9]/.test(password);

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
