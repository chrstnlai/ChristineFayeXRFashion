import {
  AmbientLight,
  Clock,
  Color,
  DirectionalLight,
  MathUtils,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";

import type { CameraOffset } from "../types";
import type { SceneEnvironmentFactory } from "./environment";
import { createCameraFramePlaceholder } from "./cameraFramePlaceholder";
import { createGltfEnvironment } from "./environments/gltfEnvironment";

type SceneVideoFeed = {
  video: HTMLVideoElement;
};

type SceneController = {
  mount(): void;
  render(frameMs: number, offset: CameraOffset, videoFeed?: SceneVideoFeed): void;
  hasReachedEnd(): boolean;
  /** True once the default GLB is fully renderable (textures + paint frames); custom factories use mesh presence only. */
  hasEnvironmentLoaded(): boolean;
  resetProgress(): void;
  dispose(): void;
};

type SceneControllerOptions = {
  environmentFactory?: SceneEnvironmentFactory;
  /** Fires when the default GLTF environment is fully renderable (ignored if you supply `environmentFactory`). */
  onEnvironmentLoaded?: () => void;
  /** Webcam element for the opening live-feed quad */
  faceVideo?: HTMLVideoElement;
};

const CAMERA_BASE_POSITION = new Vector3(-0.1, 1.52, 25);
const LOOK_DISTANCE = 12;
const JOURNEY_END_Z = -28;
const JOURNEY_SPEED = 0.55;
/** × applied to `JOURNEY_SPEED` for the +Z return glide only (second glide, after flip + Y descent). */
const POST_FLIP_RETURN_PLUS_Z_GLIDE_SPEED_MUL = 2;
/** × applied to `JOURNEY_SPEED` for the third-phase −Z glide (after return timer). */
const POST_FLIP_THIRD_PHASE_GLIDE_SPEED_MUL = 1.5;
const BASE_PITCH = -0.08;
const BASE_YAW = 0.16;
const CAMERA_FRAME_OFFSET_Z = 4.6;
/** Extra +Y on the first (left) blinking frame only (world up). */
const CAMERA_FRAME_FIRST_CENTER_Y_OFFSET = 0.12;
/** World-space gap between the two frame centers (second frame to the +X “right” of the first). */
const CAMERA_FRAME_PAIR_SPACING_X = 1.65;
/** Extra +Y on the second (right) blinking frame only (world up). */
const CAMERA_FRAME_RIGHT_CENTER_Y_OFFSET = 0.1;
/** Extra X on the second (right) front frame only (negative = left, positive = right). */
const CAMERA_FRAME_RIGHT_DELTA_X = 0.12;
/** Extra rotation Y on the right frame only (negative = tilt a bit to the left). */
const CAMERA_FRAME_RIGHT_ROTATION_Y_OFFSET = -0.1;
/** Extra −Z on the right duplicate (deeper along the glide / “further back”). */
const CAMERA_FRAME_RIGHT_DELTA_Z = -1.6;
/** Right frame: blink-only period before inner webcam can reveal (left uses placeholder default). */
const CAMERA_FRAME_RIGHT_INNER_DELAY_SECONDS = 3;
/** Extra −Z on the frame behind the first (negative = deeper along the glide). */
const CAMERA_FRAME_BACK_DELTA_Z = -2.45;
/** Extra +Y on the third (back) blinking frame only (world up). */
const CAMERA_FRAME_BACK_CENTER_Y_OFFSET = 0.08;
/** Back frame: lateral offset from first frame’s X (negative = more to the left). */
const CAMERA_FRAME_BACK_DELTA_X = -0.26;
/** Back frame: blink-only period before inner webcam can reveal. */
const CAMERA_FRAME_BACK_INNER_DELAY_SECONDS = 2.5;
/** Fourth frame: offset from third frame center (+X = right, −Z = farther behind). */
const CAMERA_FRAME_DEEP_OFFSET_X = 1.3;
const CAMERA_FRAME_DEEP_OFFSET_Z = -2.7;
/** Fifth frame: offset from fourth (deep) center (−X = left, −Z = farther behind). */
const CAMERA_FRAME_FIFTH_OFFSET_X = -2.7;
const CAMERA_FRAME_FIFTH_OFFSET_Z = -4.2;
/** Extra +Y on the fifth blinking frame only (world up). */
const CAMERA_FRAME_FIFTH_CENTER_Y_OFFSET = 0.2;
/** Fifth frame: blink-only period before inner webcam can reveal. */
const CAMERA_FRAME_FIFTH_INNER_DELAY_SECONDS = 2.5;
/** Sixth frame: offset from fifth center (+X = right, −Z = farther behind). */
const CAMERA_FRAME_SIXTH_OFFSET_X = 3.5;
const CAMERA_FRAME_SIXTH_OFFSET_Z = -3.4;
/** Extra +Y on the sixth blinking frame relative to fifth’s center Y (negative = lower). */
const CAMERA_FRAME_SIXTH_CENTER_Y_OFFSET = -0.18;
/** Sixth frame: blink-only period before inner webcam can reveal. */
const CAMERA_FRAME_SIXTH_INNER_DELAY_SECONDS = 2.5;
/** Seventh frame: offset from sixth center (−X = left, −Z = farther behind). */
const CAMERA_FRAME_SEVENTH_OFFSET_X = -2.4;
const CAMERA_FRAME_SEVENTH_OFFSET_Z = -1.5;
/** Seventh frame: blink-only period before inner webcam can reveal. */
const CAMERA_FRAME_SEVENTH_INNER_DELAY_SECONDS = 2.5;
/** Eighth frame: offset from seventh center (+X = right, −Z = farther behind). */
const CAMERA_FRAME_EIGHTH_OFFSET_X = 1.12;
const CAMERA_FRAME_EIGHTH_OFFSET_Z = -4;
/** Eighth frame: blink-only period before inner webcam can reveal. */
const CAMERA_FRAME_EIGHTH_INNER_DELAY_SECONDS = 2.5;
/** Ninth frame: offset from eighth center (−X = left, −Z = a bit farther behind). */
const CAMERA_FRAME_NINTH_OFFSET_X = -2.25;
const CAMERA_FRAME_NINTH_OFFSET_Z = -1.5;
/** Extra +Y on the ninth blinking frame (world up, relative to eighth’s center Y). */
const CAMERA_FRAME_NINTH_CENTER_Y_OFFSET = 0.14;
/** Ninth frame: blink-only period before inner webcam can reveal. */
const CAMERA_FRAME_NINTH_INNER_DELAY_SECONDS = 2.5;
/** World +Y applied the same frame as the 180° flip (then post-flip hold / descent still apply). */
const CAMERA_FLIP_CORRIDOR_LIFT_Y = 0.52;
/**
 * After this many seconds in the live experience, flip the view 180° (if not already flipped).
 * The ninth blinking frame’s inner face can flip earlier — see `ninthFlipFromInnerFaceLatched`.
 */
const EXPERIENCE_VIEW_FLIP_AFTER_SEC = 60;
/** Stay at the normal eye height this long after the flip (180° only, no drop yet). */
const POST_FLIGHT_DESCENT_HOLD_SEC = 1.5;
/** World −Y per second once the hold ends. */
const POST_FLIGHT_DESCENT_SPEED = 2.5;
/** Max drop below the normal eye line after the hold (keep shallow). */
const POST_FLIGHT_DESCENT_MAX_Y = 4;
/** After flip + vertical descent begins, glide +Z (opposite of the opening −Z run) up to this cap. */
const POST_FLIP_RETURN_GLIDE_END_Z = CAMERA_BASE_POSITION.z + 5.5;
/** After this many seconds in the +Z return glide, add π yaw and glide −Z again until `JOURNEY_END_Z`. */
const POST_FLIP_RETURN_THIRD_PHASE_AFTER_SEC = 19;
const CAMERA_FAR_DEFAULT = 140;
/** Slightly wider far clip after the flip so the space still draws while shifted. */
const CAMERA_FAR_FLIPPED = 280;

export function createSceneController(
  host: HTMLDivElement,
  options: SceneControllerOptions = {},
): SceneController {
  const scene = new Scene();
  scene.background = new Color("#03060d");

  const camera = new PerspectiveCamera(72, 1, 0.1, CAMERA_FAR_DEFAULT);
  camera.position.copy(CAMERA_BASE_POSITION);

  const renderer = new WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = SRGBColorSpace;

  const clock = new Clock();
  /** Default GLTF path: becomes true only after geometry, textures, and frame delay (see gltfEnvironment). */
  let environmentFullyReady = false;
  const environment = (
    options.environmentFactory ??
    (() =>
      createGltfEnvironment({
        url: "/models/fog3.glb",
        worldRollZRad: Math.PI,
        onLoadComplete: () => {
          environmentFullyReady = true;
          options.onEnvironmentLoaded?.();
        },
      }))
  )();
  const lookDirection = new Vector3();
  const lookTarget = new Vector3();
  let currentCameraZ = CAMERA_BASE_POSITION.z;
  let hasReachedEnd = false;
  let rightFrameStarted = false;
  let backFrameStarted = false;
  let deepFrameStarted = false;
  let fifthFrameStarted = false;
  let sixthFrameStarted = false;
  let seventhFrameStarted = false;
  let eighthFrameStarted = false;
  let ninthFrameStarted = false;
  let liveExperienceElapsedSec = 0;
  /** Once the ninth frame’s webcam quad is revealed, latch the same 180° flip as the timed flip. */
  let ninthFlipFromInnerFaceLatched = false;
  /** Live-experience seconds when the corridor flip first became active (timed or ninth). */
  let corridorFlipStartedAtLiveSec: number | null = null;
  /** When the +Z return glide (`dropY > 0` while flipped) first began. */
  let postFlipReturnGlideStartedAtLiveSec: number | null = null;
  /** After `POST_FLIP_RETURN_THIRD_PHASE_AFTER_SEC` in the return glide: −Z again + yaw +π. */
  let postFlipThirdPhaseLatched = false;

  buildLights(scene);
  scene.add(environment.root);

  const frameCenterY = CAMERA_BASE_POSITION.y + 0.1;
  const frameCenterYFirst = frameCenterY + CAMERA_FRAME_FIRST_CENTER_Y_OFFSET;
  const frameCenterZ = CAMERA_BASE_POSITION.z - CAMERA_FRAME_OFFSET_Z;
  const frameCenterXLeft = CAMERA_BASE_POSITION.x - 0.42;
  const backFrameCenterX = frameCenterXLeft + CAMERA_FRAME_BACK_DELTA_X;
  const backFrameCenterZ = frameCenterZ + CAMERA_FRAME_BACK_DELTA_Z;
  const deepFrameCenterX = backFrameCenterX + CAMERA_FRAME_DEEP_OFFSET_X;
  const deepFrameCenterZ = backFrameCenterZ + CAMERA_FRAME_DEEP_OFFSET_Z;
  const fifthFrameCenterX = deepFrameCenterX + CAMERA_FRAME_FIFTH_OFFSET_X;
  const fifthFrameCenterY = frameCenterY + CAMERA_FRAME_FIFTH_CENTER_Y_OFFSET;
  const fifthFrameCenterZ = deepFrameCenterZ + CAMERA_FRAME_FIFTH_OFFSET_Z;
  const sixthFrameCenterX = fifthFrameCenterX + CAMERA_FRAME_SIXTH_OFFSET_X;
  const sixthFrameCenterY = fifthFrameCenterY + CAMERA_FRAME_SIXTH_CENTER_Y_OFFSET;
  const sixthFrameCenterZ = fifthFrameCenterZ + CAMERA_FRAME_SIXTH_OFFSET_Z;
  const seventhFrameCenterX = sixthFrameCenterX + CAMERA_FRAME_SEVENTH_OFFSET_X;
  const seventhFrameCenterY = sixthFrameCenterY;
  const seventhFrameCenterZ = sixthFrameCenterZ + CAMERA_FRAME_SEVENTH_OFFSET_Z;
  const eighthFrameCenterX = seventhFrameCenterX + CAMERA_FRAME_EIGHTH_OFFSET_X;
  const eighthFrameCenterY = seventhFrameCenterY;
  const eighthFrameCenterZ = seventhFrameCenterZ + CAMERA_FRAME_EIGHTH_OFFSET_Z;

  const cameraFrameLeft = createCameraFramePlaceholder({
    center: new Vector3(frameCenterXLeft, frameCenterYFirst, frameCenterZ),
    rotationY: BASE_YAW,
    width: 0.25,
    height: 0.3,
    video: options.faceVideo,
    distortVideoFeed: true,
  });
  const cameraFrameBack = createCameraFramePlaceholder({
    center: new Vector3(
      backFrameCenterX,
      frameCenterY + CAMERA_FRAME_BACK_CENTER_Y_OFFSET,
      backFrameCenterZ,
    ),
    rotationY: BASE_YAW,
    width: 0.25,
    height: 0.3,
    video: options.faceVideo,
    distortVideoFeed: true,
    innerDelaySeconds: CAMERA_FRAME_BACK_INNER_DELAY_SECONDS,
  });
  const cameraFrameRight = createCameraFramePlaceholder({
    center: new Vector3(
      frameCenterXLeft + CAMERA_FRAME_PAIR_SPACING_X + CAMERA_FRAME_RIGHT_DELTA_X,
      frameCenterY + CAMERA_FRAME_RIGHT_CENTER_Y_OFFSET,
      frameCenterZ + CAMERA_FRAME_RIGHT_DELTA_Z,
    ),
    rotationY: BASE_YAW + CAMERA_FRAME_RIGHT_ROTATION_Y_OFFSET,
    width: 0.25,
    height: 0.3,
    video: options.faceVideo,
    distortVideoFeed: true,
    innerDelaySeconds: CAMERA_FRAME_RIGHT_INNER_DELAY_SECONDS,
  });
  const cameraFrameDeep = createCameraFramePlaceholder({
    center: new Vector3(deepFrameCenterX, frameCenterY, deepFrameCenterZ),
    rotationY: BASE_YAW,
    width: 0.25,
    height: 0.3,
    video: options.faceVideo,
    distortVideoFeed: true,
    innerDelaySeconds: CAMERA_FRAME_BACK_INNER_DELAY_SECONDS,
  });
  const cameraFrameFifth = createCameraFramePlaceholder({
    center: new Vector3(fifthFrameCenterX, fifthFrameCenterY, fifthFrameCenterZ),
    rotationY: BASE_YAW,
    width: 0.25,
    height: 0.3,
    video: options.faceVideo,
    distortVideoFeed: true,
    innerDelaySeconds: CAMERA_FRAME_FIFTH_INNER_DELAY_SECONDS,
  });
  const cameraFrameSixth = createCameraFramePlaceholder({
    center: new Vector3(sixthFrameCenterX, sixthFrameCenterY, sixthFrameCenterZ),
    rotationY: BASE_YAW,
    width: 0.25,
    height: 0.3,
    video: options.faceVideo,
    distortVideoFeed: true,
    innerDelaySeconds: CAMERA_FRAME_SIXTH_INNER_DELAY_SECONDS,
  });
  const cameraFrameSeventh = createCameraFramePlaceholder({
    center: new Vector3(seventhFrameCenterX, seventhFrameCenterY, seventhFrameCenterZ),
    rotationY: BASE_YAW,
    width: 0.25,
    height: 0.3,
    video: options.faceVideo,
    distortVideoFeed: true,
    innerDelaySeconds: CAMERA_FRAME_SEVENTH_INNER_DELAY_SECONDS,
  });
  const cameraFrameEighth = createCameraFramePlaceholder({
    center: new Vector3(eighthFrameCenterX, eighthFrameCenterY, eighthFrameCenterZ),
    rotationY: BASE_YAW,
    width: 0.25,
    height: 0.3,
    video: options.faceVideo,
    distortVideoFeed: true,
    innerDelaySeconds: CAMERA_FRAME_EIGHTH_INNER_DELAY_SECONDS,
  });
  const cameraFrameNinth = createCameraFramePlaceholder({
    center: new Vector3(
      eighthFrameCenterX + CAMERA_FRAME_NINTH_OFFSET_X,
      eighthFrameCenterY + CAMERA_FRAME_NINTH_CENTER_Y_OFFSET,
      eighthFrameCenterZ + CAMERA_FRAME_NINTH_OFFSET_Z,
    ),
    rotationY: BASE_YAW,
    width: 0.25,
    height: 0.3,
    video: options.faceVideo,
    distortVideoFeed: true,
    innerDelaySeconds: CAMERA_FRAME_NINTH_INNER_DELAY_SECONDS,
  });
  cameraFrameRight.root.visible = false;
  cameraFrameBack.root.visible = false;
  cameraFrameDeep.root.visible = false;
  cameraFrameFifth.root.visible = false;
  cameraFrameSixth.root.visible = false;
  cameraFrameSeventh.root.visible = false;
  cameraFrameEighth.root.visible = false;
  cameraFrameNinth.root.visible = false;
  scene.add(
    cameraFrameLeft.root,
    cameraFrameBack.root,
    cameraFrameRight.root,
    cameraFrameDeep.root,
    cameraFrameFifth.root,
    cameraFrameSixth.root,
    cameraFrameSeventh.root,
    cameraFrameEighth.root,
    cameraFrameNinth.root,
  );

  function mount(): void {
    renderer.domElement.className = "scene-canvas";
    host.replaceChildren(renderer.domElement);
    resize();
    window.addEventListener("resize", resize);
  }

  function render(_frameMs: number, offset: CameraOffset, videoFeed?: SceneVideoFeed): void {
    const deltaSeconds = clock.getDelta();
    const elapsed = clock.elapsedTime;
    environment.update(elapsed);

    if (videoFeed != null) {
      liveExperienceElapsedSec += deltaSeconds;
    }

    const feed = {
      video: videoFeed?.video,
      cameraWorldPosition: camera.position,
    };
    cameraFrameLeft.update(elapsed, feed);

    if (!rightFrameStarted && cameraFrameLeft.isFacePopulated()) {
      rightFrameStarted = true;
    }
    if (rightFrameStarted) {
      cameraFrameRight.root.visible = true;
      cameraFrameRight.update(elapsed, feed);
    }

    if (!backFrameStarted && rightFrameStarted && cameraFrameRight.isFacePopulated()) {
      backFrameStarted = true;
    }
    if (backFrameStarted) {
      cameraFrameBack.root.visible = true;
      cameraFrameBack.update(elapsed, feed);
    }

    if (!deepFrameStarted && backFrameStarted && cameraFrameBack.isFacePopulated()) {
      deepFrameStarted = true;
    }
    if (deepFrameStarted) {
      cameraFrameDeep.root.visible = true;
      cameraFrameDeep.update(elapsed, feed);
    }

    if (!fifthFrameStarted && deepFrameStarted && cameraFrameDeep.isFacePopulated()) {
      fifthFrameStarted = true;
    }
    if (fifthFrameStarted) {
      cameraFrameFifth.root.visible = true;
      cameraFrameFifth.update(elapsed, feed);
    }

    if (!sixthFrameStarted && fifthFrameStarted && cameraFrameFifth.isFacePopulated()) {
      sixthFrameStarted = true;
    }
    if (sixthFrameStarted) {
      cameraFrameSixth.root.visible = true;
      cameraFrameSixth.update(elapsed, feed);
    }

    if (!seventhFrameStarted && sixthFrameStarted && cameraFrameSixth.isFacePopulated()) {
      seventhFrameStarted = true;
    }
    if (seventhFrameStarted) {
      cameraFrameSeventh.root.visible = true;
      cameraFrameSeventh.update(elapsed, feed);
    }

    if (!eighthFrameStarted && seventhFrameStarted && cameraFrameSeventh.isFacePopulated()) {
      eighthFrameStarted = true;
    }
    if (eighthFrameStarted) {
      cameraFrameEighth.root.visible = true;
      cameraFrameEighth.update(elapsed, feed);
    }

    if (!ninthFrameStarted && eighthFrameStarted && cameraFrameEighth.isFacePopulated()) {
      ninthFrameStarted = true;
    }
    if (ninthFrameStarted) {
      cameraFrameNinth.root.visible = true;
      cameraFrameNinth.update(elapsed, feed);
    }

    if (ninthFrameStarted && cameraFrameNinth.isFacePopulated()) {
      ninthFlipFromInnerFaceLatched = true;
    }

    const viewFlippedVertically =
      liveExperienceElapsedSec >= EXPERIENCE_VIEW_FLIP_AFTER_SEC || ninthFlipFromInnerFaceLatched;

    if (viewFlippedVertically && corridorFlipStartedAtLiveSec === null) {
      corridorFlipStartedAtLiveSec = liveExperienceElapsedSec;
    }

    const postFlipElapsed =
      viewFlippedVertically && corridorFlipStartedAtLiveSec !== null
        ? Math.max(0, liveExperienceElapsedSec - corridorFlipStartedAtLiveSec)
        : 0;
    const descentElapsed = Math.max(0, postFlipElapsed - POST_FLIGHT_DESCENT_HOLD_SEC);
    const dropY = Math.min(descentElapsed * POST_FLIGHT_DESCENT_SPEED, POST_FLIGHT_DESCENT_MAX_Y);
    const flipLiftY = viewFlippedVertically ? CAMERA_FLIP_CORRIDOR_LIFT_Y : 0;
    const cameraY = CAMERA_BASE_POSITION.y + flipLiftY - dropY;

    const postFlipGlideReturn =
      viewFlippedVertically && dropY > 0 && !hasReachedEnd && corridorFlipStartedAtLiveSec !== null;

    if (postFlipGlideReturn && postFlipReturnGlideStartedAtLiveSec === null) {
      postFlipReturnGlideStartedAtLiveSec = liveExperienceElapsedSec;
    }
    const postFlipReturnGlideElapsedSec =
      postFlipReturnGlideStartedAtLiveSec !== null
        ? Math.max(0, liveExperienceElapsedSec - postFlipReturnGlideStartedAtLiveSec)
        : 0;
    if (postFlipGlideReturn && postFlipReturnGlideElapsedSec >= POST_FLIP_RETURN_THIRD_PHASE_AFTER_SEC) {
      postFlipThirdPhaseLatched = true;
    }

    const postFlipThirdPhase =
      postFlipThirdPhaseLatched &&
      viewFlippedVertically &&
      dropY > 0 &&
      !hasReachedEnd &&
      corridorFlipStartedAtLiveSec !== null;
    const postFlipGlideReturnPlusZ = postFlipGlideReturn && !postFlipThirdPhase;

    const pitchBase = MathUtils.clamp(BASE_PITCH - offset.y * 0.16, -0.36, 0.36);
    const pitch = pitchBase + (viewFlippedVertically ? Math.PI : 0);

    const yaw =
      BASE_YAW +
      -offset.x * 0.28 +
      (postFlipThirdPhase ? Math.PI : 0);

    lookDirection.set(
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      -Math.cos(yaw) * Math.cos(pitch),
    );

    if (!hasReachedEnd) {
      if (postFlipThirdPhase) {
        currentCameraZ = Math.max(
          currentCameraZ - JOURNEY_SPEED * POST_FLIP_THIRD_PHASE_GLIDE_SPEED_MUL * deltaSeconds,
          JOURNEY_END_Z,
        );
        hasReachedEnd = currentCameraZ <= JOURNEY_END_Z;
      } else if (postFlipGlideReturnPlusZ) {
        currentCameraZ = Math.min(
          currentCameraZ + JOURNEY_SPEED * POST_FLIP_RETURN_PLUS_Z_GLIDE_SPEED_MUL * deltaSeconds,
          POST_FLIP_RETURN_GLIDE_END_Z,
        );
      } else {
        currentCameraZ = Math.max(currentCameraZ - JOURNEY_SPEED * deltaSeconds, JOURNEY_END_Z);
        hasReachedEnd = currentCameraZ <= JOURNEY_END_Z;
      }
    }

    camera.position.set(CAMERA_BASE_POSITION.x, cameraY, currentCameraZ);

    const desiredFar = viewFlippedVertically ? CAMERA_FAR_FLIPPED : CAMERA_FAR_DEFAULT;
    if (camera.far !== desiredFar) {
      camera.far = desiredFar;
      camera.updateProjectionMatrix();
    }

    camera.up.set(0, viewFlippedVertically ? -1 : 1, 0);
    lookTarget.copy(camera.position).addScaledVector(lookDirection, LOOK_DISTANCE);
    camera.lookAt(lookTarget);

    renderer.render(scene, camera);
  }

  function hasReachedEndState(): boolean {
    return hasReachedEnd;
  }

  function resetProgress(): void {
    currentCameraZ = CAMERA_BASE_POSITION.z;
    liveExperienceElapsedSec = 0;
    camera.far = CAMERA_FAR_DEFAULT;
    camera.updateProjectionMatrix();
    hasReachedEnd = false;
    rightFrameStarted = false;
    backFrameStarted = false;
    deepFrameStarted = false;
    fifthFrameStarted = false;
    sixthFrameStarted = false;
    seventhFrameStarted = false;
    eighthFrameStarted = false;
    ninthFrameStarted = false;
    ninthFlipFromInnerFaceLatched = false;
    corridorFlipStartedAtLiveSec = null;
    postFlipReturnGlideStartedAtLiveSec = null;
    postFlipThirdPhaseLatched = false;
    cameraFrameRight.root.visible = false;
    cameraFrameBack.root.visible = false;
    cameraFrameDeep.root.visible = false;
    cameraFrameFifth.root.visible = false;
    cameraFrameSixth.root.visible = false;
    cameraFrameSeventh.root.visible = false;
    cameraFrameEighth.root.visible = false;
    cameraFrameNinth.root.visible = false;
  }

  function dispose(): void {
    window.removeEventListener("resize", resize);
    cameraFrameLeft.dispose();
    cameraFrameBack.dispose();
    cameraFrameRight.dispose();
    cameraFrameDeep.dispose();
    cameraFrameFifth.dispose();
    cameraFrameSixth.dispose();
    cameraFrameSeventh.dispose();
    cameraFrameEighth.dispose();
    cameraFrameNinth.dispose();
    environment.dispose();
    renderer.dispose();
  }

  function resize(): void {
    const width = host.clientWidth || window.innerWidth;
    const height = host.clientHeight || window.innerHeight;

    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  }

  function hasEnvironmentLoaded(): boolean {
    if (options.environmentFactory != null) {
      return environment.root.children.length > 0;
    }
    return environmentFullyReady;
  }

  return {
    mount,
    render,
    hasReachedEnd: hasReachedEndState,
    hasEnvironmentLoaded,
    resetProgress,
    dispose,
  };
}

function buildLights(scene: Scene): void {
  const ambient = new AmbientLight("#9ab8ff", 0.9);
  const key = new DirectionalLight("#c7f0ff", 1.5);
  key.position.set(0, 5, 4);

  const rim = new DirectionalLight("#49baff", 1.2);
  rim.position.set(-5, 0, -8);

  scene.add(ambient, key, rim);
}
