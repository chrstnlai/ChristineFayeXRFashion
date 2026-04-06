import { describe, expect, it } from "vitest";

import {
  DEFAULT_HEAD_POSE_CONFIG,
  poseToCameraOffset,
  smoothOffset,
} from "../src/tracking/headPoseMath";

describe("poseToCameraOffset", () => {
  it("returns neutral offset when tracking is absent", () => {
    expect(poseToCameraOffset(null)).toEqual({ x: 0, y: 0 });
  });

  it("holds a stable center inside the dead zone", () => {
    expect(
      poseToCameraOffset({
        x: DEFAULT_HEAD_POSE_CONFIG.deadZone.x * 0.8,
        y: DEFAULT_HEAD_POSE_CONFIG.deadZone.y * 0.8,
        confidence: 1,
      }),
    ).toEqual({ x: 0, y: 0 });
  });

  it("returns neutral offset when confidence is too low", () => {
    expect(
      poseToCameraOffset({
        x: 0.12,
        y: -0.06,
        confidence: DEFAULT_HEAD_POSE_CONFIG.confidenceFloor - 0.01,
      }),
    ).toEqual({ x: 0, y: 0 });
  });

  it("clamps large inputs to the configured camera bounds", () => {
    expect(
      poseToCameraOffset({
        x: 999,
        y: -999,
        confidence: 1,
      }),
    ).toEqual({
      x: -DEFAULT_HEAD_POSE_CONFIG.maxCameraOffset.x,
      y: DEFAULT_HEAD_POSE_CONFIG.maxCameraOffset.y,
    });
  });

  it("inverts left-right so the scene follows head movement naturally", () => {
    const left = poseToCameraOffset({ x: -0.08, y: 0, confidence: 1 });
    const right = poseToCameraOffset({ x: 0.08, y: 0, confidence: 1 });

    expect(left.x).toBeGreaterThan(0);
    expect(right.x).toBeLessThan(0);
    expect(Math.abs(left.x)).toBeCloseTo(Math.abs(right.x), 5);
  });

  it("maps vertical movement with the same non-inverted feel", () => {
    const up = poseToCameraOffset({ x: 0, y: 0.06, confidence: 1 });
    const down = poseToCameraOffset({ x: 0, y: -0.06, confidence: 1 });

    expect(up.y).toBeLessThan(0);
    expect(down.y).toBeGreaterThan(0);
  });

  it("still reacts once movement clears the dead zone", () => {
    const pose = poseToCameraOffset({
      x: DEFAULT_HEAD_POSE_CONFIG.deadZone.x + 0.02,
      y: 0,
      confidence: 1,
    });

    expect(Math.abs(pose.x)).toBeGreaterThan(0);
  });
});

describe("smoothOffset", () => {
  it("does not move when delta time is zero", () => {
    expect(smoothOffset({ x: 0, y: 0 }, { x: 1, y: 1 }, 0)).toEqual({
      x: 0,
      y: 0,
    });
  });

  it("moves toward the target without overshooting", () => {
    const result = smoothOffset({ x: 0, y: 0 }, { x: 1, y: -1 }, 1 / 60, 12);

    expect(result.x).toBeGreaterThan(0);
    expect(result.x).toBeLessThan(1);
    expect(result.y).toBeLessThan(0);
    expect(result.y).toBeGreaterThan(-1);
  });
});
