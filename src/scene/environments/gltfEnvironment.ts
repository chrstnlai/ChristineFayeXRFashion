import {
  BufferGeometry,
  Group,
  Material,
  Mesh,
  Object3D,
  Texture,
  Vector3,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";

import type { SceneEnvironment } from "../environment";

type GltfEnvironmentOptions = {
  url: string;
  /**
   * Called once after the GLB scene graph is attached, oriented, mesh textures have finished
   * decoding/uploading where applicable, and at least two frames have passed (GPU paint catch-up).
   */
  onLoadComplete?: () => void;
  /** Extra Y rotation (radians) added after the π flip to align the corridor with −Z travel; negate if skew flips. */
  yawAlignRad?: number;
  /**
   * When true, estimates corridor direction from vertex spread on XZ and adds yaw so depth aligns with world ±Z
   * (matches straight −Z camera glide).
   */
  autoAlignCorridor?: boolean;
  /** When true, base Y rotation is 0 instead of π (opposite facing for −Z glide). */
  flipCorridor180?: boolean;
  /** Roll the whole environment around world Z (e.g. π flips world Y while keeping Z glide direction). */
  worldRollZRad?: number;
};

const DEFAULT_YAW_ALIGN_RAD = -0.07;
/** Require some elongation in footprint so PCA is trustworthy (avoids spinning square scenes). */
const CORRIDOR_AXIS_RATIO_MIN = 1.14;
const VERTEX_SAMPLE_TARGET = 2800;

export function createGltfEnvironment(options: GltfEnvironmentOptions): SceneEnvironment {
  const root = new Group();
  root.name = "gltfEnvironmentRoot";
  const yawAlign = options.yawAlignRad ?? DEFAULT_YAW_ALIGN_RAD;
  const autoAlign = options.autoAlignCorridor ?? true;
  const baseYaw = options.flipCorridor180 ? 0 : Math.PI;
  const rollZ = options.worldRollZRad ?? 0;

  const loader = new GLTFLoader();
  const dracoLoader = new DRACOLoader();
  // Use a public decoder bundle so we don't need to ship decoder files.
  dracoLoader.setDecoderPath("https://www.gstatic.com/draco/v1/decoders/");
  loader.setDRACOLoader(dracoLoader);

  loader.load(
    options.url,
    (gltf) => {
      const rollWrap = new Group();
      rollWrap.name = "gltfEnvironmentRollZ";
      rollWrap.rotation.z = rollZ;

      gltf.scene.rotation.y = baseYaw + yawAlign;
      rollWrap.add(gltf.scene);
      root.add(rollWrap);
      root.updateMatrixWorld(true);

      const corridorYaw =
        autoAlign ? computeCorridorYawCorrectionXZ(root) : 0;
      gltf.scene.rotation.y = baseYaw + yawAlign + corridorYaw;
      root.updateMatrixWorld(true);

      void whenGltfSubtreeFullyRenderable(gltf.scene).then(() => {
        options.onLoadComplete?.();
      });
    },
    undefined,
    (error) => {
      console.error(`Failed to load environment GLB: ${options.url}`, error);
    },
  );

  return {
    root,
    update() {
      // No default animation; keep environment static unless GLB includes its own updates.
    },
    dispose() {
      dracoLoader.dispose();
      root.traverse((object) => {
        const geometry = Reflect.get(object, "geometry") as { dispose?: () => void } | undefined;
        if (geometry && typeof geometry.dispose === "function") {
          geometry.dispose();
        }

        const materialValue = Reflect.get(object, "material") as Material | Material[] | undefined;
        if (materialValue) {
          const materials = Array.isArray(materialValue) ? materialValue : [materialValue];
          materials.forEach((material) => {
            material.dispose();
          });
        }
      });
    },
  };
}

/**
 * Dominant horizontal axis from vertex covariance on XZ; yaw to align that axis with +Z so −Z glide stays in-corridor.
 */
function computeCorridorYawCorrectionXZ(root: Object3D): number {
  const xz: number[] = [];
  const scratch = new Vector3();

  root.updateMatrixWorld(true);
  root.traverse((object) => {
    const mesh = object as Mesh;
    const geom = mesh.geometry as BufferGeometry | undefined;
    const pos = geom?.attributes?.position;
    if (!pos || typeof mesh.matrixWorld === "undefined") {
      return;
    }

    const stride = Math.max(1, Math.ceil(pos.count / VERTEX_SAMPLE_TARGET));
    for (let i = 0; i < pos.count; i += stride) {
      scratch.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      xz.push(scratch.x, scratch.z);
    }
  });

  const n = xz.length / 2;
  if (n < 80) {
    return 0;
  }

  let mx = 0;
  let mz = 0;
  for (let i = 0; i < xz.length; i += 2) {
    mx += xz[i];
    mz += xz[i + 1];
  }
  mx /= n;
  mz /= n;

  let cxx = 0;
  let cxz = 0;
  let czz = 0;
  for (let i = 0; i < xz.length; i += 2) {
    const dx = xz[i] - mx;
    const dz = xz[i + 1] - mz;
    cxx += dx * dx;
    cxz += dx * dz;
    czz += dz * dz;
  }
  cxx /= n;
  cxz /= n;
  czz /= n;

  const trace = cxx + czz;
  const det = cxx * czz - cxz * cxz;
  const disc = Math.max(0, trace * trace * 0.25 - det);
  const lam1 = trace * 0.5 + Math.sqrt(disc);
  const lam2 = trace * 0.5 - Math.sqrt(disc);

  if (lam2 <= 1e-12 || lam1 / lam2 < CORRIDOR_AXIS_RATIO_MIN) {
    return 0;
  }

  let ex = cxz;
  let ez = lam1 - cxx;
  let len = Math.hypot(ex, ez);
  if (len < 1e-10) {
    ex = lam1 - czz;
    ez = cxz;
    len = Math.hypot(ex, ez);
  }
  if (len < 1e-10) {
    return 0;
  }
  ex /= len;
  ez /= len;

  if (ez < 0) {
    ex = -ex;
    ez = -ez;
  }

  return -Math.atan2(ex, ez);
}

function collectUniqueTextures(root: Object3D): Texture[] {
  const seen = new Set<Texture>();
  const out: Texture[] = [];

  root.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh || mesh.material == null) {
      return;
    }

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!material || typeof material !== "object") {
        continue;
      }
      for (const key of Object.keys(material)) {
        const value = (material as unknown as Record<string, unknown>)[key];
        if (
          value &&
          typeof value === "object" &&
          "isTexture" in value &&
          (value as Texture).isTexture === true
        ) {
          const tex = value as Texture;
          if (!seen.has(tex)) {
            seen.add(tex);
            out.push(tex);
          }
        }
      }
    }
  });

  return out;
}

