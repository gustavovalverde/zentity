import crypto from "node:crypto";

import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeEach, describe, expect, it } from "vitest";

import { verifyAuthIssuedJwt } from "@/lib/auth/jwt";
import { getAuthIssuer } from "@/lib/auth/oidc/well-known";
import { db } from "@/lib/db/connection";
import { jwks as jwksTable } from "@/lib/db/schema/oauth-provider";
import { resetDatabase } from "@/test-utils/db-test-utils";

const authIssuer = getAuthIssuer();

let testKeyPair: Awaited<ReturnType<typeof generateKeyPair>>;
let testKid: string;

async function ensureSigningKey() {
  testKeyPair = await generateKeyPair("EdDSA", {
    crv: "Ed25519",
    extractable: true,
  });
  testKid = crypto.randomUUID();
  const publicJwk = await exportJWK(testKeyPair.publicKey);
  const privateJwk = await exportJWK(testKeyPair.privateKey);
  await db
    .insert(jwksTable)
    .values({
      id: testKid,
      publicKey: JSON.stringify(publicJwk),
      privateKey: JSON.stringify(privateJwk),
      alg: "EdDSA",
      crv: "Ed25519",
    })
    .run();
}

function mintJwt(
  claims: Record<string, unknown>,
  opts?: { kid?: string; key?: CryptoKey; expiredSec?: number }
): Promise<string> {
  const builder = new SignJWT(claims).setProtectedHeader({
    alg: "EdDSA",
    typ: "JWT",
    kid: opts?.kid ?? testKid,
  });
  if (opts?.expiredSec) {
    builder
      .setIssuedAt(Math.floor(Date.now() / 1000) - opts.expiredSec * 2)
      .setExpirationTime(Math.floor(Date.now() / 1000) - opts.expiredSec);
  } else {
    builder.setIssuedAt().setExpirationTime("1h");
  }
  return builder.sign(opts?.key ?? testKeyPair.privateKey);
}

describe("auth-issued JWT verification", () => {
  const claims = { iss: authIssuer, sub: "subject", scope: "openid" };

  beforeEach(async () => {
    await resetDatabase();
    await ensureSigningKey();
  });

  it("accepts a JWT signed with a registered key", async () => {
    const payload = await verifyAuthIssuedJwt(await mintJwt(claims));
    expect(payload?.sub).toBe("subject");
  });

  it("rejects a forged JWT with valid structure but wrong key", async () => {
    const attackerKeys = await generateKeyPair("EdDSA", {
      crv: "Ed25519",
      extractable: true,
    });
    const token = await mintJwt(claims, { key: attackerKeys.privateKey });
    expect(await verifyAuthIssuedJwt(token)).toBeNull();
  });

  it("rejects a JWT signed with unknown kid", async () => {
    const attackerKeys = await generateKeyPair("EdDSA", {
      crv: "Ed25519",
      extractable: true,
    });
    const token = await mintJwt(claims, {
      kid: "nonexistent-kid",
      key: attackerKeys.privateKey,
    });
    expect(await verifyAuthIssuedJwt(token)).toBeNull();
  });

  it("rejects a JWT with wrong issuer", async () => {
    const token = await mintJwt({ ...claims, iss: "https://evil.example.com" });
    expect(await verifyAuthIssuedJwt(token)).toBeNull();
  });

  it("rejects an expired JWT", async () => {
    const token = await mintJwt(claims, { expiredSec: 3600 });
    expect(await verifyAuthIssuedJwt(token)).toBeNull();
  });
});
