import { nanoid } from "nanoid";

const REGISTRATION_TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface RegistrationBlobMeta {
  secretId: string;
  secretType: string;
  blobRef: string;
  blobHash: string;
  blobSize: number;
}

interface RegistrationEntry {
  expiresAt: number;
  blob?: RegistrationBlobMeta;
}

const registrationStore = new Map<string, RegistrationEntry>();

function cleanupExpiredTokens() {
  const now = Date.now();
  for (const [token, entry] of registrationStore) {
    if (entry.expiresAt < now) {
      registrationStore.delete(token);
    }
  }
}

if (typeof setInterval !== "undefined") {
  setInterval(cleanupExpiredTokens, 60 * 1000);
}

function getEntry(token: string): RegistrationEntry | null {
  const entry = registrationStore.get(token);
  if (!entry) {
    return null;
  }
  if (entry.expiresAt < Date.now()) {
    registrationStore.delete(token);
    return null;
  }
  return entry;
}

export function createRegistrationToken(): string {
  const token = nanoid(32);
  registrationStore.set(token, {
    expiresAt: Date.now() + REGISTRATION_TOKEN_TTL_MS,
  });
  return token;
}

export function storeRegistrationBlob(
  token: string,
  blob: RegistrationBlobMeta
) {
  const entry = getEntry(token);
  if (!entry) {
    throw new Error("Invalid or expired registration token.");
  }
  if (entry.blob) {
    throw new Error("Registration blob already uploaded.");
  }
  entry.blob = blob;
}

export function isRegistrationTokenValid(token: string): boolean {
  return Boolean(getEntry(token));
}

export function consumeRegistrationBlob(token: string): RegistrationBlobMeta {
  const entry = getEntry(token);
  if (!entry?.blob) {
    throw new Error("Registration blob not found or expired.");
  }
  registrationStore.delete(token);
  return entry.blob;
}
