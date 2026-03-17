import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { JWK } from "jose";

const CREDENTIALS_DIR = join(homedir(), ".zentity");
const CREDENTIALS_FILE = join(CREDENTIALS_DIR, "credentials.json");

export interface StoredCredentials {
  accessToken?: string;
  authSession?: string;
  clientId: string;
  clientSecret?: string;
  dpopJwk?: JWK;
  dpopPublicJwk?: JWK;
  expiresAt?: number;
  loginHint?: string;
  refreshToken?: string;
  zentityUrl: string;
}

function ensureDir(): void {
  if (!existsSync(CREDENTIALS_DIR)) {
    mkdirSync(CREDENTIALS_DIR, { mode: 0o700, recursive: true });
  }
}

export function loadCredentials(
  zentityUrl: string
): StoredCredentials | undefined {
  if (!existsSync(CREDENTIALS_FILE)) {
    return undefined;
  }
  try {
    const raw = readFileSync(CREDENTIALS_FILE, "utf-8");
    const creds = JSON.parse(raw) as StoredCredentials;
    if (creds.zentityUrl !== zentityUrl) {
      return undefined;
    }
    return creds;
  } catch {
    return undefined;
  }
}

export function saveCredentials(creds: StoredCredentials): void {
  ensureDir();
  writeFileSync(CREDENTIALS_FILE, JSON.stringify(creds, null, 2), {
    mode: 0o600,
  });
}

export function updateCredentials(
  zentityUrl: string,
  updates: Partial<Omit<StoredCredentials, "zentityUrl">>
): StoredCredentials {
  const existing = loadCredentials(zentityUrl) ?? {
    zentityUrl,
    clientId: "",
  };
  const merged = { ...existing, ...updates };
  saveCredentials(merged);
  return merged;
}

export function clearTokenCredentials(zentityUrl: string): void {
  const existing = loadCredentials(zentityUrl);
  if (!existing) {
    return;
  }
  const {
    accessToken: _,
    expiresAt: __,
    refreshToken: ___,
    ...rest
  } = existing;
  saveCredentials({ ...rest, zentityUrl, clientId: rest.clientId });
}
