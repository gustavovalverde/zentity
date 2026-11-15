import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { HostKeyMaterial } from "@zentity/sdk";
import { normalizeUrl } from "@zentity/sdk/node";
import { exportJWK, generateKeyPair } from "jose";

function getHostKeyDir(): string {
  const configuredDir = process.env.ZENTITY_MCP_HOST_KEY_DIR?.trim();
  if (configuredDir) {
    return configuredDir;
  }
  return join(homedir(), ".zentity", "hosts");
}

function ensureHostKeyDir(): void {
  mkdirSync(getHostKeyDir(), { mode: 0o700, recursive: true });
}

function getHostKeyFile(zentityUrl: string, namespace: string): string {
  const hashedNamespace = createHash("sha256")
    .update(`${normalizeUrl(zentityUrl)}:${namespace}`)
    .digest("hex");
  return join(getHostKeyDir(), `${hashedNamespace}.json`);
}

function readHostKeyFile(hostKeyFile: string): HostKeyMaterial | undefined {
  if (!existsSync(hostKeyFile)) {
    return undefined;
  }

  try {
    return JSON.parse(readFileSync(hostKeyFile, "utf-8")) as HostKeyMaterial;
  } catch {
    return undefined;
  }
}

export function loadHostKey(
  zentityUrl: string,
  namespace: string
): HostKeyMaterial | undefined {
  return readHostKeyFile(getHostKeyFile(zentityUrl, namespace));
}

export function saveHostKey(
  zentityUrl: string,
  namespace: string,
  data: HostKeyMaterial
): void {
  ensureHostKeyDir();
  writeFileSync(
    getHostKeyFile(zentityUrl, namespace),
    JSON.stringify(data, null, 2),
    {
      mode: 0o600,
    }
  );
}

export function clearHostId(zentityUrl: string, namespace: string): void {
  const existing = loadHostKey(zentityUrl, namespace);
  if (!existing?.hostId) {
    return;
  }

  saveHostKey(zentityUrl, namespace, {
    ...(existing.did ? { did: existing.did } : {}),
    privateKey: existing.privateKey,
    publicKey: existing.publicKey,
  });
}

export async function getOrCreateHostKey(
  zentityUrl: string,
  namespace: string
): Promise<HostKeyMaterial> {
  const existing = loadHostKey(zentityUrl, namespace);
  if (existing) {
    return existing;
  }

  const { privateKey, publicKey } = await generateKeyPair("EdDSA", {
    crv: "Ed25519",
    extractable: true,
  });

  const privateJwk = await exportJWK(privateKey);
  const publicJwk = await exportJWK(publicKey);

  const data: HostKeyMaterial = { privateKey: privateJwk, publicKey: publicJwk };
  saveHostKey(zentityUrl, namespace, data);
  console.error(
    `[host-key] Generated and persisted new Ed25519 host keypair for ${namespace}`
  );

  return data;
}
