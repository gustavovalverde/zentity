import type { Session } from "@/lib/auth/auth-config";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// --- Mock functions ---

const mockVerify = vi.fn();
const mockGetIdentityBundleByUserId = vi.fn();
const mockCreateVerification = vi.fn();
const mockGetSelectedVerification = vi.fn();
const mockIsNullifierUsedByOtherUser = vi.fn();
const mockDedupKeyExistsForOtherUser = vi.fn();
const mockHasProfileSecret = vi.fn();
const mockScheduleFheEncryption = vi.fn();
const mockInsertSignedClaim = vi.fn();
const mockInsertProofArtifact = vi.fn();
const mockSignAttestationClaim = vi.fn();
const mockUpsertAttestationEvidence = vi.fn();
const mockMaterializeVerificationChecks = vi.fn();
const mockLoggerWarn = vi.fn();

// --- Module mocks ---

vi.mock("@/lib/privacy/zk/zkpassport-verifier", () => ({
  verifyZkPassportProofs: (...args: unknown[]) => mockVerify(...args),
}));

// identity mock is above (merged all identity-related mocks together)

vi.mock("@/lib/db/queries/identity", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/db/queries/identity")>();
  return {
    ...actual,
    getIdentityBundleByUserId: (...args: unknown[]) =>
      mockGetIdentityBundleByUserId(...args),
    createVerification: (...args: unknown[]) => mockCreateVerification(...args),
    getSelectedVerification: (...args: unknown[]) =>
      mockGetSelectedVerification(...args),
    isNullifierUsedByOtherUser: (...args: unknown[]) =>
      mockIsNullifierUsedByOtherUser(...args),
    dedupKeyExistsForOtherUser: (...args: unknown[]) =>
      mockDedupKeyExistsForOtherUser(...args),
    hasProfileSecret: (...args: unknown[]) => mockHasProfileSecret(...args),
  };
});

vi.mock("@/lib/privacy/fhe/encryption", () => ({
  scheduleFheEncryption: (...args: unknown[]) =>
    mockScheduleFheEncryption(...args),
}));

vi.mock("@/lib/db/queries/privacy", () => ({
  insertSignedClaim: (...args: unknown[]) => mockInsertSignedClaim(...args),
  insertProofArtifact: (...args: unknown[]) => mockInsertProofArtifact(...args),
}));

vi.mock("@/lib/privacy/zk/attestation-claims", () => ({
  signAttestationClaim: (...args: unknown[]) =>
    mockSignAttestationClaim(...args),
}));

vi.mock("@/lib/db/queries/attestation", () => ({
  upsertAttestationEvidence: (...args: unknown[]) =>
    mockUpsertAttestationEvidence(...args),
}));

vi.mock("@/lib/identity/verification/materialize", () => ({
  materializeVerificationChecks: (...args: unknown[]) =>
    mockMaterializeVerificationChecks(...args),
}));

vi.mock("@/lib/logging/logger", () => {
  const noop = vi.fn();
  const mockLogger = {
    info: noop,
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
    error: noop,
    debug: noop,
    child: () => mockLogger,
  };
  return {
    logger: mockLogger,
    createRequestLogger: () => mockLogger,
    isDebugEnabled: () => false,
  };
});

// Allow overriding specific env values per test
let envOverrides: Record<string, string | undefined> = {};

vi.mock("@/env", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/env")>();
  return {
    ...mod,
    env: new Proxy(mod.env, {
      get(target, prop) {
        if (typeof prop === "string" && prop in envOverrides) {
          return envOverrides[prop];
        }
        return Reflect.get(target, prop);
      },
    }),
  };
});

// --- Fixtures ---

const authedSession = {
  user: { id: "user-123", twoFactorEnabled: true },
  session: { id: "session-123" },
} as unknown as Session;

const verifiedNullifier = "0xabc123nullifier";

const mockQueryResult = {
  age: { gte: { expected: 18, result: true } },
  birthdate: { disclose: { result: "1990-05-15" } },
  nationality: { disclose: { result: "USA" } },
  fullname: { disclose: { result: "John Doe" } },
  document_type: { disclose: { result: "passport" } },
  issuing_country: { disclose: { result: "USA" } },
  sanctions: { passed: true },
  facematch: { passed: true },
};

const mockProofs = [
  { proof: "0xproof1", vkeyHash: "0xvkey1", index: 0, total: 2 },
  { proof: "0xproof2", vkeyHash: "0xvkey2", index: 1, total: 2 },
];

const bundleWithFhe = { fheKeyId: "fhe-key-123", fheStatus: "complete" };
const SHA256_HEX_RE = /^[a-f0-9]{64}$/;

// --- Helpers ---

