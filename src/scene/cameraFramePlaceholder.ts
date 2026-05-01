import {
  BoxGeometry,
  CanvasTexture,
  ClampToEdgeWrapping,
  Color,
  DoubleSide,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Vector3,
  VideoTexture,
} from "three";

export type CameraFramePlaceholderOptions = {
  center?: Vector3;
  width?: number;
  height?: number;
  rotationY?: number;
  video?: HTMLVideoElement;
  borderWidth?: number;
  /** Beyond this distance (world units) the feed stays fully hidden */
  revealMaxDistance?: number;
  /** Inside this distance the feed is fully opaque */
  revealMinDistance?: number;
  /** Border blink rate (full on/off cycles per second) while waiting for reveal */
  borderFlashHz?: number;
  /**
   * Inner video stays fully hidden until distance-based `fill` exceeds this (0–1).
   * Only the flashing border shows below this threshold.
   */
  innerShowAfterFill?: number;
  /** Seconds after the webcam first has frames before distance-based inner reveal can begin */
  innerDelaySeconds?: number;
};

export type CameraFrameUpdateContext = {
  video?: HTMLVideoElement;
  /** Required for distance-based reveal */
  cameraWorldPosition?: Vector3;
};

export type CameraFramePlaceholder = {
  root: Group;
  screenMesh: Mesh;
  update(elapsedSeconds: number, feed?: CameraFrameUpdateContext): void;
  dispose(): void;
};

const BORDER_DEPTH = 0.004;
const BORDER_Z = -0.001;
const SCREEN_Z = 0.002;
const BORDER_SOLID_FILL = 0.98;
const DEFAULT_REVEAL_MAX_DIST = 5.4;
const DEFAULT_REVEAL_MIN_DIST = 2.05;
const DEFAULT_FLASH_HZ = 2.8;
const DEFAULT_INNER_SHOW_AFTER_FILL = 0.14;
const DEFAULT_INNER_DELAY_SECONDS = 5;

const LABEL_CANVAS_W = 512;
const LABEL_CANVAS_H = 128;
const LABEL_WORLD_W = 0.36;
const LABEL_WORLD_H = (LABEL_WORLD_W * LABEL_CANVAS_H) / LABEL_CANVAS_W;
const LABEL_RIGHT_MARGIN = 0.012;
const LABEL_ABOVE_GAP = 0.022;

function createDetectedLabelTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = LABEL_CANVAS_W;
  canvas.height = LABEL_CANVAS_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return new CanvasTexture(canvas);
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = "600 52px system-ui, Segoe UI, sans-serif";
  ctx.fillStyle = "#c41e1e";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText("detected", canvas.width - 20, canvas.height / 2);

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function createCameraFramePlaceholder(
  options: CameraFramePlaceholderOptions = {},
): CameraFramePlaceholder {
  const w = options.width ?? 0.68;
  const h = options.height ?? 0.42;
  const b = options.borderWidth ?? 0.008;
  const revealMax = options.revealMaxDistance ?? DEFAULT_REVEAL_MAX_DIST;
  const revealMin = options.revealMinDistance ?? DEFAULT_REVEAL_MIN_DIST;
  const flashHz = options.borderFlashHz ?? DEFAULT_FLASH_HZ;
  const innerShowAfterFill = options.innerShowAfterFill ?? DEFAULT_INNER_SHOW_AFTER_FILL;
  const innerDelaySeconds = options.innerDelaySeconds ?? DEFAULT_INNER_DELAY_SECONDS;

  const center = options.center?.clone() ?? new Vector3(0, 1.28, 18);
  const worldCenter = center.clone();
  const rotationY = options.rotationY ?? 0;

  const outerW = w + b * 2;

  let videoTexture: VideoTexture | null = null;

  let screenMat: MeshBasicMaterial | MeshStandardMaterial;
  if (options.video) {
    videoTexture = new VideoTexture(options.video);
    videoTexture.colorSpace = SRGBColorSpace;
    videoTexture.wrapS = videoTexture.wrapT = ClampToEdgeWrapping;
    videoTexture.repeat.set(-1, 1);
    videoTexture.offset.set(1, 0);
    screenMat = new MeshBasicMaterial({
      map: videoTexture,
      toneMapped: false,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
  } else {
    screenMat = new MeshStandardMaterial({
      color: new Color("#141a24"),
      metalness: 0.05,
      roughness: 0.92,
      side: DoubleSide,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
  }

  const borderMat = new MeshBasicMaterial({
    color: new Color("#c41e1e"),
    toneMapped: false,
    transparent: true,
    opacity: 1,
    depthWrite: false,
  });

  const root = new Group();
  root.name = "cameraFramePlaceholder";

  const top = new Mesh(new BoxGeometry(outerW, b, BORDER_DEPTH), borderMat);
  top.position.set(0, h / 2 + b / 2, BORDER_Z);
  const bottom = new Mesh(new BoxGeometry(outerW, b, BORDER_DEPTH), borderMat);
  bottom.position.set(0, -h / 2 - b / 2, BORDER_Z);
  const left = new Mesh(new BoxGeometry(b, h, BORDER_DEPTH), borderMat);
  left.position.set(-w / 2 - b / 2, 0, BORDER_Z);
  const right = new Mesh(new BoxGeometry(b, h, BORDER_DEPTH), borderMat);
  right.position.set(w / 2 + b / 2, 0, BORDER_Z);

  root.add(top, bottom, left, right);

  const screenGeom = new PlaneGeometry(w, h);
  const screenMesh = new Mesh(screenGeom, screenMat);
  screenMesh.name = "CameraFrameScreen";
  screenMesh.userData.role = "cameraFrameScreen";
  screenMesh.position.z = SCREEN_Z;
  root.add(screenMesh);

  const labelTex = createDetectedLabelTexture();
  const labelMat = new MeshBasicMaterial({
    map: labelTex,
    transparent: true,
    toneMapped: false,
    depthWrite: false,
    opacity: 1,
  });
  const labelGeom = new PlaneGeometry(LABEL_WORLD_W, LABEL_WORLD_H);
  const labelMesh = new Mesh(labelGeom, labelMat);
  labelMesh.name = "CameraFrameDetectedLabel";
  labelMesh.position.set(
    outerW / 2 - LABEL_WORLD_W / 2 - LABEL_RIGHT_MARGIN,
    h / 2 + b + LABEL_ABOVE_GAP + LABEL_WORLD_H / 2,
    BORDER_Z + 0.001,
  );
  labelMesh.renderOrder = 1;
  root.add(labelMesh);

  root.position.copy(center);
  root.rotation.y = rotationY;

  /** Wall-clock ms when video first had pixels; inner stays off until `innerDelaySeconds` after this */
  let videoLiveSinceMs: number | null = null;

  function update(elapsed: number, feed?: CameraFrameUpdateContext): void {
    const v = feed?.video ?? options.video;
    if (v && v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && videoLiveSinceMs === null) {
      videoLiveSinceMs = performance.now();
    }

    const delayMs = innerDelaySeconds * 1000;
    const timeUnlocked =
      videoLiveSinceMs !== null && performance.now() - videoLiveSinceMs >= delayMs;

    const cam = feed?.cameraWorldPosition;
    let fillDist = 1;
    if (cam) {
      const d = cam.distanceTo(worldCenter);
      const span = Math.max(revealMax - revealMin, 0.001);
      const tLin = MathUtils.clamp(1 - (d - revealMin) / span, 0, 1);
      fillDist = tLin * tLin * (3 - 2 * tLin);
    }

    const innerFill = timeUnlocked ? fillDist : 0;

    screenMat.transparent = true;
    screenMat.depthWrite = false;

    if (innerFill <= innerShowAfterFill) {
      screenMesh.visible = false;
      screenMat.opacity = 0;
    } else {
      screenMesh.visible = true;
      const innerLin = MathUtils.clamp(
        (innerFill - innerShowAfterFill) / Math.max(1 - innerShowAfterFill, 0.001),
        0,
        1,
      );
      screenMat.opacity = innerLin * innerLin * (3 - 2 * innerLin);
    }

    let flashOpacity = 1;
    if (!timeUnlocked || innerFill < BORDER_SOLID_FILL) {
      flashOpacity = Math.sin(elapsed * Math.PI * 2 * flashHz) > 0 ? 1 : 0;
    }
    borderMat.opacity = flashOpacity;
    labelMat.opacity = flashOpacity;

    if (videoTexture && v && v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      videoTexture.needsUpdate = true;
    }
  }

  function dispose(): void {
    top.geometry.dispose();
    bottom.geometry.dispose();
    left.geometry.dispose();
    right.geometry.dispose();
    screenGeom.dispose();
    labelGeom.dispose();
    labelMat.dispose();
    labelTex.dispose();
    borderMat.dispose();
    screenMat.dispose();
    videoTexture?.dispose();
  }

  return { root, screenMesh, update, dispose };
}
