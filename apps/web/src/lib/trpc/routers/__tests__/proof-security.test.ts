import type { Session } from "@/lib/auth/auth";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { POLICY_VERSION } from "@/lib/blockchain/attestation/policy";
import { getTodayDobDays } from "@/lib/identity/verification/birth-year";
import {
  HASH_TO_FIELD_INFO,
  hashToFieldHexFromString,
} from "@/lib/privacy/zk/hash-to-field";

const mockGetSelectedVerification = vi.fn();
const mockVerifyNoirProof = vi.fn();
const mockConsumeChallenge = vi.fn();
const mockCreateChallenge = vi.fn();
const mockGetActiveChallengeCount = vi.fn();
const mockGetProofSessionById = vi.fn();
const mockGetProofTypesByUserVerificationAndSession = vi.fn();
const mockGetProofHashesByUserVerificationAndSession = vi.fn();
const mockCloseProofSession = vi.fn();
const mockCreateProofSession = vi.fn();
const mockGetUserBaseCommitments = vi.fn();

vi.mock("@/lib/db/queries/identity", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/db/queries/identity")>();
  return {
    ...actual,
    getSelectedVerification: (...args: unknown[]) =>
      mockGetSelectedVerification(...args),
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
    getProofSessionById: (...args: unknown[]) =>
      mockGetProofSessionById(...args),
    getProofTypesByUserVerificationAndSession: (...args: unknown[]) =>
      mockGetProofTypesByUserVerificationAndSession(...args),
    getProofHashesByUserVerificationAndSession: (...args: unknown[]) =>
      mockGetProofHashesByUserVerificationAndSession(...args),
    closeProofSession: (...args: unknown[]) => mockCloseProofSession(...args),
    createProofSession: (...args: unknown[]) => mockCreateProofSession(...args),
    getUserBaseCommitments: (...args: unknown[]) =>
      mockGetUserBaseCommitments(...args),
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
async function contextField(
  value: string,
  info:
    | typeof HASH_TO_FIELD_INFO.IDENTITY_MSG_SENDER
    | typeof HASH_TO_FIELD_INFO.IDENTITY_AUDIENCE
): Promise<string> {
  const mapped = await hashToFieldHexFromString(value, info);
  return BigInt(mapped).toString();
}
const browserAudience = "http://localhost:3000";
const baseCommitment = "3";
const bindingCommitment = "2";
const isBound = "1";
const proofSessionId = "11111111-1111-4111-8111-111111111111";
const expectedNormalizedNonce = (() => {
  const raw = BigInt(nonce);
  const limit = BigInt(2) ** BigInt(128);
  return (raw % limit).toString(16).padStart(32, "0");
})();

let msgSenderHash = "";
let audienceHash = "";
let browserAudienceHash = "";
let validProofArgs: {
  circuitType: "identity_binding";
  proof: string;
  proofSessionId: string;
  publicInputs: string[];
};
let validProofArgsBrowserAudience: {
  circuitType: "identity_binding";
  proof: string;
  proofSessionId: string;
  publicInputs: string[];
};

async function createCaller(
  session: Session | null,
  options: { url?: string; headers?: HeadersInit } = {}
) {
  const { zkRouter } = await import("@/lib/trpc/routers/zk/router");
  return zkRouter.createCaller({
    req: new Request(options.url ?? "http://localhost/api/trpc", {
      ...(options.headers === undefined ? {} : { headers: options.headers }),
    }),
    resHeaders: new Headers(),
    session,
    requestId: "test-request-id",
    flowId: null,
    flowIdSource: "none",
  });
}

describe("proof router replay and context binding", () => {
  beforeEach(async () => {
    [msgSenderHash, audienceHash, browserAudienceHash] = await Promise.all([
      contextField("user-123", HASH_TO_FIELD_INFO.IDENTITY_MSG_SENDER),
      contextField("http://localhost", HASH_TO_FIELD_INFO.IDENTITY_AUDIENCE),
      contextField(browserAudience, HASH_TO_FIELD_INFO.IDENTITY_AUDIENCE),
    ]);

    validProofArgs = {
      proof: "cHJvdG9wcm90b2RvY3Rvcg==",
      publicInputs: [
        nonce,
        msgSenderHash,
        audienceHash,
        baseCommitment,
        bindingCommitment,
        isBound,
      ],
      circuitType: "identity_binding",
      proofSessionId,
    };

    validProofArgsBrowserAudience = {
      ...validProofArgs,
      publicInputs: [
        nonce,
        msgSenderHash,
        browserAudienceHash,
        baseCommitment,
        bindingCommitment,
        isBound,
      ],
    };

    vi.clearAllMocks();
    mockGetSelectedVerification.mockResolvedValue({
      id: "ver-1",
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
    mockGetProofSessionById.mockResolvedValue({
      id: proofSessionId,
      userId: "user-123",
      verificationId: "ver-1",
      msgSender: "user-123",
      audience: "http://localhost",
      policyVersion: POLICY_VERSION,
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      closedAt: null,
    });
    mockGetProofTypesByUserVerificationAndSession.mockResolvedValue([
      "identity_binding",
    ]);
    mockGetProofHashesByUserVerificationAndSession.mockResolvedValue([]);
    mockCloseProofSession.mockResolvedValue(undefined);
    mockCreateProofSession.mockResolvedValue(undefined);
    mockGetUserBaseCommitments.mockResolvedValue([baseCommitment]);
    mockGetActiveChallengeCount.mockResolvedValue(1);
    mockCreateChallenge.mockImplementation(
      async (
        circuitType: string,
        binding: {
          userId: string;
          msgSender: string;
          audience: string;
          proofSessionId?: string;
        }
      ) => ({
        nonce: "challenge-nonce",
        circuitType,
        userId: binding.userId,
        msgSender: binding.msgSender,
        audience: binding.audience,
        proofSessionId: binding.proofSessionId,
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
        proofSessionId,
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
        proofSessionId,
      }
    );
  });

  it("rejects proofs when challenge is missing for a different caller context", async () => {
    mockConsumeChallenge.mockResolvedValue(null);
    mockGetProofSessionById.mockResolvedValueOnce({
      id: proofSessionId,
      userId: "user-456",
      verificationId: "ver-1",
      msgSender: "user-456",
      audience: "http://localhost",
      policyVersion: POLICY_VERSION,
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      closedAt: null,
    });
    const attackerMsgSenderHash = await contextField(
      "user-456",
      HASH_TO_FIELD_INFO.IDENTITY_MSG_SENDER
    );

    const attacker = await createCaller(alternateUserSession);
    await expect(
      attacker.verifyProof({
        ...validProofArgs,
        publicInputs: [
          nonce,
          attackerMsgSenderHash,
          audienceHash,
          baseCommitment,
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
        proofSessionId,
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
          baseCommitment,
          bindingCommitment,
          isBound,
        ],
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects proofs when identity binding msg_sender hash mismatches caller", async () => {
    const mismatchedMsgSenderHash = await contextField(
      "user-999",
      HASH_TO_FIELD_INFO.IDENTITY_MSG_SENDER
    );
    const caller = await createCaller(authedUserSession);
    await expect(
      caller.verifyProof({
        ...validProofArgs,
        publicInputs: [
          nonce,
          mismatchedMsgSenderHash,
          audienceHash,
          baseCommitment,
          bindingCommitment,
          isBound,
        ],
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(mockConsumeChallenge).not.toHaveBeenCalled();
  });

  it("uses Origin header audience for identity binding context", async () => {
    mockGetProofSessionById.mockResolvedValueOnce({
      id: proofSessionId,
      userId: "user-123",
      verificationId: "ver-1",
      msgSender: "user-123",
      audience: browserAudience,
      policyVersion: POLICY_VERSION,
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      closedAt: null,
    });
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
        proofSessionId,
      }
    );
  });

  it("binds challenge audience from Origin header", async () => {
    mockGetProofSessionById.mockResolvedValueOnce({
      id: proofSessionId,
      userId: "user-123",
      verificationId: "ver-1",
      msgSender: "user-123",
      audience: browserAudience,
      policyVersion: POLICY_VERSION,
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      closedAt: null,
    });
    const caller = await createCaller(authedUserSession, {
      url: "http://localhost/api/trpc",
      headers: { origin: browserAudience },
    });

    const result = await caller.createChallenge({
      circuitType: "face_match",
      proofSessionId,
    });

    expect(result.circuitType).toBe("face_match");
    expect(mockCreateChallenge).toHaveBeenCalledWith(
      "face_match",
      expect.objectContaining({
        userId: "user-123",
        msgSender: "user-123",
        audience: browserAudience,
        proofSessionId,
      })
    );
  });

  it("binds challenge audience from forwarded headers when Origin is missing", async () => {
    mockGetProofSessionById.mockResolvedValueOnce({
      id: proofSessionId,
      userId: "user-123",
      verificationId: "ver-1",
      msgSender: "user-123",
      audience: "https://verify.example.com",
      policyVersion: POLICY_VERSION,
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      closedAt: null,
    });
    const caller = await createCaller(authedUserSession, {
      url: "http://internal/api/trpc",
      headers: {
        "x-forwarded-host": "verify.example.com",
        "x-forwarded-proto": "https",
      },
    });

    await caller.createChallenge({
      circuitType: "identity_binding",
      proofSessionId,
    });

    expect(mockCreateChallenge).toHaveBeenCalledWith(
      "identity_binding",
      expect.objectContaining({
        userId: "user-123",
        msgSender: "user-123",
        audience: "https://verify.example.com",
        proofSessionId,
      })
    );
  });

  it("rejects age proofs when min_age_days exceeds uint32 range", async () => {
    const caller = await createCaller(authedUserSession);

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
        proofSessionId,
        verificationId: "ver-1",
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("min_age_days"),
    });

    expect(mockVerifyNoirProof).not.toHaveBeenCalled();
    expect(mockConsumeChallenge).not.toHaveBeenCalled();
  });

  it("rejects storing age proofs when min_age_days exceeds uint32 range", async () => {
    const caller = await createCaller(authedUserSession);

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
        proofSessionId,
        verificationId: "ver-1",
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("min_age_days"),
    });

    expect(mockVerifyNoirProof).not.toHaveBeenCalled();
    expect(mockConsumeChallenge).not.toHaveBeenCalled();
  });

  it("rejects storing non-binding proofs until identity binding is stored", async () => {
    mockGetProofTypesByUserVerificationAndSession.mockResolvedValue([]);
    const caller = await createCaller(authedUserSession);

    await expect(
      caller.storeProof({
        circuitType: "age_verification",
        proof: "cHJvdG9wcm90b2RvY3Rvcg==",
        publicSignals: [getTodayDobDays().toString(), "6570", "1", "1", "1"],
        generationTimeMs: 10,
        proofSessionId,
        verificationId: "ver-1",
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
    ["identity_binding", 6],
  ] as const)("storeProof rejects %s when public signals are below minimum", async (circuitType, minPublicInputs) => {
    const caller = await createCaller(authedUserSession);

    await expect(
      caller.storeProof({
        circuitType,
        proof: "cHJvdG9wcm90b2RvY3Rvcg==",
        publicSignals: Array.from({ length: minPublicInputs - 1 }, () => "1"),
        generationTimeMs: 10,
        proofSessionId,
        verificationId: "ver-1",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
