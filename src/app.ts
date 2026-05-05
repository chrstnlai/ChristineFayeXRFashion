import WebGL from "three/addons/capabilities/WebGL.js";

import { createSceneController } from "./scene/createScene";
import { HeadPoseCalibrator } from "./tracking/calibration";
import { FaceTracker } from "./tracking/faceTracker";
import { poseToCameraOffset, smoothOffset } from "./tracking/headPoseMath";
import { startCamera, stopCamera } from "./tracking/webcam";
import type { CameraOffset, NormalizedHeadPose } from "./types";

const CALIBRATION_SAMPLE_COUNT = 18;
/** Used only if `scan.mp3` metadata never loads. */
const FALLBACK_SCAN_DURATION_SEC = 5;

const MUSIC_ICON_UNMUTED = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`;

const MUSIC_ICON_MUTED = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`;

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
  private readonly bgMusic = document.createElement("audio");
  private readonly startBoom = document.createElement("audio");
  private readonly scanSfx = document.createElement("audio");
  private readonly faceDetectedCue = document.createElement("audio");
  private readonly scanPhaseOverlay = document.createElement("section");
  private readonly scanPhaseLine = document.createElement("div");
  private readonly musicMuteButton = document.createElement("button");
  private readonly video = document.createElement("video");
  private readonly tracker = new FaceTracker();
  private readonly calibrator = new HeadPoseCalibrator(CALIBRATION_SAMPLE_COUNT);
  private readonly scene = createSceneController(this.sceneHost, { faceVideo: this.video });

  private stream: MediaStream | null = null;
  private scanPhaseTimeoutId = 0;
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

    this.bgMusic.className = "bg-music-audio";
    this.bgMusic.src = "/intheair.mp3";
    this.bgMusic.loop = true;
    this.bgMusic.preload = "auto";
    this.bgMusic.autoplay = true;
    this.bgMusic.setAttribute("playsinline", "true");
    this.bgMusic.setAttribute("aria-hidden", "true");
    this.wireBgMusicAutoplay();

    this.startBoom.src = "/boom.mp3";
    this.startBoom.preload = "auto";
    this.startBoom.setAttribute("playsinline", "true");
    this.startBoom.setAttribute("aria-hidden", "true");

    this.scanSfx.src = "/scan.mp3";
    this.scanSfx.preload = "auto";
    this.scanSfx.setAttribute("playsinline", "true");
    this.scanSfx.setAttribute("aria-hidden", "true");

    this.faceDetectedCue.src = "/face_detected_female_fast_us.wav";
    this.faceDetectedCue.preload = "auto";
    this.faceDetectedCue.setAttribute("playsinline", "true");
    this.faceDetectedCue.setAttribute("aria-hidden", "true");

    this.scanPhaseOverlay.className = "scan-phase-overlay is-hidden";
    this.scanPhaseOverlay.setAttribute("aria-hidden", "true");
    this.scanPhaseLine.className = "scan-phase-line";
    this.scanPhaseOverlay.append(this.scanPhaseLine);

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
      this.bgMusic,
      this.startBoom,
      this.scanSfx,
      this.faceDetectedCue,
      this.scanPhaseOverlay,
      this.sceneHost,
      this.overlay,
      this.statusPill,
      this.resetButton,
      this.musicMuteButton,
      this.video,
    );

    this.shell.addEventListener(
      "pointerdown",
      () => {
        this.ensureBgMusicPlaying();
      },
      { once: true, capture: true },
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
    if (this.isStarted || this.scanPhaseTimeoutId !== 0) {
      return;
    }

    // Keep landing music (`intheair.mp3`) through scan + face cue; it stops when the face wav ends.
    this.ensureBgMusicPlaying();

    this.startButton.disabled = true;
    this.overlayStatus.textContent = "Requesting camera access...";

    try {
      this.stream = await startCamera(this.video);
      void this.video.play().catch(() => {});

      // Fullscreen camera + scan overlay — one laser pass down + one up, timed to full length of scan.mp3.
      this.shell.classList.add("scan-phase-active");
      this.scanPhaseOverlay.classList.remove("is-hidden");

      const durationSec = await this.getScanSfxDurationSeconds();
      const durationMs = Math.max(16, Math.round(durationSec * 1000));
      this.scanPhaseLine.style.setProperty("--scan-sweep-duration", `${durationSec}s`);
      this.restartScanLineAnimation();

      this.scanSfx.loop = false;
      this.scanSfx.currentTime = 0;
      void this.scanSfx.play().catch(() => {});

      this.scanPhaseTimeoutId = window.setTimeout(() => {
        this.scanPhaseTimeoutId = 0;
        void this.finishScanPhaseAndEnterExperience();
      }, durationMs);

      void this.beginTrackerWarmup();
    } catch (error) {
      this.clearScanPhaseUi();
      this.startButton.disabled = false;
      this.overlayStatus.textContent =
        error instanceof Error ? error.message : "Unable to start the camera.";
    }
  }

  private restartScanLineAnimation(): void {
    this.scanPhaseLine.style.animation = "none";
    void this.scanPhaseLine.offsetHeight;
    this.scanPhaseLine.style.animation = "";
  }

  /** Duration of scan.mp3 in seconds (metadata). Fallback if unavailable. */
  private async getScanSfxDurationSeconds(): Promise<number> {
    const valid = (d: number): boolean => Number.isFinite(d) && d > 0;

    if (this.scanSfx.readyState >= HTMLMediaElement.HAVE_METADATA && valid(this.scanSfx.duration)) {
      return this.scanSfx.duration;
    }

    await new Promise<void>((resolve) => {
      const timeoutId = window.setTimeout(resolve, 3000);
      const done = (): void => {
        window.clearTimeout(timeoutId);
        resolve();
      };
      this.scanSfx.addEventListener("loadedmetadata", done, { once: true });
      this.scanSfx.addEventListener("error", done, { once: true });
    });

    return valid(this.scanSfx.duration) ? this.scanSfx.duration : FALLBACK_SCAN_DURATION_SEC;
  }

  private clearScanPhaseUi(): void {
    if (this.scanPhaseTimeoutId !== 0) {
      window.clearTimeout(this.scanPhaseTimeoutId);
      this.scanPhaseTimeoutId = 0;
    }
    this.stopScanSfx();

    this.shell.classList.remove("scan-phase-active");
    this.scanPhaseOverlay.classList.add("is-hidden");
  }

  private stopScanSfx(): void {
    this.scanSfx.loop = false;
    this.scanSfx.pause();
    this.scanSfx.currentTime = 0;
  }

  private async playAudioToEnd(audio: HTMLAudioElement): Promise<void> {
    audio.currentTime = 0;
    await new Promise<void>((resolve) => {
      const done = (): void => resolve();
      audio.addEventListener("ended", done, { once: true });
      audio.addEventListener("error", done, { once: true });
      void audio.play().catch(done);
    });
  }

  private async finishScanPhaseAndEnterExperience(): Promise<void> {
    if (this.isStarted) {
      return;
    }

    // Scan animation is done; hide the laser overlay but keep fullscreen camera for cues.
    this.scanPhaseOverlay.classList.add("is-hidden");
    this.stopScanSfx();

    await this.playAudioToEnd(this.faceDetectedCue);

    // Hand off from ambient bed to boom; enter WebGL without waiting for boom to finish.
    this.bgMusic.pause();
    this.bgMusic.currentTime = 0;

    this.shell.classList.remove("scan-phase-active");

    this.isStarted = true;
    this.shell.classList.add("experience-live");
    this.video.classList.add("is-scene-mirror-source");

    this.startBoom.currentTime = 0;
    void this.startBoom.play().catch(() => {});

    this.lastFrameMs = performance.now();
    this.animationFrameId = requestAnimationFrame(this.onFrame);
    this.startVideoTrackingLoop();

    if (this.trackerStatus === "ready") {
      this.beginCalibration();
    } else if (this.trackerStatus === "error") {
      this.setPillStatus(`Tracking unavailable: ${this.trackerErrorMessage}`, false);
    } else {
      this.setPillStatus("Camera live. Finishing tracker startup...", false);
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
    this.clearScanPhaseUi();
    this.faceDetectedCue.pause();
    this.faceDetectedCue.currentTime = 0;
    this.startBoom.pause();
    this.startBoom.currentTime = 0;

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

  private wireBgMusicAutoplay(): void {
    const tryPlay = (): void => {
      void this.bgMusic.play().catch(() => {});
    };
    tryPlay();
    this.bgMusic.addEventListener("loadeddata", tryPlay, { once: true });
    this.bgMusic.addEventListener("canplay", tryPlay, { once: true });
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
    this.musicMuteButton.innerHTML = muted ? MUSIC_ICON_MUTED : MUSIC_ICON_UNMUTED;
    this.musicMuteButton.setAttribute("aria-label", muted ? "Unmute background music" : "Mute background music");
    this.musicMuteButton.setAttribute("aria-pressed", muted ? "true" : "false");
  }

  private supportsVideoFrameCallback(): boolean {
    return typeof this.video.requestVideoFrameCallback === "function";
  }
}
