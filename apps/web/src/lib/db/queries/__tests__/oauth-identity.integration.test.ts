import crypto from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/connection";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { createTestUser, resetDatabase } from "@/test/db-test-utils";

import {
  deleteAllOAuthIdentityDataForUser,
  deleteOAuthIdentityData,
  getOAuthIdentityData,
  getOAuthIdentityDataByUser,
  upsertOAuthIdentityData,
} from "../oauth-identity";

async function createTestOAuthClient(clientId: string): Promise<void> {
  await db
    .insert(oauthClients)
    .values({
      id: crypto.randomUUID(),
      clientId,
      clientSecret: "test-secret",
      redirectUris: ["https://example.com/callback"],
    })
    .run();
}

describe("oauth identity queries", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  describe("upsertOAuthIdentityData", () => {
    it("inserts new identity data", async () => {
      const userId = await createTestUser();
      const clientId = "test-client";
      await createTestOAuthClient(clientId);

      await upsertOAuthIdentityData({
        id: crypto.randomUUID(),
        userId,
        clientId,
        encryptedBlob: Buffer.from("encrypted-data"),
        consentedScopes: ["identity.name", "identity.dob"],
        capturedAt: new Date().toISOString(),
      });

      const result = await getOAuthIdentityData(userId, clientId);
      expect(result).not.toBeNull();
      expect(result?.userId).toBe(userId);
      expect(result?.clientId).toBe(clientId);
      expect(result?.consentedScopes).toEqual([
        "identity.name",
        "identity.dob",
      ]);
    });

    it("updates existing identity data on conflict", async () => {
      const userId = await createTestUser();
      const clientId = "test-client";
      await createTestOAuthClient(clientId);

      // First insert
      await upsertOAuthIdentityData({
        id: crypto.randomUUID(),
        userId,
        clientId,
        encryptedBlob: Buffer.from("encrypted-data-v1"),
        consentedScopes: ["identity.name"],
        capturedAt: new Date().toISOString(),
      });

      // Update (upsert)
      await upsertOAuthIdentityData({
        id: crypto.randomUUID(),
        userId,
        clientId,
        encryptedBlob: Buffer.from("encrypted-data-v2"),
        consentedScopes: ["identity.name", "identity.dob", "identity.address"],
        capturedAt: new Date().toISOString(),
      });

      const result = await getOAuthIdentityData(userId, clientId);
      expect(result?.consentedScopes).toEqual([
        "identity.name",
        "identity.dob",
        "identity.address",
      ]);
      expect(result?.encryptedBlob.toString()).toBe("encrypted-data-v2");
    });

    it("stores expiry date when provided", async () => {
      const userId = await createTestUser();
      const clientId = "test-client";
      await createTestOAuthClient(clientId);

      const expiresAt = new Date(Date.now() + 86_400_000).toISOString(); // +1 day

      await upsertOAuthIdentityData({
        id: crypto.randomUUID(),
        userId,
        clientId,
        encryptedBlob: Buffer.from("data"),
        consentedScopes: ["identity.name"],
        capturedAt: new Date().toISOString(),
        expiresAt,
      });

      const result = await getOAuthIdentityData(userId, clientId);
      expect(result?.expiresAt).toBe(expiresAt);
    });
  });

  describe("getOAuthIdentityData", () => {
    it("returns null when no data exists", async () => {
      const userId = await createTestUser();
      const result = await getOAuthIdentityData(userId, "nonexistent-client");
      expect(result).toBeNull();
    });

    it("returns null when data has expired", async () => {
      const userId = await createTestUser();
      const clientId = "test-client";
      await createTestOAuthClient(clientId);

      // Insert with past expiry
      const pastExpiry = new Date(Date.now() - 86_400_000).toISOString(); // -1 day
      await upsertOAuthIdentityData({
        id: crypto.randomUUID(),
        userId,
        clientId,
        encryptedBlob: Buffer.from("data"),
        consentedScopes: ["identity.name"],
        capturedAt: new Date().toISOString(),
        expiresAt: pastExpiry,
      });

      const result = await getOAuthIdentityData(userId, clientId);
      expect(result).toBeNull();
    });

    it("returns data when not expired", async () => {
      const userId = await createTestUser();
      const clientId = "test-client";
      await createTestOAuthClient(clientId);

      const futureExpiry = new Date(Date.now() + 86_400_000).toISOString(); // +1 day
      await upsertOAuthIdentityData({
        id: crypto.randomUUID(),
        userId,
        clientId,
        encryptedBlob: Buffer.from("data"),
        consentedScopes: ["identity.name"],
        capturedAt: new Date().toISOString(),
        expiresAt: futureExpiry,
      });

      const result = await getOAuthIdentityData(userId, clientId);
      expect(result).not.toBeNull();
    });

    it("returns data when no expiry set", async () => {
      const userId = await createTestUser();
      const clientId = "test-client";
      await createTestOAuthClient(clientId);

      await upsertOAuthIdentityData({
        id: crypto.randomUUID(),
        userId,
        clientId,
        encryptedBlob: Buffer.from("data"),
        consentedScopes: ["identity.name"],
        capturedAt: new Date().toISOString(),
        // No expiresAt
      });

      const result = await getOAuthIdentityData(userId, clientId);
      expect(result).not.toBeNull();
    });
  });

  describe("deleteOAuthIdentityData", () => {
    it("deletes identity data for specific user+client", async () => {
      const userId = await createTestUser();
      const clientId = "test-client";
      await createTestOAuthClient(clientId);

      await upsertOAuthIdentityData({
        id: crypto.randomUUID(),
        userId,
        clientId,
        encryptedBlob: Buffer.from("data"),
        consentedScopes: ["identity.name"],
        capturedAt: new Date().toISOString(),
      });

      await deleteOAuthIdentityData(userId, clientId);

      const result = await getOAuthIdentityData(userId, clientId);
      expect(result).toBeNull();
    });

    it("does not affect other user+client pairs", async () => {
      const userId1 = await createTestUser();
      const userId2 = await createTestUser();
      const clientId = "test-client";
      await createTestOAuthClient(clientId);

      await upsertOAuthIdentityData({
        id: crypto.randomUUID(),
        userId: userId1,
        clientId,
        encryptedBlob: Buffer.from("data1"),
        consentedScopes: ["identity.name"],
        capturedAt: new Date().toISOString(),
      });

      await upsertOAuthIdentityData({
        id: crypto.randomUUID(),
        userId: userId2,
        clientId,
        encryptedBlob: Buffer.from("data2"),
        consentedScopes: ["identity.name"],
        capturedAt: new Date().toISOString(),
      });

      await deleteOAuthIdentityData(userId1, clientId);

      expect(await getOAuthIdentityData(userId1, clientId)).toBeNull();
      expect(await getOAuthIdentityData(userId2, clientId)).not.toBeNull();
    });
  });

  describe("deleteAllOAuthIdentityDataForUser", () => {
    it("deletes all identity data for a user across clients", async () => {
      const userId = await createTestUser();
      const clientId1 = "client-1";
      const clientId2 = "client-2";
      await createTestOAuthClient(clientId1);
      await createTestOAuthClient(clientId2);

      await upsertOAuthIdentityData({
        id: crypto.randomUUID(),
        userId,
        clientId: clientId1,
        encryptedBlob: Buffer.from("data1"),
        consentedScopes: ["identity.name"],
        capturedAt: new Date().toISOString(),
      });

      await upsertOAuthIdentityData({
        id: crypto.randomUUID(),
        userId,
        clientId: clientId2,
        encryptedBlob: Buffer.from("data2"),
        consentedScopes: ["identity.dob"],
        capturedAt: new Date().toISOString(),
      });

      await deleteAllOAuthIdentityDataForUser(userId);

      expect(await getOAuthIdentityData(userId, clientId1)).toBeNull();
      expect(await getOAuthIdentityData(userId, clientId2)).toBeNull();
    });
  });

  describe("getOAuthIdentityDataByUser", () => {
    it("returns all identity data records for a user", async () => {
      const userId = await createTestUser();
      const clientId1 = "client-1";
      const clientId2 = "client-2";
      await createTestOAuthClient(clientId1);
      await createTestOAuthClient(clientId2);

      await upsertOAuthIdentityData({
        id: crypto.randomUUID(),
        userId,
        clientId: clientId1,
        encryptedBlob: Buffer.from("data1"),
        consentedScopes: ["identity.name"],
        capturedAt: new Date().toISOString(),
      });

      await upsertOAuthIdentityData({
        id: crypto.randomUUID(),
        userId,
        clientId: clientId2,
        encryptedBlob: Buffer.from("data2"),
        consentedScopes: ["identity.dob"],
        capturedAt: new Date().toISOString(),
      });

      const results = await getOAuthIdentityDataByUser(userId);
      expect(results.length).toBe(2);
      expect(results.map((r) => r.clientId).sort()).toEqual([
        "client-1",
        "client-2",
      ]);
    });

    it("returns empty array for user with no data", async () => {
      const userId = await createTestUser();
      const results = await getOAuthIdentityDataByUser(userId);
      expect(results).toEqual([]);
    });
  });
});
