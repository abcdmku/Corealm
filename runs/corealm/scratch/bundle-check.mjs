import { rolldown } from "rolldown";
const bundle = await rolldown({
  input: "runs/corealm/scratch/eq-entry.ts",
  platform: "browser",
  external: ["three"],
});
const out = await bundle.generate({ format: "esm" });
console.log("bundled ok, chunks:", out.output.length, "bytes:", out.output[0].code.length);
