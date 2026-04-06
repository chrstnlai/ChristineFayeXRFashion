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
import { createDefaultCorridorEnvironment } from "./environments/defaultCorridorEnvironment";

type SceneController = {
  mount(): void;
  render(frameMs: number, offset: CameraOffset): void;
  hasReachedEnd(): boolean;
  resetProgress(): void;
  dispose(): void;
};

type SceneControllerOptions = {
  environmentFactory?: SceneEnvironmentFactory;
};

const CAMERA_BASE_POSITION = new Vector3(0, 0.25, 2.2);
const LOOK_DISTANCE = 12;
const JOURNEY_END_Z = -28;
const JOURNEY_SPEED = 0.55;

export function createSceneController(
  host: HTMLDivElement,
  options: SceneControllerOptions = {},
): SceneController {
  const scene = new Scene();
  scene.background = new Color("#03060d");

  const camera = new PerspectiveCamera(62, 1, 0.1, 120);
  camera.position.copy(CAMERA_BASE_POSITION);

  const renderer = new WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = SRGBColorSpace;

  const clock = new Clock();
  const environment = (options.environmentFactory ?? createDefaultCorridorEnvironment)();
  const lookDirection = new Vector3();
  const lookTarget = new Vector3();
  let currentCameraZ = CAMERA_BASE_POSITION.z;
  let hasReachedEnd = false;

  buildLights(scene);
  scene.add(environment.root);

  function mount(): void {
    renderer.domElement.className = "scene-canvas";
    host.replaceChildren(renderer.domElement);
    resize();
    window.addEventListener("resize", resize);
  }

  function render(_frameMs: number, offset: CameraOffset): void {
    const deltaSeconds = clock.getDelta();
    const elapsed = clock.elapsedTime;
    environment.update(elapsed);

    if (!hasReachedEnd) {
      currentCameraZ = Math.max(currentCameraZ - JOURNEY_SPEED * deltaSeconds, JOURNEY_END_Z);
      hasReachedEnd = currentCameraZ <= JOURNEY_END_Z;
    }

    const yaw = -offset.x * 0.28;
    const pitch = MathUtils.clamp(-offset.y * 0.16, -0.36, 0.36);

    lookDirection.set(
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      -Math.cos(yaw) * Math.cos(pitch),
    );

    camera.position.set(CAMERA_BASE_POSITION.x, CAMERA_BASE_POSITION.y, currentCameraZ);
    lookTarget.copy(camera.position).addScaledVector(lookDirection, LOOK_DISTANCE);
    camera.lookAt(lookTarget);

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
