import crypto from "node:crypto";

import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeEach, describe, expect, it } from "vitest";

import { verifyIssuedAccessToken } from "@/lib/auth/jwt";
import { encryptPrivateKey } from "@/lib/auth/oidc/jwt-signer";
import { getAuthIssuer } from "@/lib/auth/oidc/well-known";
import { db } from "@/lib/db/connection";
import { jwks as jwksTable } from "@/lib/db/schema/oauth-provider";
import { revokedTokens } from "@/lib/db/schema/revoked-tokens";
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
      privateKey: encryptPrivateKey(JSON.stringify(privateJwk)),
      alg: "EdDSA",
      crv: "Ed25519",
    })
    .run();
}

function mintJwt(
  claims: Record<string, unknown>,
  opts?: { kid?: string; key?: CryptoKey; expiredSec?: number; typ?: string }
): Promise<string> {
  const builder = new SignJWT(claims).setProtectedHeader({
    alg: "EdDSA",
    typ: opts?.typ ?? "at+jwt",
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

describe("auth-issued access token verification", () => {
  const claims = {
    iss: authIssuer,
    sub: "subject",
    scope: "openid",
    jti: "access-token-jti",
  };

  beforeEach(async () => {
    await resetDatabase();
    await ensureSigningKey();
  });

  it("accepts a JWT signed with a registered key", async () => {
    const payload = await verifyIssuedAccessToken(await mintJwt(claims));
    expect(payload?.sub).toBe("subject");
  });

  it("rejects a forged JWT with valid structure but wrong key", async () => {
    const attackerKeys = await generateKeyPair("EdDSA", {
      crv: "Ed25519",
      extractable: true,
    });
    const token = await mintJwt(claims, { key: attackerKeys.privateKey });
    expect(await verifyIssuedAccessToken(token)).toBeNull();
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
    expect(await verifyIssuedAccessToken(token)).toBeNull();
  });

  it("rejects a JWT with wrong issuer", async () => {
    const token = await mintJwt({ ...claims, iss: "https://evil.example.com" });
    expect(await verifyIssuedAccessToken(token)).toBeNull();
  });

  it("rejects an expired JWT", async () => {
    const token = await mintJwt(claims, { expiredSec: 3600 });
    expect(await verifyIssuedAccessToken(token)).toBeNull();
  });

  it("rejects a JWT that is not typed as an access token", async () => {
    const idTokenLike = await mintJwt(claims, { typ: "JWT" });
    const logoutToken = await mintJwt(claims, { typ: "logout+jwt" });

    expect(await verifyIssuedAccessToken(idTokenLike)).toBeNull();
    expect(await verifyIssuedAccessToken(logoutToken)).toBeNull();
  });

  it("rejects a revoked access token", async () => {
    const token = await mintJwt(claims);
    expect(await verifyIssuedAccessToken(token)).not.toBeNull();

    await db.insert(revokedTokens).values({ jti: claims.jti }).run();

    expect(await verifyIssuedAccessToken(token)).toBeNull();
  });

  it("rejects an access token without a jti", async () => {
    const { jti: _jti, ...withoutJti } = claims;
    expect(await verifyIssuedAccessToken(await mintJwt(withoutJti))).toBeNull();
  });

  it("checks the audience when one is required", async () => {
    const token = await mintJwt({ ...claims, aud: "https://rs.example" });

    expect(
      await verifyIssuedAccessToken(token, "https://rs.example")
    ).not.toBeNull();
    expect(
      await verifyIssuedAccessToken(token, "https://other.example")
    ).toBeNull();
  });

  it("reads the key table once and picks up a key added later", async () => {
    await verifyIssuedAccessToken(await mintJwt(claims));
    await ensureSigningKey();

    expect((await verifyIssuedAccessToken(await mintJwt(claims)))?.sub).toBe(
      "subject"
    );
  });
});
