import { NodeIO } from "@gltf-transform/core";
import { KHRONOS_EXTENSIONS } from "@gltf-transform/extensions";
import { readdir } from "node:fs/promises";

const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
const dir = "game/public/assets/models/animal";
const files = (await readdir(dir)).filter((f) => f.endsWith(".glb")).sort();
console.log("asset                     Idle    Walk  Attack   Death");
for (const file of files) {
  const doc = await io.read(`${dir}/${file}`);
  const durations: Record<string, number> = {};
  for (const anim of doc.getRoot().listAnimations()) {
    let d = 0;
    for (const ch of anim.listChannels()) {
      const times = ch.getSampler()?.getInput()?.getArray();
      if (times?.length) d = Math.max(d, Number(times[times.length - 1]));
    }
    durations[anim.getName()] = d;
  }
  const cell = (k: string) => (durations[k] === undefined ? "  -  " : durations[k]!.toFixed(2).padStart(5));
  const flag = (durations.Attack ?? 0) > 1.6 ? "  <== long" : "";
  console.log(`${file.replace(".glb", "").padEnd(24)} ${cell("Idle")} ${cell("Walk")} ${cell("Attack")} ${cell("Death")}${flag}`);
}
