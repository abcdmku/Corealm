import { Solids } from "../../../game/src/systems/solids.js";
import type { SolidVolume, Vec3 } from "../../../game/src/contracts.js";

const volumes: SolidVolume[] = [
  // A 6 x 4 m cottage at (-146, -104), base y = 1.0, 5 m tall, unrotated.
  { kind: "box", id: "cottage", position: [-146, 1, -104], size: [6, 5, 4], rotationY: 0 },
  // The same cottage rotated 45 degrees, elsewhere.
  { kind: "box", id: "rot", position: [0, 0, 0], size: [6, 5, 4], rotationY: Math.PI / 4 },
  // A tree trunk.
  { kind: "cylinder", id: "trunk", position: [20, 0, 0], radius: 0.6, height: 6 },
  // A knee-high fence panel.
  { kind: "box", id: "fence", position: [40, 0, 0], size: [4, 0.9, 0.2], rotationY: 0 },
];

const s = new Solids(volumes);
console.log("count", s.count(), "cells", s.cellCount());

function step(from: Vec3, dx: number, dz: number): Vec3 {
  return s.resolve([from[0] + dx, from[1], from[2] + dz], from, 0.35);
}

// 1. Straight into the cottage south wall from z = -108 walking +z.
let p: Vec3 = [-146, 1.04, -107];
for (let i = 0; i < 40; i += 1) p = step(p, 0, 0.42);
console.log("cottage head-on end", p.map((v) => +v.toFixed(3)));

// 2. Diagonal into the same wall: must slide along +x.
p = [-146, 1.04, -107];
for (let i = 0; i < 40; i += 1) p = step(p, 0.297, 0.297);
console.log("cottage diagonal end", p.map((v) => +v.toFixed(3)));

// 3. Rotated box, head on along +x.
p = [-8, 0.04, 0];
for (let i = 0; i < 40; i += 1) p = step(p, 0.42, 0);
console.log("rotated box end", p.map((v) => +v.toFixed(3)), "expect x ~ -(3.536+0.35)");

// 4. Tree trunk.
p = [16, 0.04, 0];
for (let i = 0; i < 40; i += 1) p = step(p, 0.42, 0);
console.log("trunk end", p.map((v) => +v.toFixed(3)), "expect x ~ 20-0.95 = 19.05");

// 5. Fence: player floating 0.42 m above its base (the measured navmesh float) must still block.
p = [40, 0.42, -3];
for (let i = 0; i < 20; i += 1) p = step(p, 0, 0.42);
console.log("fence end (player floating 0.42)", p.map((v) => +v.toFixed(3)), "expect z ~ -0.45");

// 6. A volume overhead must NOT block.
const overhead = new Solids([{ kind: "box", id: "eave", position: [0, 4, 0], size: [6, 1, 4], rotationY: 0 }]);
p = [-8, 0, 0];
for (let i = 0; i < 40; i += 1) p = overhead.resolve([p[0] + 0.42, p[1], p[2]], p, 0.35);
console.log("overhead end", p.map((v) => +v.toFixed(3)), "expect x = 8.8 (free)");

// 7. contains(): roof point and interior point.
console.log("contains roof (-146, 5.5, -104)", s.contains([-146, 5.5, -104]), "expect true");
console.log("contains interior (-146, 1.04, -104)", s.contains([-146, 1.04, -104]), "expect true");
console.log("contains above roof (-146, 6.5, -104)", s.contains([-146, 6.5, -104]), "expect false");
console.log("contains outside (-140, 1.04, -104)", s.contains([-140, 1.04, -104]), "expect false");

// 8. Determinism: same inputs, same outputs, twice.
const a = step([-146, 1.04, -105.5], 0.3, 0.3);
const b = step([-146, 1.04, -105.5], 0.3, 0.3);
console.log("deterministic", JSON.stringify(a) === JSON.stringify(b));

// 9. Cost: 900 volumes, 10,000 resolves.
const many: SolidVolume[] = [];
for (let i = 0; i < 900; i += 1) {
  many.push({ kind: "cylinder", id: `c${i}`, position: [(i % 30) * 20 - 300, 0, Math.floor(i / 30) * 12 - 180], radius: 0.8, height: 4 });
}
const big = new Solids(many);
const t0 = performance.now();
let q: Vec3 = [-300, 0.2, -180];
for (let i = 0; i < 10000; i += 1) {
  q = big.resolve([q[0] + 0.01, q[1], q[2] + 0.003], q, 0.35);
}
console.log("900 volumes / 10k resolves ms", +(performance.now() - t0).toFixed(2), "cells", big.cellCount());
