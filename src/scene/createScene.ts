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
  resetProgress(): void;
  dispose(): void;
};

type SceneControllerOptions = {
  environmentFactory?: SceneEnvironmentFactory;
  /** Webcam element for the opening live-feed quad */
  faceVideo?: HTMLVideoElement;
};

const CAMERA_BASE_POSITION = new Vector3(1, 1.28, 25);
const LOOK_DISTANCE = 12;
const JOURNEY_END_Z = -28;
const JOURNEY_SPEED = 0.55;
const BASE_PITCH = -0.08;
const BASE_YAW = 0.16;
const CAMERA_FRAME_OFFSET_Z = 4.75;

export function createSceneController(
  host: HTMLDivElement,
  options: SceneControllerOptions = {},
): SceneController {
  const scene = new Scene();
  scene.background = new Color("#03060d");

  const camera = new PerspectiveCamera(72, 1, 0.1, 140);
  camera.position.copy(CAMERA_BASE_POSITION);

  const renderer = new WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = SRGBColorSpace;

  const clock = new Clock();
  const environment = (
    options.environmentFactory ??
    (() => createGltfEnvironment({ url: "/models/EXPORT.glb" }))
  )();
  const lookDirection = new Vector3();
  const lookTarget = new Vector3();
  let currentCameraZ = CAMERA_BASE_POSITION.z;
  let hasReachedEnd = false;

  buildLights(scene);
  scene.add(environment.root);

  const cameraFrame = createCameraFramePlaceholder({
    center: new Vector3(
      CAMERA_BASE_POSITION.x - 0.28,
      CAMERA_BASE_POSITION.y + 0.1,
      CAMERA_BASE_POSITION.z - CAMERA_FRAME_OFFSET_Z,
    ),
    rotationY: BASE_YAW,
    width: 0.25,
    height: 0.3,
    video: options.faceVideo,
  });
  scene.add(cameraFrame.root);

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

    if (!hasReachedEnd) {
      currentCameraZ = Math.max(currentCameraZ - JOURNEY_SPEED * deltaSeconds, JOURNEY_END_Z);
      hasReachedEnd = currentCameraZ <= JOURNEY_END_Z;
    }

    const yaw = BASE_YAW + -offset.x * 0.28;
    const pitch = MathUtils.clamp(BASE_PITCH - offset.y * 0.16, -0.36, 0.36);

    lookDirection.set(
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      -Math.cos(yaw) * Math.cos(pitch),
    );

    camera.position.set(CAMERA_BASE_POSITION.x, CAMERA_BASE_POSITION.y, currentCameraZ);
    lookTarget.copy(camera.position).addScaledVector(lookDirection, LOOK_DISTANCE);
    camera.lookAt(lookTarget);

    cameraFrame.update(elapsed, {
      video: videoFeed?.video,
      cameraWorldPosition: camera.position,
    });

    renderer.render(scene, camera);
  }

  function hasReachedEndState(): boolean {
    return hasReachedEnd;
  }

  function resetProgress(): void {
    currentCameraZ = CAMERA_BASE_POSITION.z;
    hasReachedEnd = false;
  }

  function dispose(): void {
    window.removeEventListener("resize", resize);
    cameraFrame.dispose();
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

  return { mount, render, hasReachedEnd: hasReachedEndState, resetProgress, dispose };
}

function buildLights(scene: Scene): void {
  const ambient = new AmbientLight("#9ab8ff", 0.9);
  const key = new DirectionalLight("#c7f0ff", 1.5);
  key.position.set(0, 5, 4);

  const rim = new DirectionalLight("#49baff", 1.2);
  rim.position.set(-5, 0, -8);

  scene.add(ambient, key, rim);
}
