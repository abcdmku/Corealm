// Worker key ev2. Crop and upscale a region of a screenshot so a body part is actually readable.
import sharp from "sharp";
const [src, out, x, y, w, h, scale = "4"] = process.argv.slice(2);
await sharp(src)
  .extract({ left: +x, top: +y, width: +w, height: +h })
  .resize(+w * +scale, +h * +scale, { kernel: "nearest" })
  .toFile(out);
console.log(out);
