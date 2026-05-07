import crypto from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import {
  attachHumanSignal,
  createVerification,
  reconcileIdentityBundle,
  revokeIdentity,
  upsertIdentityBundle,
} from "@/lib/db/queries/identity";
import { getVerificationReadModel } from "@/lib/identity/verification/read-model";
import { createTestUser, resetDatabase } from "@/test-utils/db-test-utils";

describe("verification read model", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("returns grouped identity with a deterministic effective credential", async () => {
    const userId = await createTestUser();
    const ocrVerificationId = crypto.randomUUID();
    const nfcVerificationId = crypto.randomUUID();

    await createVerification({
      id: ocrVerificationId,
      userId,
      method: "ocr",
      status: "verified",
      dedupKey: "dedup-grouped-ocr",
      documentHash: "hash-ocr",
      verifiedAt: "2026-04-20T09:00:00Z",
    });

    await createVerification({
      id: nfcVerificationId,
      userId,
      method: "nfc_chip",
      status: "verified",
      chipNullifier: "nullifier-grouped-nfc",
      verifiedAt: "2026-04-20T10:00:00Z",
    });
    await reconcileIdentityBundle(userId);

    const model = await getVerificationReadModel(userId);

    expect(model.groupedIdentity.effectiveVerificationId).toBe(
      nfcVerificationId
    );
    expect(model.groupedIdentity.credentials).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          credentialId: ocrVerificationId,
          method: "ocr",
          isEffective: false,
        }),
        expect.objectContaining({
          credentialId: nfcVerificationId,
          method: "nfc_chip",
          isEffective: true,
        }),
      ])
    );
  });

  it("returns human_verified for an account with only a human signal", async () => {
    const userId = await createTestUser();
    await upsertIdentityBundle({ userId });
    await attachHumanSignal({
      userId,
      provider: "world_id",
      providerSubjectKind: "nullifier",
      providerSubjectHash: "subject-hash-read-model",
    });

    const model = await getVerificationReadModel(userId);

    expect(model.verificationId).toBeNull();
    expect(model.compliance.level).toBe("human_verified");
    expect(model.compliance.numericLevel).toBe(1.5);
    expect(model.compliance.verified).toBe(false);
    expect(model.compliance.checks).toEqual({
      documentVerified: false,
      livenessVerified: false,
      ageVerified: false,
      faceMatchVerified: false,
      nationalityVerified: false,
      identityBound: false,
      sybilResistant: true,
    });
  });

  it("does not treat a revoked identity bundle as human verified", async () => {
    const userId = await createTestUser();
    await upsertIdentityBundle({ userId });
    await attachHumanSignal({
      userId,
      provider: "world_id",
      providerSubjectKind: "nullifier",
      providerSubjectHash: "subject-hash-revoked-read-model",
    });

    await revokeIdentity(userId, "admin@zentity.app", "fraud", "admin");

    const model = await getVerificationReadModel(userId);

    expect(model.verificationId).toBeNull();
    expect(model.bundle.hasHumanSignal).toBe(true);
    expect(model.bundle.validityStatus).toBe("revoked");
    expect(model.compliance.level).toBe("none");
    expect(model.compliance.numericLevel).toBe(1);
    expect(model.compliance.verified).toBe(false);
    expect(model.compliance.checks.sybilResistant).toBe(false);
  });
});
