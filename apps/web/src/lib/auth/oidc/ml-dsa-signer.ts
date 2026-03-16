import "server-only";

import { eq } from "drizzle-orm";

import {
  decryptPrivateKey,
  encryptPrivateKey,
} from "@/lib/auth/oidc/key-vault";
import { db } from "@/lib/db/connection";
import { jwks } from "@/lib/db/schema/jwks";
import {
  mlDsaKeygen,
  mlDsaSign,
  mlDsaVerify,
} from "@/lib/privacy/primitives/ml-dsa";
import { bytesToBase64 } from "@/lib/utils/base64";
import { base64UrlToBytes, bytesToBase64Url } from "@/lib/utils/base64url";

const ML_DSA_ALG = "ML-DSA-65" as const;

interface MlDsaSigningKey {
  kid: string;
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

let cachedSigningKey: MlDsaSigningKey | null = null;

async function getOrCreateMlDsaSigningKey(): Promise<MlDsaSigningKey> {
  if (cachedSigningKey) {
    return cachedSigningKey;
  }

  const existing = await db
    .select()
    .from(jwks)
    .where(eq(jwks.alg, ML_DSA_ALG))
    .limit(1)
    .get();

  if (existing) {
    const privateKeyData = JSON.parse(
      decryptPrivateKey(existing.privateKey)
    ) as { raw: string };
    const publicKeyData = JSON.parse(existing.publicKey) as { pub: string };

    cachedSigningKey = {
      kid: existing.id,
      secretKey: Buffer.from(privateKeyData.raw, "base64"),
      publicKey: Buffer.from(publicKeyData.pub, "base64"),
    };
    return cachedSigningKey;
  }

  const { publicKey, secretKey } = mlDsaKeygen();
  const kid = crypto.randomUUID();

  const publicKeyJson = JSON.stringify({
    kty: "AKP",
    alg: ML_DSA_ALG,
    pub: bytesToBase64(publicKey),
  });
  const privateKeyJson = JSON.stringify({
    raw: bytesToBase64(secretKey),
  });

  await db
    .insert(jwks)
    .values({
      id: kid,
      publicKey: publicKeyJson,
      privateKey: encryptPrivateKey(privateKeyJson),
      alg: ML_DSA_ALG,
      crv: null,
    })
    .run();

  cachedSigningKey = { kid, secretKey, publicKey };
  return cachedSigningKey;
}

function encodeJwtPart(data: Record<string, unknown>): string {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(data)));
}

export async function signJwtWithMlDsa(
  payload: Record<string, unknown>
): Promise<string> {
  const { kid, secretKey } = await getOrCreateMlDsaSigningKey();

  const header = { alg: ML_DSA_ALG, typ: "JWT", kid };
  const encodedHeader = encodeJwtPart(header);
  const encodedPayload = encodeJwtPart(payload);

  const signingInput = new TextEncoder().encode(
    `${encodedHeader}.${encodedPayload}`
  );
  const signature = mlDsaSign(signingInput, secretKey);

  return `${encodedHeader}.${encodedPayload}.${bytesToBase64Url(signature)}`;
}

/**
 * Verify a JWT signed with ML-DSA-65.
 * Used in tests and by verification endpoints.
 */
export function verifyMlDsaJwt(
  jwt: string,
  publicKey: Uint8Array
): {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
} | null {
  const parts = jwt.split(".");
  if (parts.length !== 3) {
    return null;
  }

  const encodedHeader = parts[0];
  const encodedPayload = parts[1];
  const encodedSignature = parts[2];
  if (!(encodedHeader && encodedPayload && encodedSignature)) {
    return null;
  }

  const signingInput = new TextEncoder().encode(
    `${encodedHeader}.${encodedPayload}`
  );

  const signature = base64UrlToBytes(encodedSignature);

  if (!mlDsaVerify(signature, signingInput, publicKey)) {
    return null;
  }

  const decoder = new TextDecoder();
  const header = JSON.parse(decoder.decode(base64UrlToBytes(encodedHeader)));
  const payload = JSON.parse(decoder.decode(base64UrlToBytes(encodedPayload)));

  return { header, payload };
}
