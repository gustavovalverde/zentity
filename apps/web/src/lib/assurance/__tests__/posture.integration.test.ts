import type { LoginMethod } from "@/lib/assurance/types";
import type { Session } from "@/lib/auth/auth-config";

import crypto from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import {
  getAccountAssurance,
  getSecurityPosture,
  getSecurityPostureForSession,
  getUnauthenticatedSecurityPosture,
} from "@/lib/assurance/posture";
import { createAuthenticationContext } from "@/lib/auth/auth-context";
import { POLICY_VERSION } from "@/lib/blockchain/attestation/policy";
import { db } from "@/lib/db/connection";
import {
  createBlockchainAttestation,
  updateBlockchainAttestationConfirmed,
} from "@/lib/db/queries/attestation";
import {
  createVerification,
  upsertIdentityBundle,
} from "@/lib/db/queries/identity";
import {
  createProofSession,
  insertEncryptedAttribute,
  insertProofArtifact,
  insertSignedClaim,
} from "@/lib/db/queries/privacy";
import { passkeys, sessions } from "@/lib/db/schema/auth";
import { materializeVerificationChecks } from "@/lib/identity/verification/materialize";
import { createTestUser, resetDatabase } from "@/test-utils/db-test-utils";

async function createVerifiedDocument(docId: string, userId: string) {
  await createVerification({
    id: docId,
    userId,
    method: "ocr",
    documentHash: crypto.randomBytes(32).toString("hex"),
    nameCommitment: crypto.randomBytes(32).toString("hex"),
    status: "verified",
    verifiedAt: new Date().toISOString(),
    confidenceScore: 0.95,
  });
}

async function createBundleWithKeys(userId: string) {
  await upsertIdentityBundle({
    userId,
    fheKeyId: crypto.randomUUID(),
    fheStatus: "complete",
  });
}

async function setupProofSession(
  userId: string,
  verificationId: string,
  policyVersion = POLICY_VERSION
) {
  const sessionId = crypto.randomUUID();
  const now = Date.now();
  await createProofSession({
    id: sessionId,
    userId,
    verificationId,
    msgSender: userId,
    audience: "http://localhost:3000",
    policyVersion,
    createdAt: now,
    expiresAt: now + 60_000,
  });
  return sessionId;
}

async function createPasskeyCredential(userId: string) {
  await db
    .insert(passkeys)
    .values({
      id: crypto.randomUUID(),
      name: "Test passkey",
      publicKey: "test-public-key",
      userId,
      credentialID: crypto.randomUUID(),
      counter: 0,
      deviceType: "singleDevice",
      backedUp: true,
      transports: JSON.stringify(["internal"]),
    })
    .run();
}

async function createSessionWithAuthContext(
  userId: string,
  loginMethod: LoginMethod
): Promise<Session> {
  const now = new Date();
  const sessionId = crypto.randomUUID();
  const token = crypto.randomBytes(32).toString("hex");
  const auth = await createAuthenticationContext({
    userId,
    loginMethod,
    authenticatedAt: now,
    sourceKind: "better_auth",
    sourceSessionId: sessionId,
    referenceType: "session",
    referenceId: sessionId,
  });

  await db
    .insert(sessions)
    .values({
      id: sessionId,
      userId,
      token,
      authContextId: auth.id,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    })
    .run();

  return {
    user: {
      id: userId,
    },
    session: {
      id: sessionId,
      authContextId: auth.id,
      userId,
      expiresAt: new Date(Date.now() + 86_400_000),
      createdAt: now,
      updatedAt: now,
      token,
    },
  } as unknown as Session;
}

async function seedFullyVerifiedIdentity(userId: string) {
  await createBundleWithKeys(userId);

  const docId = crypto.randomUUID();
  await createVerifiedDocument(docId, userId);

  for (const claimType of [
    "ocr_result",
    "liveness_score",
    "face_match_score",
  ]) {
    await insertSignedClaim({
      id: crypto.randomUUID(),
      userId,
      verificationId: docId,
      claimType,
      claimPayload: JSON.stringify({ data: "test" }),
      signature: crypto.randomBytes(64).toString("hex"),
      issuedAt: new Date().toISOString(),
    });
  }

  const proofSessionId = await setupProofSession(userId, docId);
  for (const proofType of [
    "age_verification",
    "doc_validity",
    "nationality_membership",
    "face_match",
    "identity_binding",
  ]) {
    await insertProofArtifact({
      id: crypto.randomUUID(),
      userId,
      verificationId: docId,
      proofSessionId,
      proofSystem: "noir_ultrahonk",
      proofType,
      proofHash: crypto.randomBytes(32).toString("hex"),
      proofPayload: crypto.randomBytes(256).toString("hex"),
      policyVersion: POLICY_VERSION,
      verified: true,
    });
  }

  await insertEncryptedAttribute({
    id: crypto.randomUUID(),
    userId,
    source: "fhe-service",
    attributeType: "birth_year_offset",
    ciphertext: crypto.randomBytes(256),
  });
  await insertEncryptedAttribute({
    id: crypto.randomUUID(),
    userId,
    source: "fhe-service",
    attributeType: "liveness_score",
    ciphertext: crypto.randomBytes(256),
  });

  await materializeVerificationChecks(userId, docId);

  return { docId };
}

