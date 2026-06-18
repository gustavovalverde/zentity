import type { AdvanceResult } from "../challenges";

import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getIdentityDraftById,
  updateIdentityDraft,
} from "@/lib/db/queries/identity";

import {
  getFacingDirection,
  getHappyScore,
  getLiveScore,
  getPrimaryFace,
  getRealScore,
  getYawDegrees,
} from "../human/metrics";
import { detectFromBuffer } from "../human/server";
import { advanceFrame, createLivenessSession, hashSelfie } from "../session";

vi.mock("../human/server", () => ({ detectFromBuffer: vi.fn() }));
vi.mock("../human/metrics", () => ({
  getFacingDirection: vi.fn(),
  getHappyScore: vi.fn(),
  getLiveScore: vi.fn(),
  getPrimaryFace: vi.fn(),
  getRealScore: vi.fn(),
  getYawDegrees: vi.fn(),
}));
vi.mock("@/lib/db/queries/identity", () => ({
  getIdentityDraftById: vi.fn(),
  updateIdentityDraft: vi.fn(),
}));
vi.mock("@/lib/logging/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const USER = "user-a";
const FRAME = Buffer.from([1, 2, 3]);

type Detection = Awaited<ReturnType<typeof detectFromBuffer>>;
const EMPTY_RESULT = {} as Detection;
// Non-null sentinel face; the metric mocks supply the scores.
const FACE = { box: [0, 0, 10, 10] } as unknown as ReturnType<
  typeof getPrimaryFace
>;

const detect = vi.mocked(detectFromBuffer);
const primaryFace = vi.mocked(getPrimaryFace);
const happy = vi.mocked(getHappyScore);
const real = vi.mocked(getRealScore);
const live = vi.mocked(getLiveScore);
const yaw = vi.mocked(getYawDegrees);
const facing = vi.mocked(getFacingDirection);
const draftById = vi.mocked(getIdentityDraftById);
const writeDraft = vi.mocked(updateIdentityDraft);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  vi.clearAllMocks();
  detect.mockResolvedValue(EMPTY_RESULT);
  primaryFace.mockReturnValue(FACE);
  happy.mockReturnValue(0);
  real.mockReturnValue(0.95);
  live.mockReturnValue(0.95);
  yaw.mockReturnValue(0);
  facing.mockReturnValue("center");
});

afterEach(() => {
  vi.useRealTimers();
});

/** Advance fake time (clears the per-session throttle) then process one frame. */
function step(sessionId: string, advanceMs = 100, userId = USER) {
  vi.advanceTimersByTime(advanceMs);
  return advanceFrame({ sessionId, userId, frame: FRAME });
}

function expectPhase(
  outcome: AdvanceResult | null,
  phase: string
): asserts outcome is AdvanceResult {
  if (!outcome || outcome.phase !== phase) {
    throw new Error(`expected phase ${phase}, got ${outcome?.phase ?? "null"}`);
  }
}

/**
 * Walk the engine to its terminal outcome. The single challenge is always a head
 * turn (the generator forces one); we read its direction from the snapshot, then
 * drive centering followed by a yaw past the threshold.
 */
async function driveToCompletion(sessionId: string): Promise<AdvanceResult> {
  await step(sessionId); // detecting (1)
  expectPhase(await step(sessionId), "countdown"); // detecting (2) -> countdown

  const challenging = await step(sessionId, 3100); // countdown elapsed -> challenge
  expectPhase(challenging, "challenging");
  const turnLeft =
    "challenge" in challenging && challenging.challenge?.type === "turn_left";

  facing.mockReturnValue("center");
  yaw.mockReturnValue(0);
  await step(sessionId); // center the head

  yaw.mockReturnValue(turnLeft ? -20 : 20);
  await step(sessionId); // turn pass (1)
  await step(sessionId); // turn pass (2) -> verifying

  return (await step(sessionId)) as AdvanceResult; // verifying -> terminal
}

