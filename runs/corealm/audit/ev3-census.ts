import * as THREE from "three";
import { WorldScene } from "../../../game/src/render/scene.js";
import { buildWorldTerrainSpec } from "../../../game/src/app/worldSpec.js";
import { buildWorld } from "../../../game/src/world/regionBuilder.js";
const scene: any = new WorldScene(new THREE.Scene());
scene.buildWorld(buildWorldTerrainSpec());
const world = buildWorld(1337, (x: number, z: number) => scene.heightAtXZ(x, z));
const ents = world.entities;
console.log("entities", ents.length);
const byArch: Record<string, number> = {};
for (const e of ents) byArch[e.archetype] = (byArch[e.archetype] ?? 0) + 1;
console.log(byArch);
const npcs = ents.filter((e: any) => e.archetype === "npc");
console.log("\nNPCS", npcs.length);
const combos = new Set<string>();
for (const n of npcs as any[]) {
  const key = `${n.view.assetId}|${(n.view.partAssetIds ?? []).join(",")}`;
  combos.add(key);
  console.log(" ", n.id.padEnd(28), n.regionId.padEnd(12), n.view.assetId.padEnd(12), (n.view.partAssetIds ?? []).map((p: string) => p.replace(/^outfit_(male|female)_/, "")).join(","));
}
console.log("distinct authored NPC combos:", combos.size);
const enemies = ents.filter((e: any) => e.archetype === "enemy" || e.archetype === "boss");
console.log("\nENEMIES", enemies.length);
const fam = new Map<string, any[]>();
for (const e of enemies as any[]) {
  const g = e.id.replace(/_\d+$/, "");
  if (!fam.has(g)) fam.set(g, []);
  fam.get(g)!.push(e);
}
for (const [g, list] of fam) {
  const e = list[0];
  console.log(" ", g.padEnd(28), String(list.length).padStart(2), e.view.assetId.padEnd(12), "tier", e.tier, "scale", e.view.scale, "family", e.meta?.family, e.regionId);
}
console.log("distinct enemy assets:", new Set(enemies.map((e: any) => e.view.assetId)).size, "groups:", fam.size);
