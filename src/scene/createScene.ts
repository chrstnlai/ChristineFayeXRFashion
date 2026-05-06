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

const CAMERA_BASE_POSITION = new Vector3(0.68, 1.52, 25);
const LOOK_DISTANCE = 12;
const JOURNEY_END_Z = -28;
const JOURNEY_SPEED = 0.55;
const BASE_PITCH = -0.08;
const BASE_YAW = 0.16;
const CAMERA_FRAME_OFFSET_Z = 4.75;
/** World-space gap between the two frame centers (second frame to the +X “right” of the first). */
const CAMERA_FRAME_PAIR_SPACING_X = 1.65;
/** Extra −Z on the right duplicate (deeper along the glide / “further back”). */
const CAMERA_FRAME_RIGHT_DELTA_Z = -1.35;
/** Right frame: blink-only period before inner webcam can reveal (left uses placeholder default). */
const CAMERA_FRAME_RIGHT_INNER_DELAY_SECONDS = 3;
/** Extra −Z on the frame behind the first (negative = deeper along the glide). */
const CAMERA_FRAME_BACK_DELTA_Z = -2.45;
/** Back frame: lateral offset from first frame’s X (negative = more to the left). */
const CAMERA_FRAME_BACK_DELTA_X = -0.14;
/** Back frame: blink-only period before inner webcam can reveal. */
const CAMERA_FRAME_BACK_INNER_DELAY_SECONDS = 2.5;
/** Fourth frame: offset from third frame center (+X = right, −Z = farther behind). */
const CAMERA_FRAME_DEEP_OFFSET_X = 1.3;
const CAMERA_FRAME_DEEP_OFFSET_Z = -2.7;
/** After this many seconds in the live experience, flip the view 180°, then optional shallow sink on Y. */
const EXPERIENCE_VIEW_FLIP_AFTER_SEC = 60;
/** Stay at the normal eye height this long after the flip (180° only, no drop yet). */
const POST_FLIGHT_DESCENT_HOLD_SEC = 1.5;
/** World −Y per second once the hold ends. */
const POST_FLIGHT_DESCENT_SPEED = 2.5;
/** Max drop below the normal eye line after the hold (keep shallow). */
const POST_FLIGHT_DESCENT_MAX_Y = 4;
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
  let liveExperienceElapsedSec = 0;

  buildLights(scene);
  scene.add(environment.root);

  const frameCenterY = CAMERA_BASE_POSITION.y + 0.1;
  const frameCenterZ = CAMERA_BASE_POSITION.z - CAMERA_FRAME_OFFSET_Z;
  const frameCenterXLeft = CAMERA_BASE_POSITION.x - 0.28;
  const backFrameCenterX = frameCenterXLeft + CAMERA_FRAME_BACK_DELTA_X;
  const backFrameCenterZ = frameCenterZ + CAMERA_FRAME_BACK_DELTA_Z;

  const cameraFrameLeft = createCameraFramePlaceholder({
    center: new Vector3(frameCenterXLeft, frameCenterY, frameCenterZ),
    rotationY: BASE_YAW,
    width: 0.25,
    height: 0.3,
    video: options.faceVideo,
  });
  const cameraFrameBack = createCameraFramePlaceholder({
    center: new Vector3(backFrameCenterX, frameCenterY, backFrameCenterZ),
    rotationY: BASE_YAW,
    width: 0.25,
    height: 0.3,
    video: options.faceVideo,
    innerDelaySeconds: CAMERA_FRAME_BACK_INNER_DELAY_SECONDS,
  });
  const cameraFrameRight = createCameraFramePlaceholder({
    center: new Vector3(
      frameCenterXLeft + CAMERA_FRAME_PAIR_SPACING_X,
      frameCenterY,
      frameCenterZ + CAMERA_FRAME_RIGHT_DELTA_Z,
    ),
    rotationY: BASE_YAW,
    width: 0.25,
    height: 0.3,
    video: options.faceVideo,
    innerDelaySeconds: CAMERA_FRAME_RIGHT_INNER_DELAY_SECONDS,
  });
  const cameraFrameDeep = createCameraFramePlaceholder({
    center: new Vector3(
      backFrameCenterX + CAMERA_FRAME_DEEP_OFFSET_X,
      frameCenterY,
      backFrameCenterZ + CAMERA_FRAME_DEEP_OFFSET_Z,
    ),
    rotationY: BASE_YAW,
    width: 0.25,
    height: 0.3,
    video: options.faceVideo,
    innerDelaySeconds: CAMERA_FRAME_BACK_INNER_DELAY_SECONDS,
  });
  cameraFrameRight.root.visible = false;
  cameraFrameBack.root.visible = false;
  cameraFrameDeep.root.visible = false;
  scene.add(cameraFrameLeft.root, cameraFrameBack.root, cameraFrameRight.root, cameraFrameDeep.root);

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

    if (!hasReachedEnd) {
      currentCameraZ = Math.max(currentCameraZ - JOURNEY_SPEED * deltaSeconds, JOURNEY_END_Z);
      hasReachedEnd = currentCameraZ <= JOURNEY_END_Z;
    }

    const yaw = BASE_YAW + -offset.x * 0.28;
    const pitchBase = MathUtils.clamp(BASE_PITCH - offset.y * 0.16, -0.36, 0.36);
    const viewFlippedVertically = liveExperienceElapsedSec >= EXPERIENCE_VIEW_FLIP_AFTER_SEC;
    const pitch = pitchBase + (viewFlippedVertically ? Math.PI : 0);

    lookDirection.set(
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      -Math.cos(yaw) * Math.cos(pitch),
    );

    const postFlipElapsed = Math.max(0, liveExperienceElapsedSec - EXPERIENCE_VIEW_FLIP_AFTER_SEC);
    const descentElapsed = Math.max(0, postFlipElapsed - POST_FLIGHT_DESCENT_HOLD_SEC);
    const dropY = Math.min(descentElapsed * POST_FLIGHT_DESCENT_SPEED, POST_FLIGHT_DESCENT_MAX_Y);
    const cameraY = CAMERA_BASE_POSITION.y - dropY;
    camera.position.set(CAMERA_BASE_POSITION.x, cameraY, currentCameraZ);

    const desiredFar = viewFlippedVertically ? CAMERA_FAR_FLIPPED : CAMERA_FAR_DEFAULT;
    if (camera.far !== desiredFar) {
      camera.far = desiredFar;
      camera.updateProjectionMatrix();
    }

    camera.up.set(0, viewFlippedVertically ? -1 : 1, 0);
    lookTarget.copy(camera.position).addScaledVector(lookDirection, LOOK_DISTANCE);
    camera.lookAt(lookTarget);

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
    cameraFrameRight.root.visible = false;
    cameraFrameBack.root.visible = false;
    cameraFrameDeep.root.visible = false;
  }

  function dispose(): void {
    window.removeEventListener("resize", resize);
    cameraFrameLeft.dispose();
    cameraFrameBack.dispose();
    cameraFrameRight.dispose();
    cameraFrameDeep.dispose();
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
