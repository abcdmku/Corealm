import sharp from "sharp";
const f = process.argv[2]!;
const points: [number, number, string][] = JSON.parse(process.argv[3]!);
const img = sharp(f);
for (const [x, y, label] of points) {
  const buf = await img.clone().extract({ left: x, top: y, width: 3, height: 3 }).raw().toBuffer();
  const px: number[] = [];
  for (let i = 0; i < 3; i += 1) {
    let s = 0;
    for (let p = 0; p < 9; p += 1) s += buf[p * 3 + i] ?? 0;
    px.push(Math.round(s / 9));
  }
  console.log(label.padEnd(22), px.join(","));
}
