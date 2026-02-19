import type { Session } from "@/lib/auth/auth";

import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { getTodayDobDays } from "@/lib/identity/verification/birth-year";
import { BN254_FR_MODULUS } from "@/lib/privacy/zk/proof-types";

const mockGetSelectedIdentityDocumentByUserId = vi.fn();
const mockVerifyNoirProof = vi.fn();
const mockConsumeChallenge = vi.fn();
const mockCreateChallenge = vi.fn();
const mockGetActiveChallengeCount = vi.fn();
const mockGetZkProofTypesByUserAndDocument = vi.fn();

vi.mock("@/lib/db/queries/identity", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/db/queries/identity")>();
  return {
    ...actual,
    getSelectedIdentityDocumentByUserId: (...args: unknown[]) =>
      mockGetSelectedIdentityDocumentByUserId(...args),
  };
});

vi.mock("@/lib/privacy/zk/noir-verifier", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/privacy/zk/noir-verifier")>();
  return {
    ...actual,
    verifyNoirProof: (...args: unknown[]) => mockVerifyNoirProof(...args),
  };
});

vi.mock("@/lib/privacy/zk/challenge-store", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/privacy/zk/challenge-store")>();
  return {
    ...actual,
    consumeChallenge: (...args: unknown[]) => mockConsumeChallenge(...args),
    createChallenge: (...args: unknown[]) => mockCreateChallenge(...args),
    getActiveChallengeCount: (...args: unknown[]) =>
      mockGetActiveChallengeCount(...args),
  };
});

vi.mock("@/lib/db/queries/crypto", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/db/queries/crypto")>();
  return {
    ...actual,
    getZkProofTypesByUserAndDocument: (...args: unknown[]) =>
      mockGetZkProofTypesByUserAndDocument(...args),
  };
});

const authedUserSession = {
  user: { id: "user-123", twoFactorEnabled: true },
  session: { id: "session-123", lastLoginMethod: "passkey" },
} as unknown as Session;

const alternateUserSession = {
  user: { id: "user-456", twoFactorEnabled: true },
  session: { id: "session-456", lastLoginMethod: "passkey" },
} as unknown as Session;

const nonce = "123";
function contextField(value: string): string {
  const digest = createHash("sha256").update(value).digest("hex");
  return (BigInt(`0x${digest}`) % BN254_FR_MODULUS).toString();
}
const msgSenderHash = contextField("user-123");
const audienceHash = contextField("http://localhost");
const browserAudience = "http://localhost:3000";
const browserAudienceHash = contextField(browserAudience);
const bindingCommitment = "2";
const isBound = "1";
const expectedNormalizedNonce = (() => {
  const raw = BigInt(nonce);
  const limit = BigInt(2) ** BigInt(128);
  return (raw % limit).toString(16).padStart(32, "0");
})();

const validProofArgs = {
  proof: "cHJvdG9wcm90b2RvY3Rvcg==",
  publicInputs: [
    nonce,
    msgSenderHash,
    audienceHash,
    bindingCommitment,
    isBound,
  ],
  circuitType: "identity_binding" as const,
};

const validProofArgsBrowserAudience = {
  ...validProofArgs,
  publicInputs: [
    nonce,
    msgSenderHash,
    browserAudienceHash,
    bindingCommitment,
    isBound,
  ],
};

async function createCaller(
  session: Session | null,
  options: { url?: string; headers?: HeadersInit } = {}
) {
  const { cryptoRouter } = await import("@/lib/trpc/routers/crypto/router");
  return cryptoRouter.createCaller({
    req: new Request(options.url ?? "http://localhost/api/trpc", {
      headers: options.headers,
    }),
    resHeaders: new Headers(),
    session,
    requestId: "test-request-id",
    flowId: null,
    flowIdSource: "none",
  });
}

