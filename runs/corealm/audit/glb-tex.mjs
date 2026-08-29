import fs from 'node:fs';
import sharp from 'sharp';
const f = process.argv[2];
const buf = fs.readFileSync(f);
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
const binStart = 20 + jsonLen + 8;
const bin = buf.subarray(binStart);
console.log('images', JSON.stringify(json.images));
console.log('samplers', JSON.stringify(json.samplers));
for (const [i, img] of (json.images ?? []).entries()) {
  const bv = json.bufferViews[img.bufferView];
  const data = bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
  const out = `runs/corealm/screenshots/look-glbtex-${i}.png`;
  const meta = await sharp(data).metadata();
  await sharp(data).resize(256, 256, { kernel: 'nearest' }).png().toFile(out);
  console.log(out, meta.width + 'x' + meta.height, meta.format);
}
