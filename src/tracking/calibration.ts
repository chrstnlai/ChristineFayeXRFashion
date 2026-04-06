import type { NormalizedHeadPose } from "../types";

/**
 * Collects a short neutral sample window and returns pose deltas once the
 * baseline is stable enough to use for camera movement.
 */
export class HeadPoseCalibrator {
  private readonly sampleTarget: number;
  private readonly samples: NormalizedHeadPose[] = [];
  private baseline: NormalizedHeadPose | null = null;

  constructor(sampleTarget = 18) {
    this.sampleTarget = sampleTarget;
  }

  update(pose: NormalizedHeadPose | null): NormalizedHeadPose | null {
    if (!pose) {
      return null;
    }

    if (!this.baseline) {
      this.samples.push(pose);

      if (this.samples.length >= this.sampleTarget) {
        this.baseline = averagePose(this.samples);
      }

      return null;
    }

    return {
      x: pose.x - this.baseline.x,
      y: pose.y - this.baseline.y,
      confidence: pose.confidence,
    };
  }

  reset(): void {
    this.samples.length = 0;
    this.baseline = null;
  }

  isReady(): boolean {
    return this.baseline !== null;
  }

  samplesNeeded(): number {
    return Math.max(this.sampleTarget - this.samples.length, 0);
  }
}

function averagePose(samples: NormalizedHeadPose[]): NormalizedHeadPose {
  const total = samples.reduce(
    (accumulator, sample) => ({
      x: accumulator.x + sample.x,
      y: accumulator.y + sample.y,
      confidence: accumulator.confidence + sample.confidence,
    }),
    { x: 0, y: 0, confidence: 0 },
  );

  return {
    x: total.x / samples.length,
    y: total.y / samples.length,
    confidence: total.confidence / samples.length,
  };
}
