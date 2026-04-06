import { describe, expect, it } from "vitest";

import { extractHeadPoseFromLandmarks } from "../src/tracking/extractHeadPose";

function createLandmarks() {
  return Array.from({ length: 500 }, () => ({ x: 0.5, y: 0.5 }));
}

describe("extractHeadPoseFromLandmarks", () => {
  it("returns a centered pose for a centered face", () => {
    const landmarks = createLandmarks();

    landmarks[234] = { x: 0.3, y: 0.5 };
    landmarks[454] = { x: 0.7, y: 0.5 };
    landmarks[10] = { x: 0.5, y: 0.25 };
    landmarks[152] = { x: 0.5, y: 0.75 };
    landmarks[33] = { x: 0.4, y: 0.42 };
    landmarks[263] = { x: 0.6, y: 0.42 };
    landmarks[1] = { x: 0.5, y: 0.5 };
    landmarks[61] = { x: 0.43, y: 0.62 };
    landmarks[291] = { x: 0.57, y: 0.62 };

    const pose = extractHeadPoseFromLandmarks(landmarks);

    expect(pose?.x).toBeCloseTo(0, 5);
    expect(pose?.y).toBeCloseTo(-0.02, 5);
    expect(pose?.confidence).toBe(1);
  });

  it("tracks horizontal translation without depending on eye spacing", () => {
    const landmarks = createLandmarks();

    landmarks[234] = { x: 0.18, y: 0.5 };
    landmarks[454] = { x: 0.58, y: 0.5 };
    landmarks[10] = { x: 0.4, y: 0.24 };
    landmarks[152] = { x: 0.4, y: 0.74 };
    landmarks[33] = { x: 0.31, y: 0.41 };
    landmarks[263] = { x: 0.47, y: 0.41 };
    landmarks[1] = { x: 0.4, y: 0.5 };
    landmarks[61] = { x: 0.33, y: 0.61 };
    landmarks[291] = { x: 0.45, y: 0.61 };

    const pose = extractHeadPoseFromLandmarks(landmarks);

    expect(pose?.x).toBeGreaterThan(0.08);
    expect(pose?.confidence).toBe(1);
  });

  it("returns null when required landmarks are missing", () => {
    const landmarks = createLandmarks();
    landmarks[234] = undefined as never;

    expect(extractHeadPoseFromLandmarks(landmarks)).toBeNull();
  });
});
