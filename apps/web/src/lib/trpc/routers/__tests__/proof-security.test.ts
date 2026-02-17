import type { Session } from "@/lib/auth/auth";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSelectedIdentityDocumentByUserId = vi.fn();
const mockVerifyNoirProof = vi.fn();
const mockConsumeChallenge = vi.fn();

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
const bindingCommitment = "2";
const isBound = "1";
const expectedNormalizedNonce = (() => {
  const raw = BigInt(nonce);
  const limit = BigInt(2) ** BigInt(128);
  return (raw % limit).toString(16).padStart(32, "0");
})();

const validProofArgs = {
  proof: "cHJvdG9wcm90b2RvY3Rvcg==",
  publicInputs: [nonce, bindingCommitment, isBound],
  circuitType: "identity_binding" as const,
};

async function createCaller(session: Session | null) {
  const { cryptoRouter } = await import("@/lib/trpc/routers/crypto/router");
  return cryptoRouter.createCaller({
    req: new Request("http://localhost/api/trpc"),
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
        publicInputs: [nonce, bindingCommitment, isBound],
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
        publicInputs: ["9999999999", bindingCommitment, isBound],
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
