import { writeFileSync } from "node:fs";
import sharp from "sharp";
import { itemIconSvg, iconShapeFor } from "../../../game/src/ui/itemIcons.js";
import { EQUIPMENT } from "../../../game/src/content/equipment.js";

const picks = [
  "grithe_sword", "kaldite_dagger", "cairnpine_staff", "cairnpine_shield", "garnet_focus",
  "storm_charm", "storm_ring", "kaldite_helm", "marchhide_hood", "kaldite_plate",
  "wightshroud_robe", "kaldite_greaves", "kaldite_boots", "kaldite_gauntlets",
];
const byId = new Map(EQUIPMENT.map((d) => [d.id, d]));
const cell = 96;
const cols = 7;
const rows = Math.ceil(picks.length / cols);
let body = "";
picks.forEach((id, i) => {
  const def = byId.get(id);
  const x = (i % cols) * cell;
  const y = Math.floor(i / cols) * cell;
  const svg = itemIconSvg(def).replace('<svg class="icon" viewBox="0 0 24 24"', '<svg viewBox="0 0 24 24" width="72" height="72" x="12" y="8"');
  body += `<g transform="translate(${x},${y})"><rect width="${cell}" height="${cell}" fill="#1b1e24"/><g fill="#cfd6e4">${svg}</g><text x="48" y="92" font-size="9" fill="#8d97a8" text-anchor="middle">${iconShapeFor(def)}</text></g>`;
});
const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${cols * cell}" height="${rows * cell}">${body}</svg>`;
writeFileSync("runs/corealm/scratch/icons.svg", sheet);
await sharp(Buffer.from(sheet)).png().toFile("runs/corealm/screenshots/eq-icons-sheet.png");
console.log("wrote runs/corealm/screenshots/eq-icons-sheet.png", picks.map((p) => `${p}=${iconShapeFor(byId.get(p))}`).join(" "));
