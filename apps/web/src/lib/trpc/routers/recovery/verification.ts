import crypto from "node:crypto";

import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";
import { symmetricDecrypt } from "better-auth/crypto";

import { getTwoFactorByUserId } from "@/lib/db/queries/two-factor";
import { getBetterAuthSecret } from "@/lib/utils/env";

const RECOVERY_ID_PREFIX = "rec_";
const TOTP_DIGITS = 6;
const TOTP_PERIOD = 30;
const OTP_CODE_RE = /^\d{6}$/;

export function isExpired(value: string): boolean {
  const date = new Date(value);
  return !Number.isNaN(date.valueOf()) && date < new Date();
}

export function buildRecoveryMessage(params: {
  challengeId: string;
  challengeNonce: string;
}): string {
  return `recovery:${params.challengeId}:${params.challengeNonce}`;
}

function normalizeOtpCode(code: string): string {
  return code.replaceAll(/\s+/g, "");
}

export function normalizeRecoveryId(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeBackupCode(code: string): string {
  return code.replaceAll(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

export function generateRecoveryId(): string {
  const bytes = crypto.randomBytes(12);
  const encoded = base32.encode(bytes, { padding: false }).toLowerCase();
  return `${RECOVERY_ID_PREFIX}${encoded}`;
}

export async function verifyTwoFactorGuardianCode(params: {
  userId: string;
  code: string;
}): Promise<{ method: "backup" | "totp"; updatedCodes?: string[] } | null> {
  const twoFactor = await getTwoFactorByUserId(params.userId);
  if (!twoFactor) {
    return null;
  }

  const normalized = normalizeBackupCode(params.code);
  if (!normalized) {
    return null;
  }

  const decryptedSecret = await symmetricDecrypt({
    key: getBetterAuthSecret(),
    data: twoFactor.secret,
  });
  const otp = createOTP(decryptedSecret, {
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD,
  });
  const code = normalizeOtpCode(params.code);
  if (code && OTP_CODE_RE.test(code)) {
    const valid = await otp.verify(code);
    if (valid) {
      return { method: "totp" };
    }
  }

  const decryptedBackup = await symmetricDecrypt({
    key: getBetterAuthSecret(),
    data: twoFactor.backupCodes,
  });
  let backupCodes: string[] = [];
  try {
    const parsed = JSON.parse(decryptedBackup);
    if (Array.isArray(parsed)) {
      backupCodes = parsed;
    }
  } catch {
    return null;
  }

  const matchIndex = backupCodes.findIndex(
    (entry) => normalizeBackupCode(entry) === normalized
  );
  if (matchIndex === -1) {
    return null;
  }

  const updatedCodes = backupCodes.filter((_, index) => index !== matchIndex);
  return { method: "backup", updatedCodes };
}
