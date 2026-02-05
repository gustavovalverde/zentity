import { beforeAll, describe, expect, it, vi } from "vitest";

// Mock server-only before importing the module
vi.mock("server-only", () => ({}));

// Set up BETTER_AUTH_SECRET for tests
beforeAll(() => {
  process.env.BETTER_AUTH_SECRET = "test-secret-for-identity-encryption-32ch";
});

import type { IdentityFields } from "../identity";

import {
  decryptIdentityFromServer,
  encryptIdentityForServer,
} from "../identity";

describe("server-side identity encryption", () => {
  const testUserId = "user-123";
  const testClientId = "client-456";

  describe("encryptIdentityForServer", () => {
    it("encrypts identity data to a buffer", async () => {
      const identity: IdentityFields = {
        given_name: "John",
        family_name: "Doe",
        birthdate: "1990-01-15",
      };

      const encrypted = await encryptIdentityForServer(identity, {
        userId: testUserId,
        clientId: testClientId,
      });

      expect(encrypted).toBeInstanceOf(Buffer);
      expect(encrypted.length).toBeGreaterThan(0);
    });

    it("produces different ciphertext for same plaintext (random IV)", async () => {
      const identity: IdentityFields = {
        given_name: "John",
      };

      const context = { userId: testUserId, clientId: testClientId };
      const encrypted1 = await encryptIdentityForServer(identity, context);
      const encrypted2 = await encryptIdentityForServer(identity, context);

      // Different due to random IV
      expect(encrypted1.equals(encrypted2)).toBe(false);
    });

    it("handles empty identity object", async () => {
      const identity: IdentityFields = {};

      const encrypted = await encryptIdentityForServer(identity, {
        userId: testUserId,
        clientId: testClientId,
      });

      expect(encrypted).toBeInstanceOf(Buffer);
    });

    it("handles complex nested address", async () => {
      const identity: IdentityFields = {
        address: {
          formatted: "123 Main St, Apt 4B, New York, NY 10001, USA",
          street_address: "123 Main St, Apt 4B",
          locality: "New York",
          region: "NY",
          postal_code: "10001",
          country: "USA",
        },
      };

      const encrypted = await encryptIdentityForServer(identity, {
        userId: testUserId,
        clientId: testClientId,
      });

      expect(encrypted).toBeInstanceOf(Buffer);
    });

    it("handles nationalities array", async () => {
      const identity: IdentityFields = {
        nationality: "US",
        nationalities: ["US", "CA", "UK"],
      };

      const encrypted = await encryptIdentityForServer(identity, {
        userId: testUserId,
        clientId: testClientId,
      });

      expect(encrypted).toBeInstanceOf(Buffer);
    });
  });

  describe("decryptIdentityFromServer", () => {
    it("decrypts to original identity data", async () => {
      const identity: IdentityFields = {
        given_name: "John",
        family_name: "Doe",
        name: "John Doe",
        birthdate: "1990-01-15",
        document_number: "AB123456",
        document_type: "passport",
        issuing_country: "US",
        nationality: "US",
      };

      const context = { userId: testUserId, clientId: testClientId };
      const encrypted = await encryptIdentityForServer(identity, context);
      const decrypted = await decryptIdentityFromServer(encrypted, context);

      expect(decrypted).toEqual(identity);
    });

    it("decrypts complex nested address correctly", async () => {
      const identity: IdentityFields = {
        address: {
          formatted: "123 Main St, Apt 4B, New York, NY 10001, USA",
          street_address: "123 Main St, Apt 4B",
          locality: "New York",
          region: "NY",
          postal_code: "10001",
          country: "USA",
        },
      };

      const context = { userId: testUserId, clientId: testClientId };
      const encrypted = await encryptIdentityForServer(identity, context);
      const decrypted = await decryptIdentityFromServer(encrypted, context);

      expect(decrypted).toEqual(identity);
    });

    it("decrypts nationalities array correctly", async () => {
      const identity: IdentityFields = {
        nationalities: ["US", "CA", "UK"],
      };

      const context = { userId: testUserId, clientId: testClientId };
      const encrypted = await encryptIdentityForServer(identity, context);
      const decrypted = await decryptIdentityFromServer(encrypted, context);

      expect(decrypted).toEqual(identity);
    });

    it("fails to decrypt with wrong userId", async () => {
      const identity: IdentityFields = {
        given_name: "John",
      };

      const encrypted = await encryptIdentityForServer(identity, {
        userId: testUserId,
        clientId: testClientId,
      });

      await expect(
        decryptIdentityFromServer(encrypted, {
          userId: "wrong-user",
          clientId: testClientId,
        })
      ).rejects.toThrow();
    });

    it("fails to decrypt with wrong clientId", async () => {
      const identity: IdentityFields = {
        given_name: "John",
      };

      const encrypted = await encryptIdentityForServer(identity, {
        userId: testUserId,
        clientId: testClientId,
      });

      await expect(
        decryptIdentityFromServer(encrypted, {
          userId: testUserId,
          clientId: "wrong-client",
        })
      ).rejects.toThrow();
    });

    it("throws on invalid blob format", async () => {
      const invalidBlob = Buffer.from("invalid data");

      await expect(
        decryptIdentityFromServer(invalidBlob, {
          userId: testUserId,
          clientId: testClientId,
        })
      ).rejects.toThrow();
    });
  });

  describe("key derivation isolation", () => {
    it("produces different encrypted data for different users", async () => {
      const identity: IdentityFields = { given_name: "John" };

      const encrypted1 = await encryptIdentityForServer(identity, {
        userId: "user-1",
        clientId: testClientId,
      });

      const _encrypted2 = await encryptIdentityForServer(identity, {
        userId: "user-2",
        clientId: testClientId,
      });

      // Even accounting for random IV, the key derivation differs
      // so we verify by trying to decrypt with wrong context
      await expect(
        decryptIdentityFromServer(encrypted1, {
          userId: "user-2",
          clientId: testClientId,
        })
      ).rejects.toThrow();
    });

    it("produces different encrypted data for different clients", async () => {
      const identity: IdentityFields = { given_name: "John" };

      const encrypted1 = await encryptIdentityForServer(identity, {
        userId: testUserId,
        clientId: "client-1",
      });

      // Verify cross-client decryption fails
      await expect(
        decryptIdentityFromServer(encrypted1, {
          userId: testUserId,
          clientId: "client-2",
        })
      ).rejects.toThrow();
    });
  });
});
