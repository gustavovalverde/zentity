import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { exportJWK, generateKeyPair, type JWK } from "jose";

export interface HostKeyData {
  did?: string;
  hostId?: string;
  privateKey: JWK;
  publicKey: JWK;
}

function getHostKeyDir(): string {
  return join(homedir(), ".zentity", "hosts");
}

function ensureHostKeyDir(): void {
  const hostKeyDir = getHostKeyDir();
  if (!existsSync(hostKeyDir)) {
    mkdirSync(hostKeyDir, { mode: 0o700, recursive: true });
  }
}

const TRAILING_SLASHES = /\/+$/;
function normalizeZentityUrl(zentityUrl: string): string {
  return zentityUrl.replace(TRAILING_SLASHES, "");
}

function getHostKeyFile(zentityUrl: string, namespace: string): string {
  const hashedNamespace = createHash("sha256")
    .update(`${normalizeZentityUrl(zentityUrl)}:${namespace}`)
    .digest("hex");
  return join(getHostKeyDir(), `${hashedNamespace}.json`);
}

function readHostKeyFile(hostKeyFile: string): HostKeyData | undefined {
  if (!existsSync(hostKeyFile)) {
    return undefined;
  }

  try {
    return JSON.parse(readFileSync(hostKeyFile, "utf-8")) as HostKeyData;
  } catch {
    return undefined;
  }
}

export function loadHostKey(
  zentityUrl: string,
  clientId: string
): HostKeyData | undefined {
  return readHostKeyFile(getHostKeyFile(zentityUrl, clientId));
}

export function saveHostKey(
  zentityUrl: string,
  clientId: string,
  data: HostKeyData
): void {
  ensureHostKeyDir();
  writeFileSync(
    getHostKeyFile(zentityUrl, clientId),
    JSON.stringify(data, null, 2),
    {
      mode: 0o600,
    }
  );
}

export function clearHostId(zentityUrl: string, clientId: string): void {
  const existing = loadHostKey(zentityUrl, clientId);
  if (!existing?.hostId) {
    return;
  }

  saveHostKey(zentityUrl, clientId, {
    ...(existing.did ? { did: existing.did } : {}),
    privateKey: existing.privateKey,
    publicKey: existing.publicKey,
  });
}

export async function getOrCreateHostKey(
  zentityUrl: string,
  clientId: string
): Promise<HostKeyData> {
  const existing = loadHostKey(zentityUrl, clientId);
  if (existing) {
    return existing;
  }

  const { privateKey, publicKey } = await generateKeyPair("EdDSA", {
    crv: "Ed25519",
    extractable: true,
  });

  const privateJwk = await exportJWK(privateKey);
  const publicJwk = await exportJWK(publicKey);

  const data: HostKeyData = { privateKey: privateJwk, publicKey: publicJwk };
  saveHostKey(zentityUrl, clientId, data);
  console.error(
    `[host-key] Generated and persisted new Ed25519 host keypair for ${clientId}`
  );

  return data;
}
