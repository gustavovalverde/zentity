/**
 * Integration-style tests for identity.verify with FHE encryption.
 */

import type { Session } from "@/lib/auth/auth";
import type { OcrProcessResult } from "@/lib/identity/document/ocr-client";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestUser, resetDatabase } from "@/test/db-test-utils";

const mockGetSessionFromCookie = vi.fn();
const mockValidateStepAccess = vi.fn();

vi.mock("@/lib/db/onboarding-session", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/db/onboarding-session")>();
  return {
    ...actual,
    getSessionFromCookie: (...args: unknown[]) =>
      mockGetSessionFromCookie(...args),
    validateStepAccess: (...args: unknown[]) => mockValidateStepAccess(...args),
  };
});

const mockProcessDocumentOcr = vi.fn();
vi.mock("@/lib/identity/document/ocr-client", () => ({
  processDocumentOcr: (...args: unknown[]) => mockProcessDocumentOcr(...args),
}));

vi.mock("@/lib/identity/verification/face-validation", () => ({
  validateFaces: vi.fn().mockResolvedValue({
    antispoofScore: 0.9,
    liveScore: 0.9,
    livenessPassed: true,
    faceMatchConfidence: 0.9,
    faceMatchPassed: true,
    issues: [],
  }),
}));

const mockScheduleFheEncryption = vi.fn();
vi.mock("@/lib/privacy/crypto/fhe-encryption", () => ({
  scheduleFheEncryption: (...args: unknown[]) =>
    mockScheduleFheEncryption(...args),
}));

vi.mock("@/lib/privacy/crypto/signed-claims", () => ({
  signAttestationClaim: vi.fn().mockResolvedValue("signature"),
}));

vi.mock("@/lib/blockchain/attestation/claim-hash", () => ({
  getDocumentHashField: vi.fn().mockReturnValue("0x1234"),
  computeClaimHash: vi.fn().mockResolvedValue("0x5678"),
}));

async function createCaller(session: Session | null) {
  const { identityRouter } = await import("@/lib/trpc/routers/identity/router");
  return identityRouter.createCaller({
    req: new Request("http://localhost/api/trpc"),
    resHeaders: new Headers(),
    session,
    requestId: "test-request-id",
    flowId: null,
    flowIdSource: "none",
    onboardingSessionId: null,
  });
}

let authedSession: Session;

beforeEach(async () => {
  await resetDatabase();
  mockScheduleFheEncryption.mockReset();
  const userId = await createTestUser({ id: "user-fhe-test" });
  authedSession = {
    user: { id: userId },
    session: { id: "session-fhe" },
  } as Session;
});

const baseOcrResult: OcrProcessResult = {
  commitments: {
    documentHash: "doc-hash",
    nameCommitment: "name-hash",
    userSalt: "salt",
  },
  documentType: "passport",
  documentOrigin: "USA",
  confidence: 0.9,
  extractedData: {
    fullName: "Test User",
    firstName: "Test",
    lastName: "User",
    documentNumber: "P123",
    dateOfBirth: "1990-01-01",
    nationalityCode: "USA",
    gender: "M",
  },
  validationIssues: [],
};

describe("identity.verify (FHE)", () => {
  it("schedules FHE encryption when key id is provided", async () => {
    mockGetSessionFromCookie.mockResolvedValue({ id: "onboarding" });
    mockValidateStepAccess.mockReturnValue({ valid: true });
    mockProcessDocumentOcr.mockResolvedValue(baseOcrResult);

    const { deleteIdentityData } = await import("@/lib/db/queries/identity");
    const { getLatestEncryptedAttributeByUserAndType } = await import(
      "@/lib/db/queries/crypto"
    );

    await deleteIdentityData(authedSession.user.id);

    const caller = await createCaller(authedSession);
    const response = await caller.verify({
      documentImage: "doc",
      selfieImage: "selfie",
      userSalt: "salt",
      fheKeyId: "key-123",
    });

    expect(response.success).toBe(true);
    expect(mockScheduleFheEncryption).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: authedSession.user.id,
        reason: "identity_verify",
        dobDays: expect.any(Number),
      })
    );

    const dobDays = await getLatestEncryptedAttributeByUserAndType(
      authedSession.user.id,
      "dob_days"
    );
    const countryCode = await getLatestEncryptedAttributeByUserAndType(
      authedSession.user.id,
      "country_code"
    );
    const liveness = await getLatestEncryptedAttributeByUserAndType(
      authedSession.user.id,
      "liveness_score"
    );

    expect(dobDays).toBeNull();
    expect(countryCode).toBeNull();
    expect(liveness).toBeNull();

    await deleteIdentityData(authedSession.user.id);
  });

  it("records missing FHE key when not provided", async () => {
    mockGetSessionFromCookie.mockResolvedValue({ id: "onboarding" });
    mockValidateStepAccess.mockReturnValue({ valid: true });
    mockProcessDocumentOcr.mockResolvedValue(baseOcrResult);

    const caller = await createCaller(authedSession);
    const response = await caller.verify({
      documentImage: "doc",
      selfieImage: "selfie",
      userSalt: "salt",
    });

    expect(response.issues).toContain("fhe_key_missing");
  });
});
