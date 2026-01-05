/**
 * Integration tests for passkey auth router.
 * Tests registration, authentication, and credential management flows.
 */

import type { Session } from "@/lib/auth/auth";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock server-only before any imports
vi.mock("server-only", () => ({}));

import { getExpectedOrigin, getRelyingPartyId } from "@/lib/auth/passkey-auth";
import { storeRegistrationBlob } from "@/lib/auth/registration-token";
import { createTestUser, resetDatabase } from "@/test/db-test-utils";
import {
  createTestAssertion,
  createTestKeyPair,
  createTestPasskeyCredential,
  createTestPasskeyCredentialWithKeyPair,
} from "@/test/passkey-test-utils";

// Shared response headers to verify Set-Cookie
let testResHeaders: Headers;

// Helper to create a tRPC caller
async function createCaller(session: Session | null) {
  testResHeaders = new Headers();
  const { passkeyAuthRouter } = await import("@/lib/trpc/routers/passkey-auth");
  return passkeyAuthRouter.createCaller({
    req: new Request("http://localhost/api/trpc"),
    session,
    requestId: "test-request-id",
    resHeaders: testResHeaders,
    flowId: null,
    flowIdSource: "none",
    onboardingSessionId: null,
  });
}

// Create authenticated session for protected procedures
function createAuthSession(
  userId: string,
  email = "test@example.com"
): Session {
  return {
    user: { id: userId, email, name: null },
    session: { id: "test-session", userId, expiresAt: new Date() },
  } as unknown as Session;
}

