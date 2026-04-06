import type { Group } from "three";

export type SceneEnvironment = {
  root: Group;
  update(elapsedSeconds: number): void;
  dispose(): void;
};

export type SceneEnvironmentFactory = () => SceneEnvironment;
