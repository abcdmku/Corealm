const ch = [
  { c: [40, -40] as [number, number], y: 17.906, r: 11 },
  { c: [30, -58] as [number, number], y: 13.906, r: 12 },
  { c: [22, -76] as [number, number], y: 9.906, r: 12 },
];
const h = (x: number, z: number): number => {
  let w = 0, t = 0;
  for (const c of ch) {
    const d = Math.hypot(x - c.c[0], z - c.c[1]);
    const k = 1 / (d * d * d + 0.05);
    w += c.y * k; t += k;
  }
  return w / t;
};
console.log("profile across chamber 1 along the line toward chamber 2 (t=-1 away .. +1 toward)");
for (let t = -1; t <= 1.001; t += 0.2) {
  const dx = (30 - 40) / 20.6, dz = (-58 + 40) / 20.6;
  const d = t * 12.2;
  const x = 40 + dx * d, z = -40 + dz * d;
  console.log(t.toFixed(1), (x).toFixed(1), (z).toFixed(1), h(x, z).toFixed(2));
}
console.log("perpendicular across chamber 1");
for (let t = -1; t <= 1.001; t += 0.25) {
  const px = -(-58 + 40) / 20.6, pz = (30 - 40) / 20.6;
  const d = t * 12.2;
  console.log(t.toFixed(2), h(40 + px * d, -40 + pz * d).toFixed(2));
}
console.log("max slope along the c1-c2 line");
let worst = 0;
for (let s = 0; s < 20.6; s += 0.25) {
  const dx = (30 - 40) / 20.6, dz = (-58 + 40) / 20.6;
  const a = h(40 + dx * s, -40 + dz * s);
  const b = h(40 + dx * (s + 0.25), -40 + dz * (s + 0.25));
  worst = Math.max(worst, Math.abs(b - a) / 0.25);
}
console.log("worst gradient", worst.toFixed(3), "=", (Math.atan(worst) * 180 / Math.PI).toFixed(1), "deg");
