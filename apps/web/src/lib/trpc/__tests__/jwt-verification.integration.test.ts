import crypto from "node:crypto";

import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeEach, describe, expect, it } from "vitest";

import { getAuthIssuer } from "@/lib/auth/issuer";
import { db } from "@/lib/db/connection";
import { users } from "@/lib/db/schema/auth";
import { jwks as jwksTable } from "@/lib/db/schema/jwks";
import { verifyAccessToken } from "@/lib/trpc/jwt-session";
import { createTestUser, resetDatabase } from "@/test/db-test-utils";

const authIssuer = getAuthIssuer();
const AUTH_SUFFIX_RE = /\/api\/auth$/;

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

describe("tRPC JWT Signature Verification", () => {
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    await ensureSigningKey();
    userId = await createTestUser();
  });

  it("accepts a properly-signed JWT", async () => {
    const token = await mintJwt({
      iss: authIssuer,
      sub: userId,
      aud: authIssuer,
      scope: "openid",
    });
    const payload = await verifyAccessToken(token);
    expect(payload).not.toBeNull();
    expect(payload?.sub).toBe(userId);
  });

  it("rejects a forged JWT with valid structure but wrong key", async () => {
    const attackerKeys = await generateKeyPair("EdDSA", {
      crv: "Ed25519",
      extractable: true,
    });
    const token = await mintJwt(
      { iss: authIssuer, sub: userId, aud: authIssuer, scope: "openid" },
      { key: attackerKeys.privateKey }
    );
    expect(await verifyAccessToken(token)).toBeNull();
  });

  it("rejects a JWT signed with unknown kid", async () => {
    const attackerKeys = await generateKeyPair("EdDSA", {
      crv: "Ed25519",
      extractable: true,
    });
    const token = await mintJwt(
      { iss: authIssuer, sub: userId, aud: authIssuer, scope: "openid" },
      { kid: "nonexistent-kid", key: attackerKeys.privateKey }
    );
    expect(await verifyAccessToken(token)).toBeNull();
  });

  it("rejects a JWT with wrong issuer", async () => {
    const token = await mintJwt({
      iss: "https://evil.example.com",
      sub: userId,
      aud: authIssuer,
      scope: "openid",
    });
    expect(await verifyAccessToken(token)).toBeNull();
  });

  it("rejects an expired JWT", async () => {
    const token = await mintJwt(
      { iss: authIssuer, sub: userId, aud: authIssuer, scope: "openid" },
      { expiredSec: 3600 }
    );
    expect(await verifyAccessToken(token)).toBeNull();
  });

  it("rejects a JWT with no sub claim", async () => {
    const token = await mintJwt({
      iss: authIssuer,
      aud: authIssuer,
      scope: "openid",
    });
    expect(await verifyAccessToken(token)).toBeNull();
  });

  it("rejects a JWT with wrong audience", async () => {
    const token = await mintJwt({
      iss: authIssuer,
      sub: userId,
      aud: "https://evil.example.com",
      scope: "openid",
    });
    expect(await verifyAccessToken(token)).toBeNull();
  });

  it("rejects a JWT with no audience", async () => {
    const token = await mintJwt({
      iss: authIssuer,
      sub: userId,
      scope: "openid",
    });
    expect(await verifyAccessToken(token)).toBeNull();
  });

  it("accepts a JWT with appUrl audience", async () => {
    const appUrl = authIssuer.replace(AUTH_SUFFIX_RE, "");
    const token = await mintJwt({
      iss: authIssuer,
      sub: userId,
      aud: appUrl,
      scope: "openid",
    });
    const payload = await verifyAccessToken(token);
    expect(payload).not.toBeNull();
    expect(payload?.sub).toBe(userId);
  });

  it("verifies user exists in DB after JWT validation", async () => {
    const token = await mintJwt({
      iss: authIssuer,
      sub: userId,
      aud: authIssuer,
      scope: "openid",
    });
    // Token verifies even if user doesn't exist (that check is in server.ts)
    const payload = await verifyAccessToken(token);
    expect(payload?.sub).toBe(userId);

    // Verify user is in DB (integration sanity check)
    const user = await db
      .select()
      .from(users)
      .where((await import("drizzle-orm")).eq(users.id, userId))
      .limit(1)
      .get();
    expect(user).toBeDefined();
  });
});
