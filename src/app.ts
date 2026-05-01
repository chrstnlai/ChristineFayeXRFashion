import WebGL from "three/addons/capabilities/WebGL.js";

import { createSceneController } from "./scene/createScene";
import { HeadPoseCalibrator } from "./tracking/calibration";
import { FaceTracker } from "./tracking/faceTracker";
import { poseToCameraOffset, smoothOffset } from "./tracking/headPoseMath";
import { startCamera, stopCamera } from "./tracking/webcam";
import type { CameraOffset, NormalizedHeadPose } from "./types";

const CALIBRATION_SAMPLE_COUNT = 18;

export class HeadTrackedSpaceApp {
  private readonly root: HTMLDivElement;
  private readonly shell = document.createElement("div");
  private readonly sceneHost = document.createElement("div");
  private readonly overlay = document.createElement("section");
  private readonly overlayStatus = document.createElement("p");
  private readonly statusPill = document.createElement("div");
  private readonly startButton = document.createElement("button");
  private readonly resetButton = document.createElement("button");
  private readonly introVideoWrap = document.createElement("div");
  private readonly introVideoScrim = document.createElement("div");
  private readonly introTitleArt = document.createElement("img");
  private readonly introBgVideo = document.createElement("video");
  private readonly bgMusic = new Audio();
  private readonly musicMuteButton = document.createElement("button");
  private readonly video = document.createElement("video");
  private readonly tracker = new FaceTracker();
  private readonly calibrator = new HeadPoseCalibrator(CALIBRATION_SAMPLE_COUNT);
  private readonly scene = createSceneController(this.sceneHost, { faceVideo: this.video });

  private stream: MediaStream | null = null;
  private animationFrameId = 0;
  private videoFrameCallbackId: number | null = null;
  private lastFrameMs = 0;
  private smoothedOffset: CameraOffset = { x: 0, y: 0 };
  private latestPose: NormalizedHeadPose | null = null;
  private isStarted = false;
  private trackerStatus: "idle" | "loading" | "ready" | "error" = "idle";
  private trackerErrorMessage = "";

  constructor(root: HTMLDivElement) {
    this.root = root;
    this.root.replaceChildren();
    this.root.append(this.shell);

    this.shell.className = "app-shell";
    this.sceneHost.className = "scene-host";
    this.video.className = "camera-preview";
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.autoplay = true;
    this.video.setAttribute("playsinline", "true");

    this.overlay.className = "intro-overlay";

    this.introVideoWrap.className = "intro-video-wrap";
    this.introBgVideo.className = "intro-bg-video";
    this.introBgVideo.src = "/mmvideo.mp4";
    this.introBgVideo.muted = true;
    this.introBgVideo.loop = true;
    this.introBgVideo.playsInline = true;
    this.introBgVideo.autoplay = true;
    this.introBgVideo.setAttribute("playsinline", "true");
    this.introBgVideo.preload = "auto";

    this.bgMusic.src = "/justfornow.mp3";
    this.bgMusic.loop = true;
    this.bgMusic.preload = "auto";

    this.musicMuteButton.type = "button";
    this.musicMuteButton.className = "music-mute-button";
    this.musicMuteButton.setAttribute("aria-label", "Mute background music");
    this.musicMuteButton.addEventListener("click", () => {
      this.toggleMusicMute();
    });
    this.updateMusicMuteButtonLabel();

    this.introVideoScrim.className = "intro-video-scrim";
    this.introTitleArt.className = "intro-title-art";
    this.introTitleArt.src = encodeURI("/de-constructed self.png");
    this.introTitleArt.alt = "";
    this.introTitleArt.decoding = "async";

    this.introVideoWrap.append(this.introBgVideo, this.introVideoScrim, this.introTitleArt);

    const panel = document.createElement("div");
    panel.className = "intro-panel";

    this.startButton.type = "button";
    this.startButton.className = "start-button";
    this.startButton.textContent = "START EXPERIENCE";
    this.startButton.addEventListener("click", () => {
      void this.handleStart();
    });

    this.resetButton.type = "button";
    this.resetButton.className = "reset-button is-hidden";
    this.resetButton.textContent = "Reset Journey";
    this.resetButton.addEventListener("click", () => {
      this.resetJourney();
    });

    this.overlayStatus.className = "intro-status";
    //hello

    panel.append(this.startButton, this.overlayStatus);
    this.overlay.append(this.introVideoWrap, panel);

    this.statusPill.className = "status-pill";
    this.statusPill.textContent = "Loading tracker...";

    this.shell.append(
      this.sceneHost,
      this.overlay,
      this.statusPill,
      this.resetButton,
      this.musicMuteButton,
      this.video,
    );
  }

