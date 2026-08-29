import sharp from 'sharp';
const [src, left, top, w, h, out, scale] = process.argv.slice(2);
await sharp(src)
  .extract({ left: +left, top: +top, width: +w, height: +h })
  .resize(+w * (+scale || 3), +h * (+scale || 3), { kernel: 'nearest' })
  .png().toFile(out);
console.log(out);
