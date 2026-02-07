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
  beforeEach(async () => {
    await resetDatabase();
  });

  it("upserts and updates identity bundle status", async () => {
    const userId = await createTestUser();

    await upsertIdentityBundle({
      userId,
      walletAddress: "0xabc",
      status: "pending",
      policyVersion: "policy-v1",
    });

    const initial = await getIdentityBundleByUserId(userId);
    expect(initial?.walletAddress).toBe("0xabc");
    expect(initial?.status).toBe("pending");
    expect(initial?.policyVersion).toBe("policy-v1");

    await updateIdentityBundleStatus({
      userId,
      status: "verified",
      policyVersion: "policy-v2",
      issuerId: "issuer-1",
      attestationExpiresAt: "2025-01-01T00:00:00Z",
    });

    const updated = await getIdentityBundleByUserId(userId);
    expect(updated?.status).toBe("verified");
    expect(updated?.policyVersion).toBe("policy-v2");
    expect(updated?.issuerId).toBe("issuer-1");
    expect(updated?.attestationExpiresAt).toBe("2025-01-01T00:00:00Z");
  });

  it("returns latest verified identity document", async () => {
    const userId = await createTestUser();
    const olderDoc = crypto.randomUUID();
    const newerDoc = crypto.randomUUID();

    await createIdentityDocument({
      id: olderDoc,
      userId,
      documentHash: "hash-old",
      nameCommitment: "commit-old",
      verifiedAt: "2024-01-01T00:00:00Z",
      confidenceScore: 0.9,
      status: "verified",
    });

    await createIdentityDocument({
      id: newerDoc,
      userId,
      documentHash: "hash-new",
      nameCommitment: "commit-new",
      verifiedAt: "2025-01-01T00:00:00Z",
      confidenceScore: 0.95,
      status: "verified",
    });

    const latest = await getLatestIdentityDocumentByUserId(userId);
    expect(latest?.id).toBe(newerDoc);
    await expect(documentHashExists("hash-new")).resolves.toBe(true);
  });

  it("deletes all identity data for a user", async () => {
    const userId = await createTestUser();
    const documentId = crypto.randomUUID();

    await upsertIdentityBundle({ userId });

    await createIdentityDocument({
      id: documentId,
      userId,
      documentHash: "hash-delete",
      nameCommitment: "commit-delete",
      verifiedAt: "2025-01-01T00:00:00Z",
      confidenceScore: 0.8,
      status: "verified",
    });

    await insertZkProofRecord({
      id: crypto.randomUUID(),
      userId,
      documentId,
      proofType: "age_verification",
      proofHash: "proof-hash",
      verified: true,
    });

    await insertSignedClaim({
      id: crypto.randomUUID(),
      userId,
      documentId,
      claimType: "ocr_result",
      claimPayload: "{}",
      signature: "sig",
      issuedAt: new Date().toISOString(),
    });

    await insertEncryptedAttribute({
      id: crypto.randomUUID(),
      userId,
      source: "web2_tfhe",
      attributeType: "birth_year_offset",
      ciphertext: Buffer.from("ciphertext"),
      keyId: "key-1",
      encryptionTimeMs: 123,
    });

    await upsertAttestationEvidence({
      userId,
      documentId,
      policyVersion: "policy-v1",
      policyHash: "policy-hash",
      proofSetHash: "proof-set",
    });

    const secret = await upsertEncryptedSecret({
      id: crypto.randomUUID(),
      userId,
      secretType: "fhe_keys",
      encryptedBlob: "",
      blobRef: "blob-ref",
      blobHash: "blob-hash",
      blobSize: 123,
      metadata: { keyId: "key-1" },
    });

    await upsertSecretWrapper({
      id: crypto.randomUUID(),
      secretId: secret.id,
      userId,
      credentialId: "cred-1",
      wrappedDek: "wrapped",
      prfSalt: "salt",
    });

    await deleteIdentityData(userId);

    await expect(getIdentityBundleByUserId(userId)).resolves.toBeNull();
    await expect(getIdentityDocumentsByUserId(userId)).resolves.toHaveLength(0);
    await expect(getZkProofsByUserId(userId)).resolves.toHaveLength(0);
    await expect(getEncryptedAttributeTypesByUserId(userId)).resolves.toEqual(
      []
    );
    await expect(
      getAttestationEvidenceByUserAndDocument(userId, documentId)
    ).resolves.toBeNull();
    await expect(
      getEncryptedSecretByUserAndType(userId, "fhe_keys")
    ).resolves.toBeNull();
    await expect(getSecretWrappersBySecretId(secret.id)).resolves.toHaveLength(
      0
    );
  });
});
