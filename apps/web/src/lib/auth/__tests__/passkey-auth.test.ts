import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock server-only before importing anything else
vi.mock("server-only", () => ({}));

import { bytesToBase64Url } from "@/lib/utils/base64url";
import { createTestUser, resetDatabase } from "@/test/db-test-utils";
import {
  createTestAssertion,
  createTestKeyPair,
  createTestPasskeyCredential,
  createTestPasskeyCredentialWithKeyPair,
} from "@/test/passkey-test-utils";

// Import after mocks
import {
  createPasskeyChallenge,
  createPasskeySession,
  createPasswordlessUser,
  deletePasskeyCredential,
  getExpectedOrigin,
  getPasskeyCredentialByCredentialId,
  getPasskeyCredentials,
  getRelyingPartyId,
  getUserByEmail,
  registerPasskeyCredential,
  renamePasskeyCredential,
  verifyAndConsumeChallenge,
  verifyPasskeyAssertion,
} from "../passkey-auth";

describe("passkey-auth", () => {
  beforeEach(async () => {
    await resetDatabase();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("createPasskeyChallenge", () => {
    it("generates 32-byte random challenge", () => {
      const { challenge } = createPasskeyChallenge();
      expect(challenge).toBeInstanceOf(Uint8Array);
      expect(challenge.length).toBe(32);
    });

    it("generates unique challenge ID", () => {
      const result1 = createPasskeyChallenge();
      const result2 = createPasskeyChallenge();
      expect(result1.challengeId).not.toBe(result2.challengeId);
    });

    it("generates unique challenges", () => {
      const result1 = createPasskeyChallenge();
      const result2 = createPasskeyChallenge();
      expect(bytesToBase64Url(result1.challenge)).not.toBe(
        bytesToBase64Url(result2.challenge)
      );
    });
  });

  describe("verifyAndConsumeChallenge - replay prevention", () => {
    it("returns challenge on first use", () => {
      const { challengeId, challenge } = createPasskeyChallenge();
      const result = verifyAndConsumeChallenge(challengeId);
      expect(result).toEqual(challenge);
    });

    it("REJECTS already-consumed challenge (replay attack)", () => {
      const { challengeId } = createPasskeyChallenge();

      // First use succeeds
      verifyAndConsumeChallenge(challengeId);

      // Second use MUST fail
      expect(() => verifyAndConsumeChallenge(challengeId)).toThrow(
        "Invalid or expired challenge"
      );
    });

    it("REJECTS non-existent challenge ID", () => {
      expect(() => verifyAndConsumeChallenge("non-existent-id")).toThrow(
        "Invalid or expired challenge"
      );
    });

    it("REJECTS expired challenge (>5 min)", () => {
      const { challengeId } = createPasskeyChallenge();

      // Advance time by 6 minutes
      vi.advanceTimersByTime(6 * 60 * 1000);

      expect(() => verifyAndConsumeChallenge(challengeId)).toThrow(
        "Challenge expired"
      );
    });

    it("accepts challenge at TTL boundary (5 min - 1ms)", () => {
      const { challengeId, challenge } = createPasskeyChallenge();

      // Advance time to just before expiration
      vi.advanceTimersByTime(5 * 60 * 1000 - 1);

      const result = verifyAndConsumeChallenge(challengeId);
      expect(result).toEqual(challenge);
    });
  });

  describe("getRelyingPartyId", () => {
    const originalEnv = process.env.BETTER_AUTH_URL;

    afterEach(() => {
      process.env.BETTER_AUTH_URL = originalEnv;
    });

    it("extracts hostname from BETTER_AUTH_URL", () => {
      process.env.BETTER_AUTH_URL = "https://app.zentity.xyz";
      expect(getRelyingPartyId()).toBe("app.zentity.xyz");
    });

    it("extracts hostname with port", () => {
      process.env.BETTER_AUTH_URL = "https://localhost:3000";
      expect(getRelyingPartyId()).toBe("localhost");
    });

    it("returns localhost as default", () => {
      process.env.BETTER_AUTH_URL = undefined;
      expect(getRelyingPartyId()).toBe("localhost");
    });
  });

  describe("getExpectedOrigin", () => {
    const originalEnv = process.env.BETTER_AUTH_URL;

    afterEach(() => {
      process.env.BETTER_AUTH_URL = originalEnv;
    });

    it("returns BETTER_AUTH_URL", () => {
      process.env.BETTER_AUTH_URL = "https://app.zentity.xyz";
      expect(getExpectedOrigin()).toBe("https://app.zentity.xyz");
    });

    it("returns localhost:3000 as default", () => {
      process.env.BETTER_AUTH_URL = undefined;
      expect(getExpectedOrigin()).toBe("http://localhost:3000");
    });
  });

  describe("verifyPasskeyAssertion - happy path", () => {
    it("verifies valid assertion and returns user ID", async () => {
      const userId = await createTestUser();
      const { credentialId, keyPair } =
        await createTestPasskeyCredentialWithKeyPair({ userId, counter: 0 });

      const { challengeId, challenge } = createPasskeyChallenge();
      const rpId = getRelyingPartyId();
      const origin = getExpectedOrigin();

      const assertion = await createTestAssertion({
        credentialId,
        challenge,
        origin,
        rpId,
        counter: 1,
        privateKey: keyPair.privateKey,
      });

      const result = await verifyPasskeyAssertion({ challengeId, assertion });

      expect(result.userId).toBe(userId);
      expect(result.credentialId).toBe(credentialId);
      expect(result.newCounter).toBe(1);
    });

    it("updates counter in database after success", async () => {
      const userId = await createTestUser();
      const { credentialId, keyPair } =
        await createTestPasskeyCredentialWithKeyPair({ userId, counter: 5 });

      const { challengeId, challenge } = createPasskeyChallenge();
      const rpId = getRelyingPartyId();
      const origin = getExpectedOrigin();

      const assertion = await createTestAssertion({
        credentialId,
        challenge,
        origin,
        rpId,
        counter: 10,
        privateKey: keyPair.privateKey,
      });

      await verifyPasskeyAssertion({ challengeId, assertion });

      // Verify counter was updated
      const credential = await getPasskeyCredentialByCredentialId(credentialId);
      expect(credential?.counter).toBe(10);
    });
  });

  describe("verifyPasskeyAssertion - credential lookup", () => {
    it("REJECTS unknown credential ID", async () => {
      const { challengeId } = createPasskeyChallenge();

      const keyPair = await createTestKeyPair();
      const assertion = await createTestAssertion({
        credentialId: "unknown-credential-id",
        challenge: new Uint8Array(32),
        origin: getExpectedOrigin(),
        rpId: getRelyingPartyId(),
        counter: 1,
        privateKey: keyPair.privateKey,
      });

      await expect(
        verifyPasskeyAssertion({ challengeId, assertion })
      ).rejects.toThrow("Unknown credential");
    });
  });

  describe("verifyPasskeyAssertion - challenge verification", () => {
    it("REJECTS invalid challenge ID", async () => {
      const userId = await createTestUser();
      const { credentialId, keyPair } =
        await createTestPasskeyCredentialWithKeyPair({ userId, counter: 0 });

      const assertion = await createTestAssertion({
        credentialId,
        challenge: new Uint8Array(32),
        origin: getExpectedOrigin(),
        rpId: getRelyingPartyId(),
        counter: 1,
        privateKey: keyPair.privateKey,
      });

      await expect(
        verifyPasskeyAssertion({ challengeId: "invalid-challenge", assertion })
      ).rejects.toThrow("Invalid or expired challenge");
    });

    it("REJECTS expired challenge", async () => {
      const userId = await createTestUser();
      const { credentialId, keyPair } =
        await createTestPasskeyCredentialWithKeyPair({ userId, counter: 0 });

      const { challengeId, challenge } = createPasskeyChallenge();

      // Advance time past expiration
      vi.advanceTimersByTime(6 * 60 * 1000);

      const assertion = await createTestAssertion({
        credentialId,
        challenge,
        origin: getExpectedOrigin(),
        rpId: getRelyingPartyId(),
        counter: 1,
        privateKey: keyPair.privateKey,
      });

      await expect(
        verifyPasskeyAssertion({ challengeId, assertion })
      ).rejects.toThrow("Challenge expired");
    });
  });

  describe("verifyPasskeyAssertion - counter validation (replay attacks)", () => {
    it("accepts counter increment of 1", async () => {
      const userId = await createTestUser();
      const { credentialId, keyPair } =
        await createTestPasskeyCredentialWithKeyPair({ userId, counter: 0 });

      const { challengeId, challenge } = createPasskeyChallenge();

      const assertion = await createTestAssertion({
        credentialId,
        challenge,
        origin: getExpectedOrigin(),
        rpId: getRelyingPartyId(),
        counter: 1,
        privateKey: keyPair.privateKey,
      });

      const result = await verifyPasskeyAssertion({ challengeId, assertion });
      expect(result.newCounter).toBe(1);
    });

    it("accepts counter increment > 1 (skipped operations)", async () => {
      const userId = await createTestUser();
      const { credentialId, keyPair } =
        await createTestPasskeyCredentialWithKeyPair({ userId, counter: 5 });

      const { challengeId, challenge } = createPasskeyChallenge();

      const assertion = await createTestAssertion({
        credentialId,
        challenge,
        origin: getExpectedOrigin(),
        rpId: getRelyingPartyId(),
        counter: 100,
        privateKey: keyPair.privateKey,
      });

      const result = await verifyPasskeyAssertion({ challengeId, assertion });
      expect(result.newCounter).toBe(100);
    });

    it("REJECTS same counter value (replay attack)", async () => {
      const userId = await createTestUser();
      const { credentialId, keyPair } =
        await createTestPasskeyCredentialWithKeyPair({ userId, counter: 5 });

      const { challengeId, challenge } = createPasskeyChallenge();

      const assertion = await createTestAssertion({
        credentialId,
        challenge,
        origin: getExpectedOrigin(),
        rpId: getRelyingPartyId(),
        counter: 5, // Same as stored counter
        privateKey: keyPair.privateKey,
      });

      await expect(
        verifyPasskeyAssertion({ challengeId, assertion })
      ).rejects.toThrow("Credential counter did not increase");
    });

    it("REJECTS lower counter value (cloned authenticator)", async () => {
      const userId = await createTestUser();
      const { credentialId, keyPair } =
        await createTestPasskeyCredentialWithKeyPair({ userId, counter: 100 });

      const { challengeId, challenge } = createPasskeyChallenge();

      const assertion = await createTestAssertion({
        credentialId,
        challenge,
        origin: getExpectedOrigin(),
        rpId: getRelyingPartyId(),
        counter: 50, // Lower than stored counter
        privateKey: keyPair.privateKey,
      });

      await expect(
        verifyPasskeyAssertion({ challengeId, assertion })
      ).rejects.toThrow("Credential counter did not increase");
    });
  });

  describe("verifyPasskeyAssertion - origin verification", () => {
    it("REJECTS wrong origin", async () => {
      const userId = await createTestUser();
      const { credentialId, keyPair } =
        await createTestPasskeyCredentialWithKeyPair({ userId, counter: 0 });

      const { challengeId, challenge } = createPasskeyChallenge();

      const assertion = await createTestAssertion({
        credentialId,
        challenge,
        origin: "https://evil.com", // Wrong origin
        rpId: getRelyingPartyId(),
        counter: 1,
        privateKey: keyPair.privateKey,
      });

      await expect(
        verifyPasskeyAssertion({ challengeId, assertion })
      ).rejects.toThrow("Origin mismatch");
    });
  });

  describe("verifyPasskeyAssertion - RP ID verification", () => {
    it("REJECTS wrong RP ID hash", async () => {
      const userId = await createTestUser();
      const { credentialId, keyPair } =
        await createTestPasskeyCredentialWithKeyPair({ userId, counter: 0 });

      const { challengeId, challenge } = createPasskeyChallenge();

      // Use wrong RP ID in assertion
      const assertion = await createTestAssertion({
        credentialId,
        challenge,
        origin: getExpectedOrigin(),
        rpId: "wrong.rpid.com", // Wrong RP ID
        counter: 1,
        privateKey: keyPair.privateKey,
      });

      await expect(
        verifyPasskeyAssertion({ challengeId, assertion })
      ).rejects.toThrow("RP ID hash mismatch");
    });
  });

  describe("verifyPasskeyAssertion - user presence flag", () => {
    it("REJECTS missing user presence flag", async () => {
      const userId = await createTestUser();
      const { credentialId, keyPair } =
        await createTestPasskeyCredentialWithKeyPair({ userId, counter: 0 });

      const { challengeId, challenge } = createPasskeyChallenge();

      // Create assertion with UP=false
      const assertion = await createTestAssertion({
        credentialId,
        challenge,
        origin: getExpectedOrigin(),
        rpId: getRelyingPartyId(),
        counter: 1,
        privateKey: keyPair.privateKey,
        flags: { up: false, uv: true }, // No user presence
      });

      await expect(
        verifyPasskeyAssertion({ challengeId, assertion })
      ).rejects.toThrow("User presence not verified");
    });
  });

  describe("verifyPasskeyAssertion - signature verification", () => {
    it("REJECTS invalid signature", async () => {
      const userId = await createTestUser();
      const { credentialId } = await createTestPasskeyCredentialWithKeyPair({
        userId,
        counter: 0,
      });

      const { challengeId, challenge } = createPasskeyChallenge();

      // Create assertion with wrong key (valid signature but wrong key)
      const wrongKeyPair = await createTestKeyPair();
      const assertion = await createTestAssertion({
        credentialId,
        challenge,
        origin: getExpectedOrigin(),
        rpId: getRelyingPartyId(),
        counter: 1,
        privateKey: wrongKeyPair.privateKey, // Wrong key
      });

      await expect(
        verifyPasskeyAssertion({ challengeId, assertion })
      ).rejects.toThrow("Signature verification failed");
    });
  });

  describe("verifyPasskeyAssertion - user binding", () => {
    it("returns userId from credential, not from client", async () => {
      const realUserId = await createTestUser({ email: "real@example.com" });
      const { credentialId, keyPair } =
        await createTestPasskeyCredentialWithKeyPair({
          userId: realUserId,
          counter: 0,
        });

      const { challengeId, challenge } = createPasskeyChallenge();

      const assertion = await createTestAssertion({
        credentialId,
        challenge,
        origin: getExpectedOrigin(),
        rpId: getRelyingPartyId(),
        counter: 1,
        privateKey: keyPair.privateKey,
        userHandle: "attacker-user-id", // Attacker tries to impersonate
      });

      const result = await verifyPasskeyAssertion({ challengeId, assertion });

      // MUST return the real user ID from database, not the claimed one
      expect(result.userId).toBe(realUserId);
      expect(result.userId).not.toBe("attacker-user-id");
    });
  });

  describe("registerPasskeyCredential", () => {
    it("inserts credential with all fields", async () => {
      const userId = await createTestUser();
      const keyPair = await createTestKeyPair();

      const result = await registerPasskeyCredential({
        userId,
        credentialId: "test-cred-id",
        publicKey: keyPair.cosePublicKeyBase64,
        counter: 0,
        deviceType: "platform",
        backedUp: true,
        transports: ["internal", "hybrid"],
        name: "My MacBook",
      });

      expect(result.id).toBeDefined();

      const credential =
        await getPasskeyCredentialByCredentialId("test-cred-id");
      expect(credential?.userId).toBe(userId);
      expect(credential?.name).toBe("My MacBook");
      expect(credential?.deviceType).toBe("platform");
      expect(credential?.backedUp).toBe(true);
    });

    it("sets default name when not provided", async () => {
      const userId = await createTestUser();
      const keyPair = await createTestKeyPair();

      await registerPasskeyCredential({
        userId,
        credentialId: "test-cred-id-2",
        publicKey: keyPair.cosePublicKeyBase64,
        counter: 0,
        deviceType: null,
        backedUp: false,
        transports: [],
      });

      const credential =
        await getPasskeyCredentialByCredentialId("test-cred-id-2");
      expect(credential?.name).toBe("My Passkey");
    });
  });

  describe("getPasskeyCredentials", () => {
    it("returns all credentials for user", async () => {
      const userId = await createTestUser();
      await createTestPasskeyCredential({ userId, name: "Passkey 1" });
      await createTestPasskeyCredential({ userId, name: "Passkey 2" });

      const credentials = await getPasskeyCredentials(userId);
      expect(credentials).toHaveLength(2);
    });

    it("returns empty array for user with no credentials", async () => {
      const userId = await createTestUser();
      const credentials = await getPasskeyCredentials(userId);
      expect(credentials).toHaveLength(0);
    });
  });

  describe("getPasskeyCredentialByCredentialId", () => {
    it("returns credential by credential ID", async () => {
      const userId = await createTestUser();
      const credentialId = await createTestPasskeyCredential({
        userId,
        name: "My Passkey",
      });

      const credential = await getPasskeyCredentialByCredentialId(credentialId);
      expect(credential?.name).toBe("My Passkey");
    });

    it("returns undefined for unknown credential", async () => {
      const credential = await getPasskeyCredentialByCredentialId("unknown-id");
      expect(credential).toBeUndefined();
    });
  });

  describe("deletePasskeyCredential", () => {
    it("deletes credential and returns deleted=true", async () => {
      const userId = await createTestUser();
      const credentialId = await createTestPasskeyCredential({ userId });

      const result = await deletePasskeyCredential({ userId, credentialId });
      expect(result.deleted).toBe(true);

      const credential = await getPasskeyCredentialByCredentialId(credentialId);
      expect(credential).toBeUndefined();
    });

    it("returns deleted=false for unknown credential", async () => {
      const userId = await createTestUser();
      const result = await deletePasskeyCredential({
        userId,
        credentialId: "unknown-id",
      });
      expect(result.deleted).toBe(false);
    });
  });

  describe("renamePasskeyCredential", () => {
    it("updates credential name", async () => {
      const userId = await createTestUser();
      const credentialId = await createTestPasskeyCredential({
        userId,
        name: "Old Name",
      });

      const result = await renamePasskeyCredential({
        userId,
        credentialId,
        name: "New Name",
      });
      expect(result.updated).toBe(true);

      const credential = await getPasskeyCredentialByCredentialId(credentialId);
      expect(credential?.name).toBe("New Name");
    });

    it("returns updated=false for unknown credential", async () => {
      const userId = await createTestUser();
      const result = await renamePasskeyCredential({
        userId,
        credentialId: "unknown-id",
        name: "New Name",
      });
      expect(result.updated).toBe(false);
    });
  });

  describe("createPasswordlessUser", () => {
    it("creates user with passwordlessSignup=true", async () => {
      const result = await createPasswordlessUser({
        email: "test@example.com",
      });

      expect(result.userId).toBeDefined();

      const user = await getUserByEmail("test@example.com");
      expect(user?.passwordlessSignup).toBe(true);
      expect(user?.emailVerified).toBe(false);
    });
  });

  describe("getUserByEmail", () => {
    it("returns user by email", async () => {
      await createTestUser({ email: "find@example.com" });

      const user = await getUserByEmail("find@example.com");
      expect(user?.email).toBe("find@example.com");
    });

    it("returns undefined for unknown email", async () => {
      const user = await getUserByEmail("unknown@example.com");
      expect(user).toBeUndefined();
    });
  });

  describe("createPasskeySession", () => {
    it("creates session and sets cookie", async () => {
      const userId = await createTestUser();
      const resHeaders = new Headers();

      const result = await createPasskeySession(userId, resHeaders);

      expect(result.sessionToken).toBeDefined();
      expect(result.sessionToken.length).toBe(32);
      expect(result.expiresAt).toBeInstanceOf(Date);

      // Verify cookie was set via resHeaders
      const setCookie = resHeaders.get("Set-Cookie");
      expect(setCookie).toContain("better-auth.session_token=");
      expect(setCookie).toContain(result.sessionToken);
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("SameSite=Lax");
      expect(setCookie).toContain("Path=/");
    });

    it("sets 7-day expiration", async () => {
      const userId = await createTestUser();
      const resHeaders = new Headers();

      const result = await createPasskeySession(userId, resHeaders);

      const expectedExpiry = new Date("2025-01-22T12:00:00Z"); // 7 days later
      expect(result.expiresAt.getTime()).toBe(expectedExpiry.getTime());
    });
  });
});
