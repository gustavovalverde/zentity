import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { exportJWK, generateKeyPair, type JWK } from "jose";

const ZENTITY_DIR = join(homedir(), ".zentity");
const HOST_KEY_DIR = join(ZENTITY_DIR, "hosts");

export interface HostKeyData {
  hostId?: string;
  privateKey: JWK;
  publicKey: JWK;
}

function ensureDir(): void {
  if (!existsSync(HOST_KEY_DIR)) {
    mkdirSync(HOST_KEY_DIR, { mode: 0o700, recursive: true });
  }
}

function normalizeZentityUrl(zentityUrl: string): string {
  return zentityUrl.replace(/\/+$/, "");
}

function getHostKeyFile(zentityUrl: string, namespace: string): string {
  const hashedNamespace = createHash("sha256")
    .update(`${normalizeZentityUrl(zentityUrl)}:${namespace}`)
    .digest("hex");
  return join(HOST_KEY_DIR, `${hashedNamespace}.json`);
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
  ensureDir();
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
  if (!existing || !existing.hostId) {
    return;
  }

  saveHostKey(zentityUrl, clientId, {
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
