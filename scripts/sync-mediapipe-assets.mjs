import { cp, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const sourceDir = path.join(
  rootDir,
  "node_modules",
  "@mediapipe",
  "tasks-vision",
  "wasm",
);
const targetDir = path.join(rootDir, "public", "vendor", "mediapipe");
const modelDir = path.join(rootDir, "public", "models");
const modelPath = path.join(modelDir, "face_landmarker.task");
const modelUrl =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

await mkdir(targetDir, { recursive: true });
await mkdir(modelDir, { recursive: true });
await cp(sourceDir, targetDir, { recursive: true });
await ensureFaceModel(modelPath, modelUrl);

console.log(`Synced MediaPipe WASM assets to ${targetDir}`);

async function ensureFaceModel(destinationPath, sourceUrl) {
  try {
    await stat(destinationPath);
    console.log(`Face landmarker model already present at ${destinationPath}`);
    return;
  } catch {
    // Download below when the file is missing.
  }

  const response = await fetch(sourceUrl);

  if (!response.ok) {
    throw new Error(`Failed to download face model: ${response.status} ${response.statusText}`);
  }

  const data = new Uint8Array(await response.arrayBuffer());
  await writeFile(destinationPath, data);
  console.log(`Downloaded face landmarker model to ${destinationPath}`);
}
