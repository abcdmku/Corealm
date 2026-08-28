import { EQUIPMENT, KITS } from "../../../game/src/content/equipment.js";
const byId = new Map(EQUIPMENT.map((d) => [d.id, d]));
for (const [kit, ids] of Object.entries(KITS)) {
  const t = { accuracy: 0, power: 0, armour: 0, magicAccuracy: 0, magicPower: 0, magicArmour: 0, vitality: 0 };
  for (const id of ids) {
    const b = byId.get(id)?.equip?.bonuses;
    if (!b) { console.log("MISSING", id); continue; }
    for (const k of Object.keys(t) as (keyof typeof t)[]) t[k] += b[k];
  }
  console.log(kit, JSON.stringify(t));
}
console.log("rows", EQUIPMENT.length);
