import type { NormalizedHeadPose } from "../types";
import type {
  FaceLandmarker as MediaPipeFaceLandmarker,
  FaceLandmarkerResult,
} from "@mediapipe/tasks-vision";
import { extractHeadPoseFromLandmarks } from "./extractHeadPose";

const MEDIAPIPE_WASM_ROOT = "/vendor/mediapipe";
const FACE_LANDMARKER_MODEL_URL = "/models/face_landmarker.task";
const MAX_DETECTION_FPS = 30;
const LOST_TRACKING_GRACE_MS = 250;

export class FaceTracker {
  private faceLandmarker: MediaPipeFaceLandmarker | null = null;
  private initializationPromise: Promise<void> | null = null;
  private lastVideoTime = -1;
  private lastPose: NormalizedHeadPose | null = null;
  private lastPoseMs = 0;
  private lastDetectionMs = 0;

  async initialize(): Promise<void> {
    if (this.faceLandmarker) {
      return;
    }

    if (!this.initializationPromise) {
      this.initializationPromise = this.load().catch((error) => {
        this.initializationPromise = null;
        throw error;
      });
    }

    return this.initializationPromise;
  }

  isReady(): boolean {
    return this.faceLandmarker !== null;
  }

  detect(video: HTMLVideoElement, frameMs: number): NormalizedHeadPose | null {
    if (!this.faceLandmarker || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      return this.getFallbackPose(frameMs);
    }

    if (video.currentTime === this.lastVideoTime) {
      return this.getFallbackPose(frameMs);
    }

    if (frameMs - this.lastDetectionMs < 1000 / MAX_DETECTION_FPS) {
      return this.getFallbackPose(frameMs);
    }

    this.lastVideoTime = video.currentTime;
    this.lastDetectionMs = frameMs;

    try {
      const result = this.faceLandmarker.detectForVideo(video, frameMs);
      const pose = extractHeadPose(result);

      if (pose) {
        this.lastPose = pose;
        this.lastPoseMs = frameMs;
      }

      return this.getFallbackPose(frameMs);
    } catch {
      return this.getFallbackPose(frameMs);
    }
  }

  dispose(): void {
    this.faceLandmarker?.close();
    this.faceLandmarker = null;
    this.initializationPromise = null;
    this.lastPose = null;
    this.lastPoseMs = 0;
    this.lastDetectionMs = 0;
    this.lastVideoTime = -1;
  }

  private async load(): Promise<void> {
    const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
    const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_ROOT);

    this.faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: FACE_LANDMARKER_MODEL_URL,
      },
      runningMode: "VIDEO",
      numFaces: 1,
      minFaceDetectionConfidence: 0.55,
      minFacePresenceConfidence: 0.55,
      minTrackingConfidence: 0.55,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
    });
  }

  private getFallbackPose(frameMs: number): NormalizedHeadPose | null {
    if (!this.lastPose) {
      return null;
    }

    if (frameMs - this.lastPoseMs <= LOST_TRACKING_GRACE_MS) {
      return this.lastPose;
    }

    this.lastPose = null;
    return null;
  }
}

function extractHeadPose(result: FaceLandmarkerResult): NormalizedHeadPose | null {
  return extractHeadPoseFromLandmarks(result.faceLandmarks[0]);
}
