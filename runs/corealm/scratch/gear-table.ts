import { readFileSync } from "node:fs";
import { EQUIPMENT } from "../../../game/src/content/equipment.js";
import { gearAppearance, gearAppearanceParts, weaponAttachment, GEAR_ASSET_GAPS } from "../../../game/src/render/equipmentVisuals.js";

const manifest = JSON.parse(readFileSync("game/public/assets/manifest.json", "utf8")) as { assets: { id: string }[] };
const ids = new Set(manifest.assets.map((a) => a.id));
let bad = 0, empty = 0, drawn = 0;
console.log("id".padEnd(24), "slot".padEnd(11), "attach".padEnd(7), "assetId".padEnd(30), "scale".padEnd(7), "tint".padEnd(9), "manifest");
for (const def of EQUIPMENT) {
  const parts = gearAppearanceParts(def.id);
  if (parts.length === 0) {
    empty++;
    const reason = GEAR_ASSET_GAPS[def.id] ? "GAP: " + GEAR_ASSET_GAPS[def.id] : "not a visible slot";
    console.log(def.id.padEnd(24), (def.equip?.slot ?? "-").padEnd(11), "-".padEnd(7), "(none)".padEnd(30), "-".padEnd(7), "-".padEnd(9), reason);
    continue;
  }
  for (const p of parts) {
    const ok = ids.has(p.assetId);
    if (!ok) bad++; else drawn++;
    const socket = p.attach === "bone" ? weaponAttachment(p) : null;
    console.log(
      def.id.padEnd(24), p.slot.padEnd(11), p.attach.padEnd(7), p.assetId.padEnd(30),
      String(p.scale ?? "-").padEnd(7), ("#" + (p.tint ?? 0).toString(16).padStart(6, "0")).padEnd(9),
      ok ? "ok" : "MISSING", socket ? `bone=${socket.bone} pos=[${socket.position.map((v) => v.toFixed(3)).join(",")}] rot=[${socket.rotation.map((v) => v.toFixed(3)).join(",")}] s=${socket.scale}` : "",
    );
  }
}
console.log(`\nrows=${EQUIPMENT.length} parts drawn=${drawn} missing-from-manifest=${bad} no-mesh=${empty}`);
const femaleBad = EQUIPMENT.flatMap((d) => gearAppearanceParts(d.id, "female")).filter((p) => !ids.has(p.assetId));
console.log("female variants missing from manifest:", femaleBad.length);
console.log("gearAppearance('kaldite_sword'):", JSON.stringify(gearAppearance("kaldite_sword")));