  async mount(): Promise<void> {
    if (!WebGL.isWebGL2Available()) {
      this.overlayStatus.textContent = "This browser cannot render the experience because WebGL 2 is missing.";
      this.sceneHost.append(WebGL.getWebGL2ErrorMessage());
      return;
    }

    this.scene.mount();
    void this.introBgVideo.play().catch(() => {});
    this.ensureBgMusicPlaying();
    this.beginTrackerWarmup();
    this.setPillStatus("Preparing head tracking...", true);
    window.addEventListener("beforeunload", () => {
      void this.dispose();
    });
  }

  private async handleStart(): Promise<void> {
    if (this.isStarted) {
      return;
    }

    this.ensureBgMusicPlaying();
    this.isStarted = true;
    this.startButton.disabled = true;
    this.overlayStatus.textContent = "Requesting camera access...";

    try {
      this.stream = await startCamera(this.video);
      this.lastFrameMs = performance.now();
      this.animationFrameId = requestAnimationFrame(this.onFrame);
      this.startVideoTrackingLoop();
      this.shell.classList.add("experience-live");
      this.video.classList.add("is-scene-mirror-source");

      if (this.trackerStatus === "ready") {
        this.beginCalibration();
      } else if (this.trackerStatus === "error") {
        this.setPillStatus(`Tracking unavailable: ${this.trackerErrorMessage}`, false);
      } else {
        this.setPillStatus("Camera live. Finishing tracker startup...", false);
      }

      void this.beginTrackerWarmup();
    } catch (error) {
      this.isStarted = false;
      this.video.classList.remove("is-scene-mirror-source");
      this.startButton.disabled = false;
      this.overlayStatus.textContent =
        error instanceof Error ? error.message : "Unable to start the camera.";
    }
  }

  private readonly onFrame = (frameMs: number): void => {
    const deltaSeconds = (frameMs - this.lastFrameMs) / 1000;
    this.lastFrameMs = frameMs;

    if (!this.supportsVideoFrameCallback() && this.trackerStatus === "ready") {
      this.latestPose = this.tracker.detect(this.video, frameMs);
    }

    const calibratedPose =
      this.trackerStatus === "ready" ? this.calibrator.update(this.latestPose) : null;
    const targetOffset = poseToCameraOffset(calibratedPose);
    this.smoothedOffset = smoothOffset(this.smoothedOffset, targetOffset, deltaSeconds);

    this.scene.render(
      frameMs,
      this.smoothedOffset,
      this.isStarted ? { video: this.video } : undefined,
    );
    this.updateRuntimeStatus(calibratedPose);
    this.resetButton.classList.toggle("is-hidden", !this.scene.hasReachedEnd());

    this.animationFrameId = requestAnimationFrame(this.onFrame);
  };

