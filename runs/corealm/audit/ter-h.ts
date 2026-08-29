import * as THREE from "three";
import { WorldScene } from "../../../game/src/render/scene.js";
import { buildWorldTerrainSpec, WATER_BASIN_DEPTH } from "../../../game/src/app/worldSpec.js";
import { REGIONS } from "../../../game/src/content/regions.js";
const scene = new WorldScene(new THREE.Scene());
scene.buildWorld(buildWorldTerrainSpec());
for (const region of REGIONS) {
  for (const cluster of region.clusters) {
    if (cluster.archetype !== "fishing_spot") continue;
    const [x, z] = cluster.centre;
    const level = scene.heightAt(region.id, x, z) + WATER_BASIN_DEPTH * 0.55;
    const R = cluster.radius + 14;
    console.log(`\n${cluster.id} centre=(${x},${z}) clusterR=${cluster.radius} discR=${R} level=${level.toFixed(2)}`);
    // radial profile at 8 azimuths
    for (let a = 0; a < 8; a += 1) {
      const ang = (a / 8) * Math.PI * 2;
      const row: string[] = [];
      for (let r = 0; r <= R; r += 3) {
        const h = scene.meshHeightAt(x + Math.cos(ang) * r, z + Math.sin(ang) * r);
        row.push((h - level >= 0 ? "+" : "") + (h - level).toFixed(1));
      }
      console.log("  az" + a + " " + row.join(" "));
    }
    // which named locations sit inside the disc
    for (const l of region.locations) {
      const d = Math.hypot(l.position[0] - x, l.position[1] - z);
      if (d < R) console.log(`  location ${l.id} at d=${d.toFixed(1)} kind=${l.kind} groundRel=${(scene.heightAtXZ(l.position[0], l.position[1]) - level).toFixed(2)}`);
    }
  }
}
