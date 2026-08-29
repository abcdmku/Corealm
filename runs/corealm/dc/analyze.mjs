import { readFile } from "node:fs/promises";
import { meshInfo } from "./glbmesh.mjs";
const ents = JSON.parse(await readFile("C:/Users/Borg/Documents/GitHub/Corealm/runs/corealm/dc/keys.json", "utf8"));
const TIERED = new Set(["ore","tree","fishing_spot","farm_plot","enemy","boss"]);
const APPEAR = new Set(["ore","tree","fishing_spot","farm_plot","enemy","boss"]);
const ROOF = /roundtiles|rooftile/i;
const cache = new Map();
async function info(id){ if(!cache.has(id)) cache.set(id, await meshInfo(id)); return cache.get(id); }

const groups = new Map();
for (const e of ents) {
  const key = `${e.parts? e.parts.join('+')+'@'+e.asset : e.asset}|${e.dep??'-'}|${e.arch==='npc'?'-':e.tier}|${e.arch}|${e.clip}`;
  const g = groups.get(key) ?? { key, n:0, e };
  g.n += 1; groups.set(key, g);
}
let meshes = 0, unknown = 0;
const rows = [];
for (const g of groups.values()) {
  const i = await info(g.e.asset);
  if (!i) { unknown += 1; continue; }
  meshes += i.prims + (g.e.arch === 'ore' ? 1 : 0);
  rows.push({ key: g.key, n: g.n, prims: i.prims, mats: i.mats, arch: g.e.arch, asset: g.e.asset });
}
console.log('groups', groups.size, 'unknown-assets', unknown, 'sum prims', meshes);

// simulate tier-blind grouping where tier is irrelevant
const tierBlind = new Map();
for (const e of ents) {
  const i = await info(e.asset);
  const roofy = i ? i.matNames.some((n)=>ROOF.test(n)) : true;
  const matters = APPEAR.has(e.arch) || roofy;
  const key = `${e.parts? e.parts.join('+')+'@'+e.asset : e.asset}|${e.dep??'-'}|${matters?e.tier:'-'}|${e.arch}|${e.clip}`;
  tierBlind.set(key, (tierBlind.get(key)??0)+1);
}
let m2=0;
for (const k of tierBlind.keys()) { const asset=k.split('|')[0].split('@').pop(); const i=await info(asset); if(i) m2 += i.prims + (k.split('|')[3]==='ore'?1:0); }
console.log('tier-blind groups', tierBlind.size, 'sum prims', m2);

// simulate merge-by-material within group
let m3=0;
for (const k of tierBlind.keys()) { const asset=k.split('|')[0].split('@').pop(); const i=await info(asset); if(i) m3 += Math.min(i.prims,i.mats) + (k.split('|')[3]==='ore'?1:0); }
console.log('tier-blind + material-merged sum prims', m3);

rows.sort((a,b)=>b.prims-a.prims);
console.log(rows.slice(0,25).map(r=>`${String(r.prims).padStart(3)} prims ${String(r.mats).padStart(2)} mats n=${String(r.n).padStart(3)} ${r.key}`).join('\n'));
