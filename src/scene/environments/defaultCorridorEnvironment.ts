import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Material,
  Mesh,
  MeshPhysicalMaterial,
  Points,
  PointsMaterial,
  Vector3,
} from "three";

import type { SceneEnvironment } from "../environment";

export function createDefaultCorridorEnvironment(): SceneEnvironment {
  const root = new Group();
  const driftingObjects = new Group();
  const driftingBases: Vector3[] = [];

  root.add(createTunnelRibs());
  root.add(createTunnelRails());
  root.add(createStarField());
  root.add(driftingObjects);

  buildWorldObjects(driftingObjects, driftingBases);

  return {
    root,
    update(elapsedSeconds) {
      driftingObjects.children.forEach((child, index) => {
        const base = driftingBases[index];
        child.position.x = base.x + Math.sin(elapsedSeconds * 0.55 + index * 0.6) * 0.18;
        child.position.y = base.y + Math.cos(elapsedSeconds * 0.45 + index * 0.45) * 0.14;
        child.rotation.x += 0.0018;
        child.rotation.y += 0.0028;
      });

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
          const materials = (Array.isArray(materialValue) ? materialValue : [materialValue]) as Material[];
          materials.forEach((material) => {
            material.dispose();
          });
        }
      });
    },
  };
}

function buildWorldObjects(group: Group, bases: Vector3[]): void {
  const shardGeometry = new BoxGeometry(0.6, 3.8, 0.42);
  const wideShardGeometry = new BoxGeometry(0.8, 2.3, 0.8);

  const cyanMaterial = new MeshPhysicalMaterial({
    color: "#88ecff",
    emissive: "#0b2b52",
    emissiveIntensity: 0.8,
    metalness: 0.2,
    roughness: 0.18,
    transmission: 0.1,
  });

  const amberMaterial = new MeshPhysicalMaterial({
    color: "#ffbe71",
    emissive: "#4a1f00",
    emissiveIntensity: 0.7,
    metalness: 0.12,
    roughness: 0.24,
  });

  const placements = [
    { geometry: shardGeometry, material: cyanMaterial, position: new Vector3(-3.2, 1.8, -4) },
    { geometry: shardGeometry, material: amberMaterial, position: new Vector3(3.4, -1.5, -6.5) },
    { geometry: wideShardGeometry, material: cyanMaterial, position: new Vector3(-4.2, -0.6, -10) },
    { geometry: shardGeometry, material: amberMaterial, position: new Vector3(4, 1.7, -13) },
    { geometry: shardGeometry, material: cyanMaterial, position: new Vector3(-3.6, 1.2, -17) },
    { geometry: wideShardGeometry, material: amberMaterial, position: new Vector3(3.2, -1.8, -21) },
    { geometry: shardGeometry, material: cyanMaterial, position: new Vector3(-4.4, -1.1, -25) },
    { geometry: shardGeometry, material: amberMaterial, position: new Vector3(4.5, 1.5, -29) },
  ];

  for (const placement of placements) {
    const mesh = new Mesh(placement.geometry, placement.material);
    mesh.position.copy(placement.position);
    mesh.rotation.z = (Math.random() - 0.5) * 0.6;
    mesh.rotation.x = (Math.random() - 0.5) * 0.2;
    group.add(mesh);
    bases.push(placement.position.clone());
  }
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
      color: "#1e5b98",
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

function createStarField(): Points {
  const starCount = 850;
  const positions = new Float32Array(starCount * 3);

  for (let index = 0; index < starCount; index += 1) {
    const i = index * 3;
    positions[i] = (Math.random() - 0.5) * 40;
    positions[i + 1] = (Math.random() - 0.5) * 24;
    positions[i + 2] = 4 - Math.random() * 85;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));

  return new Points(
    geometry,
    new PointsMaterial({
      color: "#b7e6ff",
      size: 0.045,
      transparent: true,
      opacity: 0.95,
    }),
  );
}
