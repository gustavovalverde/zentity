import type { Session } from "@/lib/auth/auth-config";

import { eq } from "drizzle-orm";
import { decodeProtectedHeader } from "jose";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/connection";
import { jwks } from "@/lib/db/schema/oauth-provider";

import {
  cleanupExpiredKeys,
  getPublishedJwks,
  rotateSigningKey,
  signJwt,
} from "../jwt-signer";

const DAY_MS = 86_400_000;

async function createAdminCaller() {
  const { adminRouter } = await import("@/lib/trpc/routers/admin");
  return adminRouter.createCaller({
    req: new Request("http://localhost/api/trpc"),
    resHeaders: new Headers(),
    session: {
      user: {
        id: "admin-user",
        name: "Admin",
        email: "admin@example.com",
        emailVerified: true,
        banned: false,
        role: "admin",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      session: {
        id: "admin-session",
        userId: "admin-user",
        expiresAt: new Date(Date.now() + 3_600_000),
        token: "admin-token",
        createdAt: new Date(),
        updatedAt: new Date(),
        ipAddress: null,
        userAgent: null,
      },
    } as unknown as Session,
    requestId: "test-request-id",
    flowId: null,
    flowIdSource: "none" as const,
  });
}

async function createUserCaller() {
  const { adminRouter } = await import("@/lib/trpc/routers/admin");
  return adminRouter.createCaller({
    req: new Request("http://localhost/api/trpc"),
    resHeaders: new Headers(),
    session: {
      user: {
        id: "normal-user",
        name: "User",
        email: "user@example.com",
        emailVerified: true,
        banned: false,
        role: "user",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      session: {
        id: "user-session",
        userId: "normal-user",
        expiresAt: new Date(Date.now() + 3_600_000),
        token: "user-token",
        createdAt: new Date(),
        updatedAt: new Date(),
        ipAddress: null,
        userAgent: null,
      },
    } as unknown as Session,
    requestId: "test-request-id",
    flowId: null,
    flowIdSource: "none" as const,
  });
}

async function signedKid(alg: "RS256" | "EdDSA"): Promise<string> {
  // Access tokens (payloads with scope) are EdDSA; every other JWT is RS256.
  const token = await signJwt(alg === "EdDSA" ? { scope: "openid" } : {});
  const { kid } = decodeProtectedHeader(token);
  if (!kid) {
    throw new Error("signed JWT has no kid");
  }
  return kid;
}

async function expireKey(id: string, expiresAt: Date) {
  await db.update(jwks).set({ expiresAt }).where(eq(jwks.id, id)).run();
}

async function getKeyRow(id: string) {
  return await db.select().from(jwks).where(eq(jwks.id, id)).get();
}

describe("JWKS signing key rotation", () => {
  beforeEach(async () => {
    await db.delete(jwks).run();
  });

  // Prevent stale keys from leaking to subsequent test files
  afterAll(async () => {
    await db.delete(jwks).run();
  });

  it("mints a key per algorithm on first use with a scheduled rotation", async () => {
    const before = Date.now();
    const edDsaKid = await signedKid("EdDSA");
    const rsaKid = await signedKid("RS256");

    const edDsa = await getKeyRow(edDsaKid);
    const rsa = await getKeyRow(rsaKid);
    expect(edDsa?.alg).toBe("EdDSA");
    expect(edDsa?.crv).toBe("Ed25519");
    expect(rsa?.alg).toBe("RS256");
    expect(edDsa?.expiresAt?.getTime()).toBeGreaterThanOrEqual(
      before + 90 * DAY_MS
    );
    expect(edDsa?.privateKey.startsWith('{"v":')).toBe(true);
  });

  it("mints a replacement once the active key reaches its rotation time", async () => {
    const original = await signedKid("EdDSA");
    await expireKey(original, new Date(Date.now() - 1000));

    const replacement = await signedKid("EdDSA");

    expect(replacement).not.toBe(original);
    expect(await signedKid("EdDSA")).toBe(replacement);
  });

  describe("rotateSigningKey", () => {
    it("signs with the new key and retires the old one", async () => {
      const original = await signedKid("EdDSA");

      const { newKid, retiredKids } = await rotateSigningKey("EdDSA");

      expect(retiredKids).toEqual([original]);
      expect(newKid).not.toBe(original);
      expect(await signedKid("EdDSA")).toBe(newKid);
      const oldRow = await getKeyRow(original);
      expect(oldRow?.expiresAt?.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it("mints a key when none exists for the algorithm", async () => {
      const { newKid, retiredKids } = await rotateSigningKey("RS256");

      expect(retiredKids).toEqual([]);
      expect(await signedKid("RS256")).toBe(newKid);
    });

    it("leaves the other algorithm's key in place", async () => {
      const rsaKid = await signedKid("RS256");

      await rotateSigningKey("EdDSA");

      expect(await signedKid("RS256")).toBe(rsaKid);
    });
  });

  describe("published JWKS", () => {
    it("keeps a retired key published during the grace period", async () => {
      const original = await signedKid("EdDSA");
      const { newKid } = await rotateSigningKey("EdDSA");

      const kids = (await getPublishedJwks()).keys.map((key) => key.kid);

      expect(kids).toEqual(expect.arrayContaining([original, newKid]));
    });

    it("leaves out the JARM encryption key", async () => {
      await signedKid("RS256");
      await db
        .insert(jwks)
        .values({
          id: "jarm-key",
          publicKey: JSON.stringify({
            kty: "EC",
            crv: "P-256",
            x: "x",
            y: "y",
          }),
          privateKey: "{}",
          alg: "ECDH-ES",
          crv: "P-256",
        })
        .run();

      const kids = (await getPublishedJwks()).keys.map((key) => key.kid);

      expect(kids).not.toContain("jarm-key");
    });

    it("drops a key that expired longer ago than the grace period", async () => {
      const original = await signedKid("EdDSA");
      await rotateSigningKey("EdDSA");
      await expireKey(original, new Date(Date.now() - 366 * DAY_MS));

      const kids = (await getPublishedJwks()).keys.map((key) => key.kid);

      expect(kids).not.toContain(original);
    });
  });

  describe("cleanupExpiredKeys", () => {
    it("removes only keys past the grace period", async () => {
      const stale = await signedKid("EdDSA");
      await rotateSigningKey("EdDSA");
      const retired = await signedKid("EdDSA");
      const { newKid } = await rotateSigningKey("EdDSA");
      await expireKey(stale, new Date(Date.now() - 366 * DAY_MS));

      const deleted = await cleanupExpiredKeys();

      expect(deleted).toBe(1);
      const remaining = await db.select({ id: jwks.id }).from(jwks);
      expect(remaining.map((row) => row.id).sort()).toEqual(
        [retired, newKid].sort()
      );
    });
  });

  describe("admin tRPC procedure", () => {
    it("allows admin to rotate a key", async () => {
      const original = await signedKid("EdDSA");

      const caller = await createAdminCaller();
      const result = await caller.rotateSigningKey({ alg: "EdDSA" });

      expect(result.retiredKids).toEqual([original]);
      expect(result.newKid).not.toBe(original);
    });

    it("rejects non-admin with FORBIDDEN", async () => {
      const caller = await createUserCaller();

      await expect(caller.rotateSigningKey({ alg: "EdDSA" })).rejects.toThrow(
        expect.objectContaining({ code: "FORBIDDEN" })
      );
    });
  });
});