  private updateRuntimeStatus(calibratedPose: NormalizedHeadPose | null): void {
    if (!this.isStarted) {
      return;
    }

    if (this.trackerStatus === "loading") {
      this.setPillStatus("Warming up head tracking...", false);
      return;
    }

    if (this.trackerStatus === "error") {
      this.setPillStatus(`Tracking unavailable: ${this.trackerErrorMessage}`, false);
      return;
    }

    if (!this.latestPose) {
      if (this.scene.hasReachedEnd()) {
        this.setPillStatus("Journey complete. Reset when you want another pass.", false);
        return;
      }

      this.setPillStatus("Move into view so tracking can find your face.", false);
      return;
    }

    if (!this.calibrator.isReady()) {
      this.setPillStatus("Hold still briefly to calibrate the view.", false);
      return;
    }

    if (!calibratedPose) {
      if (this.scene.hasReachedEnd()) {
        this.setPillStatus("Journey complete. Reset when you want another pass.", false);
        return;
      }

      this.setPillStatus("Tracking paused. Return to center to continue.", false);
      return;
    }

    if (this.scene.hasReachedEnd()) {
      this.setPillStatus("Journey complete. Reset when you want another pass.", false);
      return;
    }

    this.setPillStatus("", true);
  }

  private beginCalibration(): void {
    this.calibrator.reset();
    this.latestPose = null;
    this.smoothedOffset = { x: 0, y: 0 };
    this.setPillStatus("Hold still briefly to calibrate the view.", false);
  }

  private resetJourney(): void {
    this.scene.resetProgress();
    this.beginCalibration();
    this.resetButton.classList.add("is-hidden");
  }

  private startVideoTrackingLoop(): void {
    if (this.supportsVideoFrameCallback()) {
      const schedule = () => {
        this.videoFrameCallbackId = this.video.requestVideoFrameCallback((now) => {
          try {
            if (this.trackerStatus === "ready") {
              this.latestPose = this.tracker.detect(this.video, now);
            }
          } finally {
            schedule();
          }
        });
      };

      schedule();
    }
  }

  private async beginTrackerWarmup(): Promise<void> {
    if (this.trackerStatus === "loading" || this.trackerStatus === "ready") {
      return;
    }

    this.trackerStatus = "loading";

    try {
      await this.tracker.initialize();
      this.trackerStatus = "ready";
      this.trackerErrorMessage = "";

      if (this.isStarted) {
        this.beginCalibration();
      } else {
        this.setPillStatus("Ready. Start the camera to enter the world.", true);
      }
    } catch (error) {
      this.trackerStatus = "error";
      this.trackerErrorMessage =
        error instanceof Error ? error.message : "Unknown tracker startup error.";
      this.setPillStatus(`Tracking unavailable: ${this.trackerErrorMessage}`, false);
    }
  }

  private setPillStatus(message: string, hidden: boolean): void {
    this.statusPill.textContent = message;
    this.statusPill.classList.toggle("is-hidden", hidden);
  }

  async dispose(): Promise<void> {
    cancelAnimationFrame(this.animationFrameId);

    if (this.videoFrameCallbackId !== null && this.supportsVideoFrameCallback()) {
      this.video.cancelVideoFrameCallback(this.videoFrameCallbackId);
      this.videoFrameCallbackId = null;
    }

    this.scene.dispose();
    this.tracker.dispose();

    this.video.classList.remove("is-scene-mirror-source");

    if (this.stream) {
      stopCamera(this.stream);
      this.stream = null;
    }

    this.introBgVideo.pause();
    this.introBgVideo.removeAttribute("src");
    this.introBgVideo.load();
    this.introTitleArt.removeAttribute("src");

    this.bgMusic.pause();
    this.bgMusic.removeAttribute("src");
    this.bgMusic.load();
  }

  private ensureBgMusicPlaying(): void {
    void this.bgMusic.play().catch(() => {});
  }

  private toggleMusicMute(): void {
    this.bgMusic.muted = !this.bgMusic.muted;
    this.updateMusicMuteButtonLabel();
  }

  private updateMusicMuteButtonLabel(): void {
    const muted = this.bgMusic.muted;
    this.musicMuteButton.textContent = muted ? "Unmute music" : "Mute music";
    this.musicMuteButton.setAttribute("aria-label", muted ? "Unmute background music" : "Mute background music");
    this.musicMuteButton.setAttribute("aria-pressed", muted ? "true" : "false");
  }

  private supportsVideoFrameCallback(): boolean {
    return typeof this.video.requestVideoFrameCallback === "function";
  }
}
