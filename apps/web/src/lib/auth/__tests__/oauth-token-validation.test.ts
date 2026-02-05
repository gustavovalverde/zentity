import crypto from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock server-only
vi.mock("server-only", () => ({}));

vi.mock("better-auth/oauth2", () => ({
  verifyAccessToken: vi.fn(),
}));

// Mock database
vi.mock("@/lib/db/connection", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => ({
            get: vi.fn(),
          })),
        })),
      })),
    })),
  },
}));

import { verifyAccessToken } from "better-auth/oauth2";

import {
  computeKeyFingerprint,
  extractBearerToken,
  isValidX25519PublicKey,
  validateOAuthAccessToken,
} from "../oauth-token-validation";

// Regex for validating SHA-256 hex fingerprint (64 hex characters)
const SHA256_HEX_REGEX = /^[a-f0-9]{64}$/;

describe("oauth token validation", () => {
  describe("extractBearerToken", () => {
    it("extracts token from valid Authorization header", () => {
      const headers = new Headers({
        Authorization: "Bearer test-token-123",
      });
      expect(extractBearerToken(headers)).toBe("test-token-123");
    });

    it("returns null when no Authorization header", () => {
      const headers = new Headers();
      expect(extractBearerToken(headers)).toBeNull();
    });

    it("returns null when Authorization is not Bearer", () => {
      const headers = new Headers({
        Authorization: "Basic dXNlcjpwYXNz",
      });
      expect(extractBearerToken(headers)).toBeNull();
    });

    it("handles case-sensitive Bearer prefix", () => {
      const headers = new Headers({
        Authorization: "bearer test-token",
      });
      // Bearer is case-sensitive per RFC 6750
      expect(extractBearerToken(headers)).toBeNull();
    });

    it("extracts token with special characters", () => {
      const headers = new Headers({
        Authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test",
      });
      expect(extractBearerToken(headers)).toBe(
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test"
      );
    });
  });

  describe("computeKeyFingerprint", () => {
    it("computes SHA-256 fingerprint of base64 key", async () => {
      const keyBytes = crypto.randomBytes(32);
      const keyBase64 = keyBytes.toString("base64");

      const fingerprint = await computeKeyFingerprint(keyBase64);

      // Fingerprint should be hex string of SHA-256 hash
      expect(fingerprint).toMatch(SHA256_HEX_REGEX);

      // Should be deterministic
      const fingerprint2 = await computeKeyFingerprint(keyBase64);
      expect(fingerprint).toBe(fingerprint2);
    });

    it("produces different fingerprints for different keys", async () => {
      const key1 = crypto.randomBytes(32).toString("base64");
      const key2 = crypto.randomBytes(32).toString("base64");

      const fp1 = await computeKeyFingerprint(key1);
      const fp2 = await computeKeyFingerprint(key2);

      expect(fp1).not.toBe(fp2);
    });
  });

  describe("isValidX25519PublicKey", () => {
    it("returns true for valid 32-byte key", () => {
      const validKey = crypto.randomBytes(32).toString("base64");
      expect(isValidX25519PublicKey(validKey)).toBe(true);
    });

    it("returns false for key that is too short", () => {
      const shortKey = crypto.randomBytes(16).toString("base64");
      expect(isValidX25519PublicKey(shortKey)).toBe(false);
    });

    it("returns false for key that is too long", () => {
      const longKey = crypto.randomBytes(64).toString("base64");
      expect(isValidX25519PublicKey(longKey)).toBe(false);
    });

    it("returns false for invalid base64", () => {
      expect(isValidX25519PublicKey("not-valid-base64!!!")).toBe(false);
    });

    it("returns false for empty string", () => {
      expect(isValidX25519PublicKey("")).toBe(false);
    });
  });

  describe("validateOAuthAccessToken", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("returns invalid for invalid token", async () => {
      vi.mocked(verifyAccessToken).mockRejectedValueOnce(
        new Error("token invalid")
      );

      const result = await validateOAuthAccessToken("invalid-token");
      expect(result.valid).toBe(false);
      expect(result.error).toBe("token invalid");
    });

    it("returns invalid for user token (not client credentials)", async () => {
      vi.mocked(verifyAccessToken).mockResolvedValueOnce({
        sub: "user-123",
        azp: "test-client",
        scope: "compliance:key:read",
      });

      const result = await validateOAuthAccessToken("user-token");
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Not a client credentials token");
    });

    it("returns invalid when client_id is missing", async () => {
      vi.mocked(verifyAccessToken).mockResolvedValueOnce({
        scope: "compliance:key:read",
      });

      const result = await validateOAuthAccessToken("missing-client");
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Missing client_id");
    });

    it("returns invalid when client is disabled", async () => {
      const { db } = await import("@/lib/db/connection");
      vi.mocked(verifyAccessToken).mockResolvedValueOnce({
        azp: "test-client",
        scope: "compliance:key:read",
      });

      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              get: vi.fn().mockResolvedValue({ disabled: true }),
            }),
          }),
        }),
      } as unknown as ReturnType<typeof db.select>);

      const result = await validateOAuthAccessToken("disabled-client");
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Client disabled");
    });

    it("returns invalid when client not found", async () => {
      const { db } = await import("@/lib/db/connection");
      vi.mocked(verifyAccessToken).mockResolvedValueOnce({
        azp: "missing-client",
        scope: "compliance:key:read",
      });

      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              get: vi.fn().mockResolvedValue(undefined),
            }),
          }),
        }),
      } as unknown as ReturnType<typeof db.select>);

      const result = await validateOAuthAccessToken("missing-client");
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Client not found");
    });

    it("returns valid with client info for valid client credentials token", async () => {
      const { db } = await import("@/lib/db/connection");
      vi.mocked(verifyAccessToken).mockResolvedValueOnce({
        azp: "test-client",
        scope: "compliance:key:read compliance:key:write",
      });

      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              get: vi.fn().mockResolvedValue({ disabled: false }),
            }),
          }),
        }),
      } as unknown as ReturnType<typeof db.select>);

      const result = await validateOAuthAccessToken("valid-token");
      expect(result.valid).toBe(true);
      expect(result.clientId).toBe("test-client");
      expect(result.scopes).toEqual([
        "compliance:key:read",
        "compliance:key:write",
      ]);
    });
  });
});