describe("liveness session ownership and lifecycle", () => {
  it("returns null for a frame against an unknown session", async () => {
    expect(
      await advanceFrame({ sessionId: "nope", userId: USER, frame: FRAME })
    ).toBeNull();
  });

  it("returns null when the frame's user does not own the session", async () => {
    const { sessionId } = createLivenessSession({
      userId: USER,
      draftId: null,
    });
    expect(await step(sessionId, 100, "user-b")).toBeNull();
  });

  it("fails with SESSION_TIMEOUT once the session lifetime elapses", async () => {
    const { sessionId } = createLivenessSession({
      userId: USER,
      draftId: null,
    });
    const outcome = await step(sessionId, 61_000);
    expect(outcome).toMatchObject({ phase: "failed", code: "session_timeout" });
  });

  it("never exposes the hidden challenge sequence at creation", () => {
    const created = createLivenessSession({ userId: USER, draftId: null });
    expect(created).not.toHaveProperty("challenges");
    expect(created.snapshot).not.toHaveProperty("challenges");
  });
});

describe("hashSelfie is the single canonical representation", () => {
  it("matches a plain sha256 of the data URL, deterministically", () => {
    const dataUrl = "data:image/jpeg;base64,AAAA";
    const expected = createHash("sha256").update(dataUrl).digest("hex");
    expect(hashSelfie(dataUrl)).toBe(expected);
  });
});

describe("liveness throttle", () => {
  it("drops a frame inside the throttle window without re-running detection", async () => {
    const { sessionId } = createLivenessSession({
      userId: USER,
      draftId: null,
    });
    await advanceFrame({ sessionId, userId: USER, frame: FRAME });
    await advanceFrame({ sessionId, userId: USER, frame: FRAME }); // same instant: dropped
    expect(detect).toHaveBeenCalledTimes(1);
  });
});

describe("liveness terminal write (the trust boundary)", () => {
  it("writes server scores and the canonical selfie hash, then completes", async () => {
    draftById.mockResolvedValue({ userId: USER } as unknown as Awaited<
      ReturnType<typeof getIdentityDraftById>
    >);

    const { sessionId } = createLivenessSession({
      userId: USER,
      draftId: "draft-1",
      challengeCount: 1,
    });
    const outcome = await driveToCompletion(sessionId);

    expect(outcome).toMatchObject({
      phase: "completed",
      verified: true,
      draftUpdated: true,
      confidence: 0.95,
    });

    expect(writeDraft).toHaveBeenCalledTimes(1);
    const [draftId, updates] = writeDraft.mock.calls[0] ?? [];
    expect(draftId).toBe("draft-1");
    expect(updates).toMatchObject({
      userId: USER,
      antispoofScore: 0.95,
      liveScore: 0.95,
    });

    // The written hash equals hashSelfie of the exact selfie returned to the client.
    const selfieImage = (outcome as { selfieImage: string }).selfieImage;
    expect((updates as { verifiedSelfieHash: string }).verifiedSelfieHash).toBe(
      hashSelfie(selfieImage)
    );
  });

  it("re-checks draft ownership at write time and skips a mismatched draft", async () => {
    draftById.mockResolvedValue({
      userId: "someone-else",
    } as unknown as Awaited<ReturnType<typeof getIdentityDraftById>>);

    const { sessionId } = createLivenessSession({
      userId: USER,
      draftId: "draft-1",
      challengeCount: 1,
    });
    const outcome = await driveToCompletion(sessionId);

    expect(outcome).toMatchObject({ phase: "completed", draftUpdated: false });
    expect(writeDraft).not.toHaveBeenCalled();
  });

  it("fails the anti-spoof gate and never writes when the real score is too low", async () => {
    const { sessionId } = createLivenessSession({
      userId: USER,
      draftId: "draft-1",
      challengeCount: 1,
    });
    real.mockReturnValue(0.05);

    const outcome = await driveToCompletion(sessionId);
    expect(outcome).toMatchObject({
      phase: "failed",
      code: "antispoof_failed",
    });
    expect(writeDraft).not.toHaveBeenCalled();
  });
});
