/**
 * Writes each detail-atlas channel and each macro channel out as a greyscale PNG, tiled 2x2, so the
 * generated texture can be judged without a browser. Tiling 2x2 is what makes a seam or a repeated
 * cell shape obvious; a single tile hides both.
 */
import sharp from "sharp";
import {
  DETAIL_ATLAS_SIZE,
  MACRO_TEXTURE_SIZE,
  createDetailAtlas,
  createMacroVariation,
} from "../../../game/src/render/proceduralTextures.js";

async function dump(name: string, data: Uint8Array, size: number, channels: string[]): Promise<void> {
  for (let c = 0; c < 4; c += 1) {
    const tile = new Uint8Array(size * size);
    for (let i = 0; i < size * size; i += 1) tile[i] = data[i * 4 + c]!;
    let min = 255; let max = 0; let sum = 0;
    for (const v of tile) { min = Math.min(min, v); max = Math.max(max, v); sum += v; }
    const doubled = new Uint8Array(size * 2 * size * 2);
    for (let y = 0; y < size * 2; y += 1) {
      for (let x = 0; x < size * 2; x += 1) doubled[y * size * 2 + x] = tile[(y % size) * size + (x % size)]!;
    }
    const file = `runs/corealm/screenshots/look-atlas-${name}-${channels[c]}.png`;
    await sharp(Buffer.from(doubled), { raw: { width: size * 2, height: size * 2, channels: 1 } })
      .png().toFile(file);
    const enc = (v: number): string => (v / 255 + 0.5).toFixed(2);
    console.log(`${name}.${channels[c]}  byte ${min}..${max} mean ${(sum / tile.length).toFixed(1)}  multiplier ${enc(min)}..${enc(max)} mean ${enc(sum / tile.length)}`);
  }
}

const atlas = createDetailAtlas();
const macro = createMacroVariation();
await dump("detail", atlas.image.data as Uint8Array, DETAIL_ATLAS_SIZE, ["grass", "soil", "rock", "gravel"]);
await dump("macro", macro.image.data as Uint8Array, MACRO_TEXTURE_SIZE, ["grass", "soil", "rock", "gravel"]);
