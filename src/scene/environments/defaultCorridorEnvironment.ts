import {
  BufferAttribute,
  BufferGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Material,
} from "three";

import type { SceneEnvironment } from "../environment";

export function createDefaultCorridorEnvironment(): SceneEnvironment {
  const root = new Group();
  const driftingObjects = new Group();

  root.add(createTunnelRibs());
  root.add(createTunnelRails());
  root.add(driftingObjects);

  buildWorldObjects();

  return {
    root,
    update(elapsedSeconds) {
      // driftingObjects.children.forEach((child, index) => {

      //   child.position.x = base.x + Math.sin(elapsedSeconds * 0.55 + index * 0.6) * 0.18;
      //   child.position.y = base.y + Math.cos(elapsedSeconds * 0.45 + index * 0.45) * 0.14;
      //   child.rotation.x += 0.0018;
      //   child.rotation.y += 0.0028;
      // });

      root.rotation.z = Math.sin(elapsedSeconds * 0.18) * 0.015;
    },
    dispose() {
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

function buildWorldObjects(): void {
  // intentionally empty for now
}

function createTunnelRibs(): LineSegments {
  const geometry = new BufferGeometry();
  const vertices: number[] = [];
  const segments = 26;

  for (let index = 0; index < segments; index += 1) {
    const z = 1.5 - index * 1.8;
    const radiusX = 6.4 - index * 0.06;
    const radiusY = 3.8 - index * 0.03;
    const corners = [
      [-radiusX, -radiusY, z],
      [radiusX, -radiusY, z],
      [radiusX, radiusY, z],
      [-radiusX, radiusY, z],
    ];

    for (let corner = 0; corner < corners.length; corner += 1) {
      const current = corners[corner];
      const next = corners[(corner + 1) % corners.length];
      vertices.push(...current, ...next);
    }
  }

  geometry.setAttribute("position", new BufferAttribute(new Float32Array(vertices), 3));

  return new LineSegments(
    geometry,
    new LineBasicMaterial({
      color: "#ffffff",
      transparent: true,
      opacity: 0.55,
    }),
  );
}

function createTunnelRails(): LineSegments {
  const geometry = new BufferGeometry();
  const vertices: number[] = [];
  const depths = 26;
  const railOffsets = [-4.4, -1.9, 1.9, 4.4];

  for (const x of railOffsets) {
    for (let index = 0; index < depths - 1; index += 1) {
      const z = 1.5 - index * 1.8;
      const nextZ = 1.5 - (index + 1) * 1.8;
      vertices.push(x, -3.2, z, x, -3.2, nextZ);
      vertices.push(x * 0.82, 3.2, z, x * 0.82, 3.2, nextZ);
    }
  }

  geometry.setAttribute("position", new BufferAttribute(new Float32Array(vertices), 3));

  return new LineSegments(
    geometry,
    new LineBasicMaterial({
      color: "#0f3157",
      transparent: true,
      opacity: 0.38,
    }),
  );
}