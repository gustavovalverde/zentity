import crypto from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import {
  createVerification,
  reconcileIdentityBundle,
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
      uniqueIdentifier: "nullifier-grouped-nfc",
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
});
