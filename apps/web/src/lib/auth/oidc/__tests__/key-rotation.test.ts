import type { Session } from "@/lib/auth/auth-config";

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db/connection";
import { jwks } from "@/lib/db/schema/oauth-provider";

import {
  cleanupExpiredKeys,
  getOrCreateSigningKey,
  rotateSigningKey,
} from "../jwt-signer";

vi.mock("../jwt-signer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../jwt-signer")>()),
  encryptPrivateKey: (v: string) => v,
  decryptPrivateKey: (v: string) => v,
}));

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

function clearKeyCache() {
  const sym = Symbol.for("zentity.jwt-signer-key-cache");
  const cache = (globalThis as Record<symbol, unknown>)[sym] as
    | Map<string, unknown>
    | undefined;
  cache?.clear();
}

describe("JWKS signing key rotation", () => {
  beforeEach(async () => {
    clearKeyCache();
    await db.delete(jwks).run();
  });

  // Prevent stale keys from leaking to subsequent test files
  afterAll(async () => {
    await db.delete(jwks).run();
    clearKeyCache();
  });

  describe("rotateSigningKey", () => {
    it("creates a new key and retires the old one", async () => {
      const original = await getOrCreateSigningKey("EdDSA");

      const { oldKid, newKid } = await rotateSigningKey("EdDSA");

      expect(oldKid).toBe(original.kid);
      expect(newKid).not.toBe(original.kid);

      // Old key should have expiresAt set
      const oldRow = await db
        .select()
        .from(jwks)
        .where(eq(jwks.id, original.kid))
        .get();
      expect(oldRow?.expiresAt).toBeTruthy();

      // New key should be active (no expiresAt)
      const newRow = await db
        .select()
        .from(jwks)
        .where(eq(jwks.id, newKid))
        .get();
      expect(newRow?.expiresAt).toBeNull();
    });

    it("returns null oldKid when no key exists for algorithm", async () => {
      const { oldKid, newKid } = await rotateSigningKey("ES256");

      expect(oldKid).toBeNull();
      expect(newKid).toBeTruthy();
    });

    it("getOrCreateSigningKey returns the new key after rotation", async () => {
      await getOrCreateSigningKey("EdDSA");
      const { newKid } = await rotateSigningKey("EdDSA");

      const current = await getOrCreateSigningKey("EdDSA");

      expect(current.kid).toBe(newKid);
    });
  });

  describe("JWKS endpoint serves both keys during overlap", () => {
    it("both old and new keys present in JWKS", async () => {
      const original = await getOrCreateSigningKey("EdDSA");
      await rotateSigningKey("EdDSA");

      const allKeys = await db.select().from(jwks).where(eq(jwks.alg, "EdDSA"));

      expect(allKeys).toHaveLength(2);
      const kids = allKeys.map((k) => k.id);
      expect(kids).toContain(original.kid);
    });
  });

  describe("cleanupExpiredKeys", () => {
    it("removes keys past their overlap window", async () => {
      await getOrCreateSigningKey("EdDSA");
      await rotateSigningKey("EdDSA", 0);

      // Set expiresAt to the past for the old key
      const oldKey = await db
        .select()
        .from(jwks)
        .where(eq(jwks.alg, "EdDSA"))
        .all();
      const expiredKey = oldKey.find((k) => k.expiresAt !== null);
      if (expiredKey) {
        await db
          .update(jwks)
          .set({ expiresAt: new Date(Date.now() - 1000) })
          .where(eq(jwks.id, expiredKey.id))
          .run();
      }

      const deleted = await cleanupExpiredKeys();
      expect(deleted).toBe(1);

      const remaining = await db
        .select()
        .from(jwks)
        .where(eq(jwks.alg, "EdDSA"));
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.expiresAt).toBeNull();
    });

    it("does not delete active keys", async () => {
      await getOrCreateSigningKey("EdDSA");

      const deleted = await cleanupExpiredKeys();
      expect(deleted).toBe(0);

      const keys = await db.select().from(jwks).where(eq(jwks.alg, "EdDSA"));
      expect(keys).toHaveLength(1);
    });
  });

  describe("admin tRPC procedure", () => {
    it("allows admin to rotate a key", async () => {
      await getOrCreateSigningKey("EdDSA");

      const caller = await createAdminCaller();
      const result = await caller.rotateSigningKey({
        alg: "EdDSA",
        overlapHours: 24,
      });

      expect(result.oldKid).toBeTruthy();
      expect(result.newKid).toBeTruthy();
      expect(result.oldKid).not.toBe(result.newKid);
    });

    it("rejects non-admin with FORBIDDEN", async () => {
      const caller = await createUserCaller();

      await expect(
        caller.rotateSigningKey({ alg: "EdDSA", overlapHours: 24 })
      ).rejects.toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
    });
  });
});
