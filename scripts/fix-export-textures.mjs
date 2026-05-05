import { NodeIO } from "@gltf-transform/core";
import fs from "node:fs";

const input = process.argv[2];
const output = process.argv[3] || "public/models/EXPORT.fixed.glb";
if (!input) {
  console.error("Usage: node scripts/fix-export-textures.mjs <source.glb> [output.glb]");
  console.error("Use your original high-res EXPORT.glb (indices match that file).");
  process.exit(1);
}

// These texture indices were found to contain non-PNG payloads (BMP/TIFF) that
// break texture compression tooling. We replace them with normalized PNGs.
const replacements = [
  { textureIndex: 12, file: "tmp/fixed_images/012_bodyImg.png" },
  { textureIndex: 116, file: "tmp/fixed_images/116_Leather_002_COLOR.png" },
  { textureIndex: 120, file: "tmp/fixed_images/120_texture_56205153.png" },
  { textureIndex: 124, file: "tmp/fixed_images/124_BUTTON_TEXTURE.png" },
];

const io = new NodeIO();
const doc = await io.read(input);
const root = doc.getRoot();
const textures = root.listTextures();

for (const { textureIndex, file } of replacements) {
  const texture = textures[textureIndex];
  if (!texture) {
    throw new Error(`Texture index ${textureIndex} not found.`);
  }

  const pngBytes = fs.readFileSync(file);
  texture.setMimeType("image/png");
  texture.setImage(pngBytes);
  console.log(`Replaced texture[${textureIndex}] "${texture.getName()}" with ${file}`);
}

await io.write(output, doc);
console.log(`Wrote: ${output}`);

