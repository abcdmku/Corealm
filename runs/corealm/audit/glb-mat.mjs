import fs from 'node:fs';
for (const f of process.argv.slice(2)) {
  const buf = fs.readFileSync(f);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  console.log('==', f);
  for (const m of json.materials ?? []) {
    const p = m.pbrMetallicRoughness ?? {};
    console.log('  ', m.name, 'base', JSON.stringify(p.baseColorFactor ?? [1,1,1,1]),
      'metal', p.metallicFactor ?? 1, 'rough', p.roughnessFactor ?? 1,
      'baseTex', p.baseColorTexture ? 'yes':'no', 'mrTex', p.metallicRoughnessTexture?'yes':'no');
  }
}
