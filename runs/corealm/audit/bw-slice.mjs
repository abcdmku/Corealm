// Scratch: slice a kit GLB in WORLD metres so a prefab author knows what the module actually is.
import { NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
function mul(m, v) {
  return [
    m[0]*v[0]+m[4]*v[1]+m[8]*v[2]+m[12],
    m[1]*v[0]+m[5]*v[1]+m[9]*v[2]+m[13],
    m[2]*v[0]+m[6]*v[1]+m[10]*v[2]+m[14],
  ];
}
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f);
  const pts = [];
  for (const scene of doc.getRoot().listScenes()) {
    scene.traverse((node) => {
      const mesh = node.getMesh();
      if (!mesh) return;
      const m = node.getWorldMatrix();
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION');
        const el = [0,0,0];
        for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, el); pts.push(mul(m, el)); }
      }
    });
  }
  const bins = new Map();
  for (const [x,y,z] of pts) {
    const k = Math.round(z*5)/5;
    const b = bins.get(k) ?? {ymin:1e9,ymax:-1e9,xmin:1e9,xmax:-1e9,n:0};
    b.ymin=Math.min(b.ymin,y); b.ymax=Math.max(b.ymax,y);
    b.xmin=Math.min(b.xmin,x); b.xmax=Math.max(b.xmax,x); b.n++;
    bins.set(k,b);
  }
  console.log('---', f, 'verts', pts.length);
  for (const k of [...bins.keys()].sort((a,b)=>a-b)) {
    const b = bins.get(k);
    console.log(`z=${k.toFixed(1).padStart(6)} y[${b.ymin.toFixed(3)},${b.ymax.toFixed(3)}] x[${b.xmin.toFixed(2)},${b.xmax.toFixed(2)}] n=${b.n}`);
  }
}