async function createCaller(session: Session | null) {
  const { passportChipRouter } = await import(
    "@/lib/trpc/routers/passport-chip"
  );
  return passportChipRouter.createCaller({
    req: new Request("http://localhost/api/trpc"),
    resHeaders: new Headers(),
    session,
    requestId: "test-request-id",
    flowId: null,
    flowIdSource: "none",
  });
}

function validInput() {
  return {
    requestId: "req-001",
    proofs: mockProofs as Record<string, unknown>[],
    result: mockQueryResult as Record<string, unknown>,
  };
}

// --- Tests ---

describe("passportChip.submitResult", () => {
  beforeAll(() => {
    vi.resetModules();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    envOverrides = {};

    // Default happy-path mocks
    mockVerify.mockResolvedValue({
      verified: true,
      uniqueIdentifier: verifiedNullifier,
    });
    mockGetIdentityBundleByUserId.mockResolvedValue(bundleWithFhe);
    mockGetSelectedVerification.mockResolvedValue(null);
    mockSignAttestationClaim.mockResolvedValue("signed-chip-claim");
    mockIsNullifierUsedByOtherUser.mockResolvedValue(false);
    mockDedupKeyExistsForOtherUser.mockResolvedValue(false);
    mockHasProfileSecret.mockResolvedValue(true);
    mockCreateVerification.mockImplementation((data) => data);
    mockScheduleFheEncryption.mockReturnValue(undefined);
    mockLoggerWarn.mockReset();
  });

  it("rejects unauthenticated requests", async () => {
    const caller = await createCaller(null);
    await expect(caller.submitResult(validInput())).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  // --- Proof verification ---

  it("rejects when proof verification fails", async () => {
    mockVerify.mockResolvedValue({
      verified: false,
      verificationTimeMs: 123,
      queryResultErrors: {
        fullname: {
          disclose: {
            expected: "redacted expected value",
            received: "John Doe",
          },
        },
      },
    });

    const caller = await createCaller(authedSession);
    await expect(caller.submitResult(validInput())).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("Proof verification failed"),
    });

    expect(mockCreateVerification).not.toHaveBeenCalled();
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      {
        proofCount: mockProofs.length,
        queryResultErrorKeys: ["fullname"],
        verificationTimeMs: 123,
      },
      "Passport chip verification failed"
    );
  });

  it("rejects when verified but nullifier is missing", async () => {
    mockVerify.mockResolvedValue({
      verified: true,
      uniqueIdentifier: undefined,
    });

    const caller = await createCaller(authedSession);
    await expect(caller.submitResult(validInput())).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "No nullifier in verified proofs",
    });
  });

  it("rejects empty proofs array (SDK returns unverified)", async () => {
    mockVerify.mockResolvedValue({ verified: false });

    const caller = await createCaller(authedSession);
    await expect(
      caller.submitResult({ ...validInput(), proofs: [] })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Proof verification failed",
    });
  });

  // --- DevMode flag derivation ---

  it("passes devMode: true when APP_ENV is development", async () => {
    envOverrides.NEXT_PUBLIC_APP_ENV = "development";

    const caller = await createCaller(authedSession);
    await caller.submitResult(validInput());

    expect(mockVerify).toHaveBeenCalledWith(
      expect.objectContaining({ devMode: true })
    );
  });

  it("passes devMode: true when APP_ENV is test", async () => {
    envOverrides.NEXT_PUBLIC_APP_ENV = "test";

    const caller = await createCaller(authedSession);
    await caller.submitResult(validInput());

    expect(mockVerify).toHaveBeenCalledWith(
      expect.objectContaining({ devMode: true })
    );
  });

  it("passes devMode: false when APP_ENV is production", async () => {
    envOverrides.NEXT_PUBLIC_APP_ENV = "production";

    const caller = await createCaller(authedSession);
    await caller.submitResult(validInput());

    expect(mockVerify).toHaveBeenCalledWith(
      expect.objectContaining({ devMode: false })
    );
  });

  it("passes devMode: false when APP_ENV is undefined", async () => {
    envOverrides.NEXT_PUBLIC_APP_ENV = undefined;

    const caller = await createCaller(authedSession);
    await caller.submitResult(validInput());

    expect(mockVerify).toHaveBeenCalledWith(
      expect.objectContaining({ devMode: false })
    );
  });

  // --- Precondition checks ---

  it("rejects when FHE enrollment is missing", async () => {
    mockGetIdentityBundleByUserId.mockResolvedValue({ fheKeyId: null });

    const caller = await createCaller(authedSession);
    await expect(caller.submitResult(validInput())).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "FHE enrollment required before passport verification",
    });
  });

  it("rejects when passport chip already verified", async () => {
    mockGetSelectedVerification.mockResolvedValue({
      method: "nfc_chip",
      status: "verified",
    });

    const caller = await createCaller(authedSession);
    await expect(caller.submitResult(validInput())).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Passport chip already verified",
    });
  });

  it("rejects when nullifier belongs to another user", async () => {
    mockIsNullifierUsedByOtherUser.mockResolvedValue(true);

    const caller = await createCaller(authedSession);
    await expect(caller.submitResult(validInput())).rejects.toMatchObject({
      code: "CONFLICT",
      message: "This passport is already registered to another account",
    });
  });

  it("uses server-derived nullifier (not client input)", async () => {
    const caller = await createCaller(authedSession);
    await caller.submitResult(validInput());

    // The nullifier check and DB write must use the server-verified value
    expect(mockIsNullifierUsedByOtherUser).toHaveBeenCalledWith(
      verifiedNullifier,
      authedSession.user.id
    );
    expect(mockCreateVerification).toHaveBeenCalledWith(
      expect.objectContaining({ uniqueIdentifier: verifiedNullifier })
    );
  });

  // --- Happy path ---

  it("creates verification record with correct fields", async () => {
    const caller = await createCaller(authedSession);
    const result = await caller.submitResult(validInput());

    expect(result.chipVerified).toBe(true);
    expect(result.verificationId).toBeDefined();

    expect(mockCreateVerification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-123",
        uniqueIdentifier: verifiedNullifier,
        method: "nfc_chip",
        status: "verified",
        documentType: "passport",
        issuerCountry: "USA",
        livenessScore: 1.0,
      })
    );

    // Commitments are SHA-256 hashes, not raw PII
    const call = mockCreateVerification.mock.calls[0]?.[0];
    expect(call.nameCommitment).toMatch(SHA256_HEX_RE);
    expect(call.dobCommitment).toMatch(SHA256_HEX_RE);
    expect(call.nationalityCommitment).toMatch(SHA256_HEX_RE);
  });

  it("creates verification linked to user", async () => {
    const caller = await createCaller(authedSession);
    await caller.submitResult(validInput());

    expect(mockCreateVerification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-123",
        method: "nfc_chip",
      })
    );
  });

  it("schedules FHE encryption with synthetic liveness", async () => {
    const caller = await createCaller(authedSession);
    await caller.submitResult(validInput());

    expect(mockScheduleFheEncryption).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-123",
        livenessScore: 1.0,
        reason: "passport_chip_verified",
      })
    );

    // dobDays should be non-null since birthdate is disclosed
    const call = mockScheduleFheEncryption.mock.calls[0]?.[0];
    expect(call.dobDays).toBeTypeOf("number");
    expect(call.dobDays).toBeGreaterThan(0);
  });

  it("returns disclosed PII for client-side vault storage", async () => {
    const caller = await createCaller(authedSession);
    const result = await caller.submitResult(validInput());

    expect(result.disclosed).toEqual({
      fullName: "John Doe",
      dateOfBirth: "1990-05-15",
      nationality: "USA",
      nationalityCode: "USA",
      documentType: "passport",
      issuingCountry: "USA",
    });
  });

  // --- Face match derivation ---

  it("stores faceMatchPassed=false in signed claim when facematch absent", async () => {
    const resultWithoutFace = { ...mockQueryResult, facematch: undefined };

    const caller = await createCaller(authedSession);
    await caller.submitResult({
      ...validInput(),
      result: resultWithoutFace as Record<string, unknown>,
    });

    const claimPayload = JSON.parse(
      mockInsertSignedClaim.mock.calls[0]?.[0].claimPayload
    );
    expect(claimPayload.data.faceMatchPassed).toBe(false);
  });

  it("stores faceMatchPassed=false in signed claim from QueryResult", async () => {
    const resultFailedFace = {
      ...mockQueryResult,
      facematch: { passed: false },
    };

    const caller = await createCaller(authedSession);
    await caller.submitResult({
      ...validInput(),
      result: resultFailedFace as Record<string, unknown>,
    });

    const claimPayload = JSON.parse(
      mockInsertSignedClaim.mock.calls[0]?.[0].claimPayload
    );
    expect(claimPayload.data.faceMatchPassed).toBe(false);
  });

  // --- Partial disclosure ---

  it("handles missing optional disclosed fields gracefully", async () => {
    const minimalResult = {
      age: { gte: { expected: 18, result: true } },
      sanctions: { passed: false },
    };

    const caller = await createCaller(authedSession);
    const result = await caller.submitResult({
      ...validInput(),
      result: minimalResult as Record<string, unknown>,
    });

    expect(result.disclosed).toEqual({
      fullName: null,
      dateOfBirth: null,
      nationality: null,
      nationalityCode: null,
      documentType: null,
      issuingCountry: null,
    });

    expect(mockCreateVerification).toHaveBeenCalledWith(
      expect.objectContaining({
        nameCommitment: null,
        dobCommitment: null,
        nationalityCommitment: null,
      })
    );
    const claimPayload = JSON.parse(
      mockInsertSignedClaim.mock.calls[0]?.[0].claimPayload
    );
    expect(claimPayload.data.sanctionsCleared).toBe(false);
  });

  // --- Birthdate extraction ---

  // --- Cross-method Sybil dedup ---

  it("rejects when dedupKey matches another user (cross-method sybil)", async () => {
    mockDedupKeyExistsForOtherUser.mockResolvedValue(true);

    const resultWithDocNumber = {
      ...mockQueryResult,
      document_number: { disclose: { result: "AB1234567" } },
    };

    const caller = await createCaller(authedSession);
    await expect(
      caller.submitResult({
        ...validInput(),
        result: resultWithDocNumber as Record<string, unknown>,
      })
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message:
        "This identity document is already registered to another account",
    });
  });

  it("stores dedupKey on verification record when document fields available", async () => {
    const resultWithDocNumber = {
      ...mockQueryResult,
      document_number: { disclose: { result: "AB1234567" } },
    };

    const caller = await createCaller(authedSession);
    await caller.submitResult({
      ...validInput(),
      result: resultWithDocNumber as Record<string, unknown>,
    });

    const createCall = mockCreateVerification.mock.calls[0]?.[0];
    expect(createCall.dedupKey).toMatch(SHA256_HEX_RE);
  });

  it("allows same user re-verification (dedupKey exists but same user)", async () => {
    mockDedupKeyExistsForOtherUser.mockResolvedValue(false);

    const resultWithDocNumber = {
      ...mockQueryResult,
      document_number: { disclose: { result: "AB1234567" } },
    };

    const caller = await createCaller(authedSession);
    const result = await caller.submitResult({
      ...validInput(),
      result: resultWithDocNumber as Record<string, unknown>,
    });

    expect(result.chipVerified).toBe(true);
  });

  it("skips dedupKey when document number not disclosed", async () => {
    const caller = await createCaller(authedSession);
    await caller.submitResult(validInput());

    const createCall = mockCreateVerification.mock.calls[0]?.[0];
    expect(createCall.dedupKey).toBeNull();
    expect(mockDedupKeyExistsForOtherUser).not.toHaveBeenCalled();
  });

  it("handles Date object birthdate from SDK", async () => {
    const resultWithDateObj = {
      ...mockQueryResult,
      birthdate: { disclose: { result: new Date("1990-05-15T00:00:00Z") } },
    };

    const caller = await createCaller(authedSession);
    const result = await caller.submitResult({
      ...validInput(),
      result: resultWithDateObj as Record<string, unknown>,
    });

    expect(result.disclosed.dateOfBirth).toBe("1990-05-15");
  });

  // --- Re-verify for vault ---

  it("allows re-submission when chip-verified but profile secret missing", async () => {
    mockGetSelectedVerification.mockResolvedValue({
      id: "existing-verification-id",
      method: "nfc_chip",
      status: "verified",
      uniqueIdentifier: verifiedNullifier,
    });
    mockHasProfileSecret.mockResolvedValue(false);

    const caller = await createCaller(authedSession);
    const result = await caller.submitResult(validInput());

    expect(result.chipVerified).toBe(true);
    expect(result.verificationId).toBe("existing-verification-id");
    // Should NOT create a new verification or signed claim
    expect(mockCreateVerification).not.toHaveBeenCalled();
    expect(mockInsertSignedClaim).not.toHaveBeenCalled();
    expect(mockScheduleFheEncryption).not.toHaveBeenCalled();
  });
});

describe("passportChip.status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    envOverrides = {};
    mockGetIdentityBundleByUserId.mockResolvedValue(bundleWithFhe);
    mockHasProfileSecret.mockResolvedValue(true);
  });

  it("returns FHE state and whether the profile secret exists", async () => {
    const caller = await createCaller(authedSession);
    const result = await caller.status();

    expect(result).toEqual({
      fheComplete: true,
      fheError: null,
      profileSecretStored: true,
    });
  });

  it("reports when the profile secret is still missing", async () => {
    mockGetIdentityBundleByUserId.mockResolvedValue({
      fheKeyId: "fhe-key-123",
      fheStatus: "pending",
      fheError: null,
    });
    mockHasProfileSecret.mockResolvedValue(false);

    const caller = await createCaller(authedSession);
    const result = await caller.status();

    expect(result).toEqual({
      fheComplete: false,
      fheError: null,
      profileSecretStored: false,
    });
  });
});