async function waitForTextureReady(tex: Texture): Promise<void> {
  const image = tex.image as unknown;

  if (image == null) {
    return;
  }

  if (typeof HTMLVideoElement !== "undefined" && image instanceof HTMLVideoElement) {
    if (image.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      return;
    }
    await new Promise<void>((resolve) => {
      const done = (): void => resolve();
      image.addEventListener("loadeddata", done, { once: true });
      image.addEventListener("error", done, { once: true });
    });
    return;
  }

  if (typeof HTMLImageElement !== "undefined" && image instanceof HTMLImageElement) {
    if (image.complete && image.naturalWidth > 0) {
      return;
    }
    await new Promise<void>((resolve) => {
      const done = (): void => resolve();
      image.addEventListener("load", done, { once: true });
      image.addEventListener("error", done, { once: true });
    });
    return;
  }

  if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) {
    return;
  }

  // DataTexture, CompressedTexture, canvases: rely on GLTFLoader callback timing.
}

async function waitAnimationFrames(count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }
}

/** Ensures environment textures are ready and the GPU has had frames to present them. */
async function whenGltfSubtreeFullyRenderable(scene: Object3D): Promise<void> {
  const textures = collectUniqueTextures(scene);
  await Promise.all(textures.map((tex) => waitForTextureReady(tex)));
  await waitAnimationFrames(2);
}