describe("passkey-auth router", () => {
  beforeEach(async () => {
    await resetDatabase();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("getRegistrationOptions", () => {
    it("returns challenge and RP config", async () => {
      const caller = await createCaller(null);

      const result = await caller.getRegistrationOptions({
        email: "new@example.com",
      });

      expect(result.challengeId).toBeDefined();
      expect(result.challenge).toBeDefined();
      expect(result.rp.id).toBe(getRelyingPartyId());
      expect(result.rp.name).toBe("Zentity");
      expect(result.origin).toBe(getExpectedOrigin());
      expect(result.registrationToken).toBeDefined();
    });

    it("returns userExists=true for existing user", async () => {
      await createTestUser({ email: "existing@example.com" });
      const caller = await createCaller(null);

      const result = await caller.getRegistrationOptions({
        email: "existing@example.com",
      });

      expect(result.userExists).toBe(true);
    });

    it("returns userExists=false for new user", async () => {
      const caller = await createCaller(null);

      const result = await caller.getRegistrationOptions({
        email: "new@example.com",
      });

      expect(result.userExists).toBe(false);
    });

    it("uses email as the WebAuthn display name", async () => {
      const caller = await createCaller(null);

      const result = await caller.getRegistrationOptions({
        email: "new@example.com",
      });

      expect(result.user.name).toBe("new@example.com");
    });
  });

  describe("completeRegistration", () => {
    it("creates user and credential for new email", async () => {
      const caller = await createCaller(null);
      const keyPair = await createTestKeyPair();

      // Get registration options first
      const options = await caller.getRegistrationOptions({
        email: "newuser@example.com",
      });
      const { registrationToken } = options;
      storeRegistrationBlob(registrationToken, {
        secretId: "secret-1",
        secretType: "fhe_keys",
        blobRef: "blob-ref",
        blobHash: "blob-hash",
        blobSize: 123,
      });

      const result = await caller.completeRegistration({
        challengeId: options.challengeId,
        email: "newuser@example.com",
        credential: {
          credentialId: "new-cred-id",
          publicKey: keyPair.cosePublicKeyBase64,
          counter: 0,
          deviceType: "platform",
          backedUp: false,
          transports: ["internal"],
        },
        fhe: {
          registrationToken,
          wrappedDek: "wrapped-dek",
          prfSalt: "prf-salt",
          credentialId: "new-cred-id",
          keyId: "fhe-key-1",
          version: "v2",
          kekVersion: "v1",
        },
      });

      expect(result.success).toBe(true);
      expect(result.userId).toBeDefined();
      expect(result.sessionToken).toBeDefined();
      expect(result.keyId).toBe("fhe-key-1");
    });

    it("registers additional credential for existing user", async () => {
      const userId = await createTestUser({ email: "existing@example.com" });
      await createTestPasskeyCredential({ userId, name: "First Passkey" });

      const caller = await createCaller(null);
      const keyPair = await createTestKeyPair();

      const options = await caller.getRegistrationOptions({
        email: "existing@example.com",
      });
      const { registrationToken } = options;
      storeRegistrationBlob(registrationToken, {
        secretId: "secret-2",
        secretType: "fhe_keys",
        blobRef: "blob-ref",
        blobHash: "blob-hash",
        blobSize: 123,
      });

      const result = await caller.completeRegistration({
        challengeId: options.challengeId,
        email: "existing@example.com",
        credential: {
          credentialId: "second-cred-id",
          publicKey: keyPair.cosePublicKeyBase64,
          counter: 0,
          deviceType: "cross-platform",
          backedUp: true,
          transports: ["usb", "nfc"],
        },
        fhe: {
          registrationToken,
          wrappedDek: "wrapped-dek",
          prfSalt: "prf-salt",
          credentialId: "second-cred-id",
          keyId: "fhe-key-1",
          version: "v2",
          kekVersion: "v1",
        },
      });

      expect(result.success).toBe(true);
      expect(result.userId).toBe(userId);
    });

    it("creates session after registration", async () => {
      const caller = await createCaller(null);
      const keyPair = await createTestKeyPair();

      const options = await caller.getRegistrationOptions({
        email: "session@example.com",
      });
      const { registrationToken } = options;
      storeRegistrationBlob(registrationToken, {
        secretId: "secret-3",
        secretType: "fhe_keys",
        blobRef: "blob-ref",
        blobHash: "blob-hash",
        blobSize: 123,
      });

      const result = await caller.completeRegistration({
        challengeId: options.challengeId,
        email: "session@example.com",
        credential: {
          credentialId: "session-cred-id",
          publicKey: keyPair.cosePublicKeyBase64,
          counter: 0,
          deviceType: null,
          backedUp: false,
          transports: [],
        },
        fhe: {
          registrationToken,
          wrappedDek: "wrapped-dek",
          prfSalt: "prf-salt",
          credentialId: "session-cred-id",
          keyId: "fhe-key-1",
          version: "v2",
          kekVersion: "v1",
        },
      });

      expect(result.sessionToken).toBeDefined();
      expect(result.expiresAt).toBeDefined();
      expect(result.keyId).toBe("fhe-key-1");
      // Verify cookie was set via resHeaders
      const setCookie = testResHeaders.get("Set-Cookie");
      expect(setCookie).toContain("better-auth.session_token=");
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("SameSite=Lax");
    });

    it("REJECTS duplicate credential ID (CONFLICT)", async () => {
      const userId = await createTestUser();
      await createTestPasskeyCredential({
        userId,
        credentialId: "existing-cred",
      });

      const caller = await createCaller(null);
      const keyPair = await createTestKeyPair();

      const options = await caller.getRegistrationOptions({
        email: "test@example.com",
      });
      const { registrationToken } = options;
      storeRegistrationBlob(registrationToken, {
        secretId: "secret-4",
        secretType: "fhe_keys",
        blobRef: "blob-ref",
        blobHash: "blob-hash",
        blobSize: 123,
      });

      await expect(
        caller.completeRegistration({
          challengeId: options.challengeId,
          email: "test@example.com",
          credential: {
            credentialId: "existing-cred", // Duplicate!
            publicKey: keyPair.cosePublicKeyBase64,
            counter: 0,
            deviceType: null,
            backedUp: false,
            transports: [],
          },
          fhe: {
            registrationToken,
            wrappedDek: "wrapped-dek",
            prfSalt: "prf-salt",
            credentialId: "existing-cred",
            keyId: "fhe-key-1",
            version: "v2",
            kekVersion: "v1",
          },
        })
      ).rejects.toMatchObject({
        code: "CONFLICT",
        message: "This passkey is already registered.",
      });
    });
  });

  describe("getAuthenticationOptions", () => {
    it("returns challenge and RP ID", async () => {
      const caller = await createCaller(null);

      const result = await caller.getAuthenticationOptions({});

      expect(result.challengeId).toBeDefined();
      expect(result.challenge).toBeDefined();
      expect(result.rpId).toBe(getRelyingPartyId());
    });

    it("returns allowCredentials when email provided", async () => {
      const userId = await createTestUser({ email: "auth@example.com" });
      await createTestPasskeyCredential({ userId, credentialId: "cred-1" });
      await createTestPasskeyCredential({ userId, credentialId: "cred-2" });

      const caller = await createCaller(null);

      const result = await caller.getAuthenticationOptions({
        email: "auth@example.com",
      });

      expect(result.allowCredentials).toHaveLength(2);
      expect(result.allowCredentials?.map((c) => c.id)).toContain("cred-1");
      expect(result.allowCredentials?.map((c) => c.id)).toContain("cred-2");
    });

    it("returns undefined allowCredentials without email", async () => {
      const caller = await createCaller(null);

      const result = await caller.getAuthenticationOptions({});

      expect(result.allowCredentials).toBeUndefined();
    });
  });

  describe("verifyAuthentication", () => {
    it("verifies assertion and creates session", async () => {
      const userId = await createTestUser({ email: "auth@example.com" });
      const { credentialId, keyPair } =
        await createTestPasskeyCredentialWithKeyPair({ userId, counter: 0 });

      const caller = await createCaller(null);

      const options = await caller.getAuthenticationOptions({
        email: "auth@example.com",
      });

      // Decode challenge from base64url
      const challengeBytes = Buffer.from(options.challenge, "base64url");
      const assertion = await createTestAssertion({
        credentialId,
        challenge: new Uint8Array(challengeBytes),
        origin: getExpectedOrigin(),
        rpId: getRelyingPartyId(),
        counter: 1,
        privateKey: keyPair.privateKey,
      });

      const result = await caller.verifyAuthentication({
        challengeId: options.challengeId,
        assertion,
      });

      expect(result.success).toBe(true);
      expect(result.userId).toBe(userId);
      expect(result.credentialId).toBe(credentialId);
      expect(result.newCounter).toBe(1);
      expect(result.sessionToken).toBeDefined();
    });

    it("REJECTS with UNAUTHORIZED on verification failure", async () => {
      const userId = await createTestUser();
      const { credentialId } = await createTestPasskeyCredentialWithKeyPair({
        userId,
        counter: 0,
      });

      const caller = await createCaller(null);

      const options = await caller.getAuthenticationOptions({});

      // Use wrong private key
      const wrongKeyPair = await createTestKeyPair();
      const challengeBytes = Buffer.from(options.challenge, "base64url");
      const assertion = await createTestAssertion({
        credentialId,
        challenge: new Uint8Array(challengeBytes),
        origin: getExpectedOrigin(),
        rpId: getRelyingPartyId(),
        counter: 1,
        privateKey: wrongKeyPair.privateKey,
      });

      await expect(
        caller.verifyAuthentication({
          challengeId: options.challengeId,
          assertion,
        })
      ).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    });
  });

  describe("listCredentials (protected)", () => {
    it("REJECTS unauthenticated requests", async () => {
      const caller = await createCaller(null);

      await expect(caller.listCredentials()).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    });

    it("returns only current user credentials", async () => {
      const userId = await createTestUser({ email: "owner@example.com" });
      const otherUserId = await createTestUser({ email: "other@example.com" });

      await createTestPasskeyCredential({ userId, name: "My Passkey" });
      await createTestPasskeyCredential({
        userId: otherUserId,
        name: "Other Passkey",
      });

      const session = createAuthSession(userId, "owner@example.com");
      const caller = await createCaller(session);

      const result = await caller.listCredentials();

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("My Passkey");
    });

    it("excludes sensitive fields", async () => {
      const userId = await createTestUser();
      await createTestPasskeyCredential({ userId });

      const session = createAuthSession(userId);
      const caller = await createCaller(session);

      const result = await caller.listCredentials();

      // Should NOT include publicKey
      expect(result[0]).not.toHaveProperty("publicKey");
      // Should include safe fields
      expect(result[0]).toHaveProperty("id");
      expect(result[0]).toHaveProperty("credentialId");
      expect(result[0]).toHaveProperty("name");
      expect(result[0]).toHaveProperty("deviceType");
    });
  });

  describe("addCredential (protected)", () => {
    it("REJECTS unauthenticated requests", async () => {
      const caller = await createCaller(null);
      const keyPair = await createTestKeyPair();

      await expect(
        caller.addCredential({
          challengeId: "test",
          credential: {
            credentialId: "new-cred",
            publicKey: keyPair.cosePublicKeyBase64,
            counter: 0,
            deviceType: null,
            backedUp: false,
            transports: [],
          },
        })
      ).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    });

    it("adds credential to current user", async () => {
      const userId = await createTestUser();
      await createTestPasskeyCredential({ userId, name: "First" }); // User already has one

      const session = createAuthSession(userId);
      const caller = await createCaller(session);
      const keyPair = await createTestKeyPair();

      const options = await caller.getAddCredentialOptions();

      const result = await caller.addCredential({
        challengeId: options.challengeId,
        credential: {
          credentialId: "second-cred",
          publicKey: keyPair.cosePublicKeyBase64,
          counter: 0,
          deviceType: "cross-platform",
          backedUp: true,
          transports: ["usb"],
          name: "Second Passkey",
        },
      });

      expect(result.success).toBe(true);
      expect(result.id).toBeDefined();
    });

    it("REJECTS duplicate credential ID", async () => {
      const userId = await createTestUser();
      await createTestPasskeyCredential({
        userId,
        credentialId: "existing-cred",
      });

      const session = createAuthSession(userId);
      const caller = await createCaller(session);
      const keyPair = await createTestKeyPair();

      const options = await caller.getAddCredentialOptions();

      await expect(
        caller.addCredential({
          challengeId: options.challengeId,
          credential: {
            credentialId: "existing-cred", // Duplicate!
            publicKey: keyPair.cosePublicKeyBase64,
            counter: 0,
            deviceType: null,
            backedUp: false,
            transports: [],
          },
        })
      ).rejects.toMatchObject({
        code: "CONFLICT",
      });
    });
  });

  describe("removeCredential (protected)", () => {
    it("REJECTS unauthenticated requests", async () => {
      const caller = await createCaller(null);

      await expect(
        caller.removeCredential({ credentialId: "test" })
      ).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    });

    it("removes credential belonging to current user", async () => {
      const userId = await createTestUser();
      await createTestPasskeyCredential({ userId, credentialId: "cred-1" });
      const credentialId = await createTestPasskeyCredential({
        userId,
        credentialId: "cred-2",
      });

      const session = createAuthSession(userId);
      const caller = await createCaller(session);

      const result = await caller.removeCredential({ credentialId });

      expect(result.success).toBe(true);

      // Verify it's gone
      const remaining = await caller.listCredentials();
      expect(remaining).toHaveLength(1);
    });

    it("REJECTS removing other user credential (NOT_FOUND)", async () => {
      const userId = await createTestUser({ email: "owner@example.com" });
      const otherUserId = await createTestUser({ email: "other@example.com" });
      // Owner needs at least 2 credentials to pass the "last credential" check
      await createTestPasskeyCredential({
        userId,
        credentialId: "owner-cred-1",
      });
      await createTestPasskeyCredential({
        userId,
        credentialId: "owner-cred-2",
      });

      const otherCredentialId = await createTestPasskeyCredential({
        userId: otherUserId,
        credentialId: "other-cred",
      });

      const session = createAuthSession(userId, "owner@example.com");
      const caller = await createCaller(session);

      await expect(
        caller.removeCredential({ credentialId: otherCredentialId })
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: "Passkey not found.",
      });
    });

    it("REJECTS removing last credential (PRECONDITION_FAILED)", async () => {
      const userId = await createTestUser();
      const credentialId = await createTestPasskeyCredential({ userId }); // Only one

      const session = createAuthSession(userId);
      const caller = await createCaller(session);

      await expect(
        caller.removeCredential({ credentialId })
      ).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: expect.stringContaining("Cannot remove your only passkey"),
      });
    });
  });

  describe("renameCredential (protected)", () => {
    it("REJECTS unauthenticated requests", async () => {
      const caller = await createCaller(null);

      await expect(
        caller.renameCredential({ credentialId: "test", name: "New Name" })
      ).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    });

    it("renames credential belonging to current user", async () => {
      const userId = await createTestUser();
      const credentialId = await createTestPasskeyCredential({
        userId,
        name: "Old Name",
      });

      const session = createAuthSession(userId);
      const caller = await createCaller(session);

      const result = await caller.renameCredential({
        credentialId,
        name: "New Name",
      });

      expect(result.success).toBe(true);

      // Verify the name changed
      const credentials = await caller.listCredentials();
      expect(credentials[0].name).toBe("New Name");
    });

    it("REJECTS renaming other user credential (NOT_FOUND)", async () => {
      const userId = await createTestUser({ email: "owner@example.com" });
      const otherUserId = await createTestUser({ email: "other@example.com" });

      const otherCredentialId = await createTestPasskeyCredential({
        userId: otherUserId,
        credentialId: "other-cred",
      });

      const session = createAuthSession(userId, "owner@example.com");
      const caller = await createCaller(session);

      await expect(
        caller.renameCredential({
          credentialId: otherCredentialId,
          name: "Hijacked Name",
        })
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: "Passkey not found.",
      });
    });
  });

  describe("getAddCredentialOptions (protected)", () => {
    it("REJECTS unauthenticated requests", async () => {
      const caller = await createCaller(null);

      await expect(caller.getAddCredentialOptions()).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    });

    it("returns challenge with user info", async () => {
      const userId = await createTestUser({ email: "user@example.com" });

      const session = createAuthSession(userId, "user@example.com");
      const caller = await createCaller(session);

      const result = await caller.getAddCredentialOptions();

      expect(result.challengeId).toBeDefined();
      expect(result.challenge).toBeDefined();
      expect(result.user.id).toBe(userId);
      expect(result.user.email).toBe("user@example.com");
      expect(result.rp.id).toBe(getRelyingPartyId());
    });

    it("returns excludeCredentials list", async () => {
      const userId = await createTestUser({ email: "user@example.com" });
      await createTestPasskeyCredential({ userId, credentialId: "existing-1" });
      await createTestPasskeyCredential({ userId, credentialId: "existing-2" });

      const session = createAuthSession(userId, "user@example.com");
      const caller = await createCaller(session);

      const result = await caller.getAddCredentialOptions();

      expect(result.excludeCredentials).toHaveLength(2);
      expect(result.excludeCredentials.map((c) => c.id)).toContain(
        "existing-1"
      );
      expect(result.excludeCredentials.map((c) => c.id)).toContain(
        "existing-2"
      );
    });
  });

  describe("input validation", () => {
    it("REJECTS invalid email format in registration", async () => {
      const caller = await createCaller(null);

      await expect(
        caller.getRegistrationOptions({ email: "not-an-email" })
      ).rejects.toThrow();
    });

    it("REJECTS empty credential name in rename", async () => {
      const userId = await createTestUser();
      const credentialId = await createTestPasskeyCredential({ userId });

      const session = createAuthSession(userId);
      const caller = await createCaller(session);

      await expect(
        caller.renameCredential({ credentialId, name: "" })
      ).rejects.toThrow();
    });

    it("REJECTS name > 100 characters in rename", async () => {
      const userId = await createTestUser();
      const credentialId = await createTestPasskeyCredential({ userId });

      const session = createAuthSession(userId);
      const caller = await createCaller(session);

      const longName = "a".repeat(101);
      await expect(
        caller.renameCredential({ credentialId, name: longName })
      ).rejects.toThrow();
    });
  });
});
