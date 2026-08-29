// Which GLBs carry COLOR_0, in what component type, and whether the stored values are near zero.
import fs from 'node:fs';
const CT = { 5120:'BYTE', 5121:'UBYTE', 5122:'SHORT', 5123:'USHORT', 5125:'UINT', 5126:'FLOAT' };
for (const f of process.argv.slice(2)) {
  const buf = fs.readFileSync(f);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const binStart = 20 + jsonLen + 8;
  const rows = [];
  for (const mesh of json.meshes ?? []) for (const prim of mesh.primitives ?? []) {
    const ci = prim.attributes?.COLOR_0;
    if (ci === undefined) continue;
    const acc = json.accessors[ci];
    const bv = json.bufferViews[acc.bufferView];
    const off = binStart + (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const comps = acc.type === 'VEC4' ? 4 : 3;
    let mn = 1e9, mx = -1e9;
    const n = Math.min(acc.count, 512);
    for (let i = 0; i < n; i += 1) for (let c = 0; c < comps; c += 1) {
      let v;
      const p = off + (i * comps + c) * (acc.componentType === 5126 ? 4 : acc.componentType === 5123 ? 2 : 1);
      if (acc.componentType === 5126) v = buf.readFloatLE(p);
      else if (acc.componentType === 5123) v = buf.readUInt16LE(p) / 65535;
      else v = buf.readUInt8(p) / 255;
      if (v < mn) mn = v; if (v > mx) mx = v;
    }
    const matName = json.materials?.[prim.material]?.name ?? '(none)';
    rows.push(`${matName} ${acc.type}/${CT[acc.componentType]} norm=${acc.normalized ?? false} range ${mn.toFixed(3)}..${mx.toFixed(3)}`);
  }
  if (rows.length) console.log(f.split(/[\/]/).pop(), '\n   ' + rows.join('\n   '));
}
