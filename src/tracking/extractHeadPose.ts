import type { NormalizedHeadPose } from "../types";

type LandmarkLike = {
  x: number;
  y: number;
};

const LEFT_FACE_INDEX = 234;
const RIGHT_FACE_INDEX = 454;
const FOREHEAD_INDEX = 10;
const CHIN_INDEX = 152;
const LEFT_EYE_INDEX = 33;
const RIGHT_EYE_INDEX = 263;
const NOSE_TIP_INDEX = 1;
const MOUTH_LEFT_INDEX = 61;
const MOUTH_RIGHT_INDEX = 291;

/**
 * Converts MediaPipe face landmarks into a stable 2D head-translation signal.
 * The center is estimated from several anchor points so small eye/mouth changes
 * do not collapse tracking the way a single-feature heuristic can.
 */
export function extractHeadPoseFromLandmarks(
  landmarks: LandmarkLike[] | undefined,
): NormalizedHeadPose | null {
  if (!landmarks) {
    return null;
  }

  const leftFace = landmarks[LEFT_FACE_INDEX];
  const rightFace = landmarks[RIGHT_FACE_INDEX];
  const forehead = landmarks[FOREHEAD_INDEX];
  const chin = landmarks[CHIN_INDEX];
  const leftEye = landmarks[LEFT_EYE_INDEX];
  const rightEye = landmarks[RIGHT_EYE_INDEX];
  const noseTip = landmarks[NOSE_TIP_INDEX];
  const mouthLeft = landmarks[MOUTH_LEFT_INDEX];
  const mouthRight = landmarks[MOUTH_RIGHT_INDEX];

  if (
    !leftFace ||
    !rightFace ||
    !forehead ||
    !chin ||
    !leftEye ||
    !rightEye ||
    !noseTip ||
    !mouthLeft ||
    !mouthRight
  ) {
    return null;
  }

  const faceCenterX = average(leftFace.x, rightFace.x, noseTip.x);
  const faceCenterY = average(forehead.y, chin.y, noseTip.y);
  const eyeCenterX = average(leftEye.x, rightEye.x);
  const eyeCenterY = average(leftEye.y, rightEye.y);
  const mouthCenterX = average(mouthLeft.x, mouthRight.x);
  const mouthCenterY = average(mouthLeft.y, mouthRight.y);

  const stabilizedX = weightedAverage([
    [faceCenterX, 0.55],
    [eyeCenterX, 0.25],
    [mouthCenterX, 0.2],
  ]);
  const stabilizedY = weightedAverage([
    [faceCenterY, 0.5],
    [eyeCenterY, 0.2],
    [mouthCenterY, 0.3],
  ]);

  return {
    x: 0.5 - stabilizedX,
    y: 0.5 - stabilizedY,
    confidence: 1,
  };
}

function average(...values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function weightedAverage(values: Array<[number, number]>): number {
  const totalWeight = values.reduce((sum, [, weight]) => sum + weight, 0);
  const weightedSum = values.reduce((sum, [value, weight]) => sum + value * weight, 0);
  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}
