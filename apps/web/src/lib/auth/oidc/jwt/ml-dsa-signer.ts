import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db/connection";
import { jwks } from "@/lib/db/schema/jwks";
import { mlDsaKeygen, mlDsaSign } from "@/lib/privacy/primitives/ml-dsa";
import { bytesToBase64, bytesToBase64Url } from "@/lib/utils/base64";

import { decryptPrivateKey, encryptPrivateKey } from "./key-vault";

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
