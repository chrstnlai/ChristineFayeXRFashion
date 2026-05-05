import { NodeIO } from "@gltf-transform/core";
import fs from "node:fs";
import path from "node:path";

const input = process.argv[2] || "public/models/EXPORT.fast.glb";
const outDir = process.argv[3] || "tmp/export_images";

fs.mkdirSync(outDir, { recursive: true });

const io = new NodeIO();
const doc = await io.read(input);
const root = doc.getRoot();

const textures = root.listTextures();

console.log(`Input: ${input}`);
console.log(`Textures: ${textures.length}`);

let wrote = 0;
for (let i = 0; i < textures.length; i++) {
  const texture = textures[i];
  const name = texture.getName() || `texture_${i}`;
  const mimeType = texture.getMimeType() || "application/octet-stream";
  const bytes = texture.getImage();
  const byteLength = bytes ? bytes.byteLength : 0;

  const ext =
    mimeType === "image/png"
      ? "png"
      : mimeType === "image/jpeg"
        ? "jpg"
        : mimeType === "image/webp"
          ? "webp"
          : "bin";
  const safeBase = name.replaceAll(/[^\w.-]+/g, "_").slice(0, 80);
  const filename = `${String(i).padStart(3, "0")}_${safeBase}.${ext}`;
  const filepath = path.join(outDir, filename);

  if (bytes && byteLength > 0) {
    fs.writeFileSync(filepath, Buffer.from(bytes));
    wrote++;
  }

  console.log(
    `${String(i).padStart(3, "0")} | ${mimeType.padEnd(16)} | ${String(byteLength).padStart(10)} bytes | ${name}`,
  );
}

console.log(`Wrote ${wrote}/${textures.length} texture image files to ${outDir}`);

