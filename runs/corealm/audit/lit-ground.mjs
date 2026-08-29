// Ground legibility: RMS high-pass contrast inside a band, and the hue spread across it.
// A "uniform tint" reads as low high-pass RMS AND low chroma variance.
import sharp from 'sharp';
const [,,file,...bands] = process.argv;
const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
const ch = info.channels, W = info.width;
const lum = (i) => 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
console.log(file.split(/[\/]/).pop());
for (const b of bands) {
  const [x0, y0, x1, y1, label = ''] = b.split(',');
  const X0 = +x0, Y0 = +y0, X1 = +x1, Y1 = +y1;
  // High-pass against a 17 px box, which at these framings is roughly a 1-2 m feature.
  let n = 0, sq = 0, sum = 0, hueSq = [0, 0, 0], hueMean = [0, 0, 0];
  const vals = [];
  for (let y = Y0; y < Y1; y += 2) for (let x = X0; x < X1; x += 2) {
    let bx = 0, bn = 0;
    for (let dy = -8; dy <= 8; dy += 4) for (let dx = -8; dx <= 8; dx += 4) {
      const xx = Math.min(W - 1, Math.max(0, x + dx)), yy = Math.min(info.height - 1, Math.max(0, y + dy));
      bx += lum((yy * W + xx) * ch); bn++;
    }
    const i = (y * W + x) * ch;
    const v = lum(i) - bx / bn;
    sq += v * v; n++; sum += lum(i);
    vals.push(lum(i));
    // Chroma: r-g and g-b, which is what "one flat green" kills.
    hueMean[0] += data[i] - data[i + 1]; hueMean[1] += data[i + 1] - data[i + 2];
  }
  hueMean[0] /= n; hueMean[1] /= n;
  for (let y = Y0; y < Y1; y += 2) for (let x = X0; x < X1; x += 2) {
    const i = (y * W + x) * ch;
    hueSq[0] += Math.pow((data[i] - data[i + 1]) - hueMean[0], 2);
    hueSq[1] += Math.pow((data[i + 1] - data[i + 2]) - hueMean[1], 2);
  }
  vals.sort((a, b2) => a - b2);
  const p = (q) => vals[Math.floor(q * (vals.length - 1))].toFixed(0);
  console.log(`  ${(label || b).padEnd(16)} n=${n} meanLum ${(sum / n).toFixed(1)} highpassRMS ${Math.sqrt(sq / n).toFixed(2)}` +
    ` p5..p95 ${p(0.05)}..${p(0.95)} chromaSD(r-g,g-b) ${Math.sqrt(hueSq[0] / n).toFixed(2)},${Math.sqrt(hueSq[1] / n).toFixed(2)}`);
}
