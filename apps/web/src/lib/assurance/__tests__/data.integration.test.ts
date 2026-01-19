/**
 * Assurance Data Layer Integration Tests
 *
 * Tests tier computation with real database queries.
 * Covers the full tier progression path from Tier 0 to Tier 2.
 */
import crypto from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import {
  createBlockchainAttestation,
  updateBlockchainAttestationConfirmed,
} from "@/lib/db/queries/attestation";
import {
  insertEncryptedAttribute,
  insertSignedClaim,
  insertZkProofRecord,
} from "@/lib/db/queries/crypto";
import {
  createIdentityDocument,
  upsertIdentityBundle,
} from "@/lib/db/queries/identity";
import { createTestUser, resetDatabase } from "@/test/db-test-utils";

import { getAssuranceState, getUnauthenticatedAssuranceState } from "../data";

/**
 * Helper to create a verified identity document with all required fields
 */
async function createVerifiedDocument(
  docId: string,
  userId: string,
  options?: { documentType?: string; issuerCountry?: string }
) {
  await createIdentityDocument({
    id: docId,
    userId,
    documentType: options?.documentType ?? "passport",
    issuerCountry: options?.issuerCountry ?? "US",
    documentHash: crypto.randomBytes(32).toString("hex"),
    nameCommitment: crypto.randomBytes(32).toString("hex"),
    status: "verified",
    verifiedAt: new Date().toISOString(),
    confidenceScore: 0.95,
  });
}

/**
 * Helper to create identity bundle with FHE keys (required for Tier 1+)
 */
async function createBundleWithKeys(userId: string) {
  await upsertIdentityBundle({
    userId,
    fheKeyId: crypto.randomUUID(),
    fheStatus: "complete",
  });
}

