import { describe, expect, it } from "vitest";

import { HeadPoseCalibrator } from "../src/tracking/calibration";

describe("HeadPoseCalibrator", () => {
  it("waits for enough samples before producing deltas", () => {
    const calibrator = new HeadPoseCalibrator(2);

    expect(calibrator.update({ x: 0.1, y: -0.1, confidence: 1 })).toBeNull();
    expect(calibrator.isReady()).toBe(false);

    expect(calibrator.update({ x: 0.2, y: -0.2, confidence: 1 })).toBeNull();
    expect(calibrator.isReady()).toBe(true);
  });

  it("returns offsets relative to the captured neutral pose", () => {
    const calibrator = new HeadPoseCalibrator(2);

    calibrator.update({ x: 0.1, y: -0.1, confidence: 1 });
    calibrator.update({ x: 0.3, y: -0.3, confidence: 1 });

    expect(calibrator.update({ x: 0.5, y: -0.5, confidence: 0.9 })).toEqual({
      x: 0.3,
      y: -0.3,
      confidence: 0.9,
    });
  });

  it("can reset and capture a fresh baseline", () => {
    const calibrator = new HeadPoseCalibrator(1);

    calibrator.update({ x: 0.2, y: 0.1, confidence: 1 });
    calibrator.reset();

    expect(calibrator.isReady()).toBe(false);
    expect(calibrator.samplesNeeded()).toBe(1);
    expect(calibrator.update({ x: -0.2, y: 0.4, confidence: 1 })).toBeNull();
    expect(calibrator.isReady()).toBe(true);
  });
});
