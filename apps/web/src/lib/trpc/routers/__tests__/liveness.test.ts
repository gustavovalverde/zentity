import type { Session } from "@/lib/auth/auth";

import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { computeLivenessAttestationProof } from "@/lib/identity/liveness/attestation";
import { livenessRouter } from "@/lib/trpc/routers/liveness";

const mockDetectFromBase64 = vi.fn();
const mockGetIdentityDraftById = vi.fn();
const mockUpdateIdentityDraft = vi.fn();

vi.mock("@/lib/identity/liveness/human-server", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/lib/identity/liveness/human-server")
    >();
  return {
    ...actual,
    detectFromBase64: (...args: unknown[]) => mockDetectFromBase64(...args),
    getHumanServer: vi.fn(),
  };
});

vi.mock("@/lib/db/queries/identity", () => ({
  getIdentityDraftById: (...args: unknown[]) =>
    mockGetIdentityDraftById(...args),
  updateIdentityDraft: (...args: unknown[]) => mockUpdateIdentityDraft(...args),
}));

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

describe("faceMatch selfie hash binding", () => {
  const SELFIE = "data:image/jpeg;base64,/9j/test-selfie-data";
  const SELFIE_HASH = createHash("sha256").update(SELFIE).digest("hex");

  beforeEach(() => {
    vi.clearAllMocks();
    mockDetectFromBase64.mockResolvedValue({ face: [] });
  });

  it("rejects when liveness not completed (null verifiedSelfieHash)", async () => {
    mockGetIdentityDraftById.mockResolvedValue({
      id: "draft-1",
      userId: "test-user",
      verifiedSelfieHash: null,
    });

    const caller = createCaller(authedSession);
    const result = await caller.faceMatch({
      idImage: "data:image/jpeg;base64,id-image",
      selfieImage: SELFIE,
      draftId: "draft-1",
    });

    expect(result.matched).toBe(false);
    expect(result.error).toBe("Liveness not completed for this draft");
  });

  it("rejects when selfie hash does not match stored hash", async () => {
    mockGetIdentityDraftById.mockResolvedValue({
      id: "draft-1",
      userId: "test-user",
      verifiedSelfieHash: "000000different-hash",
    });

    const caller = createCaller(authedSession);
    const result = await caller.faceMatch({
      idImage: "data:image/jpeg;base64,id-image",
      selfieImage: SELFIE,
      draftId: "draft-1",
    });

    expect(result.matched).toBe(false);
    expect(result.error).toBe("Selfie does not match liveness session");
  });

  it("passes hash check and proceeds to face detection when selfie matches", async () => {
    mockGetIdentityDraftById.mockResolvedValue({
      id: "draft-1",
      userId: "test-user",
      verifiedSelfieHash: SELFIE_HASH,
    });
    // detectFromBase64 returns no faces → code reaches detection but finds no match
    mockDetectFromBase64.mockResolvedValue({ face: [] });

    const caller = createCaller(authedSession);
    const result = await caller.faceMatch({
      idImage: "data:image/jpeg;base64,id-image",
      selfieImage: SELFIE,
      draftId: "draft-1",
    });

    // Hash check passed — error is about face detection, not selfie binding
    expect(result.error).not.toBe("Selfie does not match liveness session");
    expect(result.error).not.toBe("Liveness not completed for this draft");
    expect(result.idFaceExtracted).toBe(false);
  });
});
