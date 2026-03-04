import type { Session } from "@/lib/auth/auth";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// --- Mock functions ---

const mockVerify = vi.fn();
const mockGetIdentityBundleByUserId = vi.fn();
const mockCreateVerification = vi.fn();
const mockGetSelectedVerification = vi.fn();
const mockIsNullifierUsedByOtherUser = vi.fn();
const mockScheduleFheEncryption = vi.fn();

// --- Module mocks ---

vi.mock("@zkpassport/sdk", () => ({
  ZKPassport: class {
    verify(...args: unknown[]) {
      return mockVerify(...args);
    }
  },
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
  };
});

vi.mock("@/lib/privacy/fhe/encryption", () => ({
  scheduleFheEncryption: (...args: unknown[]) =>
    mockScheduleFheEncryption(...args),
}));

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
  session: { id: "session-123", lastLoginMethod: "passkey" },
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
    mockIsNullifierUsedByOtherUser.mockResolvedValue(false);
    mockCreateVerification.mockImplementation((data) => data);
    mockScheduleFheEncryption.mockReturnValue(undefined);
  });

  it("rejects unauthenticated requests", async () => {
    const caller = await createCaller(null);
    await expect(caller.submitResult(validInput())).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  // --- Proof verification ---

  it("rejects when proof verification fails", async () => {
    mockVerify.mockResolvedValue({ verified: false });

    const caller = await createCaller(authedSession);
    await expect(caller.submitResult(validInput())).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Proof verification failed",
    });

    expect(mockCreateVerification).not.toHaveBeenCalled();
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
        ageVerified: true,
        sanctionsCleared: true,
        faceMatchPassed: true,
        documentType: "passport",
        issuerCountry: "USA",
        livenessScore: 1.0,
        livenessPassed: true,
      })
    );

    // Commitments are SHA-256 hashes, not raw PII
    const call = mockCreateVerification.mock.calls[0][0];
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
    const call = mockScheduleFheEncryption.mock.calls[0][0];
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

  it("derives faceMatchPassed=null when facematch is absent", async () => {
    const resultWithoutFace = { ...mockQueryResult, facematch: undefined };

    const caller = await createCaller(authedSession);
    await caller.submitResult({
      ...validInput(),
      result: resultWithoutFace as Record<string, unknown>,
    });

    expect(mockCreateVerification).toHaveBeenCalledWith(
      expect.objectContaining({
        faceMatchPassed: null,
      })
    );
  });

  it("derives faceMatchPassed=false from QueryResult", async () => {
    const resultFailedFace = {
      ...mockQueryResult,
      facematch: { passed: false },
    };

    const caller = await createCaller(authedSession);
    await caller.submitResult({
      ...validInput(),
      result: resultFailedFace as Record<string, unknown>,
    });

    expect(mockCreateVerification).toHaveBeenCalledWith(
      expect.objectContaining({
        faceMatchPassed: false,
      })
    );
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
        sanctionsCleared: false,
        nameCommitment: null,
        dobCommitment: null,
        nationalityCommitment: null,
      })
    );
  });

  // --- Birthdate extraction ---

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
});
