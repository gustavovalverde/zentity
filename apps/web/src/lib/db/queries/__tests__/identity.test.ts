import crypto from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import {
  getAttestationEvidenceByUserAndDocument,
  upsertAttestationEvidence,
} from "@/lib/db/queries/attestation";
import {
  getEncryptedAttributeTypesByUserId,
  getEncryptedSecretByUserAndType,
  getSecretWrappersBySecretId,
  getZkProofsByUserId,
  insertEncryptedAttribute,
  insertSignedClaim,
  insertZkProofRecord,
  upsertEncryptedSecret,
  upsertSecretWrapper,
} from "@/lib/db/queries/crypto";
import {
  createIdentityDocument,
  deleteIdentityData,
  documentHashExists,
  getIdentityBundleByUserId,
  getIdentityDocumentsByUserId,
  getLatestIdentityDocumentByUserId,
  updateIdentityBundleStatus,
  upsertIdentityBundle,
} from "@/lib/db/queries/identity";
import { createTestUser, resetDatabase } from "@/test/db-test-utils";

describe("identity queries", () => {
  beforeEach(() => {
    resetDatabase();
  });

  it("upserts and updates identity bundle status", () => {
    const userId = createTestUser();

    upsertIdentityBundle({
      userId,
      walletAddress: "0xabc",
      status: "pending",
      policyVersion: "policy-v1",
    });

    const initial = getIdentityBundleByUserId(userId);
    expect(initial?.walletAddress).toBe("0xabc");
    expect(initial?.status).toBe("pending");
    expect(initial?.policyVersion).toBe("policy-v1");

    updateIdentityBundleStatus({
      userId,
      status: "verified",
      policyVersion: "policy-v2",
      issuerId: "issuer-1",
      attestationExpiresAt: "2025-01-01T00:00:00Z",
    });

    const updated = getIdentityBundleByUserId(userId);
    expect(updated?.status).toBe("verified");
    expect(updated?.policyVersion).toBe("policy-v2");
    expect(updated?.issuerId).toBe("issuer-1");
    expect(updated?.attestationExpiresAt).toBe("2025-01-01T00:00:00Z");
  });

  it("returns latest verified identity document", () => {
    const userId = createTestUser();
    const olderDoc = crypto.randomUUID();
    const newerDoc = crypto.randomUUID();

    createIdentityDocument({
      id: olderDoc,
      userId,
      documentType: "passport",
      issuerCountry: "USA",
      documentHash: "hash-old",
      nameCommitment: "commit-old",
      userSalt: null,
      birthYearOffset: null,
      firstNameEncrypted: null,
      verifiedAt: "2024-01-01T00:00:00Z",
      confidenceScore: 0.9,
      status: "verified",
    });

    createIdentityDocument({
      id: newerDoc,
      userId,
      documentType: "passport",
      issuerCountry: "USA",
      documentHash: "hash-new",
      nameCommitment: "commit-new",
      userSalt: null,
      birthYearOffset: null,
      firstNameEncrypted: null,
      verifiedAt: "2025-01-01T00:00:00Z",
      confidenceScore: 0.95,
      status: "verified",
    });

    const latest = getLatestIdentityDocumentByUserId(userId);
    expect(latest?.id).toBe(newerDoc);
    expect(documentHashExists("hash-new")).toBe(true);
  });

  it("deletes all identity data for a user", () => {
    const userId = createTestUser();
    const documentId = crypto.randomUUID();

    upsertIdentityBundle({ userId });

    createIdentityDocument({
      id: documentId,
      userId,
      documentType: "passport",
      issuerCountry: "USA",
      documentHash: "hash-delete",
      nameCommitment: "commit-delete",
      userSalt: null,
      birthYearOffset: null,
      firstNameEncrypted: null,
      verifiedAt: "2025-01-01T00:00:00Z",
      confidenceScore: 0.8,
      status: "verified",
    });

    insertZkProofRecord({
      id: crypto.randomUUID(),
      userId,
      documentId,
      proofType: "age_verification",
      proofHash: "proof-hash",
      verified: true,
    });

    insertSignedClaim({
      id: crypto.randomUUID(),
      userId,
      documentId,
      claimType: "ocr_result",
      claimPayload: "{}",
      signature: "sig",
      issuedAt: new Date().toISOString(),
    });

    insertEncryptedAttribute({
      id: crypto.randomUUID(),
      userId,
      source: "web2_tfhe",
      attributeType: "birth_year_offset",
      ciphertext: "ciphertext",
      keyId: "key-1",
      encryptionTimeMs: 123,
    });

    upsertAttestationEvidence({
      userId,
      documentId,
      policyVersion: "policy-v1",
      policyHash: "policy-hash",
      proofSetHash: "proof-set",
    });

    const secret = upsertEncryptedSecret({
      id: crypto.randomUUID(),
      userId,
      secretType: "fhe_keys",
      encryptedBlob: "blob",
      metadata: { keyId: "key-1" },
      version: "v1",
    });

    upsertSecretWrapper({
      id: crypto.randomUUID(),
      secretId: secret.id,
      userId,
      credentialId: "cred-1",
      wrappedDek: "wrapped",
      prfSalt: "salt",
      kekVersion: "v1",
    });

    deleteIdentityData(userId);

    expect(getIdentityBundleByUserId(userId)).toBeNull();
    expect(getIdentityDocumentsByUserId(userId)).toHaveLength(0);
    expect(getZkProofsByUserId(userId)).toHaveLength(0);
    expect(getEncryptedAttributeTypesByUserId(userId)).toEqual([]);
    expect(
      getAttestationEvidenceByUserAndDocument(userId, documentId)
    ).toBeNull();
    expect(getEncryptedSecretByUserAndType(userId, "fhe_keys")).toBeNull();
    expect(getSecretWrappersBySecretId(secret.id)).toHaveLength(0);
  });
});
