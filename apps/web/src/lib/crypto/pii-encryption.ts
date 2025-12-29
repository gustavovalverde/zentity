import { EncryptJWT, jwtDecrypt } from "jose";

import { getBetterAuthSecret } from "@/lib/utils/env";

/**
 * Get encryption secret from environment
 * Uses the same secret as Better Auth for consistency.
 *
 * AES-256-GCM requires exactly 256 bits (32 bytes).
 * We derive a fixed-length key from the secret using SHA-256.
 */
async function getEncryptionSecret(): Promise<Uint8Array> {
  const secret = getBetterAuthSecret();

  const encoder = new TextEncoder();
  const data = encoder.encode(secret);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(hashBuffer);
}

/**
 * Encrypt first name using JWE (AES-256-GCM)
 */
export async function encryptFirstName(firstName: string): Promise<string> {
  const secret = await getEncryptionSecret();

  const token = await new EncryptJWT({ firstName })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .encrypt(secret);

  return token;
}

/**
 * Decrypt first name from JWE token
 */
export async function decryptFirstName(
  encryptedToken: string,
): Promise<string | null> {
  try {
    const secret = await getEncryptionSecret();
    const { payload } = await jwtDecrypt(encryptedToken, secret);
    return (payload.firstName as string) || null;
  } catch {
    return null;
  }
}

/**
 * Encrypt user salt using JWE (AES-256-GCM)
 */
export async function encryptUserSalt(userSalt: string): Promise<string> {
  const secret = await getEncryptionSecret();

  const token = await new EncryptJWT({ userSalt })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .encrypt(secret);

  return token;
}

/**
 * Decrypt user salt from JWE token
 */
export async function decryptUserSalt(
  encryptedToken: string,
): Promise<string | null> {
  try {
    const secret = await getEncryptionSecret();
    const { payload } = await jwtDecrypt(encryptedToken, secret);
    return (payload.userSalt as string) || null;
  } catch {
    return null;
  }
}
