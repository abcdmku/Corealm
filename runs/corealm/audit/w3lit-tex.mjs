import { createDetailAtlas, createMacroVariation, DETAIL_VALUE_OFFSET } from "../../../game/src/render/proceduralTextures.js";
const a = createDetailAtlas(); const m = createMacroVariation();
function stats(tex, name, ch) {
  const d = tex.image.data; const n = d.length/4;
  const v = new Float64Array(n);
  for (let i=0;i<n;i++) v[i] = d[i*4+ch]/255 + DETAIL_VALUE_OFFSET;
  v.sort();
  const mean = v.reduce((s,x)=>s+x,0)/n;
  const sd = Math.sqrt(v.reduce((s,x)=>s+(x-mean)**2,0)/n);
  const q = p => v[Math.floor(p*(n-1))];
  console.log(`${name} ch${ch}: mean ${mean.toFixed(3)} sd ${sd.toFixed(4)} min ${q(0).toFixed(3)} p5 ${q(0.05).toFixed(3)} p95 ${q(0.95).toFixed(3)} max ${q(1).toFixed(3)}`);
}
for (const c of [0,1,2,3]) stats(a,"detail",c);
for (const c of [0,1,2,3]) stats(m,"macro ",c);
