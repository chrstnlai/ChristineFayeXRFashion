import {
  BufferGeometry,
  Group,
  Material,
  Mesh,
  Object3D,
  Vector3,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";

import type { SceneEnvironment } from "../environment";

type GltfEnvironmentOptions = {
  url: string;
  /** Extra Y rotation (radians) added after the π flip to align the corridor with −Z travel; negate if skew flips. */
  yawAlignRad?: number;
  /**
   * When true, estimates corridor direction from vertex spread on XZ and adds yaw so depth aligns with world ±Z
   * (matches straight −Z camera glide).
   */
  autoAlignCorridor?: boolean;
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

  const loader = new GLTFLoader();
  const dracoLoader = new DRACOLoader();
  // Use a public decoder bundle so we don't need to ship decoder files.
  dracoLoader.setDecoderPath("https://www.gstatic.com/draco/v1/decoders/");
  loader.setDRACOLoader(dracoLoader);

  loader.load(
    options.url,
    (gltf) => {
      gltf.scene.rotation.y = Math.PI + yawAlign;
      root.add(gltf.scene);
      root.updateMatrixWorld(true);

      const corridorYaw =
        autoAlign ? computeCorridorYawCorrectionXZ(root) : 0;
      gltf.scene.rotation.y = Math.PI + yawAlign + corridorYaw;
      root.updateMatrixWorld(true);
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
