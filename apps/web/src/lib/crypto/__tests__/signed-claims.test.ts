import { describe, expect, it, vi } from "vitest";

// Mock the env module before importing the module under test
vi.mock("@/lib/utils/env", () => ({
  getBetterAuthSecret: () => "test-secret-at-least-32-characters-long",
}));

// Mock server-only (no-op in test environment)
vi.mock("server-only", () => ({}));

import {
  type AttestationClaimPayload,
  type FaceMatchClaimData,
  type LivenessClaimData,
  signAttestationClaim,
  verifyAttestationClaim,
} from "../signed-claims";

describe("signed-claims", () => {
  const policyVersion = "test-policy-v1";
  const validLivenessClaim: AttestationClaimPayload = {
    type: "liveness_score",
    userId: "user-123",
    issuedAt: new Date().toISOString(),
    version: 1,
    policyVersion,
    data: {
      antispoofScore: 0.95,
      liveScore: 0.98,
      passed: true,
      antispoofScoreFixed: 9500,
      liveScoreFixed: 9800,
    } as LivenessClaimData,
  };

  const validFaceMatchClaim: AttestationClaimPayload = {
    type: "face_match_score",
    userId: "user-456",
    issuedAt: new Date().toISOString(),
    version: 1,
    policyVersion,
    documentHash: "doc-hash-abc",
    documentHashField: "0x1234",
    data: {
      confidence: 0.92,
      confidenceFixed: 9200,
      thresholdFixed: 6000,
      passed: true,
      claimHash: "0x5678",
    } as FaceMatchClaimData,
  };

  describe("signAttestationClaim", () => {
    it("signs a valid liveness claim payload", async () => {
      const token = await signAttestationClaim(validLivenessClaim);

      expect(token).toBeDefined();
      expect(typeof token).toBe("string");
      // JWT has 3 parts separated by dots
      expect(token.split(".")).toHaveLength(3);
    });

    it("signs a valid face match claim payload", async () => {
      const token = await signAttestationClaim(validFaceMatchClaim);

      expect(token).toBeDefined();
      expect(typeof token).toBe("string");
      expect(token.split(".")).toHaveLength(3);
    });

    it("produces different tokens for different claims", async () => {
      const token1 = await signAttestationClaim(validLivenessClaim);
      const token2 = await signAttestationClaim(validFaceMatchClaim);

      expect(token1).not.toBe(token2);
    });

    it("produces different tokens for same claim (unique jti)", async () => {
      const token1 = await signAttestationClaim(validLivenessClaim);
      const token2 = await signAttestationClaim(validLivenessClaim);

      // Same payload but different jti (UUID) each time
      expect(token1).not.toBe(token2);
    });
  });

  describe("verifyAttestationClaim - success cases", () => {
    it("verifies a valid liveness score claim", async () => {
      const token = await signAttestationClaim(validLivenessClaim);
      const payload = await verifyAttestationClaim(token);

      expect(payload.type).toBe("liveness_score");
      expect(payload.userId).toBe("user-123");
      expect(payload.version).toBe(1);
      expect((payload.data as LivenessClaimData).passed).toBe(true);
    });

    it("verifies a valid face match claim", async () => {
      const token = await signAttestationClaim(validFaceMatchClaim);
      const payload = await verifyAttestationClaim(token);

      expect(payload.type).toBe("face_match_score");
      expect(payload.userId).toBe("user-456");
      expect(payload.documentHash).toBe("doc-hash-abc");
      expect((payload.data as FaceMatchClaimData).confidence).toBe(0.92);
    });

    it("verifies with expected type matching", async () => {
      const token = await signAttestationClaim(validLivenessClaim);
      const payload = await verifyAttestationClaim(token, "liveness_score");

      expect(payload.type).toBe("liveness_score");
    });

    it("verifies with expected user matching", async () => {
      const token = await signAttestationClaim(validLivenessClaim);
      const payload = await verifyAttestationClaim(
        token,
        undefined,
        "user-123",
      );

      expect(payload.userId).toBe("user-123");
    });

    it("verifies with both type and user matching", async () => {
      const token = await signAttestationClaim(validLivenessClaim);
      const payload = await verifyAttestationClaim(
        token,
        "liveness_score",
        "user-123",
      );

      expect(payload.type).toBe("liveness_score");
      expect(payload.userId).toBe("user-123");
    });
  });

  describe("verifyAttestationClaim - security failure cases", () => {
    it("rejects tampered signature", async () => {
      const token = await signAttestationClaim(validLivenessClaim);
      // Tamper with the signature (last part of JWT)
      const parts = token.split(".");
      parts[2] = `${parts[2].slice(0, -5)}XXXXX`;
      const tamperedToken = parts.join(".");

      await expect(verifyAttestationClaim(tamperedToken)).rejects.toThrow();
    });

    it("rejects tampered payload", async () => {
      const token = await signAttestationClaim(validLivenessClaim);
      // Tamper with the payload (middle part of JWT)
      const parts = token.split(".");
      parts[1] = `${parts[1].slice(0, -3)}YYY`;
      const tamperedToken = parts.join(".");

      await expect(verifyAttestationClaim(tamperedToken)).rejects.toThrow();
    });

    it("rejects claim type mismatch", async () => {
      const token = await signAttestationClaim(validLivenessClaim);

      await expect(
        verifyAttestationClaim(token, "face_match_score"),
      ).rejects.toThrow("Claim type mismatch: expected face_match_score");
    });

    it("rejects user ID mismatch", async () => {
      const token = await signAttestationClaim(validLivenessClaim);

      await expect(
        verifyAttestationClaim(token, undefined, "different-user"),
      ).rejects.toThrow("Claim user mismatch");
    });

    it("rejects malformed JWT token", async () => {
      await expect(verifyAttestationClaim("not-a-jwt")).rejects.toThrow();
    });

    it("rejects JWT with wrong structure", async () => {
      await expect(verifyAttestationClaim("a.b")).rejects.toThrow();
    });

    it("rejects empty token", async () => {
      await expect(verifyAttestationClaim("")).rejects.toThrow();
    });
  });

  describe("verifyAttestationClaim - payload validation", () => {
    it("preserves all claim data fields", async () => {
      const token = await signAttestationClaim(validLivenessClaim);
      const payload = await verifyAttestationClaim(token);

      const data = payload.data as LivenessClaimData;
      expect(data.antispoofScore).toBe(0.95);
      expect(data.liveScore).toBe(0.98);
      expect(data.passed).toBe(true);
      expect(data.antispoofScoreFixed).toBe(9500);
      expect(data.liveScoreFixed).toBe(9800);
    });

    it("preserves optional documentHash when present", async () => {
      const token = await signAttestationClaim(validFaceMatchClaim);
      const payload = await verifyAttestationClaim(token);

      expect(payload.documentHash).toBe("doc-hash-abc");
    });

    it("handles null documentHash", async () => {
      const claimWithNullDocHash: AttestationClaimPayload = {
        ...validLivenessClaim,
        documentHash: null,
      };
      const token = await signAttestationClaim(claimWithNullDocHash);
      const payload = await verifyAttestationClaim(token);

      expect(payload.documentHash).toBeNull();
    });

    it("handles undefined documentHash", async () => {
      const claimWithoutDocHash: AttestationClaimPayload = {
        type: "liveness_score",
        userId: "user-789",
        issuedAt: new Date().toISOString(),
        version: 1,
        policyVersion,
        data: validLivenessClaim.data,
      };
      const token = await signAttestationClaim(claimWithoutDocHash);
      const payload = await verifyAttestationClaim(token);

      expect(payload.documentHash).toBeUndefined();
    });
  });
});
