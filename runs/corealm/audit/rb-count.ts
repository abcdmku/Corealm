import { buildWorld } from "../../../game/src/world/regionBuilder.js";
const flat = buildWorld(1, () => 0);
console.log("flat heightAt entities:", flat.entities.length);
const ramp = buildWorld(1, (_r, x, z) => (x + z) * 0.01);
console.log("ramp heightAt entities:", ramp.entities.length);
const byArch = new Map<string, number>();
for (const e of flat.entities) byArch.set(e.archetype, (byArch.get(e.archetype) ?? 0) + 1);
console.log([...byArch].map(([k, v]) => `${k} ${v}`).join(", "));

// Do any two plot beds overlap? Each is one 2 m module.
const beds = flat.entities.filter((e) => String(e.id).endsWith("#bed"));
let clashes = 0;
for (let i = 0; i < beds.length; i += 1) {
  for (let j = i + 1; j < beds.length; j += 1) {
    const a = beds[i]!; const b = beds[j]!;
    if (Math.abs(a.position[0] - b.position[0]) < 2 && Math.abs(a.position[2] - b.position[2]) < 2) {
      clashes += 1;
      console.log("bed clash", a.id, b.id,
        (a.position[0] - b.position[0]).toFixed(2), (a.position[2] - b.position[2]).toFixed(2));
    }
  }
}
console.log("plot beds:", beds.length, "overlapping pairs:", clashes);
