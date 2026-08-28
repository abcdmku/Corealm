import { NodeIO, getBounds } from '@gltf-transform/core';
import { KHRMeshQuantization } from '@gltf-transform/extensions';
import fs from 'node:fs';
const io = new NodeIO().registerExtensions([KHRMeshQuantization]);
const manifest = JSON.parse(fs.readFileSync('game/public/assets/manifest.json','utf8'));
for (const id of process.argv.slice(2)) {
  const a = manifest.assets.find(x=>x.id===id);
  if (!a) { console.log(id.padEnd(24), 'MISSING'); continue; }
  const doc = await io.read('game/public/assets/'+a.file);
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  const b = getBounds(scene);
  let prims=0;
  for (const m of doc.getRoot().listMeshes()) prims += m.listPrimitives().length;
  const f=(v)=>v.map(n=>n.toFixed(2).padStart(7)).join(' ');
  console.log(id.padEnd(22), 'prims', String(prims).padStart(2), ' min', f(b.min), ' max', f(b.max));
}
