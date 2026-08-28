/**
 * Can the player still reach every interactive entity after the new solid volumes land?
 *
 * `gameApi.interact` measures the gap to the entity CENTRE against INTERACT_RANGE 2.4 m, and the
 * navmesh carve pushes the nearest standable point out by NAV_CONFIG.walkableRadius. So for every
 * entity that carries an interaction, at least one point on a ring at 2.0 m must be outside every
 * solid volume in the world. This is the check that catches a composition ringing its own hero.
 */
import { readFileSync } from "node:fs";
import { buildWorld, type AssetSize } from "../../../game/src/world/regionBuilder.js";
import type { SolidVolume, Vec3 } from "../../../game/src/contracts.js";

interface ManifestAsset { id: string; size: { x: number; y: number; z: number }; base?: { y: number } }
const manifest = JSON.parse(readFileSync("game/public/assets/manifest.json", "utf8")) as { assets: ManifestAsset[] };
const byId = new Map(manifest.assets.map((asset) => [asset.id, asset]));

// XZ-only check, so the terrain field is irrelevant and deliberately not imported: `scene.ts` is
// being rewritten in the same wave and this audit must not depend on it.
const heightAt = (): number => 0;
const world = buildWorld(1, heightAt, {
  heightAt,
  baseY: (id) => byId.get(id)?.base?.y ?? 0,
  assetSize: (id): AssetSize | null => byId.get(id)?.size ?? null,
});

const PLAYER_RADIUS = 0.45;

function insideXZ(solid: SolidVolume, x: number, z: number, pad: number): boolean {
  if (solid.kind === "cylinder") {
    return Math.hypot(x - solid.position[0], z - solid.position[2]) < solid.radius + pad;
  }
  const dx = x - solid.position[0];
  const dz = z - solid.position[2];
  const cos = Math.cos(solid.rotationY);
  const sin = Math.sin(solid.rotationY);
  // Inverse of world = (dx*cos + dz*sin, -dx*sin + dz*cos).
  const lx = dx * cos - dz * sin;
  const lz = dx * sin + dz * cos;
  return Math.abs(lx) < solid.size[0] / 2 + pad && Math.abs(lz) < solid.size[2] / 2 + pad;
}

const blockedById = new Map<string, SolidVolume[]>();
for (const solid of world.solids) {
  const list = blockedById.get(solid.id) ?? [];
  list.push(solid);
  blockedById.set(solid.id, list);
}

let checked = 0;
const unreachable: string[] = [];
for (const entity of world.entities) {
  if (entity.interactions.length === 0) continue;
  if (entity.archetype === "npc" || entity.archetype === "enemy" || entity.archetype === "boss") continue;
  checked += 1;
  const own = new Set((blockedById.get(entity.id) ?? []).map((solid) => solid));
  const [ex, , ez]: Vec3 = entity.position;
  let open = 0;
  for (let step = 0; step < 32; step += 1) {
    const angle = (step / 32) * Math.PI * 2;
    const x = ex + Math.cos(angle) * 2;
    const z = ez + Math.sin(angle) * 2;
    let blocked = false;
    for (const solid of world.solids) {
      if (own.has(solid)) continue;
      if (Math.abs(solid.position[0] - x) > 30 || Math.abs(solid.position[2] - z) > 30) continue;
      if (insideXZ(solid, x, z, PLAYER_RADIUS)) { blocked = true; break; }
    }
    if (!blocked) open += 1;
  }
  if (open === 0) unreachable.push(`${entity.id} (${entity.archetype})`);
}
console.log(`interactive entities checked: ${checked}`);
console.log(`fully ringed by other solids at r=2.0: ${unreachable.length}`);
for (const row of unreachable) console.log("   ", row);

// And: does any entity sit INSIDE another entity's solid, which would make it unstandable?
let overlapping = 0;
for (const entity of world.entities) {
  if (entity.interactions.length === 0) continue;
  const own = new Set((blockedById.get(entity.id) ?? []).map((solid) => solid));
  for (const solid of world.solids) {
    if (own.has(solid)) continue;
    if (insideXZ(solid, entity.position[0], entity.position[2], 0)) {
      overlapping += 1;
      console.log(`   ${entity.id} inside ${solid.id}`);
      break;
    }
  }
}
console.log(`interactive entities whose centre is inside someone else's volume: ${overlapping}`);