describe("proof router replay and context binding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSelectedIdentityDocumentByUserId.mockResolvedValue({
      id: "doc-1",
      status: "verified",
    });
    mockVerifyNoirProof.mockResolvedValue({
      isValid: true,
      verificationTimeMs: 7,
      circuitType: "identity_binding",
      noirVersion: null,
      circuitHash: null,
      circuitId: null,
      verificationKeyHash: null,
      verificationKeyPoseidonHash: null,
      bbVersion: null,
    });
    mockGetZkProofTypesByUserAndDocument.mockResolvedValue([
      "identity_binding",
    ]);
    mockGetActiveChallengeCount.mockResolvedValue(1);
    mockCreateChallenge.mockImplementation(
      async (
        circuitType: string,
        binding: { userId: string; msgSender: string; audience: string }
      ) => ({
        nonce: "challenge-nonce",
        circuitType,
        userId: binding.userId,
        msgSender: binding.msgSender,
        audience: binding.audience,
        createdAt: 1,
        expiresAt: 2,
      })
    );
  });

  it("uses a challenge once for a proof and rejects replay", async () => {
    mockConsumeChallenge
      .mockResolvedValueOnce({
        nonce,
        circuitType: "identity_binding",
        userId: "user-123",
        msgSender: "user-123",
        audience: "http://localhost",
        createdAt: 1,
        expiresAt: 2,
      })
      .mockResolvedValueOnce(null);

    const caller = await createCaller(authedUserSession);
    const first = await caller.verifyProof(validProofArgs);
    expect(first.isValid).toBe(true);

    await expect(caller.verifyProof(validProofArgs)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });

    expect(mockConsumeChallenge).toHaveBeenCalledTimes(2);
    expect(mockConsumeChallenge).toHaveBeenNthCalledWith(
      1,
      expectedNormalizedNonce,
      "identity_binding",
      {
        userId: "user-123",
        msgSender: "user-123",
        audience: "http://localhost",
      }
    );
    expect(mockConsumeChallenge).toHaveBeenNthCalledWith(
      2,
      expectedNormalizedNonce,
      "identity_binding",
      {
        userId: "user-123",
        msgSender: "user-123",
        audience: "http://localhost",
      }
    );
  });

  it("rejects proofs when challenge is missing for a different caller context", async () => {
    mockConsumeChallenge.mockResolvedValue(null);

    const attacker = await createCaller(alternateUserSession);
    await expect(
      attacker.verifyProof({
        ...validProofArgs,
        publicInputs: [
          nonce,
          contextField("user-456"),
          audienceHash,
          bindingCommitment,
          isBound,
        ],
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(mockConsumeChallenge).toHaveBeenCalledWith(
      expectedNormalizedNonce,
      "identity_binding",
      {
        userId: "user-456",
        msgSender: "user-456",
        audience: "http://localhost",
      }
    );
  });

  it("rejects proofs when challenge nonce does not map to an active challenge", async () => {
    mockConsumeChallenge.mockResolvedValue(null);

    const caller = await createCaller(authedUserSession);
    await expect(
      caller.verifyProof({
        ...validProofArgs,
        publicInputs: [
          "9999999999",
          msgSenderHash,
          audienceHash,
          bindingCommitment,
          isBound,
        ],
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects proofs when identity binding msg_sender hash mismatches caller", async () => {
    const caller = await createCaller(authedUserSession);
    await expect(
      caller.verifyProof({
        ...validProofArgs,
        publicInputs: [
          nonce,
          contextField("user-999"),
          audienceHash,
          bindingCommitment,
          isBound,
        ],
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(mockConsumeChallenge).not.toHaveBeenCalled();
  });

  it("uses Origin header audience for identity binding context", async () => {
    mockConsumeChallenge.mockResolvedValueOnce({
      nonce,
      circuitType: "identity_binding",
      userId: "user-123",
      msgSender: "user-123",
      audience: browserAudience,
      createdAt: 1,
      expiresAt: 2,
    });

    const caller = await createCaller(authedUserSession, {
      url: "http://localhost/api/trpc",
      headers: { origin: browserAudience },
    });
    const result = await caller.verifyProof(validProofArgsBrowserAudience);
    expect(result.isValid).toBe(true);

    expect(mockConsumeChallenge).toHaveBeenCalledWith(
      expectedNormalizedNonce,
      "identity_binding",
      {
        userId: "user-123",
        msgSender: "user-123",
        audience: browserAudience,
      }
    );
  });

  it("binds challenge audience from Origin header", async () => {
    const caller = await createCaller(authedUserSession, {
      url: "http://localhost/api/trpc",
      headers: { origin: browserAudience },
    });

    const result = await caller.createChallenge({ circuitType: "face_match" });

    expect(result.circuitType).toBe("face_match");
    expect(mockCreateChallenge).toHaveBeenCalledWith("face_match", {
      userId: "user-123",
      msgSender: "user-123",
      audience: browserAudience,
    });
  });

  it("binds challenge audience from forwarded headers when Origin is missing", async () => {
    const caller = await createCaller(authedUserSession, {
      url: "http://internal/api/trpc",
      headers: {
        "x-forwarded-host": "verify.example.com",
        "x-forwarded-proto": "https",
      },
    });

    await caller.createChallenge({ circuitType: "identity_binding" });

    expect(mockCreateChallenge).toHaveBeenCalledWith("identity_binding", {
      userId: "user-123",
      msgSender: "user-123",
      audience: "https://verify.example.com",
    });
  });

  it("rejects age proofs when min_age_days exceeds uint32 range", async () => {
    const caller = await createCaller(authedUserSession, {
      headers: { origin: browserAudience },
    });

    const overflowMinAgeDays = (BigInt(2) ** BigInt(32) + BigInt(1)).toString();

    await expect(
      caller.verifyProof({
        circuitType: "age_verification",
        proof: "cHJvdG9wcm90b2RvY3Rvcg==",
        publicInputs: [
          getTodayDobDays().toString(),
          overflowMinAgeDays,
          "1",
          "1",
          "1",
        ],
        documentId: "doc-1",
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("min_age_days"),
    });

    expect(mockVerifyNoirProof).not.toHaveBeenCalled();
    expect(mockConsumeChallenge).not.toHaveBeenCalled();
  });

  it("rejects storing age proofs when min_age_days exceeds uint32 range", async () => {
    const caller = await createCaller(authedUserSession, {
      headers: { origin: browserAudience },
    });

    const overflowMinAgeDays = (BigInt(2) ** BigInt(32) + BigInt(1)).toString();

    await expect(
      caller.storeProof({
        circuitType: "age_verification",
        proof: "cHJvdG9wcm90b2RvY3Rvcg==",
        publicSignals: [
          getTodayDobDays().toString(),
          overflowMinAgeDays,
          "1",
          "1",
          "1",
        ],
        generationTimeMs: 10,
        documentId: "doc-1",
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("min_age_days"),
    });

    expect(mockVerifyNoirProof).not.toHaveBeenCalled();
    expect(mockConsumeChallenge).not.toHaveBeenCalled();
  });

  it("rejects storing non-binding proofs until identity binding is stored", async () => {
    mockGetZkProofTypesByUserAndDocument.mockResolvedValue([]);
    const caller = await createCaller(authedUserSession, {
      headers: { origin: browserAudience },
    });

    await expect(
      caller.storeProof({
        circuitType: "age_verification",
        proof: "cHJvdG9wcm90b2RvY3Rvcg==",
        publicSignals: [getTodayDobDays().toString(), "6570", "1", "1", "1"],
        generationTimeMs: 10,
        documentId: "doc-1",
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("Identity binding proof is required"),
    });

    expect(mockVerifyNoirProof).not.toHaveBeenCalled();
    expect(mockConsumeChallenge).not.toHaveBeenCalled();
  });

  it.each([
    ["age_verification", 5],
    ["doc_validity", 4],
    ["nationality_membership", 4],
    ["face_match", 4],
    ["identity_binding", 5],
  ] as const)("storeProof rejects %s when public signals are below minimum", async (circuitType, minPublicInputs) => {
    const caller = await createCaller(authedUserSession, {
      headers: { origin: browserAudience },
    });

    await expect(
      caller.storeProof({
        circuitType,
        proof: "cHJvdG9wcm90b2RvY3Rvcg==",
        publicSignals: Array.from({ length: minPublicInputs - 1 }, () => "1"),
        generationTimeMs: 10,
        documentId: "doc-1",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
