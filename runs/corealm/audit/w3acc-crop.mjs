/** Pixel-accurate crops of a shipped screenshot, so "can you see through it" is looked at rather
 *  than guessed from a 1440-wide thumbnail. `npx tsx` picks sharp up from the repo's devDeps. */
import sharp from "sharp";
const [, , src, x, y, w, h, out, scale] = process.argv;
await sharp(src)
  .extract({ left: +x, top: +y, width: +w, height: +h })
  .resize({ width: Math.round(+w * (+scale || 3)), kernel: "nearest" })
  .toFile(out);
console.log("wrote", out);
