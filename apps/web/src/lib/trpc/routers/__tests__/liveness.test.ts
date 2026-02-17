import type { Session } from "@/lib/auth/auth";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { computeLivenessAttestationProof } from "@/lib/identity/liveness/attestation";
import { livenessRouter } from "@/lib/trpc/routers/liveness";

const mockDetectFromBase64 = vi.fn();

vi.mock("@/lib/identity/liveness/human-server", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/lib/identity/liveness/human-server")
    >();
  return {
    ...actual,
    detectFromBase64: (...args: unknown[]) => mockDetectFromBase64(...args),
  };
});

const authedSession = {
  user: { id: "test-user", twoFactorEnabled: true },
  session: { id: "test-session", lastLoginMethod: "passkey" },
} as unknown as Session;

interface LivenessSessionWithAttestation {
  sessionId: string;
  challenges: Array<"smile" | "turn_left" | "turn_right">;
  attestationChallenge: string;
}

function createCaller(session: Session | null) {
  return livenessRouter.createCaller({
    req: new Request("http://localhost/api/trpc"),
    resHeaders: new Headers(),
    session,
    requestId: "test-request-id",
    flowId: null,
    flowIdSource: "none",
  });
}

describe("liveness router attestation gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.LIVENESS_REQUIRE_ATTESTATION = "1";
    process.env.LIVENESS_ATTESTATION_SECRET = "test-attestation-secret";
    mockDetectFromBase64.mockResolvedValue({ face: [] });
  });

  afterEach(() => {
    process.env.LIVENESS_REQUIRE_ATTESTATION = undefined;
    process.env.LIVENESS_ATTESTATION_SECRET = undefined;
  });

  it("rejects verify when attestation is missing", async () => {
    const caller = createCaller(authedSession);
    const session = await caller.createSession();

    const result = await caller.verify({
      sessionId: session.sessionId,
      baselineImage: "baseline-image",
      challenges: session.challenges.map((challengeType) => ({
        challengeType,
        image: "challenge-image",
      })),
    });

    expect(result.verified).toBe(false);
    expect(result.error).toBe("Missing liveness attestation");
  });

  it("rejects verify when attestation proof is invalid", async () => {
    const caller = createCaller(authedSession);
    const session =
      (await caller.createSession()) as unknown as LivenessSessionWithAttestation;

    const result = await caller.verify({
      sessionId: session.sessionId,
      baselineImage: "baseline-image",
      attestation: {
        challenge: session.attestationChallenge,
        proof: "invalid-proof",
      },
      challenges: session.challenges.map((challengeType) => ({
        challengeType,
        image: "challenge-image",
      })),
    } as never);

    expect(result.verified).toBe(false);
    expect(result.error).toBe("Invalid liveness attestation proof");
  });

  it("rejects replayed attestation challenge", async () => {
    const caller = createCaller(authedSession);
    const session =
      (await caller.createSession()) as unknown as LivenessSessionWithAttestation;
    const proof = computeLivenessAttestationProof(
      session.sessionId,
      session.attestationChallenge,
      process.env.LIVENESS_ATTESTATION_SECRET ?? ""
    );

    const first = await caller.verify({
      sessionId: session.sessionId,
      baselineImage: "baseline-image",
      attestation: {
        challenge: session.attestationChallenge,
        proof,
      },
      challenges: session.challenges.map((challengeType) => ({
        challengeType,
        image: "challenge-image",
      })),
    } as never);

    const replay = await caller.verify({
      sessionId: session.sessionId,
      baselineImage: "baseline-image",
      attestation: {
        challenge: session.attestationChallenge,
        proof,
      },
      challenges: session.challenges.map((challengeType) => ({
        challengeType,
        image: "challenge-image",
      })),
    } as never);

    expect(first.verified).toBe(false);
    expect(replay.verified).toBe(false);
    expect(replay.error).toBe("Invalid or replayed attestation challenge");
  });
});
