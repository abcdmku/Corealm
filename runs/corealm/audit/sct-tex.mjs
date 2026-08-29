import fs from 'node:fs';
import sharp from 'sharp';
const files = process.argv.slice(2);
for (const f of files) {
  const b = fs.readFileSync('game/public/assets/models/' + f);
  const l = b.readUInt32LE(12);
  const j = JSON.parse(b.slice(20, 20 + l).toString('utf8'));
  const binStart = 20 + l + 8;
  for (const [i, img] of (j.images ?? []).entries()) {
    const bv = j.bufferViews[img.bufferView];
    const start = binStart + (bv.byteOffset || 0);
    const png = b.slice(start, start + bv.byteLength);
    const s = sharp(png);
    const { data } = await s.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let r = 0, g = 0, bl = 0, n = 0;
    for (let k = 0; k < data.length; k += 4) { if (data[k + 3] < 128) continue; r += data[k]; g += data[k + 1]; bl += data[k + 2]; n++; }
    console.log(f, 'image', i, img.name, 'mean rgb', (r / n).toFixed(0), (g / n).toFixed(0), (bl / n).toFixed(0));
  }
}
