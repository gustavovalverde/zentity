import type { FaceResult } from "@vladmandic/human";

import { describe, expect, it } from "vitest";

import {
  getFacingDirection,
  getHappyScore,
  getLiveScore,
  getRealScore,
  getYawDegrees,
} from "../human/metrics";

const face = (partial: Partial<FaceResult>) => partial as FaceResult;

/** A face turned by `deg` degrees; Human reports rotation in radians. */
const turned = (deg: number) =>
  face({
    rotation: {
      angle: { roll: 0, pitch: 0, yaw: (deg * Math.PI) / 180 },
    },
  } as unknown as Partial<FaceResult>);

describe("human face metrics", () => {
  it("defaults absent scores to 0", () => {
    const empty = face({});
    expect(getHappyScore(empty)).toBe(0);
    expect(getRealScore(empty)).toBe(0);
    expect(getLiveScore(empty)).toBe(0);
    expect(getYawDegrees(empty)).toBe(0);
  });

  it("reads the happy score from the emotion list", () => {
    expect(
      getHappyScore(
        face({
          emotion: [
            { score: 0.2, emotion: "neutral" },
            { score: 0.7, emotion: "happy" },
          ],
        })
      )
    ).toBe(0.7);
  });

  it("reads antispoof and liveness scores", () => {
    const f = face({ real: 0.9, live: 0.8 });
    expect(getRealScore(f)).toBe(0.9);
    expect(getLiveScore(f)).toBe(0.8);
  });

  it("converts yaw from radians to degrees and keeps its sign", () => {
    expect(getYawDegrees(turned(30))).toBeCloseTo(30);
    expect(getYawDegrees(turned(-30))).toBeCloseTo(-30);
  });

  it("derives facing direction from yaw against the threshold", () => {
    expect(getFacingDirection(turned(-20), 10)).toBe("left");
    expect(getFacingDirection(turned(20), 10)).toBe("right");
    expect(getFacingDirection(turned(5), 10)).toBe("center");
    expect(getFacingDirection(turned(-10), 10)).toBe("center");
  });
});
