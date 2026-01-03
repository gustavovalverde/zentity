/**
 * Integration-style tests for identity.verify with FHE encryption.
 */

import type { Session } from "@/lib/auth/auth";
import type { OcrProcessResult } from "@/lib/document/ocr-client";

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
vi.mock("@/lib/document/ocr-client", () => ({
  processDocumentOcr: (...args: unknown[]) => mockProcessDocumentOcr(...args),
}));

vi.mock("@/lib/document/image-processing", () => ({
  cropFaceRegion: vi.fn().mockResolvedValue("data:image/png;base64,face"),
}));

vi.mock("@/lib/liveness/human-server", () => ({
  detectFromBase64: vi.fn().mockResolvedValue({ faces: [] }),
  getHumanServer: vi.fn().mockResolvedValue({
    match: { similarity: vi.fn().mockReturnValue(0.9) },
  }),
}));

vi.mock("@/lib/liveness/human-metrics", () => ({
  getLargestFace: vi.fn().mockReturnValue({}),
  getEmbeddingVector: vi.fn().mockReturnValue([1, 2, 3]),
  getLiveScore: vi.fn().mockReturnValue(0.9),
  getRealScore: vi.fn().mockReturnValue(0.9),
}));

vi.mock("@/lib/crypto/fhe-client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/crypto/fhe-client")>();
  return {
    ...actual,
    encryptBatchFhe: vi.fn().mockResolvedValue({
      birthYearOffsetCiphertext: "birth-cipher",
      countryCodeCiphertext: "country-cipher",
      livenessScoreCiphertext: "live-cipher",
    }),
  };
});

vi.mock("@/lib/crypto/signed-claims", () => ({
  signAttestationClaim: vi.fn().mockResolvedValue("signature"),
}));

vi.mock("@/lib/attestation/claim-hash", () => ({
  getDocumentHashField: vi.fn().mockResolvedValue("0x1234"),
  computeClaimHash: vi.fn().mockResolvedValue("0x5678"),
}));

async function createCaller(session: Session | null) {
  const { identityRouter } = await import("@/lib/trpc/routers/identity");
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

beforeEach(() => {
  resetDatabase();
  const userId = createTestUser({ id: "user-fhe-test" });
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
  it("stores encrypted attributes with key id", async () => {
    mockGetSessionFromCookie.mockResolvedValue({ id: "onboarding" });
    mockValidateStepAccess.mockReturnValue({ valid: true });
    mockProcessDocumentOcr.mockResolvedValue(baseOcrResult);

    const { deleteIdentityData } = await import("@/lib/db/queries/identity");
    const { getLatestEncryptedAttributeByUserAndType } = await import(
      "@/lib/db/queries/crypto"
    );

    deleteIdentityData(authedSession.user.id);

    const caller = await createCaller(authedSession);
    const response = await caller.verify({
      documentImage: "doc",
      selfieImage: "selfie",
      fheKeyId: "key-123",
    });

    expect(response.success).toBe(true);

    const birthYearOffset = getLatestEncryptedAttributeByUserAndType(
      authedSession.user.id,
      "birth_year_offset"
    );
    const countryCode = getLatestEncryptedAttributeByUserAndType(
      authedSession.user.id,
      "country_code"
    );
    const liveness = getLatestEncryptedAttributeByUserAndType(
      authedSession.user.id,
      "liveness_score"
    );

    expect(birthYearOffset?.keyId).toBe("key-123");
    expect(countryCode?.keyId).toBe("key-123");
    expect(liveness?.keyId).toBe("key-123");

    deleteIdentityData(authedSession.user.id);
  });

  it("records missing FHE key when not provided", async () => {
    mockGetSessionFromCookie.mockResolvedValue({ id: "onboarding" });
    mockValidateStepAccess.mockReturnValue({ valid: true });
    mockProcessDocumentOcr.mockResolvedValue(baseOcrResult);

    const caller = await createCaller(authedSession);
    const response = await caller.verify({
      documentImage: "doc",
      selfieImage: "selfie",
    });

    expect(response.issues).toContain("fhe_key_missing");
  });
});
