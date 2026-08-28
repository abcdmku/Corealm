import { NodeIO, getBounds } from '@gltf-transform/core';
import { KHRMeshQuantization } from '@gltf-transform/extensions';
import fs from 'node:fs';
const io = new NodeIO().registerExtensions([KHRMeshQuantization]);
const ids = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync('game/public/assets/manifest.json','utf8'));
for (const id of ids) {
  const a = manifest.assets.find(x=>x.id===id);
  if (!a) { console.log(id.padEnd(24), 'MISSING'); continue; }
  const doc = await io.read('game/public/assets/'+a.file);
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  const b = getBounds(scene);
  const f=(v)=>v.map(n=>n.toFixed(3).padStart(8)).join(' ');
  console.log(id.padEnd(24), 'min', f(b.min), '  max', f(b.max));
}
