import { describe, expect, it, vi } from "vitest";

const trpcMocks = vi.hoisted(() => ({
  zk: {
    createChallenge: { mutate: vi.fn() },
  },
}));

vi.mock("@/lib/trpc/client", () => ({
  trpc: trpcMocks,
}));

describe("crypto-client FHE", () => {
  it("dedupes concurrent proof challenge requests", async () => {
    const { getProofChallenge } = await import("@/lib/privacy/zk/client");
    const proofSessionId = "11111111-1111-4111-8111-111111111111";
    const challenge = {
      nonce: "nonce",
      circuitType: "age_verification",
      expiresAt: new Date().toISOString(),
    };
    const challengePromise = Promise.resolve(challenge);
    const createChallenge = vi.fn().mockReturnValue(challengePromise);

    const trpcClient = await import("@/lib/trpc/client");
    const originalCreateChallenge = trpcClient.trpc.zk.createChallenge;
    trpcClient.trpc.zk.createChallenge = { mutate: createChallenge };

    const first = getProofChallenge("age_verification", proofSessionId);
    const second = getProofChallenge("age_verification", proofSessionId);

    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toEqual(challenge);
    expect(secondResult).toEqual(challenge);
    expect(createChallenge).toHaveBeenCalledTimes(1);
    expect(createChallenge).toHaveBeenCalledWith({
      circuitType: "age_verification",
      proofSessionId,
    });

    trpcClient.trpc.zk.createChallenge = originalCreateChallenge;
  });
});
