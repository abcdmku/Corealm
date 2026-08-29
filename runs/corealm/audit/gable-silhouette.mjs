// XY silhouette of a GLB, rasterised. Answers "is this triangle actually filled, and how far out
// does its frame reach", which a bounding box cannot.
import { NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
const file = process.argv[2];
const COLS = 79, ROWS = 30;
function mul(m, v) {
  return [m[0]*v[0]+m[4]*v[1]+m[8]*v[2]+m[12], m[1]*v[0]+m[5]*v[1]+m[9]*v[2]+m[13], m[2]*v[0]+m[6]*v[1]+m[10]*v[2]+m[14]];
}
const tris = [];
let lo = [1e9,1e9], hi = [-1e9,-1e9];
for (const scene of (await io.read(file)).getRoot().listScenes()) {
  scene.traverse((node) => {
    const mesh = node.getMesh(); if (!mesh) return;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const idx = prim.getIndices();
      const count = idx ? idx.getCount() : pos.getCount();
      const el = [0,0,0];
      const get = (i) => { pos.getElement(idx ? idx.getScalar(i) : i, el); const p = mul(m, el); return [p[0], p[1]]; };
      for (let i = 0; i + 2 < count; i += 3) {
        const t = [get(i), get(i+1), get(i+2)];
        tris.push(t);
        for (const p of t) { lo[0]=Math.min(lo[0],p[0]); lo[1]=Math.min(lo[1],p[1]); hi[0]=Math.max(hi[0],p[0]); hi[1]=Math.max(hi[1],p[1]); }
      }
    }
  });
}
const grid = Array.from({length: ROWS}, () => new Array(COLS).fill(false));
const sign = (a,b,c) => (a[0]-c[0])*(b[1]-c[1]) - (b[0]-c[0])*(a[1]-c[1]);
for (let r = 0; r < ROWS; r += 1) {
  for (let c = 0; c < COLS; c += 1) {
    const x = lo[0] + ((c + 0.5) / COLS) * (hi[0] - lo[0]);
    const y = hi[1] - ((r + 0.5) / ROWS) * (hi[1] - lo[1]);
    for (const t of tris) {
      const d1 = sign([x,y], t[0], t[1]), d2 = sign([x,y], t[1], t[2]), d3 = sign([x,y], t[2], t[0]);
      const neg = (d1 < 0) || (d2 < 0) || (d3 < 0);
      const pos = (d1 > 0) || (d2 > 0) || (d3 > 0);
      if (!(neg && pos)) { grid[r][c] = true; break; }
    }
  }
}
console.log(`${file}  x[${lo[0].toFixed(3)},${hi[0].toFixed(3)}] y[${lo[1].toFixed(3)},${hi[1].toFixed(3)}]  ${tris.length} tris`);
for (let r = 0; r < ROWS; r += 1) {
  const y = hi[1] - ((r + 0.5) / ROWS) * (hi[1] - lo[1]);
  // Widest filled column on this row, in metres from the centre.
  let widest = 0;
  for (let c = 0; c < COLS; c += 1) if (grid[r][c]) {
    const x = lo[0] + ((c + 0.5) / COLS) * (hi[0] - lo[0]);
    widest = Math.max(widest, Math.abs(x));
  }
  console.log(`${y.toFixed(2).padStart(6)} |${grid[r].map((v) => (v ? '#' : '.')).join('')}| solid to |x|=${widest.toFixed(2)}`);
}
