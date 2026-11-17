import { SdJwtInstance } from "@sd-jwt/core";

import { readDisclosedClaims, sha256Hasher } from "@/lib/sd-jwt";

const STORAGE_KEY = "veripass:credential";

export interface StoredCredential {
  createdAt: number;
  credential: string;
  holderPrivateJwk: JsonWebKey;
  holderPublicJwk: JsonWebKey;
  issuer: string;
}

const sdjwt = new SdJwtInstance({ hasher: sha256Hasher });

export function saveCredential(stored: StoredCredential): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
}

export function loadCredential(): StoredCredential | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as StoredCredential;
  } catch {
    return null;
  }
}

export function clearCredential(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export async function decodeClaims(
  credential: string
): Promise<Record<string, unknown>> {
  return (await sdjwt.getClaims(credential)) as Record<string, unknown>;
}

export function getPresentableKeys(credential: string): Promise<string[]> {
  return sdjwt.presentableKeys(credential);
}

export function createPresentation(
  credential: string,
  selectedKeys: string[]
): Promise<string> {
  return (async () => {
    const presentableKeys = new Set(await sdjwt.presentableKeys(credential));
    const frame: Record<string, boolean> = {};

    for (const key of selectedKeys) {
      if (presentableKeys.has(key)) {
        frame[key] = true;
      }
    }

    return sdjwt.present(credential, frame);
  })();
}

export function getDisclosedClaims(
  presentation: string
): Promise<Record<string, unknown>> {
  return readDisclosedClaims(sdjwt, presentation);
}