describe("assurance data layer", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  describe("getUnauthenticatedAssuranceState", () => {
    it("returns Tier 0 for unauthenticated users", () => {
      const state = getUnauthenticatedAssuranceState();

      expect(state.tier).toBe(0);
      expect(state.tierName).toBe("Anonymous");
      expect(state.authStrength).toBe("basic");
      expect(state.loginMethod).toBe("none");
    });
  });

  describe("getAssuranceState - authenticated", () => {
    it("returns Tier 0 for authenticated user without secured keys", async () => {
      const userId = await createTestUser();
      const mockSession = createMockSession(userId, "opaque");

      const state = await getAssuranceState(userId, mockSession);

      expect(state.tier).toBe(0);
      expect(state.tierName).toBe("Anonymous");
      expect(state.authStrength).toBe("basic");
      expect(state.loginMethod).toBe("opaque");
      expect(state.details.isAuthenticated).toBe(true);
      expect(state.details.hasSecuredKeys).toBe(false);
    });

    it("returns Tier 1 for authenticated user with secured keys", async () => {
      const userId = await createTestUser();
      const mockSession = createMockSession(userId, "opaque");
      await createBundleWithKeys(userId);

      const state = await getAssuranceState(userId, mockSession);

      expect(state.tier).toBe(1);
      expect(state.tierName).toBe("Account");
      expect(state.authStrength).toBe("basic");
      expect(state.loginMethod).toBe("opaque");
      expect(state.details.hasSecuredKeys).toBe(true);
    });

    it("returns strong auth for passkey authentication", async () => {
      const userId = await createTestUser();
      const mockSession = createMockSession(userId, "passkey");
      await createBundleWithKeys(userId);

      const state = await getAssuranceState(userId, mockSession);

      expect(state.tier).toBe(1);
      expect(state.authStrength).toBe("strong");
      expect(state.loginMethod).toBe("passkey");
    });

    it("tracks document verification status", async () => {
      const userId = await createTestUser();
      const mockSession = createMockSession(userId, "opaque");
      await createBundleWithKeys(userId);

      const docId = crypto.randomUUID();
      await createVerifiedDocument(docId, userId);

      const state = await getAssuranceState(userId, mockSession);

      expect(state.details.documentVerified).toBe(true);
    });

    it("tracks liveness from signed claims", async () => {
      const userId = await createTestUser();
      const mockSession = createMockSession(userId, "opaque");
      await createBundleWithKeys(userId);

      const docId = crypto.randomUUID();
      await createVerifiedDocument(docId, userId);

      await insertSignedClaim({
        id: crypto.randomUUID(),
        userId,
        documentId: docId,
        claimType: "liveness_score",
        claimPayload: JSON.stringify({ score: 0.95 }),
        signature: crypto.randomBytes(64).toString("hex"),
        issuedAt: new Date().toISOString(),
      });

      const state = await getAssuranceState(userId, mockSession);

      expect(state.details.livenessVerified).toBe(true);
      expect(state.details.faceMatchVerified).toBe(false);
    });

    it("tracks face match from signed claims", async () => {
      const userId = await createTestUser();
      const mockSession = createMockSession(userId, "opaque");
      await createBundleWithKeys(userId);

      const docId = crypto.randomUUID();
      await createVerifiedDocument(docId, userId);

      await insertSignedClaim({
        id: crypto.randomUUID(),
        userId,
        documentId: docId,
        claimType: "face_match_score",
        claimPayload: JSON.stringify({ score: 0.95 }),
        signature: crypto.randomBytes(64).toString("hex"),
        issuedAt: new Date().toISOString(),
      });

      const state = await getAssuranceState(userId, mockSession);

      expect(state.details.faceMatchVerified).toBe(true);
    });

    it("tracks ZK proof completion", async () => {
      const userId = await createTestUser();
      const mockSession = createMockSession(userId, "opaque");
      await createBundleWithKeys(userId);

      const docId = crypto.randomUUID();
      await createVerifiedDocument(docId, userId);

      const proofTypes = [
        "age_verification",
        "doc_validity",
        "nationality_membership",
        "face_match",
      ];
      for (const proofType of proofTypes) {
        await insertZkProofRecord({
          id: crypto.randomUUID(),
          userId,
          documentId: docId,
          proofType,
          proofHash: crypto.randomBytes(32).toString("hex"),
          proofPayload: crypto.randomBytes(256).toString("hex"),
          verified: true,
        });
      }

      const state = await getAssuranceState(userId, mockSession);

      expect(state.details.zkProofsComplete).toBe(true);
    });

    it("tracks FHE encryption completion", async () => {
      const userId = await createTestUser();
      const mockSession = createMockSession(userId, "opaque");
      await createBundleWithKeys(userId);

      await insertEncryptedAttribute({
        id: crypto.randomUUID(),
        userId,
        source: "fhe-service",
        attributeType: "birth_year_offset",
        ciphertext: crypto.randomBytes(256),
      });

      const state = await getAssuranceState(userId, mockSession);

      expect(state.details.fheComplete).toBe(true);
    });

    it("tracks on-chain attestation", async () => {
      const userId = await createTestUser();
      const mockSession = createMockSession(userId, "opaque");
      await createBundleWithKeys(userId);

      const attestation = await createBlockchainAttestation({
        userId,
        walletAddress: "0x1234567890abcdef1234567890abcdef12345678",
        networkId: "sepolia",
        chainId: 11_155_111,
      });
      await updateBlockchainAttestationConfirmed(attestation.id, 12_345);

      const state = await getAssuranceState(userId, mockSession);

      expect(state.details.onChainAttested).toBe(true);
    });
  });

  describe("tier progression", () => {
    it("computes Tier 1 for authenticated user with keys", async () => {
      const userId = await createTestUser();
      const mockSession = createMockSession(userId, "opaque");
      await createBundleWithKeys(userId);

      const state = await getAssuranceState(userId, mockSession);

      expect(state.tier).toBe(1);
      expect(state.tierName).toBe("Account");
    });

    it("stays at Tier 1 when identity verified but proofs missing", async () => {
      const userId = await createTestUser();
      const mockSession = createMockSession(userId, "opaque");
      await createBundleWithKeys(userId);

      const docId = crypto.randomUUID();
      await createVerifiedDocument(docId, userId);

      // Add signed claims for identity verification
      for (const claimType of ["liveness_score", "face_match_score"]) {
        await insertSignedClaim({
          id: crypto.randomUUID(),
          userId,
          documentId: docId,
          claimType,
          claimPayload: JSON.stringify({ score: 0.95 }),
          signature: crypto.randomBytes(64).toString("hex"),
          issuedAt: new Date().toISOString(),
        });
      }

      const state = await getAssuranceState(userId, mockSession);

      expect(state.tier).toBe(1);
      expect(state.details.hasIncompleteProofs).toBe(true);
      expect(state.details.documentVerified).toBe(true);
      expect(state.details.livenessVerified).toBe(true);
      expect(state.details.faceMatchVerified).toBe(true);
      expect(state.details.zkProofsComplete).toBe(false);
    });

    it("computes Tier 2 for fully verified user", async () => {
      const userId = await createTestUser();
      const mockSession = createMockSession(userId, "passkey");
      await createBundleWithKeys(userId);

      const docId = crypto.randomUUID();
      await createVerifiedDocument(docId, userId);

      // Signed claims
      for (const claimType of [
        "ocr_result",
        "liveness_score",
        "face_match_score",
      ]) {
        await insertSignedClaim({
          id: crypto.randomUUID(),
          userId,
          documentId: docId,
          claimType,
          claimPayload: JSON.stringify({ data: "test" }),
          signature: crypto.randomBytes(64).toString("hex"),
          issuedAt: new Date().toISOString(),
        });
      }

      // All ZK proofs
      for (const proofType of [
        "age_verification",
        "doc_validity",
        "nationality_membership",
        "face_match",
      ]) {
        await insertZkProofRecord({
          id: crypto.randomUUID(),
          userId,
          documentId: docId,
          proofType,
          proofHash: crypto.randomBytes(32).toString("hex"),
          proofPayload: crypto.randomBytes(256).toString("hex"),
          verified: true,
        });
      }

      // FHE attributes
      await insertEncryptedAttribute({
        id: crypto.randomUUID(),
        userId,
        source: "fhe-service",
        attributeType: "birth_year_offset",
        ciphertext: crypto.randomBytes(256),
      });

      const state = await getAssuranceState(userId, mockSession);

      expect(state.tier).toBe(2);
      expect(state.tierName).toBe("Verified");
      expect(state.authStrength).toBe("strong");
      expect(state.details.hasIncompleteProofs).toBe(false);
    });
  });
});

/**
 * Create a mock session object for testing
 */
function createMockSession(userId: string, loginMethod: string) {
  const now = new Date();
  return {
    user: {
      id: userId,
      name: "Test User",
      email: `test-${userId}@example.com`,
      emailVerified: true,
      isAnonymous: false,
      twoFactorEnabled: loginMethod === "passkey",
      createdAt: now,
      updatedAt: now,
    },
    session: {
      id: crypto.randomUUID(),
      userId,
      lastLoginMethod: loginMethod,
      expiresAt: new Date(Date.now() + 86_400_000),
      createdAt: now,
      updatedAt: now,
      token: crypto.randomBytes(32).toString("hex"),
    },
  } as Parameters<typeof getAssuranceState>[1];
}
