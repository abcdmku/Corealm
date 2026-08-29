// Per-primitive bbox + material for a kit GLB, so a prefab author can see what part of a panel is
// stone and what part is timber without opening Blender.
import { NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
function mul(m, v) {
  return [m[0]*v[0]+m[4]*v[1]+m[8]*v[2]+m[12], m[1]*v[0]+m[5]*v[1]+m[9]*v[2]+m[13], m[2]*v[0]+m[6]*v[1]+m[10]*v[2]+m[14]];
}
for (const f of process.argv.slice(2)) {
  console.log('===', f);
  for (const scene of (await io.read(f)).getRoot().listScenes()) {
    scene.traverse((node) => {
      const mesh = node.getMesh(); if (!mesh) return;
      const m = node.getWorldMatrix();
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION'); const el = [0,0,0];
        let lo=[1e9,1e9,1e9], hi=[-1e9,-1e9,-1e9];
        for (let i=0;i<pos.getCount();i++){ pos.getElement(i,el); const p=mul(m,el);
          for(let k=0;k<3;k++){ lo[k]=Math.min(lo[k],p[k]); hi[k]=Math.max(hi[k],p[k]); } }
        const mat = prim.getMaterial();
        const bc = mat?.getBaseColorFactor?.();
        console.log('  mat', (mat?.getName()||'?').padEnd(22),
          'verts', String(pos.getCount()).padStart(5),
          'x['+lo[0].toFixed(2)+','+hi[0].toFixed(2)+']',
          'y['+lo[1].toFixed(2)+','+hi[1].toFixed(2)+']',
          'z['+lo[2].toFixed(2)+','+hi[2].toFixed(2)+']',
          'doubleSided', mat?.getDoubleSided?.(), 'alpha', mat?.getAlphaMode?.(),
          bc ? 'baseColor ['+bc.map(v=>v.toFixed(2)).join(',')+']' : '');
      }
    });
  }
}