describe("assurance data layer", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("returns an unauthenticated posture for anonymous users", () => {
    const posture = getUnauthenticatedSecurityPosture();

    expect(posture.assurance.tier).toBe(0);
    expect(posture.auth).toBeNull();
    expect(posture.capabilities).toEqual({
      hasPasskeys: false,
      hasOpaqueAccount: false,
      hasWalletAuth: false,
    });
  });

  it("treats bootstrap sessions without auth context as unauthenticated", async () => {
    const userId = await createTestUser();
    const now = new Date();
    const sessionId = crypto.randomUUID();
    const token = crypto.randomBytes(32).toString("hex");

    await db
      .insert(sessions)
      .values({
        id: sessionId,
        userId,
        token,
        authContextId: null,
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      })
      .run();

    const posture = await getSecurityPostureForSession(userId, {
      user: { id: userId },
      session: {
        id: sessionId,
        userId,
        token,
        authContextId: null,
        expiresAt: new Date(Date.now() + 86_400_000),
        createdAt: now,
        updatedAt: now,
      },
    } as unknown as Session);

    expect(posture.auth).toBeNull();
    expect(posture.assurance.details.isAuthenticated).toBe(false);
  });

  it("returns tier 0 for a user without secured keys", async () => {
    const userId = await createTestUser();

    const assurance = await getAccountAssurance(userId);

    expect(assurance.tier).toBe(0);
    expect(assurance.details.isAuthenticated).toBe(true);
    expect(assurance.details.hasSecuredKeys).toBe(false);
  });

  it("resolves auth provenance from the bound authentication context", async () => {
    const userId = await createTestUser();
    await createBundleWithKeys(userId);
    await createPasskeyCredential(userId);
    const session = await createSessionWithAuthContext(userId, "passkey");

    const posture = await getSecurityPostureForSession(userId, session);

    expect(posture.assurance.tier).toBe(1);
    expect(posture.auth).toMatchObject({
      loginMethod: "passkey",
      authStrength: "strong",
      sourceKind: "better_auth",
    });
    expect(posture.capabilities.hasPasskeys).toBe(true);
  });

  it("does not infer passkey auth from passkey enrollment alone", async () => {
    const userId = await createTestUser();
    await createBundleWithKeys(userId);
    await createPasskeyCredential(userId);

    const posture = await getSecurityPosture({
      userId,
      presentedAuth: null,
    });

    expect(posture.assurance.tier).toBe(0);
    expect(posture.auth).toBeNull();
    expect(posture.capabilities.hasPasskeys).toBe(true);
  });

  it("computes tier 2 for a fully verified user", async () => {
    const userId = await createTestUser();
    await seedFullyVerifiedIdentity(userId);

    const assurance = await getAccountAssurance(userId);

    expect(assurance.tier).toBe(2);
    expect(assurance.details.documentVerified).toBe(true);
    expect(assurance.details.livenessVerified).toBe(true);
    expect(assurance.details.faceMatchVerified).toBe(true);
    expect(assurance.details.zkProofsComplete).toBe(true);
    expect(assurance.details.fheComplete).toBe(true);
    expect(assurance.details.hasIncompleteProofs).toBe(false);
  });

  it("tracks on-chain attestation independently from authentication state", async () => {
    const userId = await createTestUser();
    await createBundleWithKeys(userId);

    const attestation = await createBlockchainAttestation({
      userId,
      walletAddress: "0x1234567890abcdef1234567890abcdef12345678",
      networkId: "sepolia",
      chainId: 11_155_111,
    });
    await updateBlockchainAttestationConfirmed(attestation.id, 12_345);

    const assurance = await getAccountAssurance(userId);
    expect(assurance.details.onChainAttested).toBe(true);
  });

  it("does not combine OCR proofs from different sessions", async () => {
    const userId = await createTestUser();
    await createBundleWithKeys(userId);

    const docId = crypto.randomUUID();
    await createVerifiedDocument(docId, userId);

    for (const claimType of [
      "ocr_result",
      "liveness_score",
      "face_match_score",
    ]) {
      await insertSignedClaim({
        id: crypto.randomUUID(),
        userId,
        verificationId: docId,
        claimType,
        claimPayload: JSON.stringify({ data: "test" }),
        signature: crypto.randomBytes(64).toString("hex"),
        issuedAt: new Date().toISOString(),
      });
    }

    const firstSessionId = await setupProofSession(userId, docId);
    for (const proofType of [
      "age_verification",
      "doc_validity",
      "face_match",
    ]) {
      await insertProofArtifact({
        id: crypto.randomUUID(),
        userId,
        verificationId: docId,
        proofSessionId: firstSessionId,
        proofSystem: "noir_ultrahonk",
        proofType,
        proofHash: crypto.randomBytes(32).toString("hex"),
        proofPayload: crypto.randomBytes(256).toString("hex"),
        policyVersion: POLICY_VERSION,
        verified: true,
      });
    }

    const secondSessionId = await setupProofSession(userId, docId);
    for (const proofType of ["nationality_membership", "identity_binding"]) {
      await insertProofArtifact({
        id: crypto.randomUUID(),
        userId,
        verificationId: docId,
        proofSessionId: secondSessionId,
        proofSystem: "noir_ultrahonk",
        proofType,
        proofHash: crypto.randomBytes(32).toString("hex"),
        proofPayload: crypto.randomBytes(256).toString("hex"),
        policyVersion: POLICY_VERSION,
        verified: true,
      });
    }

    await insertEncryptedAttribute({
      id: crypto.randomUUID(),
      userId,
      source: "fhe-service",
      attributeType: "birth_year_offset",
      ciphertext: crypto.randomBytes(256),
    });
    await insertEncryptedAttribute({
      id: crypto.randomUUID(),
      userId,
      source: "fhe-service",
      attributeType: "liveness_score",
      ciphertext: crypto.randomBytes(256),
    });

    await materializeVerificationChecks(userId, docId);

    const assurance = await getAccountAssurance(userId);

    expect(assurance.tier).toBe(1);
    expect(assurance.details.zkProofsComplete).toBe(false);
    expect(assurance.details.hasIncompleteProofs).toBe(true);
  });

  it("ignores stale OCR proof sessions when deriving verification state", async () => {
    const userId = await createTestUser();
    await createBundleWithKeys(userId);

    const docId = crypto.randomUUID();
    await createVerifiedDocument(docId, userId);

    for (const claimType of [
      "ocr_result",
      "liveness_score",
      "face_match_score",
    ]) {
      await insertSignedClaim({
        id: crypto.randomUUID(),
        userId,
        verificationId: docId,
        claimType,
        claimPayload: JSON.stringify({ data: "test" }),
        signature: crypto.randomBytes(64).toString("hex"),
        issuedAt: new Date().toISOString(),
      });
    }

    const stalePolicyVersion = `${POLICY_VERSION}-stale`;
    const staleSessionId = await setupProofSession(
      userId,
      docId,
      stalePolicyVersion
    );
    for (const proofType of [
      "age_verification",
      "doc_validity",
      "nationality_membership",
      "face_match",
      "identity_binding",
    ]) {
      await insertProofArtifact({
        id: crypto.randomUUID(),
        userId,
        verificationId: docId,
        proofSessionId: staleSessionId,
        proofSystem: "noir_ultrahonk",
        proofType,
        proofHash: crypto.randomBytes(32).toString("hex"),
        proofPayload: crypto.randomBytes(256).toString("hex"),
        policyVersion: stalePolicyVersion,
        verified: true,
      });
    }

    await insertEncryptedAttribute({
      id: crypto.randomUUID(),
      userId,
      source: "fhe-service",
      attributeType: "birth_year_offset",
      ciphertext: crypto.randomBytes(256),
    });
    await insertEncryptedAttribute({
      id: crypto.randomUUID(),
      userId,
      source: "fhe-service",
      attributeType: "liveness_score",
      ciphertext: crypto.randomBytes(256),
    });

    await materializeVerificationChecks(userId, docId);

    const assurance = await getAccountAssurance(userId);

    expect(assurance.tier).toBe(1);
    expect(assurance.details.zkProofsComplete).toBe(false);
    expect(assurance.details.hasIncompleteProofs).toBe(true);
  });

  it("keeps FHE-pending users out of the re-verify state once proofs exist", async () => {
    const userId = await createTestUser();
    await createBundleWithKeys(userId);

    const docId = crypto.randomUUID();
    await createVerifiedDocument(docId, userId);

    for (const claimType of [
      "ocr_result",
      "liveness_score",
      "face_match_score",
    ]) {
      await insertSignedClaim({
        id: crypto.randomUUID(),
        userId,
        verificationId: docId,
        claimType,
        claimPayload: JSON.stringify({ data: "test" }),
        signature: crypto.randomBytes(64).toString("hex"),
        issuedAt: new Date().toISOString(),
      });
    }

    const proofSessionId = await setupProofSession(userId, docId);
    for (const proofType of [
      "age_verification",
      "doc_validity",
      "nationality_membership",
      "face_match",
      "identity_binding",
    ]) {
      await insertProofArtifact({
        id: crypto.randomUUID(),
        userId,
        verificationId: docId,
        proofSessionId,
        proofSystem: "noir_ultrahonk",
        proofType,
        proofHash: crypto.randomBytes(32).toString("hex"),
        proofPayload: crypto.randomBytes(256).toString("hex"),
        policyVersion: POLICY_VERSION,
        verified: true,
      });
    }

    await materializeVerificationChecks(userId, docId);

    const assurance = await getAccountAssurance(userId);

    expect(assurance.tier).toBe(1);
    expect(assurance.details.zkProofsComplete).toBe(true);
    expect(assurance.details.fheComplete).toBe(false);
    expect(assurance.details.hasIncompleteProofs).toBe(false);
  });
});
