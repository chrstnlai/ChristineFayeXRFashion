import type { CameraOffset, NormalizedHeadPose, Vec2 } from "../types";

export type HeadPoseConfig = {
  maxInputOffset: Vec2;
  maxCameraOffset: Vec2;
  deadZone: Vec2;
  confidenceFloor: number;
};

export const DEFAULT_HEAD_POSE_CONFIG: HeadPoseConfig = {
  maxInputOffset: { x: 0.14, y: 0.11 },
  maxCameraOffset: { x: 1.8, y: 1.2 },
  deadZone: { x: 0.012, y: 0.018 },
  confidenceFloor: 0.35,
};

/**
 * Maps a calibrated, normalized head pose into a clamped camera offset.
 * The curve is intentionally soft near the origin so tiny tracking noise
 * does not cause distracting camera movement.
 */
export function poseToCameraOffset(
  pose: NormalizedHeadPose | null,
  config: HeadPoseConfig = DEFAULT_HEAD_POSE_CONFIG,
): CameraOffset {
  if (!pose || pose.confidence < config.confidenceFloor) {
    return { x: 0, y: 0 };
  }

  const x = normalizeAxis(pose.x, config.maxInputOffset.x, config.deadZone.x);
  const y = normalizeAxis(pose.y, config.maxInputOffset.y, config.deadZone.y);

  return {
    x: cleanZero(-easeOutCubic(x) * config.maxCameraOffset.x),
    y: cleanZero(-easeOutCubic(y) * config.maxCameraOffset.y),
  };
}

/**
 * Blends two offsets with a frame-rate-independent factor.
 * Lower smoothing values settle quickly, higher values feel steadier.
 */
export function smoothOffset(
  previous: CameraOffset,
  next: CameraOffset,
  deltaSeconds: number,
  smoothing = 14,
): CameraOffset {
  const alpha = 1 - Math.exp(-Math.max(deltaSeconds, 0) * smoothing);

  return {
    x: previous.x + (next.x - previous.x) * alpha,
    y: previous.y + (next.y - previous.y) * alpha,
  };
}

function normalizeAxis(value: number, limit: number, deadZone: number): number {
  if (limit <= 0) {
    return 0;
  }

  const magnitude = Math.abs(value);
  if (magnitude <= deadZone) {
    return 0;
  }

  const adjustedMagnitude = magnitude - deadZone;
  const adjustedLimit = Math.max(limit - deadZone, Number.EPSILON);
  return clamp((adjustedMagnitude / adjustedLimit) * Math.sign(value), -1, 1);
}

function easeOutCubic(value: number): number {
  const direction = Math.sign(value);
  const magnitude = Math.abs(value);
  return direction * (1 - Math.pow(1 - magnitude, 3));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function cleanZero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}
